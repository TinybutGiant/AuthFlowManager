import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  externalRecordRefs,
  legalEntities,
  taxAgencies,
  taxAuditEvents,
  taxFilings,
  taxLiabilities,
  taxRegistrations,
  vendors,
  type InsertExternalRecordRef,
  type InsertTaxAgency,
  type InsertTaxAuditEvent,
  type InsertTaxFiling,
  type InsertTaxLiability,
  type InsertTaxRegistration,
} from "@shared/schema";
import { db } from "./db";
import type {
  TaxAgencyListFilters,
  TaxFilingListFilters,
  TaxLiabilityListFilters,
  TaxRegistrationOverlapCandidate,
  TaxRegistrationListFilters,
  TaxRepository,
} from "./taxService";

type DrizzleDb = any;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function listLimit(pageSize?: number) {
  return Math.min(250, Math.max(1, pageSize ?? 100));
}

function searchPattern(search?: string | null) {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.toLowerCase()}%` : null;
}

function dateOnlyParam(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function createRepository(database: DrizzleDb): TaxRepository {
  const repository: TaxRepository = {
    transaction: async (work) => (
      typeof database.transaction === "function"
        ? await database.transaction(async (tx: DrizzleDb) => work(createRepository(tx)))
        : await work(repository)
    ),

    lockLegalEntity: async (id) => {
      await database.execute(sql`SELECT "id" FROM "legal_entities" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxAgency: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_agencies" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxRegistration: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_registrations" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxLiability: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_liabilities" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxLiabilityAdjustments: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_liabilities" WHERE "adjusts_tax_liability_id" = ${id} FOR UPDATE`);
    },
    lockTaxFiling: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_filings" WHERE "id" = ${id} FOR UPDATE`);
    },

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
    getVendor: async (id) => {
      const [row] = await database.select().from(vendors).where(eq(vendors.id, id));
      return row;
    },

    getTaxAgency: async (id) => {
      const [row] = await database.select().from(taxAgencies).where(eq(taxAgencies.id, id));
      return row;
    },
    listTaxAgencies: async (filters: TaxAgencyListFilters) => {
      const conditions = [];
      const pattern = searchPattern(filters.search);
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxAgencies.status, filters.status));
      }
      if (pattern) {
        conditions.push(sql`lower(${taxAgencies.name}) LIKE ${pattern} OR lower(${taxAgencies.agencyCode}) LIKE ${pattern}`);
      }
      let query = database.select().from(taxAgencies).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(asc(taxAgencies.name), asc(taxAgencies.id)).limit(listLimit(filters.pageSize));
    },
    createTaxAgency: async (values: InsertTaxAgency) => {
      const [row] = await database.insert(taxAgencies).values(compact(values)).returning();
      return row;
    },
    updateTaxAgency: async (id, values: Partial<InsertTaxAgency>) => {
      const [row] = await database
        .update(taxAgencies)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxAgencies.id, id))
        .returning();
      return row;
    },

    getTaxRegistration: async (id) => {
      const [row] = await database.select().from(taxRegistrations).where(eq(taxRegistrations.id, id));
      return row;
    },
    listTaxRegistrations: async (filters: TaxRegistrationListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxRegistrations.status, filters.status));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(taxRegistrations.legalEntityId, filters.legalEntityId));
      }
      if (filters.taxAgencyId) {
        conditions.push(eq(taxRegistrations.taxAgencyId, filters.taxAgencyId));
      }
      let query = database.select().from(taxRegistrations).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(taxRegistrations.updatedAt), desc(taxRegistrations.id)).limit(listLimit(filters.pageSize));
    },
    listOverlappingTaxRegistrations: async (input: TaxRegistrationOverlapCandidate) => {
      const rangeStart = dateOnlyParam(input.effectiveFrom) ?? "0001-01-01";
      const rangeEnd = dateOnlyParam(input.effectiveTo) ?? "9999-12-31";
      const conditions = [
        eq(taxRegistrations.legalEntityId, input.legalEntityId),
        eq(taxRegistrations.taxAgencyId, input.taxAgencyId),
        eq(taxRegistrations.taxType, input.taxType),
        eq(taxRegistrations.jurisdictionType, input.jurisdictionType),
        eq(taxRegistrations.jurisdictionCode, input.jurisdictionCode.toUpperCase()),
        sql`${taxRegistrations.status} <> 'closed'`,
        sql`COALESCE(${taxRegistrations.effectiveFrom}, DATE '0001-01-01') <= ${rangeEnd}::date`,
        sql`COALESCE(${taxRegistrations.effectiveTo}, DATE '9999-12-31') >= ${rangeStart}::date`,
      ];
      if (input.excludeRegistrationId) {
        conditions.push(sql`${taxRegistrations.id} <> ${input.excludeRegistrationId}`);
      }
      return await database
        .select()
        .from(taxRegistrations)
        .where(and(...conditions))
        .orderBy(asc(taxRegistrations.effectiveFrom), asc(taxRegistrations.id));
    },
    createTaxRegistration: async (values: InsertTaxRegistration) => {
      const [row] = await database.insert(taxRegistrations).values(compact(values)).returning();
      return row;
    },
    updateTaxRegistration: async (id, values: Partial<InsertTaxRegistration>) => {
      const [row] = await database
        .update(taxRegistrations)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxRegistrations.id, id))
        .returning();
      return row;
    },
    registrationHasTaxFacts: async (id) => {
      const [liability] = await database.select({ id: taxLiabilities.id }).from(taxLiabilities).where(eq(taxLiabilities.taxRegistrationId, id)).limit(1);
      if (liability) return true;
      const [filing] = await database.select({ id: taxFilings.id }).from(taxFilings).where(eq(taxFilings.taxRegistrationId, id)).limit(1);
      return Boolean(filing);
    },

    getTaxLiability: async (id) => {
      const [row] = await database.select().from(taxLiabilities).where(eq(taxLiabilities.id, id));
      return row;
    },
    listTaxLiabilities: async (filters: TaxLiabilityListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxLiabilities.status, filters.status));
      }
      if (filters.taxRegistrationId) {
        conditions.push(eq(taxLiabilities.taxRegistrationId, filters.taxRegistrationId));
      }
      let query = database.select().from(taxLiabilities).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(taxLiabilities.dueDate), desc(taxLiabilities.id)).limit(listLimit(filters.pageSize));
    },
    listTaxLiabilityAdjustments: async (taxLiabilityId) => (
      await database
        .select()
        .from(taxLiabilities)
        .where(eq(taxLiabilities.adjustsTaxLiabilityId, taxLiabilityId))
        .orderBy(asc(taxLiabilities.id))
    ),
    createTaxLiability: async (values: InsertTaxLiability) => {
      const [row] = await database.insert(taxLiabilities).values(compact(values)).returning();
      return row;
    },
    updateTaxLiability: async (id, values: Partial<InsertTaxLiability>) => {
      const [row] = await database
        .update(taxLiabilities)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxLiabilities.id, id))
        .returning();
      return row;
    },

    getTaxFiling: async (id) => {
      const [row] = await database.select().from(taxFilings).where(eq(taxFilings.id, id));
      return row;
    },
    listTaxFilings: async (filters: TaxFilingListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxFilings.status, filters.status));
      }
      if (filters.taxRegistrationId) {
        conditions.push(eq(taxFilings.taxRegistrationId, filters.taxRegistrationId));
      }
      let query = database.select().from(taxFilings).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(taxFilings.dueDate), desc(taxFilings.id)).limit(listLimit(filters.pageSize));
    },
    findOriginalTaxFiling: async (input) => {
      const [row] = await database
        .select()
        .from(taxFilings)
        .where(and(
          eq(taxFilings.taxRegistrationId, input.taxRegistrationId),
          eq(taxFilings.filingType, input.filingType),
          eq(taxFilings.periodStart, input.periodStart),
          eq(taxFilings.periodEnd, input.periodEnd),
          sql`${taxFilings.amendsTaxFilingId} IS NULL`,
          sql`${taxFilings.status} <> 'voided'`,
        ))
        .limit(1);
      return row;
    },
    findTaxFilingAmendmentSuccessor: async (taxFilingId) => {
      const [row] = await database
        .select()
        .from(taxFilings)
        .where(eq(taxFilings.amendsTaxFilingId, taxFilingId))
        .orderBy(desc(taxFilings.id))
        .limit(1);
      return row;
    },
    createTaxFiling: async (values: InsertTaxFiling) => {
      const [row] = await database.insert(taxFilings).values(compact(values)).returning();
      return row;
    },
    updateTaxFiling: async (id, values: Partial<InsertTaxFiling>) => {
      const [row] = await database
        .update(taxFilings)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxFilings.id, id))
        .returning();
      return row;
    },

    getExternalRecordRef: async (id) => {
      const [row] = await database.select().from(externalRecordRefs).where(eq(externalRecordRefs.id, id));
      return row;
    },
    listExternalRecordRefsForEntity: async (entityType, entityId) => (
      await database
        .select()
        .from(externalRecordRefs)
        .where(and(
          eq(externalRecordRefs.entityType, entityType),
          eq(externalRecordRefs.entityId, entityId),
        ))
        .orderBy(desc(externalRecordRefs.createdAt), desc(externalRecordRefs.id))
    ),
    createExternalRecordRef: async (values: InsertExternalRecordRef) => {
      const [row] = await database.insert(externalRecordRefs).values(compact(values)).returning();
      return row;
    },

    createTaxAuditEvent: async (values: InsertTaxAuditEvent) => {
      const [row] = await database.insert(taxAuditEvents).values(values).returning();
      return row;
    },
  };

  return repository;
}

export const taxRepository = createRepository(db);
