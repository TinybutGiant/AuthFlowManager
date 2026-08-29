import type { AmountEffect, DocumentSensitivityClass, FinanceEntityType, PayrollResultLineCategory } from "@shared/schema";

export class FinanceDomainValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinanceDomainValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new FinanceDomainValidationError(code, message);
}

export const ADMIN_IDENTITY_TYPES = ["admin_staff", "trainee"] as const;
export type CreateAdminIdentityType = (typeof ADMIN_IDENTITY_TYPES)[number];

export function assertCreateAdminIdentityType(value: string): asserts value is CreateAdminIdentityType {
  if (!ADMIN_IDENTITY_TYPES.includes(value as CreateAdminIdentityType)) {
    fail("INVALID_ADMIN_IDENTITY_TYPE", `${value} is not an Admin identity type.`);
  }
}

export function adminIdentityImpliesEmployment(_identityType: CreateAdminIdentityType): false {
  return false;
}

export const FINANCE_ENTITY_TYPES = [
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
  "reconciliation_exceptions",
] as const satisfies readonly FinanceEntityType[];

export function assertFinanceEntityType(value: string): asserts value is FinanceEntityType {
  if (!FINANCE_ENTITY_TYPES.includes(value as FinanceEntityType)) {
    fail("UNSUPPORTED_ENTITY_TYPE", `${value} is not a supported finance/personnel entity type.`);
  }
}

export type EntityTargetResolver = (
  entityType: FinanceEntityType,
  entityId: number,
) => boolean | Promise<boolean>;

export async function validatePolymorphicEntityTarget(
  ref: { entityType: string; entityId: number },
  targetExists: EntityTargetResolver,
) {
  assertFinanceEntityType(ref.entityType);
  if (!Number.isInteger(ref.entityId) || ref.entityId <= 0) {
    fail("INVALID_ENTITY_ID", "Entity id must be a positive integer.");
  }
  if (!(await targetExists(ref.entityType, ref.entityId))) {
    fail("MISSING_ENTITY_TARGET", `${ref.entityType}#${ref.entityId} does not exist.`);
  }
}

export interface EmploymentSnapshot {
  id: number;
  workerId: number;
  legalEntityId: number;
}

export interface PayrollRunSnapshot {
  id: number;
  legalEntityId: number;
  runKind: string;
  status: string;
  correctionOfPayrollRunId?: number | null;
}

export function validatePayrollRunWorkerConsistency(input: {
  payrollRun: PayrollRunSnapshot;
  employment: EmploymentSnapshot;
  workerId: number;
}) {
  if (input.workerId !== input.employment.workerId) {
    fail("PAYROLL_WORKER_EMPLOYMENT_MISMATCH", "Payroll worker result must use the employment's worker.");
  }
  if (input.payrollRun.legalEntityId !== input.employment.legalEntityId) {
    fail("PAYROLL_LEGAL_ENTITY_MISMATCH", "Payroll run and employment must belong to the same legal entity.");
  }
}

export function assertPayrollRunMutable(run: Pick<PayrollRunSnapshot, "id" | "status">) {
  if (run.status === "finalized") {
    fail("PAYROLL_RUN_FINALIZED", `Payroll run ${run.id} is finalized and cannot be edited in place.`);
  }
}

export function validatePayrollCorrectionRun(input: {
  correctionRun: PayrollRunSnapshot;
  originalRun: PayrollRunSnapshot;
  ancestorPayrollRunIds?: number[];
}) {
  const { correctionRun, originalRun } = input;
  if (correctionRun.runKind !== "correction") {
    fail("PAYROLL_CORRECTION_KIND_REQUIRED", "A correction run must have run_kind=correction.");
  }
  if (correctionRun.correctionOfPayrollRunId !== originalRun.id) {
    fail("PAYROLL_CORRECTION_TARGET_MISMATCH", "Correction run must reference the original payroll run.");
  }
  if (correctionRun.id === originalRun.id) {
    fail("PAYROLL_CORRECTION_SELF_REFERENCE", "A payroll run cannot correct itself.");
  }
  if (originalRun.status !== "finalized") {
    fail("PAYROLL_CORRECTION_REQUIRES_FINALIZED_ORIGINAL", "A correction can only target a finalized payroll run.");
  }
  if (correctionRun.legalEntityId !== originalRun.legalEntityId) {
    fail("PAYROLL_CORRECTION_LEGAL_ENTITY_MISMATCH", "Correction run must use the original run's legal entity.");
  }
  if (input.ancestorPayrollRunIds?.includes(correctionRun.id)) {
    fail("PAYROLL_CORRECTION_CYCLE", "Payroll correction lineage cannot form a cycle.");
  }
}

export interface WorkAuthorizationSnapshot {
  id: number;
  workerId: number;
  employmentId?: number | null;
  supersedesWorkAuthorizationId?: number | null;
}

export function validateWorkAuthorizationEmploymentConsistency(input: {
  authorization: WorkAuthorizationSnapshot;
  employment: EmploymentSnapshot;
}) {
  if (input.authorization.employmentId !== input.employment.id) {
    fail("WORK_AUTH_EMPLOYMENT_MISMATCH", "Work authorization must reference the supplied employment.");
  }
  if (input.authorization.workerId !== input.employment.workerId) {
    fail("WORK_AUTH_WORKER_MISMATCH", "Work authorization and employment must belong to the same worker.");
  }
}

export function validateWorkAuthorizationSupersession(input: {
  authorization: WorkAuthorizationSnapshot;
  supersededAuthorization: WorkAuthorizationSnapshot;
  ancestorAuthorizationIds?: number[];
}) {
  const { authorization, supersededAuthorization } = input;
  if (authorization.id === supersededAuthorization.id) {
    fail("WORK_AUTH_SUPERSESSION_SELF_REFERENCE", "A work authorization cannot supersede itself.");
  }
  if (authorization.supersedesWorkAuthorizationId !== supersededAuthorization.id) {
    fail("WORK_AUTH_SUPERSESSION_TARGET_MISMATCH", "Supersession must reference the prior authorization.");
  }
  if (authorization.workerId !== supersededAuthorization.workerId) {
    fail("WORK_AUTH_SUPERSESSION_WORKER_MISMATCH", "Superseded authorization must belong to the same worker.");
  }
  if (input.ancestorAuthorizationIds?.includes(authorization.id)) {
    fail("WORK_AUTH_SUPERSESSION_CYCLE", "Work authorization supersession cannot form a cycle.");
  }
}

interface PositiveAllocationSnapshot {
  amountCents: number;
  status: string;
}

function activeTotal(allocations: readonly PositiveAllocationSnapshot[]) {
  return allocations
    .filter((allocation) => allocation.status === "active")
    .reduce((total, allocation) => total + allocation.amountCents, 0);
}

function assertPositiveMinorUnits(amountCents: number, code: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    fail(code, "Amount must be a positive integer minor-unit value.");
  }
}

export interface DirectionalAmountLine {
  amountCents: number;
  amountEffect?: AmountEffect | null;
}

export function directionalAmountCents(line: DirectionalAmountLine) {
  assertPositiveMinorUnits(line.amountCents, "DIRECTIONAL_AMOUNT_INVALID");
  return line.amountEffect === "decrease" ? -line.amountCents : line.amountCents;
}

export function sumDirectionalAmountCents(lines: readonly DirectionalAmountLine[]) {
  return lines.reduce((total, line) => total + directionalAmountCents(line), 0);
}

export interface PayrollResultLineAmount extends DirectionalAmountLine {
  lineCategory: PayrollResultLineCategory;
}

export function derivePayrollResultLineTotals(lines: readonly PayrollResultLineAmount[]) {
  const totals = {
    grossPayCents: 0,
    deductionCents: 0,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    reimbursementCents: 0,
    otherCents: 0,
    netPayImpactCents: 0,
  };

  for (const line of lines) {
    const signedAmount = directionalAmountCents(line);
    switch (line.lineCategory) {
      case "earning":
        totals.grossPayCents += signedAmount;
        totals.netPayImpactCents += signedAmount;
        break;
      case "deduction":
        totals.deductionCents += signedAmount;
        totals.netPayImpactCents -= signedAmount;
        break;
      case "employee_tax":
        totals.employeeTaxCents += signedAmount;
        totals.netPayImpactCents -= signedAmount;
        break;
      case "employer_tax":
        totals.employerTaxCents += signedAmount;
        break;
      case "reimbursement":
        totals.reimbursementCents += signedAmount;
        totals.netPayImpactCents += signedAmount;
        break;
      case "other":
        totals.otherCents += signedAmount;
        break;
    }
  }

  return totals;
}

export interface TaxLiabilitySnapshot {
  id: number;
  taxRegistrationId: number;
  amountCents: number;
  currency: string;
}

export interface TaxLiabilityAmount extends DirectionalAmountLine {
  taxRegistrationId: number;
  currency: string;
}

export function deriveTaxLiabilityNetAmountCents(liabilities: readonly TaxLiabilityAmount[]) {
  return sumDirectionalAmountCents(liabilities);
}

export interface TaxAgencyPaymentSnapshot {
  id: number;
  taxRegistrationId: number;
  amountCents: number;
  currency: string;
}

export function validateTaxPaymentAllocationFromLockedRows(input: {
  liability: TaxLiabilitySnapshot;
  payment: TaxAgencyPaymentSnapshot;
  amountCents: number;
  currency: string;
  existingLiabilityAllocations: readonly PositiveAllocationSnapshot[];
  existingPaymentAllocations: readonly PositiveAllocationSnapshot[];
}) {
  assertPositiveMinorUnits(input.amountCents, "TAX_ALLOCATION_AMOUNT_INVALID");
  if (input.liability.taxRegistrationId !== input.payment.taxRegistrationId) {
    fail("TAX_ALLOCATION_REGISTRATION_MISMATCH", "Tax liability and payment must share a tax registration.");
  }
  if (input.currency !== input.liability.currency || input.currency !== input.payment.currency) {
    fail("TAX_ALLOCATION_CURRENCY_MISMATCH", "Tax allocation currency must match liability and payment.");
  }
  if (activeTotal(input.existingLiabilityAllocations) + input.amountCents > input.liability.amountCents) {
    fail("TAX_LIABILITY_OVER_ALLOCATED", "Active allocations cannot exceed the tax liability amount.");
  }
  if (activeTotal(input.existingPaymentAllocations) + input.amountCents > input.payment.amountCents) {
    fail("TAX_PAYMENT_OVER_ALLOCATED", "Active allocations cannot exceed the tax payment amount.");
  }
}

export interface TaxFilingSnapshot {
  id: number;
  taxRegistrationId: number;
  filingType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  amendsTaxFilingId?: number | null;
}

export function validateTaxFilingAmendment(input: {
  amendment: TaxFilingSnapshot;
  original: TaxFilingSnapshot;
  ancestorFilingIds?: number[];
}) {
  const { amendment, original } = input;
  if (amendment.id === original.id) {
    fail("TAX_FILING_AMENDMENT_SELF_REFERENCE", "A tax filing cannot amend itself.");
  }
  if (amendment.amendsTaxFilingId !== original.id) {
    fail("TAX_FILING_AMENDMENT_TARGET_MISMATCH", "Amendment must reference the prior filing.");
  }
  if (original.status !== "filed" && original.status !== "accepted") {
    fail("TAX_FILING_AMENDMENT_REQUIRES_FILED_ORIGINAL", "A tax filing amendment requires a filed or accepted original.");
  }
  if (
    amendment.taxRegistrationId !== original.taxRegistrationId
    || amendment.filingType !== original.filingType
    || amendment.periodStart !== original.periodStart
    || amendment.periodEnd !== original.periodEnd
  ) {
    fail("TAX_FILING_AMENDMENT_SCOPE_MISMATCH", "Tax amendment must use the same registration, type, and period.");
  }
  if (input.ancestorFilingIds?.includes(amendment.id)) {
    fail("TAX_FILING_AMENDMENT_CYCLE", "Tax filing amendment lineage cannot form a cycle.");
  }
}

export interface VendorBillSnapshot {
  id: number;
  legalEntityId: number;
  vendorId: number;
  amountCents: number;
  currency: string;
  billKind: string;
  status: string;
}

export interface ExpensePaymentSnapshot {
  id: number;
  legalEntityId: number;
  vendorId?: number | null;
  amountCents: number;
  currency: string;
  direction: string;
  status: string;
}

export type VendorBillSettlementState = "voided" | "unpaid" | "partially_paid" | "paid" | "overpaid";

export interface VendorBillBalance {
  originalAmountCents: number;
  activeAppliedAmountCents: number;
  remainingAmountCents: number;
  settlementState: VendorBillSettlementState;
}

export interface ExpensePaymentBalance {
  paymentAmountCents: number;
  activeAppliedAmountCents: number;
  unappliedAmountCents: number;
}

export interface CreditBillBalance {
  creditAmountCents: number;
  activeAppliedAmountCents: number;
  remainingCreditAmountCents: number;
}

export function deriveVendorBillSettlementState(
  bill: Pick<VendorBillSnapshot, "amountCents" | "status">,
  applications: readonly PositiveAllocationSnapshot[],
): VendorBillSettlementState {
  if (bill.status === "voided") return "voided";
  const applied = activeTotal(applications);
  if (applied === 0) return "unpaid";
  if (applied < bill.amountCents) return "partially_paid";
  if (applied === bill.amountCents) return "paid";
  return "overpaid";
}

export function deriveVendorBillBalance(
  bill: Pick<VendorBillSnapshot, "amountCents" | "status">,
  applications: readonly PositiveAllocationSnapshot[],
): VendorBillBalance {
  const activeAppliedAmountCents = activeTotal(applications);
  return {
    originalAmountCents: bill.amountCents,
    activeAppliedAmountCents,
    remainingAmountCents: Math.max(0, bill.amountCents - activeAppliedAmountCents),
    settlementState: deriveVendorBillSettlementState(bill, applications),
  };
}

export function deriveExpensePaymentBalance(
  payment: Pick<ExpensePaymentSnapshot, "amountCents">,
  applications: readonly PositiveAllocationSnapshot[],
): ExpensePaymentBalance {
  const activeAppliedAmountCents = activeTotal(applications);
  return {
    paymentAmountCents: payment.amountCents,
    activeAppliedAmountCents,
    unappliedAmountCents: Math.max(0, payment.amountCents - activeAppliedAmountCents),
  };
}

export function deriveCreditBillBalance(
  creditBill: Pick<VendorBillSnapshot, "amountCents">,
  applications: readonly PositiveAllocationSnapshot[],
): CreditBillBalance {
  const activeAppliedAmountCents = activeTotal(applications);
  return {
    creditAmountCents: creditBill.amountCents,
    activeAppliedAmountCents,
    remainingCreditAmountCents: Math.max(0, creditBill.amountCents - activeAppliedAmountCents),
  };
}

function assertTargetBillPayable(bill: Pick<VendorBillSnapshot, "billKind" | "status">) {
  if (bill.billKind === "credit_memo") {
    fail("AP_TARGET_BILL_CREDIT_MEMO", "Cannot apply payment or credit to a credit memo.");
  }
  if (bill.status === "draft") {
    fail("AP_TARGET_BILL_DRAFT", "Cannot apply payment or credit to a draft vendor bill.");
  }
  if (bill.status === "voided") {
    fail("AP_TARGET_BILL_VOIDED", "Cannot apply payment or credit to a voided vendor bill.");
  }
}

export function validateVendorBillPaymentApplicationFromLockedRows(input: {
  targetBill: VendorBillSnapshot;
  payment: ExpensePaymentSnapshot;
  amountCents: number;
  currency: string;
  existingTargetBillApplications: readonly PositiveAllocationSnapshot[];
  existingPaymentApplications: readonly PositiveAllocationSnapshot[];
}) {
  assertPositiveMinorUnits(input.amountCents, "AP_APPLICATION_AMOUNT_INVALID");
  assertTargetBillPayable(input.targetBill);
  if (input.targetBill.legalEntityId !== input.payment.legalEntityId) {
    fail("AP_PAYMENT_LEGAL_ENTITY_MISMATCH", "Expense payment and target bill must share a legal entity.");
  }
  if (input.payment.direction !== "outflow") {
    fail("AP_PAYMENT_DIRECTION_INVALID", "Only outflow expense payments can be applied to bills.");
  }
  if (!["posted", "cleared"].includes(input.payment.status)) {
    fail("AP_PAYMENT_STATUS_INVALID", "Only posted or cleared payments can be applied to bills.");
  }
  if (input.payment.vendorId != null && input.payment.vendorId !== input.targetBill.vendorId) {
    fail("AP_PAYMENT_VENDOR_MISMATCH", "Expense payment vendor must match the target bill vendor when recorded.");
  }
  if (input.currency !== input.targetBill.currency || input.currency !== input.payment.currency) {
    fail("AP_PAYMENT_APPLICATION_CURRENCY_MISMATCH", "AP payment application currency must match bill and payment.");
  }
  if (activeTotal(input.existingTargetBillApplications) + input.amountCents > input.targetBill.amountCents) {
    fail("AP_BILL_OVER_APPLIED", "Active applications cannot exceed the target bill amount.");
  }
  if (activeTotal(input.existingPaymentApplications) + input.amountCents > input.payment.amountCents) {
    fail("AP_PAYMENT_OVER_APPLIED", "Active applications cannot exceed the expense payment amount.");
  }
}

export function validateVendorBillCreditApplicationFromLockedRows(input: {
  targetBill: VendorBillSnapshot;
  creditBill: VendorBillSnapshot;
  amountCents: number;
  currency: string;
  existingTargetBillApplications: readonly PositiveAllocationSnapshot[];
  existingCreditBillApplications: readonly PositiveAllocationSnapshot[];
}) {
  assertPositiveMinorUnits(input.amountCents, "AP_CREDIT_APPLICATION_AMOUNT_INVALID");
  assertTargetBillPayable(input.targetBill);
  if (input.creditBill.billKind !== "credit_memo") {
    fail("AP_CREDIT_SOURCE_KIND_INVALID", "Credit application source must be a credit memo bill.");
  }
  if (input.creditBill.status === "draft") {
    fail("AP_CREDIT_SOURCE_DRAFT", "Cannot apply a draft credit memo.");
  }
  if (input.creditBill.status === "voided") {
    fail("AP_CREDIT_SOURCE_VOIDED", "Cannot apply a voided credit memo.");
  }
  if (input.targetBill.id === input.creditBill.id) {
    fail("AP_CREDIT_SELF_APPLICATION", "Credit bill cannot apply to itself.");
  }
  if (input.targetBill.legalEntityId !== input.creditBill.legalEntityId) {
    fail("AP_CREDIT_LEGAL_ENTITY_MISMATCH", "Credit bill and target bill must share a legal entity.");
  }
  if (input.targetBill.vendorId !== input.creditBill.vendorId) {
    fail("AP_CREDIT_VENDOR_MISMATCH", "Credit bill and target bill must belong to the same vendor.");
  }
  if (input.currency !== input.targetBill.currency || input.currency !== input.creditBill.currency) {
    fail("AP_CREDIT_CURRENCY_MISMATCH", "Credit application currency must match both bills.");
  }
  if (activeTotal(input.existingTargetBillApplications) + input.amountCents > input.targetBill.amountCents) {
    fail("AP_BILL_OVER_APPLIED", "Active applications cannot exceed the target bill amount.");
  }
  if (activeTotal(input.existingCreditBillApplications) + input.amountCents > input.creditBill.amountCents) {
    fail("AP_CREDIT_OVER_APPLIED", "Active credit applications cannot exceed the credit amount.");
  }
}

const sensitivityRank: Record<DocumentSensitivityClass, number> = {
  ordinary_finance: 1,
  employment: 2,
  payroll: 3,
  tax: 3,
  work_authorization: 4,
};

export function validateDocumentLinkSensitivity(input: {
  documentSensitivityClass: DocumentSensitivityClass;
  requiredSensitivityClass: DocumentSensitivityClass;
}) {
  if (sensitivityRank[input.requiredSensitivityClass] < sensitivityRank[input.documentSensitivityClass]) {
    fail("DOCUMENT_LINK_SCOPE_TOO_WEAK", "Document link scope cannot be weaker than the document sensitivity class.");
  }
}
