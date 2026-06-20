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

const CREATE_EMAIL_FAILURE_MESSAGE =
  "Admin was created and activated, but password setup email failed. Use resend setup link after fixing email delivery.";

const createAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  role: z.enum(['admin_finance', 'admin_verifier', 'admin_support', 'trainee_access'], {
    required_error: "Please select an access role",
  }),
  engagementType: z.enum(['employee', 'intern', 'contractor', 'advisor', 'other']).optional(),
  scheduleType: z.enum(['full_time', 'part_time']).optional(),
  workAuthorizationType: z.enum(['none', 'cpt', 'opt', 'stem_opt', 'other']).default('none'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  supervisorAdminId: z.string().optional(),
  expectedHoursPerWeek: z.string().optional(),
  workScope: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'trainee_access' && !data.engagementType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagementType'],
      message: 'Engagement is required for Trainee Access',
    });
  }
  if (data.role === 'trainee_access' && !data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date is required for Trainee Access',
    });
  }
  if (data.role === 'trainee_access' && !data.supervisorAdminId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['supervisorAdminId'],
      message: 'Supervisor is required for Trainee Access',
    });
  }
  if (data.role === 'trainee_access' && !data.workScope?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workScope'],
      message: 'Work scope is required for Trainee Access',
    });
  }
  if (data.engagementType === 'intern' && !data.endDate) {
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
      role: undefined,
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
  const selectedRole = form.watch("role");
  const isTraineeAccess = selectedRole === 'trainee_access';
  const traineeEmail = form.watch("email");

  const { data: admins = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const supervisorOptions = admins.filter((admin) => (
    admin.status === "active" &&
    admin.email.toLowerCase() !== traineeEmail.toLowerCase()
  ));

  const createAdminMutation = useMutation({
    mutationFn: async (data: CreateAdminForm) => {
      const payload: any = {
        name: data.name,
        email: data.email,
        role: data.role,
      };

      if (data.role === 'trainee_access') {
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
        description: isTraineeAccess
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
        description: getApiErrorMessage(error, isTraineeAccess ? "Failed to create trainee user" : "Failed to create admin"),
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
                <Label htmlFor="role">Access Role</Label>
                <Select 
                  value={form.watch("role") || ""} 
                  onValueChange={(value) => {
                    form.setValue("role", value as any, { shouldValidate: true });
                    if (value === 'trainee_access') {
                      form.setValue("engagementType", "intern", { shouldValidate: true });
                    } else {
                      form.setValue("engagementType", undefined);
                      form.setValue("scheduleType", undefined);
                      form.setValue("workAuthorizationType", "none");
                      form.setValue("startDate", "");
                      form.setValue("endDate", "");
                      form.setValue("supervisorAdminId", "");
                      form.setValue("expectedHoursPerWeek", "");
                      form.setValue("workScope", "");
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-admin-role">
                    <SelectValue placeholder="Select an access role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_finance">Finance Admin</SelectItem>
                    <SelectItem value="admin_verifier">Verifier Admin</SelectItem>
                    <SelectItem value="admin_support">Support Admin</SelectItem>
                    <SelectItem value="trainee_access">Trainee Access</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.role && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.role.message}
                  </p>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                After this user is created, the account will be activated and a one-time password setup link will be sent to the email address above. The link expires in 24 hours.
              </div>

              {isTraineeAccess && (
              <section className="rounded-md border border-border p-5 space-y-5">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">Engagement</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Trainee Access is for temporary interns or trainees. It does not grant access to core admin operations.
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
                      <Label htmlFor="work-authorization-type">Work Authorization Type</Label>
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
                                {admin.name} - {admin.email} - {ROLE_DISPLAY_NAMES[admin.role] || admin.role}
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
                    : isTraineeAccess
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
