import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("client/src/pages/V2FinanceManagement.tsx", "utf8");

function sourceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(haystack: string, markers: string[]) {
  let cursor = -1;
  for (const marker of markers) {
    const index = haystack.indexOf(marker, cursor + 1);
    assert.notEqual(index, -1, `Missing ordered marker: ${marker}`);
    assert.ok(index > cursor, `Marker out of order: ${marker}`);
    cursor = index;
  }
}

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
  assert.match(source, /type FinanceSubscription = \{[\s\S]*?name: string;[\s\S]*?notes\?: string \| null;[\s\S]*?\};/);
  assert.match(source, /type FinanceBill = \{[\s\S]*?notes\?: string \| null;[\s\S]*?\};/);

  assert.match(source, /notes: vendor\?\.notes \?\? ""/);
  assert.match(source, /notes: subscription\?\.notes \?\? ""/);
  assert.match(source, /notes: bill\?\.notes \?\? ""/);

  assert.equal((source.match(/<Label>Notes<\/Label>/g) ?? []).length, 3);
  assert.equal((source.match(/value=\{form\.notes\}/g) ?? []).length, 3);
  assert.equal((source.match(/notes: optionalNullableText\(form\.notes\)/g) ?? []).length, 3);
});

test("V2 finance uses loaded AP labels instead of raw IDs when available", () => {
  assert.match(source, /LegalEntityField/);
  assert.match(source, /function vendorLabel\(vendor: FinanceVendor\)/);
  assert.match(source, /function billLabel\(bill: FinanceBill\)/);
  assert.match(source, /function subscriptionLabel\(subscription: FinanceSubscription\)/);
  assert.match(source, /function paymentLabel\(payment: FinancePayment\)/);
  assert.match(source, /return `\$\{vendor\} - \$\{subscription\.name\}`;/);

  assert.doesNotMatch(source, /options=\{legalEntities\.map\(\(entity\) => String\(entity\.id\)\)\}/);
  assert.doesNotMatch(source, /options=\{vendors\.map\(\(vendor\) => String\(vendor\.id\)\)\}/);
  assert.doesNotMatch(source, /Cloudflare - saas - \$10\.46/);
  assert.match(source, /targetBill \? billLabel\(targetBill\) : `Bill #\$\{application\.targetVendorBillId\}`/);
  assert.match(source, /payment\s*\?\s*paymentLabel\(payment\)/);
  assert.match(source, /credit\s*\?\s*billLabel\(credit\)/);
});

test("V2 finance handles legal entity configuration explicitly", () => {
  assert.match(source, /getInitialLegalEntityId\(legalEntities, subscription\?\.legalEntityId\)/);
  assert.match(source, /getInitialLegalEntityId\(legalEntities, bill\?\.legalEntityId\)/);
  assert.match(source, /getInitialLegalEntityId\(legalEntities, payment\?\.legalEntityId\)/);
  assert.match(source, /parseRequiredLegalEntityId\(form\.legalEntityId\)/);
  assert.match(source, /Legal entity configuration required/);
  assert.match(source, /disabled=\{!canCreateLegalEntityScopedRecord\}/);
  assert.doesNotMatch(source, /Number\(form\.legalEntityId\)/);
});

test("V2 AP dialogs preserve legacy field order and explicit row structure", () => {
  const vendor = sourceBetween("function VendorDialog", "function SubscriptionDialog");
  assertOrdered(vendor, [
    "className=\"space-y-4\"",
    "label=\"Name\"",
    "label=\"Type\"",
    "label=\"Status\"",
    "label=\"Contact email\"",
    "label=\"Website\"",
    "<Label>Notes</Label>",
    "<DialogFooter>",
  ]);
  assert.match(vendor, /<div className="grid gap-4 sm:grid-cols-2">\s*<TextField label="Name"[\s\S]*?<SelectField label="Type"/);
  assert.match(vendor, /<div className="grid gap-4 sm:grid-cols-2">\s*<SelectField label="Status"[\s\S]*?<TextField label="Contact email"/);

  const subscription = sourceBetween("function SubscriptionDialog", "function BillDialog");
  assert.match(subscription, /<DialogContent className="sm:max-w-2xl">/);
  assert.match(subscription, /Edit Recurring Expense/);
  assert.match(subscription, /Add Recurring Expense/);
  assertOrdered(subscription, [
    "className=\"space-y-4\"",
    "<LegalEntityField",
    "label=\"Vendor\"",
    "label=\"Name\"",
    "label=\"Category\"",
    "label=\"Cadence\"",
    "label=\"Expected amount\"",
    "label=\"Currency\"",
    "label={billingDayLabel}",
    "label=\"Next bill date\"",
    "label=\"Renewal date\"",
    "label=\"Trial ends\"",
    "label=\"Initial status\"",
    "Variable amount",
    "Auto renew",
    "<Label>Notes</Label>",
  ]);

  const bill = sourceBetween("function BillDialog", "function PaymentDialog");
  assert.match(bill, /<DialogContent className="sm:max-w-3xl">/);
  assertOrdered(bill, [
    "className=\"space-y-4\"",
    "<LegalEntityField",
    "label=\"Vendor\"",
    "label=\"Kind\"",
    "label=\"Invoice number\"",
    "label=\"Amount\"",
    "label=\"Currency\"",
    "label=\"Category\"",
    "label=\"Issue date\"",
    "label=\"Due date\"",
    "label=\"Service start\"",
    "label=\"Service end\"",
    "label=\"Recurring Expense\"",
    "label=\"Credit source\"",
    "<Label>Notes</Label>",
  ]);

  const payment = sourceBetween("function PaymentDialog", "function ApplicationDialog");
  assert.match(payment, /<DialogContent className="sm:max-w-2xl">/);
  assertOrdered(payment, [
    "className=\"space-y-4\"",
    "<LegalEntityField",
    "label=\"Vendor\"",
    "label=\"Amount\"",
    "label=\"Currency\"",
    "label=\"Direction\"",
    "label=\"Payment date\"",
    "label=\"Method\"",
    "label=\"Initial status\"",
    "label=\"Method label\"",
    "label=\"Institution\"",
    "label=\"Last 4\"",
    "label=\"Confirmation\"",
  ]);

  const application = sourceBetween("function ApplicationDialog", "function ReconciliationDialog");
  assert.match(application, /<DialogContent className="sm:max-w-2xl">/);
  assertOrdered(application, [
    "className=\"space-y-4\"",
    "label=\"Target bill\"",
    "label=\"Source type\"",
    "label=\"Payment\"",
    "label=\"Credit memo\"",
    "label=\"Amount\"",
    "label=\"Currency\"",
  ]);
});

test("V2 finance has descriptive AP empty states with local actions", () => {
  for (const text of [
    "Add vendor bills as they arrive so due dates, balances, and receipts stay visible.",
    "Record an actual payment after money has moved or is in flight.",
    "Track SaaS, payroll providers, utilities, and services before bills arrive.",
    "Add vendors before creating recurring expenses, bills, or payment records.",
    "Open AP exceptions, duplicates, or amount mismatches will appear here.",
    "Payments and credits will appear here after they are applied to bills.",
  ]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(source, /FinancePageHeader|OverviewPanel|financeRolesQueryPrefix/);
});

test("V2 finance presents recurring expenses as named obligations", () => {
  assert.match(source, /\{ value: "subscriptions", label: "Recurring Expenses" \}/);
  assert.match(source, /name: subscription\?\.name \?\? ""/);
  assert.match(source, /name: form\.name\.trim\(\)/);
  assert.match(source, /expectedAmountCents: form\.variableAmount && !form\.expectedAmount\.trim\(\) \? null : moneyToCents\(form\.expectedAmount, true\)/);
  assert.match(source, /form\.name\.trim\(\)\.length > 0/);
  assert.match(source, /title="Recurring Expenses"/);
  assert.match(source, /Recurring Expense/);
  assert.match(source, /No recurring expenses yet/);
  assert.match(source, /recurringExpenseSummary\(subscription\)/);
});
