import { z } from "zod";
import type {
  AmountEffect,
  ExternalRecordRef,
  FinanceSourceType,
  InsertExternalRecordRef,
  InsertTaxAgency,
  InsertTaxAuditEvent,
  InsertTaxFiling,
  InsertTaxLiability,
  InsertTaxRegistration,
  LegalEntity,
  TaxAgency,
  TaxAuditEvent,
  TaxFiling,
  TaxLiability,
  TaxRegistration,
  Vendor,
} from "@shared/schema";
import {
  FinanceDomainValidationError,
  deriveTaxLiabilityNetAmountCents,
  validateTaxFilingAmendment,
} from "./financeDomainValidation";

export class TaxServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaxServiceError";
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new TaxServiceError(statusCode, code, message);
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

const TAX_AGENCY_STATUSES = ["active", "inactive"] as const;
const TAX_REGISTRATION_STATUSES = ["pending", "active", "inactive", "closed"] as const;
const TAX_REGISTRATION_TRANSITION_STATUSES = ["active", "inactive", "closed"] as const;
const TAX_TYPES = [
  "federal_withholding",
  "social_security",
  "medicare",
  "futa",
  "state_withholding",
  "state_unemployment",
  "local_payroll",
  "other",
] as const;
const JURISDICTION_TYPES = ["federal", "state", "local", "foreign", "other"] as const;
const TAX_LIABILITY_COMPONENTS = [
  "withholding",
  "social_security",
  "medicare",
  "futa",
  "suta",
  "local_tax",
  "penalty",
  "interest",
  "adjustment",
  "other",
] as const;
const TAX_LIABILITY_STATUSES = ["draft", "recognized", "disputed", "voided"] as const;
const TAX_LIABILITY_EFFECTIVE_STATUSES = ["recognized", "disputed"] as const;
const TAX_LIABILITY_TRANSITION_STATUSES = ["recognized", "disputed", "voided"] as const;
const TAX_FILING_STATUSES = ["draft", "ready", "filed", "accepted", "rejected", "voided"] as const;
const TAX_FILING_TRANSITION_STATUSES = ["ready", "filed", "accepted", "rejected"] as const;
const TAX_SOURCE_TYPES = ["provider", "csv_import", "manual", "internal"] as const;
const AMOUNT_EFFECTS = ["increase", "decrease"] as const;
const TAX_EXTERNAL_REF_ENTITY_TYPES = [
  "tax_agencies",
  "tax_registrations",
  "tax_liabilities",
  "tax_filings",
] as const;
const EXTERNAL_RECORD_REF_STATUSES = ["active", "superseded", "voided"] as const;
const TAX_AUDIT_ENTITY_TYPES = [
  "tax_agency",
  "tax_registration",
  "tax_liability",
  "tax_filing",
] as const;
const TAX_AUDIT_ACTIONS = [
  "created",
  "updated",
  "activated",
  "deactivated",
  "closed",
  "recognized",
  "disputed",
  "voided",
  "adjustment_created",
  "ready",
  "filed",
  "accepted",
  "rejected",
  "amendment_created",
] as const;
const TAX_AGENCY_AUDIT_FIELDS = [
  "agencyCode",
  "name",
  "jurisdictionType",
  "jurisdictionCode",
  "status",
] as const;
const TAX_REGISTRATION_AUDIT_FIELDS = [
  "legalEntityId",
  "taxAgencyId",
  "taxType",
  "jurisdictionType",
  "jurisdictionCode",
  "maskedAccountRef",
  "effectiveFrom",
  "effectiveTo",
  "status",
] as const;
const TAX_LIABILITY_AUDIT_FIELDS = [
  "taxRegistrationId",
  "periodStart",
  "periodEnd",
  "dueDate",
  "component",
  "amountEffect",
  "amountCents",
  "currency",
  "sourceType",
  "adjustsTaxLiabilityId",
  "status",
  "recognizedAt",
] as const;
const TAX_FILING_AUDIT_FIELDS = [
  "taxRegistrationId",
  "filingType",
  "periodStart",
  "periodEnd",
  "dueDate",
  "filedAt",
  "acceptedAt",
  "confirmationRef",
  "amendsTaxFilingId",
  "status",
] as const;

const positiveIdSchema = z.coerce.number().int().positive();
const optionalIdSchema = z.preprocess(
  (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
  z.coerce.number().int().positive().nullable().optional(),
);
const amountCentsSchema = z.coerce.number().int().positive();
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

function refineDateOrder(
  startField: string,
  endField: string,
  message: string,
) {
  return (data: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const start = data[startField];
    const end = data[endField];
    if (typeof start === "string" && typeof end === "string" && end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [endField],
        message,
      });
    }
  };
}

const refinePeriodOrder = refineDateOrder("periodStart", "periodEnd", "Period end cannot be before period start.");
const refineEffectiveOrder = refineDateOrder("effectiveFrom", "effectiveTo", "Effective end cannot be before effective start.");

export const taxAgencyListQuerySchema = z.object({
  status: z.enum(["all", ...TAX_AGENCY_STATUSES]).default("all"),
  search: optionalText(200),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

export const taxRegistrationListQuerySchema = z.object({
  status: z.enum(["all", ...TAX_REGISTRATION_STATUSES]).default("all"),
  legalEntityId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  taxAgencyId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

export const taxLiabilityListQuerySchema = z.object({
  status: z.enum(["all", ...TAX_LIABILITY_STATUSES]).default("all"),
  taxRegistrationId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

export const taxFilingListQuerySchema = z.object({
  status: z.enum(["all", ...TAX_FILING_STATUSES]).default("all"),
  taxRegistrationId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

export const createTaxAgencyPayloadSchema = z.object({
  agencyCode: requiredText(80),
  name: requiredText(200),
  jurisdictionType: z.enum(JURISDICTION_TYPES),
  jurisdictionCode: requiredText(80).transform((value) => value.toUpperCase()),
  status: z.enum(TAX_AGENCY_STATUSES).default("active"),
}).strict();

export const updateTaxAgencyPayloadSchema = z
  .object({
    agencyCode: requiredText(80).optional(),
    name: requiredText(200).optional(),
    jurisdictionType: z.enum(JURISDICTION_TYPES).optional(),
    jurisdictionCode: requiredText(80).transform((value) => value.toUpperCase()).optional(),
    status: z.enum(TAX_AGENCY_STATUSES).optional(),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one tax agency field is required.");

export const createTaxRegistrationPayloadSchema = z
  .object({
    legalEntityId: positiveIdSchema,
    taxAgencyId: positiveIdSchema,
    taxType: z.enum(TAX_TYPES),
    jurisdictionType: z.enum(JURISDICTION_TYPES),
    jurisdictionCode: requiredText(80).transform((value) => value.toUpperCase()),
    maskedAccountRef: optionalText(120),
    effectiveFrom: optionalDateOnlySchema,
    effectiveTo: optionalDateOnlySchema,
    status: z.enum(["pending", "active"]).default("pending"),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refineEffectiveOrder);

export const updateTaxRegistrationPayloadSchema = z
  .object({
    legalEntityId: positiveIdSchema.optional(),
    taxAgencyId: positiveIdSchema.optional(),
    taxType: z.enum(TAX_TYPES).optional(),
    jurisdictionType: z.enum(JURISDICTION_TYPES).optional(),
    jurisdictionCode: requiredText(80).transform((value) => value.toUpperCase()).optional(),
    maskedAccountRef: optionalText(120),
    effectiveFrom: optionalDateOnlySchema,
    effectiveTo: optionalDateOnlySchema,
    notes: optionalText(4000),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one tax registration field is required.")
  .superRefine(refineEffectiveOrder);

export const taxRegistrationTransitionPayloadSchema = z.object({
  status: z.enum(TAX_REGISTRATION_TRANSITION_STATUSES),
}).strict();

export const createTaxLiabilityPayloadSchema = z
  .object({
    taxRegistrationId: positiveIdSchema,
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    dueDate: optionalDateOnlySchema,
    component: z.enum(TAX_LIABILITY_COMPONENTS),
    amountEffect: z.enum(AMOUNT_EFFECTS).default("increase"),
    amountCents: amountCentsSchema,
    currency: currencySchema.default("USD"),
    sourceType: z.enum(TAX_SOURCE_TYPES).default("manual"),
    sourceMetadata: metadataSchema,
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refinePeriodOrder);

export const updateTaxLiabilityPayloadSchema = z
  .object({
    taxRegistrationId: positiveIdSchema.optional(),
    periodStart: dateOnlySchema.optional(),
    periodEnd: dateOnlySchema.optional(),
    dueDate: optionalDateOnlySchema,
    component: z.enum(TAX_LIABILITY_COMPONENTS).optional(),
    amountEffect: z.enum(AMOUNT_EFFECTS).optional(),
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    sourceType: z.enum(TAX_SOURCE_TYPES).optional(),
    sourceMetadata: metadataSchema.optional(),
    notes: optionalText(4000),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one tax liability field is required.")
  .superRefine(refinePeriodOrder);

export const createTaxLiabilityAdjustmentPayloadSchema = z
  .object({
    taxRegistrationId: positiveIdSchema.optional(),
    periodStart: dateOnlySchema.optional(),
    periodEnd: dateOnlySchema.optional(),
    dueDate: optionalDateOnlySchema,
    component: z.enum(TAX_LIABILITY_COMPONENTS).default("adjustment"),
    amountEffect: z.enum(AMOUNT_EFFECTS),
    amountCents: amountCentsSchema,
    currency: currencySchema.default("USD"),
    sourceType: z.enum(TAX_SOURCE_TYPES).default("manual"),
    sourceMetadata: metadataSchema,
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refinePeriodOrder);

export const taxLiabilityTransitionPayloadSchema = z.object({
  status: z.enum(TAX_LIABILITY_TRANSITION_STATUSES),
}).strict();

export const createTaxFilingPayloadSchema = z
  .object({
    taxRegistrationId: positiveIdSchema,
    filingType: requiredText(120),
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    dueDate: optionalDateOnlySchema,
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refinePeriodOrder);

export const updateTaxFilingPayloadSchema = z
  .object({
    taxRegistrationId: positiveIdSchema.optional(),
    filingType: requiredText(120).optional(),
    periodStart: dateOnlySchema.optional(),
    periodEnd: dateOnlySchema.optional(),
    dueDate: optionalDateOnlySchema,
    notes: optionalText(4000),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one tax filing field is required.")
  .superRefine(refinePeriodOrder);

export const taxFilingTransitionPayloadSchema = z.object({
  status: z.enum(TAX_FILING_TRANSITION_STATUSES),
  filedAt: optionalTimestamp(),
  acceptedAt: optionalTimestamp(),
  confirmationRef: optionalText(200),
  notes: optionalText(4000),
}).strict();

export const createTaxFilingAmendmentPayloadSchema = z.object({
  dueDate: optionalDateOnlySchema,
  notes: optionalText(4000),
}).strict();

export const createTaxExternalRefPayloadSchema = z.object({
  entityType: z.enum(TAX_EXTERNAL_REF_ENTITY_TYPES),
  entityId: positiveIdSchema,
  sourceType: z.enum(TAX_SOURCE_TYPES),
  sourceVendorId: optionalIdSchema,
  sourceNamespace: requiredText(120).default("default"),
  externalRecordType: requiredText(120),
  externalRecordId: requiredText(300),
  importedAt: optionalTimestamp(),
  payloadHash: optionalText(128),
  metadata: metadataSchema,
  status: z.enum(EXTERNAL_RECORD_REF_STATUSES).default("active"),
}).strict();

export type TaxAgencyListQuery = z.infer<typeof taxAgencyListQuerySchema>;
export type TaxAgencyListFilters = Partial<TaxAgencyListQuery>;
export type TaxRegistrationListQuery = z.infer<typeof taxRegistrationListQuerySchema>;
export type TaxRegistrationListFilters = Partial<TaxRegistrationListQuery>;
export type TaxLiabilityListQuery = z.infer<typeof taxLiabilityListQuerySchema>;
export type TaxLiabilityListFilters = Partial<TaxLiabilityListQuery>;
export type TaxFilingListQuery = z.infer<typeof taxFilingListQuerySchema>;
export type TaxFilingListFilters = Partial<TaxFilingListQuery>;
export type CreateTaxAgencyPayload = z.infer<typeof createTaxAgencyPayloadSchema>;
export type UpdateTaxAgencyPayload = z.infer<typeof updateTaxAgencyPayloadSchema>;
export type CreateTaxRegistrationPayload = z.infer<typeof createTaxRegistrationPayloadSchema>;
export type UpdateTaxRegistrationPayload = z.infer<typeof updateTaxRegistrationPayloadSchema>;
export type TaxRegistrationTransitionPayload = z.infer<typeof taxRegistrationTransitionPayloadSchema>;
export type CreateTaxLiabilityPayload = z.infer<typeof createTaxLiabilityPayloadSchema>;
export type UpdateTaxLiabilityPayload = z.infer<typeof updateTaxLiabilityPayloadSchema>;
export type CreateTaxLiabilityAdjustmentPayload = z.infer<typeof createTaxLiabilityAdjustmentPayloadSchema>;
export type TaxLiabilityTransitionPayload = z.infer<typeof taxLiabilityTransitionPayloadSchema>;
export type CreateTaxFilingPayload = z.infer<typeof createTaxFilingPayloadSchema>;
export type UpdateTaxFilingPayload = z.infer<typeof updateTaxFilingPayloadSchema>;
export type TaxFilingTransitionPayload = z.infer<typeof taxFilingTransitionPayloadSchema>;
export type CreateTaxFilingAmendmentPayload = z.infer<typeof createTaxFilingAmendmentPayloadSchema>;
export type CreateTaxExternalRefPayload = z.infer<typeof createTaxExternalRefPayloadSchema>;

export interface TaxRegistrationOverlapCandidate {
  legalEntityId: number;
  taxAgencyId: number;
  taxType: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
  excludeRegistrationId?: number;
}

type TaxAuditEntityType = typeof TAX_AUDIT_ENTITY_TYPES[number];
type TaxAuditAction = typeof TAX_AUDIT_ACTIONS[number];
type TaxExternalRefEntityType = typeof TAX_EXTERNAL_REF_ENTITY_TYPES[number];
type TaxDueState = "none" | "not_due" | "due_soon" | "overdue" | "complete";

export interface TaxLegalEntitySummary {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
}

export interface TaxAgencyResponse {
  id: number;
  agencyCode: string;
  name: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  status: string;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface TaxRegistrationResponse {
  id: number;
  legalEntityId: number;
  legalEntity: TaxLegalEntitySummary | null;
  taxAgencyId: number;
  taxAgency: TaxAgencyResponse | null;
  taxType: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  maskedAccountRef: string | null;
  effectiveFrom: Date | string | null;
  effectiveTo: Date | string | null;
  status: string;
  dateState: "not_yet_effective" | "within_effective_dates" | "past_effective_dates" | "undated";
  notes: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface TaxCurrencyTotal {
  currency: string;
  amountCents: number;
  liabilityCount: number;
}

export interface TaxLiabilityResponse {
  id: number;
  taxRegistrationId: number;
  registration: TaxRegistrationResponse | null;
  periodStart: Date | string;
  periodEnd: Date | string;
  dueDate: Date | string | null;
  dueState: TaxDueState;
  component: string;
  amountEffect: AmountEffect;
  amountCents: number;
  signedAmountCents: number;
  effectiveAmountCents: number;
  currency: string;
  sourceType: FinanceSourceType;
  adjustsTaxLiabilityId: number | null;
  adjustmentCount: number;
  paymentTrackingStatus: "not_yet_tracked";
  status: string;
  recognizedAt: Date | string | null;
  notes: string | null;
  adjustments?: TaxLiabilityResponse[];
  externalRefs?: TaxExternalRefResponse[];
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface TaxFilingResponse {
  id: number;
  taxRegistrationId: number;
  registration: TaxRegistrationResponse | null;
  filingType: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  dueDate: Date | string | null;
  dueState: TaxDueState;
  filedAt: Date | string | null;
  acceptedAt: Date | string | null;
  confirmationRef: string | null;
  amendsTaxFilingId: number | null;
  status: string;
  notes: string | null;
  externalRefs?: TaxExternalRefResponse[];
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface TaxExternalRefResponse {
  id: number;
  entityType: TaxExternalRefEntityType;
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

export interface TaxOverviewResponse {
  businessDate: string;
  activeRegistrationCount: number;
  effectiveLiabilityTotalsByCurrency: TaxCurrencyTotal[];
  dueSoonLiabilityCount: number;
  overdueLiabilityCount: number;
  dueSoonFilingCount: number;
  overdueFilingCount: number;
  filingStatusCounts: Record<string, number>;
  openAdjustmentOrDisputeCount: number;
  recentRegistrations: TaxRegistrationResponse[];
  recentLiabilities: TaxLiabilityResponse[];
  recentFilings: TaxFilingResponse[];
}

export interface TaxRepository {
  transaction<T>(work: (tx: TaxRepository) => Promise<T>): Promise<T>;
  lockLegalEntity(id: number): Promise<void>;
  lockTaxAgency(id: number): Promise<void>;
  lockTaxRegistration(id: number): Promise<void>;
  lockTaxLiability(id: number): Promise<void>;
  lockTaxFiling(id: number): Promise<void>;

  getLegalEntity(id: number): Promise<LegalEntity | undefined>;
  listLegalEntities(): Promise<TaxLegalEntitySummary[]>;
  getVendor(id: number): Promise<Vendor | undefined>;

  getTaxAgency(id: number): Promise<TaxAgency | undefined>;
  listTaxAgencies(filters: TaxAgencyListFilters): Promise<TaxAgency[]>;
  createTaxAgency(values: InsertTaxAgency): Promise<TaxAgency>;
  updateTaxAgency(id: number, values: Partial<InsertTaxAgency>): Promise<TaxAgency | undefined>;

  getTaxRegistration(id: number): Promise<TaxRegistration | undefined>;
  listTaxRegistrations(filters: TaxRegistrationListFilters): Promise<TaxRegistration[]>;
  listOverlappingTaxRegistrations(candidate: TaxRegistrationOverlapCandidate): Promise<TaxRegistration[]>;
  createTaxRegistration(values: InsertTaxRegistration): Promise<TaxRegistration>;
  updateTaxRegistration(id: number, values: Partial<InsertTaxRegistration>): Promise<TaxRegistration | undefined>;
  registrationHasTaxFacts(id: number): Promise<boolean>;

  getTaxLiability(id: number): Promise<TaxLiability | undefined>;
  listTaxLiabilities(filters: TaxLiabilityListFilters): Promise<TaxLiability[]>;
  listTaxLiabilityAdjustments(taxLiabilityId: number): Promise<TaxLiability[]>;
  lockTaxLiabilityAdjustments(taxLiabilityId: number): Promise<void>;
  createTaxLiability(values: InsertTaxLiability): Promise<TaxLiability>;
  updateTaxLiability(id: number, values: Partial<InsertTaxLiability>): Promise<TaxLiability | undefined>;

  getTaxFiling(id: number): Promise<TaxFiling | undefined>;
  listTaxFilings(filters: TaxFilingListFilters): Promise<TaxFiling[]>;
  findOriginalTaxFiling(input: Pick<TaxFiling, "taxRegistrationId" | "filingType" | "periodStart" | "periodEnd">): Promise<TaxFiling | undefined>;
  findTaxFilingAmendmentSuccessor(taxFilingId: number): Promise<TaxFiling | undefined>;
  createTaxFiling(values: InsertTaxFiling): Promise<TaxFiling>;
  updateTaxFiling(id: number, values: Partial<InsertTaxFiling>): Promise<TaxFiling | undefined>;

  getExternalRecordRef(id: number): Promise<ExternalRecordRef | undefined>;
  listExternalRecordRefsForEntity(entityType: TaxExternalRefEntityType, entityId: number): Promise<ExternalRecordRef[]>;
  createExternalRecordRef(values: InsertExternalRecordRef): Promise<ExternalRecordRef>;

  createTaxAuditEvent(values: InsertTaxAuditEvent): Promise<TaxAuditEvent>;
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

async function writeTaxAuditEvent(
  repo: TaxRepository,
  input: {
    actorAdminId: number;
    entityType: TaxAuditEntityType;
    entityId: number;
    action: TaxAuditAction;
    changes: Record<string, unknown>;
  },
) {
  await repo.createTaxAuditEvent({
    actorAdminUserId: input.actorAdminId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: input.changes,
  });
}

function runTaxTransaction<T>(
  repo: TaxRepository,
  work: (tx: TaxRepository) => Promise<T>,
) {
  return repo.transaction(work);
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function assertDateOrder(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  code: string,
  message: string,
) {
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);
  if (startDate && endDate && endDate < startDate) {
    fail(400, code, message);
  }
}

function businessDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function addBusinessDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return businessDate(value);
}

function dueState(
  dueDate: string | Date | null | undefined,
  status: string,
  completeStatuses: readonly string[],
  today: string,
): TaxDueState {
  if (!dueDate) return "none";
  if (completeStatuses.includes(status)) return "complete";
  const due = dateOnly(dueDate);
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due <= addBusinessDays(today, 30)) return "due_soon";
  return "not_due";
}

function registrationDateState(registration: TaxRegistration, today: string): TaxRegistrationResponse["dateState"] {
  const start = dateOnly(registration.effectiveFrom);
  const end = dateOnly(registration.effectiveTo);
  if (!start && !end) return "undated";
  if (start && start > today) return "not_yet_effective";
  if (end && end < today) return "past_effective_dates";
  return "within_effective_dates";
}

function legalEntitySummary(entity: LegalEntity | TaxLegalEntitySummary | undefined | null): TaxLegalEntitySummary | null {
  if (!entity) return null;
  return {
    id: entity.id,
    legalName: entity.legalName,
    entityType: entity.entityType,
    status: entity.status,
  };
}

function taxAgencyResponse(agency: TaxAgency | undefined | null): TaxAgencyResponse | null {
  if (!agency) return null;
  return {
    id: agency.id,
    agencyCode: agency.agencyCode,
    name: agency.name,
    jurisdictionType: agency.jurisdictionType,
    jurisdictionCode: agency.jurisdictionCode,
    status: agency.status,
    createdAt: agency.createdAt,
    updatedAt: agency.updatedAt,
  };
}

async function taxRegistrationResponse(
  repo: TaxRepository,
  registration: TaxRegistration | undefined | null,
  today: string,
): Promise<TaxRegistrationResponse | null> {
  if (!registration) return null;
  const [entity, agency] = await Promise.all([
    repo.getLegalEntity(registration.legalEntityId),
    repo.getTaxAgency(registration.taxAgencyId),
  ]);
  return {
    id: registration.id,
    legalEntityId: registration.legalEntityId,
    legalEntity: legalEntitySummary(entity),
    taxAgencyId: registration.taxAgencyId,
    taxAgency: taxAgencyResponse(agency),
    taxType: registration.taxType,
    jurisdictionType: registration.jurisdictionType,
    jurisdictionCode: registration.jurisdictionCode,
    maskedAccountRef: registration.maskedAccountRef,
    effectiveFrom: registration.effectiveFrom,
    effectiveTo: registration.effectiveTo,
    status: registration.status,
    dateState: registrationDateState(registration, today),
    notes: registration.notes,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
  };
}

function taxLiabilitySignedAmount(liability: Pick<TaxLiability, "amountCents" | "amountEffect">) {
  return liability.amountEffect === "decrease" ? -liability.amountCents : liability.amountCents;
}

function isEffectiveTaxLiabilityStatus(status: string) {
  return (TAX_LIABILITY_EFFECTIVE_STATUSES as readonly string[]).includes(status);
}

type TaxLiabilityEffectiveLine = Pick<
  TaxLiability,
  "taxRegistrationId" | "currency" | "amountCents" | "amountEffect" | "status"
>;

function taxLiabilityEffectiveAmount(base: TaxLiabilityEffectiveLine, adjustments: TaxLiabilityEffectiveLine[]) {
  if (base.status === "voided") return 0;
  const lines = [
    ...(isEffectiveTaxLiabilityStatus(base.status) ? [base] : []),
    ...adjustments.filter((item) => isEffectiveTaxLiabilityStatus(item.status)),
  ];
  if (lines.length === 0) return 0;
  return deriveTaxLiabilityNetAmountCents(lines.map((line) => ({
    taxRegistrationId: line.taxRegistrationId,
    currency: line.currency,
    amountCents: line.amountCents,
    amountEffect: line.amountEffect as AmountEffect,
  })));
}

function assertEffectiveTaxLiabilityAmountIsNonNegative(
  base: TaxLiabilityEffectiveLine,
  adjustments: TaxLiabilityEffectiveLine[],
) {
  if (taxLiabilityEffectiveAmount(base, adjustments) < 0) {
    fail(
      400,
      "TAX_LIABILITY_EFFECTIVE_AMOUNT_NEGATIVE",
      "Tax liability adjustments cannot reduce the effective liability below zero.",
    );
  }
}

async function taxLiabilityResponse(
  repo: TaxRepository,
  liability: TaxLiability,
  today: string,
  includeDetail = false,
): Promise<TaxLiabilityResponse> {
  const [registration, adjustments, externalRefs] = await Promise.all([
    repo.getTaxRegistration(liability.taxRegistrationId),
    liability.adjustsTaxLiabilityId ? Promise.resolve([]) : repo.listTaxLiabilityAdjustments(liability.id),
    includeDetail ? repo.listExternalRecordRefsForEntity("tax_liabilities", liability.id) : Promise.resolve([]),
  ]);
  const childResponses = includeDetail
    ? await Promise.all(adjustments.map((adjustment) => taxLiabilityResponse(repo, adjustment, today, false)))
    : undefined;
  return {
    id: liability.id,
    taxRegistrationId: liability.taxRegistrationId,
    registration: await taxRegistrationResponse(repo, registration, today),
    periodStart: liability.periodStart,
    periodEnd: liability.periodEnd,
    dueDate: liability.dueDate,
    dueState: dueState(liability.dueDate, liability.status, ["voided"], today),
    component: liability.component,
    amountEffect: liability.amountEffect as AmountEffect,
    amountCents: liability.amountCents,
    signedAmountCents: taxLiabilitySignedAmount(liability),
    effectiveAmountCents: liability.adjustsTaxLiabilityId
      ? taxLiabilitySignedAmount(liability)
      : taxLiabilityEffectiveAmount(liability, adjustments),
    currency: liability.currency,
    sourceType: liability.sourceType as FinanceSourceType,
    adjustsTaxLiabilityId: liability.adjustsTaxLiabilityId,
    adjustmentCount: adjustments.filter((item) => item.status !== "voided").length,
    paymentTrackingStatus: "not_yet_tracked",
    status: liability.status,
    recognizedAt: liability.recognizedAt,
    notes: liability.notes,
    adjustments: childResponses,
    externalRefs: includeDetail ? externalRefs.map(externalRefResponse) : undefined,
    createdAt: liability.createdAt,
    updatedAt: liability.updatedAt,
  };
}

async function taxFilingResponse(
  repo: TaxRepository,
  filing: TaxFiling,
  today: string,
  includeDetail = false,
): Promise<TaxFilingResponse> {
  const [registration, externalRefs] = await Promise.all([
    repo.getTaxRegistration(filing.taxRegistrationId),
    includeDetail ? repo.listExternalRecordRefsForEntity("tax_filings", filing.id) : Promise.resolve([]),
  ]);
  return {
    id: filing.id,
    taxRegistrationId: filing.taxRegistrationId,
    registration: await taxRegistrationResponse(repo, registration, today),
    filingType: filing.filingType,
    periodStart: filing.periodStart,
    periodEnd: filing.periodEnd,
    dueDate: filing.dueDate,
    dueState: dueState(filing.dueDate, filing.status, ["filed", "accepted", "voided"], today),
    filedAt: filing.filedAt,
    acceptedAt: filing.acceptedAt,
    confirmationRef: filing.confirmationRef,
    amendsTaxFilingId: filing.amendsTaxFilingId,
    status: filing.status,
    notes: filing.notes,
    externalRefs: includeDetail ? externalRefs.map(externalRefResponse) : undefined,
    createdAt: filing.createdAt,
    updatedAt: filing.updatedAt,
  };
}

function externalRefResponse(ref: ExternalRecordRef): TaxExternalRefResponse {
  return {
    id: ref.id,
    entityType: ref.entityType as TaxExternalRefEntityType,
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

function aggregateEffectiveTaxLiabilityTotals(liabilities: TaxLiability[]) {
  const byBaseId = new Map<number, TaxLiability[]>();
  const bases = liabilities.filter((item) => !item.adjustsTaxLiabilityId);
  for (const adjustment of liabilities.filter((item) => item.adjustsTaxLiabilityId)) {
    const baseId = adjustment.adjustsTaxLiabilityId!;
    byBaseId.set(baseId, [...(byBaseId.get(baseId) ?? []), adjustment]);
  }

  const totals = new Map<string, TaxCurrencyTotal>();
  for (const base of bases) {
    const effectiveAmountCents = taxLiabilityEffectiveAmount(base, byBaseId.get(base.id) ?? []);
    if (effectiveAmountCents === 0 && !isEffectiveTaxLiabilityStatus(base.status)) continue;
    const existing = totals.get(base.currency) ?? {
      currency: base.currency,
      amountCents: 0,
      liabilityCount: 0,
    };
    existing.amountCents += effectiveAmountCents;
    existing.liabilityCount += 1;
    totals.set(base.currency, existing);
  }
  return Array.from(totals.values()).sort((left, right) => left.currency.localeCompare(right.currency));
}

function filingStatusCounts(filings: TaxFiling[]) {
  const counts: Record<string, number> = {};
  for (const status of TAX_FILING_STATUSES) counts[status] = 0;
  for (const filing of filings) {
    counts[filing.status] = (counts[filing.status] ?? 0) + 1;
  }
  return counts;
}

function assertTaxAgencyExists(agency: TaxAgency | undefined, id: number): TaxAgency {
  if (!agency) {
    fail(404, "TAX_AGENCY_NOT_FOUND", `Tax agency ${id} was not found.`);
  }
  return agency;
}

function assertTaxRegistrationExists(registration: TaxRegistration | undefined, id: number): TaxRegistration {
  if (!registration) {
    fail(404, "TAX_REGISTRATION_NOT_FOUND", `Tax registration ${id} was not found.`);
  }
  return registration;
}

function assertTaxLiabilityExists(liability: TaxLiability | undefined, id: number): TaxLiability {
  if (!liability) {
    fail(404, "TAX_LIABILITY_NOT_FOUND", `Tax liability ${id} was not found.`);
  }
  return liability;
}

function assertTaxFilingExists(filing: TaxFiling | undefined, id: number): TaxFiling {
  if (!filing) {
    fail(404, "TAX_FILING_NOT_FOUND", `Tax filing ${id} was not found.`);
  }
  return filing;
}

async function assertLegalEntity(repo: TaxRepository, id: number) {
  const entity = await repo.getLegalEntity(id);
  if (!entity) {
    fail(400, "LEGAL_ENTITY_NOT_FOUND", `Legal entity ${id} was not found.`);
  }
  if (entity.status !== "active") {
    fail(400, "LEGAL_ENTITY_INACTIVE", "Tax records require an active legal entity.");
  }
  return entity;
}

async function assertTaxAgencyUsable(repo: TaxRepository, id: number) {
  const agency = assertTaxAgencyExists(await repo.getTaxAgency(id), id);
  if (agency.status !== "active") {
    fail(400, "TAX_AGENCY_INACTIVE", "Tax records require an active tax agency.");
  }
  return agency;
}

async function assertNoOverlappingCurrentTaxRegistration(
  repo: TaxRepository,
  candidate: TaxRegistrationOverlapCandidate,
  status: string,
) {
  if (status === "closed") return;
  const conflicts = await repo.listOverlappingTaxRegistrations({
    ...candidate,
    jurisdictionCode: candidate.jurisdictionCode.toUpperCase(),
  });
  if (conflicts.length > 0) {
    fail(
      409,
      "TAX_REGISTRATION_OVERLAP",
      "A current tax registration already overlaps this legal entity, agency, tax type, jurisdiction, and effective date range.",
    );
  }
}

function assertTaxFactPeriodWithinRegistration(
  registration: TaxRegistration,
  period: { periodStart: string | Date; periodEnd: string | Date },
) {
  const periodStart = dateOnly(period.periodStart);
  const periodEnd = dateOnly(period.periodEnd);
  if (!periodStart || !periodEnd) return;
  const effectiveFrom = dateOnly(registration.effectiveFrom);
  const effectiveTo = dateOnly(registration.effectiveTo);
  if (effectiveFrom && periodStart < effectiveFrom) {
    fail(
      400,
      "TAX_REGISTRATION_PERIOD_OUT_OF_RANGE",
      "Tax fact period cannot start before the registration effective start date.",
    );
  }
  if (effectiveTo && periodEnd > effectiveTo) {
    fail(
      400,
      "TAX_REGISTRATION_PERIOD_OUT_OF_RANGE",
      "Tax fact period cannot end after the registration effective end date.",
    );
  }
}

async function assertTaxRegistrationCanReceiveTaxFact(
  repo: TaxRepository,
  id: number,
  period: { periodStart: string | Date; periodEnd: string | Date },
) {
  const registration = assertTaxRegistrationExists(await repo.getTaxRegistration(id), id);
  assertTaxFactPeriodWithinRegistration(registration, period);
  return registration;
}

async function assertSourceVendor(repo: TaxRepository, sourceType: string, sourceVendorId?: number | null) {
  if (sourceType === "provider" && !sourceVendorId) {
    fail(400, "TAX_PROVIDER_VENDOR_REQUIRED", "Provider tax references require a source vendor.");
  }
  if (!sourceVendorId) return null;
  const vendor = await repo.getVendor(sourceVendorId);
  if (!vendor) {
    fail(400, "TAX_SOURCE_VENDOR_NOT_FOUND", `Source vendor ${sourceVendorId} was not found.`);
  }
  if (vendor.status === "archived") {
    fail(400, "TAX_SOURCE_VENDOR_ARCHIVED", "Archived vendors cannot be used as tax reference sources.");
  }
  return vendor;
}

function assertNoRegistrationScopeChangeAfterFacts(
  existing: TaxRegistration,
  input: UpdateTaxRegistrationPayload,
  hasFacts: boolean,
) {
  if (!hasFacts) return;
  const forbidden: (keyof UpdateTaxRegistrationPayload)[] = [
    "legalEntityId",
    "taxAgencyId",
    "taxType",
    "jurisdictionType",
    "jurisdictionCode",
  ];
  for (const field of forbidden) {
    if (input[field] !== undefined && input[field] !== (existing as any)[field]) {
      fail(400, "TAX_REGISTRATION_SCOPE_IMMUTABLE", "Tax registration scope cannot change after liabilities or filings exist.");
    }
  }
}

function nextRegistrationStatus(existing: string, target: string) {
  if (existing === target) return target;
  const allowed: Record<string, readonly string[]> = {
    pending: ["active", "closed"],
    active: ["inactive", "closed"],
    inactive: ["active", "closed"],
    closed: [],
  };
  if (allowed[existing]?.includes(target)) return target;
  fail(400, "TAX_REGISTRATION_TRANSITION_INVALID", `Cannot transition tax registration from ${existing} to ${target}.`);
}

function registrationTransitionAction(status: string): TaxAuditAction {
  if (status === "active") return "activated";
  if (status === "inactive") return "deactivated";
  return "closed";
}

function assertDraftTaxLiabilityEditable(liability: TaxLiability, input: UpdateTaxLiabilityPayload) {
  if (liability.status === "draft") return;
  const forbidden = Object.keys(input).filter((key) => key !== "notes" && key !== "actorAdminId");
  if (forbidden.length > 0) {
    fail(400, "TAX_LIABILITY_HISTORICAL_IMMUTABLE", "Recognized, disputed, or voided tax liability facts cannot be rewritten through PATCH.");
  }
}

function nextLiabilityStatus(existing: string, target: string) {
  if (existing === target) return target;
  const allowed: Record<string, readonly string[]> = {
    draft: ["recognized", "voided"],
    recognized: ["disputed", "voided"],
    disputed: ["recognized", "voided"],
    voided: [],
  };
  if (allowed[existing]?.includes(target)) return target;
  fail(400, "TAX_LIABILITY_TRANSITION_INVALID", `Cannot transition tax liability from ${existing} to ${target}.`);
}

async function lockTaxLiabilityForAmountMutation(repo: TaxRepository, liabilityId: number) {
  const snapshot = assertTaxLiabilityExists(await repo.getTaxLiability(liabilityId), liabilityId);
  if (snapshot.adjustsTaxLiabilityId) {
    await repo.lockTaxLiability(snapshot.adjustsTaxLiabilityId);
    await repo.lockTaxLiabilityAdjustments(snapshot.adjustsTaxLiabilityId);
  } else {
    await repo.lockTaxLiability(liabilityId);
  }
  return assertTaxLiabilityExists(await repo.getTaxLiability(liabilityId), liabilityId);
}

async function assertTaxLiabilityAdjustmentTarget(repo: TaxRepository, targetLiabilityId: number) {
  const target = assertTaxLiabilityExists(await repo.getTaxLiability(targetLiabilityId), targetLiabilityId);
  const visited = new Set<number>();
  let current: TaxLiability | undefined = target;
  while (current) {
    if (visited.has(current.id)) {
      fail(400, "TAX_LIABILITY_ADJUSTMENT_CYCLE", "Tax liability adjustment lineage cannot form a cycle.");
    }
    visited.add(current.id);
    current = current.adjustsTaxLiabilityId ? await repo.getTaxLiability(current.adjustsTaxLiabilityId) : undefined;
  }
  if (target.adjustsTaxLiabilityId) {
    fail(400, "TAX_LIABILITY_ADJUSTMENT_CHAIN_NOT_SUPPORTED", "Tax liability adjustments must point directly to the base liability in V1.");
  }
  if (target.status === "voided") {
    fail(400, "TAX_LIABILITY_ADJUSTMENT_TARGET_VOIDED", "Voided tax liabilities cannot receive adjustments.");
  }
  if (!isEffectiveTaxLiabilityStatus(target.status)) {
    fail(400, "TAX_LIABILITY_ADJUSTMENT_REQUIRES_RECOGNIZED_TARGET", "Tax liability adjustments require a recognized or disputed base liability.");
  }
  return target;
}

function assertDraftTaxFilingEditable(filing: TaxFiling, input: UpdateTaxFilingPayload) {
  if (filing.status === "draft") return;
  const forbidden = Object.keys(input).filter((key) => key !== "notes" && key !== "actorAdminId");
  if (forbidden.length > 0) {
    fail(400, "TAX_FILING_HISTORICAL_IMMUTABLE", "Ready, filed, accepted, rejected, or voided tax filing facts cannot be rewritten through PATCH.");
  }
}

function nextFilingStatus(existing: string, target: string) {
  if (existing === target) return target;
  const allowed: Record<string, readonly string[]> = {
    draft: ["ready"],
    ready: ["filed"],
    filed: ["accepted", "rejected"],
    rejected: ["ready"],
    accepted: [],
    voided: [],
  };
  if (allowed[existing]?.includes(target)) return target;
  fail(400, "TAX_FILING_TRANSITION_INVALID", `Cannot transition tax filing from ${existing} to ${target}.`);
}

function assertTaxFilingLifecycleFacts(filing: TaxFiling) {
  const filedAt = Boolean(filing.filedAt);
  const acceptedAt = Boolean(filing.acceptedAt);
  if (["draft", "ready"].includes(filing.status) && (filedAt || acceptedAt)) {
    fail(400, "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID", "Draft and ready tax filings cannot carry filed or accepted timestamps.");
  }
  if (["filed", "accepted", "rejected"].includes(filing.status) && !filedAt) {
    fail(400, "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID", "Filed, accepted, and rejected tax filings require a filed timestamp.");
  }
  if (filing.status === "accepted" && !acceptedAt) {
    fail(400, "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID", "Accepted tax filings require an accepted timestamp.");
  }
  if (filing.status !== "accepted" && acceptedAt) {
    fail(400, "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID", "Only accepted tax filings can carry an accepted timestamp.");
  }
}

async function assertTaxFilingAmendmentTarget(repo: TaxRepository, targetFilingId: number) {
  const target = assertTaxFilingExists(await repo.getTaxFiling(targetFilingId), targetFilingId);
  assertTaxFilingLifecycleFacts(target);
  const visited = new Set<number>();
  let current: TaxFiling | undefined = target;
  while (current) {
    if (visited.has(current.id)) {
      fail(400, "TAX_FILING_AMENDMENT_CYCLE", "Tax filing amendment lineage cannot form a cycle.");
    }
    visited.add(current.id);
    current = current.amendsTaxFilingId ? await repo.getTaxFiling(current.amendsTaxFilingId) : undefined;
  }
  if (!["filed", "accepted"].includes(target.status)) {
    fail(400, "TAX_FILING_AMENDMENT_REQUIRES_FILED_ORIGINAL", "A tax filing amendment requires a filed or accepted target.");
  }
  const existingSuccessor = await repo.findTaxFilingAmendmentSuccessor(target.id);
  if (existingSuccessor) {
    fail(409, "TAX_FILING_AMENDMENT_BRANCHING_NOT_SUPPORTED", "Tax filing amendments form one successor chain; create the next amendment from the latest amendment.");
  }
  return target;
}

async function assertExternalRefTarget(repo: TaxRepository, entityType: TaxExternalRefEntityType, entityId: number) {
  switch (entityType) {
    case "tax_agencies":
      assertTaxAgencyExists(await repo.getTaxAgency(entityId), entityId);
      return;
    case "tax_registrations":
      assertTaxRegistrationExists(await repo.getTaxRegistration(entityId), entityId);
      return;
    case "tax_liabilities":
      assertTaxLiabilityExists(await repo.getTaxLiability(entityId), entityId);
      return;
    case "tax_filings":
      assertTaxFilingExists(await repo.getTaxFiling(entityId), entityId);
      return;
  }
}

export async function listTaxLegalEntities(repo: TaxRepository) {
  return await repo.listLegalEntities();
}

export async function listTaxAgencies(repo: TaxRepository, filters: TaxAgencyListFilters) {
  return (await repo.listTaxAgencies(filters)).map((agency) => taxAgencyResponse(agency)!);
}

export async function getTaxAgency(repo: TaxRepository, agencyId: number) {
  return taxAgencyResponse(assertTaxAgencyExists(await repo.getTaxAgency(agencyId), agencyId));
}

export async function createTaxAgency(repo: TaxRepository, input: CreateTaxAgencyPayload & { actorAdminId: number }) {
  return runTaxTransaction(repo, async (tx) => {
    const agency = await tx.createTaxAgency({
      agencyCode: input.agencyCode,
      name: input.name,
      jurisdictionType: input.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode.toUpperCase(),
      status: input.status,
      createdBy: input.actorAdminId,
    });
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_agency",
      entityId: agency.id,
      action: "created",
      changes: auditChanges(null, agency, TAX_AGENCY_AUDIT_FIELDS),
    });
    return taxAgencyResponse(agency);
  });
}

export async function updateTaxAgency(
  repo: TaxRepository,
  agencyId: number,
  input: UpdateTaxAgencyPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxAgency(agencyId);
    const existing = assertTaxAgencyExists(await tx.getTaxAgency(agencyId), agencyId);
    const updated = assertTaxAgencyExists(await tx.updateTaxAgency(existing.id, {
      agencyCode: input.agencyCode,
      name: input.name,
      jurisdictionType: input.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode?.toUpperCase(),
      status: input.status,
    }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_agency",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, TAX_AGENCY_AUDIT_FIELDS),
    });
    return taxAgencyResponse(updated);
  });
}

export async function listTaxRegistrations(
  repo: TaxRepository,
  filters: TaxRegistrationListFilters,
  today = businessDate(),
) {
  return await Promise.all((await repo.listTaxRegistrations(filters)).map((item) => taxRegistrationResponse(repo, item, today)));
}

export async function getTaxRegistration(repo: TaxRepository, registrationId: number, today = businessDate()) {
  return taxRegistrationResponse(repo, assertTaxRegistrationExists(await repo.getTaxRegistration(registrationId), registrationId), today);
}

export async function createTaxRegistration(
  repo: TaxRepository,
  input: CreateTaxRegistrationPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockLegalEntity(input.legalEntityId);
    await tx.lockTaxAgency(input.taxAgencyId);
    await assertLegalEntity(tx, input.legalEntityId);
    await assertTaxAgencyUsable(tx, input.taxAgencyId);
    await assertNoOverlappingCurrentTaxRegistration(tx, {
      legalEntityId: input.legalEntityId,
      taxAgencyId: input.taxAgencyId,
      taxType: input.taxType,
      jurisdictionType: input.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
    }, input.status);

    const registration = await tx.createTaxRegistration({
      legalEntityId: input.legalEntityId,
      taxAgencyId: input.taxAgencyId,
      taxType: input.taxType,
      jurisdictionType: input.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode.toUpperCase(),
      maskedAccountRef: input.maskedAccountRef ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      status: input.status,
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_registration",
      entityId: registration.id,
      action: "created",
      changes: auditChanges(null, registration, TAX_REGISTRATION_AUDIT_FIELDS),
    });
    return taxRegistrationResponse(tx, registration, businessDate());
  });
}

export async function updateTaxRegistration(
  repo: TaxRepository,
  registrationId: number,
  input: UpdateTaxRegistrationPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxRegistration(registrationId);
    const existing = assertTaxRegistrationExists(await tx.getTaxRegistration(registrationId), registrationId);
    if (existing.status === "closed") {
      const forbidden = Object.keys(input).filter((key) => key !== "notes" && key !== "actorAdminId");
      if (forbidden.length > 0) {
        fail(400, "TAX_REGISTRATION_CLOSED", "Closed tax registrations only allow notes updates.");
      }
    }
    const hasFacts = await tx.registrationHasTaxFacts(existing.id);
    assertNoRegistrationScopeChangeAfterFacts(existing, input, hasFacts);
    assertDateOrder(
      input.effectiveFrom ?? existing.effectiveFrom,
      input.effectiveTo ?? existing.effectiveTo,
      "TAX_REGISTRATION_EFFECTIVE_DATES_INVALID",
      "Effective end cannot be before effective start.",
    );
    if (input.legalEntityId && input.legalEntityId !== existing.legalEntityId) {
      await tx.lockLegalEntity(input.legalEntityId);
      await assertLegalEntity(tx, input.legalEntityId);
    }
    if (input.taxAgencyId && input.taxAgencyId !== existing.taxAgencyId) {
      await tx.lockTaxAgency(input.taxAgencyId);
      await assertTaxAgencyUsable(tx, input.taxAgencyId);
    }
    await assertNoOverlappingCurrentTaxRegistration(tx, {
      legalEntityId: input.legalEntityId ?? existing.legalEntityId,
      taxAgencyId: input.taxAgencyId ?? existing.taxAgencyId,
      taxType: input.taxType ?? existing.taxType,
      jurisdictionType: input.jurisdictionType ?? existing.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode ?? existing.jurisdictionCode,
      effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: input.effectiveTo ?? existing.effectiveTo,
      excludeRegistrationId: existing.id,
    }, existing.status);

    const updated = assertTaxRegistrationExists(await tx.updateTaxRegistration(existing.id, {
      legalEntityId: input.legalEntityId,
      taxAgencyId: input.taxAgencyId,
      taxType: input.taxType,
      jurisdictionType: input.jurisdictionType,
      jurisdictionCode: input.jurisdictionCode?.toUpperCase(),
      maskedAccountRef: input.maskedAccountRef,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      notes: input.notes,
    }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_registration",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, TAX_REGISTRATION_AUDIT_FIELDS),
    });
    return taxRegistrationResponse(tx, updated, businessDate());
  });
}

export async function transitionTaxRegistration(
  repo: TaxRepository,
  registrationId: number,
  input: TaxRegistrationTransitionPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxRegistration(registrationId);
    const existing = assertTaxRegistrationExists(await tx.getTaxRegistration(registrationId), registrationId);
    const status = nextRegistrationStatus(existing.status, input.status);
    await assertNoOverlappingCurrentTaxRegistration(tx, {
      legalEntityId: existing.legalEntityId,
      taxAgencyId: existing.taxAgencyId,
      taxType: existing.taxType,
      jurisdictionType: existing.jurisdictionType,
      jurisdictionCode: existing.jurisdictionCode,
      effectiveFrom: existing.effectiveFrom,
      effectiveTo: existing.effectiveTo,
      excludeRegistrationId: existing.id,
    }, status);
    const updated = assertTaxRegistrationExists(await tx.updateTaxRegistration(existing.id, { status }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_registration",
      entityId: updated.id,
      action: registrationTransitionAction(status),
      changes: auditChanges(existing, updated, TAX_REGISTRATION_AUDIT_FIELDS),
    });
    return taxRegistrationResponse(tx, updated, businessDate());
  });
}

export async function listTaxLiabilities(
  repo: TaxRepository,
  filters: TaxLiabilityListFilters,
  today = businessDate(),
) {
  return await Promise.all((await repo.listTaxLiabilities(filters)).map((item) => taxLiabilityResponse(repo, item, today)));
}

export async function getTaxLiability(repo: TaxRepository, liabilityId: number, today = businessDate()) {
  return taxLiabilityResponse(repo, assertTaxLiabilityExists(await repo.getTaxLiability(liabilityId), liabilityId), today, true);
}

export async function createTaxLiability(
  repo: TaxRepository,
  input: CreateTaxLiabilityPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxRegistration(input.taxRegistrationId);
    await assertTaxRegistrationCanReceiveTaxFact(tx, input.taxRegistrationId, {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    const liability = await tx.createTaxLiability({
      taxRegistrationId: input.taxRegistrationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate ?? null,
      component: input.component,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency: input.currency,
      sourceType: input.sourceType,
      sourceMetadata: input.sourceMetadata,
      adjustsTaxLiabilityId: null,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_liability",
      entityId: liability.id,
      action: "created",
      changes: auditChanges(null, liability, TAX_LIABILITY_AUDIT_FIELDS),
    });
    return taxLiabilityResponse(tx, liability, businessDate(), true);
  });
}

export async function updateTaxLiability(
  repo: TaxRepository,
  liabilityId: number,
  input: UpdateTaxLiabilityPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    const existing = await lockTaxLiabilityForAmountMutation(tx, liabilityId);
    assertDraftTaxLiabilityEditable(existing, input);
    assertDateOrder(
      input.periodStart ?? existing.periodStart,
      input.periodEnd ?? existing.periodEnd,
      "TAX_LIABILITY_PERIOD_INVALID",
      "Period end cannot be before period start.",
    );
    const candidateRegistrationId = input.taxRegistrationId ?? existing.taxRegistrationId;
    const candidatePeriod = {
      periodStart: input.periodStart ?? existing.periodStart,
      periodEnd: input.periodEnd ?? existing.periodEnd,
    };
    if (input.taxRegistrationId && input.taxRegistrationId !== existing.taxRegistrationId) {
      await tx.lockTaxRegistration(input.taxRegistrationId);
    }
    await assertTaxRegistrationCanReceiveTaxFact(tx, candidateRegistrationId, candidatePeriod);
    if (existing.adjustsTaxLiabilityId) {
      const base = assertTaxLiabilityExists(await tx.getTaxLiability(existing.adjustsTaxLiabilityId), existing.adjustsTaxLiabilityId);
      if (candidateRegistrationId !== base.taxRegistrationId) {
        fail(400, "TAX_LIABILITY_ADJUSTMENT_REGISTRATION_MISMATCH", "Tax liability adjustment must use the base liability registration.");
      }
      const candidate = {
        ...existing,
        taxRegistrationId: candidateRegistrationId,
        periodStart: candidatePeriod.periodStart,
        periodEnd: candidatePeriod.periodEnd,
        dueDate: input.dueDate ?? existing.dueDate,
        component: input.component ?? existing.component,
        amountEffect: input.amountEffect ?? existing.amountEffect,
        amountCents: input.amountCents ?? existing.amountCents,
        currency: input.currency ?? existing.currency,
        sourceType: input.sourceType ?? existing.sourceType,
        sourceMetadata: input.sourceMetadata ?? existing.sourceMetadata,
        status: isEffectiveTaxLiabilityStatus(existing.status) ? existing.status : "recognized",
      } as TaxLiability;
      if (candidate.currency !== base.currency) {
        fail(400, "TAX_LIABILITY_ADJUSTMENT_CURRENCY_MISMATCH", "Tax liability adjustment currency must match the base liability currency.");
      }
      const adjustments = await tx.listTaxLiabilityAdjustments(base.id);
      assertEffectiveTaxLiabilityAmountIsNonNegative(
        base,
        adjustments.map((adjustment) => adjustment.id === existing.id ? candidate : adjustment),
      );
    }
    const updated = assertTaxLiabilityExists(await tx.updateTaxLiability(existing.id, {
      taxRegistrationId: input.taxRegistrationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate,
      component: input.component,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency: input.currency,
      sourceType: input.sourceType,
      sourceMetadata: input.sourceMetadata,
      notes: input.notes,
    }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_liability",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, TAX_LIABILITY_AUDIT_FIELDS),
    });
    return taxLiabilityResponse(tx, updated, businessDate(), true);
  });
}

export async function transitionTaxLiability(
  repo: TaxRepository,
  liabilityId: number,
  input: TaxLiabilityTransitionPayload & { actorAdminId: number },
  now = new Date(),
) {
  return runTaxTransaction(repo, async (tx) => {
    const existing = await lockTaxLiabilityForAmountMutation(tx, liabilityId);
    const status = nextLiabilityStatus(existing.status, input.status);
    if (existing.adjustsTaxLiabilityId && isEffectiveTaxLiabilityStatus(status)) {
      const base = assertTaxLiabilityExists(await tx.getTaxLiability(existing.adjustsTaxLiabilityId), existing.adjustsTaxLiabilityId);
      if (existing.currency !== base.currency) {
        fail(400, "TAX_LIABILITY_ADJUSTMENT_CURRENCY_MISMATCH", "Tax liability adjustment currency must match the base liability currency.");
      }
      const adjustments = await tx.listTaxLiabilityAdjustments(base.id);
      const candidate = {
        ...existing,
        status,
        recognizedAt: status === "recognized" && !existing.recognizedAt ? now : existing.recognizedAt,
      } as TaxLiability;
      assertEffectiveTaxLiabilityAmountIsNonNegative(
        base,
        adjustments.map((adjustment) => adjustment.id === existing.id ? candidate : adjustment),
      );
    }
    const updated = assertTaxLiabilityExists(await tx.updateTaxLiability(existing.id, {
      status,
      recognizedAt: status === "recognized" && !existing.recognizedAt ? now : undefined,
    }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_liability",
      entityId: updated.id,
      action: status as TaxAuditAction,
      changes: auditChanges(existing, updated, TAX_LIABILITY_AUDIT_FIELDS),
    });
    return taxLiabilityResponse(tx, updated, businessDate(), true);
  });
}

export async function createTaxLiabilityAdjustment(
  repo: TaxRepository,
  liabilityId: number,
  input: CreateTaxLiabilityAdjustmentPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxLiability(liabilityId);
    const target = await assertTaxLiabilityAdjustmentTarget(tx, liabilityId);
    if (input.taxRegistrationId !== undefined && input.taxRegistrationId !== target.taxRegistrationId) {
      fail(400, "TAX_LIABILITY_ADJUSTMENT_REGISTRATION_MISMATCH", "Tax liability adjustment must use the base liability registration.");
    }
    const component = input.component ?? "adjustment";
    const currency = input.currency ?? "USD";
    const sourceType = input.sourceType ?? "manual";
    const sourceMetadata = input.sourceMetadata ?? {};
    if (currency !== target.currency) {
      fail(400, "TAX_LIABILITY_ADJUSTMENT_CURRENCY_MISMATCH", "Tax liability adjustment currency must match the base liability currency.");
    }
    const period = {
      periodStart: input.periodStart ?? target.periodStart,
      periodEnd: input.periodEnd ?? target.periodEnd,
    };
    assertDateOrder(
      period.periodStart,
      period.periodEnd,
      "TAX_LIABILITY_PERIOD_INVALID",
      "Period end cannot be before period start.",
    );
    await assertTaxRegistrationCanReceiveTaxFact(tx, target.taxRegistrationId, period);
    await tx.lockTaxLiabilityAdjustments(target.id);
    const adjustments = await tx.listTaxLiabilityAdjustments(target.id);
    const proposedAdjustment = {
      ...target,
      id: Number.MIN_SAFE_INTEGER,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDate: input.dueDate ?? target.dueDate,
      component,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency,
      sourceType,
      sourceMetadata,
      adjustsTaxLiabilityId: target.id,
      status: "recognized",
      notes: input.notes ?? null,
    } as TaxLiability;
    assertEffectiveTaxLiabilityAmountIsNonNegative(target, [...adjustments, proposedAdjustment]);
    const liability = await tx.createTaxLiability({
      taxRegistrationId: target.taxRegistrationId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDate: input.dueDate ?? target.dueDate,
      component,
      amountEffect: input.amountEffect,
      amountCents: input.amountCents,
      currency,
      sourceType,
      sourceMetadata,
      adjustsTaxLiabilityId: target.id,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_liability",
      entityId: liability.id,
      action: "adjustment_created",
      changes: auditChanges(null, liability, TAX_LIABILITY_AUDIT_FIELDS),
    });
    return taxLiabilityResponse(tx, liability, businessDate(), true);
  });
}

export async function listTaxFilings(repo: TaxRepository, filters: TaxFilingListFilters, today = businessDate()) {
  return await Promise.all((await repo.listTaxFilings(filters)).map((item) => taxFilingResponse(repo, item, today)));
}

export async function getTaxFiling(repo: TaxRepository, filingId: number, today = businessDate()) {
  return taxFilingResponse(repo, assertTaxFilingExists(await repo.getTaxFiling(filingId), filingId), today, true);
}

export async function createTaxFiling(
  repo: TaxRepository,
  input: CreateTaxFilingPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxRegistration(input.taxRegistrationId);
    await assertTaxRegistrationCanReceiveTaxFact(tx, input.taxRegistrationId, {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    const existing = await tx.findOriginalTaxFiling({
      taxRegistrationId: input.taxRegistrationId,
      filingType: input.filingType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    } as TaxFiling);
    if (existing && existing.status !== "voided") {
      fail(409, "TAX_FILING_ORIGINAL_DUPLICATE", "An original filing already exists for this registration, type, and period.");
    }
    const filing = await tx.createTaxFiling({
      taxRegistrationId: input.taxRegistrationId,
      filingType: input.filingType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate ?? null,
      filedAt: null,
      acceptedAt: null,
      confirmationRef: null,
      amendsTaxFilingId: null,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_filing",
      entityId: filing.id,
      action: "created",
      changes: auditChanges(null, filing, TAX_FILING_AUDIT_FIELDS),
    });
    return taxFilingResponse(tx, filing, businessDate(), true);
  });
}

export async function updateTaxFiling(
  repo: TaxRepository,
  filingId: number,
  input: UpdateTaxFilingPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxFiling(filingId);
    const existing = assertTaxFilingExists(await tx.getTaxFiling(filingId), filingId);
    assertTaxFilingLifecycleFacts(existing);
    assertDraftTaxFilingEditable(existing, input);
    assertDateOrder(
      input.periodStart ?? existing.periodStart,
      input.periodEnd ?? existing.periodEnd,
      "TAX_FILING_PERIOD_INVALID",
      "Period end cannot be before period start.",
    );
    if (input.taxRegistrationId && input.taxRegistrationId !== existing.taxRegistrationId) {
      await tx.lockTaxRegistration(input.taxRegistrationId);
    }
    await assertTaxRegistrationCanReceiveTaxFact(tx, input.taxRegistrationId ?? existing.taxRegistrationId, {
      periodStart: input.periodStart ?? existing.periodStart,
      periodEnd: input.periodEnd ?? existing.periodEnd,
    });
    if (
      existing.status === "draft"
      && !existing.amendsTaxFilingId
      && (
        input.taxRegistrationId !== undefined
        || input.filingType !== undefined
        || input.periodStart !== undefined
        || input.periodEnd !== undefined
      )
    ) {
      const candidate = {
        taxRegistrationId: input.taxRegistrationId ?? existing.taxRegistrationId,
        filingType: input.filingType ?? existing.filingType,
        periodStart: input.periodStart ?? existing.periodStart,
        periodEnd: input.periodEnd ?? existing.periodEnd,
      } as TaxFiling;
      const duplicate = await tx.findOriginalTaxFiling(candidate);
      if (duplicate && duplicate.id !== existing.id && duplicate.status !== "voided") {
        fail(409, "TAX_FILING_ORIGINAL_DUPLICATE", "An original filing already exists for this registration, type, and period.");
      }
    }

    const updated = assertTaxFilingExists(await tx.updateTaxFiling(existing.id, {
      taxRegistrationId: input.taxRegistrationId,
      filingType: input.filingType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate,
      notes: input.notes,
    }), existing.id);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_filing",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, TAX_FILING_AUDIT_FIELDS),
    });
    return taxFilingResponse(tx, updated, businessDate(), true);
  });
}

export async function transitionTaxFiling(
  repo: TaxRepository,
  filingId: number,
  input: TaxFilingTransitionPayload & { actorAdminId: number },
  now = new Date(),
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxFiling(filingId);
    const existing = assertTaxFilingExists(await tx.getTaxFiling(filingId), filingId);
    assertTaxFilingLifecycleFacts(existing);
    const status = nextFilingStatus(existing.status, input.status);
    if (status === existing.status) {
      return taxFilingResponse(tx, existing, businessDate(), true);
    }
    const update: Partial<InsertTaxFiling> = { status };
    if (status === "ready") {
      update.filedAt = null;
      update.acceptedAt = null;
      update.confirmationRef = null;
    }
    if (status === "filed") {
      update.filedAt = input.filedAt ?? now;
      update.confirmationRef = input.confirmationRef ?? existing.confirmationRef;
    }
    if (status === "accepted") {
      update.acceptedAt = input.acceptedAt ?? now;
    }
    if (status === "rejected") {
      update.notes = input.notes ?? existing.notes;
    }
    const updated = assertTaxFilingExists(await tx.updateTaxFiling(existing.id, update), existing.id);
    assertTaxFilingLifecycleFacts(updated);
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_filing",
      entityId: updated.id,
      action: status as TaxAuditAction,
      changes: auditChanges(existing, updated, TAX_FILING_AUDIT_FIELDS),
    });
    return taxFilingResponse(tx, updated, businessDate(), true);
  });
}

export async function createTaxFilingAmendment(
  repo: TaxRepository,
  filingId: number,
  input: CreateTaxFilingAmendmentPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
    await tx.lockTaxFiling(filingId);
    const target = await assertTaxFilingAmendmentTarget(tx, filingId);
    const amendment = await tx.createTaxFiling({
      taxRegistrationId: target.taxRegistrationId,
      filingType: target.filingType,
      periodStart: target.periodStart,
      periodEnd: target.periodEnd,
      dueDate: input.dueDate ?? target.dueDate,
      filedAt: null,
      acceptedAt: null,
      confirmationRef: null,
      amendsTaxFilingId: target.id,
      status: "draft",
      notes: input.notes ?? null,
      createdBy: input.actorAdminId,
    });
    runFinanceDomainValidation(() => validateTaxFilingAmendment({
      amendment,
      original: target,
      ancestorFilingIds: [],
    }));
    await writeTaxAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "tax_filing",
      entityId: amendment.id,
      action: "amendment_created",
      changes: auditChanges(null, amendment, TAX_FILING_AUDIT_FIELDS),
    });
    return taxFilingResponse(tx, amendment, businessDate(), true);
  });
}

export async function createTaxExternalRecordRef(
  repo: TaxRepository,
  input: CreateTaxExternalRefPayload & { actorAdminId: number },
) {
  return runTaxTransaction(repo, async (tx) => {
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

export async function getTaxOverview(repo: TaxRepository, today = businessDate()): Promise<TaxOverviewResponse> {
  const [registrations, liabilities, filings] = await Promise.all([
    repo.listTaxRegistrations({ pageSize: 250 }),
    repo.listTaxLiabilities({ pageSize: 250 }),
    repo.listTaxFilings({ pageSize: 250 }),
  ]);
  const liabilityResponses = await Promise.all(liabilities.slice(0, 25).map((item) => taxLiabilityResponse(repo, item, today)));
  const filingResponses = await Promise.all(filings.slice(0, 25).map((item) => taxFilingResponse(repo, item, today)));
  return {
    businessDate: today,
    activeRegistrationCount: registrations.filter((item) => item.status === "active").length,
    effectiveLiabilityTotalsByCurrency: aggregateEffectiveTaxLiabilityTotals(liabilities),
    dueSoonLiabilityCount: liabilities.filter((item) => dueState(item.dueDate, item.status, ["voided"], today) === "due_soon" && isEffectiveTaxLiabilityStatus(item.status)).length,
    overdueLiabilityCount: liabilities.filter((item) => dueState(item.dueDate, item.status, ["voided"], today) === "overdue" && isEffectiveTaxLiabilityStatus(item.status)).length,
    dueSoonFilingCount: filings.filter((item) => dueState(item.dueDate, item.status, ["filed", "accepted", "voided"], today) === "due_soon").length,
    overdueFilingCount: filings.filter((item) => dueState(item.dueDate, item.status, ["filed", "accepted", "voided"], today) === "overdue").length,
    filingStatusCounts: filingStatusCounts(filings),
    openAdjustmentOrDisputeCount: liabilities.filter((item) => item.status === "disputed" || (item.adjustsTaxLiabilityId && item.status !== "voided")).length,
    recentRegistrations: (await Promise.all(registrations.slice(0, 10).map((item) => taxRegistrationResponse(repo, item, today)))).filter(Boolean) as TaxRegistrationResponse[],
    recentLiabilities: liabilityResponses,
    recentFilings: filingResponses,
  };
}
