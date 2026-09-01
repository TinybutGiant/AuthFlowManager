import type { AmountEffect, PayrollResultLineCategory } from "@shared/schema";

export class FinanceDomainValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinanceDomainValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new FinanceDomainValidationError(code, message);
}

export interface EmploymentSnapshot {
  id: number;
  workerId: number;
  legalEntityId: number;
}

export interface PayrollRunSnapshot {
  id: number;
  legalEntityId: number;
  runKind: string;
  status: string;
  correctionOfPayrollRunId?: number | null;
}

export function validatePayrollRunWorkerConsistency(input: {
  payrollRun: PayrollRunSnapshot;
  employment: EmploymentSnapshot;
  workerId: number;
}) {
  if (input.workerId !== input.employment.workerId) {
    fail("PAYROLL_WORKER_EMPLOYMENT_MISMATCH", "Payroll worker result must use the employment's worker.");
  }
  if (input.payrollRun.legalEntityId !== input.employment.legalEntityId) {
    fail("PAYROLL_LEGAL_ENTITY_MISMATCH", "Payroll run and employment must belong to the same legal entity.");
  }
}

export function validatePayrollCorrectionRun(input: {
  correctionRun: PayrollRunSnapshot;
  originalRun: PayrollRunSnapshot;
  ancestorPayrollRunIds?: number[];
}) {
  const { correctionRun, originalRun } = input;
  if (correctionRun.runKind !== "correction") {
    fail("PAYROLL_CORRECTION_KIND_REQUIRED", "A correction run must have run_kind=correction.");
  }
  if (correctionRun.correctionOfPayrollRunId !== originalRun.id) {
    fail("PAYROLL_CORRECTION_TARGET_MISMATCH", "Correction run must reference the original payroll run.");
  }
  if (correctionRun.id === originalRun.id) {
    fail("PAYROLL_CORRECTION_SELF_REFERENCE", "A payroll run cannot correct itself.");
  }
  if (originalRun.status !== "finalized") {
    fail("PAYROLL_CORRECTION_REQUIRES_FINALIZED_ORIGINAL", "A correction can only target a finalized payroll run.");
  }
  if (correctionRun.legalEntityId !== originalRun.legalEntityId) {
    fail("PAYROLL_CORRECTION_LEGAL_ENTITY_MISMATCH", "Correction run must use the original run's legal entity.");
  }
  if (input.ancestorPayrollRunIds?.includes(correctionRun.id)) {
    fail("PAYROLL_CORRECTION_CYCLE", "Payroll correction lineage cannot form a cycle.");
  }
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

export interface PayrollResultLineAmount extends DirectionalAmountLine {
  lineCategory: PayrollResultLineCategory;
}

export function derivePayrollResultLineTotals(lines: readonly PayrollResultLineAmount[]) {
  const totals = {
    grossPayCents: 0,
    deductionCents: 0,
    employeeTaxCents: 0,
    employerTaxCents: 0,
    reimbursementCents: 0,
    otherCents: 0,
    netPayImpactCents: 0,
  };

  for (const line of lines) {
    const signedAmount = directionalAmountCents(line);
    switch (line.lineCategory) {
      case "earning":
        totals.grossPayCents += signedAmount;
        totals.netPayImpactCents += signedAmount;
        break;
      case "deduction":
        totals.deductionCents += signedAmount;
        totals.netPayImpactCents -= signedAmount;
        break;
      case "employee_tax":
        totals.employeeTaxCents += signedAmount;
        totals.netPayImpactCents -= signedAmount;
        break;
      case "employer_tax":
        totals.employerTaxCents += signedAmount;
        break;
      case "reimbursement":
        totals.reimbursementCents += signedAmount;
        totals.netPayImpactCents += signedAmount;
        break;
      case "other":
        totals.otherCents += signedAmount;
        break;
    }
  }

  return totals;
}
