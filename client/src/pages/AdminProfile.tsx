import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeftRight, Delete, CheckCircle, Send } from "lucide-react";
import { AdminEngagement, AdminLifecycleEvent, AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdminProfile() {
  const params = useParams();
  const adminId = params.id ? parseInt(params.id) : undefined;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: admin, isLoading } = useQuery<AdminUser>({
    queryKey: ["/api/admin/users", adminId],
    enabled: !!adminId,
    retry: false,
  });

  const { data: engagements = [] } = useQuery<AdminEngagement[]>({
    queryKey: ["/api/admin/users", adminId, "engagements"],
    enabled: !!adminId,
    retry: false,
  });

  const { data: lifecycleEvents = [] } = useQuery<AdminLifecycleEvent[]>({
    queryKey: ["/api/admin/users", adminId, "lifecycle-events"],
    enabled: !!adminId,
    retry: false,
  });

  const resendSetupMutation = useMutation({
    mutationFn: async (targetAdminId: number) => {
      await apiRequest("POST", `/api/admin/users/${targetAdminId}/resend-setup-link`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId] });
      toast({
        title: "Setup email sent",
        description: "A fresh password setup link has been sent.",
      });
    },
    onError: (error) => {
      toast({
        title: "Resend failed",
        description: getApiErrorMessage(error, "Could not send password setup email."),
        variant: "destructive",
      });
    },
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
      trainee_access: "bg-slate-500/10 text-slate-700",
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
          {admin.status === "active" && admin.mustChangePassword && (
            <Button
              variant="outline"
              onClick={() => resendSetupMutation.mutate(admin.id)}
              disabled={resendSetupMutation.isPending}
              data-testid="button-resend-setup"
            >
              <Send className="h-4 w-4 mr-2" />
              Resend setup
            </Button>
          )}
          <Link href={`/admin-management/change-role/${admin.id}`}>
            <Button variant="outline" data-testid="button-change-role">
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Change Access Role
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
                  <Label className="text-sm font-medium text-muted-foreground">Access Role</Label>
                  <div className="mt-1" data-testid="text-admin-role">
                    {getRoleBadge(admin.role)}
                  </div>
                </div>
                
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Status</Label>
                  <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="text-admin-status">
                    {getStatusBadge(admin.status)}
                    {admin.status === "active" && admin.mustChangePassword && (
                      <Badge variant="secondary">Password setup pending</Badge>
                    )}
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

          <Card>
            <CardHeader>
              <CardTitle data-testid="text-engagement-title">Engagement</CardTitle>
            </CardHeader>
            <CardContent>
              {engagements.length > 0 ? (
                <div className="space-y-4">
                  {engagements.map((engagement) => (
                    <div key={engagement.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="secondary">{engagement.engagementType.replace('_', ' ')}</Badge>
                        <Badge>{engagement.status}</Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Schedule: </span>
                          <span>{engagement.scheduleType?.replace('_', '-') || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Work Authorization: </span>
                          <span>{engagement.workAuthorizationType.replace('_', ' ').toUpperCase()}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Start: </span>
                          <span>{engagement.startDate || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">End: </span>
                          <span>{engagement.endDate || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Supervisor: </span>
                          <span>{engagement.supervisorAdminId ? `Admin ID ${engagement.supervisorAdminId}` : 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Expected Hours: </span>
                          <span>{engagement.expectedHoursPerWeek ?? 'Not set'}</span>
                        </div>
                      </div>
                      {engagement.workScope && (
                        <p className="text-sm text-muted-foreground mt-3">{engagement.workScope}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground" data-testid="text-no-engagements">
                  No engagement records yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Work Activity */}
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-lifecycle-events-title">Lifecycle Events</CardTitle>
            </CardHeader>
            <CardContent>
              {lifecycleEvents.length > 0 ? (
                <div className="space-y-4">
                  {lifecycleEvents.map((event) => (
                    <div key={event.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{event.eventType.replace(/_/g, ' ')}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(event.occurredAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Actor: {event.actorAdminId ? `Admin ID ${event.actorAdminId}` : 'System'}
                      </div>
                      {event.notes && (
                        <p className="text-sm text-foreground mt-2">{event.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground" data-testid="text-no-lifecycle-events">
                  No lifecycle events yet.
                </p>
              )}
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
