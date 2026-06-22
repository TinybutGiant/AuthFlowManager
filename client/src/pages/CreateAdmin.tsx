import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";
import {
  ASSIGNABLE_ACCESS_GROUP_OPTIONS,
  DEFAULT_TRAINEE_ACCESS_GROUP,
  IDENTITY_TYPE_OPTIONS,
  deriveLegacyRoleFromIdentityAndAccessGroup,
  type AssignableAccessGroup,
  type IdentityType,
} from "@/lib/adminIdentity";

const CREATE_EMAIL_FAILURE_MESSAGE =
  "Admin was created and activated, but password setup email failed. Use resend setup link after fixing email delivery.";

const createAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  identityType: z.enum(['admin_staff', 'trainee'], {
    required_error: "Please select an identity type",
  }),
  accessGroup: z.enum(['finance_admin', 'verifier_admin', 'support_admin']).optional(),
  engagementType: z.enum(['employee', 'intern', 'contractor', 'advisor', 'other']).optional(),
  scheduleType: z.enum(['full_time', 'part_time']).optional(),
  workAuthorizationType: z.enum(['none', 'cpt', 'opt', 'stem_opt', 'other']).default('none'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  supervisorAdminId: z.string().optional(),
  expectedHoursPerWeek: z.string().optional(),
  workScope: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.identityType === 'admin_staff' && !data.accessGroup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accessGroup'],
      message: 'Assignable Access Group is required for Admin Staff',
    });
  }
  if (data.identityType === 'trainee' && !data.engagementType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagementType'],
      message: 'Engagement is required for Trainee',
    });
  }
  if (data.identityType === 'trainee' && !data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date is required for Trainee',
    });
  }
  if (data.identityType === 'trainee' && !data.supervisorAdminId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['supervisorAdminId'],
      message: 'Supervisor is required for Trainee',
    });
  }
  if (data.identityType === 'trainee' && !data.workScope?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workScope'],
      message: 'Work scope is required for Trainee',
    });
  }
  if (data.identityType === 'trainee' && data.engagementType === 'intern' && !data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date is required for intern engagements',
    });
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date cannot be before start date',
    });
  }
});

type CreateAdminForm = z.infer<typeof createAdminSchema>;

export default function CreateAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const form = useForm<CreateAdminForm>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: {
      name: "",
      email: "",
      identityType: undefined,
      accessGroup: undefined,
      engagementType: undefined,
      scheduleType: undefined,
      workAuthorizationType: 'none',
      startDate: "",
      endDate: "",
      supervisorAdminId: "",
      expectedHoursPerWeek: "",
      workScope: "",
    },
  });
  const selectedIdentityType = form.watch("identityType");
  const selectedAccessGroup = form.watch("accessGroup");
  const isAdminStaffIdentity = selectedIdentityType === 'admin_staff';
  const isTraineeIdentity = selectedIdentityType === 'trainee';
  const traineeEmail = form.watch("email");

  const { data: admins = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const supervisorOptions = admins.filter((admin) => (
    admin.status === "active" &&
    admin.email.toLowerCase() !== traineeEmail.toLowerCase()
  ));

  const clearTraineeEngagementFields = () => {
    form.setValue("engagementType", undefined);
    form.setValue("scheduleType", undefined);
    form.setValue("workAuthorizationType", "none");
    form.setValue("startDate", "");
    form.setValue("endDate", "");
    form.setValue("supervisorAdminId", "");
    form.setValue("expectedHoursPerWeek", "");
    form.setValue("workScope", "");
  };

  const getSupervisorRoleLabel = (role: AdminUser["role"]) => {
    return role === "trainee_access" ? "Trainee" : ROLE_DISPLAY_NAMES[role] || role;
  };

  const createAdminMutation = useMutation({
    mutationFn: async (data: CreateAdminForm) => {
      const role = deriveLegacyRoleFromIdentityAndAccessGroup(data.identityType, data.accessGroup);
      if (!role) {
        throw new Error("Select an identity type and assignable access group.");
      }

      const payload: any = {
        name: data.name,
        email: data.email,
        role,
      };

      if (role === 'trainee_access') {
        payload.engagement = {
          engagementType: data.engagementType || 'intern',
          scheduleType: data.scheduleType || null,
          workAuthorizationType: data.workAuthorizationType || 'none',
          startDate: data.startDate || null,
          endDate: data.endDate || null,
          supervisorAdminId: data.supervisorAdminId ? Number(data.supervisorAdminId) : null,
          expectedHoursPerWeek: data.expectedHoursPerWeek ? Number(data.expectedHoursPerWeek) : null,
          workScope: data.workScope || null,
          status: 'draft',
        };
      }

      await apiRequest("POST", "/api/admin/users", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({
        title: "Success",
        description: isTraineeIdentity
          ? "Trainee user created. Password setup email sent."
          : "Admin created. Password setup email sent.",
      });
      navigate("/admin-management");
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }

      if (
        error instanceof ApiError &&
        error.status === 502 &&
        error.serverMessage === CREATE_EMAIL_FAILURE_MESSAGE
      ) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
        toast({
          title: "User created, email failed",
          description: "The account is active, but password setup email delivery failed. Use Resend setup link after fixing email delivery.",
          variant: "warning",
          duration: 8000,
        });
        navigate("/admin-management");
        return;
      }

      toast({
        title: "Error",
        description: getApiErrorMessage(error, isTraineeIdentity ? "Failed to create trainee user" : "Failed to create admin"),
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateAdminForm) => {
    createAdminMutation.mutate(data);
  };

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-create-admin-title">
          Create Admin
        </h1>
        <p className="text-muted-foreground">
          Add a new administrator to the system.
        </p>
      </div>

      <div className="max-w-2xl">
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    type="text"
                    {...form.register("name")}
                    placeholder="Enter full name"
                    data-testid="input-admin-name"
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive mt-1">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    {...form.register("email")}
                    placeholder="admin@example.com"
                    data-testid="input-admin-email"
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-destructive mt-1">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="identity-type">Identity Type</Label>
                <Select 
                  value={selectedIdentityType || ""}
                  onValueChange={(value) => {
                    const identityType = value as IdentityType;
                    form.setValue("identityType", identityType, { shouldValidate: true });
                    if (identityType === 'trainee') {
                      form.setValue("accessGroup", undefined, { shouldValidate: true });
                      form.setValue("engagementType", "intern", { shouldValidate: true });
                    } else {
                      form.setValue("accessGroup", undefined, { shouldValidate: true });
                      clearTraineeEngagementFields();
                    }
                  }}
                >
                  <SelectTrigger id="identity-type" data-testid="select-identity-type">
                    <SelectValue placeholder="Select identity type" />
                  </SelectTrigger>
                  <SelectContent>
                    {IDENTITY_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-1">
                  Identity Type describes the person's relationship to the organization.
                </p>
                {form.formState.errors.identityType && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.identityType.message}
                  </p>
                )}
              </div>

              {isAdminStaffIdentity && (
                <section className="rounded-md border border-border p-5 space-y-4">
                  <div>
                    <Label htmlFor="assignable-access-group">Assignable Access Groups</Label>
                    <Select
                      value={selectedAccessGroup || ""}
                      onValueChange={(value) => form.setValue("accessGroup", value as AssignableAccessGroup, { shouldValidate: true })}
                    >
                      <SelectTrigger id="assignable-access-group" data-testid="select-assignable-access-group">
                        <SelectValue placeholder="Select assignable access group" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ACCESS_GROUP_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground mt-1">
                      Assignable Access Groups control which admin functions this person can use.
                    </p>
                    {form.formState.errors.accessGroup && (
                      <p className="text-sm text-destructive mt-1">
                        {form.formState.errors.accessGroup.message}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {isTraineeIdentity && (
                <section className="rounded-md border border-border p-5 space-y-3">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">Initial Access</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Trainee accounts can review and accept their offer before full workspace access is enabled. Trainee Workspace access activates after offer acceptance.
                    </p>
                  </div>
                  <div
                    className="inline-flex rounded-md border border-border bg-muted px-3 py-1 text-sm font-medium text-foreground"
                    data-testid="pill-default-access-group"
                  >
                    {DEFAULT_TRAINEE_ACCESS_GROUP.label}
                  </div>
                </section>
              )}

              <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                After this user is created, the account will be activated and a one-time password setup link will be sent to the email address above. The link expires in 24 hours.
              </div>

              {isTraineeIdentity && (
                <section className="rounded-md border border-border p-5 space-y-5">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">Engagement</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Trainee identity is for temporary interns or trainees. It does not grant access to core admin operations.
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Engagement tracks start/end dates, supervisor, work scope, and onboarding/offboarding events.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="engagement-type">Engagement Type</Label>
                      <Select
                        value={form.watch("engagementType") || ""}
                        onValueChange={(value) => form.setValue("engagementType", value as any, { shouldValidate: true })}
                      >
                        <SelectTrigger id="engagement-type" data-testid="select-engagement-type">
                          <SelectValue placeholder="Select engagement type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="intern">Intern</SelectItem>
                          <SelectItem value="contractor">Contractor</SelectItem>
                          <SelectItem value="advisor">Advisor</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      {form.formState.errors.engagementType && (
                        <p className="text-sm text-destructive mt-1">
                          {form.formState.errors.engagementType.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="schedule-type">Schedule Type</Label>
                      <Select
                        value={form.watch("scheduleType") || ""}
                        onValueChange={(value) => form.setValue("scheduleType", value as any)}
                      >
                        <SelectTrigger id="schedule-type" data-testid="select-schedule-type">
                          <SelectValue placeholder="Select schedule type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_time">Full-time</SelectItem>
                          <SelectItem value="part_time">Part-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="work-authorization-type">Work Authorization</Label>
                      <Select
                        value={form.watch("workAuthorizationType") || "none"}
                        onValueChange={(value) => form.setValue("workAuthorizationType", value as any)}
                      >
                        <SelectTrigger id="work-authorization-type" data-testid="select-work-authorization-type">
                          <SelectValue placeholder="Select work authorization" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="cpt">CPT</SelectItem>
                          <SelectItem value="opt">OPT</SelectItem>
                          <SelectItem value="stem_opt">STEM OPT</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="supervisor-admin-id">Supervisor</Label>
                      <Select
                        value={form.watch("supervisorAdminId") || ""}
                        onValueChange={(value) => form.setValue("supervisorAdminId", value, { shouldValidate: true })}
                      >
                        <SelectTrigger id="supervisor-admin-id" data-testid="select-supervisor-admin">
                          <SelectValue placeholder="Select supervisor" />
                        </SelectTrigger>
                        <SelectContent>
                          {supervisorOptions.length === 0 ? (
                            <SelectItem value="none" disabled>No active admins available</SelectItem>
                          ) : (
                            supervisorOptions.map((admin) => (
                              <SelectItem key={admin.id} value={String(admin.id)}>
                                {admin.name} - {admin.email} - {getSupervisorRoleLabel(admin.role)}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {form.formState.errors.supervisorAdminId && (
                        <p className="text-sm text-destructive mt-1">
                          {form.formState.errors.supervisorAdminId.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="start-date">Start Date</Label>
                      <Input
                        id="start-date"
                        type="date"
                        {...form.register("startDate")}
                        data-testid="input-engagement-start-date"
                      />
                    </div>

                    <div>
                      <Label htmlFor="end-date">End Date</Label>
                      <Input
                        id="end-date"
                        type="date"
                        {...form.register("endDate")}
                        data-testid="input-engagement-end-date"
                      />
                      {form.formState.errors.endDate && (
                        <p className="text-sm text-destructive mt-1">
                          {form.formState.errors.endDate.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="expected-hours">Expected Hours Per Week</Label>
                      <Input
                        id="expected-hours"
                        type="number"
                        min="0"
                        max="168"
                        {...form.register("expectedHoursPerWeek")}
                        placeholder="e.g. 20"
                        data-testid="input-expected-hours"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="work-scope">Work Scope</Label>
                    <Input
                      id="work-scope"
                      {...form.register("workScope")}
                      placeholder="Briefly describe scope"
                      data-testid="input-work-scope"
                    />
                    {form.formState.errors.workScope && (
                      <p className="text-sm text-destructive mt-1">
                        {form.formState.errors.workScope.message}
                      </p>
                    )}
                  </div>
                  {/* TODO: Add permission override UI only after a clear override model exists. Permissions remain role-derived for now. */}
                </section>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => navigate("/admin-management")}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createAdminMutation.isPending}
                  data-testid="button-create-admin-submit"
                >
                  {createAdminMutation.isPending
                    ? "Creating..."
                    : isTraineeIdentity
                      ? "Create Trainee User"
                      : "Create Admin"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
