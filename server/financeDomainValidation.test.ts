import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_IDENTITY_TYPES,
  FinanceDomainValidationError,
  adminIdentityImpliesEmployment,
  assertCreateAdminIdentityType,
  derivePayrollResultLineTotals,
  deriveTaxLiabilityNetAmountCents,
  deriveVendorBillSettlementState,
  validateDocumentLinkSensitivity,
  validatePayrollCorrectionRun,
  validatePayrollRunWorkerConsistency,
  validatePolymorphicEntityTarget,
  validateTaxFilingAmendment,
  validateTaxPaymentAllocationFromLockedRows,
  validateVendorBillCreditApplicationFromLockedRows,
  validateVendorBillPaymentApplicationFromLockedRows,
  validateWorkAuthorizationSupersession,
  type EmploymentSnapshot,
  type PayrollRunSnapshot,
  type TaxAgencyPaymentSnapshot,
  type TaxFilingSnapshot,
  type TaxLiabilitySnapshot,
  type VendorBillSnapshot,
  type WorkAuthorizationSnapshot,
} from "./financeDomainValidation";

function assertValidationError(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error) => error instanceof FinanceDomainValidationError && error.code === code,
  );
}

const payrollRun: PayrollRunSnapshot = {
  id: 10,
  legalEntityId: 1,
  runKind: "regular",
  status: "draft",
};

const employment: EmploymentSnapshot = {
  id: 20,
  workerId: 30,
  legalEntityId: 1,
};

const taxLiability: TaxLiabilitySnapshot = {
  id: 1,
  taxRegistrationId: 7,
  amountCents: 10_626,
  currency: "USD",
};

const taxPayment: TaxAgencyPaymentSnapshot = {
  id: 2,
  taxRegistrationId: 7,
  amountCents: 10_600,
  currency: "USD",
};

const vendorBill: VendorBillSnapshot = {
  id: 1,
  vendorId: 44,
  amountCents: 2_000,
  currency: "USD",
  billKind: "invoice",
  status: "approved",
};

test("finance foundation migration creates approved V1 tables and defers later tables", async () => {
  const migration = await readFile(
    new URL("../migrations/0017_finance_personnel_payroll_tax_foundation.sql", import.meta.url),
    "utf8",
  );

  const expectedTables = [
    "legal_entities",
    "workers",
    "employments",
    "compensation_terms",
    "work_authorizations",
    "payroll_runs",
    "payroll_run_workers",
    "payroll_result_lines",
    "payroll_payments",
    "tax_agencies",
    "tax_registrations",
    "tax_liabilities",
    "tax_agency_payments",
    "tax_payment_allocations",
    "tax_filings",
    "vendors",
    "recurring_expenses",
    "vendor_bills",
    "expense_payments",
    "vendor_bill_applications",
    "documents",
    "document_links",
    "external_record_refs",
    "reconciliation_exceptions",
  ];

  for (const table of expectedTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
    assert.match(migration, new RegExp(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY`));
  }

  for (const deferred of [
    "timecards",
    "time_entries",
    "expense_categories",
    "payment_method_refs",
    "recurring_expense_terms",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${deferred}"`));
  }

  for (const marketplaceTable of [
    "booking_bills",
    "bill_payment_mappings",
    "booking_payment_receipts",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`ALTER TABLE "${marketplaceTable}"`));
  }

  assert.match(migration, /"documents_status_check"[\s\S]*'active'[\s\S]*'voided'/);
  assert.match(migration, /"documents_sensitivity_check"[\s\S]*'work_authorization'/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_documents_file_key_unique"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "idx_documents_sha256"/);
  assert.doesNotMatch(migration, /idx_documents_sha256_unique/);
});

test("external refs normalize NULL source vendor for uniqueness", async () => {
  const migration = await readFile(
    new URL("../migrations/0017_finance_personnel_payroll_tax_foundation.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_external_record_refs_namespace_unique"/);
  assert.match(migration, /COALESCE\("source_vendor_id", 0\)/);
  assert.match(migration, /"source_namespace"/);
  assert.match(migration, /"external_record_type"/);
  assert.match(migration, /"external_record_id"/);
});

test("worker admin link is optional and one admin can link to at most one worker", async () => {
  const migration = await readFile(
    new URL("../migrations/0017_finance_personnel_payroll_tax_foundation.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /"admin_user_id" integer REFERENCES "admin_users"/);
  assert.doesNotMatch(migration, /"admin_user_id" integer NOT NULL REFERENCES "admin_users"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_workers_admin_user_unique"/);
});

test("trainee identity does not imply employment", () => {
  assert.equal(adminIdentityImpliesEmployment("trainee"), false);
  assert.equal(adminIdentityImpliesEmployment("admin_staff"), false);
});

test("STEM OPT and H-1B are not Admin identity values", () => {
  assert.deepEqual([...ADMIN_IDENTITY_TYPES], ["admin_staff", "trainee"]);
  assert.doesNotThrow(() => assertCreateAdminIdentityType("admin_staff"));
  assert.doesNotThrow(() => assertCreateAdminIdentityType("trainee"));
  assertValidationError(() => assertCreateAdminIdentityType("stem_opt"), "INVALID_ADMIN_IDENTITY_TYPE");
  assertValidationError(() => assertCreateAdminIdentityType("h1b"), "INVALID_ADMIN_IDENTITY_TYPE");
});

test("payroll result cannot reference mismatched worker and employment", () => {
  assertValidationError(
    () => validatePayrollRunWorkerConsistency({
      payrollRun,
      employment,
      workerId: 999,
    }),
    "PAYROLL_WORKER_EMPLOYMENT_MISMATCH",
  );
});

test("payroll result cannot cross legal entities", () => {
  assertValidationError(
    () => validatePayrollRunWorkerConsistency({
      payrollRun: { ...payrollRun, legalEntityId: 2 },
      employment,
      workerId: employment.workerId,
    }),
    "PAYROLL_LEGAL_ENTITY_MISMATCH",
  );
});

test("finalized payroll run cannot be edited in place", async () => {
  const { assertPayrollRunMutable } = await import("./financeDomainValidation");

  assert.doesNotThrow(() => assertPayrollRunMutable({ id: 1, status: "reviewed" }));
  assertValidationError(
    () => assertPayrollRunMutable({ id: 1, status: "finalized" }),
    "PAYROLL_RUN_FINALIZED",
  );
});

test("correction run preserves original and references prior finalized run", () => {
  const original: PayrollRunSnapshot = {
    id: 100,
    legalEntityId: 1,
    runKind: "regular",
    status: "finalized",
  };
  const correction: PayrollRunSnapshot = {
    id: 101,
    legalEntityId: 1,
    runKind: "correction",
    status: "draft",
    correctionOfPayrollRunId: 100,
  };

  assert.doesNotThrow(() => validatePayrollCorrectionRun({ correctionRun: correction, originalRun: original }));
  assertValidationError(
    () => validatePayrollCorrectionRun({
      correctionRun: { ...correction, runKind: "regular" },
      originalRun: original,
    }),
    "PAYROLL_CORRECTION_KIND_REQUIRED",
  );
  assertValidationError(
    () => validatePayrollCorrectionRun({
      correctionRun: correction,
      originalRun: { ...original, status: "reviewed" },
    }),
    "PAYROLL_CORRECTION_REQUIRES_FINALIZED_ORIGINAL",
  );
});

test("payroll result derived totals apply increase and decrease effects", () => {
  const totals = derivePayrollResultLineTotals([
    { lineCategory: "earning", amountCents: 100_000, amountEffect: "increase" },
    { lineCategory: "earning", amountCents: 10_000, amountEffect: "decrease" },
    { lineCategory: "employee_tax", amountCents: 15_000, amountEffect: "increase" },
    { lineCategory: "deduction", amountCents: 2_500, amountEffect: "decrease" },
  ]);

  assert.equal(totals.grossPayCents, 90_000);
  assert.equal(totals.employeeTaxCents, 15_000);
  assert.equal(totals.deductionCents, -2_500);
  assert.equal(totals.netPayImpactCents, 77_500);
});

test("tax liability and payment allocation cannot cross registrations", () => {
  assertValidationError(
    () => validateTaxPaymentAllocationFromLockedRows({
      liability: taxLiability,
      payment: { ...taxPayment, taxRegistrationId: 8 },
      amountCents: 100,
      currency: "USD",
      existingLiabilityAllocations: [],
      existingPaymentAllocations: [],
    }),
    "TAX_ALLOCATION_REGISTRATION_MISMATCH",
  );
});

test("tax payment cannot be over-allocated", () => {
  assertValidationError(
    () => validateTaxPaymentAllocationFromLockedRows({
      liability: taxLiability,
      payment: taxPayment,
      amountCents: 200,
      currency: "USD",
      existingLiabilityAllocations: [],
      existingPaymentAllocations: [{ amountCents: 10_500, status: "active" }],
    }),
    "TAX_PAYMENT_OVER_ALLOCATED",
  );
});

test("tax liability net amount applies increase and decrease effects", () => {
  assert.equal(
    deriveTaxLiabilityNetAmountCents([
      { taxRegistrationId: 1, currency: "USD", amountCents: 50_000, amountEffect: "increase" },
      { taxRegistrationId: 1, currency: "USD", amountCents: 5_000, amountEffect: "decrease" },
    ]),
    45_000,
  );
});

test("vendor bill payment state derives from applications", () => {
  assert.equal(deriveVendorBillSettlementState(vendorBill, []), "unpaid");
  assert.equal(
    deriveVendorBillSettlementState(vendorBill, [{ amountCents: 500, status: "active" }]),
    "partially_paid",
  );
  assert.equal(
    deriveVendorBillSettlementState(vendorBill, [{ amountCents: 2_000, status: "active" }]),
    "paid",
  );
  assert.equal(
    deriveVendorBillSettlementState(vendorBill, [{ amountCents: 2_100, status: "active" }]),
    "overpaid",
  );
});

test("AP payment cannot be over-applied", () => {
  assertValidationError(
    () => validateVendorBillPaymentApplicationFromLockedRows({
      targetBill: vendorBill,
      payment: { id: 7, vendorId: vendorBill.vendorId, amountCents: 1_000, currency: "USD" },
      amountCents: 100,
      currency: "USD",
      existingTargetBillApplications: [],
      existingPaymentApplications: [{ amountCents: 950, status: "active" }],
    }),
    "AP_PAYMENT_OVER_APPLIED",
  );
});

test("credit bill application validates vendor and currency", () => {
  const creditBill: VendorBillSnapshot = {
    id: 2,
    vendorId: vendorBill.vendorId,
    amountCents: 1_000,
    currency: "USD",
    billKind: "credit_memo",
    status: "approved",
  };

  assert.doesNotThrow(() => validateVendorBillCreditApplicationFromLockedRows({
    targetBill: vendorBill,
    creditBill,
    amountCents: 500,
    currency: "USD",
    existingTargetBillApplications: [],
    existingCreditBillApplications: [],
  }));
  assertValidationError(
    () => validateVendorBillCreditApplicationFromLockedRows({
      targetBill: vendorBill,
      creditBill: { ...creditBill, vendorId: 999 },
      amountCents: 500,
      currency: "USD",
      existingTargetBillApplications: [],
      existingCreditBillApplications: [],
    }),
    "AP_CREDIT_VENDOR_MISMATCH",
  );
  assertValidationError(
    () => validateVendorBillCreditApplicationFromLockedRows({
      targetBill: vendorBill,
      creditBill: { ...creditBill, currency: "EUR" },
      amountCents: 500,
      currency: "USD",
      existingTargetBillApplications: [],
      existingCreditBillApplications: [],
    }),
    "AP_CREDIT_CURRENCY_MISMATCH",
  );
});

test("tax filing amendment preserves original filing", () => {
  const original: TaxFilingSnapshot = {
    id: 30,
    taxRegistrationId: 3,
    filingType: "941",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    status: "accepted",
  };
  const amendment: TaxFilingSnapshot = {
    ...original,
    id: 31,
    status: "draft",
    amendsTaxFilingId: 30,
  };

  assert.doesNotThrow(() => validateTaxFilingAmendment({ amendment, original }));
  assertValidationError(
    () => validateTaxFilingAmendment({
      amendment: { ...amendment, periodEnd: "2026-07-01" },
      original,
    }),
    "TAX_FILING_AMENDMENT_SCOPE_MISMATCH",
  );
});

test("work authorization supersession preserves historical authorization", () => {
  const stemOpt: WorkAuthorizationSnapshot = {
    id: 1,
    workerId: 77,
  };
  const h1b: WorkAuthorizationSnapshot = {
    id: 2,
    workerId: 77,
    supersedesWorkAuthorizationId: 1,
  };

  assert.doesNotThrow(() => validateWorkAuthorizationSupersession({
    authorization: h1b,
    supersededAuthorization: stemOpt,
  }));
  assertValidationError(
    () => validateWorkAuthorizationSupersession({
      authorization: { ...h1b, workerId: 88 },
      supersededAuthorization: stemOpt,
    }),
    "WORK_AUTH_SUPERSESSION_WORKER_MISMATCH",
  );
});

test("polymorphic shared refs reject unsupported or nonexistent targets", async () => {
  await assert.rejects(
    () => validatePolymorphicEntityTarget(
      { entityType: "booking_bills", entityId: 1 },
      () => true,
    ),
    (error) => error instanceof FinanceDomainValidationError && error.code === "UNSUPPORTED_ENTITY_TYPE",
  );

  await assert.rejects(
    () => validatePolymorphicEntityTarget(
      { entityType: "workers", entityId: 404 },
      () => false,
    ),
    (error) => error instanceof FinanceDomainValidationError && error.code === "MISSING_ENTITY_TARGET",
  );
});

test("restricted document cannot be exposed through a weaker link scope", () => {
  assert.doesNotThrow(() => validateDocumentLinkSensitivity({
    documentSensitivityClass: "work_authorization",
    requiredSensitivityClass: "work_authorization",
  }));
  assertValidationError(
    () => validateDocumentLinkSensitivity({
      documentSensitivityClass: "work_authorization",
      requiredSensitivityClass: "ordinary_finance",
    }),
    "DOCUMENT_LINK_SCOPE_TOO_WEAK",
  );
});
