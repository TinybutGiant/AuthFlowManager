import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  externalRecordRefs,
  reconciliationExceptions,
  legalEntities,
  taxAgencies,
  taxAgencyPayments,
  taxAuditEvents,
  taxFilings,
  taxLiabilities,
  taxPaymentAllocations,
  taxRegistrations,
  vendors,
  type FinanceEntityType,
  type InsertExternalRecordRef,
  type InsertReconciliationException,
  type InsertTaxAgency,
  type InsertTaxAgencyPayment,
  type InsertTaxAuditEvent,
  type InsertTaxFiling,
  type InsertTaxLiability,
  type InsertTaxPaymentAllocation,
  type InsertTaxRegistration,
} from "@shared/schema";
import { db } from "./db";
import type {
  TaxAgencyListFilters,
  TaxAgencyPaymentListFilters,
  TaxFilingListFilters,
  TaxLiabilityListFilters,
  TaxPaymentAllocationListFilters,
  TaxReconciliationListFilters,
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
    lockTaxAgencyPayment: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_agency_payments" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxPaymentAllocation: async (id) => {
      await database.execute(sql`SELECT "id" FROM "tax_payment_allocations" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockTaxPaymentAllocationsForPayment: async (taxAgencyPaymentId) => {
      await database.execute(sql`SELECT "id" FROM "tax_payment_allocations" WHERE "tax_agency_payment_id" = ${taxAgencyPaymentId} FOR UPDATE`);
    },
    lockTaxPaymentAllocationsForLiability: async (taxLiabilityId) => {
      await database.execute(sql`SELECT "id" FROM "tax_payment_allocations" WHERE "tax_liability_id" = ${taxLiabilityId} FOR UPDATE`);
    },
    lockReconciliationException: async (id) => {
      await database.execute(sql`SELECT "id" FROM "reconciliation_exceptions" WHERE "id" = ${id} AND "domain" = 'tax' FOR UPDATE`);
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
      if (filing) return true;
      const [payment] = await database.select({ id: taxAgencyPayments.id }).from(taxAgencyPayments).where(eq(taxAgencyPayments.taxRegistrationId, id)).limit(1);
      return Boolean(payment);
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

    getTaxAgencyPayment: async (id) => {
      const [row] = await database.select().from(taxAgencyPayments).where(eq(taxAgencyPayments.id, id));
      return row;
    },
    listTaxAgencyPayments: async (filters: TaxAgencyPaymentListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxAgencyPayments.status, filters.status));
      }
      if (filters.taxRegistrationId) {
        conditions.push(eq(taxAgencyPayments.taxRegistrationId, filters.taxRegistrationId));
      }
      let query = database.select().from(taxAgencyPayments).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(taxAgencyPayments.paymentDate), desc(taxAgencyPayments.createdAt), desc(taxAgencyPayments.id)).limit(listLimit(filters.pageSize));
    },
    createTaxAgencyPayment: async (values: InsertTaxAgencyPayment) => {
      const [row] = await database.insert(taxAgencyPayments).values(compact(values)).returning();
      return row;
    },
    updateTaxAgencyPayment: async (id, values: Partial<InsertTaxAgencyPayment>) => {
      const [row] = await database
        .update(taxAgencyPayments)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxAgencyPayments.id, id))
        .returning();
      return row;
    },

    getTaxPaymentAllocation: async (id) => {
      const [row] = await database.select().from(taxPaymentAllocations).where(eq(taxPaymentAllocations.id, id));
      return row;
    },
    listTaxPaymentAllocations: async (filters: TaxPaymentAllocationListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(taxPaymentAllocations.status, filters.status));
      }
      if (filters.taxLiabilityId) {
        conditions.push(eq(taxPaymentAllocations.taxLiabilityId, filters.taxLiabilityId));
      }
      if (filters.taxAgencyPaymentId) {
        conditions.push(eq(taxPaymentAllocations.taxAgencyPaymentId, filters.taxAgencyPaymentId));
      }
      let query = database.select().from(taxPaymentAllocations).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(taxPaymentAllocations.createdAt), desc(taxPaymentAllocations.id)).limit(listLimit(filters.pageSize));
    },
    createTaxPaymentAllocation: async (values: InsertTaxPaymentAllocation) => {
      const [row] = await database.insert(taxPaymentAllocations).values(compact(values)).returning();
      return row;
    },
    updateTaxPaymentAllocation: async (id, values: Partial<InsertTaxPaymentAllocation>) => {
      const [row] = await database
        .update(taxPaymentAllocations)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(taxPaymentAllocations.id, id))
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

    getReconciliationException: async (id) => {
      const [row] = await database
        .select()
        .from(reconciliationExceptions)
        .where(and(
          eq(reconciliationExceptions.id, id),
          eq(reconciliationExceptions.domain, "tax"),
        ));
      return row;
    },
    listReconciliationExceptions: async (filters: TaxReconciliationListFilters) => {
      const conditions = [eq(reconciliationExceptions.domain, "tax")];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(reconciliationExceptions.status, filters.status));
      }
      return await database
        .select()
        .from(reconciliationExceptions)
        .where(and(...conditions))
        .orderBy(desc(reconciliationExceptions.createdAt), desc(reconciliationExceptions.id))
        .limit(listLimit(filters.pageSize));
    },
    createReconciliationException: async (values: InsertReconciliationException) => {
      const [row] = await database.insert(reconciliationExceptions).values(compact(values)).returning();
      return row;
    },
    updateReconciliationException: async (id, values: Partial<InsertReconciliationException>) => {
      const [row] = await database
        .update(reconciliationExceptions)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(and(
          eq(reconciliationExceptions.id, id),
          eq(reconciliationExceptions.domain, "tax"),
        ))
        .returning();
      return row;
    },

    entityExists: async (entityType: FinanceEntityType, entityId: number) => {
      const tableByEntity: Partial<Record<FinanceEntityType, any>> = {
        tax_agencies: taxAgencies,
        tax_registrations: taxRegistrations,
        tax_liabilities: taxLiabilities,
        tax_agency_payments: taxAgencyPayments,
        tax_payment_allocations: taxPaymentAllocations,
        tax_filings: taxFilings,
        reconciliation_exceptions: reconciliationExceptions,
      };
      const table = tableByEntity[entityType];
      if (!table) return false;
      if (entityType === "reconciliation_exceptions") {
        const [row] = await database
          .select({ id: reconciliationExceptions.id })
          .from(reconciliationExceptions)
          .where(and(
            eq(reconciliationExceptions.id, entityId),
            eq(reconciliationExceptions.domain, "tax"),
          ))
          .limit(1);
        return Boolean(row);
      }
      const [row] = await database.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
      return Boolean(row);
    },

    createTaxAuditEvent: async (values: InsertTaxAuditEvent) => {
      const [row] = await database.insert(taxAuditEvents).values(values).returning();
      return row;
    },
  };

  return repository;
}

export const taxRepository = createRepository(db);
