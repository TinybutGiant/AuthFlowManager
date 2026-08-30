import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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
import {
  PayrollServiceError,
  addPayrollResultLine,
  addPayrollRunWorker,
  createPayrollCorrectionRun,
  createPayrollExternalRecordRef,
  createPayrollRun,
  finalizePayrollRun,
  getPayrollOverview,
  getPayrollRun,
  markPayrollRunReviewed,
  recordPayrollPayment,
  reversePayrollPayment,
  transitionPayrollPayment,
  updatePayrollPayment,
  updatePayrollResultLine,
  updatePayrollRun,
  updatePayrollRunWorker,
  type PayrollEmploymentOptionFilters,
  type PayrollRepository,
  type PayrollRunListFilters,
} from "./payrollService";

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
  taxLiabilities: unknown[];
  locks: string[];
  failAudit: boolean;
  next: Record<string, number>;
};

function now() {
  return new Date("2026-08-30T12:00:00.000Z");
}

function row<T extends Record<string, unknown>>(value: T): T {
  return value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
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
    taxLiabilities: [...state.taxLiabilities],
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
  state.taxLiabilities = snapshot.taxLiabilities;
  state.locks = snapshot.locks;
  state.failAudit = snapshot.failAudit;
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
    taxLiabilities: [],
    locks: [],
    failAudit: false,
    next: {
      legalEntity: 1,
      vendor: 1,
      worker: 1,
      employment: 1,
      payrollRun: 1,
      payrollRunWorker: 1,
      payrollResultLine: 1,
      payrollPayment: 1,
      externalRecordRef: 1,
      payrollAuditEvent: 1,
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
      .map((item) => ({ id: item.id, legalName: item.legalName, entityType: item.entityType, status: item.status })),
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
      const run = row({
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
      } satisfies PayrollRun);
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
      const worker = row({
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
      } satisfies PayrollRunWorker);
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
      const line = row({
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
      } satisfies PayrollResultLine);
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
      const payment = row({
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
      } satisfies PayrollPayment);
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
      const ref = row({
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
      } satisfies ExternalRecordRef);
      state.externalRecordRefs.push(ref);
      return ref;
    },

    createPayrollAuditEvent: async (values: InsertPayrollAuditEvent) => {
      if (state.failAudit) {
        throw new Error("audit write failed");
      }
      const event = row({
        id: state.next.payrollAuditEvent++,
        actorAdminUserId: values.actorAdminUserId,
        entityType: values.entityType,
        entityId: values.entityId,
        action: values.action,
        changesJson: values.changesJson ?? {},
        createdAt: now(),
      } satisfies PayrollAuditEvent);
      state.payrollAuditEvents.push(event);
      return event;
    },
  };
  return repo;
}

function seedLegalEntity(state: State, values: Partial<LegalEntity> = {}) {
  const entity = row({
    id: values.id ?? state.next.legalEntity++,
    legalName: values.legalName ?? `Yaotu Entity ${state.next.legalEntity}`,
    entityType: values.entityType ?? "llc",
    taxIdentifierMasked: values.taxIdentifierMasked ?? null,
    formationJurisdiction: values.formationJurisdiction ?? null,
    status: values.status ?? "active",
    createdAt: now(),
    updatedAt: now(),
  } satisfies LegalEntity);
  state.legalEntities.push(entity);
  return entity;
}

function seedVendor(state: State, values: Partial<Vendor> = {}) {
  const vendor = row({
    id: values.id ?? state.next.vendor++,
    name: values.name ?? "Payroll Provider",
    vendorType: values.vendorType ?? "payroll_provider",
    status: values.status ?? "active",
    website: values.website ?? null,
    contactEmail: values.contactEmail ?? null,
    notes: values.notes ?? null,
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } satisfies Vendor);
  state.vendors.push(vendor);
  return vendor;
}

function seedWorker(state: State, values: Partial<Worker> = {}) {
  const id = values.id ?? state.next.worker++;
  const worker = row({
    id,
    adminUserId: values.adminUserId ?? null,
    workerCode: values.workerCode ?? `W-${id}`,
    legalName: values.legalName ?? `Worker ${id}`,
    preferredName: values.preferredName ?? null,
    personnelEmail: values.personnelEmail ?? null,
    archivedAt: values.archivedAt ?? null,
    mergedIntoWorkerId: values.mergedIntoWorkerId ?? null,
    mergedAt: values.mergedAt ?? null,
    voidedAt: values.voidedAt ?? null,
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } satisfies Worker);
  state.workers.push(worker);
  return worker;
}

function seedEmployment(state: State, values: Partial<Employment> & { workerId: number; legalEntityId: number }) {
  const employment = row({
    id: values.id ?? state.next.employment++,
    workerId: values.workerId,
    legalEntityId: values.legalEntityId,
    employeeClassification: values.employeeClassification ?? "employee",
    payrollParticipation: values.payrollParticipation ?? "active",
    status: values.status ?? "active",
    startDate: values.startDate ?? "2026-01-01",
    endDate: values.endDate ?? null,
    workLocation: values.workLocation ?? null,
    primaryWorkState: values.primaryWorkState ?? null,
    primaryWorkJurisdiction: values.primaryWorkJurisdiction ?? null,
    createdBy: values.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  } satisfies Employment);
  state.employments.push(employment);
  return employment;
}

function seedPayrollRun(state: State, values: Partial<PayrollRun> & { legalEntityId: number }) {
  const run = row({
    id: values.id ?? state.next.payrollRun++,
    legalEntityId: values.legalEntityId,
    periodStart: values.periodStart ?? "2026-08-01",
    periodEnd: values.periodEnd ?? "2026-08-15",
    payDate: values.payDate ?? "2026-08-20",
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
  } satisfies PayrollRun);
  state.payrollRuns.push(run);
  return run;
}

async function assertRejectsCode(work: Promise<unknown>, code: string) {
  await assert.rejects(
    work,
    (error) => error instanceof PayrollServiceError && error.code === code,
  );
}

async function basicFinalizedRun() {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const draft = await createPayrollRun(repo, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
    runKind: "regular",
    sourceType: "manual",
    actorAdminId: 1,
  });
  const runWorker = await addPayrollRunWorker(repo, draft.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 5000,
    netPayCents: 75000,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, draft.id, 1);
  await finalizePayrollRun(repo, draft.id, 1, now());
  return { repo, entity, worker, employment, runId: draft.id, runWorkerId: runWorker.id };
}

test("worker without Admin login may appear in Payroll", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state, { adminUserId: null });
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = await createPayrollRun(repo, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
    runKind: "regular",
    sourceType: "manual",
    actorAdminId: 1,
  });

  const result = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 0,
    netPayCents: 80000,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  assert.equal(result.worker?.adminUserId, null);
  assert.equal(result.workerId, worker.id);
});

test("Payroll Worker and Employment mismatch is rejected", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const otherWorker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: otherWorker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });

  await assertRejectsCode(addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 1,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    deductionCents: 0,
    netPayCents: 1,
    sourceMetadata: {},
    actorAdminId: 1,
  }), "PAYROLL_WORKER_EMPLOYMENT_MISMATCH");
});

test("cross-Legal-Entity payroll result is rejected", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const otherEntity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: otherEntity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });

  await assertRejectsCode(addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 1,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    deductionCents: 0,
    netPayCents: 1,
    sourceMetadata: {},
    actorAdminId: 1,
  }), "PAYROLL_LEGAL_ENTITY_MISMATCH");
});

test("Work Authorization absence does not block Payroll", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });

  const result = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 50000,
    employeeTaxCents: 10000,
    employerTaxCents: 4000,
    deductionCents: 0,
    netPayCents: 40000,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  assert.equal(result.netPayCents, 40000);
});

test("Compensation changes do not mutate historical Payroll snapshots", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  const before = await getPayrollRun(repo, runId);
  repo.state.employments[0].payrollParticipation = "inactive";
  repo.state.employments[0].status = "ended";
  const after = await getPayrollRun(repo, runId);

  assert.equal(before.workers.find((item) => item.id === runWorkerId)?.grossPayCents, 100000);
  assert.equal(after.workers.find((item) => item.id === runWorkerId)?.grossPayCents, 100000);
});

test("draft Payroll Run can be edited", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const run = await createPayrollRun(repo, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
    runKind: "regular",
    sourceType: "manual",
    actorAdminId: 1,
  });

  const updated = await updatePayrollRun(repo, run.id, {
    payDate: "2026-08-21",
    notes: "Reviewed provider draft.",
    actorAdminId: 1,
  });

  assert.equal(updated.payDate, "2026-08-21");
});

test("reviewed and finalized Payroll Run edit restrictions work", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });
  await markPayrollRunReviewed(repo, run.id, 1);
  await assertRejectsCode(updatePayrollRun(repo, run.id, {
    payDate: "2026-08-21",
    actorAdminId: 1,
  }), "PAYROLL_REVIEWED_FIELD_IMMUTABLE");
  const notesOnly = await updatePayrollRun(repo, run.id, { notes: "Ready for finalization", actorAdminId: 1 });
  assert.equal(notesOnly.notes, "Ready for finalization");
  await finalizePayrollRun(repo, run.id, 1, now());
  await assertRejectsCode(updatePayrollRun(repo, run.id, { notes: "after", actorAdminId: 1 }), "PAYROLL_RUN_FINALIZED");
});

test("reviewed Payroll Run cannot silently change worker results or lines", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });
  const runWorker = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 5000,
    netPayCents: 75000,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, run.id, 1);

  await assertRejectsCode(updatePayrollRunWorker(repo, runWorker.id, {
    netPayCents: 70000,
    actorAdminId: 1,
  }), "PAYROLL_OUTPUT_LOCKED");
  await assertRejectsCode(addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "earning",
    lineCode: "REG",
    amountEffect: "increase",
    amountCents: 1000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  }), "PAYROLL_OUTPUT_LOCKED");
});

test("finalized Run worker result and lines are immutable", async () => {
  const { repo, runWorkerId } = await basicFinalizedRun();
  await assertRejectsCode(updatePayrollRunWorker(repo, runWorkerId, {
    netPayCents: 70000,
    actorAdminId: 1,
  }), "PAYROLL_OUTPUT_LOCKED");
  await assertRejectsCode(addPayrollResultLine(repo, runWorkerId, {
    lineCategory: "earning",
    lineCode: "REG",
    amountEffect: "increase",
    amountCents: 1000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  }), "PAYROLL_OUTPUT_LOCKED");
});

test("Correction Run references finalized original and preserves it", async () => {
  const { repo, entity, runId } = await basicFinalizedRun();
  const originalBefore = await getPayrollRun(repo, runId);
  const correction = await createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: runId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-31",
    sourceType: "manual",
    notes: "Correct provider snapshot.",
    actorAdminId: 1,
  });

  assert.equal(correction.runKind, "correction");
  assert.equal(correction.legalEntityId, entity.id);
  assert.equal(correction.correctionOfPayrollRunId, runId);
  assert.equal((await getPayrollRun(repo, runId)).status, originalBefore.status);
});

test("downward Correction Run is a replacement snapshot and overview does not double count it", async () => {
  const { repo, worker, employment, runId } = await basicFinalizedRun();
  const correction = await createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: runId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-31",
    sourceType: "manual",
    actorAdminId: 1,
  });
  const correctionWorker = await addPayrollRunWorker(repo, correction.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 90000,
    employeeTaxCents: 13500,
    employerTaxCents: 7200,
    deductionCents: 0,
    netPayCents: 76500,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, correctionWorker.id, {
    lineCategory: "earning",
    lineCode: "REG",
    amountEffect: "increase",
    amountCents: 90000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, correctionWorker.id, {
    lineCategory: "employee_tax",
    lineCode: "FIT",
    amountEffect: "increase",
    amountCents: 13500,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, correction.id, 1);
  await finalizePayrollRun(repo, correction.id, 1, now());

  const original = await getPayrollRun(repo, runId);
  const corrected = await getPayrollRun(repo, correction.id);
  const overview = await getPayrollOverview(repo);

  assert.equal(original.workers[0].grossPayCents, 100000);
  assert.equal(original.workers[0].netPayCents, 75000);
  assert.equal(corrected.workers[0].grossPayCents, 90000);
  assert.equal(corrected.workers[0].netPayCents, 76500);
  assert.deepEqual(overview.effectiveRuns.map((run) => run.id), [correction.id]);
  assert.equal(overview.totalsByCurrency[0].grossPayCents, 90000);
  assert.equal(overview.totalsByCurrency[0].netPayCents, 76500);
});

test("Correction Runs form a single successor chain and latest finalized snapshot is effective", async () => {
  const { repo, worker, employment, runId } = await basicFinalizedRun();
  const firstCorrection = await createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: runId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-09-01",
    sourceType: "manual",
    actorAdminId: 1,
  });
  await addPayrollRunWorker(repo, firstCorrection.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 90000,
    employeeTaxCents: 13500,
    employerTaxCents: 7200,
    deductionCents: 0,
    netPayCents: 76500,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, firstCorrection.id, 1);
  await finalizePayrollRun(repo, firstCorrection.id, 1, now());

  await assertRejectsCode(createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: runId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-09-15",
    sourceType: "manual",
    actorAdminId: 1,
  }), "PAYROLL_CORRECTION_BRANCHING_NOT_SUPPORTED");

  const secondCorrection = await createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: firstCorrection.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-09-15",
    sourceType: "manual",
    actorAdminId: 1,
  });
  await addPayrollRunWorker(repo, secondCorrection.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 95000,
    employeeTaxCents: 14250,
    employerTaxCents: 7600,
    deductionCents: 0,
    netPayCents: 80750,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, secondCorrection.id, 1);
  await finalizePayrollRun(repo, secondCorrection.id, 1, now());

  const overview = await getPayrollOverview(repo);
  assert.deepEqual(overview.effectiveRuns.map((run) => run.id), [secondCorrection.id]);
  assert.equal(overview.totalsByCurrency[0].grossPayCents, 95000);
  assert.equal(overview.totalsByCurrency[0].netPayCents, 80750);
});

test("Correction Run rejects non-finalized targets and cyclic lineage", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const draft = seedPayrollRun(repo.state, { legalEntityId: entity.id, status: "draft" });
  await assertRejectsCode(createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: draft.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-31",
    sourceType: "manual",
    actorAdminId: 1,
  }), "PAYROLL_CORRECTION_REQUIRES_FINALIZED_ORIGINAL");

  const corrupt = seedPayrollRun(repo.state, {
    legalEntityId: entity.id,
    runKind: "correction",
    correctionOfPayrollRunId: 999,
    status: "finalized",
    finalizedAt: now(),
  });
  corrupt.correctionOfPayrollRunId = corrupt.id;
  await assertRejectsCode(createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: corrupt.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-31",
    sourceType: "manual",
    actorAdminId: 1,
  }), "PAYROLL_CORRECTION_CYCLE");
});

test("increase and decrease Result Lines derive correctly", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });
  const runWorker = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 5000,
    netPayCents: 75000,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "earning",
    lineCode: "REG",
    amountEffect: "increase",
    amountCents: 100000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "earning",
    lineCode: "CORR",
    amountEffect: "decrease",
    amountCents: 10000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "employee_tax",
    lineCode: "FIT",
    amountEffect: "increase",
    amountCents: 15000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });

  const detail = await getPayrollRun(repo, run.id);
  const totals = detail.workers[0].lineTotalsByCurrency[0];
  assert.equal(totals.grossPayCents, 90000);
  assert.equal(totals.employeeTaxCents, 15000);
  assert.equal(totals.netPayImpactCents, 75000);
});

test("finalization treats aggregate payroll snapshots as authoritative over incomplete line detail", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });
  const runWorker = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 5000,
    netPayCents: 75000,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "earning",
    lineCode: "REG_PARTIAL",
    amountEffect: "increase",
    amountCents: 1000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });

  await markPayrollRunReviewed(repo, run.id, 1);
  const finalized = await finalizePayrollRun(repo, run.id, 1, now());

  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.workers[0].netPayCents, 75000);
  assert.equal(finalized.workers[0].lineTotalsByCurrency[0].netPayImpactCents, 1000);
});

test("hourly provider result can be recorded without internal timecards", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const vendor = seedVendor(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = await createPayrollRun(repo, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
    runKind: "regular",
    sourceType: "provider",
    sourceVendorId: vendor.id,
    actorAdminId: 1,
  });

  const result = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 50000,
    employeeTaxCents: 8000,
    employerTaxCents: 3500,
    deductionCents: 0,
    netPayCents: 42000,
    sourceMetadata: { providerSnapshot: "summary" },
    actorAdminId: 1,
  });

  assert.equal(result.grossPayCents, 50000);
});

test("salary provider result can be recorded without calculating from current Compensation", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id, runKind: "bonus" });

  const result = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 125000,
    employeeTaxCents: 25000,
    employerTaxCents: 9000,
    deductionCents: 0,
    netPayCents: 100000,
    sourceMetadata: { basis: "provider_salary_snapshot" },
    actorAdminId: 1,
  });

  assert.equal(result.netPayCents, 100000);
});

test("Payroll Payment can be recorded after finalization", async () => {
  const { repo, runWorkerId } = await basicFinalizedRun();
  const payment = await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    paymentDate: "2026-08-20",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });

  assert.equal(payment.status, "cleared");
});

test("pending Payroll Payment is not settled paid", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "pending",
    actorAdminId: 1,
  });

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "unpaid");
  assert.equal(summary.effectivePaidCents, 0);
  assert.equal(summary.clearedPaymentCents, 0);
  assert.equal(summary.inFlightPaymentCents, 0);
  assert.equal(summary.pendingPaymentCents, 75000);
  assert.equal(summary.remainingNetPayCents, 75000);
});

test("sent Payroll Payment is in flight and not settled paid", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "sent",
    actorAdminId: 1,
  });

  const run = await getPayrollRun(repo, runId);
  const summary = run.workers[0].paymentSummary;
  assert.equal(summary.state, "unpaid");
  assert.equal(summary.effectivePaidCents, 0);
  assert.equal(summary.clearedPaymentCents, 0);
  assert.equal(summary.inFlightPaymentCents, 75000);
  assert.equal(summary.remainingNetPayCents, 75000);
  assert.equal(run.totalsByCurrency[0].effectivePaidCents, 0);
  assert.equal(run.totalsByCurrency[0].clearedPaymentCents, 0);
  assert.equal(run.totalsByCurrency[0].inFlightPaymentCents, 75000);
});

test("cleared full Payroll Payment settles the worker result", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "paid");
  assert.equal(summary.effectivePaidCents, 75000);
  assert.equal(summary.clearedPaymentCents, 75000);
  assert.equal(summary.remainingNetPayCents, 0);
});

test("partial cleared Payroll Payment remains partially paid", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 25000,
    currency: "USD",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "partially_paid");
  assert.equal(summary.clearedPaymentCents, 25000);
  assert.equal(summary.remainingNetPayCents, 50000);
});

test("cleared Payment is historical and not freely editable", async () => {
  const { repo, runWorkerId } = await basicFinalizedRun();
  const payment = await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });

  await assertRejectsCode(updatePayrollPayment(repo, payment.id, {
    amountCents: 1,
    actorAdminId: 1,
  }), "PAYROLL_PAYMENT_HISTORICAL_IMMUTABLE");
});

test("sent Payment date cannot be rewritten during clearing", async () => {
  const { repo, runWorkerId } = await basicFinalizedRun();
  const payment = await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    paymentDate: "2026-08-20",
    methodType: "ach",
    status: "sent",
    actorAdminId: 1,
  });

  await assertRejectsCode(transitionPayrollPayment(repo, payment.id, {
    status: "cleared",
    paymentDate: "2026-08-21",
    actorAdminId: 1,
  }), "PAYROLL_PAYMENT_HISTORICAL_IMMUTABLE");
});

test("failed Payment does not imply Worker was paid", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "failed",
    actorAdminId: 1,
  });

  const detail = await getPayrollRun(repo, runId);
  assert.equal(detail.workers[0].paymentSummary.state, "failed");
  assert.equal(detail.workers[0].paymentSummary.effectivePaidCents, 0);
});

test("multiple payment attempts produce correct derived payment summary", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "failed",
    actorAdminId: 1,
  });
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "check",
    status: "cleared",
    actorAdminId: 1,
  });

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "paid");
  assert.equal(summary.failedAttemptCents, 75000);
  assert.equal(summary.effectivePaidCents, 75000);
  assert.equal(summary.clearedPaymentCents, 75000);
});

test("reversed cleared Payroll Payment no longer contributes to settled paid amount", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  const payment = await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });
  await reversePayrollPayment(repo, payment.id, 1, now());

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "unpaid");
  assert.equal(summary.effectivePaidCents, 0);
  assert.equal(summary.clearedPaymentCents, 0);
  assert.equal(summary.reversedPaymentCents, 75000);
});

test("overpaid Payroll Payment is preserved and exposed", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 80000,
    currency: "USD",
    methodType: "ach",
    status: "cleared",
    actorAdminId: 1,
  });

  const summary = (await getPayrollRun(repo, runId)).workers[0].paymentSummary;
  assert.equal(summary.state, "overpaid");
  assert.equal(summary.clearedPaymentCents, 80000);
  assert.equal(summary.remainingNetPayCents, 0);
  assert.equal(summary.overpaidNetPayCents, 5000);
});

test("Run-level payment summary derives from settled and in-flight Worker Payments", async () => {
  const { repo, runId, runWorkerId } = await basicFinalizedRun();
  await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 25000,
    currency: "USD",
    methodType: "ach",
    status: "sent",
    actorAdminId: 1,
  });

  const run = await getPayrollRun(repo, runId);
  assert.equal(run.totalsByCurrency[0].effectivePaidCents, 0);
  assert.equal(run.totalsByCurrency[0].clearedPaymentCents, 0);
  assert.equal(run.totalsByCurrency[0].inFlightPaymentCents, 25000);
  assert.equal(run.totalsByCurrency[0].unpaidNetPayCents, 75000);
});

test("currency aggregation remains separated", async () => {
  const repo = makeRepo();
  const usdEntity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const otherWorker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: usdEntity.id });
  const otherEmployment = seedEmployment(repo.state, { workerId: otherWorker.id, legalEntityId: usdEntity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: usdEntity.id });
  await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    deductionCents: 0,
    netPayCents: 100,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await addPayrollRunWorker(repo, run.id, {
    workerId: otherWorker.id,
    employmentId: otherEmployment.id,
    currency: "JPY",
    grossPayCents: 10000,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    deductionCents: 0,
    netPayCents: 10000,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  const currencies = (await getPayrollRun(repo, run.id)).totalsByCurrency.map((item) => item.currency);
  assert.deepEqual(currencies, ["JPY", "USD"]);
});

test("Payroll tax lines do not create Tax-domain records", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, { workerId: worker.id, legalEntityId: entity.id });
  const run = seedPayrollRun(repo.state, { legalEntityId: entity.id });
  const runWorker = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 20000,
    employerTaxCents: 8000,
    deductionCents: 0,
    netPayCents: 80000,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "employee_tax",
    lineCode: "FEDERAL_INCOME_TAX",
    amountEffect: "increase",
    amountCents: 12000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });
  await addPayrollResultLine(repo, runWorker.id, {
    lineCategory: "employer_tax",
    lineCode: "FICA_ER",
    amountEffect: "increase",
    amountCents: 8000,
    currency: "USD",
    metadata: {},
    actorAdminId: 1,
  });

  assert.equal(repo.state.taxLiabilities.length, 0);
});

test("admin_finance cannot read Payroll routes", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const payrollRouteBlocks = [...source.matchAll(/app\.get\(\s*["`]\/api\/admin\/finance\/payroll[\s\S]*?payrollRoute/g)];
  assert.ok(payrollRouteBlocks.length >= 5);
  for (const [block] of payrollRouteBlocks) {
    assert.match(block, /requireRole\(\['super_admin'\]\)/);
    assert.doesNotMatch(block, /admin_finance/);
  }
});

test("admin_finance cannot mutate Payroll routes", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const payrollRouteBlocks = [...source.matchAll(/app\.(post|patch|delete)\(\s*["`]\/api\/admin\/finance\/payroll[\s\S]*?payrollRoute/g)];
  assert.ok(payrollRouteBlocks.length >= 10);
  for (const [block] of payrollRouteBlocks) {
    assert.match(block, /requireRole\(\['super_admin'\]\)/);
    assert.doesNotMatch(block, /admin_finance/);
  }
});

test("broader Admin/Profile DTO does not leak Payroll", () => {
  const routesSource = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const adminUserRoute = routesSource.match(/app\.get\(\s*["`]\/api\/admin\/users\/:id["`][\s\S]*?\n  \);/);
  assert.ok(adminUserRoute);
  assert.doesNotMatch(adminUserRoute[0], /payrollRuns|payrollRunWorkers|payrollPayments|payrollResultLines|getPayroll/i);

  const profileSource = readFileSync(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(profileSource, /\/api\/admin\/finance\/payroll|payrollRuns|payrollPayments|payrollResultLines/i);
});

test("mutation and Payroll audit failure rolls back mutation", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  repo.state.failAudit = true;

  await assert.rejects(createPayrollRun(repo, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
    runKind: "regular",
    sourceType: "manual",
    actorAdminId: 1,
  }));

  assert.equal(repo.state.payrollRuns.length, 0);
  assert.equal(repo.state.payrollAuditEvents.length, 0);
});

test("external provider identifiers use external_record_refs instead of provider columns", async () => {
  const { repo, runId } = await basicFinalizedRun();
  const vendor = seedVendor(repo.state);
  const ref = await createPayrollExternalRecordRef(repo, {
    entityType: "payroll_runs",
    entityId: runId,
    sourceType: "provider",
    sourceVendorId: vendor.id,
    sourceNamespace: "payroll",
    externalRecordType: "payroll_run",
    externalRecordId: "provider-run-123",
    metadata: {},
    status: "active",
    actorAdminId: 1,
  });

  assert.equal(ref.externalRecordId, "provider-run-123");
  const schemaSource = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
  assert.doesNotMatch(schemaSource, /gusto_payroll_id|gusto_id/);
});

test("Payroll audit migration is domain-specific and service-role isolated", () => {
  const migration = readFileSync(new URL("../migrations/0022_payroll_audit_events.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "payroll_audit_events"/);
  assert.match(migration, /'payroll_run'/);
  assert.match(migration, /'payroll_run_worker'/);
  assert.match(migration, /'payroll_result_line'/);
  assert.match(migration, /'payroll_payment'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE "payroll_audit_events" FROM anon, authenticated/);
  assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE "payroll_audit_events" TO service_role/);
  assert.doesNotMatch(migration, /finance_audit_events|personnel_audit_events|tax_liabilities|tax_agency_payments/);
});

test("Employment timing allows final pay after end date when payroll period overlaps employment", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, {
    workerId: worker.id,
    legalEntityId: entity.id,
    status: "ended",
    payrollParticipation: "inactive",
    startDate: "2026-08-01",
    endDate: "2026-08-10",
  });
  const run = seedPayrollRun(repo.state, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
  });

  const result = await addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 50000,
    employeeTaxCents: 10000,
    employerTaxCents: 4000,
    deductionCents: 0,
    netPayCents: 40000,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  assert.equal(result.employment?.status, "ended");
});

test("Correction Run can reference a historically ended Employment months later", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, {
    workerId: worker.id,
    legalEntityId: entity.id,
    status: "ended",
    payrollParticipation: "inactive",
    startDate: "2026-08-01",
    endDate: "2026-08-15",
  });
  const original = seedPayrollRun(repo.state, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-22",
  });
  await addPayrollRunWorker(repo, original.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 100000,
    employeeTaxCents: 15000,
    employerTaxCents: 8000,
    deductionCents: 0,
    netPayCents: 85000,
    sourceMetadata: {},
    actorAdminId: 1,
  });
  await markPayrollRunReviewed(repo, original.id, 1);
  await finalizePayrollRun(repo, original.id, 1, now());

  const correction = await createPayrollCorrectionRun(repo, {
    correctionOfPayrollRunId: original.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-12-01",
    sourceType: "manual",
    actorAdminId: 1,
  });
  const correctionWorker = await addPayrollRunWorker(repo, correction.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 90000,
    employeeTaxCents: 13500,
    employerTaxCents: 7200,
    deductionCents: 0,
    netPayCents: 76500,
    sourceMetadata: {},
    actorAdminId: 1,
  });

  assert.equal(correctionWorker.employment?.status, "ended");
  assert.equal(correctionWorker.employment?.payrollParticipation, "inactive");
});

test("ordinary regular Payroll rejects employment outside the payroll period", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo.state);
  const worker = seedWorker(repo.state);
  const employment = seedEmployment(repo.state, {
    workerId: worker.id,
    legalEntityId: entity.id,
    status: "ended",
    payrollParticipation: "inactive",
    startDate: "2026-07-01",
    endDate: "2026-07-15",
  });
  const run = seedPayrollRun(repo.state, {
    legalEntityId: entity.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-20",
  });

  await assertRejectsCode(addPayrollRunWorker(repo, run.id, {
    workerId: worker.id,
    employmentId: employment.id,
    currency: "USD",
    grossPayCents: 50000,
    employeeTaxCents: 10000,
    employerTaxCents: 4000,
    deductionCents: 0,
    netPayCents: 40000,
    sourceMetadata: {},
    actorAdminId: 1,
  }), "PAYROLL_EMPLOYMENT_PERIOD_MISMATCH");
});

test("pending payroll payment can transition to sent and then cleared", async () => {
  const { repo, runWorkerId } = await basicFinalizedRun();
  const payment = await recordPayrollPayment(repo, runWorkerId, {
    amountCents: 75000,
    currency: "USD",
    methodType: "ach",
    status: "pending",
    actorAdminId: 1,
  });

  const sent = await transitionPayrollPayment(repo, payment.id, { status: "sent", actorAdminId: 1 });
  assert.equal(sent.status, "sent");
  const cleared = await transitionPayrollPayment(repo, payment.id, { status: "cleared", actorAdminId: 1 });
  assert.equal(cleared.status, "cleared");
});
