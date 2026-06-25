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

interface OfferLetterBuilderProps {
  adminId: number;
}

interface CompanyBrandDefaultsResponse {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  defaultWorkLocation: string;
  defaultSignatoryTitle: string;
  logo: {
    enabled: boolean;
    altText: string;
    version: string;
    hasAsset: boolean;
  };
}

const ENGAGEMENT_SEED_VARIABLES = new Set([
  "school_name",
  "program_or_major",
  "engagement_title",
  "response_deadline",
  "work_location",
]);

const OFFER_BUILDER_VARIABLES = new Set([
  "responsibilities_text",
  "training_alignment_text",
  "compensation_text",
  "signatory_name",
]);

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
      if (a.status === b.status) {
        const nameComparison = a.name.localeCompare(b.name);
        return nameComparison === 0 ? b.version - a.version : nameComparison;
      }
      return a.status === "active" ? -1 : 1;
    });
}

function fieldPayload(fields: OfferLetterManualFields) {
  return {
    compensationText: fields.compensationText,
    responsibilitiesText: fields.responsibilitiesText,
    trainingAlignmentText: fields.trainingAlignmentText,
    signatoryName: fields.signatoryName,
  };
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  return String(value).replace(/_/g, " ");
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
    const searchParams = new URLSearchParams(window.location.search);
    const value = searchParams.get("engagementId");
    const parsed = value ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);
  const fromCreate = useMemo(() => {
    return new URLSearchParams(window.location.search).get("fromCreate") === "1";
  }, []);

  const [selectedEngagementId, setSelectedEngagementId] = useState<number | null>(queryEngagementId);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [fields, setFields] = useState<OfferLetterManualFields>(() => emptyOfferLetterManualFields());
  const [responsibilitiesTouched, setResponsibilitiesTouched] = useState(false);
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

  const { data: companyBrandDefaults } = useQuery<CompanyBrandDefaultsResponse>({
    queryKey: ["/api/admin/company-brand-defaults"],
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
    if (selectedTemplateId || templates.length === 0) return;
    const cptTemplate = templates.find((template) => template.name === CPT_TEMPLATE_NAME);
    const generalTemplate = templates.find((template) => template.name !== CPT_TEMPLATE_NAME);
    const preferredTemplate = selectedEngagement?.workAuthorizationType === "cpt"
      ? cptTemplate ?? templates[0]
      : generalTemplate ?? templates[0];
    setSelectedTemplateId(String(preferredTemplate.id));
  }, [selectedEngagement?.workAuthorizationType, selectedTemplateId, templates]);

  useEffect(() => {
    if (!selectedTemplate || !selectedEngagement) return;
    const nextDefaultsKey = `${selectedEngagement.id}`;
    if (defaultsKey === nextDefaultsKey) return;

    setFields((current) => ({
      ...current,
      responsibilitiesText: responsibilitiesTouched
        ? current.responsibilitiesText
        : current.responsibilitiesText || selectedEngagement.workScope || "",
    }));
    setDefaultsKey(nextDefaultsKey);
  }, [defaultsKey, responsibilitiesTouched, selectedEngagement, selectedTemplate]);

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
  const effectiveBrandDefaults = activePreview?.company_brand_defaults ?? companyBrandDefaults ?? null;
  const missingFromEngagementSeed = model.missingFields.filter((field) =>
    ENGAGEMENT_SEED_VARIABLES.has(field.variable)
  );
  const missingFromOfferBuilder = model.missingFields.filter((field) =>
    OFFER_BUILDER_VARIABLES.has(field.variable)
  );
  const otherMissingFields = model.missingFields.filter((field) =>
    !ENGAGEMENT_SEED_VARIABLES.has(field.variable) &&
    !OFFER_BUILDER_VARIABLES.has(field.variable)
  );
  const mergeData = activePreview?.merge_data ?? {};
  const supervisorText = mergeData.supervisor_name && mergeData.supervisor_email
    ? `${mergeData.supervisor_name} (${mergeData.supervisor_email})`
    : selectedEngagement?.supervisorAdminId
      ? `Admin ID ${selectedEngagement.supervisorAdminId}`
      : "Not set";
  const engagementContext = [
    ["Trainee Name", admin?.name],
    ["Trainee Email", admin?.email],
    ["School Name", selectedEngagement?.schoolName],
    ["Program or Major", selectedEngagement?.programOrMajor],
    ["Position Title", selectedEngagement?.positionTitle],
    ["Start Date", selectedEngagement?.startDate],
    ["End Date", selectedEngagement?.endDate],
    ["Expected Hours Per Week", selectedEngagement?.expectedHoursPerWeek],
    ["Schedule", selectedEngagement?.scheduleType],
    ["Work Authorization", selectedEngagement?.workAuthorizationType],
    ["Work Location", selectedEngagement?.workLocation || effectiveBrandDefaults?.defaultWorkLocation],
    ["Supervisor", supervisorText],
    ["Response Deadline", selectedEngagement?.responseDeadline],
    ["Work Scope", selectedEngagement?.workScope],
  ];
  const companyContext = effectiveBrandDefaults
    ? [
        ["Company Name", effectiveBrandDefaults.companyName],
        ["Company Email", effectiveBrandDefaults.companyEmail],
        ["Company Phone", effectiveBrandDefaults.companyPhone],
        ["Signatory Title", effectiveBrandDefaults.defaultSignatoryTitle],
        [
          "Logo",
          effectiveBrandDefaults.logo.enabled
            ? `Enabled (${effectiveBrandDefaults.logo.version})`
            : "Disabled",
        ],
      ]
    : [];

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
    if (key === "responsibilitiesText") {
      setResponsibilitiesTouched(true);
    }
    setFields((current) => ({ ...current, [key]: value }));
  };

  const resetDraftForEngagement = (engagementId: number) => {
    setSelectedEngagementId(engagementId);
    setFields(emptyOfferLetterManualFields());
    setResponsibilitiesTouched(false);
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
            {fromCreate
              ? "Step 2 of 2: Create the offer letter for this trainee engagement."
              : "Build the document from structured merge fields while reviewing the full draft."}
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
          {fromCreate && (
            <Button
              variant="outline"
              onClick={() => setLocation(`/admin-management/profile/${adminId}`)}
              data-testid="button-skip-offer-letter-for-now"
            >
              Skip for Now
            </Button>
          )}
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
              <div className="space-y-4">
                {missingFromEngagementSeed.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Missing from Engagement Seed
                    </p>
                    {missingFromEngagementSeed.map((field) => (
                      <div
                        key={field.variable}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                      >
                        <span className="block font-medium text-amber-950">{field.label}</span>
                        <span className="text-xs text-amber-800">
                          This value should be completed in the engagement seed.
                        </span>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation(`/admin-management/profile/${adminId}`)}
                    >
                      Back to Profile
                    </Button>
                  </div>
                )}

                {missingFromOfferBuilder.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Missing Offer Builder Input
                    </p>
                    {missingFromOfferBuilder.map((field) => (
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
                )}

                {otherMissingFields.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Other Missing Fields
                    </p>
                    {otherMissingFields.map((field) => (
                      <div
                        key={field.variable}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                      >
                        {field.label}
                      </div>
                    ))}
                  </div>
                )}
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
                {[
                  ["offer-section-template", "Template"],
                  ["offer-section-context", "Reused Context"],
                  ["offer-section-responsibilities", "Primary Responsibilities"],
                  ["offer-section-advanced", "Advanced Overrides"],
                ].map(([id, title]) => (
                  <button
                    key={id}
                    type="button"
                    className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      const element = window.document.getElementById(id);
                      element?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <span>{title}</span>
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
                CPT template selected. Review the engagement seed values and finalize Primary Responsibilities.
              </div>
            )}

            <section id="offer-section-context" className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Reused from Engagement Seed</p>
                <p className="text-xs text-muted-foreground">
                  These values come from the trainee engagement record.
                </p>
              </div>
              <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                {engagementContext.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="break-words">{formatValue(value)}</span>
                  </div>
                ))}
              </div>
              {companyContext.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">Company Brand Defaults</p>
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                    {companyContext.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="break-words">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Separator />
            </section>

            <section id="offer-section-responsibilities" className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Primary Responsibilities</p>
                <p className="text-xs text-muted-foreground">
                  Start from the engagement work scope, then expand into the final task list for the offer letter.
                </p>
              </div>
              <Textarea
                id="offer-field-responsibilitiesText"
                value={fields.responsibilitiesText}
                maxLength={8000}
                className={cn(
                  "min-h-40",
                  missingFromOfferBuilder.some((field) => field.variable === "responsibilities_text") &&
                    "border-amber-400 bg-amber-50 focus-visible:ring-amber-500",
                )}
                onChange={(event) => updateField("responsibilitiesText", event.target.value)}
                data-testid="offer-field-responsibilitiesText"
              />
              <Separator />
            </section>

            <section id="offer-section-advanced" className="space-y-3">
              <details className="group">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">
                  Advanced Overrides
                </summary>
                <div className="mt-3 space-y-4">
                  {OFFER_LETTER_FIELD_DEFINITIONS
                    .filter((definition) => definition.variable !== "responsibilities_text")
                    .map((definition) => renderField(definition))}
                </div>
              </details>
            </section>
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
