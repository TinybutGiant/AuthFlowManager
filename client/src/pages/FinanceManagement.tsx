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
  Send,
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
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

type FinanceSection = "overview" | "expenses" | "subscriptions" | "vendors" | "payroll";

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

type PayrollCurrencyTotals = {
  currency: string;
  workerCount: number;
  grossPayCents: number;
  netPayCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  deductionCents: number;
  effectivePaidCents: number;
  clearedPaymentCents: number;
  inFlightPaymentCents: number;
  pendingPaymentCents: number;
  failedAttemptCents: number;
  unpaidNetPayCents: number;
  overpaidNetPayCents: number;
};

type PayrollOverview = {
  recentRuns: PayrollRun[];
  draftRuns: PayrollRun[];
  effectiveRuns: PayrollRun[];
  totalsByCurrency: PayrollCurrencyTotals[];
  runPaymentStates: Record<string, number>;
};

type PayrollRun = {
  id: number;
  legalEntityId: number;
  legalEntity?: FinanceLegalEntity | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runKind: string;
  sourceType: string;
  sourceVendorId?: number | null;
  sourceVendor?: FinanceVendor | null;
  correctionOfPayrollRunId?: number | null;
  status: string;
  finalizedAt?: string | null;
  finalizedBy?: number | null;
  notes?: string | null;
  workerCount: number;
  totalsByCurrency: PayrollCurrencyTotals[];
  workers?: PayrollRunWorker[];
};

type PayrollRunWorker = {
  id: number;
  payrollRunId: number;
  workerId: number;
  employmentId: number;
  worker?: {
    id: number;
    workerCode: string;
    legalName: string;
    preferredName?: string | null;
    adminUserId?: number | null;
    lifecycleState: string;
  } | null;
  employment?: {
    id: number;
    employeeClassification: string;
    payrollParticipation: string;
    status: string;
    startDate: string;
    endDate?: string | null;
  } | null;
  currency: string;
  grossPayCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  deductionCents: number;
  netPayCents: number;
  lineTotalsByCurrency: Array<{
    currency: string;
    grossPayCents: number;
    deductionCents: number;
    employeeTaxCents: number;
    employerTaxCents: number;
    reimbursementCents: number;
    otherCents: number;
    netPayImpactCents: number;
  }>;
  paymentSummary: {
    targetNetPayCents: number;
    effectivePaidCents: number;
    clearedPaymentCents: number;
    inFlightPaymentCents: number;
    pendingPaymentCents: number;
    failedAttemptCents: number;
    reversedPaymentCents: number;
    voidedPaymentCents: number;
    remainingNetPayCents: number;
    overpaidNetPayCents: number;
    state: string;
  };
  resultLines: PayrollResultLine[];
  payments: PayrollPayment[];
};

type PayrollResultLine = {
  id: number;
  payrollRunWorkerId: number;
  lineCategory: string;
  lineCode: string;
  description?: string | null;
  amountEffect: string;
  amountCents: number;
  signedAmountCents: number;
  currency: string;
  quantityMicrounits?: number | null;
  rateAmountCents?: number | null;
  jurisdictionCode?: string | null;
};

type PayrollPayment = {
  id: number;
  payrollRunWorkerId: number;
  amountCents: number;
  currency: string;
  paymentDate?: string | null;
  methodType: string;
  methodLabel?: string | null;
  institutionName?: string | null;
  maskedLast4?: string | null;
  externalConfirmationRef?: string | null;
  status: string;
  processedAt?: string | null;
};

type PayrollEmploymentOption = {
  employment: {
    id: number;
    legalEntityId: number;
    employeeClassification: string;
    payrollParticipation: string;
    status: string;
    startDate: string;
    endDate?: string | null;
  };
  worker: {
    id: number;
    workerCode: string;
    legalName: string;
    preferredName?: string | null;
    lifecycleState: string;
  };
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

type PayrollRunFormState = {
  legalEntityId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runKind: string;
  sourceType: string;
  sourceVendorId: string;
  correctionOfPayrollRunId: string;
  notes: string;
};

type PayrollWorkerFormState = {
  workerId: string;
  employmentId: string;
  currency: string;
  grossPay: string;
  employeeTax: string;
  employerTax: string;
  deduction: string;
  netPay: string;
};

type PayrollLineFormState = {
  lineCategory: string;
  lineCode: string;
  description: string;
  amountEffect: string;
  amount: string;
  currency: string;
  quantity: string;
  rateAmount: string;
  jurisdictionCode: string;
};

type PayrollPaymentFormState = {
  amount: string;
  currency: string;
  paymentDate: string;
  methodType: string;
  methodLabel: string;
  institutionName: string;
  maskedLast4: string;
  externalConfirmationRef: string;
  status: string;
};

type PayrollRunDialogState = {
  mode: "create" | "correction";
  form: PayrollRunFormState;
};

type PayrollWorkerDialogState = {
  run: PayrollRun;
  form: PayrollWorkerFormState;
};

type PayrollLineDialogState = {
  runWorker: PayrollRunWorker;
  form: PayrollLineFormState;
};

type PayrollPaymentDialogState = {
  runWorker: PayrollRunWorker;
  form: PayrollPaymentFormState;
};

type FinanceMutationRequest = {
  method: "POST" | "PATCH";
  url: string;
  body: Record<string, unknown>;
  successTitle: string;
  onSuccess?: () => void;
};

const sections: FinanceSection[] = ["overview", "expenses", "subscriptions", "vendors", "payroll"];
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
const payrollRunKinds = ["regular", "off_cycle", "bonus", "adjustment"] as const;
const payrollSourceTypes = ["manual", "provider", "csv_import", "internal"] as const;
const payrollLineCategories = ["earning", "deduction", "employee_tax", "employer_tax", "reimbursement", "other"] as const;
const payrollAmountEffects = ["increase", "decrease"] as const;
const payrollPaymentMethods = ["payroll_provider", "ach", "check", "manual", "other"] as const;
const payrollPaymentInitialStatuses = ["pending", "sent", "cleared", "failed"] as const;

export default function FinanceManagement() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const isSuperAdmin = (user as { role?: string } | undefined)?.role === "super_admin";
  const requestedSection = sectionFromLocation(location);
  const selectedSection = requestedSection === "payroll" && !isSuperAdmin ? "overview" : requestedSection;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [vendorDialog, setVendorDialog] = React.useState<VendorDialogState | null>(null);
  const [subscriptionDialog, setSubscriptionDialog] = React.useState<SubscriptionDialogState | null>(null);
  const [billDialog, setBillDialog] = React.useState<BillDialogState | null>(null);
  const [paymentDialog, setPaymentDialog] = React.useState<PaymentDialogState | null>(null);
  const [applicationDialog, setApplicationDialog] = React.useState<ApplicationDialogState | null>(null);
  const [reconciliationDialog, setReconciliationDialog] = React.useState<ReconciliationDialogState | null>(null);
  const [selectedPayrollRunId, setSelectedPayrollRunId] = React.useState<number | null>(null);
  const [payrollRunDialog, setPayrollRunDialog] = React.useState<PayrollRunDialogState | null>(null);
  const [payrollWorkerDialog, setPayrollWorkerDialog] = React.useState<PayrollWorkerDialogState | null>(null);
  const [payrollLineDialog, setPayrollLineDialog] = React.useState<PayrollLineDialogState | null>(null);
  const [payrollPaymentDialog, setPayrollPaymentDialog] = React.useState<PayrollPaymentDialogState | null>(null);

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
  const payrollOverviewQuery = useQuery<PayrollOverview>({
    queryKey: ["/api/admin/finance/payroll/overview"],
    enabled: isSuperAdmin,
  });
  const payrollRunsQuery = useQuery<PayrollRun[]>({
    queryKey: ["/api/admin/finance/payroll/runs?pageSize=100"],
    enabled: isSuperAdmin,
  });
  const payrollLegalEntitiesQuery = useQuery<FinanceLegalEntity[]>({
    queryKey: ["/api/admin/finance/payroll/legal-entities"],
    enabled: isSuperAdmin,
  });
  const payrollVendorsQuery = useQuery<FinanceVendor[]>({
    queryKey: ["/api/admin/finance/payroll/vendors"],
    enabled: isSuperAdmin,
  });
  const payrollEmploymentOptionsQuery = useQuery<PayrollEmploymentOption[]>({
    queryKey: ["/api/admin/finance/payroll/employment-options?pageSize=250"],
    enabled: isSuperAdmin,
  });
  const payrollRunDetailQuery = useQuery<PayrollRun>({
    queryKey: [`/api/admin/finance/payroll/runs/${selectedPayrollRunId}`],
    enabled: isSuperAdmin && Boolean(selectedPayrollRunId),
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
  const payrollRuns = payrollRunsQuery.data ?? [];
  const selectedPayrollRun = payrollRunDetailQuery.data ?? payrollRuns.find((run) => run.id === selectedPayrollRunId) ?? payrollRuns[0];
  const payrollLegalEntities = payrollLegalEntitiesQuery.data ?? legalEntities;
  const payrollVendors = payrollVendorsQuery.data ?? [];
  const payrollEmploymentOptions = payrollEmploymentOptionsQuery.data ?? [];
  const linkableSubscriptions = React.useMemo(
    () => subscriptions.filter((subscription) => subscription.status !== "cancelled" && subscription.status !== "expired"),
    [subscriptions],
  );
  const linkableBills = React.useMemo(
    () => bills.filter((bill) => bill.status !== "voided"),
    [bills],
  );
  const isMutating = financeMutation.isPending;

  React.useEffect(() => {
    if (!selectedPayrollRunId && payrollRuns.length > 0) {
      setSelectedPayrollRunId(payrollRuns[0].id);
    }
  }, [payrollRuns, selectedPayrollRunId]);

  const error =
    overviewQuery.error ||
    legalEntitiesQuery.error ||
    billsQuery.error ||
    paymentsQuery.error ||
    applicationsQuery.error ||
    reconciliationQuery.error ||
    subscriptionsQuery.error ||
    vendorsQuery.error ||
    (isSuperAdmin
      ? payrollOverviewQuery.error ||
        payrollRunsQuery.error ||
        payrollLegalEntitiesQuery.error ||
        payrollVendorsQuery.error ||
        payrollEmploymentOptionsQuery.error ||
        payrollRunDetailQuery.error
      : null);

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

  function openCreatePayrollRun() {
    setPayrollRunDialog({
      mode: "create",
      form: emptyPayrollRunForm(payrollLegalEntities[0], payrollVendors[0]),
    });
  }

  function openCreatePayrollCorrection(run: PayrollRun) {
    setPayrollRunDialog({
      mode: "correction",
      form: {
        ...emptyPayrollRunForm(payrollLegalEntities.find((entity) => entity.id === run.legalEntityId), payrollVendors[0]),
        legalEntityId: String(run.legalEntityId),
        periodStart: run.periodStart?.slice(0, 10) ?? "",
        periodEnd: run.periodEnd?.slice(0, 10) ?? "",
        payDate: run.payDate?.slice(0, 10) ?? "",
        runKind: "correction",
        correctionOfPayrollRunId: String(run.id),
      },
    });
  }

  function submitPayrollRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payrollRunDialog) return;
    try {
      const isCorrection = payrollRunDialog.mode === "correction";
      const body = compactPayload({
        legalEntityId: isCorrection ? undefined : Number(payrollRunDialog.form.legalEntityId),
        correctionOfPayrollRunId: isCorrection ? Number(payrollRunDialog.form.correctionOfPayrollRunId) : undefined,
        periodStart: payrollRunDialog.form.periodStart,
        periodEnd: payrollRunDialog.form.periodEnd,
        payDate: payrollRunDialog.form.payDate,
        runKind: isCorrection ? undefined : payrollRunDialog.form.runKind,
        sourceType: payrollRunDialog.form.sourceType,
        sourceVendorId: payrollRunDialog.form.sourceVendorId ? Number(payrollRunDialog.form.sourceVendorId) : undefined,
        notes: optionalString(payrollRunDialog.form.notes),
      });
      financeMutation.mutate({
        method: "POST",
        url: isCorrection ? "/api/admin/finance/payroll/runs/corrections" : "/api/admin/finance/payroll/runs",
        body,
        successTitle: isCorrection ? "Correction run created" : "Payroll run created",
        onSuccess: () => setPayrollRunDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll run form needs attention",
        description: error instanceof Error ? error.message : "Check the payroll run fields.",
        variant: "destructive",
      });
    }
  }

  function transitionPayrollRun(run: PayrollRun, action: "review" | "finalize") {
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/payroll/runs/${run.id}/${action}`,
      body: {},
      successTitle: action === "review" ? "Payroll run reviewed" : "Payroll run finalized",
    });
  }

  function openAddPayrollWorker(run: PayrollRun) {
    const option = payrollEmploymentOptions.find((item) => item.employment.legalEntityId === run.legalEntityId) ?? payrollEmploymentOptions[0];
    setPayrollWorkerDialog({
      run,
      form: emptyPayrollWorkerForm(option),
    });
  }

  function submitPayrollWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payrollWorkerDialog) return;
    try {
      const body = {
        workerId: Number(payrollWorkerDialog.form.workerId),
        employmentId: Number(payrollWorkerDialog.form.employmentId),
        currency: payrollWorkerDialog.form.currency,
        grossPayCents: parseMoneyToCents(payrollWorkerDialog.form.grossPay, true),
        employeeTaxCents: parseMoneyToCents(payrollWorkerDialog.form.employeeTax, true),
        employerTaxCents: parseMoneyToCents(payrollWorkerDialog.form.employerTax, true),
        deductionCents: parseMoneyToCents(payrollWorkerDialog.form.deduction, true),
        netPayCents: parseMoneyToCents(payrollWorkerDialog.form.netPay, true),
        sourceMetadata: {},
      };
      financeMutation.mutate({
        method: "POST",
        url: `/api/admin/finance/payroll/runs/${payrollWorkerDialog.run.id}/workers`,
        body,
        successTitle: "Payroll worker result added",
        onSuccess: () => setPayrollWorkerDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll worker result needs attention",
        description: error instanceof Error ? error.message : "Check the worker result fields.",
        variant: "destructive",
      });
    }
  }

  function openAddPayrollLine(runWorker: PayrollRunWorker) {
    setPayrollLineDialog({
      runWorker,
      form: emptyPayrollLineForm(runWorker.currency),
    });
  }

  function submitPayrollLine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payrollLineDialog) return;
    try {
      const body = compactPayload({
        lineCategory: payrollLineDialog.form.lineCategory,
        lineCode: payrollLineDialog.form.lineCode.trim(),
        description: optionalString(payrollLineDialog.form.description),
        amountEffect: payrollLineDialog.form.amountEffect,
        amountCents: parseMoneyToCents(payrollLineDialog.form.amount),
        currency: payrollLineDialog.form.currency,
        quantityMicrounits: payrollLineDialog.form.quantity ? Math.round(Number(payrollLineDialog.form.quantity) * 1_000_000) : undefined,
        rateAmountCents: payrollLineDialog.form.rateAmount ? parseMoneyToCents(payrollLineDialog.form.rateAmount) : undefined,
        jurisdictionCode: optionalString(payrollLineDialog.form.jurisdictionCode),
        metadata: {},
      });
      financeMutation.mutate({
        method: "POST",
        url: `/api/admin/finance/payroll/run-workers/${payrollLineDialog.runWorker.id}/result-lines`,
        body,
        successTitle: "Payroll result line added",
        onSuccess: () => setPayrollLineDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll line needs attention",
        description: error instanceof Error ? error.message : "Check the result line fields.",
        variant: "destructive",
      });
    }
  }

  function openRecordPayrollPayment(runWorker: PayrollRunWorker) {
    setPayrollPaymentDialog({
      runWorker,
      form: emptyPayrollPaymentForm(runWorker),
    });
  }

  function submitPayrollPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payrollPaymentDialog) return;
    try {
      const body = compactPayload({
        amountCents: parseMoneyToCents(payrollPaymentDialog.form.amount),
        currency: payrollPaymentDialog.form.currency,
        paymentDate: optionalString(payrollPaymentDialog.form.paymentDate),
        methodType: payrollPaymentDialog.form.methodType,
        methodLabel: optionalString(payrollPaymentDialog.form.methodLabel),
        institutionName: optionalString(payrollPaymentDialog.form.institutionName),
        maskedLast4: optionalString(payrollPaymentDialog.form.maskedLast4),
        externalConfirmationRef: optionalString(payrollPaymentDialog.form.externalConfirmationRef),
        status: payrollPaymentDialog.form.status,
      });
      financeMutation.mutate({
        method: "POST",
        url: `/api/admin/finance/payroll/run-workers/${payrollPaymentDialog.runWorker.id}/payments`,
        body,
        successTitle: "Payroll payment recorded",
        onSuccess: () => setPayrollPaymentDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll payment needs attention",
        description: error instanceof Error ? error.message : "Check the payment fields.",
        variant: "destructive",
      });
    }
  }

  function transitionPayrollPaymentRecord(payment: PayrollPayment, action: "send" | "clear" | "fail" | "void" | "reverse") {
    financeMutation.mutate({
      method: "POST",
      url: `/api/admin/finance/payroll/payments/${payment.id}/${action}`,
      body: {},
      successTitle: `Payroll payment ${action === "send" ? "sent" : action === "clear" ? "cleared" : action === "fail" ? "failed" : action === "void" ? "voided" : "reversed"}`,
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
        <TabsList className={`grid w-full grid-cols-2 ${isSuperAdmin ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="payroll">Payroll</TabsTrigger>}
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

        {isSuperAdmin && (
          <TabsContent value="payroll" className="space-y-6">
            <PayrollPanel
              overview={payrollOverviewQuery.data}
              runs={payrollRuns}
              selectedRun={selectedPayrollRun}
              selectedRunId={selectedPayrollRunId}
              isLoading={payrollRunsQuery.isLoading || payrollRunDetailQuery.isLoading || payrollOverviewQuery.isLoading}
              isMutating={isMutating}
              onSelectRun={setSelectedPayrollRunId}
              onCreateRun={openCreatePayrollRun}
              onCreateCorrection={openCreatePayrollCorrection}
              onRunTransition={transitionPayrollRun}
              onAddWorker={openAddPayrollWorker}
              onAddLine={openAddPayrollLine}
              onRecordPayment={openRecordPayrollPayment}
              onPaymentTransition={transitionPayrollPaymentRecord}
            />
          </TabsContent>
        )}
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
      <PayrollRunDialog
        state={payrollRunDialog}
        legalEntities={payrollLegalEntities}
        vendors={payrollVendors}
        isPending={isMutating}
        onClose={() => setPayrollRunDialog(null)}
        onChange={(form) => setPayrollRunDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayrollRun}
      />
      <PayrollWorkerDialog
        state={payrollWorkerDialog}
        employmentOptions={payrollEmploymentOptions}
        isPending={isMutating}
        onClose={() => setPayrollWorkerDialog(null)}
        onChange={(form) => setPayrollWorkerDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayrollWorker}
      />
      <PayrollLineDialog
        state={payrollLineDialog}
        isPending={isMutating}
        onClose={() => setPayrollLineDialog(null)}
        onChange={(form) => setPayrollLineDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayrollLine}
      />
      <PayrollPaymentDialog
        state={payrollPaymentDialog}
        isPending={isMutating}
        onClose={() => setPayrollPaymentDialog(null)}
        onChange={(form) => setPayrollPaymentDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayrollPayment}
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

function PayrollPanel({
  overview,
  runs,
  selectedRun,
  selectedRunId,
  isLoading,
  isMutating,
  onSelectRun,
  onCreateRun,
  onCreateCorrection,
  onRunTransition,
  onAddWorker,
  onAddLine,
  onRecordPayment,
  onPaymentTransition,
}: {
  overview?: PayrollOverview;
  runs: PayrollRun[];
  selectedRun?: PayrollRun;
  selectedRunId: number | null;
  isLoading: boolean;
  isMutating: boolean;
  onSelectRun: (runId: number) => void;
  onCreateRun: () => void;
  onCreateCorrection: (run: PayrollRun) => void;
  onRunTransition: (run: PayrollRun, action: "review" | "finalize") => void;
  onAddWorker: (run: PayrollRun) => void;
  onAddLine: (runWorker: PayrollRunWorker) => void;
  onRecordPayment: (runWorker: PayrollRunWorker) => void;
  onPaymentTransition: (payment: PayrollPayment, action: "send" | "clear" | "fail" | "void" | "reverse") => void;
}) {
  const selected = selectedRun ?? runs.find((run) => run.id === selectedRunId);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Open runs"
          value={overview?.draftRuns.length ?? 0}
          detail="Draft or reviewed"
          icon={ReceiptText}
        />
        <MetricCard
          title="Gross payroll"
          value={formatPayrollTotals(overview?.totalsByCurrency, "grossPayCents")}
          detail="Effective finalized snapshots"
          icon={WalletCards}
        />
        <MetricCard
          title="Net payroll"
          value={formatPayrollTotals(overview?.totalsByCurrency, "netPayCents")}
          detail="Corrections replace originals"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Payment issues"
          value={(overview?.runPaymentStates.failed ?? 0) + (overview?.runPaymentStates.mixed ?? 0) + (overview?.runPaymentStates.overpaid ?? 0)}
          detail="Failed, mixed, or overpaid"
          icon={AlertCircle}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Payroll Runs</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Historical records by pay period.
              </p>
            </div>
            <Button size="sm" onClick={onCreateRun} disabled={isMutating}>
              <Plus className="h-4 w-4" />
              Run
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <EmptyRow colSpan={3} label="Loading payroll runs..." />
                ) : runs.length === 0 ? (
                  <EmptyRow colSpan={3} label="No payroll runs." />
                ) : (
                  runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={run.id === selected?.id ? "bg-muted/50" : undefined}
                      onClick={() => onSelectRun(run.id)}
                    >
                      <TableCell>
                        <button className="text-left font-medium" type="button" onClick={() => onSelectRun(run.id)}>
                          {formatDate(run.periodStart)} - {formatDate(run.periodEnd)}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          Pay {formatDate(run.payDate)} - {humanize(run.runKind)} - {humanize(run.sourceType)}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell className="text-right">{formatPayrollTotals(run.totalsByCurrency, "netPayCents")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <PayrollRunDetailPanel
          run={selected}
          isMutating={isMutating}
          onCreateCorrection={onCreateCorrection}
          onRunTransition={onRunTransition}
          onAddWorker={onAddWorker}
          onAddLine={onAddLine}
          onRecordPayment={onRecordPayment}
          onPaymentTransition={onPaymentTransition}
        />
      </div>
    </div>
  );
}

function PayrollRunDetailPanel({
  run,
  isMutating,
  onCreateCorrection,
  onRunTransition,
  onAddWorker,
  onAddLine,
  onRecordPayment,
  onPaymentTransition,
}: {
  run?: PayrollRun;
  isMutating: boolean;
  onCreateCorrection: (run: PayrollRun) => void;
  onRunTransition: (run: PayrollRun, action: "review" | "finalize") => void;
  onAddWorker: (run: PayrollRun) => void;
  onAddLine: (runWorker: PayrollRunWorker) => void;
  onRecordPayment: (runWorker: PayrollRunWorker) => void;
  onPaymentTransition: (payment: PayrollPayment, action: "send" | "clear" | "fail" | "void" | "reverse") => void;
}) {
  if (!run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run Detail</CardTitle>
        </CardHeader>
        <CardContent className="py-10 text-center text-muted-foreground">
          Select or create a payroll run.
        </CardContent>
      </Card>
    );
  }

  const canEditOutput = run.status === "draft";
  const canRecordPayments = run.status === "finalized";
  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>
              {formatDate(run.periodStart)} - {formatDate(run.periodEnd)}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Pay {formatDate(run.payDate)} - {run.legalEntity?.legalName || `Entity #${run.legalEntityId}`}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {statusBadge(run.status)}
            {statusBadge(run.runKind)}
            {run.sourceVendor && statusBadge(run.sourceVendor.name)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" && (
            <>
              <Button size="sm" variant="outline" onClick={() => onAddWorker(run)} disabled={isMutating}>
                <Plus className="h-4 w-4" />
                Worker
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRunTransition(run, "review")} disabled={isMutating}>
                <CheckCircle2 className="h-4 w-4" />
                Review
              </Button>
            </>
          )}
          {run.status === "reviewed" && (
            <Button size="sm" variant="outline" onClick={() => onRunTransition(run, "finalize")} disabled={isMutating}>
              <CheckCircle2 className="h-4 w-4" />
              Finalize
            </Button>
          )}
          {run.status === "finalized" && (
            <Button size="sm" variant="outline" onClick={() => onCreateCorrection(run)} disabled={isMutating}>
              <RotateCcw className="h-4 w-4" />
              Correction
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Gross</div>
            <div className="font-medium">{formatPayrollTotals(run.totalsByCurrency, "grossPayCents")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Net</div>
            <div className="font-medium">{formatPayrollTotals(run.totalsByCurrency, "netPayCents")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Cleared</div>
            <div className="font-medium">{formatPayrollTotals(run.totalsByCurrency, "clearedPaymentCents")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">In flight</div>
            <div className="font-medium">{formatPayrollTotals(run.totalsByCurrency, "inFlightPaymentCents")}</div>
          </div>
        </div>

        <div className="space-y-4">
          {(run.workers ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No worker results recorded.
            </div>
          ) : (
            (run.workers ?? []).map((worker) => (
              <div key={worker.id} className="rounded-md border p-4">
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {worker.worker?.legalName || `Worker #${worker.workerId}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {worker.worker?.workerCode || `Employment #${worker.employmentId}`} - {humanize(worker.employment?.payrollParticipation)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(worker.paymentSummary.state)}
                    {canEditOutput && (
                      <Button size="sm" variant="outline" onClick={() => onAddLine(worker)} disabled={isMutating}>
                        <Plus className="h-4 w-4" />
                        Line
                      </Button>
                    )}
                    {canRecordPayments && (
                      <Button size="sm" variant="outline" onClick={() => onRecordPayment(worker)} disabled={isMutating}>
                        <WalletCards className="h-4 w-4" />
                        Payment
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  <PayrollAmount label="Gross" value={worker.grossPayCents} currency={worker.currency} />
                  <PayrollAmount label="Employee tax" value={worker.employeeTaxCents} currency={worker.currency} />
                  <PayrollAmount label="Employer tax" value={worker.employerTaxCents} currency={worker.currency} />
                  <PayrollAmount label="Deductions" value={worker.deductionCents} currency={worker.currency} />
                  <PayrollAmount label="Net" value={worker.netPayCents} currency={worker.currency} />
                  <PayrollAmount label="Cleared" value={worker.paymentSummary.clearedPaymentCents} currency={worker.currency} />
                  <PayrollAmount label="In flight" value={worker.paymentSummary.inFlightPaymentCents} currency={worker.currency} />
                  <PayrollAmount label="Pending" value={worker.paymentSummary.pendingPaymentCents} currency={worker.currency} />
                  <PayrollAmount label="Unpaid" value={worker.paymentSummary.remainingNetPayCents} currency={worker.currency} />
                  <PayrollAmount label="Overpaid" value={worker.paymentSummary.overpaidNetPayCents} currency={worker.currency} />
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <PayrollLinesTable lines={worker.resultLines ?? []} />
                  <PayrollPaymentsTable
                    payments={worker.payments ?? []}
                    onPaymentTransition={onPaymentTransition}
                    isMutating={isMutating}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PayrollAmount({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{formatMoney(value, currency)}</div>
    </div>
  );
}

function PayrollLinesTable({ lines }: { lines: PayrollResultLine[] }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Result Lines</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <EmptyRow colSpan={3} label="No lines." />
          ) : (
            lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <div className="font-medium">{line.lineCode}</div>
                  <div className="text-xs text-muted-foreground">{line.description || "-"}</div>
                </TableCell>
                <TableCell>{humanize(line.lineCategory)}</TableCell>
                <TableCell className="text-right">
                  {line.amountEffect === "decrease" ? "-" : ""}
                  {formatMoney(line.amountCents, line.currency)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PayrollPaymentsTable({
  payments,
  isMutating,
  onPaymentTransition,
}: {
  payments: PayrollPayment[];
  isMutating: boolean;
  onPaymentTransition: (payment: PayrollPayment, action: "send" | "clear" | "fail" | "void" | "reverse") => void;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Payments</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <EmptyRow colSpan={4} label="No payments." />
          ) : (
            payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>
                  <div>{formatDate(payment.paymentDate)}</div>
                  <div className="text-xs text-muted-foreground">{payment.methodLabel || humanize(payment.methodType)}</div>
                </TableCell>
                <TableCell>{statusBadge(payment.status)}</TableCell>
                <TableCell className="text-right">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-2">
                    {payment.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "send")} disabled={isMutating}>
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "fail")} disabled={isMutating}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {payment.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "clear")} disabled={isMutating}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "fail")} disabled={isMutating}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {["sent", "cleared"].includes(payment.status) && (
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "reverse")} disabled={isMutating}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    {payment.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "void")} disabled={isMutating}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
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

function PayrollRunDialog({
  state,
  legalEntities,
  vendors,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: PayrollRunDialogState | null;
  legalEntities: FinanceLegalEntity[];
  vendors: FinanceVendor[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: PayrollRunFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof PayrollRunFormState>(key: K, value: PayrollRunFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state.mode === "correction" ? "Create Correction Run" : "Create Payroll Run"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Legal entity">
              <Select
                value={form.legalEntityId}
                onValueChange={(value) => update("legalEntityId", value)}
                disabled={state.mode === "correction"}
              >
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
            <FormField label="Run kind">
              <Select value={form.runKind} onValueChange={(value) => update("runKind", value)} disabled={state.mode === "correction"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.mode === "correction" ? (
                    <SelectItem value="correction">Correction</SelectItem>
                  ) : payrollRunKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>{humanize(kind)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Period start">
              <Input type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} required />
            </FormField>
            <FormField label="Period end">
              <Input type="date" value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} required />
            </FormField>
            <FormField label="Pay date">
              <Input type="date" value={form.payDate} onChange={(event) => update("payDate", event.target.value)} required />
            </FormField>
            <FormField label="Source">
              <Select value={form.sourceType} onValueChange={(value) => update("sourceType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payrollSourceTypes.map((source) => (
                    <SelectItem key={source} value={source}>{humanize(source)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Source vendor">
              <Select value={form.sourceVendorId || noSelection} onValueChange={(value) => update("sourceVendorId", value === noSelection ? "" : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noSelection}>None</SelectItem>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} maxLength={4000} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayrollWorkerDialog({
  state,
  employmentOptions,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: PayrollWorkerDialogState | null;
  employmentOptions: PayrollEmploymentOption[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: PayrollWorkerFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const options = employmentOptions.filter((option) => option.employment.legalEntityId === state.run.legalEntityId);
  const update = <K extends keyof PayrollWorkerFormState>(key: K, value: PayrollWorkerFormState[K]) => {
    onChange({ ...form, [key]: value });
  };
  const updateEmployment = (employmentId: string) => {
    const option = options.find((item) => item.employment.id === Number(employmentId));
    onChange({
      ...form,
      employmentId,
      workerId: option ? String(option.worker.id) : "",
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add Worker Result</DialogTitle>
          </DialogHeader>

          <FormField label="Worker / employment">
            <Select value={form.employmentId} onValueChange={updateEmployment}>
              <SelectTrigger>
                <SelectValue placeholder="Select worker" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.employment.id} value={String(option.employment.id)}>
                      {option.worker.legalName} - {option.worker.workerCode} - {humanize(option.employment.payrollParticipation)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Currency">
              <Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} required />
            </FormField>
            <FormField label="Gross pay">
              <Input inputMode="decimal" value={form.grossPay} onChange={(event) => update("grossPay", event.target.value)} required />
            </FormField>
            <FormField label="Net pay">
              <Input inputMode="decimal" value={form.netPay} onChange={(event) => update("netPay", event.target.value)} required />
            </FormField>
            <FormField label="Employee tax">
              <Input inputMode="decimal" value={form.employeeTax} onChange={(event) => update("employeeTax", event.target.value)} />
            </FormField>
            <FormField label="Employer tax">
              <Input inputMode="decimal" value={form.employerTax} onChange={(event) => update("employerTax", event.target.value)} />
            </FormField>
            <FormField label="Deductions">
              <Input inputMode="decimal" value={form.deduction} onChange={(event) => update("deduction", event.target.value)} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.employmentId}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayrollLineDialog({
  state,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: PayrollLineDialogState | null;
  isPending: boolean;
  onClose: () => void;
  onChange: (form: PayrollLineFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof PayrollLineFormState>(key: K, value: PayrollLineFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add Result Line</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Category">
              <Select value={form.lineCategory} onValueChange={(value) => update("lineCategory", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payrollLineCategories.map((category) => (
                    <SelectItem key={category} value={category}>{humanize(category)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Code">
              <Input value={form.lineCode} onChange={(event) => update("lineCode", event.target.value)} required maxLength={120} />
            </FormField>
            <FormField label="Effect">
              <Select value={form.amountEffect} onValueChange={(value) => update("amountEffect", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payrollAmountEffects.map((effect) => (
                    <SelectItem key={effect} value={effect}>{humanize(effect)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Amount">
              <Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} required />
            </FormField>
            <FormField label="Currency">
              <Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} required />
            </FormField>
            <FormField label="Jurisdiction">
              <Input value={form.jurisdictionCode} onChange={(event) => update("jurisdictionCode", event.target.value)} maxLength={80} />
            </FormField>
            <FormField label="Quantity">
              <Input inputMode="decimal" value={form.quantity} onChange={(event) => update("quantity", event.target.value)} />
            </FormField>
            <FormField label="Rate">
              <Input inputMode="decimal" value={form.rateAmount} onChange={(event) => update("rateAmount", event.target.value)} />
            </FormField>
          </div>

          <FormField label="Description">
            <Input value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={400} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayrollPaymentDialog({
  state,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: PayrollPaymentDialogState | null;
  isPending: boolean;
  onClose: () => void;
  onChange: (form: PayrollPaymentFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof PayrollPaymentFormState>(key: K, value: PayrollPaymentFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Record Payroll Payment</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Amount">
              <Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} required />
            </FormField>
            <FormField label="Currency">
              <Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} required />
            </FormField>
            <FormField label="Payment date">
              <Input type="date" value={form.paymentDate} onChange={(event) => update("paymentDate", event.target.value)} />
            </FormField>
            <FormField label="Status">
              <Select value={form.status} onValueChange={(value) => update("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payrollPaymentInitialStatuses.map((status) => (
                    <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Method">
              <Select value={form.methodType} onValueChange={(value) => update("methodType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payrollPaymentMethods.map((method) => (
                    <SelectItem key={method} value={method}>{humanize(method)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Method label">
              <Input value={form.methodLabel} onChange={(event) => update("methodLabel", event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Institution">
              <Input value={form.institutionName} onChange={(event) => update("institutionName", event.target.value)} maxLength={160} />
            </FormField>
            <FormField label="Last 4">
              <Input value={form.maskedLast4} onChange={(event) => update("maskedLast4", event.target.value)} maxLength={4} inputMode="numeric" />
            </FormField>
          </div>

          <FormField label="Confirmation">
            <Input value={form.externalConfirmationRef} onChange={(event) => update("externalConfirmationRef", event.target.value)} maxLength={200} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              <WalletCards className="h-4 w-4" />
              Record
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

function emptyPayrollRunForm(entity?: FinanceLegalEntity, vendor?: FinanceVendor): PayrollRunFormState {
  return {
    legalEntityId: entity ? String(entity.id) : "",
    periodStart: "",
    periodEnd: "",
    payDate: "",
    runKind: "regular",
    sourceType: "manual",
    sourceVendorId: vendor ? String(vendor.id) : "",
    correctionOfPayrollRunId: "",
    notes: "",
  };
}

function emptyPayrollWorkerForm(option?: PayrollEmploymentOption): PayrollWorkerFormState {
  return {
    workerId: option ? String(option.worker.id) : "",
    employmentId: option ? String(option.employment.id) : "",
    currency: "USD",
    grossPay: "0.00",
    employeeTax: "0.00",
    employerTax: "0.00",
    deduction: "0.00",
    netPay: "0.00",
  };
}

function emptyPayrollLineForm(currency: string): PayrollLineFormState {
  return {
    lineCategory: "earning",
    lineCode: "",
    description: "",
    amountEffect: "increase",
    amount: "",
    currency,
    quantity: "",
    rateAmount: "",
    jurisdictionCode: "",
  };
}

function emptyPayrollPaymentForm(runWorker: PayrollRunWorker): PayrollPaymentFormState {
  return {
    amount: formatCentsForInput(Math.max(0, runWorker.paymentSummary.remainingNetPayCents || runWorker.netPayCents)),
    currency: runWorker.currency,
    paymentDate: "",
    methodType: "ach",
    methodLabel: "",
    institutionName: "",
    maskedLast4: "",
    externalConfirmationRef: "",
    status: "pending",
  };
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

function parseMoneyToCents(value: string, allowZero = false) {
  const trimmed = value.trim();
  if (!trimmed && allowZero) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter a positive amount with up to two decimals.");
  }
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents) || cents < 0 || (!allowZero && cents <= 0)) {
    throw new Error(allowZero ? "Amount cannot be negative." : "Amount must be positive.");
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

function formatPayrollTotals(values: PayrollCurrencyTotals[] | undefined, field: keyof PayrollCurrencyTotals) {
  if (!values || values.length === 0) {
    return formatMoney(0);
  }
  return values
    .map((value) => {
      const amount = value[field];
      return formatMoney(typeof amount === "number" ? amount : 0, value.currency);
    })
    .join(" / ");
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
    ["active", "paid", "cleared", "approved", "finalized", "sent", "not_payable"].includes(status)
      ? "border-green-500/20 bg-green-500/10 text-green-700"
      : ["pending", "draft", "reviewed", "received", "partially_paid", "outflow"].includes(status)
        ? "border-blue-500/20 bg-blue-500/10 text-blue-700"
        : ["disputed", "failed", "missing", "trial", "paused", "mixed", "overpaid"].includes(status)
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
