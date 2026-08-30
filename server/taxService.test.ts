import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TaxServiceError,
  createTaxAgency,
  createTaxFiling,
  createTaxFilingAmendment,
  createTaxFilingAmendmentPayloadSchema,
  createTaxLiability,
  createTaxLiabilityAdjustment,
  createTaxRegistration,
  getTaxFiling,
  getTaxLiability,
  getTaxOverview,
  listTaxFilings,
  listTaxLiabilities,
  transitionTaxFiling,
  transitionTaxLiability,
  transitionTaxRegistration,
  updateTaxFiling,
  updateTaxLiability,
  updateTaxRegistration,
  type TaxAgencyListFilters,
  type TaxFilingListFilters,
  type TaxLiabilityListFilters,
  type TaxRegistrationOverlapCandidate,
  type TaxRegistrationListFilters,
  type TaxRepository,
} from "./taxService";

type TaxState = {
  legalEntities: any[];
  vendors: any[];
  taxAgencies: any[];
  taxRegistrations: any[];
  taxLiabilities: any[];
  taxFilings: any[];
  externalRecordRefs: any[];
  taxAuditEvents: any[];
  locks: string[];
  failAudit: boolean;
  ids: Record<string, number>;
};

function now() {
  return new Date("2026-08-30T12:00:00.000Z");
}

function dateOnly(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function openRangeStart(value: unknown) {
  return dateOnly(value) ?? "0001-01-01";
}

function openRangeEnd(value: unknown) {
  return dateOnly(value) ?? "9999-12-31";
}

function dateRangesOverlap(left: { effectiveFrom?: unknown; effectiveTo?: unknown }, right: { effectiveFrom?: unknown; effectiveTo?: unknown }) {
  return openRangeStart(left.effectiveFrom) <= openRangeEnd(right.effectiveTo)
    && openRangeStart(right.effectiveFrom) <= openRangeEnd(left.effectiveTo);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function cloneState(state: TaxState): TaxState {
  return structuredClone(state);
}

function restoreState(state: TaxState, snapshot: TaxState) {
  state.legalEntities = snapshot.legalEntities;
  state.vendors = snapshot.vendors;
  state.taxAgencies = snapshot.taxAgencies;
  state.taxRegistrations = snapshot.taxRegistrations;
  state.taxLiabilities = snapshot.taxLiabilities;
  state.taxFilings = snapshot.taxFilings;
  state.externalRecordRefs = snapshot.externalRecordRefs;
  state.taxAuditEvents = snapshot.taxAuditEvents;
  state.locks = snapshot.locks;
  state.failAudit = snapshot.failAudit;
  state.ids = snapshot.ids;
}

function makeState(): TaxState {
  return {
    legalEntities: [],
    vendors: [],
    taxAgencies: [],
    taxRegistrations: [],
    taxLiabilities: [],
    taxFilings: [],
    externalRecordRefs: [],
    taxAuditEvents: [],
    locks: [],
    failAudit: false,
    ids: {
      legalEntity: 1,
      vendor: 1,
      taxAgency: 1,
      taxRegistration: 1,
      taxLiability: 1,
      taxFiling: 1,
      externalRecordRef: 1,
      taxAuditEvent: 1,
    },
  };
}

function makeRepo(state = makeState()): TaxRepository & { state: TaxState } {
  const repo: TaxRepository & { state: TaxState } = {
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
    lockLegalEntity: async (id) => { state.locks.push(`legal_entity:${id}`); },
    lockTaxAgency: async (id) => { state.locks.push(`tax_agency:${id}`); },
    lockTaxRegistration: async (id) => { state.locks.push(`tax_registration:${id}`); },
    lockTaxLiability: async (id) => { state.locks.push(`tax_liability:${id}`); },
    lockTaxLiabilityAdjustments: async (id) => { state.locks.push(`tax_liability_adjustments:${id}`); },
    lockTaxFiling: async (id) => { state.locks.push(`tax_filing:${id}`); },

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

    getTaxAgency: async (id) => state.taxAgencies.find((item) => item.id === id),
    listTaxAgencies: async (filters: TaxAgencyListFilters) => state.taxAgencies
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .slice(0, filters.pageSize ?? 100),
    createTaxAgency: async (values) => {
      const agency = {
        id: state.ids.taxAgency++,
        agencyCode: values.agencyCode,
        name: values.name,
        jurisdictionType: values.jurisdictionType,
        jurisdictionCode: values.jurisdictionCode,
        status: values.status ?? "active",
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxAgencies.push(agency);
      return agency as any;
    },
    updateTaxAgency: async (id, values) => {
      const existing = state.taxAgencies.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getTaxRegistration: async (id) => state.taxRegistrations.find((item) => item.id === id),
    listTaxRegistrations: async (filters: TaxRegistrationListFilters) => state.taxRegistrations
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.legalEntityId || item.legalEntityId === filters.legalEntityId)
      .filter((item) => !filters.taxAgencyId || item.taxAgencyId === filters.taxAgencyId)
      .slice(0, filters.pageSize ?? 100),
    listOverlappingTaxRegistrations: async (input: TaxRegistrationOverlapCandidate) => state.taxRegistrations
      .filter((item) => item.status !== "closed")
      .filter((item) => !input.excludeRegistrationId || item.id !== input.excludeRegistrationId)
      .filter((item) => item.legalEntityId === input.legalEntityId)
      .filter((item) => item.taxAgencyId === input.taxAgencyId)
      .filter((item) => item.taxType === input.taxType)
      .filter((item) => item.jurisdictionType === input.jurisdictionType)
      .filter((item) => item.jurisdictionCode === input.jurisdictionCode.toUpperCase())
      .filter((item) => dateRangesOverlap(item, input)),
    createTaxRegistration: async (values) => {
      const registration = {
        id: state.ids.taxRegistration++,
        legalEntityId: values.legalEntityId,
        taxAgencyId: values.taxAgencyId,
        taxType: values.taxType,
        jurisdictionType: values.jurisdictionType,
        jurisdictionCode: values.jurisdictionCode,
        maskedAccountRef: values.maskedAccountRef ?? null,
        effectiveFrom: values.effectiveFrom ?? null,
        effectiveTo: values.effectiveTo ?? null,
        status: values.status ?? "pending",
        notes: values.notes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxRegistrations.push(registration);
      return registration as any;
    },
    updateTaxRegistration: async (id, values) => {
      const existing = state.taxRegistrations.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },
    registrationHasTaxFacts: async (id) => (
      state.taxLiabilities.some((item) => item.taxRegistrationId === id)
      || state.taxFilings.some((item) => item.taxRegistrationId === id)
    ),

    getTaxLiability: async (id) => state.taxLiabilities.find((item) => item.id === id),
    listTaxLiabilities: async (filters: TaxLiabilityListFilters) => state.taxLiabilities
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.taxRegistrationId || item.taxRegistrationId === filters.taxRegistrationId)
      .slice(0, filters.pageSize ?? 100),
    listTaxLiabilityAdjustments: async (taxLiabilityId) => state.taxLiabilities
      .filter((item) => item.adjustsTaxLiabilityId === taxLiabilityId),
    createTaxLiability: async (values) => {
      const liability = {
        id: state.ids.taxLiability++,
        taxRegistrationId: values.taxRegistrationId,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        dueDate: values.dueDate ?? null,
        component: values.component,
        amountEffect: values.amountEffect ?? "increase",
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        sourceType: values.sourceType ?? "manual",
        sourceMetadata: values.sourceMetadata ?? {},
        adjustsTaxLiabilityId: values.adjustsTaxLiabilityId ?? null,
        status: values.status ?? "draft",
        recognizedAt: values.recognizedAt ?? null,
        notes: values.notes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxLiabilities.push(liability);
      return liability as any;
    },
    updateTaxLiability: async (id, values) => {
      const existing = state.taxLiabilities.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getTaxFiling: async (id) => state.taxFilings.find((item) => item.id === id),
    listTaxFilings: async (filters: TaxFilingListFilters) => state.taxFilings
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.taxRegistrationId || item.taxRegistrationId === filters.taxRegistrationId)
      .slice(0, filters.pageSize ?? 100),
    findOriginalTaxFiling: async (input) => state.taxFilings.find((item) => (
      item.taxRegistrationId === input.taxRegistrationId
      && item.filingType === input.filingType
      && item.periodStart === input.periodStart
      && item.periodEnd === input.periodEnd
      && item.amendsTaxFilingId === null
      && item.status !== "voided"
    )),
    findTaxFilingAmendmentSuccessor: async (taxFilingId) => state.taxFilings.find(
      (item) => item.amendsTaxFilingId === taxFilingId && item.status !== "voided",
    ),
    createTaxFiling: async (values) => {
      const filing = {
        id: state.ids.taxFiling++,
        taxRegistrationId: values.taxRegistrationId,
        filingType: values.filingType,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        dueDate: values.dueDate ?? null,
        filedAt: values.filedAt ?? null,
        acceptedAt: values.acceptedAt ?? null,
        confirmationRef: values.confirmationRef ?? null,
        amendsTaxFilingId: values.amendsTaxFilingId ?? null,
        status: values.status ?? "draft",
        notes: values.notes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxFilings.push(filing);
      return filing as any;
    },
    updateTaxFiling: async (id, values) => {
      const existing = state.taxFilings.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getExternalRecordRef: async (id) => state.externalRecordRefs.find((item) => item.id === id),
    listExternalRecordRefsForEntity: async (entityType, entityId) => state.externalRecordRefs.filter((item) => (
      item.entityType === entityType && item.entityId === entityId
    )),
    createExternalRecordRef: async (values) => {
      const ref = {
        id: state.ids.externalRecordRef++,
        ...values,
        sourceVendorId: values.sourceVendorId ?? null,
        importedAt: values.importedAt ?? null,
        payloadHash: values.payloadHash ?? null,
        metadata: values.metadata ?? {},
        status: values.status ?? "active",
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.externalRecordRefs.push(ref);
      return ref as any;
    },

    createTaxAuditEvent: async (values) => {
      if (state.failAudit) throw new Error("audit insert failed");
      const event = {
        id: state.ids.taxAuditEvent++,
        ...values,
        changesJson: values.changesJson ?? {},
        createdAt: now(),
      };
      state.taxAuditEvents.push(event);
      return event as any;
    },
  };

  return repo;
}

function seedLegalEntity(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const entity = {
    id: repo.state.ids.legalEntity++,
    legalName: "Yaotu LLC",
    entityType: "llc",
    formationState: "CA",
    maskedTaxIdentifier: null,
    status: "active",
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.legalEntities.push(entity);
  return entity;
}

function seedVendor(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const vendor = {
    id: repo.state.ids.vendor++,
    name: "Gusto",
    vendorType: "payroll_provider",
    status: "active",
    website: null,
    contactEmail: null,
    notes: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.vendors.push(vendor);
  return vendor;
}

function seedTaxAgency(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const agency = {
    id: repo.state.ids.taxAgency++,
    agencyCode: "IRS",
    name: "Internal Revenue Service",
    jurisdictionType: "federal",
    jurisdictionCode: "US",
    status: "active",
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxAgencies.push(agency);
  return agency;
}

function seedRegistration(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const legalEntityId = values.legalEntityId ?? seedLegalEntity(repo).id;
  const taxAgencyId = values.taxAgencyId ?? seedTaxAgency(repo).id;
  const registration = {
    id: repo.state.ids.taxRegistration++,
    legalEntityId,
    taxAgencyId,
    taxType: "federal_withholding",
    jurisdictionType: "federal",
    jurisdictionCode: "US",
    maskedAccountRef: "****1234",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    status: "active",
    notes: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxRegistrations.push(registration);
  return registration;
}

function seedLiability(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const taxRegistrationId = values.taxRegistrationId ?? seedRegistration(repo).id;
  const status = String(values.status ?? "draft");
  const liability = {
    id: repo.state.ids.taxLiability++,
    taxRegistrationId,
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    dueDate: "2026-07-31",
    component: "withholding",
    amountEffect: "increase",
    amountCents: 10_626,
    currency: "USD",
    sourceType: "manual",
    sourceMetadata: {},
    adjustsTaxLiabilityId: null,
    status,
    recognizedAt: status === "recognized" || status === "disputed" ? now() : null,
    notes: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxLiabilities.push(liability);
  return liability;
}

function seedFiling(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const taxRegistrationId = values.taxRegistrationId ?? seedRegistration(repo).id;
  const filing = {
    id: repo.state.ids.taxFiling++,
    taxRegistrationId,
    filingType: "941",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    dueDate: "2026-07-31",
    filedAt: null,
    acceptedAt: null,
    confirmationRef: null,
    amendsTaxFilingId: null,
    status: "draft",
    notes: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxFilings.push(filing);
  return filing;
}

async function assertTaxRejects(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(
    fn,
    (error) => error instanceof TaxServiceError && error.code === code,
  );
}

function taxBlock() {
  const routes = readFileSync("server/routes.ts", "utf8");
  return routes.slice(
    routes.indexOf("// Finance / Tax routes"),
    routes.indexOf("// Finance / AP and subscription routes"),
  );
}

function taxLiabilitiesSchemaBlock() {
  const schema = readFileSync("shared/schema.ts", "utf8");
  return schema.slice(
    schema.indexOf("export const taxLiabilities"),
    schema.indexOf("export const taxAgencyPayments"),
  );
}

test("tax agencies are distinct from vendors", async () => {
  const repo = makeRepo();
  const vendor = seedVendor(repo);
  const agency = await createTaxAgency(repo, {
    agencyCode: "CA-EDD",
    name: "California Employment Development Department",
    jurisdictionType: "state",
    jurisdictionCode: "ca",
    status: "active",
    actorAdminId: 7,
  });

  assert.notEqual(agency.id, vendor.id + 10_000);
  assert.equal(repo.state.vendors.length, 1);
  assert.equal(repo.state.taxAgencies.length, 1);
  assert.equal(repo.state.taxAgencies[0].name, "California Employment Development Department");
});

test("tax registration belongs to legal entity plus tax agency", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo, { legalName: "Yaotu Travel LLC" });
  const agency = seedTaxAgency(repo);

  const registration = await createTaxRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    taxType: "federal_withholding",
    jurisdictionType: "federal",
    jurisdictionCode: "us",
    status: "active",
    maskedAccountRef: "****9999",
    actorAdminId: 7,
  });

  assert.equal(registration?.legalEntity?.legalName, "Yaotu Travel LLC");
  assert.equal(registration?.taxAgency?.name, "Internal Revenue Service");
  assert.equal(registration?.jurisdictionCode, "US");
});

test("current tax registrations cannot overlap for the same legal entity agency type and jurisdiction", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo);
  const agency = seedTaxAgency(repo);

  await createTaxRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    taxType: "federal_withholding",
    jurisdictionType: "federal",
    jurisdictionCode: "us",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    status: "active",
    actorAdminId: 7,
  });

  await assertTaxRejects(
    () => createTaxRegistration(repo, {
      legalEntityId: entity.id,
      taxAgencyId: agency.id,
      taxType: "federal_withholding",
      jurisdictionType: "federal",
      jurisdictionCode: "US",
      effectiveFrom: "2026-06-30",
      effectiveTo: "2026-12-31",
      status: "active",
      actorAdminId: 7,
    }),
    "TAX_REGISTRATION_OVERLAP",
  );

  const successor = await createTaxRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    taxType: "federal_withholding",
    jurisdictionType: "federal",
    jurisdictionCode: "US",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    status: "active",
    actorAdminId: 7,
  });
  assert.equal(successor?.effectiveFrom, "2026-07-01");
});

test("closed historical tax registrations do not block a sequential successor", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo);
  const agency = seedTaxAgency(repo);
  seedRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    status: "closed",
  });

  const successor = await createTaxRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    taxType: "federal_withholding",
    jurisdictionType: "federal",
    jurisdictionCode: "US",
    effectiveFrom: "2026-07-01",
    status: "active",
    actorAdminId: 7,
  });

  assert.equal(successor?.status, "active");
});

test("activating a tax registration rejects current overlap", async () => {
  const repo = makeRepo();
  const entity = seedLegalEntity(repo);
  const agency = seedTaxAgency(repo);
  seedRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    status: "active",
  });
  const pending = seedRegistration(repo, {
    legalEntityId: entity.id,
    taxAgencyId: agency.id,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    status: "pending",
  });

  await assertTaxRejects(
    () => transitionTaxRegistration(repo, pending.id, { status: "active", actorAdminId: 7 }),
    "TAX_REGISTRATION_OVERLAP",
  );
});

test("closed tax registration is historical and preserves liabilities and filings", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo, { effectiveTo: "2026-06-30" });
  seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized" });
  seedFiling(repo, { taxRegistrationId: registration.id, status: "filed", filedAt: now() });

  const closed = await transitionTaxRegistration(repo, registration.id, { status: "closed", actorAdminId: 7 });

  assert.equal(closed?.status, "closed");
  assert.equal(repo.state.taxLiabilities.length, 1);
  assert.equal(repo.state.taxFilings.length, 1);
  const backfilled = await createTaxLiability(repo, {
    taxRegistrationId: registration.id,
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    component: "withholding",
    amountCents: 1_000,
    actorAdminId: 7,
  });
  assert.equal(backfilled.periodEnd, "2026-06-30");

  await assertTaxRejects(
    () => createTaxLiability(repo, {
      taxRegistrationId: registration.id,
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      component: "withholding",
      amountCents: 1_000,
      actorAdminId: 7,
    }),
    "TAX_REGISTRATION_PERIOD_OUT_OF_RANGE",
  );
});

test("tax liability schema does not store payroll run identity", () => {
  assert.doesNotMatch(taxLiabilitiesSchemaBlock(), /payrollRunId|payroll_run_id|payrollRuns/);
  const migration = readFileSync("migrations/0017_finance_personnel_payroll_tax_foundation.sql", "utf8");
  const liabilityMigrationBlock = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS "tax_liabilities"'),
    migration.indexOf('CREATE TABLE IF NOT EXISTS "tax_agency_payments"'),
  );
  assert.doesNotMatch(liabilityMigrationBlock, /payroll_run_id|payroll_runs/);
});

test("payroll service does not create tax liabilities during payroll finalization", () => {
  const payrollService = readFileSync("server/payrollService.ts", "utf8");
  assert.doesNotMatch(payrollService, /createTaxLiability|taxLiabilities|tax_liabilities|taxRegistrations/);
});

test("draft tax liability can be edited before recognition", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = await createTaxLiability(repo, {
    taxRegistrationId: registration.id,
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    dueDate: "2026-07-31",
    component: "withholding",
    amountCents: 10_000,
    actorAdminId: 7,
  });

  const updated = await updateTaxLiability(repo, liability.id, {
    amountCents: 10_626,
    dueDate: "2026-08-15",
    notes: "Adjusted before recognition",
    actorAdminId: 7,
  });

  assert.equal(updated.amountCents, 10_626);
  assert.equal(updated.dueDate, "2026-08-15");
});

test("recognized tax liability cannot rewrite historical facts", async () => {
  const repo = makeRepo();
  const liability = seedLiability(repo, { status: "draft" });
  await transitionTaxLiability(repo, liability.id, { status: "recognized", actorAdminId: 7 }, now());

  await assertTaxRejects(
    () => updateTaxLiability(repo, liability.id, { amountCents: 12_000, actorAdminId: 7 }),
    "TAX_LIABILITY_HISTORICAL_IMMUTABLE",
  );

  const updated = await updateTaxLiability(repo, liability.id, { notes: "Reviewed by accountant", actorAdminId: 7 });
  assert.equal(updated.notes, "Reviewed by accountant");
});

test("tax liability payment state is not stored in V1", async () => {
  const repo = makeRepo();
  const liability = seedLiability(repo, { status: "recognized" });
  const response = await getTaxLiability(repo, liability.id, "2026-08-30");

  assert.doesNotMatch(taxLiabilitiesSchemaBlock(), /paymentStatus|payment_status|paid|unpaid|partially_paid/);
  assert.equal(response.paymentTrackingStatus, "not_yet_tracked");
});

test("increase adjustment raises effective liability after recognition", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 10_600 });
  const adjustment = await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "increase",
    amountCents: 26,
    actorAdminId: 7,
  });
  await transitionTaxLiability(repo, adjustment.id, { status: "recognized", actorAdminId: 7 }, now());

  const response = await getTaxLiability(repo, base.id, "2026-08-30");
  assert.equal(response.effectiveAmountCents, 10_626);
  assert.equal(response.adjustmentCount, 1);
});

test("decrease adjustment lowers effective liability after recognition", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 10_626 });
  const adjustment = await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "decrease",
    amountCents: 26,
    actorAdminId: 7,
  });
  await transitionTaxLiability(repo, adjustment.id, { status: "recognized", actorAdminId: 7 }, now());

  const response = await getTaxLiability(repo, base.id, "2026-08-30");
  assert.equal(response.effectiveAmountCents, 10_600);
});

test("effective liability math includes recognized and disputed rows but excludes draft and voided rows", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 10_000 });
  seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "increase",
    amountCents: 2_000,
    status: "draft",
  });
  seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "increase",
    amountCents: 600,
    status: "disputed",
  });
  seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "decrease",
    amountCents: 250,
    status: "recognized",
  });
  seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "decrease",
    amountCents: 9_999,
    status: "voided",
  });
  seedLiability(repo, { status: "draft", amountCents: 5_000 });

  const overview = await getTaxOverview(repo, "2026-08-30");

  assert.deepEqual(overview.effectiveLiabilityTotalsByCurrency, [
    { currency: "USD", amountCents: 10_350, liabilityCount: 1 },
  ]);
});

test("decrease adjustment cannot make effective liability negative", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 1_000 });

  await assertTaxRejects(
    () => createTaxLiabilityAdjustment(repo, base.id, {
      amountEffect: "decrease",
      amountCents: 1_001,
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_EFFECTIVE_AMOUNT_NEGATIVE",
  );

  const zero = await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "decrease",
    amountCents: 1_000,
    actorAdminId: 7,
  });
  assert.equal(zero.amountCents, 1_000);
});

test("recognizing stale draft adjustments rechecks the locked persisted adjustment set", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 1_000 });
  const largeDraft = await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "decrease",
    amountCents: 900,
    actorAdminId: 7,
  });
  const secondDraft = await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "decrease",
    amountCents: 200,
    actorAdminId: 7,
  });
  repo.state.locks = [];

  await transitionTaxLiability(repo, largeDraft.id, { status: "recognized", actorAdminId: 7 }, now());
  await assertTaxRejects(
    () => transitionTaxLiability(repo, secondDraft.id, { status: "recognized", actorAdminId: 7 }, now()),
    "TAX_LIABILITY_EFFECTIVE_AMOUNT_NEGATIVE",
  );

  assert.deepEqual(repo.state.locks.slice(-2), [
    `tax_liability:${base.id}`,
    `tax_liability_adjustments:${base.id}`,
  ]);
});

test("adjustment creation locks and re-reads the base adjustment set before validation", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 1_000 });

  await createTaxLiabilityAdjustment(repo, base.id, {
    amountEffect: "decrease",
    amountCents: 100,
    actorAdminId: 7,
  });

  assert.deepEqual(repo.state.locks.slice(-2), [
    `tax_liability:${base.id}`,
    `tax_liability_adjustments:${base.id}`,
  ]);
});

test("cross-registration liability adjustments are rejected", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized" });
  const otherRegistration = seedRegistration(repo);

  await assertTaxRejects(
    () => createTaxLiabilityAdjustment(repo, base.id, {
      taxRegistrationId: otherRegistration.id,
      amountEffect: "increase",
      amountCents: 1,
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_ADJUSTMENT_REGISTRATION_MISMATCH",
  );
});

test("liability adjustment chains and cycles are rejected", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized" });
  const adjustment = seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "increase",
    amountCents: 5,
    status: "recognized",
  });

  await assertTaxRejects(
    () => createTaxLiabilityAdjustment(repo, adjustment.id, {
      amountEffect: "increase",
      amountCents: 1,
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_ADJUSTMENT_CHAIN_NOT_SUPPORTED",
  );

  const cycle = seedLiability(repo, { status: "recognized" });
  cycle.adjustsTaxLiabilityId = cycle.id;
  await assertTaxRejects(
    () => createTaxLiabilityAdjustment(repo, cycle.id, {
      amountEffect: "decrease",
      amountCents: 1,
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_ADJUSTMENT_CYCLE",
  );
});

test("voided liabilities cannot be adjustment bases", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "voided" });

  await assertTaxRejects(
    () => createTaxLiabilityAdjustment(repo, base.id, {
      amountEffect: "increase",
      amountCents: 1,
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_ADJUSTMENT_TARGET_VOIDED",
  );
});

test("effective liability totals count base plus adjustments once", async () => {
  const repo = makeRepo();
  const base = seedLiability(repo, { status: "recognized", amountCents: 10_626 });
  seedLiability(repo, {
    taxRegistrationId: base.taxRegistrationId,
    adjustsTaxLiabilityId: base.id,
    amountEffect: "decrease",
    amountCents: 26,
    status: "recognized",
  });

  const overview = await getTaxOverview(repo, "2026-08-30");
  assert.deepEqual(overview.effectiveLiabilityTotalsByCurrency, [
    { currency: "USD", amountCents: 10_600, liabilityCount: 1 },
  ]);
});

test("effective liability totals stay separated by currency", async () => {
  const repo = makeRepo();
  seedLiability(repo, { status: "recognized", amountCents: 10_000, currency: "USD" });
  seedLiability(repo, { status: "recognized", amountCents: 20_000, currency: "CAD" });

  const overview = await getTaxOverview(repo, "2026-08-30");
  assert.deepEqual(overview.effectiveLiabilityTotalsByCurrency, [
    { currency: "CAD", amountCents: 20_000, liabilityCount: 1 },
    { currency: "USD", amountCents: 10_000, liabilityCount: 1 },
  ]);
});

test("tax filing lifecycle rejects invalid jumps and permits rejected to ready", async () => {
  const repo = makeRepo();
  const filing = seedFiling(repo, { status: "draft" });

  await assertTaxRejects(
    () => transitionTaxFiling(repo, filing.id, { status: "accepted", actorAdminId: 7 }, now()),
    "TAX_FILING_TRANSITION_INVALID",
  );
  await transitionTaxFiling(repo, filing.id, { status: "ready", actorAdminId: 7 }, now());
  await transitionTaxFiling(repo, filing.id, {
    status: "filed",
    confirmationRef: "IRS-941-2026Q2",
    actorAdminId: 7,
  }, now());
  await transitionTaxFiling(repo, filing.id, { status: "rejected", notes: "Correct EIN", actorAdminId: 7 }, now());
  const readyAgain = await transitionTaxFiling(repo, filing.id, { status: "ready", actorAdminId: 7 }, now());

  assert.equal(readyAgain.status, "ready");
  assert.equal(readyAgain.filedAt, null);
  assert.equal(readyAgain.acceptedAt, null);
  assert.equal(readyAgain.confirmationRef, null);
});

test("filed tax filing protects historical fields and confirmation reference", async () => {
  const repo = makeRepo();
  const filing = seedFiling(repo, { status: "draft" });
  await transitionTaxFiling(repo, filing.id, { status: "ready", actorAdminId: 7 }, now());
  await transitionTaxFiling(repo, filing.id, {
    status: "filed",
    confirmationRef: "ORIGINAL-CONFIRMATION",
    actorAdminId: 7,
  }, now());

  await assertTaxRejects(
    () => updateTaxFiling(repo, filing.id, { dueDate: "2026-09-01", actorAdminId: 7 }),
    "TAX_FILING_HISTORICAL_IMMUTABLE",
  );

  const accepted = await transitionTaxFiling(repo, filing.id, {
    status: "accepted",
    confirmationRef: "SHOULD-NOT-REWRITE",
    actorAdminId: 7,
  }, now());
  assert.equal(accepted.confirmationRef, "ORIGINAL-CONFIRMATION");
  assert.ok(accepted.acceptedAt);
});

test("tax filing lifecycle rejects persisted timestamp/status contradictions", async () => {
  const repo = makeRepo();
  const draftWithFiledAt = seedFiling(repo, { status: "draft", filedAt: now() });
  await assertTaxRejects(
    () => transitionTaxFiling(repo, draftWithFiledAt.id, { status: "ready", actorAdminId: 7 }, now()),
    "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID",
  );

  const filedWithoutTimestamp = seedFiling(repo, { status: "filed", filedAt: null });
  await assertTaxRejects(
    () => transitionTaxFiling(repo, filedWithoutTimestamp.id, { status: "accepted", actorAdminId: 7 }, now()),
    "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID",
  );

  const rejectedWithAcceptedAt = seedFiling(repo, {
    status: "rejected",
    filedAt: now(),
    acceptedAt: now(),
  });
  await assertTaxRejects(
    () => transitionTaxFiling(repo, rejectedWithAcceptedAt.id, { status: "ready", actorAdminId: 7 }, now()),
    "TAX_FILING_LIFECYCLE_TIMESTAMPS_INVALID",
  );
});

test("tax filing amendment preserves original and inherits registration type and period", async () => {
  const repo = makeRepo();
  const filedAt = now();
  const original = seedFiling(repo, {
    status: "filed",
    filedAt,
    confirmationRef: "ORIGINAL",
  });

  const amendment = await createTaxFilingAmendment(repo, original.id, {
    notes: "Correct wage total",
    actorAdminId: 7,
  });
  const originalAfter = await getTaxFiling(repo, original.id, "2026-08-30");

  assert.equal(originalAfter.status, "filed");
  assert.deepEqual(originalAfter.filedAt, filedAt);
  assert.equal(originalAfter.confirmationRef, "ORIGINAL");
  assert.equal(amendment.amendsTaxFilingId, original.id);
  assert.equal(amendment.taxRegistrationId, original.taxRegistrationId);
  assert.equal(amendment.filingType, original.filingType);
  assert.equal(amendment.periodStart, original.periodStart);
  assert.equal(amendment.periodEnd, original.periodEnd);
  assert.equal(amendment.status, "draft");
});

test("tax filing amendment API rejects caller-provided scope changes", () => {
  const parsed = createTaxFilingAmendmentPayloadSchema.safeParse({
    taxRegistrationId: 999,
    filingType: "941-X",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });

  assert.equal(parsed.success, false);
});

test("tax filing amendment branching and cycles are rejected", async () => {
  const repo = makeRepo();
  const original = seedFiling(repo, { status: "filed", filedAt: now() });
  await createTaxFilingAmendment(repo, original.id, { actorAdminId: 7 });

  await assertTaxRejects(
    () => createTaxFilingAmendment(repo, original.id, { actorAdminId: 7 }),
    "TAX_FILING_AMENDMENT_BRANCHING_NOT_SUPPORTED",
  );

  const cycle = seedFiling(repo, { status: "filed", filedAt: now() });
  cycle.amendsTaxFilingId = cycle.id;
  await assertTaxRejects(
    () => createTaxFilingAmendment(repo, cycle.id, { actorAdminId: 7 }),
    "TAX_FILING_AMENDMENT_CYCLE",
  );
});

test("tax filing overdue state is derived from due date and lifecycle", async () => {
  const repo = makeRepo();
  const filing = seedFiling(repo, { status: "draft", dueDate: "2026-08-01" });

  const [overdue] = await listTaxFilings(repo, { pageSize: 100 }, "2026-08-30");
  assert.equal(overdue.dueState, "overdue");

  await transitionTaxFiling(repo, filing.id, { status: "ready", actorAdminId: 7 }, now());
  await transitionTaxFiling(repo, filing.id, { status: "filed", actorAdminId: 7 }, now());
  const [filed] = await listTaxFilings(repo, { pageSize: 100 }, "2026-08-30");
  assert.equal(filed.dueState, "complete");
});

test("tax due date boundaries use date-only semantics", async () => {
  const repo = makeRepo();
  seedLiability(repo, { status: "recognized", dueDate: "2026-09-30" });
  seedFiling(repo, { status: "ready", dueDate: "2026-09-30" });

  const [liabilityDueToday] = await listTaxLiabilities(repo, { pageSize: 100 }, "2026-09-30");
  const [filingDueToday] = await listTaxFilings(repo, { pageSize: 100 }, "2026-09-30");
  assert.equal(liabilityDueToday.dueState, "due_soon");
  assert.equal(filingDueToday.dueState, "due_soon");

  const [liabilityTomorrow] = await listTaxLiabilities(repo, { pageSize: 100 }, "2026-10-01");
  const [filingTomorrow] = await listTaxFilings(repo, { pageSize: 100 }, "2026-10-01");
  assert.equal(liabilityTomorrow.dueState, "overdue");
  assert.equal(filingTomorrow.dueState, "overdue");
});

test("tax liabilities and filings are independent obligation records", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);

  const liability = await createTaxLiability(repo, {
    taxRegistrationId: registration.id,
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    component: "withholding",
    amountCents: 10_626,
    actorAdminId: 7,
  });
  assert.equal((await listTaxFilings(repo, { pageSize: 100 })).length, 0);

  await createTaxFiling(repo, {
    taxRegistrationId: registration.id,
    filingType: "941",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    actorAdminId: 7,
  });
  const [liabilityAfter] = await listTaxLiabilities(repo, { pageSize: 100 });
  assert.equal(liabilityAfter.id, liability.id);
  assert.equal(liabilityAfter.status, "draft");
});

test("tax routes do not expose agency payment or allocation mutations in 4A", () => {
  assert.doesNotMatch(taxBlock(), /finance\/tax\/(?:agency-)?payments|finance\/tax\/(?:payment-)?allocations/);
});

test("tax read routes are super-admin only", () => {
  const gets = taxBlock().match(/app\.get\(/g) ?? [];
  assert.ok(gets.length >= 8);
  assert.equal(taxBlock().includes("admin_finance"), false);
  assert.equal((taxBlock().match(/requireRole\(\['super_admin'\]\)/g) ?? []).length >= gets.length, true);
});

test("tax mutation routes are super-admin only", () => {
  const mutations = taxBlock().match(/app\.(post|patch)\(/g) ?? [];
  assert.ok(mutations.length >= 15);
  assert.equal(taxBlock().includes("admin_finance"), false);
  assert.equal((taxBlock().match(/requireRole\(\['super_admin'\]\)/g) ?? []).length >= mutations.length, true);
});

test("AP payroll admin profile and personnel surfaces do not leak Tax control-plane DTOs", () => {
  const financeService = readFileSync("server/financeExpenseService.ts", "utf8");
  const payrollService = readFileSync("server/payrollService.ts", "utf8");
  const personnelService = readFileSync("server/personnelService.ts", "utf8");
  const adminValidation = readFileSync("server/adminEngagementValidation.test.ts", "utf8");
  const adminProfile = readFileSync("client/src/pages/AdminProfile.tsx", "utf8");
  const personnelPage = readFileSync("client/src/pages/PersonnelManagement.tsx", "utf8");

  assert.doesNotMatch(financeService, /taxLiabilities|taxFilings|taxRegistrations|tax_agency_payments|tax_payment_allocations/);
  assert.doesNotMatch(payrollService, /taxLiabilities|taxFilings|taxRegistrations|tax_agency_payments|tax_payment_allocations/);
  assert.doesNotMatch(personnelService, /taxLiabilities|taxFilings|taxRegistrations|tax_agency_payments|tax_payment_allocations/);
  assert.doesNotMatch(adminValidation, /taxLiabilities|taxFilings|taxRegistrations/);
  assert.doesNotMatch(adminProfile, /taxLiabilities|taxFilings|taxRegistrations|tax_agency_payments|tax_payment_allocations/);
  assert.doesNotMatch(personnelPage, /taxLiabilities|taxFilings|taxRegistrations|tax_agency_payments|tax_payment_allocations/);
});

test("tax mutation and audit event rollback together", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  repo.state.failAudit = true;

  await assert.rejects(
    () => createTaxLiability(repo, {
      taxRegistrationId: registration.id,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      component: "withholding",
      amountCents: 10_626,
      actorAdminId: 7,
    }),
    /audit insert failed/,
  );

  assert.equal(repo.state.taxLiabilities.length, 0);
  assert.equal(repo.state.taxAuditEvents.length, 0);
});

test("tax audit events preserve actor attribution and omit raw mutable payload fields", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized" });

  await createTaxLiabilityAdjustment(repo, liability.id, {
    amountEffect: "increase",
    amountCents: 26,
    sourceMetadata: { providerRequestId: "raw-provider-payload" },
    notes: "Do not audit notes",
    actorAdminId: 41,
  });
  await transitionTaxRegistration(repo, registration.id, { status: "inactive", actorAdminId: 42 });

  const filing = seedFiling(repo, { taxRegistrationId: registration.id, status: "draft" });
  await transitionTaxFiling(repo, filing.id, { status: "ready", actorAdminId: 43 }, now());
  await transitionTaxFiling(repo, filing.id, {
    status: "filed",
    confirmationRef: "IRS-941-2026Q2",
    actorAdminId: 44,
  }, now());
  await createTaxFilingAmendment(repo, filing.id, { notes: "Correct wage total", actorAdminId: 45 });

  const adjustmentEvent = repo.state.taxAuditEvents.find((event) => event.action === "adjustment_created");
  const registrationEvent = repo.state.taxAuditEvents.find((event) => event.action === "deactivated");
  const filedEvent = repo.state.taxAuditEvents.find((event) => event.action === "filed");
  const amendmentEvent = repo.state.taxAuditEvents.find((event) => event.action === "amendment_created");

  assert.equal(adjustmentEvent?.actorAdminUserId, 41);
  assert.equal(registrationEvent?.actorAdminUserId, 42);
  assert.equal(filedEvent?.actorAdminUserId, 44);
  assert.equal(amendmentEvent?.actorAdminUserId, 45);
  assert.equal(Object.prototype.hasOwnProperty.call(adjustmentEvent?.changesJson ?? {}, "sourceMetadata"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(adjustmentEvent?.changesJson ?? {}, "notes"), false);
  assert.doesNotMatch(JSON.stringify(repo.state.taxAuditEvents.map((event) => event.changesJson)), /raw-provider-payload|credentials|rawRequest|taxAccountRef/);
});

test("tax audit events are forward migration service-role records", () => {
  const migration = readFileSync("migrations/0023_tax_audit_events.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "tax_audit_events"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE "tax_audit_events" TO service_role/);
  assert.match(migration, /USING \(false\)/);
});

test("tax registration scope cannot change after liabilities or filings exist", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const otherAgency = seedTaxAgency(repo, { agencyCode: "CA-EDD", name: "California EDD", jurisdictionType: "state", jurisdictionCode: "CA" });
  seedLiability(repo, { taxRegistrationId: registration.id });

  await assertTaxRejects(
    () => updateTaxRegistration(repo, registration.id, {
      taxAgencyId: otherAgency.id,
      actorAdminId: 7,
    }),
    "TAX_REGISTRATION_SCOPE_IMMUTABLE",
  );
});
