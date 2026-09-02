import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  pgEnum,
  serial,
  integer,
  boolean,
  date,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for JWT authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isActive: varchar("is_active").default('true').notNull(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type InsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Admin role enum
export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'admin_finance', 
  'admin_verifier',
  'admin_support',
  'trainee_access'
]);

// Admin status enum
export const adminStatusEnum = pgEnum('admin_status', [
  'pending',
  'active', 
  'inactive',
  'rejected'
]);

// Admin users table
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordSetupTokenHash: text("password_setup_token_hash"),
  passwordSetupExpiresAt: timestamp("password_setup_expires_at"),
  role: adminRoleEnum("role").notNull(),
  accountType: text("account_type").notNull().default("admin_staff"),
  status: adminStatusEnum("status").notNull().default('pending'),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
  permissions: text("permissions").array(),
});

// Admin user approvals table
export const adminUserApprovals = pgTable("admin_user_approvals", {
  id: serial("id").primaryKey(),
  targetAdminId: integer("target_admin_id").notNull(),
  action: varchar("action", { length: 50 }).notNull(), // 'create', 'change_role', 'delete'
  requestedBy: integer("requested_by").notNull(),
  approvedBy: integer("approved_by"),
  status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending', 'approved', 'rejected'
  requestData: jsonb("request_data"), // Store additional data like old/new role
  createdAt: timestamp("created_at").defaultNow(),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
});

export const adminUserAccessGrants = pgTable(
  "admin_user_access_grants",
  {
    id: serial("id").primaryKey(),
    adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
    accessGroup: text("access_group").notNull(),
    source: text("source"),
    metadata: jsonb("metadata").notNull().default({}),
    grantedBy: integer("granted_by").references(() => adminUsers.id),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    revokedBy: integer("revoked_by").references(() => adminUsers.id),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_admin_user_access_grants_admin_user_id").on(table.adminUserId),
    index("idx_admin_user_access_grants_access_group").on(table.accessGroup),
    uniqueIndex("idx_admin_user_access_grants_active_unique")
      .on(table.adminUserId, table.accessGroup)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const adminEngagements = pgTable("admin_engagements", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
  engagementType: text("engagement_type").notNull(),
  scheduleType: text("schedule_type"),
  workAuthorizationType: text("work_authorization_type").notNull().default("none"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  supervisorAdminId: integer("supervisor_admin_id").references(() => adminUsers.id),
  workScope: text("work_scope"),
  positionTitle: text("position_title"),
  schoolName: text("school_name"),
  programOrMajor: text("program_or_major"),
  responseDeadline: date("response_deadline"),
  workLocation: text("work_location"),
  expectedHoursPerWeek: integer("expected_hours_per_week"),
  status: text("status").notNull().default("draft"),
  endedAt: timestamp("ended_at"),
  createdBy: integer("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const adminLifecycleEvents = pgTable("admin_lifecycle_events", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
  engagementId: integer("engagement_id").references(() => adminEngagements.id),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  actorAdminId: integer("actor_admin_id").references(() => adminUsers.id),
  metadata: jsonb("metadata").notNull().default({}),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const adminActivityLogs = pgTable("admin_activity_logs", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => adminEngagements.id),
  adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
  activityType: text("activity_type").notNull(),
  activityDate: date("activity_date").notNull(),
  durationMinutes: integer("duration_minutes"),
  summary: text("summary").notNull(),
  learningObjective: text("learning_objective"),
  status: text("status").notNull().default("submitted"),
  reviewedBy: integer("reviewed_by").references(() => adminUsers.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const supervisorFeedbackSlots = pgTable(
  "supervisor_feedback_slots",
  {
    id: serial("id").primaryKey(),
    supervisorAdminId: integer("supervisor_admin_id").notNull().references(() => adminUsers.id),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_supervisor_feedback_slots_supervisor").on(table.supervisorAdminId),
    index("idx_supervisor_feedback_slots_status").on(table.status),
  ],
);

export const engagementFeedbackSchedules = pgTable(
  "engagement_feedback_schedules",
  {
    id: serial("id").primaryKey(),
    engagementId: integer("engagement_id").notNull().references(() => adminEngagements.id),
    adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
    supervisorAdminId: integer("supervisor_admin_id").notNull().references(() => adminUsers.id),
    frequencyPerWeek: integer("frequency_per_week").notNull(),
    timezone: text("timezone").notNull(),
    selectedSlots: jsonb("selected_slots").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("confirmed"),
    changeRequestNote: text("change_request_note"),
    confirmedAt: timestamp("confirmed_at"),
    changeRequestedAt: timestamp("change_requested_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_engagement_feedback_schedules_engagement").on(table.engagementId),
    index("idx_engagement_feedback_schedules_admin_user").on(table.adminUserId),
    index("idx_engagement_feedback_schedules_supervisor").on(table.supervisorAdminId),
    index("idx_engagement_feedback_schedules_status").on(table.status),
  ],
);

export const feedbackMeetingOccurrences = pgTable(
  "feedback_meeting_occurrences",
  {
    id: serial("id").primaryKey(),
    scheduleId: integer("schedule_id").notNull().references(() => engagementFeedbackSchedules.id),
    engagementId: integer("engagement_id").notNull().references(() => adminEngagements.id),
    adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
    supervisorAdminId: integer("supervisor_admin_id").notNull().references(() => adminUsers.id),
    occurrenceDate: date("occurrence_date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("scheduled"),
    absenceReason: text("absence_reason"),
    absenceNote: text("absence_note"),
    absenceRequestedAt: timestamp("absence_requested_at"),
    statusUpdatedBy: integer("status_updated_by").references(() => adminUsers.id),
    statusUpdatedAt: timestamp("status_updated_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_feedback_meeting_occurrences_schedule").on(table.scheduleId),
    index("idx_feedback_meeting_occurrences_engagement").on(table.engagementId),
    index("idx_feedback_meeting_occurrences_admin_user").on(table.adminUserId),
    index("idx_feedback_meeting_occurrences_supervisor").on(table.supervisorAdminId),
    index("idx_feedback_meeting_occurrences_status").on(table.status),
    index("idx_feedback_meeting_occurrences_date").on(table.occurrenceDate),
  ],
);

export const adminDocumentTemplates = pgTable("admin_document_templates", {
  id: serial("id").primaryKey(),
  documentType: text("document_type").notNull().default("offer_letter"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  titleTemplate: text("title_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  contentFormat: text("content_format").notNull().default("plain_text"),
  allowedVariables: jsonb("allowed_variables").notNull().default(sql`'[]'::jsonb`),
  createdBy: integer("created_by").references(() => adminUsers.id),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const adminEngagementDocuments = pgTable("admin_engagement_documents", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => adminEngagements.id),
  adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id),
  documentType: text("document_type").notNull().default("offer_letter"),
  status: text("status").notNull().default("draft"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  templateId: integer("template_id").references(() => adminDocumentTemplates.id),
  templateVersion: integer("template_version"),
  templateNameSnapshot: text("template_name_snapshot"),
  templateTitleSnapshot: text("template_title_snapshot"),
  templateBodySnapshot: text("template_body_snapshot"),
  mergeData: jsonb("merge_data"),
  contentFormat: text("content_format").notNull().default("plain_text"),
  fileKey: text("file_key"),
  fileSha256: text("file_sha256"),
  fileContentType: text("file_content_type").default("application/pdf"),
  fileSizeBytes: integer("file_size_bytes"),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: integer("accepted_by").references(() => adminUsers.id),
  acceptedIp: text("accepted_ip"),
  acceptedUserAgent: text("accepted_user_agent"),
  declinedAt: timestamp("declined_at"),
  voidedAt: timestamp("voided_at"),
  voidedBy: integer("voided_by").references(() => adminUsers.id),
  createdBy: integer("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const legalEntities = pgTable("legal_entities", {
  id: serial("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  entityType: text("entity_type").notNull().default("llc"),
  formationState: text("formation_state"),
  maskedTaxIdentifier: text("masked_tax_identifier"),
  status: text("status").notNull().default("active"),
  createdBy: integer("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    vendorType: text("vendor_type").notNull().default("other"),
    status: text("status").notNull().default("active"),
    website: text("website"),
    contactEmail: text("contact_email"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_vendors_status").on(table.status),
  ],
);

export const taxAgencies = pgTable(
  "tax_agencies",
  {
    id: serial("id").primaryKey(),
    agencyCode: text("agency_code").notNull(),
    name: text("name").notNull(),
    jurisdictionType: text("jurisdiction_type").notNull(),
    jurisdictionCode: text("jurisdiction_code").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_tax_agencies_code_unique").on(table.agencyCode),
    index("idx_tax_agencies_status").on(table.status),
  ],
);

export const workers = pgTable(
  "workers",
  {
    id: serial("id").primaryKey(),
    adminUserId: integer("admin_user_id").references(() => adminUsers.id),
    workerCode: text("worker_code").notNull(),
    legalName: text("legal_name").notNull(),
    preferredName: text("preferred_name"),
    personnelEmail: text("personnel_email"),
    archivedAt: timestamp("archived_at"),
    voidedAt: timestamp("voided_at"),
    mergedIntoWorkerId: integer("merged_into_worker_id").references((): AnyPgColumn => workers.id),
    mergedAt: timestamp("merged_at"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_workers_admin_user_unique").on(table.adminUserId).where(sql`${table.adminUserId} IS NOT NULL`),
    uniqueIndex("idx_workers_code_unique").on(table.workerCode),
    index("idx_workers_merged_into_worker").on(table.mergedIntoWorkerId),
  ],
);

export const employments = pgTable(
  "employments",
  {
    id: serial("id").primaryKey(),
    workerId: integer("worker_id").notNull().references(() => workers.id),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    employeeClassification: text("employee_classification").notNull().default("employee"),
    payrollParticipation: text("payroll_participation").notNull().default("not_enrolled"),
    status: text("status").notNull().default("draft"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    workLocation: text("work_location"),
    primaryWorkState: text("primary_work_state"),
    primaryWorkJurisdiction: text("primary_work_jurisdiction"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_employments_worker").on(table.workerId),
    index("idx_employments_legal_entity").on(table.legalEntityId),
    index("idx_employments_status").on(table.status),
    uniqueIndex("idx_employments_one_current_per_worker_entity")
      .on(table.workerId, table.legalEntityId)
      .where(sql`${table.status} IN ('draft', 'active', 'on_leave')`),
  ],
);

export const compensationTerms = pgTable(
  "compensation_terms",
  {
    id: serial("id").primaryKey(),
    employmentId: integer("employment_id").notNull().references(() => employments.id),
    payBasis: text("pay_basis").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    payFrequency: text("pay_frequency").notNull(),
    expectedHoursPerWeek: integer("expected_hours_per_week"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_compensation_terms_employment").on(table.employmentId),
    index("idx_compensation_terms_effective_dates").on(table.effectiveFrom, table.effectiveTo),
  ],
);

export const workAuthorizations = pgTable(
  "work_authorizations",
  {
    id: serial("id").primaryKey(),
    workerId: integer("worker_id").notNull().references(() => workers.id),
    employmentId: integer("employment_id").references(() => employments.id),
    adminEngagementId: integer("admin_engagement_id").references(() => adminEngagements.id),
    authorizationType: text("authorization_type").notNull(),
    status: text("status").notNull().default("draft"),
    validFrom: date("valid_from"),
    validThrough: date("valid_through"),
    worksiteScope: text("worksite_scope"),
    maskedExternalRef: text("masked_external_ref"),
    restrictedNotes: text("restricted_notes"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    supersedesWorkAuthorizationId: integer("supersedes_work_authorization_id").references((): AnyPgColumn => workAuthorizations.id),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_work_authorizations_worker").on(table.workerId),
    index("idx_work_authorizations_employment").on(table.employmentId),
    index("idx_work_authorizations_admin_engagement").on(table.adminEngagementId),
    index("idx_work_authorizations_valid_through").on(table.validThrough),
    index("idx_work_authorizations_supersedes").on(table.supersedesWorkAuthorizationId),
  ],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date").notNull(),
    runKind: text("run_kind").notNull().default("regular"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceVendorId: integer("source_vendor_id").references(() => vendors.id),
    correctionOfPayrollRunId: integer("correction_of_payroll_run_id").references((): AnyPgColumn => payrollRuns.id),
    status: text("status").notNull().default("draft"),
    finalizedAt: timestamp("finalized_at"),
    finalizedBy: integer("finalized_by").references(() => adminUsers.id),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_runs_legal_entity").on(table.legalEntityId),
    index("idx_payroll_runs_status").on(table.status),
    index("idx_payroll_runs_correction_of").on(table.correctionOfPayrollRunId),
  ],
);

export const payrollRunWorkers = pgTable(
  "payroll_run_workers",
  {
    id: serial("id").primaryKey(),
    payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id),
    workerId: integer("worker_id").notNull().references(() => workers.id),
    employmentId: integer("employment_id").notNull().references(() => employments.id),
    currency: text("currency").notNull().default("USD"),
    grossPayCents: integer("gross_pay_cents").notNull().default(0),
    employeeTaxCents: integer("employee_tax_cents").notNull().default(0),
    employerTaxCents: integer("employer_tax_cents").notNull().default(0),
    deductionCents: integer("deduction_cents").notNull().default(0),
    netPayCents: integer("net_pay_cents").notNull().default(0),
    sourceMetadata: jsonb("source_metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_payroll_run_workers_run_employment_unique").on(table.payrollRunId, table.employmentId),
    index("idx_payroll_run_workers_worker").on(table.workerId),
    index("idx_payroll_run_workers_employment").on(table.employmentId),
  ],
);

export const payrollResultLines = pgTable(
  "payroll_result_lines",
  {
    id: serial("id").primaryKey(),
    payrollRunWorkerId: integer("payroll_run_worker_id").notNull().references(() => payrollRunWorkers.id),
    lineCategory: text("line_category").notNull(),
    lineCode: text("line_code").notNull(),
    description: text("description"),
    amountEffect: text("amount_effect").notNull().default("increase"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    quantityMicrounits: integer("quantity_microunits"),
    rateAmountCents: integer("rate_amount_cents"),
    jurisdictionCode: text("jurisdiction_code"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_result_lines_run_worker").on(table.payrollRunWorkerId),
    index("idx_payroll_result_lines_category").on(table.lineCategory),
  ],
);

export const payrollPayments = pgTable(
  "payroll_payments",
  {
    id: serial("id").primaryKey(),
    payrollRunWorkerId: integer("payroll_run_worker_id").notNull().references(() => payrollRunWorkers.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    paymentDate: date("payment_date"),
    methodType: text("method_type").notNull(),
    methodLabel: text("method_label"),
    institutionName: text("institution_name"),
    maskedLast4: text("masked_last4"),
    externalConfirmationRef: text("external_confirmation_ref"),
    status: text("status").notNull().default("pending"),
    processedAt: timestamp("processed_at"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_payments_run_worker").on(table.payrollRunWorkerId),
    index("idx_payroll_payments_status").on(table.status),
  ],
);

export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    taxAgencyId: integer("tax_agency_id").notNull().references(() => taxAgencies.id),
    taxType: text("tax_type").notNull(),
    jurisdictionType: text("jurisdiction_type").notNull(),
    jurisdictionCode: text("jurisdiction_code").notNull(),
    maskedAccountRef: text("masked_account_ref"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("pending"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_tax_registrations_legal_entity").on(table.legalEntityId),
    index("idx_tax_registrations_agency").on(table.taxAgencyId),
    index("idx_tax_registrations_tax_type").on(table.taxType),
  ],
);

export const taxLiabilities = pgTable(
  "tax_liabilities",
  {
    id: serial("id").primaryKey(),
    taxRegistrationId: integer("tax_registration_id").notNull().references(() => taxRegistrations.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date"),
    component: text("component").notNull(),
    amountEffect: text("amount_effect").notNull().default("increase"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceMetadata: jsonb("source_metadata").notNull().default(sql`'{}'::jsonb`),
    adjustsTaxLiabilityId: integer("adjusts_tax_liability_id").references((): AnyPgColumn => taxLiabilities.id),
    status: text("status").notNull().default("draft"),
    recognizedAt: timestamp("recognized_at"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_tax_liabilities_registration").on(table.taxRegistrationId),
    index("idx_tax_liabilities_period").on(table.periodStart, table.periodEnd),
    index("idx_tax_liabilities_adjusts").on(table.adjustsTaxLiabilityId),
  ],
);

export const taxAgencyPayments = pgTable(
  "tax_agency_payments",
  {
    id: serial("id").primaryKey(),
    taxRegistrationId: integer("tax_registration_id").notNull().references(() => taxRegistrations.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    paymentDate: date("payment_date"),
    methodType: text("method_type").notNull(),
    methodLabel: text("method_label"),
    institutionName: text("institution_name"),
    maskedLast4: text("masked_last4"),
    confirmationRef: text("confirmation_ref"),
    status: text("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at"),
    clearedAt: timestamp("cleared_at"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_tax_agency_payments_registration").on(table.taxRegistrationId),
    index("idx_tax_agency_payments_status").on(table.status),
  ],
);

export const taxPaymentAllocations = pgTable(
  "tax_payment_allocations",
  {
    id: serial("id").primaryKey(),
    taxLiabilityId: integer("tax_liability_id").notNull().references(() => taxLiabilities.id),
    taxAgencyPaymentId: integer("tax_agency_payment_id").notNull().references(() => taxAgencyPayments.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("active"),
    reversedAt: timestamp("reversed_at"),
    reversedBy: integer("reversed_by").references(() => adminUsers.id),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_tax_payment_allocations_active_unique")
      .on(table.taxLiabilityId, table.taxAgencyPaymentId)
      .where(sql`${table.status} = 'active'`),
    index("idx_tax_payment_allocations_liability").on(table.taxLiabilityId),
    index("idx_tax_payment_allocations_payment").on(table.taxAgencyPaymentId),
  ],
);

export const taxFilings = pgTable(
  "tax_filings",
  {
    id: serial("id").primaryKey(),
    taxRegistrationId: integer("tax_registration_id").notNull().references(() => taxRegistrations.id),
    filingType: text("filing_type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date"),
    filedAt: timestamp("filed_at"),
    acceptedAt: timestamp("accepted_at"),
    confirmationRef: text("confirmation_ref"),
    amendsTaxFilingId: integer("amends_tax_filing_id").references((): AnyPgColumn => taxFilings.id),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_tax_filings_original_unique")
      .on(table.taxRegistrationId, table.filingType, table.periodStart, table.periodEnd)
      .where(sql`${table.amendsTaxFilingId} IS NULL AND ${table.status} <> 'voided'`),
    index("idx_tax_filings_registration").on(table.taxRegistrationId),
    index("idx_tax_filings_amends").on(table.amendsTaxFilingId),
  ],
);

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id),
    name: text("name").notNull(),
    categoryCode: text("category_code").notNull(),
    cadence: text("cadence").notNull(),
    expectedAmountCents: integer("expected_amount_cents"),
    currency: text("currency").notNull().default("USD"),
    variableAmount: boolean("variable_amount").notNull().default(false),
    billingDay: integer("billing_day"),
    nextBillingDate: date("next_billing_date"),
    renewalDate: date("renewal_date"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    trialEndsOn: date("trial_ends_on"),
    cancellationDate: date("cancellation_date"),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_recurring_expenses_vendor").on(table.vendorId),
    index("idx_recurring_expenses_legal_entity").on(table.legalEntityId),
    index("idx_recurring_expenses_status").on(table.status),
  ],
);

export const vendorBills = pgTable(
  "vendor_bills",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id),
    recurringExpenseId: integer("recurring_expense_id").references(() => recurringExpenses.id),
    invoiceNumber: text("invoice_number"),
    billKind: text("bill_kind").notNull().default("invoice"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    servicePeriodStart: date("service_period_start"),
    servicePeriodEnd: date("service_period_end"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    categoryCode: text("category_code").notNull(),
    status: text("status").notNull().default("draft"),
    creditForVendorBillId: integer("credit_for_vendor_bill_id").references((): AnyPgColumn => vendorBills.id),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_vendor_bills_vendor").on(table.vendorId),
    index("idx_vendor_bills_legal_entity").on(table.legalEntityId),
    index("idx_vendor_bills_recurring_expense").on(table.recurringExpenseId),
    index("idx_vendor_bills_status").on(table.status),
  ],
);

export const expensePayments = pgTable(
  "expense_payments",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id),
    vendorId: integer("vendor_id").references(() => vendors.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    direction: text("direction").notNull().default("outflow"),
    paymentDate: date("payment_date"),
    methodType: text("method_type").notNull(),
    methodLabel: text("method_label"),
    institutionName: text("institution_name"),
    maskedLast4: text("masked_last4"),
    externalConfirmationRef: text("external_confirmation_ref"),
    status: text("status").notNull().default("pending"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_expense_payments_vendor").on(table.vendorId),
    index("idx_expense_payments_legal_entity").on(table.legalEntityId),
    index("idx_expense_payments_status").on(table.status),
  ],
);

export const vendorBillApplications = pgTable(
  "vendor_bill_applications",
  {
    id: serial("id").primaryKey(),
    targetVendorBillId: integer("target_vendor_bill_id").notNull().references(() => vendorBills.id),
    expensePaymentId: integer("expense_payment_id").references(() => expensePayments.id),
    creditVendorBillId: integer("credit_vendor_bill_id").references(() => vendorBills.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("active"),
    reversedAt: timestamp("reversed_at"),
    reversedBy: integer("reversed_by").references(() => adminUsers.id),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_vendor_bill_payment_applications_active_unique")
      .on(table.targetVendorBillId, table.expensePaymentId)
      .where(sql`${table.status} = 'active' AND ${table.expensePaymentId} IS NOT NULL`),
    uniqueIndex("idx_vendor_bill_credit_applications_active_unique")
      .on(table.targetVendorBillId, table.creditVendorBillId)
      .where(sql`${table.status} = 'active' AND ${table.creditVendorBillId} IS NOT NULL`),
    index("idx_vendor_bill_applications_target").on(table.targetVendorBillId),
    index("idx_vendor_bill_applications_payment").on(table.expensePaymentId),
    index("idx_vendor_bill_applications_credit").on(table.creditVendorBillId),
  ],
);

export const financeAuditEvents = pgTable(
  "finance_audit_events",
  {
    id: serial("id").primaryKey(),
    actorAdminUserId: integer("actor_admin_user_id").notNull().references(() => adminUsers.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    changesJson: jsonb("changes_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_finance_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
    index("idx_finance_audit_events_actor").on(table.actorAdminUserId, table.createdAt),
  ],
);

export const personnelAuditEvents = pgTable(
  "personnel_audit_events",
  {
    id: serial("id").primaryKey(),
    actorAdminUserId: integer("actor_admin_user_id").notNull().references(() => adminUsers.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    changesJson: jsonb("changes_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_personnel_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
    index("idx_personnel_audit_events_actor").on(table.actorAdminUserId, table.createdAt),
  ],
);

export const payrollAuditEvents = pgTable(
  "payroll_audit_events",
  {
    id: serial("id").primaryKey(),
    actorAdminUserId: integer("actor_admin_user_id").notNull().references(() => adminUsers.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    changesJson: jsonb("changes_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
    index("idx_payroll_audit_events_actor").on(table.actorAdminUserId, table.createdAt),
  ],
);

export const taxAuditEvents = pgTable(
  "tax_audit_events",
  {
    id: serial("id").primaryKey(),
    actorAdminUserId: integer("actor_admin_user_id").notNull().references(() => adminUsers.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    changesJson: jsonb("changes_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_tax_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
    index("idx_tax_audit_events_actor").on(table.actorAdminUserId, table.createdAt),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    storageProvider: text("storage_provider").notNull().default("r2"),
    fileKey: text("file_key").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileContentType: text("file_content_type").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    originalFilename: text("original_filename"),
    documentType: text("document_type").notNull(),
    sensitivityClass: text("sensitivity_class").notNull(),
    status: text("status").notNull().default("active"),
    voidedAt: timestamp("voided_at"),
    voidedBy: integer("voided_by").references(() => adminUsers.id),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_documents_file_key_unique").on(table.fileKey),
    index("idx_documents_sha256").on(table.fileSha256),
    index("idx_documents_sensitivity").on(table.sensitivityClass),
  ],
);

export const documentLinks = pgTable(
  "document_links",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull().references(() => documents.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    linkType: text("link_type").notNull(),
    requiredSensitivityClass: text("required_sensitivity_class").notNull(),
    status: text("status").notNull().default("active"),
    voidedAt: timestamp("voided_at"),
    voidedBy: integer("voided_by").references(() => adminUsers.id),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_document_links_active_unique")
      .on(table.documentId, table.entityType, table.entityId, table.linkType)
      .where(sql`${table.status} = 'active'`),
    index("idx_document_links_entity").on(table.entityType, table.entityId),
  ],
);

export const externalRecordRefs = pgTable(
  "external_record_refs",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceVendorId: integer("source_vendor_id").references(() => vendors.id),
    sourceNamespace: text("source_namespace").notNull().default("default"),
    externalRecordType: text("external_record_type").notNull(),
    externalRecordId: text("external_record_id").notNull(),
    importedAt: timestamp("imported_at"),
    payloadHash: text("payload_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_external_record_refs_entity").on(table.entityType, table.entityId),
    index("idx_external_record_refs_vendor").on(table.sourceVendorId),
  ],
);

export const reconciliationExceptions = pgTable(
  "reconciliation_exceptions",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    expectedEntityType: text("expected_entity_type"),
    expectedEntityId: integer("expected_entity_id"),
    actualEntityType: text("actual_entity_type"),
    actualEntityId: integer("actual_entity_id"),
    currency: text("currency"),
    expectedAmountCents: integer("expected_amount_cents"),
    actualAmountCents: integer("actual_amount_cents"),
    differenceAmountCents: integer("difference_amount_cents"),
    reasonCode: text("reason_code").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("open"),
    ownerAdminId: integer("owner_admin_id").references(() => adminUsers.id),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by").references(() => adminUsers.id),
    resolutionNotes: text("resolution_notes"),
    createdBy: integer("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_reconciliation_exceptions_expected_entity").on(table.expectedEntityType, table.expectedEntityId),
    index("idx_reconciliation_exceptions_actual_entity").on(table.actualEntityType, table.actualEntityId),
    index("idx_reconciliation_exceptions_status").on(table.status),
    index("idx_reconciliation_exceptions_domain").on(table.domain),
  ],
);

// Relations
export const adminUsersRelations = relations(adminUsers, ({ one, many }) => ({
  createdByUser: one(adminUsers, {
    fields: [adminUsers.createdBy],
    references: [adminUsers.id],
    relationName: "createdBy"
  }),
  createdUsers: many(adminUsers, { relationName: "createdBy" }),
  requestsCreated: many(adminUserApprovals, { relationName: "requestedBy" }),
  requestsApproved: many(adminUserApprovals, { relationName: "approvedBy" }),
  targetRequests: many(adminUserApprovals, { relationName: "targetAdmin" }),
  engagements: many(adminEngagements, { relationName: "engagementAdmin" }),
  lifecycleEvents: many(adminLifecycleEvents, { relationName: "eventAdmin" }),
  activityLogs: many(adminActivityLogs, { relationName: "activityLogAdmin" }),
  accessGrants: many(adminUserAccessGrants, { relationName: "accessGrantAdmin" }),
  supervisorFeedbackSlots: many(supervisorFeedbackSlots, { relationName: "supervisorFeedbackSlotAdmin" }),
  feedbackSchedulesAsTrainee: many(engagementFeedbackSchedules, { relationName: "feedbackScheduleTraineeAdmin" }),
  feedbackSchedulesAsSupervisor: many(engagementFeedbackSchedules, { relationName: "feedbackScheduleSupervisorAdmin" }),
  feedbackMeetingOccurrencesAsTrainee: many(feedbackMeetingOccurrences, { relationName: "feedbackMeetingTraineeAdmin" }),
  feedbackMeetingOccurrencesAsSupervisor: many(feedbackMeetingOccurrences, { relationName: "feedbackMeetingSupervisorAdmin" }),
  feedbackMeetingStatusUpdates: many(feedbackMeetingOccurrences, { relationName: "feedbackMeetingStatusUpdaterAdmin" }),
}));

export const adminUserApprovalsRelations = relations(adminUserApprovals, ({ one }) => ({
  targetAdmin: one(adminUsers, {
    fields: [adminUserApprovals.targetAdminId],
    references: [adminUsers.id],
    relationName: "targetAdmin"
  }),
  requestedByUser: one(adminUsers, {
    fields: [adminUserApprovals.requestedBy],
    references: [adminUsers.id],
    relationName: "requestedBy"
  }),
  approvedByUser: one(adminUsers, {
    fields: [adminUserApprovals.approvedBy],
    references: [adminUsers.id],
    relationName: "approvedBy"
  }),
}));

export const adminUserAccessGrantsRelations = relations(adminUserAccessGrants, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [adminUserAccessGrants.adminUserId],
    references: [adminUsers.id],
    relationName: "accessGrantAdmin",
  }),
  grantedByUser: one(adminUsers, {
    fields: [adminUserAccessGrants.grantedBy],
    references: [adminUsers.id],
    relationName: "accessGrantGrantedBy",
  }),
  revokedByUser: one(adminUsers, {
    fields: [adminUserAccessGrants.revokedBy],
    references: [adminUsers.id],
    relationName: "accessGrantRevokedBy",
  }),
}));

export const adminEngagementsRelations = relations(adminEngagements, ({ one, many }) => ({
  adminUser: one(adminUsers, {
    fields: [adminEngagements.adminUserId],
    references: [adminUsers.id],
    relationName: "engagementAdmin",
  }),
  supervisor: one(adminUsers, {
    fields: [adminEngagements.supervisorAdminId],
    references: [adminUsers.id],
    relationName: "engagementSupervisor",
  }),
  createdByUser: one(adminUsers, {
    fields: [adminEngagements.createdBy],
    references: [adminUsers.id],
    relationName: "engagementCreatedBy",
  }),
  lifecycleEvents: many(adminLifecycleEvents, { relationName: "engagementEvents" }),
  activityLogs: many(adminActivityLogs, { relationName: "engagementActivityLogs" }),
  engagementDocuments: many(adminEngagementDocuments, { relationName: "engagementDocuments" }),
  feedbackSchedules: many(engagementFeedbackSchedules, { relationName: "engagementFeedbackSchedules" }),
  feedbackMeetingOccurrences: many(feedbackMeetingOccurrences, { relationName: "engagementFeedbackMeetingOccurrences" }),
}));

export const adminLifecycleEventsRelations = relations(adminLifecycleEvents, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [adminLifecycleEvents.adminUserId],
    references: [adminUsers.id],
    relationName: "eventAdmin",
  }),
  engagement: one(adminEngagements, {
    fields: [adminLifecycleEvents.engagementId],
    references: [adminEngagements.id],
    relationName: "engagementEvents",
  }),
  actor: one(adminUsers, {
    fields: [adminLifecycleEvents.actorAdminId],
    references: [adminUsers.id],
    relationName: "eventActor",
  }),
}));

export const adminActivityLogsRelations = relations(adminActivityLogs, ({ one }) => ({
  engagement: one(adminEngagements, {
    fields: [adminActivityLogs.engagementId],
    references: [adminEngagements.id],
    relationName: "engagementActivityLogs",
  }),
  adminUser: one(adminUsers, {
    fields: [adminActivityLogs.adminUserId],
    references: [adminUsers.id],
    relationName: "activityLogAdmin",
  }),
  reviewer: one(adminUsers, {
    fields: [adminActivityLogs.reviewedBy],
    references: [adminUsers.id],
    relationName: "activityLogReviewer",
  }),
}));

export const supervisorFeedbackSlotsRelations = relations(supervisorFeedbackSlots, ({ one }) => ({
  supervisor: one(adminUsers, {
    fields: [supervisorFeedbackSlots.supervisorAdminId],
    references: [adminUsers.id],
    relationName: "supervisorFeedbackSlotAdmin",
  }),
  createdByUser: one(adminUsers, {
    fields: [supervisorFeedbackSlots.createdBy],
    references: [adminUsers.id],
    relationName: "createdBy",
  }),
}));

export const engagementFeedbackSchedulesRelations = relations(engagementFeedbackSchedules, ({ one, many }) => ({
  engagement: one(adminEngagements, {
    fields: [engagementFeedbackSchedules.engagementId],
    references: [adminEngagements.id],
    relationName: "engagementFeedbackSchedules",
  }),
  trainee: one(adminUsers, {
    fields: [engagementFeedbackSchedules.adminUserId],
    references: [adminUsers.id],
    relationName: "feedbackScheduleTraineeAdmin",
  }),
  supervisor: one(adminUsers, {
    fields: [engagementFeedbackSchedules.supervisorAdminId],
    references: [adminUsers.id],
    relationName: "feedbackScheduleSupervisorAdmin",
  }),
  occurrences: many(feedbackMeetingOccurrences, { relationName: "feedbackScheduleOccurrences" }),
}));

export const feedbackMeetingOccurrencesRelations = relations(feedbackMeetingOccurrences, ({ one }) => ({
  schedule: one(engagementFeedbackSchedules, {
    fields: [feedbackMeetingOccurrences.scheduleId],
    references: [engagementFeedbackSchedules.id],
    relationName: "feedbackScheduleOccurrences",
  }),
  engagement: one(adminEngagements, {
    fields: [feedbackMeetingOccurrences.engagementId],
    references: [adminEngagements.id],
    relationName: "engagementFeedbackMeetingOccurrences",
  }),
  trainee: one(adminUsers, {
    fields: [feedbackMeetingOccurrences.adminUserId],
    references: [adminUsers.id],
    relationName: "feedbackMeetingTraineeAdmin",
  }),
  supervisor: one(adminUsers, {
    fields: [feedbackMeetingOccurrences.supervisorAdminId],
    references: [adminUsers.id],
    relationName: "feedbackMeetingSupervisorAdmin",
  }),
  statusUpdatedByUser: one(adminUsers, {
    fields: [feedbackMeetingOccurrences.statusUpdatedBy],
    references: [adminUsers.id],
    relationName: "feedbackMeetingStatusUpdaterAdmin",
  }),
}));

export const adminDocumentTemplatesRelations = relations(adminDocumentTemplates, ({ one, many }) => ({
  creator: one(adminUsers, {
    fields: [adminDocumentTemplates.createdBy],
    references: [adminUsers.id],
    relationName: "documentTemplateCreator",
  }),
  documents: many(adminEngagementDocuments, { relationName: "documentTemplateDocuments" }),
}));

export const adminEngagementDocumentsRelations = relations(adminEngagementDocuments, ({ one }) => ({
  engagement: one(adminEngagements, {
    fields: [adminEngagementDocuments.engagementId],
    references: [adminEngagements.id],
    relationName: "engagementDocuments",
  }),
  adminUser: one(adminUsers, {
    fields: [adminEngagementDocuments.adminUserId],
    references: [adminUsers.id],
    relationName: "engagementDocumentAdmin",
  }),
  creator: one(adminUsers, {
    fields: [adminEngagementDocuments.createdBy],
    references: [adminUsers.id],
    relationName: "engagementDocumentCreator",
  }),
  voider: one(adminUsers, {
    fields: [adminEngagementDocuments.voidedBy],
    references: [adminUsers.id],
    relationName: "engagementDocumentVoider",
  }),
  accepter: one(adminUsers, {
    fields: [adminEngagementDocuments.acceptedBy],
    references: [adminUsers.id],
    relationName: "engagementDocumentAccepter",
  }),
  template: one(adminDocumentTemplates, {
    fields: [adminEngagementDocuments.templateId],
    references: [adminDocumentTemplates.id],
    relationName: "documentTemplateDocuments",
  }),
}));

// Insert schemas
export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});

export const insertAdminUserApprovalSchema = createInsertSchema(adminUserApprovals).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export const insertAdminUserAccessGrantSchema = createInsertSchema(adminUserAccessGrants).omit({
  id: true,
  grantedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdminEngagementSchema = createInsertSchema(adminEngagements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdminLifecycleEventSchema = createInsertSchema(adminLifecycleEvents).omit({
  id: true,
  createdAt: true,
});

export const insertAdminActivityLogSchema = createInsertSchema(adminActivityLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupervisorFeedbackSlotSchema = createInsertSchema(supervisorFeedbackSlots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEngagementFeedbackScheduleSchema = createInsertSchema(engagementFeedbackSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFeedbackMeetingOccurrenceSchema = createInsertSchema(feedbackMeetingOccurrences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdminDocumentTemplateSchema = createInsertSchema(adminDocumentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdminEngagementDocumentSchema = createInsertSchema(adminEngagementDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLegalEntitySchema = createInsertSchema(legalEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkerSchema = createInsertSchema(workers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmploymentSchema = createInsertSchema(employments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompensationTermSchema = createInsertSchema(compensationTerms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkAuthorizationSchema = createInsertSchema(workAuthorizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollRunWorkerSchema = createInsertSchema(payrollRunWorkers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollResultLineSchema = createInsertSchema(payrollResultLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollPaymentSchema = createInsertSchema(payrollPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxAgencySchema = createInsertSchema(taxAgencies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxRegistrationSchema = createInsertSchema(taxRegistrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxLiabilitySchema = createInsertSchema(taxLiabilities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxAgencyPaymentSchema = createInsertSchema(taxAgencyPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxPaymentAllocationSchema = createInsertSchema(taxPaymentAllocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaxFilingSchema = createInsertSchema(taxFilings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRecurringExpenseSchema = createInsertSchema(recurringExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorBillSchema = createInsertSchema(vendorBills).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExpensePaymentSchema = createInsertSchema(expensePayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorBillApplicationSchema = createInsertSchema(vendorBillApplications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFinanceAuditEventSchema = createInsertSchema(financeAuditEvents).omit({
  id: true,
  createdAt: true,
});

export const insertPersonnelAuditEventSchema = createInsertSchema(personnelAuditEvents).omit({
  id: true,
  createdAt: true,
});

export const insertPayrollAuditEventSchema = createInsertSchema(payrollAuditEvents).omit({
  id: true,
  createdAt: true,
});

export const insertTaxAuditEventSchema = createInsertSchema(taxAuditEvents).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentLinkSchema = createInsertSchema(documentLinks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExternalRecordRefSchema = createInsertSchema(externalRecordRefs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReconciliationExceptionSchema = createInsertSchema(reconciliationExceptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUserApproval = typeof adminUserApprovals.$inferSelect;
export type InsertAdminUserApproval = z.infer<typeof insertAdminUserApprovalSchema>;
export type AdminUserAccessGrant = typeof adminUserAccessGrants.$inferSelect;
export type InsertAdminUserAccessGrant = z.infer<typeof insertAdminUserAccessGrantSchema>;
export type AdminEngagement = typeof adminEngagements.$inferSelect;
export type InsertAdminEngagement = z.infer<typeof insertAdminEngagementSchema>;
export type AdminLifecycleEvent = typeof adminLifecycleEvents.$inferSelect;
export type InsertAdminLifecycleEvent = z.infer<typeof insertAdminLifecycleEventSchema>;
export type AdminActivityLog = typeof adminActivityLogs.$inferSelect;
export type InsertAdminActivityLog = z.infer<typeof insertAdminActivityLogSchema>;
export type SupervisorFeedbackSlot = typeof supervisorFeedbackSlots.$inferSelect;
export type InsertSupervisorFeedbackSlot = z.infer<typeof insertSupervisorFeedbackSlotSchema>;
export type EngagementFeedbackSchedule = typeof engagementFeedbackSchedules.$inferSelect;
export type InsertEngagementFeedbackSchedule = z.infer<typeof insertEngagementFeedbackScheduleSchema>;
export type FeedbackMeetingOccurrence = typeof feedbackMeetingOccurrences.$inferSelect;
export type InsertFeedbackMeetingOccurrence = z.infer<typeof insertFeedbackMeetingOccurrenceSchema>;
export type AdminDocumentTemplate = typeof adminDocumentTemplates.$inferSelect;
export type InsertAdminDocumentTemplate = z.infer<typeof insertAdminDocumentTemplateSchema>;
export type AdminEngagementDocument = typeof adminEngagementDocuments.$inferSelect;
export type InsertAdminEngagementDocument = z.infer<typeof insertAdminEngagementDocumentSchema>;
export type LegalEntity = typeof legalEntities.$inferSelect;
export type InsertLegalEntity = z.infer<typeof insertLegalEntitySchema>;
export type Worker = typeof workers.$inferSelect;
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Employment = typeof employments.$inferSelect;
export type InsertEmployment = z.infer<typeof insertEmploymentSchema>;
export type CompensationTerm = typeof compensationTerms.$inferSelect;
export type InsertCompensationTerm = z.infer<typeof insertCompensationTermSchema>;
export type WorkAuthorization = typeof workAuthorizations.$inferSelect;
export type InsertWorkAuthorization = z.infer<typeof insertWorkAuthorizationSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRunWorker = typeof payrollRunWorkers.$inferSelect;
export type InsertPayrollRunWorker = z.infer<typeof insertPayrollRunWorkerSchema>;
export type PayrollResultLine = typeof payrollResultLines.$inferSelect;
export type InsertPayrollResultLine = z.infer<typeof insertPayrollResultLineSchema>;
export type PayrollPayment = typeof payrollPayments.$inferSelect;
export type InsertPayrollPayment = z.infer<typeof insertPayrollPaymentSchema>;
export type TaxAgency = typeof taxAgencies.$inferSelect;
export type InsertTaxAgency = z.infer<typeof insertTaxAgencySchema>;
export type TaxRegistration = typeof taxRegistrations.$inferSelect;
export type InsertTaxRegistration = z.infer<typeof insertTaxRegistrationSchema>;
export type TaxLiability = typeof taxLiabilities.$inferSelect;
export type InsertTaxLiability = z.infer<typeof insertTaxLiabilitySchema>;
export type TaxAgencyPayment = typeof taxAgencyPayments.$inferSelect;
export type InsertTaxAgencyPayment = z.infer<typeof insertTaxAgencyPaymentSchema>;
export type TaxPaymentAllocation = typeof taxPaymentAllocations.$inferSelect;
export type InsertTaxPaymentAllocation = z.infer<typeof insertTaxPaymentAllocationSchema>;
export type TaxFiling = typeof taxFilings.$inferSelect;
export type InsertTaxFiling = z.infer<typeof insertTaxFilingSchema>;
export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type InsertRecurringExpense = z.infer<typeof insertRecurringExpenseSchema>;
export type VendorBill = typeof vendorBills.$inferSelect;
export type InsertVendorBill = z.infer<typeof insertVendorBillSchema>;
export type ExpensePayment = typeof expensePayments.$inferSelect;
export type InsertExpensePayment = z.infer<typeof insertExpensePaymentSchema>;
export type VendorBillApplication = typeof vendorBillApplications.$inferSelect;
export type InsertVendorBillApplication = z.infer<typeof insertVendorBillApplicationSchema>;
export type FinanceAuditEvent = typeof financeAuditEvents.$inferSelect;
export type InsertFinanceAuditEvent = z.infer<typeof insertFinanceAuditEventSchema>;
export type PersonnelAuditEvent = typeof personnelAuditEvents.$inferSelect;
export type InsertPersonnelAuditEvent = z.infer<typeof insertPersonnelAuditEventSchema>;
export type PayrollAuditEvent = typeof payrollAuditEvents.$inferSelect;
export type InsertPayrollAuditEvent = z.infer<typeof insertPayrollAuditEventSchema>;
export type TaxAuditEvent = typeof taxAuditEvents.$inferSelect;
export type InsertTaxAuditEvent = z.infer<typeof insertTaxAuditEventSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DocumentLink = typeof documentLinks.$inferSelect;
export type InsertDocumentLink = z.infer<typeof insertDocumentLinkSchema>;
export type ExternalRecordRef = typeof externalRecordRefs.$inferSelect;
export type InsertExternalRecordRef = z.infer<typeof insertExternalRecordRefSchema>;
export type ReconciliationException = typeof reconciliationExceptions.$inferSelect;
export type InsertReconciliationException = z.infer<typeof insertReconciliationExceptionSchema>;

export type AdminRole = 'super_admin' | 'admin_finance' | 'admin_verifier' | 'admin_support' | 'trainee_access';
export type AdminAccountType = 'admin_staff' | 'trainee' | 'contractor' | 'employee' | 'advisor';
export type AdminAccessGroup =
  | 'finance_admin'
  | 'verifier_admin'
  | 'support_admin'
  | 'super_admin'
  | 'admin_operations'
  | 'payroll_admin'
  | 'tax_admin'
  | 'trainee_offer_portal'
  | 'trainee_workspace'
  | 'document_templates'
  | 'lifecycle_jobs';
export type AdminStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalAction = 'create' | 'change_role' | 'delete';
export type EngagementType = 'employee' | 'intern' | 'contractor' | 'advisor' | 'other';
export type EngagementScheduleType = 'full_time' | 'part_time';
export type WorkAuthorizationType = 'none' | 'cpt' | 'opt' | 'stem_opt' | 'other';
export type EngagementStatus = 'draft' | 'invited' | 'active' | 'offboarding' | 'ended' | 'cancelled';
export type AdminLifecycleEventType =
  | 'engagement_created'
  | 'engagement_updated'
  | 'invitation_sent'
  | 'account_activated'
  | 'onboarding_started'
  | 'engagement_activated'
  | 'permission_granted'
  | 'permission_revoked'
  | 'office_hour_attended'
  | 'training_completed'
  | 'offboarding_started'
  | 'access_disabled'
  | 'offboarding_email_sent'
  | 'offboarding_email_failed'
  | 'engagement_ended'
  | 'self_offboarding_requested'
  | 'early_offboarding_started'
  | 'engagement_cancelled'
  | 'activity_log_submitted'
  | 'offer_letter_created'
  | 'offer_letter_pdf_generated'
  | 'offer_letter_sent'
  | 'offer_letter_viewed'
  | 'offer_letter_accepted'
  | 'offer_letter_declined'
  | 'offer_letter_voided';
export type AdminActivityType =
  | 'office_hour'
  | 'training'
  | 'learning'
  | 'research'
  | 'documentation'
  | 'draft_work'
  | 'meeting'
  | 'other';
export type AdminActivityLogStatus = 'submitted' | 'reviewed';
export type AdminEngagementDocumentType = 'offer_letter';
export type AdminEngagementDocumentStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'voided';
export type AdminDocumentTemplateStatus = 'draft' | 'active' | 'archived';
export type AdminDocumentContentFormat = 'plain_text';
export type LegalEntityStatus = 'active' | 'inactive';
export type WorkerLifecycleState = 'normal' | 'archived' | 'merged' | 'voided';
export type EmploymentStatus = 'draft' | 'active' | 'on_leave' | 'ended' | 'voided';
export type EmployeeClassification = 'employee' | 'paid_intern' | 'other_employee';
export type PayrollParticipation = 'not_enrolled' | 'eligible' | 'active' | 'inactive';
export type CompensationPayBasis = 'hourly' | 'salary' | 'stipend' | 'other';
export type CompensationStatus = 'draft' | 'active' | 'superseded' | 'voided';
export type WorkerWorkAuthorizationType = 'stem_opt' | 'h1b' | 'other';
export type WorkerWorkAuthorizationStatus = 'draft' | 'active' | 'superseded' | 'voided';
export type PayrollRunKind = 'regular' | 'off_cycle' | 'bonus' | 'correction' | 'adjustment';
export type FinanceSourceType = 'provider' | 'csv_import' | 'manual' | 'internal';
export type PayrollRunStatus = 'draft' | 'reviewed' | 'finalized';
export type AmountEffect = 'increase' | 'decrease';
export type PayrollResultLineCategory =
  | 'earning'
  | 'deduction'
  | 'employee_tax'
  | 'employer_tax'
  | 'reimbursement'
  | 'other';
export type PaymentProcessingStatus =
  | 'pending'
  | 'sent'
  | 'submitted'
  | 'posted'
  | 'cleared'
  | 'failed'
  | 'reversed'
  | 'voided';
export type TaxAgencyStatus = 'active' | 'inactive';
export type TaxRegistrationStatus = 'pending' | 'active' | 'inactive' | 'closed';
export type TaxLiabilityStatus = 'draft' | 'recognized' | 'disputed' | 'voided';
export type TaxFilingStatus = 'draft' | 'ready' | 'filed' | 'accepted' | 'rejected' | 'voided';
export type VendorStatus = 'active' | 'inactive' | 'archived';
export type RecurringExpenseStatus = 'draft' | 'trial' | 'active' | 'paused' | 'cancelled' | 'expired';
export type VendorBillStatus = 'draft' | 'received' | 'approved' | 'disputed' | 'voided';
export type VendorBillKind = 'invoice' | 'bill' | 'credit_memo' | 'statement' | 'other';
export type AllocationStatus = 'active' | 'reversed' | 'voided';
export type DocumentStatus = 'active' | 'voided';
export type DocumentSensitivityClass =
  | 'ordinary_finance'
  | 'employment'
  | 'payroll'
  | 'tax'
  | 'work_authorization';
export type ExternalRecordRefStatus = 'active' | 'superseded' | 'voided';
export type ReconciliationDomain = 'payroll' | 'tax' | 'ap' | 'documents' | 'provider_sync';
export type ReconciliationExceptionStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'waived'
  | 'voided';
export type FinanceEntityType =
  | 'legal_entities'
  | 'workers'
  | 'employments'
  | 'compensation_terms'
  | 'work_authorizations'
  | 'payroll_runs'
  | 'payroll_run_workers'
  | 'payroll_result_lines'
  | 'payroll_payments'
  | 'tax_agencies'
  | 'tax_registrations'
  | 'tax_liabilities'
  | 'tax_agency_payments'
  | 'tax_payment_allocations'
  | 'tax_filings'
  | 'vendors'
  | 'recurring_expenses'
  | 'vendor_bills'
  | 'expense_payments'
  | 'vendor_bill_applications'
  | 'documents'
  | 'reconciliation_exceptions';
