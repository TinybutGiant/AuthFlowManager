import type { AdminDocumentTemplate } from "@/types/admin";

export interface OfferTemplatePreviewResponse {
  template_id: number;
  template_version: number;
  title: string;
  body: string;
  merge_data: Record<string, string>;
  used_variables: string[];
  missing_variables: string[];
}

export interface OfferLetterManualFields {
  engagementTitle: string;
  functionArea: string;
  compensationText: string;
  schoolName: string;
  programOrMajor: string;
  workLocation: string;
  responseDeadline: string;
  responsibilitiesText: string;
  trainingAlignmentText: string;
  companyPhone: string;
  companyEmail: string;
  signatoryName: string;
  signatoryTitle: string;
}

export type OfferLetterFieldSectionId =
  | "template"
  | "candidate_school"
  | "engagement"
  | "training_alignment"
  | "compensation"
  | "signature"
  | "readiness";

export interface OfferLetterFieldDefinition {
  variable: string;
  fieldKey: keyof OfferLetterManualFields;
  label: string;
  sectionId: OfferLetterFieldSectionId;
  sectionTitle: string;
  required: boolean;
  multiline?: boolean;
  maxLength: number;
}

export interface OfferLetterMissingField {
  variable: string;
  fieldKey?: keyof OfferLetterManualFields;
  label: string;
  sectionId: OfferLetterFieldSectionId;
  sectionTitle: string;
}

export interface OfferLetterPreviewToken {
  type: "text" | "variable";
  text: string;
  variable?: string;
  label?: string;
  missing?: boolean;
}

export interface OfferLetterFieldSection {
  id: OfferLetterFieldSectionId;
  title: string;
  fields: OfferLetterFieldDefinition[];
  missingCount: number;
}

export interface OfferLetterPreviewModel {
  template: AdminDocumentTemplate | null;
  mode: "empty" | "raw_template" | "merged";
  title: string;
  body: string;
  titleTokens: OfferLetterPreviewToken[];
  bodyTokens: OfferLetterPreviewToken[];
  usedVariables: string[];
  missingFields: OfferLetterMissingField[];
  sections: OfferLetterFieldSection[];
  serverPreview: OfferTemplatePreviewResponse | null;
  previewIsValid: boolean;
}

export const CPT_TEMPLATE_NAME = "CPT Internship Offer Letter";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const SECTION_TITLES: Record<OfferLetterFieldSectionId, string> = {
  template: "Template",
  candidate_school: "Candidate / School",
  engagement: "Engagement",
  training_alignment: "Training Alignment",
  compensation: "Compensation",
  signature: "Signature",
  readiness: "Offer Readiness",
};

export const OFFER_LETTER_FIELD_DEFINITIONS: OfferLetterFieldDefinition[] = [
  {
    variable: "school_name",
    fieldKey: "schoolName",
    label: "School Name",
    sectionId: "candidate_school",
    sectionTitle: SECTION_TITLES.candidate_school,
    required: true,
    maxLength: 200,
  },
  {
    variable: "program_or_major",
    fieldKey: "programOrMajor",
    label: "Program or Major",
    sectionId: "candidate_school",
    sectionTitle: SECTION_TITLES.candidate_school,
    required: true,
    maxLength: 300,
  },
  {
    variable: "engagement_title",
    fieldKey: "engagementTitle",
    label: "Engagement Title",
    sectionId: "engagement",
    sectionTitle: SECTION_TITLES.engagement,
    required: true,
    maxLength: 200,
  },
  {
    variable: "function_area",
    fieldKey: "functionArea",
    label: "Function Area",
    sectionId: "engagement",
    sectionTitle: SECTION_TITLES.engagement,
    required: false,
    maxLength: 200,
  },
  {
    variable: "work_location",
    fieldKey: "workLocation",
    label: "Work Location",
    sectionId: "engagement",
    sectionTitle: SECTION_TITLES.engagement,
    required: true,
    maxLength: 500,
  },
  {
    variable: "response_deadline",
    fieldKey: "responseDeadline",
    label: "Response Deadline",
    sectionId: "engagement",
    sectionTitle: SECTION_TITLES.engagement,
    required: true,
    maxLength: 200,
  },
  {
    variable: "responsibilities_text",
    fieldKey: "responsibilitiesText",
    label: "Responsibilities",
    sectionId: "training_alignment",
    sectionTitle: SECTION_TITLES.training_alignment,
    required: true,
    multiline: true,
    maxLength: 8000,
  },
  {
    variable: "training_alignment_text",
    fieldKey: "trainingAlignmentText",
    label: "Training Alignment",
    sectionId: "training_alignment",
    sectionTitle: SECTION_TITLES.training_alignment,
    required: true,
    multiline: true,
    maxLength: 8000,
  },
  {
    variable: "compensation_text",
    fieldKey: "compensationText",
    label: "Compensation Text",
    sectionId: "compensation",
    sectionTitle: SECTION_TITLES.compensation,
    required: true,
    multiline: true,
    maxLength: 4000,
  },
  {
    variable: "signatory_name",
    fieldKey: "signatoryName",
    label: "Signatory Name",
    sectionId: "signature",
    sectionTitle: SECTION_TITLES.signature,
    required: true,
    maxLength: 200,
  },
  {
    variable: "signatory_title",
    fieldKey: "signatoryTitle",
    label: "Signatory Title",
    sectionId: "signature",
    sectionTitle: SECTION_TITLES.signature,
    required: true,
    maxLength: 200,
  },
  {
    variable: "company_email",
    fieldKey: "companyEmail",
    label: "Company Email",
    sectionId: "signature",
    sectionTitle: SECTION_TITLES.signature,
    required: false,
    maxLength: 320,
  },
  {
    variable: "company_phone",
    fieldKey: "companyPhone",
    label: "Company Phone",
    sectionId: "signature",
    sectionTitle: SECTION_TITLES.signature,
    required: false,
    maxLength: 100,
  },
];

const VARIABLE_DEFINITION_MAP = new Map(
  OFFER_LETTER_FIELD_DEFINITIONS.map((definition) => [definition.variable, definition])
);

const FALLBACK_VARIABLE_LABELS: Record<string, string> = {
  trainee_name: "Trainee Name",
  trainee_email: "Trainee Email",
  engagement_type: "Engagement Type",
  schedule_text: "Schedule",
  start_date: "Start Date",
  end_date: "End Date",
  expected_hours_per_week: "Expected Hours Per Week",
  work_scope: "Work Scope",
  work_authorization_type: "Work Authorization Type",
  supervisor_name: "Supervisor Name",
  supervisor_email: "Supervisor Email",
  company_name: "Company Name",
};

export function emptyOfferLetterManualFields(): OfferLetterManualFields {
  return {
    engagementTitle: "",
    functionArea: "",
    compensationText: "",
    schoolName: "",
    programOrMajor: "",
    workLocation: "",
    responseDeadline: "",
    responsibilitiesText: "",
    trainingAlignmentText: "",
    companyPhone: "",
    companyEmail: "",
    signatoryName: "",
    signatoryTitle: "",
  };
}

export function variableLabel(variable: string): string {
  return VARIABLE_DEFINITION_MAP.get(variable)?.label
    ?? FALLBACK_VARIABLE_LABELS[variable]
    ?? variable.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractOfferLetterTemplateVariables(...templates: Array<string | null | undefined>) {
  const variables = new Set<string>();
  for (const template of templates) {
    if (!template) continue;
    const pattern = new RegExp(VARIABLE_PATTERN);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
  }
  return Array.from(variables).sort();
}

export function tokenizeOfferLetterTemplateText(
  text: string,
  missingVariables: Set<string>
): OfferLetterPreviewToken[] {
  const tokens: OfferLetterPreviewToken[] = [];
  const pattern = new RegExp(VARIABLE_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const variable = match[1];
    tokens.push({
      type: "variable",
      text: match[0],
      variable,
      label: variableLabel(variable),
      missing: missingVariables.has(variable),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", text }];
}

function usedTemplateVariables(template: AdminDocumentTemplate | null) {
  if (!template) return [];
  const declared = Array.isArray(template.allowed_variables) ? template.allowed_variables : [];
  const extracted = extractOfferLetterTemplateVariables(template.title_template, template.body_template);
  return Array.from(new Set(declared.concat(extracted))).sort();
}

function requiredMissingVariables(input: {
  template: AdminDocumentTemplate | null;
  values: OfferLetterManualFields;
  serverMissingVariables?: string[];
}) {
  const used = new Set(usedTemplateVariables(input.template));
  const serverMissing = new Set(input.serverMissingVariables ?? []);
  const missing = new Set<string>();

  for (const definition of OFFER_LETTER_FIELD_DEFINITIONS) {
    if (!definition.required || !used.has(definition.variable)) continue;
    if (!input.values[definition.fieldKey]?.trim()) {
      missing.add(definition.variable);
    }
  }

  for (const variable of Array.from(serverMissing)) {
    missing.add(variable);
  }

  return missing;
}

function buildMissingFields(missingVariables: Set<string>): OfferLetterMissingField[] {
  return Array.from(missingVariables).sort().map((variable) => {
    const definition = VARIABLE_DEFINITION_MAP.get(variable);
    return {
      variable,
      fieldKey: definition?.fieldKey,
      label: variableLabel(variable),
      sectionId: definition?.sectionId ?? "template",
      sectionTitle: definition?.sectionTitle ?? SECTION_TITLES.template,
    };
  });
}

function buildSections(template: AdminDocumentTemplate | null, missingFields: OfferLetterMissingField[]) {
  const used = new Set(usedTemplateVariables(template));
  const missingBySection = new Map<OfferLetterFieldSectionId, number>();
  for (const field of missingFields) {
    missingBySection.set(field.sectionId, (missingBySection.get(field.sectionId) ?? 0) + 1);
  }

  const orderedSectionIds: OfferLetterFieldSectionId[] = [
    "candidate_school",
    "engagement",
    "training_alignment",
    "compensation",
    "signature",
    "readiness",
  ];

  return orderedSectionIds.map((id) => ({
    id,
    title: SECTION_TITLES[id],
    fields: OFFER_LETTER_FIELD_DEFINITIONS.filter((definition) => (
      definition.sectionId === id && (!template || used.has(definition.variable))
    )),
    missingCount: missingBySection.get(id) ?? 0,
  }));
}

export function buildOfferLetterPreviewModel(input: {
  template: AdminDocumentTemplate | null;
  values: OfferLetterManualFields;
  serverPreview?: OfferTemplatePreviewResponse | null;
  serverMissingVariables?: string[];
}): OfferLetterPreviewModel {
  const template = input.template;
  const serverPreview = input.serverPreview ?? null;
  const usedVariables = usedTemplateVariables(template);
  const missingVariables = requiredMissingVariables({
    template,
    values: input.values,
    serverMissingVariables: input.serverMissingVariables,
  });
  const missingFields = buildMissingFields(missingVariables);

  if (!template) {
    return {
      template: null,
      mode: "empty",
      title: "Select an offer letter template",
      body: "Choose a template to start building the offer letter.",
      titleTokens: [{ type: "text", text: "Select an offer letter template" }],
      bodyTokens: [{ type: "text", text: "Choose a template to start building the offer letter." }],
      usedVariables: [],
      missingFields: [],
      sections: buildSections(null, []),
      serverPreview: null,
      previewIsValid: false,
    };
  }

  const hasValidServerPreview =
    Boolean(serverPreview) &&
    (serverPreview?.missing_variables?.length ?? 0) === 0 &&
    missingFields.length === 0;
  const title = hasValidServerPreview ? serverPreview!.title : template.title_template;
  const body = hasValidServerPreview ? serverPreview!.body : template.body_template;
  const tokenMissingVariables = hasValidServerPreview ? new Set<string>() : missingVariables;

  return {
    template,
    mode: hasValidServerPreview ? "merged" : "raw_template",
    title,
    body,
    titleTokens: tokenizeOfferLetterTemplateText(title, tokenMissingVariables),
    bodyTokens: tokenizeOfferLetterTemplateText(body, tokenMissingVariables),
    usedVariables,
    missingFields,
    sections: buildSections(template, missingFields),
    serverPreview,
    previewIsValid: hasValidServerPreview,
  };
}
