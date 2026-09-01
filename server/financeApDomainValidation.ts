import type { DocumentSensitivityClass, FinanceEntityType } from "@shared/schema";

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

const AP_FINANCE_ENTITY_TYPES = [
  "legal_entities",
  "vendors",
  "recurring_expenses",
  "vendor_bills",
  "expense_payments",
  "vendor_bill_applications",
  "documents",
  "reconciliation_exceptions",
] as const satisfies readonly FinanceEntityType[];

export function assertFinanceEntityType(value: string): asserts value is FinanceEntityType {
  if (!AP_FINANCE_ENTITY_TYPES.includes(value as (typeof AP_FINANCE_ENTITY_TYPES)[number])) {
    fail("UNSUPPORTED_ENTITY_TYPE", `${value} is not a supported AP finance entity type.`);
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
