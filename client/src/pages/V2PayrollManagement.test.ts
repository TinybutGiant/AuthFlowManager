import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const payrollSource = readFileSync("client/src/pages/V2PayrollManagement.tsx", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");
const accessSource = readFileSync("client/src/lib/v2StaffAccess.ts", "utf8");
const shellSource = readFileSync("client/src/components/V2Shell.tsx", "utf8");
const homeSource = readFileSync("client/src/pages/V2Home.tsx", "utf8");

test("V2 payroll page uses only the Access-backed V2 payroll API surface", () => {
  assert.match(payrollSource, /const V2_PAYROLL_BASE = "\/api\/v2\/payroll"/);
  assert.match(payrollSource, /credentials: "same-origin"/);
  assert.doesNotMatch(payrollSource, /\/api\/admin\/finance/);
  assert.doesNotMatch(payrollSource, /\/api\/v2\/finance/);
  assert.doesNotMatch(payrollSource, /\/api\/v2\/tax/);
  assert.doesNotMatch(payrollSource, /\/api\/v2\/personnel/);
  assert.doesNotMatch(payrollSource, /\/api\/admin\/personnel/);
  assert.doesNotMatch(payrollSource, /localStorage|auth_token|tokenManager|apiRequest/);
});

test("V2 payroll frontend route and navigation are gated by payroll_admin", () => {
  assert.match(appSource, /location === "\/v2\/payroll"/);
  assert.match(appSource, /<V2PayrollManagement \/>/);
  assert.match(accessSource, /key: "payroll"[\s\S]*permission: "payroll_admin"/);
  assert.match(shellSource, /payroll: WalletCards/);
  assert.match(homeSource, /payroll: WalletCards/);
  const payrollModule = accessSource.match(/\{\s*key: "payroll"[\s\S]*?\},/);
  assert.ok(payrollModule);
  assert.doesNotMatch(payrollModule[0], /finance_admin/);
});

test("V2 payroll source does not render legacy AP Billing, Tax, or full Personnel panes", () => {
  assert.doesNotMatch(payrollSource, /FinanceManagement|TaxManagement|PersonnelManagement/);
  assert.doesNotMatch(payrollSource, /taxAgencies|taxLiabilities|taxFilings|taxAgencyPayments|taxPaymentAllocations/);
  assert.doesNotMatch(payrollSource, /compensationTerms|workAuthorizations|adminEngagements/);
  assert.match(payrollSource, /employment-options/);
});
