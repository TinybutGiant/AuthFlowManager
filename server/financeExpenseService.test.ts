import assert from "node:assert/strict";
import test from "node:test";

import {
  FinanceExpenseServiceError,
  applyFinanceCreditToBill,
  applyFinancePaymentToBill,
  archiveFinanceVendor,
  assertVendorBillEditable,
  cancelFinanceSubscription,
  createFinanceReconciliationException,
  createFinanceBill,
  createFinanceSubscription,
  createFinanceVendor,
  createReconciliationExceptionPayloadSchema,
  createRecurringExpensePayloadSchema,
  createVendorBillPayloadSchema,
  deriveFinanceOverviewFromRows,
  listFinanceReconciliationExceptions,
  monthlyRecurringAmountCents,
  nextExpensePaymentStatus,
  nextVendorBillStatus,
  pauseFinanceSubscription,
  recordBillPaymentPayloadSchema,
  recordFinanceBillPayment,
  recordFinancePayment,
  reverseFinanceBillApplication,
  reverseFinancePayment,
  resumeFinanceSubscription,
  transitionFinanceBillStatus,
  transitionFinanceReconciliationException,
  updateDraftFinanceBill,
  updateFinancePayment,
  updateFinancePaymentStatus,
  updateFinanceSubscription,
  updateFinanceVendor,
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

test("vendor create stores actor and vendor update/archive mutate only vendor fields", async () => {
  const now = baseTimestamp();
  const updates: any[] = [];
  const auditEvents: any[] = [];
  const repo = {
    transaction: async (work: any) => work(repo),
    lockVendor: async () => undefined,
    createVendor: async (values: any) => ({
      id: 20,
      name: values.name,
      vendorType: values.vendorType,
      status: values.status,
      website: values.website ?? null,
      contactEmail: values.contactEmail ?? null,
      notes: values.notes ?? null,
      createdBy: values.createdBy,
      createdAt: now,
      updatedAt: now,
    }),
    getVendor: async () => ({
      id: 20,
      name: "Old SaaS",
      vendorType: "saas",
      status: "active",
      website: null,
      contactEmail: null,
      notes: null,
      createdBy: 7,
      createdAt: now,
      updatedAt: now,
    }),
    updateVendor: async (id: number, values: any) => {
      updates.push({ id, values });
      return {
        id,
        name: values.name ?? "Old SaaS",
        vendorType: values.vendorType ?? "saas",
        status: values.status ?? "active",
        website: values.website ?? null,
        contactEmail: values.contactEmail ?? null,
        notes: values.notes ?? null,
        createdBy: 7,
        createdAt: now,
        updatedAt: values.updatedAt ?? now,
      };
    },
    createFinanceAuditEvent: async (values: any) => {
      auditEvents.push(values);
      return { id: auditEvents.length, ...values, createdAt: now };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  const created = await createFinanceVendor(repo, {
    name: "New SaaS",
    vendorType: "saas",
    status: "active",
    actorAdminId: 42,
  });
  assert.equal(created.createdBy, 42);

  const updated = await updateFinanceVendor(repo, 20, { contactEmail: "ap@example.com", actorAdminId: 42 });
  assert.equal(updated.contactEmail, "ap@example.com");
  assert.equal(updates[0].id, 20);
  assert.ok(updates[0].values.updatedAt instanceof Date);

  const archived = await archiveFinanceVendor(repo, 20, 42);
  assert.equal(archived.status, "archived");
  assert.equal(updates[1].values.status, "archived");
  assert.deepEqual(auditEvents.map((event) => event.action), ["created", "updated", "archived"]);
  assert.deepEqual(auditEvents.map((event) => event.actorAdminUserId), [42, 42, 42]);
  assert.equal(auditEvents[0].entityType, "vendor");
  assert.equal(auditEvents[0].entityId, 20);
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[1].changesJson, "contactEmail"), false);
  assert.deepEqual(auditEvents[2].changesJson.status, { from: "active", to: "archived" });
});

test("subscription lifecycle supports create, pause, resume, and cancel without generating bills or payments", async () => {
  const now = baseTimestamp();
  const calls: string[] = [];
  const auditEvents: any[] = [];
  let currentStatus = "active";
  const repo = {
    transaction: async (work: any) => work(repo),
    lockRecurringExpense: async (id: number) => {
      calls.push(`lock-subscription-${id}`);
    },
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    createRecurringExpense: async (values: any) => {
      calls.push("create-subscription");
      return {
        id: 100,
        ...values,
        billingDay: values.billingDay ?? null,
        nextBillingDate: values.nextBillingDate ?? null,
        renewalDate: values.renewalDate ?? null,
        trialEndsOn: values.trialEndsOn ?? null,
        cancellationDate: values.cancellationDate ?? null,
        notes: values.notes ?? null,
        createdAt: now,
        updatedAt: now,
      };
    },
    getRecurringExpense: async () => ({
      id: 100,
      legalEntityId: 1,
      vendorId: 20,
      name: "Cloudflare domain renewal",
      categoryCode: "saas",
      cadence: "monthly",
      expectedAmountCents: 2_000,
      currency: "USD",
      variableAmount: false,
      billingDay: 1,
      nextBillingDate: "2026-09-01",
      renewalDate: null,
      autoRenew: true,
      trialEndsOn: null,
      cancellationDate: null,
      status: currentStatus,
      notes: null,
      createdBy: 42,
      createdAt: now,
      updatedAt: now,
    }),
    updateRecurringExpense: async (_id: number, values: any) => {
      calls.push(`update-${values.status ?? "terms"}`);
      currentStatus = values.status ?? currentStatus;
      return {
        id: 100,
        legalEntityId: 1,
        vendorId: 20,
        name: values.name ?? "Cloudflare domain renewal",
        categoryCode: values.categoryCode ?? "saas",
        cadence: values.cadence ?? "monthly",
        expectedAmountCents: values.expectedAmountCents ?? 2_000,
        currency: values.currency ?? "USD",
        variableAmount: values.variableAmount ?? false,
        billingDay: values.billingDay ?? 1,
        nextBillingDate: values.nextBillingDate ?? "2026-09-01",
        renewalDate: values.renewalDate ?? null,
        autoRenew: values.autoRenew ?? true,
        trialEndsOn: values.trialEndsOn ?? null,
        cancellationDate: values.cancellationDate ?? null,
        status: currentStatus,
        notes: values.notes ?? null,
        createdBy: 42,
        createdAt: now,
        updatedAt: values.updatedAt ?? now,
      };
    },
    createVendorBill: async () => {
      calls.push("create-bill");
      throw new Error("cancel must not create bills");
    },
    createExpensePayment: async () => {
      calls.push("create-payment");
      throw new Error("cancel must not create payments");
    },
    createFinanceAuditEvent: async (values: any) => {
      auditEvents.push(values);
      calls.push(`audit-${values.action}`);
      return { id: auditEvents.length, ...values, createdAt: now };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  const created = await createFinanceSubscription(repo, {
    legalEntityId: 1,
    vendorId: 20,
    name: "Cloudflare domain renewal",
    categoryCode: "saas",
    cadence: "monthly",
    expectedAmountCents: 2_000,
    currency: "USD",
    variableAmount: false,
    autoRenew: true,
    status: "active",
    actorAdminId: 42,
  });
  assert.equal(created.createdBy, 42);
  assert.equal(created.name, "Cloudflare domain renewal");

  assert.equal((await pauseFinanceSubscription(repo, 100, 42)).status, "paused");
  assert.equal((await resumeFinanceSubscription(repo, 100, 42)).status, "active");
  assert.equal((await updateFinanceSubscription(repo, 100, { expectedAmountCents: 2_500, actorAdminId: 42 })).expectedAmountCents, 2_500);
  assert.equal((await updateFinanceSubscription(repo, 100, { name: "Workers paid plan", actorAdminId: 42 })).name, "Workers paid plan");
  assert.equal((await cancelFinanceSubscription(repo, 100, { actorAdminId: 42 }, now)).status, "cancelled");
  assert.equal(calls.includes("create-bill"), false);
  assert.equal(calls.includes("create-payment"), false);
  assert.deepEqual(auditEvents.map((event) => event.action), ["created", "paused", "resumed", "updated", "updated", "cancelled"]);
  assert.equal(auditEvents.every((event) => event.entityType === "recurring_expense"), true);
  assert.deepEqual(auditEvents[1].changesJson.status, { from: "active", to: "paused" });
  assert.deepEqual(auditEvents[3].changesJson.expectedAmountCents, { from: 2000, to: 2500 });
  assert.deepEqual(auditEvents[4].changesJson.name, { from: "Cloudflare domain renewal", to: "Workers paid plan" });
});

test("bill creation validates references, duplicate invoice numbers, and actor attribution", async () => {
  const now = baseTimestamp();
  const auditEvents: any[] = [];
  const repo = {
    transaction: async (work: any) => work(repo),
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    findVendorBillInvoiceConflict: async () => undefined,
    createVendorBill: async (values: any) => ({
      id: 10,
      recurringExpenseId: values.recurringExpenseId ?? null,
      invoiceNumber: values.invoiceNumber ?? null,
      billKind: values.billKind,
      issueDate: values.issueDate ?? null,
      dueDate: values.dueDate ?? null,
      servicePeriodStart: values.servicePeriodStart ?? null,
      servicePeriodEnd: values.servicePeriodEnd ?? null,
      creditForVendorBillId: values.creditForVendorBillId ?? null,
      notes: values.notes ?? null,
      createdAt: now,
      updatedAt: now,
      ...values,
    }),
    createFinanceAuditEvent: async (values: any) => {
      auditEvents.push(values);
      return { id: auditEvents.length, ...values, createdAt: now };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  const bill = await createFinanceBill(repo, {
    legalEntityId: 1,
    vendorId: 20,
    invoiceNumber: "INV-100",
    billKind: "invoice",
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
    actorAdminId: 42,
  });

  assert.equal(bill.status, "draft");
  assert.equal(bill.createdBy, 42);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actorAdminUserId, 42);
  assert.equal(auditEvents[0].entityType, "vendor_bill");
  assert.equal(auditEvents[0].action, "created");
  assert.deepEqual(auditEvents[0].changesJson.amountCents, { from: null, to: 2000 });
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[0].changesJson, "notes"), false);
});

test("bill creation rejects duplicate invoice numbers in the same vendor scope", async () => {
  const repo = {
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    findVendorBillInvoiceConflict: async () => ({ id: 99 }),
    createVendorBill: async () => {
      throw new Error("duplicate invoice must not create bill");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => createFinanceBill(repo, {
    legalEntityId: 1,
    vendorId: 20,
    invoiceNumber: "INV-100",
    billKind: "invoice",
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
    actorAdminId: 42,
  }), "VENDOR_BILL_INVOICE_DUPLICATE");
});

test("subscription-backed bill rejects vendor linkage mismatch", async () => {
  const repo = {
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    getRecurringExpense: async () => ({
      id: 100,
      legalEntityId: 1,
      vendorId: 21,
      name: "Mismatched vendor plan",
      currency: "USD",
      categoryCode: "saas",
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
  }), "SUBSCRIPTION_BILL_SCOPE_MISMATCH");
});

test("approved bill cannot be silently rewritten as a different obligation", async () => {
  const now = baseTimestamp();
  const repo = {
    transaction: async (work: any) => work(repo),
    lockVendorBill: async () => undefined,
    getVendorBill: async () => ({
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
      amountCents: 2_000,
      currency: "USD",
      categoryCode: "saas",
      status: "approved",
      creditForVendorBillId: null,
      notes: null,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    }),
    updateVendorBill: async () => {
      throw new Error("approved bill must not be updated");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => updateDraftFinanceBill(repo, 10, {
    invoiceNumber: "INV-REWRITE",
    amountCents: 3_000,
    categoryCode: "cloud",
    actorAdminId: 42,
  }), "BILL_NOT_DRAFT");
});

test("vendor bill schema does not store paid or partially paid lifecycle states", () => {
  const baseBill = {
    legalEntityId: 1,
    vendorId: 20,
    billKind: "invoice",
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
  };

  assert.equal(createVendorBillPayloadSchema.safeParse({ ...baseBill, status: "paid" }).success, false);
  assert.equal(createVendorBillPayloadSchema.safeParse({ ...baseBill, status: "partially_paid" }).success, false);
  assert.equal(createVendorBillPayloadSchema.safeParse({ ...baseBill, status: "draft" }).success, true);
});

test("vendor bill schema rejects invalid date ranges", () => {
  const baseBill = {
    legalEntityId: 1,
    vendorId: 20,
    billKind: "invoice",
    amountCents: 2_000,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
  };

  assert.equal(createVendorBillPayloadSchema.safeParse({
    ...baseBill,
    issueDate: "2026-08-31",
    dueDate: "2026-08-01",
  }).success, false);
  assert.equal(createVendorBillPayloadSchema.safeParse({
    ...baseBill,
    servicePeriodStart: "2026-08-31",
    servicePeriodEnd: "2026-08-01",
  }).success, false);
});

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
        name: "Cloud A monthly infrastructure",
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
        name: "SaaS B annual license",
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
        name: "Utility variable plan",
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
        name: "CN utility monthly service",
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
        name: "Paused SaaS plan",
        status: "paused",
        cadence: "monthly",
        expectedAmountCents: 900,
        variableAmount: false,
        currency: "USD",
        categoryCode: "saas",
        autoRenew: false,
      },
    ],
    payments: [
      {
        id: 200,
        amountCents: 1_046,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2026-08-29",
        status: "cleared",
      },
      {
        id: 201,
        amountCents: 5_000,
        currency: "CNY",
        direction: "outflow",
        paymentDate: "2026-01-15",
        status: "cleared",
      },
      {
        id: 202,
        amountCents: 2_000,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2026-08-28",
        status: "pending",
      },
      {
        id: 203,
        amountCents: 3_000,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2026-08-28",
        status: "failed",
      },
      {
        id: 204,
        amountCents: 4_000,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2026-08-28",
        status: "voided",
      },
      {
        id: 205,
        amountCents: 5_000,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2026-08-28",
        status: "reversed",
      },
      {
        id: 206,
        amountCents: 6_000,
        currency: "USD",
        direction: "refund",
        paymentDate: "2026-08-28",
        status: "cleared",
      },
      {
        id: 207,
        amountCents: 7_000,
        currency: "USD",
        direction: "outflow",
        paymentDate: "2025-12-31",
        status: "cleared",
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
  assert.deepEqual(overview.metrics.paidThisMonthByCurrency, [
    { currency: "USD", amountCents: 1_046 },
  ]);
  assert.deepEqual(overview.metrics.paidYtdByCurrency, [
    { currency: "CNY", amountCents: 5_000 },
    { currency: "USD", amountCents: 1_046 },
  ]);
  assert.equal(overview.metrics.openBillsCount, 3);
  assert.equal(overview.metrics.overdueBillsCount, 0);
  assert.deepEqual(overview.metrics.openBillTotalsByCurrency, [
    { currency: "CNY", amountCents: 4_000 },
    { currency: "USD", amountCents: 4_500 },
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

test("subscription payload requires name and expected amount unless variable", () => {
  assert.throws(() => createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    categoryCode: "saas",
    cadence: "monthly",
    expectedAmountCents: 1_000,
    variableAmount: false,
  }));
  assert.throws(() => createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    name: "   ",
    categoryCode: "saas",
    cadence: "monthly",
    expectedAmountCents: 1_000,
    variableAmount: false,
  }));
  assert.throws(() => createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    name: "Cloudflare domain renewal",
    categoryCode: "saas",
    cadence: "monthly",
    variableAmount: false,
  }));
  assert.deepEqual(createRecurringExpensePayloadSchema.parse({
    legalEntityId: 1,
    vendorId: 1,
    name: "  Cloudflare domain renewal  ",
    categoryCode: "saas",
    cadence: "monthly",
    variableAmount: true,
    notes: "  Annual domain registration renewal  ",
  }), {
    legalEntityId: 1,
    vendorId: 1,
    name: "Cloudflare domain renewal",
    categoryCode: "saas",
    cadence: "monthly",
    variableAmount: true,
    currency: "USD",
    autoRenew: false,
    status: "draft",
    notes: "Annual domain registration renewal",
  });
});

test("subscription patch does not treat absent optional fields as updates", () => {
  assert.equal(updateRecurringExpensePayloadSchema.safeParse({}).success, false);
  assert.equal(updateRecurringExpensePayloadSchema.safeParse({ name: null }).success, false);
  assert.equal(updateRecurringExpensePayloadSchema.safeParse({ name: "   " }).success, false);
  assert.deepEqual(updateRecurringExpensePayloadSchema.parse({ nextBillingDate: "" }), {
    nextBillingDate: null,
  });
  assert.deepEqual(updateRecurringExpensePayloadSchema.parse({
    name: "  ahhh-yaotu.com domain renewal  ",
    categoryCode: "domain",
    notes: "  Annual domain registration renewal.  ",
  }), {
    name: "ahhh-yaotu.com domain renewal",
    categoryCode: "domain",
    notes: "Annual domain registration renewal.",
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

test("bill transition locks current row and writes a sanitized audit event in the same transaction", async () => {
  const now = baseTimestamp();
  const calls: string[] = [];
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
    status: "received",
    creditForVendorBillId: null,
    notes: "do not audit notes",
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };
  const auditEvents: any[] = [];
  const repo = {
    transaction: async (work: any) => {
      calls.push("transaction");
      return work(repo);
    },
    lockVendorBill: async (id: number) => {
      calls.push(`lock-bill-${id}`);
    },
    getVendorBill: async (id: number) => {
      calls.push(`get-bill-${id}`);
      return bill;
    },
    updateVendorBill: async (id: number, values: any) => {
      calls.push(`update-bill-${id}-${values.status}`);
      return { ...bill, ...values, id };
    },
    createFinanceAuditEvent: async (values: any) => {
      calls.push(`audit-${values.action}`);
      auditEvents.push(values);
      return { id: 1, ...values, createdAt: now };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  const updated = await transitionFinanceBillStatus(repo, 10, "approve", {
    actorAdminId: 42,
    notes: "new notes are not audited",
  });

  assert.equal(updated.status, "approved");
  assert.deepEqual(calls, [
    "transaction",
    "lock-bill-10",
    "get-bill-10",
    "update-bill-10-approved",
    "audit-approved",
  ]);
  assert.equal(auditEvents[0].actorAdminUserId, 42);
  assert.deepEqual(auditEvents[0].changesJson.status, { from: "received", to: "approved" });
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[0].changesJson, "notes"), false);
});

test("bill transition rejects stale source state after acquiring the row lock", async () => {
  const now = baseTimestamp();
  const calls: string[] = [];
  const repo = {
    transaction: async (work: any) => {
      calls.push("transaction");
      return work(repo);
    },
    lockVendorBill: async (id: number) => {
      calls.push(`lock-bill-${id}`);
    },
    getVendorBill: async (id: number) => {
      calls.push(`get-bill-${id}`);
      return {
        id,
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
    },
    updateVendorBill: async () => {
      calls.push("update");
      throw new Error("stale transition must not update");
    },
    createFinanceAuditEvent: async () => {
      calls.push("audit");
      throw new Error("stale transition must not audit");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => transitionFinanceBillStatus(repo, 10, "approve", {
    actorAdminId: 42,
  }), "BILL_APPROVE_REQUIRES_RECEIVED");
  assert.deepEqual(calls, ["transaction", "lock-bill-10", "get-bill-10"]);
});

test("subscription-backed bill must match subscription scope and category", async () => {
  const repo = {
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    getVendor: async () => ({ id: 20, status: "active" }),
    getRecurringExpense: async () => ({
      id: 100,
      legalEntityId: 1,
      vendorId: 20,
      name: "Cloud infrastructure plan",
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
    transaction: async (work: any) => work(repo),
    lockVendorBill: async () => undefined,
    getVendorBill: async () => bill,
    updateVendorBill: async () => {
      throw new Error("updateVendorBill should not be called");
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  await assertFinanceRejects(() => updateDraftFinanceBill(repo, 10, {
    billKind: "credit_memo",
    creditForVendorBillId: 10,
    actorAdminId: 42,
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
    createFinanceAuditEvent: async (values: any) => {
      calls.push(`audit-${values.action}`);
      return { id: 1, ...values, createdAt: now };
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
    "audit-applied",
  ]);
  assert.equal(application.targetVendorBillId, 10);
  assert.equal(application.expensePaymentId, 30);
  assert.equal(application.amountCents, 5_000);
});

type ApFixtureState = {
  legalEntities: any[];
  vendors: any[];
  bills: any[];
  payments: any[];
  applications: any[];
  reconciliationExceptions: any[];
  auditEvents: any[];
  calls: string[];
  failNextApplication: boolean;
  failNextAudit: boolean;
  failAuditAction?: string;
  nextPaymentId: number;
  nextApplicationId: number;
  nextExceptionId: number;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function cloneApState(state: ApFixtureState) {
  return {
    legalEntities: structuredClone(state.legalEntities),
    vendors: structuredClone(state.vendors),
    bills: structuredClone(state.bills),
    payments: structuredClone(state.payments),
    applications: structuredClone(state.applications),
    reconciliationExceptions: structuredClone(state.reconciliationExceptions),
    auditEvents: structuredClone(state.auditEvents),
    nextPaymentId: state.nextPaymentId,
    nextApplicationId: state.nextApplicationId,
    nextExceptionId: state.nextExceptionId,
  };
}

function restoreApState(state: ApFixtureState, snapshot: ReturnType<typeof cloneApState>) {
  state.legalEntities = snapshot.legalEntities;
  state.vendors = snapshot.vendors;
  state.bills = snapshot.bills;
  state.payments = snapshot.payments;
  state.applications = snapshot.applications;
  state.reconciliationExceptions = snapshot.reconciliationExceptions;
  state.auditEvents = snapshot.auditEvents;
  state.nextPaymentId = snapshot.nextPaymentId;
  state.nextApplicationId = snapshot.nextApplicationId;
  state.nextExceptionId = snapshot.nextExceptionId;
}

function createApFixture() {
  const now = baseTimestamp();
  const state: ApFixtureState = {
    legalEntities: [{ id: 1, status: "active" }],
    vendors: [{ id: 20, name: "Vendor A", status: "active" }, { id: 21, name: "Vendor B", status: "active" }],
    bills: [],
    payments: [],
    applications: [],
    reconciliationExceptions: [],
    auditEvents: [],
    calls: [],
    failNextApplication: false,
    failNextAudit: false,
    failAuditAction: undefined,
    nextPaymentId: 100,
    nextApplicationId: 200,
    nextExceptionId: 300,
  };

  function seedBill(values: Partial<any>) {
    const bill = {
      id: values.id ?? state.bills.length + 1,
      legalEntityId: values.legalEntityId ?? 1,
      vendorId: values.vendorId ?? 20,
      recurringExpenseId: null,
      invoiceNumber: values.invoiceNumber ?? null,
      billKind: values.billKind ?? "invoice",
      issueDate: null,
      dueDate: values.dueDate ?? "2026-08-31",
      servicePeriodStart: null,
      servicePeriodEnd: null,
      amountCents: values.amountCents ?? 10_000,
      currency: values.currency ?? "USD",
      categoryCode: values.categoryCode ?? "saas",
      status: values.status ?? "approved",
      creditForVendorBillId: values.creditForVendorBillId ?? null,
      notes: null,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.bills.push(bill);
    return bill;
  }

  function seedPayment(values: Partial<any>) {
    const payment = {
      id: values.id ?? state.nextPaymentId++,
      legalEntityId: values.legalEntityId ?? 1,
      vendorId: values.vendorId === undefined ? 20 : values.vendorId,
      amountCents: values.amountCents ?? 10_000,
      currency: values.currency ?? "USD",
      direction: values.direction ?? "outflow",
      paymentDate: values.paymentDate ?? "2026-08-29",
      methodType: values.methodType ?? "ach",
      methodLabel: values.methodLabel ?? null,
      institutionName: values.institutionName ?? null,
      maskedLast4: values.maskedLast4 ?? null,
      externalConfirmationRef: values.externalConfirmationRef ?? null,
      status: values.status ?? "cleared",
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.payments.push(payment);
    return payment;
  }

  const repo = {
    transaction: async (work: any) => {
      state.calls.push("transaction");
      const snapshot = cloneApState(state);
      try {
        return await work(repo);
      } catch (error) {
        restoreApState(state, snapshot);
        throw error;
      }
    },
    lockVendorBill: async (id: number) => {
      state.calls.push(`lock-bill-${id}`);
    },
    lockExpensePayment: async (id: number) => {
      state.calls.push(`lock-payment-${id}`);
    },
    lockVendorBillApplication: async (id: number) => {
      state.calls.push(`lock-application-${id}`);
    },
    lockReconciliationException: async (id: number) => {
      state.calls.push(`lock-exception-${id}`);
    },
    getLegalEntity: async (id: number) => state.legalEntities.find((row) => row.id === id),
    getVendor: async (id: number) => state.vendors.find((row) => row.id === id),
    getVendorBill: async (id: number) => state.bills.find((row) => row.id === id),
    updateVendorBill: async (id: number, values: any) => {
      const index = state.bills.findIndex((row) => row.id === id);
      if (index === -1) return undefined;
      state.bills[index] = { ...state.bills[index], ...withoutUndefined(values) };
      return state.bills[index];
    },
    getExpensePayment: async (id: number) => state.payments.find((row) => row.id === id),
    createExpensePayment: async (values: any) => {
      const payment = seedPayment({ ...values, id: state.nextPaymentId++ });
      return payment;
    },
    updateExpensePayment: async (id: number, values: any) => {
      const index = state.payments.findIndex((row) => row.id === id);
      if (index === -1) return undefined;
      state.payments[index] = { ...state.payments[index], ...withoutUndefined(values) };
      return state.payments[index];
    },
    getVendorBillApplication: async (id: number) => state.applications.find((row) => row.id === id),
    listVendorBillApplications: async (filters: any) => state.applications.filter((application) => (
      (filters.targetVendorBillId === undefined || application.targetVendorBillId === filters.targetVendorBillId) &&
      (filters.expensePaymentId === undefined || application.expensePaymentId === filters.expensePaymentId) &&
      (filters.creditVendorBillId === undefined || application.creditVendorBillId === filters.creditVendorBillId) &&
      (filters.status === undefined || application.status === filters.status)
    )),
    createVendorBillApplication: async (values: any) => {
      if (state.failNextApplication) {
        state.failNextApplication = false;
        throw new Error("application insert failed");
      }
      const application = {
        id: state.nextApplicationId++,
        ...values,
        reversedAt: null,
        reversedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      state.applications.push(application);
      return application;
    },
    updateVendorBillApplication: async (id: number, values: any) => {
      const index = state.applications.findIndex((row) => row.id === id);
      if (index === -1) return undefined;
      state.applications[index] = { ...state.applications[index], ...withoutUndefined(values) };
      return state.applications[index];
    },
    getReconciliationException: async (id: number) => state.reconciliationExceptions.find((row) => row.id === id),
    listReconciliationExceptions: async () => state.reconciliationExceptions,
    createReconciliationException: async (values: any) => {
      const exception = {
        id: state.nextExceptionId++,
        ...values,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
        createdAt: now,
        updatedAt: now,
      };
      state.reconciliationExceptions.push(exception);
      return exception;
    },
    updateReconciliationException: async (id: number, values: any) => {
      const index = state.reconciliationExceptions.findIndex((row) => row.id === id);
      if (index === -1) return undefined;
      state.reconciliationExceptions[index] = { ...state.reconciliationExceptions[index], ...withoutUndefined(values) };
      return state.reconciliationExceptions[index];
    },
    entityExists: async (entityType: string, entityId: number) => {
      const tableByType: Record<string, any[]> = {
        vendors: state.vendors,
        vendor_bills: state.bills,
        expense_payments: state.payments,
        vendor_bill_applications: state.applications,
        reconciliation_exceptions: state.reconciliationExceptions,
      };
      return Boolean(tableByType[entityType]?.some((row) => row.id === entityId));
    },
    createFinanceAuditEvent: async (values: any) => {
      if (state.failNextAudit || values.action === state.failAuditAction) {
        state.failNextAudit = false;
        state.failAuditAction = undefined;
        throw new Error("audit insert failed");
      }
      state.auditEvents.push(values);
      return { id: state.auditEvents.length, ...values, createdAt: now };
    },
  } as Partial<FinanceExpenseRepository> as FinanceExpenseRepository;

  return { repo, state, seedBill, seedPayment };
}

function activeTotal(rows: any[]) {
  return rows.filter((row) => row.status === "active").reduce((total, row) => total + row.amountCents, 0);
}

function billRemaining(state: ApFixtureState, billId: number) {
  const bill = state.bills.find((row) => row.id === billId);
  assert.ok(bill);
  return bill.amountCents - activeTotal(state.applications.filter((row) => row.targetVendorBillId === billId));
}

function paymentRemaining(state: ApFixtureState, paymentId: number) {
  const payment = state.payments.find((row) => row.id === paymentId);
  assert.ok(payment);
  return payment.amountCents - activeTotal(state.applications.filter((row) => row.expensePaymentId === paymentId));
}

function creditRemaining(state: ApFixtureState, creditBillId: number) {
  const credit = state.bills.find((row) => row.id === creditBillId);
  assert.ok(credit);
  return credit.amountCents - activeTotal(state.applications.filter((row) => row.creditVendorBillId === creditBillId));
}

test("AP payment applications support full, partial, split, multi-payment, and unapplied cleared payments", async () => {
  const { repo, state, seedBill, seedPayment } = createApFixture();

  const fullBill = seedBill({ id: 1, amountCents: 10_000 });
  const fullPayment = seedPayment({ id: 101, amountCents: 10_000, status: "cleared" });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: fullBill.id,
    expensePaymentId: fullPayment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(billRemaining(state, fullBill.id), 0);
  assert.equal(paymentRemaining(state, fullPayment.id), 0);

  const partialBill = seedBill({ id: 2, amountCents: 10_000 });
  const partialPayment = seedPayment({ id: 102, amountCents: 10_000, status: "cleared" });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: partialBill.id,
    expensePaymentId: partialPayment.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(billRemaining(state, partialBill.id), 4_000);
  assert.equal(paymentRemaining(state, partialPayment.id), 4_000);

  const splitPayment = seedPayment({ id: 103, amountCents: 10_000, status: "cleared" });
  const splitBillA = seedBill({ id: 3, amountCents: 6_000 });
  const splitBillB = seedBill({ id: 4, amountCents: 4_000 });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: splitBillA.id,
    expensePaymentId: splitPayment.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 42,
  });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: splitBillB.id,
    expensePaymentId: splitPayment.id,
    amountCents: 4_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(paymentRemaining(state, splitPayment.id), 0);

  const multiBill = seedBill({ id: 5, amountCents: 10_000 });
  const smallPayment = seedPayment({ id: 104, amountCents: 3_000, status: "posted" });
  const largePayment = seedPayment({ id: 105, amountCents: 7_000, status: "cleared" });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: multiBill.id,
    expensePaymentId: smallPayment.id,
    amountCents: 3_000,
    currency: "USD",
    actorAdminId: 42,
  });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: multiBill.id,
    expensePaymentId: largePayment.id,
    amountCents: 7_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(billRemaining(state, multiBill.id), 0);

  const cleared = await recordFinancePayment(repo, {
    legalEntityId: 1,
    vendorId: 20,
    amountCents: 10_000,
    currency: "USD",
    direction: "outflow",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 42,
  });
  assert.equal(paymentRemaining(state, cleared.id), 10_000);
  assert.equal(state.auditEvents.filter((event) => event.entityType === "vendor_bill_application").length, 6);
});

test("AP application rejects stale over-application and incompatible payment inputs", async () => {
  const { repo, seedBill, seedPayment } = createApFixture();
  const bill = seedBill({ id: 10, amountCents: 10_000 });
  const payment = seedPayment({ id: 110, amountCents: 10_000 });
  await applyFinancePaymentToBill(repo, {
    targetVendorBillId: bill.id,
    expensePaymentId: payment.id,
    amountCents: 9_000,
    currency: "USD",
    actorAdminId: 42,
  });
  await assertFinanceRejects(() => applyFinancePaymentToBill(repo, {
    targetVendorBillId: bill.id,
    expensePaymentId: seedPayment({ id: 111, amountCents: 2_000 }).id,
    amountCents: 2_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_BILL_OVER_APPLIED");

  const secondBill = seedBill({ id: 11, amountCents: 10_000 });
  await assertFinanceRejects(() => applyFinancePaymentToBill(repo, {
    targetVendorBillId: secondBill.id,
    expensePaymentId: payment.id,
    amountCents: 2_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_PAYMENT_OVER_APPLIED");
  await assertFinanceRejects(() => applyFinancePaymentToBill(repo, {
    targetVendorBillId: secondBill.id,
    expensePaymentId: seedPayment({ id: 112, vendorId: 21, amountCents: 2_000 }).id,
    amountCents: 2_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_PAYMENT_VENDOR_MISMATCH");
  await assertFinanceRejects(() => applyFinancePaymentToBill(repo, {
    targetVendorBillId: secondBill.id,
    expensePaymentId: seedPayment({ id: 113, amountCents: 2_000, currency: "EUR" }).id,
    amountCents: 2_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_PAYMENT_APPLICATION_CURRENCY_MISMATCH");
  await assertFinanceRejects(() => applyFinancePaymentToBill(repo, {
    targetVendorBillId: secondBill.id,
    expensePaymentId: seedPayment({ id: 114, amountCents: 2_000, status: "pending" }).id,
    amountCents: 2_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_PAYMENT_STATUS_INVALID");
});

test("AP bill-first record payment creates payment and application atomically", async () => {
  const { repo, state, seedBill } = createApFixture();
  const fullBill = seedBill({
    id: 60,
    invoiceNumber: "IN-77096614",
    amountCents: 10_000,
    status: "approved",
  });

  const full = await recordFinanceBillPayment(repo, fullBill.id, {
    amountCents: 10_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
    actorAdminId: 42,
  });

  assert.equal(full.payment.legalEntityId, fullBill.legalEntityId);
  assert.equal(full.payment.vendorId, fullBill.vendorId);
  assert.equal(full.payment.currency, fullBill.currency);
  assert.equal(full.payment.externalConfirmationRef, null);
  assert.equal(full.application.targetVendorBillId, fullBill.id);
  assert.equal(full.application.expensePaymentId, full.payment.id);
  assert.equal(full.application.amountCents, 10_000);
  assert.equal(billRemaining(state, fullBill.id), 0);
  assert.equal(paymentRemaining(state, full.payment.id), 0);

  const partialBill = seedBill({ id: 61, amountCents: 10_000, status: "approved" });
  const partial = await recordFinanceBillPayment(repo, partialBill.id, {
    amountCents: 4_000,
    direction: "outflow",
    paymentDate: "2026-08-30",
    methodType: "ach",
    externalConfirmationRef: "CARD-SETTLEMENT-1",
    status: "posted",
    actorAdminId: 42,
  });

  assert.equal(billRemaining(state, partialBill.id), 6_000);
  assert.equal(paymentRemaining(state, partial.payment.id), 0);
  assert.equal(partial.payment.externalConfirmationRef, "CARD-SETTLEMENT-1");
  assert.deepEqual(
    state.auditEvents
      .filter((event) => ["expense_payment", "vendor_bill_application"].includes(event.entityType))
      .map((event) => `${event.entityType}:${event.action}`),
    [
      "expense_payment:created",
      "vendor_bill_application:applied",
      "expense_payment:created",
      "vendor_bill_application:applied",
    ],
  );
});

test("AP bill-first record payment rejects over-application and rolls back partial work", async () => {
  const { repo, state, seedBill } = createApFixture();
  const bill = seedBill({ id: 62, amountCents: 5_000, status: "approved" });

  await assertFinanceRejects(() => recordFinanceBillPayment(repo, bill.id, {
    amountCents: 5_001,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
    actorAdminId: 42,
  }), "AP_BILL_OVER_APPLIED");
  assert.equal(state.payments.length, 0);
  assert.equal(state.applications.length, 0);
  assert.equal(state.auditEvents.length, 0);

  state.failNextApplication = true;
  await assert.rejects(() => recordFinanceBillPayment(repo, bill.id, {
    amountCents: 4_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
    actorAdminId: 42,
  }), /application insert failed/);
  assert.equal(state.payments.length, 0);
  assert.equal(state.applications.length, 0);
  assert.equal(state.auditEvents.length, 0);

  state.failAuditAction = "applied";
  await assert.rejects(() => recordFinanceBillPayment(repo, bill.id, {
    amountCents: 4_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
    actorAdminId: 42,
  }), /audit insert failed/);
  assert.equal(state.payments.length, 0);
  assert.equal(state.applications.length, 0);
  assert.equal(state.auditEvents.length, 0);
});

test("AP bill-first record payment requires payment date and explicit status", () => {
  assert.equal(recordBillPaymentPayloadSchema.safeParse({
    amountCents: 1_000,
    direction: "outflow",
    methodType: "card",
    status: "cleared",
  }).success, false);

  assert.equal(recordBillPaymentPayloadSchema.safeParse({
    amountCents: 1_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
  }).success, false);

  assert.equal(recordBillPaymentPayloadSchema.safeParse({
    amountCents: 1_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
  }).success, true);

  assert.equal(recordBillPaymentPayloadSchema.safeParse({
    legalEntityId: 1,
    vendorId: 20,
    currency: "USD",
    amountCents: 1_000,
    direction: "outflow",
    paymentDate: "2026-08-29",
    methodType: "card",
    status: "cleared",
  }).success, false);
});

test("AP credit applications validate credit source and remaining credit", async () => {
  const { repo, state, seedBill } = createApFixture();
  const target = seedBill({ id: 20, amountCents: 10_000 });
  const credit = seedBill({ id: 21, billKind: "credit_memo", amountCents: 10_000, status: "approved" });
  await applyFinanceCreditToBill(repo, {
    targetVendorBillId: target.id,
    creditVendorBillId: credit.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(billRemaining(state, target.id), 4_000);
  assert.equal(creditRemaining(state, credit.id), 4_000);

  const secondTarget = seedBill({ id: 22, amountCents: 5_000 });
  await assertFinanceRejects(() => applyFinanceCreditToBill(repo, {
    targetVendorBillId: secondTarget.id,
    creditVendorBillId: credit.id,
    amountCents: 5_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_CREDIT_OVER_APPLIED");
  await assertFinanceRejects(() => applyFinanceCreditToBill(repo, {
    targetVendorBillId: secondTarget.id,
    creditVendorBillId: seedBill({ id: 23, billKind: "invoice", amountCents: 5_000 }).id,
    amountCents: 1_000,
    currency: "USD",
    actorAdminId: 42,
  }), "AP_CREDIT_SOURCE_KIND_INVALID");
});

test("AP reversal preserves application history and gates payment and bill reversal", async () => {
  const { repo, state, seedBill, seedPayment } = createApFixture();
  const bill = seedBill({ id: 30, amountCents: 10_000, status: "approved" });
  const payment = seedPayment({ id: 130, amountCents: 10_000, status: "cleared" });
  const application = await applyFinancePaymentToBill(repo, {
    targetVendorBillId: bill.id,
    expensePaymentId: payment.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 42,
  });

  await assertFinanceRejects(() => reverseFinancePayment(repo, payment.id, 42), "PAYMENT_REVERSE_HAS_ACTIVE_APPLICATIONS");
  await assertFinanceRejects(() => transitionFinanceBillStatus(repo, bill.id, "void", { actorAdminId: 42 }), "BILL_VOID_HAS_ACTIVE_APPLICATIONS");

  const reversed = await reverseFinanceBillApplication(repo, application.id, 42);
  assert.equal(reversed.status, "reversed");
  assert.equal(billRemaining(state, bill.id), 10_000);
  assert.equal(paymentRemaining(state, payment.id), 10_000);

  await reverseFinanceBillApplication(repo, application.id, 42);
  assert.equal(state.applications.length, 1);
  assert.equal(state.auditEvents.filter((event) => event.action === "reversed" && event.entityType === "vendor_bill_application").length, 1);

  const reversedPayment = await reverseFinancePayment(repo, payment.id, 42);
  assert.equal(reversedPayment.status, "reversed");
});

test("AP payment editing and lifecycle preserve posted history", async () => {
  const { repo, state, seedPayment } = createApFixture();
  const pending = seedPayment({ id: 140, amountCents: 10_000, status: "pending" });
  const edited = await updateFinancePayment(repo, pending.id, {
    amountCents: 12_000,
    currency: "USD",
    actorAdminId: 42,
  });
  assert.equal(edited.amountCents, 12_000);

  const posted = await updateFinancePaymentStatus(repo, pending.id, { status: "posted", actorAdminId: 42 });
  assert.equal(posted.status, "posted");
  await assertFinanceRejects(() => updateFinancePayment(repo, pending.id, {
    amountCents: 13_000,
    actorAdminId: 42,
  }), "PAYMENT_NOT_PENDING");
  await assertFinanceRejects(() => updateFinancePaymentStatus(repo, pending.id, {
    status: "voided",
    actorAdminId: 42,
  }), "PAYMENT_STATUS_TRANSITION_INVALID");
  const cleared = await updateFinancePaymentStatus(repo, pending.id, { status: "cleared", actorAdminId: 42 });
  assert.equal(cleared.status, "cleared");
  assert.deepEqual(
    state.auditEvents
      .filter((event) => event.entityType === "expense_payment")
      .map((event) => event.action),
    ["updated", "posted", "cleared"],
  );
});

test("Finance mutation rolls back when audit insert fails", async () => {
  const { repo, state } = createApFixture();
  state.failNextAudit = true;

  await assert.rejects(() => recordFinancePayment(repo, {
    legalEntityId: 1,
    vendorId: 20,
    amountCents: 10_000,
    currency: "USD",
    direction: "outflow",
    methodType: "ach",
    status: "posted",
    actorAdminId: 42,
  }));

  assert.equal(state.payments.length, 0);
  assert.equal(state.auditEvents.length, 0);
});

test("AP reconciliation exception lifecycle is AP-only and audited", async () => {
  const { repo, state, seedBill, seedPayment } = createApFixture();
  const bill = seedBill({ id: 50, amountCents: 10_000 });
  const payment = seedPayment({ id: 150, amountCents: 9_900 });

  const exception = await createFinanceReconciliationException(repo, {
    expectedEntityType: "vendor_bills",
    expectedEntityId: bill.id,
    actualEntityType: "expense_payments",
    actualEntityId: payment.id,
    expectedAmountCents: 10_000,
    actualAmountCents: 9_900,
    currency: "USD",
    reasonCode: "amount_mismatch",
    summary: "Invoice and payment differ",
    actorAdminId: 42,
  });
  assert.equal(exception.domain, "ap");
  assert.equal(exception.differenceAmountCents, 100);

  assert.equal((await transitionFinanceReconciliationException(repo, exception.id, "investigate", { actorAdminId: 42 })).status, "investigating");
  assert.equal((await transitionFinanceReconciliationException(repo, exception.id, "resolve", { actorAdminId: 42 })).status, "resolved");
  assert.equal((await transitionFinanceReconciliationException(repo, exception.id, "reopen", { actorAdminId: 42 })).status, "open");
  assert.equal((await transitionFinanceReconciliationException(repo, exception.id, "waive", { actorAdminId: 42 })).status, "waived");
  assert.deepEqual(
    state.auditEvents
      .filter((event) => event.entityType === "reconciliation_exception")
      .map((event) => event.action),
    ["created", "investigating", "resolved", "reopened", "waived"],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(state.auditEvents[0].changesJson, "summary"), false);

  await assertFinanceRejects(() => createFinanceReconciliationException(repo, {
    expectedEntityType: "vendor_bills",
    expectedEntityId: 999,
    reasonCode: "missing_invoice",
    summary: "Missing invoice",
    actorAdminId: 42,
  }), "RECONCILIATION_ENTITY_NOT_FOUND");
});

test("AP reconciliation API contract rejects cross-domain exception targets", async () => {
  const { repo, state } = createApFixture();
  state.reconciliationExceptions.push(
    {
      id: 301,
      domain: "ap",
      expectedEntityType: "vendor_bills",
      expectedEntityId: 1,
      actualEntityType: null,
      actualEntityId: null,
      currency: "USD",
      expectedAmountCents: 10_000,
      actualAmountCents: null,
      differenceAmountCents: null,
      reasonCode: "missing_invoice",
      summary: "AP exception",
      status: "open",
      ownerAdminId: null,
      createdBy: 42,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: baseTimestamp(),
      updatedAt: baseTimestamp(),
    },
    {
      id: 302,
      domain: "tax",
      expectedEntityType: "tax_liabilities",
      expectedEntityId: 7,
      actualEntityType: "tax_agency_payments",
      actualEntityId: 8,
      currency: "USD",
      expectedAmountCents: 10_626,
      actualAmountCents: 10_600,
      differenceAmountCents: 26,
      reasonCode: "amount_mismatch",
      summary: "Tax exception",
      status: "open",
      ownerAdminId: null,
      createdBy: 42,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: baseTimestamp(),
      updatedAt: baseTimestamp(),
    },
  );

  assert.equal(createReconciliationExceptionPayloadSchema.safeParse({
    domain: "tax",
    expectedEntityType: "vendor_bills",
    expectedEntityId: 1,
    reasonCode: "missing_invoice",
    summary: "Caller-supplied domain is not accepted",
  }).success, false);
  assert.equal(createReconciliationExceptionPayloadSchema.safeParse({
    expectedEntityType: "payroll_runs",
    expectedEntityId: 1,
    reasonCode: "amount_mismatch",
    summary: "Payroll exception",
  }).success, false);
  assert.equal(createReconciliationExceptionPayloadSchema.safeParse({
    expectedEntityType: "tax_liabilities",
    expectedEntityId: 1,
    reasonCode: "amount_mismatch",
    summary: "Tax exception",
  }).success, false);

  const listed = await listFinanceReconciliationExceptions(repo, { pageSize: 100 });
  assert.deepEqual(listed.map((exception) => exception.id), [301]);
  assert.equal(listed.every((exception) => exception.domain === "ap"), true);
});
