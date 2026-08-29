import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  documentLinks,
  documents,
  expensePayments,
  legalEntities,
  reconciliationExceptions,
  recurringExpenses,
  vendorBillApplications,
  vendorBills,
  vendors,
  type AllocationStatus,
  type FinanceEntityType,
  type InsertDocument,
  type InsertDocumentLink,
  type InsertExpensePayment,
  type InsertRecurringExpense,
  type InsertVendor,
  type InsertVendorBill,
  type InsertVendorBillApplication,
} from "@shared/schema";
import { db } from "./db";
import type {
  ExpensePaymentListItem,
  FinanceExpenseRepository,
  FinanceListQuery,
  FinanceOverviewInput,
  FinanceVendorListItem,
  RecurringExpenseListItem,
  VendorBillListItem,
} from "./financeExpenseService";
import { deriveVendorBillSettlementState } from "./financeDomainValidation";

type DrizzleDb = any;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function queryLimit(filters: FinanceListQuery) {
  return Math.min(250, Math.max(1, filters.pageSize ?? 100));
}

function searchPattern(search?: string | null) {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.toLowerCase()}%` : null;
}

function activeApplicationTotal(applications: Array<{ amountCents: number; status: string }>) {
  return applications
    .filter((application) => application.status === "active")
    .reduce((total, application) => total + application.amountCents, 0);
}

function mapBillRows(
  rows: Array<{
    bill: {
      id: number;
      vendorId: number;
      recurringExpenseId: number | null;
      invoiceNumber: string | null;
      billKind: string;
      issueDate: string | Date | null;
      dueDate: string | Date | null;
      servicePeriodStart: string | Date | null;
      servicePeriodEnd: string | Date | null;
      amountCents: number;
      currency: string;
      categoryCode: string;
      status: string;
      creditForVendorBillId: number | null;
    };
    vendorName: string | null;
    recurringExpectedAmountCents: number | null;
  }>,
  applications: typeof vendorBillApplications.$inferSelect[],
  documentCounts: Map<number, number>,
): VendorBillListItem[] {
  return rows.map((row) => {
    const billApplications = applications.filter((application) => application.targetVendorBillId === row.bill.id);
    const activeAppliedAmountCents = activeApplicationTotal(billApplications);
    return {
      id: row.bill.id,
      vendorId: row.bill.vendorId,
      recurringExpenseId: row.bill.recurringExpenseId,
      invoiceNumber: row.bill.invoiceNumber,
      billKind: row.bill.billKind,
      issueDate: row.bill.issueDate,
      dueDate: row.bill.dueDate,
      servicePeriodStart: row.bill.servicePeriodStart,
      servicePeriodEnd: row.bill.servicePeriodEnd,
      amountCents: row.bill.amountCents,
      currency: row.bill.currency,
      categoryCode: row.bill.categoryCode,
      status: row.bill.status,
      creditForVendorBillId: row.bill.creditForVendorBillId,
      vendorName: row.vendorName,
      activeAppliedAmountCents,
      remainingAmountCents: Math.max(0, row.bill.amountCents - activeAppliedAmountCents),
      settlementState: deriveVendorBillSettlementState(row.bill, billApplications),
      documentCount: documentCounts.get(row.bill.id) ?? 0,
      recurringExpectedAmountCents: row.recurringExpectedAmountCents,
    };
  });
}

function mapPaymentRows(
  rows: Array<{
    payment: {
      id: number;
      vendorId: number | null;
      amountCents: number;
      currency: string;
      direction: string;
      paymentDate: string | Date | null;
      methodType: string;
      methodLabel: string | null;
      institutionName: string | null;
      maskedLast4: string | null;
      status: string;
    };
    vendorName: string | null;
  }>,
  applications: typeof vendorBillApplications.$inferSelect[],
): ExpensePaymentListItem[] {
  return rows.map((row) => {
    const activeAppliedAmountCents = activeApplicationTotal(
      applications.filter((application) => application.expensePaymentId === row.payment.id),
    );
    return {
      id: row.payment.id,
      vendorId: row.payment.vendorId,
      amountCents: row.payment.amountCents,
      currency: row.payment.currency,
      direction: row.payment.direction,
      paymentDate: row.payment.paymentDate,
      methodType: row.payment.methodType,
      methodLabel: row.payment.methodLabel,
      institutionName: row.payment.institutionName,
      maskedLast4: row.payment.maskedLast4,
      status: row.payment.status,
      vendorName: row.vendorName,
      activeAppliedAmountCents,
      remainingAmountCents: Math.max(0, row.payment.amountCents - activeAppliedAmountCents),
    };
  });
}

async function documentCountsForBills(database: DrizzleDb, billIds: number[]) {
  if (billIds.length === 0) {
    return new Map<number, number>();
  }

  const rows = await database
    .select({
      entityId: documentLinks.entityId,
      value: count(),
    })
    .from(documentLinks)
    .where(
      and(
        eq(documentLinks.entityType, "vendor_bills"),
        eq(documentLinks.status, "active"),
        inArray(documentLinks.entityId, billIds),
      ),
    )
    .groupBy(documentLinks.entityId);

  return new Map<number, number>(rows.map((row: any) => [row.entityId, Number(row.value ?? 0)]));
}

async function applicationsForBills(database: DrizzleDb, billIds: number[]) {
  if (billIds.length === 0) return [];
  return await database
    .select()
    .from(vendorBillApplications)
    .where(inArray(vendorBillApplications.targetVendorBillId, billIds));
}

async function applicationsForPayments(database: DrizzleDb, paymentIds: number[]) {
  if (paymentIds.length === 0) return [];
  return await database
    .select()
    .from(vendorBillApplications)
    .where(inArray(vendorBillApplications.expensePaymentId, paymentIds));
}

function createRepository(database: DrizzleDb): FinanceExpenseRepository {
  const repository: FinanceExpenseRepository = {
    transaction: async (work) => (
      typeof database.transaction === "function"
        ? await database.transaction(async (tx: DrizzleDb) => work(createRepository(tx)))
        : await work(repository)
    ),

    lockVendorBill: async (id) => {
      await database.execute(sql`SELECT "id" FROM "vendor_bills" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockExpensePayment: async (id) => {
      await database.execute(sql`SELECT "id" FROM "expense_payments" WHERE "id" = ${id} FOR UPDATE`);
    },

    lockVendorBillApplication: async (id) => {
      await database.execute(sql`SELECT "id" FROM "vendor_bill_applications" WHERE "id" = ${id} FOR UPDATE`);
    },

    getLegalEntity: async (id) => {
      const [row] = await database.select().from(legalEntities).where(eq(legalEntities.id, id));
      return row;
    },

    getVendor: async (id) => {
      const [row] = await database.select().from(vendors).where(eq(vendors.id, id));
      return row;
    },

    listVendors: async (filters) => {
      const conditions = [];
      const pattern = searchPattern(filters.search);
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(vendors.status, filters.status));
      }
      if (pattern) {
        conditions.push(sql`lower(${vendors.name}) LIKE ${pattern}`);
      }

      let query = database
        .select({
          id: vendors.id,
          name: vendors.name,
          vendorType: vendors.vendorType,
          status: vendors.status,
          website: vendors.website,
          contactEmail: vendors.contactEmail,
        })
        .from(vendors)
        .$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(asc(vendors.name)).limit(queryLimit(filters)) satisfies FinanceVendorListItem[];
    },

    createVendor: async (values) => {
      const [row] = await database.insert(vendors).values(compact(values)).returning();
      return row;
    },

    updateVendor: async (id, values) => {
      const [row] = await database
        .update(vendors)
        .set(compact(values))
        .where(eq(vendors.id, id))
        .returning();
      return row;
    },

    getRecurringExpense: async (id) => {
      const [row] = await database.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
      return row;
    },

    listRecurringExpenses: async (filters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(recurringExpenses.status, filters.status));
      }
      if (filters.vendorId) {
        conditions.push(eq(recurringExpenses.vendorId, filters.vendorId));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(recurringExpenses.legalEntityId, filters.legalEntityId));
      }

      let query = database
        .select({
          id: recurringExpenses.id,
          legalEntityId: recurringExpenses.legalEntityId,
          vendorId: recurringExpenses.vendorId,
          vendorName: vendors.name,
          categoryCode: recurringExpenses.categoryCode,
          cadence: recurringExpenses.cadence,
          expectedAmountCents: recurringExpenses.expectedAmountCents,
          currency: recurringExpenses.currency,
          variableAmount: recurringExpenses.variableAmount,
          billingDay: recurringExpenses.billingDay,
          nextBillingDate: recurringExpenses.nextBillingDate,
          renewalDate: recurringExpenses.renewalDate,
          autoRenew: recurringExpenses.autoRenew,
          trialEndsOn: recurringExpenses.trialEndsOn,
          cancellationDate: recurringExpenses.cancellationDate,
          status: recurringExpenses.status,
        })
        .from(recurringExpenses)
        .leftJoin(vendors, eq(recurringExpenses.vendorId, vendors.id))
        .$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const rows = await query
        .orderBy(asc(recurringExpenses.nextBillingDate), asc(recurringExpenses.id))
        .limit(queryLimit(filters));
      return rows satisfies RecurringExpenseListItem[];
    },

    createRecurringExpense: async (values) => {
      const [row] = await database.insert(recurringExpenses).values(compact(values)).returning();
      return row;
    },

    updateRecurringExpense: async (id, values) => {
      const [row] = await database
        .update(recurringExpenses)
        .set(compact(values))
        .where(eq(recurringExpenses.id, id))
        .returning();
      return row;
    },

    getVendorBill: async (id) => {
      const [row] = await database.select().from(vendorBills).where(eq(vendorBills.id, id));
      return row;
    },

    listVendorBills: async (filters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(vendorBills.status, filters.status));
      }
      if (filters.vendorId) {
        conditions.push(eq(vendorBills.vendorId, filters.vendorId));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(vendorBills.legalEntityId, filters.legalEntityId));
      }
      if (filters.dueFrom) {
        conditions.push(sql`${vendorBills.dueDate} >= ${filters.dueFrom}`);
      }
      if (filters.dueTo) {
        conditions.push(sql`${vendorBills.dueDate} <= ${filters.dueTo}`);
      }

      let query = database
        .select({
          bill: {
            id: vendorBills.id,
            vendorId: vendorBills.vendorId,
            recurringExpenseId: vendorBills.recurringExpenseId,
            invoiceNumber: vendorBills.invoiceNumber,
            billKind: vendorBills.billKind,
            issueDate: vendorBills.issueDate,
            dueDate: vendorBills.dueDate,
            servicePeriodStart: vendorBills.servicePeriodStart,
            servicePeriodEnd: vendorBills.servicePeriodEnd,
            amountCents: vendorBills.amountCents,
            currency: vendorBills.currency,
            categoryCode: vendorBills.categoryCode,
            status: vendorBills.status,
            creditForVendorBillId: vendorBills.creditForVendorBillId,
          },
          vendorName: vendors.name,
          recurringExpectedAmountCents: recurringExpenses.expectedAmountCents,
        })
        .from(vendorBills)
        .leftJoin(vendors, eq(vendorBills.vendorId, vendors.id))
        .leftJoin(recurringExpenses, eq(vendorBills.recurringExpenseId, recurringExpenses.id))
        .$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const rows = await query
        .orderBy(asc(vendorBills.dueDate), desc(vendorBills.createdAt))
        .limit(queryLimit(filters));
      const billIds = rows.map((row: any) => row.bill.id);
      const [applications, documentCounts] = await Promise.all([
        applicationsForBills(database, billIds),
        documentCountsForBills(database, billIds),
      ]);
      return mapBillRows(rows, applications, documentCounts);
    },

    createVendorBill: async (values) => {
      const [row] = await database.insert(vendorBills).values(compact(values)).returning();
      return row;
    },

    updateVendorBill: async (id, values) => {
      const [row] = await database
        .update(vendorBills)
        .set(compact(values))
        .where(eq(vendorBills.id, id))
        .returning();
      return row;
    },

    getExpensePayment: async (id) => {
      const [row] = await database.select().from(expensePayments).where(eq(expensePayments.id, id));
      return row;
    },

    listExpensePayments: async (filters) => {
      const conditions = [];
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(expensePayments.status, filters.status));
      }
      if (filters.vendorId) {
        conditions.push(eq(expensePayments.vendorId, filters.vendorId));
      }
      if (filters.legalEntityId) {
        conditions.push(eq(expensePayments.legalEntityId, filters.legalEntityId));
      }

      let query = database
        .select({
          payment: {
            id: expensePayments.id,
            vendorId: expensePayments.vendorId,
            amountCents: expensePayments.amountCents,
            currency: expensePayments.currency,
            direction: expensePayments.direction,
            paymentDate: expensePayments.paymentDate,
            methodType: expensePayments.methodType,
            methodLabel: expensePayments.methodLabel,
            institutionName: expensePayments.institutionName,
            maskedLast4: expensePayments.maskedLast4,
            status: expensePayments.status,
          },
          vendorName: vendors.name,
        })
        .from(expensePayments)
        .leftJoin(vendors, eq(expensePayments.vendorId, vendors.id))
        .$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const rows = await query
        .orderBy(desc(expensePayments.paymentDate), desc(expensePayments.createdAt))
        .limit(queryLimit(filters));
      const applications = await applicationsForPayments(database, rows.map((row: any) => row.payment.id));
      return mapPaymentRows(rows, applications);
    },

    createExpensePayment: async (values) => {
      const [row] = await database.insert(expensePayments).values(compact(values)).returning();
      return row;
    },

    updateExpensePayment: async (id, values) => {
      const [row] = await database
        .update(expensePayments)
        .set(compact(values))
        .where(eq(expensePayments.id, id))
        .returning();
      return row;
    },

    getVendorBillApplication: async (id) => {
      const [row] = await database
        .select()
        .from(vendorBillApplications)
        .where(eq(vendorBillApplications.id, id));
      return row;
    },

    listVendorBillApplications: async (filters) => {
      const conditions = [];
      if (filters.targetVendorBillId) {
        conditions.push(eq(vendorBillApplications.targetVendorBillId, filters.targetVendorBillId));
      }
      if (filters.expensePaymentId) {
        conditions.push(eq(vendorBillApplications.expensePaymentId, filters.expensePaymentId));
      }
      if (filters.creditVendorBillId) {
        conditions.push(eq(vendorBillApplications.creditVendorBillId, filters.creditVendorBillId));
      }
      if (filters.status) {
        conditions.push(eq(vendorBillApplications.status, filters.status));
      }

      let query = database.select().from(vendorBillApplications).$dynamic();
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      return await query.orderBy(desc(vendorBillApplications.createdAt));
    },

    createVendorBillApplication: async (values) => {
      const [row] = await database.insert(vendorBillApplications).values(compact(values)).returning();
      return row;
    },

    updateVendorBillApplication: async (id, values) => {
      const [row] = await database
        .update(vendorBillApplications)
        .set(compact(values))
        .where(eq(vendorBillApplications.id, id))
        .returning();
      return row;
    },

    createDocumentWithLink: async (values) => {
      const createRows = async (client: DrizzleDb) => {
        const [document] = await client.insert(documents).values(compact(values.document)).returning();
        const linkValues: InsertDocumentLink = {
          ...values.link,
          documentId: document.id,
        };
        const [link] = await client.insert(documentLinks).values(compact(linkValues)).returning();
        return { document, link };
      };

      return typeof database.transaction === "function"
        ? await database.transaction((tx: DrizzleDb) => createRows(tx))
        : await createRows(database);
    },

    entityExists: async (entityType: FinanceEntityType, entityId: number) => {
      const tableByEntity: Partial<Record<FinanceEntityType, any>> = {
        vendors,
        recurring_expenses: recurringExpenses,
        vendor_bills: vendorBills,
        expense_payments: expensePayments,
        vendor_bill_applications: vendorBillApplications,
      };
      const table = tableByEntity[entityType];
      if (!table) return false;
      const [row] = await database.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
      return Boolean(row);
    },

    getFinanceOverviewRows: async (today) => {
      const billRows = await database
        .select({
          bill: {
            id: vendorBills.id,
            vendorId: vendorBills.vendorId,
            recurringExpenseId: vendorBills.recurringExpenseId,
            invoiceNumber: vendorBills.invoiceNumber,
            billKind: vendorBills.billKind,
            issueDate: vendorBills.issueDate,
            dueDate: vendorBills.dueDate,
            servicePeriodStart: vendorBills.servicePeriodStart,
            servicePeriodEnd: vendorBills.servicePeriodEnd,
            amountCents: vendorBills.amountCents,
            currency: vendorBills.currency,
            categoryCode: vendorBills.categoryCode,
            status: vendorBills.status,
            creditForVendorBillId: vendorBills.creditForVendorBillId,
          },
          vendorName: vendors.name,
          recurringExpectedAmountCents: recurringExpenses.expectedAmountCents,
        })
        .from(vendorBills)
        .leftJoin(vendors, eq(vendorBills.vendorId, vendors.id))
        .leftJoin(recurringExpenses, eq(vendorBills.recurringExpenseId, recurringExpenses.id))
        .where(sql`${vendorBills.status} <> 'voided'`)
        .orderBy(asc(vendorBills.dueDate), desc(vendorBills.createdAt))
        .limit(1000);
      const billIds = billRows.map((row: any) => row.bill.id);
      const [applications, documentCounts, subscriptionRows, exceptionRows] = await Promise.all([
        applicationsForBills(database, billIds),
        documentCountsForBills(database, billIds),
        database
          .select({
            id: recurringExpenses.id,
            legalEntityId: recurringExpenses.legalEntityId,
            vendorId: recurringExpenses.vendorId,
            vendorName: vendors.name,
            categoryCode: recurringExpenses.categoryCode,
            cadence: recurringExpenses.cadence,
            expectedAmountCents: recurringExpenses.expectedAmountCents,
            currency: recurringExpenses.currency,
            variableAmount: recurringExpenses.variableAmount,
            billingDay: recurringExpenses.billingDay,
            nextBillingDate: recurringExpenses.nextBillingDate,
            renewalDate: recurringExpenses.renewalDate,
            autoRenew: recurringExpenses.autoRenew,
            trialEndsOn: recurringExpenses.trialEndsOn,
            cancellationDate: recurringExpenses.cancellationDate,
            status: recurringExpenses.status,
          })
          .from(recurringExpenses)
          .leftJoin(vendors, eq(recurringExpenses.vendorId, vendors.id))
          .where(inArray(recurringExpenses.status, ["trial", "active", "paused"]))
          .orderBy(asc(recurringExpenses.nextBillingDate), asc(recurringExpenses.id))
          .limit(1000),
        database
          .select()
          .from(reconciliationExceptions)
          .where(
            and(
              eq(reconciliationExceptions.domain, "ap"),
              inArray(reconciliationExceptions.status, ["open", "investigating"]),
            ),
          )
          .limit(1000),
      ]);

      const bills = mapBillRows(billRows, applications, documentCounts);
      return {
        today,
        bills: bills.map((bill) => ({
          id: bill.id,
          vendorId: bill.vendorId,
          vendorName: bill.vendorName,
          billKind: bill.billKind,
          status: bill.status,
          dueDate: bill.dueDate,
          amountCents: bill.amountCents,
          currency: bill.currency,
          categoryCode: bill.categoryCode,
          recurringExpenseId: bill.recurringExpenseId,
          recurringExpectedAmountCents: bill.recurringExpectedAmountCents,
          activeAppliedAmountCents: bill.activeAppliedAmountCents,
          documentCount: bill.documentCount,
        })),
        subscriptions: subscriptionRows,
        reconciliationExceptions: exceptionRows,
      } satisfies FinanceOverviewInput;
    },
  };

  return repository;
}

export const financeExpenseRepository = createRepository(db);

export type {
  InsertDocument,
  InsertDocumentLink,
  InsertExpensePayment,
  InsertRecurringExpense,
  InsertVendor,
  InsertVendorBill,
  InsertVendorBillApplication,
};
