import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BadgePlus, ArrowLeftRight, Delete, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AdminUserApproval } from "@/types/admin";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function PendingRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: approvals = [], isLoading } = useQuery<AdminUserApproval[]>({
    queryKey: ["/api/admin/approvals"],
    retry: false,
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      await apiRequest("PUT", `/api/admin/approvals/${id}`, { status, notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals"] });
      toast({
        title: "Success",
        description: "Approval request updated successfully",
      });
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
        description: "Failed to update approval request",
        variant: "destructive",
      });
    },
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create':
        return <BadgePlus className="h-4 w-4" />;
      case 'change_role':
        return <ArrowLeftRight className="h-4 w-4" />;
      case 'delete':
        return <Delete className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "secondary",
      approved: "default",
      rejected: "destructive",
    } as const;
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {status}
      </Badge>
    );
  };

  const handleApprove = (id: number) => {
    approvalMutation.mutate({ id, status: 'approved' });
  };

  const handleReject = (id: number) => {
    approvalMutation.mutate({ id, status: 'rejected' });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-light text-foreground mb-2">Pending Admin Requests</h1>
          <p className="text-muted-foreground">Loading requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-pending-requests-title">
          Pending Admin Requests
        </h1>
        <p className="text-muted-foreground">
          Review and approve admin account requests and role changes.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            <Select>
              <SelectTrigger className="w-40" data-testid="select-filter-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="create">Create Admin</SelectItem>
                <SelectItem value="change_role">Change Role</SelectItem>
                <SelectItem value="delete">Delete Admin</SelectItem>
              </SelectContent>
            </Select>

            <Select>
              <SelectTrigger className="w-40" data-testid="select-filter-status">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Button data-testid="button-apply-filters">Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Requests Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-4 font-medium text-foreground">Request Type</th>
                  <th className="text-left p-4 font-medium text-foreground">Target Admin</th>
                  <th className="text-left p-4 font-medium text-foreground">Requested By</th>
                  <th className="text-left p-4 font-medium text-foreground">Date</th>
                  <th className="text-left p-4 font-medium text-foreground">Status</th>
                  <th className="text-left p-4 font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {approvals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground" data-testid="text-no-requests">
                      No pending requests found.
                    </td>
                  </tr>
                ) : (
                  approvals.map((approval) => (
                    <tr key={approval.id} className="border-b border-border hover:bg-accent/50" data-testid={`row-approval-${approval.id}`}>
                      <td className="p-4">
                        <div className="flex items-center space-x-2">
                          {getActionIcon(approval.action)}
                          <span className="capitalize">{approval.action.replace('_', ' ')}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div data-testid={`text-target-admin-${approval.id}`}>
                          Admin ID: {approval.targetAdminId}
                        </div>
                      </td>
                      <td className="p-4" data-testid={`text-requested-by-${approval.id}`}>
                        User ID: {approval.requestedBy}
                      </td>
                      <td className="p-4" data-testid={`text-date-${approval.id}`}>
                        {new Date(approval.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4">
                        {getStatusBadge(approval.status)}
                      </td>
                      <td className="p-4">
                        {approval.status === 'pending' && (
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(approval.id)}
                              disabled={approvalMutation.isPending}
                              data-testid={`button-approve-${approval.id}`}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(approval.id)}
                              disabled={approvalMutation.isPending}
                              data-testid={`button-reject-${approval.id}`}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
