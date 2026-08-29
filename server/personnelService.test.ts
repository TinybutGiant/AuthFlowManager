import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PersonnelServiceError,
  activatePersonnelCompensationTerm,
  archivePersonnelWorker,
  createPersonnelCompensationTerm,
  createPersonnelEmployment,
  createPersonnelWorker,
  createPersonnelWorkerFromAdminUser,
  createWorkerPayloadSchema,
  deriveWorkerLifecycleState,
  getPersonnelForAdminUser,
  getPersonnelWorker,
  listPersonnelWorkers,
  transitionPersonnelEmployment,
  updateDraftPersonnelCompensationTerm,
  updatePersonnelEmployment,
  voidPersonnelCompensationTerm,
  voidPersonnelWorker,
  type PersonnelRepository,
} from "./personnelService";

async function assertPersonnelRejects(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(
    fn,
    (error) => error instanceof PersonnelServiceError && error.code === code,
  );
}

function baseTimestamp() {
  return new Date("2026-08-29T12:00:00.000Z");
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

interface PersonnelState {
  adminUsers: any[];
  legalEntities: any[];
  workers: any[];
  employments: any[];
  compensationTerms: any[];
  auditEvents: any[];
  locks: string[];
  failNextAudit: boolean;
  ids: {
    worker: number;
    employment: number;
    compensation: number;
    audit: number;
  };
}

function cloneState(state: PersonnelState): PersonnelState {
  return structuredClone(state);
}

function restoreState(state: PersonnelState, snapshot: PersonnelState) {
  state.adminUsers = snapshot.adminUsers;
  state.legalEntities = snapshot.legalEntities;
  state.workers = snapshot.workers;
  state.employments = snapshot.employments;
  state.compensationTerms = snapshot.compensationTerms;
  state.auditEvents = snapshot.auditEvents;
  state.locks = snapshot.locks;
  state.failNextAudit = snapshot.failNextAudit;
  state.ids = snapshot.ids;
}

function createFixture() {
  const now = baseTimestamp();
  const state: PersonnelState = {
    adminUsers: [
      {
        id: 1,
        name: "Owner Admin",
        email: "owner@yaotu.test",
        passwordHash: "secret",
        passwordSetupTokenHash: "setup-secret",
        mustChangePassword: false,
        role: "super_admin",
        accountType: "admin_staff",
        status: "active",
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        permissions: [],
      },
      {
        id: 2,
        name: "Trainee One",
        email: "trainee@yaotu.test",
        passwordHash: "secret",
        passwordSetupTokenHash: "setup-secret",
        mustChangePassword: false,
        role: "trainee_access",
        accountType: "trainee",
        status: "active",
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        permissions: [],
      },
      {
        id: 3,
        name: "Finance Admin",
        email: "finance@yaotu.test",
        passwordHash: "secret",
        passwordSetupTokenHash: "setup-secret",
        mustChangePassword: false,
        role: "admin_finance",
        accountType: "admin_staff",
        status: "active",
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        permissions: [],
      },
    ],
    legalEntities: [
      {
        id: 10,
        legalName: "Yaotu LLC",
        entityType: "llc",
        formationState: "CA",
        maskedTaxIdentifier: null,
        status: "active",
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 11,
        legalName: "Inactive LLC",
        entityType: "llc",
        formationState: "CA",
        maskedTaxIdentifier: null,
        status: "inactive",
        createdBy: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    workers: [],
    employments: [],
    compensationTerms: [],
    auditEvents: [],
    locks: [],
    failNextAudit: false,
    ids: {
      worker: 100,
      employment: 200,
      compensation: 300,
      audit: 400,
    },
  };

  const repo: PersonnelRepository = {
    transaction: async (work) => {
      const snapshot = cloneState(state);
      try {
        return await work(repo);
      } catch (error) {
        restoreState(state, snapshot);
        throw error;
      }
    },
    lockAdminUser: async (id) => { state.locks.push(`admin:${id}`); },
    lockWorker: async (id) => { state.locks.push(`worker:${id}`); },
    lockEmployment: async (id) => { state.locks.push(`employment:${id}`); },
    lockCompensationTerm: async (id) => { state.locks.push(`compensation:${id}`); },
    getAdminUser: async (id) => state.adminUsers.find((row) => row.id === id),
    listAdminUsers: async (filters) => state.adminUsers
      .filter((row) => !filters.status || filters.status === "all" || row.status === filters.status)
      .slice(0, filters.pageSize ?? 100),
    getLegalEntity: async (id) => state.legalEntities.find((row) => row.id === id),
    listLegalEntities: async () => state.legalEntities
      .filter((row) => row.status === "active")
      .map(({ id, legalName, entityType, status }) => ({ id, legalName, entityType, status })),
    getWorker: async (id) => state.workers.find((row) => row.id === id),
    getWorkerByAdminUserId: async (adminUserId) => state.workers.find((row) => row.adminUserId === adminUserId),
    getWorkerByCode: async (workerCode) => state.workers.find((row) => row.workerCode === workerCode),
    listWorkers: async (filters) => state.workers
      .filter((row) => !filters.adminUserId || row.adminUserId === filters.adminUserId)
      .filter((row) => !filters.lifecycleState || filters.lifecycleState === "all" || deriveWorkerLifecycleState(row) === filters.lifecycleState)
      .slice(0, filters.pageSize ?? 100),
    createWorker: async (values) => {
      const row = {
        id: state.ids.worker++,
        adminUserId: values.adminUserId ?? null,
        workerCode: values.workerCode,
        legalName: values.legalName,
        preferredName: values.preferredName ?? null,
        personnelEmail: values.personnelEmail ?? null,
        archivedAt: values.archivedAt ?? null,
        voidedAt: values.voidedAt ?? null,
        mergedIntoWorkerId: values.mergedIntoWorkerId ?? null,
        mergedAt: values.mergedAt ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.workers.push(row);
      return row;
    },
    updateWorker: async (id, values) => {
      const index = state.workers.findIndex((row) => row.id === id);
      if (index < 0) return undefined;
      state.workers[index] = { ...state.workers[index], ...compact(values) };
      return state.workers[index];
    },
    getEmployment: async (id) => state.employments.find((row) => row.id === id),
    listEmployments: async (filters) => state.employments
      .filter((row) => !filters.workerId || row.workerId === filters.workerId)
      .filter((row) => !filters.legalEntityId || row.legalEntityId === filters.legalEntityId)
      .filter((row) => !filters.status || filters.status === "all" || row.status === filters.status)
      .slice(0, filters.pageSize ?? 100),
    findCurrentEmploymentConflict: async (filters) => state.employments.find((row) => (
      row.workerId === filters.workerId &&
      row.legalEntityId === filters.legalEntityId &&
      ["draft", "active", "on_leave"].includes(row.status) &&
      row.id !== filters.excludeEmploymentId
    )),
    createEmployment: async (values) => {
      const row = {
        id: state.ids.employment++,
        workerId: values.workerId,
        legalEntityId: values.legalEntityId,
        employeeClassification: values.employeeClassification ?? "employee",
        payrollParticipation: values.payrollParticipation ?? "not_enrolled",
        status: values.status ?? "draft",
        startDate: values.startDate,
        endDate: values.endDate ?? null,
        workLocation: values.workLocation ?? null,
        primaryWorkState: values.primaryWorkState ?? null,
        primaryWorkJurisdiction: values.primaryWorkJurisdiction ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.employments.push(row);
      return row;
    },
    updateEmployment: async (id, values) => {
      const index = state.employments.findIndex((row) => row.id === id);
      if (index < 0) return undefined;
      state.employments[index] = { ...state.employments[index], ...compact(values) };
      return state.employments[index];
    },
    getCompensationTerm: async (id) => state.compensationTerms.find((row) => row.id === id),
    listCompensationTerms: async (filters) => state.compensationTerms
      .filter((row) => !filters.employmentId || row.employmentId === filters.employmentId)
      .filter((row) => !filters.status || filters.status === "all" || row.status === filters.status)
      .slice(0, filters.pageSize ?? 100),
    listActiveCompensationTermsForEmployment: async (employmentId) => state.compensationTerms.filter((row) => (
      row.employmentId === employmentId &&
      row.status === "active"
    )),
    createCompensationTerm: async (values) => {
      const row = {
        id: state.ids.compensation++,
        employmentId: values.employmentId,
        payBasis: values.payBasis,
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        payFrequency: values.payFrequency,
        expectedHoursPerWeek: values.expectedHoursPerWeek ?? null,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo ?? null,
        status: values.status ?? "draft",
        notes: values.notes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.compensationTerms.push(row);
      return row;
    },
    updateCompensationTerm: async (id, values) => {
      const index = state.compensationTerms.findIndex((row) => row.id === id);
      if (index < 0) return undefined;
      state.compensationTerms[index] = { ...state.compensationTerms[index], ...compact(values) };
      return state.compensationTerms[index];
    },
    createPersonnelAuditEvent: async (values) => {
      if (state.failNextAudit) {
        state.failNextAudit = false;
        throw new Error("audit failed");
      }
      const row = {
        id: state.ids.audit++,
        ...values,
        createdAt: now,
      };
      state.auditEvents.push(row);
      return row;
    },
  };

  const seedWorker = (values: Partial<any> = {}) => {
    const row = {
      id: state.ids.worker++,
      adminUserId: null,
      workerCode: `W-${state.ids.worker}`,
      legalName: "Seed Worker",
      preferredName: null,
      personnelEmail: null,
      archivedAt: null,
      voidedAt: null,
      mergedIntoWorkerId: null,
      mergedAt: null,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
    state.workers.push(row);
    return row;
  };

  const seedEmployment = (values: Partial<any> = {}) => {
    const row = {
      id: state.ids.employment++,
      workerId: values.workerId ?? seedWorker().id,
      legalEntityId: 10,
      employeeClassification: "employee",
      payrollParticipation: "not_enrolled",
      status: "draft",
      startDate: "2026-01-01",
      endDate: null,
      workLocation: null,
      primaryWorkState: null,
      primaryWorkJurisdiction: null,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
    state.employments.push(row);
    return row;
  };

  const seedCompensation = (values: Partial<any> = {}) => {
    const row = {
      id: state.ids.compensation++,
      employmentId: values.employmentId ?? seedEmployment().id,
      payBasis: "hourly",
      amountCents: 2_000,
      currency: "USD",
      payFrequency: "hourly",
      expectedHoursPerWeek: 20,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "active",
      notes: null,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
    state.compensationTerms.push(row);
    return row;
  };

  return { repo, state, seedWorker, seedEmployment, seedCompensation };
}

test("admin identities can remain separate from worker and employment records", async () => {
  const { repo, seedWorker } = createFixture();

  const adminOnly = await getPersonnelForAdminUser(repo, 1);
  assert.equal(adminOnly.adminUser.accountType, "admin_staff");
  assert.equal(adminOnly.worker, null);

  const traineeOnly = await getPersonnelForAdminUser(repo, 2);
  assert.equal(traineeOnly.adminUser.accountType, "trainee");
  assert.equal(traineeOnly.worker, null);

  const unlinkedWorker = seedWorker({ workerCode: "W-UNLINKED", legalName: "No Login Worker" });
  const workers = await listPersonnelWorkers(repo, { pageSize: 100 });
  const unlinked = workers.find((worker) => worker.id === unlinkedWorker.id)!;
  assert.equal(unlinked.adminUser, null);
  assert.equal(unlinked.currentEmployment, null);
});

test("worker creation supports admin linkage and blocks duplicate admin links", async () => {
  const { repo, state } = createFixture();

  const traineeWorker = await createPersonnelWorkerFromAdminUser(repo, {
    adminUserId: 2,
    workerCode: "W-TRAINEE",
    actorAdminId: 1,
  });
  assert.equal(traineeWorker.adminUserId, 2);
  assert.equal(traineeWorker.legalName, "Trainee One");
  assert.equal(traineeWorker.personnelEmail, "trainee@yaotu.test");

  const adminWorker = await createPersonnelWorker(repo, {
    adminUserId: 3,
    workerCode: "W-ADMIN",
    legalName: "Paid Admin",
    personnelEmail: "paid.admin@yaotu.test",
    actorAdminId: 1,
  });
  assert.equal(adminWorker.adminUser?.role, "admin_finance");

  await assertPersonnelRejects(() => createPersonnelWorker(repo, {
    adminUserId: 2,
    workerCode: "W-DUP",
    legalName: "Duplicate",
    actorAdminId: 1,
  }), "ADMIN_USER_ALREADY_LINKED");

  assert.ok(state.locks.includes("admin:2"));
  assert.ok(state.locks.includes("admin:3"));
  const schemaSource = await readFile(new URL("../shared/schema.ts", import.meta.url), "utf8");
  assert.match(schemaSource, /uniqueIndex\("idx_workers_admin_user_unique"\)[\s\S]*where\(sql`\$\{table\.adminUserId\} IS NOT NULL`\)/);
  assert.deepEqual(
    state.auditEvents.filter((event) => event.entityType === "worker").map((event) => event.action),
    ["created", "created"],
  );
});

test("employment lifecycle preserves admin and worker history and supports rehire", async () => {
  const { repo, state } = createFixture();
  const worker = await createPersonnelWorkerFromAdminUser(repo, {
    adminUserId: 2,
    workerCode: "W-EMP",
    actorAdminId: 1,
  });

  const draft = await createPersonnelEmployment(repo, {
    workerId: worker.id,
    legalEntityId: 10,
    employeeClassification: "paid_intern",
    payrollParticipation: "eligible",
    startDate: "2026-01-01",
    workLocation: "California",
    actorAdminId: 1,
  });
  assert.equal(draft.status, "draft");

  await assertPersonnelRejects(() => createPersonnelEmployment(repo, {
    workerId: worker.id,
    legalEntityId: 10,
    employeeClassification: "paid_intern",
    payrollParticipation: "eligible",
    startDate: "2026-02-01",
    actorAdminId: 1,
  }), "CURRENT_EMPLOYMENT_CONFLICT");

  assert.equal((await transitionPersonnelEmployment(repo, draft.id, "activate", { actorAdminId: 1 })).status, "active");
  assert.equal((await transitionPersonnelEmployment(repo, draft.id, "place_on_leave", { actorAdminId: 1 })).status, "on_leave");
  assert.equal((await transitionPersonnelEmployment(repo, draft.id, "return", { actorAdminId: 1 })).status, "active");
  const ended = await transitionPersonnelEmployment(repo, draft.id, "end", {
    endDate: "2026-06-30",
    actorAdminId: 1,
  });
  assert.equal(ended.status, "ended");
  assert.equal(ended.payrollParticipation, "inactive");
  assert.equal(state.adminUsers.find((admin) => admin.id === 2).status, "active");
  assert.equal(deriveWorkerLifecycleState(state.workers.find((row) => row.id === worker.id)), "normal");

  const rehire = await createPersonnelEmployment(repo, {
    workerId: worker.id,
    legalEntityId: 10,
    employeeClassification: "employee",
    payrollParticipation: "eligible",
    startDate: "2026-07-15",
    actorAdminId: 1,
  });
  assert.notEqual(rehire.id, ended.id);
  assert.equal(state.employments.length, 2);
});

test("employment updates keep committed identity fields immutable and draft voidable", async () => {
  const { repo, seedWorker, seedEmployment } = createFixture();
  const worker = seedWorker();
  const draft = seedEmployment({ workerId: worker.id, status: "draft" });

  const editedDraft = await updatePersonnelEmployment(repo, draft.id, {
    employeeClassification: "paid_intern",
    startDate: "2026-02-01",
    endDate: "2026-08-31",
    actorAdminId: 1,
  });
  assert.equal(editedDraft.employeeClassification, "paid_intern");
  assert.equal(editedDraft.endDate, "2026-08-31");

  const voided = await transitionPersonnelEmployment(repo, draft.id, "void", { actorAdminId: 1 });
  assert.equal(voided.status, "voided");
  assert.equal(voided.payrollParticipation, "inactive");

  const current = seedEmployment({ workerId: worker.id, status: "active", payrollParticipation: "eligible" });
  const payrollOnly = await updatePersonnelEmployment(repo, current.id, {
    payrollParticipation: "active",
    workLocation: "Remote",
    primaryWorkState: "CA",
    actorAdminId: 1,
  });
  assert.equal(payrollOnly.payrollParticipation, "active");
  assert.equal(payrollOnly.workLocation, "Remote");
  assert.equal(payrollOnly.primaryWorkState, "CA");
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, current.id, {
    startDate: "2026-03-01",
    actorAdminId: 1,
  }), "EMPLOYMENT_COMMITTED_FIELD_IMMUTABLE");
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, current.id, {
    legalEntityId: 10,
    actorAdminId: 1,
  }), "EMPLOYMENT_COMMITTED_FIELD_IMMUTABLE");
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, current.id, {
    employeeClassification: "paid_intern",
    actorAdminId: 1,
  }), "EMPLOYMENT_COMMITTED_FIELD_IMMUTABLE");
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, current.id, {
    endDate: "2026-05-31",
    actorAdminId: 1,
  }), "EMPLOYMENT_COMMITTED_FIELD_IMMUTABLE");

  const ended = await transitionPersonnelEmployment(repo, current.id, "end", {
    endDate: "2026-09-30",
    actorAdminId: 1,
  });
  assert.equal(ended.payrollParticipation, "inactive");
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, current.id, {
    workLocation: "Historical rewrite",
    actorAdminId: 1,
  }), "EMPLOYMENT_TERMINAL_STATE");
});

test("employment payroll participation matrix rejects impossible combinations", async () => {
  const { repo, seedWorker } = createFixture();
  const worker = seedWorker();

  await assertPersonnelRejects(() => createPersonnelEmployment(repo, {
    workerId: worker.id,
    legalEntityId: 10,
    employeeClassification: "employee",
    payrollParticipation: "active",
    startDate: "2026-01-01",
    actorAdminId: 1,
  }), "EMPLOYMENT_PAYROLL_PARTICIPATION_INVALID");

  const draft = await createPersonnelEmployment(repo, {
    workerId: worker.id,
    legalEntityId: 10,
    employeeClassification: "employee",
    payrollParticipation: "eligible",
    startDate: "2026-01-01",
    actorAdminId: 1,
  });
  await assertPersonnelRejects(() => updatePersonnelEmployment(repo, draft.id, {
    payrollParticipation: "active",
    actorAdminId: 1,
  }), "EMPLOYMENT_PAYROLL_PARTICIPATION_INVALID");

  const active = await transitionPersonnelEmployment(repo, draft.id, "activate", { actorAdminId: 1 });
  assert.equal(active.status, "active");
  const payrollActive = await updatePersonnelEmployment(repo, active.id, {
    payrollParticipation: "active",
    actorAdminId: 1,
  });
  assert.equal(payrollActive.payrollParticipation, "active");

  const leave = await transitionPersonnelEmployment(repo, active.id, "place_on_leave", { actorAdminId: 1 });
  assert.equal(leave.status, "on_leave");
  assert.equal(leave.payrollParticipation, "active");

  const ended = await transitionPersonnelEmployment(repo, active.id, "end", {
    endDate: "2026-06-30",
    actorAdminId: 1,
  });
  assert.equal(ended.status, "ended");
  assert.equal(ended.payrollParticipation, "inactive");
});

test("worker archive and void are not employment truth shortcuts", async () => {
  const { repo, seedWorker, seedEmployment } = createFixture();
  const standalone = seedWorker({ workerCode: "W-STANDALONE" });
  const voided = await voidPersonnelWorker(repo, standalone.id, 1);
  assert.equal(voided.lifecycleState, "voided");

  const worker = seedWorker({ workerCode: "W-HISTORY" });
  seedEmployment({ workerId: worker.id, status: "ended", endDate: "2026-01-31" });
  await assertPersonnelRejects(() => voidPersonnelWorker(repo, worker.id, 1), "WORKER_VOID_HAS_EMPLOYMENT_HISTORY");
  const archived = await archivePersonnelWorker(repo, worker.id, 1);
  assert.equal(archived.lifecycleState, "archived");

  const currentWorker = seedWorker({ workerCode: "W-CURRENT" });
  seedEmployment({ workerId: currentWorker.id, status: "active" });
  await assertPersonnelRejects(() => archivePersonnelWorker(repo, currentWorker.id, 1), "WORKER_ARCHIVE_HAS_CURRENT_EMPLOYMENT");
});

test("compensation terms preserve hourly salary history and reject overlaps", async () => {
  const { repo, state, seedWorker, seedEmployment } = createFixture();
  const employment = seedEmployment({ workerId: seedWorker().id, status: "active" });

  const hourly = await createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 2_000,
    currency: "USD",
    payFrequency: "hourly",
    expectedHoursPerWeek: 20,
    effectiveFrom: "2026-01-01",
    status: "active",
    actorAdminId: 1,
  });
  assert.equal(hourly.payBasis, "hourly");
  assert.equal(hourly.amountCents, 2_000);
  assert.equal(hourly.expectedHoursPerWeek, 20);
  await assertPersonnelRejects(() => updateDraftPersonnelCompensationTerm(repo, hourly.id, {
    amountCents: 2_200,
    actorAdminId: 1,
  }), "COMPENSATION_TERM_NOT_DRAFT");

  await assertPersonnelRejects(() => createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 2_200,
    currency: "USD",
    payFrequency: "hourly",
    effectiveFrom: "2026-03-01",
    status: "active",
    actorAdminId: 1,
  }), "COMPENSATION_TERM_OVERLAP");

  const salary = await createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "salary",
    amountCents: 6_000_000,
    currency: "USD",
    payFrequency: "annual",
    effectiveFrom: "2026-07-01",
    status: "active",
    supersedeCurrent: true,
    actorAdminId: 1,
  });
  assert.equal(salary.payBasis, "salary");
  assert.equal(salary.amountCents, 6_000_000);
  assert.equal(salary.payFrequency, "annual");
  const prior = state.compensationTerms.find((term) => term.id === hourly.id);
  assert.equal(prior.status, "superseded");
  assert.equal(prior.effectiveTo, "2026-06-30");
  assert.equal(state.compensationTerms.length, 2);
});

test("compensation terms use inclusive effective-through dates with adjacent changes allowed", async () => {
  const { repo, seedWorker, seedEmployment } = createFixture();
  const worker = seedWorker({ adminUserId: 2, workerCode: "W-COMP-DATES" });
  const employment = seedEmployment({ workerId: worker.id, status: "active" });

  const oldTerm = await createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 2_000,
    currency: "USD",
    payFrequency: "hourly",
    expectedHoursPerWeek: 20,
    effectiveFrom: "2020-01-01",
    effectiveTo: "2020-06-30",
    status: "active",
    actorAdminId: 1,
  });

  await assertPersonnelRejects(() => createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 2_200,
    currency: "USD",
    payFrequency: "hourly",
    effectiveFrom: "2020-06-30",
    status: "active",
    actorAdminId: 1,
  }), "COMPENSATION_TERM_OVERLAP");

  const newTerm = await createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 2_200,
    currency: "USD",
    payFrequency: "hourly",
    expectedHoursPerWeek: 20,
    effectiveFrom: "2020-07-01",
    status: "active",
    actorAdminId: 1,
  });

  const workerDetail = await getPersonnelWorker(repo, worker.id);
  assert.equal(workerDetail.currentEmployment?.currentCompensation?.id, newTerm.id);
  assert.equal(oldTerm.effectiveTo, "2020-06-30");
});

test("draft compensation corrections do not rewrite historical active terms", async () => {
  const { repo, seedWorker, seedEmployment } = createFixture();
  const employment = seedEmployment({ workerId: seedWorker().id, status: "active" });
  const draft = await createPersonnelCompensationTerm(repo, {
    employmentId: employment.id,
    payBasis: "hourly",
    amountCents: 1_800,
    currency: "USD",
    payFrequency: "hourly",
    effectiveFrom: "2026-01-01",
    status: "draft",
    actorAdminId: 1,
  });
  assert.equal(draft.status, "draft");

  const corrected = await updateDraftPersonnelCompensationTerm(repo, draft.id, {
    amountCents: 1_900,
    actorAdminId: 1,
  });
  assert.equal(corrected.amountCents, 1_900);

  const active = await activatePersonnelCompensationTerm(repo, draft.id, 1);
  assert.equal(active.status, "active");
  await assertPersonnelRejects(() => updateDraftPersonnelCompensationTerm(repo, draft.id, {
    amountCents: 2_100,
    actorAdminId: 1,
  }), "COMPENSATION_TERM_NOT_DRAFT");
  await assertPersonnelRejects(() => voidPersonnelCompensationTerm(repo, draft.id, 1), "COMPENSATION_VOID_REQUIRES_DRAFT");
});

test("personnel mutation rolls back when audit insert fails", async () => {
  const { repo, state } = createFixture();
  state.failNextAudit = true;

  await assert.rejects(() => createPersonnelWorker(repo, {
    workerCode: "W-ROLLBACK",
    legalName: "Rollback Person",
    actorAdminId: 1,
  }));

  assert.equal(state.workers.length, 0);
  assert.equal(state.auditEvents.length, 0);
});

test("personnel audit records only sanitized field deltas", async () => {
  const { repo, state } = createFixture();

  await createPersonnelWorkerFromAdminUser(repo, {
    adminUserId: 2,
    workerCode: "W-AUDIT",
    actorAdminId: 1,
  });

  const serialized = JSON.stringify(state.auditEvents);
  for (const forbidden of [
    "passwordHash",
    "passwordSetupTokenHash",
    "ssn",
    "bankAccount",
    "passport",
    "i94",
    "uscis",
    "alienNumber",
    "actorAdminId",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in personnel audit changes`);
  }
  assert.deepEqual(
    Object.keys(state.auditEvents[0].changesJson).sort(),
    ["adminUserId", "legalName", "personnelEmail", "workerCode"],
  );
});

test("personnel response DTO omits auth secrets and future sensitive fields", async () => {
  const { repo } = createFixture();
  const worker = await createPersonnelWorkerFromAdminUser(repo, {
    adminUserId: 2,
    workerCode: "W-SAFE",
    actorAdminId: 1,
  });

  const serialized = JSON.stringify(worker);
  for (const forbidden of [
    "passwordHash",
    "passwordSetupTokenHash",
    "ssn",
    "bankAccount",
    "passport",
    "i94",
    "uscis",
    "alienNumber",
    "workAuthorizations",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in personnel DTO`);
  }
});

test("personnel routes are super-admin-only and do not introduce work authorization APIs", async () => {
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const personnelRoutes = [
    "/api/admin/personnel/admin-users",
    "/api/admin/personnel/admin-users/:adminUserId",
    "/api/admin/personnel/legal-entities",
    "/api/admin/personnel/workers",
    "/api/admin/personnel/workers/:workerId",
    "/api/admin/personnel/workers/from-admin-user",
    "/api/admin/personnel/workers/:workerId/archive",
    "/api/admin/personnel/workers/:workerId/void",
    "/api/admin/personnel/employments",
    "/api/admin/personnel/employments/:employmentId/activate",
    "/api/admin/personnel/employments/:employmentId/place-on-leave",
    "/api/admin/personnel/employments/:employmentId/return",
    "/api/admin/personnel/employments/:employmentId/end",
    "/api/admin/personnel/employments/:employmentId/void",
    "/api/admin/personnel/employments/:employmentId/compensation",
    "/api/admin/personnel/compensation-terms",
    "/api/admin/personnel/compensation-terms/:termId",
    "/api/admin/personnel/compensation-terms/:termId/activate",
    "/api/admin/personnel/compensation-terms/:termId/void",
  ];

  for (const route of personnelRoutes) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      routesSource,
      new RegExp(`["']${escapedRoute}["'][\\s\\S]*?requireAuth,[\\s\\S]*?requireRole\\(\\['super_admin'\\]\\)`),
      `${route} must require super_admin`,
    );
  }
  assert.doesNotMatch(routesSource, /\/api\/admin\/personnel\/(?:work-authorizations|stem-opt|h-1b|h1b|payroll|tax)/i);
  assert.doesNotMatch(routesSource, /\/api\/admin\/finance\/.*compensation/i);
});

test("admin profile compensation summary uses only the restricted personnel API", async () => {
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const profileSource = await readFile(
    new URL("../client/src/pages/AdminProfile.tsx", import.meta.url),
    "utf8",
  );

  assert.match(profileSource, /queryKey:\s*\["\/api\/admin\/personnel\/admin-users", adminId\]/);
  assert.match(profileSource, /currentCompensation/);
  const adminProfileRoute = routesSource.match(/app\.get\("\/api\/admin\/users\/:id"[\s\S]*?res\.json\(await serializeAdminUser\(admin\)\);[\s\S]*?\n\s*\}\);/);
  assert.ok(adminProfileRoute, "admin profile route should be present");
  assert.doesNotMatch(adminProfileRoute[0], /getPersonnelForAdminUser|currentCompensation|compensationTerms/);
  assert.match(
    routesSource,
    /"\/api\/admin\/personnel\/admin-users\/:adminUserId"[\s\S]*?requireRole\(\['super_admin'\]\)/,
  );
});

test("personnel audit migration is domain-specific and service-role isolated", async () => {
  const migration = await readFile(
    new URL("../migrations/0020_personnel_audit_events.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "personnel_audit_events"/);
  for (const entityType of ["worker", "employment", "compensation_term"]) {
    assert.match(migration, new RegExp(`'${entityType}'`));
  }
  assert.doesNotMatch(migration, /finance_audit_events|work_authorization|stem_opt|h1b|payroll_runs|tax_liabilities/i);
  assert.match(migration, /ALTER TABLE "personnel_audit_events" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE "personnel_audit_events" FROM anon, authenticated/);
  assert.match(migration, /AS RESTRICTIVE/);
  assert.match(migration, /USING \(false\)/);
  assert.match(migration, /WITH CHECK \(false\)/);
});

test("worker payload rejects employment and work authorization identity leakage", () => {
  assert.equal(createWorkerPayloadSchema.safeParse({
    workerCode: "W-BAD",
    legalName: "Bad Worker",
    employmentStatus: "active",
  }).success, false);
  assert.equal(createWorkerPayloadSchema.safeParse({
    workerCode: "W-BAD",
    legalName: "Bad Worker",
    workAuthorizationType: "stem_opt",
  }).success, false);
});

test("personnel UI stays within Worker Employment Compensation scope", async () => {
  const pageSource = await readFile(
    new URL("../client/src/pages/PersonnelManagement.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /Worker/);
  assert.match(pageSource, /Employment/);
  assert.match(pageSource, /Compensation/);
  assert.doesNotMatch(pageSource, /Work Authorization|STEM OPT|H-1B|H1B|passport|I-94|USCIS|Social Security/i);
});
