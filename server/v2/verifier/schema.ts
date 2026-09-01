import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const applicationStatusTypeEnum = pgEnum("application_status_type", [
  "drafted",
  "pending",
  "needs_more_info",
  "approved",
  "rejected",
]);

export const adminActionTypeEnum = pgEnum("admin_action_type", [
  "review",
  "approve",
  "reject",
  "require_more_info",
]);

export const guideApplications = pgTable("guide_applications", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  applicationStatus: applicationStatusTypeEnum("application_status")
    .notNull()
    .default("drafted"),
  internalTags: text("internal_tags").array(),
  qualifications: jsonb("qualifications"),
  flaggedForReview: boolean("flagged_for_review").default(false),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockExpiry: timestamp("lock_expiry", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const destinations = pgTable("destinations", {
  id: serial("id").primaryKey(),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  nameEn: text("name_en").notNull(),
  nameJa: text("name_ja"),
  nameZhCn: text("name_zh_cn"),
  timezone: text("timezone").notNull(),
  prefectureCode: varchar("prefecture_code", { length: 16 }),
  prefectureName: text("prefecture_name"),
  placeType: text("place_type").notNull(),
  status: text("status").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const guideApplicationServiceAreas = pgTable(
  "guide_application_service_areas",
  {
    applicationId: uuid("application_id").notNull(),
    destinationId: integer("destination_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
);

export const guideServiceAreaProposals = pgTable(
  "guide_service_area_proposals",
  {
    id: serial("id").primaryKey(),
    applicationId: uuid("application_id"),
    guideId: integer("guide_id"),
    rawName: text("raw_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    status: text("status").notNull(),
    resolvedDestinationId: integer("resolved_destination_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: integer("resolved_by"),
  },
);

export const guideApplicationApprovals = pgTable(
  "guide_application_approvals",
  {
    id: serial("id").primaryKey(),
    applicationId: uuid("application_id").notNull(),
    userId: integer("user_id").notNull(),
    adminId: integer("admin_id"),
    adminAction: adminActionTypeEnum("admin_action"),
    note: text("note"),
    userResponse: jsonb("user_response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export type GuideApplicationRecord = typeof guideApplications.$inferSelect;
export type DestinationRecord = typeof destinations.$inferSelect;
export type GuideServiceAreaProposalRecord =
  typeof guideServiceAreaProposals.$inferSelect;
export type GuideApplicationApprovalRecord =
  typeof guideApplicationApprovals.$inferSelect;
export type ApplicationStatus =
  (typeof applicationStatusTypeEnum.enumValues)[number];
export type AdminActionType = (typeof adminActionTypeEnum.enumValues)[number];
