import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight, Delete, CheckCircle, Download, Eye, FileText, RefreshCw, Send, XCircle } from "lucide-react";
import { AdminDocumentTemplate, AdminEngagement, AdminEngagementDocument, AdminLifecycleEvent, AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";
import { ApiError, apiRequest, getApiErrorMessage, tokenManager } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OfferTemplatePreviewResponse {
  template_id: number;
  template_version: number;
  title: string;
  body: string;
  merge_data: Record<string, string>;
  used_variables: string[];
  missing_variables: string[];
}

const CPT_TEMPLATE_NAME = "CPT Internship Offer Letter";
const DEFAULT_CPT_COMPENSATION_TEXT = "Unpaid internship position for academic practical training purposes.";
const DEFAULT_CPT_SIGNATORY_TITLE = "Founder & Manager";
const DEFAULT_TRAINING_ALIGNMENT_TEXT =
  "The activities in this engagement are designed to provide supervised practical training aligned with the student's academic background and prior experience.";

export default function AdminProfile() {
  const params = useParams();
  const adminId = params.id ? parseInt(params.id) : undefined;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOfferEngagement, setCreateOfferEngagement] = useState<AdminEngagement | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [engagementTitle, setEngagementTitle] = useState("");
  const [functionArea, setFunctionArea] = useState("");
  const [compensationText, setCompensationText] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [programOrMajor, setProgramOrMajor] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [responseDeadline, setResponseDeadline] = useState("");
  const [responsibilitiesText, setResponsibilitiesText] = useState("");
  const [trainingAlignmentText, setTrainingAlignmentText] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryTitle, setSignatoryTitle] = useState("");
  const [offerReadiness, setOfferReadiness] = useState({
    resumeReviewed: false,
    discussionCompleted: false,
    schoolDetailsConfirmed: false,
    responsibilitiesAligned: false,
  });
  const [offerTitle, setOfferTitle] = useState("");
  const [offerBody, setOfferBody] = useState("");
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null);
  const [templatePreviewMissingVariables, setTemplatePreviewMissingVariables] = useState<string[]>([]);
  const [previewDocument, setPreviewDocument] = useState<AdminEngagementDocument | null>(null);

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

  const { data: documentTemplates = [] } = useQuery<AdminDocumentTemplate[]>({
    queryKey: ["/api/admin/document-templates?documentType=offer_letter"],
    retry: false,
  });

  const availableOfferTemplates = documentTemplates
    .filter((template) => template.document_type === "offer_letter" && template.status !== "archived")
    .sort((a, b) => {
      if (a.status === b.status) return a.name.localeCompare(b.name);
      return a.status === "active" ? -1 : 1;
    });
  const selectedTemplate = availableOfferTemplates.find((template) => String(template.id) === selectedTemplateId);
  const isCptTemplateSelected = selectedTemplate?.name === CPT_TEMPLATE_NAME;

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

  const resetCptFields = () => {
    setSchoolName("");
    setProgramOrMajor("");
    setWorkLocation("");
    setResponseDeadline("");
    setResponsibilitiesText("");
    setTrainingAlignmentText("");
    setCompanyPhone("");
    setCompanyEmail("");
    setSignatoryName("");
    setSignatoryTitle("");
    setOfferReadiness({
      resumeReviewed: false,
      discussionCompleted: false,
      schoolDetailsConfirmed: false,
      responsibilitiesAligned: false,
    });
  };

  const applyCptDefaults = (engagement: AdminEngagement) => {
    setWorkLocation((value) => value || "Remote");
    setResponsibilitiesText((value) => value || engagement.workScope || "");
    setTrainingAlignmentText((value) => value || DEFAULT_TRAINING_ALIGNMENT_TEXT);
    setCompensationText((value) => value || DEFAULT_CPT_COMPENSATION_TEXT);
    setSignatoryTitle((value) => value || DEFAULT_CPT_SIGNATORY_TITLE);
  };

  useEffect(() => {
    if (!createOfferEngagement || selectedTemplateId || availableOfferTemplates.length === 0) {
      return;
    }
    const template = availableOfferTemplates[0];
    setSelectedTemplateId(String(template.id));
    if (template.name === CPT_TEMPLATE_NAME) {
      applyCptDefaults(createOfferEngagement);
    } else {
      resetCptFields();
    }
  }, [availableOfferTemplates, createOfferEngagement, selectedTemplateId]);

  const templateErrorDetails = (error: unknown) => {
    if (error instanceof ApiError && error.body && typeof error.body === "object") {
      const body = error.body as { missing_variables?: unknown; unknown_variables?: unknown };
      const missing = Array.isArray(body.missing_variables) ? body.missing_variables.map(String) : [];
      const unknown = Array.isArray(body.unknown_variables) ? body.unknown_variables.map(String) : [];
      return { missing, unknown };
    }
    return { missing: [], unknown: [] };
  };

  const previewOfferTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!createOfferEngagement || !selectedTemplateId) {
        throw new Error("Select a template first");
      }
      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${createOfferEngagement.id}/documents/preview-template`,
        {
          templateId: Number(selectedTemplateId),
          engagementTitle,
          functionArea,
          compensationText,
          schoolName,
          programOrMajor,
          workLocation,
          responseDeadline,
          responsibilitiesText,
          trainingAlignmentText,
          companyPhone,
          companyEmail,
          signatoryName,
          signatoryTitle,
        },
      );
      return response.json() as Promise<OfferTemplatePreviewResponse>;
    },
    onSuccess: (preview) => {
      setOfferTitle(preview.title);
      setOfferBody(preview.body);
      setTemplatePreviewError(null);
      setTemplatePreviewMissingVariables(preview.missing_variables ?? []);
    },
    onError: (error) => {
      const details = templateErrorDetails(error);
      setTemplatePreviewMissingVariables(details.missing);
      setTemplatePreviewError(getApiErrorMessage(error, "Could not preview this template."));
    },
  });

  const createOfferLetterMutation = useMutation({
    mutationFn: async () => {
      if (!createOfferEngagement) {
        throw new Error("No engagement selected");
      }
      const payload = selectedTemplateId
        ? {
            documentType: "offer_letter",
            templateId: Number(selectedTemplateId),
            engagementTitle,
            functionArea,
            compensationText,
            schoolName,
            programOrMajor,
            workLocation,
            responseDeadline,
            responsibilitiesText,
            trainingAlignmentText,
            companyPhone,
            companyEmail,
            signatoryName,
            signatoryTitle,
            title: offerTitle,
            body: offerBody,
          }
        : {
            documentType: "offer_letter",
            title: offerTitle,
            body: offerBody,
          };
      const response = await apiRequest("POST", `/api/admin/engagements/${createOfferEngagement.id}/documents`, payload);
      return response.json() as Promise<AdminEngagementDocument>;
    },
    onSuccess: () => {
      setCreateOfferEngagement(null);
      setSelectedTemplateId("");
      setEngagementTitle("");
      setFunctionArea("");
      setCompensationText("");
      resetCptFields();
      setOfferTitle("");
      setOfferBody("");
      setTemplatePreviewError(null);
      setTemplatePreviewMissingVariables([]);
      invalidateOfferLetterQueries();
      toast({
        title: "Offer letter created",
        description: "The PDF artifact has been generated in private storage.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not create offer letter",
        description: getApiErrorMessage(error, "Please check the offer letter and try again."),
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

  const openCreateOfferLetter = (engagement: AdminEngagement) => {
    setCreateOfferEngagement(engagement);
    setSelectedTemplateId(availableOfferTemplates[0] ? String(availableOfferTemplates[0].id) : "");
    setEngagementTitle(`${admin?.name ?? "Trainee"} Trainee Engagement`);
    setFunctionArea("");
    setCompensationText("");
    resetCptFields();
    setTemplatePreviewError(null);
    setTemplatePreviewMissingVariables([]);
    if (availableOfferTemplates.length > 0) {
      setOfferTitle("");
      setOfferBody("");
      return;
    }
    setOfferTitle(`${admin?.name ?? "Trainee"} Offer Letter`);
    setOfferBody(
      [
        `Hello ${admin?.name ?? "Trainee"},`,
        "",
        "We are pleased to offer you a trainee engagement with YaoTu.",
        "",
        `Engagement type: ${engagement.engagementType.replace(/_/g, " ")}`,
        `Schedule: ${engagement.scheduleType?.replace(/_/g, " ") || "Not set"}`,
        `Start date: ${engagement.startDate || "Not set"}`,
        `End date: ${engagement.endDate || "Not set"}`,
        "",
        engagement.workScope ? `Scope:\n${engagement.workScope}` : "Scope: Not set",
      ].join("\n")
    );
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

  const currentOfferLetterFor = (engagementId: number) => {
    const documents = documentsByEngagement[engagementId] ?? [];
    return documents.find((document) => document.document_type === "offer_letter" && document.status !== "voided")
      ?? documents.find((document) => document.document_type === "offer_letter");
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
                                      <p className="mt-1 text-sm text-muted-foreground">No offer letter has been created.</p>
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
                                        Create
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

      <Dialog open={Boolean(createOfferEngagement)} onOpenChange={(open) => !open && setCreateOfferEngagement(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Offer Letter</DialogTitle>
            <DialogDescription>
              Merge a plain-text template, review the final body, and create a private PDF artifact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {availableOfferTemplates.length > 0 && (
              <>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">
                    Template <RequiredLabel />
                  </Label>
                  <Select
                    value={selectedTemplateId}
                    onValueChange={(value) => {
                      setSelectedTemplateId(value);
                      setOfferTitle("");
                      setOfferBody("");
                      setTemplatePreviewError(null);
                      setTemplatePreviewMissingVariables([]);
                      const template = availableOfferTemplates.find((item) => String(item.id) === value);
                      if (template?.name === CPT_TEMPLATE_NAME && createOfferEngagement) {
                        applyCptDefaults(createOfferEngagement);
                      } else {
                        resetCptFields();
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-offer-letter-template">
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableOfferTemplates.map((template) => (
                        <SelectItem key={template.id} value={String(template.id)}>
                          {template.name} v{template.version} ({template.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">
                      Engagement Title <RequiredLabel />
                    </Label>
                    <Input
                      value={engagementTitle}
                      onChange={(event) => setEngagementTitle(event.target.value)}
                      maxLength={200}
                      data-testid="input-offer-engagement-title"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Function Area</Label>
                    <Input
                      value={functionArea}
                      onChange={(event) => setFunctionArea(event.target.value)}
                      maxLength={200}
                      data-testid="input-offer-function-area"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-muted-foreground">
                    Compensation Text <RequiredLabel />
                  </Label>
                  <Textarea
                    value={compensationText}
                    onChange={(event) => setCompensationText(event.target.value)}
                    className="min-h-24"
                    maxLength={4000}
                    data-testid="textarea-offer-compensation-text"
                  />
                </div>

                {isCptTemplateSelected && (
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-foreground">CPT Details</p>
                    </div>
                    <div className="mb-4 rounded-md border border-border bg-muted/20 p-3">
                      <p className="mb-2 text-sm font-medium text-foreground">Offer Readiness</p>
                      {/* TODO: Persist internally only after a safe admin-only metadata model exists. */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={offerReadiness.resumeReviewed}
                            onChange={(event) => setOfferReadiness((value) => ({
                              ...value,
                              resumeReviewed: event.target.checked,
                            }))}
                            data-testid="checkbox-offer-readiness-resume-reviewed"
                          />
                          Resume reviewed outside system
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={offerReadiness.discussionCompleted}
                            onChange={(event) => setOfferReadiness((value) => ({
                              ...value,
                              discussionCompleted: event.target.checked,
                            }))}
                            data-testid="checkbox-offer-readiness-discussion-completed"
                          />
                          Zoom/discussion completed
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={offerReadiness.schoolDetailsConfirmed}
                            onChange={(event) => setOfferReadiness((value) => ({
                              ...value,
                              schoolDetailsConfirmed: event.target.checked,
                            }))}
                            data-testid="checkbox-offer-readiness-school-confirmed"
                          />
                          School/CPT details confirmed
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={offerReadiness.responsibilitiesAligned}
                            onChange={(event) => setOfferReadiness((value) => ({
                              ...value,
                              responsibilitiesAligned: event.target.checked,
                            }))}
                            data-testid="checkbox-offer-readiness-responsibilities-aligned"
                          />
                          Responsibilities aligned with student background
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          School Name <RequiredLabel />
                        </Label>
                        <Input
                          value={schoolName}
                          onChange={(event) => setSchoolName(event.target.value)}
                          maxLength={200}
                          data-testid="input-offer-school-name"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          Program or Major <RequiredLabel />
                        </Label>
                        <Input
                          value={programOrMajor}
                          onChange={(event) => setProgramOrMajor(event.target.value)}
                          maxLength={300}
                          data-testid="input-offer-program-or-major"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          Work Location <RequiredLabel />
                        </Label>
                        <Input
                          value={workLocation}
                          onChange={(event) => setWorkLocation(event.target.value)}
                          maxLength={500}
                          data-testid="input-offer-work-location"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          Response Deadline <RequiredLabel />
                        </Label>
                        <Input
                          value={responseDeadline}
                          onChange={(event) => setResponseDeadline(event.target.value)}
                          maxLength={200}
                          placeholder="e.g. July 15, 2026"
                          data-testid="input-offer-response-deadline"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          Signatory Name <RequiredLabel />
                        </Label>
                        <Input
                          value={signatoryName}
                          onChange={(event) => setSignatoryName(event.target.value)}
                          maxLength={200}
                          data-testid="input-offer-signatory-name"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">
                          Signatory Title <RequiredLabel />
                        </Label>
                        <Input
                          value={signatoryTitle}
                          onChange={(event) => setSignatoryTitle(event.target.value)}
                          maxLength={200}
                          data-testid="input-offer-signatory-title"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Company Email</Label>
                        <Input
                          value={companyEmail}
                          onChange={(event) => setCompanyEmail(event.target.value)}
                          maxLength={320}
                          data-testid="input-offer-company-email"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Company Phone</Label>
                        <Input
                          value={companyPhone}
                          onChange={(event) => setCompanyPhone(event.target.value)}
                          maxLength={100}
                          data-testid="input-offer-company-phone"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <Label className="text-sm font-medium text-muted-foreground">
                        Responsibilities Text <RequiredLabel />
                      </Label>
                      <Textarea
                        value={responsibilitiesText}
                        onChange={(event) => setResponsibilitiesText(event.target.value)}
                        className="min-h-24"
                        maxLength={8000}
                        data-testid="textarea-offer-responsibilities-text"
                      />
                    </div>
                    <div className="mt-3">
                      <Label className="text-sm font-medium text-muted-foreground">
                        Training Alignment Text <RequiredLabel />
                      </Label>
                      <Textarea
                        value={trainingAlignmentText}
                        onChange={(event) => setTrainingAlignmentText(event.target.value)}
                        className="min-h-24"
                        maxLength={8000}
                        data-testid="textarea-offer-training-alignment-text"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => previewOfferTemplateMutation.mutate()}
                    disabled={!selectedTemplateId || previewOfferTemplateMutation.isPending}
                    data-testid="button-preview-offer-template"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {previewOfferTemplateMutation.isPending ? "Previewing..." : "Preview Template"}
                  </Button>
                  {templatePreviewMissingVariables.length > 0 && (
                    <p className="text-sm text-destructive">
                      Missing: {templatePreviewMissingVariables.join(", ")}
                    </p>
                  )}
                </div>

                {templatePreviewError && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {templatePreviewError}
                  </p>
                )}
              </>
            )}

            {availableOfferTemplates.length === 0 && (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                No offer letter templates are available. This will use the legacy direct body mode.
              </p>
            )}

            <div>
              <Label className="text-sm font-medium text-muted-foreground">
                Final Title <RequiredLabel />
              </Label>
              <Input
                value={offerTitle}
                onChange={(event) => setOfferTitle(event.target.value)}
                maxLength={200}
                data-testid="input-offer-letter-title"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-muted-foreground">
                Final Body <RequiredLabel />
              </Label>
              <Textarea
                value={offerBody}
                onChange={(event) => setOfferBody(event.target.value)}
                className="min-h-64"
                maxLength={20000}
                data-testid="textarea-offer-letter-body"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOfferEngagement(null)}
              disabled={createOfferLetterMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createOfferLetterMutation.mutate()}
              disabled={
                createOfferLetterMutation.isPending ||
                previewOfferTemplateMutation.isPending ||
                !offerTitle.trim() ||
                !offerBody.trim()
              }
              data-testid="button-submit-offer-letter"
            >
              {createOfferLetterMutation.isPending ? "Creating..." : "Create Offer Letter"}
            </Button>
          </DialogFooter>
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

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

function RequiredLabel() {
  return <span className="ml-1 text-xs font-medium text-destructive">Required</span>;
}
