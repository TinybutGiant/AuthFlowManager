import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("client/src/pages/V2FinanceManagement.tsx", "utf8");

test("V2 finance page uses only the Access-backed V2 finance API surface", () => {
  assert.match(source, /const V2_FINANCE_BASE = "\/api\/v2\/finance"/);
  assert.doesNotMatch(source, /\/api\/admin\/finance/);
  assert.doesNotMatch(source, /\/api\/v2\/finance\/payroll/);
  assert.doesNotMatch(source, /\/api\/v2\/finance\/tax/);
  assert.doesNotMatch(source, /localStorage|auth_token|tokenManager|apiRequest/);
  assert.match(source, /credentials: "same-origin"/);
});
