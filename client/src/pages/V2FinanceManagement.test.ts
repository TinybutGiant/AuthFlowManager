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

test("V2 finance read queries declare explicit V2 query functions", () => {
  const readPaths = [
    "/overview",
    "/legal-entities",
    "/vendors?pageSize=100",
    "/subscriptions?pageSize=100",
    "/bills?pageSize=100",
    "/payments?pageSize=100",
    "/bill-applications?pageSize=100",
    "/reconciliation-exceptions?pageSize=100",
  ];

  for (const path of readPaths) {
    assert.match(
      source,
      new RegExp(
        `queryKey:\\s*\\[\\\`\\$\\{V2_FINANCE_BASE\\}${path.replace(/[/?]/g, "\\$&")}\\\`\\],[\\s\\S]*?queryFn:\\s*\\(\\)\\s*=>\\s*v2FinanceJson`,
      ),
    );
  }
});

test("V2 finance restores AP notes without adding legacy finance coupling", () => {
  assert.match(source, /type FinanceVendor = \{[\s\S]*?notes\?: string \| null;[\s\S]*?\};/);
  assert.match(source, /type FinanceSubscription = \{[\s\S]*?notes\?: string \| null;[\s\S]*?\};/);
  assert.match(source, /type FinanceBill = \{[\s\S]*?notes\?: string \| null;[\s\S]*?\};/);

  assert.match(source, /notes: vendor\?\.notes \?\? ""/);
  assert.match(source, /notes: subscription\?\.notes \?\? ""/);
  assert.match(source, /notes: bill\?\.notes \?\? ""/);

  assert.equal((source.match(/<Label>Notes<\/Label>/g) ?? []).length, 3);
  assert.equal((source.match(/value=\{form\.notes\}/g) ?? []).length, 3);
  assert.equal((source.match(/notes: optionalNullableText\(form\.notes\)/g) ?? []).length, 3);
});

test("V2 finance uses loaded AP labels instead of raw IDs when available", () => {
  assert.match(source, /function legalEntityLabel\(entity: FinanceLegalEntity\)/);
  assert.match(source, /function vendorLabel\(vendor: FinanceVendor\)/);
  assert.match(source, /function billLabel\(bill: FinanceBill\)/);
  assert.match(source, /function subscriptionLabel\(subscription: FinanceSubscription\)/);
  assert.match(source, /function paymentLabel\(payment: FinancePayment\)/);

  assert.doesNotMatch(source, /options=\{legalEntities\.map\(\(entity\) => String\(entity\.id\)\)\}/);
  assert.doesNotMatch(source, /options=\{vendors\.map\(\(vendor\) => String\(vendor\.id\)\)\}/);
  assert.match(source, /targetBill \? billLabel\(targetBill\) : `Bill #\$\{application\.targetVendorBillId\}`/);
  assert.match(source, /payment\s*\?\s*paymentLabel\(payment\)/);
  assert.match(source, /credit\s*\?\s*billLabel\(credit\)/);
});

test("V2 finance has descriptive AP empty states with local actions", () => {
  for (const text of [
    "Add vendor bills as they arrive so due dates, balances, and receipts stay visible.",
    "Record an actual payment after money has moved or is in flight.",
    "Track SaaS, payroll providers, utilities, and services before invoices arrive.",
    "Add vendors before creating subscriptions, bills, or payment records.",
    "Open AP exceptions, duplicates, or amount mismatches will appear here.",
    "Payments and credits will appear here after they are applied to bills.",
  ]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(source, /FinancePageHeader|OverviewPanel|financeRolesQueryPrefix/);
});
