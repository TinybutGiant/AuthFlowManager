import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BriefcaseBusiness, CircleDollarSign, Plus, UserRound, Users } from "lucide-react";

type WorkerLifecycleState = "normal" | "archived" | "merged" | "voided";
type EmploymentStatus = "draft" | "active" | "on_leave" | "ended" | "voided";
type PayrollParticipation = "not_enrolled" | "eligible" | "active" | "inactive";
type EmployeeClassification = "employee" | "paid_intern" | "other_employee";
type CompensationStatus = "draft" | "active" | "superseded" | "voided";
type CompensationPayBasis = "hourly" | "salary" | "stipend" | "other";

interface AdminSummary {
  id: number;
  name: string;
  email: string;
  role: string;
  accountType: string;
  status: string;
}

interface LegalEntitySummary {
  id: number;
  legalName: string;
  entityType: string;
  status: string;
}

interface CompensationTerm {
  id: number;
  employmentId: number;
  payBasis: CompensationPayBasis;
  amountCents: number;
  currency: string;
  payFrequency: string;
  expectedHoursPerWeek: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: CompensationStatus;
  notes: string | null;
}

interface Employment {
  id: number;
  workerId: number;
  legalEntityId: number;
  legalEntity: LegalEntitySummary | null;
  employeeClassification: EmployeeClassification;
  payrollParticipation: PayrollParticipation;
  status: EmploymentStatus;
  startDate: string;
  endDate: string | null;
  workLocation: string | null;
  primaryWorkState: string | null;
  primaryWorkJurisdiction: string | null;
  currentCompensation: CompensationTerm | null;
}

interface Worker {
  id: number;
  adminUserId: number | null;
  workerCode: string;
  legalName: string;
  preferredName: string | null;
  personnelEmail: string | null;
  lifecycleState: WorkerLifecycleState;
  adminUser: AdminSummary | null;
  currentEmployment: Employment | null;
  employments?: Employment[];
}

interface WorkerFormState {
  adminUserId: string;
  workerCode: string;
  legalName: string;
  preferredName: string;
  personnelEmail: string;
}

interface EmploymentFormState {
  workerId: string;
  legalEntityId: string;
  employeeClassification: EmployeeClassification;
  payrollParticipation: PayrollParticipation;
  startDate: string;
  endDate: string;
  workLocation: string;
  primaryWorkState: string;
  primaryWorkJurisdiction: string;
}

interface CompensationFormState {
  employmentId: string;
  payBasis: CompensationPayBasis;
  amountCents: string;
  currency: string;
  payFrequency: string;
  expectedHoursPerWeek: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "draft" | "active";
  supersedeCurrent: boolean;
  notes: string;
}

const initialWorkerForm: WorkerFormState = {
  adminUserId: "none",
  workerCode: "",
  legalName: "",
  preferredName: "",
  personnelEmail: "",
};

const initialEmploymentForm: EmploymentFormState = {
  workerId: "",
  legalEntityId: "",
  employeeClassification: "employee",
  payrollParticipation: "not_enrolled",
  startDate: "",
  endDate: "",
  workLocation: "",
  primaryWorkState: "",
  primaryWorkJurisdiction: "",
};

const initialCompensationForm: CompensationFormState = {
  employmentId: "",
  payBasis: "hourly",
  amountCents: "",
  currency: "USD",
  payFrequency: "hourly",
  expectedHoursPerWeek: "",
  effectiveFrom: "",
  effectiveTo: "",
  status: "draft",
  supersedeCurrent: false,
  notes: "",
};

function cents(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(value / 100);
}

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
}

function statusBadge(status: string) {
  const variant = ["active", "normal"].includes(status)
    ? "default"
    : ["ended", "voided", "archived", "reversed"].includes(status)
      ? "destructive"
      : "secondary";
  return <Badge variant={variant as "default" | "secondary" | "destructive"}>{label(status)}</Badge>;
}

function roleLabel(admin: AdminSummary | null) {
  if (!admin) return "No admin login";
  return `${label(admin.accountType)} / ${label(admin.role)}`;
}

function workerPayload(form: WorkerFormState) {
  return {
    adminUserId: form.adminUserId === "none" ? null : Number(form.adminUserId),
    workerCode: form.workerCode.trim(),
    legalName: form.legalName.trim(),
    preferredName: form.preferredName.trim() || null,
    personnelEmail: form.personnelEmail.trim() || null,
  };
}

function employmentPayload(form: EmploymentFormState) {
  return {
    workerId: Number(form.workerId),
    legalEntityId: Number(form.legalEntityId),
    employeeClassification: form.employeeClassification,
    payrollParticipation: form.payrollParticipation,
    startDate: form.startDate,
    endDate: form.endDate || null,
    workLocation: form.workLocation || null,
    primaryWorkState: form.primaryWorkState || null,
    primaryWorkJurisdiction: form.primaryWorkJurisdiction || null,
  };
}

function compensationPayload(form: CompensationFormState) {
  return {
    employmentId: Number(form.employmentId),
    payBasis: form.payBasis,
    amountCents: Number(form.amountCents),
    currency: form.currency,
    payFrequency: form.payFrequency,
    expectedHoursPerWeek: form.expectedHoursPerWeek ? Number(form.expectedHoursPerWeek) : null,
    effectiveFrom: form.effectiveFrom,
    effectiveTo: form.effectiveTo || null,
    status: form.status,
    supersedeCurrent: form.supersedeCurrent,
    notes: form.notes || null,
  };
}

export default function PersonnelManagement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location] = useLocation();
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [selectedEmploymentId, setSelectedEmploymentId] = useState<number | null>(null);
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [employmentDialogOpen, setEmploymentDialogOpen] = useState(false);
  const [compensationDialogOpen, setCompensationDialogOpen] = useState(false);
  const [endingEmployment, setEndingEmployment] = useState<Employment | null>(null);
  const [endDate, setEndDate] = useState("");
  const [workerForm, setWorkerForm] = useState<WorkerFormState>(initialWorkerForm);
  const [employmentForm, setEmploymentForm] = useState<EmploymentFormState>(initialEmploymentForm);
  const [compensationForm, setCompensationForm] = useState<CompensationFormState>(initialCompensationForm);

  const workersQuery = useQuery<Worker[]>({
    queryKey: ["/api/admin/personnel/workers"],
    retry: false,
  });

  const adminsQuery = useQuery<AdminSummary[]>({
    queryKey: ["/api/admin/personnel/admin-users"],
    retry: false,
  });

  const legalEntitiesQuery = useQuery<LegalEntitySummary[]>({
    queryKey: ["/api/admin/personnel/legal-entities"],
    retry: false,
  });

  const workerDetailQuery = useQuery<Worker>({
    queryKey: ["/api/admin/personnel/workers", selectedWorkerId],
    enabled: Boolean(selectedWorkerId),
    retry: false,
  });

  const compensationQuery = useQuery<CompensationTerm[]>({
    queryKey: ["/api/admin/personnel/employments", selectedEmploymentId, "compensation"],
    enabled: Boolean(selectedEmploymentId),
    retry: false,
  });

  const workers = workersQuery.data ?? [];
  const admins = adminsQuery.data ?? [];
  const legalEntities = legalEntitiesQuery.data ?? [];
  const selectedWorker = workerDetailQuery.data ?? workers.find((worker) => worker.id === selectedWorkerId) ?? null;
  const employments = selectedWorker?.employments ?? [];
  const selectedEmployment = employments.find((employment) => employment.id === selectedEmploymentId) ?? employments[0] ?? null;
  const compensationTerms = compensationQuery.data ?? [];
  const requestedAdminUserId = useMemo(() => {
    const [, query = ""] = location.split("?");
    const value = new URLSearchParams(query).get("adminUserId");
    return value ? Number(value) : null;
  }, [location]);

  useEffect(() => {
    if (requestedAdminUserId && workers.length > 0) {
      const linkedWorker = workers.find((worker) => worker.adminUserId === requestedAdminUserId);
      if (linkedWorker && selectedWorkerId !== linkedWorker.id) {
        setSelectedWorkerId(linkedWorker.id);
        setSelectedEmploymentId(linkedWorker.currentEmployment?.id ?? null);
        return;
      }
    }
    if (!selectedWorkerId && workers.length > 0) {
      setSelectedWorkerId(workers[0].id);
    }
  }, [requestedAdminUserId, selectedWorkerId, workers]);

  useEffect(() => {
    if (selectedEmployment && selectedEmployment.id !== selectedEmploymentId) {
      setSelectedEmploymentId(selectedEmployment.id);
    }
  }, [selectedEmployment, selectedEmploymentId]);

  const invalidatePersonnel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/personnel/workers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/personnel/workers", selectedWorkerId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/personnel/employments", selectedEmploymentId, "compensation"] });
  };

  const createWorkerMutation = useMutation({
    mutationFn: async () => {
      const payload = workerPayload(workerForm);
      const useAdminSeed = payload.adminUserId && !payload.legalName;
      const response = await apiRequest(
        "POST",
        useAdminSeed ? "/api/admin/personnel/workers/from-admin-user" : "/api/admin/personnel/workers",
        useAdminSeed
          ? {
              adminUserId: payload.adminUserId,
              workerCode: payload.workerCode,
              preferredName: payload.preferredName,
              personnelEmail: payload.personnelEmail,
            }
          : payload,
      );
      return response.json() as Promise<Worker>;
    },
    onSuccess: (worker) => {
      invalidatePersonnel();
      setSelectedWorkerId(worker.id);
      setWorkerDialogOpen(false);
      setWorkerForm(initialWorkerForm);
      toast({ title: "Worker saved", description: "The personnel record has been created." });
    },
    onError: (error) => {
      toast({
        title: "Could not save worker",
        description: getApiErrorMessage(error, "Please check the worker fields and try again."),
        variant: "destructive",
      });
    },
  });

  const createEmploymentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/personnel/employments", employmentPayload(employmentForm));
      return response.json() as Promise<Employment>;
    },
    onSuccess: (employment) => {
      invalidatePersonnel();
      setSelectedEmploymentId(employment.id);
      setEmploymentDialogOpen(false);
      setEmploymentForm(initialEmploymentForm);
      toast({ title: "Employment saved", description: "The employment record has been created as draft." });
    },
    onError: (error) => {
      toast({
        title: "Could not save employment",
        description: getApiErrorMessage(error, "Please check the employment fields and try again."),
        variant: "destructive",
      });
    },
  });

  const transitionEmploymentMutation = useMutation({
    mutationFn: async (input: { employment: Employment; action: "activate" | "place-on-leave" | "return" | "void" | "end"; endDate?: string }) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/personnel/employments/${input.employment.id}/${input.action}`,
        input.action === "end" ? { endDate: input.endDate } : undefined,
      );
      return response.json() as Promise<Employment>;
    },
    onSuccess: () => {
      invalidatePersonnel();
      setEndingEmployment(null);
      setEndDate("");
      toast({ title: "Employment updated", description: "The employment lifecycle has been updated." });
    },
    onError: (error) => {
      toast({
        title: "Could not update employment",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const createCompensationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/admin/personnel/compensation-terms",
        compensationPayload(compensationForm),
      );
      return response.json() as Promise<CompensationTerm>;
    },
    onSuccess: () => {
      invalidatePersonnel();
      setCompensationDialogOpen(false);
      setCompensationForm(initialCompensationForm);
      toast({ title: "Compensation saved", description: "The effective-dated compensation term has been recorded." });
    },
    onError: (error) => {
      toast({
        title: "Could not save compensation",
        description: getApiErrorMessage(error, "Please check the compensation fields and try again."),
        variant: "destructive",
      });
    },
  });

  const openWorkerDialog = () => {
    setWorkerForm(initialWorkerForm);
    setWorkerDialogOpen(true);
  };

  const openEmploymentDialog = () => {
    if (!selectedWorker) return;
    setEmploymentForm({
      ...initialEmploymentForm,
      workerId: String(selectedWorker.id),
      legalEntityId: legalEntities[0] ? String(legalEntities[0].id) : "",
    });
    setEmploymentDialogOpen(true);
  };

  const openCompensationDialog = () => {
    const employment = selectedEmployment;
    if (!employment) return;
    setCompensationForm({
      ...initialCompensationForm,
      employmentId: String(employment.id),
      effectiveFrom: employment.startDate?.slice(0, 10) ?? "",
    });
    setCompensationDialogOpen(true);
  };

  const currentCounts = useMemo(() => {
    const active = workers.filter((worker) => ["active", "on_leave"].includes(worker.currentEmployment?.status ?? "")).length;
    const payrollActive = workers.filter((worker) => worker.currentEmployment?.payrollParticipation === "active").length;
    const unlinked = workers.filter((worker) => !worker.adminUserId).length;
    return { active, payrollActive, unlinked };
  }, [workers]);

  if (workersQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-light text-foreground mb-2">Personnel</h1>
          <p className="text-muted-foreground">Loading personnel records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-personnel-title">Personnel</h1>
          <p className="text-muted-foreground">
            Manage worker records, employment relationships, and compensation history.
          </p>
        </div>
        <Button onClick={openWorkerDialog} data-testid="button-create-worker">
          <Plus className="mr-2 h-4 w-4" />
          New Worker
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric label="Active employment" value={currentCounts.active} icon={<BriefcaseBusiness className="h-4 w-4" />} />
        <Metric label="Payroll active" value={currentCounts.payrollActive} icon={<CircleDollarSign className="h-4 w-4" />} />
        <Metric label="No admin login" value={currentCounts.unlinked} icon={<UserRound className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              Workers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workers have been created yet.</p>
            ) : (
              workers.map((worker) => (
                <button
                  key={worker.id}
                  type="button"
                  onClick={() => {
                    setSelectedWorkerId(worker.id);
                    setSelectedEmploymentId(worker.currentEmployment?.id ?? null);
                  }}
                  className={`w-full rounded-md border p-3 text-left transition hover:bg-accent/50 ${
                    selectedWorkerId === worker.id ? "border-primary bg-accent/40" : "border-border"
                  }`}
                  data-testid={`button-worker-${worker.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{worker.legalName}</p>
                      <p className="text-sm text-muted-foreground">{worker.workerCode}</p>
                    </div>
                    {statusBadge(worker.lifecycleState)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{roleLabel(worker.adminUser)}</span>
                    <span>{label(worker.currentEmployment?.status ?? "not employed")}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!selectedWorker ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Select a worker or create a new personnel record.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{selectedWorker.legalName}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {selectedWorker.workerCode} / {roleLabel(selectedWorker.adminUser)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {statusBadge(selectedWorker.lifecycleState)}
                      {selectedWorker.currentEmployment
                        ? statusBadge(selectedWorker.currentEmployment.status)
                        : <Badge variant="outline">Not employed</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field label="System identity" value={selectedWorker.adminUser?.name ?? "No admin login"} />
                  <Field label="Personnel email" value={selectedWorker.personnelEmail ?? selectedWorker.adminUser?.email ?? "Not set"} />
                  <Field label="Payroll participation" value={label(selectedWorker.currentEmployment?.payrollParticipation ?? "not enrolled")} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="text-lg">Employment</CardTitle>
                    <Button onClick={openEmploymentDialog} data-testid="button-create-employment">
                      <Plus className="mr-2 h-4 w-4" />
                      New Employment
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {employments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">This worker has no employment records.</p>
                  ) : (
                    employments.map((employment) => (
                      <div
                        key={employment.id}
                        className={`rounded-md border p-4 ${selectedEmploymentId === employment.id ? "border-primary" : "border-border"}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelectedEmploymentId(employment.id)}
                            data-testid={`button-employment-${employment.id}`}
                          >
                            <p className="font-medium">{employment.legalEntity?.legalName ?? `Legal Entity ${employment.legalEntityId}`}</p>
                            <p className="text-sm text-muted-foreground">
                              {employment.startDate?.slice(0, 10)} to {employment.endDate?.slice(0, 10) ?? "current"}
                            </p>
                          </button>
                          <div className="flex flex-wrap gap-2">
                            {statusBadge(employment.status)}
                            <Badge variant="outline">{label(employment.payrollParticipation)}</Badge>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                          <Field label="Classification" value={label(employment.employeeClassification)} />
                          <Field label="Location" value={employment.workLocation ?? "Not set"} />
                          <Field label="Work state" value={employment.primaryWorkState ?? "Not set"} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {employment.status === "draft" && (
                            <>
                              <Button size="sm" onClick={() => transitionEmploymentMutation.mutate({ employment, action: "activate" })}>
                                Activate
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => transitionEmploymentMutation.mutate({ employment, action: "void" })}>
                                Void
                              </Button>
                            </>
                          )}
                          {employment.status === "active" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => transitionEmploymentMutation.mutate({ employment, action: "place-on-leave" })}>
                                Place on leave
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => {
                                setEndingEmployment(employment);
                                setEndDate(new Date().toISOString().slice(0, 10));
                              }}>
                                End
                              </Button>
                            </>
                          )}
                          {employment.status === "on_leave" && (
                            <>
                              <Button size="sm" onClick={() => transitionEmploymentMutation.mutate({ employment, action: "return" })}>
                                Return
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => {
                                setEndingEmployment(employment);
                                setEndDate(new Date().toISOString().slice(0, 10));
                              }}>
                                End
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="text-lg">Compensation</CardTitle>
                    <Button onClick={openCompensationDialog} disabled={!selectedEmployment} data-testid="button-create-compensation">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Term
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selectedEmployment ? (
                    <p className="text-sm text-muted-foreground">Select or create an employment record first.</p>
                  ) : compensationTerms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No compensation terms recorded for this employment.</p>
                  ) : (
                    compensationTerms.map((term) => (
                      <div key={term.id} className="rounded-md border border-border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              {cents(term.amountCents, term.currency)} / {label(term.payFrequency)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {label(term.payBasis)} / {term.effectiveFrom?.slice(0, 10)} through {term.effectiveTo?.slice(0, 10) ?? "current"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {statusBadge(term.status)}
                            {term.expectedHoursPerWeek && <Badge variant="outline">{term.expectedHoursPerWeek} hrs/wk</Badge>}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <WorkerDialog
        open={workerDialogOpen}
        admins={admins}
        form={workerForm}
        setForm={setWorkerForm}
        onClose={() => setWorkerDialogOpen(false)}
        onSubmit={() => createWorkerMutation.mutate()}
        pending={createWorkerMutation.isPending}
      />

      <EmploymentDialog
        open={employmentDialogOpen}
        legalEntities={legalEntities}
        form={employmentForm}
        setForm={setEmploymentForm}
        onClose={() => setEmploymentDialogOpen(false)}
        onSubmit={() => createEmploymentMutation.mutate()}
        pending={createEmploymentMutation.isPending}
      />

      <CompensationDialog
        open={compensationDialogOpen}
        form={compensationForm}
        setForm={setCompensationForm}
        onClose={() => setCompensationDialogOpen(false)}
        onSubmit={() => createCompensationMutation.mutate()}
        pending={createCompensationMutation.isPending}
      />

      <Dialog open={Boolean(endingEmployment)} onOpenChange={(open) => !open && setEndingEmployment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>End Employment</DialogTitle>
            <DialogDescription>Ending employment preserves the worker and admin identity records.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!endingEmployment) return;
              transitionEmploymentMutation.mutate({
                employment: endingEmployment,
                action: "end",
                endDate,
              });
            }}
          >
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEndingEmployment(null)}>Cancel</Button>
              <Button type="submit" disabled={transitionEmploymentMutation.isPending}>End Employment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label: text, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{text}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label: text, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{text}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium">{children}</div>;
}

function WorkerDialog({
  open,
  admins,
  form,
  setForm,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean;
  admins: AdminSummary[];
  form: WorkerFormState;
  setForm: (value: WorkerFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Worker</DialogTitle>
          <DialogDescription>Create a personnel record. Linking an admin login is optional.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Admin Login</Label>
              <Select value={form.adminUserId} onValueChange={(value) => setForm({ ...form, adminUserId: value })}>
                <SelectTrigger data-testid="select-worker-admin-user">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No admin login</SelectItem>
                  {admins.map((admin) => (
                    <SelectItem key={admin.id} value={String(admin.id)}>
                      {admin.name} · {label(admin.accountType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Worker Code</Label>
              <Input required value={form.workerCode} onChange={(event) => setForm({ ...form, workerCode: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Legal Name</Label>
              <Input
                required={form.adminUserId === "none"}
                value={form.legalName}
                placeholder={form.adminUserId === "none" ? "" : "Use admin name if blank"}
                onChange={(event) => setForm({ ...form, legalName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Preferred Name</Label>
              <Input value={form.preferredName} onChange={(event) => setForm({ ...form, preferredName: event.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Personnel Email</Label>
              <Input
                type="email"
                value={form.personnelEmail}
                placeholder={form.adminUserId === "none" ? "" : "Use admin email if blank"}
                onChange={(event) => setForm({ ...form, personnelEmail: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Create Worker"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmploymentDialog({
  open,
  legalEntities,
  form,
  setForm,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean;
  legalEntities: LegalEntitySummary[];
  form: EmploymentFormState;
  setForm: (value: EmploymentFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Employment</DialogTitle>
          <DialogDescription>Create a real Yaotu employment relationship as draft.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Legal Entity</Label>
              <Select value={form.legalEntityId} onValueChange={(value) => setForm({ ...form, legalEntityId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select legal entity" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.id} value={String(entity.id)}>{entity.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Classification</Label>
              <Select
                value={form.employeeClassification}
                onValueChange={(value) => setForm({ ...form, employeeClassification: value as EmployeeClassification })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="paid_intern">Paid intern</SelectItem>
                  <SelectItem value="other_employee">Other employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payroll Participation</Label>
              <Select
                value={form.payrollParticipation}
                onValueChange={(value) => setForm({ ...form, payrollParticipation: value as PayrollParticipation })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_enrolled">Not enrolled</SelectItem>
                  <SelectItem value="eligible">Eligible</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Work Location</Label>
              <Input value={form.workLocation} onChange={(event) => setForm({ ...form, workLocation: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Primary Work State</Label>
              <Input value={form.primaryWorkState} onChange={(event) => setForm({ ...form, primaryWorkState: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Primary Work Jurisdiction</Label>
              <Input value={form.primaryWorkJurisdiction} onChange={(event) => setForm({ ...form, primaryWorkJurisdiction: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Create Employment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompensationDialog({
  open,
  form,
  setForm,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean;
  form: CompensationFormState;
  setForm: (value: CompensationFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Compensation Term</DialogTitle>
          <DialogDescription>Record a draft correction or a new effective-dated compensation term.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Pay Basis</Label>
              <Select value={form.payBasis} onValueChange={(value) => setForm({ ...form, payBasis: value as CompensationPayBasis })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                  <SelectItem value="stipend">Stipend</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount Cents</Label>
              <Input type="number" min="1" required value={form.amountCents} onChange={(event) => setForm({ ...form, amountCents: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input required maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-2">
              <Label>Pay Frequency</Label>
              <Select value={form.payFrequency} onValueChange={(value) => setForm({ ...form, payFrequency: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="semimonthly">Semimonthly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="one_time">One time</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expected Hours Per Week</Label>
              <Input type="number" min="1" max="168" value={form.expectedHoursPerWeek} onChange={(event) => setForm({ ...form, expectedHoursPerWeek: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as "draft" | "active" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft correction</SelectItem>
                  <SelectItem value="active">Active term</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Effective From</Label>
              <Input type="date" required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Effective Through</Label>
              <Input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={form.supersedeCurrent}
                onChange={(event) => setForm({ ...form, supersedeCurrent: event.target.checked })}
              />
              Supersede current active term from the new effective date
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save Compensation"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
