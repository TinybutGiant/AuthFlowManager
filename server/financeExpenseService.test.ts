import assert from "node:assert/strict";
import test from "node:test";

import {
  FinanceExpenseServiceError,
  applyFinancePaymentToBill,
  assertVendorBillEditable,
  createFinanceBill,
  createRecurringExpensePayloadSchema,
  deriveFinanceOverviewFromRows,
  monthlyRecurringAmountCents,
  nextExpensePaymentStatus,
  nextVendorBillStatus,
  updateDraftFinanceBill,
  updateRecurringExpensePayloadSchema,
  type FinanceExpenseRepository,
} from "./financeExpenseService";

function assertFinanceError(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error) => error instanceof FinanceExpenseServiceError && error.code === code,
  );
}

async function assertFinanceRejects(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(
    fn,
    (error) => error instanceof FinanceExpenseServiceError && error.code === code,
  );
}

function baseTimestamp() {
  return new Date("2026-08-29T12:00:00.000Z");
}

test("finance overview separates expected subscriptions from actual bills and payments", () => {
  const overview = deriveFinanceOverviewFromRows({
    today: "2026-08-29",
    bills: [
      {
        id: 1,
        vendorId: 10,
        vendorName: "Cloud A",
        billKind: "invoice",
        status: "approved",
        dueDate: "2026-08-31",
        amountCents: 2_000,
        currency: "USD",
        categoryCode: "cloud",
        recurringExpenseId: 100,
        recurringExpectedAmountCents: 2_000,
        activeAppliedAmountCents: 500,
        documentCount: 1,
      },
      {
        id: 2,
        vendorId: 11,
        vendorName: "SaaS B",
        billKind: "invoice",
        status: "received",
        dueDate: "2026-09-05",
        amountCents: 3_000,
        currency: "USD",
        categoryCode: "saas",
        recurringExpenseId: 101,
        recurringExpectedAmountCents: 2_500,
        activeAppliedAmountCents: 0,
        documentCount: 0,
      },
      {
        id: 3,
        vendorId: 11,
        vendorName: "SaaS B",
        billKind: "credit_memo",
        status: "received",
        dueDate: "2026-09-01",
        amountCents: 1_000,
        currency: "USD",
        categoryCode: "saas",
        activeAppliedAmountCents: 0,
        documentCount: 0,
      },
      {
        id: 4,
        vendorId: 12,
        billKind: "invoice",
        status: "draft",
        dueDate: "2026-09-10",
        amountCents: 4_000,
        currency: "USD",
        categoryCode: "professional_service",
        activeAppliedAmountCents: 0,
        documentCount: 0,
      },
      {
        id: 5,
        vendorId: 14,
        vendorName: "CN Utility",
        billKind: "invoice",
        status: "approved",
        dueDate: "2026-09-02",
        amountCents: 5_000,
        currency: "CNY",
        categoryCode: "utility",
        activeAppliedAmountCents: 1_000,
        documentCount: 1,
      },
    ],
    subscriptions: [
      {
        id: 100,
        vendorId: 10,
        status: "active",
        cadence: "monthly",
        expectedAmountCents: 2_000,
        variableAmount: false,
        currency: "USD",
        categoryCode: "cloud",
        nextBillingDate: "2026-09-01",
        autoRenew: true,
      },
      {
        id: 101,
        vendorId: 11,
        status: "active",
        cadence: "annual",
        expectedAmountCents: 12_000,
        variableAmount: false,
        currency: "USD",
        categoryCode: "saas",
        renewalDate: "2027-01-01",
        autoRenew: true,
      },
      {
        id: 102,
        vendorId: 12,
        status: "active",
        cadence: "custom",
        expectedAmountCents: null,
        variableAmount: true,
        currency: "USD",
        categoryCode: "utility",
        autoRenew: false,
      },
      {
        id: 104,
        vendorId: 14,
        status: "active",
        cadence: "monthly",
        expectedAmountCents: 5_000,
        variableAmount: false,
        currency: "CNY",
        categoryCode: "utility",
        nextBillingDate: "2026-09-02",
        autoRenew: true,
      },
      {
        id: 103,
        vendorId: 13,
        status: "paused",
        cadence: "monthly",
        expectedAmountCents: 900,
        variableAmount: false,
        currency: "USD",
        categoryCode: "saas",
        autoRenew: false,
      },
    ],
    reconciliationExceptions: [
      { id: 1, domain: "ap", status: "open" },
      { id: 2, domain: "ap", status: "resolved" },
      { id: 3, domain: "tax", status: "open" },
    ],
  });

  assert.deepEqual(overview.metrics.unpaidBalanceByCurrency, [
    { currency: "CNY", amountCents: 4_000 },
    { currency: "USD", amountCents: 4_500 },
  ]);
  assert.equal(overview.metrics.billsDueThisWeekCount, 3);
  assert.deepEqual(overview.metrics.billsDueThisWeekByCurrency, [
    { currency: "CNY", amountCents: 4_000 },
    { currency: "USD", amountCents: 4_500 },
  ]);
  assert.deepEqual(overview.metrics.billsDueThisMonthByCurrency, [
    { currency: "USD", amountCents: 1_500 },
  ]);
  assert.deepEqual(overview.metrics.monthlyRecurringSpendByCurrency, [
    { currency: "CNY", amountCents: 5_000 },
    { currency: "USD", amountCents: 3_000 },
  ]);
  assert.equal(overview.metrics.variableOrUnknownRecurringCount, 1);
  assert.equal(overview.metrics.activeSubscriptionsCount, 4);
  assert.equal(overview.metrics.openReconciliationIssuesCount, 1);
  assert.equal(overview.metrics.missingDocumentsCount, 1);
  assert.equal(overview.metrics.subscriptionPriceVarianceCount, 1);
  assert.equal(overview.subscriptionPriceVariances[0].differenceAmountCents, 500);
});

test("monthly recurring spend converts fixed active cadences and excludes variable subscriptions", () => {
  assert.equal(monthlyRecurringAmountCents({
    status: "active",
    cadence: "weekly",
    expectedAmountCents: 1_200,
    variableAmount: false,
  }), 5_200);
  assert.equal(monthlyRecurringAmountCents({
    status: "active",
    cadence: "quarterly",
    expectedAmountCents: 9_000,
    variableAmount: false,
  }), 3_000);
  assert.equal(monthlyRecurringAmountCents({
    status: "active",
    cadence: "custom",
    expectedAmountCents: 9_000,
    variableAmount: false,
  }), null);
  assert.equal(monthlyRecurringAmountCents({
    status: "paused",
    cadence: "monthly",
    expectedAmountCents: 9_000,
    variableAmount: false,
  }), null);
});

test("subscription payload requires expected amount unless variable", () => {
  assert.throws(() => createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    categoryCode: "saas",
    cadence: "monthly",
    variableAmount: false,
  }));
  assert.equal(createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    categoryCode: "saas",
    cadence: "monthly",
    variableAmount: true,
  }).expectedAmountCents, undefined);
});

test("subscription patch does not treat absent optional fields as updates", () => {
  assert.equal(updateRecurringExpensePayloadSchema.safeParse({}).success, false);
  assert.deepEqual(updateRecurringExpensePayloadSchema.parse({ nextBillingDate: "" }), {
    nextBillingDate: null,
  });
});

test("bill lifecycle keeps draft edits separate from status transitions", () => {
  assert.doesNotThrow(() => assertVendorBillEditable({ status: "draft" } as any));
  assertFinanceError(() => assertVendorBillEditable({ status: "received" } as any), "BILL_NOT_DRAFT");
  assert.equal(nextVendorBillStatus({ status: "draft" } as any, "receive"), "received");
  assert.equal(nextVendorBillStatus({ status: "received" } as any, "approve"), "approved");
  assert.equal(nextVendorBillStatus({ status: "approved" } as any, "dispute"), "disputed");
  assert.equal(nextVendorBillStatus({ status: "disputed" } as any, "void"), "voided");
  assertFinanceError(() => nextVendorBillStatus({ status: "draft" } as any, "approve"), "BILL_APPROVE_REQUIRES_RECEIVED");
});

test("subscription-backed bill must match subscription scope and category", async () => {
  const repo = {
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    getRecurringExpense: async () => ({
      id: 100,
      legalEntityId: 1,
      vendorId: 20,
      currency: "USD",
      categoryCode: "cloud",
      status: "active",
    }),
    createVendorBill: async () => {
      throw new Error("createVendorBill should not be called");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => createFinanceBill(repo, {
    legalEntityId: 1,
    vendorId: 20,
    recurringExpenseId: 100,
    billKind: "invoice",
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
    actorAdminId: 1,
  }), "SUBSCRIPTION_BILL_CATEGORY_MISMATCH");
});

test("draft credit memo cannot reference itself as the source bill", async () => {
  const now = baseTimestamp();
  const bill = {
    id: 10,
    legalEntityId: 1,
    vendorId: 20,
    recurringExpenseId: null,
    invoiceNumber: null,
    billKind: "credit_memo",
    issueDate: null,
    dueDate: null,
    servicePeriodStart: null,
    servicePeriodEnd: null,
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
    creditForVendorBillId: null,
    notes: null,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };
  const repo = {
    getVendorBill: async () => bill,
    updateVendorBill: async () => {
      throw new Error("updateVendorBill should not be called");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => updateDraftFinanceBill(repo, 10, {
    billKind: "credit_memo",
    creditForVendorBillId: 10,
  }), "CREDIT_SOURCE_SELF_REFERENCE");
});

test("payment status transitions reject terminal records", () => {
  assert.equal(nextExpensePaymentStatus({ status: "pending" } as any, "posted"), "posted");
  assertFinanceError(() => nextExpensePaymentStatus({ status: "reversed" } as any, "posted"), "PAYMENT_TERMINAL_STATE");
  assertFinanceError(() => nextExpensePaymentStatus({ status: "voided" } as any, "cleared"), "PAYMENT_TERMINAL_STATE");
});

test("payment application uses transaction and row locks before creating allocation", async () => {
  const calls: string[] = [];
  const now = baseTimestamp();
  const bill = {
    id: 10,
    legalEntityId: 1,
    vendorId: 20,
    recurringExpenseId: null,
    invoiceNumber: "INV-10",
    billKind: "invoice",
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    servicePeriodStart: null,
    servicePeriodEnd: null,
    amountCents: 5_000,
    currency: "USD",
    categoryCode: "saas",
    status: "approved",
    creditForVendorBillId: null,
    notes: null,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };
  const payment = {
    id: 30,
    legalEntityId: 1,
    vendorId: 20,
    amountCents: 5_000,
    currency: "USD",
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "ach",
    methodLabel: null,
    institutionName: null,
    maskedLast4: null,
    externalConfirmationRef: null,
    status: "cleared",
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };

  const repo = {
    transaction: async (work: any) => {
      calls.push("transaction");
      return work(repo);
    },
    lockVendorBill: async (id: number) => {
      calls.push(`lock-bill-${id}`);
    },
    lockExpensePayment: async (id: number) => {
      calls.push(`lock-payment-${id}`);
    },
    lockVendorBillApplication: async () => {
      calls.push("lock-application");
    },
    getVendorBill: async () => bill,
    getExpensePayment: async () => payment,
    listVendorBillApplications: async () => [],
    createVendorBillApplication: async (values: any) => {
      calls.push("create-application");
      return {
        id: 40,
        ...values,
        reversedAt: null,
        reversedBy: null,
        createdAt: now,
        updatedAt: now,
      };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  const application = await applyFinancePaymentToBill(repo, {
    targetVendorBillId: 10,
    expensePaymentId: 30,
    amountCents: 5_000,
    currency: "USD",
    actorAdminId: 1,
  });

  assert.deepEqual(calls, [
    "transaction",
    "lock-bill-10",
    "lock-payment-30",
    "create-application",
  ]);
  assert.equal(application.targetVendorBillId, 10);
  assert.equal(application.expensePaymentId, 30);
  assert.equal(application.amountCents, 5_000);
});
