import { db } from "./db";
import {
  createFinanceExpenseRepository,
  type InsertDocument,
  type InsertDocumentLink,
  type InsertExpensePayment,
  type InsertFinanceAuditEvent,
  type InsertReconciliationException,
  type InsertRecurringExpense,
  type InsertVendor,
  type InsertVendorBill,
  type InsertVendorBillApplication,
} from "./financeExpenseRepositoryFactory";

export const financeExpenseRepository = createFinanceExpenseRepository(db);

export { createFinanceExpenseRepository };
export type {
  InsertDocument,
  InsertDocumentLink,
  InsertExpensePayment,
  InsertFinanceAuditEvent,
  InsertReconciliationException,
  InsertRecurringExpense,
  InsertVendor,
  InsertVendorBill,
  InsertVendorBillApplication,
};
