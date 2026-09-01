import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  InsertExternalRecordRef,
  InsertPayrollAuditEvent,
  InsertPayrollPayment,
  InsertPayrollResultLine,
  InsertPayrollRun,
  InsertPayrollRunWorker,
} from "@shared/schema";
import {
  employments,
  externalRecordRefs,
  legalEntities,
  payrollAuditEvents,
  payrollPayments,
  payrollResultLines,
  payrollRunWorkers,
  payrollRuns,
  vendors,
  workers,
} from "./payrollSchema";
import type { PayrollEmploymentOptionFilters, PayrollRepository, PayrollRunListFilters } from "./payrollService";

type DrizzleDb = any;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function listLimit(pageSize?: number) {
  return Math.min(250, Math.max(1, pageSize ?? 100));
}

export function createPayrollRepository(database: DrizzleDb): PayrollRepository {
  const repository: PayrollRepository = {
    transaction: async (work) => (
      typeof database.transaction === "function"
        ? await database.transaction(async (tx: DrizzleDb) => work(createPayrollRepository(tx)))
        : await work(repository)
    ),

    lockPayrollRun: async (id) => {
      await database.execute(sql`SELECT "id" FROM "payroll_runs" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockPayrollRunWorker: async (id) => {
      await database.execute(sql`SELECT "id" FROM "payroll_run_workers" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockPayrollResultLine: async (id) => {
      await database.execute(sql`SELECT "id" FROM "payroll_result_lines" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockPayrollPayment: async (id) => {
      await database.execute(sql`SELECT "id" FROM "payroll_payments" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockWorker: async (id) => {
      await database.execute(sql`SELECT "id" FROM "workers" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockEmployment: async (id) => {
      await database.execute(sql`SELECT "id" FROM "employments" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockLegalEntity: async (id) => {
      await database.execute(sql`SELECT "id" FROM "legal_entities" WHERE "id" = ${id} FOR UPDATE`);
    },
    lockVendor: async (id) => {
      await database.execute(sql`SELECT "id" FROM "vendors" WHERE "id" = ${id} FOR UPDATE`);
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
    listPayrollVendors: async () => (
      await database
        .select()
        .from(vendors)
        .where(and(
          inArray(vendors.vendorType, ["payroll_provider", "professional_service", "other"]),
          sql`${vendors.status} <> 'archived'`,
        ))
        .orderBy(asc(vendors.name), asc(vendors.id))
        .limit(250)
    ),
    getWorker: async (id) => {
      const [row] = await database.select().from(workers).where(eq(workers.id, id));
      return row;
    },
    getEmployment: async (id) => {
      const [row] = await database.select().from(employments).where(eq(employments.id, id));
      return row;
    },
    listPayrollEmploymentOptions: async (filters: PayrollEmploymentOptionFilters) => {
      const conditions = [];
      if (filters.legalEntityId) {
        conditions.push(eq(employments.legalEntityId, filters.legalEntityId));
      }
      conditions.push(sql`${employments.status} <> 'voided'`);
      let query = database.select().from(employments).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(employments.startDate), desc(employments.id)).limit(listLimit(filters.pageSize));
    },

    getPayrollRun: async (id) => {
      const [row] = await database.select().from(payrollRuns).where(eq(payrollRuns.id, id));
      return row;
    },
    findPayrollCorrectionSuccessor: async (payrollRunId) => {
      const [row] = await database
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.correctionOfPayrollRunId, payrollRunId))
        .orderBy(desc(payrollRuns.id))
        .limit(1);
      return row;
    },
    listPayrollRuns: async (filters: PayrollRunListFilters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(payrollRuns.status, filters.status));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(payrollRuns.legalEntityId, filters.legalEntityId));
      }
      let query = database.select().from(payrollRuns).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query
        .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.periodEnd), desc(payrollRuns.id))
        .limit(listLimit(filters.pageSize));
    },
    createPayrollRun: async (values: InsertPayrollRun) => {
      const [row] = await database.insert(payrollRuns).values(compact(values)).returning();
      return row;
    },
    updatePayrollRun: async (id, values: Partial<InsertPayrollRun>) => {
      const [row] = await database
        .update(payrollRuns)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(payrollRuns.id, id))
        .returning();
      return row;
    },

    getPayrollRunWorker: async (id) => {
      const [row] = await database.select().from(payrollRunWorkers).where(eq(payrollRunWorkers.id, id));
      return row;
    },
    findPayrollRunWorkerByRunEmployment: async (payrollRunId, employmentId) => {
      const [row] = await database
        .select()
        .from(payrollRunWorkers)
        .where(and(
          eq(payrollRunWorkers.payrollRunId, payrollRunId),
          eq(payrollRunWorkers.employmentId, employmentId),
        ));
      return row;
    },
    listPayrollRunWorkers: async (payrollRunId) => (
      await database
        .select()
        .from(payrollRunWorkers)
        .where(eq(payrollRunWorkers.payrollRunId, payrollRunId))
        .orderBy(asc(payrollRunWorkers.id))
    ),
    listPayrollRunWorkersForRuns: async (payrollRunIds) => {
      if (payrollRunIds.length === 0) return [];
      return await database
        .select()
        .from(payrollRunWorkers)
        .where(inArray(payrollRunWorkers.payrollRunId, payrollRunIds))
        .orderBy(asc(payrollRunWorkers.payrollRunId), asc(payrollRunWorkers.id));
    },
    createPayrollRunWorker: async (values: InsertPayrollRunWorker) => {
      const [row] = await database.insert(payrollRunWorkers).values(compact(values)).returning();
      return row;
    },
    updatePayrollRunWorker: async (id, values: Partial<InsertPayrollRunWorker>) => {
      const [row] = await database
        .update(payrollRunWorkers)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(payrollRunWorkers.id, id))
        .returning();
      return row;
    },
    deletePayrollRunWorker: async (id) => {
      await database.delete(payrollRunWorkers).where(eq(payrollRunWorkers.id, id));
    },

    getPayrollResultLine: async (id) => {
      const [row] = await database.select().from(payrollResultLines).where(eq(payrollResultLines.id, id));
      return row;
    },
    listPayrollResultLines: async (payrollRunWorkerId) => (
      await database
        .select()
        .from(payrollResultLines)
        .where(eq(payrollResultLines.payrollRunWorkerId, payrollRunWorkerId))
        .orderBy(asc(payrollResultLines.id))
    ),
    listPayrollResultLinesForWorkers: async (payrollRunWorkerIds) => {
      if (payrollRunWorkerIds.length === 0) return [];
      return await database
        .select()
        .from(payrollResultLines)
        .where(inArray(payrollResultLines.payrollRunWorkerId, payrollRunWorkerIds))
        .orderBy(asc(payrollResultLines.payrollRunWorkerId), asc(payrollResultLines.id));
    },
    createPayrollResultLine: async (values: InsertPayrollResultLine) => {
      const [row] = await database.insert(payrollResultLines).values(compact(values)).returning();
      return row;
    },
    updatePayrollResultLine: async (id, values: Partial<InsertPayrollResultLine>) => {
      const [row] = await database
        .update(payrollResultLines)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(payrollResultLines.id, id))
        .returning();
      return row;
    },
    deletePayrollResultLine: async (id) => {
      await database.delete(payrollResultLines).where(eq(payrollResultLines.id, id));
    },
    deletePayrollResultLinesForWorker: async (payrollRunWorkerId) => {
      await database.delete(payrollResultLines).where(eq(payrollResultLines.payrollRunWorkerId, payrollRunWorkerId));
    },

    getPayrollPayment: async (id) => {
      const [row] = await database.select().from(payrollPayments).where(eq(payrollPayments.id, id));
      return row;
    },
    listPayrollPayments: async (payrollRunWorkerId) => (
      await database
        .select()
        .from(payrollPayments)
        .where(eq(payrollPayments.payrollRunWorkerId, payrollRunWorkerId))
        .orderBy(asc(payrollPayments.id))
    ),
    listPayrollPaymentsForWorkers: async (payrollRunWorkerIds) => {
      if (payrollRunWorkerIds.length === 0) return [];
      return await database
        .select()
        .from(payrollPayments)
        .where(inArray(payrollPayments.payrollRunWorkerId, payrollRunWorkerIds))
        .orderBy(asc(payrollPayments.payrollRunWorkerId), asc(payrollPayments.id));
    },
    createPayrollPayment: async (values: InsertPayrollPayment) => {
      const [row] = await database.insert(payrollPayments).values(compact(values)).returning();
      return row;
    },
    updatePayrollPayment: async (id, values: Partial<InsertPayrollPayment>) => {
      const [row] = await database
        .update(payrollPayments)
        .set(compact({ ...values, updatedAt: new Date() }))
        .where(eq(payrollPayments.id, id))
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

    createPayrollAuditEvent: async (values: InsertPayrollAuditEvent) => {
      const [row] = await database.insert(payrollAuditEvents).values(values).returning();
      return row;
    },
  };

  return repository;
}
