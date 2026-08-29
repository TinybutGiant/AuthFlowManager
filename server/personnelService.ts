import { z } from "zod";
import type {
  AdminUser,
  CompensationPayBasis,
  CompensationStatus,
  CompensationTerm,
  EmployeeClassification,
  Employment,
  EmploymentStatus,
  InsertCompensationTerm,
  InsertEmployment,
  InsertPersonnelAuditEvent,
  InsertWorker,
  LegalEntity,
  PayrollParticipation,
  PersonnelAuditEvent,
  Worker,
  WorkerLifecycleState,
} from "@shared/schema";

export class PersonnelServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PersonnelServiceError";
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new PersonnelServiceError(statusCode, code, message);
}

const WORKER_AUDIT_FIELDS = [
  "adminUserId",
  "workerCode",
  "legalName",
  "preferredName",
  "personnelEmail",
  "archivedAt",
  "voidedAt",
] as const;

const EMPLOYMENT_AUDIT_FIELDS = [
  "workerId",
  "legalEntityId",
  "employeeClassification",
  "payrollParticipation",
  "status",
  "startDate",
  "endDate",
  "workLocation",
  "primaryWorkState",
  "primaryWorkJurisdiction",
] as const;

const COMPENSATION_AUDIT_FIELDS = [
  "employmentId",
  "payBasis",
  "amountCents",
  "currency",
  "payFrequency",
  "expectedHoursPerWeek",
  "effectiveFrom",
  "effectiveTo",
  "status",
] as const;

const EMPLOYEE_CLASSIFICATIONS = ["employee", "paid_intern", "other_employee"] as const;
const PAYROLL_PARTICIPATION_VALUES = ["not_enrolled", "eligible", "active", "inactive"] as const;
const EMPLOYMENT_STATUSES = ["draft", "active", "on_leave", "ended", "voided"] as const;
const CURRENT_EMPLOYMENT_STATUSES = ["draft", "active", "on_leave"] as const;
const EMPLOYMENT_PAYROLL_PARTICIPATION_BY_STATUS = {
  draft: ["not_enrolled", "eligible", "inactive"],
  active: PAYROLL_PARTICIPATION_VALUES,
  on_leave: PAYROLL_PARTICIPATION_VALUES,
  ended: ["inactive"],
  voided: ["inactive"],
} satisfies Record<EmploymentStatus, readonly PayrollParticipation[]>;
const COMPENSATION_PAY_BASES = ["hourly", "salary", "stipend", "other"] as const;
const COMPENSATION_PAY_FREQUENCIES = [
  "hourly",
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "annual",
  "one_time",
  "other",
] as const;
const COMPENSATION_INITIAL_STATUSES = ["draft", "active"] as const;
const PERSONNEL_AUDIT_ENTITY_TYPES = ["worker", "employment", "compensation_term"] as const;
const PERSONNEL_AUDIT_ACTIONS = [
  "created",
  "updated",
  "archived",
  "voided",
  "activated",
  "placed_on_leave",
  "returned_from_leave",
  "ended",
  "superseded",
] as const;

const positiveIdSchema = z.coerce.number().int().positive();
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

function optionalEmail() {
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
    z.string().email().max(320).nullable().optional(),
  );
}

function nonEmptyPatch(value: Record<string, unknown>) {
  return Object.values(value).some((item) => item !== undefined);
}

function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function previousDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateOnly(date);
}

function refineDateOrder(data: { startDate?: string | null; endDate?: string | null }, ctx: z.RefinementCtx) {
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date cannot be before start date.",
    });
  }
}

function refineEffectiveDateOrder(
  data: { effectiveFrom?: string | null; effectiveTo?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.effectiveFrom && data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "Effective end cannot be before effective start.",
    });
  }
}

export const personnelListQuerySchema = z.object({
  search: optionalText(200),
  lifecycleState: z.enum(["all", "normal", "archived", "merged", "voided"]).default("all"),
  status: optionalText(40),
  adminUserId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  workerId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  legalEntityId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  employmentId: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  pageSize: z.preprocess(
    (value) => value === "" || value === undefined ? 100 : value,
    z.coerce.number().int().min(1).max(250).default(100),
  ),
}).strict();

const workerWriteFields = {
  adminUserId: z.preprocess(
    (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
    z.coerce.number().int().positive().nullable().optional(),
  ),
  workerCode: requiredText(80),
  legalName: requiredText(200),
  preferredName: optionalText(120),
  personnelEmail: optionalEmail(),
};

export const createWorkerPayloadSchema = z.object(workerWriteFields).strict();

export const createWorkerFromAdminUserPayloadSchema = z.object({
  adminUserId: positiveIdSchema,
  workerCode: requiredText(80),
  legalName: workerWriteFields.legalName.optional(),
  preferredName: workerWriteFields.preferredName,
  personnelEmail: workerWriteFields.personnelEmail,
}).strict();

export const updateWorkerPayloadSchema = z.object({
  legalName: workerWriteFields.legalName.optional(),
  preferredName: workerWriteFields.preferredName,
  personnelEmail: workerWriteFields.personnelEmail,
}).strict().refine(nonEmptyPatch, "At least one worker field is required.");

const employmentWriteFields = {
  workerId: positiveIdSchema,
  legalEntityId: positiveIdSchema,
  employeeClassification: z.enum(EMPLOYEE_CLASSIFICATIONS).default("employee"),
  payrollParticipation: z.enum(PAYROLL_PARTICIPATION_VALUES).default("not_enrolled"),
  status: z.literal("draft").default("draft"),
  startDate: dateOnlySchema,
  endDate: optionalDateOnlySchema,
  workLocation: optionalText(200),
  primaryWorkState: optionalText(80),
  primaryWorkJurisdiction: optionalText(120),
};

export const createEmploymentPayloadSchema = z
  .object(employmentWriteFields)
  .strict()
  .superRefine(refineDateOrder);

export const updateEmploymentPayloadSchema = z
  .object({
    legalEntityId: employmentWriteFields.legalEntityId.optional(),
    employeeClassification: z.enum(EMPLOYEE_CLASSIFICATIONS).optional(),
    payrollParticipation: z.enum(PAYROLL_PARTICIPATION_VALUES).optional(),
    startDate: dateOnlySchema.optional(),
    endDate: optionalDateOnlySchema,
    workLocation: employmentWriteFields.workLocation,
    primaryWorkState: employmentWriteFields.primaryWorkState,
    primaryWorkJurisdiction: employmentWriteFields.primaryWorkJurisdiction,
  })
  .strict()
  .refine(nonEmptyPatch, "At least one employment field is required.")
  .superRefine(refineDateOrder);

export const endEmploymentPayloadSchema = z.object({
  endDate: dateOnlySchema,
}).strict();

export const createCompensationTermPayloadSchema = z
  .object({
    employmentId: positiveIdSchema,
    payBasis: z.enum(COMPENSATION_PAY_BASES),
    amountCents: amountCentsSchema,
    currency: currencySchema.default("USD"),
    payFrequency: z.enum(COMPENSATION_PAY_FREQUENCIES),
    expectedHoursPerWeek: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().min(1).max(168).nullable().optional(),
    ),
    effectiveFrom: dateOnlySchema,
    effectiveTo: optionalDateOnlySchema,
    status: z.enum(COMPENSATION_INITIAL_STATUSES).default("draft"),
    supersedeCurrent: z.boolean().default(false),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine(refineEffectiveDateOrder);

export const updateCompensationTermPayloadSchema = z
  .object({
    payBasis: z.enum(COMPENSATION_PAY_BASES).optional(),
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    payFrequency: z.enum(COMPENSATION_PAY_FREQUENCIES).optional(),
    expectedHoursPerWeek: z.preprocess(
      (value) => value === undefined ? undefined : value === "" || value === null ? null : value,
      z.coerce.number().int().min(1).max(168).nullable().optional(),
    ),
    effectiveFrom: dateOnlySchema.optional(),
    effectiveTo: optionalDateOnlySchema,
    notes: optionalText(4000),
  })
  .strict()
  .refine(nonEmptyPatch, "At least one compensation field is required.")
  .superRefine(refineEffectiveDateOrder);

export type PersonnelListQuery = z.infer<typeof personnelListQuerySchema>;
export type PersonnelListFilters = Partial<PersonnelListQuery>;
export type CreateWorkerPayload = z.infer<typeof createWorkerPayloadSchema>;
export type CreateWorkerFromAdminUserPayload = z.infer<typeof createWorkerFromAdminUserPayloadSchema>;
export type UpdateWorkerPayload = z.infer<typeof updateWorkerPayloadSchema>;
export type CreateEmploymentPayload = z.infer<typeof createEmploymentPayloadSchema>;
export type UpdateEmploymentPayload = z.infer<typeof updateEmploymentPayloadSchema>;
export type EndEmploymentPayload = z.infer<typeof endEmploymentPayloadSchema>;
export type CreateCompensationTermPayload = z.infer<typeof createCompensationTermPayloadSchema>;
export type UpdateCompensationTermPayload = z.infer<typeof updateCompensationTermPayloadSchema>;

type PersonnelAuditEntityType = typeof PERSONNEL_AUDIT_ENTITY_TYPES[number];
type PersonnelAuditAction = typeof PERSONNEL_AUDIT_ACTIONS[number];

export interface AdminUserSummary {
  id: number;
  name: string;
  email: string;
  role: string;
  accountType: string;
  status: string;
}

export interface LegalEntitySummary {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
}

export interface WorkerResponse {
  id: number;
  adminUserId: number | null;
  workerCode: string;
  legalName: string;
  preferredName: string | null;
  personnelEmail: string | null;
  lifecycleState: WorkerLifecycleState;
  adminUser: AdminUserSummary | null;
  currentEmployment: EmploymentResponse | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface WorkerDetailResponse extends WorkerResponse {
  employments: EmploymentResponse[];
}

export interface AdminPersonnelResponse {
  adminUser: AdminUserSummary;
  worker: WorkerDetailResponse | null;
}

export interface EmploymentResponse {
  id: number;
  workerId: number;
  legalEntityId: number;
  legalEntity: LegalEntitySummary | null;
  employeeClassification: EmployeeClassification;
  payrollParticipation: PayrollParticipation;
  status: EmploymentStatus;
  startDate: string | Date;
  endDate: string | Date | null;
  workLocation: string | null;
  primaryWorkState: string | null;
  primaryWorkJurisdiction: string | null;
  currentCompensation: CompensationTermResponse | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface CompensationTermResponse {
  id: number;
  employmentId: number;
  payBasis: CompensationPayBasis;
  amountCents: number;
  currency: string;
  payFrequency: string;
  expectedHoursPerWeek: number | null;
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
  status: CompensationStatus;
  notes: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface PersonnelRepository {
  transaction<T>(work: (tx: PersonnelRepository) => Promise<T>): Promise<T>;
  lockAdminUser(id: number): Promise<void>;
  lockWorker(id: number): Promise<void>;
  lockEmployment(id: number): Promise<void>;
  lockCompensationTerm(id: number): Promise<void>;

  getAdminUser(id: number): Promise<AdminUser | undefined>;
  listAdminUsers(filters: PersonnelListFilters): Promise<AdminUser[]>;
  getLegalEntity(id: number): Promise<LegalEntity | undefined>;
  listLegalEntities(): Promise<LegalEntitySummary[]>;

  getWorker(id: number): Promise<Worker | undefined>;
  getWorkerByAdminUserId(adminUserId: number): Promise<Worker | undefined>;
  getWorkerByCode(workerCode: string): Promise<Worker | undefined>;
  listWorkers(filters: PersonnelListFilters): Promise<Worker[]>;
  createWorker(values: InsertWorker): Promise<Worker>;
  updateWorker(id: number, values: Partial<InsertWorker>): Promise<Worker | undefined>;

  getEmployment(id: number): Promise<Employment | undefined>;
  listEmployments(filters: PersonnelListFilters): Promise<Employment[]>;
  findCurrentEmploymentConflict(filters: {
    workerId: number;
    legalEntityId: number;
    excludeEmploymentId?: number;
  }): Promise<Employment | undefined>;
  createEmployment(values: InsertEmployment): Promise<Employment>;
  updateEmployment(id: number, values: Partial<InsertEmployment>): Promise<Employment | undefined>;

  getCompensationTerm(id: number): Promise<CompensationTerm | undefined>;
  listCompensationTerms(filters: PersonnelListFilters): Promise<CompensationTerm[]>;
  listActiveCompensationTermsForEmployment(employmentId: number): Promise<CompensationTerm[]>;
  createCompensationTerm(values: InsertCompensationTerm): Promise<CompensationTerm>;
  updateCompensationTerm(id: number, values: Partial<InsertCompensationTerm>): Promise<CompensationTerm | undefined>;

  createPersonnelAuditEvent(values: InsertPersonnelAuditEvent): Promise<PersonnelAuditEvent>;
}

function serializeAuditValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
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
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[field] = { before: beforeValue, after: afterValue };
    }
  }
  return changes;
}

async function writePersonnelAuditEvent(
  repo: PersonnelRepository,
  input: {
    actorAdminId: number;
    entityType: PersonnelAuditEntityType;
    entityId: number;
    action: PersonnelAuditAction;
    changes: Record<string, unknown>;
  },
) {
  await repo.createPersonnelAuditEvent({
    actorAdminUserId: input.actorAdminId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: input.changes,
  });
}

async function runPersonnelTransaction<T>(
  repo: PersonnelRepository,
  work: (tx: PersonnelRepository) => Promise<T>,
) {
  return await repo.transaction(work);
}

function adminUserSummary(adminUser: AdminUser | undefined | null): AdminUserSummary | null {
  if (!adminUser) return null;
  return {
    id: adminUser.id,
    name: adminUser.name,
    email: adminUser.email,
    role: adminUser.role,
    accountType: adminUser.accountType,
    status: adminUser.status,
  };
}

function legalEntitySummary(entity: LegalEntity | undefined | null): LegalEntitySummary | null {
  if (!entity) return null;
  return {
    id: entity.id,
    legalName: entity.legalName,
    entityType: entity.entityType,
    status: entity.status,
  };
}

export function deriveWorkerLifecycleState(worker: Pick<Worker, "archivedAt" | "voidedAt" | "mergedAt">): WorkerLifecycleState {
  if (worker.voidedAt) return "voided";
  if (worker.mergedAt) return "merged";
  if (worker.archivedAt) return "archived";
  return "normal";
}

function assertWorkerUsable(worker: Worker) {
  const state = deriveWorkerLifecycleState(worker);
  if (state !== "normal") {
    fail(409, "WORKER_NOT_USABLE", "Archived, merged, or voided workers cannot be used for new personnel records.");
  }
}

async function assertAdminUserExists(repo: PersonnelRepository, adminUserId: number) {
  const adminUser = await repo.getAdminUser(adminUserId);
  if (!adminUser) {
    fail(404, "ADMIN_USER_NOT_FOUND", "Admin user not found.");
  }
  return adminUser;
}

async function assertAdminUserLinkAvailable(
  repo: PersonnelRepository,
  adminUserId: number | null | undefined,
  excludeWorkerId?: number,
) {
  if (!adminUserId) return;
  await assertAdminUserExists(repo, adminUserId);
  const existing = await repo.getWorkerByAdminUserId(adminUserId);
  if (existing && existing.id !== excludeWorkerId) {
    fail(409, "ADMIN_USER_ALREADY_LINKED", "This admin user is already linked to a worker.");
  }
}

async function assertWorkerCodeAvailable(
  repo: PersonnelRepository,
  workerCode: string,
  excludeWorkerId?: number,
) {
  const existing = await repo.getWorkerByCode(workerCode);
  if (existing && existing.id !== excludeWorkerId) {
    fail(409, "WORKER_CODE_ALREADY_EXISTS", "Worker code is already in use.");
  }
}

async function assertLegalEntityUsable(repo: PersonnelRepository, legalEntityId: number) {
  const legalEntity = await repo.getLegalEntity(legalEntityId);
  if (!legalEntity || legalEntity.status !== "active") {
    fail(404, "LEGAL_ENTITY_NOT_FOUND", "Active legal entity not found.");
  }
  return legalEntity;
}

async function assertNoCurrentEmploymentConflict(
  repo: PersonnelRepository,
  input: { workerId: number; legalEntityId: number; excludeEmploymentId?: number },
) {
  const conflict = await repo.findCurrentEmploymentConflict(input);
  if (conflict) {
    fail(409, "CURRENT_EMPLOYMENT_CONFLICT", "Worker already has a current employment for this legal entity.");
  }
}

function assertEmploymentDates(startDate: string | Date, endDate?: string | Date | null) {
  const start = String(startDate).slice(0, 10);
  const end = endDate ? String(endDate).slice(0, 10) : null;
  if (end && end < start) {
    fail(400, "EMPLOYMENT_DATES_INVALID", "Employment end date cannot be before start date.");
  }
}

function assertEmploymentPayrollParticipation(status: EmploymentStatus, payrollParticipation: PayrollParticipation) {
  const allowed = EMPLOYMENT_PAYROLL_PARTICIPATION_BY_STATUS[status] as readonly PayrollParticipation[];
  if (!allowed.includes(payrollParticipation)) {
    fail(
      409,
      "EMPLOYMENT_PAYROLL_PARTICIPATION_INVALID",
      "Payroll participation is inconsistent with the employment status.",
    );
  }
}

function nextEmploymentStatus(employment: Employment, action: "activate" | "place_on_leave" | "return" | "end" | "void") {
  switch (action) {
    case "activate":
      if (employment.status !== "draft") {
        fail(409, "EMPLOYMENT_ACTIVATE_REQUIRES_DRAFT", "Only draft employments can be activated.");
      }
      return "active";
    case "place_on_leave":
      if (employment.status !== "active") {
        fail(409, "EMPLOYMENT_LEAVE_REQUIRES_ACTIVE", "Only active employments can be placed on leave.");
      }
      return "on_leave";
    case "return":
      if (employment.status !== "on_leave") {
        fail(409, "EMPLOYMENT_RETURN_REQUIRES_LEAVE", "Only on-leave employments can return to active.");
      }
      return "active";
    case "end":
      if (!["active", "on_leave"].includes(employment.status)) {
        fail(409, "EMPLOYMENT_END_REQUIRES_CURRENT", "Only active or on-leave employments can be ended.");
      }
      return "ended";
    case "void":
      if (employment.status !== "draft") {
        fail(409, "EMPLOYMENT_VOID_REQUIRES_DRAFT", "Only draft employments can be voided.");
      }
      return "voided";
  }
}

function employmentStatusAuditAction(status: EmploymentStatus): PersonnelAuditAction {
  switch (status) {
    case "active":
      return "activated";
    case "on_leave":
      return "placed_on_leave";
    case "ended":
      return "ended";
    case "voided":
      return "voided";
    default:
      return "updated";
  }
}

// Compensation terms use inclusive date intervals: [effectiveFrom, effectiveTo].
// A null effectiveTo is open-ended, and adjacent terms are valid only when the
// earlier term ends before the next term's effectiveFrom date.
function compensationRangesOverlap(
  a: Pick<CompensationTerm, "effectiveFrom" | "effectiveTo"> | Pick<CreateCompensationTermPayload, "effectiveFrom" | "effectiveTo">,
  b: Pick<CompensationTerm, "effectiveFrom" | "effectiveTo"> | Pick<CreateCompensationTermPayload, "effectiveFrom" | "effectiveTo">,
) {
  const aStart = String(a.effectiveFrom).slice(0, 10);
  const aEnd = a.effectiveTo ? String(a.effectiveTo).slice(0, 10) : "9999-12-31";
  const bStart = String(b.effectiveFrom).slice(0, 10);
  const bEnd = b.effectiveTo ? String(b.effectiveTo).slice(0, 10) : "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

function compensationIsCurrent(term: CompensationTerm, today: string) {
  if (term.status !== "active") return false;
  const start = String(term.effectiveFrom).slice(0, 10);
  const end = term.effectiveTo ? String(term.effectiveTo).slice(0, 10) : null;
  return start <= today && (!end || end >= today);
}

async function assertNoCompensationOverlap(
  repo: PersonnelRepository,
  input: Pick<CreateCompensationTermPayload, "employmentId" | "effectiveFrom" | "effectiveTo"> & { excludeTermId?: number },
) {
  const activeTerms = await repo.listActiveCompensationTermsForEmployment(input.employmentId);
  const overlap = activeTerms.find((term) => (
    term.id !== input.excludeTermId &&
    compensationRangesOverlap(input, term)
  ));
  if (overlap) {
    fail(409, "COMPENSATION_TERM_OVERLAP", "Active compensation terms cannot overlap for the same employment.");
  }
}

function compensationResponse(term: CompensationTerm): CompensationTermResponse {
  return {
    id: term.id,
    employmentId: term.employmentId,
    payBasis: term.payBasis as CompensationPayBasis,
    amountCents: term.amountCents,
    currency: term.currency,
    payFrequency: term.payFrequency,
    expectedHoursPerWeek: term.expectedHoursPerWeek,
    effectiveFrom: term.effectiveFrom,
    effectiveTo: term.effectiveTo,
    status: term.status as CompensationStatus,
    notes: term.notes,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

async function employmentResponse(
  repo: PersonnelRepository,
  employment: Employment,
  today = dateOnly(),
): Promise<EmploymentResponse> {
  const [legalEntity, compensationTerms] = await Promise.all([
    repo.getLegalEntity(employment.legalEntityId),
    repo.listCompensationTerms({ employmentId: employment.id, pageSize: 250 }),
  ]);
  const currentCompensation = compensationTerms.find((term) => compensationIsCurrent(term, today)) ?? null;
  return {
    id: employment.id,
    workerId: employment.workerId,
    legalEntityId: employment.legalEntityId,
    legalEntity: legalEntitySummary(legalEntity),
    employeeClassification: employment.employeeClassification as EmployeeClassification,
    payrollParticipation: employment.payrollParticipation as PayrollParticipation,
    status: employment.status as EmploymentStatus,
    startDate: employment.startDate,
    endDate: employment.endDate,
    workLocation: employment.workLocation,
    primaryWorkState: employment.primaryWorkState,
    primaryWorkJurisdiction: employment.primaryWorkJurisdiction,
    currentCompensation: currentCompensation ? compensationResponse(currentCompensation) : null,
    createdAt: employment.createdAt,
    updatedAt: employment.updatedAt,
  };
}

async function workerResponse(
  repo: PersonnelRepository,
  worker: Worker,
  includeEmployments = false,
  today = dateOnly(),
): Promise<WorkerResponse | WorkerDetailResponse> {
  const [adminUser, employments] = await Promise.all([
    worker.adminUserId ? repo.getAdminUser(worker.adminUserId) : Promise.resolve(undefined),
    repo.listEmployments({ workerId: worker.id, pageSize: 250 }),
  ]);
  const employmentDtos = await Promise.all(employments.map((employment) => employmentResponse(repo, employment, today)));
  const currentEmployment = employmentDtos.find((employment) => CURRENT_EMPLOYMENT_STATUSES.includes(
    employment.status as typeof CURRENT_EMPLOYMENT_STATUSES[number],
  )) ?? null;
  const base = {
    id: worker.id,
    adminUserId: worker.adminUserId,
    workerCode: worker.workerCode,
    legalName: worker.legalName,
    preferredName: worker.preferredName,
    personnelEmail: worker.personnelEmail,
    lifecycleState: deriveWorkerLifecycleState(worker),
    adminUser: adminUserSummary(adminUser),
    currentEmployment,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
  return includeEmployments ? { ...base, employments: employmentDtos } : base;
}

export function listPersonnelAdminUsers(repo: PersonnelRepository, query: PersonnelListQuery) {
  return repo.listAdminUsers(query).then((rows) => rows.map((row) => adminUserSummary(row)!));
}

export function listPersonnelLegalEntities(repo: PersonnelRepository) {
  return repo.listLegalEntities();
}

export async function listPersonnelWorkers(repo: PersonnelRepository, query: PersonnelListQuery) {
  const workers = await repo.listWorkers(query);
  return await Promise.all(workers.map((worker) => workerResponse(repo, worker, false)));
}

export async function getPersonnelWorker(repo: PersonnelRepository, workerId: number) {
  const worker = await repo.getWorker(workerId);
  if (!worker) {
    fail(404, "WORKER_NOT_FOUND", "Worker not found.");
  }
  return await workerResponse(repo, worker, true);
}

export async function getPersonnelForAdminUser(repo: PersonnelRepository, adminUserId: number) {
  const adminUser = await assertAdminUserExists(repo, adminUserId);
  const worker = await repo.getWorkerByAdminUserId(adminUserId);
  return {
    adminUser: adminUserSummary(adminUser)!,
    worker: worker ? await workerResponse(repo, worker, true) as WorkerDetailResponse : null,
  } satisfies AdminPersonnelResponse;
}

export async function createPersonnelWorker(
  repo: PersonnelRepository,
  input: CreateWorkerPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    if (payload.adminUserId) {
      await tx.lockAdminUser(payload.adminUserId);
    }
    await assertAdminUserLinkAvailable(tx, payload.adminUserId);
    await assertWorkerCodeAvailable(tx, payload.workerCode);
    const worker = await tx.createWorker({
      ...payload,
      createdBy: actorAdminId,
    });
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "worker",
      entityId: worker.id,
      action: "created",
      changes: auditChanges(null, worker, WORKER_AUDIT_FIELDS),
    });
    return await workerResponse(tx, worker, true);
  });
}

export async function createPersonnelWorkerFromAdminUser(
  repo: PersonnelRepository,
  input: CreateWorkerFromAdminUserPayload & { actorAdminId: number },
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockAdminUser(input.adminUserId);
    const adminUser = await assertAdminUserExists(tx, input.adminUserId);
    await assertAdminUserLinkAvailable(tx, input.adminUserId);
    await assertWorkerCodeAvailable(tx, input.workerCode);
    const worker = await tx.createWorker({
      adminUserId: input.adminUserId,
      workerCode: input.workerCode,
      legalName: input.legalName ?? adminUser.name,
      preferredName: input.preferredName ?? null,
      personnelEmail: input.personnelEmail ?? adminUser.email,
      createdBy: input.actorAdminId,
    });
    await writePersonnelAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "worker",
      entityId: worker.id,
      action: "created",
      changes: auditChanges(null, worker, WORKER_AUDIT_FIELDS),
    });
    return await workerResponse(tx, worker, true);
  });
}

export async function updatePersonnelWorker(
  repo: PersonnelRepository,
  workerId: number,
  input: UpdateWorkerPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockWorker(workerId);
    const existing = await tx.getWorker(workerId);
    if (!existing) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    assertWorkerUsable(existing);
    const updated = await tx.updateWorker(workerId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertWorker>);
    if (!updated) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "worker",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, WORKER_AUDIT_FIELDS),
    });
    return await workerResponse(tx, updated, true);
  });
}

export async function archivePersonnelWorker(
  repo: PersonnelRepository,
  workerId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockWorker(workerId);
    const existing = await tx.getWorker(workerId);
    if (!existing) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    if (existing.archivedAt) {
      return await workerResponse(tx, existing, true);
    }
    assertWorkerUsable(existing);
    const currentEmployments = await tx.listEmployments({ workerId, pageSize: 250 });
    if (currentEmployments.some((employment) => CURRENT_EMPLOYMENT_STATUSES.includes(
      employment.status as typeof CURRENT_EMPLOYMENT_STATUSES[number],
    ))) {
      fail(409, "WORKER_ARCHIVE_HAS_CURRENT_EMPLOYMENT", "Workers with current employments cannot be archived.");
    }
    const updated = await tx.updateWorker(workerId, { archivedAt: now, updatedAt: now } as Partial<InsertWorker>);
    if (!updated) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "worker",
      entityId: updated.id,
      action: "archived",
      changes: auditChanges(existing, updated, WORKER_AUDIT_FIELDS),
    });
    return await workerResponse(tx, updated, true);
  });
}

export async function voidPersonnelWorker(
  repo: PersonnelRepository,
  workerId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockWorker(workerId);
    const existing = await tx.getWorker(workerId);
    if (!existing) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    if (existing.voidedAt) {
      return await workerResponse(tx, existing, true);
    }
    if (existing.archivedAt || existing.mergedAt) {
      fail(409, "WORKER_TERMINAL_STATE", "Archived or merged workers cannot be voided.");
    }
    const employments = await tx.listEmployments({ workerId, pageSize: 250 });
    if (employments.length > 0) {
      fail(409, "WORKER_VOID_HAS_EMPLOYMENT_HISTORY", "Workers with employment history cannot be voided.");
    }
    const updated = await tx.updateWorker(workerId, { voidedAt: now, updatedAt: now } as Partial<InsertWorker>);
    if (!updated) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "worker",
      entityId: updated.id,
      action: "voided",
      changes: auditChanges(existing, updated, WORKER_AUDIT_FIELDS),
    });
    return await workerResponse(tx, updated, true);
  });
}

export async function listPersonnelEmployments(repo: PersonnelRepository, query: PersonnelListQuery) {
  const employments = await repo.listEmployments(query);
  return await Promise.all(employments.map((employment) => employmentResponse(repo, employment)));
}

export async function createPersonnelEmployment(
  repo: PersonnelRepository,
  input: CreateEmploymentPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockWorker(payload.workerId);
    const worker = await tx.getWorker(payload.workerId);
    if (!worker) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    assertWorkerUsable(worker);
    await assertLegalEntityUsable(tx, payload.legalEntityId);
    await assertNoCurrentEmploymentConflict(tx, {
      workerId: payload.workerId,
      legalEntityId: payload.legalEntityId,
    });
    assertEmploymentDates(payload.startDate, payload.endDate);
    assertEmploymentPayrollParticipation(
      (payload.status ?? "draft") as EmploymentStatus,
      (payload.payrollParticipation ?? "not_enrolled") as PayrollParticipation,
    );
    const employment = await tx.createEmployment({
      ...payload,
      createdBy: actorAdminId,
    });
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "employment",
      entityId: employment.id,
      action: "created",
      changes: auditChanges(null, employment, EMPLOYMENT_AUDIT_FIELDS),
    });
    return await employmentResponse(tx, employment);
  });
}

export async function updatePersonnelEmployment(
  repo: PersonnelRepository,
  employmentId: number,
  input: UpdateEmploymentPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockEmployment(employmentId);
    const existing = await tx.getEmployment(employmentId);
    if (!existing) {
      fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
    }
    if (existing.status === "ended" || existing.status === "voided") {
      fail(409, "EMPLOYMENT_TERMINAL_STATE", "Ended or voided employments cannot be edited.");
    }
    if (existing.status !== "draft") {
      for (const field of ["legalEntityId", "employeeClassification", "startDate", "endDate"] as const) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
          fail(409, "EMPLOYMENT_COMMITTED_FIELD_IMMUTABLE", "Committed employment identity and date fields require lifecycle actions.");
        }
      }
    }
    const merged = {
      ...existing,
      ...payload,
    };
    assertEmploymentDates(merged.startDate, merged.endDate);
    assertEmploymentPayrollParticipation(
      merged.status as EmploymentStatus,
      merged.payrollParticipation as PayrollParticipation,
    );
    if (payload.legalEntityId) {
      await assertLegalEntityUsable(tx, payload.legalEntityId);
    }
    if (existing.status === "draft") {
      await assertNoCurrentEmploymentConflict(tx, {
        workerId: existing.workerId,
        legalEntityId: merged.legalEntityId,
        excludeEmploymentId: employmentId,
      });
    }
    const updated = await tx.updateEmployment(employmentId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertEmployment>);
    if (!updated) {
      fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "employment",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, EMPLOYMENT_AUDIT_FIELDS),
    });
    return await employmentResponse(tx, updated);
  });
}

export async function transitionPersonnelEmployment(
  repo: PersonnelRepository,
  employmentId: number,
  action: "activate" | "place_on_leave" | "return" | "end" | "void",
  input: Partial<EndEmploymentPayload> & { actorAdminId: number },
  now = new Date(),
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockEmployment(employmentId);
    const existing = await tx.getEmployment(employmentId);
    if (!existing) {
      fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
    }
    await tx.lockWorker(existing.workerId);
    const worker = await tx.getWorker(existing.workerId);
    if (!worker) {
      fail(404, "WORKER_NOT_FOUND", "Worker not found.");
    }
    assertWorkerUsable(worker);
    const nextStatus = nextEmploymentStatus(existing, action) as EmploymentStatus;
    if (nextStatus === "active") {
      await assertNoCurrentEmploymentConflict(tx, {
        workerId: existing.workerId,
        legalEntityId: existing.legalEntityId,
        excludeEmploymentId: employmentId,
      });
    }
    const updateValues: Partial<InsertEmployment> = {
      status: nextStatus,
      updatedAt: now,
    } as Partial<InsertEmployment>;
    if (action === "end") {
      if (!input.endDate) {
        fail(400, "EMPLOYMENT_END_DATE_REQUIRED", "End date is required when ending employment.");
      }
      assertEmploymentDates(existing.startDate, input.endDate);
      updateValues.endDate = input.endDate;
      updateValues.payrollParticipation = "inactive";
    }
    if (action === "void") {
      updateValues.payrollParticipation = "inactive";
    }
    assertEmploymentPayrollParticipation(
      nextStatus,
      (updateValues.payrollParticipation ?? existing.payrollParticipation) as PayrollParticipation,
    );
    const updated = await tx.updateEmployment(employmentId, updateValues);
    if (!updated) {
      fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId: input.actorAdminId,
      entityType: "employment",
      entityId: updated.id,
      action: action === "return" ? "returned_from_leave" : employmentStatusAuditAction(nextStatus),
      changes: auditChanges(existing, updated, EMPLOYMENT_AUDIT_FIELDS),
    });
    return await employmentResponse(tx, updated);
  });
}

export async function listPersonnelCompensationTerms(repo: PersonnelRepository, query: PersonnelListQuery) {
  return (await repo.listCompensationTerms(query)).map(compensationResponse);
}

async function assertEmploymentAcceptsCompensation(repo: PersonnelRepository, employmentId: number) {
  const employment = await repo.getEmployment(employmentId);
  if (!employment) {
    fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
  }
  if (employment.status === "ended" || employment.status === "voided") {
    fail(409, "EMPLOYMENT_NOT_COMPENSABLE", "Ended or voided employments cannot receive new compensation terms.");
  }
  return employment;
}

async function supersedeOverlappingCurrentCompensation(
  repo: PersonnelRepository,
  input: CreateCompensationTermPayload & { actorAdminId: number },
) {
  const activeTerms = await repo.listActiveCompensationTermsForEmployment(input.employmentId);
  const overlapping = activeTerms.filter((term) => compensationRangesOverlap(input, term));
  for (const term of overlapping) {
    const termStart = String(term.effectiveFrom).slice(0, 10);
    if (termStart >= input.effectiveFrom) {
      fail(409, "COMPENSATION_SUPERSEDE_ORDER_INVALID", "A new compensation term must start after the term it supersedes.");
    }
    const updated = await repo.updateCompensationTerm(term.id, {
      effectiveTo: previousDateOnly(input.effectiveFrom),
      status: "superseded",
      updatedAt: new Date(),
    } as Partial<InsertCompensationTerm>);
    if (!updated) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    await writePersonnelAuditEvent(repo, {
      actorAdminId: input.actorAdminId,
      entityType: "compensation_term",
      entityId: updated.id,
      action: "superseded",
      changes: auditChanges(term, updated, COMPENSATION_AUDIT_FIELDS),
    });
  }
}

export async function createPersonnelCompensationTerm(
  repo: PersonnelRepository,
  input: CreateCompensationTermPayload & { actorAdminId: number },
) {
  const { actorAdminId, supersedeCurrent, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockEmployment(payload.employmentId);
    await assertEmploymentAcceptsCompensation(tx, payload.employmentId);
    if (payload.status === "active" && supersedeCurrent) {
      await supersedeOverlappingCurrentCompensation(tx, input);
    }
    if (payload.status === "active") {
      await assertNoCompensationOverlap(tx, payload);
    }
    const term = await tx.createCompensationTerm({
      ...payload,
      createdBy: actorAdminId,
    });
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "compensation_term",
      entityId: term.id,
      action: "created",
      changes: auditChanges(null, term, COMPENSATION_AUDIT_FIELDS),
    });
    return compensationResponse(term);
  });
}

export async function updateDraftPersonnelCompensationTerm(
  repo: PersonnelRepository,
  termId: number,
  input: UpdateCompensationTermPayload & { actorAdminId: number },
) {
  const { actorAdminId, ...payload } = input;
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockCompensationTerm(termId);
    const existing = await tx.getCompensationTerm(termId);
    if (!existing) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    if (existing.status !== "draft") {
      fail(409, "COMPENSATION_TERM_NOT_DRAFT", "Only draft compensation terms can be edited.");
    }
    const merged = {
      ...existing,
      ...payload,
    };
    if (merged.effectiveTo && String(merged.effectiveTo).slice(0, 10) < String(merged.effectiveFrom).slice(0, 10)) {
      fail(400, "COMPENSATION_DATES_INVALID", "Effective end cannot be before effective start.");
    }
    const updated = await tx.updateCompensationTerm(termId, {
      ...payload,
      updatedAt: new Date(),
    } as Partial<InsertCompensationTerm>);
    if (!updated) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "compensation_term",
      entityId: updated.id,
      action: "updated",
      changes: auditChanges(existing, updated, COMPENSATION_AUDIT_FIELDS),
    });
    return compensationResponse(updated);
  });
}

export async function activatePersonnelCompensationTerm(
  repo: PersonnelRepository,
  termId: number,
  actorAdminId: number,
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockCompensationTerm(termId);
    const existing = await tx.getCompensationTerm(termId);
    if (!existing) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    if (existing.status !== "draft") {
      fail(409, "COMPENSATION_ACTIVATE_REQUIRES_DRAFT", "Only draft compensation terms can be activated.");
    }
    await tx.lockEmployment(existing.employmentId);
    await assertEmploymentAcceptsCompensation(tx, existing.employmentId);
    await assertNoCompensationOverlap(tx, {
      employmentId: existing.employmentId,
      effectiveFrom: String(existing.effectiveFrom).slice(0, 10),
      effectiveTo: existing.effectiveTo ? String(existing.effectiveTo).slice(0, 10) : null,
      excludeTermId: termId,
    });
    const updated = await tx.updateCompensationTerm(termId, {
      status: "active",
      updatedAt: new Date(),
    } as Partial<InsertCompensationTerm>);
    if (!updated) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "compensation_term",
      entityId: updated.id,
      action: "activated",
      changes: auditChanges(existing, updated, COMPENSATION_AUDIT_FIELDS),
    });
    return compensationResponse(updated);
  });
}

export async function voidPersonnelCompensationTerm(
  repo: PersonnelRepository,
  termId: number,
  actorAdminId: number,
  now = new Date(),
) {
  return await runPersonnelTransaction(repo, async (tx) => {
    await tx.lockCompensationTerm(termId);
    const existing = await tx.getCompensationTerm(termId);
    if (!existing) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    if (existing.status === "voided") {
      return compensationResponse(existing);
    }
    if (existing.status !== "draft") {
      fail(409, "COMPENSATION_VOID_REQUIRES_DRAFT", "Only draft compensation terms can be voided.");
    }
    const updated = await tx.updateCompensationTerm(termId, {
      status: "voided",
      updatedAt: now,
    } as Partial<InsertCompensationTerm>);
    if (!updated) {
      fail(404, "COMPENSATION_TERM_NOT_FOUND", "Compensation term not found.");
    }
    await writePersonnelAuditEvent(tx, {
      actorAdminId,
      entityType: "compensation_term",
      entityId: updated.id,
      action: "voided",
      changes: auditChanges(existing, updated, COMPENSATION_AUDIT_FIELDS),
    });
    return compensationResponse(updated);
  });
}

export const personnelResponseSanityFields = [
  "passwordHash",
  "passwordSetupTokenHash",
  "ssn",
  "bankAccount",
  "passport",
  "i94",
  "uscis",
  "alienNumber",
] as const;
