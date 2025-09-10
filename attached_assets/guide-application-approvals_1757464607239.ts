import {
  pgTable,
  text,
  serial,
  primaryKey,
  integer,
  timestamp,
  pgEnum,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../../schema";
import { guideApplications } from "./guide-applications";
import { adminUsers } from "./admin-schema";

// 管理员操作类型枚举
export const adminActionTypeEnum = pgEnum("admin_action_type", [
  "review",
  "approve", 
  "reject",
  "require_more_info",
]);

// 导游申请审批表
export const guideApplicationApprovals = pgTable(
  "guide_application_approvals",
  {
    id: serial("id").primaryKey(),  
    applicationId: uuid("application_id")
      .notNull()
      .references(() => guideApplications.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id), // 申请人 ID
    adminId: integer("admin_id").references(() => adminUsers.id), // 审核管理员，可为空
    adminAction: adminActionTypeEnum("admin_action"), // 审核动作，可为空
    note: text("note"), // 管理员说明或反馈
    userResponse: jsonb("user_response"), // 用户在 require_more_info 后上传的说明/文件
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

// Insert schema
export const insertGuideApplicationApprovalSchema = createInsertSchema(
  guideApplicationApprovals,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertGuideApplicationApproval = z.infer<
  typeof insertGuideApplicationApprovalSchema
>;
export type GuideApplicationApproval = typeof guideApplicationApprovals.$inferSelect;

// API request schemas
export const createGuideApplicationApprovalSchema = insertGuideApplicationApprovalSchema.extend({
  // Add any additional validation rules if needed
});

export const updateGuideApplicationApprovalSchema = insertGuideApplicationApprovalSchema
  .partial()
  .extend({
    id: z.number().positive(),
  });

// User response schema for require_more_info cases
export const userResponseSchema = z.object({
  description: z.string().optional(), // 用户在文本框中的补充说明
  certifications: z.record(z.object({
    proof: z.string(), // 文件 URL
    description: z.string(), // 文件描述
  })).optional(), // 用户上传文件
});

export type CreateGuideApplicationApprovalRequest = z.infer<
  typeof createGuideApplicationApprovalSchema
>;
export type UpdateGuideApplicationApprovalRequest = z.infer<
  typeof updateGuideApplicationApprovalSchema
>;
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