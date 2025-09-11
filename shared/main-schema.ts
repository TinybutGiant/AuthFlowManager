import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  serial,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Application status enum
export const applicationStatusTypeEnum = pgEnum("application_status_type", [
  "drafted",
  "pending", 
  "needs_more_info",
  "approved",
  "rejected",
]);

// Admin action type enum  
export const adminActionTypeEnum = pgEnum("admin_action_type", [
  "review",
  "approve", 
  "reject",
  "require_more_info",
]);

// Guide applications table (lite version for admin panel)
export const guideApplicationsLite = pgTable("guide_applications", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  applicationStatus: applicationStatusTypeEnum("application_status")
    .notNull()
    .default("drafted"),
  internalTags: text("internal_tags").array(),
  flaggedForReview: boolean("flagged_for_review").default(false),
  // Exclusive lock fields
  lockedBy: integer("locked_by"), // Admin ID who has the exclusive lock
  lockedAt: timestamp("locked_at", { withTimezone: true }), // When the lock was acquired
  lockExpiry: timestamp("lock_expiry", { withTimezone: true }), // When the lock expires (24 hours after lockedAt)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Guide application approvals table
export const guideApplicationApprovals = pgTable("guide_application_approvals", {
  id: serial("id").primaryKey(),  
  applicationId: uuid("application_id")
    .notNull()
    .references(() => guideApplicationsLite.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(), // 申请人 ID
  adminId: integer("admin_id"), // 审核管理员，可为空
  adminAction: adminActionTypeEnum("admin_action"), // 审核动作，可为空
  note: text("note"), // 管理员说明或反馈
  userResponse: jsonb("user_response"), // 用户在 require_more_info 后上传的说明/文件
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Relations
export const guideApplicationsLiteRelations = relations(guideApplicationsLite, ({ many }) => ({
  approvals: many(guideApplicationApprovals),
}));

export const guideApplicationApprovalsRelations = relations(guideApplicationApprovals, ({ one }) => ({
  application: one(guideApplicationsLite, {
    fields: [guideApplicationApprovals.applicationId],
    references: [guideApplicationsLite.id],
  }),
}));

// Insert schemas
export const insertGuideApplicationLiteSchema = createInsertSchema(guideApplicationsLite).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGuideApplicationApprovalSchema = createInsertSchema(guideApplicationApprovals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update schemas
export const updateGuideApplicationLiteSchema = insertGuideApplicationLiteSchema
  .partial()
  .extend({
    id: z.string().uuid(),
    updatedAt: z.date(),
  });

export const updateGuideApplicationApprovalSchema = insertGuideApplicationApprovalSchema
  .partial()
  .extend({
    id: z.number().positive(),
  });

// Types
export type GuideApplicationLite = typeof guideApplicationsLite.$inferSelect;
export type InsertGuideApplicationLite = z.infer<typeof insertGuideApplicationLiteSchema>;
export type UpdateGuideApplicationLite = z.infer<typeof updateGuideApplicationLiteSchema>;

export type GuideApplicationApproval = typeof guideApplicationApprovals.$inferSelect;
export type InsertGuideApplicationApproval = z.infer<typeof insertGuideApplicationApprovalSchema>;
export type UpdateGuideApplicationApproval = z.infer<typeof updateGuideApplicationApprovalSchema>;

// User response schema for require_more_info cases
export const userResponseSchema = z.object({
  description: z.string().optional(), // 用户在文本框中的补充说明
  certifications: z.record(z.object({
    proof: z.string(), // 文件 URL
    description: z.string(), // 文件描述
  })).optional(), // 用户上传文件
});

export type UserResponse = z.infer<typeof userResponseSchema>;

// Timeline entry type for displaying approval history
export interface ApprovalTimelineEntry {
  id: string | number;
  type: 'application_submitted' | 'admin_action' | 'user_response';
  timestamp: Date;
  adminAction?: 'review' | 'approve' | 'reject' | 'require_more_info' | null;
  note?: string | null;
  userResponse?: UserResponse | null;
  adminName?: string;
}

// Status type definitions
export type ApplicationStatus = 'drafted' | 'pending' | 'needs_more_info' | 'approved' | 'rejected';
export type AdminActionType = 'review' | 'approve' | 'reject' | 'require_more_info';