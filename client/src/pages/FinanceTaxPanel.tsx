import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FileText,
  Landmark,
  Plus,
  RotateCcw,
  Scale,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

type TaxLegalEntity = {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
};

type TaxAgency = {
  id: number;
  agencyCode: string;
  name: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  status: string;
};

type TaxRegistration = {
  id: number;
  legalEntityId: number;
  legalEntity?: TaxLegalEntity | null;
  taxAgencyId: number;
  taxAgency?: TaxAgency | null;
  taxType: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  maskedAccountRef?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status: string;
  dateState: string;
  notes?: string | null;
};

type TaxLiability = {
  id: number;
  taxRegistrationId: number;
  registration?: TaxRegistration | null;
  periodStart: string;
  periodEnd: string;
  dueDate?: string | null;
  dueState: string;
  component: string;
  amountEffect: string;
  amountCents: number;
  signedAmountCents: number;
  effectiveAmountCents: number;
  currency: string;
  sourceType: string;
  adjustsTaxLiabilityId?: number | null;
  adjustmentCount: number;
  paymentTrackingStatus: "not_yet_tracked";
  status: string;
  recognizedAt?: string | null;
  notes?: string | null;
};

type TaxFiling = {
  id: number;
  taxRegistrationId: number;
  registration?: TaxRegistration | null;
  filingType: string;
  periodStart: string;
  periodEnd: string;
  dueDate?: string | null;
  dueState: string;
  filedAt?: string | null;
  acceptedAt?: string | null;
  confirmationRef?: string | null;
  amendsTaxFilingId?: number | null;
  status: string;
  notes?: string | null;
};

type TaxCurrencyTotal = {
  currency: string;
  amountCents: number;
  liabilityCount: number;
};

type TaxOverview = {
  businessDate: string;
  activeRegistrationCount: number;
  effectiveLiabilityTotalsByCurrency: TaxCurrencyTotal[];
  dueSoonLiabilityCount: number;
  overdueLiabilityCount: number;
  dueSoonFilingCount: number;
  overdueFilingCount: number;
  filingStatusCounts: Record<string, number>;
  openAdjustmentOrDisputeCount: number;
  recentRegistrations: TaxRegistration[];
  recentLiabilities: TaxLiability[];
  recentFilings: TaxFiling[];
};

type TaxAgencyFormState = {
  agencyCode: string;
  name: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  status: string;
};

type TaxRegistrationFormState = {
  legalEntityId: string;
  taxAgencyId: string;
  taxType: string;
  jurisdictionType: string;
  jurisdictionCode: string;
  maskedAccountRef: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
  notes: string;
};

type TaxLiabilityFormState = {
  taxRegistrationId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  component: string;
  amountEffect: string;
  amount: string;
  currency: string;
  sourceType: string;
  notes: string;
};

type TaxFilingFormState = {
  taxRegistrationId: string;
  filingType: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  notes: string;
};

type TaxAgencyDialogState = {
  mode: "create" | "edit";
  agency?: TaxAgency;
  form: TaxAgencyFormState;
};

type TaxRegistrationDialogState = {
  mode: "create" | "edit";
  registration?: TaxRegistration;
  form: TaxRegistrationFormState;
};

type TaxLiabilityDialogState = {
  mode: "create" | "edit" | "adjustment";
  liability?: TaxLiability;
  form: TaxLiabilityFormState;
};

type TaxFilingDialogState = {
  mode: "create" | "edit" | "amendment";
  filing?: TaxFiling;
  form: TaxFilingFormState;
};

type TaxMutationRequest = {
  method: "POST" | "PATCH";
  url: string;
  body: Record<string, unknown>;
  successTitle: string;
  onSuccess?: () => void;
};

const taxQueryPrefix = "/api/admin/finance/tax";
const taxAgencyStatuses = ["active", "inactive"] as const;
const taxRegistrationStatuses = ["pending", "active"] as const;
const taxJurisdictionTypes = ["federal", "state", "local", "foreign", "other"] as const;
const taxTypes = [
  "federal_withholding",
  "social_security",
  "medicare",
  "futa",
  "state_withholding",
  "state_unemployment",
  "local_payroll",
  "other",
] as const;
const taxLiabilityComponents = [
  "withholding",
  "social_security",
  "medicare",
  "futa",
  "suta",
  "local_tax",
  "penalty",
  "interest",
  "adjustment",
  "other",
] as const;
const taxAmountEffects = ["increase", "decrease"] as const;
const taxSourceTypes = ["manual", "provider", "csv_import", "internal"] as const;

export default function FinanceTaxPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [agencyDialog, setAgencyDialog] = React.useState<TaxAgencyDialogState | null>(null);
  const [registrationDialog, setRegistrationDialog] = React.useState<TaxRegistrationDialogState | null>(null);
  const [liabilityDialog, setLiabilityDialog] = React.useState<TaxLiabilityDialogState | null>(null);
  const [filingDialog, setFilingDialog] = React.useState<TaxFilingDialogState | null>(null);

  const overviewQuery = useQuery<TaxOverview>({
    queryKey: [`${taxQueryPrefix}/overview`],
  });
  const legalEntitiesQuery = useQuery<TaxLegalEntity[]>({
    queryKey: [`${taxQueryPrefix}/legal-entities`],
  });
  const agenciesQuery = useQuery<TaxAgency[]>({
    queryKey: [`${taxQueryPrefix}/agencies?pageSize=100`],
  });
  const registrationsQuery = useQuery<TaxRegistration[]>({
    queryKey: [`${taxQueryPrefix}/registrations?pageSize=100`],
  });
  const liabilitiesQuery = useQuery<TaxLiability[]>({
    queryKey: [`${taxQueryPrefix}/liabilities?pageSize=100`],
  });
  const filingsQuery = useQuery<TaxFiling[]>({
    queryKey: [`${taxQueryPrefix}/filings?pageSize=100`],
  });

  const taxMutation = useMutation({
    mutationFn: async (request: TaxMutationRequest) => {
      const response = await apiRequest(request.method, request.url, request.body);
      return response.json();
    },
    onSuccess: async (_data, request) => {
      request.onSuccess?.();
      await invalidateTaxQueries(queryClient);
      toast({ title: request.successTitle });
    },
    onError: (error) => {
      toast({
        title: "Tax update failed",
        description: getApiErrorMessage(error, "The tax record was not updated."),
        variant: "destructive",
      });
    },
  });

  const legalEntities = legalEntitiesQuery.data ?? [];
  const agencies = agenciesQuery.data ?? [];
  const registrations = registrationsQuery.data ?? [];
  const activeRegistrations = registrations.filter((registration) => registration.status !== "closed");
  const liabilities = liabilitiesQuery.data ?? [];
  const filings = filingsQuery.data ?? [];
  const isLoading = overviewQuery.isLoading
    || legalEntitiesQuery.isLoading
    || agenciesQuery.isLoading
    || registrationsQuery.isLoading
    || liabilitiesQuery.isLoading
    || filingsQuery.isLoading;
  const isMutating = taxMutation.isPending;
  const error = overviewQuery.error
    || legalEntitiesQuery.error
    || agenciesQuery.error
    || registrationsQuery.error
    || liabilitiesQuery.error
    || filingsQuery.error;

  function openCreateAgency() {
    setAgencyDialog({ mode: "create", form: emptyAgencyForm() });
  }

  function openEditAgency(agency: TaxAgency) {
    setAgencyDialog({ mode: "edit", agency, form: agencyFormFromRecord(agency) });
  }

  function submitAgency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agencyDialog) return;
    taxMutation.mutate({
      method: agencyDialog.mode === "create" ? "POST" : "PATCH",
      url: agencyDialog.mode === "create"
        ? `${taxQueryPrefix}/agencies`
        : `${taxQueryPrefix}/agencies/${agencyDialog.agency?.id}`,
      body: {
        agencyCode: agencyDialog.form.agencyCode.trim(),
        name: agencyDialog.form.name.trim(),
        jurisdictionType: agencyDialog.form.jurisdictionType,
        jurisdictionCode: agencyDialog.form.jurisdictionCode.trim().toUpperCase(),
        status: agencyDialog.form.status,
      },
      successTitle: agencyDialog.mode === "create" ? "Tax agency added" : "Tax agency updated",
      onSuccess: () => setAgencyDialog(null),
    });
  }

  function openCreateRegistration() {
    setRegistrationDialog({
      mode: "create",
      form: emptyRegistrationForm(legalEntities[0], agencies[0]),
    });
  }

  function openEditRegistration(registration: TaxRegistration) {
    setRegistrationDialog({
      mode: "edit",
      registration,
      form: registrationFormFromRecord(registration),
    });
  }

  function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationDialog) return;
    try {
      const body = registrationPayload(registrationDialog);
      taxMutation.mutate({
        method: registrationDialog.mode === "create" ? "POST" : "PATCH",
        url: registrationDialog.mode === "create"
          ? `${taxQueryPrefix}/registrations`
          : `${taxQueryPrefix}/registrations/${registrationDialog.registration?.id}`,
        body,
        successTitle: registrationDialog.mode === "create" ? "Tax registration added" : "Tax registration updated",
        onSuccess: () => setRegistrationDialog(null),
      });
    } catch (error) {
      toast({
        title: "Tax registration needs attention",
        description: error instanceof Error ? error.message : "Check the registration fields.",
        variant: "destructive",
      });
    }
  }

  function transitionRegistration(registration: TaxRegistration, action: "activate" | "deactivate" | "close") {
    if (action === "close" && !window.confirm(`Close registration #${registration.id}?`)) return;
    taxMutation.mutate({
      method: "POST",
      url: `${taxQueryPrefix}/registrations/${registration.id}/${action}`,
      body: {},
      successTitle: `Tax registration ${action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : "closed"}`,
    });
  }

  function openCreateLiability() {
    setLiabilityDialog({
      mode: "create",
      form: emptyLiabilityForm(activeRegistrations[0]),
    });
  }

  function openEditLiability(liability: TaxLiability) {
    setLiabilityDialog({
      mode: "edit",
      liability,
      form: liabilityFormFromRecord(liability),
    });
  }

  function openCreateAdjustment(liability: TaxLiability) {
    setLiabilityDialog({
      mode: "adjustment",
      liability,
      form: emptyLiabilityAdjustmentForm(liability),
    });
  }

  function submitLiability(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!liabilityDialog) return;
    try {
      const body = liabilityPayload(liabilityDialog);
      taxMutation.mutate({
        method: liabilityDialog.mode === "edit" ? "PATCH" : "POST",
        url: liabilityDialog.mode === "create"
          ? `${taxQueryPrefix}/liabilities`
          : liabilityDialog.mode === "edit"
            ? `${taxQueryPrefix}/liabilities/${liabilityDialog.liability?.id}`
            : `${taxQueryPrefix}/liabilities/${liabilityDialog.liability?.id}/adjustments`,
        body,
        successTitle: liabilityDialog.mode === "adjustment" ? "Tax adjustment added" : liabilityDialog.mode === "edit" ? "Tax liability updated" : "Tax liability added",
        onSuccess: () => setLiabilityDialog(null),
      });
    } catch (error) {
      toast({
        title: "Tax liability needs attention",
        description: error instanceof Error ? error.message : "Check the liability fields.",
        variant: "destructive",
      });
    }
  }

  function transitionLiability(liability: TaxLiability, action: "recognize" | "dispute" | "void") {
    if (action === "void" && !window.confirm(`Void liability #${liability.id}?`)) return;
    taxMutation.mutate({
      method: "POST",
      url: `${taxQueryPrefix}/liabilities/${liability.id}/${action}`,
      body: {},
      successTitle: `Tax liability ${action === "recognize" ? "recognized" : action === "dispute" ? "disputed" : "voided"}`,
    });
  }

  function openCreateFiling() {
    setFilingDialog({
      mode: "create",
      form: emptyFilingForm(activeRegistrations[0]),
    });
  }

  function openEditFiling(filing: TaxFiling) {
    setFilingDialog({
      mode: "edit",
      filing,
      form: filingFormFromRecord(filing),
    });
  }

  function openCreateAmendment(filing: TaxFiling) {
    setFilingDialog({
      mode: "amendment",
      filing,
      form: emptyFilingAmendmentForm(filing),
    });
  }

  function submitFiling(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filingDialog) return;
    try {
      const body = filingPayload(filingDialog);
      taxMutation.mutate({
        method: filingDialog.mode === "edit" ? "PATCH" : "POST",
        url: filingDialog.mode === "create"
          ? `${taxQueryPrefix}/filings`
          : filingDialog.mode === "edit"
            ? `${taxQueryPrefix}/filings/${filingDialog.filing?.id}`
            : `${taxQueryPrefix}/filings/${filingDialog.filing?.id}/amendments`,
        body,
        successTitle: filingDialog.mode === "amendment" ? "Tax amendment added" : filingDialog.mode === "edit" ? "Tax filing updated" : "Tax filing added",
        onSuccess: () => setFilingDialog(null),
      });
    } catch (error) {
      toast({
        title: "Tax filing needs attention",
        description: error instanceof Error ? error.message : "Check the filing fields.",
        variant: "destructive",
      });
    }
  }

  function transitionFiling(filing: TaxFiling, action: "ready" | "file" | "accept" | "reject") {
    const body: Record<string, unknown> = {};
    if (action === "reject") {
      const notes = window.prompt("Rejection note", filing.notes ?? "");
      if (notes === null) return;
      body.notes = optionalString(notes);
    }
    if (action === "file") {
      const confirmationRef = window.prompt("Confirmation reference", filing.confirmationRef ?? "");
      if (confirmationRef === null) return;
      body.confirmationRef = optionalString(confirmationRef);
    }
    taxMutation.mutate({
      method: "POST",
      url: `${taxQueryPrefix}/filings/${filing.id}/${action}`,
      body,
      successTitle: `Tax filing ${action === "file" ? "filed" : action === "accept" ? "accepted" : action === "reject" ? "rejected" : "ready"}`,
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Tax data unavailable</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Registrations" value={overviewQuery.data?.activeRegistrationCount ?? 0} detail="Active" icon={Landmark} />
        <MetricCard title="Liabilities" value={formatTaxTotals(overviewQuery.data?.effectiveLiabilityTotalsByCurrency)} detail="Recognized and disputed" icon={Scale} />
        <MetricCard title="Liability due" value={(overviewQuery.data?.dueSoonLiabilityCount ?? 0) + (overviewQuery.data?.overdueLiabilityCount ?? 0)} detail={`${overviewQuery.data?.overdueLiabilityCount ?? 0} overdue`} icon={CalendarClock} />
        <MetricCard title="Filings due" value={(overviewQuery.data?.dueSoonFilingCount ?? 0) + (overviewQuery.data?.overdueFilingCount ?? 0)} detail={`${overviewQuery.data?.overdueFilingCount ?? 0} overdue`} icon={FileText} />
        <MetricCard title="Open issues" value={overviewQuery.data?.openAdjustmentOrDisputeCount ?? 0} detail="Disputes and adjustments" icon={AlertCircle} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Agencies
          </CardTitle>
          <Button size="sm" onClick={openCreateAgency} disabled={isMutating}>
            <Plus className="h-4 w-4" />
            Agency
          </Button>
        </CardHeader>
        <CardContent>
          <TaxAgenciesTable agencies={agencies} isLoading={isLoading} isMutating={isMutating} onEdit={openEditAgency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Registrations
          </CardTitle>
          <Button size="sm" onClick={openCreateRegistration} disabled={isMutating || legalEntities.length === 0 || agencies.length === 0}>
            <Plus className="h-4 w-4" />
            Registration
          </Button>
        </CardHeader>
        <CardContent>
          <TaxRegistrationsTable
            registrations={registrations}
            isLoading={isLoading}
            isMutating={isMutating}
            onEdit={openEditRegistration}
            onTransition={transitionRegistration}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Liabilities
          </CardTitle>
          <Button size="sm" onClick={openCreateLiability} disabled={isMutating || activeRegistrations.length === 0}>
            <Plus className="h-4 w-4" />
            Liability
          </Button>
        </CardHeader>
        <CardContent>
          <TaxLiabilitiesTable
            liabilities={liabilities}
            isLoading={isLoading}
            isMutating={isMutating}
            onEdit={openEditLiability}
            onCreateAdjustment={openCreateAdjustment}
            onTransition={transitionLiability}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Filings
          </CardTitle>
          <Button size="sm" onClick={openCreateFiling} disabled={isMutating || activeRegistrations.length === 0}>
            <Plus className="h-4 w-4" />
            Filing
          </Button>
        </CardHeader>
        <CardContent>
          <TaxFilingsTable
            filings={filings}
            isLoading={isLoading}
            isMutating={isMutating}
            onEdit={openEditFiling}
            onCreateAmendment={openCreateAmendment}
            onTransition={transitionFiling}
          />
        </CardContent>
      </Card>

      <TaxAgencyDialog
        state={agencyDialog}
        isPending={isMutating}
        onClose={() => setAgencyDialog(null)}
        onChange={(form) => setAgencyDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitAgency}
      />
      <TaxRegistrationDialog
        state={registrationDialog}
        legalEntities={legalEntities}
        agencies={agencies}
        isPending={isMutating}
        onClose={() => setRegistrationDialog(null)}
        onChange={(form) => setRegistrationDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitRegistration}
      />
      <TaxLiabilityDialog
        state={liabilityDialog}
        registrations={activeRegistrations}
        isPending={isMutating}
        onClose={() => setLiabilityDialog(null)}
        onChange={(form) => setLiabilityDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitLiability}
      />
      <TaxFilingDialog
        state={filingDialog}
        registrations={activeRegistrations}
        isPending={isMutating}
        onClose={() => setFilingDialog(null)}
        onChange={(form) => setFilingDialog((current) => current ? { ...current, form } : current)}
        onSubmit={submitFiling}
      />
    </div>
  );
}

function TaxAgenciesTable({
  agencies,
  isLoading,
  isMutating,
  onEdit,
}: {
  agencies: TaxAgency[];
  isLoading: boolean;
  isMutating: boolean;
  onEdit: (agency: TaxAgency) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Jurisdiction</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={5} label="Loading tax agencies..." />
        ) : agencies.length === 0 ? (
          <EmptyRow colSpan={5} label="No tax agencies." />
        ) : (
          agencies.map((agency) => (
            <TableRow key={agency.id}>
              <TableCell className="font-medium">{agency.agencyCode}</TableCell>
              <TableCell>{agency.name}</TableCell>
              <TableCell>{humanize(agency.jurisdictionType)} / {agency.jurisdictionCode}</TableCell>
              <TableCell>{statusBadge(agency.status)}</TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => onEdit(agency)} disabled={isMutating}>
                    <Edit3 className="h-4 w-4" />
                    Edit
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function TaxRegistrationsTable({
  registrations,
  isLoading,
  isMutating,
  onEdit,
  onTransition,
}: {
  registrations: TaxRegistration[];
  isLoading: boolean;
  isMutating: boolean;
  onEdit: (registration: TaxRegistration) => void;
  onTransition: (registration: TaxRegistration, action: "activate" | "deactivate" | "close") => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Entity</TableHead>
          <TableHead>Agency</TableHead>
          <TableHead>Tax type</TableHead>
          <TableHead>Effective</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={6} label="Loading registrations..." />
        ) : registrations.length === 0 ? (
          <EmptyRow colSpan={6} label="No registrations." />
        ) : (
          registrations.map((registration) => (
            <TableRow key={registration.id}>
              <TableCell className="font-medium">{registration.legalEntity?.legalName || `Entity #${registration.legalEntityId}`}</TableCell>
              <TableCell>{registration.taxAgency?.name || `Agency #${registration.taxAgencyId}`}</TableCell>
              <TableCell>
                <div>{humanize(registration.taxType)}</div>
                <div className="text-xs text-muted-foreground">{humanize(registration.jurisdictionType)} / {registration.jurisdictionCode}</div>
              </TableCell>
              <TableCell>
                <div>{formatDate(registration.effectiveFrom)} - {formatDate(registration.effectiveTo)}</div>
                <div className="text-xs text-muted-foreground">{humanize(registration.dateState)}</div>
              </TableCell>
              <TableCell>{statusBadge(registration.status)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(registration)} disabled={isMutating}>
                    <Edit3 className="h-4 w-4" />
                    Edit
                  </Button>
                  {registration.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(registration, "activate")} disabled={isMutating}>
                      <CheckCircle2 className="h-4 w-4" />
                      Activate
                    </Button>
                  )}
                  {registration.status === "active" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(registration, "deactivate")} disabled={isMutating}>
                      <RotateCcw className="h-4 w-4" />
                      Deactivate
                    </Button>
                  )}
                  {registration.status === "inactive" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(registration, "activate")} disabled={isMutating}>
                      <CheckCircle2 className="h-4 w-4" />
                      Activate
                    </Button>
                  )}
                  {registration.status !== "closed" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(registration, "close")} disabled={isMutating}>
                      <XCircle className="h-4 w-4" />
                      Close
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

function TaxLiabilitiesTable({
  liabilities,
  isLoading,
  isMutating,
  onEdit,
  onCreateAdjustment,
  onTransition,
}: {
  liabilities: TaxLiability[];
  isLoading: boolean;
  isMutating: boolean;
  onEdit: (liability: TaxLiability) => void;
  onCreateAdjustment: (liability: TaxLiability) => void;
  onTransition: (liability: TaxLiability, action: "recognize" | "dispute" | "void") => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Registration</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Component</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Effective</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={8} label="Loading liabilities..." />
        ) : liabilities.length === 0 ? (
          <EmptyRow colSpan={8} label="No liabilities." />
        ) : (
          liabilities.map((liability) => {
            const isAdjustment = Boolean(liability.adjustsTaxLiabilityId);
            return (
              <TableRow key={liability.id}>
                <TableCell>
                  <div className="font-medium">{liability.registration?.taxAgency?.agencyCode || `Registration #${liability.taxRegistrationId}`}</div>
                  <div className="text-xs text-muted-foreground">{liability.registration?.legalEntity?.legalName || "Legal entity"}</div>
                </TableCell>
                <TableCell>{formatDate(liability.periodStart)} - {formatDate(liability.periodEnd)}</TableCell>
                <TableCell>
                  <div>{formatDate(liability.dueDate)}</div>
                  <div className="text-xs text-muted-foreground">{humanize(liability.dueState)}</div>
                </TableCell>
                <TableCell>
                  <div>{humanize(liability.component)}</div>
                  {isAdjustment && <div className="text-xs text-muted-foreground">Adjusts #{liability.adjustsTaxLiabilityId}</div>}
                </TableCell>
                <TableCell className="text-right">{formatSignedMoney(liability.signedAmountCents, liability.currency)}</TableCell>
                <TableCell className="text-right">{formatMoney(liability.effectiveAmountCents, liability.currency)}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    {statusBadge(liability.status)}
                    <Badge variant="outline" className="border-muted bg-muted text-muted-foreground">
                      {humanize(liability.paymentTrackingStatus)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-2">
                    {liability.status === "draft" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onEdit(liability)} disabled={isMutating}>
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onTransition(liability, "recognize")} disabled={isMutating}>
                          <CheckCircle2 className="h-4 w-4" />
                          Recognize
                        </Button>
                      </>
                    )}
                    {["recognized", "disputed"].includes(liability.status) && !isAdjustment && (
                      <Button size="sm" variant="outline" onClick={() => onCreateAdjustment(liability)} disabled={isMutating}>
                        <Plus className="h-4 w-4" />
                        Adjustment
                      </Button>
                    )}
                    {liability.status === "recognized" && (
                      <Button size="sm" variant="outline" onClick={() => onTransition(liability, "dispute")} disabled={isMutating}>
                        <AlertCircle className="h-4 w-4" />
                        Dispute
                      </Button>
                    )}
                    {liability.status === "disputed" && (
                      <Button size="sm" variant="outline" onClick={() => onTransition(liability, "recognize")} disabled={isMutating}>
                        <CheckCircle2 className="h-4 w-4" />
                        Recognize
                      </Button>
                    )}
                    {liability.status !== "voided" && (
                      <Button size="sm" variant="outline" onClick={() => onTransition(liability, "void")} disabled={isMutating}>
                        <XCircle className="h-4 w-4" />
                        Void
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

function TaxFilingsTable({
  filings,
  isLoading,
  isMutating,
  onEdit,
  onCreateAmendment,
  onTransition,
}: {
  filings: TaxFiling[];
  isLoading: boolean;
  isMutating: boolean;
  onEdit: (filing: TaxFiling) => void;
  onCreateAmendment: (filing: TaxFiling) => void;
  onTransition: (filing: TaxFiling, action: "ready" | "file" | "accept" | "reject") => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Registration</TableHead>
          <TableHead>Filing</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <EmptyRow colSpan={6} label="Loading filings..." />
        ) : filings.length === 0 ? (
          <EmptyRow colSpan={6} label="No filings." />
        ) : (
          filings.map((filing) => (
            <TableRow key={filing.id}>
              <TableCell>
                <div className="font-medium">{filing.registration?.taxAgency?.agencyCode || `Registration #${filing.taxRegistrationId}`}</div>
                <div className="text-xs text-muted-foreground">{filing.registration?.legalEntity?.legalName || "Legal entity"}</div>
              </TableCell>
              <TableCell>
                <div>{filing.filingType}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(filing.periodStart)} - {formatDate(filing.periodEnd)}
                  {filing.amendsTaxFilingId ? ` / amends #${filing.amendsTaxFilingId}` : ""}
                </div>
              </TableCell>
              <TableCell>
                <div>{formatDate(filing.dueDate)}</div>
                <div className="text-xs text-muted-foreground">{humanize(filing.dueState)}</div>
              </TableCell>
              <TableCell>
                <div>{formatDate(filing.filedAt)}</div>
                <div className="text-xs text-muted-foreground">{filing.confirmationRef || "-"}</div>
              </TableCell>
              <TableCell>{statusBadge(filing.status)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  {filing.status === "draft" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onEdit(filing)} disabled={isMutating}>
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onTransition(filing, "ready")} disabled={isMutating}>
                        <CheckCircle2 className="h-4 w-4" />
                        Ready
                      </Button>
                    </>
                  )}
                  {filing.status === "ready" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(filing, "file")} disabled={isMutating}>
                      <FileText className="h-4 w-4" />
                      File
                    </Button>
                  )}
                  {filing.status === "filed" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onTransition(filing, "accept")} disabled={isMutating}>
                        <CheckCircle2 className="h-4 w-4" />
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onTransition(filing, "reject")} disabled={isMutating}>
                        <AlertCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  )}
                  {filing.status === "rejected" && (
                    <Button size="sm" variant="outline" onClick={() => onTransition(filing, "ready")} disabled={isMutating}>
                      <RotateCcw className="h-4 w-4" />
                      Ready
                    </Button>
                  )}
                  {["filed", "accepted"].includes(filing.status) && (
                    <Button size="sm" variant="outline" onClick={() => onCreateAmendment(filing)} disabled={isMutating}>
                      <Plus className="h-4 w-4" />
                      Amendment
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

function TaxAgencyDialog({
  state,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: TaxAgencyDialogState | null;
  isPending: boolean;
  onClose: () => void;
  onChange: (form: TaxAgencyFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof TaxAgencyFormState>(key: K, value: TaxAgencyFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state.mode === "create" ? "Add Tax Agency" : "Edit Tax Agency"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Code">
              <Input value={form.agencyCode} onChange={(event) => update("agencyCode", event.target.value.toUpperCase())} required maxLength={80} />
            </FormField>
            <FormField label="Name">
              <Input value={form.name} onChange={(event) => update("name", event.target.value)} required maxLength={200} />
            </FormField>
            <FormField label="Jurisdiction type">
              <Select value={form.jurisdictionType} onValueChange={(value) => update("jurisdictionType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxJurisdictionTypes.map((type) => (
                    <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Jurisdiction code">
              <Input value={form.jurisdictionCode} onChange={(event) => update("jurisdictionCode", event.target.value.toUpperCase())} required maxLength={80} />
            </FormField>
            <FormField label="Status">
              <Select value={form.status} onValueChange={(value) => update("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxAgencyStatuses.map((status) => (
                    <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

function TaxRegistrationDialog({
  state,
  legalEntities,
  agencies,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: TaxRegistrationDialogState | null;
  legalEntities: TaxLegalEntity[];
  agencies: TaxAgency[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: TaxRegistrationFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const update = <K extends keyof TaxRegistrationFormState>(key: K, value: TaxRegistrationFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state.mode === "create" ? "Add Tax Registration" : "Edit Tax Registration"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Legal entity">
              <Select value={form.legalEntityId} onValueChange={(value) => update("legalEntityId", value)}>
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
            <FormField label="Tax agency">
              <Select value={form.taxAgencyId} onValueChange={(value) => update("taxAgencyId", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agency" />
                </SelectTrigger>
                <SelectContent>
                  {agencies.map((agency) => (
                    <SelectItem key={agency.id} value={String(agency.id)}>{agency.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Tax type">
              <Select value={form.taxType} onValueChange={(value) => update("taxType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxTypes.map((type) => (
                    <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Jurisdiction type">
              <Select value={form.jurisdictionType} onValueChange={(value) => update("jurisdictionType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxJurisdictionTypes.map((type) => (
                    <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Jurisdiction code">
              <Input value={form.jurisdictionCode} onChange={(event) => update("jurisdictionCode", event.target.value.toUpperCase())} required maxLength={80} />
            </FormField>
            <FormField label="Account ref">
              <Input value={form.maskedAccountRef} onChange={(event) => update("maskedAccountRef", event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Effective from">
              <Input type="date" value={form.effectiveFrom} onChange={(event) => update("effectiveFrom", event.target.value)} />
            </FormField>
            <FormField label="Effective to">
              <Input type="date" value={form.effectiveTo} onChange={(event) => update("effectiveTo", event.target.value)} />
            </FormField>
            {state.mode === "create" && (
              <FormField label="Initial status">
                <Select value={form.status} onValueChange={(value) => update("status", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taxRegistrationStatuses.map((status) => (
                      <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} maxLength={4000} />
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

function TaxLiabilityDialog({
  state,
  registrations,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: TaxLiabilityDialogState | null;
  registrations: TaxRegistration[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: TaxLiabilityFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const adjustment = state.mode === "adjustment";
  const update = <K extends keyof TaxLiabilityFormState>(key: K, value: TaxLiabilityFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{adjustment ? "Add Tax Adjustment" : state.mode === "edit" ? "Edit Tax Liability" : "Add Tax Liability"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            {!adjustment && (
              <FormField label="Registration">
                <Select value={form.taxRegistrationId} onValueChange={(value) => update("taxRegistrationId", value)} disabled={state.mode === "edit"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select registration" />
                  </SelectTrigger>
                  <SelectContent>
                    {registrations.map((registration) => (
                      <SelectItem key={registration.id} value={String(registration.id)}>
                        {registration.taxAgency?.agencyCode || `Registration #${registration.id}`} - {humanize(registration.taxType)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Component">
              <Select value={form.component} onValueChange={(value) => update("component", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxLiabilityComponents.map((component) => (
                    <SelectItem key={component} value={component}>{humanize(component)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Effect">
              <Select value={form.amountEffect} onValueChange={(value) => update("amountEffect", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxAmountEffects.map((effect) => (
                    <SelectItem key={effect} value={effect}>{humanize(effect)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Amount">
              <Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="0.00" required />
            </FormField>
            <FormField label="Currency">
              <Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} required />
            </FormField>
            <FormField label="Period start">
              <Input type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} required />
            </FormField>
            <FormField label="Period end">
              <Input type="date" value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} required />
            </FormField>
            <FormField label="Due date">
              <Input type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
            </FormField>
            <FormField label="Source">
              <Select value={form.sourceType} onValueChange={(value) => update("sourceType", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taxSourceTypes.map((source) => (
                    <SelectItem key={source} value={source}>{humanize(source)}</SelectItem>
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
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaxFilingDialog({
  state,
  registrations,
  isPending,
  onClose,
  onChange,
  onSubmit,
}: {
  state: TaxFilingDialogState | null;
  registrations: TaxRegistration[];
  isPending: boolean;
  onClose: () => void;
  onChange: (form: TaxFilingFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!state) return null;
  const form = state.form;
  const amendment = state.mode === "amendment";
  const update = <K extends keyof TaxFilingFormState>(key: K, value: TaxFilingFormState[K]) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{amendment ? "Add Tax Amendment" : state.mode === "edit" ? "Edit Tax Filing" : "Add Tax Filing"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            {!amendment && (
              <FormField label="Registration">
                <Select value={form.taxRegistrationId} onValueChange={(value) => update("taxRegistrationId", value)} disabled={state.mode === "edit"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select registration" />
                  </SelectTrigger>
                  <SelectContent>
                    {registrations.map((registration) => (
                      <SelectItem key={registration.id} value={String(registration.id)}>
                        {registration.taxAgency?.agencyCode || `Registration #${registration.id}`} - {humanize(registration.taxType)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {!amendment && (
              <FormField label="Filing type">
                <Input value={form.filingType} onChange={(event) => update("filingType", event.target.value)} required maxLength={120} />
              </FormField>
            )}
            {!amendment && (
              <>
                <FormField label="Period start">
                  <Input type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} required />
                </FormField>
                <FormField label="Period end">
                  <Input type="date" value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} required />
                </FormField>
              </>
            )}
            <FormField label="Due date">
              <Input type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
            </FormField>
          </div>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} maxLength={4000} />
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

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}

function emptyAgencyForm(): TaxAgencyFormState {
  return {
    agencyCode: "",
    name: "",
    jurisdictionType: "federal",
    jurisdictionCode: "US",
    status: "active",
  };
}

function agencyFormFromRecord(agency: TaxAgency): TaxAgencyFormState {
  return {
    agencyCode: agency.agencyCode,
    name: agency.name,
    jurisdictionType: agency.jurisdictionType,
    jurisdictionCode: agency.jurisdictionCode,
    status: agency.status,
  };
}

function emptyRegistrationForm(entity?: TaxLegalEntity, agency?: TaxAgency): TaxRegistrationFormState {
  return {
    legalEntityId: entity ? String(entity.id) : "",
    taxAgencyId: agency ? String(agency.id) : "",
    taxType: "federal_withholding",
    jurisdictionType: agency?.jurisdictionType ?? "federal",
    jurisdictionCode: agency?.jurisdictionCode ?? "US",
    maskedAccountRef: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "pending",
    notes: "",
  };
}

function registrationFormFromRecord(registration: TaxRegistration): TaxRegistrationFormState {
  return {
    legalEntityId: String(registration.legalEntityId),
    taxAgencyId: String(registration.taxAgencyId),
    taxType: registration.taxType,
    jurisdictionType: registration.jurisdictionType,
    jurisdictionCode: registration.jurisdictionCode,
    maskedAccountRef: registration.maskedAccountRef ?? "",
    effectiveFrom: dateForInput(registration.effectiveFrom),
    effectiveTo: dateForInput(registration.effectiveTo),
    status: registration.status,
    notes: registration.notes ?? "",
  };
}

function emptyLiabilityForm(registration?: TaxRegistration): TaxLiabilityFormState {
  return {
    taxRegistrationId: registration ? String(registration.id) : "",
    periodStart: "",
    periodEnd: "",
    dueDate: "",
    component: "withholding",
    amountEffect: "increase",
    amount: "",
    currency: "USD",
    sourceType: "manual",
    notes: "",
  };
}

function liabilityFormFromRecord(liability: TaxLiability): TaxLiabilityFormState {
  return {
    taxRegistrationId: String(liability.taxRegistrationId),
    periodStart: dateForInput(liability.periodStart),
    periodEnd: dateForInput(liability.periodEnd),
    dueDate: dateForInput(liability.dueDate),
    component: liability.component,
    amountEffect: liability.amountEffect,
    amount: formatCentsForInput(liability.amountCents),
    currency: liability.currency,
    sourceType: liability.sourceType,
    notes: liability.notes ?? "",
  };
}

function emptyLiabilityAdjustmentForm(liability: TaxLiability): TaxLiabilityFormState {
  return {
    taxRegistrationId: String(liability.taxRegistrationId),
    periodStart: dateForInput(liability.periodStart),
    periodEnd: dateForInput(liability.periodEnd),
    dueDate: dateForInput(liability.dueDate),
    component: "adjustment",
    amountEffect: "decrease",
    amount: "",
    currency: liability.currency,
    sourceType: "manual",
    notes: "",
  };
}

function emptyFilingForm(registration?: TaxRegistration): TaxFilingFormState {
  return {
    taxRegistrationId: registration ? String(registration.id) : "",
    filingType: "",
    periodStart: "",
    periodEnd: "",
    dueDate: "",
    notes: "",
  };
}

function filingFormFromRecord(filing: TaxFiling): TaxFilingFormState {
  return {
    taxRegistrationId: String(filing.taxRegistrationId),
    filingType: filing.filingType,
    periodStart: dateForInput(filing.periodStart),
    periodEnd: dateForInput(filing.periodEnd),
    dueDate: dateForInput(filing.dueDate),
    notes: filing.notes ?? "",
  };
}

function emptyFilingAmendmentForm(filing: TaxFiling): TaxFilingFormState {
  return {
    taxRegistrationId: String(filing.taxRegistrationId),
    filingType: filing.filingType,
    periodStart: dateForInput(filing.periodStart),
    periodEnd: dateForInput(filing.periodEnd),
    dueDate: dateForInput(filing.dueDate),
    notes: "",
  };
}

function registrationPayload(state: TaxRegistrationDialogState) {
  const form = state.form;
  const common = compactPayload({
    legalEntityId: parsePositiveId(form.legalEntityId, "Legal entity"),
    taxAgencyId: parsePositiveId(form.taxAgencyId, "Tax agency"),
    taxType: form.taxType,
    jurisdictionType: form.jurisdictionType,
    jurisdictionCode: form.jurisdictionCode.trim().toUpperCase(),
    maskedAccountRef: optionalString(form.maskedAccountRef),
    effectiveFrom: dateOrNull(form.effectiveFrom),
    effectiveTo: dateOrNull(form.effectiveTo),
    notes: optionalString(form.notes),
  });

  return state.mode === "create"
    ? { ...common, status: form.status }
    : common;
}

function liabilityPayload(state: TaxLiabilityDialogState) {
  const form = state.form;
  const common = compactPayload({
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    dueDate: dateOrNull(form.dueDate),
    component: form.component,
    amountEffect: form.amountEffect,
    amountCents: parseMoneyToCents(form.amount),
    currency: form.currency.trim().toUpperCase(),
    sourceType: form.sourceType,
    sourceMetadata: {},
    notes: optionalString(form.notes),
  });

  return state.mode === "adjustment"
    ? common
    : {
        ...common,
        taxRegistrationId: parsePositiveId(form.taxRegistrationId, "Tax registration"),
      };
}

function filingPayload(state: TaxFilingDialogState) {
  const form = state.form;
  if (state.mode === "amendment") {
    return compactPayload({
      dueDate: dateOrNull(form.dueDate),
      notes: optionalString(form.notes),
    });
  }

  return compactPayload({
    taxRegistrationId: parsePositiveId(form.taxRegistrationId, "Tax registration"),
    filingType: form.filingType.trim(),
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    dueDate: dateOrNull(form.dueDate),
    notes: optionalString(form.notes),
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

async function invalidateTaxQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(taxQueryPrefix);
    },
  });
}

function formatMoney(value?: number | null, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function formatSignedMoney(value?: number | null, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  return `${sign}${formatMoney(Math.abs(value), currency)}`;
}

function formatTaxTotals(values?: TaxCurrencyTotal[]) {
  if (!values || values.length === 0) return formatMoney(0);
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
    ["active", "accepted", "recognized", "ready", "filed"].includes(status)
      ? "border-green-500/20 bg-green-500/10 text-green-700"
      : ["pending", "draft", "not_due"].includes(status)
        ? "border-blue-500/20 bg-blue-500/10 text-blue-700"
        : ["disputed", "rejected", "due_soon", "inactive", "not_yet_tracked"].includes(status)
          ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-700"
          : ["voided", "closed", "overdue"].includes(status)
            ? "border-red-500/20 bg-red-500/10 text-red-700"
            : "border-muted bg-muted text-muted-foreground";

  return (
    <Badge variant="outline" className={className}>
      {humanize(status)}
    </Badge>
  );
}
