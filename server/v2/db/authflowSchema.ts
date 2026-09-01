import {
  jsonb,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const adminRoleEnum = pgEnum("admin_role", [
  "super_admin",
  "admin_finance",
  "admin_verifier",
  "admin_support",
  "trainee_access",
]);

export const adminStatusEnum = pgEnum("admin_status", [
  "pending",
  "active",
  "inactive",
  "rejected",
]);

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash"),
  role: adminRoleEnum("role").notNull(),
  accountType: text("account_type").notNull().default("admin_staff"),
  status: adminStatusEnum("status").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const adminUserAccessGrants = pgTable("admin_user_access_grants", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull(),
  accessGroup: text("access_group").notNull(),
  source: text("source"),
  metadata: jsonb("metadata").notNull().default({}),
  grantedBy: integer("granted_by"),
  grantedAt: timestamp("granted_at").notNull(),
  revokedBy: integer("revoked_by"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const adminLifecycleEvents = pgTable("admin_lifecycle_events", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull(),
  engagementId: integer("engagement_id"),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  actorAdminId: integer("actor_admin_id"),
  metadata: jsonb("metadata").notNull().default({}),
  notes: text("notes"),
  createdAt: timestamp("created_at"),
});
