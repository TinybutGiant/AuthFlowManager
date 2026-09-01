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

function repo(): FinanceExpenseRepository {
  const vendor = baseVendor();
  return {
    transaction: async (work) => work(repo()),
    lockVendor: async () => undefined,
    lockRecurringExpense: async () => undefined,
    lockVendorBill: async () => undefined,
    lockExpensePayment: async () => undefined,
    lockVendorBillApplication: async () => undefined,
    lockReconciliationException: async () => undefined,
    getLegalEntity: async () => undefined,
    listLegalEntities: async () => [],
    getVendor: async () => vendor,
    listVendors: async () => [vendor],
    createVendor: async (values) => ({ ...vendor, ...values, id: 21 }),
    updateVendor: async (_id, values) => ({ ...vendor, ...values }),
    getRecurringExpense: async () => undefined,
    listRecurringExpenses: async () => [],
    createRecurringExpense: async () => {
      throw new Error("not used");
    },
    updateRecurringExpense: async () => undefined,
    getVendorBill: async () => undefined,
    listVendorBills: async () => [],
    createVendorBill: async () => {
      throw new Error("not used");
    },
    updateVendorBill: async () => undefined,
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
  });
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
