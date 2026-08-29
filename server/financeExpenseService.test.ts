import assert from "node:assert/strict";
import test from "node:test";

import {
  FinanceExpenseServiceError,
  applyFinancePaymentToBill,
  archiveFinanceVendor,
  assertVendorBillEditable,
  cancelFinanceSubscription,
  createFinanceBill,
  createFinanceSubscription,
  createFinanceVendor,
  createRecurringExpensePayloadSchema,
  createVendorBillPayloadSchema,
  deriveFinanceOverviewFromRows,
  monthlyRecurringAmountCents,
  nextExpensePaymentStatus,
  nextVendorBillStatus,
  pauseFinanceSubscription,
  resumeFinanceSubscription,
  transitionFinanceBillStatus,
  updateDraftFinanceBill,
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

  assert.equal((await pauseFinanceSubscription(repo, 100, 42)).status, "paused");
  assert.equal((await resumeFinanceSubscription(repo, 100, 42)).status, "active");
  assert.equal((await updateFinanceSubscription(repo, 100, { expectedAmountCents: 2_500, actorAdminId: 42 })).expectedAmountCents, 2_500);
  assert.equal((await cancelFinanceSubscription(repo, 100, { actorAdminId: 42 }, now)).status, "cancelled");
  assert.equal(calls.includes("create-bill"), false);
  assert.equal(calls.includes("create-payment"), false);
  assert.deepEqual(auditEvents.map((event) => event.action), ["created", "paused", "resumed", "updated", "cancelled"]);
  assert.equal(auditEvents.every((event) => event.entityType === "recurring_expense"), true);
  assert.deepEqual(auditEvents[1].changesJson.status, { from: "active", to: "paused" });
  assert.deepEqual(auditEvents[3].changesJson.expectedAmountCents, { from: 2000, to: 2500 });
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
