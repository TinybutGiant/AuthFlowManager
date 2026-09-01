import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  Building2,
  CheckCircle2,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Send,
  WalletCards,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

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

type PayrollLegalEntity = {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
};

type PayrollVendor = {
  id: number;
  name: string;
  vendorType: string;
  status: string;
};

type PayrollRun = {
  id: number;
  legalEntityId: number;
  legalEntity?: PayrollLegalEntity | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runKind: string;
  sourceType: string;
  sourceVendorId?: number | null;
  sourceVendor?: PayrollVendor | null;
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

const V2_PAYROLL_BASE = "/api/v2/payroll";
const noSelection = "__none__";
const payrollRunKinds = ["regular", "off_cycle", "bonus", "adjustment"] as const;
const payrollSourceTypes = ["manual", "provider", "csv_import", "internal"] as const;
const payrollLineCategories = ["earning", "deduction", "employee_tax", "employer_tax", "reimbursement", "other"] as const;
const payrollAmountEffects = ["increase", "decrease"] as const;
const payrollPaymentMethods = ["payroll_provider", "ach", "check", "manual", "other"] as const;
const payrollPaymentInitialStatuses = ["pending", "sent", "cleared", "failed"] as const;

async function v2PayrollJson<T>(
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

function usePayrollMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (request: { method: string; path: string; body?: unknown }) =>
      v2PayrollJson(request.path, { method: request.method, json: request.body ?? {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith(V2_PAYROLL_BASE);
        },
      });
      toast({ title: "Payroll updated" });
    },
    onError: (error) => {
      toast({
        title: "Payroll update failed",
        description: error instanceof Error ? error.message : "The payroll record was not updated.",
        variant: "destructive",
      });
    },
  });
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
    <Card className="rounded-md border-border/80 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{title}</CardTitle>
        <span className="rounded-md border bg-muted/30 p-1.5 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-[28px] font-semibold leading-none tracking-normal text-foreground tabular-nums">{value}</div>
        {detail && <p className="mt-2 text-[13px] text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function PayrollSectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-md border-border/80 shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-[17px] font-semibold">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            {title}
          </CardTitle>
          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap justify-end gap-2">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CompactEmptyState({
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
    <div className="rounded-md border border-dashed bg-muted/20 px-5 py-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <div className="mx-auto mt-1 max-w-md text-[13px] leading-5 text-muted-foreground">{description}</div>}
      {actionLabel && onAction && (
        <Button className="mt-4" size="sm" variant="outline" onClick={onAction}>
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
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

function PayrollSummaryAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function PayrollAmount({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{formatMoney(value, currency)}</div>
    </div>
  );
}

function PayrollLinesTable({ lines }: { lines: PayrollResultLine[] }) {
  if (lines.length === 0) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">Result lines</div>
        <CompactEmptyState title="No result lines" description="Earnings, taxes, deductions, and employer costs will appear here." />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Result lines</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id} className="h-12">
              <TableCell>
                <div className="font-medium">{line.lineCode}</div>
                <div className="text-xs text-muted-foreground">{line.description || "-"}</div>
              </TableCell>
              <TableCell>{humanize(line.lineCategory)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {line.amountEffect === "decrease" ? "-" : ""}
                {formatMoney(line.amountCents, line.currency)}
              </TableCell>
            </TableRow>
          ))}
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
  if (payments.length === 0) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">Payments</div>
        <CompactEmptyState title="No payroll payments" description="Recorded worker payment attempts will appear here." />
      </div>
    );
  }

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
          {payments.map((payment) => (
            <TableRow key={payment.id} className="h-12">
              <TableCell>
                <div>{formatDate(payment.paymentDate)}</div>
                <div className="text-xs text-muted-foreground">{payment.methodLabel || humanize(payment.methodType)}</div>
              </TableCell>
              <TableCell>{statusBadge(payment.status)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  {payment.status === "pending" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "send")} disabled={isMutating}>
                        <Send className="h-4 w-4" />
                        Send
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "fail")} disabled={isMutating}>
                        <XCircle className="h-4 w-4" />
                        Fail
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "void")} disabled={isMutating}>
                        <Archive className="h-4 w-4" />
                        Void
                      </Button>
                    </>
                  )}
                  {payment.status === "sent" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "clear")} disabled={isMutating}>
                        <CheckCircle2 className="h-4 w-4" />
                        Clear
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "fail")} disabled={isMutating}>
                        <XCircle className="h-4 w-4" />
                        Fail
                      </Button>
                    </>
                  )}
                  {["sent", "cleared"].includes(payment.status) && (
                    <Button size="sm" variant="outline" onClick={() => onPaymentTransition(payment, "reverse")} disabled={isMutating}>
                      <RotateCcw className="h-4 w-4" />
                      Reverse
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <PayrollSectionCard title="Run detail" description="Select a run to review workers, lines, and payments." icon={ReceiptText}>
        <CompactEmptyState
          title="No run selected"
          description="Select a payroll run from the list or create a new run."
        />
      </PayrollSectionCard>
    );
  }

  const canEditOutput = run.status === "draft";
  const canRecordPayments = run.status === "finalized";
  return (
    <PayrollSectionCard
      title={`${formatDate(run.periodStart)} - ${formatDate(run.periodEnd)}`}
      description={`Pay ${formatDate(run.payDate)} - ${run.legalEntity?.legalName || `Entity #${run.legalEntityId}`}`}
      icon={ReceiptText}
      action={(
        <div className="flex flex-wrap justify-end gap-2">
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
      )}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap justify-end gap-2">
            {statusBadge(run.status)}
            {statusBadge(run.runKind)}
            {run.sourceVendor && statusBadge(run.sourceVendor.name)}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PayrollSummaryAmount label="Gross" value={formatPayrollTotals(run.totalsByCurrency, "grossPayCents")} />
          <PayrollSummaryAmount label="Net" value={formatPayrollTotals(run.totalsByCurrency, "netPayCents")} />
          <PayrollSummaryAmount label="Cleared" value={formatPayrollTotals(run.totalsByCurrency, "clearedPaymentCents")} />
          <PayrollSummaryAmount label="In flight" value={formatPayrollTotals(run.totalsByCurrency, "inFlightPaymentCents")} />
        </div>

        <div className="space-y-4">
          {(run.workers ?? []).length === 0 ? (
            <CompactEmptyState
              title="No worker results"
              description="Add worker results after payroll output is available."
              actionLabel={canEditOutput ? "Add worker" : undefined}
              onAction={canEditOutput ? () => onAddWorker(run) : undefined}
            />
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
      </div>
    </PayrollSectionCard>
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
  legalEntities: PayrollLegalEntity[];
  vendors: PayrollVendor[];
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

function emptyPayrollRunForm(entity?: PayrollLegalEntity, vendor?: PayrollVendor): PayrollRunFormState {
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

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function formatMoney(value?: number | null, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value / 100);
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
      : ["pending", "draft", "reviewed", "received", "partially_paid", "outflow", "needs_attention"].includes(status)
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

export default function V2PayrollManagement() {
  const { toast } = useToast();
  const [selectedRunId, setSelectedRunId] = React.useState<number | null>(null);
  const [runDialog, setRunDialog] = React.useState<PayrollRunDialogState | null>(null);
  const [workerDialog, setWorkerDialog] = React.useState<PayrollWorkerDialogState | null>(null);
  const [lineDialog, setLineDialog] = React.useState<PayrollLineDialogState | null>(null);
  const [paymentDialog, setPaymentDialog] = React.useState<PayrollPaymentDialogState | null>(null);

  const overviewQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/overview`],
    queryFn: () => v2PayrollJson<PayrollOverview>(`${V2_PAYROLL_BASE}/overview`),
  });
  const runsQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/runs?pageSize=100`],
    queryFn: () => v2PayrollJson<PayrollRun[]>(`${V2_PAYROLL_BASE}/runs?pageSize=100`),
  });
  const legalEntitiesQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/legal-entities`],
    queryFn: () => v2PayrollJson<PayrollLegalEntity[]>(`${V2_PAYROLL_BASE}/legal-entities`),
  });
  const vendorsQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/vendors`],
    queryFn: () => v2PayrollJson<PayrollVendor[]>(`${V2_PAYROLL_BASE}/vendors`),
  });
  const employmentOptionsQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/employment-options?pageSize=250`],
    queryFn: () => v2PayrollJson<PayrollEmploymentOption[]>(`${V2_PAYROLL_BASE}/employment-options?pageSize=250`),
  });
  const runDetailQuery = useQuery({
    queryKey: [`${V2_PAYROLL_BASE}/runs/${selectedRunId}`],
    queryFn: () => v2PayrollJson<PayrollRun>(`${V2_PAYROLL_BASE}/runs/${selectedRunId}`),
    enabled: Boolean(selectedRunId),
  });
  const payrollMutation = usePayrollMutation();

  const runs = runsQuery.data ?? [];
  const selectedRun = runDetailQuery.data ?? runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const legalEntities = legalEntitiesQuery.data ?? [];
  const vendors = vendorsQuery.data ?? [];
  const employmentOptions = employmentOptionsQuery.data ?? [];
  const isLoading =
    overviewQuery.isLoading ||
    runsQuery.isLoading ||
    legalEntitiesQuery.isLoading ||
    vendorsQuery.isLoading ||
    employmentOptionsQuery.isLoading ||
    runDetailQuery.isLoading;
  const error =
    overviewQuery.error ||
    runsQuery.error ||
    legalEntitiesQuery.error ||
    vendorsQuery.error ||
    employmentOptionsQuery.error ||
    runDetailQuery.error;

  React.useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  function mutate(method: string, path: string, body: Record<string, unknown> = {}) {
    payrollMutation.mutate({ method, path, body });
  }

  function openCreateRun() {
    setRunDialog({
      mode: "create",
      form: emptyPayrollRunForm(legalEntities[0], vendors[0]),
    });
  }

  function openCreateCorrection(run: PayrollRun) {
    setRunDialog({
      mode: "correction",
      form: {
        ...emptyPayrollRunForm(legalEntities.find((entity) => entity.id === run.legalEntityId), vendors[0]),
        legalEntityId: String(run.legalEntityId),
        periodStart: run.periodStart?.slice(0, 10) ?? "",
        periodEnd: run.periodEnd?.slice(0, 10) ?? "",
        payDate: run.payDate?.slice(0, 10) ?? "",
        runKind: "correction",
        correctionOfPayrollRunId: String(run.id),
      },
    });
  }

  function submitRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runDialog) return;
    try {
      const isCorrection = runDialog.mode === "correction";
      const body = compactPayload({
        legalEntityId: isCorrection ? undefined : Number(runDialog.form.legalEntityId),
        correctionOfPayrollRunId: isCorrection ? Number(runDialog.form.correctionOfPayrollRunId) : undefined,
        periodStart: runDialog.form.periodStart,
        periodEnd: runDialog.form.periodEnd,
        payDate: runDialog.form.payDate,
        runKind: isCorrection ? undefined : runDialog.form.runKind,
        sourceType: runDialog.form.sourceType,
        sourceVendorId: runDialog.form.sourceVendorId ? Number(runDialog.form.sourceVendorId) : undefined,
        notes: optionalString(runDialog.form.notes),
      });
      payrollMutation.mutate({
        method: "POST",
        path: isCorrection ? `${V2_PAYROLL_BASE}/runs/corrections` : `${V2_PAYROLL_BASE}/runs`,
        body,
      }, {
        onSuccess: (created) => {
          const run = created as PayrollRun;
          setRunDialog(null);
          if (run.id) setSelectedRunId(run.id);
        },
      });
    } catch (error) {
      toast({
        title: "Payroll run form needs attention",
        description: error instanceof Error ? error.message : "Check the payroll run fields.",
        variant: "destructive",
      });
    }
  }

  function transitionRun(run: PayrollRun, action: "review" | "finalize") {
    mutate("POST", `${V2_PAYROLL_BASE}/runs/${run.id}/${action}`);
  }

  function openAddWorker(run: PayrollRun) {
    const option = employmentOptions.find((item) => item.employment.legalEntityId === run.legalEntityId) ?? employmentOptions[0];
    setWorkerDialog({
      run,
      form: emptyPayrollWorkerForm(option),
    });
  }

  function submitWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workerDialog) return;
    try {
      const body = {
        workerId: Number(workerDialog.form.workerId),
        employmentId: Number(workerDialog.form.employmentId),
        currency: workerDialog.form.currency,
        grossPayCents: parseMoneyToCents(workerDialog.form.grossPay, true),
        employeeTaxCents: parseMoneyToCents(workerDialog.form.employeeTax, true),
        employerTaxCents: parseMoneyToCents(workerDialog.form.employerTax, true),
        deductionCents: parseMoneyToCents(workerDialog.form.deduction, true),
        netPayCents: parseMoneyToCents(workerDialog.form.netPay, true),
        sourceMetadata: {},
      };
      payrollMutation.mutate({
        method: "POST",
        path: `${V2_PAYROLL_BASE}/runs/${workerDialog.run.id}/workers`,
        body,
      }, {
        onSuccess: () => setWorkerDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll worker result needs attention",
        description: error instanceof Error ? error.message : "Check the worker result fields.",
        variant: "destructive",
      });
    }
  }

  function submitLine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lineDialog) return;
    try {
      const body = compactPayload({
        lineCategory: lineDialog.form.lineCategory,
        lineCode: lineDialog.form.lineCode.trim(),
        description: optionalString(lineDialog.form.description),
        amountEffect: lineDialog.form.amountEffect,
        amountCents: parseMoneyToCents(lineDialog.form.amount),
        currency: lineDialog.form.currency,
        quantityMicrounits: lineDialog.form.quantity ? Math.round(Number(lineDialog.form.quantity) * 1_000_000) : undefined,
        rateAmountCents: lineDialog.form.rateAmount ? parseMoneyToCents(lineDialog.form.rateAmount) : undefined,
        jurisdictionCode: optionalString(lineDialog.form.jurisdictionCode),
        metadata: {},
      });
      payrollMutation.mutate({
        method: "POST",
        path: `${V2_PAYROLL_BASE}/run-workers/${lineDialog.runWorker.id}/result-lines`,
        body,
      }, {
        onSuccess: () => setLineDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll line needs attention",
        description: error instanceof Error ? error.message : "Check the result line fields.",
        variant: "destructive",
      });
    }
  }

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentDialog) return;
    try {
      const body = compactPayload({
        amountCents: parseMoneyToCents(paymentDialog.form.amount),
        currency: paymentDialog.form.currency,
        paymentDate: optionalString(paymentDialog.form.paymentDate),
        methodType: paymentDialog.form.methodType,
        methodLabel: optionalString(paymentDialog.form.methodLabel),
        institutionName: optionalString(paymentDialog.form.institutionName),
        maskedLast4: optionalString(paymentDialog.form.maskedLast4),
        externalConfirmationRef: optionalString(paymentDialog.form.externalConfirmationRef),
        status: paymentDialog.form.status,
      });
      payrollMutation.mutate({
        method: "POST",
        path: `${V2_PAYROLL_BASE}/run-workers/${paymentDialog.runWorker.id}/payments`,
        body,
      }, {
        onSuccess: () => setPaymentDialog(null),
      });
    } catch (error) {
      toast({
        title: "Payroll payment needs attention",
        description: error instanceof Error ? error.message : "Check the payment fields.",
        variant: "destructive",
      });
    }
  }

  function transitionPayment(payment: PayrollPayment, action: "send" | "clear" | "fail" | "void" | "reverse") {
    mutate("POST", `${V2_PAYROLL_BASE}/payments/${payment.id}/${action}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">Payroll</h2>
          <p className="mt-1 text-sm text-muted-foreground">Externally calculated payroll ledger and payment status.</p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Unable to load payroll records."}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Open runs"
          value={overviewQuery.data?.draftRuns.length ?? 0}
          detail="Draft or reviewed"
          icon={ReceiptText}
        />
        <MetricCard
          title="Gross payroll"
          value={formatPayrollTotals(overviewQuery.data?.totalsByCurrency, "grossPayCents")}
          detail="Effective finalized snapshots"
          icon={WalletCards}
        />
        <MetricCard
          title="Net payroll"
          value={formatPayrollTotals(overviewQuery.data?.totalsByCurrency, "netPayCents")}
          detail="Corrections replace originals"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Payment issues"
          value={(overviewQuery.data?.runPaymentStates.failed ?? 0) + (overviewQuery.data?.runPaymentStates.mixed ?? 0) + (overviewQuery.data?.runPaymentStates.overpaid ?? 0)}
          detail="Failed, mixed, or overpaid"
          icon={AlertCircle}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <PayrollSectionCard
          title="Payroll runs"
          description="Historical records by pay period."
          icon={Building2}
          action={<Button size="sm" onClick={openCreateRun} disabled={payrollMutation.isPending}><Plus className="h-4 w-4" />Create run</Button>}
        >
          <div className="overflow-x-auto">
            {isLoading ? (
              <CompactEmptyState title="Loading payroll runs" description="Loading payroll periods and payment summaries." />
            ) : runs.length === 0 ? (
              <CompactEmptyState
                title="No payroll runs"
                description="Create a run after payroll has been calculated externally."
                actionLabel="Create run"
                onAction={openCreateRun}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={cn("h-12 cursor-pointer", run.id === selectedRun?.id && "bg-muted/50")}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <TableCell>
                        <button className="text-left font-medium" type="button" onClick={() => setSelectedRunId(run.id)}>
                          {formatDate(run.periodStart)} - {formatDate(run.periodEnd)}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          Pay {formatDate(run.payDate)} - {humanize(run.runKind)} - {humanize(run.sourceType)}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatPayrollTotals(run.totalsByCurrency, "netPayCents")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </PayrollSectionCard>

        <PayrollRunDetailPanel
          run={selectedRun}
          isMutating={payrollMutation.isPending}
          onCreateCorrection={openCreateCorrection}
          onRunTransition={transitionRun}
          onAddWorker={openAddWorker}
          onAddLine={(runWorker) => setLineDialog({ runWorker, form: emptyPayrollLineForm(runWorker.currency) })}
          onRecordPayment={(runWorker) => setPaymentDialog({ runWorker, form: emptyPayrollPaymentForm(runWorker) })}
          onPaymentTransition={transitionPayment}
        />
      </div>

      <PayrollRunDialog
        state={runDialog}
        legalEntities={legalEntities}
        vendors={vendors}
        isPending={payrollMutation.isPending}
        onClose={() => setRunDialog(null)}
        onChange={(form) => setRunDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitRun}
      />
      <PayrollWorkerDialog
        state={workerDialog}
        employmentOptions={employmentOptions}
        isPending={payrollMutation.isPending}
        onClose={() => setWorkerDialog(null)}
        onChange={(form) => setWorkerDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitWorker}
      />
      <PayrollLineDialog
        state={lineDialog}
        isPending={payrollMutation.isPending}
        onClose={() => setLineDialog(null)}
        onChange={(form) => setLineDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitLine}
      />
      <PayrollPaymentDialog
        state={paymentDialog}
        isPending={payrollMutation.isPending}
        onClose={() => setPaymentDialog(null)}
        onChange={(form) => setPaymentDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitPayment}
      />
    </main>
  );
}
