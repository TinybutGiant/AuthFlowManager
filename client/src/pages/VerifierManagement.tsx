import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Search, AlertTriangle, FileText, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  GuideApplication,
  GuideApplicationApproval,
  ApplicationStatus,
} from "@/types/admin";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function VerifierManagement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("pending");
  const [historyFilter, setHistoryFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Fetch all guide applications
  const { data: applications = [], isLoading } = useQuery<GuideApplication[]>({
    queryKey: ["/api/guide-applications"],
    retry: false,
  });

  // Fetch all approvals for history
  const { data: allApprovals = [], isLoading: approvalsLoading } = useQuery<
    GuideApplicationApproval[]
  >({
    queryKey: ["/api/guide-approvals"],
    retry: false,
    enabled: selectedTab === "history",
  });

  // Filter applications based on status and search
  const filteredApplications = applications.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Categorize applications
  const pendingApplications = filteredApplications.filter(
    (app) =>
      app.applicationStatus === "pending" ||
      app.applicationStatus === "needs_more_info",
  );
  const approvedApplications = filteredApplications.filter(
    (app) => app.applicationStatus === "approved",
  );
  const rejectedApplications = filteredApplications.filter(
    (app) => app.applicationStatus === "rejected",
  );

  const getStatusBadge = (status: ApplicationStatus) => {
    const colors = {
      pending: "bg-blue-500/10 text-blue-700",
      needs_more_info: "bg-yellow-500/10 text-yellow-700",
      approved: "bg-green-500/10 text-green-700",
      rejected: "bg-red-500/10 text-red-700",
      drafted: "bg-gray-500/10 text-gray-700",
    } as const;

    return (
      <span
        className={`px-2 py-1 rounded-full text-sm font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}
      >
        {status.replace("_", " ")}
      </span>
    );
  };

  const handleViewApplication = (applicationId: string, isReadOnly = false) => {
    // Navigate directly to application detail page
    // The locking logic will be handled in the ApplicationDetail component
    setLocation(
      `/verifier-management/application/${applicationId}${isReadOnly ? "?readonly=true" : ""}`,
    );
  };

  const ApplicationCard = ({
    application,
    isReadOnly = false,
  }: {
    application: GuideApplication;
    isReadOnly?: boolean;
  }) => (
    <Card key={application.id} className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3
                className="font-semibold text-lg"
                data-testid={`text-application-name-${application.id}`}
              >
                {application.name}
              </h3>
              {application.flaggedForReview && (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </div>
            <p
              className="text-sm text-muted-foreground mb-2"
              data-testid={`text-application-id-${application.id}`}
            >
              Application ID: {application.id}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(application.updatedAt).toLocaleDateString()}
              </div>
              {application.internalTags &&
                application.internalTags.length > 0 && (
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
          <h1 className="text-3xl font-light text-foreground mb-2">
            Verifier Management
          </h1>
          <p className="text-muted-foreground">Loading applications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1
          className="text-3xl font-light text-foreground mb-2"
          data-testid="text-verifier-management-title"
        >
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
      <Tabs
        value={selectedTab}
        onValueChange={setSelectedTab}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingApplications.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approvedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Rejected ({rejectedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            History ({allApprovals.length})
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
                <p
                  className="text-muted-foreground text-center py-8"
                  data-testid="text-no-pending-applications"
                >
                  No pending applications found.
                </p>
              ) : (
                pendingApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                  />
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
                <p
                  className="text-muted-foreground text-center py-8"
                  data-testid="text-no-approved-applications"
                >
                  No approved applications found.
                </p>
              ) : (
                approvedApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    isReadOnly={true}
                  />
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
                <p
                  className="text-muted-foreground text-center py-8"
                  data-testid="text-no-rejected-applications"
                >
                  No rejected applications found.
                </p>
              ) : (
                rejectedApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    isReadOnly={true}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-purple-500" />
                Approval History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* History filters */}
              <div className="flex gap-4 items-center">
                <Input
                  placeholder="Filter by Application ID..."
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                  className="max-w-sm"
                  data-testid="input-filter-history"
                />
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger
                    className="max-w-xs"
                    data-testid="select-action-filter"
                  >
                    <SelectValue placeholder="Filter by action..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="approve">Approve</SelectItem>
                    <SelectItem value="reject">Reject</SelectItem>
                    <SelectItem value="require_more_info">
                      Require More Info
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={sortOrder}
                  onValueChange={(value) =>
                    setSortOrder(value as "asc" | "desc")
                  }
                >
                  <SelectTrigger
                    className="max-w-xs"
                    data-testid="select-sort-order"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest first</SelectItem>
                    <SelectItem value="asc">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Approval history list */}
              {approvalsLoading ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">
                    Loading approval history...
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allApprovals
                    .filter((approval) => {
                      const matchesApplication =
                        !historyFilter ||
                        approval.applicationId
                          .toLowerCase()
                          .includes(historyFilter.toLowerCase());
                      const matchesAction =
                        !actionFilter || actionFilter === "all" || approval.adminAction === actionFilter;
                      return matchesApplication && matchesAction;
                    })
                    .sort((a, b) => {
                      const dateA = new Date(a.createdAt).getTime();
                      const dateB = new Date(b.createdAt).getTime();
                      return sortOrder === "desc"
                        ? dateB - dateA
                        : dateA - dateB;
                    })
                    .map((approval) => (
                      <Card key={approval.id} className="p-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span
                                className="font-medium text-sm"
                                data-testid={`text-approval-app-id-${approval.id}`}
                              >
                                App ID: {approval.applicationId}
                              </span>
                              {approval.adminAction && (
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    approval.adminAction === "approve"
                                      ? "bg-green-500/10 text-green-700"
                                      : approval.adminAction === "reject"
                                        ? "bg-red-500/10 text-red-700"
                                        : approval.adminAction ===
                                            "require_more_info"
                                          ? "bg-yellow-500/10 text-yellow-700"
                                          : "bg-blue-500/10 text-blue-700"
                                  }`}
                                >
                                  {approval.adminAction.replace("_", " ")}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground mb-2">
                              <div>
                                <span className="font-medium">User ID:</span>{" "}
                                {approval.userId}
                              </div>
                              <div>
                                <span className="font-medium">Admin ID:</span>{" "}
                                {approval.adminId || "N/A"}
                              </div>
                              <div className="col-span-2">
                                <span className="font-medium">Date:</span>{" "}
                                {new Date(approval.createdAt).toLocaleString()}
                              </div>
                            </div>

                            {approval.note && (
                              <div className="bg-muted p-3 rounded-lg text-sm">
                                <span className="font-medium">Note:</span>
                                <p className="mt-1">{approval.note}</p>
                              </div>
                            )}

                            {approval.userResponse && (
                              <div className="bg-blue-50 p-3 rounded-lg text-sm mt-2">
                                <span className="font-medium">
                                  User Response:
                                </span>
                                <pre className="mt-1 whitespace-pre-wrap text-xs">
                                  {JSON.stringify(
                                    approval.userResponse,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}

                  {allApprovals.length === 0 && (
                    <p
                      className="text-muted-foreground text-center py-8"
                      data-testid="text-no-approval-history"
                    >
                      No approval history found.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
