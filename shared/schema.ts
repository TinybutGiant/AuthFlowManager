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

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Admin role enum
export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'admin_finance', 
  'admin_verifier',
  'admin_support'
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
  role: adminRoleEnum("role").notNull(),
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

// Types
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUserApproval = typeof adminUserApprovals.$inferSelect;
export type InsertAdminUserApproval = z.infer<typeof insertAdminUserApprovalSchema>;

export type AdminRole = 'super_admin' | 'admin_finance' | 'admin_verifier' | 'admin_support';
export type AdminStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalAction = 'create' | 'change_role' | 'delete';
