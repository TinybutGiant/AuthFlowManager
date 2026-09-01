import type { AmountEffect } from "@shared/schema";

export class TaxDomainValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaxDomainValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new TaxDomainValidationError(code, message);
}

interface DirectionalAmountLine {
  amountCents: number;
  amountEffect?: AmountEffect | null;
}

function assertPositiveMinorUnits(amountCents: number, code: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    fail(code, "Amount must be a positive integer minor-unit value.");
  }
}

function directionalAmountCents(line: DirectionalAmountLine) {
  assertPositiveMinorUnits(line.amountCents, "DIRECTIONAL_AMOUNT_INVALID");
  return line.amountEffect === "decrease" ? -line.amountCents : line.amountCents;
}

function sumDirectionalAmountCents(lines: readonly DirectionalAmountLine[]) {
  return lines.reduce((total, line) => total + directionalAmountCents(line), 0);
}

export interface TaxLiabilityAmount extends DirectionalAmountLine {
  taxRegistrationId: number;
  currency: string;
}

export function deriveTaxLiabilityNetAmountCents(
  liabilities: readonly TaxLiabilityAmount[],
) {
  return sumDirectionalAmountCents(liabilities);
}

export interface TaxFilingSnapshot {
  id: number;
  taxRegistrationId: number;
  filingType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  amendsTaxFilingId?: number | null;
}

export function validateTaxFilingAmendment(input: {
  amendment: TaxFilingSnapshot;
  original: TaxFilingSnapshot;
  ancestorFilingIds?: number[];
}) {
  const { amendment, original } = input;
  if (amendment.id === original.id) {
    fail("TAX_FILING_AMENDMENT_SELF_REFERENCE", "A tax filing cannot amend itself.");
  }
  if (amendment.amendsTaxFilingId !== original.id) {
    fail("TAX_FILING_AMENDMENT_TARGET_MISMATCH", "Amendment must reference the prior filing.");
  }
  if (original.status !== "filed" && original.status !== "accepted") {
    fail("TAX_FILING_AMENDMENT_REQUIRES_FILED_ORIGINAL", "A tax filing amendment requires a filed or accepted original.");
  }
  if (
    amendment.taxRegistrationId !== original.taxRegistrationId
    || amendment.filingType !== original.filingType
    || amendment.periodStart !== original.periodStart
    || amendment.periodEnd !== original.periodEnd
  ) {
    fail("TAX_FILING_AMENDMENT_SCOPE_MISMATCH", "Tax amendment must use the same registration, type, and period.");
  }
  if (input.ancestorFilingIds?.includes(amendment.id)) {
    fail("TAX_FILING_AMENDMENT_CYCLE", "Tax filing amendment lineage cannot form a cycle.");
  }
}
