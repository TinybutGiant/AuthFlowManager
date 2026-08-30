import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adminEngagements,
  adminUsers,
  compensationTerms,
  employments,
  legalEntities,
  personnelAuditEvents,
  workAuthorizations,
  workers,
  type InsertWorkAuthorization,
  type InsertCompensationTerm,
  type InsertEmployment,
  type InsertPersonnelAuditEvent,
  type InsertWorker,
} from "@shared/schema";
import { db } from "./db";
import type { PersonnelListFilters, PersonnelRepository, WorkAuthorizationListFilters } from "./personnelService";

type DrizzleDb = any;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function queryLimit(filters: PersonnelListFilters) {
  return Math.min(250, Math.max(1, filters.pageSize ?? 100));
}

function searchPattern(search?: string | null) {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.toLowerCase()}%` : null;
}

function isAdminStatus(value: string): value is "pending" | "active" | "inactive" | "rejected" {
  return ["pending", "active", "inactive", "rejected"].includes(value);
}

function createRepository(database: DrizzleDb): PersonnelRepository {
  const repository: PersonnelRepository = {
    transaction: async (work) => (
      typeof database.transaction === "function"
        ? await database.transaction(async (tx: DrizzleDb) => work(createRepository(tx)))
        : await work(repository)
    ),

    lockAdminUser: async (id) => {
      await database.execute(sql`SELECT "id" FROM "admin_users" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockWorker: async (id) => {
      await database.execute(sql`SELECT "id" FROM "workers" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockEmployment: async (id) => {
      await database.execute(sql`SELECT "id" FROM "employments" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockCompensationTerm: async (id) => {
      await database.execute(sql`SELECT "id" FROM "compensation_terms" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockAdminEngagement: async (id) => {
      await database.execute(sql`SELECT "id" FROM "admin_engagements" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockWorkAuthorization: async (id) => {
      await database.execute(sql`SELECT "id" FROM "work_authorizations" WHERE "id" = ${id} FOR UPDATE`);
    },

    getAdminUser: async (id) => {
      const [row] = await database.select().from(adminUsers).where(eq(adminUsers.id, id));
      return row;
    },

    listAdminUsers: async (filters) => {
      const conditions = [];
      const pattern = searchPattern(filters.search);
      if (filters.status && filters.status !== "all" && isAdminStatus(filters.status)) {
        conditions.push(eq(adminUsers.status, filters.status));
      }
      if (pattern) {
        conditions.push(sql`(lower(${adminUsers.name}) LIKE ${pattern} OR lower(${adminUsers.email}) LIKE ${pattern})`);
      }

      let query = database.select().from(adminUsers).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(asc(adminUsers.name), asc(adminUsers.id)).limit(queryLimit(filters));
    },

    getAdminEngagement: async (id) => {
      const [row] = await database.select().from(adminEngagements).where(eq(adminEngagements.id, id));
      return row;
    },

    listAdminEngagementsForAdminUser: async (adminUserId) => (
      await database
        .select()
        .from(adminEngagements)
        .where(eq(adminEngagements.adminUserId, adminUserId))
        .orderBy(desc(adminEngagements.createdAt), desc(adminEngagements.id))
    ),

    getLegalEntity: async (id) => {
      const [row] = await database.select().from(legalEntities).where(eq(legalEntities.id, id));
      return row;
    },

    listLegalEntities: async () => (
      await database
        .select({
          id: legalEntities.id,
          legalName: legalEntities.legalName,
          entityType: legalEntities.entityType,
          status: legalEntities.status,
        })
        .from(legalEntities)
        .where(eq(legalEntities.status, "active"))
        .orderBy(asc(legalEntities.legalName), asc(legalEntities.id))
    ),

    getWorker: async (id) => {
      const [row] = await database.select().from(workers).where(eq(workers.id, id));
      return row;
    },

    getWorkerByAdminUserId: async (adminUserId) => {
      const [row] = await database.select().from(workers).where(eq(workers.adminUserId, adminUserId));
      return row;
    },

    getWorkerByCode: async (workerCode) => {
      const [row] = await database.select().from(workers).where(eq(workers.workerCode, workerCode));
      return row;
    },

    listWorkers: async (filters) => {
      const conditions = [];
      const pattern = searchPattern(filters.search);
      if (filters.adminUserId) {
        conditions.push(eq(workers.adminUserId, filters.adminUserId));
      }
      if (pattern) {
        conditions.push(sql`(lower(${workers.legalName}) LIKE ${pattern} OR lower(${workers.workerCode}) LIKE ${pattern})`);
      }
      switch (filters.lifecycleState) {
        case "normal":
          conditions.push(sql`${workers.archivedAt} IS NULL AND ${workers.voidedAt} IS NULL AND ${workers.mergedAt} IS NULL`);
          break;
        case "archived":
          conditions.push(sql`${workers.archivedAt} IS NOT NULL`);
          break;
        case "voided":
          conditions.push(sql`${workers.voidedAt} IS NOT NULL`);
          break;
        case "merged":
          conditions.push(sql`${workers.mergedAt} IS NOT NULL`);
          break;
      }

      let query = database.select().from(workers).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(asc(workers.legalName), asc(workers.id)).limit(queryLimit(filters));
    },

    createWorker: async (values) => {
      const [row] = await database.insert(workers).values(compact(values)).returning();
      return row;
    },

    updateWorker: async (id, values) => {
      const [row] = await database
        .update(workers)
        .set(compact(values))
        .where(eq(workers.id, id))
        .returning();
      return row;
    },

    getEmployment: async (id) => {
      const [row] = await database.select().from(employments).where(eq(employments.id, id));
      return row;
    },

    listEmployments: async (filters) => {
      const conditions = [];
      if (filters.workerId) {
        conditions.push(eq(employments.workerId, filters.workerId));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(employments.legalEntityId, filters.legalEntityId));
      }
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(employments.status, filters.status));
      }

      let query = database.select().from(employments).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(employments.startDate), desc(employments.id)).limit(queryLimit(filters));
    },

    findCurrentEmploymentConflict: async (filters) => {
      const conditions = [
        eq(employments.workerId, filters.workerId),
        eq(employments.legalEntityId, filters.legalEntityId),
        inArray(employments.status, ["draft", "active", "on_leave"]),
      ];
      if (filters.excludeEmploymentId) {
        conditions.push(sql`${employments.id} <> ${filters.excludeEmploymentId}`);
      }
      const [row] = await database
        .select()
        .from(employments)
        .where(and(...conditions))
        .limit(1);
      return row;
    },

    createEmployment: async (values) => {
      const [row] = await database.insert(employments).values(compact(values)).returning();
      return row;
    },

    updateEmployment: async (id, values) => {
      const [row] = await database
        .update(employments)
        .set(compact(values))
        .where(eq(employments.id, id))
        .returning();
      return row;
    },

    getCompensationTerm: async (id) => {
      const [row] = await database.select().from(compensationTerms).where(eq(compensationTerms.id, id));
      return row;
    },

    listCompensationTerms: async (filters) => {
      const conditions = [];
      if (filters.employmentId) {
        conditions.push(eq(compensationTerms.employmentId, filters.employmentId));
      }
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(compensationTerms.status, filters.status));
      }

      let query = database.select().from(compensationTerms).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query
        .orderBy(desc(compensationTerms.effectiveFrom), desc(compensationTerms.id))
        .limit(queryLimit(filters));
    },

    listActiveCompensationTermsForEmployment: async (employmentId) => (
      await database
        .select()
        .from(compensationTerms)
        .where(and(
          eq(compensationTerms.employmentId, employmentId),
          eq(compensationTerms.status, "active"),
        ))
        .orderBy(asc(compensationTerms.effectiveFrom), asc(compensationTerms.id))
    ),

    createCompensationTerm: async (values) => {
      const [row] = await database.insert(compensationTerms).values(compact(values)).returning();
      return row;
    },

    updateCompensationTerm: async (id, values) => {
      const [row] = await database
        .update(compensationTerms)
        .set(compact(values))
        .where(eq(compensationTerms.id, id))
        .returning();
      return row;
    },

    getWorkAuthorization: async (id) => {
      const [row] = await database.select().from(workAuthorizations).where(eq(workAuthorizations.id, id));
      return row;
    },

    listWorkAuthorizations: async (filters: WorkAuthorizationListFilters) => {
      const conditions = [];
      if (filters.workerId) {
        conditions.push(eq(workAuthorizations.workerId, filters.workerId));
      }
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(workAuthorizations.status, filters.status));
      }
      if (filters.authorizationType && filters.authorizationType !== "all") {
        conditions.push(eq(workAuthorizations.authorizationType, filters.authorizationType));
      }

      let query = database.select().from(workAuthorizations).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query
        .orderBy(desc(workAuthorizations.validThrough), desc(workAuthorizations.id))
        .limit(Math.min(250, Math.max(1, filters.pageSize ?? 100)));
    },

    createWorkAuthorization: async (values) => {
      const [row] = await database.insert(workAuthorizations).values(compact(values)).returning();
      return row;
    },

    updateWorkAuthorization: async (id, values) => {
      const [row] = await database
        .update(workAuthorizations)
        .set(compact(values))
        .where(eq(workAuthorizations.id, id))
        .returning();
      return row;
    },

    createPersonnelAuditEvent: async (values) => {
      const [row] = await database.insert(personnelAuditEvents).values(compact(values)).returning();
      return row;
    },
  };

  return repository;
}

export const personnelRepository = createRepository(db);

export type {
  InsertCompensationTerm,
  InsertEmployment,
  InsertPersonnelAuditEvent,
  InsertWorkAuthorization,
  InsertWorker,
};
