import { z } from "zod";
import type {
  AllocationStatus,
  Document,
  DocumentLink,
  DocumentSensitivityClass,
  ExpensePayment,
  FinanceAuditEvent,
  FinanceEntityType,
  InsertDocument,
  InsertDocumentLink,
  InsertExpensePayment,
  InsertFinanceAuditEvent,
  InsertReconciliationException,
  InsertRecurringExpense,
  InsertVendor,
  InsertVendorBill,
  InsertVendorBillApplication,
  LegalEntity,
  ReconciliationException,
  ReconciliationExceptionStatus,
  RecurringExpense,
  RecurringExpenseStatus,
  Vendor,
  VendorBill,
  VendorBillApplication,
  VendorBillKind,
  VendorBillStatus,
  VendorStatus,
} from "@shared/schema";
import {
  FinanceDomainValidationError,
  deriveVendorBillSettlementState,
  validateDocumentLinkSensitivity,
  validatePolymorphicEntityTarget,
  validateVendorBillCreditApplicationFromLockedRows,
  validateVendorBillPaymentApplicationFromLockedRows,
  type ExpensePaymentSnapshot,
  type VendorBillSnapshot,
  type VendorBillSettlementState,
} from "./financeDomainValidation";

export class FinanceExpenseServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinanceExpenseServiceError";
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new FinanceExpenseServiceError(statusCode, code, message);
}

function runFinanceDomainValidation(work: () => void) {
  try {
    work();
  } catch (error) {
    if (error instanceof FinanceDomainValidationError) {
      fail(400, error.code, error.message);
    }
    throw error;
  }
}

const VENDOR_TYPES = [
  "saas",
  "cloud",
  "payroll_provider",
  "utility",
  "professional_service",
  "contractor_vendor",
  "supplier",
  "other",
] as const;

const VENDOR_STATUSES = ["active", "inactive", "archived"] as const;
const RECURRING_EXPENSE_STATUSES = ["draft", "trial", "active", "paused", "cancelled", "expired"] as const;
const RECURRING_EXPENSE_CADENCES = ["weekly", "monthly", "quarterly", "annual", "custom"] as const;
const VENDOR_BILL_KINDS = ["invoice", "bill", "credit_memo", "statement", "other"] as const;
const VENDOR_BILL_STATUSES = ["draft", "received", "approved", "disputed", "voided"] as const;
const EXPENSE_PAYMENT_DIRECTIONS = ["outflow", "refund"] as const;
const EXPENSE_PAYMENT_METHODS = ["provider", "ach", "check", "card", "wire", "manual", "other"] as const;
const EXPENSE_PAYMENT_STATUSES = ["pending", "posted", "cleared", "failed", "reversed", "voided"] as const;
const EXPENSE_PAYMENT_MUTABLE_STATUSES = ["pending"] as const;
const EXPENSE_PAYMENT_TRANSITION_STATUSES = ["posted", "cleared", "failed", "voided"] as const;
const FINANCE_AUDIT_ENTITY_TYPES = [
  "vendor",
  "recurring_expense",
  "vendor_bill",
  "expense_payment",
  "vendor_bill_application",
  "reconciliation_exception",
] as const;
const FINANCE_AUDIT_ACTIONS = [
  "created",
  "updated",
  "archived",
  "paused",
  "resumed",
  "cancelled",
  "received",
  "approved",
  "disputed",
  "voided",
  "posted",
  "cleared",
  "failed",
  "reversed",
  "applied",
  "investigating",
  "resolved",
  "waived",
  "reopened",
] as const;
const VENDOR_AUDIT_FIELDS = ["name", "vendorType", "status"] as const;
const RECURRING_EXPENSE_AUDIT_FIELDS = [
  "categoryCode",
  "cadence",
  "expectedAmountCents",
  "currency",
  "variableAmount",
  "billingDay",
  "nextBillingDate",
  "renewalDate",
  "autoRenew",
  "trialEndsOn",
  "cancellationDate",
  "status",
] as const;
const VENDOR_BILL_AUDIT_FIELDS = [
  "recurringExpenseId",
  "invoiceNumber",
  "billKind",
  "issueDate",
  "dueDate",
  "servicePeriodStart",
  "servicePeriodEnd",
  "amountCents",
  "currency",
  "categoryCode",
  "status",
  "creditForVendorBillId",
] as const;
const EXPENSE_PAYMENT_AUDIT_FIELDS = [
  "vendorId",
  "amountCents",
  "currency",
  "direction",
  "paymentDate",
  "methodType",
  "status",
] as const;
const VENDOR_BILL_APPLICATION_AUDIT_FIELDS = [
  "targetVendorBillId",
  "expensePaymentId",
  "creditVendorBillId",
  "amountCents",
  "currency",
  "status",
] as const;
const RECONCILIATION_EXCEPTION_AUDIT_FIELDS = [
  "expectedEntityType",
  "expectedEntityId",
  "actualEntityType",
  "actualEntityId",
  "currency",
  "expectedAmountCents",
  "actualAmountCents",
  "differenceAmountCents",
  "reasonCode",
  "status",
  "ownerAdminId",
] as const;
const AP_RECONCILIATION_ENTITY_TYPES = [
  "vendors",
  "recurring_expenses",
  "vendor_bills",
  "expense_payments",
  "vendor_bill_applications",
] as const satisfies readonly FinanceEntityType[];
const AP_RECONCILIATION_REASON_CODES = [
  "unmatched_payment",
  "amount_mismatch",
  "duplicate_charge",
  "missing_invoice",
  "missing_receipt",
  "stale_unpaid_bill",
  "other_ap_mismatch",
] as const;
const AP_DOCUMENT_ENTITY_TYPES = [
  "vendors",
  "recurring_expenses",
  "vendor_bills",
  "expense_payments",
  "vendor_bill_applications",
] as const satisfies readonly FinanceEntityType[];
const AP_DOCUMENT_SENSITIVITY_CLASSES = ["ordinary_finance"] as const satisfies readonly DocumentSensitivityClass[];

const positiveIdSchema = z.coerce.number().int().positive();
const amountCentsSchema = z.coerce.number().int().positive();
const optionalAmountCentsSchema = z.preprocess(
  (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
  z.coerce.number().int().positive().nullable().optional(),
);
const currencySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{3}$/)
  .transform((value) => value.toUpperCase());
const dateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateOnlySchema = z.preprocess(
  (value) => value === undefined ? undefined : value === "" ? null : value,
  dateOnlySchema.nullable().optional(),
);

function requiredText(max: number) {
  return z.string().trim().min(1).max(max);
}

function optionalText(max: number) {
  return z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      }
      return value;
    },
    z.string().max(max).nullable().optional(),
  );
}

function nonEmptyPatch(value: Record<string, unknown>) {
  return Object.values(value).some((item) => item !== undefined);
}

function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateOnly(value);
}

function endOfUtcMonth(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
  return dateOnly(end);
}

export const financeListQuerySchema = z.object({
  search: optionalText(200),
  status: optionalText(40),
  vendorId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  legalEntityId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  dueFrom: optionalDateOnlySchema,
  dueTo: optionalDateOnlySchema,
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

const vendorWriteFields = {
  name: requiredText(200),
  vendorType: z.enum(VENDOR_TYPES).default("other"),
  status: z.enum(VENDOR_STATUSES).default("active"),
  website: optionalText(500),
  contactEmail: z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      }
      return value;
    },
    z.string().email().max(320).nullable().optional(),
  ),
  notes: optionalText(4000),
};

export const createVendorPayloadSchema = z.object(vendorWriteFields).strict();
export const updateVendorPayloadSchema = z.object({
  name: vendorWriteFields.name.optional(),
  vendorType: z.enum(VENDOR_TYPES).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  website: vendorWriteFields.website,
  contactEmail: vendorWriteFields.contactEmail,
  notes: vendorWriteFields.notes,
}).strict().refine(nonEmptyPatch, "At least one vendor field is required.");

const recurringExpenseWriteFields = {
  legalEntityId: positiveIdSchema,
  vendorId: positiveIdSchema,
  categoryCode: requiredText(80),
  cadence: z.enum(RECURRING_EXPENSE_CADENCES),
  expectedAmountCents: optionalAmountCentsSchema,
  currency: currencySchema.default("USD"),
  variableAmount: z.boolean().default(false),
  billingDay: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().min(1).max(31).nullable().optional(),
  ),
  nextBillingDate: optionalDateOnlySchema,
  renewalDate: optionalDateOnlySchema,
  autoRenew: z.boolean().default(false),
  trialEndsOn: optionalDateOnlySchema,
  cancellationDate: optionalDateOnlySchema,
  status: z.enum(RECURRING_EXPENSE_STATUSES).default("draft"),
  notes: optionalText(4000),
};

function refineRecurringExpensePayload(
  data: {
    variableAmount?: boolean;
    expectedAmountCents?: number | null;
    status?: RecurringExpenseStatus;
    cancellationDate?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (!data.variableAmount && data.expectedAmountCents == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedAmountCents"],
      message: "Expected amount is required unless the subscription is variable.",
    });
  }
  if (data.status === "cancelled" && !data.cancellationDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cancellationDate"],
      message: "Cancellation date is required for cancelled subscriptions.",
    });
  }
}

export const createRecurringExpensePayloadSchema = z
  .object(recurringExpenseWriteFields)
  .strict()
  .superRefine(refineRecurringExpensePayload);

export const updateRecurringExpensePayloadSchema = z
  .object({
    categoryCode: recurringExpenseWriteFields.categoryCode.optional(),
    cadence: recurringExpenseWriteFields.cadence.optional(),
    expectedAmountCents: optionalAmountCentsSchema,
    currency: currencySchema.optional(),
    variableAmount: z.boolean().optional(),
    billingDay: recurringExpenseWriteFields.billingDay,
    nextBillingDate: optionalDateOnlySchema,
    renewalDate: optionalDateOnlySchema,
    autoRenew: z.boolean().optional(),
    trialEndsOn: optionalDateOnlySchema,
    notes: recurringExpenseWriteFields.notes,
  })
  .strict()
  .refine(nonEmptyPatch, "At least one subscription field is required.");

export const cancelRecurringExpensePayloadSchema = z.object({
  cancellationDate: optionalDateOnlySchema,
  notes: optionalText(4000),
}).strict();

const vendorBillWriteFields = {
  legalEntityId: positiveIdSchema,
  vendorId: positiveIdSchema,
  recurringExpenseId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  invoiceNumber: optionalText(120),
  billKind: z.enum(VENDOR_BILL_KINDS).default("invoice"),
  issueDate: optionalDateOnlySchema,
  dueDate: optionalDateOnlySchema,
  servicePeriodStart: optionalDateOnlySchema,
  servicePeriodEnd: optionalDateOnlySchema,
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
  categoryCode: requiredText(80),
  status: z.literal("draft").default("draft"),
  creditForVendorBillId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  notes: optionalText(4000),
};

function refineVendorBillPayload(
  data: {
    billKind?: VendorBillKind;
    issueDate?: string | null;
    dueDate?: string | null;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    creditForVendorBillId?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  if (data.issueDate && data.dueDate && data.dueDate < data.issueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dueDate"],
      message: "Due date cannot be before issue date.",
    });
  }
  if (data.servicePeriodStart && data.servicePeriodEnd && data.servicePeriodStart > data.servicePeriodEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["servicePeriodEnd"],
      message: "Service period end cannot be before service period start.",
    });
  }
  if (data.creditForVendorBillId && data.billKind !== "credit_memo") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billKind"],
      message: "Only credit memos can reference another bill as credit source.",
    });
  }
}

export const createVendorBillPayloadSchema = z
  .object(vendorBillWriteFields)
  .strict()
  .superRefine(refineVendorBillPayload);

export const updateDraftVendorBillPayloadSchema = z
  .object({
    recurringExpenseId: vendorBillWriteFields.recurringExpenseId,
    invoiceNumber: vendorBillWriteFields.invoiceNumber,
    billKind: z.enum(VENDOR_BILL_KINDS).optional(),
    issueDate: optionalDateOnlySchema,
    dueDate: optionalDateOnlySchema,
    servicePeriodStart: optionalDateOnlySchema,
    servicePeriodEnd: optionalDateOnlySchema,
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    categoryCode: vendorBillWriteFields.categoryCode.optional(),
    creditForVendorBillId: vendorBillWriteFields.creditForVendorBillId,
    notes: vendorBillWriteFields.notes,
  })
  .strict()
  .refine(nonEmptyPatch, "At least one bill field is required.")
  .superRefine(refineVendorBillPayload);

export const financeBillTransitionPayloadSchema = z.object({
  notes: optionalText(4000),
}).strict();

export const createExpensePaymentPayloadSchema = z.object({
  legalEntityId: positiveIdSchema,
  vendorId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
  direction: z.enum(EXPENSE_PAYMENT_DIRECTIONS).default("outflow"),
  paymentDate: optionalDateOnlySchema,
  methodType: z.enum(EXPENSE_PAYMENT_METHODS),
  methodLabel: optionalText(120),
  institutionName: optionalText(160),
  maskedLast4: z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      }
      return value;
    },
    z.string().regex(/^[0-9]{4}$/).nullable().optional(),
  ),
  externalConfirmationRef: optionalText(200),
  status: z.enum(EXPENSE_PAYMENT_STATUSES).default("pending"),
}).strict();

export const updateExpensePaymentPayloadSchema = z.object({
  vendorId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  amountCents: amountCentsSchema.optional(),
  currency: currencySchema.optional(),
  direction: z.enum(EXPENSE_PAYMENT_DIRECTIONS).optional(),
  paymentDate: optionalDateOnlySchema,
  methodType: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  methodLabel: optionalText(120),
  institutionName: optionalText(160),
  maskedLast4: z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      }
      return value;
    },
    z.string().regex(/^[0-9]{4}$/).nullable().optional(),
  ),
  externalConfirmationRef: optionalText(200),
}).strict().refine(nonEmptyPatch, "At least one payment field is required.");

export const updateExpensePaymentStatusPayloadSchema = z.object({
  status: z.enum(EXPENSE_PAYMENT_TRANSITION_STATUSES),
}).strict();

export const applyExpensePaymentPayloadSchema = z.object({
  targetVendorBillId: positiveIdSchema,
  expensePaymentId: positiveIdSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
}).strict();

export const applyCreditMemoPayloadSchema = z.object({
  targetVendorBillId: positiveIdSchema,
  creditVendorBillId: positiveIdSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
}).strict();

function refineEntityPair(
  data: {
    expectedEntityType?: FinanceEntityType | null;
    expectedEntityId?: number | null;
    actualEntityType?: FinanceEntityType | null;
    actualEntityId?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  for (const side of ["expected", "actual"] as const) {
    const entityType = data[`${side}EntityType`];
    const entityId = data[`${side}EntityId`];
    if (Boolean(entityType) !== Boolean(entityId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${side}EntityId`],
        message: `${side} entity type and id must be supplied together.`,
      });
    }
  }
  if (!data.expectedEntityId && !data.actualEntityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedEntityId"],
      message: "At least one reconciliation entity is required.",
    });
  }
}

export const createReconciliationExceptionPayloadSchema = z
  .object({
    expectedEntityType: z.enum(AP_RECONCILIATION_ENTITY_TYPES).nullable().optional(),
    expectedEntityId: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().positive().nullable().optional(),
    ),
    actualEntityType: z.enum(AP_RECONCILIATION_ENTITY_TYPES).nullable().optional(),
    actualEntityId: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().positive().nullable().optional(),
    ),
    currency: currencySchema.nullable().optional(),
    expectedAmountCents: z.coerce.number().int().min(0).nullable().optional(),
    actualAmountCents: z.coerce.number().int().min(0).nullable().optional(),
    reasonCode: z.enum(AP_RECONCILIATION_REASON_CODES),
    summary: requiredText(500),
    ownerAdminId: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().positive().nullable().optional(),
    ),
  })
  .strict()
  .superRefine(refineEntityPair);

export const reconciliationExceptionTransitionPayloadSchema = z.object({
  resolutionNotes: optionalText(1000),
}).strict();

export const createFinanceDocumentPayloadSchema = z.object({
  storageProvider: z.enum(["r2", "external"]).default("external"),
  fileKey: requiredText(1000),
  fileSha256: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().regex(/^[a-f0-9]{64}$/)),
  fileContentType: requiredText(120),
  fileSizeBytes: amountCentsSchema,
  originalFilename: optionalText(255),
  documentType: requiredText(80),
  sensitivityClass: z.enum(AP_DOCUMENT_SENSITIVITY_CLASSES).default("ordinary_finance"),
  link: z.object({
    entityType: z.enum(AP_DOCUMENT_ENTITY_TYPES),
    entityId: positiveIdSchema,
    linkType: requiredText(80),
    requiredSensitivityClass: z.enum(AP_DOCUMENT_SENSITIVITY_CLASSES).default("ordinary_finance"),
  }).strict(),
}).strict();

export type FinanceListQuery = z.infer<typeof financeListQuerySchema>;
export type CreateVendorPayload = z.infer<typeof createVendorPayloadSchema>;
export type UpdateVendorPayload = z.infer<typeof updateVendorPayloadSchema>;
export type CreateRecurringExpensePayload = z.infer<typeof createRecurringExpensePayloadSchema>;
export type UpdateRecurringExpensePayload = z.infer<typeof updateRecurringExpensePayloadSchema>;
export type CancelRecurringExpensePayload = z.infer<typeof cancelRecurringExpensePayloadSchema>;
export type CreateVendorBillPayload = z.infer<typeof createVendorBillPayloadSchema>;
export type UpdateDraftVendorBillPayload = z.infer<typeof updateDraftVendorBillPayloadSchema>;
export type CreateExpensePaymentPayload = z.infer<typeof createExpensePaymentPayloadSchema>;
export type UpdateExpensePaymentPayload = z.infer<typeof updateExpensePaymentPayloadSchema>;
export type UpdateExpensePaymentStatusPayload = z.infer<typeof updateExpensePaymentStatusPayloadSchema>;
export type ApplyExpensePaymentPayload = z.infer<typeof applyExpensePaymentPayloadSchema>;
export type ApplyCreditMemoPayload = z.infer<typeof applyCreditMemoPayloadSchema>;
export type CreateReconciliationExceptionPayload = z.infer<typeof createReconciliationExceptionPayloadSchema>;
export type ReconciliationExceptionTransitionPayload = z.infer<typeof reconciliationExceptionTransitionPayloadSchema>;
export type CreateFinanceDocumentPayload = z.infer<typeof createFinanceDocumentPayloadSchema>;
export type FinanceAuditEntityType = typeof FINANCE_AUDIT_ENTITY_TYPES[number];
export type FinanceAuditAction = typeof FINANCE_AUDIT_ACTIONS[number];

export interface CurrencyAmount {
  currency: string;
  amountCents: number;
}

export interface FinanceVendorListItem {
  id: number;
  name: string;
  vendorType: string;
  status: string;
  website?: string | null;
  contactEmail?: string | null;
}

export interface FinanceLegalEntityListItem {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
}

export interface VendorBillListItem {
  id: number;
  legalEntityId: number;
  vendorId: number;
  vendorName?: string | null;
  recurringExpenseId?: number | null;
  invoiceNumber?: string | null;
  billKind: string;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
  servicePeriodStart?: string | Date | null;
  servicePeriodEnd?: string | Date | null;
  amountCents: number;
  currency: string;
  categoryCode: string;
  status: string;
  creditForVendorBillId?: number | null;
  activeAppliedAmountCents: number;
  remainingAmountCents: number;
  settlementState: VendorBillSettlementState;
  documentCount: number;
  recurringExpectedAmountCents?: number | null;
}

export interface VendorBillMutationResult {
  id: number;
  legalEntityId: number;
  vendorId: number;
  recurringExpenseId?: number | null;
  invoiceNumber?: string | null;
  billKind: string;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
  servicePeriodStart?: string | Date | null;
  servicePeriodEnd?: string | Date | null;
  amountCents: number;
  currency: string;
  categoryCode: string;
  status: string;
  creditForVendorBillId?: number | null;
}

export interface RecurringExpenseListItem {
  id: number;
  legalEntityId: number;
  vendorId: number;
  vendorName?: string | null;
  categoryCode: string;
  cadence: string;
  expectedAmountCents?: number | null;
  currency: string;
  variableAmount: boolean;
  billingDay?: number | null;
  nextBillingDate?: string | Date | null;
  renewalDate?: string | Date | null;
  autoRenew: boolean;
  trialEndsOn?: string | Date | null;
  cancellationDate?: string | Date | null;
  status: string;
}

export interface ExpensePaymentListItem {
  id: number;
  legalEntityId?: number;
  vendorId?: number | null;
  vendorName?: string | null;
  amountCents: number;
  currency: string;
  direction: string;
  paymentDate?: string | Date | null;
  methodType: string;
  methodLabel?: string | null;
  institutionName?: string | null;
  maskedLast4?: string | null;
  externalConfirmationRef?: string | null;
  status: string;
  activeAppliedAmountCents: number;
  remainingAmountCents: number;
}

export interface VendorBillApplicationListItem {
  id: number;
  targetVendorBillId: number;
  expensePaymentId?: number | null;
  creditVendorBillId?: number | null;
  amountCents: number;
  currency: string;
  status: string;
  reversedAt?: string | Date | null;
  reversedBy?: number | null;
  createdBy?: number | null;
  createdAt?: string | Date | null;
}

export interface ReconciliationExceptionListItem {
  id: number;
  domain: string;
  expectedEntityType?: string | null;
  expectedEntityId?: number | null;
  actualEntityType?: string | null;
  actualEntityId?: number | null;
  currency?: string | null;
  expectedAmountCents?: number | null;
  actualAmountCents?: number | null;
  differenceAmountCents?: number | null;
  reasonCode: string;
  summary: string;
  status: string;
  ownerAdminId?: number | null;
  resolvedAt?: string | Date | null;
  resolvedBy?: number | null;
}

export interface FinanceOverviewBillRow {
  id: number;
  vendorId: number;
  vendorName?: string | null;
  billKind: string;
  status: string;
  dueDate?: string | Date | null;
  amountCents: number;
  currency: string;
  categoryCode: string;
  recurringExpenseId?: number | null;
  recurringExpectedAmountCents?: number | null;
  activeAppliedAmountCents?: number;
  documentCount?: number;
}

export interface FinanceOverviewSubscriptionRow {
  id: number;
  vendorId: number;
  vendorName?: string | null;
  status: string;
  cadence: string;
  expectedAmountCents?: number | null;
  variableAmount?: boolean | null;
  currency: string;
  categoryCode: string;
  nextBillingDate?: string | Date | null;
  renewalDate?: string | Date | null;
  autoRenew?: boolean | null;
}

export interface FinanceOverviewExceptionRow {
  id: number;
  status: string;
  domain: string;
}

export interface FinanceOverviewInput {
  bills: readonly FinanceOverviewBillRow[];
  subscriptions: readonly FinanceOverviewSubscriptionRow[];
  reconciliationExceptions: readonly FinanceOverviewExceptionRow[];
  today?: string;
}

export interface FinanceOverview {
  asOfDate: string;
  metrics: {
    unpaidBalanceByCurrency: CurrencyAmount[];
    billsDueThisWeekCount: number;
    billsDueThisWeekByCurrency: CurrencyAmount[];
    billsDueThisMonthCount: number;
    billsDueThisMonthByCurrency: CurrencyAmount[];
    monthlyRecurringSpendByCurrency: CurrencyAmount[];
    variableOrUnknownRecurringCount: number;
    activeSubscriptionsCount: number;
    openReconciliationIssuesCount: number;
    missingDocumentsCount: number;
    subscriptionPriceVarianceCount: number;
  };
  billsDueSoon: FinanceOverviewBillRow[];
  activeSubscriptions: FinanceOverviewSubscriptionRow[];
  missingDocumentationBills: FinanceOverviewBillRow[];
  subscriptionPriceVariances: Array<{
    billId: number;
    recurringExpenseId: number;
    vendorId: number;
    vendorName?: string | null;
    expectedAmountCents: number;
    actualAmountCents: number;
    differenceAmountCents: number;
    currency: string;
  }>;
}

export interface FinanceExpenseRepository {
  transaction<T>(work: (repo: FinanceExpenseRepository) => Promise<T>): Promise<T>;
  lockVendor(id: number): Promise<void>;
  lockRecurringExpense(id: number): Promise<void>;
  lockVendorBill(id: number): Promise<void>;
  lockExpensePayment(id: number): Promise<void>;
  lockVendorBillApplication(id: number): Promise<void>;
  lockReconciliationException(id: number): Promise<void>;
  getLegalEntity(id: number): Promise<LegalEntity | undefined>;
  listLegalEntities(): Promise<FinanceLegalEntityListItem[]>;
  getVendor(id: number): Promise<Vendor | undefined>;
  listVendors(filters: FinanceListQuery): Promise<FinanceVendorListItem[]>;
  createVendor(values: InsertVendor): Promise<Vendor>;
  updateVendor(id: number, values: Partial<InsertVendor>): Promise<Vendor | undefined>;
  getRecurringExpense(id: number): Promise<RecurringExpense | undefined>;
  listRecurringExpenses(filters: FinanceListQuery): Promise<RecurringExpenseListItem[]>;
  createRecurringExpense(values: InsertRecurringExpense): Promise<RecurringExpense>;
  updateRecurringExpense(id: number, values: Partial<InsertRecurringExpense>): Promise<RecurringExpense | undefined>;
  getVendorBill(id: number): Promise<VendorBill | undefined>;
  listVendorBills(filters: FinanceListQuery): Promise<VendorBillListItem[]>;
  createVendorBill(values: InsertVendorBill): Promise<VendorBill>;
  updateVendorBill(id: number, values: Partial<InsertVendorBill>): Promise<VendorBill | undefined>;
  findVendorBillInvoiceConflict(filters: {
    legalEntityId: number;
    vendorId: number;
    invoiceNumber: string;
    currency: string;
    excludeVendorBillId?: number;
  }): Promise<Pick<VendorBill, "id"> | undefined>;
  getExpensePayment(id: number): Promise<ExpensePayment | undefined>;
  listExpensePayments(filters: FinanceListQuery): Promise<ExpensePaymentListItem[]>;
  createExpensePayment(values: InsertExpensePayment): Promise<ExpensePayment>;
  updateExpensePayment(id: number, values: Partial<InsertExpensePayment>): Promise<ExpensePayment | undefined>;
  getVendorBillApplication(id: number): Promise<VendorBillApplication | undefined>;
  listVendorBillApplications(filters: {
    targetVendorBillId?: number;
    expensePaymentId?: number;
    creditVendorBillId?: number;
    status?: AllocationStatus;
  }): Promise<VendorBillApplication[]>;
  createVendorBillApplication(values: InsertVendorBillApplication): Promise<VendorBillApplication>;
  updateVendorBillApplication(
    id: number,
    values: Partial<InsertVendorBillApplication>,
  ): Promise<VendorBillApplication | undefined>;
  getReconciliationException(id: number): Promise<ReconciliationException | undefined>;
  listReconciliationExceptions(filters: FinanceListQuery): Promise<ReconciliationExceptionListItem[]>;
  createReconciliationException(values: InsertReconciliationException): Promise<ReconciliationException>;
  updateReconciliationException(
    id: number,
    values: Partial<InsertReconciliationException>,
  ): Promise<ReconciliationException | undefined>;
  createFinanceAuditEvent(values: InsertFinanceAuditEvent): Promise<FinanceAuditEvent>;
  createDocumentWithLink(values: {
    document: InsertDocument;
    link: Omit<InsertDocumentLink, "documentId">;
  }): Promise<{ document: Document; link: DocumentLink }>;
  entityExists(entityType: FinanceEntityType, entityId: number): Promise<boolean>;
  getFinanceOverviewRows(today: string): Promise<FinanceOverviewInput>;
}

export function financeVendorResponse(vendor: Vendor | FinanceVendorListItem): FinanceVendorListItem {
  return {
    id: vendor.id,
    name: vendor.name,
    vendorType: vendor.vendorType,
    status: vendor.status,
    website: vendor.website,
    contactEmail: vendor.contactEmail,
  };
}

export function financeSubscriptionResponse(
  subscription: RecurringExpense | RecurringExpenseListItem,
): RecurringExpenseListItem {
  return {
    id: subscription.id,
    legalEntityId: subscription.legalEntityId,
    vendorId: subscription.vendorId,
    vendorName: "vendorName" in subscription ? subscription.vendorName : undefined,
    categoryCode: subscription.categoryCode,
    cadence: subscription.cadence,
    expectedAmountCents: subscription.expectedAmountCents,
    currency: subscription.currency,
    variableAmount: subscription.variableAmount,
    billingDay: subscription.billingDay,
    nextBillingDate: subscription.nextBillingDate,
    renewalDate: subscription.renewalDate,
    autoRenew: subscription.autoRenew,
    trialEndsOn: subscription.trialEndsOn,
    cancellationDate: subscription.cancellationDate,
    status: subscription.status,
  };
}

export function financeBillResponse(bill: VendorBill | VendorBillListItem): VendorBillMutationResult {
  return {
    id: bill.id,
    legalEntityId: bill.legalEntityId,
    vendorId: bill.vendorId,
    recurringExpenseId: bill.recurringExpenseId,
    invoiceNumber: bill.invoiceNumber,
    billKind: bill.billKind,
    issueDate: bill.issueDate,
    dueDate: bill.dueDate,
    servicePeriodStart: bill.servicePeriodStart,
    servicePeriodEnd: bill.servicePeriodEnd,
    amountCents: bill.amountCents,
    currency: bill.currency,
    categoryCode: bill.categoryCode,
    status: bill.status,
    creditForVendorBillId: bill.creditForVendorBillId,
  };
}

export function financePaymentResponse(payment: ExpensePayment | ExpensePaymentListItem): ExpensePaymentListItem {
  return {
    id: payment.id,
    legalEntityId: "legalEntityId" in payment ? payment.legalEntityId : undefined,
    vendorId: payment.vendorId,
    vendorName: "vendorName" in payment ? payment.vendorName : undefined,
    amountCents: payment.amountCents,
    currency: payment.currency,
    direction: payment.direction,
    paymentDate: payment.paymentDate,
    methodType: payment.methodType,
    methodLabel: payment.methodLabel,
    institutionName: payment.institutionName,
    maskedLast4: payment.maskedLast4,
    externalConfirmationRef: payment.externalConfirmationRef,
    status: payment.status,
    activeAppliedAmountCents: "activeAppliedAmountCents" in payment ? payment.activeAppliedAmountCents : 0,
    remainingAmountCents: "remainingAmountCents" in payment ? payment.remainingAmountCents : payment.amountCents,
  };
}

export function financeBillApplicationResponse(
  application: VendorBillApplication | VendorBillApplicationListItem,
): VendorBillApplicationListItem {
  return {
    id: application.id,
    targetVendorBillId: application.targetVendorBillId,
    expensePaymentId: application.expensePaymentId,
    creditVendorBillId: application.creditVendorBillId,
    amountCents: application.amountCents,
    currency: application.currency,
    status: application.status,
    reversedAt: application.reversedAt,
    reversedBy: application.reversedBy,
    createdBy: application.createdBy,
    createdAt: application.createdAt,
  };
}

export function financeReconciliationExceptionResponse(
  exception: ReconciliationException | ReconciliationExceptionListItem,
): ReconciliationExceptionListItem {
  return {
    id: exception.id,
    domain: exception.domain,
    expectedEntityType: exception.expectedEntityType,
    expectedEntityId: exception.expectedEntityId,
    actualEntityType: exception.actualEntityType,
    actualEntityId: exception.actualEntityId,
    currency: exception.currency,
    expectedAmountCents: exception.expectedAmountCents,
    actualAmountCents: exception.actualAmountCents,
    differenceAmountCents: exception.differenceAmountCents,
    reasonCode: exception.reasonCode,
    summary: exception.summary,
    status: exception.status,
    ownerAdminId: exception.ownerAdminId,
    resolvedAt: exception.resolvedAt,
    resolvedBy: exception.resolvedBy,
  };
}

function normalizeAuditValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value === undefined ? null : value;
}

function auditValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(normalizeAuditValue(left)) === JSON.stringify(normalizeAuditValue(right));
}

function auditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: readonly string[],
) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const from = before ? normalizeAuditValue(before[field]) : null;
      const to = normalizeAuditValue(after[field]);
      if (!before && to === null) {
        return [];
      }
      if (before && auditValuesEqual(from, to)) {
        return [];
      }
      return [[field, { from, to }]];
    }),
  );
}

async function writeFinanceAuditEvent(
  repo: FinanceExpenseRepository,
  input: {
    actorAdminId: number;
    entityType: FinanceAuditEntityType;
    entityId: number;
    action: FinanceAuditAction;
    changes: Record<string, unknown>;
  },
) {
  return repo.createFinanceAuditEvent({
    actorAdminUserId: input.actorAdminId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: input.changes,
  } as InsertFinanceAuditEvent);
}

function runFinanceTransaction<T>(
  repo: FinanceExpenseRepository,
  work: (tx: FinanceExpenseRepository) => Promise<T>,
) {
  return typeof repo.transaction === "function" ? repo.transaction(work) : work(repo);
}

export function monthlyRecurringAmountCents(
  subscription: Pick<FinanceOverviewSubscriptionRow, "cadence" | "expectedAmountCents" | "variableAmount" | "status">,
) {
  if (subscription.status !== "active" || subscription.variableAmount || subscription.expectedAmountCents == null) {
    return null;
  }

  // Normalizes expected recurring obligations only; actual bills and payments stay separate records.
  switch (subscription.cadence) {
    case "weekly":
      return Math.round((subscription.expectedAmountCents * 52) / 12);
    case "monthly":
      return subscription.expectedAmountCents;
    case "quarterly":
      return Math.round(subscription.expectedAmountCents / 3);
    case "annual":
      return Math.round(subscription.expectedAmountCents / 12);
    default:
      return null;
  }
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return dateOnly(value);
  return String(value).slice(0, 10);
}

function remainingBillAmountCents(bill: Pick<FinanceOverviewBillRow, "amountCents" | "activeAppliedAmountCents">) {
  return Math.max(0, bill.amountCents - (bill.activeAppliedAmountCents ?? 0));
}

function addCurrencyAmount(values: Map<string, number>, currency: string, amountCents: number) {
  values.set(currency, (values.get(currency) ?? 0) + amountCents);
}

function amountByCurrency(
  rows: readonly FinanceOverviewBillRow[],
  amountForRow: (row: FinanceOverviewBillRow) => number,
) {
  const values = new Map<string, number>();
  for (const row of rows) {
    addCurrencyAmount(values, row.currency, amountForRow(row));
  }
  return Array.from(values.entries())
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function mapToCurrencyAmounts(values: Map<string, number>) {
  return Array.from(values.entries())
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function isOpenPayableBill(bill: Pick<FinanceOverviewBillRow, "billKind" | "status" | "amountCents" | "activeAppliedAmountCents">) {
  if (bill.billKind === "credit_memo" || bill.status === "draft" || bill.status === "voided") {
    return false;
  }
  return remainingBillAmountCents(bill) > 0;
}

export function deriveFinanceOverviewFromRows(input: FinanceOverviewInput): FinanceOverview {
  const today = input.today ?? dateOnly();
  const weekEnd = addUtcDays(today, 7);
  const monthEnd = endOfUtcMonth(today);
  const openBills = input.bills.filter(isOpenPayableBill);
  const dueThisWeek = openBills.filter((bill) => {
    const dueDate = normalizeDate(bill.dueDate);
    return Boolean(dueDate && dueDate >= today && dueDate <= weekEnd);
  });
  const dueThisMonth = openBills.filter((bill) => {
    const dueDate = normalizeDate(bill.dueDate);
    return Boolean(dueDate && dueDate >= today && dueDate <= monthEnd);
  });
  const missingDocumentationBills = input.bills.filter((bill) => (
    bill.billKind !== "credit_memo" &&
    bill.status !== "draft" &&
    bill.status !== "voided" &&
    (bill.documentCount ?? 0) === 0
  ));

  const monthlyRecurringSpendByCurrency = new Map<string, number>();
  let variableOrUnknownRecurringCount = 0;
  const activeSubscriptions = input.subscriptions.filter((subscription) => subscription.status === "active");
  for (const subscription of activeSubscriptions) {
    const monthlyAmount = monthlyRecurringAmountCents(subscription);
    if (monthlyAmount == null) {
      variableOrUnknownRecurringCount += 1;
    } else {
      addCurrencyAmount(monthlyRecurringSpendByCurrency, subscription.currency, monthlyAmount);
    }
  }

  const subscriptionPriceVariances = input.bills.flatMap((bill) => {
    if (
      !bill.recurringExpenseId ||
      bill.status === "voided" ||
      bill.billKind === "credit_memo" ||
      bill.recurringExpectedAmountCents == null ||
      bill.recurringExpectedAmountCents === bill.amountCents
    ) {
      return [];
    }
    return [{
      billId: bill.id,
      recurringExpenseId: bill.recurringExpenseId,
      vendorId: bill.vendorId,
      vendorName: bill.vendorName,
      expectedAmountCents: bill.recurringExpectedAmountCents,
      actualAmountCents: bill.amountCents,
      differenceAmountCents: bill.amountCents - bill.recurringExpectedAmountCents,
      currency: bill.currency,
    }];
  });

  const byDueDate = (a: FinanceOverviewBillRow, b: FinanceOverviewBillRow) => {
    const left = normalizeDate(a.dueDate) ?? "9999-12-31";
    const right = normalizeDate(b.dueDate) ?? "9999-12-31";
    return left.localeCompare(right);
  };
  const byNextBillingDate = (a: FinanceOverviewSubscriptionRow, b: FinanceOverviewSubscriptionRow) => {
    const left = normalizeDate(a.nextBillingDate) ?? normalizeDate(a.renewalDate) ?? "9999-12-31";
    const right = normalizeDate(b.nextBillingDate) ?? normalizeDate(b.renewalDate) ?? "9999-12-31";
    return left.localeCompare(right);
  };

  return {
    asOfDate: today,
    metrics: {
      unpaidBalanceByCurrency: amountByCurrency(openBills, remainingBillAmountCents),
      billsDueThisWeekCount: dueThisWeek.length,
      billsDueThisWeekByCurrency: amountByCurrency(dueThisWeek, remainingBillAmountCents),
      billsDueThisMonthCount: dueThisMonth.length,
      billsDueThisMonthByCurrency: amountByCurrency(dueThisMonth, remainingBillAmountCents),
      monthlyRecurringSpendByCurrency: mapToCurrencyAmounts(monthlyRecurringSpendByCurrency),
      variableOrUnknownRecurringCount,
      activeSubscriptionsCount: activeSubscriptions.length,
      openReconciliationIssuesCount: input.reconciliationExceptions.filter((row) => (
        row.domain === "ap" && ["open", "investigating"].includes(row.status)
      )).length,
      missingDocumentsCount: missingDocumentationBills.length,
      subscriptionPriceVarianceCount: subscriptionPriceVariances.length,
    },
    billsDueSoon: dueThisWeek.slice().sort(byDueDate).slice(0, 10),
    activeSubscriptions: activeSubscriptions.slice().sort(byNextBillingDate).slice(0, 10),
    missingDocumentationBills: missingDocumentationBills.slice().sort(byDueDate).slice(0, 10),
    subscriptionPriceVariances: subscriptionPriceVariances.slice(0, 10),
  };
}

function billSnapshot(bill: VendorBill): VendorBillSnapshot {
  return {
    id: bill.id,
    legalEntityId: bill.legalEntityId,
    vendorId: bill.vendorId,
    amountCents: bill.amountCents,
    currency: bill.currency,
    billKind: bill.billKind,
    status: bill.status,
  };
}

function paymentSnapshot(payment: ExpensePayment): ExpensePaymentSnapshot {
  return {
    id: payment.id,
    legalEntityId: payment.legalEntityId,
    vendorId: payment.vendorId,
    amountCents: payment.amountCents,
    currency: payment.currency,
    direction: payment.direction,
    status: payment.status,
  };
}

function activeAllocationRows(applications: readonly VendorBillApplication[]) {
  return applications.map((application) => ({
    amountCents: application.amountCents,
    status: application.status,
  }));
}

async function assertLegalEntityExists(repo: FinanceExpenseRepository, legalEntityId: number) {
  const legalEntity = await repo.getLegalEntity(legalEntityId);
  if (!legalEntity || legalEntity.status !== "active") {
    fail(404, "LEGAL_ENTITY_NOT_FOUND", "Active legal entity not found.");
  }
}

async function assertVendorUsable(repo: FinanceExpenseRepository, vendorId: number) {
  const vendor = await repo.getVendor(vendorId);
  if (!vendor || vendor.status === "archived") {
    fail(404, "VENDOR_NOT_FOUND", "Active or inactive vendor not found.");
  }
  return vendor;
}

async function assertRecurringExpenseMatchesBill(
  repo: FinanceExpenseRepository,
  bill: Pick<CreateVendorBillPayload, "recurringExpenseId" | "vendorId" | "legalEntityId" | "currency" | "categoryCode">,
) {
  if (!bill.recurringExpenseId) return;
  const subscription = await repo.getRecurringExpense(bill.recurringExpenseId);
  if (!subscription || subscription.status === "cancelled" || subscription.status === "expired") {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Current subscription not found.");
  }
  if (subscription.vendorId !== bill.vendorId || subscription.legalEntityId !== bill.legalEntityId) {
    fail(409, "SUBSCRIPTION_BILL_SCOPE_MISMATCH", "Bill must use the subscription vendor and legal entity.");
  }
  if (subscription.currency !== bill.currency) {
    fail(409, "SUBSCRIPTION_BILL_CURRENCY_MISMATCH", "Bill currency must match the subscription currency.");
  }
  if (subscription.categoryCode !== bill.categoryCode) {
    fail(409, "SUBSCRIPTION_BILL_CATEGORY_MISMATCH", "Bill category must match the subscription category.");
  }
}

async function assertCreditSourceMatchesBill(
  repo: FinanceExpenseRepository,
  bill: {
    targetVendorBillId?: number;
    creditForVendorBillId?: number | null;
    vendorId: number;
    legalEntityId: number;
    currency: string;
    billKind?: string;
  },
) {
  if (!bill.creditForVendorBillId) return;
  if (bill.billKind !== "credit_memo") {
    fail(400, "CREDIT_SOURCE_REQUIRES_CREDIT_MEMO", "Only credit memos can reference another bill.");
  }
  if (bill.targetVendorBillId && bill.creditForVendorBillId === bill.targetVendorBillId) {
    fail(400, "CREDIT_SOURCE_SELF_REFERENCE", "Credit memo cannot reference itself.");
  }
  const sourceBill = await repo.getVendorBill(bill.creditForVendorBillId);
  if (!sourceBill || sourceBill.status === "voided") {
    fail(404, "CREDIT_SOURCE_BILL_NOT_FOUND", "Credit source bill not found.");
  }
  if (
    sourceBill.vendorId !== bill.vendorId ||
    sourceBill.legalEntityId !== bill.legalEntityId ||
    sourceBill.currency !== bill.currency
  ) {
    fail(409, "CREDIT_SOURCE_SCOPE_MISMATCH", "Credit memo must match source bill vendor, legal entity, and currency.");
  }
}

async function assertInvoiceNumberAvailable(
  repo: FinanceExpenseRepository,
  bill: {
    legalEntityId: number;
    vendorId: number;
    invoiceNumber?: string | null;
    currency: string;
  },
  excludeVendorBillId?: number,
) {
  if (!bill.invoiceNumber) return;
  const conflict = await repo.findVendorBillInvoiceConflict({
    legalEntityId: bill.legalEntityId,
    vendorId: bill.vendorId,
    invoiceNumber: bill.invoiceNumber,
    currency: bill.currency,
    excludeVendorBillId,
  });
  if (conflict) {
    fail(409, "VENDOR_BILL_INVOICE_DUPLICATE", "Invoice number already exists for this vendor and currency.");
  }
}

export function assertVendorBillEditable(bill: Pick<VendorBill, "status">) {
  if (bill.status !== "draft") {
    fail(409, "BILL_NOT_DRAFT", "Only draft bills can be edited.");
  }
}

export function nextVendorBillStatus(
  bill: Pick<VendorBill, "status">,
  action: "receive" | "approve" | "dispute" | "void",
): VendorBillStatus {
  if (bill.status === "voided") {
    fail(409, "BILL_ALREADY_VOIDED", "Voided bills cannot transition.");
  }

  switch (action) {
    case "receive":
      if (bill.status !== "draft") {
        fail(409, "BILL_RECEIVE_REQUIRES_DRAFT", "Only draft bills can be received.");
      }
      return "received";
    case "approve":
      if (!["received", "disputed"].includes(bill.status)) {
        fail(409, "BILL_APPROVE_REQUIRES_RECEIVED", "Only received or disputed bills can be approved.");
      }
      return "approved";
    case "dispute":
      if (!["received", "approved"].includes(bill.status)) {
        fail(409, "BILL_DISPUTE_REQUIRES_RECEIVED", "Only received or approved bills can be disputed.");
      }
      return "disputed";
    case "void":
      return "voided";
  }
}

export function nextExpensePaymentStatus(
  payment: Pick<ExpensePayment, "status">,
  nextStatus: string,
) {
  if (payment.status === "voided" || payment.status === "reversed") {
    fail(409, "PAYMENT_TERMINAL_STATE", "Terminal payments cannot transition.");
  }
  if (!EXPENSE_PAYMENT_TRANSITION_STATUSES.includes(nextStatus as typeof EXPENSE_PAYMENT_TRANSITION_STATUSES[number])) {
    fail(400, "PAYMENT_STATUS_INVALID", "Invalid payment status.");
  }
  if (payment.status === "pending" && ["posted", "failed", "voided"].includes(nextStatus)) {
    return nextStatus as ExpensePayment["status"];
  }
  if (payment.status === "posted" && ["cleared", "failed"].includes(nextStatus)) {
    return nextStatus as ExpensePayment["status"];
  }
  if (payment.status === "cleared") {
    fail(409, "PAYMENT_REVERSE_REQUIRED", "Cleared payments can only change through explicit reversal.");
  }
  if (payment.status === "failed") {
    fail(409, "PAYMENT_TERMINAL_STATE", "Failed payments cannot transition.");
  }
  fail(409, "PAYMENT_STATUS_TRANSITION_INVALID", "Expense payment status transition is not allowed.");
}

function assertExpensePaymentEditable(payment: Pick<ExpensePayment, "status">) {
  if (!EXPENSE_PAYMENT_MUTABLE_STATUSES.includes(payment.status as typeof EXPENSE_PAYMENT_MUTABLE_STATUSES[number])) {
    fail(409, "PAYMENT_NOT_PENDING", "Only pending payments can be edited.");
  }
}

function paymentStatusAuditAction(status: ExpensePayment["status"]): FinanceAuditAction {
  switch (status) {
    case "posted":
    case "cleared":
    case "failed":
    case "voided":
    case "reversed":
      return status;
    case "pending":
      fail(500, "PAYMENT_AUDIT_STATUS_INVALID", "Pending is not a payment transition audit action.");
  }
  fail(500, "PAYMENT_AUDIT_STATUS_INVALID", "Invalid payment transition audit action.");
}

function reconciliationStatusAuditAction(status: ReconciliationExceptionStatus): FinanceAuditAction {
  switch (status) {
    case "investigating":
    case "resolved":
    case "waived":
      return status;
    case "open":
      return "reopened";
    case "voided":
      return "voided";
  }
  fail(500, "RECONCILIATION_AUDIT_STATUS_INVALID", "Invalid reconciliation audit action.");
}

function nextReconciliationExceptionStatus(
  exception: Pick<ReconciliationException, "status">,
  action: "investigate" | "resolve" | "waive" | "reopen",
): ReconciliationExceptionStatus {
  switch (action) {
    case "investigate":
      if (exception.status !== "open") {
        fail(409, "RECONCILIATION_INVESTIGATE_REQUIRES_OPEN", "Only open reconciliation exceptions can move to investigating.");
      }
      return "investigating";
    case "resolve":
      if (!["open", "investigating"].includes(exception.status)) {
        fail(409, "RECONCILIATION_RESOLVE_REQUIRES_OPEN", "Only open or investigating reconciliation exceptions can be resolved.");
      }
      return "resolved";
    case "waive":
      if (!["open", "investigating"].includes(exception.status)) {
        fail(409, "RECONCILIATION_WAIVE_REQUIRES_OPEN", "Only open or investigating reconciliation exceptions can be waived.");
      }
      return "waived";
    case "reopen":
      if (!["resolved", "waived"].includes(exception.status)) {
        fail(409, "RECONCILIATION_REOPEN_REQUIRES_CLOSED", "Only resolved or waived reconciliation exceptions can be reopened.");
      }
      return "open";
  }
  fail(500, "RECONCILIATION_ACTION_INVALID", "Invalid reconciliation action.");
}

function differenceAmountCents(expected?: number | null, actual?: number | null) {
  if (expected == null || actual == null) {
    return null;
  }
  return Math.abs(actual - expected);
}

async function validateReconciliationEntityTargets(
  repo: FinanceExpenseRepository,
  payload: Pick<
    CreateReconciliationExceptionPayload,
    "expectedEntityType" | "expectedEntityId" | "actualEntityType" | "actualEntityId"
  >,
) {
  for (const side of ["expected", "actual"] as const) {
    const entityType = payload[`${side}EntityType`];
    const entityId = payload[`${side}EntityId`];
    if (!entityType || !entityId) continue;
    if (!(await repo.entityExists(entityType, entityId))) {
      fail(404, "RECONCILIATION_ENTITY_NOT_FOUND", "Reconciliation exception entity target not found.");
    }
  }
}

function ensureRecordablePaymentStatus(status: ExpensePayment["status"]) {
  if (!["pending", "posted", "cleared"].includes(status)) {
    fail(400, "PAYMENT_INITIAL_STATUS_INVALID", "New expense payments must start pending, posted, or cleared.");
  }
}

function assertNoActiveApplications(applications: readonly VendorBillApplication[], code: string, message: string) {
  if (applications.some((application) => application.status === "active")) {
    fail(409, code, message);
  }
}

function hasActiveApplications(applications: readonly VendorBillApplication[]) {
  return applications.some((application) => application.status === "active");
}

function activeApplicationAuditChanges(before: VendorBillApplication | null, after: VendorBillApplication) {
  return auditChanges(before, after, VENDOR_BILL_APPLICATION_AUDIT_FIELDS);
}

function paymentAuditChanges(before: ExpensePayment | null, after: ExpensePayment) {
  return auditChanges(before, after, EXPENSE_PAYMENT_AUDIT_FIELDS);
}

function reconciliationAuditChanges(before: ReconciliationException | null, after: ReconciliationException) {
  return auditChanges(before, after, RECONCILIATION_EXCEPTION_AUDIT_FIELDS);
}

function vendorBillStatusAuditAction(status: VendorBillStatus): FinanceAuditAction {
  switch (status) {
    case "received":
    case "approved":
    case "disputed":
    case "voided":
      return status;
    case "draft":
      fail(500, "BILL_AUDIT_STATUS_INVALID", "Draft is not a bill transition audit action.");
  }
}

export async function getFinanceOverview(repo: FinanceExpenseRepository, today = dateOnly()) {
  return deriveFinanceOverviewFromRows(await repo.getFinanceOverviewRows(today));
}

export function listFinanceLegalEntities(repo: FinanceExpenseRepository) {
  return repo.listLegalEntities();
}

export function listFinanceVendors(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listVendors(query);
}

export async function createFinanceVendor(
  repo: FinanceExpenseRepository,
  input: CreateVendorPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    const vendor = await tx.createVendor({
      ...payload,
      createdBy: actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor",
      entityId: vendor.id,
      action: "created",
      changes: auditChanges(null, vendor, VENDOR_AUDIT_FIELDS),
    });
    return vendor;
  });
}

export async function updateFinanceVendor(
  repo: FinanceExpenseRepository,
  vendorId: number,
  input: UpdateVendorPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendor(vendorId);
    const existing = await tx.getVendor(vendorId);
    if (!existing) {
      fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
    }
    const updated = await tx.updateVendor(vendorId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertVendor>);
    if (!updated) {
      fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, VENDOR_AUDIT_FIELDS),
    });
    return updated;
  });
}

export async function archiveFinanceVendor(repo: FinanceExpenseRepository, vendorId: number, actorAdminId: number) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendor(vendorId);
    const existing = await tx.getVendor(vendorId);
    if (!existing) {
      fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
    }
    const updated = await tx.updateVendor(vendorId, {
      status: "archived",
      updatedAt: new Date(),
    } as Partial<InsertVendor>);
    if (!updated) {
      fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor",
      entityId: updated.id,
      action: "archived",
      changes: auditChanges(existing, updated, VENDOR_AUDIT_FIELDS),
    });
    return updated;
  });
}

export function listFinanceSubscriptions(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listRecurringExpenses(query);
}

export async function createFinanceSubscription(
  repo: FinanceExpenseRepository,
  input: CreateRecurringExpensePayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await assertLegalEntityExists(tx, payload.legalEntityId);
    await assertVendorUsable(tx, payload.vendorId);
    const subscription = await tx.createRecurringExpense({
      ...payload,
      createdBy: actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "recurring_expense",
      entityId: subscription.id,
      action: "created",
      changes: auditChanges(null, subscription, RECURRING_EXPENSE_AUDIT_FIELDS),
    });
    return subscription;
  });
}

export async function updateFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  input: UpdateRecurringExpensePayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockRecurringExpense(subscriptionId);
    const existing = await tx.getRecurringExpense(subscriptionId);
    if (!existing) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    if (existing.status === "cancelled" || existing.status === "expired") {
      fail(409, "SUBSCRIPTION_TERMINAL_STATE", "Cancelled or expired subscriptions cannot be edited.");
    }
    const nextVariableAmount = payload.variableAmount ?? existing.variableAmount;
    const nextExpectedAmount = Object.prototype.hasOwnProperty.call(payload, "expectedAmountCents")
      ? payload.expectedAmountCents
      : existing.expectedAmountCents;
    if (!nextVariableAmount && nextExpectedAmount == null) {
      fail(400, "SUBSCRIPTION_EXPECTED_AMOUNT_REQUIRED", "Expected amount is required unless the subscription is variable.");
    }
    const updated = await tx.updateRecurringExpense(subscriptionId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertRecurringExpense>);
    if (!updated) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "recurring_expense",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, RECURRING_EXPENSE_AUDIT_FIELDS),
    });
    return updated;
  });
}

export async function pauseFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  actorAdminId: number,
) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockRecurringExpense(subscriptionId);
    const existing = await tx.getRecurringExpense(subscriptionId);
    if (!existing) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    if (!["trial", "active"].includes(existing.status)) {
      fail(409, "SUBSCRIPTION_PAUSE_REQUIRES_ACTIVE", "Only trial or active subscriptions can be paused.");
    }
    const updated = await tx.updateRecurringExpense(subscriptionId, {
      status: "paused",
      updatedAt: new Date(),
    } as Partial<InsertRecurringExpense>);
    if (!updated) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "recurring_expense",
      entityId: updated.id,
      action: "paused",
      changes: auditChanges(existing, updated, RECURRING_EXPENSE_AUDIT_FIELDS),
    });
    return updated;
  });
}

export async function resumeFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  actorAdminId: number,
) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockRecurringExpense(subscriptionId);
    const existing = await tx.getRecurringExpense(subscriptionId);
    if (!existing) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    if (existing.status !== "paused") {
      fail(409, "SUBSCRIPTION_RESUME_REQUIRES_PAUSED", "Only paused subscriptions can be resumed.");
    }
    const updated = await tx.updateRecurringExpense(subscriptionId, {
      status: "active",
      updatedAt: new Date(),
    } as Partial<InsertRecurringExpense>);
    if (!updated) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "recurring_expense",
      entityId: updated.id,
      action: "resumed",
      changes: auditChanges(existing, updated, RECURRING_EXPENSE_AUDIT_FIELDS),
    });
    return updated;
  });
}

export async function cancelFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  input: CancelRecurringExpensePayload & { actorAdminId: number },
  now = new Date(),
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockRecurringExpense(subscriptionId);
    const existing = await tx.getRecurringExpense(subscriptionId);
    if (!existing) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    if (existing.status === "cancelled") {
      return existing;
    }
    if (existing.status === "expired") {
      fail(409, "SUBSCRIPTION_EXPIRED", "Expired subscriptions cannot be cancelled.");
    }
    const updated = await tx.updateRecurringExpense(subscriptionId, {
      status: "cancelled",
      cancellationDate: payload.cancellationDate ?? dateOnly(now),
      notes: payload.notes ?? existing.notes,
      updatedAt: now,
    } as Partial<InsertRecurringExpense>);
    if (!updated) {
      fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "recurring_expense",
      entityId: updated.id,
      action: "cancelled",
      changes: auditChanges(existing, updated, RECURRING_EXPENSE_AUDIT_FIELDS),
    });
    return updated;
  });
}

export function listFinanceBills(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listVendorBills(query);
}

export async function createFinanceBill(
  repo: FinanceExpenseRepository,
  input: CreateVendorBillPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await assertLegalEntityExists(tx, payload.legalEntityId);
    await assertVendorUsable(tx, payload.vendorId);
    await assertRecurringExpenseMatchesBill(tx, payload);
    await assertCreditSourceMatchesBill(tx, payload);
    await assertInvoiceNumberAvailable(tx, payload);
    const bill = await tx.createVendorBill({
      ...payload,
      createdBy: actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor_bill",
      entityId: bill.id,
      action: "created",
      changes: auditChanges(null, bill, VENDOR_BILL_AUDIT_FIELDS),
    });
    return bill;
  });
}

export async function updateDraftFinanceBill(
  repo: FinanceExpenseRepository,
  billId: number,
  input: UpdateDraftVendorBillPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendorBill(billId);
    const existing = await tx.getVendorBill(billId);
    if (!existing) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    assertVendorBillEditable(existing);
    const merged = {
      legalEntityId: existing.legalEntityId,
      vendorId: existing.vendorId,
      currency: payload.currency ?? existing.currency,
      categoryCode: payload.categoryCode ?? existing.categoryCode,
      billKind: payload.billKind ?? existing.billKind,
      recurringExpenseId: Object.prototype.hasOwnProperty.call(payload, "recurringExpenseId")
        ? payload.recurringExpenseId
        : existing.recurringExpenseId,
      creditForVendorBillId: Object.prototype.hasOwnProperty.call(payload, "creditForVendorBillId")
        ? payload.creditForVendorBillId
        : existing.creditForVendorBillId,
      targetVendorBillId: billId,
    };
    await assertRecurringExpenseMatchesBill(tx, merged);
    await assertCreditSourceMatchesBill(tx, merged);
    await assertInvoiceNumberAvailable(tx, {
      legalEntityId: merged.legalEntityId,
      vendorId: merged.vendorId,
      invoiceNumber: Object.prototype.hasOwnProperty.call(payload, "invoiceNumber")
        ? payload.invoiceNumber
        : existing.invoiceNumber,
      currency: merged.currency,
    }, billId);
    const updated = await tx.updateVendorBill(billId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertVendorBill>);
    if (!updated) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor_bill",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, VENDOR_BILL_AUDIT_FIELDS),
    });
    return updated;
  });
}

export async function transitionFinanceBillStatus(
  repo: FinanceExpenseRepository,
  billId: number,
  action: "receive" | "approve" | "dispute" | "void",
  input: z.infer<typeof financeBillTransitionPayloadSchema> & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendorBill(billId);
    const existing = await tx.getVendorBill(billId);
    if (!existing) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    const status = nextVendorBillStatus(existing, action);
    if (action === "void") {
      const activeApplications = await Promise.all([
        tx.listVendorBillApplications({ targetVendorBillId: billId, status: "active" }),
        tx.listVendorBillApplications({ creditVendorBillId: billId, status: "active" }),
      ]);
      if (activeApplications.some(hasActiveApplications)) {
        fail(409, "BILL_VOID_HAS_ACTIVE_APPLICATIONS", "Bills with active applications must have applications reversed before voiding.");
      }
    }
    const updated = await tx.updateVendorBill(billId, {
      status,
      notes: payload.notes ?? existing.notes,
      updatedAt: new Date(),
    } as Partial<InsertVendorBill>);
    if (!updated) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor_bill",
      entityId: updated.id,
      action: vendorBillStatusAuditAction(status),
      changes: auditChanges(existing, updated, VENDOR_BILL_AUDIT_FIELDS),
    });
    return updated;
  });
}

export function listFinancePayments(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listExpensePayments(query);
}

export async function recordFinancePayment(
  repo: FinanceExpenseRepository,
  input: CreateExpensePaymentPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  ensureRecordablePaymentStatus(payload.status);
  return runFinanceTransaction(repo, async (tx) => {
    await assertLegalEntityExists(tx, payload.legalEntityId);
    if (payload.vendorId) {
      await assertVendorUsable(tx, payload.vendorId);
    }
    const payment = await tx.createExpensePayment({
      ...payload,
      createdBy: actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "expense_payment",
      entityId: payment.id,
      action: "created",
      changes: paymentAuditChanges(null, payment),
    });
    return payment;
  });
}

export async function updateFinancePayment(
  repo: FinanceExpenseRepository,
  paymentId: number,
  input: UpdateExpensePaymentPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockExpensePayment(paymentId);
    const existing = await tx.getExpensePayment(paymentId);
    if (!existing) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    assertExpensePaymentEditable(existing);
    if (payload.vendorId) {
      await assertVendorUsable(tx, payload.vendorId);
    }
    const updated = await tx.updateExpensePayment(paymentId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertExpensePayment>);
    if (!updated) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "expense_payment",
      entityId: updated.id,
      action: "updated",
      changes: paymentAuditChanges(existing, updated),
    });
    return updated;
  });
}

export async function updateFinancePaymentStatus(
  repo: FinanceExpenseRepository,
  paymentId: number,
  input: UpdateExpensePaymentStatusPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockExpensePayment(paymentId);
    const existing = await tx.getExpensePayment(paymentId);
    if (!existing) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    const status = nextExpensePaymentStatus(existing, payload.status);
    const updated = await tx.updateExpensePayment(paymentId, {
      status,
      updatedAt: new Date(),
    } as Partial<InsertExpensePayment>);
    if (!updated) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "expense_payment",
      entityId: updated.id,
      action: paymentStatusAuditAction(status),
      changes: paymentAuditChanges(existing, updated),
    });
    return updated;
  });
}

export async function reverseFinancePayment(
  repo: FinanceExpenseRepository,
  paymentId: number,
  actorAdminId: number,
) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockExpensePayment(paymentId);
    const existing = await tx.getExpensePayment(paymentId);
    if (!existing) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    if (existing.status === "reversed") {
      return existing;
    }
    if (!["posted", "cleared"].includes(existing.status)) {
      fail(409, "PAYMENT_REVERSE_REQUIRES_POSTED", "Only posted or cleared payments can be reversed.");
    }
    const activeApplications = await tx.listVendorBillApplications({ expensePaymentId: paymentId, status: "active" });
    assertNoActiveApplications(
      activeApplications,
      "PAYMENT_REVERSE_HAS_ACTIVE_APPLICATIONS",
      "Payments with active applications must have applications reversed before payment reversal.",
    );
    const updated = await tx.updateExpensePayment(paymentId, {
      status: "reversed",
      updatedAt: new Date(),
    } as Partial<InsertExpensePayment>);
    if (!updated) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "expense_payment",
      entityId: updated.id,
      action: "reversed",
      changes: paymentAuditChanges(existing, updated),
    });
    return updated;
  });
}

export async function applyFinancePaymentToBill(
  repo: FinanceExpenseRepository,
  input: ApplyExpensePaymentPayload & { actorAdminId: number },
) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendorBill(input.targetVendorBillId);
    await tx.lockExpensePayment(input.expensePaymentId);

    const [targetBill, payment, existingTargetBillApplications, existingPaymentApplications] = await Promise.all([
      tx.getVendorBill(input.targetVendorBillId),
      tx.getExpensePayment(input.expensePaymentId),
      tx.listVendorBillApplications({ targetVendorBillId: input.targetVendorBillId, status: "active" }),
      tx.listVendorBillApplications({ expensePaymentId: input.expensePaymentId, status: "active" }),
    ]);

    if (!targetBill) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    if (!payment) {
      fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
    }

    runFinanceDomainValidation(() => validateVendorBillPaymentApplicationFromLockedRows({
      targetBill: billSnapshot(targetBill),
      payment: paymentSnapshot(payment),
      amountCents: input.amountCents,
      currency: input.currency,
      existingTargetBillApplications: activeAllocationRows(existingTargetBillApplications),
      existingPaymentApplications: activeAllocationRows(existingPaymentApplications),
    }));

    const application = await tx.createVendorBillApplication({
      targetVendorBillId: input.targetVendorBillId,
      expensePaymentId: input.expensePaymentId,
      creditVendorBillId: null,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "active",
      createdBy: input.actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "vendor_bill_application",
      entityId: application.id,
      action: "applied",
      changes: activeApplicationAuditChanges(null, application),
    });
    return application;
  });
}

export async function applyFinanceCreditToBill(
  repo: FinanceExpenseRepository,
  input: ApplyCreditMemoPayload & { actorAdminId: number },
) {
  if (input.targetVendorBillId === input.creditVendorBillId) {
    fail(400, "AP_CREDIT_SELF_APPLICATION", "Credit bill cannot apply to itself.");
  }

  return runFinanceTransaction(repo, async (tx) => {
    for (const billId of [input.targetVendorBillId, input.creditVendorBillId].sort((a, b) => a - b)) {
      await tx.lockVendorBill(billId);
    }

    const [targetBill, creditBill, existingTargetBillApplications, existingCreditBillApplications] = await Promise.all([
      tx.getVendorBill(input.targetVendorBillId),
      tx.getVendorBill(input.creditVendorBillId),
      tx.listVendorBillApplications({ targetVendorBillId: input.targetVendorBillId, status: "active" }),
      tx.listVendorBillApplications({ creditVendorBillId: input.creditVendorBillId, status: "active" }),
    ]);

    if (!targetBill) {
      fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    }
    if (!creditBill) {
      fail(404, "CREDIT_BILL_NOT_FOUND", "Credit memo not found.");
    }

    runFinanceDomainValidation(() => validateVendorBillCreditApplicationFromLockedRows({
      targetBill: billSnapshot(targetBill),
      creditBill: billSnapshot(creditBill),
      amountCents: input.amountCents,
      currency: input.currency,
      existingTargetBillApplications: activeAllocationRows(existingTargetBillApplications),
      existingCreditBillApplications: activeAllocationRows(existingCreditBillApplications),
    }));

    const application = await tx.createVendorBillApplication({
      targetVendorBillId: input.targetVendorBillId,
      expensePaymentId: null,
      creditVendorBillId: input.creditVendorBillId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "active",
      createdBy: input.actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "vendor_bill_application",
      entityId: application.id,
      action: "applied",
      changes: activeApplicationAuditChanges(null, application),
    });
    return application;
  });
}

export async function reverseFinanceBillApplication(
  repo: FinanceExpenseRepository,
  applicationId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockVendorBillApplication(applicationId);
    const existing = await tx.getVendorBillApplication(applicationId);
    if (!existing) {
      fail(404, "APPLICATION_NOT_FOUND", "Bill application not found.");
    }
    if (existing.status === "reversed") {
      return existing;
    }
    if (existing.status === "voided") {
      fail(409, "APPLICATION_VOIDED", "Voided applications cannot be reversed.");
    }
    const relatedBillIds = [existing.targetVendorBillId, existing.creditVendorBillId].filter(
      (id): id is number => Number.isInteger(id),
    );
    for (const billId of relatedBillIds.sort((a, b) => a - b)) {
      await tx.lockVendorBill(billId);
    }
    if (existing.expensePaymentId) {
      await tx.lockExpensePayment(existing.expensePaymentId);
    }
    const updated = await tx.updateVendorBillApplication(applicationId, {
      status: "reversed",
      reversedAt: now,
      reversedBy: actorAdminId,
      updatedAt: now,
    } as Partial<InsertVendorBillApplication>);
    if (!updated) {
      fail(404, "APPLICATION_NOT_FOUND", "Bill application not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "vendor_bill_application",
      entityId: updated.id,
      action: "reversed",
      changes: activeApplicationAuditChanges(existing, updated),
    });
    return updated;
  });
}

export function listFinanceBillApplications(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listVendorBillApplications({
    status: query.status && query.status !== "all" ? query.status as AllocationStatus : undefined,
  }).then((rows) => rows.slice(0, Math.min(250, Math.max(1, query.pageSize ?? 100))).map(financeBillApplicationResponse));
}

export function listFinanceReconciliationExceptions(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listReconciliationExceptions(query).then((rows) => rows
    .filter((row) => row.domain === "ap")
    .map(financeReconciliationExceptionResponse));
}

export async function createFinanceReconciliationException(
  repo: FinanceExpenseRepository,
  input: CreateReconciliationExceptionPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await validateReconciliationEntityTargets(tx, payload);
    const exception = await tx.createReconciliationException({
      domain: "ap",
      expectedEntityType: payload.expectedEntityType,
      expectedEntityId: payload.expectedEntityId,
      actualEntityType: payload.actualEntityType,
      actualEntityId: payload.actualEntityId,
      currency: payload.currency,
      expectedAmountCents: payload.expectedAmountCents,
      actualAmountCents: payload.actualAmountCents,
      differenceAmountCents: differenceAmountCents(payload.expectedAmountCents, payload.actualAmountCents),
      reasonCode: payload.reasonCode,
      summary: payload.summary,
      status: "open",
      ownerAdminId: payload.ownerAdminId,
      createdBy: actorAdminId,
    });
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "reconciliation_exception",
      entityId: exception.id,
      action: "created",
      changes: reconciliationAuditChanges(null, exception),
    });
    return exception;
  });
}

export async function transitionFinanceReconciliationException(
  repo: FinanceExpenseRepository,
  exceptionId: number,
  action: "investigate" | "resolve" | "waive" | "reopen",
  input: ReconciliationExceptionTransitionPayload & { actorAdminId: number },
  now = new Date(),
) {
  const { actorAdminId, ...payload } = input;
  return runFinanceTransaction(repo, async (tx) => {
    await tx.lockReconciliationException(exceptionId);
    const existing = await tx.getReconciliationException(exceptionId);
    if (!existing || existing.domain !== "ap") {
      fail(404, "RECONCILIATION_EXCEPTION_NOT_FOUND", "AP reconciliation exception not found.");
    }
    const status = nextReconciliationExceptionStatus(existing, action);
    const updateValues = {
      status,
      updatedAt: now,
    } as Partial<InsertReconciliationException> & {
      status: ReconciliationExceptionStatus;
      updatedAt: Date;
      resolvedAt?: Date | null;
      resolvedBy?: number | null;
      resolutionNotes?: string | null;
    };
    if (status === "resolved" || status === "waived") {
      updateValues.resolvedAt = now;
      updateValues.resolvedBy = actorAdminId;
      updateValues.resolutionNotes = payload.resolutionNotes ?? existing.resolutionNotes;
    } else if (status === "open") {
      updateValues.resolvedAt = null;
      updateValues.resolvedBy = null;
      updateValues.resolutionNotes = null;
    }
    const updated = await tx.updateReconciliationException(exceptionId, updateValues);
    if (!updated) {
      fail(404, "RECONCILIATION_EXCEPTION_NOT_FOUND", "AP reconciliation exception not found.");
    }
    await writeFinanceAuditEvent(tx, {
      actorAdminId,
      entityType: "reconciliation_exception",
      entityId: updated.id,
      action: reconciliationStatusAuditAction(status),
      changes: reconciliationAuditChanges(existing, updated),
    });
    return updated;
  });
}

export async function registerFinanceDocument(
  repo: FinanceExpenseRepository,
  input: CreateFinanceDocumentPayload & { actorAdminId: number },
) {
  await validatePolymorphicEntityTarget(
    { entityType: input.link.entityType, entityId: input.link.entityId },
    (entityType, entityId) => repo.entityExists(entityType, entityId),
  );
  runFinanceDomainValidation(() => validateDocumentLinkSensitivity({
    documentSensitivityClass: input.sensitivityClass,
    requiredSensitivityClass: input.link.requiredSensitivityClass,
  }));

  return repo.createDocumentWithLink({
    document: {
      storageProvider: input.storageProvider,
      fileKey: input.fileKey,
      fileSha256: input.fileSha256,
      fileContentType: input.fileContentType,
      fileSizeBytes: input.fileSizeBytes,
      originalFilename: input.originalFilename,
      documentType: input.documentType,
      sensitivityClass: input.sensitivityClass,
      status: "active",
      createdBy: input.actorAdminId,
    },
    link: {
      entityType: input.link.entityType,
      entityId: input.link.entityId,
      linkType: input.link.linkType,
      requiredSensitivityClass: input.link.requiredSensitivityClass,
      status: "active",
      createdBy: input.actorAdminId,
    },
  });
}
