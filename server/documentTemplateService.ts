import type {
  AdminDocumentTemplate,
  AdminEngagement,
  AdminUser,
  InsertAdminDocumentTemplate,
} from "@shared/schema";
import type { IStorage } from "./storage";

export const OFFER_LETTER_TEMPLATE_VARIABLES = [
  "trainee_name",
  "trainee_email",
  "engagement_type",
  "schedule_text",
  "start_date",
  "end_date",
  "expected_hours_per_week",
  "work_scope",
  "work_authorization_type",
  "supervisor_name",
  "supervisor_email",
  "engagement_title",
  "function_area",
  "compensation_text",
  "school_name",
  "program_or_major",
  "work_location",
  "response_deadline",
  "responsibilities_text",
  "training_alignment_text",
  "company_phone",
  "company_email",
  "signatory_name",
  "signatory_title",
  "company_name",
] as const;

export type OfferLetterTemplateVariable = typeof OFFER_LETTER_TEMPLATE_VARIABLES[number];
export type OfferLetterMergeData = Record<OfferLetterTemplateVariable, string>;

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const SUPPORTED_VARIABLES = new Set<string>(OFFER_LETTER_TEMPLATE_VARIABLES);
const MANUAL_VARIABLES = new Set<string>([
  "engagement_title",
  "function_area",
  "compensation_text",
  "school_name",
  "program_or_major",
  "work_location",
  "response_deadline",
  "responsibilities_text",
  "training_alignment_text",
  "signatory_name",
  "signatory_title",
]);

export class DocumentTemplateError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DocumentTemplateError";
  }
}

export interface ManualOfferLetterMergeValues {
  engagementTitle?: string;
  functionArea?: string;
  compensationText?: string;
  schoolName?: string;
  programOrMajor?: string;
  workLocation?: string;
  responseDeadline?: string;
  responsibilitiesText?: string;
  trainingAlignmentText?: string;
  companyPhone?: string;
  companyEmail?: string;
  signatoryName?: string;
  signatoryTitle?: string;
}

export interface OfferLetterTemplatePreview {
  template: AdminDocumentTemplate;
  title: string;
  body: string;
  mergeData: OfferLetterMergeData;
  usedVariables: string[];
  missingVariables: string[];
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) {
    return "Not set";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function valueOrFallback(value: string | number | null | undefined, fallback = "Not set") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value).replace(/_/g, " ");
}

function trimOptional(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function getCompanyName() {
  return process.env.COMPANY_NAME?.trim() || "Yaotu";
}

function getCompanyEmail() {
  const value = process.env.COMPANY_EMAIL
    || process.env.MAIL_FROM
    || process.env.MAILGUN_FROM
    || "";
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? "";
}

function toSnakeManualValues(values: ManualOfferLetterMergeValues) {
  return {
    engagement_title: trimOptional(values.engagementTitle),
    function_area: trimOptional(values.functionArea),
    compensation_text: trimOptional(values.compensationText),
    school_name: trimOptional(values.schoolName),
    program_or_major: trimOptional(values.programOrMajor),
    work_location: trimOptional(values.workLocation),
    response_deadline: trimOptional(values.responseDeadline),
    responsibilities_text: trimOptional(values.responsibilitiesText),
    training_alignment_text: trimOptional(values.trainingAlignmentText),
    company_phone: trimOptional(values.companyPhone),
    company_email: trimOptional(values.companyEmail),
    signatory_name: trimOptional(values.signatoryName),
    signatory_title: trimOptional(values.signatoryTitle),
  };
}

export function extractTemplateVariables(...templates: string[]): string[] {
  const variables = new Set<string>();

  for (const template of templates) {
    const pattern = new RegExp(TEMPLATE_VARIABLE_PATTERN);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
  }

  return Array.from(variables).sort();
}

export function validateTemplateVariables(
  titleTemplate: string,
  bodyTemplate: string,
  allowedVariables: string[] = [],
) {
  const usedVariables = extractTemplateVariables(titleTemplate, bodyTemplate);
  const unknownVariables = usedVariables.filter((variable) => !SUPPORTED_VARIABLES.has(variable));
  const unknownAllowedVariables = allowedVariables.filter((variable) => !SUPPORTED_VARIABLES.has(variable));

  if (unknownVariables.length || unknownAllowedVariables.length) {
    throw new DocumentTemplateError(400, "Template contains unsupported variables.", {
      unknown_variables: Array.from(new Set(unknownVariables.concat(unknownAllowedVariables))),
    });
  }

  return usedVariables;
}

export function normalizeAllowedVariables(
  titleTemplate: string,
  bodyTemplate: string,
  allowedVariables?: string[],
) {
  const usedVariables = validateTemplateVariables(titleTemplate, bodyTemplate, allowedVariables ?? []);
  return allowedVariables?.length ? Array.from(new Set(allowedVariables)).sort() : usedVariables;
}

async function getOfferLetterContext(
  storage: IStorage,
  engagementId: number,
): Promise<{ engagement: AdminEngagement; trainee: AdminUser; supervisor?: AdminUser }> {
  const engagement = await storage.getAdminEngagement(engagementId);
  if (!engagement) {
    throw new DocumentTemplateError(404, "Admin engagement not found.");
  }

  const trainee = await storage.getAdminUser(engagement.adminUserId);
  if (!trainee) {
    throw new DocumentTemplateError(404, "Trainee admin user not found.");
  }
  if (trainee.role !== "trainee_access") {
    throw new DocumentTemplateError(400, "Offer letters can be created only for trainee engagements.");
  }

  const supervisor = engagement.supervisorAdminId
    ? await storage.getAdminUser(engagement.supervisorAdminId)
    : undefined;

  return { engagement, trainee, supervisor };
}

function buildMergeData(input: {
  engagement: AdminEngagement;
  trainee: AdminUser;
  supervisor?: AdminUser;
  manualValues: ManualOfferLetterMergeValues;
}): OfferLetterMergeData {
  const manual = toSnakeManualValues(input.manualValues);

  return {
    trainee_name: valueOrFallback(input.trainee.name),
    trainee_email: valueOrFallback(input.trainee.email),
    engagement_type: valueOrFallback(input.engagement.engagementType),
    schedule_text: valueOrFallback(input.engagement.scheduleType),
    start_date: dateOnly(input.engagement.startDate),
    end_date: dateOnly(input.engagement.endDate),
    expected_hours_per_week: valueOrFallback(input.engagement.expectedHoursPerWeek),
    work_scope: valueOrFallback(input.engagement.workScope),
    work_authorization_type: valueOrFallback(input.engagement.workAuthorizationType),
    supervisor_name: input.supervisor ? valueOrFallback(input.supervisor.name) : "Not set",
    supervisor_email: input.supervisor ? valueOrFallback(input.supervisor.email) : "Not set",
    engagement_title: manual.engagement_title,
    function_area: manual.function_area,
    compensation_text: manual.compensation_text || "Unpaid internship position for academic practical training purposes.",
    school_name: manual.school_name,
    program_or_major: manual.program_or_major,
    work_location: manual.work_location || "Remote",
    response_deadline: manual.response_deadline,
    responsibilities_text: manual.responsibilities_text || valueOrFallback(input.engagement.workScope, ""),
    training_alignment_text: manual.training_alignment_text
      || "The activities in this engagement are designed to provide supervised practical training aligned with the student's academic background and prior experience.",
    company_phone: manual.company_phone || process.env.COMPANY_PHONE?.trim() || "Not provided",
    company_email: manual.company_email || getCompanyEmail() || "Not provided",
    signatory_name: manual.signatory_name || (input.supervisor ? valueOrFallback(input.supervisor.name) : ""),
    signatory_title: manual.signatory_title || process.env.COMPANY_SIGNATORY_TITLE?.trim() || "Founder & Manager",
    company_name: getCompanyName(),
  };
}

function renderPlainTextTemplate(template: string, mergeData: OfferLetterMergeData) {
  return template.replace(TEMPLATE_VARIABLE_PATTERN, (_match, variable: OfferLetterTemplateVariable) => {
    return mergeData[variable] ?? "";
  });
}

export function mergePlainTextTemplate(input: {
  template: Pick<AdminDocumentTemplate, "titleTemplate" | "bodyTemplate" | "contentFormat">;
  mergeData: OfferLetterMergeData;
}) {
  if (input.template.contentFormat !== "plain_text") {
    throw new DocumentTemplateError(400, "Only plain_text templates are supported.");
  }

  const usedVariables = validateTemplateVariables(
    input.template.titleTemplate,
    input.template.bodyTemplate,
  );
  const missingVariables = usedVariables.filter((variable) => (
    MANUAL_VARIABLES.has(variable) && !input.mergeData[variable as OfferLetterTemplateVariable]?.trim()
  ));

  if (missingVariables.length) {
    throw new DocumentTemplateError(400, "Template variables are missing required values.", {
      missing_variables: missingVariables,
    });
  }

  return {
    title: renderPlainTextTemplate(input.template.titleTemplate, input.mergeData).trim(),
    body: renderPlainTextTemplate(input.template.bodyTemplate, input.mergeData).trim(),
    usedVariables,
    missingVariables,
  };
}

export async function previewOfferLetterTemplate(input: {
  storage: IStorage;
  engagementId: number;
  templateId: number;
  manualValues: ManualOfferLetterMergeValues;
}): Promise<OfferLetterTemplatePreview> {
  const template = await input.storage.getAdminDocumentTemplate(input.templateId);
  if (!template || template.documentType !== "offer_letter") {
    throw new DocumentTemplateError(404, "Document template not found.");
  }
  if (template.status === "archived") {
    throw new DocumentTemplateError(409, "Archived templates cannot be used for offer letters.");
  }

  const context = await getOfferLetterContext(input.storage, input.engagementId);
  const mergeData = buildMergeData({
    ...context,
    manualValues: input.manualValues,
  });
  const merged = mergePlainTextTemplate({ template, mergeData });

  return {
    template,
    title: merged.title,
    body: merged.body,
    mergeData,
    usedVariables: merged.usedVariables,
    missingVariables: merged.missingVariables,
  };
}

export async function createDocumentTemplate(input: {
  storage: IStorage;
  actorAdminId: number;
  documentType: "offer_letter";
  name: string;
  description?: string | null;
  status: "draft" | "active" | "archived";
  titleTemplate: string;
  bodyTemplate: string;
  contentFormat: "plain_text";
  allowedVariables?: string[];
}) {
  const allowedVariables = normalizeAllowedVariables(
    input.titleTemplate,
    input.bodyTemplate,
    input.allowedVariables,
  );

  const templateInput: InsertAdminDocumentTemplate = {
    documentType: input.documentType,
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status,
    version: 1,
    titleTemplate: input.titleTemplate.trim(),
    bodyTemplate: input.bodyTemplate.trim(),
    contentFormat: input.contentFormat,
    allowedVariables,
    createdBy: input.actorAdminId,
    archivedAt: input.status === "archived" ? new Date() : null,
  };

  return input.storage.createAdminDocumentTemplate(templateInput);
}

export async function updateDocumentTemplate(input: {
  storage: IStorage;
  templateId: number;
  updates: Partial<{
    documentType: "offer_letter";
    name: string;
    description: string | null;
    status: "draft" | "active" | "archived";
    titleTemplate: string;
    bodyTemplate: string;
    contentFormat: "plain_text";
    allowedVariables: string[];
  }>;
}) {
  const existing = await input.storage.getAdminDocumentTemplate(input.templateId);
  if (!existing) {
    throw new DocumentTemplateError(404, "Document template not found.");
  }

  const nextTitleTemplate = input.updates.titleTemplate?.trim() ?? existing.titleTemplate;
  const nextBodyTemplate = input.updates.bodyTemplate?.trim() ?? existing.bodyTemplate;
  const allowedVariables = input.updates.allowedVariables !== undefined
    ? normalizeAllowedVariables(nextTitleTemplate, nextBodyTemplate, input.updates.allowedVariables)
    : normalizeAllowedVariables(nextTitleTemplate, nextBodyTemplate, existing.allowedVariables as string[]);
  const nextStatus = input.updates.status ?? existing.status;

  const updated = await input.storage.updateAdminDocumentTemplate(input.templateId, {
    ...(input.updates.documentType ? { documentType: input.updates.documentType } : {}),
    ...(input.updates.name !== undefined ? { name: input.updates.name.trim() } : {}),
    ...(input.updates.description !== undefined ? { description: input.updates.description } : {}),
    ...(input.updates.status !== undefined ? { status: input.updates.status } : {}),
    ...(input.updates.titleTemplate !== undefined ? { titleTemplate: nextTitleTemplate } : {}),
    ...(input.updates.bodyTemplate !== undefined ? { bodyTemplate: nextBodyTemplate } : {}),
    ...(input.updates.contentFormat !== undefined ? { contentFormat: input.updates.contentFormat } : {}),
    allowedVariables,
    version: existing.version + 1,
    archivedAt: nextStatus === "archived" ? (existing.archivedAt ?? new Date()) : null,
  });

  if (!updated) {
    throw new DocumentTemplateError(404, "Document template not found.");
  }

  return updated;
}

export async function archiveDocumentTemplate(input: {
  storage: IStorage;
  templateId: number;
}) {
  return updateDocumentTemplate({
    storage: input.storage,
    templateId: input.templateId,
    updates: { status: "archived" },
  });
}
