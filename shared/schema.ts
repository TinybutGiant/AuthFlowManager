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
  passwordHash: text("password_hash").notNull(),
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
export type AdminDocumentTemplate = typeof adminDocumentTemplates.$inferSelect;
export type InsertAdminDocumentTemplate = z.infer<typeof insertAdminDocumentTemplateSchema>;
export type AdminEngagementDocument = typeof adminEngagementDocuments.$inferSelect;
export type InsertAdminEngagementDocument = z.infer<typeof insertAdminEngagementDocumentSchema>;

export type AdminRole = 'super_admin' | 'admin_finance' | 'admin_verifier' | 'admin_support' | 'trainee_access';
export type AdminAccountType = 'admin_staff' | 'trainee' | 'contractor' | 'employee' | 'advisor';
export type AdminAccessGroup =
  | 'finance_admin'
  | 'verifier_admin'
  | 'support_admin'
  | 'super_admin'
  | 'admin_operations'
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
