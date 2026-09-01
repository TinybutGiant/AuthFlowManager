import { sql } from "drizzle-orm";
import {
  boolean,
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
  (table) => [index("idx_finance_expense_vendors_status").on(table.status)],
);

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull(),
    vendorId: integer("vendor_id").notNull(),
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
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_finance_expense_recurring_vendor").on(table.vendorId),
    index("idx_finance_expense_recurring_legal_entity").on(table.legalEntityId),
    index("idx_finance_expense_recurring_status").on(table.status),
  ],
);

export const vendorBills = pgTable(
  "vendor_bills",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull(),
    vendorId: integer("vendor_id").notNull(),
    recurringExpenseId: integer("recurring_expense_id"),
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
    creditForVendorBillId: integer("credit_for_vendor_bill_id"),
    notes: text("notes"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_finance_expense_bills_vendor").on(table.vendorId),
    index("idx_finance_expense_bills_legal_entity").on(table.legalEntityId),
    index("idx_finance_expense_bills_recurring").on(table.recurringExpenseId),
    index("idx_finance_expense_bills_status").on(table.status),
  ],
);

export const expensePayments = pgTable(
  "expense_payments",
  {
    id: serial("id").primaryKey(),
    legalEntityId: integer("legal_entity_id").notNull(),
    vendorId: integer("vendor_id"),
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
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_finance_expense_payments_vendor").on(table.vendorId),
    index("idx_finance_expense_payments_legal_entity").on(table.legalEntityId),
    index("idx_finance_expense_payments_status").on(table.status),
  ],
);

export const vendorBillApplications = pgTable(
  "vendor_bill_applications",
  {
    id: serial("id").primaryKey(),
    targetVendorBillId: integer("target_vendor_bill_id").notNull(),
    expensePaymentId: integer("expense_payment_id"),
    creditVendorBillId: integer("credit_vendor_bill_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("active"),
    reversedAt: timestamp("reversed_at"),
    reversedBy: integer("reversed_by"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_finance_expense_applications_payment_active")
      .on(table.targetVendorBillId, table.expensePaymentId)
      .where(sql`${table.status} = 'active' AND ${table.expensePaymentId} IS NOT NULL`),
    uniqueIndex("idx_finance_expense_applications_credit_active")
      .on(table.targetVendorBillId, table.creditVendorBillId)
      .where(sql`${table.status} = 'active' AND ${table.creditVendorBillId} IS NOT NULL`),
    index("idx_finance_expense_applications_target").on(table.targetVendorBillId),
    index("idx_finance_expense_applications_payment").on(table.expensePaymentId),
    index("idx_finance_expense_applications_credit").on(table.creditVendorBillId),
  ],
);

export const financeAuditEvents = pgTable(
  "finance_audit_events",
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
    index("idx_finance_expense_audit_entity").on(table.entityType, table.entityId, table.createdAt),
    index("idx_finance_expense_audit_actor").on(table.actorAdminUserId, table.createdAt),
  ],
);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  storageProvider: text("storage_provider").notNull(),
  fileKey: text("file_key").notNull(),
  fileSha256: text("file_sha256").notNull(),
  fileContentType: text("file_content_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  originalFilename: text("original_filename"),
  documentType: text("document_type").notNull(),
  sensitivityClass: text("sensitivity_class").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const documentLinks = pgTable("document_links", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  linkType: text("link_type").notNull(),
  requiredSensitivityClass: text("required_sensitivity_class").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
    differenceAmountCents: integer("difference_amount_cents").notNull(),
    reasonCode: text("reason_code").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("open"),
    ownerAdminId: integer("owner_admin_id"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by"),
    resolutionNotes: text("resolution_notes"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_finance_expense_reconciliation_expected").on(table.expectedEntityType, table.expectedEntityId),
    index("idx_finance_expense_reconciliation_actual").on(table.actualEntityType, table.actualEntityId),
    index("idx_finance_expense_reconciliation_status").on(table.status),
    index("idx_finance_expense_reconciliation_domain").on(table.domain),
  ],
);
