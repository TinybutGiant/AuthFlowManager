import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type {
  AdminDocumentTemplate,
  AdminEngagement,
  AdminEngagementDocument,
  AdminUser,
} from "@/types/admin";
import { OfferLetterDocumentPreview } from "./OfferLetterDocumentPreview";
import {
  buildOfferLetterPreviewModel,
  CPT_TEMPLATE_NAME,
  emptyOfferLetterManualFields,
  OFFER_LETTER_FIELD_DEFINITIONS,
  type OfferLetterFieldDefinition,
  type OfferLetterManualFields,
  type OfferLetterMissingField,
  type OfferTemplatePreviewResponse,
} from "./offerLetterPreviewMapper";

const DEFAULT_CPT_COMPENSATION_TEXT =
  "Unpaid internship position for academic practical training purposes.";
const DEFAULT_CPT_SIGNATORY_TITLE = "Founder & Manager";
const DEFAULT_TRAINING_ALIGNMENT_TEXT =
  "The activities in this engagement are designed to provide supervised practical training aligned with the student's academic background and prior experience.";

type OfferReadinessKey =
  | "resumeReviewed"
  | "discussionCompleted"
  | "schoolDetailsConfirmed"
  | "responsibilitiesAligned";

const OFFER_READINESS_LABELS: Array<{ key: OfferReadinessKey; label: string }> = [
  { key: "resumeReviewed", label: "Resume reviewed outside system" },
  { key: "discussionCompleted", label: "Zoom/discussion completed" },
  { key: "schoolDetailsConfirmed", label: "School/CPT details confirmed" },
  { key: "responsibilitiesAligned", label: "Responsibilities aligned with student background" },
];

interface OfferLetterBuilderProps {
  adminId: number;
}

function extractMissingVariables(error: unknown) {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const body = error.body as { missing_variables?: unknown };
    return Array.isArray(body.missing_variables) ? body.missing_variables.map(String) : [];
  }

  return [];
}

function previewRequestFingerprint(input: {
  engagementId: number | null;
  templateId: string;
  fields: OfferLetterManualFields;
}) {
  return JSON.stringify(input);
}

function sortTemplates(templates: AdminDocumentTemplate[]) {
  return templates
    .filter((template) => template.document_type === "offer_letter" && template.status !== "archived")
    .sort((a, b) => {
      if (a.status === b.status) return a.name.localeCompare(b.name);
      return a.status === "active" ? -1 : 1;
    });
}

function fieldPayload(fields: OfferLetterManualFields) {
  return {
    engagementTitle: fields.engagementTitle,
    functionArea: fields.functionArea,
    compensationText: fields.compensationText,
    schoolName: fields.schoolName,
    programOrMajor: fields.programOrMajor,
    workLocation: fields.workLocation,
    responseDeadline: fields.responseDeadline,
    responsibilitiesText: fields.responsibilitiesText,
    trainingAlignmentText: fields.trainingAlignmentText,
    companyPhone: fields.companyPhone,
    companyEmail: fields.companyEmail,
    signatoryName: fields.signatoryName,
    signatoryTitle: fields.signatoryTitle,
  };
}

function focusField(field: OfferLetterMissingField) {
  if (!field.fieldKey) return;
  const element = window.document.getElementById(`offer-field-${field.fieldKey}`);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
  }
}

export function OfferLetterBuilder({ adminId }: OfferLetterBuilderProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryEngagementId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("engagementId");
    const parsed = value ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const [selectedEngagementId, setSelectedEngagementId] = useState<number | null>(queryEngagementId);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [fields, setFields] = useState<OfferLetterManualFields>(() => emptyOfferLetterManualFields());
  const [offerReadiness, setOfferReadiness] = useState<Record<OfferReadinessKey, boolean>>({
    resumeReviewed: false,
    discussionCompleted: false,
    schoolDetailsConfirmed: false,
    responsibilitiesAligned: false,
  });
  const [rawTemplateOpen, setRawTemplateOpen] = useState(false);
  const [serverPreview, setServerPreview] = useState<OfferTemplatePreviewResponse | null>(null);
  const [serverMissingVariables, setServerMissingVariables] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStateKey, setPreviewStateKey] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [defaultsKey, setDefaultsKey] = useState("");

  const { data: admin, isLoading: adminLoading } = useQuery<AdminUser>({
    queryKey: ["/api/admin/users", adminId],
    enabled: Boolean(adminId),
    retry: false,
  });

  const { data: engagements = [], isLoading: engagementsLoading } = useQuery<AdminEngagement[]>({
    queryKey: ["/api/admin/users", adminId, "engagements"],
    enabled: Boolean(adminId),
    retry: false,
  });

  const { data: documentTemplates = [], isLoading: templatesLoading } = useQuery<AdminDocumentTemplate[]>({
    queryKey: ["/api/admin/document-templates?documentType=offer_letter"],
    retry: false,
  });

  const selectedEngagement = engagements.find((engagement) => engagement.id === selectedEngagementId) ?? null;
  const templates = useMemo(() => sortTemplates(documentTemplates), [documentTemplates]);
  const selectedTemplate = templates.find((template) => String(template.id) === selectedTemplateId) ?? null;
  const isCptTemplateSelected = selectedTemplate?.name === CPT_TEMPLATE_NAME;

  const { data: engagementDocuments = [] } = useQuery<AdminEngagementDocument[]>({
    queryKey: ["/api/admin/engagements", selectedEngagementId, "documents"],
    enabled: Boolean(selectedEngagementId),
    retry: false,
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/admin/engagements/${selectedEngagementId}/documents`,
      );
      return response.json() as Promise<AdminEngagementDocument[]>;
    },
  });

  const activeOffer = engagementDocuments.find((document) => (
    document.document_type === "offer_letter" && document.status !== "voided"
  ));

  useEffect(() => {
    if (!selectedEngagementId && engagements.length > 0) {
      const traineeEngagement = engagements.find((engagement) => engagement.status !== "cancelled");
      setSelectedEngagementId(traineeEngagement?.id ?? engagements[0].id);
    }
  }, [engagements, selectedEngagementId]);

  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      setSelectedTemplateId(String(templates[0].id));
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (!selectedTemplate || !selectedEngagement) return;
    const nextDefaultsKey = `${selectedTemplate.id}:${selectedEngagement.id}`;
    if (defaultsKey === nextDefaultsKey) return;

    setFields((current) => ({
      ...current,
      engagementTitle:
        current.engagementTitle || `${admin?.name ?? "Trainee"} Trainee Engagement`,
      workLocation:
        current.workLocation || (selectedTemplate.name === CPT_TEMPLATE_NAME ? "Remote" : ""),
      responsibilitiesText:
        current.responsibilitiesText ||
        (selectedTemplate.name === CPT_TEMPLATE_NAME ? selectedEngagement.workScope || "" : ""),
      compensationText:
        current.compensationText ||
        (selectedTemplate.name === CPT_TEMPLATE_NAME ? DEFAULT_CPT_COMPENSATION_TEXT : ""),
      trainingAlignmentText:
        current.trainingAlignmentText ||
        (selectedTemplate.name === CPT_TEMPLATE_NAME ? DEFAULT_TRAINING_ALIGNMENT_TEXT : ""),
      signatoryTitle:
        current.signatoryTitle ||
        (selectedTemplate.name === CPT_TEMPLATE_NAME ? DEFAULT_CPT_SIGNATORY_TITLE : ""),
    }));
    setDefaultsKey(nextDefaultsKey);
  }, [admin?.name, defaultsKey, selectedEngagement, selectedTemplate]);

  const previewKey = useMemo(
    () => previewRequestFingerprint({
      engagementId: selectedEngagement?.id ?? null,
      templateId: selectedTemplateId,
      fields,
    }),
    [fields, selectedEngagement?.id, selectedTemplateId],
  );

  const refreshPreview = useCallback(async () => {
    if (!selectedTemplate || !selectedEngagement) {
      setServerPreview(null);
      setServerMissingVariables([]);
      setPreviewError(null);
      setPreviewStateKey(previewKey);
      return;
    }

    const requestKey = previewKey;
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${selectedEngagement.id}/documents/preview-template`,
        {
          templateId: selectedTemplate.id,
          ...fieldPayload(fields),
        },
      );
      const preview = await response.json() as OfferTemplatePreviewResponse;
      setServerPreview(preview);
      setServerMissingVariables(preview.missing_variables ?? []);
      setPreviewError(null);
      setPreviewStateKey(requestKey);
    } catch (error) {
      setServerPreview(null);
      setServerMissingVariables(extractMissingVariables(error));
      setPreviewError(getApiErrorMessage(error, "Could not preview this template."));
      setPreviewStateKey(requestKey);
    } finally {
      setPreviewLoading(false);
    }
  }, [fields, previewKey, selectedEngagement, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate || !selectedEngagement) return;
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [previewKey, refreshPreview, selectedEngagement, selectedTemplate]);

  const activePreview = previewStateKey === previewKey ? serverPreview : null;
  const activeMissingVariables = previewStateKey === previewKey ? serverMissingVariables : [];
  const activePreviewError = previewStateKey === previewKey ? previewError : null;
  const model = useMemo(
    () => buildOfferLetterPreviewModel({
      template: selectedTemplate,
      values: fields,
      serverPreview: activePreview,
      serverMissingVariables: activeMissingVariables,
    }),
    [activeMissingVariables, activePreview, fields, selectedTemplate],
  );

  const createOfferLetterMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEngagement || !selectedTemplate) {
        throw new Error("Select an engagement and template first.");
      }

      const response = await apiRequest(
        "POST",
        `/api/admin/engagements/${selectedEngagement.id}/documents`,
        {
          documentType: "offer_letter",
          templateId: selectedTemplate.id,
          ...fieldPayload(fields),
        },
      );
      return response.json() as Promise<AdminEngagementDocument>;
    },
    onSuccess: () => {
      if (selectedEngagement) {
        queryClient.invalidateQueries({
          queryKey: ["/api/admin/engagements", selectedEngagement.id, "documents"],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "engagement-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", adminId, "lifecycle-events"] });
      toast({
        title: "Offer letter created",
        description: "The private PDF artifact has been generated.",
      });
      setLocation(`/admin-management/profile/${adminId}`);
    },
    onError: (error) => {
      toast({
        title: "Could not create offer letter",
        description: getApiErrorMessage(error, "Please check the offer letter and try again."),
        variant: "destructive",
      });
    },
  });

  const createDisabled =
    !model.previewIsValid ||
    previewStateKey !== previewKey ||
    previewLoading ||
    Boolean(activeOffer) ||
    createOfferLetterMutation.isPending;

  const updateField = (key: keyof OfferLetterManualFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const resetDraftForEngagement = (engagementId: number) => {
    setSelectedEngagementId(engagementId);
    setFields(emptyOfferLetterManualFields());
    setOfferReadiness({
      resumeReviewed: false,
      discussionCompleted: false,
      schoolDetailsConfirmed: false,
      responsibilitiesAligned: false,
    });
    setServerPreview(null);
    setServerMissingVariables([]);
    setPreviewError(null);
    setPreviewStateKey("");
    setDefaultsKey("");
  };

  const renderField = (definition: OfferLetterFieldDefinition) => {
    const value = fields[definition.fieldKey];
    const missing = model.missingFields.some((field) => field.variable === definition.variable);
    const id = `offer-field-${definition.fieldKey}`;
    const commonProps = {
      id,
      value,
      maxLength: definition.maxLength,
      "data-testid": id,
      className: cn(missing && "border-amber-400 bg-amber-50 focus-visible:ring-amber-500"),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        updateField(definition.fieldKey, event.target.value),
    };

    return (
      <div key={definition.variable} className="space-y-2">
        <Label htmlFor={id} className="flex items-center justify-between gap-2">
          <span>
            {definition.label}
            {definition.required && <span className="ml-1 text-destructive">*</span>}
          </span>
          {missing && <span className="text-xs font-medium text-amber-700">Missing</span>}
        </Label>
        {definition.multiline ? (
          <Textarea {...commonProps} className={cn(commonProps.className, "min-h-28")} />
        ) : (
          <Input {...commonProps} />
        )}
      </div>
    );
  };

  if (adminLoading || engagementsLoading || templatesLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading offer letter builder...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            className="-ml-3 mb-2"
            onClick={() => setLocation(`/admin-management/profile/${adminId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Profile
          </Button>
          <h1 className="text-3xl font-light text-foreground">Offer Letter Builder</h1>
          <p className="text-muted-foreground">
            Build the document from structured merge fields while reviewing the full draft.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {previewLoading && (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Refreshing preview
            </Badge>
          )}
          {model.previewIsValid && (
            <Badge>
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Preview valid
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={() => void refreshPreview()}
            disabled={!selectedTemplate || !selectedEngagement || previewLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Preview
          </Button>
          <Button
            onClick={() => createOfferLetterMutation.mutate()}
            disabled={createDisabled}
            data-testid="button-create-offer-letter-document"
          >
            {createOfferLetterMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Create Offer Letter
              </>
            )}
          </Button>
        </div>
      </div>

      {activeOffer && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This engagement already has a current offer letter. Void the existing document before creating a new version.
        </div>
      )}

      <div className="grid min-h-[calc(100vh-13rem)] grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        <aside className="rounded-lg border bg-background p-4 xl:sticky xl:top-4 xl:h-[calc(100vh-13rem)] xl:overflow-auto">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Missing Required Fields</p>
              <p className="mt-1 text-3xl font-semibold text-foreground">{model.missingFields.length}</p>
              <p className="text-xs text-muted-foreground">Fields must be resolved before create.</p>
            </div>

            {model.missingFields.length > 0 ? (
              <div className="space-y-2">
                {model.missingFields.map((field) => (
                  <button
                    key={field.variable}
                    type="button"
                    className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm hover:bg-amber-100"
                    onClick={() => focusField(field)}
                  >
                    <span className="block font-medium text-amber-950">{field.label}</span>
                    <span className="text-xs text-amber-800">{field.sectionTitle}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Required fields are complete.
              </div>
            )}

            <Separator />

            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Sections</p>
              <div className="space-y-1">
                {model.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      const element = window.document.getElementById(`offer-section-${section.id}`);
                      element?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <span>{section.title}</span>
                    {section.missingCount > 0 && (
                      <Badge variant="secondary">{section.missingCount}</Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {activePreviewError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {activePreviewError}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-[720px] overflow-hidden rounded-lg border bg-slate-100">
          <OfferLetterDocumentPreview model={model} />
        </section>

        <aside className="rounded-lg border bg-background p-4 xl:h-[calc(100vh-13rem)] xl:overflow-auto">
          <div className="space-y-6">
            <section id="offer-section-template" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Template</p>
                  <p className="text-xs text-muted-foreground">
                    Raw Template is reusable text with variables. Document Preview is the merged offer draft.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRawTemplateOpen(true)}
                  disabled={!selectedTemplate}
                  data-testid="button-view-raw-offer-template"
                >
                  <Search className="mr-2 h-4 w-4" />
                  View Raw Template
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Offer Template</Label>
                <Select
                  value={selectedTemplateId}
                  onValueChange={(value) => {
                    setSelectedTemplateId(value);
                    setServerPreview(null);
                    setServerMissingVariables([]);
                    setPreviewError(null);
                  }}
                >
                  <SelectTrigger data-testid="select-offer-letter-template">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={String(template.id)}>
                        {template.name} v{template.version} ({template.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {engagements.length > 1 && (
                <div className="space-y-2">
                  <Label>Engagement Record</Label>
                  <Select
                    value={selectedEngagementId ? String(selectedEngagementId) : ""}
                    onValueChange={(value) => resetDraftForEngagement(Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select engagement" />
                    </SelectTrigger>
                    <SelectContent>
                      {engagements.map((engagement) => (
                        <SelectItem key={engagement.id} value={String(engagement.id)}>
                          #{engagement.id} {engagement.engagementType} - {engagement.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </section>

            {isCptTemplateSelected && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                CPT Details fields are active for this template. Confirm school, program, CPT/I-20 wording,
                dates, hours, responsibilities, unpaid wording, and Trainee Workspace acceptance in the preview.
              </div>
            )}

            {model.sections
              .filter((section) => section.fields.length > 0)
              .map((section) => (
                <section key={section.id} id={`offer-section-${section.id}`} className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{section.title}</p>
                    {section.missingCount > 0 && (
                      <p className="text-xs text-amber-700">{section.missingCount} required field(s) missing</p>
                    )}
                  </div>
                  <div className="space-y-4">
                    {section.fields.map((definition) => renderField(definition))}
                  </div>
                  <Separator />
                </section>
              ))}

            {isCptTemplateSelected && (
              <section id="offer-section-readiness" className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Offer Readiness</p>
                  <p className="text-xs text-muted-foreground">
                    Admin-only checklist. This is not submitted, stored, exposed to trainee, or included in PDF.
                  </p>
                </div>
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  {OFFER_READINESS_LABELS.map((item) => (
                    <label key={item.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={offerReadiness[item.key]}
                        onChange={(event) => setOfferReadiness((current) => ({
                          ...current,
                          [item.key]: event.target.checked,
                        }))}
                        data-testid={`checkbox-offer-readiness-${item.key}`}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={rawTemplateOpen} onOpenChange={setRawTemplateOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.name ?? "Raw Template"}</DialogTitle>
            <DialogDescription>
              Raw Template is the reusable plain-text template with variables. Document Preview is the final merged offer draft.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-auto pr-2">
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">Title Template</p>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {selectedTemplate?.title_template}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">Body Template</p>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {selectedTemplate?.body_template}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">Allowed Variables</p>
              <div className="flex flex-wrap gap-2">
                {selectedTemplate?.allowed_variables?.length ? (
                  selectedTemplate.allowed_variables.map((variable) => (
                    <Badge key={variable} variant="outline">{variable}</Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No variables declared.</span>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OfferLetterBuilder;
