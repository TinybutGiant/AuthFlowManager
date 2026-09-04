import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  Archive,
  Building2,
  CheckCircle2,
  Edit3,
  Eye,
  Link2,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  WalletCards,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getInitialLegalEntityId,
  legalEntityDisplayName,
  LegalEntityField,
  parseRequiredLegalEntityId,
} from "@/components/finance/LegalEntityField";
import { useToast } from "@/hooks/use-toast";

type FinanceTab = "bills" | "payments" | "subscriptions" | "vendors" | "reconciliation";
type PaymentPeriod = "this-month" | "last-month" | "ytd" | "last-12-months" | "all-time" | "custom";
type PaymentScope = "all" | "completed-outflow";
type BillView = "all" | "open" | "overdue";
type SubscriptionView = "all" | "active";

type FinanceLegalEntity = {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
};

type FinanceVendor = {
  id: number;
  name: string;
  vendorType: string;
  status: string;
  website?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
};

type FinanceSubscription = {
  id: number;
  legalEntityId: number;
  vendorId: number;
  vendorName?: string | null;
  name: string;
  categoryCode: string;
  cadence: string;
  expectedAmountCents?: number | null;
  currency: string;
  variableAmount: boolean;
  billingDay?: number | null;
  nextBillingDate?: string | null;
  renewalDate?: string | null;
  autoRenew: boolean;
  trialEndsOn?: string | null;
  cancellationDate?: string | null;
  status: string;
  notes?: string | null;
};

type FinanceBill = {
  id: number;
  legalEntityId: number;
  vendorId: number;
  vendorName?: string | null;
  recurringExpenseId?: number | null;
  invoiceNumber?: string | null;
  billKind: string;
  issueDate?: string | null;
  dueDate?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  amountCents: number;
  currency: string;
  categoryCode: string;
  status: string;
  creditForVendorBillId?: number | null;
  activeAppliedAmountCents?: number;
  remainingAmountCents?: number;
  settlementState?: string;
  documentCount?: number;
  recurringExpectedAmountCents?: number | null;
  notes?: string | null;
};

type FinancePayment = {
  id: number;
  legalEntityId?: number;
  vendorId?: number | null;
  vendorName?: string | null;
  amountCents: number;
  currency: string;
  direction: string;
  paymentDate?: string | null;
  methodType: string;
  methodLabel?: string | null;
  institutionName?: string | null;
  maskedLast4?: string | null;
  externalConfirmationRef?: string | null;
  status: string;
  activeAppliedAmountCents?: number;
  remainingAmountCents?: number;
};

type FinancePaymentLedgerSummary = {
  count: number;
  totalAmountByCurrency: CurrencyAmount[];
  appliedAmountByCurrency: CurrencyAmount[];
  unappliedAmountByCurrency: CurrencyAmount[];
};

type FinancePaymentLedger = {
  payments: FinancePayment[];
  summary: FinancePaymentLedgerSummary;
};

type FinanceBillApplication = {
  id: number;
  targetVendorBillId: number;
  expensePaymentId?: number | null;
  creditVendorBillId?: number | null;
  amountCents: number;
  currency: string;
  status: string;
};

type FinanceReconciliationException = {
  id: number;
  domain: "ap";
  expectedEntityType?: string | null;
  expectedEntityId?: number | null;
  actualEntityType?: string | null;
  actualEntityId?: number | null;
  currency?: string | null;
  expectedAmountCents?: number | null;
  actualAmountCents?: number | null;
  differenceAmountCents: number;
  reasonCode: string;
  summary: string;
  status: string;
};

type CurrencyAmount = {
  currency: string;
  amountCents: number;
};

type FinanceOverview = {
  asOfDate?: string;
  metrics?: {
    openBillsCount: number;
    overdueBillsCount: number;
    openReconciliationIssuesCount: number;
    activeSubscriptionsCount: number;
    openBillTotalsByCurrency: CurrencyAmount[];
    paidThisMonthByCurrency: CurrencyAmount[];
    paidYtdByCurrency: CurrencyAmount[];
  };
};

type VendorForm = {
  name: string;
  vendorType: string;
  status: string;
  website: string;
  contactEmail: string;
  notes: string;
};

type SubscriptionForm = {
  legalEntityId: string;
  vendorId: string;
  name: string;
  categoryCode: string;
  cadence: string;
  expectedAmount: string;
  currency: string;
  variableAmount: boolean;
  billingDay: string;
  nextBillingDate: string;
  renewalDate: string;
  autoRenew: boolean;
  trialEndsOn: string;
  notes: string;
  status: string;
};

type BillForm = {
  legalEntityId: string;
  vendorId: string;
  recurringExpenseId: string;
  paymentState: "unpaid" | "already_paid";
  invoiceNumber: string;
  billKind: string;
  issueDate: string;
  dueDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  amount: string;
  currency: string;
  categoryCode: string;
  creditForVendorBillId: string;
  notes: string;
  paymentDate: string;
  paymentMethodType: string;
  paymentMethodLabel: string;
  paymentInstitutionName: string;
  paymentMaskedLast4: string;
  paymentExternalConfirmationRef: string;
};

type PaymentForm = {
  legalEntityId: string;
  vendorId: string;
  amount: string;
  currency: string;
  direction: string;
  paymentDate: string;
  methodType: string;
  methodLabel: string;
  institutionName: string;
  maskedLast4: string;
  externalConfirmationRef: string;
  status: string;
};

type PaymentDialogState = {
  mode: "create" | "edit";
  payment?: FinancePayment;
  sourceBill?: FinanceBill;
  approveBillFirst?: boolean;
  form: PaymentForm;
};

type ApplicationForm = {
  sourceType: "payment" | "credit";
  targetVendorBillId: string;
  expensePaymentId: string;
  creditVendorBillId: string;
  amount: string;
  currency: string;
};

type ReconciliationForm = {
  reasonCode: string;
  summary: string;
  expectedEntityType: string;
  expectedEntityId: string;
  actualEntityType: string;
  actualEntityId: string;
  currency: string;
  expectedAmount: string;
  actualAmount: string;
};

type SelectOption = string | { value: string; label: string };

const V2_FINANCE_BASE = "/api/v2/finance";
const tabs: Array<{ value: FinanceTab; label: string }> = [
  { value: "bills", label: "Bills" },
  { value: "payments", label: "Payments" },
  { value: "subscriptions", label: "Recurring Expenses" },
  { value: "vendors", label: "Vendors" },
  { value: "reconciliation", label: "Reconciliation" },
];
const paymentPeriods: Array<{ value: PaymentPeriod; label: string }> = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "ytd", label: "YTD" },
  { value: "last-12-months", label: "Last 12 months" },
  { value: "all-time", label: "All time" },
  { value: "custom", label: "Custom range" },
];
const paymentPeriodValues = new Set<PaymentPeriod>(paymentPeriods.map((period) => period.value));
const billViewValues = new Set<BillView>(["all", "open", "overdue"]);
const subscriptionViewValues = new Set<SubscriptionView>(["all", "active"]);

const vendorTypes = ["saas", "cloud", "utility", "professional_service", "contractor_vendor", "supplier", "other"];
const vendorStatuses = ["active", "inactive", "archived"];
const cadences = ["weekly", "monthly", "quarterly", "annual", "custom"];
const subscriptionStatuses = ["draft", "trial", "active", "paused", "cancelled", "expired"];
const billKinds = ["invoice", "bill", "credit_memo", "statement", "other"];
const paymentMethods = ["provider", "ach", "check", "card", "wire", "manual", "other"];
const paymentStatuses = ["pending", "posted", "cleared", "failed", "voided"];
const billFirstPaymentStatuses = ["posted", "cleared"];
const paymentStatusPlaceholder = "__select_status";
const paymentMethodPlaceholder = "__select_payment_method";
const reconciliationReasons = [
  "unmatched_payment",
  "amount_mismatch",
  "duplicate_charge",
  "missing_invoice",
  "missing_receipt",
  "stale_unpaid_bill",
  "other_ap_mismatch",
];
const reconciliationEntityTypes = [
  "vendors",
  "recurring_expenses",
  "vendor_bills",
  "expense_payments",
  "vendor_bill_applications",
];

async function v2FinanceJson<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : response.statusText;
    const code =
      body && typeof body === "object" && "code" in body
        ? String((body as { code: unknown }).code)
        : message;
    throw new Error(`${code}: ${message}`);
  }

  return body as T;
}

function moneyToCents(value: string, optional = false) {
  const trimmed = value.trim();
  if (!trimmed && optional) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be positive.");
  }
  return Math.round(amount * 100);
}

function centsToMoney(value?: number | null) {
  return value == null ? "" : (value / 100).toFixed(2);
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : undefined;
}

function optionalNullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function optionalNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function humanize(value?: string | null) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "-";
}

function formatMoney(amountCents?: number | null, currency = "USD") {
  if (amountCents == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function formatMoneyBreakdown(rows?: CurrencyAmount[]) {
  return rows?.map((row) => formatMoney(row.amountCents, row.currency)).join(" / ") || "$0.00";
}

function formatDate(value?: string | null) {
  return value ? value : "-";
}

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatShortDate(value?: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function vendorLabel(vendor: FinanceVendor) {
  return vendor.name || `Vendor #${vendor.id}`;
}

function billLabel(bill: FinanceBill) {
  const vendor = bill.vendorName || `Vendor #${bill.vendorId}`;
  const reference = bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : humanize(bill.categoryCode);
  return `${vendor} - ${reference} - ${formatMoney(bill.amountCents, bill.currency)}`;
}

function billReferenceLabel(bill: FinanceBill) {
  return bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : humanize(bill.categoryCode);
}

function sourceBillPaymentLabel(bill: FinanceBill) {
  const vendor = bill.vendorName || `Vendor #${bill.vendorId}`;
  return `${billReferenceLabel(bill)} - ${vendor}`;
}

function billRemainingAmountCents(bill: FinanceBill) {
  return bill.remainingAmountCents ?? bill.amountCents;
}

function billHasActiveApplications(bill: FinanceBill) {
  return (bill.activeAppliedAmountCents ?? 0) > 0;
}

function billHasOpenBalance(bill: FinanceBill) {
  return billRemainingAmountCents(bill) > 0;
}

function canVoidBillDirectly(bill: FinanceBill) {
  return bill.status !== "voided" &&
    bill.settlementState !== "paid" &&
    bill.settlementState !== "partially_paid" &&
    bill.settlementState !== "overpaid" &&
    !billHasActiveApplications(bill);
}

function canRecordBillPayment(bill: FinanceBill) {
  return bill.billKind !== "credit_memo" && bill.status === "approved" && billHasOpenBalance(bill);
}

function canApproveAndRecordBillPayment(bill: FinanceBill) {
  return bill.billKind !== "credit_memo" && bill.status === "received" && billHasOpenBalance(bill);
}

function canManuallyApplyToBill(bill: FinanceBill) {
  return bill.billKind !== "credit_memo" && bill.status === "approved" && billHasOpenBalance(bill);
}

function subscriptionLabel(subscription: FinanceSubscription) {
  const vendor = subscription.vendorName || `Vendor #${subscription.vendorId}`;
  return `${vendor} - ${subscription.name}`;
}

function recurringExpenseSummary(subscription: FinanceSubscription) {
  const vendor = subscription.vendorName || `Vendor #${subscription.vendorId}`;
  const amount = subscription.variableAmount ? "Variable" : formatMoney(subscription.expectedAmountCents, subscription.currency);
  return `${vendor} - ${humanize(subscription.cadence)} - ${amount}`;
}

function recurringExpenseContextSummary(subscription: FinanceSubscription) {
  const amount = subscription.expectedAmountCents == null
    ? "Variable amount"
    : `Expected ${formatMoney(subscription.expectedAmountCents, subscription.currency)} ${subscription.currency}`;
  const nextBill = formatShortDate(subscription.nextBillingDate);
  return [
    humanize(subscription.cadence),
    amount,
    nextBill ? `Next bill ${nextBill}` : null,
  ].filter(Boolean).join(" - ");
}

function paymentLabel(payment: FinancePayment) {
  const vendor = payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned");
  const reference = payment.externalConfirmationRef || payment.methodLabel || humanize(payment.methodType);
  return `${vendor} - ${reference} - ${formatMoney(payment.amountCents, payment.currency)}`;
}

function activeApplicationsForPayment(payment: FinancePayment, applications: FinanceBillApplication[]) {
  return applications.filter((application) => application.expensePaymentId === payment.id && application.status === "active");
}

function financePathForTab(tab: FinanceTab) {
  return tab === "bills" ? "/v2/finance" : `/v2/finance/${tab}`;
}

function financeTabFromLocation(location: string): FinanceTab {
  const path = location.split("?")[0] ?? "";
  const segment = path.replace(/^\/v2\/finance\/?/, "").split("/")[0];
  return tabs.some((item) => item.value === segment) ? segment as FinanceTab : "bills";
}

function parsePaymentPeriod(value: string | null): PaymentPeriod {
  return value && paymentPeriodValues.has(value as PaymentPeriod) ? value as PaymentPeriod : "all-time";
}

function parsePaymentScope(value: string | null, hasPeriodQuery: boolean): PaymentScope {
  if (value === "completed-outflow") return "completed-outflow";
  if (value === "all") return "all";
  return hasPeriodQuery ? "completed-outflow" : "all";
}

function parseBillView(value: string | null): BillView {
  return value && billViewValues.has(value as BillView) ? value as BillView : "all";
}

function parseSubscriptionView(value: string | null): SubscriptionView {
  return value && subscriptionViewValues.has(value as SubscriptionView) ? value as SubscriptionView : "all";
}

function paymentPeriodLabel(period: PaymentPeriod) {
  return paymentPeriods.find((item) => item.value === period)?.label ?? "All time";
}

function paymentQueryPath(period: PaymentPeriod, scope: PaymentScope, paymentFrom: string, paymentTo: string) {
  const params = new URLSearchParams({ pageSize: "100", period, scope });
  if (period === "custom") {
    if (paymentFrom.trim()) params.set("paymentFrom", paymentFrom.trim());
    if (paymentTo.trim()) params.set("paymentTo", paymentTo.trim());
  }
  return `${V2_FINANCE_BASE}/payments?${params.toString()}`;
}

function financeUrl(tab: FinanceTab, params: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `${financePathForTab(tab)}${query ? `?${query}` : ""}`;
}

function paymentBillInvoiceLabel(payment: FinancePayment, applications: FinanceBillApplication[], billById: Map<number, FinanceBill>) {
  const labels = activeApplicationsForPayment(payment, applications).map((application) => {
    const bill = billById.get(application.targetVendorBillId);
    return bill ? billReferenceLabel(bill) : `Bill #${application.targetVendorBillId}`;
  });
  return labels.length > 0 ? labels.join(", ") : "-";
}

function paymentLedgerTotals(payments: FinancePayment[]): FinancePaymentLedgerSummary {
  const totalAmountByCurrency = new Map<string, number>();
  const appliedByCurrency = new Map<string, number>();
  const unappliedByCurrency = new Map<string, number>();
  for (const payment of payments) {
    totalAmountByCurrency.set(payment.currency, (totalAmountByCurrency.get(payment.currency) ?? 0) + payment.amountCents);
    appliedByCurrency.set(payment.currency, (appliedByCurrency.get(payment.currency) ?? 0) + (payment.activeAppliedAmountCents ?? 0));
    unappliedByCurrency.set(payment.currency, (unappliedByCurrency.get(payment.currency) ?? 0) + (payment.remainingAmountCents ?? payment.amountCents));
  }
  const toCurrencyAmounts = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([currency, amountCents]) => ({ currency, amountCents }))
      .sort((left, right) => left.currency.localeCompare(right.currency));
  return {
    count: payments.length,
    totalAmountByCurrency: toCurrencyAmounts(totalAmountByCurrency),
    appliedAmountByCurrency: toCurrencyAmounts(appliedByCurrency),
    unappliedAmountByCurrency: toCurrencyAmounts(unappliedByCurrency),
  };
}

function statusBadge(status?: string | null) {
  const variant =
    status === "active" || status === "approved" || status === "cleared" || status === "paid"
      ? "default"
      : status === "voided" || status === "failed" || status === "archived" || status === "cancelled"
        ? "destructive"
        : "secondary";

  return <Badge variant={variant}>{humanize(status)}</Badge>;
}

function billStatusBadges(bill: FinanceBill) {
  return (
    <div className="flex flex-wrap gap-2">
      {bill.status === "received" ? (
        <ActionTooltip content="Invoice received, pending approval.">
          {statusBadge(bill.status)}
        </ActionTooltip>
      ) : (
        statusBadge(bill.status)
      )}
      {bill.settlementState && statusBadge(bill.settlementState)}
    </div>
  );
}

function ActionTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      {description && <div className="mt-1 max-w-xl">{description}</div>}
      {actionLabel && onAction && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onAction}>
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      className={`rounded-lg border bg-card p-4 text-left shadow-sm ${clickable ? "transition-colors hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default"}`}
      onClick={onClick}
      disabled={!clickable}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
    </button>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            const item = typeof option === "string" ? { value: option, label: humanize(option) } : option;
            return (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex min-h-10 items-center rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="min-w-0 truncate font-medium">{value}</span>
      </div>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} required={required} maxLength={maxLength} />
    </div>
  );
}

function useFinanceMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (request: { method: string; path: string; body?: unknown }) =>
      v2FinanceJson(request.path, { method: request.method, json: request.body ?? {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith(V2_FINANCE_BASE);
        },
      });
      toast({ title: "Finance updated" });
    },
    onError: (error) => {
      toast({
        title: "Finance update failed",
        description: error instanceof Error ? error.message : "The AP record was not updated.",
        variant: "destructive",
      });
    },
  });
}

function vendorFormFrom(vendor?: FinanceVendor): VendorForm {
  return {
    name: vendor?.name ?? "",
    vendorType: vendor?.vendorType ?? "other",
    status: vendor?.status ?? "active",
    website: vendor?.website ?? "",
    contactEmail: vendor?.contactEmail ?? "",
    notes: vendor?.notes ?? "",
  };
}

function subscriptionFormFrom(
  legalEntities: FinanceLegalEntity[],
  vendors: FinanceVendor[],
  subscription?: FinanceSubscription,
): SubscriptionForm {
  return {
    legalEntityId: getInitialLegalEntityId(legalEntities, subscription?.legalEntityId),
    vendorId: String(subscription?.vendorId ?? vendors[0]?.id ?? ""),
    name: subscription?.name ?? "",
    categoryCode: subscription?.categoryCode ?? "saas",
    cadence: subscription?.cadence ?? "monthly",
    expectedAmount: centsToMoney(subscription?.expectedAmountCents ?? 0),
    currency: subscription?.currency ?? "USD",
    variableAmount: subscription?.variableAmount ?? false,
    billingDay: subscription?.billingDay == null ? "" : String(subscription.billingDay),
    nextBillingDate: subscription?.nextBillingDate ?? "",
    renewalDate: subscription?.renewalDate ?? "",
    autoRenew: subscription?.autoRenew ?? false,
    trialEndsOn: subscription?.trialEndsOn ?? "",
    notes: subscription?.notes ?? "",
    status: subscription?.status ?? "active",
  };
}

function billFormFrom(
  legalEntities: FinanceLegalEntity[],
  vendors: FinanceVendor[],
  bill?: FinanceBill,
): BillForm {
  return {
    legalEntityId: getInitialLegalEntityId(legalEntities, bill?.legalEntityId),
    vendorId: String(bill?.vendorId ?? vendors[0]?.id ?? ""),
    recurringExpenseId: bill?.recurringExpenseId == null ? "" : String(bill.recurringExpenseId),
    paymentState: "unpaid",
    invoiceNumber: bill?.invoiceNumber ?? "",
    billKind: bill?.billKind ?? "invoice",
    issueDate: bill?.issueDate ?? "",
    dueDate: bill?.dueDate ?? "",
    servicePeriodStart: bill?.servicePeriodStart ?? "",
    servicePeriodEnd: bill?.servicePeriodEnd ?? "",
    amount: centsToMoney(bill?.amountCents ?? 0),
    currency: bill?.currency ?? "USD",
    categoryCode: bill?.categoryCode ?? "saas",
    creditForVendorBillId: bill?.creditForVendorBillId == null ? "" : String(bill.creditForVendorBillId),
    notes: bill?.notes ?? "",
    paymentDate: "",
    paymentMethodType: paymentMethodPlaceholder,
    paymentMethodLabel: "",
    paymentInstitutionName: "",
    paymentMaskedLast4: "",
    paymentExternalConfirmationRef: "",
  };
}

function selectedRecurringExpenseFromForm(
  subscriptions: FinanceSubscription[],
  form: Pick<BillForm, "recurringExpenseId">,
) {
  if (!form.recurringExpenseId) return null;
  return subscriptions.find((subscription) => String(subscription.id) === form.recurringExpenseId) ?? null;
}

function recurringExpenseOptions(subscriptions: FinanceSubscription[]): SelectOption[] {
  return [
    { value: "none", label: "None — One-time bill" },
    ...subscriptions.map((subscription) => ({
      value: String(subscription.id),
      label: subscriptionLabel(subscription),
    })),
  ];
}

function billFormWithRecurringExpense(form: BillForm, subscription: FinanceSubscription): BillForm {
  return {
    ...form,
    recurringExpenseId: String(subscription.id),
    legalEntityId: String(subscription.legalEntityId),
    vendorId: String(subscription.vendorId),
    amount: subscription.expectedAmountCents == null ? form.amount : centsToMoney(subscription.expectedAmountCents),
    currency: subscription.currency,
    categoryCode: subscription.categoryCode,
  };
}

function paymentFormFrom(
  legalEntities: FinanceLegalEntity[],
  vendors: FinanceVendor[],
  payment?: FinancePayment,
  sourceBill?: FinanceBill,
): PaymentForm {
  return {
    legalEntityId: sourceBill ? String(sourceBill.legalEntityId) : getInitialLegalEntityId(legalEntities, payment?.legalEntityId),
    vendorId: sourceBill ? String(sourceBill.vendorId) : payment?.vendorId == null ? String(vendors[0]?.id ?? "") : String(payment.vendorId),
    amount: centsToMoney(sourceBill ? sourceBill.remainingAmountCents ?? sourceBill.amountCents : payment?.amountCents ?? 0),
    currency: sourceBill?.currency ?? payment?.currency ?? "USD",
    direction: payment?.direction ?? "outflow",
    paymentDate: payment?.paymentDate ?? "",
    methodType: payment?.methodType ?? "ach",
    methodLabel: payment?.methodLabel ?? "",
    institutionName: payment?.institutionName ?? "",
    maskedLast4: payment?.maskedLast4 ?? "",
    externalConfirmationRef: payment?.externalConfirmationRef ?? "",
    status: payment?.status ?? "",
  };
}

function applicationFormFrom(bill?: FinanceBill): ApplicationForm {
  return {
    sourceType: "payment",
    targetVendorBillId: bill ? String(bill.id) : "",
    expensePaymentId: "",
    creditVendorBillId: "",
    amount: bill?.remainingAmountCents == null ? "" : centsToMoney(bill.remainingAmountCents),
    currency: bill?.currency ?? "USD",
  };
}

function reconciliationFormFrom(): ReconciliationForm {
  return {
    reasonCode: "unmatched_payment",
    summary: "",
    expectedEntityType: "",
    expectedEntityId: "",
    actualEntityType: "",
    actualEntityId: "",
    currency: "USD",
    expectedAmount: "",
    actualAmount: "",
  };
}

function VendorDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: { mode: "create" | "edit"; vendor?: FinanceVendor; form: VendorForm } | null;
  onClose: () => void;
  onSubmit: (form: VendorForm) => void;
}) {
  const [form, setForm] = React.useState<VendorForm>(vendorFormFrom());

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(form);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <SelectField label="Type" value={form.vendorType} options={vendorTypes} onValueChange={(vendorType) => setForm({ ...form, vendorType })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Status" value={form.status} options={vendorStatuses} onValueChange={(status) => setForm({ ...form, status })} />
            <TextField label="Contact email" type="email" value={form.contactEmail} onChange={(contactEmail) => setForm({ ...form, contactEmail })} />
          </div>
          <TextField label="Website" value={form.website} onChange={(website) => setForm({ ...form, website })} />
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })}
              rows={3}
              maxLength={4000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionDialog({
  state,
  legalEntities,
  vendors,
  onClose,
  onSubmit,
}: {
  state: { mode: "create" | "edit"; subscription?: FinanceSubscription; form: SubscriptionForm } | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  onClose: () => void;
  onSubmit: (form: SubscriptionForm) => void;
}) {
  const [form, setForm] = React.useState<SubscriptionForm>(subscriptionFormFrom([], []));

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  const billingDayLabel = form.cadence === "monthly" ? "Billing day" : "Billing day (optional)";
  const canSubmit = form.name.trim().length > 0 && (state?.mode !== "create" || legalEntities.length > 0);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit Recurring Expense" : "Add Recurring Expense"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(form); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <LegalEntityField legalEntities={legalEntities} value={form.legalEntityId} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} autoSelectSingle={state?.mode === "create"} />
            <SelectField label="Vendor" value={form.vendorId} options={vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))} onValueChange={(vendorId) => setForm({ ...form, vendorId })} />
          </div>
          <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} required maxLength={200} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Category" value={form.categoryCode} onChange={(categoryCode) => setForm({ ...form, categoryCode })} />
            <SelectField label="Cadence" value={form.cadence} options={cadences} onValueChange={(cadence) => setForm({ ...form, cadence })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Expected amount" type="number" value={form.expectedAmount} onChange={(expectedAmount) => setForm({ ...form, expectedAmount })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={billingDayLabel} type="number" value={form.billingDay} onChange={(billingDay) => setForm({ ...form, billingDay })} />
            <TextField label="Next bill date" type="date" value={form.nextBillingDate} onChange={(nextBillingDate) => setForm({ ...form, nextBillingDate })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Renewal date" type="date" value={form.renewalDate} onChange={(renewalDate) => setForm({ ...form, renewalDate })} />
            <TextField label="Trial ends" type="date" value={form.trialEndsOn} onChange={(trialEndsOn) => setForm({ ...form, trialEndsOn })} />
          </div>
          {state?.mode === "create" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Initial status" value={form.status} options={subscriptionStatuses} onValueChange={(status) => setForm({ ...form, status })} />
            </div>
          )}
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.variableAmount} onCheckedChange={(checked) => setForm({ ...form, variableAmount: checked === true })} />
              Variable amount
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.autoRenew} onCheckedChange={(checked) => setForm({ ...form, autoRenew: checked === true })} />
              Auto renew
            </label>
          </div>
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })}
              rows={3}
              maxLength={4000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BillDialog({
  state,
  legalEntities,
  vendors,
  subscriptions,
  bills,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  state: { mode: "create" | "edit"; bill?: FinanceBill; form: BillForm } | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  subscriptions: FinanceSubscription[];
  bills: FinanceBill[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (form: BillForm) => void;
}) {
  const [form, setForm] = React.useState<BillForm>(billFormFrom([], []));

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  const availableSubscriptions = React.useMemo(() => {
    if (state?.mode !== "edit" || !state.bill) return subscriptions;
    return subscriptions.filter(
      (subscription) =>
        subscription.legalEntityId === state.bill?.legalEntityId &&
        subscription.vendorId === state.bill?.vendorId,
    );
  }, [state, subscriptions]);
  const selectedRecurringExpense = selectedRecurringExpenseFromForm(availableSubscriptions, form);
  const recurringLegalEntity = selectedRecurringExpense
    ? legalEntities.find((entity) => entity.id === selectedRecurringExpense.legalEntityId)
    : null;
  const recurringVendor = selectedRecurringExpense
    ? vendors.find((vendor) => vendor.id === selectedRecurringExpense.vendorId)
    : null;
  const isCreate = state?.mode === "create";
  const isAlreadyPaid = isCreate && form.paymentState === "already_paid";
  const hasRequiredPaymentFacts = !isAlreadyPaid || (
    form.paymentDate.trim().length > 0 &&
    form.paymentMethodType !== paymentMethodPlaceholder
  );
  const canSubmit = (state?.mode !== "create" || legalEntities.length > 0) && hasRequiredPaymentFacts && !isSubmitting;

  function handleRecurringExpenseChange(recurringExpenseId: string) {
    if (recurringExpenseId === "none") {
      setForm({ ...form, recurringExpenseId: "" });
      return;
    }
    const subscription = availableSubscriptions.find((item) => String(item.id) === recurringExpenseId);
    if (!subscription) return;
    setForm(billFormWithRecurringExpense(form, subscription));
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit Draft Bill" : "Add Bill"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(form); }}>
          <SelectField
            label="Recurring Expense (optional)"
            value={form.recurringExpenseId || "none"}
            options={recurringExpenseOptions(availableSubscriptions)}
            onValueChange={handleRecurringExpenseChange}
          />
          {selectedRecurringExpense && (
            <p className="text-xs text-muted-foreground">
              {recurringExpenseContextSummary(selectedRecurringExpense)}
            </p>
          )}
          {isCreate && (
            <div className="grid gap-2">
              <Label>Payment state</Label>
              <RadioGroup
                value={form.paymentState}
                onValueChange={(paymentState) => setForm({
                  ...form,
                  paymentState: paymentState as BillForm["paymentState"],
                })}
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <RadioGroupItem value="unpaid" />
                  <span>
                    <span className="block font-medium">Unpaid / pay later</span>
                    <span className="block text-xs text-muted-foreground">Use the normal received and approval workflow.</span>
                  </span>
                </label>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <RadioGroupItem value="already_paid" />
                  <span>
                    <span className="block font-medium">Already paid</span>
                    <span className="block text-xs text-muted-foreground">Create the bill, cleared payment, and application together.</span>
                  </span>
                </label>
              </RadioGroup>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {selectedRecurringExpense ? (
              <ReadOnlyField
                label="Legal entity"
                value={recurringLegalEntity ? legalEntityDisplayName(recurringLegalEntity) : `Legal entity #${selectedRecurringExpense.legalEntityId}`}
                helper="From recurring expense"
              />
            ) : (
              <LegalEntityField legalEntities={legalEntities} value={form.legalEntityId} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} autoSelectSingle={state?.mode === "create"} />
            )}
            {selectedRecurringExpense ? (
              <ReadOnlyField
                label="Vendor"
                value={recurringVendor ? vendorLabel(recurringVendor) : `Vendor #${selectedRecurringExpense.vendorId}`}
                helper="From recurring expense"
              />
            ) : (
              <SelectField label="Vendor" value={form.vendorId} options={vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))} onValueChange={(vendorId) => setForm({ ...form, vendorId })} />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Kind" value={form.billKind} options={billKinds} onValueChange={(billKind) => setForm({ ...form, billKind })} />
            <TextField label="Invoice number" value={form.invoiceNumber} onChange={(invoiceNumber) => setForm({ ...form, invoiceNumber })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Actual amount" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
            {selectedRecurringExpense ? (
              <ReadOnlyField label="Currency" value={selectedRecurringExpense.currency} helper="From recurring expense" />
            ) : (
              <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            )}
          </div>
          {selectedRecurringExpense ? (
            <ReadOnlyField label="Category" value={humanize(selectedRecurringExpense.categoryCode)} helper="From recurring expense" />
          ) : (
            <TextField label="Category" value={form.categoryCode} onChange={(categoryCode) => setForm({ ...form, categoryCode })} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Issue date" type="date" value={form.issueDate} onChange={(issueDate) => setForm({ ...form, issueDate })} />
            <TextField label="Due date" type="date" value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Service start" type="date" value={form.servicePeriodStart} onChange={(servicePeriodStart) => setForm({ ...form, servicePeriodStart })} />
            <TextField label="Service end" type="date" value={form.servicePeriodEnd} onChange={(servicePeriodEnd) => setForm({ ...form, servicePeriodEnd })} />
          </div>
          <SelectField label="Credit source" value={form.creditForVendorBillId || "none"} options={["none", ...bills.map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))]} onValueChange={(creditForVendorBillId) => setForm({ ...form, creditForVendorBillId: creditForVendorBillId === "none" ? "" : creditForVendorBillId })} />
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })}
              rows={3}
              maxLength={4000}
            />
          </div>
          {isAlreadyPaid && (
            <div className="space-y-4 rounded-md border bg-muted/20 p-4">
              <div>
                <div className="text-sm font-medium">Payment details</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used only for already-settled bills. The invoice number stays on the bill; confirmation is for a separate payment reference.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Payment date"
                  type="date"
                  value={form.paymentDate}
                  onChange={(paymentDate) => setForm({ ...form, paymentDate })}
                  required
                />
                <SelectField
                  label="Method"
                  value={form.paymentMethodType}
                  options={[{ value: paymentMethodPlaceholder, label: "Select method" }, ...paymentMethods]}
                  onValueChange={(paymentMethodType) => setForm({ ...form, paymentMethodType })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Method label" value={form.paymentMethodLabel} onChange={(paymentMethodLabel) => setForm({ ...form, paymentMethodLabel })} />
                <TextField label="Institution" value={form.paymentInstitutionName} onChange={(paymentInstitutionName) => setForm({ ...form, paymentInstitutionName })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Last 4" value={form.paymentMaskedLast4} onChange={(paymentMaskedLast4) => setForm({ ...form, paymentMaskedLast4 })} maxLength={4} />
                <TextField label="Confirmation" value={form.paymentExternalConfirmationRef} onChange={(paymentExternalConfirmationRef) => setForm({ ...form, paymentExternalConfirmationRef })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{isSubmitting ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  state,
  legalEntities,
  vendors,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  state: PaymentDialogState | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (form: PaymentForm) => void;
}) {
  const [form, setForm] = React.useState<PaymentForm>(paymentFormFrom([], []));

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  const sourceBill = state?.sourceBill;
  const sourceLegalEntity = sourceBill
    ? legalEntities.find((entity) => entity.id === sourceBill.legalEntityId)
    : null;
  const sourceVendor = sourceBill
    ? vendors.find((vendor) => vendor.id === sourceBill.vendorId)
    : null;
  const statusOptions = sourceBill ? billFirstPaymentStatuses : paymentStatuses;
  const selectedStatusValue = form.status || paymentStatusPlaceholder;
  const hasRequiredScope = sourceBill ? true : state?.mode !== "create" || legalEntities.length > 0;
  const hasRequiredPaymentFacts = state?.mode !== "create" || (form.paymentDate.trim().length > 0 && form.status.trim().length > 0);
  const canSubmit = hasRequiredScope && hasRequiredPaymentFacts && !isSubmitting;

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit"
              ? "Edit Pending Payment"
              : state?.approveBillFirst
                ? "Approve & Record Payment"
                : "Record Payment"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(form); }}>
          {sourceBill && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">Bill: {sourceBillPaymentLabel(sourceBill)}</div>
              <div className="mt-1 text-muted-foreground">
                Remaining: {formatMoney(sourceBill.remainingAmountCents ?? sourceBill.amountCents, sourceBill.currency)}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {sourceBill ? (
              <ReadOnlyField
                label="Legal entity"
                value={sourceLegalEntity ? legalEntityDisplayName(sourceLegalEntity) : `Legal entity #${sourceBill.legalEntityId}`}
                helper="From bill"
              />
            ) : (
              <LegalEntityField legalEntities={legalEntities} value={form.legalEntityId} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} autoSelectSingle={state?.mode === "create"} />
            )}
            {sourceBill ? (
              <ReadOnlyField
                label="Vendor"
                value={sourceVendor ? vendorLabel(sourceVendor) : sourceBill.vendorName || `Vendor #${sourceBill.vendorId}`}
                helper="From bill"
              />
            ) : (
              <SelectField label="Vendor" value={form.vendorId || "none"} options={["none", ...vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))]} onValueChange={(vendorId) => setForm({ ...form, vendorId: vendorId === "none" ? "" : vendorId })} />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Amount" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
            {sourceBill ? (
              <ReadOnlyField label="Currency" value={sourceBill.currency} helper="From bill" />
            ) : (
              <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Direction" value={form.direction} options={["outflow", "refund"]} onValueChange={(direction) => setForm({ ...form, direction })} />
            <TextField label="Payment date" type="date" value={form.paymentDate} onChange={(paymentDate) => setForm({ ...form, paymentDate })} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Method" value={form.methodType} options={paymentMethods} onValueChange={(methodType) => setForm({ ...form, methodType })} />
            {state?.mode === "create" ? (
              <SelectField
                label="Initial status"
                value={selectedStatusValue}
                options={[{ value: paymentStatusPlaceholder, label: "Select status" }, ...statusOptions]}
                onValueChange={(status) => setForm({ ...form, status: status === paymentStatusPlaceholder ? "" : status })}
              />
            ) : (
              <TextField label="Method label" value={form.methodLabel} onChange={(methodLabel) => setForm({ ...form, methodLabel })} />
            )}
          </div>
          {state?.mode === "create" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Method label" value={form.methodLabel} onChange={(methodLabel) => setForm({ ...form, methodLabel })} />
                <TextField label="Institution" value={form.institutionName} onChange={(institutionName) => setForm({ ...form, institutionName })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Last 4" value={form.maskedLast4} onChange={(maskedLast4) => setForm({ ...form, maskedLast4 })} />
                <TextField label="Confirmation" value={form.externalConfirmationRef} onChange={(externalConfirmationRef) => setForm({ ...form, externalConfirmationRef })} />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Institution" value={form.institutionName} onChange={(institutionName) => setForm({ ...form, institutionName })} />
                <TextField label="Last 4" value={form.maskedLast4} onChange={(maskedLast4) => setForm({ ...form, maskedLast4 })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Confirmation" value={form.externalConfirmationRef} onChange={(externalConfirmationRef) => setForm({ ...form, externalConfirmationRef })} />
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{isSubmitting ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="min-h-6 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function PaymentDetailDialog({
  payment,
  legalEntities,
  bills,
  applications,
  onClose,
}: {
  payment: FinancePayment | null;
  legalEntities: FinanceLegalEntity[];
  bills: FinanceBill[];
  applications: FinanceBillApplication[];
  onClose: () => void;
}) {
  const legalEntity = payment?.legalEntityId
    ? legalEntities.find((entity) => entity.id === payment.legalEntityId)
    : null;
  const appliedApplications = payment ? activeApplicationsForPayment(payment, applications) : [];
  const billById = React.useMemo(() => new Map(bills.map((bill) => [bill.id, bill])), [bills]);

  return (
    <Dialog open={Boolean(payment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payment Details</DialogTitle>
        </DialogHeader>
        {payment && (
          <div className="space-y-5">
            <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
              <DetailField label="Vendor" value={payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "-")} />
              <DetailField label="Legal entity" value={legalEntity ? legalEntityDisplayName(legalEntity) : payment.legalEntityId ? `Legal entity #${payment.legalEntityId}` : "-"} />
              <DetailField label="Amount" value={`${formatMoney(payment.amountCents, payment.currency)} ${payment.currency}`} />
              <DetailField label="Payment date" value={formatDate(payment.paymentDate)} />
              <DetailField label="Direction" value={humanize(payment.direction)} />
              <DetailField label="Status" value={statusBadge(payment.status)} />
            </div>

            <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
              <DetailField label="Method" value={humanize(payment.methodType)} />
              <DetailField label="Method label" value={displayValue(payment.methodLabel)} />
              <DetailField label="Institution" value={displayValue(payment.institutionName)} />
              <DetailField label="Last 4" value={displayValue(payment.maskedLast4)} />
              <DetailField label="Confirmation" value={displayValue(payment.externalConfirmationRef)} />
            </div>

            <div className="rounded-md border p-4">
              <div className="mb-3 text-sm font-medium">Applied Bills</div>
              {appliedApplications.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active bill applications.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead className="text-right">Current balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appliedApplications.map((application) => {
                      const bill = billById.get(application.targetVendorBillId);
                      return (
                        <TableRow key={application.id}>
                          <TableCell>{bill ? billLabel(bill) : `Bill #${application.targetVendorBillId}`}</TableCell>
                          <TableCell className="text-right">{formatMoney(application.amountCents, application.currency)}</TableCell>
                          <TableCell className="text-right">{bill ? formatMoney(bill.remainingAmountCents ?? bill.amountCents, bill.currency) : "-"}</TableCell>
                          <TableCell>{bill ? billStatusBadges(bill) : statusBadge(application.status)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApplicationDialog({
  state,
  bills,
  payments,
  onClose,
  onSubmit,
}: {
  state: { form: ApplicationForm } | null;
  bills: FinanceBill[];
  payments: FinancePayment[];
  onClose: () => void;
  onSubmit: (form: ApplicationForm) => void;
}) {
  const [form, setForm] = React.useState<ApplicationForm>(applicationFormFrom());

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Apply to Bill</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Target bill" value={form.targetVendorBillId} options={bills.map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))} onValueChange={(targetVendorBillId) => setForm({ ...form, targetVendorBillId })} />
            <SelectField label="Source type" value={form.sourceType} options={[{ value: "payment", label: "Payment" }, { value: "credit", label: "Credit memo" }]} onValueChange={(sourceType) => setForm({ ...form, sourceType: sourceType as ApplicationForm["sourceType"] })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {form.sourceType === "payment" ? (
              <SelectField label="Payment" value={form.expensePaymentId} options={payments.map((payment) => ({ value: String(payment.id), label: paymentLabel(payment) }))} onValueChange={(expensePaymentId) => setForm({ ...form, expensePaymentId })} />
            ) : (
              <SelectField label="Credit memo" value={form.creditVendorBillId} options={bills.filter((bill) => bill.billKind === "credit_memo").map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))} onValueChange={(creditVendorBillId) => setForm({ ...form, creditVendorBillId })} />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Amount" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: { form: ReconciliationForm } | null;
  onClose: () => void;
  onSubmit: (form: ReconciliationForm) => void;
}) {
  const [form, setForm] = React.useState<ReconciliationForm>(reconciliationFormFrom());

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Open reconciliation exception</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <SelectField label="Reason" value={form.reasonCode} options={reconciliationReasons} onValueChange={(reasonCode) => setForm({ ...form, reasonCode })} />
          <div className="grid gap-2">
            <Label>Summary</Label>
            <Textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.currentTarget.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Expected type" value={form.expectedEntityType || "none"} options={["none", ...reconciliationEntityTypes]} onValueChange={(expectedEntityType) => setForm({ ...form, expectedEntityType: expectedEntityType === "none" ? "" : expectedEntityType })} />
            <TextField label="Expected id" type="number" value={form.expectedEntityId} onChange={(expectedEntityId) => setForm({ ...form, expectedEntityId })} />
            <SelectField label="Actual type" value={form.actualEntityType || "none"} options={["none", ...reconciliationEntityTypes]} onValueChange={(actualEntityType) => setForm({ ...form, actualEntityType: actualEntityType === "none" ? "" : actualEntityType })} />
            <TextField label="Actual id" type="number" value={form.actualEntityId} onChange={(actualEntityId) => setForm({ ...form, actualEntityId })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            <TextField label="Expected amount" type="number" value={form.expectedAmount} onChange={(expectedAmount) => setForm({ ...form, expectedAmount })} />
            <TextField label="Actual amount" type="number" value={form.actualAmount} onChange={(actualAmount) => setForm({ ...form, actualAmount })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Open</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function V2FinanceManagement() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = React.useMemo(() => new URLSearchParams(search), [search]);
  const tab = financeTabFromLocation(location);
  const paymentPeriod = parsePaymentPeriod(searchParams.get("period"));
  const paymentScope = parsePaymentScope(searchParams.get("scope"), searchParams.has("period"));
  const customPaymentFrom = searchParams.get("paymentFrom") ?? "";
  const customPaymentTo = searchParams.get("paymentTo") ?? "";
  const billView = parseBillView(searchParams.get("view"));
  const subscriptionView = parseSubscriptionView(searchParams.get("view"));
  const [vendorDialog, setVendorDialog] = React.useState<{ mode: "create" | "edit"; vendor?: FinanceVendor; form: VendorForm } | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = React.useState<{ mode: "create" | "edit"; subscription?: FinanceSubscription; form: SubscriptionForm } | null>(null);
  const [billDialog, setBillDialog] = React.useState<{ mode: "create" | "edit"; bill?: FinanceBill; form: BillForm } | null>(null);
  const [paymentDialog, setPaymentDialog] = React.useState<PaymentDialogState | null>(null);
  const [paymentDetail, setPaymentDetail] = React.useState<FinancePayment | null>(null);
  const [applicationDialog, setApplicationDialog] = React.useState<{ form: ApplicationForm } | null>(null);
  const [reconciliationDialog, setReconciliationDialog] = React.useState<{ form: ReconciliationForm } | null>(null);
  const mutation = useFinanceMutation();

  const overviewQuery = useQuery<FinanceOverview>({
    queryKey: [`${V2_FINANCE_BASE}/overview`],
    queryFn: () => v2FinanceJson<FinanceOverview>(`${V2_FINANCE_BASE}/overview`),
  });
  const legalEntitiesQuery = useQuery<FinanceLegalEntity[]>({
    queryKey: [`${V2_FINANCE_BASE}/legal-entities`],
    queryFn: () => v2FinanceJson<FinanceLegalEntity[]>(`${V2_FINANCE_BASE}/legal-entities`),
  });
  const vendorsQuery = useQuery<FinanceVendor[]>({
    queryKey: [`${V2_FINANCE_BASE}/vendors?pageSize=100`],
    queryFn: () => v2FinanceJson<FinanceVendor[]>(`${V2_FINANCE_BASE}/vendors?pageSize=100`),
  });
  const subscriptionsQuery = useQuery<FinanceSubscription[]>({
    queryKey: [`${V2_FINANCE_BASE}/subscriptions?pageSize=100`],
    queryFn: () => v2FinanceJson<FinanceSubscription[]>(`${V2_FINANCE_BASE}/subscriptions?pageSize=100`),
  });
  const billsQuery = useQuery<FinanceBill[]>({
    queryKey: [`${V2_FINANCE_BASE}/bills?pageSize=100`],
    queryFn: () => v2FinanceJson<FinanceBill[]>(`${V2_FINANCE_BASE}/bills?pageSize=100`),
  });
  const paymentsQuery = useQuery<FinancePaymentLedger>({
    queryKey: [paymentQueryPath(paymentPeriod, paymentScope, customPaymentFrom, customPaymentTo)],
    queryFn: ({ queryKey }) => v2FinanceJson<FinancePaymentLedger>(String(queryKey[0])),
  });
  const applicationsQuery = useQuery<FinanceBillApplication[]>({
    queryKey: [`${V2_FINANCE_BASE}/bill-applications?pageSize=100`],
    queryFn: () => v2FinanceJson<FinanceBillApplication[]>(`${V2_FINANCE_BASE}/bill-applications?pageSize=100`),
  });
  const reconciliationQuery = useQuery<FinanceReconciliationException[]>({
    queryKey: [`${V2_FINANCE_BASE}/reconciliation-exceptions?pageSize=100`],
    queryFn: () =>
      v2FinanceJson<FinanceReconciliationException[]>(
        `${V2_FINANCE_BASE}/reconciliation-exceptions?pageSize=100`,
      ),
  });

  const legalEntities = legalEntitiesQuery.data ?? [];
  const vendors = vendorsQuery.data ?? [];
  const activeVendors = vendors.filter((vendor) => vendor.status !== "archived");
  const subscriptions = subscriptionsQuery.data ?? [];
  const bills = billsQuery.data ?? [];
  const payments = paymentsQuery.data?.payments ?? [];
  const applications = applicationsQuery.data ?? [];
  const reconciliation = reconciliationQuery.data ?? [];
  const billById = React.useMemo(() => new Map(bills.map((bill) => [bill.id, bill])), [bills]);
  const paymentById = React.useMemo(() => new Map(payments.map((payment) => [payment.id, payment])), [payments]);
  const today = overviewQuery.data?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const displayedBills = React.useMemo(() => bills.filter((bill) => {
    if (billView === "all") return true;
    if (!billHasOpenBalance(bill) || bill.status === "draft" || bill.status === "voided" || bill.billKind === "credit_memo") {
      return false;
    }
    if (billView === "overdue") {
      return Boolean(bill.dueDate && bill.dueDate < today);
    }
    return true;
  }), [billView, bills, today]);
  const displayedSubscriptions = React.useMemo(() => (
    subscriptionView === "active"
      ? subscriptions.filter((subscription) => subscription.status === "active")
      : subscriptions
  ), [subscriptionView, subscriptions]);
  const paymentTotals = paymentsQuery.data?.summary ?? paymentLedgerTotals(payments);
  const isLoading = [
    overviewQuery,
    legalEntitiesQuery,
    vendorsQuery,
    subscriptionsQuery,
    billsQuery,
    paymentsQuery,
    applicationsQuery,
    reconciliationQuery,
  ].some((query) => query.isLoading);
  const error = [
    overviewQuery,
    legalEntitiesQuery,
    vendorsQuery,
    subscriptionsQuery,
    billsQuery,
    paymentsQuery,
    applicationsQuery,
    reconciliationQuery,
  ].find((query) => query.error)?.error;
  const legalEntityConfigurationRequired = !isLoading && !error && legalEntities.length === 0;
  const canCreateLegalEntityScopedRecord = legalEntities.length > 0;

  function navigateFinance(tab: FinanceTab, params: Record<string, string | undefined> = {}) {
    setLocation(financeUrl(tab, params));
  }

  function navigatePaymentPeriod(period: PaymentPeriod, extra: Record<string, string | undefined> = {}) {
    navigateFinance("payments", {
      period,
      scope: "completed-outflow",
      ...extra,
    });
  }

  function mutate(method: string, path: string, body?: unknown, onSuccess?: () => void) {
    mutation.mutate(
      { method, path, body },
      { onSuccess },
    );
  }

  function openBillPaymentDialog(bill: FinanceBill, approveBillFirst = false) {
    setPaymentDialog({
      mode: "create",
      sourceBill: bill,
      approveBillFirst,
      form: paymentFormFrom(legalEntities, activeVendors, undefined, bill),
    });
  }

  function submitVendor(form: VendorForm) {
    const body = {
      name: form.name.trim(),
      vendorType: form.vendorType,
      status: form.status,
      website: optionalNullableText(form.website),
      contactEmail: optionalNullableText(form.contactEmail),
      notes: optionalNullableText(form.notes),
    };
    mutate(
      vendorDialog?.mode === "edit" ? "PATCH" : "POST",
      vendorDialog?.mode === "edit" ? `${V2_FINANCE_BASE}/vendors/${vendorDialog.vendor?.id}` : `${V2_FINANCE_BASE}/vendors`,
      body,
      () => setVendorDialog(null),
    );
  }

  function submitSubscription(form: SubscriptionForm) {
    try {
      const body = {
        vendorId: Number(form.vendorId),
        name: form.name.trim(),
        categoryCode: form.categoryCode.trim(),
        cadence: form.cadence,
        expectedAmountCents: form.variableAmount && !form.expectedAmount.trim() ? null : moneyToCents(form.expectedAmount, true),
        currency: form.currency.trim().toUpperCase(),
        variableAmount: form.variableAmount,
        billingDay: optionalNullableNumber(form.billingDay),
        nextBillingDate: optionalNullableText(form.nextBillingDate),
        renewalDate: optionalNullableText(form.renewalDate),
        autoRenew: form.autoRenew,
        trialEndsOn: optionalNullableText(form.trialEndsOn),
        status: form.status,
        notes: optionalNullableText(form.notes),
      };
      const isEdit = subscriptionDialog?.mode === "edit";
      if (isEdit) {
        const { vendorId: _vendorId, status: _status, ...updateBody } = body;
        mutate("PATCH", `${V2_FINANCE_BASE}/subscriptions/${subscriptionDialog?.subscription?.id}`, updateBody, () => setSubscriptionDialog(null));
      } else {
        mutate(
          "POST",
          `${V2_FINANCE_BASE}/subscriptions`,
          { legalEntityId: parseRequiredLegalEntityId(form.legalEntityId), ...body },
          () => setSubscriptionDialog(null),
        );
      }
    } catch (error) {
      mutation.reset();
      throw error;
    }
  }

  function submitBill(form: BillForm) {
    const selectedRecurringExpense = selectedRecurringExpenseFromForm(subscriptions, form);
    const body = {
      vendorId: selectedRecurringExpense?.vendorId ?? Number(form.vendorId),
      recurringExpenseId: selectedRecurringExpense?.id ?? optionalNullableNumber(form.recurringExpenseId),
      invoiceNumber: optionalNullableText(form.invoiceNumber),
      billKind: form.billKind,
      issueDate: optionalNullableText(form.issueDate),
      dueDate: optionalNullableText(form.dueDate),
      servicePeriodStart: optionalNullableText(form.servicePeriodStart),
      servicePeriodEnd: optionalNullableText(form.servicePeriodEnd),
      amountCents: moneyToCents(form.amount),
      currency: (selectedRecurringExpense?.currency ?? form.currency).trim().toUpperCase(),
      categoryCode: selectedRecurringExpense?.categoryCode ?? form.categoryCode.trim(),
      status: "draft",
      creditForVendorBillId: optionalNullableNumber(form.creditForVendorBillId),
      notes: optionalNullableText(form.notes),
    };
    const isEdit = billDialog?.mode === "edit";
    if (isEdit) {
      const { vendorId: _vendorId, status: _status, ...updateBody } = body;
      mutate("PATCH", `${V2_FINANCE_BASE}/bills/${billDialog?.bill?.id}`, updateBody, () => setBillDialog(null));
    } else if (form.paymentState === "already_paid") {
      const { status: _status, ...recordPaidBody } = body;
      mutate(
        "POST",
        `${V2_FINANCE_BASE}/bills/record-paid`,
        {
          legalEntityId: selectedRecurringExpense?.legalEntityId ?? parseRequiredLegalEntityId(form.legalEntityId),
          ...recordPaidBody,
          paymentDate: form.paymentDate.trim(),
          methodType: form.paymentMethodType,
          methodLabel: optionalNullableText(form.paymentMethodLabel),
          institutionName: optionalNullableText(form.paymentInstitutionName),
          maskedLast4: optionalText(form.paymentMaskedLast4),
          externalConfirmationRef: optionalNullableText(form.paymentExternalConfirmationRef),
        },
        () => setBillDialog(null),
      );
    } else {
      mutate(
        "POST",
        `${V2_FINANCE_BASE}/bills`,
        { legalEntityId: selectedRecurringExpense?.legalEntityId ?? parseRequiredLegalEntityId(form.legalEntityId), ...body },
        () => setBillDialog(null),
      );
    }
  }

  function submitPayment(form: PaymentForm) {
    const paymentFacts = {
      amountCents: moneyToCents(form.amount),
      direction: form.direction,
      paymentDate: form.paymentDate.trim(),
      methodType: form.methodType,
      methodLabel: optionalNullableText(form.methodLabel),
      institutionName: optionalNullableText(form.institutionName),
      maskedLast4: optionalText(form.maskedLast4),
      externalConfirmationRef: optionalNullableText(form.externalConfirmationRef),
      status: form.status,
    };
    const isEdit = paymentDialog?.mode === "edit";
    if (isEdit) {
      const updateBody = {
        vendorId: optionalNullableNumber(form.vendorId),
        ...paymentFacts,
        currency: form.currency.trim().toUpperCase(),
      };
      const { status: _status, ...editableBody } = updateBody;
      mutate("PATCH", `${V2_FINANCE_BASE}/payments/${paymentDialog?.payment?.id}`, editableBody, () => setPaymentDialog(null));
    } else if (paymentDialog?.sourceBill) {
      mutate(
        "POST",
        `${V2_FINANCE_BASE}/bills/${paymentDialog.sourceBill.id}/${paymentDialog.approveBillFirst ? "approve-and-record-payment" : "record-payment"}`,
        paymentFacts,
        () => setPaymentDialog(null),
      );
    } else {
      const body = {
        vendorId: optionalNullableNumber(form.vendorId),
        ...paymentFacts,
        currency: form.currency.trim().toUpperCase(),
      };
      mutate(
        "POST",
        `${V2_FINANCE_BASE}/payments`,
        { legalEntityId: parseRequiredLegalEntityId(form.legalEntityId), ...body },
        () => setPaymentDialog(null),
      );
    }
  }

  function submitApplication(form: ApplicationForm) {
    const common = {
      targetVendorBillId: Number(form.targetVendorBillId),
      amountCents: moneyToCents(form.amount),
      currency: form.currency.trim().toUpperCase(),
    };
    if (form.sourceType === "payment") {
      mutate("POST", `${V2_FINANCE_BASE}/bill-applications/payment`, {
        ...common,
        expensePaymentId: Number(form.expensePaymentId),
      }, () => setApplicationDialog(null));
      return;
    }

    mutate("POST", `${V2_FINANCE_BASE}/bill-applications/credit`, {
      ...common,
      creditVendorBillId: Number(form.creditVendorBillId),
    }, () => setApplicationDialog(null));
  }

  function submitReconciliation(form: ReconciliationForm) {
    const body = {
      reasonCode: form.reasonCode,
      summary: form.summary.trim(),
      expectedEntityType: optionalNullableText(form.expectedEntityType),
      expectedEntityId: optionalNullableNumber(form.expectedEntityId),
      actualEntityType: optionalNullableText(form.actualEntityType),
      actualEntityId: optionalNullableNumber(form.actualEntityId),
      currency: optionalNullableText(form.currency.trim().toUpperCase()),
      expectedAmountCents: moneyToCents(form.expectedAmount, true),
      actualAmountCents: moneyToCents(form.actualAmount, true),
    };
    mutate("POST", `${V2_FINANCE_BASE}/reconciliation-exceptions`, body, () => setReconciliationDialog(null));
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Accounts Payable</h1>
            <p className="text-sm text-muted-foreground">V2 finance workspace</p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </header>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Metric
            label="Open bills"
            value={overviewQuery.data?.metrics?.openBillsCount ?? 0}
            icon={ReceiptText}
            onClick={() => navigateFinance("bills", { view: "open" })}
          />
          <Metric
            label="Overdue"
            value={overviewQuery.data?.metrics?.overdueBillsCount ?? 0}
            icon={AlertCircle}
            onClick={() => navigateFinance("bills", { view: "overdue" })}
          />
          <Metric
            label="Recurring expenses"
            value={overviewQuery.data?.metrics?.activeSubscriptionsCount ?? 0}
            icon={Building2}
            onClick={() => navigateFinance("subscriptions", { view: "active" })}
          />
          <Metric
            label="Open total"
            value={formatMoneyBreakdown(overviewQuery.data?.metrics?.openBillTotalsByCurrency)}
            icon={WalletCards}
            onClick={() => navigateFinance("bills", { view: "open" })}
          />
          <Metric
            label="Paid this month"
            value={formatMoneyBreakdown(overviewQuery.data?.metrics?.paidThisMonthByCurrency)}
            icon={WalletCards}
            onClick={() => navigatePaymentPeriod("this-month")}
          />
          <Metric
            label="Paid YTD"
            value={formatMoneyBreakdown(overviewQuery.data?.metrics?.paidYtdByCurrency)}
            icon={WalletCards}
            onClick={() => navigatePaymentPeriod("ytd")}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.value}
              variant={tab === item.value ? "default" : "outline"}
              onClick={() => navigateFinance(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Unable to load AP records."}
          </div>
        )}

        {legalEntityConfigurationRequired && (
          <EmptyState
            title="Legal entity configuration required"
            description="Add an active company legal entity before creating recurring expenses, bills, or payments."
          />
        )}

        {tab === "bills" && (
          <Section
            title="Bills"
            icon={ReceiptText}
            action={<Button disabled={!canCreateLegalEntityScopedRecord} onClick={() => setBillDialog({ mode: "create", form: billFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Add bill</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading bills" description="Loading vendor bills and settlement details." />
            ) : displayedBills.length === 0 ? (
              <EmptyState
                title={billView === "all" ? "No bills yet" : "No bills match this view"}
                description={billView === "all" ? "Add vendor bills as they arrive so due dates, balances, and receipts stay visible." : "Change the saved view or add a bill when a new payable arrives."}
                actionLabel={canCreateLegalEntityScopedRecord ? "Add bill" : undefined}
                onAction={canCreateLegalEntityScopedRecord ? () => setBillDialog({ mode: "create", form: billFormFrom(legalEntities, activeVendors) }) : undefined}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedBills.map((bill) => (
                    <TableRow key={bill.id}>
                      <TableCell>{bill.vendorName || `Vendor #${bill.vendorId}`}</TableCell>
                      <TableCell>
                        <div>{bill.invoiceNumber || humanize(bill.categoryCode)}</div>
                        {bill.notes && <div className="mt-1 text-xs text-muted-foreground">{bill.notes}</div>}
                      </TableCell>
                      <TableCell>{formatDate(bill.dueDate)}</TableCell>
                      <TableCell>{billStatusBadges(bill)}</TableCell>
                      <TableCell className="text-right">{formatMoney(bill.amountCents, bill.currency)}</TableCell>
                      <TableCell className="text-right">{formatMoney(bill.remainingAmountCents ?? bill.amountCents, bill.currency)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {bill.status === "draft" && (
                            <>
                              <ActionTooltip content="Edit draft bill details before it is received.">
                                <Button size="sm" variant="outline" onClick={() => setBillDialog({ mode: "edit", bill, form: billFormFrom(legalEntities, activeVendors, bill) })}><Edit3 className="h-4 w-4" />Edit</Button>
                              </ActionTooltip>
                              <ActionTooltip content="Move this draft bill into AP. Receive it before approving, disputing, applying, or recording payment.">
                                <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/receive`)}><ReceiptText className="h-4 w-4" />Receive</Button>
                              </ActionTooltip>
                            </>
                          )}
                          {["received", "disputed"].includes(bill.status) && billHasOpenBalance(bill) && (
                            <ActionTooltip content="Confirm this bill is valid and ready to pay.">
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/approve`)}><CheckCircle2 className="h-4 w-4" />Approve</Button>
                            </ActionTooltip>
                          )}
                          {bill.status === "received" && billHasOpenBalance(bill) && (
                            <ActionTooltip content="Mark this bill as under dispute. It should not be paid until resolved.">
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/dispute`)}><AlertCircle className="h-4 w-4" />Dispute</Button>
                            </ActionTooltip>
                          )}
                          {canApproveAndRecordBillPayment(bill) && (
                            <ActionTooltip content="Approve this bill, record an actual payment, and apply it in one transaction.">
                              <Button size="sm" variant="outline" onClick={() => openBillPaymentDialog(bill, true)}><WalletCards className="h-4 w-4" />Approve & pay</Button>
                            </ActionTooltip>
                          )}
                          {canRecordBillPayment(bill) && (
                            <ActionTooltip content="Record an actual payment and apply it to this bill.">
                              <Button size="sm" variant="outline" onClick={() => openBillPaymentDialog(bill)}><WalletCards className="h-4 w-4" />Record payment</Button>
                            </ActionTooltip>
                          )}
                          {canManuallyApplyToBill(bill) && (
                            <ActionTooltip content="Manually link an existing payment or credit to this bill.">
                              <Button size="sm" variant="outline" onClick={() => setApplicationDialog({ form: applicationFormFrom(bill) })}><Link2 className="h-4 w-4" />Apply</Button>
                            </ActionTooltip>
                          )}
                          {canVoidBillDirectly(bill) && (
                            <>
                              <ActionTooltip content="Cancel this bill without recording payment.">
                                <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/void`)}><XCircle className="h-4 w-4" />Void</Button>
                              </ActionTooltip>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        )}

        {tab === "payments" && (
          <Section
            title="Payments"
            icon={WalletCards}
            action={(
              <ActionTooltip content="Record a standalone payment. Apply it to bills later if needed.">
                <Button disabled={!canCreateLegalEntityScopedRecord} onClick={() => setPaymentDialog({ mode: "create", form: paymentFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Record payment</Button>
              </ActionTooltip>
            )}
          >
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="grid min-w-44 gap-2">
                <Label>Period</Label>
                <Select
                  value={paymentPeriod}
                  onValueChange={(period) => navigatePaymentPeriod(period as PaymentPeriod, period === "custom" ? { paymentFrom: customPaymentFrom, paymentTo: customPaymentTo } : {})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentPeriods.map((period) => (
                      <SelectItem key={period.value} value={period.value}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {paymentPeriod === "custom" && (
                <>
                  <TextField
                    label="From"
                    type="date"
                    value={customPaymentFrom}
                    onChange={(paymentFrom) => navigatePaymentPeriod("custom", { paymentFrom, paymentTo: customPaymentTo })}
                  />
                  <TextField
                    label="To"
                    type="date"
                    value={customPaymentTo}
                    onChange={(paymentTo) => navigatePaymentPeriod("custom", { paymentFrom: customPaymentFrom, paymentTo })}
                  />
                </>
              )}
              {paymentScope === "completed-outflow" && (
                <Badge variant="secondary" className="mb-2">
                  Completed AP spend
                </Badge>
              )}
            </div>
            {isLoading ? (
              <EmptyState title="Loading payments" description="Loading payment records and unapplied balances." />
            ) : payments.length === 0 ? (
              <EmptyState
                title={paymentScope === "completed-outflow" ? `No completed AP spend for ${paymentPeriodLabel(paymentPeriod)}` : "No payments recorded"}
                description={paymentScope === "completed-outflow" ? "This saved view only includes cleared outflow payments in the selected period." : "Record an actual payment after money has moved or is in flight."}
                actionLabel={canCreateLegalEntityScopedRecord ? "Record payment" : undefined}
                onAction={canCreateLegalEntityScopedRecord ? () => setPaymentDialog({ mode: "create", form: paymentFormFrom(legalEntities, activeVendors) }) : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1080px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill / Invoice</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead className="text-right">Unapplied</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>{payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned")}</TableCell>
                        <TableCell>{paymentBillInvoiceLabel(payment, applications, billById)}</TableCell>
                        <TableCell>{payment.methodLabel || humanize(payment.methodType)}</TableCell>
                        <TableCell>{statusBadge(payment.status)}</TableCell>
                        <TableCell className="text-right">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
                        <TableCell className="text-right">{formatMoney(payment.activeAppliedAmountCents ?? 0, payment.currency)}</TableCell>
                        <TableCell className="text-right">{formatMoney(payment.remainingAmountCents ?? payment.amountCents, payment.currency)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-2">
                            <ActionTooltip content="View stored payment method details and active bill applications.">
                              <Button size="sm" variant="outline" onClick={() => setPaymentDetail(payment)}><Eye className="h-4 w-4" />View details</Button>
                            </ActionTooltip>
                            {payment.status === "pending" && (
                              <>
                                <ActionTooltip content="Edit pending payment details before posting or clearing.">
                                  <Button size="sm" variant="outline" onClick={() => setPaymentDialog({ mode: "edit", payment, form: paymentFormFrom(legalEntities, activeVendors, payment) })}><Edit3 className="h-4 w-4" />Edit</Button>
                                </ActionTooltip>
                                <ActionTooltip content="Mark this pending payment as sent or posted.">
                                  <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/post`)}><CheckCircle2 className="h-4 w-4" />Post</Button>
                                </ActionTooltip>
                                <ActionTooltip content="Mark this pending payment as failed.">
                                  <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/fail`)}><XCircle className="h-4 w-4" />Fail</Button>
                                </ActionTooltip>
                                <ActionTooltip content="Void this pending payment before it posts.">
                                  <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/void`)}><Archive className="h-4 w-4" />Void</Button>
                                </ActionTooltip>
                              </>
                            )}
                            {payment.status === "posted" && (
                              <ActionTooltip content="Mark this posted payment as cleared.">
                                <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/clear`)}><CheckCircle2 className="h-4 w-4" />Clear</Button>
                              </ActionTooltip>
                            )}
                            {["posted", "cleared"].includes(payment.status) && (
                              <ActionTooltip content="Reverse this posted or cleared payment and its active applications.">
                                <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/reverse`)}><RotateCcw className="h-4 w-4" />Reverse</Button>
                              </ActionTooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-2 py-3 text-sm">
                  <div className="font-medium">{paymentTotals.count} payments</div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
                    <span>Total <span className="font-medium text-foreground">{formatMoneyBreakdown(paymentTotals.totalAmountByCurrency)}</span></span>
                    <span>Applied <span className="font-medium text-foreground">{formatMoneyBreakdown(paymentTotals.appliedAmountByCurrency)}</span></span>
                    <span>Unapplied <span className="font-medium text-foreground">{formatMoneyBreakdown(paymentTotals.unappliedAmountByCurrency)}</span></span>
                  </div>
                </div>
              </div>
            )}
          </Section>
        )}

        {tab === "subscriptions" && (
          <Section
            title="Recurring Expenses"
            icon={Building2}
            action={<Button disabled={!canCreateLegalEntityScopedRecord} onClick={() => setSubscriptionDialog({ mode: "create", form: subscriptionFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Add recurring expense</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading recurring expenses" description="Loading expected recurring obligations." />
            ) : displayedSubscriptions.length === 0 ? (
              <EmptyState
                title={subscriptionView === "all" ? "No recurring expenses yet" : "No recurring expenses match this view"}
                description={subscriptionView === "all" ? "Track SaaS, payroll providers, utilities, and services before bills arrive." : "Change the saved view or add a recurring expense when a new obligation starts."}
                actionLabel={canCreateLegalEntityScopedRecord ? "Add recurring expense" : undefined}
                onAction={canCreateLegalEntityScopedRecord ? () => setSubscriptionDialog({ mode: "create", form: subscriptionFormFrom(legalEntities, activeVendors) }) : undefined}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recurring Expense</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead>Next bill date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedSubscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div>{subscription.name}</div>
                        <div className="text-xs text-muted-foreground">{recurringExpenseSummary(subscription)}</div>
                        <div className="text-xs text-muted-foreground">{humanize(subscription.categoryCode)}</div>
                        {subscription.notes && <div className="mt-1 text-xs text-muted-foreground">{subscription.notes}</div>}
                      </TableCell>
                      <TableCell>{humanize(subscription.cadence)}</TableCell>
                      <TableCell>{statusBadge(subscription.status)}</TableCell>
                      <TableCell className="text-right">{subscription.variableAmount ? "Variable" : formatMoney(subscription.expectedAmountCents, subscription.currency)}</TableCell>
                      <TableCell>{formatDate(subscription.nextBillingDate)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSubscriptionDialog({ mode: "edit", subscription, form: subscriptionFormFrom(legalEntities, activeVendors, subscription) })}><Edit3 className="h-4 w-4" />Edit</Button>
                          {["trial", "active"].includes(subscription.status) && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/subscriptions/${subscription.id}/pause`)}>Pause</Button>
                          )}
                          {subscription.status === "paused" && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/subscriptions/${subscription.id}/resume`)}>Resume</Button>
                          )}
                          {!["cancelled", "expired"].includes(subscription.status) && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/subscriptions/${subscription.id}/cancel`)}>Cancel</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        )}

        {tab === "vendors" && (
          <Section
            title="Vendors"
            icon={Building2}
            action={<Button onClick={() => setVendorDialog({ mode: "create", form: vendorFormFrom() })}><Plus className="h-4 w-4" />Add vendor</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading vendors" description="Loading the vendor directory." />
            ) : vendors.length === 0 ? (
              <EmptyState
                title="No vendors yet"
                description="Add vendors before creating recurring expenses, bills, or payment records."
                actionLabel="Add vendor"
                onAction={() => setVendorDialog({ mode: "create", form: vendorFormFrom() })}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Contact email</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map((vendor) => (
                      <TableRow key={vendor.id}>
                        <TableCell>{vendor.name}</TableCell>
                        <TableCell>{humanize(vendor.vendorType)}</TableCell>
                        <TableCell>{statusBadge(vendor.status)}</TableCell>
                        <TableCell>{vendor.contactEmail || "-"}</TableCell>
                        <TableCell>{vendor.website || "-"}</TableCell>
                        <TableCell>{vendor.notes || "-"}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setVendorDialog({ mode: "edit", vendor, form: vendorFormFrom(vendor) })}><Edit3 className="h-4 w-4" />Edit</Button>
                            {vendor.status !== "archived" && (
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/vendors/${vendor.id}/archive`)}><Archive className="h-4 w-4" />Archive</Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        )}

        {tab === "reconciliation" && (
          <Section
            title="Reconciliation"
            icon={AlertCircle}
            action={<Button onClick={() => setReconciliationDialog({ form: reconciliationFormFrom() })}><Plus className="h-4 w-4" />Open exception</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading reconciliation" description="Loading AP exceptions, differences, and follow-up states." />
            ) : reconciliation.length === 0 ? (
              <EmptyState
                title="No reconciliation exceptions"
                description="Open AP exceptions, duplicates, or amount mismatches will appear here."
                actionLabel="Open exception"
                onAction={() => setReconciliationDialog({ form: reconciliationFormFrom() })}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliation.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{humanize(item.reasonCode)}</TableCell>
                      <TableCell>{item.summary}</TableCell>
                      <TableCell>{statusBadge(item.status)}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.differenceAmountCents, item.currency ?? "USD")}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {item.status === "open" && <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/reconciliation-exceptions/${item.id}/investigate`)}>Investigate</Button>}
                          {["open", "investigating"].includes(item.status) && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/reconciliation-exceptions/${item.id}/resolve`)}>Resolve</Button>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/reconciliation-exceptions/${item.id}/waive`)}>Waive</Button>
                            </>
                          )}
                          {["resolved", "waived"].includes(item.status) && <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/reconciliation-exceptions/${item.id}/reopen`)}>Reopen</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        )}

        <Section
          title="Applications"
          icon={Link2}
          action={(
            <ActionTooltip content="Apply an existing payment or credit to an open bill.">
              <Button variant="outline" onClick={() => setApplicationDialog({ form: applicationFormFrom() })}><Plus className="h-4 w-4" />Apply manually</Button>
            </ActionTooltip>
          )}
        >
          {isLoading ? (
            <EmptyState title="Loading applied payments" description="Loading payment and credit applications." />
          ) : applications.length === 0 ? (
            <EmptyState
              title="No applied payments"
              description="Payments and credits will appear here after they are applied to bills."
              actionLabel="Apply manually"
              onAction={() => setApplicationDialog({ form: applicationFormFrom() })}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target bill</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => {
                  const targetBill = billById.get(application.targetVendorBillId);
                  const payment = application.expensePaymentId ? paymentById.get(application.expensePaymentId) : undefined;
                  const credit = application.creditVendorBillId ? billById.get(application.creditVendorBillId) : undefined;
                  return (
                    <TableRow key={application.id}>
                      <TableCell>{targetBill ? billLabel(targetBill) : `Bill #${application.targetVendorBillId}`}</TableCell>
                      <TableCell>
                        {payment
                          ? paymentLabel(payment)
                          : credit
                            ? billLabel(credit)
                            : `Credit #${application.creditVendorBillId}`}
                      </TableCell>
                      <TableCell>{statusBadge(application.status)}</TableCell>
                      <TableCell className="text-right">{formatMoney(application.amountCents, application.currency)}</TableCell>
                      <TableCell className="text-right">
                        {application.status === "active" && (
                          <ActionTooltip content="Reverse this application without deleting the payment or bill.">
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bill-applications/${application.id}/reverse`)}>
                              <RotateCcw className="h-4 w-4" />
                              Reverse
                            </Button>
                          </ActionTooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <VendorDialog state={vendorDialog} onClose={() => setVendorDialog(null)} onSubmit={submitVendor} />
      <SubscriptionDialog state={subscriptionDialog} legalEntities={legalEntities} vendors={activeVendors} onClose={() => setSubscriptionDialog(null)} onSubmit={submitSubscription} />
      <BillDialog state={billDialog} legalEntities={legalEntities} vendors={activeVendors} subscriptions={subscriptions} bills={bills} isSubmitting={mutation.isPending} onClose={() => setBillDialog(null)} onSubmit={submitBill} />
      <PaymentDialog state={paymentDialog} legalEntities={legalEntities} vendors={activeVendors} isSubmitting={mutation.isPending} onClose={() => setPaymentDialog(null)} onSubmit={submitPayment} />
      <PaymentDetailDialog payment={paymentDetail} legalEntities={legalEntities} bills={bills} applications={applications} onClose={() => setPaymentDetail(null)} />
      <ApplicationDialog state={applicationDialog} bills={bills} payments={payments} onClose={() => setApplicationDialog(null)} onSubmit={submitApplication} />
      <ReconciliationDialog state={reconciliationDialog} onClose={() => setReconciliationDialog(null)} onSubmit={submitReconciliation} />
    </div>
  );
}
