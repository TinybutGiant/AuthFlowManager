import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { ROLE_DISPLAY_NAMES } from "@/types/admin";

const createAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  role: z.enum(['admin_finance', 'admin_verifier', 'admin_support'], {
    required_error: "Please select a role",
  }),
  passwordHash: z.string().min(8, "Password must be at least 8 characters"),
  permissions: z.array(z.string()).optional(),
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
      passwordHash: "",
      permissions: [],
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: async (data: CreateAdminForm) => {
      await apiRequest("POST", "/api/admin/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "Admin user created successfully",
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
      toast({
        title: "Error",
        description: "Failed to create admin user",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateAdminForm) => {
    createAdminMutation.mutate(data);
  };

  const generatePassword = () => {
    const password = Math.random().toString(36).slice(-12);
    form.setValue("passwordHash", password);
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
                <Label htmlFor="role">Role</Label>
                <Select 
                  value={form.watch("role")} 
                  onValueChange={(value) => form.setValue("role", value as any)}
                >
                  <SelectTrigger data-testid="select-admin-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_finance">Finance Admin</SelectItem>
                    <SelectItem value="admin_verifier">Verifier Admin</SelectItem>
                    <SelectItem value="admin_support">Support Admin</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.role && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.role.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="password">Initial Password</Label>
                <div className="flex space-x-2">
                  <Input
                    id="password"
                    type="password"
                    {...form.register("passwordHash")}
                    placeholder="Generate or enter password"
                    data-testid="input-admin-password"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={generatePassword}
                    data-testid="button-generate-password"
                  >
                    Generate
                  </Button>
                </div>
                {form.formState.errors.passwordHash && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.passwordHash.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  User will be required to change password on first login.
                </p>
              </div>

              <div>
                <Label>Permissions</Label>
                <div className="space-y-2 mt-2">
                  {['View Reports', 'Manage Users', 'Access Logs'].map((permission) => (
                    <div key={permission} className="flex items-center space-x-2">
                      <Checkbox 
                        id={permission} 
                        data-testid={`checkbox-permission-${permission.toLowerCase().replace(' ', '-')}`}
                      />
                      <Label htmlFor={permission} className="text-sm">{permission}</Label>
                    </div>
                  ))}
                </div>
              </div>

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
                  {createAdminMutation.isPending ? "Creating..." : "Create Admin"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
