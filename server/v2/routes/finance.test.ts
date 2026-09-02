import assert from "node:assert/strict";
import test from "node:test";

import type { FinanceExpenseRepository } from "../../financeExpenseService";
import {
  financeRouteModule,
  handleFinanceRouteWithRepository,
} from "./finance";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import type { StaffPrincipalRepository } from "../auth/staffPrincipal";

function principal(permissions: StaffPrincipal["permissions"]): StaffPrincipal {
  return {
    id: "42",
    email: "finance@example.com",
    role: "admin_support",
    permissions,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://worker.example${path}`, init);
}

function jsonRequest(path: string, method: string, body: unknown) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function baseVendor() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 20,
    name: "Vendor A",
    vendorType: "saas",
    status: "active",
    website: null,
    contactEmail: null,
    notes: null,
    createdBy: 42,
    createdAt: now,
    updatedAt: now,
  };
}

function baseSubscription(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 100,
    legalEntityId: 1,
    vendorId: 20,
    vendorName: "Vendor A",
    name: "Vendor A monthly SaaS",
    categoryCode: "saas",
    cadence: "monthly",
    expectedAmountCents: 2_000,
    currency: "USD",
    variableAmount: false,
    billingDay: 1,
    nextBillingDate: "2026-02-01",
    renewalDate: null,
    autoRenew: true,
    trialEndsOn: null,
    cancellationDate: null,
    status: "active",
    notes: null,
    createdBy: 42,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseBill(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 200,
    legalEntityId: 1,
    vendorId: 20,
    vendorName: "Vendor A",
    recurringExpenseId: null,
    invoiceNumber: "INV-200",
    billKind: "invoice",
    issueDate: "2026-01-01",
    dueDate: "2026-01-31",
    servicePeriodStart: null,
    servicePeriodEnd: null,
    amountCents: 2_500,
    currency: "USD",
    categoryCode: "saas",
    status: "draft",
    creditForVendorBillId: null,
    notes: null,
    activeAppliedAmountCents: 0,
    remainingAmountCents: 2_500,
    settlementState: "open",
    documentCount: 0,
    recurringExpectedAmountCents: null,
    createdBy: 42,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function repo(overrides: {
  vendor?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  bill?: Record<string, unknown>;
} = {}): FinanceExpenseRepository {
  const vendor = { ...baseVendor(), ...overrides.vendor };
  const subscription = baseSubscription(overrides.subscription);
  const bill = baseBill(overrides.bill);
  return {
    transaction: async (work) => work(repo(overrides)),
    lockVendor: async () => undefined,
    lockRecurringExpense: async () => undefined,
    lockVendorBill: async () => undefined,
    lockExpensePayment: async () => undefined,
    lockVendorBillApplication: async () => undefined,
    lockReconciliationException: async () => undefined,
    getLegalEntity: async () => ({ id: 1, status: "active" }),
    listLegalEntities: async () => [],
    getVendor: async () => vendor,
    listVendors: async () => [vendor],
    createVendor: async (values) => ({ ...vendor, ...values, id: 21 }),
    updateVendor: async (_id, values) => ({ ...vendor, ...values }),
    getRecurringExpense: async () => subscription,
    listRecurringExpenses: async () => [subscription],
    createRecurringExpense: async (values) => ({ ...subscription, ...values, id: 101 }),
    updateRecurringExpense: async (_id, values) => ({ ...subscription, ...values }),
    getVendorBill: async () => bill,
    listVendorBills: async () => [bill],
    createVendorBill: async (values) => ({ ...bill, ...values, id: 201 }),
    updateVendorBill: async (_id, values) => ({ ...bill, ...values }),
    findVendorBillInvoiceConflict: async () => undefined,
    getExpensePayment: async () => undefined,
    listExpensePayments: async () => [],
    createExpensePayment: async () => {
      throw new Error("not used");
    },
    updateExpensePayment: async () => undefined,
    getVendorBillApplication: async () => undefined,
    listVendorBillApplications: async () => [],
    createVendorBillApplication: async () => {
      throw new Error("not used");
    },
    updateVendorBillApplication: async () => undefined,
    getReconciliationException: async () => undefined,
    listReconciliationExceptions: async () => [],
    createReconciliationException: async () => {
      throw new Error("not used");
    },
    updateReconciliationException: async () => undefined,
    createFinanceAuditEvent: async (values) => ({
      id: 1,
      ...values,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    createDocumentWithLink: async () => {
      throw new Error("not used");
    },
    entityExists: async () => false,
    getFinanceOverviewRows: async (today) => ({
      today,
      bills: [],
      subscriptions: [],
      reconciliationExceptions: [],
    }),
  } as FinanceExpenseRepository;
}

test("V2 finance route manifest is AP-only", () => {
  assert.equal(financeRouteModule.basePath, "/api/v2/finance");
  assert.equal(financeRouteModule.routes.some((route) => route.includes("payroll")), false);
  assert.equal(financeRouteModule.routes.some((route) => route.includes("tax")), false);
  assert.ok(financeRouteModule.routes.includes("POST /api/v2/finance/bill-applications/payment"));
  assert.ok(financeRouteModule.routes.includes("POST /api/v2/finance/reconciliation-exceptions/:exceptionId/resolve"));
});

test("V2 finance denies requests without Cloudflare Access principal before finance authorization", async () => {
  let lookupCalled = false;
  const staffRepository: StaffPrincipalRepository = {
    async findStaffByNormalizedEmail() {
      lookupCalled = true;
      return undefined;
    },
    async loadAccessGrants() {
      throw new Error("not reached");
    },
  };

  const result = await resolveStaffPrincipalWithRepository(
    request("/api/v2/finance/vendors"),
    {},
    {},
    staffRepository,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.deepEqual(publicStaffAuthFailure(result), {
    status: "error",
    code: "ACCESS_REQUIRED",
  });
  assert.equal(lookupCalled, false);
});

test("V2 finance authorizes only active effective super_admin or finance_admin grants", async () => {
  for (const denied of [
    principal([]),
    principal(["admin_operations"]),
    principal(["verifier_admin"]),
    { ...principal(["finance_admin"]), id: "not-a-number" },
  ]) {
    const response = await handleFinanceRouteWithRepository(
      request("/api/v2/finance/vendors"),
      denied,
      repo(),
    );
    assert.equal(response.status, 403);
    assert.equal((await body(response)).code, "STAFF_ACCESS_DENIED");
  }

  for (const allowed of [principal(["finance_admin"]), principal(["super_admin"])]) {
    const response = await handleFinanceRouteWithRepository(
      request("/api/v2/finance/vendors"),
      allowed,
      repo(),
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as Array<{ name: string }>;
    assert.equal(payload[0].name, "Vendor A");
  }
});

test("V2 finance vendor route preserves AP response contract and actor mapping", async () => {
  const response = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/vendors", "POST", {
      name: "Vendor B",
      vendorType: "saas",
      status: "active",
    }),
    principal(["finance_admin"]),
    repo(),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: 21,
    name: "Vendor B",
    vendorType: "saas",
    status: "active",
    website: null,
    contactEmail: null,
    notes: null,
  });
});

test("V2 finance GET responses preserve AP notes fields", async () => {
  const repository = repo({
    vendor: { notes: "Vendor directory note" },
    subscription: { name: "ahhh-yaotu.com domain renewal", notes: "Annual domain renewal" },
    bill: { notes: "Invoice reviewed with receipt" },
  });

  const vendorsResponse = await handleFinanceRouteWithRepository(
    request("/api/v2/finance/vendors"),
    principal(["finance_admin"]),
    repository,
  );
  assert.equal(vendorsResponse.status, 200);
  assert.equal(((await vendorsResponse.json()) as Array<Record<string, unknown>>)[0].notes, "Vendor directory note");

  const subscriptionsResponse = await handleFinanceRouteWithRepository(
    request("/api/v2/finance/subscriptions"),
    principal(["finance_admin"]),
    repository,
  );
  assert.equal(subscriptionsResponse.status, 200);
  const subscriptionsPayload = await subscriptionsResponse.json() as Array<Record<string, unknown>>;
  assert.equal(subscriptionsPayload[0].name, "ahhh-yaotu.com domain renewal");
  assert.equal(subscriptionsPayload[0].notes, "Annual domain renewal");

  const billsResponse = await handleFinanceRouteWithRepository(
    request("/api/v2/finance/bills"),
    principal(["finance_admin"]),
    repository,
  );
  assert.equal(billsResponse.status, 200);
  assert.equal(((await billsResponse.json()) as Array<Record<string, unknown>>)[0].notes, "Invoice reviewed with receipt");
});

test("V2 finance AP mutations return, edit, and clear notes", async () => {
  const staff = principal(["finance_admin"]);
  const repository = repo();

  const createdVendorResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/vendors", "POST", {
      name: "Cloudflare",
      vendorType: "cloud",
      status: "active",
      notes: "Domain registrar and CDN provider",
    }),
    staff,
    repository,
  );
  assert.equal(createdVendorResponse.status, 201);
  assert.equal((await body(createdVendorResponse)).notes, "Domain registrar and CDN provider");

  const clearedVendorResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/vendors/20", "PATCH", { notes: null }),
    staff,
    repository,
  );
  assert.equal(clearedVendorResponse.status, 200);
  assert.equal((await body(clearedVendorResponse)).notes, null);

  const createdSubscriptionResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/subscriptions", "POST", {
      legalEntityId: 1,
      vendorId: 20,
      name: "ahhh-yaotu.com domain renewal",
      categoryCode: "cloud",
      cadence: "annual",
      expectedAmountCents: 1_200,
      currency: "USD",
      variableAmount: false,
      autoRenew: true,
      status: "active",
      notes: "Annual domain registration renewal",
    }),
    staff,
    repository,
  );
  assert.equal(createdSubscriptionResponse.status, 201);
  const createdSubscription = await body(createdSubscriptionResponse);
  assert.equal(createdSubscription.name, "ahhh-yaotu.com domain renewal");
  assert.equal(createdSubscription.categoryCode, "cloud");
  assert.equal(createdSubscription.notes, "Annual domain registration renewal");

  const clearedSubscriptionResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/subscriptions/100", "PATCH", {
      name: "Cloudflare Workers paid plan",
      notes: null,
    }),
    staff,
    repository,
  );
  assert.equal(clearedSubscriptionResponse.status, 200);
  const updatedSubscription = await body(clearedSubscriptionResponse);
  assert.equal(updatedSubscription.name, "Cloudflare Workers paid plan");
  assert.equal(updatedSubscription.notes, null);

  const createdBillResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/bills", "POST", {
      legalEntityId: 1,
      vendorId: 20,
      invoiceNumber: "CF-2026",
      billKind: "invoice",
      amountCents: 1_200,
      currency: "USD",
      categoryCode: "cloud",
      status: "draft",
      notes: "Cloudflare domain renewal invoice",
    }),
    staff,
    repository,
  );
  assert.equal(createdBillResponse.status, 201);
  assert.equal((await body(createdBillResponse)).notes, "Cloudflare domain renewal invoice");

  const clearedBillResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/bills/200", "PATCH", { notes: null }),
    staff,
    repository,
  );
  assert.equal(clearedBillResponse.status, 200);
  assert.equal((await body(clearedBillResponse)).notes, null);
});

test("V2 finance validation errors are bounded JSON errors", async () => {
  const response = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/vendors", "POST", {
      vendorType: "saas",
      status: "active",
    }),
    principal(["finance_admin"]),
    repo(),
  );

  assert.equal(response.status, 400);
  const payload = await body(response);
  assert.equal(payload.code, "INVALID_REQUEST");
  assert.equal(payload.message, "Invalid finance request");
});

test("V2 recurring expense identity rejects missing or whitespace names", async () => {
  for (const payload of [
    {
      legalEntityId: 1,
      vendorId: 20,
      categoryCode: "cloud",
      cadence: "annual",
      expectedAmountCents: 1_200,
      variableAmount: false,
    },
    {
      legalEntityId: 1,
      vendorId: 20,
      name: "   ",
      categoryCode: "cloud",
      cadence: "annual",
      expectedAmountCents: 1_200,
      variableAmount: false,
    },
  ]) {
    const response = await handleFinanceRouteWithRepository(
      jsonRequest("/api/v2/finance/subscriptions", "POST", payload),
      principal(["finance_admin"]),
      repo(),
    );
    assert.equal(response.status, 400);
    assert.equal((await body(response)).code, "INVALID_REQUEST");
  }

  const patchResponse = await handleFinanceRouteWithRepository(
    jsonRequest("/api/v2/finance/subscriptions/100", "PATCH", { name: "   " }),
    principal(["finance_admin"]),
    repo(),
  );
  assert.equal(patchResponse.status, 400);
  assert.equal((await body(patchResponse)).code, "INVALID_REQUEST");
});
