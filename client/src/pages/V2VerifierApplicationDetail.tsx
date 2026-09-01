import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, FileText, Send } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type {
  AdminActionType,
  Destination,
  GuideApplication,
  GuideApplicationApproval,
  GuideServiceAreaProposal,
  UserResponse,
} from "@/types/admin";

type CreateDestinationDraft = {
  nameEn: string;
  nameJa: string;
  nameZhCn: string;
  prefectureName: string;
};

const V2_VERIFIER_BASE = "/api/v2/verifier";

async function v2VerifierJson<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
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

function extractApplicationId(location: string) {
  const match = /^\/v2\/verifier\/applications\/([^/?#]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : undefined;
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

function documentUrl(tag: string) {
  return tag.startsWith("pdf:") ? tag.slice(4) : tag;
}

function parseUserResponse(value: unknown): UserResponse | null {
  try {
    if (value && typeof value === "object") return value as UserResponse;
    if (typeof value === "string") return JSON.parse(value) as UserResponse;
    return null;
  } catch {
    return null;
  }
}

function formatDestination(destination?: Destination | null) {
  if (!destination) return "Unknown destination";
  const localizedNames = [destination.nameZhCn, destination.nameJa]
    .filter((name) => name && name !== destination.nameEn)
    .join(" / ");
  return localizedNames
    ? `${destination.nameEn} (${localizedNames})`
    : destination.nameEn;
}

function proposalStatusVariant(status: string) {
  if (status === "mapped" || status === "approved") return "default";
  if (status === "rejected") return "destructive";
  if (status === "pending") return "secondary";
  return "outline";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function V2VerifierApplicationDetail() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const applicationId = extractApplicationId(location);
  const isReadOnly = new URLSearchParams(search).get("readonly") === "true";
  const [note, setNote] = React.useState("");
  const [selectedAction, setSelectedAction] =
    React.useState<AdminActionType | "">("");
  const [mapSelections, setMapSelections] = React.useState<
    Record<number, string>
  >({});
  const [createDrafts, setCreateDrafts] = React.useState<
    Record<number, CreateDestinationDraft>
  >({});
  const [lockAcquired, setLockAcquired] = React.useState(false);
  const [lockError, setLockError] = React.useState("");

  const detailKey = ["v2", "verifier", "application", applicationId];

  const acquireLockMutation = useMutation({
    mutationFn: (id: string) =>
      v2VerifierJson<GuideApplication>(
        `${V2_VERIFIER_BASE}/applications/${id}/acquire-lock`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setLockAcquired(true);
      setLockError("");
    },
    onError: (error) => {
      setLockError(
        errorMessage(
          error,
          "Failed to acquire exclusive access to this application.",
        ),
      );
    },
  });

  const releaseLockMutation = useMutation({
    mutationFn: (id: string) =>
      v2VerifierJson<{ status: string }>(
        `${V2_VERIFIER_BASE}/applications/${id}/release-lock`,
        { method: "POST" },
      ),
  });

  React.useEffect(() => {
    if (!applicationId) return;
    setLockError("");

    if (isReadOnly) {
      setLockAcquired(false);
      return;
    }

    setLockAcquired(false);
    acquireLockMutation.mutate(applicationId);
  }, [applicationId, isReadOnly]);

  React.useEffect(() => {
    return () => {
      if (applicationId && !isReadOnly && lockAcquired) {
        releaseLockMutation.mutate(applicationId);
      }
    };
  }, [applicationId, isReadOnly, lockAcquired]);

  const applicationQuery = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      v2VerifierJson<GuideApplication>(
        `${V2_VERIFIER_BASE}/applications/${applicationId}${isReadOnly ? "?readonly=true" : ""}`,
      ),
    enabled: Boolean(applicationId) && (isReadOnly || lockAcquired),
  });

  const approvalsQuery = useQuery({
    queryKey: ["v2", "verifier", "application", applicationId, "approvals"],
    queryFn: () =>
      v2VerifierJson<GuideApplicationApproval[]>(
        `${V2_VERIFIER_BASE}/applications/${applicationId}/approvals`,
      ),
    enabled: Boolean(applicationId) && (isReadOnly || lockAcquired),
  });

  const destinationsQuery = useQuery({
    queryKey: ["v2", "verifier", "destinations", "JP"],
    queryFn: () =>
      v2VerifierJson<Destination[]>(
        `${V2_VERIFIER_BASE}/destinations?countryCode=JP`,
      ),
    enabled: Boolean(applicationId) && (isReadOnly || lockAcquired),
  });

  const refreshDetail = async () => {
    await queryClient.invalidateQueries({ queryKey: detailKey });
    await queryClient.invalidateQueries({
      queryKey: ["v2", "verifier", "application", applicationId, "approvals"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["v2", "verifier", "destinations", "JP"],
    });
  };

  const mapProposalMutation = useMutation({
    mutationFn: ({
      proposalId,
      destinationId,
    }: {
      proposalId: number;
      destinationId: number;
    }) =>
      v2VerifierJson<unknown>(
        `${V2_VERIFIER_BASE}/service-area-proposals/${proposalId}/map`,
        { method: "POST", json: { destinationId } },
      ),
    onSuccess: async () => {
      await refreshDetail();
      toast({ title: "Service area mapped" });
    },
    onError: (error) => {
      toast({
        title: "Mapping failed",
        description: errorMessage(error, "Failed to map service area proposal."),
        variant: "destructive",
      });
    },
  });

  const createDestinationMutation = useMutation({
    mutationFn: ({
      proposal,
      draft,
    }: {
      proposal: GuideServiceAreaProposal;
      draft: CreateDestinationDraft;
    }) =>
      v2VerifierJson<unknown>(
        `${V2_VERIFIER_BASE}/service-area-proposals/${proposal.id}/create-destination`,
        {
          method: "POST",
          json: {
            nameEn: draft.nameEn.trim() || proposal.rawName,
            nameJa: draft.nameJa.trim() || undefined,
            nameZhCn: draft.nameZhCn.trim() || undefined,
            prefectureName: draft.prefectureName.trim() || undefined,
            placeType: "area",
            aliases: [proposal.rawName],
          },
        },
      ),
    onSuccess: async () => {
      await refreshDetail();
      toast({ title: "Destination created" });
    },
    onError: (error) => {
      toast({
        title: "Destination creation failed",
        description: errorMessage(error, "Failed to create destination."),
        variant: "destructive",
      });
    },
  });

  const rejectProposalMutation = useMutation({
    mutationFn: (proposalId: number) =>
      v2VerifierJson<unknown>(
        `${V2_VERIFIER_BASE}/service-area-proposals/${proposalId}/reject`,
        { method: "POST", json: {} },
      ),
    onSuccess: async () => {
      await refreshDetail();
      toast({ title: "Service area rejected" });
    },
    onError: (error) => {
      toast({
        title: "Rejection failed",
        description: errorMessage(error, "Failed to reject service area."),
        variant: "destructive",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { flaggedForReview: boolean }) =>
      v2VerifierJson<GuideApplication>(
        `${V2_VERIFIER_BASE}/applications/${applicationId}/review`,
        { method: "PATCH", json: input },
      ),
    onSuccess: async () => {
      await refreshDetail();
      toast({ title: "Review state updated" });
    },
    onError: (error) => {
      toast({
        title: "Review update failed",
        description: errorMessage(error, "Failed to update review state."),
        variant: "destructive",
      });
    },
  });

  const submitApprovalMutation = useMutation({
    mutationFn: (input: { action: AdminActionType; note?: string }) =>
      v2VerifierJson<unknown>(`${V2_VERIFIER_BASE}/approvals`, {
        method: "POST",
        json: {
          applicationId,
          adminAction: input.action,
          note: input.note,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["v2", "verifier", "applications"],
      });
      queryClient.invalidateQueries({ queryKey: ["v2", "verifier", "approvals"] });
      toast({ title: "Review submitted" });
      setLocation("/v2/verifier");
    },
    onError: (error) => {
      toast({
        title: "Submit failed",
        description: errorMessage(error, "Failed to submit review."),
        variant: "destructive",
      });
    },
  });

  const application = applicationQuery.data;
  const approvals = approvalsQuery.data ?? [];
  const destinations = destinationsQuery.data ?? [];
  const serviceAreas = application?.serviceAreas ?? [];
  const proposals = application?.serviceAreaProposals ?? [];
  const pendingProposals = proposals.filter(
    (proposal) => proposal.status === "pending",
  );
  const hasPendingProposals = pendingProposals.length > 0;
  const destinationById = new Map(
    destinations.map((destination) => [destination.id, destination]),
  );

  function getCreateDraft(
    proposal: GuideServiceAreaProposal,
  ): CreateDestinationDraft {
    return (
      createDrafts[proposal.id] ?? {
        nameEn: proposal.rawName,
        nameJa: "",
        nameZhCn: "",
        prefectureName: "",
      }
    );
  }

  function updateCreateDraft(
    proposal: GuideServiceAreaProposal,
    field: keyof CreateDestinationDraft,
    value: string,
  ) {
    setCreateDrafts((current) => ({
      ...current,
      [proposal.id]: {
        ...getCreateDraft(proposal),
        [field]: value,
      },
    }));
  }

  function handleMapProposal(proposal: GuideServiceAreaProposal) {
    const destinationId = Number(mapSelections[proposal.id]);
    if (!Number.isInteger(destinationId) || destinationId <= 0) {
      toast({
        title: "Select a destination",
        description: "Choose the canonical destination to map.",
        variant: "destructive",
      });
      return;
    }

    mapProposalMutation.mutate({ proposalId: proposal.id, destinationId });
  }

  function handleSubmitApproval() {
    if (!selectedAction) {
      toast({
        title: "Select an action",
        description: "Choose the review action to submit.",
        variant: "destructive",
      });
      return;
    }

    if (selectedAction === "require_more_info" && !note.trim()) {
      toast({
        title: "Review note required",
        description: "Add a note before requesting more information.",
        variant: "destructive",
      });
      return;
    }

    if (selectedAction === "approve" && hasPendingProposals) {
      toast({
        title: "Resolve service areas first",
        description:
          "All pending service-area proposals must be resolved before approval.",
        variant: "destructive",
      });
      return;
    }

    submitApprovalMutation.mutate({
      action: selectedAction,
      note: note.trim() || undefined,
    });
  }

  if (!applicationId) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Button variant="ghost" onClick={() => setLocation("/v2/verifier")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-destructive">
            Application ID is missing.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!isReadOnly && !lockAcquired && !lockError) {
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation("/v2/verifier")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-light">
            {acquireLockMutation.isPending
              ? "Acquiring exclusive access..."
              : "Preparing application..."}
          </h1>
        </div>
      </main>
    );
  }

  if (!isReadOnly && lockError) {
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation("/v2/verifier")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-light">Unable to Access Application</h1>
        </div>
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-yellow-600" />
            <p className="mb-4 text-muted-foreground">{lockError}</p>
            <Button onClick={() => setLocation("/v2/verifier")}>
              Back to Application List
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (applicationQuery.isLoading || approvalsQuery.isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <Button variant="ghost" onClick={() => setLocation("/v2/verifier")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <p className="text-muted-foreground">Loading application...</p>
      </main>
    );
  }

  if (!application) {
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <Button variant="ghost" onClick={() => setLocation("/v2/verifier")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Application not found.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => setLocation("/v2/verifier")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-light">
              Application Review: {application.name}
            </h1>
            <Badge variant={statusVariant(application.applicationStatus)}>
              {formatLabel(application.applicationStatus)}
            </Badge>
            {application.flaggedForReview && (
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            )}
          </div>
          <p className="break-all text-muted-foreground">
            Application ID: {application.id}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Applicant Name
            </p>
            <p className="text-lg">{application.name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">User ID</p>
            <p className="text-lg">{application.userId}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p className="text-lg">
              {new Date(application.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Last Updated
            </p>
            <p className="text-lg">
              {new Date(application.updatedAt).toLocaleDateString()}
            </p>
          </div>
          {!isReadOnly && (
            <div className="md:col-span-2">
              <Button
                variant="outline"
                disabled={reviewMutation.isPending}
                onClick={() =>
                  reviewMutation.mutate({
                    flaggedForReview: !application.flaggedForReview,
                  })
                }
              >
                {application.flaggedForReview
                  ? "Clear Review Flag"
                  : "Flag for Review"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <span>Service Areas</span>
            {hasPendingProposals && (
              <Badge variant="secondary">
                {pendingProposals.length} proposal(s) need review
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Canonical destinations
            </p>
            {serviceAreas.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {serviceAreas.map((destination) => (
                  <Badge key={destination.id} variant="outline">
                    {formatDestination(destination)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No canonical service areas selected.
              </p>
            )}
          </div>

          {proposals.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                Custom service-area proposals
              </p>
              {proposals.map((proposal) => {
                const draft = getCreateDraft(proposal);
                const resolvedDestination = proposal.resolvedDestinationId
                  ? destinationById.get(proposal.resolvedDestinationId)
                  : null;
                const actionPending =
                  mapProposalMutation.isPending ||
                  createDestinationMutation.isPending ||
                  rejectProposalMutation.isPending;

                return (
                  <div key={proposal.id} className="space-y-4 rounded-md border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{proposal.rawName}</p>
                        <p className="text-sm text-muted-foreground">
                          Normalized: {proposal.normalizedName}
                        </p>
                        {resolvedDestination && (
                          <p className="text-sm text-muted-foreground">
                            Resolved to: {formatDestination(resolvedDestination)}
                          </p>
                        )}
                      </div>
                      <Badge variant={proposalStatusVariant(proposal.status)}>
                        {proposal.status}
                      </Badge>
                    </div>

                    {!isReadOnly && proposal.status === "pending" && (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3 rounded-md bg-muted/40 p-3">
                          <p className="text-sm font-medium">
                            Map to existing destination
                          </p>
                          <Select
                            value={mapSelections[proposal.id] ?? ""}
                            onValueChange={(value) =>
                              setMapSelections((current) => ({
                                ...current,
                                [proposal.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a destination" />
                            </SelectTrigger>
                            <SelectContent>
                              {destinations.map((destination) => (
                                <SelectItem
                                  key={destination.id}
                                  value={String(destination.id)}
                                >
                                  {formatDestination(destination)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionPending}
                            onClick={() => handleMapProposal(proposal)}
                          >
                            Map Proposal
                          </Button>
                        </div>

                        <div className="space-y-3 rounded-md bg-muted/40 p-3">
                          <p className="text-sm font-medium">
                            Create canonical destination
                          </p>
                          <div className="grid gap-2 md:grid-cols-2">
                            <Input
                              value={draft.nameEn}
                              onChange={(event) =>
                                updateCreateDraft(
                                  proposal,
                                  "nameEn",
                                  event.currentTarget.value,
                                )
                              }
                              placeholder="English name"
                            />
                            <Input
                              value={draft.nameZhCn}
                              onChange={(event) =>
                                updateCreateDraft(
                                  proposal,
                                  "nameZhCn",
                                  event.currentTarget.value,
                                )
                              }
                              placeholder="Chinese name"
                            />
                            <Input
                              value={draft.nameJa}
                              onChange={(event) =>
                                updateCreateDraft(
                                  proposal,
                                  "nameJa",
                                  event.currentTarget.value,
                                )
                              }
                              placeholder="Japanese name"
                            />
                            <Input
                              value={draft.prefectureName}
                              onChange={(event) =>
                                updateCreateDraft(
                                  proposal,
                                  "prefectureName",
                                  event.currentTarget.value,
                                )
                              }
                              placeholder="Prefecture / region"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={actionPending}
                              onClick={() =>
                                createDestinationMutation.mutate({
                                  proposal,
                                  draft,
                                })
                              }
                            >
                              Create Destination
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={actionPending}
                              onClick={() =>
                                rejectProposalMutation.mutate(proposal.id)
                              }
                            >
                              Reject Proposal
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasPendingProposals && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
              Resolve all pending service-area proposals before approval.
            </div>
          )}
        </CardContent>
      </Card>

      {application.internalTags && application.internalTags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Application Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {application.internalTags.map((tag, index) => {
              const url = documentUrl(tag);
              return (
                <div key={`${url}-${index}`} className="rounded-md border p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h4 className="font-medium">Document {index + 1}</h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(url, "_blank")}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Open
                    </Button>
                  </div>
                  <div className="h-[70vh] min-h-[420px] w-full rounded-md border">
                    <iframe
                      src={url}
                      className="h-full w-full rounded-md"
                      title={`Application document ${index + 1}`}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {application.qualifications?.certifications && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Qualifications Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(application.qualifications.certifications).map(
              ([key, certification], index) => (
                <div key={key} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{certification.description}</p>
                      <p className="break-all text-sm text-muted-foreground">
                        {certification.proof}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(certification.proof, "_blank")}
                    >
                      View File {index + 1}
                    </Button>
                  </div>
                </div>
              ),
            )}
          </CardContent>
        </Card>
      )}

      {approvals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Approval History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvals
              .slice()
              .sort(
                (left, right) =>
                  new Date(left.createdAt).getTime() -
                  new Date(right.createdAt).getTime(),
              )
              .map((approval) => {
                const response = parseUserResponse(approval.userResponse);
                return (
                  <div key={approval.id} className="rounded-md border p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={actionVariant(approval.adminAction)}>
                        {formatLabel(approval.adminAction)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(approval.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {approval.note && <p className="text-sm">{approval.note}</p>}
                    {response?.description && (
                      <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                        {response.description}
                      </p>
                    )}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {!isReadOnly && application.applicationStatus === "pending" && (
        <Card>
          <CardHeader>
            <CardTitle>Review Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              rows={4}
              placeholder="Enter review notes..."
            />
            <Select
              value={selectedAction}
              onValueChange={(value) =>
                setSelectedAction(value as AdminActionType)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an action..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">Approve Application</SelectItem>
                <SelectItem value="reject">Reject Application</SelectItem>
                <SelectItem value="require_more_info">
                  Require More Information
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={
                !selectedAction ||
                submitApprovalMutation.isPending ||
                (selectedAction === "approve" && hasPendingProposals)
              }
              onClick={handleSubmitApproval}
            >
              <Send className="mr-2 h-4 w-4" />
              {submitApprovalMutation.isPending ? "Submitting..." : "Submit Review"}
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
