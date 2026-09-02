import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  Building2,
  CheckCircle2,
  Edit3,
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
import { useToast } from "@/hooks/use-toast";

type FinanceTab = "bills" | "payments" | "subscriptions" | "vendors" | "reconciliation";

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

type FinanceOverview = {
  metrics?: {
    openBillsCount: number;
    overdueBillsCount: number;
    openReconciliationIssuesCount: number;
    activeSubscriptionsCount: number;
    openBillTotalsByCurrency: Array<{ currency: string; amountCents: number }>;
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
  { value: "subscriptions", label: "Subscriptions" },
  { value: "vendors", label: "Vendors" },
  { value: "reconciliation", label: "Reconciliation" },
];

const vendorTypes = ["saas", "cloud", "utility", "professional_service", "contractor_vendor", "supplier", "other"];
const vendorStatuses = ["active", "inactive", "archived"];
const cadences = ["weekly", "monthly", "quarterly", "annual", "custom"];
const subscriptionStatuses = ["draft", "trial", "active", "paused", "cancelled", "expired"];
const billKinds = ["invoice", "bill", "credit_memo", "statement", "other"];
const paymentMethods = ["provider", "ach", "check", "card", "wire", "manual", "other"];
const paymentStatuses = ["pending", "posted", "cleared", "failed", "voided"];
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

function formatDate(value?: string | null) {
  return value ? value : "-";
}

function legalEntityLabel(entity: FinanceLegalEntity) {
  return entity.legalName || `Legal entity #${entity.id}`;
}

function vendorLabel(vendor: FinanceVendor) {
  return vendor.name || `Vendor #${vendor.id}`;
}

function billLabel(bill: FinanceBill) {
  const vendor = bill.vendorName || `Vendor #${bill.vendorId}`;
  const reference = bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : humanize(bill.categoryCode);
  return `${vendor} - ${reference} - ${formatMoney(bill.amountCents, bill.currency)}`;
}

function subscriptionLabel(subscription: FinanceSubscription) {
  const vendor = subscription.vendorName || `Vendor #${subscription.vendorId}`;
  const amount = subscription.variableAmount
    ? "Variable"
    : formatMoney(subscription.expectedAmountCents, subscription.currency);
  return `${vendor} - ${humanize(subscription.categoryCode)} - ${amount}`;
}

function paymentLabel(payment: FinancePayment) {
  const vendor = payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned");
  const reference = payment.externalConfirmationRef || payment.methodLabel || humanize(payment.methodType);
  return `${vendor} - ${reference} - ${formatMoney(payment.amountCents, payment.currency)}`;
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
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
    </div>
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

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
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
    legalEntityId: String(subscription?.legalEntityId ?? legalEntities[0]?.id ?? ""),
    vendorId: String(subscription?.vendorId ?? vendors[0]?.id ?? ""),
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
    legalEntityId: String(bill?.legalEntityId ?? legalEntities[0]?.id ?? ""),
    vendorId: String(bill?.vendorId ?? vendors[0]?.id ?? ""),
    recurringExpenseId: bill?.recurringExpenseId == null ? "" : String(bill.recurringExpenseId),
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
  };
}

function paymentFormFrom(
  legalEntities: FinanceLegalEntity[],
  vendors: FinanceVendor[],
  payment?: FinancePayment,
): PaymentForm {
  return {
    legalEntityId: String(payment?.legalEntityId ?? legalEntities[0]?.id ?? ""),
    vendorId: payment?.vendorId == null ? String(vendors[0]?.id ?? "") : String(payment.vendorId),
    amount: centsToMoney(payment?.amountCents ?? 0),
    currency: payment?.currency ?? "USD",
    direction: payment?.direction ?? "outflow",
    paymentDate: payment?.paymentDate ?? "",
    methodType: payment?.methodType ?? "ach",
    methodLabel: payment?.methodLabel ?? "",
    institutionName: payment?.institutionName ?? "",
    maskedLast4: payment?.maskedLast4 ?? "",
    externalConfirmationRef: payment?.externalConfirmationRef ?? "",
    status: payment?.status ?? "pending",
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
          <DialogTitle>{state?.mode === "edit" ? "Edit vendor" : "Add vendor"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(form);
          }}
        >
          <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" value={form.vendorType} options={vendorTypes} onValueChange={(vendorType) => setForm({ ...form, vendorType })} />
            <SelectField label="Status" value={form.status} options={vendorStatuses} onValueChange={(status) => setForm({ ...form, status })} />
          </div>
          <TextField label="Website" value={form.website} onChange={(website) => setForm({ ...form, website })} />
          <TextField label="Contact email" type="email" value={form.contactEmail} onChange={(contactEmail) => setForm({ ...form, contactEmail })} />
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

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit subscription" : "Add subscription"}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Legal entity" value={form.legalEntityId} options={legalEntities.map((entity) => ({ value: String(entity.id), label: legalEntityLabel(entity) }))} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} />
            <SelectField label="Vendor" value={form.vendorId} options={vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))} onValueChange={(vendorId) => setForm({ ...form, vendorId })} />
            <TextField label="Category" value={form.categoryCode} onChange={(categoryCode) => setForm({ ...form, categoryCode })} />
            <SelectField label="Cadence" value={form.cadence} options={cadences} onValueChange={(cadence) => setForm({ ...form, cadence })} />
            <TextField label="Expected amount" type="number" value={form.expectedAmount} onChange={(expectedAmount) => setForm({ ...form, expectedAmount })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            <TextField label="Billing day" type="number" value={form.billingDay} onChange={(billingDay) => setForm({ ...form, billingDay })} />
            <TextField label="Next billing date" type="date" value={form.nextBillingDate} onChange={(nextBillingDate) => setForm({ ...form, nextBillingDate })} />
            <TextField label="Renewal date" type="date" value={form.renewalDate} onChange={(renewalDate) => setForm({ ...form, renewalDate })} />
            <TextField label="Trial ends" type="date" value={form.trialEndsOn} onChange={(trialEndsOn) => setForm({ ...form, trialEndsOn })} />
          </div>
          {state?.mode === "create" && (
            <SelectField label="Initial status" value={form.status} options={subscriptionStatuses} onValueChange={(status) => setForm({ ...form, status })} />
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
            <Button type="submit">Save</Button>
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
  onClose,
  onSubmit,
}: {
  state: { mode: "create" | "edit"; bill?: FinanceBill; form: BillForm } | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  subscriptions: FinanceSubscription[];
  bills: FinanceBill[];
  onClose: () => void;
  onSubmit: (form: BillForm) => void;
}) {
  const [form, setForm] = React.useState<BillForm>(billFormFrom([], []));

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit draft bill" : "Add bill"}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Legal entity" value={form.legalEntityId} options={legalEntities.map((entity) => ({ value: String(entity.id), label: legalEntityLabel(entity) }))} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} />
            <SelectField label="Vendor" value={form.vendorId} options={vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))} onValueChange={(vendorId) => setForm({ ...form, vendorId })} />
            <SelectField label="Kind" value={form.billKind} options={billKinds} onValueChange={(billKind) => setForm({ ...form, billKind })} />
            <TextField label="Invoice number" value={form.invoiceNumber} onChange={(invoiceNumber) => setForm({ ...form, invoiceNumber })} />
            <TextField label="Amount" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            <TextField label="Category" value={form.categoryCode} onChange={(categoryCode) => setForm({ ...form, categoryCode })} />
            <TextField label="Issue date" type="date" value={form.issueDate} onChange={(issueDate) => setForm({ ...form, issueDate })} />
            <TextField label="Due date" type="date" value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} />
            <TextField label="Service start" type="date" value={form.servicePeriodStart} onChange={(servicePeriodStart) => setForm({ ...form, servicePeriodStart })} />
            <TextField label="Service end" type="date" value={form.servicePeriodEnd} onChange={(servicePeriodEnd) => setForm({ ...form, servicePeriodEnd })} />
            <SelectField label="Subscription" value={form.recurringExpenseId || "none"} options={["none", ...subscriptions.map((subscription) => ({ value: String(subscription.id), label: subscriptionLabel(subscription) }))]} onValueChange={(recurringExpenseId) => setForm({ ...form, recurringExpenseId: recurringExpenseId === "none" ? "" : recurringExpenseId })} />
            <SelectField label="Credit source" value={form.creditForVendorBillId || "none"} options={["none", ...bills.map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))]} onValueChange={(creditForVendorBillId) => setForm({ ...form, creditForVendorBillId: creditForVendorBillId === "none" ? "" : creditForVendorBillId })} />
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
            <Button type="submit">Save</Button>
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
  onClose,
  onSubmit,
}: {
  state: { mode: "create" | "edit"; payment?: FinancePayment; form: PaymentForm } | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  onClose: () => void;
  onSubmit: (form: PaymentForm) => void;
}) {
  const [form, setForm] = React.useState<PaymentForm>(paymentFormFrom([], []));

  React.useEffect(() => {
    if (state) setForm(state.form);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit payment" : "Record payment"}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Legal entity" value={form.legalEntityId} options={legalEntities.map((entity) => ({ value: String(entity.id), label: legalEntityLabel(entity) }))} onValueChange={(legalEntityId) => setForm({ ...form, legalEntityId })} />
            <SelectField label="Vendor" value={form.vendorId || "none"} options={["none", ...vendors.map((vendor) => ({ value: String(vendor.id), label: vendorLabel(vendor) }))]} onValueChange={(vendorId) => setForm({ ...form, vendorId: vendorId === "none" ? "" : vendorId })} />
            <TextField label="Amount" type="number" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
            <TextField label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            <SelectField label="Direction" value={form.direction} options={["outflow", "refund"]} onValueChange={(direction) => setForm({ ...form, direction })} />
            <TextField label="Payment date" type="date" value={form.paymentDate} onChange={(paymentDate) => setForm({ ...form, paymentDate })} />
            <SelectField label="Method" value={form.methodType} options={paymentMethods} onValueChange={(methodType) => setForm({ ...form, methodType })} />
            <TextField label="Method label" value={form.methodLabel} onChange={(methodLabel) => setForm({ ...form, methodLabel })} />
            <TextField label="Institution" value={form.institutionName} onChange={(institutionName) => setForm({ ...form, institutionName })} />
            <TextField label="Last 4" value={form.maskedLast4} onChange={(maskedLast4) => setForm({ ...form, maskedLast4 })} />
            <TextField label="Confirmation" value={form.externalConfirmationRef} onChange={(externalConfirmationRef) => setForm({ ...form, externalConfirmationRef })} />
            {state?.mode === "create" && (
              <SelectField label="Initial status" value={form.status} options={paymentStatuses} onValueChange={(status) => setForm({ ...form, status })} />
            )}
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply to bill</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          <SelectField label="Source" value={form.sourceType} options={["payment", "credit"]} onValueChange={(sourceType) => setForm({ ...form, sourceType: sourceType as ApplicationForm["sourceType"] })} />
          <SelectField label="Target bill" value={form.targetVendorBillId} options={bills.map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))} onValueChange={(targetVendorBillId) => setForm({ ...form, targetVendorBillId })} />
          {form.sourceType === "payment" ? (
            <SelectField label="Payment" value={form.expensePaymentId} options={payments.map((payment) => ({ value: String(payment.id), label: paymentLabel(payment) }))} onValueChange={(expensePaymentId) => setForm({ ...form, expensePaymentId })} />
          ) : (
            <SelectField label="Credit bill" value={form.creditVendorBillId} options={bills.filter((bill) => bill.billKind === "credit_memo").map((bill) => ({ value: String(bill.id), label: billLabel(bill) }))} onValueChange={(creditVendorBillId) => setForm({ ...form, creditVendorBillId })} />
          )}
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
  const [tab, setTab] = React.useState<FinanceTab>("bills");
  const [vendorDialog, setVendorDialog] = React.useState<{ mode: "create" | "edit"; vendor?: FinanceVendor; form: VendorForm } | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = React.useState<{ mode: "create" | "edit"; subscription?: FinanceSubscription; form: SubscriptionForm } | null>(null);
  const [billDialog, setBillDialog] = React.useState<{ mode: "create" | "edit"; bill?: FinanceBill; form: BillForm } | null>(null);
  const [paymentDialog, setPaymentDialog] = React.useState<{ mode: "create" | "edit"; payment?: FinancePayment; form: PaymentForm } | null>(null);
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
  const paymentsQuery = useQuery<FinancePayment[]>({
    queryKey: [`${V2_FINANCE_BASE}/payments?pageSize=100`],
    queryFn: () => v2FinanceJson<FinancePayment[]>(`${V2_FINANCE_BASE}/payments?pageSize=100`),
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
  const payments = paymentsQuery.data ?? [];
  const applications = applicationsQuery.data ?? [];
  const reconciliation = reconciliationQuery.data ?? [];
  const billById = React.useMemo(() => new Map(bills.map((bill) => [bill.id, bill])), [bills]);
  const paymentById = React.useMemo(() => new Map(payments.map((payment) => [payment.id, payment])), [payments]);
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

  function mutate(method: string, path: string, body?: unknown, onSuccess?: () => void) {
    mutation.mutate(
      { method, path, body },
      { onSuccess },
    );
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
        legalEntityId: Number(form.legalEntityId),
        vendorId: Number(form.vendorId),
        categoryCode: form.categoryCode.trim(),
        cadence: form.cadence,
        expectedAmountCents: form.variableAmount ? null : moneyToCents(form.expectedAmount, true),
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
        const { legalEntityId: _legalEntityId, vendorId: _vendorId, status: _status, ...updateBody } = body;
        mutate("PATCH", `${V2_FINANCE_BASE}/subscriptions/${subscriptionDialog?.subscription?.id}`, updateBody, () => setSubscriptionDialog(null));
      } else {
        mutate("POST", `${V2_FINANCE_BASE}/subscriptions`, body, () => setSubscriptionDialog(null));
      }
    } catch (error) {
      mutation.reset();
      throw error;
    }
  }

  function submitBill(form: BillForm) {
    const body = {
      legalEntityId: Number(form.legalEntityId),
      vendorId: Number(form.vendorId),
      recurringExpenseId: optionalNullableNumber(form.recurringExpenseId),
      invoiceNumber: optionalNullableText(form.invoiceNumber),
      billKind: form.billKind,
      issueDate: optionalNullableText(form.issueDate),
      dueDate: optionalNullableText(form.dueDate),
      servicePeriodStart: optionalNullableText(form.servicePeriodStart),
      servicePeriodEnd: optionalNullableText(form.servicePeriodEnd),
      amountCents: moneyToCents(form.amount),
      currency: form.currency.trim().toUpperCase(),
      categoryCode: form.categoryCode.trim(),
      status: "draft",
      creditForVendorBillId: optionalNullableNumber(form.creditForVendorBillId),
      notes: optionalNullableText(form.notes),
    };
    const isEdit = billDialog?.mode === "edit";
    if (isEdit) {
      const { legalEntityId: _legalEntityId, vendorId: _vendorId, status: _status, ...updateBody } = body;
      mutate("PATCH", `${V2_FINANCE_BASE}/bills/${billDialog?.bill?.id}`, updateBody, () => setBillDialog(null));
    } else {
      mutate("POST", `${V2_FINANCE_BASE}/bills`, body, () => setBillDialog(null));
    }
  }

  function submitPayment(form: PaymentForm) {
    const body = {
      legalEntityId: Number(form.legalEntityId),
      vendorId: optionalNullableNumber(form.vendorId),
      amountCents: moneyToCents(form.amount),
      currency: form.currency.trim().toUpperCase(),
      direction: form.direction,
      paymentDate: optionalNullableText(form.paymentDate),
      methodType: form.methodType,
      methodLabel: optionalNullableText(form.methodLabel),
      institutionName: optionalNullableText(form.institutionName),
      maskedLast4: optionalText(form.maskedLast4),
      externalConfirmationRef: optionalNullableText(form.externalConfirmationRef),
      status: form.status,
    };
    const isEdit = paymentDialog?.mode === "edit";
    if (isEdit) {
      const { legalEntityId: _legalEntityId, status: _status, ...updateBody } = body;
      mutate("PATCH", `${V2_FINANCE_BASE}/payments/${paymentDialog?.payment?.id}`, updateBody, () => setPaymentDialog(null));
    } else {
      mutate("POST", `${V2_FINANCE_BASE}/payments`, body, () => setPaymentDialog(null));
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

        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Open bills" value={overviewQuery.data?.metrics?.openBillsCount ?? 0} icon={ReceiptText} />
          <Metric label="Overdue" value={overviewQuery.data?.metrics?.overdueBillsCount ?? 0} icon={AlertCircle} />
          <Metric label="Recurring" value={overviewQuery.data?.metrics?.activeSubscriptionsCount ?? 0} icon={Building2} />
          <Metric
            label="Open total"
            value={(overviewQuery.data?.metrics?.openBillTotalsByCurrency ?? []).map((row) => formatMoney(row.amountCents, row.currency)).join(" / ") || "$0.00"}
            icon={WalletCards}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.value}
              variant={tab === item.value ? "default" : "outline"}
              onClick={() => setTab(item.value)}
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

        {tab === "bills" && (
          <Section
            title="Bills"
            icon={ReceiptText}
            action={<Button onClick={() => setBillDialog({ mode: "create", form: billFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Add bill</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading bills" description="Loading vendor bills and settlement details." />
            ) : bills.length === 0 ? (
              <EmptyState
                title="No bills yet"
                description="Add vendor bills as they arrive so due dates, balances, and receipts stay visible."
                actionLabel="Add bill"
                onAction={() => setBillDialog({ mode: "create", form: billFormFrom(legalEntities, activeVendors) })}
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
                  {bills.map((bill) => (
                    <TableRow key={bill.id}>
                      <TableCell>{bill.vendorName || `Vendor #${bill.vendorId}`}</TableCell>
                      <TableCell>
                        <div>{bill.invoiceNumber || humanize(bill.categoryCode)}</div>
                        {bill.notes && <div className="mt-1 text-xs text-muted-foreground">{bill.notes}</div>}
                      </TableCell>
                      <TableCell>{formatDate(bill.dueDate)}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-2">{statusBadge(bill.status)}{bill.settlementState && statusBadge(bill.settlementState)}</div></TableCell>
                      <TableCell className="text-right">{formatMoney(bill.amountCents, bill.currency)}</TableCell>
                      <TableCell className="text-right">{formatMoney(bill.remainingAmountCents ?? bill.amountCents, bill.currency)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {bill.status === "draft" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setBillDialog({ mode: "edit", bill, form: billFormFrom(legalEntities, activeVendors, bill) })}><Edit3 className="h-4 w-4" />Edit</Button>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/receive`)}><ReceiptText className="h-4 w-4" />Receive</Button>
                            </>
                          )}
                          {["received", "disputed"].includes(bill.status) && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/approve`)}><CheckCircle2 className="h-4 w-4" />Approve</Button>
                          )}
                          {["received", "approved"].includes(bill.status) && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/dispute`)}><AlertCircle className="h-4 w-4" />Dispute</Button>
                          )}
                          {bill.billKind !== "credit_memo" && bill.status !== "draft" && bill.status !== "voided" && (bill.remainingAmountCents ?? 0) > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setApplicationDialog({ form: applicationFormFrom(bill) })}><Link2 className="h-4 w-4" />Apply</Button>
                          )}
                          {bill.status !== "voided" && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bills/${bill.id}/void`)}><XCircle className="h-4 w-4" />Void</Button>
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
            action={<Button onClick={() => setPaymentDialog({ mode: "create", form: paymentFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Record payment</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading payments" description="Loading payment records and unapplied balances." />
            ) : payments.length === 0 ? (
              <EmptyState
                title="No payments recorded"
                description="Record an actual payment after money has moved or is in flight."
                actionLabel="Record payment"
                onAction={() => setPaymentDialog({ mode: "create", form: paymentFormFrom(legalEntities, activeVendors) })}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Unapplied</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned")}</TableCell>
                      <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                      <TableCell>{payment.methodLabel || humanize(payment.methodType)}</TableCell>
                      <TableCell>{statusBadge(payment.status)}</TableCell>
                      <TableCell className="text-right">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
                      <TableCell className="text-right">{formatMoney(payment.remainingAmountCents ?? payment.amountCents, payment.currency)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {payment.status === "pending" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setPaymentDialog({ mode: "edit", payment, form: paymentFormFrom(legalEntities, activeVendors, payment) })}><Edit3 className="h-4 w-4" />Edit</Button>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/post`)}><CheckCircle2 className="h-4 w-4" />Post</Button>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/fail`)}><XCircle className="h-4 w-4" />Fail</Button>
                              <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/void`)}><Archive className="h-4 w-4" />Void</Button>
                            </>
                          )}
                          {payment.status === "posted" && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/clear`)}><CheckCircle2 className="h-4 w-4" />Clear</Button>
                          )}
                          {["posted", "cleared"].includes(payment.status) && (
                            <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/payments/${payment.id}/reverse`)}><RotateCcw className="h-4 w-4" />Reverse</Button>
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

        {tab === "subscriptions" && (
          <Section
            title="Subscriptions"
            icon={Building2}
            action={<Button onClick={() => setSubscriptionDialog({ mode: "create", form: subscriptionFormFrom(legalEntities, activeVendors) })}><Plus className="h-4 w-4" />Add subscription</Button>}
          >
            {isLoading ? (
              <EmptyState title="Loading subscriptions" description="Loading expected recurring expenses." />
            ) : subscriptions.length === 0 ? (
              <EmptyState
                title="No subscriptions yet"
                description="Track SaaS, payroll providers, utilities, and services before invoices arrive."
                actionLabel="Add subscription"
                onAction={() => setSubscriptionDialog({ mode: "create", form: subscriptionFormFrom(legalEntities, activeVendors) })}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead>Next bill</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div>{subscription.vendorName || `Vendor #${subscription.vendorId}`}</div>
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
                description="Add vendors before creating subscriptions, bills, or payment records."
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

        <Section title="Applications" icon={Link2} action={<Button variant="outline" onClick={() => setApplicationDialog({ form: applicationFormFrom() })}><Plus className="h-4 w-4" />Apply manually</Button>}>
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
                          <Button size="sm" variant="outline" onClick={() => mutate("POST", `${V2_FINANCE_BASE}/bill-applications/${application.id}/reverse`)}>
                            <RotateCcw className="h-4 w-4" />
                            Reverse
                          </Button>
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
      <BillDialog state={billDialog} legalEntities={legalEntities} vendors={activeVendors} subscriptions={subscriptions} bills={bills} onClose={() => setBillDialog(null)} onSubmit={submitBill} />
      <PaymentDialog state={paymentDialog} legalEntities={legalEntities} vendors={activeVendors} onClose={() => setPaymentDialog(null)} onSubmit={submitPayment} />
      <ApplicationDialog state={applicationDialog} bills={bills} payments={payments} onClose={() => setApplicationDialog(null)} onSubmit={submitApplication} />
      <ReconciliationDialog state={reconciliationDialog} onClose={() => setReconciliationDialog(null)} onSubmit={submitReconciliation} />
    </div>
  );
}
