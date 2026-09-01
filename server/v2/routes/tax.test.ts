import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { StaffPrincipalRepository } from "../auth/staffPrincipal";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import {
  handleTaxRouteWithRepository,
  taxRouteModule,
} from "./tax";
import type {
  TaxAgencyListFilters,
  TaxAgencyPaymentListFilters,
  TaxFilingListFilters,
  TaxLiabilityListFilters,
  TaxPaymentAllocationListFilters,
  TaxReconciliationListFilters,
  TaxRegistrationOverlapCandidate,
  TaxRegistrationListFilters,
  TaxRepository,
} from "../../taxService";

type TaxState = {
  legalEntities: any[];
  vendors: any[];
  taxAgencies: any[];
  taxRegistrations: any[];
  taxLiabilities: any[];
  taxAgencyPayments: any[];
  taxPaymentAllocations: any[];
  taxFilings: any[];
  reconciliationExceptions: any[];
  externalRecordRefs: any[];
  taxAuditEvents: any[];
  locks: string[];
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

function dateRangesOverlap(
  left: { effectiveFrom?: unknown; effectiveTo?: unknown },
  right: { effectiveFrom?: unknown; effectiveTo?: unknown },
) {
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
  state.taxAgencyPayments = snapshot.taxAgencyPayments;
  state.taxPaymentAllocations = snapshot.taxPaymentAllocations;
  state.taxFilings = snapshot.taxFilings;
  state.reconciliationExceptions = snapshot.reconciliationExceptions;
  state.externalRecordRefs = snapshot.externalRecordRefs;
  state.taxAuditEvents = snapshot.taxAuditEvents;
  state.locks = snapshot.locks;
  state.ids = snapshot.ids;
}

function makeState(): TaxState {
  return {
    legalEntities: [],
    vendors: [],
    taxAgencies: [],
    taxRegistrations: [],
    taxLiabilities: [],
    taxAgencyPayments: [],
    taxPaymentAllocations: [],
    taxFilings: [],
    reconciliationExceptions: [],
    externalRecordRefs: [],
    taxAuditEvents: [],
    locks: [],
    ids: {
      legalEntity: 1,
      vendor: 1,
      taxAgency: 1,
      taxRegistration: 1,
      taxLiability: 1,
      taxAgencyPayment: 1,
      taxPaymentAllocation: 1,
      taxFiling: 1,
      reconciliationException: 1,
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
    lockTaxAgencyPayment: async (id) => { state.locks.push(`tax_agency_payment:${id}`); },
    lockTaxPaymentAllocation: async (id) => { state.locks.push(`tax_payment_allocation:${id}`); },
    lockTaxPaymentAllocationsForPayment: async (id) => { state.locks.push(`tax_payment_allocations_for_payment:${id}`); },
    lockTaxPaymentAllocationsForLiability: async (id) => { state.locks.push(`tax_payment_allocations_for_liability:${id}`); },
    lockReconciliationException: async (id) => { state.locks.push(`reconciliation_exception:${id}`); },

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
      || state.taxAgencyPayments.some((item) => item.taxRegistrationId === id)
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

    getTaxAgencyPayment: async (id) => state.taxAgencyPayments.find((item) => item.id === id),
    listTaxAgencyPayments: async (filters: TaxAgencyPaymentListFilters) => state.taxAgencyPayments
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.taxRegistrationId || item.taxRegistrationId === filters.taxRegistrationId)
      .slice(0, filters.pageSize ?? 100),
    createTaxAgencyPayment: async (values) => {
      const payment = {
        id: state.ids.taxAgencyPayment++,
        taxRegistrationId: values.taxRegistrationId,
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        paymentDate: values.paymentDate ?? null,
        methodType: values.methodType,
        methodLabel: values.methodLabel ?? null,
        institutionName: values.institutionName ?? null,
        maskedLast4: values.maskedLast4 ?? null,
        confirmationRef: values.confirmationRef ?? null,
        status: values.status ?? "pending",
        submittedAt: values.submittedAt ?? null,
        clearedAt: values.clearedAt ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxAgencyPayments.push(payment);
      return payment as any;
    },
    updateTaxAgencyPayment: async (id, values) => {
      const existing = state.taxAgencyPayments.find((item) => item.id === id);
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    getTaxPaymentAllocation: async (id) => state.taxPaymentAllocations.find((item) => item.id === id),
    listTaxPaymentAllocations: async (filters: TaxPaymentAllocationListFilters) => state.taxPaymentAllocations
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.taxLiabilityId || item.taxLiabilityId === filters.taxLiabilityId)
      .filter((item) => !filters.taxAgencyPaymentId || item.taxAgencyPaymentId === filters.taxAgencyPaymentId)
      .slice(0, filters.pageSize ?? 100),
    createTaxPaymentAllocation: async (values) => {
      const allocation = {
        id: state.ids.taxPaymentAllocation++,
        taxLiabilityId: values.taxLiabilityId,
        taxAgencyPaymentId: values.taxAgencyPaymentId,
        amountCents: values.amountCents,
        currency: values.currency ?? "USD",
        status: values.status ?? "active",
        reversedAt: values.reversedAt ?? null,
        reversedBy: values.reversedBy ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.taxPaymentAllocations.push(allocation);
      return allocation as any;
    },
    updateTaxPaymentAllocation: async (id, values) => {
      const existing = state.taxPaymentAllocations.find((item) => item.id === id);
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

    getReconciliationException: async (id) => state.reconciliationExceptions.find((item) => item.id === id && item.domain === "tax"),
    listReconciliationExceptions: async (filters: TaxReconciliationListFilters) => state.reconciliationExceptions
      .filter((item) => item.domain === "tax")
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .slice(0, filters.pageSize ?? 100),
    createReconciliationException: async (values) => {
      const exception = {
        id: state.ids.reconciliationException++,
        domain: values.domain,
        expectedEntityType: values.expectedEntityType ?? null,
        expectedEntityId: values.expectedEntityId ?? null,
        actualEntityType: values.actualEntityType ?? null,
        actualEntityId: values.actualEntityId ?? null,
        currency: values.currency ?? null,
        expectedAmountCents: values.expectedAmountCents ?? null,
        actualAmountCents: values.actualAmountCents ?? null,
        differenceAmountCents: values.differenceAmountCents ?? null,
        reasonCode: values.reasonCode,
        summary: values.summary,
        status: values.status ?? "open",
        ownerAdminId: values.ownerAdminId ?? null,
        resolvedAt: values.resolvedAt ?? null,
        resolvedBy: values.resolvedBy ?? null,
        resolutionNotes: values.resolutionNotes ?? null,
        createdBy: values.createdBy ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.reconciliationExceptions.push(exception);
      return exception as any;
    },
    updateReconciliationException: async (id, values) => {
      const existing = state.reconciliationExceptions.find((item) => item.id === id && item.domain === "tax");
      if (!existing) return undefined;
      Object.assign(existing, compact(values), { updatedAt: now() });
      return existing;
    },

    entityExists: async (entityType, entityId) => {
      const collections: Record<string, any[]> = {
        tax_agencies: state.taxAgencies,
        tax_registrations: state.taxRegistrations,
        tax_liabilities: state.taxLiabilities,
        tax_agency_payments: state.taxAgencyPayments,
        tax_payment_allocations: state.taxPaymentAllocations,
        tax_filings: state.taxFilings,
        reconciliation_exceptions: state.reconciliationExceptions.filter((item) => item.domain === "tax"),
      };
      return Boolean(collections[entityType]?.some((item) => item.id === entityId));
    },

    createTaxAuditEvent: async (values) => {
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
    maskedTaxIdentifier: "***-**-1234",
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
    name: "Provider with private notes",
    vendorType: "payroll_provider",
    status: "active",
    website: "https://provider.example",
    contactEmail: "private-vendor@example.com",
    notes: "private vendor note",
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.vendors.push(vendor);
  return vendor;
}

function principal(permissions: StaffPrincipal["permissions"]): StaffPrincipal {
  return {
    id: "42",
    email: "tax@example.com",
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

async function jsonBody<T = Record<string, unknown>>(response: Response) {
  return await response.json() as T;
}

async function taxJson<T = Record<string, unknown>>(
  repository: TaxRepository,
  path: string,
  init: RequestInit = {},
) {
  const response = await handleTaxRouteWithRepository(
    request(path, init),
    principal(["tax_admin"]),
    repository,
  );
  return {
    response,
    body: await jsonBody<T>(response),
  };
}

async function taxJsonRequest<T = Record<string, unknown>>(
  repository: TaxRepository,
  path: string,
  method: string,
  requestBody: unknown,
) {
  const response = await handleTaxRouteWithRepository(
    jsonRequest(path, method, requestBody),
    principal(["tax_admin"]),
    repository,
  );
  return {
    response,
    body: await jsonBody<T>(response),
  };
}

test("V2 tax route manifest is Tax-only and complete", () => {
  assert.equal(taxRouteModule.basePath, "/api/v2/tax");
  assert.equal(taxRouteModule.routes.length, 50);
  assert.ok(taxRouteModule.routes.includes("GET /api/v2/tax/overview"));
  assert.ok(taxRouteModule.routes.includes("POST /api/v2/tax/liabilities/:liabilityId/adjustments"));
  assert.ok(taxRouteModule.routes.includes("POST /api/v2/tax/payments/:paymentId/reverse"));
  assert.ok(taxRouteModule.routes.includes("POST /api/v2/tax/filings/:filingId/amendments"));
  assert.ok(taxRouteModule.routes.includes("POST /api/v2/tax/external-record-refs"));
  assert.equal(
    taxRouteModule.routes.some((route) =>
      /api\/admin|finance|payroll|personnel|gusto|ach-provider|bank/i.test(route),
    ),
    false,
  );
});

test("V2 tax denies requests without Cloudflare Access principal before staff lookup", async () => {
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
    request("/api/v2/tax"),
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

test("V2 tax authorizes only effective super_admin or tax_admin grants", async () => {
  for (const denied of [
    principal([]),
    principal(["finance_admin"]),
    principal(["payroll_admin"]),
    principal(["admin_operations"]),
    principal(["verifier_admin"]),
    principal(["support_admin"]),
    principal(["trainee_workspace"]),
    { ...principal(["tax_admin"]), id: "not-a-number" },
  ]) {
    const response = await handleTaxRouteWithRepository(
      request("/api/v2/tax/legal-entities"),
      denied,
      makeRepo(),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await jsonBody(response), {
      status: "error",
      code: "STAFF_ACCESS_DENIED",
    });
  }

  for (const allowed of [
    principal(["tax_admin"]),
    principal(["super_admin"]),
  ]) {
    const response = await handleTaxRouteWithRepository(
      request("/api/v2/tax/legal-entities"),
      allowed,
      makeRepo(),
    );
    assert.equal(response.status, 200);
  }
});

test("V2 tax route maps Tax ledger operations without exposing broad source data", async () => {
  const repository = makeRepo();
  const entity = seedLegalEntity(repository);
  const vendor = seedVendor(repository);

  const agencyResult = await taxJsonRequest<{ id: number; jurisdictionCode: string }>(
    repository,
    "/api/v2/tax/agencies",
    "POST",
    {
      agencyCode: "irs",
      name: "Internal Revenue Service",
      jurisdictionType: "federal",
      jurisdictionCode: "us",
      status: "active",
    },
  );
  assert.equal(agencyResult.response.status, 201);
  assert.equal(agencyResult.body.jurisdictionCode, "US");

  const registrationResult = await taxJsonRequest<{ id: number; legalEntity: { legalName: string }; maskedAccountRef: string }>(
    repository,
    "/api/v2/tax/registrations",
    "POST",
    {
      legalEntityId: entity.id,
      taxAgencyId: agencyResult.body.id,
      taxType: "federal_withholding",
      jurisdictionType: "federal",
      jurisdictionCode: "us",
      maskedAccountRef: "****9999",
      effectiveFrom: "2026-01-01",
      status: "active",
      notes: "ledger-only registration",
    },
  );
  assert.equal(registrationResult.response.status, 201);
  assert.equal(registrationResult.body.legalEntity.legalName, "Yaotu LLC");
  assert.equal(registrationResult.body.maskedAccountRef, "****9999");

  const liabilityResult = await taxJsonRequest<{ id: number; status: string; sourceMetadata?: unknown }>(
    repository,
    "/api/v2/tax/liabilities",
    "POST",
    {
      taxRegistrationId: registrationResult.body.id,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      dueDate: "2026-07-31",
      component: "withholding",
      amountCents: 10_626,
      currency: "USD",
      sourceType: "manual",
      sourceMetadata: { rawProviderPayload: "must-not-return" },
      notes: "created after accountant review",
    },
  );
  assert.equal(liabilityResult.response.status, 201);
  assert.equal(liabilityResult.body.status, "draft");
  assert.equal("sourceMetadata" in liabilityResult.body, false);

  const recognized = await taxJsonRequest<{ status: string }>(
    repository,
    `/api/v2/tax/liabilities/${liabilityResult.body.id}/recognize`,
    "POST",
    {},
  );
  assert.equal(recognized.body.status, "recognized");

  const adjustment = await taxJsonRequest<{ id: number; adjustsTaxLiabilityId: number; status: string }>(
    repository,
    `/api/v2/tax/liabilities/${liabilityResult.body.id}/adjustments`,
    "POST",
    {
      amountEffect: "decrease",
      amountCents: 26,
      sourceMetadata: { rawProviderPayload: "must-not-return" },
      notes: "rounding adjustment",
    },
  );
  assert.equal(adjustment.response.status, 201);
  assert.equal(adjustment.body.adjustsTaxLiabilityId, liabilityResult.body.id);
  await taxJsonRequest(repository, `/api/v2/tax/liabilities/${adjustment.body.id}/recognize`, "POST", {});

  const invalidPaymentTransition = await handleTaxRouteWithRepository(
    jsonRequest(
      "/api/v2/tax/payments/999/clear",
      "POST",
      {},
    ),
    principal(["tax_admin"]),
    repository,
  );
  assert.equal(invalidPaymentTransition.status, 404);

  const paymentResult = await taxJsonRequest<{ id: number; status: string; maskedLast4: string; sourceMetadata?: unknown }>(
    repository,
    "/api/v2/tax/payments",
    "POST",
    {
      taxRegistrationId: registrationResult.body.id,
      amountCents: 10_600,
      currency: "USD",
      paymentDate: "2026-07-15",
      methodType: "ach",
      methodLabel: "ACH",
      institutionName: "Bank",
      maskedLast4: "1234",
      confirmationRef: "IRS-10600",
      status: "cleared",
    },
  );
  assert.equal(paymentResult.response.status, 201);
  assert.equal(paymentResult.body.maskedLast4, "1234");
  assert.equal("sourceMetadata" in paymentResult.body, false);

  const allocationResult = await taxJsonRequest<{ id: number; status: string }>(
    repository,
    "/api/v2/tax/payment-allocations",
    "POST",
    {
      taxLiabilityId: liabilityResult.body.id,
      taxAgencyPaymentId: paymentResult.body.id,
      amountCents: 10_600,
      currency: "USD",
    },
  );
  assert.equal(allocationResult.response.status, 201);
  assert.equal(allocationResult.body.status, "active");
  assert.deepEqual(repository.state.locks.slice(-5), [
    `tax_agency_payment:${paymentResult.body.id}`,
    `tax_liability:${liabilityResult.body.id}`,
    `tax_liability_adjustments:${liabilityResult.body.id}`,
    `tax_payment_allocations_for_payment:${paymentResult.body.id}`,
    `tax_payment_allocations_for_liability:${liabilityResult.body.id}`,
  ]);

  const reversedAllocation = await taxJsonRequest<{ status: string; reversedBy: number }>(
    repository,
    `/api/v2/tax/payment-allocations/${allocationResult.body.id}/reverse`,
    "POST",
    {},
  );
  assert.equal(reversedAllocation.body.status, "reversed");
  assert.equal(reversedAllocation.body.reversedBy, 42);

  const reversedPayment = await taxJsonRequest<{ status: string }>(
    repository,
    `/api/v2/tax/payments/${paymentResult.body.id}/reverse`,
    "POST",
    {},
  );
  assert.equal(reversedPayment.body.status, "reversed");

  const filingResult = await taxJsonRequest<{ id: number; status: string; confirmationRef: string | null }>(
    repository,
    "/api/v2/tax/filings",
    "POST",
    {
      taxRegistrationId: registrationResult.body.id,
      filingType: "941",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      dueDate: "2026-07-31",
      notes: "filed externally",
    },
  );
  assert.equal(filingResult.response.status, 201);
  assert.equal(filingResult.body.status, "draft");

  await taxJsonRequest(repository, `/api/v2/tax/filings/${filingResult.body.id}/ready`, "POST", {});
  const filed = await taxJsonRequest<{ status: string; confirmationRef: string }>(
    repository,
    `/api/v2/tax/filings/${filingResult.body.id}/file`,
    "POST",
    { confirmationRef: "IRS-941-2026Q2" },
  );
  assert.equal(filed.body.status, "filed");
  assert.equal(filed.body.confirmationRef, "IRS-941-2026Q2");
  const accepted = await taxJsonRequest<{ status: string }>(
    repository,
    `/api/v2/tax/filings/${filingResult.body.id}/accept`,
    "POST",
    {},
  );
  assert.equal(accepted.body.status, "accepted");

  const amendment = await taxJsonRequest<{ amendsTaxFilingId: number; status: string }>(
    repository,
    `/api/v2/tax/filings/${filingResult.body.id}/amendments`,
    "POST",
    { notes: "manual amendment tracking only" },
  );
  assert.equal(amendment.response.status, 201);
  assert.equal(amendment.body.amendsTaxFilingId, filingResult.body.id);
  assert.equal(amendment.body.status, "draft");

  const exceptionResult = await taxJsonRequest<{ id: number; domain: string; status: string; differenceAmountCents: number }>(
    repository,
    "/api/v2/tax/reconciliation-exceptions",
    "POST",
    {
      expectedEntityType: "tax_liabilities",
      expectedEntityId: liabilityResult.body.id,
      actualEntityType: "tax_agency_payments",
      actualEntityId: paymentResult.body.id,
      currency: "USD",
      expectedAmountCents: 10_626,
      actualAmountCents: 10_600,
      reasonCode: "tax_underpayment",
      summary: "Q2 liability remains underpaid by 26 cents.",
    },
  );
  assert.equal(exceptionResult.response.status, 201);
  assert.equal(exceptionResult.body.domain, "tax");
  assert.equal(exceptionResult.body.differenceAmountCents, 26);
  const resolved = await taxJsonRequest<{ status: string; resolvedBy: number }>(
    repository,
    `/api/v2/tax/reconciliation-exceptions/${exceptionResult.body.id}/resolve`,
    "POST",
    { resolutionNotes: "Agency credit posted" },
  );
  assert.equal(resolved.body.status, "resolved");
  assert.equal(resolved.body.resolvedBy, 42);

  const externalRefResult = await taxJsonRequest<Record<string, unknown>>(
    repository,
    "/api/v2/tax/external-record-refs",
    "POST",
    {
      entityType: "tax_filings",
      entityId: filingResult.body.id,
      sourceType: "provider",
      sourceVendorId: vendor.id,
      sourceNamespace: "provider",
      externalRecordType: "filing",
      externalRecordId: "provider-filing-123",
      payloadHash: "abc123",
      metadata: { rawPayload: "must-not-return" },
      status: "active",
    },
  );
  assert.equal(externalRefResult.response.status, 201);
  assert.equal(externalRefResult.body.externalRecordId, "provider-filing-123");
  assert.equal("metadata" in externalRefResult.body, false);

  const [overview, agencies, registrations, liabilities, payments, allocations, filings, exceptions, legalEntities] =
    await Promise.all([
      taxJson<Record<string, unknown>>(repository, "/api/v2/tax/overview"),
      taxJson<unknown[]>(repository, "/api/v2/tax/agencies?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/registrations?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/liabilities?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/payments?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/payment-allocations?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/filings?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/reconciliation-exceptions?pageSize=100"),
      taxJson<unknown[]>(repository, "/api/v2/tax/legal-entities"),
    ]);

  assert.equal(overview.response.status, 200);
  assert.equal(agencies.body.length, 1);
  assert.equal(registrations.body.length, 1);
  assert.equal(liabilities.body.length, 2);
  assert.equal(payments.body.length, 1);
  assert.equal(allocations.body.length, 1);
  assert.equal(filings.body.length, 2);
  assert.equal(exceptions.body.length, 1);
  assert.equal(legalEntities.body.length, 1);

  const dtoJson = JSON.stringify({
    overview: overview.body,
    agencies: agencies.body,
    registrations: registrations.body,
    liabilities: liabilities.body,
    payments: payments.body,
    allocations: allocations.body,
    filings: filings.body,
    exceptions: exceptions.body,
    externalRef: externalRefResult.body,
  });
  assert.doesNotMatch(dtoJson, /rawProviderPayload|rawPayload|private-vendor@example\.com|private vendor note|\*\*\*-\*\*-1234/);
  assert.match(dtoJson, /"maskedAccountRef":"\*\*\*\*9999"/);
  assert.match(dtoJson, /"maskedLast4":"1234"/);
  assert.match(dtoJson, /"methodLabel":"ACH"/);
  assert.match(dtoJson, /"institutionName":"Bank"/);
  assert.match(dtoJson, /"confirmationRef":"IRS-941-2026Q2"/);
});

test("V2 tax route source excludes AP, Payroll, legacy auth, and non-Worker dependencies", () => {
  const routeSource = readFileSync("server/v2/routes/tax.ts", "utf8");
  const repositoryFactorySource = readFileSync("server/taxRepositoryFactory.ts", "utf8");
  const taxServiceSource = readFileSync("server/taxService.ts", "utf8");

  assert.doesNotMatch(routeSource, /server\/routes|server\/storage|MAIN_DB|financeExpenseService|payrollService|createFinanceExpenseRepository|createPayrollRepository|tokenManager|jsonwebtoken|bcrypt|pdfkit|mailgun|@aws-sdk|child_process/i);
  assert.doesNotMatch(repositoryFactorySource, /\.\/db|DATABASE_URL|MAIN_DB|process\.env|financeExpenseRepository|payrollRepository/i);
  assert.doesNotMatch(taxServiceSource, /financeExpenseService|payrollService|taxRepository|server\/db|process\.env|MAIN_DB/);
  assert.doesNotMatch(taxServiceSource, /from "\.\/financeDomainValidation"/);
  assert.match(taxServiceSource, /from "\.\/taxDomainValidation"/);
});
