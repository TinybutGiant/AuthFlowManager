import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ClipboardList, Download, FileText, GraduationCap, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage, tokenManager } from "@/lib/queryClient";
import {
  AdminActivityLog,
  AdminActivityType,
  CheckInBundle,
  FeedbackMeetingOccurrence,
  FeedbackMeetingStatus,
  FeedbackSlot,
  ROLE_DISPLAY_NAMES,
  TraineeDocument,
  TraineeEngagement,
} from "@/types/admin";

const ACTIVITY_TYPE_LABELS: Record<AdminActivityType, string> = {
  office_hour: "Office Hour",
  training: "Training",
  learning: "Learning",
  research: "Research",
  documentation: "Documentation",
  draft_work: "Supervised Draft Work",
  meeting: "Meeting",
  other: "Other",
};

const activityTypes = Object.keys(ACTIVITY_TYPE_LABELS) as AdminActivityType[];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEETING_STATUS_LABELS: Record<FeedbackMeetingStatus, string> = {
  scheduled: "Scheduled",
  absence_requested: "Absence Requested",
  excused: "Excused Absence",
  completed: "Completed",
  missed: "Missed",
  cancelled: "Cancelled",
};

interface FeedbackMeetingTimeSelection {
  slotId: string;
  startTime: string;
  endTime: string;
}

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value).replace(/_/g, " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function getOfferLetterStatusVariant(status: string) {
  if (status === "accepted") return "default" as const;
  if (status === "voided" || status === "declined") return "destructive" as const;
  if (status === "viewed") return "outline" as const;
  return "secondary" as const;
}

function getMeetingStatusVariant(status: FeedbackMeetingStatus) {
  if (status === "excused" || status === "completed") return "default" as const;
  if (status === "missed" || status === "cancelled") return "destructive" as const;
  if (status === "absence_requested") return "outline" as const;
  return "secondary" as const;
}

function formatFeedbackSlot(slot: FeedbackSlot | { dayOfWeek: number; startTime: string; endTime: string; timezone: string }) {
  const dayOfWeek = "day_of_week" in slot ? slot.day_of_week : slot.dayOfWeek;
  const startTime = "start_time" in slot ? slot.start_time : slot.startTime;
  const endTime = "end_time" in slot ? slot.end_time : slot.endTime;
  return `${DAY_LABELS[dayOfWeek]} ${startTime}-${endTime} ${slot.timezone}`;
}

function defaultFeedbackMeetingTimeSelection(): FeedbackMeetingTimeSelection {
  return {
    slotId: "",
    startTime: "",
    endTime: "",
  };
}

export default function TraineeWorkspace() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activityType, setActivityType] = useState<AdminActivityType | "">("");
  const [activityDate, setActivityDate] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [summary, setSummary] = useState("");
  const [learningObjective, setLearningObjective] = useState("");
  const [endReason, setEndReason] = useState("");
  const [offerAcceptedAcknowledgement, setOfferAcceptedAcknowledgement] = useState(false);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState("1");
  const [feedbackMeetingSelections, setFeedbackMeetingSelections] = useState<FeedbackMeetingTimeSelection[]>([
    defaultFeedbackMeetingTimeSelection(),
  ]);
  const [feedbackTimezone, setFeedbackTimezone] = useState(() => (
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  ));
  const [scheduleChangeNote, setScheduleChangeNote] = useState("");
  const [absenceForms, setAbsenceForms] = useState<Record<number, { reason: string; note: string }>>({});

  const engagementQuery = useQuery<TraineeEngagement | null>({
    queryKey: ["/api/trainee/me/engagement"],
    retry: false,
  });

  const documentsQuery = useQuery<TraineeDocument[]>({
    queryKey: ["/api/trainee/me/documents"],
    retry: false,
  });

  const engagement = engagementQuery.data;
  const documents = documentsQuery.data ?? [];
  const offerLetter = documents.find((document) => document.document_type === "offer_letter" && document.status !== "voided")
    ?? documents.find((document) => document.document_type === "offer_letter");
  const hasAcceptedOffer = offerLetter?.status === "accepted" || Boolean(offerLetter?.accepted_at);
  const activityLogsQuery = useQuery<AdminActivityLog[]>({
    queryKey: ["/api/trainee/me/activity-logs"],
    retry: false,
    enabled: hasAcceptedOffer,
  });
  const checkInsQuery = useQuery<CheckInBundle>({
    queryKey: ["/api/trainee/me/check-ins"],
    retry: false,
    enabled: hasAcceptedOffer,
  });
  const logs = hasAcceptedOffer ? activityLogsQuery.data ?? [] : [];
  const checkIns = checkInsQuery.data;
  const feedbackSlots = checkIns?.available_slots ?? [];
  const selectedSchedule = checkIns?.selected_schedule ?? null;
  const meetingOccurrences = checkIns?.meeting_occurrences ?? [];
  const upcomingMeetingOccurrences = meetingOccurrences.filter((occurrence) => (
    occurrence.status !== "cancelled" && occurrence.occurrence_date >= new Date().toISOString().slice(0, 10)
  ));
  const canSubmitActivity = hasAcceptedOffer && engagement?.status === "active";
  const canEndEngagement = Boolean(engagement && !["ended", "cancelled"].includes(engagement.status));

  const createActivityLogMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/trainee/me/activity-logs", {
        activityType,
        activityDate,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        summary,
        learningObjective: learningObjective.trim() || null,
      });
      return response.json();
    },
    onSuccess: () => {
      setActivityType("");
      setActivityDate("");
      setDurationMinutes("");
      setSummary("");
      setLearningObjective("");
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/activity-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
      toast({
        title: "Activity log submitted",
        description: "Your activity log has been recorded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not submit activity log",
        description: getApiErrorMessage(error, "Please check the activity log and try again."),
        variant: "destructive",
      });
    },
  });

  const confirmFeedbackScheduleMutation = useMutation({
    mutationFn: async () => {
      const selections = feedbackMeetingSelections.map((selection) => ({
        slotId: Number(selection.slotId),
        startTime: selection.startTime,
        endTime: selection.endTime,
      }));
      const response = await apiRequest("POST", "/api/trainee/me/feedback-schedule", {
        frequencyPerWeek: Number(frequencyPerWeek),
        selections,
        timezone: feedbackTimezone,
      });
      return response.json() as Promise<CheckInBundle>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/check-ins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
      toast({
        title: "Feedback meeting schedule confirmed",
        description: "Your recurring check-in schedule has been recorded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not confirm feedback meeting schedule",
        description: getApiErrorMessage(error, "Please select available feedback meeting slots and try again."),
        variant: "destructive",
      });
    },
  });

  const requestScheduleChangeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/trainee/me/feedback-schedule/change-request", {
        note: scheduleChangeNote.trim() || null,
      });
      return response.json();
    },
    onSuccess: () => {
      setScheduleChangeNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/check-ins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
      toast({
        title: "Schedule change requested",
        description: "Your supervisor can review the request from the engagement record.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not request schedule change",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const requestAbsenceMutation = useMutation({
    mutationFn: async (occurrenceId: number) => {
      const form = absenceForms[occurrenceId] ?? { reason: "", note: "" };
      const response = await apiRequest("POST", `/api/trainee/me/feedback-meetings/${occurrenceId}/absence-request`, {
        reason: form.reason,
        note: form.note.trim() || null,
      });
      return response.json() as Promise<FeedbackMeetingOccurrence>;
    },
    onSuccess: (occurrence) => {
      setAbsenceForms((current) => ({
        ...current,
        [occurrence.id]: { reason: "", note: "" },
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/check-ins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
      toast({
        title: "Absence request submitted",
        description: "Your feedback meeting absence request has been recorded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not submit absence request",
        description: getApiErrorMessage(error, "Please add a reason and try again."),
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmitActivity) return;
    createActivityLogMutation.mutate();
  };

  const endEngagementMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/trainee/me/end-engagement", {
        reason: endReason.trim() || null,
      });
      return response.json() as Promise<{ status: "ended" | "cancelled" | "already_ended" }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.status === "already_ended" ? "Engagement already ended" : "Trainee access ended",
        description: "Your trainee access has been disabled. You will be returned to sign in.",
      });
      queryClient.clear();
      setTimeout(() => {
        tokenManager.removeToken();
        window.location.href = "/";
      }, 1200);
    },
    onError: (error) => {
      toast({
        title: "Could not end trainee access",
        description: getApiErrorMessage(error, "Please try again or contact your supervisor."),
        variant: "destructive",
      });
    },
  });

  const markOfferLetterViewedMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await apiRequest("POST", `/api/trainee/me/documents/${documentId}/view`);
      return response.json() as Promise<TraineeDocument>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
    },
  });

  const acceptOfferLetterMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await apiRequest("POST", `/api/trainee/me/documents/${documentId}/accept`);
      return response.json() as Promise<TraineeDocument>;
    },
    onSuccess: () => {
      setOfferAcceptedAcknowledgement(false);
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/lifecycle-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trainee/me/engagement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Offer letter accepted",
        description: "Your acceptance has been recorded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not accept offer letter",
        description: getApiErrorMessage(error, "Please try again or contact your supervisor."),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (offerLetter?.status === "sent" && !markOfferLetterViewedMutation.isPending) {
      markOfferLetterViewedMutation.mutate(offerLetter.id);
    }
  }, [offerLetter?.id, offerLetter?.status]);

  const downloadOfferLetter = async (document: TraineeDocument) => {
    try {
      const token = tokenManager.getToken();
      const response = await fetch(`/api/trainee/me/documents/${document.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `offer-letter-v${document.version}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Could not download offer letter",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  const updateSelectedFeedbackSlot = (index: number, value: string) => {
    setFeedbackMeetingSelections((current) => {
      const next = [...current];
      next[index] = {
        slotId: value,
        startTime: "",
        endTime: "",
      };
      return next;
    });
  };

  const updateFeedbackMeetingSelectionTime = (
    index: number,
    field: "startTime" | "endTime",
    value: string,
  ) => {
    setFeedbackMeetingSelections((current) => {
      const next = [...current];
      next[index] = {
        ...(next[index] ?? defaultFeedbackMeetingTimeSelection()),
        [field]: value,
      };
      return next;
    });
  };

  const updateFrequency = (value: string) => {
    setFrequencyPerWeek(value);
    setFeedbackMeetingSelections((current) => {
      const count = Number(value);
      return Array.from({ length: count }, (_, index) => current[index] ?? defaultFeedbackMeetingTimeSelection());
    });
  };

  const updateAbsenceForm = (occurrenceId: number, field: "reason" | "note", value: string) => {
    setAbsenceForms((current) => ({
      ...current,
      [occurrenceId]: {
        reason: current[occurrenceId]?.reason ?? "",
        note: current[occurrenceId]?.note ?? "",
        [field]: value,
      },
    }));
  };

  const feedbackSlotForSelection = (selection: FeedbackMeetingTimeSelection) => (
    feedbackSlots.find((slot) => String(slot.id) === selection.slotId)
  );

  useEffect(() => {
    const firstSelectedSlot = feedbackMeetingSelections
      .map((selection) => feedbackSlotForSelection(selection))
      .find(Boolean);
    if (firstSelectedSlot && feedbackTimezone !== firstSelectedSlot.timezone) {
      setFeedbackTimezone(firstSelectedSlot.timezone);
    }
  }, [feedbackMeetingSelections, feedbackSlots, feedbackTimezone]);

  const feedbackSelectionError = (selection: FeedbackMeetingTimeSelection) => {
    const slot = feedbackSlotForSelection(selection);
    if (!selection.slotId) return "Select an available range.";
    if (!slot) return "Selected range is no longer available.";
    if (!selection.startTime || !selection.endTime) return "Enter a Feedback Meeting start and end time.";
    if (selection.endTime <= selection.startTime) return "End time must be after start time.";
    if (selection.startTime < slot.start_time || selection.endTime > slot.end_time) {
      return `Choose a time within ${slot.start_time}-${slot.end_time}.`;
    }
    if (slot.timezone !== feedbackTimezone.trim()) {
      return "Selected ranges must use the same timezone.";
    }
    return "";
  };

  const selectedMeetingTimeKeys = feedbackMeetingSelections.map((selection) => {
    const slot = feedbackSlotForSelection(selection);
    return `${slot?.day_of_week ?? selection.slotId}:${selection.startTime}-${selection.endTime}:${slot?.timezone ?? feedbackTimezone}`;
  });
  const hasDuplicateFeedbackMeetingTime = new Set(selectedMeetingTimeKeys).size !== selectedMeetingTimeKeys.length;
  const hasOverlappingFeedbackMeetingTime = feedbackMeetingSelections.some((selection, index) => {
    const slot = feedbackSlotForSelection(selection);
    if (!slot || !selection.startTime || !selection.endTime) return false;
    return feedbackMeetingSelections.some((comparison, comparisonIndex) => {
      if (comparisonIndex <= index) return false;
      const comparisonSlot = feedbackSlotForSelection(comparison);
      if (!comparisonSlot || !comparison.startTime || !comparison.endTime) return false;
      const sameLocalMeetingDay = slot.day_of_week === comparisonSlot.day_of_week && slot.timezone === comparisonSlot.timezone;
      return sameLocalMeetingDay && selection.startTime < comparison.endTime && comparison.startTime < selection.endTime;
    });
  });
  const feedbackSelectionErrors = feedbackMeetingSelections.map(feedbackSelectionError);
  const canConfirmFeedbackSchedule =
    hasAcceptedOffer &&
    feedbackMeetingSelections.length === Number(frequencyPerWeek) &&
    feedbackSelectionErrors.every((error) => !error) &&
    !hasDuplicateFeedbackMeetingTime &&
    !hasOverlappingFeedbackMeetingTime &&
    Boolean(feedbackTimezone.trim());

  const workspaceError =
    engagementQuery.isError ||
    documentsQuery.isError ||
    (hasAcceptedOffer && (activityLogsQuery.isError || checkInsQuery.isError));

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-trainee-workspace-title">
          Trainee Workspace
        </h1>
        <p className="text-muted-foreground">View your engagement, feedback meetings, and learning activity logs.</p>
      </div>

      {workspaceError && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-destructive" data-testid="text-trainee-workspace-error">
            Could not load your trainee workspace.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="offer-letter">Offer Letter</TabsTrigger>
          <TabsTrigger value="check-ins">Check-ins & Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {!documentsQuery.isLoading && !hasAcceptedOffer && (
            <Card className="border-primary/40">
              <CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-offer-portal-state">
                Please review and accept your offer letter to unlock the Trainee Workspace.
              </CardContent>
            </Card>
          )}

          {hasAcceptedOffer && engagement?.status !== "active" && (
            <Card className="border-primary/40">
              <CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-offer-accepted-pending-active">
                Your offer has been accepted. Learning Activity Logs will be available when your engagement becomes active.
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Current Engagement
                </CardTitle>
              </CardHeader>
              <CardContent>
                {engagementQuery.isLoading ? (
                  <p className="text-muted-foreground">Loading engagement...</p>
                ) : !engagement ? (
                  <p className="text-muted-foreground">No current engagement is available yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="card-current-engagement">
                    <div>
                      <p className="text-sm text-muted-foreground">Engagement Type</p>
                      <p className="font-medium capitalize">{formatValue(engagement.engagement_type)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge variant={engagement.status === "active" ? "default" : "secondary"}>{engagement.status}</Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Start Date</p>
                      <p className="font-medium">{formatDate(engagement.start_date)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">End Date</p>
                      <p className="font-medium">{formatDate(engagement.end_date)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Schedule Type</p>
                      <p className="font-medium capitalize">{formatValue(engagement.schedule_type)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Expected Hours Per Week</p>
                      <p className="font-medium">{formatValue(engagement.expected_hours_per_week)}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-sm text-muted-foreground">Work Scope</p>
                      <p className="font-medium whitespace-pre-wrap">{formatValue(engagement.work_scope)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="h-5 w-5" />
                  Supervisor
                </CardTitle>
              </CardHeader>
              <CardContent>
                {engagement?.supervisor ? (
                  <div className="space-y-2" data-testid="card-supervisor-details">
                    <p className="font-medium">{engagement.supervisor.name}</p>
                    <p className="text-sm text-muted-foreground">{engagement.supervisor.email}</p>
                    <Badge variant="outline">{ROLE_DISPLAY_NAMES[engagement.supervisor.role] ?? engagement.supervisor.role}</Badge>
                  </div>
                ) : (
                  <p className="text-muted-foreground" data-testid="text-supervisor-fallback">
                    Supervisor information is not available yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="offer-letter" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Offer Letter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {documentsQuery.isLoading ? (
                <p className="text-muted-foreground">Loading offer letter...</p>
              ) : !offerLetter ? (
                <p className="text-muted-foreground" data-testid="text-no-offer-letter">
                  No offer letter is available yet.
                </p>
              ) : offerLetter.status === "voided" ? (
                <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="text-offer-letter-voided">
                  This offer letter is no longer available.
                </p>
              ) : (
                <div className="space-y-4" data-testid="card-offer-letter">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-medium">{offerLetter.title}</h2>
                        <Badge variant={getOfferLetterStatusVariant(offerLetter.status)}>{offerLetter.status}</Badge>
                        <Badge variant="outline">v{offerLetter.version}</Badge>
                      </div>
                      {offerLetter.accepted_at && (
                        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4" />
                          Accepted {formatDateTime(offerLetter.accepted_at)}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => downloadOfferLetter(offerLetter)}
                      data-testid="button-download-offer-letter"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </Button>
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-4">
                    <p className="whitespace-pre-wrap text-sm leading-6">{offerLetter.body}</p>
                  </div>

                  {offerLetter.status === "accepted" ? (
                    <Button disabled data-testid="button-offer-letter-accepted">
                      Accepted
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="offer-letter-acknowledgement"
                          checked={offerAcceptedAcknowledgement}
                          onCheckedChange={(checked) => setOfferAcceptedAcknowledgement(checked === true)}
                          data-testid="checkbox-offer-letter-acknowledgement"
                        />
                        <Label htmlFor="offer-letter-acknowledgement" className="text-sm">
                          I have read and accept this offer letter.
                        </Label>
                      </div>
                      <Button
                        onClick={() => acceptOfferLetterMutation.mutate(offerLetter.id)}
                        disabled={!offerAcceptedAcknowledgement || acceptOfferLetterMutation.isPending}
                        data-testid="button-accept-offer-letter"
                      >
                        {acceptOfferLetterMutation.isPending ? "Accepting..." : "Accept Offer Letter"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="check-ins" className="space-y-6">
          {!hasAcceptedOffer ? (
            <Card className="border-primary/40">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Accept your offer letter before setting up feedback meetings or submitting Learning Activity Logs.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Card className="xl:col-span-1">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5" />
                      Feedback Meeting Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {checkInsQuery.isLoading ? (
                      <p className="text-muted-foreground">Loading feedback meeting options...</p>
                    ) : selectedSchedule ? (
                      <div className="space-y-4" data-testid="card-feedback-schedule">
                        <div className="rounded-md border border-border p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant={selectedSchedule.status === "confirmed" ? "default" : "outline"}>
                              {selectedSchedule.status === "change_requested" ? "Change Requested" : "Confirmed"}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {selectedSchedule.frequency_per_week} per week
                            </span>
                          </div>
                          <div className="space-y-1 text-sm">
                            {selectedSchedule.selected_slots.map((slot) => (
                              <p key={slot.id}>{formatFeedbackSlot(slot)}</p>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="schedule-change-note">Request Schedule Change</Label>
                          <Textarea
                            id="schedule-change-note"
                            value={scheduleChangeNote}
                            onChange={(event) => setScheduleChangeNote(event.target.value)}
                            maxLength={1000}
                            placeholder="Optional note"
                            data-testid="textarea-schedule-change-note"
                          />
                          <Button
                            variant="outline"
                            onClick={() => requestScheduleChangeMutation.mutate()}
                            disabled={requestScheduleChangeMutation.isPending || selectedSchedule.status === "change_requested"}
                            data-testid="button-request-schedule-change"
                          >
                            {requestScheduleChangeMutation.isPending ? "Requesting..." : "Request Change"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4" data-testid="form-feedback-schedule">
                        <p className="text-sm text-muted-foreground">
                          Select recurring Feedback Meeting times from your supervisor's available slots. This required setup should be completed within 7 days after accepting the offer.
                        </p>
                        <div>
                          <Label htmlFor="feedback-frequency">Frequency</Label>
                          <Select value={frequencyPerWeek} onValueChange={updateFrequency}>
                            <SelectTrigger id="feedback-frequency" data-testid="select-feedback-frequency">
                              <SelectValue placeholder="Select frequency" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1 per week</SelectItem>
                              <SelectItem value="2">2 per week</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="feedback-timezone">Timezone</Label>
                          <Input
                            id="feedback-timezone"
                            value={feedbackTimezone}
                            readOnly
                            data-testid="input-feedback-timezone"
                          />
                        </div>
                        {feedbackMeetingSelections.map((selection, index) => {
                          const selectedSlot = feedbackSlotForSelection(selection);
                          const selectionError = feedbackSelectionErrors[index];
                          const shouldShowSelectionError = Boolean(selection.slotId || selection.startTime || selection.endTime);
                          return (
                            <div key={index} className="space-y-2">
                              <Label>Feedback Meeting Range {index + 1}</Label>
                              <Select
                                value={selection.slotId}
                                onValueChange={(value) => updateSelectedFeedbackSlot(index, value)}
                              >
                                <SelectTrigger data-testid={`select-feedback-slot-${index}`}>
                                  <SelectValue placeholder="Select available range" />
                                </SelectTrigger>
                                <SelectContent>
                                  {feedbackSlots.map((slot) => (
                                    <SelectItem key={slot.id} value={String(slot.id)}>
                                      {formatFeedbackSlot(slot)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {selectedSlot && (
                                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                                  <p className="text-sm text-muted-foreground">
                                    Available range: {selectedSlot.start_time}-{selectedSlot.end_time} {selectedSlot.timezone}
                                  </p>
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div>
                                      <Label htmlFor={`feedback-meeting-start-${index}`}>Meeting Start</Label>
                                      <Input
                                        id={`feedback-meeting-start-${index}`}
                                        type="time"
                                        min={selectedSlot.start_time}
                                        max={selectedSlot.end_time}
                                        value={selection.startTime}
                                        onChange={(event) => updateFeedbackMeetingSelectionTime(index, "startTime", event.target.value)}
                                        data-testid={`input-feedback-meeting-start-${index}`}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor={`feedback-meeting-end-${index}`}>Meeting End</Label>
                                      <Input
                                        id={`feedback-meeting-end-${index}`}
                                        type="time"
                                        min={selectedSlot.start_time}
                                        max={selectedSlot.end_time}
                                        value={selection.endTime}
                                        onChange={(event) => updateFeedbackMeetingSelectionTime(index, "endTime", event.target.value)}
                                        data-testid={`input-feedback-meeting-end-${index}`}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                              {selectionError && shouldShowSelectionError && (
                                <p className="text-sm text-destructive" data-testid={`text-feedback-meeting-selection-error-${index}`}>
                                  {selectionError}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {hasDuplicateFeedbackMeetingTime && feedbackSelectionErrors.every((error) => !error) && (
                          <p className="text-sm text-destructive">Selected Feedback Meeting times must be unique.</p>
                        )}
                        {hasOverlappingFeedbackMeetingTime && feedbackSelectionErrors.every((error) => !error) && (
                          <p className="text-sm text-destructive">Selected Feedback Meeting times must not overlap.</p>
                        )}
                        {feedbackSlots.length === 0 && (
                          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                            No supervisor-defined Feedback Meeting slots are available yet.
                          </p>
                        )}
                        <Button
                          onClick={() => confirmFeedbackScheduleMutation.mutate()}
                          disabled={!canConfirmFeedbackSchedule || confirmFeedbackScheduleMutation.isPending}
                          data-testid="button-confirm-feedback-schedule"
                        >
                          {confirmFeedbackScheduleMutation.isPending ? "Confirming..." : "Confirm Feedback Meeting Schedule"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5" />
                      Upcoming Feedback Meetings
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {checkInsQuery.isLoading ? (
                      <p className="text-muted-foreground">Loading feedback meetings...</p>
                    ) : upcomingMeetingOccurrences.length === 0 ? (
                      <p className="text-muted-foreground" data-testid="text-no-feedback-meetings">
                        No upcoming Feedback Meetings are scheduled yet.
                      </p>
                    ) : (
                      <div className="space-y-4" data-testid="list-feedback-meetings">
                        {upcomingMeetingOccurrences.map((occurrence) => {
                          const form = absenceForms[occurrence.id] ?? { reason: "", note: "" };
                          const canRequestAbsence = occurrence.status === "scheduled";
                          return (
                            <div key={occurrence.id} className="rounded-md border border-border p-4">
                              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">{formatDate(occurrence.occurrence_date)}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {occurrence.start_time}-{occurrence.end_time} {occurrence.timezone}
                                  </p>
                                </div>
                                <Badge variant={getMeetingStatusVariant(occurrence.status)}>
                                  {MEETING_STATUS_LABELS[occurrence.status]}
                                </Badge>
                              </div>
                              {occurrence.absence_reason && (
                                <p className="mb-3 rounded-md bg-muted/40 p-3 text-sm">
                                  Absence Request: {occurrence.absence_reason}
                                </p>
                              )}
                              {canRequestAbsence && (
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                                  <Input
                                    value={form.reason}
                                    onChange={(event) => updateAbsenceForm(occurrence.id, "reason", event.target.value)}
                                    placeholder="Absence request reason"
                                    data-testid={`input-absence-reason-${occurrence.id}`}
                                  />
                                  <Input
                                    value={form.note}
                                    onChange={(event) => updateAbsenceForm(occurrence.id, "note", event.target.value)}
                                    placeholder="Optional note"
                                    data-testid={`input-absence-note-${occurrence.id}`}
                                  />
                                  <Button
                                    variant="outline"
                                    onClick={() => requestAbsenceMutation.mutate(occurrence.id)}
                                    disabled={!form.reason.trim() || requestAbsenceMutation.isPending}
                                    data-testid={`button-request-absence-${occurrence.id}`}
                                  >
                                    Absence Request
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Card className="xl:col-span-1">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ClipboardList className="h-5 w-5" />
                      Learning Activity Log
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-activity-log">
                      <p className="text-sm text-muted-foreground">
                        Record training, office hours, learning activities, or supervised draft work for your engagement record.
                      </p>

                      {!canSubmitActivity && (
                        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="text-activity-disabled">
                          Learning Activity Log submission is available when your engagement is active.
                        </p>
                      )}

                      <div>
                        <Label htmlFor="activity-type">Activity Type</Label>
                        <Select value={activityType} onValueChange={(value) => setActivityType(value as AdminActivityType)}>
                          <SelectTrigger id="activity-type" data-testid="select-activity-type">
                            <SelectValue placeholder="Select activity type" />
                          </SelectTrigger>
                          <SelectContent>
                            {activityTypes.map((type) => (
                              <SelectItem key={type} value={type}>{ACTIVITY_TYPE_LABELS[type]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="activity-date">Activity Date</Label>
                        <Input
                          id="activity-date"
                          type="date"
                          value={activityDate}
                          onChange={(event) => setActivityDate(event.target.value)}
                          data-testid="input-activity-date"
                        />
                      </div>

                      <div>
                        <Label htmlFor="duration-minutes">Duration Minutes</Label>
                        <Input
                          id="duration-minutes"
                          type="number"
                          min="1"
                          max="480"
                          value={durationMinutes}
                          onChange={(event) => setDurationMinutes(event.target.value)}
                          placeholder="Optional"
                          data-testid="input-duration-minutes"
                        />
                      </div>

                      <div>
                        <Label htmlFor="activity-summary">Summary</Label>
                        <Textarea
                          id="activity-summary"
                          value={summary}
                          onChange={(event) => setSummary(event.target.value)}
                          maxLength={2000}
                          placeholder="Summarize the activity"
                          data-testid="textarea-activity-summary"
                        />
                      </div>

                      <div>
                        <Label htmlFor="learning-objective">Learning Objective</Label>
                        <Textarea
                          id="learning-objective"
                          value={learningObjective}
                          onChange={(event) => setLearningObjective(event.target.value)}
                          maxLength={1000}
                          placeholder="Optional"
                          data-testid="textarea-learning-objective"
                        />
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={!canSubmitActivity || createActivityLogMutation.isPending}
                        data-testid="button-submit-activity-log"
                      >
                        {createActivityLogMutation.isPending ? "Submitting..." : "Submit Learning Activity Log"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ClipboardList className="h-5 w-5" />
                      Recent Learning Activity Logs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {activityLogsQuery.isLoading ? (
                      <p className="text-muted-foreground">Loading Learning Activity Logs...</p>
                    ) : logs.length === 0 ? (
                      <p className="text-muted-foreground" data-testid="text-no-activity-logs">No Learning Activity Logs submitted yet.</p>
                    ) : (
                      <div className="space-y-4" data-testid="list-activity-logs">
                        {logs.map((log) => (
                          <div key={log.id} className="rounded-md border border-border p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                              <div>
                                <p className="font-medium">{ACTIVITY_TYPE_LABELS[log.activity_type]}</p>
                                <p className="text-sm text-muted-foreground">{formatDate(log.activity_date)}</p>
                              </div>
                              <Badge variant={log.status === "reviewed" ? "default" : "secondary"}>{log.status}</Badge>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{log.summary}</p>
                            {log.duration_minutes && (
                              <p className="text-xs text-muted-foreground mt-2">Duration: {log.duration_minutes} minutes</p>
                            )}
                            {log.learning_objective && (
                              <p className="text-xs text-muted-foreground mt-2">Learning objective: {log.learning_objective}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {canEndEngagement && (
        <Card>
          <CardHeader>
            <CardTitle>End My Trainee Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use this if you need to end your trainee participation early. This will disable your trainee access.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" data-testid="button-open-self-offboarding">
                  End My Trainee Access
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End My Trainee Access</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will end your trainee participation and disable your trainee access. Your records will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="end-reason">Reason</Label>
                  <Textarea
                    id="end-reason"
                    value={endReason}
                    onChange={(event) => setEndReason(event.target.value)}
                    maxLength={1000}
                    placeholder="Optional"
                    data-testid="textarea-self-offboarding-reason"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={endEngagementMutation.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      endEngagementMutation.mutate();
                    }}
                    disabled={endEngagementMutation.isPending}
                    data-testid="button-confirm-self-offboarding"
                  >
                    {endEngagementMutation.isPending ? "Ending..." : "End My Trainee Access"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
