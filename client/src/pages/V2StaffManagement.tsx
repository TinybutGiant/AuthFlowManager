import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Pencil, Power, RefreshCw, UserPlus } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import type { AdminAccessGroup, AdminRole, AdminStatus } from "@/types/admin";
import { ROLE_DISPLAY_NAMES } from "@/types/admin";

type StaffPrincipal = {
  id: string;
  email: string;
  role: AdminRole;
  permissions: AdminAccessGroup[];
};

type V2StaffRecord = {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  accountType: string;
  accessGroups: AdminAccessGroup[];
  createdAt: string | null;
  updatedAt: string | null;
};

type AuthMeResponse = {
  status: "ok";
  staff: StaffPrincipal;
};

type StaffListResponse = {
  status: "ok";
  staff: V2StaffRecord[];
  assignableAccessGroups: AdminAccessGroup[];
};

type StaffResponse = {
  status: "ok";
  staff: V2StaffRecord;
  assignableAccessGroups: AdminAccessGroup[];
};

type StaffFormState = {
  name: string;
  email: string;
  role: AdminRole;
  accessGroups: AdminAccessGroup[];
};

const DEFAULT_CREATE_FORM: StaffFormState = {
  name: "",
  email: "",
  role: "admin_support",
  accessGroups: [],
};

const ACCESS_GROUP_LABELS: Record<AdminAccessGroup, string> = {
  super_admin: "Super admin",
  admin_operations: "Admin operations",
  finance_admin: "Finance admin",
  payroll_admin: "Payroll admin",
  verifier_admin: "Verifier admin",
  support_admin: "Support admin",
  document_templates: "Document templates",
  lifecycle_jobs: "Lifecycle jobs",
  trainee_offer_portal: "Trainee offer portal",
  trainee_workspace: "Trainee workspace",
};

async function v2Json<T>(
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
    const code =
      body && typeof body === "object" && "code" in body
        ? String((body as { code: unknown }).code)
        : response.statusText;
    throw new Error(code);
  }

  return body as T;
}

function statusLabel(status: AdminStatus) {
  if (status === "inactive") {
    return "Suspended";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusVariant(status: AdminStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "active") return "default";
  if (status === "inactive") return "destructive";
  if (status === "pending") return "secondary";
  return "outline";
}

function accessGroupLabel(accessGroup: AdminAccessGroup) {
  return ACCESS_GROUP_LABELS[accessGroup] ?? accessGroup;
}

function updateAccessGroups(
  accessGroups: AdminAccessGroup[],
  accessGroup: AdminAccessGroup,
  checked: boolean,
) {
  if (checked) {
    return Array.from(new Set([...accessGroups, accessGroup]));
  }

  return accessGroups.filter((item) => item !== accessGroup);
}

function assignableActiveGroups(
  accessGroups: AdminAccessGroup[],
  assignableAccessGroups: AdminAccessGroup[],
) {
  const assignable = new Set(assignableAccessGroups);
  return accessGroups.filter((accessGroup) => assignable.has(accessGroup));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function StaffFormFields({
  form,
  assignableAccessGroups,
  onChange,
}: {
  form: StaffFormState;
  assignableAccessGroups: AdminAccessGroup[];
  onChange: (form: StaffFormState) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="staff-name">Name</Label>
        <Input
          id="staff-name"
          value={form.name}
          onChange={(event) =>
            onChange({ ...form, name: event.currentTarget.value })
          }
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="staff-email">Email</Label>
        <Input
          id="staff-email"
          type="email"
          value={form.email}
          onChange={(event) =>
            onChange({ ...form, email: event.currentTarget.value })
          }
        />
      </div>

      <div className="grid gap-2">
        <Label>Role</Label>
        <Select
          value={form.role}
          onValueChange={(role: AdminRole) => onChange({ ...form, role })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ROLE_DISPLAY_NAMES).map(([role, label]) => (
              <SelectItem key={role} value={role}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        <Label>Access grants</Label>
        <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
          {assignableAccessGroups.map((accessGroup) => (
            <label
              key={accessGroup}
              className="flex min-h-9 items-center gap-2 text-sm"
            >
              <Checkbox
                checked={form.accessGroups.includes(accessGroup)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...form,
                    accessGroups: updateAccessGroups(
                      form.accessGroups,
                      accessGroup,
                      checked === true,
                    ),
                  })
                }
              />
              <span>{accessGroupLabel(accessGroup)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function V2StaffManagement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editStaff, setEditStaff] = React.useState<V2StaffRecord | null>(null);
  const [createForm, setCreateForm] =
    React.useState<StaffFormState>(DEFAULT_CREATE_FORM);
  const [editForm, setEditForm] =
    React.useState<StaffFormState>(DEFAULT_CREATE_FORM);

  const meQuery = useQuery({
    queryKey: ["v2", "auth", "me"],
    queryFn: () => v2Json<AuthMeResponse>("/api/v2/auth/me"),
  });

  const staffQuery = useQuery({
    queryKey: ["v2", "staff"],
    queryFn: () => v2Json<StaffListResponse>("/api/v2/staff"),
  });

  const assignableAccessGroups =
    staffQuery.data?.assignableAccessGroups ?? [];

  const refreshStaff = async () => {
    await queryClient.invalidateQueries({ queryKey: ["v2", "staff"] });
    await queryClient.invalidateQueries({ queryKey: ["v2", "auth", "me"] });
  };

  const createMutation = useMutation({
    mutationFn: (input: StaffFormState) =>
      v2Json<StaffResponse>("/api/v2/staff", {
        method: "POST",
        json: input,
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      await refreshStaff();
      toast({ title: "Staff identity added" });
    },
    onError: (error) => {
      toast({
        title: "Create failed",
        description: errorMessage(error, "Staff identity could not be added."),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Pick<StaffFormState, "name" | "email" | "role">;
    }) =>
      v2Json<StaffResponse>(`/api/v2/staff/${id}`, {
        method: "PATCH",
        json: input,
      }),
  });

  const replaceGrantsMutation = useMutation({
    mutationFn: ({
      id,
      accessGroups,
    }: {
      id: number;
      accessGroups: AdminAccessGroup[];
    }) =>
      v2Json<StaffResponse>(`/api/v2/staff/${id}/grants`, {
        method: "PUT",
        json: { accessGroups },
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: number;
      action: "activate" | "suspend";
    }) =>
      v2Json<StaffResponse>(`/api/v2/staff/${id}/${action}`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await refreshStaff();
      toast({ title: "Staff status updated" });
    },
    onError: (error) => {
      toast({
        title: "Status update failed",
        description: errorMessage(error, "Staff status could not be updated."),
        variant: "destructive",
      });
    },
  });

  const openEdit = (staff: V2StaffRecord) => {
    setEditStaff(staff);
    setEditForm({
      name: staff.name,
      email: staff.email,
      role: staff.role,
      accessGroups: assignableActiveGroups(
        staff.accessGroups,
        assignableAccessGroups,
      ),
    });
  };

  const saveEdit = async () => {
    if (!editStaff) {
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: editStaff.id,
        input: {
          name: editForm.name,
          email: editForm.email,
          role: editForm.role,
        },
      });
      await replaceGrantsMutation.mutateAsync({
        id: editStaff.id,
        accessGroups: editForm.accessGroups,
      });
      setEditStaff(null);
      await refreshStaff();
      toast({ title: "Staff updated" });
    } catch (error) {
      toast({
        title: "Update failed",
        description: errorMessage(error, "Staff account could not be updated."),
        variant: "destructive",
      });
    }
  };

  const isSaving =
    createMutation.isPending ||
    updateMutation.isPending ||
    replaceGrantsMutation.isPending ||
    statusMutation.isPending;

  if (meQuery.isLoading || staffQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="text-sm text-muted-foreground">Loading staff...</div>
      </main>
    );
  }

  if (meQuery.error || staffQuery.error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl rounded-md border bg-white p-6">
          <div className="text-sm font-medium text-destructive">
            Staff management unavailable
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {errorMessage(
              meQuery.error ?? staffQuery.error,
              "The V2 staff endpoint could not be loaded.",
            )}
          </div>
        </div>
      </main>
    );
  }

  const currentStaff = meQuery.data?.staff;
  const staff = staffQuery.data?.staff ?? [];

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Staff Management
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              Signed in as {currentStaff?.email}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refreshStaff} disabled={isSaving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)} disabled={isSaving}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add authorized staff identity
            </Button>
          </div>
        </header>

        <section className="overflow-hidden rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access grants</TableHead>
                <TableHead className="w-[220px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((staffMember) => (
                <TableRow key={staffMember.id}>
                  <TableCell>
                    <div className="font-medium">{staffMember.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {staffMember.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(staffMember.status)}>
                      {statusLabel(staffMember.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {ROLE_DISPLAY_NAMES[staffMember.role] ?? staffMember.role}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xl flex-wrap gap-1.5">
                      {staffMember.accessGroups.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          None
                        </span>
                      ) : (
                        staffMember.accessGroups.map((accessGroup) => (
                          <Badge key={accessGroup} variant="secondary">
                            {accessGroupLabel(accessGroup)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(staffMember)}
                        disabled={isSaving}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      {staffMember.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            statusMutation.mutate({
                              id: staffMember.id,
                              action: "suspend",
                            })
                          }
                          disabled={isSaving}
                        >
                          <Ban className="mr-2 h-4 w-4" />
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            statusMutation.mutate({
                              id: staffMember.id,
                              action: "activate",
                            })
                          }
                          disabled={isSaving}
                        >
                          <Power className="mr-2 h-4 w-4" />
                          Activate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add authorized staff identity</DialogTitle>
          </DialogHeader>
          <StaffFormFields
            form={createForm}
            assignableAccessGroups={assignableAccessGroups}
            onChange={setCreateForm}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={createMutation.isPending}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editStaff !== null}
        onOpenChange={(open) => {
          if (!open) setEditStaff(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit staff access</DialogTitle>
          </DialogHeader>
          <StaffFormFields
            form={editForm}
            assignableAccessGroups={assignableAccessGroups}
            onChange={setEditForm}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditStaff(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={isSaving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
