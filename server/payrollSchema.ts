import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const legalEntities = pgTable("legal_entities", {
  id: serial("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  entityType: text("entity_type").notNull().default("llc"),
  formationState: text("formation_state"),
  maskedTaxIdentifier: text("masked_tax_identifier"),
  status: text("status").notNull().default("active"),
  createdBy: integer("created_by"),
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
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("idx_payroll_vendors_status").on(table.status)],
);

export const workers = pgTable(
  "workers",
  {
    id: serial("id").primaryKey(),
    adminUserId: integer("admin_user_id"),
    workerCode: text("worker_code").notNull(),
    legalName: text("legal_name").notNull(),
    preferredName: text("preferred_name"),
    personnelEmail: text("personnel_email"),
    archivedAt: timestamp("archived_at"),
    voidedAt: timestamp("voided_at"),
    mergedIntoWorkerId: integer("merged_into_worker_id"),
    mergedAt: timestamp("merged_at"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_payroll_workers_code_unique").on(table.workerCode),
    index("idx_payroll_workers_merged_into_worker").on(table.mergedIntoWorkerId),
  ],
);

export const employments = pgTable(
  "employments",
  {
    id: serial("id").primaryKey(),
    workerId: integer("worker_id").notNull(),
    legalEntityId: integer("legal_entity_id").notNull(),
    employeeClassification: text("employee_classification").notNull().default("employee"),
    payrollParticipation: text("payroll_participation").notNull().default("not_enrolled"),
    status: text("status").notNull().default("draft"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    workLocation: text("work_location"),
    primaryWorkState: text("primary_work_state"),
    primaryWorkJurisdiction: text("primary_work_jurisdiction"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_employments_worker").on(table.workerId),
    index("idx_payroll_employments_legal_entity").on(table.legalEntityId),
    index("idx_payroll_employments_status").on(table.status),
  ],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date").notNull(),
    runKind: text("run_kind").notNull().default("regular"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceVendorId: integer("source_vendor_id"),
    correctionOfPayrollRunId: integer("correction_of_payroll_run_id"),
    status: text("status").notNull().default("draft"),
    finalizedAt: timestamp("finalized_at"),
    finalizedBy: integer("finalized_by"),
    notes: text("notes"),
    createdBy: integer("created_by"),
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
    payrollRunId: integer("payroll_run_id").notNull(),
    workerId: integer("worker_id").notNull(),
    employmentId: integer("employment_id").notNull(),
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
    payrollRunWorkerId: integer("payroll_run_worker_id").notNull(),
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
    payrollRunWorkerId: integer("payroll_run_worker_id").notNull(),
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
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_payments_run_worker").on(table.payrollRunWorkerId),
    index("idx_payroll_payments_status").on(table.status),
  ],
);

export const payrollAuditEvents = pgTable(
  "payroll_audit_events",
  {
    id: serial("id").primaryKey(),
    actorAdminUserId: integer("actor_admin_user_id").notNull(),
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

export const externalRecordRefs = pgTable(
  "external_record_refs",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceVendorId: integer("source_vendor_id"),
    sourceNamespace: text("source_namespace").notNull().default("default"),
    externalRecordType: text("external_record_type").notNull(),
    externalRecordId: text("external_record_id").notNull(),
    importedAt: timestamp("imported_at"),
    payloadHash: text("payload_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_payroll_external_record_refs_entity").on(table.entityType, table.entityId),
    index("idx_payroll_external_record_refs_vendor").on(table.sourceVendorId),
  ],
);
