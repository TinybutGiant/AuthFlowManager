import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle,
  Archive,
  Building2,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FileWarning,
  Pause,
  Play,
  Plus,
  ReceiptText,
  Repeat2,
  RotateCcw,
  Link2,
  WalletCards,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

type FinanceSection = "overview" | "expenses" | "subscriptions" | "vendors";

type CurrencyAmount = {
  currency: string;
  amountCents: number;
};

type FinanceOverview = {
  asOfDate: string;
  metrics: {
    unpaidBalanceByCurrency: CurrencyAmount[];
    billsDueThisWeekCount: number;
    billsDueThisWeekByCurrency: CurrencyAmount[];
    billsDueThisMonthCount: number;
    billsDueThisMonthByCurrency: CurrencyAmount[];
    monthlyRecurringSpendByCurrency: CurrencyAmount[];
    variableOrUnknownRecurringCount: number;
    activeSubscriptionsCount: number;
    openReconciliationIssuesCount: number;
    missingDocumentsCount: number;
    subscriptionPriceVarianceCount: number;
  };
  billsDueSoon: FinanceBill[];
  activeSubscriptions: FinanceSubscription[];
  missingDocumentationBills: FinanceBill[];
  subscriptionPriceVariances: Array<{
    billId: number;
    recurringExpenseId: number;
    vendorId: number;
    vendorName?: string | null;
    expectedAmountCents: number;
    actualAmountCents: number;
    differenceAmountCents: number;
    currency: string;
  }>;
};

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
  createdAt?: string | null;
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
  reversedAt?: string | null;
  reversedBy?: number | null;
  createdBy?: number | null;
  createdAt?: string | null;
};

type FinanceReconciliationException = {
  id: number;
  domain: string;
  expectedEntityType?: string | null;
  expectedEntityId?: number | null;
  actualEntityType?: string | null;
  actualEntityId?: number | null;
  currency?: string | null;
  expectedAmountCents?: number | null;
  actualAmountCents?: number | null;
  differenceAmountCents?: number | null;
  reasonCode: string;
  summary: string;
  status: string;
  ownerAdminId?: number | null;
  resolvedAt?: string | null;
  resolvedBy?: number | null;
};

type VendorFormState = {
  name: string;
  vendorType: string;
  status: string;
  website: string;
  contactEmail: string;
  notes: string;
};

type SubscriptionFormState = {
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

type BillFormState = {
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

type PaymentFormState = {
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

type ApplicationFormState = {
  sourceType: "payment" | "credit";
  targetVendorBillId: string;
  expensePaymentId: string;
  creditVendorBillId: string;
  amount: string;
  currency: string;
};

type ReconciliationFormState = {
  expectedEntityType: string;
  expectedEntityId: string;
  actualEntityType: string;
  actualEntityId: string;
  currency: string;
  expectedAmount: string;
  actualAmount: string;
  reasonCode: string;
  summary: string;
};

type VendorDialogState = {
  mode: "create" | "edit";
  vendor?: FinanceVendor;
  form: VendorFormState;
};

type SubscriptionDialogState = {
  mode: "create" | "edit";
  subscription?: FinanceSubscription;
  form: SubscriptionFormState;
};

type BillDialogState = {
  mode: "create" | "edit";
  bill?: FinanceBill;
  form: BillFormState;
};

type PaymentDialogState = {
  mode: "create" | "edit";
  payment?: FinancePayment;
  form: PaymentFormState;
};

type ApplicationDialogState = {
  bill?: FinanceBill;
  form: ApplicationFormState;
};

type ReconciliationDialogState = {
  form: ReconciliationFormState;
};

type FinanceMutationRequest = {
  method: "POST" | "PATCH";
  url: string;
  body: Record<string, unknown>;
  successTitle: string;
  onSuccess?: () => void;
};

const sections: FinanceSection[] = ["overview", "expenses", "subscriptions", "vendors"];
const financeRolesQueryPrefix = "/api/admin/finance";
const noSelection = "__none__";

const vendorTypes = [
  "saas",
  "cloud",
  "payroll_provider",
  "utility",
  "professional_service",
  "contractor_vendor",
  "supplier",
  "other",
] as const;
const vendorStatuses = ["active", "inactive", "archived"] as const;
const subscriptionStatuses = ["draft", "trial", "active"] as const;
const subscriptionCadences = ["weekly", "monthly", "quarterly", "annual", "custom"] as const;
const billKinds = ["invoice", "bill", "credit_memo", "statement", "other"] as const;
const paymentDirections = ["outflow", "refund"] as const;
const paymentMethods = ["provider", "ach", "check", "card", "wire", "manual", "other"] as const;
const initialPaymentStatuses = ["pending", "posted", "cleared"] as const;
const reconciliationEntityTypes = [
  "vendors",
  "recurring_expenses",
  "vendor_bills",
  "expense_payments",
  "vendor_bill_applications",
] as const;
const reconciliationReasonCodes = [
  "unmatched_payment",
  "amount_mismatch",
  "duplicate_charge",
  "missing_invoice",
  "missing_receipt",
  "stale_unpaid_bill",
  "other_ap_mismatch",
] as const;
const expenseCategories = [
  "saas",
  "cloud",
  "payroll_provider",
  "professional_service",
  "utility",
  "contractor",
  "supplies",
  "insurance",
  "tax",
  "other",
] as const;

export default function FinanceManagement() {
  const [location, setLocation] = useLocation();
  const selectedSection = sectionFromLocation(location);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [vendorDialog, setVendorDialog] = React.useState<VendorDialogState | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = React.useState<SubscriptionDialogState | null>(null);
  const [billDialog, setBillDialog] = React.useState<BillDialogState | null>(null);
  const [paymentDialog, setPaymentDialog] = React.useState<PaymentDialogState | null>(null);
  const [applicationDialog, setApplicationDialog] = React.useState<ApplicationDialogState | null>(null);
  const [reconciliationDialog, setReconciliationDialog] = React.useState<ReconciliationDialogState | null>(null);

  const overviewQuery = useQuery<FinanceOverview>({
    queryKey: ["/api/admin/finance/overview"],
  });
  const legalEntitiesQuery = useQuery<FinanceLegalEntity[]>({
    queryKey: ["/api/admin/finance/legal-entities"],
  });
  const billsQuery = useQuery<FinanceBill[]>({
    queryKey: ["/api/admin/finance/bills?pageSize=100"],
  });
  const paymentsQuery = useQuery<FinancePayment[]>({
    queryKey: ["/api/admin/finance/payments?pageSize=100"],
  });
  const applicationsQuery = useQuery<FinanceBillApplication[]>({
    queryKey: ["/api/admin/finance/bill-applications?pageSize=100"],
  });
  const reconciliationQuery = useQuery<FinanceReconciliationException[]>({
    queryKey: ["/api/admin/finance/reconciliation-exceptions?pageSize=100"],
  });
  const subscriptionsQuery = useQuery<FinanceSubscription[]>({
    queryKey: ["/api/admin/finance/subscriptions?pageSize=100"],
  });
  const vendorsQuery = useQuery<FinanceVendor[]>({
    queryKey: ["/api/admin/finance/vendors?pageSize=100"],
  });

  const financeMutation = useMutation({
    mutationFn: async (request: FinanceMutationRequest) => {
      const response = await apiRequest(request.method, request.url, request.body);
      return response.json();
    },
    onSuccess: async (_data, request) => {
      request.onSuccess?.();
      await invalidateFinanceQueries(queryClient);
      toast({ title: request.successTitle });
    },
    onError: (error) => {
      toast({
        title: "Finance update failed",
        description: getApiErrorMessage(error, "The finance record was not updated."),
        variant: "destructive",
      });
    },
  });

  const legalEntities = legalEntitiesQuery.data ?? [];
  const vendors = vendorsQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];
  const bills = billsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const applications = applicationsQuery.data ?? [];
  const reconciliationExceptions = reconciliationQuery.data ?? [];
  const activeVendors = React.useMemo(
    () => vendors.filter((vendor) => vendor.status !== "archived"),
    [vendors],
  );
  const linkableSubscriptions = React.useMemo(
    () => subscriptions.filter((subscription) => subscription.status !== "cancelled" && subscription.status !== "expired"),
    [subscriptions],
  );
  const linkableBills = React.useMemo(
    () => bills.filter((bill) => bill.status !== "voided"),
    [bills],
  );
  const isMutating = financeMutation.isPending;

  const error =
    overviewQuery.error ||
    legalEntitiesQuery.error ||
    billsQuery.error ||
    paymentsQuery.error ||
    applicationsQuery.error ||
    reconciliationQuery.error ||
    subscriptionsQuery.error ||
    vendorsQuery.error;

  function openCreateVendor() {
    setVendorDialog({
      mode: "create",
      form: emptyVendorForm(),
    });
  }

  function openEditVendor(vendor: FinanceVendor) {
    setVendorDialog({
      mode: "edit",
      vendor,
      form: vendorFormFromVendor(vendor),
    });
  }

  function submitVendor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vendorDialog) return;

    const body = compactPayload({
      name: vendorDialog.form.name.trim(),
      vendorType: vendorDialog.form.vendorType,
      status: vendorDialog.form.status,
      website: optionalString(vendorDialog.form.website),
      contactEmail: optionalString(vendorDialog.form.contactEmail),
      notes: optionalString(vendorDialog.form.notes),
    });

    financeMutation.mutate({
      method: vendorDialog.mode === "create" ? "POST" : "PATCH",
      url: vendorDialog.mode === "create"
        ? "/api/admin/finance/vendors"
        : `/api/admin/finance/vendors/${vendorDialog.vendor?.id}`,
      body,
      successTitle: vendorDialog.mode === "create" ? "Vendor added" : "Vendor updated",
      onSuccess: () => setVendorDialog(null),
    });
  }

  function archiveVendor(vendor: FinanceVendor) {
    if (!window.confirm(`Archive ${vendor.name}?`)) return;
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/vendors/${vendor.id}/archive`,
      body: {},
      successTitle: "Vendor archived",
    });
  }

  function openCreateSubscription() {
    setSubscriptionDialog({
      mode: "create",
      form: emptySubscriptionForm(legalEntities[0], activeVendors[0]),
    });
  }

  function openEditSubscription(subscription: FinanceSubscription) {
    setSubscriptionDialog({
      mode: "edit",
      subscription,
      form: subscriptionFormFromSubscription(subscription),
    });
  }

  function submitSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subscriptionDialog) return;

    try {
      const body = subscriptionPayload(subscriptionDialog);
      financeMutation.mutate({
        method: subscriptionDialog.mode === "create" ? "POST" : "PATCH",
        url: subscriptionDialog.mode === "create"
          ? "/api/admin/finance/subscriptions"
          : `/api/admin/finance/subscriptions/${subscriptionDialog.subscription?.id}`,
        body,
        successTitle: subscriptionDialog.mode === "create" ? "Subscription added" : "Subscription updated",
        onSuccess: () => setSubscriptionDialog(null),
      });
    } catch (error) {
      toast({
        title: "Subscription form needs attention",
        description: error instanceof Error ? error.message : "Check the subscription fields.",
        variant: "destructive",
      });
    }
  }

  function transitionSubscription(subscription: FinanceSubscription, action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !window.confirm(`Cancel ${subscription.vendorName || `subscription #${subscription.id}`}?`)) {
      return;
    }
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/subscriptions/${subscription.id}/${action}`,
      body: {},
      successTitle: `Subscription ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}`,
    });
  }

  function openCreateBill() {
    setBillDialog({
      mode: "create",
      form: emptyBillForm(legalEntities[0], activeVendors[0]),
    });
  }

  function openEditBill(bill: FinanceBill) {
    setBillDialog({
      mode: "edit",
      bill,
      form: billFormFromBill(bill),
    });
  }

  function submitBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!billDialog) return;

    try {
      const body = billPayload(billDialog);
      financeMutation.mutate({
        method: billDialog.mode === "create" ? "POST" : "PATCH",
        url: billDialog.mode === "create"
          ? "/api/admin/finance/bills"
          : `/api/admin/finance/bills/${billDialog.bill?.id}`,
        body,
        successTitle: billDialog.mode === "create" ? "Bill added" : "Bill updated",
        onSuccess: () => setBillDialog(null),
      });
    } catch (error) {
      toast({
        title: "Bill form needs attention",
        description: error instanceof Error ? error.message : "Check the bill fields.",
        variant: "destructive",
      });
    }
  }

  function transitionBill(bill: FinanceBill, action: "receive" | "approve" | "dispute" | "void") {
    if (action === "void" && !window.confirm(`Void bill ${bill.invoiceNumber || `#${bill.id}`}?`)) {
      return;
    }
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/bills/${bill.id}/${action}`,
      body: {},
      successTitle: `Bill ${action === "receive" ? "received" : action === "approve" ? "approved" : action === "dispute" ? "disputed" : "voided"}`,
    });
  }

  function openCreatePayment() {
    setPaymentDialog({
      mode: "create",
      form: emptyPaymentForm(legalEntities[0], activeVendors[0]),
    });
  }

  function openEditPayment(payment: FinancePayment) {
    setPaymentDialog({
      mode: "edit",
      payment,
      form: paymentFormFromPayment(payment),
    });
  }

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentDialog) return;

    try {
      const body = paymentPayload(paymentDialog);
      financeMutation.mutate({
        method: paymentDialog.mode === "create" ? "POST" : "PATCH",
        url: paymentDialog.mode === "create"
          ? "/api/admin/finance/payments"
          : `/api/admin/finance/payments/${paymentDialog.payment?.id}`,
        body,
        successTitle: paymentDialog.mode === "create" ? "Payment recorded" : "Payment updated",
        onSuccess: () => setPaymentDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payment form needs attention",
        description: error instanceof Error ? error.message : "Check the payment fields.",
        variant: "destructive",
      });
    }
  }

  function transitionPayment(payment: FinancePayment, action: "post" | "clear" | "fail" | "void" | "reverse") {
    if (["fail", "void", "reverse"].includes(action) && !window.confirm(`${humanize(action)} payment #${payment.id}?`)) {
      return;
    }
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/payments/${payment.id}/${action}`,
      body: {},
      successTitle: `Payment ${action === "post" ? "posted" : action === "clear" ? "cleared" : action === "fail" ? "failed" : action === "void" ? "voided" : "reversed"}`,
    });
  }

  function openApplyToBill(bill: FinanceBill) {
    setApplicationDialog({
      bill,
      form: emptyApplicationForm(bill),
    });
  }

  function submitApplication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applicationDialog) return;

    try {
      const body = applicationPayload(applicationDialog.form);
      financeMutation.mutate({
        method: "POST",
        url: applicationDialog.form.sourceType === "payment"
          ? "/api/admin/finance/bill-applications/payment"
          : "/api/admin/finance/bill-applications/credit",
        body,
        successTitle: applicationDialog.form.sourceType === "payment" ? "Payment applied" : "Credit applied",
        onSuccess: () => setApplicationDialog(null),
      });
    } catch (error) {
      toast({
        title: "Application form needs attention",
        description: error instanceof Error ? error.message : "Check the application fields.",
        variant: "destructive",
      });
    }
  }

  function reverseApplication(application: FinanceBillApplication) {
    if (!window.confirm(`Reverse application #${application.id}?`)) return;
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/bill-applications/${application.id}/reverse`,
      body: {},
      successTitle: "Application reversed",
    });
  }

  function openCreateReconciliationException() {
    setReconciliationDialog({
      form: emptyReconciliationForm(),
    });
  }

  function submitReconciliationException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reconciliationDialog) return;

    try {
      financeMutation.mutate({
        method: "POST",
        url: "/api/admin/finance/reconciliation-exceptions",
        body: reconciliationPayload(reconciliationDialog.form),
        successTitle: "Exception opened",
        onSuccess: () => setReconciliationDialog(null),
      });
    } catch (error) {
      toast({
        title: "Exception form needs attention",
        description: error instanceof Error ? error.message : "Check the exception fields.",
        variant: "destructive",
      });
    }
  }

  function transitionReconciliationException(
    exception: FinanceReconciliationException,
    action: "investigate" | "resolve" | "waive" | "reopen",
  ) {
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/reconciliation-exceptions/${exception.id}/${action}`,
      body: {},
      successTitle: `Exception ${action === "investigate" ? "moved to investigating" : action === "resolve" ? "resolved" : action === "waive" ? "waived" : "reopened"}`,
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-light text-foreground" data-testid="text-finance-management-title">
          Finance
        </h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Finance data unavailable</AlertTitle>
          <AlertDescription>
            {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={selectedSection}
        onValueChange={(value) => {
          const next = value as FinanceSection;
          setLocation(next === "overview" ? "/finance-management" : `/finance-management/${next}`);
        }}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewPanel
            overview={overviewQuery.data}
            isLoading={overviewQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="expenses" className="space-y-6">
          <ExpensesPanel
            bills={bills}
            payments={payments}
            applications={applications}
            reconciliationExceptions={reconciliationExceptions}
            isLoading={billsQuery.isLoading || paymentsQuery.isLoading || applicationsQuery.isLoading || reconciliationQuery.isLoading}
            onCreateBill={openCreateBill}
            onEditBill={openEditBill}
            onBillTransition={transitionBill}
            onApplyToBill={openApplyToBill}
            onCreatePayment={openCreatePayment}
            onEditPayment={openEditPayment}
            onPaymentTransition={transitionPayment}
            onReverseApplication={reverseApplication}
            onCreateReconciliationException={openCreateReconciliationException}
            onReconciliationTransition={transitionReconciliationException}
            isMutating={isMutating}
          />
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-6">
          <SubscriptionsPanel
            subscriptions={subscriptions}
            isLoading={subscriptionsQuery.isLoading}
            onCreateSubscription={openCreateSubscription}
            onEditSubscription={openEditSubscription}
            onSubscriptionTransition={transitionSubscription}
            isMutating={isMutating}
          />
        </TabsContent>

        <TabsContent value="vendors" className="space-y-6">
          <VendorsPanel
            vendors={vendors}
            isLoading={vendorsQuery.isLoading}
            onCreateVendor={openCreateVendor}
            onEditVendor={openEditVendor}
            onArchiveVendor={archiveVendor}
            isMutating={isMutating}
          />
        </TabsContent>
      </Tabs>

      <VendorDialog
        state={vendorDialog}
        isPending={isMutating}
        onClose={() => setVendorDialog(null)}
        onChange={(form) => setVendorDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitVendor}
      />
      <SubscriptionDialog
        state={subscriptionDialog}
        legalEntities={legalEntities}
        vendors={activeVendors}
        isPending={isMutating}
        onClose={() => setSubscriptionDialog(null)}
        onChange={(form) => setSubscriptionDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitSubscription}
      />
      <BillDialog
        state={billDialog}
        legalEntities={legalEntities}
        vendors={activeVendors}
        subscriptions={linkableSubscriptions}
        bills={linkableBills}
        isPending={isMutating}
        onClose={() => setBillDialog(null)}
        onChange={(form) => setBillDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitBill}
      />
      <PaymentDialog
        state={paymentDialog}
        legalEntities={legalEntities}
        vendors={activeVendors}
        isPending={isMutating}
        onClose={() => setPaymentDialog(null)}
        onChange={(form) => setPaymentDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayment}
      />
      <ApplicationDialog
        state={applicationDialog}
        bills={bills}
        payments={payments}
        isPending={isMutating}
        onClose={() => setApplicationDialog(null)}
        onChange={(form) => setApplicationDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitApplication}
      />
      <ReconciliationDialog
        state={reconciliationDialog}
        isPending={isMutating}
        onClose={() => setReconciliationDialog(null)}
        onChange={(form) => setReconciliationDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitReconciliationException}
      />
    </div>
  );
}

function OverviewPanel({ overview, isLoading }: { overview?: FinanceOverview; isLoading: boolean }) {
  const metrics = overview?.metrics;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Unpaid balance"
          value={formatMoneyBreakdown(metrics?.unpaidBalanceByCurrency)}
          icon={WalletCards}
        />
        <MetricCard
          title="Due this week"
          value={formatMoneyBreakdown(metrics?.billsDueThisWeekByCurrency)}
          detail={`${metrics?.billsDueThisWeekCount ?? 0} bill(s)`}
          icon={CalendarClock}
        />
        <MetricCard
          title="Monthly recurring"
          value={formatMoneyBreakdown(metrics?.monthlyRecurringSpendByCurrency)}
          detail={`${metrics?.variableOrUnknownRecurringCount ?? 0} variable`}
          icon={Repeat2}
        />
        <MetricCard
          title="Active subscriptions"
          value={metrics?.activeSubscriptionsCount ?? 0}
          icon={Repeat2}
        />
        <MetricCard
          title="Missing docs"
          value={metrics?.missingDocumentsCount ?? 0}
          icon={FileWarning}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Bills Due Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BillsTable bills={overview?.billsDueSoon ?? []} isLoading={isLoading} compact />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat2 className="h-5 w-5" />
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SubscriptionsTable subscriptions={overview?.activeSubscriptions ?? []} isLoading={isLoading} compact />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5" />
              Missing Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BillsTable bills={overview?.missingDocumentationBills ?? []} isLoading={isLoading} compact />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Price Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PriceVarianceTable rows={overview?.subscriptionPriceVariances ?? []} isLoading={isLoading} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ExpensesPanel({
  bills,
  payments,
  applications,
  reconciliationExceptions,
  isLoading,
  onCreateBill,
  onEditBill,
  onBillTransition,
  onApplyToBill,
  onCreatePayment,
  onEditPayment,
  onPaymentTransition,
  onReverseApplication,
  onCreateReconciliationException,
  onReconciliationTransition,
  isMutating,
}: {
  bills: FinanceBill[];
  payments: FinancePayment[];
  applications: FinanceBillApplication[];
  reconciliationExceptions: FinanceReconciliationException[];
  isLoading: boolean;
  onCreateBill: () => void;
  onEditBill: (bill: FinanceBill) => void;
  onBillTransition: (bill: FinanceBill, action: "receive" | "approve" | "dispute" | "void") => void;
  onApplyToBill: (bill: FinanceBill) => void;
  onCreatePayment: () => void;
  onEditPayment: (payment: FinancePayment) => void;
  onPaymentTransition: (payment: FinancePayment, action: "post" | "clear" | "fail" | "void" | "reverse") => void;
  onReverseApplication: (application: FinanceBillApplication) => void;
  onCreateReconciliationException: () => void;
  onReconciliationTransition: (
    exception: FinanceReconciliationException,
    action: "investigate" | "resolve" | "waive" | "reopen",
  ) => void;
  isMutating: boolean;
}) {
  const unappliedPayments = payments.filter((payment) => (
    ["posted", "cleared"].includes(payment.status) && (payment.remainingAmountCents ?? 0) > 0
  ));

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            Bills
          </CardTitle>
          <Button size="sm" onClick={onCreateBill}>
            <Plus className="h-4 w-4" />
            Bill
          </Button>
        </CardHeader>
        <CardContent>
          <BillsTable
            bills={bills}
            isLoading={isLoading}
            onEdit={onEditBill}
            onTransition={onBillTransition}
            onApply={onApplyToBill}
            isMutating={isMutating}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <WalletCards className="h-5 w-5" />
            Payments
          </CardTitle>
          <Button size="sm" onClick={onCreatePayment}>
            <Plus className="h-4 w-4" />
            Payment
          </Button>
        </CardHeader>
        <CardContent>
          <PaymentsTable
            payments={payments}
            isLoading={isLoading}
            onEdit={onEditPayment}
            onTransition={onPaymentTransition}
            isMutating={isMutating}
          />
          {unappliedPayments.length > 0 && (
            <div className="mt-4 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3">
              <div className="mb-2 text-sm font-medium">Unapplied Payments</div>
              <PaymentsTable payments={unappliedPayments.slice(0, 5)} isLoading={false} compact />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Applications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationsTable
            applications={applications}
            bills={bills}
            payments={payments}
            isLoading={isLoading}
            onReverse={onReverseApplication}
            isMutating={isMutating}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Reconciliation
          </CardTitle>
          <Button size="sm" onClick={onCreateReconciliationException}>
            <Plus className="h-4 w-4" />
            Exception
          </Button>
        </CardHeader>
        <CardContent>
          <ReconciliationTable
            exceptions={reconciliationExceptions}
            isLoading={isLoading}
            onTransition={onReconciliationTransition}
            isMutating={isMutating}
          />
        </CardContent>
      </Card>
    </>
  );
}

function SubscriptionsPanel({
  subscriptions,
  isLoading,
  onCreateSubscription,
  onEditSubscription,
  onSubscriptionTransition,
  isMutating,
}: {
  subscriptions: FinanceSubscription[];
  isLoading: boolean;
  onCreateSubscription: () => void;
  onEditSubscription: (subscription: FinanceSubscription) => void;
  onSubscriptionTransition: (subscription: FinanceSubscription, action: "pause" | "resume" | "cancel") => void;
  isMutating: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Repeat2 className="h-5 w-5" />
          Subscriptions
        </CardTitle>
        <Button size="sm" onClick={onCreateSubscription}>
          <Plus className="h-4 w-4" />
          Subscription
        </Button>
      </CardHeader>
      <CardContent>
        <SubscriptionsTable
          subscriptions={subscriptions}
          isLoading={isLoading}
          onEdit={onEditSubscription}
          onTransition={onSubscriptionTransition}
          isMutating={isMutating}
        />
      </CardContent>
    </Card>
  );
}

function VendorsPanel({
  vendors,
  isLoading,
  onCreateVendor,
  onEditVendor,
  onArchiveVendor,
  isMutating,
}: {
  vendors: FinanceVendor[];
  isLoading: boolean;
  onCreateVendor: () => void;
  onEditVendor: (vendor: FinanceVendor) => void;
  onArchiveVendor: (vendor: FinanceVendor) => void;
  isMutating: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Vendors
        </CardTitle>
        <Button size="sm" onClick={onCreateVendor}>
          <Plus className="h-4 w-4" />
          Vendor
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <EmptyRow colSpan={5} label="Loading vendors..." />
            ) : vendors.length === 0 ? (
              <EmptyRow colSpan={5} label="No vendors." />
            ) : (
              vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>{humanize(vendor.vendorType)}</TableCell>
                  <TableCell>{statusBadge(vendor.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {vendor.contactEmail || vendor.website || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => onEditVendor(vendor)} disabled={isMutating}>
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </Button>
                      {vendor.status !== "archived" && (
                        <Button size="sm" variant="outline" onClick={() => onArchiveVendor(vendor)} disabled={isMutating}>
                          <Archive className="h-4 w-4" />
                          Archive
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BillsTable({
  bills,
  isLoading,
  compact = false,
  onEdit,
  onTransition,
  onApply,
  isMutating = false,
}: {
  bills: FinanceBill[];
  isLoading: boolean;
  compact?: boolean;
  onEdit?: (bill: FinanceBill) => void;
  onTransition?: (bill: FinanceBill, action: "receive" | "approve" | "dispute" | "void") => void;
  onApply?: (bill: FinanceBill) => void;
  isMutating?: boolean;
}) {
  const showActions = !compact && Boolean(onEdit && onTransition);
  const colSpan = compact ? 5 : showActions ? 8 : 7;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          {!compact && <TableHead>Invoice</TableHead>}
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Open</TableHead>
          {!compact && <TableHead>Docs</TableHead>}
          {showActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={colSpan} label="Loading bills..." />
        ) : bills.length === 0 ? (
          <EmptyRow colSpan={colSpan} label="No bills." />
        ) : (
          bills.map((bill) => (
            <TableRow key={bill.id}>
              <TableCell>
                <div className="font-medium">{bill.vendorName || `Vendor #${bill.vendorId}`}</div>
                <div className="text-xs text-muted-foreground">{humanize(bill.categoryCode)}</div>
              </TableCell>
              {!compact && <TableCell>{bill.invoiceNumber || "-"}</TableCell>}
              <TableCell>{formatDate(bill.dueDate)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {statusBadge(bill.status)}
                  {bill.settlementState && statusBadge(bill.settlementState)}
                </div>
              </TableCell>
              <TableCell className="text-right">{formatMoney(bill.amountCents, bill.currency)}</TableCell>
              <TableCell className="text-right">{formatMoney(bill.remainingAmountCents, bill.currency)}</TableCell>
              {!compact && <TableCell>{bill.documentCount ?? 0}</TableCell>}
              {showActions && (
                <TableCell>
                  <BillActionButtons
                    bill={bill}
                    isMutating={isMutating}
                    onEdit={onEdit}
                    onTransition={onTransition}
                    onApply={onApply}
                  />
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function BillActionButtons({
  bill,
  isMutating,
  onEdit,
  onTransition,
  onApply,
}: {
  bill: FinanceBill;
  isMutating: boolean;
  onEdit?: (bill: FinanceBill) => void;
  onTransition?: (bill: FinanceBill, action: "receive" | "approve" | "dispute" | "void") => void;
  onApply?: (bill: FinanceBill) => void;
}) {
  if (!onEdit || !onTransition) return null;
  const canApply = onApply && bill.billKind !== "credit_memo" && !["draft", "voided"].includes(bill.status) && (bill.remainingAmountCents ?? 0) > 0;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {canApply && (
        <Button size="sm" variant="outline" onClick={() => onApply(bill)} disabled={isMutating}>
          <Link2 className="h-4 w-4" />
          Apply
        </Button>
      )}
      {bill.status === "draft" && (
        <>
          <Button size="sm" variant="outline" onClick={() => onEdit(bill)} disabled={isMutating}>
            <Edit3 className="h-4 w-4" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(bill, "receive")} disabled={isMutating}>
            <ReceiptText className="h-4 w-4" />
            Receive
          </Button>
        </>
      )}
      {["received", "disputed"].includes(bill.status) && (
        <Button size="sm" variant="outline" onClick={() => onTransition(bill, "approve")} disabled={isMutating}>
          <CheckCircle2 className="h-4 w-4" />
          Approve
        </Button>
      )}
      {["received", "approved"].includes(bill.status) && (
        <Button size="sm" variant="outline" onClick={() => onTransition(bill, "dispute")} disabled={isMutating}>
          <AlertCircle className="h-4 w-4" />
          Dispute
        </Button>
      )}
      {bill.status !== "voided" && (
        <Button size="sm" variant="outline" onClick={() => onTransition(bill, "void")} disabled={isMutating}>
          <XCircle className="h-4 w-4" />
          Void
        </Button>
      )}
    </div>
  );
}

function PaymentsTable({
  payments,
  isLoading,
  compact = false,
  onEdit,
  onTransition,
  isMutating = false,
}: {
  payments: FinancePayment[];
  isLoading: boolean;
  compact?: boolean;
  onEdit?: (payment: FinancePayment) => void;
  onTransition?: (payment: FinancePayment, action: "post" | "clear" | "fail" | "void" | "reverse") => void;
  isMutating?: boolean;
}) {
  const showActions = !compact && Boolean(onEdit && onTransition);
  const colSpan = showActions ? 7 : 6;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Unapplied</TableHead>
          {showActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={colSpan} label="Loading payments..." />
        ) : payments.length === 0 ? (
          <EmptyRow colSpan={colSpan} label="No payments." />
        ) : (
          payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="font-medium">
                {payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned")}
              </TableCell>
              <TableCell>{formatDate(payment.paymentDate)}</TableCell>
              <TableCell>{payment.methodLabel || humanize(payment.methodType)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {statusBadge(payment.direction)}
                  {statusBadge(payment.status)}
                </div>
              </TableCell>
              <TableCell className="text-right">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
              <TableCell className="text-right">{formatMoney(payment.remainingAmountCents, payment.currency)}</TableCell>
              {showActions && (
                <TableCell>
                  <PaymentActionButtons
                    payment={payment}
                    isMutating={isMutating}
                    onEdit={onEdit}
                    onTransition={onTransition}
                  />
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function PaymentActionButtons({
  payment,
  isMutating,
  onEdit,
  onTransition,
}: {
  payment: FinancePayment;
  isMutating: boolean;
  onEdit?: (payment: FinancePayment) => void;
  onTransition?: (payment: FinancePayment, action: "post" | "clear" | "fail" | "void" | "reverse") => void;
}) {
  if (!onEdit || !onTransition) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {payment.status === "pending" && (
        <>
          <Button size="sm" variant="outline" onClick={() => onEdit(payment)} disabled={isMutating}>
            <Edit3 className="h-4 w-4" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "post")} disabled={isMutating}>
            <CheckCircle2 className="h-4 w-4" />
            Post
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "fail")} disabled={isMutating}>
            <XCircle className="h-4 w-4" />
            Fail
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "void")} disabled={isMutating}>
            <Archive className="h-4 w-4" />
            Void
          </Button>
        </>
      )}
      {payment.status === "posted" && (
        <>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "clear")} disabled={isMutating}>
            <CheckCircle2 className="h-4 w-4" />
            Clear
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "fail")} disabled={isMutating}>
            <XCircle className="h-4 w-4" />
            Fail
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTransition(payment, "reverse")} disabled={isMutating}>
            <RotateCcw className="h-4 w-4" />
            Reverse
          </Button>
        </>
      )}
      {payment.status === "cleared" && (
        <Button size="sm" variant="outline" onClick={() => onTransition(payment, "reverse")} disabled={isMutating}>
          <RotateCcw className="h-4 w-4" />
          Reverse
        </Button>
      )}
    </div>
  );
}

function ApplicationsTable({
  applications,
  bills,
  payments,
  isLoading,
  onReverse,
  isMutating,
}: {
  applications: FinanceBillApplication[];
  bills: FinanceBill[];
  payments: FinancePayment[];
  isLoading: boolean;
  onReverse: (application: FinanceBillApplication) => void;
  isMutating: boolean;
}) {
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));

  return (
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
        {isLoading ? (
          <EmptyRow colSpan={5} label="Loading applications..." />
        ) : applications.length === 0 ? (
          <EmptyRow colSpan={5} label="No applications." />
        ) : (
          applications.map((application) => {
            const targetBill = billById.get(application.targetVendorBillId);
            const payment = application.expensePaymentId ? paymentById.get(application.expensePaymentId) : undefined;
            const credit = application.creditVendorBillId ? billById.get(application.creditVendorBillId) : undefined;
            return (
              <TableRow key={application.id}>
                <TableCell className="font-medium">
                  {targetBill?.invoiceNumber || `Bill #${application.targetVendorBillId}`}
                </TableCell>
                <TableCell>
                  {payment
                    ? `${payment.methodLabel || humanize(payment.methodType)} #${payment.id}`
                    : credit?.invoiceNumber || `Credit #${application.creditVendorBillId}`}
                </TableCell>
                <TableCell>{statusBadge(application.status)}</TableCell>
                <TableCell className="text-right">{formatMoney(application.amountCents, application.currency)}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    {application.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => onReverse(application)} disabled={isMutating}>
                        <RotateCcw className="h-4 w-4" />
                        Reverse
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function ReconciliationTable({
  exceptions,
  isLoading,
  onTransition,
  isMutating,
}: {
  exceptions: FinanceReconciliationException[];
  isLoading: boolean;
  onTransition: (
    exception: FinanceReconciliationException,
    action: "investigate" | "resolve" | "waive" | "reopen",
  ) => void;
  isMutating: boolean;
}) {
  return (
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
        {isLoading ? (
          <EmptyRow colSpan={5} label="Loading exceptions..." />
        ) : exceptions.length === 0 ? (
          <EmptyRow colSpan={5} label="No exceptions." />
        ) : (
          exceptions.map((exception) => (
            <TableRow key={exception.id}>
              <TableCell className="font-medium">{humanize(exception.reasonCode)}</TableCell>
              <TableCell>{exception.summary}</TableCell>
              <TableCell>{statusBadge(exception.status)}</TableCell>
              <TableCell className="text-right">{formatMoney(exception.differenceAmountCents, exception.currency || "USD")}</TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  {exception.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(exception, "investigate")} disabled={isMutating}>
                      <AlertCircle className="h-4 w-4" />
                      Investigate
                    </Button>
                  )}
                  {["open", "investigating"].includes(exception.status) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onTransition(exception, "resolve")} disabled={isMutating}>
                        <CheckCircle2 className="h-4 w-4" />
                        Resolve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onTransition(exception, "waive")} disabled={isMutating}>
                        <Archive className="h-4 w-4" />
                        Waive
                      </Button>
                    </>
                  )}
                  {["resolved", "waived"].includes(exception.status) && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(exception, "reopen")} disabled={isMutating}>
                      <RotateCcw className="h-4 w-4" />
                      Reopen
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SubscriptionsTable({
  subscriptions,
  isLoading,
  compact = false,
  onEdit,
  onTransition,
  isMutating = false,
}: {
  subscriptions: FinanceSubscription[];
  isLoading: boolean;
  compact?: boolean;
  onEdit?: (subscription: FinanceSubscription) => void;
  onTransition?: (subscription: FinanceSubscription, action: "pause" | "resume" | "cancel") => void;
  isMutating?: boolean;
}) {
  const showActions = !compact && Boolean(onEdit && onTransition);
  const colSpan = compact ? 5 : showActions ? 7 : 6;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          {!compact && <TableHead>Category</TableHead>}
          <TableHead>Cadence</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Next bill</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          {showActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={colSpan} label="Loading subscriptions..." />
        ) : subscriptions.length === 0 ? (
          <EmptyRow colSpan={colSpan} label="No subscriptions." />
        ) : (
          subscriptions.map((subscription) => (
            <TableRow key={subscription.id}>
              <TableCell className="font-medium">
                {subscription.vendorName || `Vendor #${subscription.vendorId}`}
              </TableCell>
              {!compact && <TableCell>{humanize(subscription.categoryCode)}</TableCell>}
              <TableCell>{humanize(subscription.cadence)}</TableCell>
              <TableCell>{statusBadge(subscription.status)}</TableCell>
              <TableCell>{formatDate(subscription.nextBillingDate)}</TableCell>
              <TableCell className="text-right">
                {subscription.variableAmount
                  ? "Variable"
                  : formatMoney(subscription.expectedAmountCents, subscription.currency)}
              </TableCell>
              {showActions && (
                <TableCell>
                  <SubscriptionActionButtons
                    subscription={subscription}
                    isMutating={isMutating}
                    onEdit={onEdit}
                    onTransition={onTransition}
                  />
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SubscriptionActionButtons({
  subscription,
  isMutating,
  onEdit,
  onTransition,
}: {
  subscription: FinanceSubscription;
  isMutating: boolean;
  onEdit?: (subscription: FinanceSubscription) => void;
  onTransition?: (subscription: FinanceSubscription, action: "pause" | "resume" | "cancel") => void;
}) {
  if (!onEdit || !onTransition) return null;
  const terminal = ["cancelled", "expired"].includes(subscription.status);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {!terminal && (
        <Button size="sm" variant="outline" onClick={() => onEdit(subscription)} disabled={isMutating}>
          <Edit3 className="h-4 w-4" />
          Edit
        </Button>
      )}
      {["trial", "active"].includes(subscription.status) && (
        <Button size="sm" variant="outline" onClick={() => onTransition(subscription, "pause")} disabled={isMutating}>
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      )}
      {subscription.status === "paused" && (
        <Button size="sm" variant="outline" onClick={() => onTransition(subscription, "resume")} disabled={isMutating}>
          <Play className="h-4 w-4" />
          Resume
        </Button>
      )}
      {!terminal && (
        <Button size="sm" variant="outline" onClick={() => onTransition(subscription, "cancel")} disabled={isMutating}>
          <XCircle className="h-4 w-4" />
          Cancel
        </Button>
      )}
    </div>
  );
}

function PriceVarianceTable({
  rows,
  isLoading,
}: {
  rows: NonNullable<FinanceOverview["subscriptionPriceVariances"]>;
  isLoading: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          <TableHead className="text-right">Actual</TableHead>
          <TableHead className="text-right">Difference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={4} label="Loading variances..." />
        ) : rows.length === 0 ? (
          <EmptyRow colSpan={4} label="No variances." />
        ) : (
          rows.map((row) => (
            <TableRow key={`${row.recurringExpenseId}-${row.billId}`}>
              <TableCell className="font-medium">{row.vendorName || `Vendor #${row.vendorId}`}</TableCell>
              <TableCell className="text-right">{formatMoney(row.expectedAmountCents, row.currency)}</TableCell>
              <TableCell className="text-right">{formatMoney(row.actualAmountCents, row.currency)}</TableCell>
              <TableCell className="text-right">{formatMoney(row.differenceAmountCents, row.currency)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function VendorDialog({
  state,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: VendorDialogState | null;
  isPending: boolean;
  onClose: () => void;
  onChange: (form: VendorFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof VendorFormState>(key: K, value: VendorFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state.mode === "create" ? "Add Vendor" : "Edit Vendor"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Name">
              <Input value={form.name} onChange={(event) => update("name", event.target.value)} required maxLength={200} />
            </FormField>
            <FormField label="Type">
              <Select value={form.vendorType} onValueChange={(value) => update("vendorType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vendorTypes.map((type) => (
                    <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Status">
              <Select value={form.status} onValueChange={(value) => update("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vendorStatuses.map((status) => (
                    <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Contact email">
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(event) => update("contactEmail", event.target.value)}
                maxLength={320}
              />
            </FormField>
            <FormField label="Website">
              <Input value={form.website} onChange={(event) => update("website", event.target.value)} maxLength={500} />
            </FormField>
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
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
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: SubscriptionDialogState | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: SubscriptionFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const editing = state.mode === "edit";
  const update = <K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Subscription" : "Add Subscription"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Legal entity">
              <Select value={form.legalEntityId} onValueChange={(value) => update("legalEntityId", value)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.id} value={String(entity.id)}>{entity.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Vendor">
              <Select value={form.vendorId} onValueChange={(value) => update("vendorId", value)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Category">
              <CategorySelect value={form.categoryCode} onValueChange={(value) => update("categoryCode", value)} />
            </FormField>
            <FormField label="Cadence">
              <Select value={form.cadence} onValueChange={(value) => update("cadence", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {subscriptionCadences.map((cadence) => (
                    <SelectItem key={cadence} value={cadence}>{humanize(cadence)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Expected amount">
              <Input
                inputMode="decimal"
                value={form.expectedAmount}
                onChange={(event) => update("expectedAmount", event.target.value)}
                placeholder="0.00"
                disabled={form.variableAmount}
              />
            </FormField>
            <FormField label="Currency">
              <Input
                value={form.currency}
                onChange={(event) => update("currency", event.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </FormField>
            <FormField label="Billing day">
              <Input
                type="number"
                min={1}
                max={31}
                value={form.billingDay}
                onChange={(event) => update("billingDay", event.target.value)}
              />
            </FormField>
            <FormField label="Next bill">
              <Input type="date" value={form.nextBillingDate} onChange={(event) => update("nextBillingDate", event.target.value)} />
            </FormField>
            <FormField label="Renewal date">
              <Input type="date" value={form.renewalDate} onChange={(event) => update("renewalDate", event.target.value)} />
            </FormField>
            <FormField label="Trial ends">
              <Input type="date" value={form.trialEndsOn} onChange={(event) => update("trialEndsOn", event.target.value)} />
            </FormField>
            {!editing && (
              <FormField label="Initial status">
                <Select value={form.status} onValueChange={(value) => update("status", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subscriptionStatuses.map((status) => (
                      <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>

          <div className="flex flex-wrap gap-6">
            <CheckboxField
              label="Variable amount"
              checked={form.variableAmount}
              onCheckedChange={(checked) => update("variableAmount", checked)}
            />
            <CheckboxField
              label="Auto renew"
              checked={form.autoRenew}
              onCheckedChange={(checked) => update("autoRenew", checked)}
            />
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
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
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: BillDialogState | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  subscriptions: FinanceSubscription[];
  bills: FinanceBill[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: BillFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const editing = state.mode === "edit";
  const update = <K extends keyof BillFormState>(key: K, value: BillFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Draft Bill" : "Add Bill"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Legal entity">
              <Select value={form.legalEntityId} onValueChange={(value) => update("legalEntityId", value)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.id} value={String(entity.id)}>{entity.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Vendor">
              <Select value={form.vendorId} onValueChange={(value) => update("vendorId", value)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Bill kind">
              <Select value={form.billKind} onValueChange={(value) => update("billKind", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {billKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>{humanize(kind)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Invoice">
              <Input value={form.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Amount">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => update("amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </FormField>
            <FormField label="Currency">
              <Input
                value={form.currency}
                onChange={(event) => update("currency", event.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </FormField>
            <FormField label="Category">
              <CategorySelect value={form.categoryCode} onValueChange={(value) => update("categoryCode", value)} />
            </FormField>
            <FormField label="Issue date">
              <Input type="date" value={form.issueDate} onChange={(event) => update("issueDate", event.target.value)} />
            </FormField>
            <FormField label="Due date">
              <Input type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
            </FormField>
            <FormField label="Service start">
              <Input type="date" value={form.servicePeriodStart} onChange={(event) => update("servicePeriodStart", event.target.value)} />
            </FormField>
            <FormField label="Service end">
              <Input type="date" value={form.servicePeriodEnd} onChange={(event) => update("servicePeriodEnd", event.target.value)} />
            </FormField>
            <FormField label="Subscription">
              <Select value={form.recurringExpenseId || noSelection} onValueChange={(value) => update("recurringExpenseId", value === noSelection ? "" : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noSelection}>None</SelectItem>
                  {subscriptions.map((subscription) => (
                    <SelectItem key={subscription.id} value={String(subscription.id)}>
                      {subscription.vendorName || `Subscription #${subscription.id}`} - {humanize(subscription.cadence)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {form.billKind === "credit_memo" && (
              <FormField label="Credit source">
                <Select value={form.creditForVendorBillId || noSelection} onValueChange={(value) => update("creditForVendorBillId", value === noSelection ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noSelection}>None</SelectItem>
                    {bills
                      .filter((bill) => bill.id !== state.bill?.id)
                      .map((bill) => (
                        <SelectItem key={bill.id} value={String(bill.id)}>
                          {bill.invoiceNumber || `Bill #${bill.id}`} - {formatMoney(bill.amountCents, bill.currency)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
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
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: PaymentDialogState | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: PaymentFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const editing = state.mode === "edit";
  const update = <K extends keyof PaymentFormState>(key: K, value: PaymentFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pending Payment" : "Record Payment"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Legal entity">
              <Select value={form.legalEntityId} onValueChange={(value) => update("legalEntityId", value)} disabled={editing}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.id} value={String(entity.id)}>{entity.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Vendor">
              <Select value={form.vendorId || noSelection} onValueChange={(value) => update("vendorId", value === noSelection ? "" : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noSelection}>Unassigned</SelectItem>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Amount">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => update("amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </FormField>
            <FormField label="Currency">
              <Input
                value={form.currency}
                onChange={(event) => update("currency", event.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </FormField>
            <FormField label="Direction">
              <Select value={form.direction} onValueChange={(value) => update("direction", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentDirections.map((direction) => (
                    <SelectItem key={direction} value={direction}>{humanize(direction)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Payment date">
              <Input type="date" value={form.paymentDate} onChange={(event) => update("paymentDate", event.target.value)} />
            </FormField>
            <FormField label="Method">
              <Select value={form.methodType} onValueChange={(value) => update("methodType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method} value={method}>{humanize(method)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {!editing && (
              <FormField label="Initial status">
                <Select value={form.status} onValueChange={(value) => update("status", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {initialPaymentStatuses.map((status) => (
                      <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Method label">
              <Input value={form.methodLabel} onChange={(event) => update("methodLabel", event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Institution">
              <Input value={form.institutionName} onChange={(event) => update("institutionName", event.target.value)} maxLength={160} />
            </FormField>
            <FormField label="Last 4">
              <Input value={form.maskedLast4} onChange={(event) => update("maskedLast4", event.target.value)} maxLength={4} inputMode="numeric" />
            </FormField>
            <FormField label="Confirmation">
              <Input value={form.externalConfirmationRef} onChange={(event) => update("externalConfirmationRef", event.target.value)} maxLength={200} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
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
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: ApplicationDialogState | null;
  bills: FinanceBill[];
  payments: FinancePayment[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: ApplicationFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const targetBill = bills.find((bill) => bill.id === Number(form.targetVendorBillId));
  const update = <K extends keyof ApplicationFormState>(key: K, value: ApplicationFormState[K]) => {
    const next = { ...form, [key]: value };
    if (key === "sourceType") {
      next.expensePaymentId = "";
      next.creditVendorBillId = "";
    }
    if (key === "targetVendorBillId") {
      const bill = bills.find((item) => item.id === Number(value));
      next.currency = bill?.currency ?? next.currency;
      next.amount = formatCentsForInput(bill?.remainingAmountCents);
    }
    onChange(next);
  };
  const eligiblePayments = payments.filter((payment) => (
    targetBill &&
    ["posted", "cleared"].includes(payment.status) &&
    payment.direction === "outflow" &&
    payment.currency === targetBill.currency &&
    (payment.remainingAmountCents ?? 0) > 0 &&
    (!payment.vendorId || payment.vendorId === targetBill.vendorId)
  ));
  const eligibleCredits = bills.filter((bill) => (
    targetBill &&
    bill.id !== targetBill.id &&
    bill.billKind === "credit_memo" &&
    bill.status !== "draft" &&
    bill.status !== "voided" &&
    bill.vendorId === targetBill.vendorId &&
    bill.currency === targetBill.currency &&
    (bill.remainingAmountCents ?? 0) > 0
  ));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Apply to Bill</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Target bill">
              <Select value={form.targetVendorBillId} onValueChange={(value) => update("targetVendorBillId", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bills
                    .filter((bill) => bill.billKind !== "credit_memo" && !["draft", "voided"].includes(bill.status))
                    .map((bill) => (
                      <SelectItem key={bill.id} value={String(bill.id)}>
                        {bill.invoiceNumber || `Bill #${bill.id}`} - {formatMoney(bill.remainingAmountCents, bill.currency)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Source type">
              <Select value={form.sourceType} onValueChange={(value) => update("sourceType", value as ApplicationFormState["sourceType"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="credit">Credit memo</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {form.sourceType === "payment" ? (
              <FormField label="Payment">
                <Select value={form.expensePaymentId} onValueChange={(value) => update("expensePaymentId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligiblePayments.map((payment) => (
                      <SelectItem key={payment.id} value={String(payment.id)}>
                        #{payment.id} - {formatMoney(payment.remainingAmountCents, payment.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : (
              <FormField label="Credit memo">
                <Select value={form.creditVendorBillId} onValueChange={(value) => update("creditVendorBillId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select credit" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleCredits.map((bill) => (
                      <SelectItem key={bill.id} value={String(bill.id)}>
                        {bill.invoiceNumber || `Credit #${bill.id}`} - {formatMoney(bill.remainingAmountCents, bill.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Amount">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => update("amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </FormField>
            <FormField label="Currency">
              <Input
                value={form.currency}
                onChange={(event) => update("currency", event.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <Link2 className="h-4 w-4" />
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationDialog({
  state,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: ReconciliationDialogState | null;
  isPending: boolean;
  onClose: () => void;
  onChange: (form: ReconciliationFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof ReconciliationFormState>(key: K, value: ReconciliationFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Open Exception</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Expected type">
              <EntityTypeSelect value={form.expectedEntityType} onValueChange={(value) => update("expectedEntityType", value)} />
            </FormField>
            <FormField label="Expected id">
              <Input value={form.expectedEntityId} onChange={(event) => update("expectedEntityId", event.target.value)} inputMode="numeric" />
            </FormField>
            <FormField label="Actual type">
              <EntityTypeSelect value={form.actualEntityType} onValueChange={(value) => update("actualEntityType", value)} />
            </FormField>
            <FormField label="Actual id">
              <Input value={form.actualEntityId} onChange={(event) => update("actualEntityId", event.target.value)} inputMode="numeric" />
            </FormField>
            <FormField label="Reason">
              <Select value={form.reasonCode} onValueChange={(value) => update("reasonCode", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reconciliationReasonCodes.map((reason) => (
                    <SelectItem key={reason} value={reason}>{humanize(reason)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Currency">
              <Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} />
            </FormField>
            <FormField label="Expected amount">
              <Input inputMode="decimal" value={form.expectedAmount} onChange={(event) => update("expectedAmount", event.target.value)} />
            </FormField>
            <FormField label="Actual amount">
              <Input inputMode="decimal" value={form.actualAmount} onChange={(event) => update("actualAmount", event.target.value)} />
            </FormField>
          </div>

          <FormField label="Summary">
            <Textarea value={form.summary} onChange={(event) => update("summary", event.target.value)} rows={3} required maxLength={500} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <AlertCircle className="h-4 w-4" />
              Open
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntityTypeSelect({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  return (
    <Select value={value || noSelection} onValueChange={(next) => onValueChange(next === noSelection ? "" : next)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={noSelection}>None</SelectItem>
        {reconciliationEntityTypes.map((type) => (
          <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CategorySelect({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {expenseCategories.map((category) => (
          <SelectItem key={category} value={category}>{humanize(category)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  detail?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}

function sectionFromLocation(location: string): FinanceSection {
  const value = location.split("/")[2] as FinanceSection | undefined;
  return value && sections.includes(value) ? value : "overview";
}

function emptyVendorForm(): VendorFormState {
  return {
    name: "",
    vendorType: "other",
    status: "active",
    website: "",
    contactEmail: "",
    notes: "",
  };
}

function vendorFormFromVendor(vendor: FinanceVendor): VendorFormState {
  return {
    name: vendor.name,
    vendorType: vendor.vendorType,
    status: vendor.status,
    website: vendor.website ?? "",
    contactEmail: vendor.contactEmail ?? "",
    notes: "",
  };
}

function emptySubscriptionForm(entity?: FinanceLegalEntity, vendor?: FinanceVendor): SubscriptionFormState {
  return {
    legalEntityId: entity ? String(entity.id) : "",
    vendorId: vendor ? String(vendor.id) : "",
    categoryCode: "saas",
    cadence: "monthly",
    expectedAmount: "",
    currency: "USD",
    variableAmount: false,
    billingDay: "",
    nextBillingDate: "",
    renewalDate: "",
    autoRenew: true,
    trialEndsOn: "",
    notes: "",
    status: "active",
  };
}

function subscriptionFormFromSubscription(subscription: FinanceSubscription): SubscriptionFormState {
  return {
    legalEntityId: String(subscription.legalEntityId),
    vendorId: String(subscription.vendorId),
    categoryCode: subscription.categoryCode,
    cadence: subscription.cadence,
    expectedAmount: formatCentsForInput(subscription.expectedAmountCents),
    currency: subscription.currency,
    variableAmount: subscription.variableAmount,
    billingDay: subscription.billingDay ? String(subscription.billingDay) : "",
    nextBillingDate: dateForInput(subscription.nextBillingDate),
    renewalDate: dateForInput(subscription.renewalDate),
    autoRenew: subscription.autoRenew,
    trialEndsOn: dateForInput(subscription.trialEndsOn),
    notes: "",
    status: subscription.status,
  };
}

function emptyBillForm(entity?: FinanceLegalEntity, vendor?: FinanceVendor): BillFormState {
  return {
    legalEntityId: entity ? String(entity.id) : "",
    vendorId: vendor ? String(vendor.id) : "",
    recurringExpenseId: "",
    invoiceNumber: "",
    billKind: "invoice",
    issueDate: "",
    dueDate: "",
    servicePeriodStart: "",
    servicePeriodEnd: "",
    amount: "",
    currency: "USD",
    categoryCode: "saas",
    creditForVendorBillId: "",
    notes: "",
  };
}

function billFormFromBill(bill: FinanceBill): BillFormState {
  return {
    legalEntityId: String(bill.legalEntityId),
    vendorId: String(bill.vendorId),
    recurringExpenseId: bill.recurringExpenseId ? String(bill.recurringExpenseId) : "",
    invoiceNumber: bill.invoiceNumber ?? "",
    billKind: bill.billKind,
    issueDate: dateForInput(bill.issueDate),
    dueDate: dateForInput(bill.dueDate),
    servicePeriodStart: dateForInput(bill.servicePeriodStart),
    servicePeriodEnd: dateForInput(bill.servicePeriodEnd),
    amount: formatCentsForInput(bill.amountCents),
    currency: bill.currency,
    categoryCode: bill.categoryCode,
    creditForVendorBillId: bill.creditForVendorBillId ? String(bill.creditForVendorBillId) : "",
    notes: "",
  };
}

function emptyPaymentForm(entity?: FinanceLegalEntity, vendor?: FinanceVendor): PaymentFormState {
  return {
    legalEntityId: entity ? String(entity.id) : "",
    vendorId: vendor ? String(vendor.id) : "",
    amount: "",
    currency: "USD",
    direction: "outflow",
    paymentDate: "",
    methodType: "ach",
    methodLabel: "",
    institutionName: "",
    maskedLast4: "",
    externalConfirmationRef: "",
    status: "pending",
  };
}

function paymentFormFromPayment(payment: FinancePayment): PaymentFormState {
  return {
    legalEntityId: payment.legalEntityId ? String(payment.legalEntityId) : "",
    vendorId: payment.vendorId ? String(payment.vendorId) : "",
    amount: formatCentsForInput(payment.amountCents),
    currency: payment.currency,
    direction: payment.direction,
    paymentDate: dateForInput(payment.paymentDate),
    methodType: payment.methodType,
    methodLabel: payment.methodLabel ?? "",
    institutionName: payment.institutionName ?? "",
    maskedLast4: payment.maskedLast4 ?? "",
    externalConfirmationRef: payment.externalConfirmationRef ?? "",
    status: payment.status,
  };
}

function emptyApplicationForm(bill?: FinanceBill): ApplicationFormState {
  return {
    sourceType: "payment",
    targetVendorBillId: bill ? String(bill.id) : "",
    expensePaymentId: "",
    creditVendorBillId: "",
    amount: formatCentsForInput(bill?.remainingAmountCents),
    currency: bill?.currency ?? "USD",
  };
}

function emptyReconciliationForm(): ReconciliationFormState {
  return {
    expectedEntityType: "",
    expectedEntityId: "",
    actualEntityType: "",
    actualEntityId: "",
    currency: "USD",
    expectedAmount: "",
    actualAmount: "",
    reasonCode: "other_ap_mismatch",
    summary: "",
  };
}

function subscriptionPayload(state: SubscriptionDialogState) {
  const form = state.form;
  const expectedAmountCents = form.variableAmount && !form.expectedAmount.trim()
    ? null
    : parseMoneyToCents(form.expectedAmount);
  const common = compactPayload({
    categoryCode: form.categoryCode,
    cadence: form.cadence,
    expectedAmountCents,
    currency: form.currency.trim().toUpperCase(),
    variableAmount: form.variableAmount,
    billingDay: numberOrNull(form.billingDay),
    nextBillingDate: dateOrNull(form.nextBillingDate),
    renewalDate: dateOrNull(form.renewalDate),
    autoRenew: form.autoRenew,
    trialEndsOn: dateOrNull(form.trialEndsOn),
    notes: optionalString(form.notes),
  });

  if (state.mode === "edit") {
    return common;
  }

  return compactPayload({
    ...common,
    legalEntityId: parsePositiveId(form.legalEntityId, "Legal entity"),
    vendorId: parsePositiveId(form.vendorId, "Vendor"),
    status: form.status,
  });
}

function billPayload(state: BillDialogState) {
  const form = state.form;
  const common = compactPayload({
    recurringExpenseId: numberOrNull(form.recurringExpenseId),
    invoiceNumber: optionalString(form.invoiceNumber),
    billKind: form.billKind,
    issueDate: dateOrNull(form.issueDate),
    dueDate: dateOrNull(form.dueDate),
    servicePeriodStart: dateOrNull(form.servicePeriodStart),
    servicePeriodEnd: dateOrNull(form.servicePeriodEnd),
    amountCents: parseMoneyToCents(form.amount),
    currency: form.currency.trim().toUpperCase(),
    categoryCode: form.categoryCode,
    creditForVendorBillId: form.billKind === "credit_memo" ? numberOrNull(form.creditForVendorBillId) : null,
    notes: optionalString(form.notes),
  });

  if (state.mode === "edit") {
    return common;
  }

  return compactPayload({
    ...common,
    legalEntityId: parsePositiveId(form.legalEntityId, "Legal entity"),
    vendorId: parsePositiveId(form.vendorId, "Vendor"),
    status: "draft",
  });
}

function paymentPayload(state: PaymentDialogState) {
  const form = state.form;
  const common = compactPayload({
    vendorId: numberOrNull(form.vendorId),
    amountCents: parseMoneyToCents(form.amount),
    currency: form.currency.trim().toUpperCase(),
    direction: form.direction,
    paymentDate: dateOrNull(form.paymentDate),
    methodType: form.methodType,
    methodLabel: optionalString(form.methodLabel),
    institutionName: optionalString(form.institutionName),
    maskedLast4: optionalString(form.maskedLast4),
    externalConfirmationRef: optionalString(form.externalConfirmationRef),
  });

  if (state.mode === "edit") {
    return common;
  }

  return compactPayload({
    ...common,
    legalEntityId: parsePositiveId(form.legalEntityId, "Legal entity"),
    status: form.status,
  });
}

function applicationPayload(form: ApplicationFormState) {
  const common = {
    targetVendorBillId: parsePositiveId(form.targetVendorBillId, "Target bill"),
    amountCents: parseMoneyToCents(form.amount),
    currency: form.currency.trim().toUpperCase(),
  };
  if (form.sourceType === "payment") {
    return {
      ...common,
      expensePaymentId: parsePositiveId(form.expensePaymentId, "Payment"),
    };
  }
  return {
    ...common,
    creditVendorBillId: parsePositiveId(form.creditVendorBillId, "Credit memo"),
  };
}

function reconciliationPayload(form: ReconciliationFormState) {
  return compactPayload({
    expectedEntityType: optionalString(form.expectedEntityType),
    expectedEntityId: numberOrNull(form.expectedEntityId),
    actualEntityType: optionalString(form.actualEntityType),
    actualEntityId: numberOrNull(form.actualEntityId),
    currency: optionalString(form.currency)?.toUpperCase(),
    expectedAmountCents: form.expectedAmount.trim() ? parseMoneyToCents(form.expectedAmount) : null,
    actualAmountCents: form.actualAmount.trim() ? parseMoneyToCents(form.actualAmount) : null,
    reasonCode: form.reasonCode,
    summary: form.summary.trim(),
  });
}

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dateOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dateForInput(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parsePositiveId(trimmed, "Selection");
}

function parsePositiveId(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

function parseMoneyToCents(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter a positive amount with up to two decimals.");
  }
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error("Amount must be positive.");
  }
  return cents;
}

function formatCentsForInput(value?: number | null) {
  if (typeof value !== "number") return "";
  return (value / 100).toFixed(2);
}

function compactPayload<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function invalidateFinanceQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(financeRolesQueryPrefix);
    },
  });
}

function formatMoney(value?: number | null, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function formatMoneyBreakdown(values?: CurrencyAmount[]) {
  if (!values || values.length === 0) {
    return formatMoney(0);
  }
  return values.map((value) => formatMoney(value.amountCents, value.currency)).join(" / ");
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function humanize(value?: string | null) {
  return value ? value.replace(/_/g, " ") : "-";
}

function statusBadge(status: string) {
  const className =
    ["active", "paid", "cleared", "approved"].includes(status)
      ? "border-green-500/20 bg-green-500/10 text-green-700"
      : ["pending", "draft", "received", "partially_paid", "outflow"].includes(status)
        ? "border-blue-500/20 bg-blue-500/10 text-blue-700"
        : ["disputed", "failed", "missing", "trial", "paused"].includes(status)
          ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-700"
          : ["voided", "reversed", "cancelled", "archived", "unpaid"].includes(status)
            ? "border-red-500/20 bg-red-500/10 text-red-700"
            : "border-muted bg-muted text-muted-foreground";

  return (
    <Badge variant="outline" className={className}>
      {humanize(status)}
    </Badge>
  );
}
