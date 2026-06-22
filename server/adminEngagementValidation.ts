import { z } from "zod";

export const accessRoleSchema = z.enum(['super_admin', 'admin_finance', 'admin_verifier', 'admin_support', 'trainee_access']);
export const adminStatusSchema = z.enum(['pending', 'active', 'inactive', 'rejected']);
export const engagementTypeSchema = z.enum(['employee', 'intern', 'contractor', 'advisor', 'other']);
export const scheduleTypeSchema = z.enum(['full_time', 'part_time']);
export const workAuthorizationTypeSchema = z.enum(['none', 'cpt', 'opt', 'stem_opt', 'other']);
export const engagementStatusSchema = z.enum(['draft', 'invited', 'active', 'offboarding', 'ended', 'cancelled']);
export const activityTypeSchema = z.enum([
  'office_hour',
  'training',
  'learning',
  'research',
  'documentation',
  'draft_work',
  'meeting',
  'other',
]);
export const activityLogStatusSchema = z.enum(['submitted', 'reviewed']);
export const lifecycleEventTypeSchema = z.enum([
  'engagement_created',
  'engagement_updated',
  'invitation_sent',
  'account_activated',
  'onboarding_started',
  'engagement_activated',
  'permission_granted',
  'permission_revoked',
  'office_hour_attended',
  'training_completed',
  'offboarding_started',
  'access_disabled',
  'offboarding_email_sent',
  'offboarding_email_failed',
  'engagement_ended',
  'self_offboarding_requested',
  'early_offboarding_started',
  'engagement_cancelled',
  'activity_log_submitted',
  'offer_letter_created',
  'offer_letter_pdf_generated',
  'offer_letter_sent',
  'offer_letter_viewed',
  'offer_letter_accepted',
  'offer_letter_declined',
  'offer_letter_voided',
]);

export const engagementDocumentTypeSchema = z.enum(['offer_letter']);
export const documentTemplateStatusSchema = z.enum(['draft', 'active', 'archived']);
export const documentContentFormatSchema = z.enum(['plain_text']);
export const engagementDocumentStatusSchema = z.enum([
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'voided',
]);

const optionalDateSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const optionalNumberSchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? null : Number(value),
  z.number().int().min(0).max(168).nullable().optional()
);

const optionalNullableStringSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().nullable().optional()
);

export const engagementPayloadBaseSchema = z.object({
  engagementType: engagementTypeSchema,
  scheduleType: z.preprocess(
    (value) => value === "" ? null : value,
    scheduleTypeSchema.nullable().optional()
  ),
  workAuthorizationType: workAuthorizationTypeSchema.default('none'),
  startDate: optionalDateSchema,
  endDate: optionalDateSchema,
  supervisorAdminId: z.preprocess(
    (value) => value === "" || value === undefined || value === null ? null : Number(value),
    z.number().int().positive().nullable().optional()
  ),
  workScope: optionalNullableStringSchema,
  expectedHoursPerWeek: optionalNumberSchema,
  status: engagementStatusSchema.default('draft'),
});

export function validateEngagementDates(
  data: { engagementType?: string; startDate?: string | null; endDate?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.engagementType === 'intern' && !data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date is required for intern engagements',
    });
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End date cannot be before start date',
    });
  }
}

export const engagementPayloadSchema = engagementPayloadBaseSchema.superRefine(validateEngagementDates);
export const updateEngagementPayloadSchema = engagementPayloadBaseSchema.partial();

export function validateTraineeEngagement(
  data: {
    role?: string;
    engagement?: {
      endDate?: string | null;
      supervisorAdminId?: number | null;
      workScope?: string | null;
    };
  },
  ctx: z.RefinementCtx
) {
  if (data.role !== 'trainee_access') {
    return;
  }

  if (!data.engagement) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagement'],
      message: 'Engagement is required for Trainee Access',
    });
    return;
  }

  if (!data.engagement.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagement', 'endDate'],
      message: 'End date is required for Trainee Access',
    });
  }

  if (!data.engagement.supervisorAdminId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagement', 'supervisorAdminId'],
      message: 'Supervisor is required for Trainee Access',
    });
  }

  if (!data.engagement.workScope?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['engagement', 'workScope'],
      message: 'Work scope is required for Trainee Access',
    });
  }
}

export const adminUserUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: accessRoleSchema.optional(),
  status: adminStatusSchema.optional(),
  permissions: z.array(z.string()).nullable().optional(),
}).strict();

export const lifecycleEventPayloadSchema = z.object({
  eventType: lifecycleEventTypeSchema,
  occurredAt: z.coerce.date().optional(),
  metadata: z.record(z.any()).optional(),
  notes: z.string().nullable().optional(),
}).strict();

export const traineeActivityLogPayloadSchema = z.object({
  activityType: activityTypeSchema,
  activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Activity date is required"),
  durationMinutes: z.preprocess(
    (value) => value === "" || value === undefined || value === null ? null : Number(value),
    z.number().int().positive().max(480).nullable().optional()
  ),
  summary: z.string().trim().min(1, "Summary is required").max(2000),
  learningObjective: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(1000).nullable().optional()
  ),
}).strict();

export const traineeEndEngagementPayloadSchema = z.object({
  reason: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(1000).nullable().optional()
  ),
}).strict();

const manualTemplateMergeValuesSchema = {
  engagementTitle: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
  functionArea: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
  compensationText: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(4000).optional()
  ),
  schoolName: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
  programOrMajor: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(300).optional()
  ),
  workLocation: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(500).optional()
  ),
  responseDeadline: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
  responsibilitiesText: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(8000).optional()
  ),
  trainingAlignmentText: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(8000).optional()
  ),
  companyPhone: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(100).optional()
  ),
  companyEmail: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().email().max(320).optional()
  ),
  signatoryName: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
  signatoryTitle: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(200).optional()
  ),
};

const directOfferLetterPayloadSchema = z.object({
  documentType: engagementDocumentTypeSchema.default('offer_letter'),
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(20000),
}).strict();

const templateOfferLetterPayloadSchema = z.object({
  documentType: engagementDocumentTypeSchema.default('offer_letter'),
  templateId: z.coerce.number().int().positive(),
  ...manualTemplateMergeValuesSchema,
  title: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).max(200).optional()
  ),
  body: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).max(20000).optional()
  ),
}).strict();

export const offerLetterPayloadSchema = z.union([
  directOfferLetterPayloadSchema,
  templateOfferLetterPayloadSchema,
]);

export const documentTemplatePayloadSchema = z.object({
  documentType: engagementDocumentTypeSchema.default('offer_letter'),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(1000).nullable().optional()
  ),
  status: documentTemplateStatusSchema.default('draft'),
  titleTemplate: z.string().trim().min(1, "Title template is required").max(200),
  bodyTemplate: z.string().trim().min(1, "Body template is required").max(20000),
  contentFormat: documentContentFormatSchema.default('plain_text'),
  allowedVariables: z.array(z.string().trim().min(1).max(100)).optional(),
}).strict();

export const documentTemplateUpdatePayloadSchema = z.object({
  documentType: engagementDocumentTypeSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(1000).nullable().optional()
  ),
  status: documentTemplateStatusSchema.optional(),
  titleTemplate: z.string().trim().min(1).max(200).optional(),
  bodyTemplate: z.string().trim().min(1).max(20000).optional(),
  contentFormat: documentContentFormatSchema.optional(),
  allowedVariables: z.array(z.string().trim().min(1).max(100)).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "At least one template field is required",
);

export const templatePreviewPayloadSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  ...manualTemplateMergeValuesSchema,
}).strict();

export function validateActivityDateWithinEngagement(
  activityDate: string,
  engagement: { startDate?: string | Date | null; endDate?: string | Date | null }
): string | null {
  const toDateOnly = (value: string | Date | null | undefined) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };

  const startDate = toDateOnly(engagement.startDate);
  const endDate = toDateOnly(engagement.endDate);

  if (startDate && activityDate < startDate) {
    return "Activity date cannot be before your engagement start date";
  }

  if (endDate && activityDate > endDate) {
    return "Activity date cannot be after your engagement end date";
  }

  return null;
}
