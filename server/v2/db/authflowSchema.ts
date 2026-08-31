import {
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
  email: varchar("email", { length: 255 }).notNull(),
  role: adminRoleEnum("role").notNull(),
  status: adminStatusEnum("status").notNull(),
});

export const adminUserAccessGrants = pgTable("admin_user_access_grants", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull(),
  accessGroup: text("access_group").notNull(),
  revokedAt: timestamp("revoked_at"),
});
