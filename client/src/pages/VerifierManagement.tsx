import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Search, AlertTriangle, FileText, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { GuideApplication, GuideApplicationApproval, ApplicationStatus } from "@/types/admin";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function VerifierManagement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("pending");

  // Fetch all guide applications
  const { data: applications = [], isLoading } = useQuery<GuideApplication[]>({
    queryKey: ["/api/guide-applications"],
    retry: false,
  });

  // Create review action mutation
  const createReviewMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      await apiRequest("POST", "/api/guide-approvals", {
        applicationId,
        userId: 0, // This will be set by backend from application data
        adminAction: "review",
        note: "Started review process"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guide-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guide-approvals"] });
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
        description: "Failed to start review process",
        variant: "destructive",
      });
    },
  });

  // Filter applications based on status and search
  const filteredApplications = applications.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         app.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Categorize applications
  const pendingApplications = filteredApplications.filter(
    app => app.applicationStatus === 'pending' || app.applicationStatus === 'needs_more_info'
  );
  const approvedApplications = filteredApplications.filter(
    app => app.applicationStatus === 'approved'
  );
  const rejectedApplications = filteredApplications.filter(
    app => app.applicationStatus === 'rejected'
  );

  const getStatusBadge = (status: ApplicationStatus) => {
    const colors = {
      pending: "bg-blue-500/10 text-blue-700",
      needs_more_info: "bg-yellow-500/10 text-yellow-700", 
      approved: "bg-green-500/10 text-green-700",
      rejected: "bg-red-500/10 text-red-700",
      drafted: "bg-gray-500/10 text-gray-700"
    } as const;

    return (
      <span className={`px-2 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-700'}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const handleViewApplication = async (applicationId: string, isReadOnly = false) => {
    if (!isReadOnly) {
      // Create review record for pending applications
      try {
        await createReviewMutation.mutateAsync(applicationId);
      } catch (error) {
        // Error already handled by mutation
        return;
      }
    }
    
    // Navigate to application detail page
    setLocation(`/verifier-management/application/${applicationId}${isReadOnly ? '?readonly=true' : ''}`);
  };

  const ApplicationCard = ({ application, isReadOnly = false }: { application: GuideApplication; isReadOnly?: boolean }) => (
    <Card key={application.id} className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-semibold text-lg" data-testid={`text-application-name-${application.id}`}>
                {application.name}
              </h3>
              {application.flaggedForReview && (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-2" data-testid={`text-application-id-${application.id}`}>
              Application ID: {application.id}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(application.updatedAt).toLocaleDateString()}
              </div>
              {application.internalTags && application.internalTags.length > 0 && (
                <div className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  {application.internalTags.length} document(s)
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            {getStatusBadge(application.applicationStatus)}
            <Button
              onClick={() => handleViewApplication(application.id, isReadOnly)}
              size="sm"
              variant="outline"
              disabled={createReviewMutation.isPending}
              data-testid={`button-view-${application.id}`}
            >
              <Eye className="h-4 w-4 mr-2" />
              View
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-light text-foreground mb-2">Verifier Management</h1>
          <p className="text-muted-foreground">Loading applications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-verifier-management-title">
          Verifier Management
        </h1>
        <p className="text-muted-foreground">
          Manage guide application verification processes and approvals.
        </p>
      </div>

      {/* Search and filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search applications by name or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-applications"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Applications by status */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingApplications.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approvedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Rejected ({rejectedApplications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Pending Applications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingApplications.length === 0 ? (
                <p className="text-muted-foreground text-center py-8" data-testid="text-no-pending-applications">
                  No pending applications found.
                </p>
              ) : (
                pendingApplications.map(application => (
                  <ApplicationCard key={application.id} application={application} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approved" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-green-500" />
                Approved Applications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {approvedApplications.length === 0 ? (
                <p className="text-muted-foreground text-center py-8" data-testid="text-no-approved-applications">
                  No approved applications found.
                </p>
              ) : (
                approvedApplications.map(application => (
                  <ApplicationCard key={application.id} application={application} isReadOnly={true} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rejected" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-red-500" />
                Rejected Applications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {rejectedApplications.length === 0 ? (
                <p className="text-muted-foreground text-center py-8" data-testid="text-no-rejected-applications">
                  No rejected applications found.
                </p>
              ) : (
                rejectedApplications.map(application => (
                  <ApplicationCard key={application.id} application={application} isReadOnly={true} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}