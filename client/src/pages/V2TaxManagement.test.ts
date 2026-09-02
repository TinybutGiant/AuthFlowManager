import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taxSource = readFileSync("client/src/pages/V2TaxManagement.tsx", "utf8");
const panelSource = readFileSync("client/src/pages/FinanceTaxPanel.tsx", "utf8");
const financeSource = readFileSync("client/src/pages/FinanceManagement.tsx", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");
const accessSource = readFileSync("client/src/lib/v2StaffAccess.ts", "utf8");
const shellSource = readFileSync("client/src/components/V2Shell.tsx", "utf8");
const homeSource = readFileSync("client/src/pages/V2Home.tsx", "utf8");

test("V2 tax page uses only the Access-backed V2 Tax API surface", () => {
  assert.match(taxSource, /const V2_TAX_BASE = "\/api\/v2\/tax"/);
  assert.match(taxSource, /credentials: "same-origin"/);
  assert.doesNotMatch(taxSource, /\/api\/admin\/finance/);
  assert.doesNotMatch(taxSource, /\/api\/v2\/finance/);
  assert.doesNotMatch(taxSource, /\/api\/v2\/payroll/);
  assert.doesNotMatch(taxSource, /\/api\/v2\/personnel/);
  assert.doesNotMatch(taxSource, /\/api\/admin\/personnel/);
  assert.doesNotMatch(taxSource, /localStorage|auth_token|tokenManager|apiRequest|getApiErrorMessage/);
});

test("shared Tax panel is request-injected so V2 does not import legacy queryClient", () => {
  assert.match(panelSource, /apiBase: string/);
  assert.match(panelSource, /requestJson: TaxRequestJson/);
  assert.match(financeSource, /apiBase="\/api\/admin\/finance\/tax"/);
  assert.match(financeSource, /requestJson=\{legacyTaxRequestJson\}/);
  assert.doesNotMatch(panelSource, /@\/lib\/queryClient|apiRequest|tokenManager|auth_token|localStorage/);
});

test("V2 tax frontend route and navigation are gated by tax_admin", () => {
  assert.match(appSource, /location === "\/v2\/tax"/);
  assert.match(appSource, /<V2TaxManagement \/>/);
  assert.match(accessSource, /key: "tax"[\s\S]*permission: "tax_admin"/);
  assert.match(shellSource, /tax: Landmark/);
  assert.match(homeSource, /tax: Landmark/);
  const taxModule = accessSource.match(/\{\s*key: "tax"[\s\S]*?\},/);
  assert.ok(taxModule);
  assert.doesNotMatch(taxModule[0], /finance_admin|payroll_admin|verifier_admin|admin_operations/);
});

test("V2 tax source does not render AP Billing, Payroll, or full Personnel panes", () => {
  assert.doesNotMatch(taxSource, /FinanceManagement|V2FinanceManagement|V2PayrollManagement|PersonnelManagement/);
  assert.doesNotMatch(taxSource, /\/api\/admin\/finance|\/api\/v2\/finance|\/api\/v2\/payroll|\/api\/admin\/personnel/);
  assert.doesNotMatch(panelSource, /PayrollManagement|PersonnelManagement|payrollRuns|vendorBills|expensePayments/);
});

test("V2 tax handles legal entity configuration through the shared panel", () => {
  assert.match(panelSource, /LegalEntityField/);
  assert.match(panelSource, /getInitialLegalEntityId\(legalEntities\)/);
  assert.match(panelSource, /Legal entity configuration required/);
  assert.match(panelSource, /disabled=\{isPending \|\| !canSubmit\}/);
  assert.match(panelSource, /legalEntityId: parsePositiveId\(form\.legalEntityId, "Legal entity"\)/);
});
