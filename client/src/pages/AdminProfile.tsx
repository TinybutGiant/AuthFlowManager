import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight, CalendarDays, Delete, CheckCircle, Download, Edit, Eye, FileText, RefreshCw, Send, XCircle } from "lucide-react";
import {
  AdminEngagement,
  AdminEngagementDocument,
  AdminLifecycleEvent,
  AdminUser,
  CheckInBundle,
  FeedbackMeetingStatus,
  FeedbackSlot,
  ROLE_DISPLAY_NAMES,
} from "@/types/admin";
import { apiRequest, getApiErrorMessage, tokenManager } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EngagementEditForm {
  engagementType: string;
  scheduleType: string;
  workAuthorizationType: string;
  startDate: string;
  endDate: string;
  supervisorAdminId: string;
  positionTitle: string;
  schoolName: string;
  programOrMajor: string;
  responseDeadline: string;
  workLocation: string;
  expectedHoursPerWeek: string;
  workScope: string;
}

interface ProfileEditForm {
  name: string;
  email: string;
}

interface FeedbackSlotForm {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  timezone: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEETING_STATUS_LABELS: Record<FeedbackMeetingStatus, string> = {
  scheduled: "Scheduled",
  absence_requested: "Absence Requested",
  excused: "Excused Absence",
  completed: "Completed",
  missed: "Missed",
  cancelled: "Cancelled",
};

function defaultFeedbackSlotForm(): FeedbackSlotForm {
  return {
    dayOfWeek: "1",
    startTime: "10:00",
    endTime: "10:30",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function formatFeedbackSlot(slot: FeedbackSlot | { dayOfWeek: number; startTime: string; endTime: string; timezone: string }) {
  const dayOfWeek = "day_of_week" in slot ? slot.day_of_week : slot.dayOfWeek;
  const startTime = "start_time" in slot ? slot.start_time : slot.startTime;
  const endTime = "end_time" in slot ? slot.end_time : slot.endTime;
  return `${DAY_LABELS[dayOfWeek]} ${startTime}-${endTime} ${slot.timezone}`;
}

function engagementToEditForm(engagement: AdminEngagement): EngagementEditForm {
  return {
    engagementType: engagement.engagementType,
    scheduleType: engagement.scheduleType ?? "none",
    workAuthorizationType: engagement.workAuthorizationType,
    startDate: engagement.startDate ?? "",
    endDate: engagement.endDate ?? "",
    supervisorAdminId: engagement.supervisorAdminId ? String(engagement.supervisorAdminId) : "none",
    positionTitle: engagement.positionTitle ?? "",
    schoolName: engagement.schoolName ?? "",
    programOrMajor: engagement.programOrMajor ?? "",
    responseDeadline: engagement.responseDeadline ?? "",
    workLocation: engagement.workLocation ?? "",
    expectedHoursPerWeek: engagement.expectedHoursPerWeek === null || engagement.expectedHoursPerWeek === undefined
      ? ""
      : String(engagement.expectedHoursPerWeek),
    workScope: engagement.workScope ?? "",
  };
}

export default function AdminProfile() {
  const params = useParams();
  const adminId = params.id ? parseInt(params.id) : undefined;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [previewDocument, setPreviewDocument] = useState<AdminEngagementDocument | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState<ProfileEditForm | null>(null);
  const [editingEngagement, setEditingEngagement] = useState<AdminEngagement | null>(null);
  const [engagementEditForm, setEngagementEditForm] = useState<EngagementEditForm | null>(null);
  const [feedbackSlotForms, setFeedbackSlotForms] = useState<Record<number, FeedbackSlotForm>>({});

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

  const { data: allAdmins = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!adminId,
    retry: false,
  });

  const engagementDocumentQueryKey = [
    "/api/admin/users",
    adminId,
    "engagement-documents",
    engagements.map((engagement) => engagement.id).join(","),
  ];

  const { data: documentsByEngagement = {} } = useQuery<Record<number, AdminEngagementDocument[]>>({
    queryKey: engagementDocumentQueryKey,
    enabled: engagements.length > 0,
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(
        engagements.map(async (engagement) => {
          const response = await apiRequest("GET", `/api/admin/engagements/${engagement.id}/documents`);
          const documents = await response.json() as AdminEngagementDocument[];
          return [engagement.id, documents] as const;
        })
      );
      return Object.fromEntries(entries);
    },
  });

  const checkInQueryKey = [
    "/api/admin/users",
    adminId,
    "check-ins",
    engagements.map((engagement) => engagement.id).join(","),
  ];

  const { data: checkInsByEngagement = {} } = useQuery<Record<number, CheckInBundle>>({
    queryKey: checkInQueryKey,
    enabled: engagements.length > 0,
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(
        engagements.map(async (engagement) => {
          const response = await apiRequest("GET", `/api/admin/engagements/${engagement.id}/check-ins`);
          const checkIns = await response.json() as CheckInBundle;
          return [engagement.id, checkIns] as const;
        })
      );
      return Object.fromEntries(entries);
    },
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

  const invalidateOfferLetterQueries = () => {
    queryClient.invalidateQueries({ queryKey: engagementDocumentQueryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "lifecycle-events"] });
  };

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!admin || !profileEditForm) {
        throw new Error("Open the profile editor before saving changes.");
      }

      const payload = {
        name: profileEditForm.name.trim(),
        email: profileEditForm.email.trim(),
      };

      const response = await apiRequest("PUT", `/api/admin/users/${admin.id}`, payload);
      return response.json() as Promise<AdminUser>;
    },
    onSuccess: (updatedAdmin) => {
      queryClient.setQueryData(["/api/admin/users", adminId], updatedAdmin);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId] });
      setEditingProfile(false);
      setProfileEditForm(null);
      toast({
        title: "Profile updated",
        description: "The saved admin profile information has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update profile",
        description: getApiErrorMessage(error, "Please check the profile fields and try again."),
        variant: "destructive",
      });
    },
  });

  const sendOfferLetterMutation = useMutation({
    mutationFn: async (document: AdminEngagementDocument) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${document.engagement_id}/documents/${document.id}/send`,
      );
      return response.json() as Promise<AdminEngagementDocument>;
    },
    onSuccess: () => {
      invalidateOfferLetterQueries();
      toast({
        title: "Offer letter sent",
        description: "The trainee has been notified to review it in the workspace.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not send offer letter",
        description: getApiErrorMessage(error, "Please verify email delivery and try again."),
        variant: "destructive",
      });
    },
  });

  const regenerateOfferLetterMutation = useMutation({
    mutationFn: async (document: AdminEngagementDocument) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${document.engagement_id}/documents/${document.id}/regenerate-pdf`,
      );
      return response.json() as Promise<AdminEngagementDocument>;
    },
    onSuccess: () => {
      invalidateOfferLetterQueries();
      toast({
        title: "PDF regenerated",
        description: "The private offer letter artifact has been refreshed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not regenerate PDF",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const voidOfferLetterMutation = useMutation({
    mutationFn: async (document: AdminEngagementDocument) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${document.engagement_id}/documents/${document.id}/void`,
      );
      return response.json() as Promise<AdminEngagementDocument>;
    },
    onSuccess: () => {
      invalidateOfferLetterQueries();
      toast({
        title: "Offer letter voided",
        description: "The trainee can no longer accept this offer letter.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not void offer letter",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const updateEngagementMutation = useMutation({
    mutationFn: async () => {
      if (!editingEngagement || !engagementEditForm) {
        throw new Error("Open an engagement before saving changes.");
      }

      const payload = {
        engagementType: engagementEditForm.engagementType,
        scheduleType: engagementEditForm.scheduleType === "none" ? null : engagementEditForm.scheduleType,
        workAuthorizationType: engagementEditForm.workAuthorizationType,
        startDate: engagementEditForm.startDate || null,
        endDate: engagementEditForm.endDate || null,
        supervisorAdminId: engagementEditForm.supervisorAdminId === "none"
          ? null
          : Number(engagementEditForm.supervisorAdminId),
        positionTitle: engagementEditForm.positionTitle || null,
        schoolName: engagementEditForm.schoolName || null,
        programOrMajor: engagementEditForm.programOrMajor || null,
        responseDeadline: engagementEditForm.responseDeadline || null,
        workLocation: engagementEditForm.workLocation || null,
        expectedHoursPerWeek: engagementEditForm.expectedHoursPerWeek === ""
          ? null
          : Number(engagementEditForm.expectedHoursPerWeek),
        workScope: engagementEditForm.workScope || null,
      };

      const response = await apiRequest(
        "PATCH",
        `/api/admin/engagements/${editingEngagement.id}`,
        payload,
      );
      return response.json() as Promise<AdminEngagement>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "engagements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "lifecycle-events"] });
      queryClient.invalidateQueries({ queryKey: engagementDocumentQueryKey });
      setEditingEngagement(null);
      setEngagementEditForm(null);
      toast({
        title: "Engagement updated",
        description: "The offer seed fields have been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update engagement",
        description: getApiErrorMessage(error, "Please check the engagement fields and try again."),
        variant: "destructive",
      });
    },
  });

  const createFeedbackSlotMutation = useMutation({
    mutationFn: async (engagement: AdminEngagement) => {
      if (!engagement.supervisorAdminId) {
        throw new Error("Set a supervisor before adding Feedback Meeting slots.");
      }
      const form = feedbackSlotForms[engagement.id] ?? defaultFeedbackSlotForm();
      const response = await apiRequest("POST", "/api/admin/feedback-slots", {
        supervisorAdminId: engagement.supervisorAdminId,
        dayOfWeek: Number(form.dayOfWeek),
        startTime: form.startTime,
        endTime: form.endTime,
        timezone: form.timezone,
      });
      return response.json() as Promise<FeedbackSlot>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: checkInQueryKey });
      toast({
        title: "Feedback Meeting slot added",
        description: "The trainee can select this slot from the Trainee Workspace.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not add Feedback Meeting slot",
        description: getApiErrorMessage(error, "Please check the slot values and try again."),
        variant: "destructive",
      });
    },
  });

  const deactivateFeedbackSlotMutation = useMutation({
    mutationFn: async (slotId: number) => {
      const response = await apiRequest("PATCH", `/api/admin/feedback-slots/${slotId}`, {
        status: "inactive",
      });
      return response.json() as Promise<FeedbackSlot>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: checkInQueryKey });
      toast({
        title: "Feedback Meeting slot updated",
        description: "The slot is no longer available for new selections.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update Feedback Meeting slot",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const updateMeetingStatusMutation = useMutation({
    mutationFn: async (input: { engagementId: number; occurrenceId: number; status: FeedbackMeetingStatus }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/admin/engagements/${input.engagementId}/feedback-meetings/${input.occurrenceId}/status`,
        { status: input.status },
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: checkInQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "lifecycle-events"] });
      toast({
        title: "Feedback Meeting status updated",
        description: "The engagement check-in record has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update Feedback Meeting status",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const openEditEngagement = (engagement: AdminEngagement) => {
    setEditingEngagement(engagement);
    setEngagementEditForm(engagementToEditForm(engagement));
  };

  const closeEditEngagement = () => {
    if (updateEngagementMutation.isPending) return;
    setEditingEngagement(null);
    setEngagementEditForm(null);
  };

  const updateEngagementField = (field: keyof EngagementEditForm, value: string) => {
    setEngagementEditForm((current) => current ? { ...current, [field]: value } : current);
  };

  const feedbackSlotFormFor = (engagementId: number) => {
    return feedbackSlotForms[engagementId] ?? defaultFeedbackSlotForm();
  };

  const updateFeedbackSlotForm = (engagementId: number, field: keyof FeedbackSlotForm, value: string) => {
    setFeedbackSlotForms((current) => ({
      ...current,
      [engagementId]: {
        ...(current[engagementId] ?? defaultFeedbackSlotForm()),
        [field]: value,
      },
    }));
  };

  const openEditProfile = () => {
    if (!admin) return;
    setProfileEditForm({
      name: admin.name,
      email: admin.email,
    });
    setEditingProfile(true);
  };

  const closeEditProfile = () => {
    if (updateProfileMutation.isPending) return;
    setEditingProfile(false);
    setProfileEditForm(null);
  };

  const updateProfileField = (field: keyof ProfileEditForm, value: string) => {
    setProfileEditForm((current) => current ? { ...current, [field]: value } : current);
  };

  const openCreateOfferLetter = (engagement: AdminEngagement) => {
    setLocation(`/admin-management/profile/${adminId}/offer-letter/new?engagementId=${engagement.id}`);
  };

  const downloadOfferLetter = async (document: AdminEngagementDocument) => {
    try {
      const token = tokenManager.getToken();
      const response = await fetch(
        `/api/admin/engagements/${document.engagement_id}/documents/${document.id}/download`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
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

  const formatTimestamp = (value: string | null | undefined) => {
    return value ? new Date(value).toLocaleString() : "Not set";
  };

  const getDocumentStatusBadge = (status: string) => {
    const variants = {
      draft: "secondary",
      sent: "secondary",
      viewed: "outline",
      accepted: "default",
      declined: "destructive",
      voided: "destructive",
    } as const;

    return <Badge variant={variants[status as keyof typeof variants] || "secondary"}>{status}</Badge>;
  };

  const getMeetingStatusBadge = (status: FeedbackMeetingStatus) => {
    const variants = {
      scheduled: "secondary",
      absence_requested: "outline",
      excused: "default",
      completed: "default",
      missed: "destructive",
      cancelled: "destructive",
    } as const;

    return <Badge variant={variants[status] || "secondary"}>{MEETING_STATUS_LABELS[status]}</Badge>;
  };

  const currentOfferLetterFor = (engagementId: number) => {
    const documents = documentsByEngagement[engagementId] ?? [];
    return documents.find((document) => document.document_type === "offer_letter" && document.status !== "voided")
      ?? documents.find((document) => document.document_type === "offer_letter");
  };

  const missingOfferSeedFields = (engagement: AdminEngagement) => {
    const missing: string[] = [];
    if (!engagement.positionTitle?.trim()) missing.push("Position Title");
    if (!engagement.workLocation?.trim()) missing.push("Work Location");
    if (engagement.workAuthorizationType === "cpt") {
      if (!engagement.schoolName?.trim()) missing.push("School Name");
      if (!engagement.programOrMajor?.trim()) missing.push("Program or Major");
      if (!engagement.responseDeadline) missing.push("Response Deadline");
    }
    return missing;
  };

  const supervisorOptions = allAdmins.filter((candidate) => (
    candidate.id !== admin.id &&
    candidate.status === "active" &&
    candidate.role !== "trainee_access"
  ));

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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={openEditProfile}
                  data-testid="button-edit-profile-info"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Profile Info
                </Button>
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
                      {(() => {
                        const missingSeedFields = admin.role === "trainee_access"
                          ? missingOfferSeedFields(engagement)
                          : [];
                        return missingSeedFields.length > 0 ? (
                          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            This trainee engagement is missing offer seed fields required for the offer letter:{" "}
                            {missingSeedFields.join(", ")}.
                          </div>
                        ) : null;
                      })()}
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{engagement.engagementType.replace('_', ' ')}</Badge>
                          <Badge>{engagement.status}</Badge>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditEngagement(engagement)}
                          data-testid={`button-edit-engagement-${engagement.id}`}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Engagement Seed
                        </Button>
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
                          <span className="text-muted-foreground">
                            End <RequiredLabel />:{" "}
                          </span>
                          <span>{engagement.endDate || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Supervisor <RequiredLabel />:{" "}
                          </span>
                          <span>{engagement.supervisorAdminId ? `Admin ID ${engagement.supervisorAdminId}` : 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Expected Hours: </span>
                          <span>{engagement.expectedHoursPerWeek ?? 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Position Title: </span>
                          <span>{engagement.positionTitle || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">School: </span>
                          <span>{engagement.schoolName || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Program or Major: </span>
                          <span>{engagement.programOrMajor || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Work Location: </span>
                          <span>{engagement.workLocation || 'Not set'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Response Deadline: </span>
                          <span>{engagement.responseDeadline || 'Not set'}</span>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-muted-foreground">
                            Work Scope <RequiredLabel />:{" "}
                          </span>
                          <span>{engagement.workScope || 'Not set'}</span>
                        </div>
                      </div>
                      {admin.role === "trainee_access" && (
                        <div className="mt-4 rounded-md border border-border p-4" data-testid={`card-offer-letter-${engagement.id}`}>
                          {(() => {
                            const offerLetter = currentOfferLetterFor(engagement.id);
                            const canCreate = !offerLetter || offerLetter.status === "voided";
                            const canRegenerate = offerLetter && !["accepted", "voided"].includes(offerLetter.status);
                            const canSend = offerLetter && ["draft", "sent", "viewed"].includes(offerLetter.status);
                            return (
                              <div className="space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <FileText className="h-4 w-4 text-muted-foreground" />
                                      <p className="font-medium">Offer Letter</p>
                                    </div>
                                    {offerLetter ? (
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {getDocumentStatusBadge(offerLetter.status)}
                                        <Badge variant="outline">v{offerLetter.version}</Badge>
                                        {offerLetter.has_pdf && <Badge variant="outline">PDF ready</Badge>}
                                      </div>
                                    ) : (
                                      <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                        No offer letter has been created for this trainee yet.
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {canCreate && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openCreateOfferLetter(engagement)}
                                        data-testid={`button-create-offer-letter-${engagement.id}`}
                                      >
                                        <FileText className="h-4 w-4 mr-2" />
                                        Create Offer Letter
                                      </Button>
                                    )}
                                    {offerLetter && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPreviewDocument(offerLetter)}
                                        data-testid={`button-preview-offer-letter-${offerLetter.id}`}
                                      >
                                        <Eye className="h-4 w-4 mr-2" />
                                        Preview
                                      </Button>
                                    )}
                                    {offerLetter?.has_pdf && offerLetter.status !== "voided" && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => downloadOfferLetter(offerLetter)}
                                        data-testid={`button-download-offer-letter-${offerLetter.id}`}
                                      >
                                        <Download className="h-4 w-4 mr-2" />
                                        Download
                                      </Button>
                                    )}
                                    {canRegenerate && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => regenerateOfferLetterMutation.mutate(offerLetter)}
                                        disabled={regenerateOfferLetterMutation.isPending}
                                        data-testid={`button-regenerate-offer-letter-${offerLetter.id}`}
                                      >
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Regenerate
                                      </Button>
                                    )}
                                    {canSend && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => sendOfferLetterMutation.mutate(offerLetter)}
                                        disabled={sendOfferLetterMutation.isPending}
                                        data-testid={`button-send-offer-letter-${offerLetter.id}`}
                                      >
                                        <Send className="h-4 w-4 mr-2" />
                                        Send
                                      </Button>
                                    )}
                                    {offerLetter && !["accepted", "voided"].includes(offerLetter.status) && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => voidOfferLetterMutation.mutate(offerLetter)}
                                        disabled={voidOfferLetterMutation.isPending}
                                        data-testid={`button-void-offer-letter-${offerLetter.id}`}
                                      >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Void
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                {offerLetter && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">Title: </span>
                                      <span>{offerLetter.title}</span>
                                    </div>
                                    {offerLetter.template_name_snapshot && (
                                      <div>
                                        <span className="text-muted-foreground">Template: </span>
                                        <span>
                                          {offerLetter.template_name_snapshot}
                                          {offerLetter.template_version ? ` v${offerLetter.template_version}` : ""}
                                        </span>
                                      </div>
                                    )}
                                    <div>
                                      <span className="text-muted-foreground">Sent: </span>
                                      <span>{formatTimestamp(offerLetter.sent_at)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Viewed: </span>
                                      <span>{formatTimestamp(offerLetter.viewed_at)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Accepted: </span>
                                      <span>{formatTimestamp(offerLetter.accepted_at)}</span>
                                    </div>
                                    {offerLetter.file_sha256 && (
                                      <div className="md:col-span-2">
                                        <span className="text-muted-foreground">File hash: </span>
                                        <span className="font-mono text-xs break-all">{offerLetter.file_sha256}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {admin.role === "trainee_access" && (
                        <div className="mt-4 rounded-md border border-border p-4" data-testid={`card-check-ins-${engagement.id}`}>
                          {(() => {
                            const checkIns = checkInsByEngagement[engagement.id];
                            const slotForm = feedbackSlotFormFor(engagement.id);
                            const selectedSchedule = checkIns?.selected_schedule;
                            const occurrences = checkIns?.meeting_occurrences ?? [];
                            const absenceRequests = occurrences.filter((occurrence) => (
                              occurrence.status === "absence_requested" || occurrence.absence_reason
                            ));
                            return (
                              <div className="space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                      <p className="font-medium">Check-ins & Logs</p>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      Feedback Meeting schedule, Absence Requests, and Learning Activity Logs.
                                    </p>
                                  </div>
                                  {selectedSchedule ? (
                                    <Badge variant={selectedSchedule.status === "confirmed" ? "default" : "outline"}>
                                      {selectedSchedule.status === "change_requested" ? "Schedule Change Requested" : "Schedule Confirmed"}
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">No Feedback Meeting Schedule</Badge>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                  <div className="rounded-md border border-border p-3">
                                    <p className="mb-2 text-sm font-medium">Supervisor Available Slots</p>
                                    {checkIns?.available_slots?.length ? (
                                      <div className="space-y-2">
                                        {checkIns.available_slots.map((slot) => (
                                          <div key={slot.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <span>{formatFeedbackSlot(slot)}</span>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => deactivateFeedbackSlotMutation.mutate(slot.id)}
                                              disabled={deactivateFeedbackSlotMutation.isPending}
                                              data-testid={`button-deactivate-feedback-slot-${slot.id}`}
                                            >
                                              Disable
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No active Feedback Meeting slots have been defined for this supervisor.</p>
                                    )}

                                    {engagement.supervisorAdminId ? (
                                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
                                        <Select
                                          value={slotForm.dayOfWeek}
                                          onValueChange={(value) => updateFeedbackSlotForm(engagement.id, "dayOfWeek", value)}
                                        >
                                          <SelectTrigger data-testid={`select-feedback-slot-day-${engagement.id}`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {DAY_LABELS.map((label, index) => (
                                              <SelectItem key={label} value={String(index)}>{label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Input
                                          type="time"
                                          value={slotForm.startTime}
                                          onChange={(event) => updateFeedbackSlotForm(engagement.id, "startTime", event.target.value)}
                                          data-testid={`input-feedback-slot-start-${engagement.id}`}
                                        />
                                        <Input
                                          type="time"
                                          value={slotForm.endTime}
                                          onChange={(event) => updateFeedbackSlotForm(engagement.id, "endTime", event.target.value)}
                                          data-testid={`input-feedback-slot-end-${engagement.id}`}
                                        />
                                        <Input
                                          value={slotForm.timezone}
                                          onChange={(event) => updateFeedbackSlotForm(engagement.id, "timezone", event.target.value)}
                                          data-testid={`input-feedback-slot-timezone-${engagement.id}`}
                                        />
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => createFeedbackSlotMutation.mutate(engagement)}
                                          disabled={createFeedbackSlotMutation.isPending}
                                          data-testid={`button-add-feedback-slot-${engagement.id}`}
                                        >
                                          Add Slot
                                        </Button>
                                      </div>
                                    ) : (
                                      <p className="mt-3 text-sm text-muted-foreground">Set a supervisor before adding Feedback Meeting slots.</p>
                                    )}
                                  </div>

                                  <div className="rounded-md border border-border p-3">
                                    <p className="mb-2 text-sm font-medium">Selected Feedback Meeting Schedule</p>
                                    {selectedSchedule ? (
                                      <div className="space-y-2 text-sm">
                                        <div className="flex flex-wrap gap-2">
                                          <Badge variant="outline">{selectedSchedule.frequency_per_week} per week</Badge>
                                          <Badge variant="outline">{selectedSchedule.timezone}</Badge>
                                        </div>
                                        {selectedSchedule.selected_slots.map((slot) => (
                                          <p key={slot.id}>{formatFeedbackSlot(slot)}</p>
                                        ))}
                                        {selectedSchedule.change_request_note && (
                                          <p className="rounded-md bg-muted/40 p-2">
                                            Change request: {selectedSchedule.change_request_note}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">The trainee has not selected a recurring Feedback Meeting schedule.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-md border border-border p-3">
                                  <p className="mb-2 text-sm font-medium">Upcoming Feedback Meetings and Absence Requests</p>
                                  {occurrences.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No Feedback Meeting occurrences have been generated yet.</p>
                                  ) : (
                                    <div className="space-y-3">
                                      {occurrences.slice(0, 8).map((occurrence) => (
                                        <div key={occurrence.id} className="grid grid-cols-1 gap-2 rounded-md bg-muted/30 p-3 text-sm md:grid-cols-[1fr_auto_auto]">
                                          <div>
                                            <p className="font-medium">{occurrence.occurrence_date} {occurrence.start_time}-{occurrence.end_time}</p>
                                            {occurrence.absence_reason && (
                                              <p className="text-muted-foreground">
                                                Absence Request: {occurrence.absence_reason}
                                                {occurrence.absence_note ? ` - ${occurrence.absence_note}` : ""}
                                              </p>
                                            )}
                                          </div>
                                          <div>{getMeetingStatusBadge(occurrence.status)}</div>
                                          <Select
                                            value={occurrence.status}
                                            onValueChange={(status) => updateMeetingStatusMutation.mutate({
                                              engagementId: engagement.id,
                                              occurrenceId: occurrence.id,
                                              status: status as FeedbackMeetingStatus,
                                            })}
                                          >
                                            <SelectTrigger data-testid={`select-feedback-meeting-status-${occurrence.id}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {(Object.keys(MEETING_STATUS_LABELS) as FeedbackMeetingStatus[]).map((status) => (
                                                <SelectItem key={status} value={status}>{MEETING_STATUS_LABELS[status]}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {absenceRequests.length > 0 && (
                                    <p className="mt-3 text-xs text-muted-foreground">
                                      {absenceRequests.length} Absence Request{absenceRequests.length === 1 ? "" : "s"} recorded for this engagement.
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
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

      <Dialog open={editingProfile} onOpenChange={(open) => !open && closeEditProfile()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile Info</DialogTitle>
            <DialogDescription>
              Update the saved Step 1 account information for this admin.
            </DialogDescription>
          </DialogHeader>
          {profileEditForm && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                updateProfileMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={profileEditForm.name}
                  minLength={2}
                  required
                  onChange={(event) => updateProfileField("name", event.target.value)}
                  data-testid="input-edit-admin-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={profileEditForm.email}
                  required
                  onChange={(event) => updateProfileField("email", event.target.value)}
                  data-testid="input-edit-admin-email"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditProfile}
                  disabled={updateProfileMutation.isPending}
                  data-testid="button-cancel-edit-profile"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                  data-testid="button-save-edit-profile"
                >
                  {updateProfileMutation.isPending ? "Saving..." : "Save Profile Info"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingEngagement)} onOpenChange={(open) => !open && closeEditEngagement()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Engagement Seed</DialogTitle>
            <DialogDescription>
              Update the Step 1 values reused by the offer letter builder.
            </DialogDescription>
          </DialogHeader>
          {engagementEditForm && (
            <form
              className="max-h-[70vh] space-y-5 overflow-y-auto pr-2"
              onSubmit={(event) => {
                event.preventDefault();
                updateEngagementMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Position Title</Label>
                  <Input
                    value={engagementEditForm.positionTitle}
                    onChange={(event) => updateEngagementField("positionTitle", event.target.value)}
                    data-testid="input-edit-position-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Work Location</Label>
                  <Input
                    value={engagementEditForm.workLocation}
                    onChange={(event) => updateEngagementField("workLocation", event.target.value)}
                    data-testid="input-edit-work-location"
                  />
                </div>
                <div className="space-y-2">
                  <Label>School Name</Label>
                  <Input
                    value={engagementEditForm.schoolName}
                    onChange={(event) => updateEngagementField("schoolName", event.target.value)}
                    data-testid="input-edit-school-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Program or Major</Label>
                  <Input
                    value={engagementEditForm.programOrMajor}
                    onChange={(event) => updateEngagementField("programOrMajor", event.target.value)}
                    data-testid="input-edit-program-or-major"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Response Deadline</Label>
                  <Input
                    type="date"
                    value={engagementEditForm.responseDeadline}
                    onChange={(event) => updateEngagementField("responseDeadline", event.target.value)}
                    data-testid="input-edit-response-deadline"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expected Hours Per Week</Label>
                  <Input
                    type="number"
                    min="0"
                    max="168"
                    value={engagementEditForm.expectedHoursPerWeek}
                    onChange={(event) => updateEngagementField("expectedHoursPerWeek", event.target.value)}
                    data-testid="input-edit-expected-hours"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Engagement Type</Label>
                  <Select
                    value={engagementEditForm.engagementType}
                    onValueChange={(value) => updateEngagementField("engagementType", value)}
                  >
                    <SelectTrigger data-testid="select-edit-engagement-type">
                      <SelectValue placeholder="Select engagement type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="advisor">Advisor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Schedule Type</Label>
                  <Select
                    value={engagementEditForm.scheduleType}
                    onValueChange={(value) => updateEngagementField("scheduleType", value)}
                  >
                    <SelectTrigger data-testid="select-edit-schedule-type">
                      <SelectValue placeholder="Select schedule type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      <SelectItem value="full_time">Full-time</SelectItem>
                      <SelectItem value="part_time">Part-time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Work Authorization</Label>
                  <Select
                    value={engagementEditForm.workAuthorizationType}
                    onValueChange={(value) => updateEngagementField("workAuthorizationType", value)}
                  >
                    <SelectTrigger data-testid="select-edit-work-authorization-type">
                      <SelectValue placeholder="Select work authorization" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="cpt">CPT</SelectItem>
                      <SelectItem value="opt">OPT</SelectItem>
                      <SelectItem value="stem_opt">STEM OPT</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Supervisor</Label>
                  <Select
                    value={engagementEditForm.supervisorAdminId}
                    onValueChange={(value) => updateEngagementField("supervisorAdminId", value)}
                  >
                    <SelectTrigger data-testid="select-edit-supervisor-admin">
                      <SelectValue placeholder="Select supervisor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {supervisorOptions.map((candidate) => (
                        <SelectItem key={candidate.id} value={String(candidate.id)}>
                          {candidate.name} - {candidate.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={engagementEditForm.startDate}
                    onChange={(event) => updateEngagementField("startDate", event.target.value)}
                    data-testid="input-edit-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={engagementEditForm.endDate}
                    onChange={(event) => updateEngagementField("endDate", event.target.value)}
                    data-testid="input-edit-end-date"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Work Scope</Label>
                  <Textarea
                    value={engagementEditForm.workScope}
                    onChange={(event) => updateEngagementField("workScope", event.target.value)}
                    data-testid="textarea-edit-work-scope"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditEngagement}
                  disabled={updateEngagementMutation.isPending}
                  data-testid="button-cancel-edit-engagement"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateEngagementMutation.isPending}
                  data-testid="button-save-edit-engagement"
                >
                  {updateEngagementMutation.isPending ? "Saving..." : "Save Engagement Seed"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewDocument)} onOpenChange={(open) => !open && setPreviewDocument(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewDocument?.title ?? "Offer Letter"}</DialogTitle>
            <DialogDescription>
              Version {previewDocument?.version} · {previewDocument?.status}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/20 p-4">
            <p className="whitespace-pre-wrap text-sm leading-6">{previewDocument?.body}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

function RequiredLabel() {
  return <span className="ml-1 text-xs font-medium text-destructive">Required</span>;
}
