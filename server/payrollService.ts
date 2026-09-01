import { z } from "zod";
import type {
  AmountEffect,
  Employment,
  ExternalRecordRef,
  FinanceSourceType,
  InsertExternalRecordRef,
  InsertPayrollAuditEvent,
  InsertPayrollPayment,
  InsertPayrollResultLine,
  InsertPayrollRun,
  InsertPayrollRunWorker,
  LegalEntity,
  PaymentProcessingStatus,
  PayrollAuditEvent,
  PayrollPayment,
  PayrollResultLine,
  PayrollResultLineCategory,
  PayrollRun,
  PayrollRunKind,
  PayrollRunStatus,
  PayrollRunWorker,
  Vendor,
  Worker,
} from "@shared/schema";
import {
  FinanceDomainValidationError,
  derivePayrollResultLineTotals,
  validatePayrollCorrectionRun,
  validatePayrollRunWorkerConsistency,
} from "./payrollDomainValidation";

export class PayrollServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayrollServiceError";
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new PayrollServiceError(statusCode, code, message);
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

const PAYROLL_RUN_KINDS = ["regular", "off_cycle", "bonus", "correction", "adjustment"] as const;
const NON_CORRECTION_PAYROLL_RUN_KINDS = ["regular", "off_cycle", "bonus", "adjustment"] as const;
const PAYROLL_SOURCE_TYPES = ["provider", "csv_import", "manual", "internal"] as const;
const PAYROLL_RUN_STATUSES = ["draft", "reviewed", "finalized"] as const;
const PAYROLL_RESULT_LINE_CATEGORIES = [
  "earning",
  "deduction",
  "employee_tax",
  "employer_tax",
  "reimbursement",
  "other",
] as const;
const AMOUNT_EFFECTS = ["increase", "decrease"] as const;
const PAYROLL_PAYMENT_METHODS = ["payroll_provider", "ach", "check", "manual", "other"] as const;
const PAYROLL_PAYMENT_INITIAL_STATUSES = ["pending", "sent", "cleared", "failed"] as const;
const PAYROLL_PAYMENT_TRANSITION_STATUSES = ["sent", "cleared", "failed", "voided"] as const;
const PAYROLL_PAYMENT_SETTLED_STATUSES = ["cleared"] as const;
const PAYROLL_PAYMENT_IN_FLIGHT_STATUSES = ["sent"] as const;
const PAYROLL_PAYMENT_REVERSIBLE_STATUSES = ["sent", "cleared"] as const;
const PAYROLL_AUDIT_ENTITY_TYPES = [
  "payroll_run",
  "payroll_run_worker",
  "payroll_result_line",
  "payroll_payment",
] as const;
const PAYROLL_AUDIT_ACTIONS = [
  "created",
  "updated",
  "reviewed",
  "finalized",
  "correction_created",
  "removed",
  "recorded",
  "sent",
  "cleared",
  "failed",
  "reversed",
  "voided",
] as const;
const PAYROLL_RUN_AUDIT_FIELDS = [
  "legalEntityId",
  "periodStart",
  "periodEnd",
  "payDate",
  "runKind",
  "sourceType",
  "sourceVendorId",
  "correctionOfPayrollRunId",
  "status",
  "finalizedAt",
  "finalizedBy",
] as const;
const PAYROLL_RUN_WORKER_AUDIT_FIELDS = [
  "payrollRunId",
  "workerId",
  "employmentId",
  "currency",
  "grossPayCents",
  "employeeTaxCents",
  "employerTaxCents",
  "deductionCents",
  "netPayCents",
] as const;
const PAYROLL_RESULT_LINE_AUDIT_FIELDS = [
  "payrollRunWorkerId",
  "lineCategory",
  "lineCode",
  "description",
  "amountEffect",
  "amountCents",
  "currency",
  "quantityMicrounits",
  "rateAmountCents",
  "jurisdictionCode",
] as const;
const PAYROLL_PAYMENT_AUDIT_FIELDS = [
  "payrollRunWorkerId",
  "amountCents",
  "currency",
  "paymentDate",
  "methodType",
  "maskedLast4",
  "status",
  "processedAt",
] as const;
const PAYROLL_EXTERNAL_REF_ENTITY_TYPES = [
  "payroll_runs",
  "payroll_run_workers",
  "payroll_result_lines",
  "payroll_payments",
] as const;
const EXTERNAL_RECORD_REF_STATUSES = ["active", "superseded", "voided"] as const;

const positiveIdSchema = z.coerce.number().int().positive();
const optionalIdSchema = z.preprocess(
  (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
  z.coerce.number().int().positive().nullable().optional(),
);
const amountCentsSchema = z.coerce.number().int().positive();
const nonnegativeAmountCentsSchema = z.coerce.number().int().min(0);
const dateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateOnlySchema = z.preprocess(
  (value) => value === undefined ? undefined : value === "" ? null : value,
  dateOnlySchema.nullable().optional(),
);
const currencySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{3}$/)
  .transform((value) => value.toUpperCase());
const metadataSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({});

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

function optionalTimestamp() {
  return z.preprocess(
    (value) => value === undefined || value === "" || value === null ? undefined : value,
    z.coerce.date().optional(),
  );
}

function nonEmptyPatch(value: Record<string, unknown>) {
  return Object.values(value).some((item) => item !== undefined);
}

function refinePayrollPeriod(
  data: { periodStart?: string | null; periodEnd?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.periodStart && data.periodEnd && data.periodEnd < data.periodStart) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Payroll period end cannot be before period start.",
    });
  }
}

export const payrollRunListQuerySchema = z.object({
  status: z.enum(["all", ...PAYROLL_RUN_STATUSES]).default("all"),
  legalEntityId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

export const payrollEmploymentOptionQuerySchema = z.object({
  legalEntityId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 250 : value,
    z.coerce.number().int().min(1).max(250).default(250),
  ),
}).strict();

const payrollRunWriteFields = {
  legalEntityId: positiveIdSchema,
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  payDate: dateOnlySchema,
  sourceType: z.enum(PAYROLL_SOURCE_TYPES).default("manual"),
  sourceVendorId: optionalIdSchema,
  notes: optionalText(4000),
};

export const createPayrollRunPayloadSchema = z
  .object({
    ...payrollRunWriteFields,
    runKind: z.enum(NON_CORRECTION_PAYROLL_RUN_KINDS).default("regular"),
  })
  .strict()
  .superRefine(refinePayrollPeriod);

export const createPayrollCorrectionRunPayloadSchema = z
  .object({
    correctionOfPayrollRunId: positiveIdSchema,
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    payDate: dateOnlySchema,
    sourceType: z.enum(PAYROLL_SOURCE_TYPES).default("manual"),
    sourceVendorId: optionalIdSchema,
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refinePayrollPeriod);

export const updatePayrollRunPayloadSchema = z
  .object({
    legalEntityId: payrollRunWriteFields.legalEntityId.optional(),
    periodStart: dateOnlySchema.optional(),
    periodEnd: dateOnlySchema.optional(),
    payDate: dateOnlySchema.optional(),
    sourceType: z.enum(PAYROLL_SOURCE_TYPES).optional(),
    sourceVendorId: payrollRunWriteFields.sourceVendorId,
    notes: payrollRunWriteFields.notes,
  })
  .strict()
  .refine(nonEmptyPatch, "At least one payroll run field is required.")
  .superRefine(refinePayrollPeriod);

export const createPayrollRunWorkerPayloadSchema = z.object({
  workerId: positiveIdSchema,
  employmentId: positiveIdSchema,
  currency: currencySchema.default("USD"),
  grossPayCents: nonnegativeAmountCentsSchema.default(0),
  employeeTaxCents: nonnegativeAmountCentsSchema.default(0),
  employerTaxCents: nonnegativeAmountCentsSchema.default(0),
  deductionCents: nonnegativeAmountCentsSchema.default(0),
  netPayCents: nonnegativeAmountCentsSchema.default(0),
  sourceMetadata: metadataSchema,
}).strict();

export const updatePayrollRunWorkerPayloadSchema = z
  .object({
    currency: currencySchema.optional(),
    grossPayCents: nonnegativeAmountCentsSchema.optional(),
    employeeTaxCents: nonnegativeAmountCentsSchema.optional(),
    employerTaxCents: nonnegativeAmountCentsSchema.optional(),
    deductionCents: nonnegativeAmountCentsSchema.optional(),
    netPayCents: nonnegativeAmountCentsSchema.optional(),
    sourceMetadata: metadataSchema.optional(),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one payroll worker result field is required.");

export const createPayrollResultLinePayloadSchema = z.object({
  lineCategory: z.enum(PAYROLL_RESULT_LINE_CATEGORIES),
  lineCode: requiredText(120),
  description: optionalText(400),
  amountEffect: z.enum(AMOUNT_EFFECTS).default("increase"),
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
  quantityMicrounits: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  rateAmountCents: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  jurisdictionCode: optionalText(80),
  metadata: metadataSchema,
}).strict();

export const updatePayrollResultLinePayloadSchema = z
  .object({
    lineCategory: z.enum(PAYROLL_RESULT_LINE_CATEGORIES).optional(),
    lineCode: requiredText(120).optional(),
    description: optionalText(400),
    amountEffect: z.enum(AMOUNT_EFFECTS).optional(),
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    quantityMicrounits: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().positive().nullable().optional(),
    ),
    rateAmountCents: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().positive().nullable().optional(),
    ),
    jurisdictionCode: optionalText(80),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one payroll result line field is required.");

export const createPayrollPaymentPayloadSchema = z.object({
  amountCents: amountCentsSchema,
  currency: currencySchema.default("USD"),
  paymentDate: optionalDateOnlySchema,
  methodType: z.enum(PAYROLL_PAYMENT_METHODS),
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
  status: z.enum(PAYROLL_PAYMENT_INITIAL_STATUSES).default("pending"),
  processedAt: optionalTimestamp(),
}).strict();

export const updatePayrollPaymentPayloadSchema = z
  .object({
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    paymentDate: optionalDateOnlySchema,
    methodType: z.enum(PAYROLL_PAYMENT_METHODS).optional(),
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
  })
  .strict()
  .refine(nonEmptyPatch, "At least one payroll payment field is required.");

export const payrollPaymentTransitionPayloadSchema = z.object({
  status: z.enum(PAYROLL_PAYMENT_TRANSITION_STATUSES),
  paymentDate: optionalDateOnlySchema,
  processedAt: optionalTimestamp(),
}).strict();

export const createPayrollExternalRefPayloadSchema = z.object({
  entityType: z.enum(PAYROLL_EXTERNAL_REF_ENTITY_TYPES),
  entityId: positiveIdSchema,
  sourceType: z.enum(PAYROLL_SOURCE_TYPES),
  sourceVendorId: optionalIdSchema,
  sourceNamespace: requiredText(120).default("default"),
  externalRecordType: requiredText(120),
  externalRecordId: requiredText(300),
  importedAt: optionalTimestamp(),
  payloadHash: optionalText(128),
  metadata: metadataSchema,
  status: z.enum(EXTERNAL_RECORD_REF_STATUSES).default("active"),
}).strict();

export type PayrollRunListQuery = z.infer<typeof payrollRunListQuerySchema>;
export type PayrollRunListFilters = Partial<PayrollRunListQuery>;
export type PayrollEmploymentOptionQuery = z.infer<typeof payrollEmploymentOptionQuerySchema>;
export type PayrollEmploymentOptionFilters = Partial<PayrollEmploymentOptionQuery>;
export type CreatePayrollRunPayload = z.infer<typeof createPayrollRunPayloadSchema>;
export type CreatePayrollCorrectionRunPayload = z.infer<typeof createPayrollCorrectionRunPayloadSchema>;
export type UpdatePayrollRunPayload = z.infer<typeof updatePayrollRunPayloadSchema>;
export type CreatePayrollRunWorkerPayload = z.infer<typeof createPayrollRunWorkerPayloadSchema>;
export type UpdatePayrollRunWorkerPayload = z.infer<typeof updatePayrollRunWorkerPayloadSchema>;
export type CreatePayrollResultLinePayload = z.infer<typeof createPayrollResultLinePayloadSchema>;
export type UpdatePayrollResultLinePayload = z.infer<typeof updatePayrollResultLinePayloadSchema>;
export type CreatePayrollPaymentPayload = z.infer<typeof createPayrollPaymentPayloadSchema>;
export type UpdatePayrollPaymentPayload = z.infer<typeof updatePayrollPaymentPayloadSchema>;
export type PayrollPaymentTransitionPayload = z.infer<typeof payrollPaymentTransitionPayloadSchema>;
export type CreatePayrollExternalRefPayload = z.infer<typeof createPayrollExternalRefPayloadSchema>;

type PayrollAuditEntityType = typeof PAYROLL_AUDIT_ENTITY_TYPES[number];
type PayrollAuditAction = typeof PAYROLL_AUDIT_ACTIONS[number];
type PayrollExternalRefEntityType = typeof PAYROLL_EXTERNAL_REF_ENTITY_TYPES[number];

export interface PayrollLegalEntitySummary {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
}

export interface PayrollVendorSummary {
  id: number;
  name: string;
  vendorType: string;
  status: string;
}

export interface PayrollWorkerSummary {
  id: number;
  workerCode: string;
  legalName: string;
  preferredName: string | null;
  adminUserId: number | null;
  lifecycleState: string;
}

export interface PayrollEmploymentSummary {
  id: number;
  workerId: number;
  legalEntityId: number;
  employeeClassification: string;
  payrollParticipation: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date | null;
  legalEntity: PayrollLegalEntitySummary | null;
  worker: PayrollWorkerSummary | null;
}

export interface PayrollEmploymentOption {
  employment: PayrollEmploymentSummary;
  worker: PayrollWorkerSummary;
}

export interface PayrollCurrencyTotals {
  currency: string;
  workerCount: number;
  grossPayCents: number;
  netPayCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  deductionCents: number;
  effectivePaidCents: number;
  clearedPaymentCents: number;
  inFlightPaymentCents: number;
  pendingPaymentCents: number;
  failedAttemptCents: number;
  unpaidNetPayCents: number;
  overpaidNetPayCents: number;
}

export type PayrollPaymentSettlementState =
  | "not_payable"
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "failed"
  | "mixed";

export interface PayrollPaymentSummary {
  targetNetPayCents: number;
  effectivePaidCents: number;
  clearedPaymentCents: number;
  inFlightPaymentCents: number;
  pendingPaymentCents: number;
  failedAttemptCents: number;
  reversedPaymentCents: number;
  voidedPaymentCents: number;
  remainingNetPayCents: number;
  overpaidNetPayCents: number;
  state: PayrollPaymentSettlementState;
}

export interface PayrollResultLineTotals {
  currency: string;
  grossPayCents: number;
  deductionCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  reimbursementCents: number;
  otherCents: number;
  netPayImpactCents: number;
}

export interface PayrollRunListItem {
  id: number;
  legalEntityId: number;
  legalEntity: PayrollLegalEntitySummary | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  payDate: string | Date;
  runKind: PayrollRunKind;
  sourceType: FinanceSourceType;
  sourceVendorId: number | null;
  sourceVendor: PayrollVendorSummary | null;
  correctionOfPayrollRunId: number | null;
  status: PayrollRunStatus;
  finalizedAt: Date | string | null;
  finalizedBy: number | null;
  notes: string | null;
  workerCount: number;
  totalsByCurrency: PayrollCurrencyTotals[];
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface PayrollResultLineResponse {
  id: number;
  payrollRunWorkerId: number;
  lineCategory: PayrollResultLineCategory;
  lineCode: string;
  description: string | null;
  amountEffect: AmountEffect;
  amountCents: number;
  signedAmountCents: number;
  currency: string;
  quantityMicrounits: number | null;
  rateAmountCents: number | null;
  jurisdictionCode: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface PayrollPaymentResponse {
  id: number;
  payrollRunWorkerId: number;
  amountCents: number;
  currency: string;
  paymentDate: string | Date | null;
  methodType: string;
  methodLabel: string | null;
  institutionName: string | null;
  maskedLast4: string | null;
  externalConfirmationRef: string | null;
  status: PaymentProcessingStatus;
  processedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface PayrollRunWorkerResponse {
  id: number;
  payrollRunId: number;
  workerId: number;
  employmentId: number;
  worker: PayrollWorkerSummary | null;
  employment: PayrollEmploymentSummary | null;
  currency: string;
  grossPayCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  deductionCents: number;
  netPayCents: number;
  lineTotalsByCurrency: PayrollResultLineTotals[];
  paymentSummary: PayrollPaymentSummary;
  resultLines: PayrollResultLineResponse[];
  payments: PayrollPaymentResponse[];
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface PayrollRunDetailResponse extends PayrollRunListItem {
  workers: PayrollRunWorkerResponse[];
  externalRefs: PayrollExternalRefResponse[];
}

export interface PayrollOverviewResponse {
  recentRuns: PayrollRunListItem[];
  draftRuns: PayrollRunListItem[];
  effectiveRuns: PayrollRunListItem[];
  totalsByCurrency: PayrollCurrencyTotals[];
  runPaymentStates: Record<PayrollPaymentSettlementState, number>;
}

export interface PayrollExternalRefResponse {
  id: number;
  entityType: PayrollExternalRefEntityType;
  entityId: number;
  sourceType: FinanceSourceType;
  sourceVendorId: number | null;
  sourceNamespace: string;
  externalRecordType: string;
  externalRecordId: string;
  importedAt: Date | string | null;
  payloadHash: string | null;
  status: string;
  createdAt: Date | string | null;
}

export interface PayrollRepository {
  transaction<T>(work: (tx: PayrollRepository) => Promise<T>): Promise<T>;
  lockPayrollRun(id: number): Promise<void>;
  lockPayrollRunWorker(id: number): Promise<void>;
  lockPayrollResultLine(id: number): Promise<void>;
  lockPayrollPayment(id: number): Promise<void>;
  lockWorker(id: number): Promise<void>;
  lockEmployment(id: number): Promise<void>;
  lockLegalEntity(id: number): Promise<void>;
  lockVendor(id: number): Promise<void>;

  getLegalEntity(id: number): Promise<LegalEntity | undefined>;
  listLegalEntities(): Promise<PayrollLegalEntitySummary[]>;
  getVendor(id: number): Promise<Vendor | undefined>;
  listPayrollVendors(): Promise<Vendor[]>;
  getWorker(id: number): Promise<Worker | undefined>;
  getEmployment(id: number): Promise<Employment | undefined>;
  listPayrollEmploymentOptions(filters: PayrollEmploymentOptionFilters): Promise<Employment[]>;

  getPayrollRun(id: number): Promise<PayrollRun | undefined>;
  findPayrollCorrectionSuccessor(payrollRunId: number): Promise<PayrollRun | undefined>;
  listPayrollRuns(filters: PayrollRunListFilters): Promise<PayrollRun[]>;
  createPayrollRun(values: InsertPayrollRun): Promise<PayrollRun>;
  updatePayrollRun(id: number, values: Partial<InsertPayrollRun>): Promise<PayrollRun | undefined>;

  getPayrollRunWorker(id: number): Promise<PayrollRunWorker | undefined>;
  findPayrollRunWorkerByRunEmployment(payrollRunId: number, employmentId: number): Promise<PayrollRunWorker | undefined>;
  listPayrollRunWorkers(payrollRunId: number): Promise<PayrollRunWorker[]>;
  listPayrollRunWorkersForRuns(payrollRunIds: number[]): Promise<PayrollRunWorker[]>;
  createPayrollRunWorker(values: InsertPayrollRunWorker): Promise<PayrollRunWorker>;
  updatePayrollRunWorker(id: number, values: Partial<InsertPayrollRunWorker>): Promise<PayrollRunWorker | undefined>;
  deletePayrollRunWorker(id: number): Promise<void>;

  getPayrollResultLine(id: number): Promise<PayrollResultLine | undefined>;
  listPayrollResultLines(payrollRunWorkerId: number): Promise<PayrollResultLine[]>;
  listPayrollResultLinesForWorkers(payrollRunWorkerIds: number[]): Promise<PayrollResultLine[]>;
  createPayrollResultLine(values: InsertPayrollResultLine): Promise<PayrollResultLine>;
  updatePayrollResultLine(id: number, values: Partial<InsertPayrollResultLine>): Promise<PayrollResultLine | undefined>;
  deletePayrollResultLine(id: number): Promise<void>;
  deletePayrollResultLinesForWorker(payrollRunWorkerId: number): Promise<void>;

  getPayrollPayment(id: number): Promise<PayrollPayment | undefined>;
  listPayrollPayments(payrollRunWorkerId: number): Promise<PayrollPayment[]>;
  listPayrollPaymentsForWorkers(payrollRunWorkerIds: number[]): Promise<PayrollPayment[]>;
  createPayrollPayment(values: InsertPayrollPayment): Promise<PayrollPayment>;
  updatePayrollPayment(id: number, values: Partial<InsertPayrollPayment>): Promise<PayrollPayment | undefined>;

  getExternalRecordRef(id: number): Promise<ExternalRecordRef | undefined>;
  listExternalRecordRefsForEntity(entityType: PayrollExternalRefEntityType, entityId: number): Promise<ExternalRecordRef[]>;
  createExternalRecordRef(values: InsertExternalRecordRef): Promise<ExternalRecordRef>;

  createPayrollAuditEvent(values: InsertPayrollAuditEvent): Promise<PayrollAuditEvent>;
}

function serializeAuditValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function auditValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function auditChanges<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: readonly (keyof T & string)[],
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of fields) {
    const beforeValue = before ? serializeAuditValue(before[field]) : null;
    const afterValue = serializeAuditValue(after[field]);
    if (!auditValuesEqual(beforeValue, afterValue)) {
      changes[field] = { before: beforeValue, after: afterValue };
    }
  }
  return changes;
}

async function writePayrollAuditEvent(
  repo: PayrollRepository,
  input: {
    actorAdminId: number;
    entityType: PayrollAuditEntityType;
    entityId: number;
    action: PayrollAuditAction;
    changes: Record<string, unknown>;
  },
) {
  await repo.createPayrollAuditEvent({
    actorAdminUserId: input.actorAdminId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: input.changes,
  });
}

function runPayrollTransaction<T>(
  repo: PayrollRepository,
  work: (tx: PayrollRepository) => Promise<T>,
) {
  return repo.transaction(work);
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function vendorSummary(vendor: Vendor | undefined | null): PayrollVendorSummary | null {
  if (!vendor) return null;
  return {
    id: vendor.id,
    name: vendor.name,
    vendorType: vendor.vendorType,
    status: vendor.status,
  };
}

function legalEntitySummary(entity: LegalEntity | PayrollLegalEntitySummary | undefined | null): PayrollLegalEntitySummary | null {
  if (!entity) return null;
  return {
    id: entity.id,
    legalName: entity.legalName,
    entityType: entity.entityType,
    status: entity.status,
  };
}

function workerSummary(worker: Worker | undefined | null): PayrollWorkerSummary | null {
  if (!worker) return null;
  return {
    id: worker.id,
    workerCode: worker.workerCode,
    legalName: worker.legalName,
    preferredName: worker.preferredName,
    adminUserId: worker.adminUserId,
    lifecycleState: worker.voidedAt ? "voided" : worker.mergedAt ? "merged" : worker.archivedAt ? "archived" : "normal",
  };
}

async function employmentSummary(
  repo: PayrollRepository,
  employment: Employment | undefined | null,
): Promise<PayrollEmploymentSummary | null> {
  if (!employment) return null;
  const entity = await repo.getLegalEntity(employment.legalEntityId);
  const worker = await repo.getWorker(employment.workerId);
  return {
    id: employment.id,
    workerId: employment.workerId,
    legalEntityId: employment.legalEntityId,
    employeeClassification: employment.employeeClassification,
    payrollParticipation: employment.payrollParticipation,
    status: employment.status,
    startDate: employment.startDate,
    endDate: employment.endDate,
    legalEntity: legalEntitySummary(entity),
    worker: workerSummary(worker),
  };
}

function lineResponse(line: PayrollResultLine): PayrollResultLineResponse {
  return {
    id: line.id,
    payrollRunWorkerId: line.payrollRunWorkerId,
    lineCategory: line.lineCategory as PayrollResultLineCategory,
    lineCode: line.lineCode,
    description: line.description,
    amountEffect: line.amountEffect as AmountEffect,
    amountCents: line.amountCents,
    signedAmountCents: line.amountEffect === "decrease" ? -line.amountCents : line.amountCents,
    currency: line.currency,
    quantityMicrounits: line.quantityMicrounits,
    rateAmountCents: line.rateAmountCents,
    jurisdictionCode: line.jurisdictionCode,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

function paymentResponse(payment: PayrollPayment): PayrollPaymentResponse {
  return {
    id: payment.id,
    payrollRunWorkerId: payment.payrollRunWorkerId,
    amountCents: payment.amountCents,
    currency: payment.currency,
    paymentDate: payment.paymentDate,
    methodType: payment.methodType,
    methodLabel: payment.methodLabel,
    institutionName: payment.institutionName,
    maskedLast4: payment.maskedLast4,
    externalConfirmationRef: payment.externalConfirmationRef,
    status: payment.status as PaymentProcessingStatus,
    processedAt: payment.processedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function externalRefResponse(ref: ExternalRecordRef): PayrollExternalRefResponse {
  return {
    id: ref.id,
    entityType: ref.entityType as PayrollExternalRefEntityType,
    entityId: ref.entityId,
    sourceType: ref.sourceType as FinanceSourceType,
    sourceVendorId: ref.sourceVendorId,
    sourceNamespace: ref.sourceNamespace,
    externalRecordType: ref.externalRecordType,
    externalRecordId: ref.externalRecordId,
    importedAt: ref.importedAt,
    payloadHash: ref.payloadHash,
    status: ref.status,
    createdAt: ref.createdAt,
  };
}

function derivePaymentSummary(workerResult: Pick<PayrollRunWorker, "netPayCents">, payments: PayrollPayment[]): PayrollPaymentSummary {
  let clearedPaymentCents = 0;
  let inFlightPaymentCents = 0;
  let pendingPaymentCents = 0;
  let failedAttemptCents = 0;
  let reversedPaymentCents = 0;
  let voidedPaymentCents = 0;

  for (const payment of payments) {
    if ((PAYROLL_PAYMENT_SETTLED_STATUSES as readonly string[]).includes(payment.status)) {
      clearedPaymentCents += payment.amountCents;
    } else if ((PAYROLL_PAYMENT_IN_FLIGHT_STATUSES as readonly string[]).includes(payment.status)) {
      inFlightPaymentCents += payment.amountCents;
    } else {
      switch (payment.status) {
        case "pending":
          pendingPaymentCents += payment.amountCents;
          break;
        case "failed":
          failedAttemptCents += payment.amountCents;
          break;
        case "reversed":
          reversedPaymentCents += payment.amountCents;
          break;
        case "voided":
          voidedPaymentCents += payment.amountCents;
          break;
      }
    }
  }

  const effectivePaidCents = clearedPaymentCents;
  const remainingNetPayCents = Math.max(0, workerResult.netPayCents - clearedPaymentCents);
  const overpaidNetPayCents = Math.max(0, clearedPaymentCents - workerResult.netPayCents);
  let state: PayrollPaymentSettlementState = "unpaid";
  if (clearedPaymentCents > workerResult.netPayCents) {
    state = "overpaid";
  } else if (workerResult.netPayCents === 0) {
    state = "not_payable";
  } else if (clearedPaymentCents === workerResult.netPayCents) {
    state = "paid";
  } else if (clearedPaymentCents > 0) {
    state = "partially_paid";
  } else if (failedAttemptCents > 0 && (pendingPaymentCents > 0 || inFlightPaymentCents > 0)) {
    state = "mixed";
  } else if (failedAttemptCents > 0) {
    state = "failed";
  }

  return {
    targetNetPayCents: workerResult.netPayCents,
    effectivePaidCents,
    clearedPaymentCents,
    inFlightPaymentCents,
    pendingPaymentCents,
    failedAttemptCents,
    reversedPaymentCents,
    voidedPaymentCents,
    remainingNetPayCents,
    overpaidNetPayCents,
    state,
  };
}

function lineTotalsByCurrency(lines: PayrollResultLine[]): PayrollResultLineTotals[] {
  const grouped = new Map<string, PayrollResultLine[]>();
  for (const line of lines) {
    grouped.set(line.currency, [...(grouped.get(line.currency) ?? []), line]);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, currencyLines]) => ({
      currency,
      ...derivePayrollResultLineTotals(currencyLines.map((line) => ({
        lineCategory: line.lineCategory as PayrollResultLineCategory,
        amountCents: line.amountCents,
        amountEffect: line.amountEffect as AmountEffect,
      }))),
    }));
}

function emptyCurrencyTotals(currency: string): PayrollCurrencyTotals {
  return {
    currency,
    workerCount: 0,
    grossPayCents: 0,
    netPayCents: 0,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    deductionCents: 0,
    effectivePaidCents: 0,
    clearedPaymentCents: 0,
    inFlightPaymentCents: 0,
    pendingPaymentCents: 0,
    failedAttemptCents: 0,
    unpaidNetPayCents: 0,
    overpaidNetPayCents: 0,
  };
}

function totalsByCurrency(workers: PayrollRunWorker[], paymentsByWorker: Map<number, PayrollPayment[]>): PayrollCurrencyTotals[] {
  const grouped = new Map<string, PayrollCurrencyTotals>();
  for (const worker of workers) {
    const totals = grouped.get(worker.currency) ?? emptyCurrencyTotals(worker.currency);
    const paymentSummary = derivePaymentSummary(worker, paymentsByWorker.get(worker.id) ?? []);
    totals.workerCount += 1;
    totals.grossPayCents += worker.grossPayCents;
    totals.netPayCents += worker.netPayCents;
    totals.employeeTaxCents += worker.employeeTaxCents;
    totals.employerTaxCents += worker.employerTaxCents;
    totals.deductionCents += worker.deductionCents;
    totals.effectivePaidCents += paymentSummary.effectivePaidCents;
    totals.clearedPaymentCents += paymentSummary.clearedPaymentCents;
    totals.inFlightPaymentCents += paymentSummary.inFlightPaymentCents;
    totals.pendingPaymentCents += paymentSummary.pendingPaymentCents;
    totals.failedAttemptCents += paymentSummary.failedAttemptCents;
    totals.unpaidNetPayCents += paymentSummary.remainingNetPayCents;
    totals.overpaidNetPayCents += paymentSummary.overpaidNetPayCents;
    grouped.set(worker.currency, totals);
  }
  return Array.from(grouped.values()).sort((left, right) => left.currency.localeCompare(right.currency));
}

function aggregateCurrencyTotals(items: PayrollRunListItem[]) {
  const grouped = new Map<string, PayrollCurrencyTotals>();
  for (const item of items) {
    for (const total of item.totalsByCurrency) {
      const existing = grouped.get(total.currency) ?? emptyCurrencyTotals(total.currency);
      existing.workerCount += total.workerCount;
      existing.grossPayCents += total.grossPayCents;
      existing.netPayCents += total.netPayCents;
      existing.employeeTaxCents += total.employeeTaxCents;
      existing.employerTaxCents += total.employerTaxCents;
      existing.deductionCents += total.deductionCents;
      existing.effectivePaidCents += total.effectivePaidCents;
      existing.clearedPaymentCents += total.clearedPaymentCents;
      existing.inFlightPaymentCents += total.inFlightPaymentCents;
      existing.pendingPaymentCents += total.pendingPaymentCents;
      existing.failedAttemptCents += total.failedAttemptCents;
      existing.unpaidNetPayCents += total.unpaidNetPayCents;
      existing.overpaidNetPayCents += total.overpaidNetPayCents;
      grouped.set(total.currency, existing);
    }
  }
  return Array.from(grouped.values()).sort((left, right) => left.currency.localeCompare(right.currency));
}

function runPaymentStates(workers: PayrollRunWorker[], paymentsByWorker: Map<number, PayrollPayment[]>) {
  const counts: Record<PayrollPaymentSettlementState, number> = {
    not_payable: 0,
    unpaid: 0,
    partially_paid: 0,
    paid: 0,
    overpaid: 0,
    failed: 0,
    mixed: 0,
  };
  for (const worker of workers) {
    counts[derivePaymentSummary(worker, paymentsByWorker.get(worker.id) ?? []).state] += 1;
  }
  return counts;
}

async function paymentsByWorkerId(repo: PayrollRepository, workerIds: number[]) {
  const payments = await repo.listPayrollPaymentsForWorkers(workerIds);
  const grouped = new Map<number, PayrollPayment[]>();
  for (const payment of payments) {
    grouped.set(payment.payrollRunWorkerId, [...(grouped.get(payment.payrollRunWorkerId) ?? []), payment]);
  }
  return grouped;
}

function payrollRunSortValue(value: string | Date | null | undefined) {
  return dateOnly(value) ?? "";
}

function sortPayrollRuns(runs: PayrollRun[]) {
  return [...runs].sort((left, right) => {
    const payDate = payrollRunSortValue(right.payDate).localeCompare(payrollRunSortValue(left.payDate));
    if (payDate !== 0) return payDate;
    const periodEnd = payrollRunSortValue(right.periodEnd).localeCompare(payrollRunSortValue(left.periodEnd));
    if (periodEnd !== 0) return periodEnd;
    return right.id - left.id;
  });
}

async function resolveEffectivePayrollRun(repo: PayrollRepository, run: PayrollRun) {
  let current = run;
  const visited = new Set<number>();

  while (true) {
    if (visited.has(current.id)) {
      fail(500, "PAYROLL_CORRECTION_CYCLE", "Payroll correction lineage cannot form a cycle.");
    }
    visited.add(current.id);

    const successor = await repo.findPayrollCorrectionSuccessor(current.id);
    if (!successor || successor.status !== "finalized") {
      return current;
    }
    current = successor;
  }
}

async function effectivePayrollRunsForTotals(repo: PayrollRepository, historicalRuns: PayrollRun[]) {
  const effectiveRuns = new Map<number, PayrollRun>();
  for (const run of historicalRuns) {
    if (run.status !== "finalized") continue;
    const effectiveRun = await resolveEffectivePayrollRun(repo, run);
    if (effectiveRun.status === "finalized") {
      effectiveRuns.set(effectiveRun.id, effectiveRun);
    }
  }
  return sortPayrollRuns(Array.from(effectiveRuns.values()));
}

async function runListItem(repo: PayrollRepository, run: PayrollRun): Promise<PayrollRunListItem> {
  const entity = await repo.getLegalEntity(run.legalEntityId);
  const vendor = run.sourceVendorId ? await repo.getVendor(run.sourceVendorId) : undefined;
  const workers = await repo.listPayrollRunWorkers(run.id);
  const payments = await paymentsByWorkerId(repo, workers.map((worker) => worker.id));
  return {
    id: run.id,
    legalEntityId: run.legalEntityId,
    legalEntity: legalEntitySummary(entity),
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    runKind: run.runKind as PayrollRunKind,
    sourceType: run.sourceType as FinanceSourceType,
    sourceVendorId: run.sourceVendorId,
    sourceVendor: vendorSummary(vendor),
    correctionOfPayrollRunId: run.correctionOfPayrollRunId,
    status: run.status as PayrollRunStatus,
    finalizedAt: run.finalizedAt,
    finalizedBy: run.finalizedBy,
    notes: run.notes,
    workerCount: workers.length,
    totalsByCurrency: totalsByCurrency(workers, payments),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

async function runWorkerResponse(
  repo: PayrollRepository,
  workerResult: PayrollRunWorker,
): Promise<PayrollRunWorkerResponse> {
  const worker = await repo.getWorker(workerResult.workerId);
  const employment = await repo.getEmployment(workerResult.employmentId);
  const lines = await repo.listPayrollResultLines(workerResult.id);
  const payments = await repo.listPayrollPayments(workerResult.id);
  return {
    id: workerResult.id,
    payrollRunId: workerResult.payrollRunId,
    workerId: workerResult.workerId,
    employmentId: workerResult.employmentId,
    worker: workerSummary(worker),
    employment: await employmentSummary(repo, employment),
    currency: workerResult.currency,
    grossPayCents: workerResult.grossPayCents,
    employeeTaxCents: workerResult.employeeTaxCents,
    employerTaxCents: workerResult.employerTaxCents,
    deductionCents: workerResult.deductionCents,
    netPayCents: workerResult.netPayCents,
    lineTotalsByCurrency: lineTotalsByCurrency(lines),
    paymentSummary: derivePaymentSummary(workerResult, payments),
    resultLines: lines.map(lineResponse),
    payments: payments.map(paymentResponse),
    createdAt: workerResult.createdAt,
    updatedAt: workerResult.updatedAt,
  };
}

async function runDetailResponse(repo: PayrollRepository, run: PayrollRun): Promise<PayrollRunDetailResponse> {
  const item = await runListItem(repo, run);
  const workers = await repo.listPayrollRunWorkers(run.id);
  const externalRefs = await repo.listExternalRecordRefsForEntity("payroll_runs", run.id);
  const workerResponses: PayrollRunWorkerResponse[] = [];
  for (const worker of workers) {
    workerResponses.push(await runWorkerResponse(repo, worker));
  }
  return {
    ...item,
    workers: workerResponses,
    externalRefs: externalRefs.map(externalRefResponse),
  };
}

function assertRunExists(run: PayrollRun | undefined, id: number): PayrollRun {
  if (!run) {
    fail(404, "PAYROLL_RUN_NOT_FOUND", `Payroll run ${id} was not found.`);
  }
  return run;
}

function assertRunWorkerExists(worker: PayrollRunWorker | undefined, id: number): PayrollRunWorker {
  if (!worker) {
    fail(404, "PAYROLL_RUN_WORKER_NOT_FOUND", `Payroll worker result ${id} was not found.`);
  }
  return worker;
}

function assertResultLineExists(line: PayrollResultLine | undefined, id: number): PayrollResultLine {
  if (!line) {
    fail(404, "PAYROLL_RESULT_LINE_NOT_FOUND", `Payroll result line ${id} was not found.`);
  }
  return line;
}

function assertPaymentExists(payment: PayrollPayment | undefined, id: number): PayrollPayment {
  if (!payment) {
    fail(404, "PAYROLL_PAYMENT_NOT_FOUND", `Payroll payment ${id} was not found.`);
  }
  return payment;
}

async function assertLegalEntity(repo: PayrollRepository, id: number) {
  const entity = await repo.getLegalEntity(id);
  if (!entity) {
    fail(400, "LEGAL_ENTITY_NOT_FOUND", `Legal entity ${id} was not found.`);
  }
  if (entity.status !== "active") {
    fail(400, "LEGAL_ENTITY_INACTIVE", "Payroll run legal entity must be active.");
  }
  return entity;
}

async function assertSourceVendor(repo: PayrollRepository, sourceType: string, sourceVendorId?: number | null) {
  if (sourceType === "provider" && !sourceVendorId) {
    fail(400, "PAYROLL_PROVIDER_VENDOR_REQUIRED", "Provider payroll records require a source vendor.");
  }
  if (!sourceVendorId) return null;
  const vendor = await repo.getVendor(sourceVendorId);
  if (!vendor) {
    fail(400, "PAYROLL_SOURCE_VENDOR_NOT_FOUND", `Source vendor ${sourceVendorId} was not found.`);
  }
  if (vendor.status === "archived") {
    fail(400, "PAYROLL_SOURCE_VENDOR_ARCHIVED", "Archived vendors cannot be used as payroll sources.");
  }
  return vendor;
}

function assertDraftOutputEditable(run: PayrollRun) {
  if (run.status !== "draft") {
    fail(400, "PAYROLL_OUTPUT_LOCKED", "Payroll worker results and lines can only be changed while the run is draft.");
  }
}

function assertPaymentCurrencyMatchesWorker(workerResult: PayrollRunWorker, currency: string) {
  if (workerResult.currency !== currency) {
    fail(400, "PAYROLL_PAYMENT_CURRENCY_MISMATCH", "Payroll payment currency must match the worker result currency.");
  }
}

function assertLineCurrencyMatchesWorker(workerResult: PayrollRunWorker, currency: string) {
  if (workerResult.currency !== currency) {
    fail(400, "PAYROLL_LINE_CURRENCY_MISMATCH", "Payroll result line currency must match the worker result currency.");
  }
}

function assertPayrollWorkerIdentity(worker: Worker | undefined, workerId: number) {
  if (!worker) {
    fail(400, "WORKER_NOT_FOUND", `Worker ${workerId} was not found.`);
  }
  if (worker.voidedAt || worker.mergedAt) {
    fail(400, "WORKER_NOT_USABLE_FOR_PAYROLL", "Voided or merged workers cannot be used for payroll results.");
  }
}

function payrollPeriodOverlapsEmployment(run: PayrollRun, employment: Employment) {
  const start = dateOnly(employment.startDate);
  const end = dateOnly(employment.endDate);
  const periodStart = dateOnly(run.periodStart);
  const periodEnd = dateOnly(run.periodEnd);
  if (!start || !periodStart || !periodEnd) return false;
  return start <= periodEnd && (!end || end >= periodStart);
}

function assertEmploymentTiming(run: PayrollRun, employment: Employment) {
  const employmentStart = dateOnly(employment.startDate);
  const runPayDate = dateOnly(run.payDate);
  if (!employmentStart || !runPayDate || employmentStart > runPayDate) {
    fail(400, "PAYROLL_EMPLOYMENT_TIMING_MISMATCH", "Employment must have started on or before the payroll pay date.");
  }

  if (run.runKind === "regular" && !payrollPeriodOverlapsEmployment(run, employment)) {
    fail(
      400,
      "PAYROLL_EMPLOYMENT_PERIOD_MISMATCH",
      "Regular payroll requires employment dates to overlap the payroll period.",
    );
  }
}

function assertEmploymentParticipation(run: PayrollRun, employment: Employment) {
  if (run.runKind === "correction") return;
  if (employment.status === "draft" || employment.status === "voided") {
    fail(400, "PAYROLL_EMPLOYMENT_NOT_COMMITTED", "Payroll results require a committed employment record.");
  }
  if (
    (employment.status === "active" || employment.status === "on_leave")
    && !["eligible", "active"].includes(employment.payrollParticipation)
  ) {
    fail(
      400,
      "PAYROLL_PARTICIPATION_NOT_READY",
      "Active payroll employment must be eligible or active for ordinary payroll results.",
    );
  }
}

async function assertPayrollRunWorkerLinks(
  repo: PayrollRepository,
  run: PayrollRun,
  payload: Pick<CreatePayrollRunWorkerPayload, "workerId" | "employmentId">,
) {
  const worker = await repo.getWorker(payload.workerId);
  const employment = await repo.getEmployment(payload.employmentId);
  assertPayrollWorkerIdentity(worker, payload.workerId);
  if (!employment) {
    fail(400, "EMPLOYMENT_NOT_FOUND", `Employment ${payload.employmentId} was not found.`);
  }

  runFinanceDomainValidation(() => validatePayrollRunWorkerConsistency({
    payrollRun: run,
    employment,
    workerId: payload.workerId,
  }));
  assertEmploymentTiming(run, employment);
  assertEmploymentParticipation(run, employment);
}

async function assertRunReadyForFinalization(repo: PayrollRepository, run: PayrollRun) {
  const workerResults = await repo.listPayrollRunWorkers(run.id);
  for (const workerResult of workerResults) {
    const worker = await repo.getWorker(workerResult.workerId);
    const employment = await repo.getEmployment(workerResult.employmentId);
    const lines = await repo.listPayrollResultLines(workerResult.id);
    assertPayrollWorkerIdentity(worker, workerResult.workerId);
    if (!employment) {
      fail(400, "EMPLOYMENT_NOT_FOUND", `Employment ${workerResult.employmentId} was not found.`);
    }
    runFinanceDomainValidation(() => validatePayrollRunWorkerConsistency({
      payrollRun: run,
      employment,
      workerId: workerResult.workerId,
    }));
    assertEmploymentTiming(run, employment);
    assertEmploymentParticipation(run, employment);
    for (const line of lines) {
      assertLineCurrencyMatchesWorker(workerResult, line.currency);
    }
  }
}

async function assertPayrollCorrectionTarget(repo: PayrollRepository, targetRunId: number) {
  const targetRun = assertRunExists(await repo.getPayrollRun(targetRunId), targetRunId);
  const visited = new Set<number>();
  let current: PayrollRun | undefined = targetRun;
  while (current) {
    if (visited.has(current.id)) {
      fail(400, "PAYROLL_CORRECTION_CYCLE", "Payroll correction lineage cannot form a cycle.");
    }
    visited.add(current.id);
    current = current.correctionOfPayrollRunId
      ? await repo.getPayrollRun(current.correctionOfPayrollRunId)
      : undefined;
  }

  if (targetRun.status !== "finalized") {
    fail(400, "PAYROLL_CORRECTION_REQUIRES_FINALIZED_ORIGINAL", "A correction can only target a finalized payroll run.");
  }
  const existingSuccessor = await repo.findPayrollCorrectionSuccessor(targetRun.id);
  if (existingSuccessor) {
    fail(
      409,
      "PAYROLL_CORRECTION_BRANCHING_NOT_SUPPORTED",
      "Payroll correction runs form one successor chain; create the next correction from the latest correction run.",
    );
  }
  return targetRun;
}

function ensureReviewedPatchIsNotesOnly(run: PayrollRun, payload: UpdatePayrollRunPayload) {
  if (run.status !== "reviewed") return;
  const forbidden = Object.keys(payload).filter((key) => key !== "notes" && key !== "actorAdminId");
  if (forbidden.length > 0) {
    fail(400, "PAYROLL_REVIEWED_FIELD_IMMUTABLE", "Reviewed payroll runs only allow notes changes before finalization.");
  }
}

function initialPaymentProcessedAt(payload: CreatePayrollPaymentPayload) {
  if (payload.processedAt) return payload.processedAt;
  return payload.status === "pending" ? null : new Date();
}

function transitionPaymentStatus(existing: PayrollPayment, target: PayrollPaymentTransitionPayload["status"]) {
  if (existing.status === target) return target;
  switch (existing.status) {
    case "pending":
      if (["sent", "failed", "voided"].includes(target)) return target;
      break;
    case "sent":
      if (["cleared", "failed"].includes(target)) return target;
      break;
    case "failed":
    case "cleared":
    case "reversed":
    case "voided":
      break;
  }
  fail(400, "PAYROLL_PAYMENT_TRANSITION_INVALID", `Cannot transition payroll payment from ${existing.status} to ${target}.`);
}

function paymentDateForTransition(existing: PayrollPayment, input: PayrollPaymentTransitionPayload) {
  if (input.paymentDate === undefined) return undefined;
  if (existing.status !== "pending" && dateOnly(input.paymentDate) !== dateOnly(existing.paymentDate)) {
    fail(400, "PAYROLL_PAYMENT_HISTORICAL_IMMUTABLE", "Sent or cleared payroll payment dates cannot be rewritten during settlement transitions.");
  }
  return input.paymentDate;
}

function assertPayrollExternalRefEntityType(entityType: string): asserts entityType is PayrollExternalRefEntityType {
  if (!PAYROLL_EXTERNAL_REF_ENTITY_TYPES.includes(entityType as PayrollExternalRefEntityType)) {
    fail(400, "PAYROLL_EXTERNAL_REF_ENTITY_TYPE_UNSUPPORTED", "Unsupported payroll external reference entity type.");
  }
}

async function assertExternalRefTarget(repo: PayrollRepository, entityType: string, entityId: number) {
  assertPayrollExternalRefEntityType(entityType);
  switch (entityType) {
    case "payroll_runs":
      assertRunExists(await repo.getPayrollRun(entityId), entityId);
      return;
    case "payroll_run_workers":
      assertRunWorkerExists(await repo.getPayrollRunWorker(entityId), entityId);
      return;
    case "payroll_result_lines":
      assertResultLineExists(await repo.getPayrollResultLine(entityId), entityId);
      return;
    case "payroll_payments":
      assertPaymentExists(await repo.getPayrollPayment(entityId), entityId);
      return;
  }
}

export async function listPayrollLegalEntities(repo: PayrollRepository) {
  return await repo.listLegalEntities();
}

export async function listPayrollVendors(repo: PayrollRepository) {
  return (await repo.listPayrollVendors()).map(vendorSummary).filter(Boolean) as PayrollVendorSummary[];
}

export async function listPayrollEmploymentOptions(
  repo: PayrollRepository,
  filters: PayrollEmploymentOptionFilters,
): Promise<PayrollEmploymentOption[]> {
  const employments = await repo.listPayrollEmploymentOptions(filters);
  const options: PayrollEmploymentOption[] = [];
  for (const employment of employments) {
    const worker = await repo.getWorker(employment.workerId);
    const employmentItem = await employmentSummary(repo, employment);
    if (worker && employmentItem) {
      options.push({
        employment: employmentItem,
        worker: workerSummary(worker)!,
      });
    }
  }
  return options;
}

export async function listPayrollRuns(
  repo: PayrollRepository,
  filters: PayrollRunListFilters,
): Promise<PayrollRunListItem[]> {
  const runs = await repo.listPayrollRuns(filters);
  const items: PayrollRunListItem[] = [];
  for (const run of runs) {
    items.push(await runListItem(repo, run));
  }
  return items;
}

export async function getPayrollOverview(repo: PayrollRepository): Promise<PayrollOverviewResponse> {
  const recentRunRows = await repo.listPayrollRuns({ pageSize: 25 });
  const recentRuns: PayrollRunListItem[] = [];
  for (const run of recentRunRows) {
    recentRuns.push(await runListItem(repo, run));
  }
  const effectiveRunRows = await effectivePayrollRunsForTotals(repo, recentRunRows);
  const effectiveRuns: PayrollRunListItem[] = [];
  for (const run of effectiveRunRows) {
    effectiveRuns.push(await runListItem(repo, run));
  }
  const allRunWorkers = await repo.listPayrollRunWorkersForRuns(effectiveRunRows.map((run) => run.id));
  const draftRuns = recentRuns.filter((run) => run.status === "draft" || run.status === "reviewed");
  const allPayments = await paymentsByWorkerId(repo, allRunWorkers.map((worker) => worker.id));
  return {
    recentRuns,
    draftRuns,
    effectiveRuns,
    totalsByCurrency: aggregateCurrencyTotals(effectiveRuns),
    runPaymentStates: runPaymentStates(allRunWorkers, allPayments),
  };
}

export async function getPayrollRun(
  repo: PayrollRepository,
  runId: number,
): Promise<PayrollRunDetailResponse> {
  return runDetailResponse(repo, assertRunExists(await repo.getPayrollRun(runId), runId));
}

export async function createPayrollRun(
  repo: PayrollRepository,
  input: CreatePayrollRunPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockLegalEntity(input.legalEntityId);
    await assertLegalEntity(tx, input.legalEntityId);
    await assertSourceVendor(tx, input.sourceType, input.sourceVendorId);

    const run = await tx.createPayrollRun({
      legalEntityId: input.legalEntityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      runKind: input.runKind,
      sourceType: input.sourceType,
      sourceVendorId: input.sourceVendorId ?? null,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_run",
      entityId: run.id,
      action: "created",
      changes: auditChanges(null, run, PAYROLL_RUN_AUDIT_FIELDS),
    });
    return runDetailResponse(tx, run);
  });
}

export async function createPayrollCorrectionRun(
  repo: PayrollRepository,
  input: CreatePayrollCorrectionRunPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRun(input.correctionOfPayrollRunId);
    const originalRun = await assertPayrollCorrectionTarget(tx, input.correctionOfPayrollRunId);
    await tx.lockLegalEntity(originalRun.legalEntityId);
    await assertSourceVendor(tx, input.sourceType, input.sourceVendorId);

    const draftCorrection = await tx.createPayrollRun({
      legalEntityId: originalRun.legalEntityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      runKind: "correction",
      sourceType: input.sourceType,
      sourceVendorId: input.sourceVendorId ?? null,
      correctionOfPayrollRunId: originalRun.id,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });

    runFinanceDomainValidation(() => validatePayrollCorrectionRun({
      correctionRun: draftCorrection,
      originalRun,
      ancestorPayrollRunIds: [],
    }));

    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_run",
      entityId: draftCorrection.id,
      action: "correction_created",
      changes: auditChanges(null, draftCorrection, PAYROLL_RUN_AUDIT_FIELDS),
    });
    return runDetailResponse(tx, draftCorrection);
  });
}

export async function updatePayrollRun(
  repo: PayrollRepository,
  runId: number,
  input: UpdatePayrollRunPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRun(runId);
    const existing = assertRunExists(await tx.getPayrollRun(runId), runId);
    if (existing.status === "finalized") {
      fail(400, "PAYROLL_RUN_FINALIZED", "Finalized payroll runs cannot be edited in place.");
    }
    ensureReviewedPatchIsNotesOnly(existing, input);

    const workerRows = await tx.listPayrollRunWorkers(existing.id);
    if (input.legalEntityId && input.legalEntityId !== existing.legalEntityId && workerRows.length > 0) {
      fail(400, "PAYROLL_RUN_LEGAL_ENTITY_HAS_RESULTS", "Remove payroll worker results before changing the run legal entity.");
    }
    if (input.legalEntityId) {
      await tx.lockLegalEntity(input.legalEntityId);
      await assertLegalEntity(tx, input.legalEntityId);
    }
    await assertSourceVendor(tx, input.sourceType ?? existing.sourceType, input.sourceVendorId ?? existing.sourceVendorId);

    const updated = assertRunExists(await tx.updatePayrollRun(existing.id, {
      legalEntityId: input.legalEntityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      sourceType: input.sourceType,
      sourceVendorId: input.sourceVendorId,
      notes: input.notes,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_run",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, PAYROLL_RUN_AUDIT_FIELDS),
    });
    return runDetailResponse(tx, updated);
  });
}

export async function markPayrollRunReviewed(repo: PayrollRepository, runId: number, actorAdminId: number) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRun(runId);
    const existing = assertRunExists(await tx.getPayrollRun(runId), runId);
    if (existing.status !== "draft") {
      fail(400, "PAYROLL_RUN_REVIEW_INVALID", "Only draft payroll runs can be marked reviewed.");
    }
    const updated = assertRunExists(await tx.updatePayrollRun(existing.id, { status: "reviewed" }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId,
      entityType: "payroll_run",
      entityId: updated.id,
      action: "reviewed",
      changes: auditChanges(existing, updated, PAYROLL_RUN_AUDIT_FIELDS),
    });
    return runDetailResponse(tx, updated);
  });
}

export async function finalizePayrollRun(repo: PayrollRepository, runId: number, actorAdminId: number, now = new Date()) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRun(runId);
    const existing = assertRunExists(await tx.getPayrollRun(runId), runId);
    if (existing.status !== "reviewed") {
      fail(400, "PAYROLL_RUN_FINALIZE_INVALID", "Payroll runs must be reviewed before finalization.");
    }
    await assertRunReadyForFinalization(tx, existing);
    const updated = assertRunExists(await tx.updatePayrollRun(existing.id, {
      status: "finalized",
      finalizedAt: now,
      finalizedBy: actorAdminId,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId,
      entityType: "payroll_run",
      entityId: updated.id,
      action: "finalized",
      changes: auditChanges(existing, updated, PAYROLL_RUN_AUDIT_FIELDS),
    });
    return runDetailResponse(tx, updated);
  });
}

export async function addPayrollRunWorker(
  repo: PayrollRepository,
  runId: number,
  input: CreatePayrollRunWorkerPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRun(runId);
    await tx.lockWorker(input.workerId);
    await tx.lockEmployment(input.employmentId);
    const run = assertRunExists(await tx.getPayrollRun(runId), runId);
    assertDraftOutputEditable(run);
    await assertPayrollRunWorkerLinks(tx, run, input);
    if (await tx.findPayrollRunWorkerByRunEmployment(run.id, input.employmentId)) {
      fail(409, "PAYROLL_RUN_WORKER_DUPLICATE", "This employment already has a result in the payroll run.");
    }
    const workerResult = await tx.createPayrollRunWorker({
      payrollRunId: run.id,
      workerId: input.workerId,
      employmentId: input.employmentId,
      currency: input.currency,
      grossPayCents: input.grossPayCents,
      employeeTaxCents: input.employeeTaxCents,
      employerTaxCents: input.employerTaxCents,
      deductionCents: input.deductionCents,
      netPayCents: input.netPayCents,
      sourceMetadata: input.sourceMetadata,
    });
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_run_worker",
      entityId: workerResult.id,
      action: "created",
      changes: auditChanges(null, workerResult, PAYROLL_RUN_WORKER_AUDIT_FIELDS),
    });
    return runWorkerResponse(tx, workerResult);
  });
}

export async function updatePayrollRunWorker(
  repo: PayrollRepository,
  runWorkerId: number,
  input: UpdatePayrollRunWorkerPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRunWorker(runWorkerId);
    const existing = assertRunWorkerExists(await tx.getPayrollRunWorker(runWorkerId), runWorkerId);
    await tx.lockPayrollRun(existing.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(existing.payrollRunId), existing.payrollRunId);
    assertDraftOutputEditable(run);
    const updatedCurrency = input.currency ?? existing.currency;
    const lines = await tx.listPayrollResultLines(existing.id);
    if (input.currency && lines.some((line) => line.currency !== updatedCurrency)) {
      fail(400, "PAYROLL_WORKER_CURRENCY_HAS_LINES", "Payroll result line currencies must match the worker result currency.");
    }

    const updated = assertRunWorkerExists(await tx.updatePayrollRunWorker(existing.id, {
      currency: input.currency,
      grossPayCents: input.grossPayCents,
      employeeTaxCents: input.employeeTaxCents,
      employerTaxCents: input.employerTaxCents,
      deductionCents: input.deductionCents,
      netPayCents: input.netPayCents,
      sourceMetadata: input.sourceMetadata,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_run_worker",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, PAYROLL_RUN_WORKER_AUDIT_FIELDS),
    });
    return runWorkerResponse(tx, updated);
  });
}

export async function removePayrollRunWorker(repo: PayrollRepository, runWorkerId: number, actorAdminId: number) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRunWorker(runWorkerId);
    const existing = assertRunWorkerExists(await tx.getPayrollRunWorker(runWorkerId), runWorkerId);
    await tx.lockPayrollRun(existing.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(existing.payrollRunId), existing.payrollRunId);
    assertDraftOutputEditable(run);
    const payments = await tx.listPayrollPayments(existing.id);
    if (payments.length > 0) {
      fail(400, "PAYROLL_RUN_WORKER_HAS_PAYMENTS", "Payroll worker results with payment records cannot be removed.");
    }
    await tx.deletePayrollResultLinesForWorker(existing.id);
    await tx.deletePayrollRunWorker(existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId,
      entityType: "payroll_run_worker",
      entityId: existing.id,
      action: "removed",
      changes: {
        ...auditChanges(existing, existing, PAYROLL_RUN_WORKER_AUDIT_FIELDS),
        removed: { before: false, after: true },
      },
    });
    return { removed: true, id: existing.id };
  });
}

export async function addPayrollResultLine(
  repo: PayrollRepository,
  runWorkerId: number,
  input: CreatePayrollResultLinePayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRunWorker(runWorkerId);
    const workerResult = assertRunWorkerExists(await tx.getPayrollRunWorker(runWorkerId), runWorkerId);
    await tx.lockPayrollRun(workerResult.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(workerResult.payrollRunId), workerResult.payrollRunId);
    assertDraftOutputEditable(run);
    assertLineCurrencyMatchesWorker(workerResult, input.currency);
    const line = await tx.createPayrollResultLine({
      payrollRunWorkerId: workerResult.id,
      lineCategory: input.lineCategory,
      lineCode: input.lineCode,
      description: input.description ?? null,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency: input.currency,
      quantityMicrounits: input.quantityMicrounits ?? null,
      rateAmountCents: input.rateAmountCents ?? null,
      jurisdictionCode: input.jurisdictionCode ?? null,
      metadata: input.metadata,
    });
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_result_line",
      entityId: line.id,
      action: "created",
      changes: auditChanges(null, line, PAYROLL_RESULT_LINE_AUDIT_FIELDS),
    });
    return lineResponse(line);
  });
}

export async function updatePayrollResultLine(
  repo: PayrollRepository,
  lineId: number,
  input: UpdatePayrollResultLinePayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollResultLine(lineId);
    const existing = assertResultLineExists(await tx.getPayrollResultLine(lineId), lineId);
    await tx.lockPayrollRunWorker(existing.payrollRunWorkerId);
    const workerResult = assertRunWorkerExists(await tx.getPayrollRunWorker(existing.payrollRunWorkerId), existing.payrollRunWorkerId);
    await tx.lockPayrollRun(workerResult.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(workerResult.payrollRunId), workerResult.payrollRunId);
    assertDraftOutputEditable(run);
    assertLineCurrencyMatchesWorker(workerResult, input.currency ?? existing.currency);
    const updated = assertResultLineExists(await tx.updatePayrollResultLine(existing.id, {
      lineCategory: input.lineCategory,
      lineCode: input.lineCode,
      description: input.description,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency: input.currency,
      quantityMicrounits: input.quantityMicrounits,
      rateAmountCents: input.rateAmountCents,
      jurisdictionCode: input.jurisdictionCode,
      metadata: input.metadata,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_result_line",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, PAYROLL_RESULT_LINE_AUDIT_FIELDS),
    });
    return lineResponse(updated);
  });
}

export async function removePayrollResultLine(repo: PayrollRepository, lineId: number, actorAdminId: number) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollResultLine(lineId);
    const existing = assertResultLineExists(await tx.getPayrollResultLine(lineId), lineId);
    await tx.lockPayrollRunWorker(existing.payrollRunWorkerId);
    const workerResult = assertRunWorkerExists(await tx.getPayrollRunWorker(existing.payrollRunWorkerId), existing.payrollRunWorkerId);
    await tx.lockPayrollRun(workerResult.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(workerResult.payrollRunId), workerResult.payrollRunId);
    assertDraftOutputEditable(run);
    await tx.deletePayrollResultLine(existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId,
      entityType: "payroll_result_line",
      entityId: existing.id,
      action: "removed",
      changes: {
        ...auditChanges(existing, existing, PAYROLL_RESULT_LINE_AUDIT_FIELDS),
        removed: { before: false, after: true },
      },
    });
    return { removed: true, id: existing.id };
  });
}

export async function recordPayrollPayment(
  repo: PayrollRepository,
  runWorkerId: number,
  input: CreatePayrollPaymentPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollRunWorker(runWorkerId);
    const workerResult = assertRunWorkerExists(await tx.getPayrollRunWorker(runWorkerId), runWorkerId);
    await tx.lockPayrollRun(workerResult.payrollRunId);
    const run = assertRunExists(await tx.getPayrollRun(workerResult.payrollRunId), workerResult.payrollRunId);
    if (run.status !== "finalized") {
      fail(400, "PAYROLL_PAYMENT_REQUIRES_FINALIZED_RUN", "Payroll payments can only be recorded for finalized payroll runs.");
    }
    assertPaymentCurrencyMatchesWorker(workerResult, input.currency);
    const payment = await tx.createPayrollPayment({
      payrollRunWorkerId: workerResult.id,
      amountCents: input.amountCents,
      currency: input.currency,
      paymentDate: input.paymentDate ?? null,
      methodType: input.methodType,
      methodLabel: input.methodLabel ?? null,
      institutionName: input.institutionName ?? null,
      maskedLast4: input.maskedLast4 ?? null,
      externalConfirmationRef: input.externalConfirmationRef ?? null,
      status: input.status,
      processedAt: initialPaymentProcessedAt(input),
      createdBy: input.actorAdminId,
    });
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_payment",
      entityId: payment.id,
      action: "recorded",
      changes: auditChanges(null, payment, PAYROLL_PAYMENT_AUDIT_FIELDS),
    });
    return paymentResponse(payment);
  });
}

export async function updatePayrollPayment(
  repo: PayrollRepository,
  paymentId: number,
  input: UpdatePayrollPaymentPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollPayment(paymentId);
    const existing = assertPaymentExists(await tx.getPayrollPayment(paymentId), paymentId);
    if (existing.status !== "pending") {
      fail(400, "PAYROLL_PAYMENT_HISTORICAL_IMMUTABLE", "Only pending payroll payments can be edited.");
    }
    await tx.lockPayrollRunWorker(existing.payrollRunWorkerId);
    const workerResult = assertRunWorkerExists(await tx.getPayrollRunWorker(existing.payrollRunWorkerId), existing.payrollRunWorkerId);
    assertPaymentCurrencyMatchesWorker(workerResult, input.currency ?? existing.currency);
    const updated = assertPaymentExists(await tx.updatePayrollPayment(existing.id, {
      amountCents: input.amountCents,
      currency: input.currency,
      paymentDate: input.paymentDate,
      methodType: input.methodType,
      methodLabel: input.methodLabel,
      institutionName: input.institutionName,
      maskedLast4: input.maskedLast4,
      externalConfirmationRef: input.externalConfirmationRef,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_payment",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, PAYROLL_PAYMENT_AUDIT_FIELDS),
    });
    return paymentResponse(updated);
  });
}

export async function transitionPayrollPayment(
  repo: PayrollRepository,
  paymentId: number,
  input: PayrollPaymentTransitionPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollPayment(paymentId);
    const existing = assertPaymentExists(await tx.getPayrollPayment(paymentId), paymentId);
    const status = transitionPaymentStatus(existing, input.status);
    const updated = assertPaymentExists(await tx.updatePayrollPayment(existing.id, {
      status,
      paymentDate: paymentDateForTransition(existing, input),
      processedAt: input.processedAt ?? new Date(),
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "payroll_payment",
      entityId: updated.id,
      action: status as PayrollAuditAction,
      changes: auditChanges(existing, updated, PAYROLL_PAYMENT_AUDIT_FIELDS),
    });
    return paymentResponse(updated);
  });
}

export async function reversePayrollPayment(
  repo: PayrollRepository,
  paymentId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return runPayrollTransaction(repo, async (tx) => {
    await tx.lockPayrollPayment(paymentId);
    const existing = assertPaymentExists(await tx.getPayrollPayment(paymentId), paymentId);
    if (!PAYROLL_PAYMENT_REVERSIBLE_STATUSES.includes(existing.status as "sent" | "cleared")) {
      fail(400, "PAYROLL_PAYMENT_REVERSAL_INVALID", "Only sent or cleared payroll payments can be reversed.");
    }
    const updated = assertPaymentExists(await tx.updatePayrollPayment(existing.id, {
      status: "reversed",
      processedAt: now,
    }), existing.id);
    await writePayrollAuditEvent(tx, {
      actorAdminId,
      entityType: "payroll_payment",
      entityId: updated.id,
      action: "reversed",
      changes: auditChanges(existing, updated, PAYROLL_PAYMENT_AUDIT_FIELDS),
    });
    return paymentResponse(updated);
  });
}

export async function createPayrollExternalRecordRef(
  repo: PayrollRepository,
  input: CreatePayrollExternalRefPayload & { actorAdminId: number },
) {
  return runPayrollTransaction(repo, async (tx) => {
    await assertSourceVendor(tx, input.sourceType, input.sourceVendorId);
    await assertExternalRefTarget(tx, input.entityType, input.entityId);
    const ref = await tx.createExternalRecordRef({
      entityType: input.entityType,
      entityId: input.entityId,
      sourceType: input.sourceType,
      sourceVendorId: input.sourceVendorId ?? null,
      sourceNamespace: input.sourceNamespace,
      externalRecordType: input.externalRecordType,
      externalRecordId: input.externalRecordId,
      importedAt: input.importedAt,
      payloadHash: input.payloadHash ?? null,
      metadata: input.metadata,
      status: input.status,
      createdBy: input.actorAdminId,
    });
    return externalRefResponse(ref);
  });
}
