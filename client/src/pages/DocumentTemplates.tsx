import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, Eye, FileText, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { AdminDocumentTemplate, AdminDocumentTemplateStatus } from "@/types/admin";

const TEMPLATES_QUERY = "/api/admin/document-templates";

const SAMPLE_MERGE_DATA: Record<string, string> = {
  trainee_name: "Sample Trainee",
  trainee_email: "trainee@example.com",
  engagement_title: "Business Analyst Intern",
  engagement_type: "intern",
  schedule_text: "part time",
  start_date: "2026-06-01",
  end_date: "2026-08-31",
  school_name: "Sample University",
  program_or_major: "Business Analytics",
  work_location: "Remote",
  expected_hours_per_week: "20",
  work_scope: "Supervised business analysis training",
  work_authorization_type: "cpt",
  supervisor_name: "Sample Supervisor",
  supervisor_email: "supervisor@example.com",
  function_area: "Operations",
  company_name: "Sample Company",
  company_email: "sample-company@example.test",
  company_phone: "000-000-0000",
  signatory_name: "Sample Signatory",
  signatory_title: "Program Manager",
  compensation_text: "Unpaid internship position for academic practical training purposes.",
  training_alignment_text:
    "This engagement is intended to provide supervised practical training aligned with the student's academic background and prior experience.",
  responsibilities_text:
    "Conduct market research, support pricing analysis, document business requirements, and assist with supervised platform testing.",
  response_deadline: "July 15, 2026",
};

type TemplateFormState = {
  name: string;
  description: string;
  status: AdminDocumentTemplateStatus;
  titleTemplate: string;
  bodyTemplate: string;
  allowedVariablesText: string;
};

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString();
}

function statusBadge(status: AdminDocumentTemplateStatus) {
  const variant = status === "active" ? "default" : status === "archived" ? "secondary" : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function renderSampleTemplate(templateText: string) {
  return templateText.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, variable) => {
    return SAMPLE_MERGE_DATA[variable] ?? match;
  });
}

function templateToForm(template?: AdminDocumentTemplate): TemplateFormState {
  return {
    name: template?.name ?? "",
    description: template?.description ?? "",
    status: template?.status ?? "draft",
    titleTemplate: template?.title_template ?? "",
    bodyTemplate: template?.body_template ?? "",
    allowedVariablesText: template?.allowed_variables?.join(", ") ?? "",
  };
}

function parseAllowedVariables(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function TemplateBodyBlock({ value }: { value: string }) {
  return (
    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-4 text-sm leading-6">
      {value}
    </pre>
  );
}

export default function DocumentTemplates() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewTemplate, setViewTemplate] = useState<AdminDocumentTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<AdminDocumentTemplate | null>(null);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<AdminDocumentTemplate | null>(null);
  const [archiveTemplate, setArchiveTemplate] = useState<AdminDocumentTemplate | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(templateToForm());

  const { data: templates = [], isLoading } = useQuery<AdminDocumentTemplate[]>({
    queryKey: [TEMPLATES_QUERY],
    retry: false,
  });

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => statusFilter === "all" || template.status === statusFilter);
  }, [statusFilter, templates]);

  const resetForm = () => {
    setFormState(templateToForm());
    setEditingTemplate(null);
    setDuplicatingTemplate(null);
    setIsFormOpen(false);
  };

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        documentType: "offer_letter",
        name: formState.name.trim(),
        description: formState.description.trim() || null,
        status: formState.status,
        titleTemplate: formState.titleTemplate,
        bodyTemplate: formState.bodyTemplate,
        contentFormat: "plain_text",
        allowedVariables: parseAllowedVariables(formState.allowedVariablesText),
      };

      if (editingTemplate) {
        const response = await apiRequest("PATCH", `/api/admin/document-templates/${editingTemplate.id}`, payload);
        return response.json() as Promise<AdminDocumentTemplate>;
      }

      const response = await apiRequest("POST", "/api/admin/document-templates", payload);
      return response.json() as Promise<AdminDocumentTemplate>;
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: [TEMPLATES_QUERY] });
      toast({
        title: editingTemplate?.status === "active" ? "Template version created" : "Template saved",
        description: `${template.name} v${template.version} is ${template.status}.`,
      });
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Template save failed",
        description: getApiErrorMessage(error, "Could not save document template."),
        variant: "destructive",
      });
    },
  });

  const archiveTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      const response = await apiRequest("POST", `/api/admin/document-templates/${templateId}/archive`);
      return response.json() as Promise<AdminDocumentTemplate>;
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: [TEMPLATES_QUERY] });
      toast({
        title: "Template archived",
        description: `${template.name} v${template.version} is no longer selectable for new offers.`,
      });
      setArchiveTemplate(null);
    },
    onError: (error) => {
      toast({
        title: "Archive failed",
        description: getApiErrorMessage(error, "Could not archive document template."),
        variant: "destructive",
      });
    },
  });

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setDuplicatingTemplate(null);
    setFormState(templateToForm());
    setIsFormOpen(true);
  };

  const openEditDialog = (template: AdminDocumentTemplate) => {
    setDuplicatingTemplate(null);
    setEditingTemplate(template);
    setFormState(templateToForm(template));
    setIsFormOpen(true);
  };

  const openDuplicateDialog = (template: AdminDocumentTemplate) => {
    setEditingTemplate(null);
    setDuplicatingTemplate(template);
    setFormState({
      ...templateToForm(template),
      name: `Copy of ${template.name}`,
      status: "draft",
    });
    setIsFormOpen(true);
  };

  const formTitle = editingTemplate
    ? editingTemplate.status === "active"
      ? "Edit / Create New Version"
      : "Edit Template"
    : duplicatingTemplate
      ? "Duplicate Template"
      : "Create Template";
  const rawPreviewTitle = viewTemplate ? viewTemplate.title_template : formState.titleTemplate;
  const rawPreviewBody = viewTemplate ? viewTemplate.body_template : formState.bodyTemplate;

  return (
    <div className="space-y-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-document-templates-title">
            Document Templates
          </h1>
          <p className="text-muted-foreground">
            Manage plain-text offer letter templates for future trainee engagement documents.
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="button-create-document-template">
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" data-testid="select-template-status-filter">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All templates</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Active template edits create a new version; generated offer documents keep frozen snapshots.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Templates
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-4 font-medium text-foreground">Name</th>
                  <th className="text-left p-4 font-medium text-foreground">Type</th>
                  <th className="text-left p-4 font-medium text-foreground">Status</th>
                  <th className="text-left p-4 font-medium text-foreground">Version</th>
                  <th className="text-left p-4 font-medium text-foreground">Format</th>
                  <th className="text-left p-4 font-medium text-foreground">Updated</th>
                  <th className="text-left p-4 font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="p-8 text-center text-muted-foreground" colSpan={7}>
                      Loading document templates...
                    </td>
                  </tr>
                ) : filteredTemplates.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-muted-foreground" colSpan={7} data-testid="text-no-document-templates">
                      No document templates found.
                    </td>
                  </tr>
                ) : (
                  filteredTemplates.map((template) => (
                    <tr key={template.id} className="border-b border-border hover:bg-accent/50" data-testid={`row-document-template-${template.id}`}>
                      <td className="p-4">
                        <div className="font-medium">{template.name}</div>
                        {template.description && (
                          <div className="max-w-md truncate text-sm text-muted-foreground">{template.description}</div>
                        )}
                      </td>
                      <td className="p-4">{template.document_type}</td>
                      <td className="p-4">{statusBadge(template.status)}</td>
                      <td className="p-4">v{template.version}</td>
                      <td className="p-4">{template.content_format}</td>
                      <td className="p-4 text-sm text-muted-foreground">{formatDateTime(template.updated_at)}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => setViewTemplate(template)} data-testid={`button-view-template-${template.id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openEditDialog(template)} data-testid={`button-edit-template-${template.id}`}>
                            <Pencil className="h-4 w-4 mr-1" />
                            Edit / Create New Version
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openDuplicateDialog(template)} data-testid={`button-duplicate-template-${template.id}`}>
                            <Copy className="h-4 w-4 mr-1" />
                            Duplicate
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setArchiveTemplate(template)}
                            disabled={template.status === "archived"}
                            data-testid={`button-archive-template-${template.id}`}
                          >
                            <Archive className="h-4 w-4 mr-1" />
                            Archive
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewTemplate)} onOpenChange={(open) => !open && setViewTemplate(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{viewTemplate?.name ?? "Document Template"}</DialogTitle>
            <DialogDescription>
              Plain-text template detail and maintenance preview. This does not create documents, PDFs, emails, or lifecycle events.
            </DialogDescription>
          </DialogHeader>
          {viewTemplate && (
            <div className="min-h-0 space-y-5 overflow-y-auto pb-1 pl-1 pr-2 pt-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Document Type</p>
                  <p>{viewTemplate.document_type}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <div>{statusBadge(viewTemplate.status)}</div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Version</p>
                  <p>v{viewTemplate.version}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Content Format</p>
                  <p>{viewTemplate.content_format}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Updated</p>
                  <p>{formatDateTime(viewTemplate.updated_at)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Archived</p>
                  <p>{formatDateTime(viewTemplate.archived_at)}</p>
                </div>
              </div>

              {viewTemplate.description && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Description</p>
                  <p className="whitespace-pre-wrap">{viewTemplate.description}</p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-muted-foreground">Allowed Variables</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {viewTemplate.allowed_variables.length > 0 ? (
                    viewTemplate.allowed_variables.map((variable) => (
                      <Badge key={variable} variant="outline">{variable}</Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No variables declared.</span>
                  )}
                </div>
              </div>

              <Tabs defaultValue="raw" data-testid="tabs-template-preview">
                <TabsList>
                  <TabsTrigger value="raw">Raw Template</TabsTrigger>
                  <TabsTrigger value="sample">Sample Merged Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="raw" className="space-y-3">
                  <div>
                    <p className="mb-1 text-sm font-medium text-muted-foreground">Title Template</p>
                    <TemplateBodyBlock value={rawPreviewTitle} />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-medium text-muted-foreground">Body Template</p>
                    <TemplateBodyBlock value={rawPreviewBody} />
                  </div>
                </TabsContent>
                <TabsContent value="sample" className="space-y-3">
                  <div>
                    <p className="mb-1 text-sm font-medium text-muted-foreground">Sample Title</p>
                    <TemplateBodyBlock value={renderSampleTemplate(rawPreviewTitle)} />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-medium text-muted-foreground">Sample Body</p>
                    <TemplateBodyBlock value={renderSampleTemplate(rawPreviewBody)} />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isFormOpen} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-h-[calc(100vh-1rem)] w-[96vw] max-w-7xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{formTitle}</DialogTitle>
            <DialogDescription>
              Templates are plain text only. Editing an active template creates a new active version and archives the old version.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-4 overflow-y-auto pb-1 pl-1 pr-2 pt-1">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="template-name">Name</Label>
                <Input
                  id="template-name"
                  value={formState.name}
                  onChange={(event) => setFormState((value) => ({ ...value, name: event.target.value }))}
                  maxLength={200}
                  data-testid="input-document-template-name"
                />
              </div>
              <div>
                <Label htmlFor="template-status">Status</Label>
                <Select
                  value={formState.status}
                  onValueChange={(status) => setFormState((value) => ({ ...value, status: status as AdminDocumentTemplateStatus }))}
                  disabled={editingTemplate?.status === "active"}
                >
                  <SelectTrigger id="template-status" data-testid="select-document-template-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={formState.description}
                onChange={(event) => setFormState((value) => ({ ...value, description: event.target.value }))}
                className="min-h-20"
                maxLength={1000}
                data-testid="textarea-document-template-description"
              />
            </div>

            <div>
              <Label htmlFor="template-title">Title Template</Label>
              <Input
                id="template-title"
                value={formState.titleTemplate}
                onChange={(event) => setFormState((value) => ({ ...value, titleTemplate: event.target.value }))}
                maxLength={200}
                data-testid="input-document-template-title"
              />
            </div>

            <div>
              <Label htmlFor="template-body">Body Template</Label>
              <Textarea
                id="template-body"
                value={formState.bodyTemplate}
                onChange={(event) => setFormState((value) => ({ ...value, bodyTemplate: event.target.value }))}
                className="min-h-[28rem] font-mono text-sm"
                maxLength={20000}
                data-testid="textarea-document-template-body"
              />
            </div>

            <div>
              <Label htmlFor="template-variables">Allowed Variables</Label>
              <Textarea
                id="template-variables"
                value={formState.allowedVariablesText}
                onChange={(event) => setFormState((value) => ({ ...value, allowedVariablesText: event.target.value }))}
                className="min-h-20 font-mono text-sm"
                placeholder="Comma-separated or one per line. Leave blank to derive from template body."
                data-testid="textarea-document-template-variables"
              />
            </div>

            <Tabs defaultValue="raw">
              <TabsList>
                <TabsTrigger value="raw">Raw Template</TabsTrigger>
                <TabsTrigger value="sample">Sample Merged Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="raw" className="space-y-3">
                <TemplateBodyBlock value={`${formState.titleTemplate}\n\n${formState.bodyTemplate}`} />
              </TabsContent>
              <TabsContent value="sample" className="space-y-3">
                <TemplateBodyBlock value={`${renderSampleTemplate(formState.titleTemplate)}\n\n${renderSampleTemplate(formState.bodyTemplate)}`} />
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={resetForm} disabled={saveTemplateMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTemplateMutation.mutate()}
              disabled={
                saveTemplateMutation.isPending ||
                !formState.name.trim() ||
                !formState.titleTemplate.trim() ||
                !formState.bodyTemplate.trim()
              }
              data-testid="button-save-document-template"
            >
              {saveTemplateMutation.isPending ? "Saving..." : formTitle}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archiveTemplate)} onOpenChange={(open) => !open && setArchiveTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Document Template</AlertDialogTitle>
            <AlertDialogDescription>
              Archived templates are hidden from new offer letter selection by default. Existing generated offer documents remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveTemplateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveTemplate && archiveTemplateMutation.mutate(archiveTemplate.id)}
              disabled={archiveTemplateMutation.isPending}
              data-testid="button-confirm-archive-template"
            >
              {archiveTemplateMutation.isPending ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
