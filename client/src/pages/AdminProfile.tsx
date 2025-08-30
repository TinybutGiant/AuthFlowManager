import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeftRight, Delete, CheckCircle } from "lucide-react";
import { AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";

export default function AdminProfile() {
  const params = useParams();
  const adminId = params.id ? parseInt(params.id) : undefined;

  const { data: admin, isLoading } = useQuery<AdminUser>({
    queryKey: ["/api/admin/users", adminId],
    enabled: !!adminId,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-light text-foreground mb-2">Admin Profile</h1>
          <p className="text-muted-foreground">Loading admin profile...</p>
        </div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-light text-foreground mb-2">Admin Profile</h1>
          <p className="text-muted-foreground">Admin not found.</p>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      active: "default",
      pending: "secondary",
      inactive: "destructive",
      rejected: "destructive",
    } as const;
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {status}
      </Badge>
    );
  };

  const getRoleBadge = (role: string) => {
    const colors = {
      super_admin: "bg-primary/10 text-primary",
      admin_finance: "bg-blue-500/10 text-blue-700",
      admin_verifier: "bg-green-500/10 text-green-700",
      admin_support: "bg-orange-500/10 text-orange-700",
    } as const;

    return (
      <span className={`px-2 py-1 rounded-full text-sm ${colors[role as keyof typeof colors] || 'bg-gray-100 text-gray-700'}`}>
        {ROLE_DISPLAY_NAMES[role as keyof typeof ROLE_DISPLAY_NAMES] || role}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-admin-profile-title">
            Admin Profile
          </h1>
          <p className="text-muted-foreground">
            View and manage administrator details.
          </p>
        </div>
        <div className="flex space-x-3">
          <Link href={`/admin-management/change-role/${admin.id}`}>
            <Button variant="outline" data-testid="button-change-role">
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Change Role
            </Button>
          </Link>
          <Link href={`/admin-management/delete/${admin.id}`}>
            <Button variant="destructive" data-testid="button-delete-admin">
              <Delete className="h-4 w-4 mr-2" />
              Delete Admin
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Information */}
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center mb-6">
                <Avatar className="w-20 h-20 mx-auto mb-4">
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                    {admin.name[0]}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-xl font-medium text-foreground" data-testid="text-admin-name">
                  {admin.name}
                </h2>
                <p className="text-muted-foreground" data-testid="text-admin-email">
                  {admin.email}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Role</Label>
                  <div className="mt-1" data-testid="text-admin-role">
                    {getRoleBadge(admin.role)}
                  </div>
                </div>
                
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Status</Label>
                  <div className="mt-1" data-testid="text-admin-status">
                    {getStatusBadge(admin.status)}
                  </div>
                </div>
                
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Created</Label>
                  <p className="text-foreground" data-testid="text-admin-created">
                    {new Date(admin.createdAt).toLocaleDateString()}
                  </p>
                </div>
                
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Last Login</Label>
                  <p className="text-foreground" data-testid="text-admin-last-login">
                    {admin.lastLoginAt 
                      ? new Date(admin.lastLoginAt).toLocaleDateString() + ' at ' + new Date(admin.lastLoginAt).toLocaleTimeString()
                      : 'Never'
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Activity and Details */}
        <div className="lg:col-span-2 space-y-8">
          {/* Permissions */}
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-permissions-title">Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {admin.permissions && admin.permissions.length > 0 ? (
                  admin.permissions.map((permission, index) => (
                    <div key={index} className="flex items-center space-x-3" data-testid={`permission-${index}`}>
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-foreground">{permission}</span>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2">
                    <p className="text-muted-foreground" data-testid="text-no-permissions">
                      No specific permissions assigned. Role-based permissions apply.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Work Activity */}
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-work-activity-title">Work Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-work-activity-placeholder">
                Activity tracking will be displayed here once implemented.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
