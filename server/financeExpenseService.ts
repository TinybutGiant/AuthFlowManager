import { z } from "zod";
import type {
  AllocationStatus,
  Document,
  DocumentLink,
  DocumentSensitivityClass,
  ExpensePayment,
  FinanceEntityType,
  InsertDocument,
  InsertDocumentLink,
  InsertExpensePayment,
  InsertRecurringExpense,
  InsertVendor,
  InsertVendorBill,
  InsertVendorBillApplication,
  LegalEntity,
  ReconciliationException,
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
  status: z.enum(VENDOR_BILL_STATUSES).default("draft"),
  creditForVendorBillId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  notes: optionalText(4000),
};

function refineVendorBillPayload(
  data: {
    billKind?: VendorBillKind;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    creditForVendorBillId?: number | null;
  },
  ctx: z.RefinementCtx,
) {
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

export const updateExpensePaymentStatusPayloadSchema = z.object({
  status: z.enum(EXPENSE_PAYMENT_STATUSES),
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
export type UpdateExpensePaymentStatusPayload = z.infer<typeof updateExpensePaymentStatusPayloadSchema>;
export type ApplyExpensePaymentPayload = z.infer<typeof applyExpensePaymentPayloadSchema>;
export type ApplyCreditMemoPayload = z.infer<typeof applyCreditMemoPayloadSchema>;
export type CreateFinanceDocumentPayload = z.infer<typeof createFinanceDocumentPayloadSchema>;

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

export interface VendorBillListItem {
  id: number;
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
  status: string;
  activeAppliedAmountCents: number;
  remainingAmountCents: number;
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
  lockVendorBill(id: number): Promise<void>;
  lockExpensePayment(id: number): Promise<void>;
  lockVendorBillApplication(id: number): Promise<void>;
  getLegalEntity(id: number): Promise<LegalEntity | undefined>;
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
  createDocumentWithLink(values: {
    document: InsertDocument;
    link: Omit<InsertDocumentLink, "documentId">;
  }): Promise<{ document: Document; link: DocumentLink }>;
  entityExists(entityType: FinanceEntityType, entityId: number): Promise<boolean>;
  getFinanceOverviewRows(today: string): Promise<FinanceOverviewInput>;
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
    vendorId: payment.vendorId,
    amountCents: payment.amountCents,
    currency: payment.currency,
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
  if (!EXPENSE_PAYMENT_STATUSES.includes(nextStatus as typeof EXPENSE_PAYMENT_STATUSES[number])) {
    fail(400, "PAYMENT_STATUS_INVALID", "Invalid payment status.");
  }
  return nextStatus as ExpensePayment["status"];
}

export async function getFinanceOverview(repo: FinanceExpenseRepository, today = dateOnly()) {
  return deriveFinanceOverviewFromRows(await repo.getFinanceOverviewRows(today));
}

export function listFinanceVendors(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listVendors(query);
}

export async function createFinanceVendor(
  repo: FinanceExpenseRepository,
  input: CreateVendorPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return repo.createVendor({
    ...payload,
    createdBy: actorAdminId,
  });
}

export async function updateFinanceVendor(
  repo: FinanceExpenseRepository,
  vendorId: number,
  payload: UpdateVendorPayload,
) {
  const existing = await repo.getVendor(vendorId);
  if (!existing) {
    fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
  }
  const updated = await repo.updateVendor(vendorId, {
    ...payload,
    updatedAt: new Date(),
  } as Partial<InsertVendor>);
  if (!updated) {
    fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
  }
  return updated;
}

export async function archiveFinanceVendor(repo: FinanceExpenseRepository, vendorId: number) {
  const updated = await repo.updateVendor(vendorId, {
    status: "archived",
    updatedAt: new Date(),
  } as Partial<InsertVendor>);
  if (!updated) {
    fail(404, "VENDOR_NOT_FOUND", "Vendor not found.");
  }
  return updated;
}

export function listFinanceSubscriptions(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listRecurringExpenses(query);
}

export async function createFinanceSubscription(
  repo: FinanceExpenseRepository,
  input: CreateRecurringExpensePayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  await assertLegalEntityExists(repo, payload.legalEntityId);
  await assertVendorUsable(repo, payload.vendorId);
  return repo.createRecurringExpense({
    ...payload,
    createdBy: actorAdminId,
  });
}

export async function updateFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  payload: UpdateRecurringExpensePayload,
) {
  const existing = await repo.getRecurringExpense(subscriptionId);
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
  const updated = await repo.updateRecurringExpense(subscriptionId, {
    ...payload,
    updatedAt: new Date(),
  } as Partial<InsertRecurringExpense>);
  if (!updated) {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }
  return updated;
}

export async function pauseFinanceSubscription(repo: FinanceExpenseRepository, subscriptionId: number) {
  const existing = await repo.getRecurringExpense(subscriptionId);
  if (!existing) {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }
  if (!["trial", "active"].includes(existing.status)) {
    fail(409, "SUBSCRIPTION_PAUSE_REQUIRES_ACTIVE", "Only trial or active subscriptions can be paused.");
  }
  const updated = await repo.updateRecurringExpense(subscriptionId, {
    status: "paused",
    updatedAt: new Date(),
  } as Partial<InsertRecurringExpense>);
  if (!updated) {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }
  return updated;
}

export async function cancelFinanceSubscription(
  repo: FinanceExpenseRepository,
  subscriptionId: number,
  input: CancelRecurringExpensePayload,
  now = new Date(),
) {
  const existing = await repo.getRecurringExpense(subscriptionId);
  if (!existing) {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }
  if (existing.status === "cancelled") {
    return existing;
  }
  if (existing.status === "expired") {
    fail(409, "SUBSCRIPTION_EXPIRED", "Expired subscriptions cannot be cancelled.");
  }
  const updated = await repo.updateRecurringExpense(subscriptionId, {
    status: "cancelled",
    cancellationDate: input.cancellationDate ?? dateOnly(now),
    notes: input.notes ?? existing.notes,
    updatedAt: now,
  } as Partial<InsertRecurringExpense>);
  if (!updated) {
    fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }
  return updated;
}

export function listFinanceBills(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listVendorBills(query);
}

export async function createFinanceBill(
  repo: FinanceExpenseRepository,
  input: CreateVendorBillPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  await assertLegalEntityExists(repo, payload.legalEntityId);
  await assertVendorUsable(repo, payload.vendorId);
  await assertRecurringExpenseMatchesBill(repo, payload);
  await assertCreditSourceMatchesBill(repo, payload);
  return repo.createVendorBill({
    ...payload,
    createdBy: actorAdminId,
  });
}

export async function updateDraftFinanceBill(
  repo: FinanceExpenseRepository,
  billId: number,
  payload: UpdateDraftVendorBillPayload,
) {
  const existing = await repo.getVendorBill(billId);
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
  await assertRecurringExpenseMatchesBill(repo, merged);
  await assertCreditSourceMatchesBill(repo, merged);
  const updated = await repo.updateVendorBill(billId, {
    ...payload,
    updatedAt: new Date(),
  } as Partial<InsertVendorBill>);
  if (!updated) {
    fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
  }
  return updated;
}

export async function transitionFinanceBillStatus(
  repo: FinanceExpenseRepository,
  billId: number,
  action: "receive" | "approve" | "dispute" | "void",
  payload: z.infer<typeof financeBillTransitionPayloadSchema>,
) {
  const existing = await repo.getVendorBill(billId);
  if (!existing) {
    fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
  }
  const status = nextVendorBillStatus(existing, action);
  const updated = await repo.updateVendorBill(billId, {
    status,
    notes: payload.notes ?? existing.notes,
    updatedAt: new Date(),
  } as Partial<InsertVendorBill>);
  if (!updated) {
    fail(404, "BILL_NOT_FOUND", "Vendor bill not found.");
  }
  return updated;
}

export function listFinancePayments(repo: FinanceExpenseRepository, query: FinanceListQuery) {
  return repo.listExpensePayments(query);
}

export async function recordFinancePayment(
  repo: FinanceExpenseRepository,
  input: CreateExpensePaymentPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  await assertLegalEntityExists(repo, payload.legalEntityId);
  if (payload.vendorId) {
    await assertVendorUsable(repo, payload.vendorId);
  }
  return repo.createExpensePayment({
    ...payload,
    createdBy: actorAdminId,
  });
}

export async function updateFinancePaymentStatus(
  repo: FinanceExpenseRepository,
  paymentId: number,
  payload: UpdateExpensePaymentStatusPayload,
) {
  const existing = await repo.getExpensePayment(paymentId);
  if (!existing) {
    fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
  }
  const status = nextExpensePaymentStatus(existing, payload.status);
  const updated = await repo.updateExpensePayment(paymentId, {
    status,
    updatedAt: new Date(),
  } as Partial<InsertExpensePayment>);
  if (!updated) {
    fail(404, "PAYMENT_NOT_FOUND", "Expense payment not found.");
  }
  return updated;
}

export async function applyFinancePaymentToBill(
  repo: FinanceExpenseRepository,
  input: ApplyExpensePaymentPayload & { actorAdminId: number },
) {
  return repo.transaction(async (tx) => {
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

    validateVendorBillPaymentApplicationFromLockedRows({
      targetBill: billSnapshot(targetBill),
      payment: paymentSnapshot(payment),
      amountCents: input.amountCents,
      currency: input.currency,
      existingTargetBillApplications: activeAllocationRows(existingTargetBillApplications),
      existingPaymentApplications: activeAllocationRows(existingPaymentApplications),
    });

    return tx.createVendorBillApplication({
      targetVendorBillId: input.targetVendorBillId,
      expensePaymentId: input.expensePaymentId,
      creditVendorBillId: null,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "active",
      createdBy: input.actorAdminId,
    });
  });
}

export async function applyFinanceCreditToBill(
  repo: FinanceExpenseRepository,
  input: ApplyCreditMemoPayload & { actorAdminId: number },
) {
  if (input.targetVendorBillId === input.creditVendorBillId) {
    fail(400, "AP_CREDIT_SELF_APPLICATION", "Credit bill cannot apply to itself.");
  }

  return repo.transaction(async (tx) => {
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

    validateVendorBillCreditApplicationFromLockedRows({
      targetBill: billSnapshot(targetBill),
      creditBill: billSnapshot(creditBill),
      amountCents: input.amountCents,
      currency: input.currency,
      existingTargetBillApplications: activeAllocationRows(existingTargetBillApplications),
      existingCreditBillApplications: activeAllocationRows(existingCreditBillApplications),
    });

    return tx.createVendorBillApplication({
      targetVendorBillId: input.targetVendorBillId,
      expensePaymentId: null,
      creditVendorBillId: input.creditVendorBillId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "active",
      createdBy: input.actorAdminId,
    });
  });
}

export async function reverseFinanceBillApplication(
  repo: FinanceExpenseRepository,
  applicationId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return repo.transaction(async (tx) => {
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
    const updated = await tx.updateVendorBillApplication(applicationId, {
      status: "reversed",
      reversedAt: now,
      reversedBy: actorAdminId,
      updatedAt: now,
    } as Partial<InsertVendorBillApplication>);
    if (!updated) {
      fail(404, "APPLICATION_NOT_FOUND", "Bill application not found.");
    }
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
  validateDocumentLinkSensitivity({
    documentSensitivityClass: input.sensitivityClass,
    requiredSensitivityClass: input.link.requiredSensitivityClass,
  });

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
