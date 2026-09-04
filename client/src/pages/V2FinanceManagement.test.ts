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

  assert.match(source, /queryKey: \[paymentQueryPath\(paymentPeriod, paymentScope, customPaymentFrom, customPaymentTo\)\]/);
  assert.match(source, /queryFn: \(\{ queryKey \}\) => v2FinanceJson<FinancePaymentLedger>\(String\(queryKey\[0\]\)\)/);
});

test("V2 finance shows payment-sourced spend metrics and payment details", () => {
  const overview = sourceBetween("type FinanceOverview", "type VendorForm");
  assert.match(overview, /paidThisMonthByCurrency: CurrencyAmount\[\];/);
  assert.match(overview, /paidYtdByCurrency: CurrencyAmount\[\];/);

  const metrics = sourceBetween("<div className=\"grid gap-4 md:grid-cols-3 xl:grid-cols-6\">", "<div className=\"flex flex-wrap gap-2\">");
  assertOrdered(metrics, [
    "Open bills",
    "Overdue",
    "Recurring expenses",
    "Open total",
    "Paid this month",
    "Paid YTD",
  ]);
  assert.match(metrics, /formatMoneyBreakdown\(overviewQuery\.data\?\.metrics\?\.paidThisMonthByCurrency\)/);
  assert.match(metrics, /formatMoneyBreakdown\(overviewQuery\.data\?\.metrics\?\.paidYtdByCurrency\)/);

  const paymentsTable = sourceBetween("{tab === \"payments\" && (", "{tab === \"subscriptions\" && (");
  assert.match(paymentsTable, /View stored payment method details and active bill applications\./);
  assert.match(paymentsTable, /setPaymentDetail\(payment\)/);
  assert.match(paymentsTable, /<Eye className="h-4 w-4" \/>View details/);

  const detailDialog = sourceBetween("function PaymentDetailDialog", "function ApplicationDialog");
  assert.match(detailDialog, /<DialogTitle>Payment Details<\/DialogTitle>/);
  assert.match(detailDialog, /activeApplicationsForPayment\(payment, applications\)/);
  assertOrdered(detailDialog, [
    "Vendor",
    "Legal entity",
    "Amount",
    "Payment date",
    "Direction",
    "Status",
    "Method",
    "Method label",
    "Institution",
    "Last 4",
    "Confirmation",
    "Applied Bills",
  ]);
  assert.match(detailDialog, /displayValue\(payment\.methodLabel\)/);
  assert.match(detailDialog, /displayValue\(payment\.institutionName\)/);
  assert.match(detailDialog, /displayValue\(payment\.maskedLast4\)/);
  assert.match(detailDialog, /displayValue\(payment\.externalConfirmationRef\)/);
  assert.match(detailDialog, /Bill #\$\{application\.targetVendorBillId\}/);
  assert.match(detailDialog, /No active bill applications\./);
  assert.doesNotMatch(detailDialog, /accountNumber|cardNumber|fullCard|fullAccount/i);
});

test("V2 finance makes overview metrics clickable saved ledger views", () => {
  assert.match(source, /import \{ useLocation, useSearch \} from "wouter";/);
  assert.match(source, /type PaymentPeriod = "this-month" \| "last-month" \| "ytd" \| "last-12-months" \| "all-time" \| "custom";/);
  assert.match(source, /type PaymentScope = "all" \| "completed-outflow";/);
  assert.match(source, /function financeTabFromLocation\(location: string\)/);
  assert.match(source, /function paymentQueryPath\(period: PaymentPeriod, scope: PaymentScope, paymentFrom: string, paymentTo: string\)/);
  assert.match(source, /function navigatePaymentPeriod\(period: PaymentPeriod/);
  assert.match(source, /setLocation\(financeUrl\(tab, params\)\)/);
  assert.match(source, /const search = useSearch\(\);/);
  assert.match(source, /const searchParams = React\.useMemo\(\(\) => new URLSearchParams\(search\), \[search\]\);/);
  assert.match(source, /const tab = financeTabFromLocation\(location\);/);
  assert.match(source, /const paymentPeriod = parsePaymentPeriod\(searchParams\.get\("period"\)\);/);
  assert.match(source, /const paymentScope = parsePaymentScope\(searchParams\.get\("scope"\), searchParams\.has\("period"\)\);/);
  assert.match(source, /const customPaymentFrom = searchParams\.get\("paymentFrom"\) \?\? "";/);
  assert.match(source, /const customPaymentTo = searchParams\.get\("paymentTo"\) \?\? "";/);

  const metrics = sourceBetween("<div className=\"grid gap-4 md:grid-cols-3 xl:grid-cols-6\">", "<div className=\"flex flex-wrap gap-2\">");
  assert.match(metrics, /onClick=\{\(\) => navigateFinance\("bills", \{ view: "open" \}\)\}/);
  assert.match(metrics, /onClick=\{\(\) => navigateFinance\("bills", \{ view: "overdue" \}\)\}/);
  assert.match(metrics, /onClick=\{\(\) => navigateFinance\("subscriptions", \{ view: "active" \}\)\}/);
  assert.match(metrics, /onClick=\{\(\) => navigatePaymentPeriod\("this-month"\)\}/);
  assert.match(metrics, /onClick=\{\(\) => navigatePaymentPeriod\("ytd"\)\}/);
});

test("V2 finance payments ledger exposes period filters and row subtotals", () => {
  const paymentsTable = sourceBetween("{tab === \"payments\" && (", "{tab === \"subscriptions\" && (");

  assert.match(source, /type FinancePaymentLedgerSummary = \{/);
  assert.match(source, /type FinancePaymentLedger = \{[\s\S]*?payments: FinancePayment\[\];[\s\S]*?summary: FinancePaymentLedgerSummary;[\s\S]*?\};/);
  assert.match(source, /const payments = paymentsQuery\.data\?\.payments \?\? \[\];/);
  assert.match(source, /const paymentTotals = paymentsQuery\.data\?\.summary \?\? paymentLedgerTotals\(payments\);/);
  for (const label of ["This month", "Last month", "YTD", "Last 12 months", "All time", "Custom range"]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assertOrdered(paymentsTable, [
    "<Label>Period</Label>",
    "paymentPeriods.map",
    "Completed AP spend",
    "Date",
    "Vendor",
    "Bill / Invoice",
    "Method",
    "Status",
    "Amount",
    "Applied",
    "Unapplied",
    "Actions",
    "View details",
    "{paymentTotals.count} payments",
    "Total",
    "Applied",
    "Unapplied",
  ]);
  assert.match(paymentsTable, /paymentBillInvoiceLabel\(payment, applications, billById\)/);
  assert.match(paymentsTable, /formatMoney\(payment\.activeAppliedAmountCents \?\? 0, payment\.currency\)/);
  assert.match(paymentsTable, /formatMoney\(payment\.remainingAmountCents \?\? payment\.amountCents, payment\.currency\)/);
  assert.match(paymentsTable, /formatMoneyBreakdown\(paymentTotals\.totalAmountByCurrency\)/);
  assert.match(paymentsTable, /formatMoneyBreakdown\(paymentTotals\.appliedAmountByCurrency\)/);
  assert.match(paymentsTable, /formatMoneyBreakdown\(paymentTotals\.unappliedAmountByCurrency\)/);
  assert.match(source, /function paymentLedgerTotals\(payments: FinancePayment\[\]\): FinancePaymentLedgerSummary/);
  assert.match(source, /totalAmountByCurrency\.set\(payment\.currency/);
  assert.match(source, /appliedByCurrency\.set\(payment\.currency/);
  assert.match(source, /unappliedByCurrency\.set\(payment\.currency/);
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
    "label=\"Recurring Expense (optional)\"",
    "<Label>Payment state</Label>",
    "label=\"Legal entity\"",
    "label=\"Vendor\"",
    "label=\"Kind\"",
    "label=\"Invoice number\"",
    "label=\"Actual amount\"",
    "label=\"Currency\"",
    "label=\"Category\"",
    "label=\"Issue date\"",
    "label=\"Due date\"",
    "label=\"Service start\"",
    "label=\"Service end\"",
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

test("V2 AP row actions explain bill and payment lifecycle", () => {
  assert.match(source, /TooltipTrigger asChild/);
  assert.match(source, /Move this draft bill into AP\. Receive it before approving, disputing, applying, or recording payment\./);
  assert.match(source, /Invoice received, pending approval\./);
  assert.match(source, /Confirm this bill is valid and ready to pay\./);
  assert.match(source, /Mark this bill as under dispute\. It should not be paid until resolved\./);
  assert.match(source, /Approve this bill, record an actual payment, and apply it in one transaction\./);
  assert.match(source, /Record an actual payment and apply it to this bill\./);
  assert.match(source, /Manually link an existing payment or credit to this bill\./);
  assert.match(source, /Cancel this bill without recording payment\./);
  assert.match(source, /Record a standalone payment\. Apply it to bills later if needed\./);
  assert.match(source, /Reverse this application without deleting the payment or bill\./);
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

test("V2 bill dialog asks for recurring expense first and keeps bill snapshots explicit", () => {
  const bill = sourceBetween("function BillDialog", "function PaymentDialog");
  const prefill = sourceBetween("function billFormWithRecurringExpense", "function paymentFormFrom");
  const submit = sourceBetween("function submitBill", "function submitPayment");

  assert.match(source, /\{ value: "none", label: "None — One-time bill" \}/);
  assertOrdered(bill, [
    "label=\"Recurring Expense (optional)\"",
    "options={recurringExpenseOptions(availableSubscriptions)}",
    "onValueChange={handleRecurringExpenseChange}",
    "recurringExpenseContextSummary(selectedRecurringExpense)",
    "<ReadOnlyField",
    "helper=\"From recurring expense\"",
    "<LegalEntityField",
    "label=\"Vendor\"",
    "label=\"Actual amount\"",
  ]);

  assert.match(prefill, /recurringExpenseId: String\(subscription\.id\)/);
  assert.match(prefill, /legalEntityId: String\(subscription\.legalEntityId\)/);
  assert.match(prefill, /vendorId: String\(subscription\.vendorId\)/);
  assert.match(prefill, /amount: subscription\.expectedAmountCents == null \? form\.amount : centsToMoney\(subscription\.expectedAmountCents\)/);
  assert.match(prefill, /currency: subscription\.currency/);
  assert.match(prefill, /categoryCode: subscription\.categoryCode/);
  assert.doesNotMatch(prefill, /issueDate|dueDate|servicePeriodStart|servicePeriodEnd|nextBillingDate|renewalDate/);

  assert.match(bill, /if \(recurringExpenseId === "none"\) \{\s*setForm\(\{ \.\.\.form, recurringExpenseId: "" \}\);/);
  assert.match(source, /function recurringExpenseContextSummary\(subscription: FinanceSubscription\)/);
  assert.match(source, /Expected \$\{formatMoney\(subscription\.expectedAmountCents, subscription\.currency\)\} \$\{subscription\.currency\}/);
  assert.match(source, /nextBill \? `Next bill \$\{nextBill\}` : null/);
  assert.match(bill, /<ReadOnlyField label="Currency" value=\{selectedRecurringExpense\.currency\} helper="From recurring expense" \/>/);
  assert.match(bill, /<TextField label="Currency" value=\{form\.currency\}/);
  assert.match(bill, /<ReadOnlyField label="Category" value=\{humanize\(selectedRecurringExpense\.categoryCode\)\} helper="From recurring expense" \/>/);
  assert.match(bill, /<TextField label="Category" value=\{form\.categoryCode\}/);
  assert.match(bill, /<TextField label="Actual amount" type="number" value=\{form\.amount\}/);
  assert.match(submit, /const selectedRecurringExpense = selectedRecurringExpenseFromForm\(subscriptions, form\);/);
  assert.match(submit, /vendorId: selectedRecurringExpense\?\.vendorId \?\? Number\(form\.vendorId\)/);
  assert.match(submit, /recurringExpenseId: selectedRecurringExpense\?\.id \?\? optionalNullableNumber\(form\.recurringExpenseId\)/);
  assert.match(submit, /amountCents: moneyToCents\(form\.amount\)/);
  assert.match(submit, /currency: \(selectedRecurringExpense\?\.currency \?\? form\.currency\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(submit, /categoryCode: selectedRecurringExpense\?\.categoryCode \?\? form\.categoryCode\.trim\(\)/);
  assert.match(submit, /legalEntityId: selectedRecurringExpense\?\.legalEntityId \?\? parseRequiredLegalEntityId\(form\.legalEntityId\)/);
  assert.doesNotMatch(sourceBetween("type FinanceSubscription", "type FinanceBill"), /invoiceNumber/);
});

test("V2 already-paid bill intake is a single atomic create command", () => {
  const billForm = sourceBetween("type BillForm", "type PaymentForm");
  const billDialog = sourceBetween("function BillDialog", "function PaymentDialog");
  const submit = sourceBetween("function submitBill", "function submitPayment");

  assert.match(billForm, /paymentState: "unpaid" \| "already_paid";/);
  assert.match(billForm, /paymentDate: string;/);
  assert.match(billForm, /paymentMethodType: string;/);
  assert.match(source, /const paymentMethodPlaceholder = "__select_payment_method";/);
  assert.match(source, /paymentState: "unpaid"/);
  assert.match(source, /paymentMethodType: paymentMethodPlaceholder/);

  assertOrdered(billDialog, [
    "label=\"Recurring Expense (optional)\"",
    "<Label>Payment state</Label>",
    "Unpaid / pay later",
    "Already paid",
    "Payment details",
    "label=\"Payment date\"",
    "label=\"Method\"",
    "label=\"Institution\"",
    "label=\"Last 4\"",
    "label=\"Confirmation\"",
  ]);
  assert.match(billDialog, /const isAlreadyPaid = isCreate && form\.paymentState === "already_paid"/);
  assert.match(billDialog, /form\.paymentDate\.trim\(\)\.length > 0/);
  assert.match(billDialog, /form\.paymentMethodType !== paymentMethodPlaceholder/);
  assert.match(billDialog, /<Button type="submit" disabled=\{!canSubmit\}>\{isSubmitting \? "Saving" : "Save"\}<\/Button>/);
  assert.match(billDialog, /if \(canSubmit\) onSubmit\(form\)/);

  assert.match(submit, /form\.paymentState === "already_paid"/);
  assert.match(submit, /`\$\{V2_FINANCE_BASE\}\/bills\/record-paid`/);
  assert.match(submit, /const \{ status: _status, \.\.\.recordPaidBody \} = body;/);
  assert.match(submit, /paymentDate: form\.paymentDate\.trim\(\)/);
  assert.match(submit, /methodType: form\.paymentMethodType/);
  assert.match(submit, /maskedLast4: optionalText\(form\.paymentMaskedLast4\)/);
  assert.match(submit, /externalConfirmationRef: optionalNullableText\(form\.paymentExternalConfirmationRef\)/);
  assert.doesNotMatch(submit, /record-paid[\s\S]*invoiceNumber[\s\S]*externalConfirmationRef: optionalNullableText\(form\.invoiceNumber\)/);
  assert.doesNotMatch(submit, /record-paid[\s\S]*\/record-payment/);
});

test("V2 bill row actions are state-aware and keep manual apply secondary", () => {
  assert.match(source, /function canVoidBillDirectly\(bill: FinanceBill\)/);
  assert.match(source, /bill\.settlementState !== "paid"/);
  assert.match(source, /bill\.settlementState !== "partially_paid"/);
  assert.match(source, /bill\.settlementState !== "overpaid"/);
  assert.match(source, /function canRecordBillPayment\(bill: FinanceBill\)/);
  assert.match(source, /bill\.status === "approved" && billHasOpenBalance\(bill\)/);
  assert.match(source, /function canApproveAndRecordBillPayment\(bill: FinanceBill\)/);
  assert.match(source, /bill\.status === "received" && billHasOpenBalance\(bill\)/);
  assert.match(source, /function canManuallyApplyToBill\(bill: FinanceBill\)/);

  const billsTable = sourceBetween("{tab === \"bills\" && (", "{tab === \"payments\" && (");
  assert.match(billsTable, /canApproveAndRecordBillPayment\(bill\)/);
  assert.match(billsTable, /openBillPaymentDialog\(bill, true\)/);
  assert.match(billsTable, /Approve & pay/);
  assert.match(billsTable, /bill\.status === "received" && billHasOpenBalance\(bill\)/);
  assert.match(billsTable, /canRecordBillPayment\(bill\)/);
  assert.match(billsTable, /openBillPaymentDialog\(bill\)/);
  assert.match(billsTable, /canManuallyApplyToBill\(bill\)/);
  assert.match(billsTable, /canVoidBillDirectly\(bill\)/);
  assert.doesNotMatch(billsTable, /bill\.status !== "voided" && \(/);
});

test("V2 bill-first record payment keeps payment allocation workflow off the data model", () => {
  const paymentForm = sourceBetween("function paymentFormFrom", "function applicationFormFrom");
  const paymentDialog = sourceBetween("function PaymentDialog", "function ApplicationDialog");
  const submit = sourceBetween("function submitPayment", "function submitApplication");
  const sourceBillSubmit = sourceBetween("} else if (paymentDialog?.sourceBill) {", "} else {");

  assert.match(source, /type PaymentDialogState = \{[\s\S]*?sourceBill\?: FinanceBill;[\s\S]*?approveBillFirst\?: boolean;[\s\S]*?\};/);
  assert.match(source, /function openBillPaymentDialog\(bill: FinanceBill, approveBillFirst = false\)/);
  assert.match(source, /sourceBill: bill/);
  assert.match(source, /approveBillFirst/);
  assert.match(source, /paymentFormFrom\(legalEntities, activeVendors, undefined, bill\)/);
  assert.match(source, /<ActionTooltip content="Record an actual payment and apply it to this bill\.">[\s\S]*?<Button size="sm" variant="outline" onClick=\{\(\) => openBillPaymentDialog\(bill\)\}><WalletCards className="h-4 w-4" \/>Record payment<\/Button>[\s\S]*?<\/ActionTooltip>/);
  assert.doesNotMatch(sourceBetween("type FinancePayment", "type FinanceBillApplication"), /billId|vendorBillId|targetVendorBillId/);

  assert.match(paymentForm, /sourceBill\?: FinanceBill/);
  assert.match(paymentForm, /legalEntityId: sourceBill \? String\(sourceBill\.legalEntityId\) : getInitialLegalEntityId\(legalEntities, payment\?\.legalEntityId\)/);
  assert.match(paymentForm, /vendorId: sourceBill \? String\(sourceBill\.vendorId\) : payment\?\.vendorId == null/);
  assert.match(paymentForm, /amount: centsToMoney\(sourceBill \? sourceBill\.remainingAmountCents \?\? sourceBill\.amountCents : payment\?\.amountCents \?\? 0\)/);
  assert.match(paymentForm, /currency: sourceBill\?\.currency \?\? payment\?\.currency \?\? "USD"/);
  assert.match(paymentForm, /paymentDate: payment\?\.paymentDate \?\? ""/);
  assert.match(paymentForm, /status: payment\?\.status \?\? ""/);

  assertOrdered(paymentDialog, [
    "Bill: {sourceBillPaymentLabel(sourceBill)}",
    "Remaining:",
    "label=\"Legal entity\"",
    "helper=\"From bill\"",
    "label=\"Vendor\"",
    "label=\"Amount\"",
    "label=\"Currency\"",
    "label=\"Direction\"",
    "label=\"Payment date\"",
    "label=\"Method\"",
    "label=\"Initial status\"",
  ]);
  assert.match(paymentDialog, /<ReadOnlyField[\s\S]*label="Legal entity"[\s\S]*helper="From bill"/);
  assert.match(paymentDialog, /<ReadOnlyField[\s\S]*label="Vendor"[\s\S]*helper="From bill"/);
  assert.match(paymentDialog, /<ReadOnlyField label="Currency" value=\{sourceBill\.currency\} helper="From bill" \/>/);
  assert.match(paymentDialog, /<TextField label="Amount" type="number" value=\{form\.amount\}/);
  assert.match(paymentDialog, /<TextField label="Payment date" type="date"[\s\S]*required \/>/);
  assert.match(paymentDialog, /const statusOptions = sourceBill \? billFirstPaymentStatuses : paymentStatuses/);
  assert.match(source, /const billFirstPaymentStatuses = \["posted", "cleared"\]/);
  assert.match(paymentDialog, /value=\{selectedStatusValue\}/);
  assert.match(paymentDialog, /status === paymentStatusPlaceholder \? "" : status/);
  assert.match(paymentDialog, /disabled=\{!canSubmit\}/);
  assert.match(paymentDialog, /isSubmitting \? "Saving" : "Save"/);

  assert.match(submit, /paymentDate: form\.paymentDate\.trim\(\)/);
  assert.match(sourceBillSubmit, /POST/);
  assert.match(sourceBillSubmit, /approve-and-record-payment/);
  assert.match(sourceBillSubmit, /record-payment/);
  assert.match(sourceBillSubmit, /paymentFacts/);
  assert.doesNotMatch(sourceBillSubmit, /legalEntityId|vendorId|currency|invoiceNumber/);
});
