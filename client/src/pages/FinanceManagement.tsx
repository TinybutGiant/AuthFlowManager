import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  FileWarning,
  ReceiptText,
  Repeat2,
  WalletCards,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  vendorId: number;
  vendorName?: string | null;
  categoryCode: string;
  cadence: string;
  expectedAmountCents?: number | null;
  currency: string;
  variableAmount: boolean;
  nextBillingDate?: string | null;
  renewalDate?: string | null;
  autoRenew: boolean;
  status: string;
};

type FinanceBill = {
  id: number;
  vendorId: number;
  vendorName?: string | null;
  recurringExpenseId?: number | null;
  invoiceNumber?: string | null;
  billKind: string;
  issueDate?: string | null;
  dueDate?: string | null;
  amountCents: number;
  currency: string;
  categoryCode: string;
  status: string;
  activeAppliedAmountCents?: number;
  remainingAmountCents?: number;
  settlementState?: string;
  documentCount?: number;
};

type FinancePayment = {
  id: number;
  vendorId?: number | null;
  vendorName?: string | null;
  amountCents: number;
  currency: string;
  direction: string;
  paymentDate?: string | null;
  methodType: string;
  status: string;
  activeAppliedAmountCents?: number;
  remainingAmountCents?: number;
};

const sections: FinanceSection[] = ["overview", "expenses", "subscriptions", "vendors"];

export default function FinanceManagement() {
  const [location, setLocation] = useLocation();
  const selectedSection = sectionFromLocation(location);

  const overviewQuery = useQuery<FinanceOverview>({
    queryKey: ["/api/admin/finance/overview"],
  });
  const billsQuery = useQuery<FinanceBill[]>({
    queryKey: ["/api/admin/finance/bills?pageSize=100"],
  });
  const paymentsQuery = useQuery<FinancePayment[]>({
    queryKey: ["/api/admin/finance/payments?pageSize=100"],
  });
  const subscriptionsQuery = useQuery<FinanceSubscription[]>({
    queryKey: ["/api/admin/finance/subscriptions?pageSize=100"],
  });
  const vendorsQuery = useQuery<FinanceVendor[]>({
    queryKey: ["/api/admin/finance/vendors?pageSize=100"],
  });

  const error = overviewQuery.error || billsQuery.error || paymentsQuery.error || subscriptionsQuery.error || vendorsQuery.error;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-light text-foreground" data-testid="text-finance-management-title">
          Finance
        </h1>
        <p className="text-muted-foreground">
          Expenses, subscriptions, vendors, and AP reconciliation.
        </p>
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
            bills={billsQuery.data ?? []}
            payments={paymentsQuery.data ?? []}
            isLoading={billsQuery.isLoading || paymentsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-6">
          <SubscriptionsPanel
            subscriptions={subscriptionsQuery.data ?? []}
            isLoading={subscriptionsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="vendors" className="space-y-6">
          <VendorsPanel
            vendors={vendorsQuery.data ?? []}
            isLoading={vendorsQuery.isLoading}
          />
        </TabsContent>
      </Tabs>
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
  isLoading,
}: {
  bills: FinanceBill[];
  payments: FinancePayment[];
  isLoading: boolean;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            Bills
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BillsTable bills={bills} isLoading={isLoading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WalletCards className="h-5 w-5" />
            Payments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentsTable payments={payments} isLoading={isLoading} />
        </CardContent>
      </Card>
    </>
  );
}

function SubscriptionsPanel({
  subscriptions,
  isLoading,
}: {
  subscriptions: FinanceSubscription[];
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat2 className="h-5 w-5" />
          Subscriptions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SubscriptionsTable subscriptions={subscriptions} isLoading={isLoading} />
      </CardContent>
    </Card>
  );
}

function VendorsPanel({ vendors, isLoading }: { vendors: FinanceVendor[]; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Vendors
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <EmptyRow colSpan={4} label="Loading vendors..." />
            ) : vendors.length === 0 ? (
              <EmptyRow colSpan={4} label="No vendors." />
            ) : (
              vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>{humanize(vendor.vendorType)}</TableCell>
                  <TableCell>{statusBadge(vendor.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {vendor.contactEmail || vendor.website || "-"}
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
}: {
  bills: FinanceBill[];
  isLoading: boolean;
  compact?: boolean;
}) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={compact ? 5 : 7} label="Loading bills..." />
        ) : bills.length === 0 ? (
          <EmptyRow colSpan={compact ? 5 : 7} label="No bills." />
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
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function PaymentsTable({ payments, isLoading }: { payments: FinancePayment[]; isLoading: boolean }) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={6} label="Loading payments..." />
        ) : payments.length === 0 ? (
          <EmptyRow colSpan={6} label="No payments." />
        ) : (
          payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="font-medium">
                {payment.vendorName || (payment.vendorId ? `Vendor #${payment.vendorId}` : "Unassigned")}
              </TableCell>
              <TableCell>{formatDate(payment.paymentDate)}</TableCell>
              <TableCell>{humanize(payment.methodType)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {statusBadge(payment.direction)}
                  {statusBadge(payment.status)}
                </div>
              </TableCell>
              <TableCell className="text-right">{formatMoney(payment.amountCents, payment.currency)}</TableCell>
              <TableCell className="text-right">{formatMoney(payment.remainingAmountCents, payment.currency)}</TableCell>
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
}: {
  subscriptions: FinanceSubscription[];
  isLoading: boolean;
  compact?: boolean;
}) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={compact ? 5 : 6} label="Loading subscriptions..." />
        ) : subscriptions.length === 0 ? (
          <EmptyRow colSpan={compact ? 5 : 6} label="No subscriptions." />
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
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
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
        : ["disputed", "failed", "missing"].includes(status)
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
