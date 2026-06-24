import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";

export default function DeleteAdmin() {
  const params = useParams();
  const adminId = params.id ? Number(params.id) : null;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmation, setConfirmation] = useState("");

  const { data: admin, isLoading } = useQuery<AdminUser>({
    queryKey: ["/api/admin/users", adminId],
    enabled: Boolean(adminId),
    retry: false,
  });

  const expectedConfirmation = admin?.email ?? "";
  const confirmed = useMemo(() => {
    return Boolean(expectedConfirmation) && confirmation.trim() === expectedConfirmation;
  }, [confirmation, expectedConfirmation]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!adminId) {
        throw new Error("Select an admin to delete.");
      }
      await apiRequest("DELETE", `/api/admin/users/${adminId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Admin deleted",
        description: "The admin account and its owned trainee records were removed.",
      });
      setLocation("/admin-management");
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: getApiErrorMessage(error, "Could not delete this admin."),
        variant: "destructive",
      });
    },
  });

  if (!adminId) {
    return (
      <div className="space-y-8">
        <PageHeader />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Open an admin profile before deleting an admin account.</p>
            <Link href="/admin-management">
              <Button variant="outline" className="mt-4" data-testid="button-back-admin-management">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Admin Management
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader />
        <p className="text-muted-foreground">Loading admin details...</p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="space-y-8">
        <PageHeader />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Admin not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader />

      <Card>
        <CardHeader>
          <CardTitle>Confirm Admin Deletion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4 rounded-md border border-border p-4">
            <Avatar>
              <AvatarFallback className="bg-primary text-primary-foreground">
                {admin.name[0]}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground" data-testid="text-delete-admin-name">
                {admin.name}
              </p>
              <p className="text-sm text-muted-foreground" data-testid="text-delete-admin-email">
                {admin.email}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {ROLE_DISPLAY_NAMES[admin.role as keyof typeof ROLE_DISPLAY_NAMES] ?? admin.role}
              </Badge>
              <Badge>{admin.status}</Badge>
            </div>
          </div>

          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              This permanently deletes the admin account.
            </div>
            <p>
              For trainee accounts, owned engagement records, offer letters, activity logs, lifecycle events,
              and access grants are removed too. This action cannot be undone.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">
              Type the admin email to confirm deletion
            </Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={admin.email}
              autoComplete="off"
              data-testid="input-delete-admin-confirmation"
            />
          </div>

          <div className="flex justify-end gap-3">
            <Link href={`/admin-management/profile/${admin.id}`}>
              <Button variant="outline" data-testid="button-cancel-delete-admin">
                Cancel
              </Button>
            </Link>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={!confirmed || deleteMutation.isPending}
              data-testid="button-confirm-delete-admin"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteMutation.isPending ? "Deleting..." : "Delete Admin"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-delete-admin-title">
        Delete Admin
      </h1>
      <p className="text-muted-foreground">
        Remove an administrator and any owned trainee access records.
      </p>
    </div>
  );
}
