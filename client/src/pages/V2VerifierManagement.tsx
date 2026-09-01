import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, Calendar, Eye, FileText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdminAccessGroup,
  AdminActionType,
  GuideApplication,
  GuideApplicationApproval,
} from "@/types/admin";

type StaffPrincipal = {
  id: string;
  email: string;
  permissions: AdminAccessGroup[];
};

type AuthMeResponse = {
  status: "ok";
  staff: StaffPrincipal;
};

const V2_VERIFIER_BASE = "/api/v2/verifier";

async function v2VerifierJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
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

function statusVariant(status: GuideApplication["applicationStatus"]) {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  if (status === "needs_more_info") return "secondary";
  return "outline";
}

function actionVariant(action: AdminActionType | null) {
  if (action === "approve") return "default";
  if (action === "reject") return "destructive";
  if (action === "require_more_info") return "secondary";
  return "outline";
}

function formatLabel(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "review";
}

function applicationPath(applicationId: string, readonly = false) {
  return `/v2/verifier/applications/${applicationId}${readonly ? "?readonly=true" : ""}`;
}

export default function V2VerifierManagement() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedTab, setSelectedTab] = React.useState("pending");
  const [historyFilter, setHistoryFilter] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("all");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");

  const meQuery = useQuery({
    queryKey: ["v2", "auth", "me"],
    queryFn: () => v2VerifierJson<AuthMeResponse>("/api/v2/auth/me"),
  });

  const applicationsQuery = useQuery({
    queryKey: ["v2", "verifier", "applications"],
    queryFn: () =>
      v2VerifierJson<GuideApplication[]>(`${V2_VERIFIER_BASE}/applications`),
  });

  const approvalsQuery = useQuery({
    queryKey: ["v2", "verifier", "approvals"],
    queryFn: () =>
      v2VerifierJson<GuideApplicationApproval[]>(
        `${V2_VERIFIER_BASE}/approvals`,
      ),
    enabled: selectedTab === "history",
  });

  const currentAdminId = Number(meQuery.data?.staff.id);
  const applications = applicationsQuery.data ?? [];
  const approvals = approvalsQuery.data ?? [];

  const filteredApplications = applications.filter((application) => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return true;
    return (
      application.name.toLowerCase().includes(needle) ||
      application.id.toLowerCase().includes(needle)
    );
  });

  const pendingApplications = filteredApplications.filter(
    (application) =>
      application.applicationStatus === "pending" ||
      application.applicationStatus === "needs_more_info",
  );
  const approvedApplications = filteredApplications.filter(
    (application) => application.applicationStatus === "approved",
  );
  const rejectedApplications = filteredApplications.filter(
    (application) => application.applicationStatus === "rejected",
  );

  function lockState(application: GuideApplication) {
    const expiryTime = application.lockExpiry
      ? new Date(application.lockExpiry).getTime()
      : 0;
    const hasActiveLock =
      Boolean(application.lockedBy) &&
      Number.isFinite(expiryTime) &&
      expiryTime > Date.now();

    if (!hasActiveLock) return "available";
    return application.lockedBy === currentAdminId ? "mine" : "other";
  }

  function ApplicationCard({
    application,
    readonly = false,
  }: {
    application: GuideApplication;
    readonly?: boolean;
  }) {
    const state = lockState(application);
    const lockedByOther = !readonly && state === "other";
    const lockedByCurrentStaff = !readonly && state === "mine";

    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{application.name}</h3>
                {application.flaggedForReview && (
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                )}
              </div>
              <p className="mb-2 break-all text-sm text-muted-foreground">
                Application ID: {application.id}
              </p>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {new Date(application.updatedAt).toLocaleDateString()}
                </span>
                {application.internalTags &&
                  application.internalTags.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {application.internalTags.length} document(s)
                    </span>
                  )}
              </div>
              {lockedByOther && (
                <p className="mt-3 text-sm font-medium text-yellow-700">
                  This application has been claimed by another staff member.
                </p>
              )}
              {lockedByCurrentStaff && (
                <p className="mt-3 text-sm font-medium text-blue-700">
                  You have this application open.
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <Badge variant={statusVariant(application.applicationStatus)}>
                {formatLabel(application.applicationStatus)}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={lockedByOther}
                onClick={() =>
                  setLocation(applicationPath(application.id, readonly))
                }
              >
                <Eye className="mr-2 h-4 w-4" />
                View
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (applicationsQuery.isLoading || meQuery.isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-light">Verifier Management</h1>
        <p className="text-muted-foreground">Loading applications...</p>
      </main>
    );
  }

  if (applicationsQuery.isError || meQuery.isError) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-light">Verifier Management</h1>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">
              Verifier access is unavailable.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="mb-2 text-3xl font-light">Verifier Management</h1>
        <p className="text-muted-foreground">
          Review guide applications and verification actions.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              placeholder="Search applications by name or ID..."
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={selectedTab}
        onValueChange={setSelectedTab}
        className="space-y-5"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pending">
            Pending ({pendingApplications.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({approvedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({rejectedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="history">History ({approvals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {pendingApplications.length > 0 ? (
            pendingApplications.map((application) => (
              <ApplicationCard key={application.id} application={application} />
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No pending applications found.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-3">
          {approvedApplications.length > 0 ? (
            approvedApplications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                readonly
              />
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No approved applications found.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-3">
          {rejectedApplications.length > 0 ? (
            rejectedApplications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                readonly
              />
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No rejected applications found.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Approval History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
                <Input
                  value={historyFilter}
                  onChange={(event) =>
                    setHistoryFilter(event.currentTarget.value)
                  }
                  placeholder="Filter by application ID..."
                />
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="approve">Approve</SelectItem>
                    <SelectItem value="reject">Reject</SelectItem>
                    <SelectItem value="require_more_info">
                      Require more info
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={sortOrder}
                  onValueChange={(value) =>
                    setSortOrder(value as "asc" | "desc")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest first</SelectItem>
                    <SelectItem value="asc">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                {approvals
                  .filter((approval) => {
                    const matchesApplication =
                      !historyFilter ||
                      approval.applicationId
                        .toLowerCase()
                        .includes(historyFilter.toLowerCase());
                    const matchesAction =
                      actionFilter === "all" ||
                      approval.adminAction === actionFilter;
                    return matchesApplication && matchesAction;
                  })
                  .sort((left, right) => {
                    const leftTime = new Date(left.createdAt).getTime();
                    const rightTime = new Date(right.createdAt).getTime();
                    return sortOrder === "desc"
                      ? rightTime - leftTime
                      : leftTime - rightTime;
                  })
                  .map((approval) => (
                    <div key={approval.id} className="rounded-md border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="break-all text-sm font-medium">
                          {approval.applicationId}
                        </span>
                        <Badge variant={actionVariant(approval.adminAction)}>
                          {formatLabel(approval.adminAction)}
                        </Badge>
                      </div>
                      <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                        <span>User ID: {approval.userId}</span>
                        <span>Staff ID: {approval.adminId ?? "N/A"}</span>
                        <span>
                          {new Date(approval.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {approval.note && (
                        <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                          {approval.note}
                        </p>
                      )}
                    </div>
                  ))}

                {!approvalsQuery.isLoading && approvals.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No approval history found.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
