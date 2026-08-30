import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TaxServiceError,
  applyTaxPaymentAllocation,
  createTaxAgency,
  createTaxAgencyPaymentPayloadSchema,
  createTaxFiling,
  createTaxFilingAmendment,
  createTaxFilingAmendmentPayloadSchema,
  createTaxLiability,
  createTaxLiabilityAdjustment,
  createTaxReconciliationException,
  createTaxReconciliationExceptionPayloadSchema,
  createTaxRegistration,
  getTaxAgencyPayment,
  getTaxFiling,
  getTaxLiability,
  getTaxOverview,
  listTaxAgencyPayments,
  listTaxFilings,
  listTaxLiabilities,
  listTaxPaymentAllocations,
  listTaxReconciliationExceptions,
  recordTaxAgencyPayment,
  reverseTaxAgencyPayment,
  reverseTaxPaymentAllocation,
  transitionTaxFiling,
  transitionTaxLiability,
  transitionTaxAgencyPayment,
  transitionTaxReconciliationException,
  transitionTaxRegistration,
  updateTaxAgencyPayment,
  updateTaxFiling,
  updateTaxLiability,
  updateTaxRegistration,
  type TaxAgencyListFilters,
  type TaxAgencyPaymentListFilters,
  type TaxFilingListFilters,
  type TaxLiabilityListFilters,
  type TaxPaymentAllocationListFilters,
  type TaxReconciliationListFilters,
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
  taxAgencyPayments: any[];
  taxPaymentAllocations: any[];
  taxFilings: any[];
  reconciliationExceptions: any[];
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
  state.taxAgencyPayments = snapshot.taxAgencyPayments;
  state.taxPaymentAllocations = snapshot.taxPaymentAllocations;
  state.taxFilings = snapshot.taxFilings;
  state.reconciliationExceptions = snapshot.reconciliationExceptions;
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
    taxAgencyPayments: [],
    taxPaymentAllocations: [],
    taxFilings: [],
    reconciliationExceptions: [],
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
    lockTaxPaymentAllocationsForPayment: async (id) => {
      state.locks.push(`tax_payment_allocations_for_payment:${id}`);
      const callback = (repo as any).__afterLockTaxPaymentAllocationsForPayment;
      if (typeof callback === "function") {
        delete (repo as any).__afterLockTaxPaymentAllocationsForPayment;
        callback();
      }
    },
    lockTaxPaymentAllocationsForLiability: async (id) => {
      state.locks.push(`tax_payment_allocations_for_liability:${id}`);
      const callback = (repo as any).__afterLockTaxPaymentAllocationsForLiability;
      if (typeof callback === "function") {
        delete (repo as any).__afterLockTaxPaymentAllocationsForLiability;
        callback();
      }
    },
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

function seedPayment(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const taxRegistrationId = values.taxRegistrationId ?? seedRegistration(repo).id;
  const payment = {
    id: repo.state.ids.taxAgencyPayment++,
    taxRegistrationId,
    amountCents: 10_600,
    currency: "USD",
    paymentDate: "2026-07-15",
    methodType: "ach",
    methodLabel: "ACH",
    institutionName: "Bank",
    maskedLast4: "1234",
    confirmationRef: "IRS-10600",
    status: "cleared",
    submittedAt: now(),
    clearedAt: now(),
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxAgencyPayments.push(payment);
  return payment;
}

function seedAllocation(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const taxLiabilityId = values.taxLiabilityId ?? seedLiability(repo, { status: "recognized" }).id;
  const taxAgencyPaymentId = values.taxAgencyPaymentId ?? seedPayment(repo).id;
  const allocation = {
    id: repo.state.ids.taxPaymentAllocation++,
    taxLiabilityId,
    taxAgencyPaymentId,
    amountCents: 10_600,
    currency: "USD",
    status: "active",
    reversedAt: null,
    reversedBy: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.taxPaymentAllocations.push(allocation);
  return allocation;
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

function seedReconciliationException(repo: { state: TaxState }, values: Partial<Record<string, unknown>> = {}) {
  const exception = {
    id: repo.state.ids.reconciliationException++,
    domain: "tax",
    expectedEntityType: null,
    expectedEntityId: null,
    actualEntityType: null,
    actualEntityId: null,
    currency: "USD",
    expectedAmountCents: 10_626,
    actualAmountCents: 10_600,
    differenceAmountCents: 26,
    reasonCode: "tax_underpayment",
    summary: "Unresolved tax underpayment",
    status: "open",
    ownerAdminId: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdBy: 1,
    createdAt: now(),
    updatedAt: now(),
    ...values,
  };
  repo.state.reconciliationExceptions.push(exception);
  return exception;
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

test("tax liability settlement state is derived, not stored on the liability row", async () => {
  const repo = makeRepo();
  const liability = seedLiability(repo, { status: "recognized" });
  const response = await getTaxLiability(repo, liability.id, "2026-08-30");

  assert.doesNotMatch(taxLiabilitiesSchemaBlock(), /paymentStatus|payment_status|paid|unpaid|partially_paid/);
  assert.equal(response.settlementState, "unpaid");
  assert.equal(response.paymentTrackingStatus, "unpaid");
  assert.equal(response.outstandingAmountCents, 10_626);
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

test("tax agency payment can be edited only while pending", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const payment = await recordTaxAgencyPayment(repo, {
    taxRegistrationId: registration.id,
    amountCents: 10_000,
    methodType: "ach",
    status: "pending",
    actorAdminId: 7,
  });

  const edited = await updateTaxAgencyPayment(repo, payment.id, {
    amountCents: 10_500,
    confirmationRef: "draft-ref",
    actorAdminId: 7,
  });
  assert.equal(edited.amountCents, 10_500);

  await transitionTaxAgencyPayment(repo, payment.id, { status: "submitted", actorAdminId: 7 }, now());
  await assertTaxRejects(
    () => updateTaxAgencyPayment(repo, payment.id, { amountCents: 10_600, actorAdminId: 7 }),
    "TAX_AGENCY_PAYMENT_NOT_PENDING",
  );
});

test("cleared tax payment fully allocated to matching liability derives paid settlement", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "cleared" });

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const [settledLiability] = await listTaxLiabilities(repo, { pageSize: 100 });
  const [settledPayment] = await listTaxAgencyPayments(repo, { pageSize: 100 });
  assert.equal(settledLiability.effectiveAmountCents, 10_000);
  assert.equal(settledLiability.clearedAllocatedAmountCents, 10_000);
  assert.equal(settledLiability.outstandingAmountCents, 0);
  assert.equal(settledLiability.settlementState, "paid");
  assert.equal(settledPayment.activeAllocatedAmountCents, 10_000);
  assert.equal(settledPayment.unappliedAmountCents, 0);
  assert.equal(settledPayment.settlementImpact, "settled");
});

test("tax payment allocation can leave payment partially unapplied", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "cleared" });

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const liabilityResponse = await getTaxLiability(repo, liability.id, "2026-08-30");
  const paymentResponse = await getTaxAgencyPayment(repo, payment.id, "2026-08-30");
  assert.equal(liabilityResponse.clearedAllocatedAmountCents, 6_000);
  assert.equal(liabilityResponse.outstandingAmountCents, 4_000);
  assert.equal(liabilityResponse.settlementState, "partial");
  assert.equal(paymentResponse.activeAllocatedAmountCents, 6_000);
  assert.equal(paymentResponse.unappliedAmountCents, 4_000);
});

test("one tax agency payment can allocate across multiple compatible liabilities", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const firstLiability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const secondLiability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 5_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 15_000, status: "cleared" });

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: firstLiability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });
  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: secondLiability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 5_000,
    currency: "USD",
    actorAdminId: 7,
  });

  assert.equal((await getTaxLiability(repo, firstLiability.id, "2026-08-30")).settlementState, "paid");
  assert.equal((await getTaxLiability(repo, secondLiability.id, "2026-08-30")).settlementState, "paid");
  assert.equal((await getTaxAgencyPayment(repo, payment.id, "2026-08-30")).unappliedAmountCents, 0);
});

test("one tax liability can receive allocations from multiple payments", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const firstPayment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 6_000, status: "cleared" });
  const secondPayment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 4_000, status: "cleared" });

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: firstPayment.id,
    amountCents: 6_000,
    currency: "USD",
    actorAdminId: 7,
  });
  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: secondPayment.id,
    amountCents: 4_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  assert.equal(response.clearedAllocatedAmountCents, 10_000);
  assert.equal(response.settlementState, "paid");
});

test("tax payment may exceed known liability and remain unapplied", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = await recordTaxAgencyPayment(repo, {
    taxRegistrationId: registration.id,
    amountCents: 12_000,
    methodType: "ach",
    status: "cleared",
    actorAdminId: 7,
  }, now());

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const paymentResponse = await getTaxAgencyPayment(repo, payment.id, "2026-08-30");
  assert.equal(paymentResponse.amountCents, 12_000);
  assert.equal(paymentResponse.activeAllocatedAmountCents, 10_000);
  assert.equal(paymentResponse.unappliedAmountCents, 2_000);
});

test("submitted tax payment allocation is in-flight and does not settle liability", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "submitted", clearedAt: null });

  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  assert.equal(response.inFlightAllocatedAmountCents, 10_000);
  assert.equal(response.clearedAllocatedAmountCents, 0);
  assert.equal(response.outstandingAmountCents, 10_000);
  assert.equal(response.settlementState, "unpaid");
});

test("failed tax payment allocation does not count as liability settlement", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "failed", clearedAt: null });
  seedAllocation(repo, { taxLiabilityId: liability.id, taxAgencyPaymentId: payment.id, amountCents: 10_000 });

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  assert.equal(response.clearedAllocatedAmountCents, 0);
  assert.equal(response.inFlightAllocatedAmountCents, 0);
  assert.equal(response.outstandingAmountCents, 10_000);
});

test("reversed tax payment allocation does not count as liability settlement", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "reversed" });
  seedAllocation(repo, { taxLiabilityId: liability.id, taxAgencyPaymentId: payment.id, amountCents: 10_000 });

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  assert.equal(response.clearedAllocatedAmountCents, 0);
  assert.equal(response.outstandingAmountCents, 10_000);
});

test("tax allocation rejects currency mismatch", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000, currency: "USD" });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, currency: "USD" });

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: liability.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 10_000,
      currency: "EUR",
      actorAdminId: 7,
    }),
    "TAX_ALLOCATION_CURRENCY_MISMATCH",
  );
});

test("tax allocation rejects tax registration mismatch", async () => {
  const repo = makeRepo();
  const liability = seedLiability(repo, { status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: seedRegistration(repo).id, amountCents: 10_000 });

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: liability.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 10_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_ALLOCATION_REGISTRATION_MISMATCH",
  );
});

test("tax allocation rejects draft and voided liabilities", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const draft = seedLiability(repo, { taxRegistrationId: registration.id, status: "draft", amountCents: 10_000 });
  const voided = seedLiability(repo, { taxRegistrationId: registration.id, status: "voided", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000 });

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: draft.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 1_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_ALLOCATION_LIABILITY_STATUS_INVALID",
  );
  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: voided.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 1_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_ALLOCATION_LIABILITY_STATUS_INVALID",
  );
});

test("tax allocation rejects adjustment rows as targets", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const base = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const adjustment = seedLiability(repo, {
    taxRegistrationId: registration.id,
    adjustsTaxLiabilityId: base.id,
    status: "recognized",
    amountEffect: "increase",
    amountCents: 1_000,
  });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 1_000 });

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: adjustment.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 1_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_ALLOCATION_TARGET_ADJUSTMENT",
  );
});

test("stale tax payment over-allocation is prevented after locks are acquired", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const firstLiability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 8_000 });
  const secondLiability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000 });
  let injected = false;
  (repo as any).__afterLockTaxPaymentAllocationsForPayment = () => {
    injected = true;
    seedAllocation(repo, {
      taxLiabilityId: firstLiability.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 8_000,
    });
  };

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: secondLiability.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 3_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_PAYMENT_OVER_ALLOCATED",
  );
  assert.equal(injected, true);
  assert.equal(repo.state.taxPaymentAllocations.length, 0);
});

test("stale tax liability over-allocation is prevented after locks are acquired", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const firstPayment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 8_000 });
  const secondPayment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000 });
  let injected = false;
  (repo as any).__afterLockTaxPaymentAllocationsForLiability = () => {
    injected = true;
    seedAllocation(repo, {
      taxLiabilityId: liability.id,
      taxAgencyPaymentId: firstPayment.id,
      amountCents: 8_000,
    });
  };

  await assertTaxRejects(
    () => applyTaxPaymentAllocation(repo, {
      taxLiabilityId: liability.id,
      taxAgencyPaymentId: secondPayment.id,
      amountCents: 3_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    "TAX_LIABILITY_OVER_ALLOCATED",
  );
  assert.equal(injected, true);
  assert.equal(repo.state.taxPaymentAllocations.length, 0);
});

test("tax allocation reversal restores derived balances", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000 });
  const allocation = await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const reversed = await reverseTaxPaymentAllocation(repo, allocation.id, 8, now());
  const liabilityAfter = await getTaxLiability(repo, liability.id, "2026-08-30");
  const paymentAfter = await getTaxAgencyPayment(repo, payment.id, "2026-08-30");
  assert.equal(reversed.status, "reversed");
  assert.equal(reversed.reversedBy, 8);
  assert.equal(liabilityAfter.outstandingAmountCents, 10_000);
  assert.equal(paymentAfter.unappliedAmountCents, 10_000);
});

test("tax allocation double reversal is idempotent and does not corrupt balances", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000 });
  const allocation = await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  await reverseTaxPaymentAllocation(repo, allocation.id, 8, now());
  await reverseTaxPaymentAllocation(repo, allocation.id, 8, now());

  const reversalAudits = repo.state.taxAuditEvents.filter((event) => (
    event.entityType === "tax_payment_allocation" && event.action === "reversed"
  ));
  assert.equal(reversalAudits.length, 1);
  assert.equal((await getTaxLiability(repo, liability.id, "2026-08-30")).outstandingAmountCents, 10_000);
});

test("tax agency payment with active allocation cannot be reversed directly", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "cleared" });
  seedAllocation(repo, { taxLiabilityId: liability.id, taxAgencyPaymentId: payment.id, amountCents: 10_000 });

  await assertTaxRejects(
    () => reverseTaxAgencyPayment(repo, payment.id, 7),
    "TAX_AGENCY_PAYMENT_HAS_ACTIVE_ALLOCATIONS",
  );
});

test("later decrease adjustment can create overapplied tax state without rewriting history", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "cleared" });
  const allocation = await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  const adjustment = await createTaxLiabilityAdjustment(repo, liability.id, {
    amountEffect: "decrease",
    amountCents: 2_000,
    actorAdminId: 7,
  });
  await transitionTaxLiability(repo, adjustment.id, { status: "recognized", actorAdminId: 7 }, now());

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  assert.equal(response.effectiveAmountCents, 8_000);
  assert.equal(response.clearedAllocatedAmountCents, 10_000);
  assert.equal(response.overappliedAmountCents, 2_000);
  assert.equal(response.settlementState, "overpaid");
  assert.equal(repo.state.taxPaymentAllocations.find((item) => item.id === allocation.id)?.amountCents, 10_000);
});

test("tax payment operations do not mutate filing lifecycle", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const filing = seedFiling(repo, { taxRegistrationId: registration.id, status: "draft" });
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_000, status: "cleared" });
  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_000,
    currency: "USD",
    actorAdminId: 7,
  });

  assert.equal(repo.state.taxFilings.find((item) => item.id === filing.id)?.status, "draft");
});

test("tax reconciliation creation forces tax domain and rejects domain injection", async () => {
  const repo = makeRepo();
  const liability = seedLiability(repo, { status: "recognized", amountCents: 10_626 });
  const payment = seedPayment(repo, { taxRegistrationId: liability.taxRegistrationId, amountCents: 10_600 });

  assert.equal(createTaxReconciliationExceptionPayloadSchema.safeParse({
    domain: "ap",
    expectedEntityType: "tax_liabilities",
    expectedEntityId: liability.id,
    actualEntityType: "tax_agency_payments",
    actualEntityId: payment.id,
    currency: "USD",
    expectedAmountCents: 10_626,
    actualAmountCents: 10_600,
    reasonCode: "tax_underpayment",
    summary: "Unresolved underpayment",
  }).success, false);

  const exception = await createTaxReconciliationException(repo, {
    expectedEntityType: "tax_liabilities",
    expectedEntityId: liability.id,
    actualEntityType: "tax_agency_payments",
    actualEntityId: payment.id,
    currency: "USD",
    expectedAmountCents: 10_626,
    actualAmountCents: 10_600,
    reasonCode: "tax_underpayment",
    summary: "Unresolved underpayment",
    domain: "payroll",
    actorAdminId: 7,
  } as any);
  seedReconciliationException(repo, { domain: "ap", reasonCode: "amount_mismatch", summary: "AP issue" });

  assert.equal(exception.domain, "tax");
  assert.equal(exception.differenceAmountCents, 26);
  assert.equal((await listTaxReconciliationExceptions(repo, { pageSize: 100 })).length, 1);
});

test("tax reconciliation lifecycle preserves actor attribution", async () => {
  const repo = makeRepo();
  const exception = seedReconciliationException(repo);

  const investigating = await transitionTaxReconciliationException(repo, exception.id, "investigate", { actorAdminId: 7 }, now());
  const resolved = await transitionTaxReconciliationException(repo, exception.id, "resolve", {
    resolutionNotes: "Agency credit posted",
    actorAdminId: 8,
  }, now());
  const reopened = await transitionTaxReconciliationException(repo, exception.id, "reopen", { actorAdminId: 9 }, now());

  assert.equal(investigating.status, "investigating");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedBy, 8);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.resolvedBy, null);
  assert.deepEqual(
    repo.state.taxAuditEvents
      .filter((event) => event.entityType === "reconciliation_exception")
      .map((event) => event.action),
    ["investigating", "resolved", "reopened"],
  );
});

test("admin_finance cannot read tax payment or reconciliation routes", () => {
  const block = taxBlock();
  assert.match(block, /finance\/tax\/payments/);
  assert.match(block, /finance\/tax\/payment-allocations/);
  assert.match(block, /finance\/tax\/reconciliation-exceptions/);
  assert.equal(block.includes("admin_finance"), false);
});

test("tax payment, allocation, and reconciliation audit failures roll back business writes", async () => {
  const paymentRepo = makeRepo();
  const registration = seedRegistration(paymentRepo);
  paymentRepo.state.failAudit = true;
  await assert.rejects(
    () => recordTaxAgencyPayment(paymentRepo, {
      taxRegistrationId: registration.id,
      amountCents: 10_000,
      methodType: "ach",
      actorAdminId: 7,
    }),
    /audit insert failed/,
  );
  assert.equal(paymentRepo.state.taxAgencyPayments.length, 0);

  const allocationRepo = makeRepo();
  const allocationRegistration = seedRegistration(allocationRepo);
  const liability = seedLiability(allocationRepo, { taxRegistrationId: allocationRegistration.id, status: "recognized", amountCents: 10_000 });
  const payment = seedPayment(allocationRepo, { taxRegistrationId: allocationRegistration.id, amountCents: 10_000 });
  allocationRepo.state.failAudit = true;
  await assert.rejects(
    () => applyTaxPaymentAllocation(allocationRepo, {
      taxLiabilityId: liability.id,
      taxAgencyPaymentId: payment.id,
      amountCents: 10_000,
      currency: "USD",
      actorAdminId: 7,
    }),
    /audit insert failed/,
  );
  assert.equal(allocationRepo.state.taxPaymentAllocations.length, 0);

  const reconciliationRepo = makeRepo();
  reconciliationRepo.state.failAudit = true;
  await assert.rejects(
    () => createTaxReconciliationException(reconciliationRepo, {
      reasonCode: "other_tax_discrepancy",
      summary: "Audit failure rollback",
      actorAdminId: 7,
    }),
    /audit insert failed/,
  );
  assert.equal(reconciliationRepo.state.reconciliationExceptions.length, 0);
});

test("exact 106.26 liability and 106.00 agency payment leaves 0.26 tax reconciliation issue", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const liability = seedLiability(repo, { taxRegistrationId: registration.id, status: "recognized", amountCents: 10_626 });
  const payment = seedPayment(repo, { taxRegistrationId: registration.id, amountCents: 10_600, status: "cleared" });
  await applyTaxPaymentAllocation(repo, {
    taxLiabilityId: liability.id,
    taxAgencyPaymentId: payment.id,
    amountCents: 10_600,
    currency: "USD",
    actorAdminId: 7,
  });

  const response = await getTaxLiability(repo, liability.id, "2026-08-30");
  const exception = await createTaxReconciliationException(repo, {
    expectedEntityType: "tax_liabilities",
    expectedEntityId: liability.id,
    actualEntityType: "tax_agency_payments",
    actualEntityId: payment.id,
    currency: "USD",
    expectedAmountCents: response.effectiveAmountCents,
    actualAmountCents: response.clearedAllocatedAmountCents,
    reasonCode: "tax_underpayment",
    summary: "Q2 liability remains underpaid by 26 cents.",
    actorAdminId: 7,
  });

  assert.equal(response.effectiveAmountCents, 10_626);
  assert.equal(response.clearedAllocatedAmountCents, 10_600);
  assert.equal(response.outstandingAmountCents, 26);
  assert.equal(response.settlementState, "partial");
  assert.equal(exception.status, "open");
  assert.equal(exception.differenceAmountCents, 26);
  assert.equal(repo.state.taxLiabilities.find((item) => item.id === liability.id)?.amountCents, 10_626);
  assert.equal(repo.state.taxAgencyPayments.find((item) => item.id === payment.id)?.amountCents, 10_600);
});

test("tax payment schema accepts committed method types only", () => {
  assert.equal(createTaxAgencyPaymentPayloadSchema.safeParse({
    taxRegistrationId: 1,
    amountCents: 100,
    methodType: "wire",
  }).success, false);
  assert.equal(createTaxAgencyPaymentPayloadSchema.safeParse({
    taxRegistrationId: 1,
    amountCents: 100,
    methodType: "ach",
  }).success, true);
});

test("tax payment and reconciliation audit scope is forward migration only", () => {
  const migration23 = readFileSync("migrations/0023_tax_audit_events.sql", "utf8");
  const migration24 = readFileSync("migrations/0024_tax_payment_reconciliation_audit_scope.sql", "utf8");
  assert.doesNotMatch(migration23, /tax_agency_payment|tax_payment_allocation|reconciliation_exception/);
  assert.match(migration24, /DROP CONSTRAINT IF EXISTS "tax_audit_events_entity_type_check"/);
  assert.match(migration24, /'tax_agency_payment'/);
  assert.match(migration24, /'tax_payment_allocation'/);
  assert.match(migration24, /'reconciliation_exception'/);
  assert.match(migration24, /'allocation_created'/);
  assert.match(migration24, /'reopened'/);
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

test("tax registration scope cannot change after tax facts exist", async () => {
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

test("tax registration scope cannot change after agency payments exist", async () => {
  const repo = makeRepo();
  const registration = seedRegistration(repo);
  const otherAgency = seedTaxAgency(repo, { agencyCode: "NY-DTF", name: "New York Department of Taxation", jurisdictionType: "state", jurisdictionCode: "NY" });
  seedPayment(repo, { taxRegistrationId: registration.id });

  await assertTaxRejects(
    () => updateTaxRegistration(repo, registration.id, {
      taxAgencyId: otherAgency.id,
      actorAdminId: 7,
    }),
    "TAX_REGISTRATION_SCOPE_IMMUTABLE",
  );
});
