import assert from "node:assert/strict";
import test from "node:test";

import type {
  Employment,
  ExternalRecordRef,
  InsertExternalRecordRef,
  InsertPayrollAuditEvent,
  InsertPayrollPayment,
  InsertPayrollResultLine,
  InsertPayrollRun,
  InsertPayrollRunWorker,
  LegalEntity,
  PayrollAuditEvent,
  PayrollPayment,
  PayrollResultLine,
  PayrollRun,
  PayrollRunWorker,
  Vendor,
  Worker,
} from "@shared/schema";
import type {
  PayrollEmploymentOptionFilters,
  PayrollRepository,
  PayrollRunListFilters,
} from "../../payrollService";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { StaffPrincipalRepository } from "../auth/staffPrincipal";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import {
  handlePayrollRouteWithRepository,
  payrollRouteModule,
} from "./payroll";

type State = {
  legalEntities: LegalEntity[];
  vendors: Vendor[];
  workers: Worker[];
  employments: Employment[];
  payrollRuns: PayrollRun[];
  payrollRunWorkers: PayrollRunWorker[];
  payrollResultLines: PayrollResultLine[];
  payrollPayments: PayrollPayment[];
  externalRecordRefs: ExternalRecordRef[];
  payrollAuditEvents: PayrollAuditEvent[];
  locks: string[];
  next: Record<string, number>;
};

function now() {
  return new Date("2026-01-01T00:00:00.000Z");
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function cloneState(state: State): State {
  return {
    ...state,
    legalEntities: state.legalEntities.map((item) => ({ ...item })),
    vendors: state.vendors.map((item) => ({ ...item })),
    workers: state.workers.map((item) => ({ ...item })),
    employments: state.employments.map((item) => ({ ...item })),
    payrollRuns: state.payrollRuns.map((item) => ({ ...item })),
    payrollRunWorkers: state.payrollRunWorkers.map((item) => ({ ...item })),
    payrollResultLines: state.payrollResultLines.map((item) => ({ ...item })),
    payrollPayments: state.payrollPayments.map((item) => ({ ...item })),
    externalRecordRefs: state.externalRecordRefs.map((item) => ({ ...item })),
    payrollAuditEvents: state.payrollAuditEvents.map((item) => ({ ...item })),
    locks: [...state.locks],
    next: { ...state.next },
  };
}

function restoreState(state: State, snapshot: State) {
  state.legalEntities = snapshot.legalEntities;
  state.vendors = snapshot.vendors;
  state.workers = snapshot.workers;
  state.employments = snapshot.employments;
  state.payrollRuns = snapshot.payrollRuns;
  state.payrollRunWorkers = snapshot.payrollRunWorkers;
  state.payrollResultLines = snapshot.payrollResultLines;
  state.payrollPayments = snapshot.payrollPayments;
  state.externalRecordRefs = snapshot.externalRecordRefs;
  state.payrollAuditEvents = snapshot.payrollAuditEvents;
  state.locks = snapshot.locks;
  state.next = snapshot.next;
}

function makeState(): State {
  return {
    legalEntities: [],
    vendors: [],
    workers: [],
    employments: [],
    payrollRuns: [],
    payrollRunWorkers: [],
    payrollResultLines: [],
    payrollPayments: [],
    externalRecordRefs: [],
    payrollAuditEvents: [],
    locks: [],
    next: {
      legalEntity: 1,
      vendor: 20,
      worker: 100,
      employment: 200,
      payrollRun: 300,
      payrollRunWorker: 400,
      payrollResultLine: 500,
      payrollPayment: 600,
      externalRecordRef: 700,
      payrollAuditEvent: 800,
    },
  };
}

function makeRepo(state = makeState()): PayrollRepository & { state: State } {
  const repo: PayrollRepository & { state: State } = {
    state,
    transaction: async (work) => {
      const snapshot = cloneState(state);
      try {
        return await work(repo);
      } catch (error) {
        restoreState(state, snapshot);
        throw error;
      }
    },
    lockPayrollRun: async (id) => { state.locks.push(`payroll_run:${id}`); },
    lockPayrollRunWorker: async (id) => { state.locks.push(`payroll_run_worker:${id}`); },
    lockPayrollResultLine: async (id) => { state.locks.push(`payroll_result_line:${id}`); },
    lockPayrollPayment: async (id) => { state.locks.push(`payroll_payment:${id}`); },
    lockWorker: async (id) => { state.locks.push(`worker:${id}`); },
    lockEmployment: async (id) => { state.locks.push(`employment:${id}`); },
    lockLegalEntity: async (id) => { state.locks.push(`legal_entity:${id}`); },
    lockVendor: async (id) => { state.locks.push(`vendor:${id}`); },

    getLegalEntity: async (id) => state.legalEntities.find((item) => item.id === id),
    listLegalEntities: async () => state.legalEntities
      .filter((item) => item.status === "active")
      .map((item) => ({
        id: item.id,
        legalName: item.legalName,
        entityType: item.entityType,
        status: item.status,
      })),
    getVendor: async (id) => state.vendors.find((item) => item.id === id),
    listPayrollVendors: async () => state.vendors.filter((item) => item.status !== "archived"),
    getWorker: async (id) => state.workers.find((item) => item.id === id),
    getEmployment: async (id) => state.employments.find((item) => item.id === id),
    listPayrollEmploymentOptions: async (filters: PayrollEmploymentOptionFilters) => state.employments
      .filter((item) => !filters.legalEntityId || item.legalEntityId === filters.legalEntityId)
      .filter((item) => item.status !== "voided")
      .slice(0, filters.pageSize ?? 250),

    getPayrollRun: async (id) => state.payrollRuns.find((item) => item.id === id),
    findPayrollCorrectionSuccessor: async (payrollRunId) => state.payrollRuns.find(
      (item) => item.correctionOfPayrollRunId === payrollRunId,
    ),
    listPayrollRuns: async (filters: PayrollRunListFilters) => state.payrollRuns
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.legalEntityId || item.legalEntityId === filters.legalEntityId)
      .slice(0, filters.pageSize ?? 100),
    createPayrollRun: async (values: InsertPayrollRun) => {
      const run = {
        id: state.next.payrollRun++,
        legalEntityId: values.legalEntityId,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        payDate: values.payDate,
        runKind: values.runKind ?? "regular",
        sourceType: values.sourceType ?? "manual",
        sourceVendorId: values.sourceVendorId ?? null,
        correctionOfPayrollRunId: values.correctionOfPayrollRunId ?? null,
        status: values.status ?? "draft",
        finalizedAt: values.finalizedAt ?? null,
        finalizedBy: values.finalizedBy ?? null,
        notes: values.notes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      } as PayrollRun;
      state.payrollRuns.push(run);
      return run;
    },
    updatePayrollRun: async (id, values) => {
      const existing = state.payrollRuns.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getPayrollRunWorker: async (id) => state.payrollRunWorkers.find((item) => item.id === id),
    findPayrollRunWorkerByRunEmployment: async (payrollRunId, employmentId) => state.payrollRunWorkers.find(
      (item) => item.payrollRunId === payrollRunId && item.employmentId === employmentId,
    ),
    listPayrollRunWorkers: async (payrollRunId) => state.payrollRunWorkers.filter((item) => item.payrollRunId === payrollRunId),
    listPayrollRunWorkersForRuns: async (payrollRunIds) => state.payrollRunWorkers.filter((item) => payrollRunIds.includes(item.payrollRunId)),
    createPayrollRunWorker: async (values: InsertPayrollRunWorker) => {
      const worker = {
        id: state.next.payrollRunWorker++,
        payrollRunId: values.payrollRunId,
        workerId: values.workerId,
        employmentId: values.employmentId,
        currency: values.currency ?? "USD",
        grossPayCents: values.grossPayCents ?? 0,
        employeeTaxCents: values.employeeTaxCents ?? 0,
        employerTaxCents: values.employerTaxCents ?? 0,
        deductionCents: values.deductionCents ?? 0,
        netPayCents: values.netPayCents ?? 0,
        sourceMetadata: values.sourceMetadata ?? {},
        createdAt: now(),
        updatedAt: now(),
      } as PayrollRunWorker;
      state.payrollRunWorkers.push(worker);
      return worker;
    },
    updatePayrollRunWorker: async (id, values) => {
      const existing = state.payrollRunWorkers.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },
    deletePayrollRunWorker: async (id) => {
      state.payrollRunWorkers = state.payrollRunWorkers.filter((item) => item.id !== id);
    },

    getPayrollResultLine: async (id) => state.payrollResultLines.find((item) => item.id === id),
    listPayrollResultLines: async (payrollRunWorkerId) => state.payrollResultLines.filter((item) => item.payrollRunWorkerId === payrollRunWorkerId),
    listPayrollResultLinesForWorkers: async (payrollRunWorkerIds) => state.payrollResultLines.filter((item) => payrollRunWorkerIds.includes(item.payrollRunWorkerId)),
    createPayrollResultLine: async (values: InsertPayrollResultLine) => {
      const line = {
        id: state.next.payrollResultLine++,
        payrollRunWorkerId: values.payrollRunWorkerId,
        lineCategory: values.lineCategory,
        lineCode: values.lineCode,
        description: values.description ?? null,
        amountEffect: values.amountEffect ?? "increase",
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        quantityMicrounits: values.quantityMicrounits ?? null,
        rateAmountCents: values.rateAmountCents ?? null,
        jurisdictionCode: values.jurisdictionCode ?? null,
        metadata: values.metadata ?? {},
        createdAt: now(),
        updatedAt: now(),
      } as PayrollResultLine;
      state.payrollResultLines.push(line);
      return line;
    },
    updatePayrollResultLine: async (id, values) => {
      const existing = state.payrollResultLines.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },
    deletePayrollResultLine: async (id) => {
      state.payrollResultLines = state.payrollResultLines.filter((item) => item.id !== id);
    },
    deletePayrollResultLinesForWorker: async (payrollRunWorkerId) => {
      state.payrollResultLines = state.payrollResultLines.filter((item) => item.payrollRunWorkerId !== payrollRunWorkerId);
    },

    getPayrollPayment: async (id) => state.payrollPayments.find((item) => item.id === id),
    listPayrollPayments: async (payrollRunWorkerId) => state.payrollPayments.filter((item) => item.payrollRunWorkerId === payrollRunWorkerId),
    listPayrollPaymentsForWorkers: async (payrollRunWorkerIds) => state.payrollPayments.filter((item) => payrollRunWorkerIds.includes(item.payrollRunWorkerId)),
    createPayrollPayment: async (values: InsertPayrollPayment) => {
      const payment = {
        id: state.next.payrollPayment++,
        payrollRunWorkerId: values.payrollRunWorkerId,
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        paymentDate: values.paymentDate ?? null,
        methodType: values.methodType,
        methodLabel: values.methodLabel ?? null,
        institutionName: values.institutionName ?? null,
        maskedLast4: values.maskedLast4 ?? null,
        externalConfirmationRef: values.externalConfirmationRef ?? null,
        status: values.status ?? "pending",
        processedAt: values.processedAt ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      } as PayrollPayment;
      state.payrollPayments.push(payment);
      return payment;
    },
    updatePayrollPayment: async (id, values) => {
      const existing = state.payrollPayments.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getExternalRecordRef: async (id) => state.externalRecordRefs.find((item) => item.id === id),
    listExternalRecordRefsForEntity: async (entityType, entityId) => state.externalRecordRefs.filter(
      (item) => item.entityType === entityType && item.entityId === entityId,
    ),
    createExternalRecordRef: async (values: InsertExternalRecordRef) => {
      const ref = {
        id: state.next.externalRecordRef++,
        entityType: values.entityType,
        entityId: values.entityId,
        sourceType: values.sourceType,
        sourceVendorId: values.sourceVendorId ?? null,
        sourceNamespace: values.sourceNamespace ?? "default",
        externalRecordType: values.externalRecordType,
        externalRecordId: values.externalRecordId,
        importedAt: values.importedAt ?? null,
        payloadHash: values.payloadHash ?? null,
        metadata: values.metadata ?? {},
        status: values.status ?? "active",
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      } as ExternalRecordRef;
      state.externalRecordRefs.push(ref);
      return ref;
    },

    createPayrollAuditEvent: async (values: InsertPayrollAuditEvent) => {
      const event = {
        id: state.next.payrollAuditEvent++,
        actorAdminUserId: values.actorAdminUserId,
        entityType: values.entityType,
        entityId: values.entityId,
        action: values.action,
        changesJson: values.changesJson ?? {},
        createdAt: now(),
      } as PayrollAuditEvent;
      state.payrollAuditEvents.push(event);
      return event;
    },
  };

  return repo;
}

function seedLegalEntity(state: State, values: Partial<LegalEntity> = {}) {
  const entity = {
    id: values.id ?? state.next.legalEntity++,
    legalName: values.legalName ?? "Yaotu LLC",
    entityType: values.entityType ?? "llc",
    formationState: values.formationState ?? "DE",
    maskedTaxIdentifier: values.maskedTaxIdentifier ?? "***-**-1234",
    status: values.status ?? "active",
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } as LegalEntity;
  state.legalEntities.push(entity);
  return entity;
}

function seedVendor(state: State, values: Partial<Vendor> = {}) {
  const vendor = {
    id: values.id ?? state.next.vendor++,
    name: values.name ?? "Payroll Provider",
    vendorType: values.vendorType ?? "payroll_provider",
    status: values.status ?? "active",
    website: values.website ?? "https://payroll.example",
    contactEmail: values.contactEmail ?? "vendor-private@example.com",
    notes: values.notes ?? "sensitive vendor note",
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } as Vendor;
  state.vendors.push(vendor);
  return vendor;
}

function seedWorker(state: State, values: Partial<Worker> = {}) {
  const id = values.id ?? state.next.worker++;
  const worker = {
    id,
    adminUserId: values.adminUserId ?? null,
    workerCode: values.workerCode ?? `W-${id}`,
    legalName: values.legalName ?? "Jane Worker",
    preferredName: values.preferredName ?? "Jane",
    personnelEmail: values.personnelEmail ?? "private-worker@example.com",
    archivedAt: values.archivedAt ?? null,
    voidedAt: values.voidedAt ?? null,
    mergedIntoWorkerId: values.mergedIntoWorkerId ?? null,
    mergedAt: values.mergedAt ?? null,
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } as Worker;
  state.workers.push(worker);
  return worker;
}

function seedEmployment(
  state: State,
  values: Partial<Employment> & { workerId: number; legalEntityId: number },
) {
  const employment = {
    id: values.id ?? state.next.employment++,
    workerId: values.workerId,
    legalEntityId: values.legalEntityId,
    employeeClassification: values.employeeClassification ?? "employee",
    payrollParticipation: values.payrollParticipation ?? "active",
    status: values.status ?? "active",
    startDate: values.startDate ?? "2026-01-01",
    endDate: values.endDate ?? null,
    workLocation: values.workLocation ?? "private work location",
    primaryWorkState: values.primaryWorkState ?? "MI",
    primaryWorkJurisdiction: values.primaryWorkJurisdiction ?? "US-MI",
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } as Employment;
  state.employments.push(employment);
  return employment;
}

function principal(permissions: StaffPrincipal["permissions"]): StaffPrincipal {
  return {
    id: "42",
    email: "payroll@example.com",
    role: "admin_finance",
    permissions,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://worker.example${path}`, init);
}

function jsonRequest(path: string, method: string, requestBody: unknown) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>;
}

async function jsonBody<T>(response: Response) {
  return await response.json() as T;
}

function seededPayrollRepo() {
  const repository = makeRepo();
  const entity = seedLegalEntity(repository.state);
  const vendor = seedVendor(repository.state);
  const worker = seedWorker(repository.state);
  const employment = seedEmployment(repository.state, {
    workerId: worker.id,
    legalEntityId: entity.id,
  });
  return { repository, entity, vendor, worker, employment };
}

test("V2 payroll route manifest is Payroll-only", () => {
  assert.equal(payrollRouteModule.basePath, "/api/v2/payroll");
  assert.equal(payrollRouteModule.routes.length, 26);
  assert.ok(payrollRouteModule.routes.includes("GET /api/v2/payroll/overview"));
  assert.ok(payrollRouteModule.routes.includes("POST /api/v2/payroll/runs/:runId/finalize"));
  assert.ok(payrollRouteModule.routes.includes("POST /api/v2/payroll/payments/:paymentId/reverse"));
  assert.ok(payrollRouteModule.routes.includes("POST /api/v2/payroll/external-record-refs"));
  assert.equal(
    payrollRouteModule.routes.some((route) =>
      /finance|billing|tax|personnel|compensation|bank|ach-provider|gusto/i.test(route),
    ),
    false,
  );
});

test("V2 payroll denies requests without Cloudflare Access principal before staff lookup", async () => {
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
    request("/api/v2/payroll/runs"),
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

test("V2 payroll authorizes only effective super_admin or payroll_admin grants", async () => {
  for (const denied of [
    principal([]),
    principal(["finance_admin"]),
    principal(["admin_operations"]),
    principal(["verifier_admin"]),
    principal(["support_admin"]),
    principal(["trainee_workspace"]),
    { ...principal(["payroll_admin"]), id: "not-a-number" },
  ]) {
    const response = await handlePayrollRouteWithRepository(
      request("/api/v2/payroll/legal-entities"),
      denied,
      seededPayrollRepo().repository,
    );
    assert.equal(response.status, 403);
    assert.equal((await body(response)).code, "STAFF_ACCESS_DENIED");
  }

  for (const allowed of [principal(["payroll_admin"]), principal(["super_admin"])]) {
    const response = await handlePayrollRouteWithRepository(
      request("/api/v2/payroll/legal-entities"),
      allowed,
      seededPayrollRepo().repository,
    );
    assert.equal(response.status, 200);
    const payload = await jsonBody<Array<{ legalName: string }>>(response);
    assert.equal(payload[0].legalName, "Yaotu LLC");
  }
});

test("V2 payroll DTOs expose narrow Payroll reference data only", async () => {
  const { repository } = seededPayrollRepo();

  const entitiesResponse = await handlePayrollRouteWithRepository(
    request("/api/v2/payroll/legal-entities"),
    principal(["payroll_admin"]),
    repository,
  );
  assert.equal(entitiesResponse.status, 200);
  assert.deepEqual(
    Object.keys((await jsonBody<Record<string, unknown>[]>(entitiesResponse))[0]).sort(),
    ["entityType", "id", "legalName", "status"].sort(),
  );

  const vendorsResponse = await handlePayrollRouteWithRepository(
    request("/api/v2/payroll/vendors"),
    principal(["payroll_admin"]),
    repository,
  );
  assert.equal(vendorsResponse.status, 200);
  assert.deepEqual(
    Object.keys((await jsonBody<Record<string, unknown>[]>(vendorsResponse))[0]).sort(),
    ["id", "name", "status", "vendorType"].sort(),
  );

  const optionsResponse = await handlePayrollRouteWithRepository(
    request("/api/v2/payroll/employment-options"),
    principal(["payroll_admin"]),
    repository,
  );
  assert.equal(optionsResponse.status, 200);
  const optionsText = JSON.stringify(await optionsResponse.json());
  assert.equal(optionsText.includes("private-worker@example.com"), false);
  assert.equal(optionsText.includes("private work location"), false);
  assert.equal(optionsText.includes("***-**-1234"), false);
  assert.equal(optionsText.includes("vendor-private@example.com"), false);
  assert.equal(optionsText.includes("sensitive vendor note"), false);
});

test("V2 payroll route maps Payroll lifecycle, correction, payment, and external-ref operations", async () => {
  const { repository, entity, vendor, worker, employment } = seededPayrollRepo();
  const actor = principal(["payroll_admin"]);

  const createRunResponse = await handlePayrollRouteWithRepository(
    jsonRequest("/api/v2/payroll/runs", "POST", {
      legalEntityId: entity.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      payDate: "2026-01-20",
      runKind: "regular",
      sourceType: "provider",
      sourceVendorId: vendor.id,
      notes: "provider output imported",
    }),
    actor,
    repository,
  );
  assert.equal(createRunResponse.status, 201);
  const createdRun = await jsonBody<{ id: number; status: string; workers: unknown[] }>(createRunResponse);
  assert.equal(createdRun.status, "draft");
  assert.deepEqual(createdRun.workers, []);

  const listRunsResponse = await handlePayrollRouteWithRepository(
    request("/api/v2/payroll/runs"),
    actor,
    repository,
  );
  assert.equal(listRunsResponse.status, 200);
  assert.equal((await jsonBody<Array<{ id: number }>>(listRunsResponse))[0].id, createdRun.id);

  const updateRunResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/runs/${createdRun.id}`, "PATCH", {
      notes: "review imported snapshot",
    }),
    actor,
    repository,
  );
  assert.equal(updateRunResponse.status, 200);
  assert.equal((await body(updateRunResponse)).notes, "review imported snapshot");

  const addWorkerResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/runs/${createdRun.id}/workers`, "POST", {
      workerId: worker.id,
      employmentId: employment.id,
      currency: "USD",
      grossPayCents: 100_000,
      employeeTaxCents: 20_000,
      employerTaxCents: 8_000,
      deductionCents: 5_000,
      netPayCents: 75_000,
      sourceMetadata: { providerBatch: "batch-1" },
    }),
    actor,
    repository,
  );
  assert.equal(addWorkerResponse.status, 201);
  const runWorker = await jsonBody<{ id: number; worker: { legalName: string } }>(addWorkerResponse);
  assert.equal(runWorker.worker.legalName, "Jane Worker");

  const duplicateWorkerResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/runs/${createdRun.id}/workers`, "POST", {
      workerId: worker.id,
      employmentId: employment.id,
      currency: "USD",
      grossPayCents: 100_000,
      employeeTaxCents: 20_000,
      employerTaxCents: 8_000,
      deductionCents: 5_000,
      netPayCents: 75_000,
      sourceMetadata: {},
    }),
    actor,
    repository,
  );
  assert.equal(duplicateWorkerResponse.status, 409);
  assert.equal((await body(duplicateWorkerResponse)).code, "PAYROLL_RUN_WORKER_DUPLICATE");

  const updateWorkerResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/run-workers/${runWorker.id}`, "PATCH", {
      netPayCents: 76_000,
    }),
    actor,
    repository,
  );
  assert.equal(updateWorkerResponse.status, 200);
  assert.equal((await body(updateWorkerResponse)).netPayCents, 76_000);

  const addLineResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/run-workers/${runWorker.id}/result-lines`, "POST", {
      lineCategory: "employee_tax",
      lineCode: "FEDERAL_INCOME_TAX",
      description: "Federal withholding snapshot",
      amountEffect: "increase",
      amountCents: 20_000,
      currency: "USD",
      jurisdictionCode: "US-FED",
      metadata: { source: "provider" },
    }),
    actor,
    repository,
  );
  assert.equal(addLineResponse.status, 201);
  const line = await jsonBody<{ id: number; jurisdictionCode: string }>(addLineResponse);
  assert.equal(line.jurisdictionCode, "US-FED");

  const updateLineResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/result-lines/${line.id}`, "PATCH", {
      amountCents: 20_500,
    }),
    actor,
    repository,
  );
  assert.equal(updateLineResponse.status, 200);
  assert.equal((await body(updateLineResponse)).amountCents, 20_500);

  const reviewResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/runs/${createdRun.id}/review`, { method: "POST" }),
    actor,
    repository,
  );
  assert.equal(reviewResponse.status, 200);
  assert.equal((await body(reviewResponse)).status, "reviewed");

  const finalizeResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/runs/${createdRun.id}/finalize`, { method: "POST" }),
    actor,
    repository,
  );
  assert.equal(finalizeResponse.status, 200);
  assert.equal((await body(finalizeResponse)).status, "finalized");

  const recordPaymentResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/run-workers/${runWorker.id}/payments`, "POST", {
      amountCents: 76_000,
      currency: "USD",
      methodType: "manual",
      status: "pending",
    }),
    actor,
    repository,
  );
  assert.equal(recordPaymentResponse.status, 201);
  const payment = await jsonBody<{ id: number; status: string }>(recordPaymentResponse);
  assert.equal(payment.status, "pending");

  const invalidTransitionResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/payments/${payment.id}/clear`, { method: "POST" }),
    actor,
    repository,
  );
  assert.equal(invalidTransitionResponse.status, 400);
  assert.equal((await body(invalidTransitionResponse)).code, "PAYROLL_PAYMENT_TRANSITION_INVALID");

  const sentResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/payments/${payment.id}/send`, "POST", {
      paymentDate: "2026-01-20",
    }),
    actor,
    repository,
  );
  assert.equal(sentResponse.status, 200);
  assert.equal((await body(sentResponse)).status, "sent");

  const clearedResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/payments/${payment.id}/clear`, "POST", {
      paymentDate: "2026-01-20",
    }),
    actor,
    repository,
  );
  assert.equal(clearedResponse.status, 200);
  assert.equal((await body(clearedResponse)).status, "cleared");

  const reversedResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/payments/${payment.id}/reverse`, { method: "POST" }),
    actor,
    repository,
  );
  assert.equal(reversedResponse.status, 200);
  assert.equal((await body(reversedResponse)).status, "reversed");

  const externalRefResponse = await handlePayrollRouteWithRepository(
    jsonRequest("/api/v2/payroll/external-record-refs", "POST", {
      entityType: "payroll_runs",
      entityId: createdRun.id,
      sourceType: "provider",
      sourceVendorId: vendor.id,
      sourceNamespace: "payroll",
      externalRecordType: "payroll_run",
      externalRecordId: "provider-run-123",
      metadata: {},
      status: "active",
    }),
    actor,
    repository,
  );
  assert.equal(externalRefResponse.status, 201);
  assert.equal((await body(externalRefResponse)).externalRecordId, "provider-run-123");

  const correctionResponse = await handlePayrollRouteWithRepository(
    jsonRequest("/api/v2/payroll/runs/corrections", "POST", {
      correctionOfPayrollRunId: createdRun.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      payDate: "2026-01-31",
      sourceType: "manual",
    }),
    actor,
    repository,
  );
  assert.equal(correctionResponse.status, 201);
  assert.equal((await body(correctionResponse)).runKind, "correction");

  const detailResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/runs/${createdRun.id}`),
    actor,
    repository,
  );
  assert.equal(detailResponse.status, 200);
  const detailText = JSON.stringify(await detailResponse.json());
  assert.equal(detailText.includes("private-worker@example.com"), false);
  assert.equal(detailText.includes("private work location"), false);
  assert.equal(detailText.includes("sensitive vendor note"), false);
  for (const expectedLock of [
    `legal_entity:${entity.id}`,
    `payroll_run:${createdRun.id}`,
    `worker:${worker.id}`,
    `employment:${employment.id}`,
    `payroll_run_worker:${runWorker.id}`,
    `payroll_result_line:${line.id}`,
    `payroll_payment:${payment.id}`,
  ]) {
    assert.ok(repository.state.locks.includes(expectedLock), `missing lock ${expectedLock}`);
  }
  assert.deepEqual(
    repository.state.payrollAuditEvents.map((event) => `${event.entityType}:${event.action}`),
    [
      "payroll_run:created",
      "payroll_run:updated",
      "payroll_run_worker:created",
      "payroll_run_worker:updated",
      "payroll_result_line:created",
      "payroll_result_line:updated",
      "payroll_run:reviewed",
      "payroll_run:finalized",
      "payroll_payment:recorded",
      "payroll_payment:sent",
      "payroll_payment:cleared",
      "payroll_payment:reversed",
      "payroll_run:correction_created",
    ],
  );
});

test("V2 payroll worker and result-line removals remain draft-only ledger operations", async () => {
  const { repository, entity, worker, employment } = seededPayrollRepo();
  const actor = principal(["super_admin"]);

  const createRunResponse = await handlePayrollRouteWithRepository(
    jsonRequest("/api/v2/payroll/runs", "POST", {
      legalEntityId: entity.id,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-15",
      payDate: "2026-02-20",
      runKind: "regular",
      sourceType: "manual",
    }),
    actor,
    repository,
  );
  const run = await jsonBody<{ id: number }>(createRunResponse);
  const addWorkerResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/runs/${run.id}/workers`, "POST", {
      workerId: worker.id,
      employmentId: employment.id,
      currency: "USD",
      grossPayCents: 100,
      employeeTaxCents: 0,
      employerTaxCents: 0,
      deductionCents: 0,
      netPayCents: 100,
      sourceMetadata: {},
    }),
    actor,
    repository,
  );
  const runWorker = await jsonBody<{ id: number }>(addWorkerResponse);
  const addLineResponse = await handlePayrollRouteWithRepository(
    jsonRequest(`/api/v2/payroll/run-workers/${runWorker.id}/result-lines`, "POST", {
      lineCategory: "earning",
      lineCode: "REG",
      amountEffect: "increase",
      amountCents: 100,
      currency: "USD",
      metadata: {},
    }),
    actor,
    repository,
  );
  const line = await jsonBody<{ id: number }>(addLineResponse);

  const removeLineResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/result-lines/${line.id}`, { method: "DELETE" }),
    actor,
    repository,
  );
  assert.equal(removeLineResponse.status, 200);
  assert.deepEqual(await removeLineResponse.json(), { removed: true, id: line.id });

  const removeWorkerResponse = await handlePayrollRouteWithRepository(
    request(`/api/v2/payroll/run-workers/${runWorker.id}`, { method: "DELETE" }),
    actor,
    repository,
  );
  assert.equal(removeWorkerResponse.status, 200);
  assert.deepEqual(await removeWorkerResponse.json(), { removed: true, id: runWorker.id });
});

test("V2 payroll validation errors are bounded JSON errors", async () => {
  const response = await handlePayrollRouteWithRepository(
    jsonRequest("/api/v2/payroll/runs", "POST", {
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      payDate: "2026-01-20",
      sourceType: "manual",
    }),
    principal(["payroll_admin"]),
    seededPayrollRepo().repository,
  );

  assert.equal(response.status, 400);
  const payload = await body(response);
  assert.equal(payload.code, "INVALID_REQUEST");
  assert.equal(payload.message, "Invalid payroll request");
});

test("V2 payroll body parser rejects oversized mutation payloads before JSON parsing", async () => {
  const response = await handlePayrollRouteWithRepository(
    request("/api/v2/payroll/runs", {
      method: "POST",
      headers: {
        "Content-Length": String(65 * 1024),
      },
      body: "{",
    }),
    principal(["payroll_admin"]),
    seededPayrollRepo().repository,
  );

  assert.equal(response.status, 413);
  assert.equal((await body(response)).code, "PAYROLL_REQUEST_TOO_LARGE");
});
