import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  deriveAccessGroupsFromLegacyRole,
  deriveAccountTypeFromLegacyRole,
  deriveLegacyRoleFromAccountTypeAndAccessGroup,
} from "./adminAccessModel";
import {
  accessRoleSchema,
  adminUserUpdateSchema,
  documentTemplatePayloadSchema,
  documentTemplateUpdatePayloadSchema,
  engagementPayloadSchema,
  offerLetterPayloadSchema,
  lifecycleEventPayloadSchema,
  templatePreviewPayloadSchema,
  traineeActivityLogPayloadSchema,
  traineeEndEngagementPayloadSchema,
  validateActivityDateWithinEngagement,
  validateTraineeEngagement,
} from "./adminEngagementValidation";
import { deriveLegacyRoleFromIdentityAndAccessGroup } from "../client/src/lib/adminIdentity";
import {
  buildOfferLetterPreviewModel,
  emptyOfferLetterManualFields,
  tokenizeOfferLetterTemplateText,
  variableLabel,
} from "../client/src/components/offerLetter/offerLetterPreviewMapper";
import {
  parseOfferLetterPlainText,
  stripLegacyOfferLetterTextHeader,
} from "../shared/offerLetterPlainTextParser";
import { z } from "zod";

test("access role rejects engagement identity and lifecycle values", () => {
  for (const value of ['intern', 'contractor', 'employee', 'advisor', 'cpt', 'opt', 'stem_opt', 'full_time', 'part_time']) {
    assert.equal(accessRoleSchema.safeParse(value).success, false, `${value} must not be an access role`);
  }

  assert.equal(accessRoleSchema.safeParse('admin_finance').success, true);
  assert.equal(accessRoleSchema.safeParse('admin_verifier').success, true);
  assert.equal(accessRoleSchema.safeParse('admin_support').success, true);
  assert.equal(accessRoleSchema.safeParse('super_admin').success, true);
  assert.equal(accessRoleSchema.safeParse('trainee_access').success, true);
});

test("engagement validation accepts a valid engagement", () => {
  const result = engagementPayloadSchema.safeParse({
    engagementType: 'intern',
    scheduleType: 'part_time',
    workAuthorizationType: 'cpt',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    expectedHoursPerWeek: 20,
    status: 'draft',
  });

  assert.equal(result.success, true);
});

test("engagement validation rejects invalid engagement type and work authorization", () => {
  assert.equal(engagementPayloadSchema.safeParse({
    engagementType: 'seasonal',
    workAuthorizationType: 'none',
  }).success, false);

  assert.equal(engagementPayloadSchema.safeParse({
    engagementType: 'employee',
    workAuthorizationType: 'h1b',
  }).success, false);
});

test("engagement validation rejects intern without end date and invalid date order", () => {
  assert.equal(engagementPayloadSchema.safeParse({
    engagementType: 'intern',
    workAuthorizationType: 'none',
  }).success, false);

  assert.equal(engagementPayloadSchema.safeParse({
    engagementType: 'contractor',
    workAuthorizationType: 'none',
    startDate: '2026-09-01',
    endDate: '2026-08-31',
  }).success, false);
});

test("lifecycle event payload is append-only metadata and cannot carry permission mutations", () => {
  assert.equal(lifecycleEventPayloadSchema.safeParse({
    eventType: 'training_completed',
    notes: 'Completed onboarding training.',
    metadata: { course: 'admin-basics' },
  }).success, true);

  assert.equal(lifecycleEventPayloadSchema.safeParse({
    eventType: 'activity_log_submitted',
    metadata: { activity_log_id: 1, activity_type: 'learning', activity_date: '2026-06-20' },
  }).success, true);

  for (const eventType of [
    'onboarding_started',
    'engagement_activated',
    'offboarding_started',
    'access_disabled',
    'engagement_ended',
    'offboarding_email_sent',
    'offboarding_email_failed',
    'self_offboarding_requested',
    'early_offboarding_started',
    'engagement_cancelled',
    'offer_letter_created',
    'offer_letter_pdf_generated',
    'offer_letter_sent',
    'offer_letter_viewed',
    'offer_letter_accepted',
    'offer_letter_declined',
    'offer_letter_voided',
  ]) {
    assert.equal(lifecycleEventPayloadSchema.safeParse({
      eventType,
      metadata: { source: 'test' },
    }).success, true, `${eventType} should be valid`);
  }

  assert.equal(lifecycleEventPayloadSchema.safeParse({
    eventType: 'permission_granted',
    permissions: ['finance.*'],
  }).success, false);
});

test("offer letter validation accepts direct body and template create payloads only", () => {
  assert.equal(offerLetterPayloadSchema.safeParse({
    documentType: "offer_letter",
    title: "Offer Letter",
    body: "Please review this offer letter.",
  }).success, true);

  assert.equal(offerLetterPayloadSchema.safeParse({
    documentType: "offer_letter",
    templateId: 1,
    engagementTitle: "Operations Trainee",
    functionArea: "Operations",
    compensationText: "This trainee engagement is unpaid.",
    title: "Final title",
    body: "Final body",
  }).success, true);

  assert.equal(offerLetterPayloadSchema.safeParse({
    documentType: "contract",
    title: "Offer Letter",
    body: "Body",
  }).success, false);

  assert.equal(offerLetterPayloadSchema.safeParse({
    title: "",
    body: "Body",
  }).success, false);

  assert.equal(offerLetterPayloadSchema.safeParse({
    title: "Offer Letter",
    body: "Body",
    status: "accepted",
    adminUserId: 1,
    engagementId: 2,
    fileKey: "unsafe",
  }).success, false);
});

test("document template validation is plain-text and strict", () => {
  assert.equal(documentTemplatePayloadSchema.safeParse({
    documentType: "offer_letter",
    name: "Default Offer",
    status: "active",
    titleTemplate: "{{trainee_name}} Offer Letter",
    bodyTemplate: "Dear {{trainee_name}}",
    contentFormat: "plain_text",
    allowedVariables: ["trainee_name"],
  }).success, true);

  assert.equal(documentTemplatePayloadSchema.safeParse({
    documentType: "offer_letter",
    name: "HTML Offer",
    titleTemplate: "<h1>{{trainee_name}}</h1>",
    bodyTemplate: "<script>alert(1)</script>",
    contentFormat: "html",
  }).success, false);

  assert.equal(documentTemplatePayloadSchema.safeParse({
    documentType: "offer_letter",
    name: "Unsafe",
    titleTemplate: "{{trainee_name}}",
    bodyTemplate: "Body",
    status: "active",
    createdBy: 1,
  }).success, false);

  assert.equal(documentTemplateUpdatePayloadSchema.safeParse({
    bodyTemplate: "Updated {{trainee_name}}",
  }).success, true);
  assert.equal(documentTemplateUpdatePayloadSchema.safeParse({}).success, false);

  assert.equal(templatePreviewPayloadSchema.safeParse({
    templateId: 1,
    engagementTitle: "Research Trainee",
    functionArea: "Research",
    compensationText: "Compensation text",
  }).success, true);
  assert.equal(offerLetterPayloadSchema.safeParse({
    documentType: "offer_letter",
    templateId: 1,
    responsibilitiesText: "Supervised training activities.",
  }).success, true);
  assert.equal(offerLetterPayloadSchema.safeParse({
    documentType: "offer_letter",
    templateId: 1,
    companyEmail: "frontend-owned@example.com",
  }).success, false);
  assert.equal(templatePreviewPayloadSchema.safeParse({
    templateId: 1,
    companyPhone: "555-0100",
  }).success, false);
  assert.equal(templatePreviewPayloadSchema.safeParse({
    templateId: 1,
    engagementId: 2,
  }).success, false);
});

test("offer letter preview mapper highlights unresolved variables without evaluating template text", () => {
  const tokens = tokenizeOfferLetterTemplateText(
    "Dear {{school_name}}, <script>alert('x')</script>",
    new Set(["school_name"]),
  );

  const variableToken = tokens.find((token) => token.type === "variable");
  assert.equal(variableToken?.text, "{{school_name}}");
  assert.equal(variableToken?.missing, true);
  assert.equal(
    tokens.some((token) => token.type === "text" && token.text.includes("<script>alert('x')</script>")),
    true,
  );
});

test("offer letter preview mapper maps missing fields to readable sections", () => {
  const template = {
    id: 1,
    document_type: "offer_letter",
    name: "CPT Internship Offer Letter",
    description: null,
    status: "active",
    version: 1,
    title_template: "{{trainee_name}} Offer Letter",
    body_template: "School: {{school_name}}\nProgram: {{program_or_major}}\n{{responsibilities_text}}",
    content_format: "plain_text",
    allowed_variables: ["school_name", "program_or_major", "responsibilities_text"],
    created_at: "2026-06-23",
    updated_at: "2026-06-23",
  } as const;

  const model = buildOfferLetterPreviewModel({
    template: template as any,
    values: emptyOfferLetterManualFields(),
    serverMissingVariables: ["school_name", "program_or_major"],
  });

  assert.equal(variableLabel("school_name"), "School Name");
  assert.deepEqual(
    model.missingFields.map((field) => `${field.sectionTitle}:${field.label}`),
    [
      "Template:Program or Major",
      "Training Alignment:Primary Responsibilities",
      "Template:School Name",
    ],
  );
  assert.equal(model.previewIsValid, false);
});

test("Phase 3B.7 plain-text offer parser identifies formal document blocks safely", () => {
  const blocks = parseOfferLetterPlainText(`
1. Status, Schedule, and Location

This is a normal paragraph with <script>alert("x")</script> text.

* Schedule: part time
* Work location: Remote

Your primary responsibilities will include:

1. Conduct supervised research across a long list item that should wrap safely in renderers.
2. Document findings for supervisor review.

Sincerely,

Jane Manager
Founder & Manager

Acknowledged and Accepted:

By accepting this offer, you acknowledge the terms.
`);

  assert.equal(blocks.some((block) => block.type === "sectionHeading" && block.text === "Status, Schedule, and Location"), true);
  assert.equal(blocks.some((block) => block.type === "bulletList" && block.items.length === 2), true);
  assert.equal(blocks.some((block) => block.type === "numberedList" && block.items.length === 2), true);
  assert.equal(blocks.some((block) => block.type === "signatureBlock" && block.lines.includes("Jane Manager")), true);
  assert.equal(blocks.some((block) => block.type === "acknowledgmentBlock"), true);
  assert.equal(
    blocks.some((block) => block.type === "paragraph" && block.text.includes("<script>alert(\"x\")</script>")),
    true,
  );
  assert.equal(
    stripLegacyOfferLetterTextHeader("Yaotu Technologies, LLC\nRemote\n\nSubject: Offer", {
      companyName: "Yaotu Technologies, LLC",
      workLocation: "Remote",
    }),
    "Subject: Offer",
  );
});

test("trainee end engagement validation only accepts optional reason", () => {
  assert.equal(traineeEndEngagementPayloadSchema.safeParse({}).success, true);
  assert.equal(traineeEndEngagementPayloadSchema.safeParse({ reason: "Need to end early" }).success, true);
  assert.equal(traineeEndEngagementPayloadSchema.safeParse({ reason: "x".repeat(1001) }).success, false);
  assert.equal(traineeEndEngagementPayloadSchema.safeParse({
    reason: "Unsafe attempt",
    adminUserId: 99,
    engagementId: 88,
    status: "active",
    eventType: "engagement_ended",
  }).success, false);
});

test("trainee activity log validation accepts safe payload and rejects unsafe fields", () => {
  assert.equal(traineeActivityLogPayloadSchema.safeParse({
    activityType: 'learning',
    activityDate: '2026-06-20',
    durationMinutes: 45,
    summary: 'Completed onboarding reading.',
    learningObjective: 'Understand product basics.',
  }).success, true);

  assert.equal(traineeActivityLogPayloadSchema.safeParse({
    activityType: 'clock_in',
    activityDate: '2026-06-20',
    summary: 'Unsafe type.',
  }).success, false);

  assert.equal(traineeActivityLogPayloadSchema.safeParse({
    activityType: 'learning',
    activityDate: '2026-06-20',
    durationMinutes: 481,
    summary: 'Too long.',
  }).success, false);

  assert.equal(traineeActivityLogPayloadSchema.safeParse({
    activityType: 'learning',
    activityDate: '2026-06-20',
    summary: '',
  }).success, false);

  assert.equal(traineeActivityLogPayloadSchema.safeParse({
    activityType: 'learning',
    activityDate: '2026-06-20',
    summary: 'Cannot pick another user.',
    adminUserId: 99,
    engagementId: 88,
  }).success, false);
});

test("trainee activity log date must stay within engagement range", () => {
  const engagement = { startDate: '2026-06-01', endDate: '2026-08-31' };

  assert.equal(validateActivityDateWithinEngagement('2026-06-01', engagement), null);
  assert.equal(validateActivityDateWithinEngagement('2026-08-31', engagement), null);
  assert.match(validateActivityDateWithinEngagement('2026-05-31', engagement) ?? '', /before/);
  assert.match(validateActivityDateWithinEngagement('2026-09-01', engagement) ?? '', /after/);
});

test("admin update allowlist rejects protected fields", () => {
  assert.equal(adminUserUpdateSchema.safeParse({
    name: 'Finance Admin',
    role: 'admin_finance',
  }).success, true);

  for (const field of ['passwordHash', 'passwordSetupTokenHash', 'passwordSetupExpiresAt', 'createdBy', 'createdAt', 'lastLoginAt', 'mustChangePassword']) {
    assert.equal(adminUserUpdateSchema.safeParse({ [field]: 'unsafe' }).success, false, `${field} must be protected`);
  }
});

test("trainee access requires engagement, end date, supervisor, work scope, and offer seed fields", () => {
  const traineeCreateSchema = z.object({
    role: accessRoleSchema,
    engagement: engagementPayloadSchema.optional(),
  }).superRefine(validateTraineeEngagement);

  assert.equal(traineeCreateSchema.safeParse({ role: 'trainee_access' }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      supervisorAdminId: 1,
      workScope: 'Training project',
      positionTitle: 'Operations Trainee',
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      endDate: '2026-08-31',
      workScope: 'Training project',
      positionTitle: 'Operations Trainee',
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      endDate: '2026-08-31',
      supervisorAdminId: 1,
      positionTitle: 'Operations Trainee',
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      endDate: '2026-08-31',
      supervisorAdminId: 1,
      workScope: 'Training project',
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      endDate: '2026-08-31',
      supervisorAdminId: 1,
      workScope: 'Training project',
      positionTitle: 'Operations Trainee',
    },
  }).success, true);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'cpt',
      endDate: '2026-08-31',
      supervisorAdminId: 1,
      workScope: 'Training project',
      positionTitle: 'Operations Trainee',
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'cpt',
      endDate: '2026-08-31',
      supervisorAdminId: 1,
      workScope: 'Training project',
      positionTitle: 'Operations Trainee',
      schoolName: 'Wayne State University',
      programOrMajor: 'Information Systems',
      responseDeadline: '2026-07-15',
    },
  }).success, true);
  assert.equal(traineeCreateSchema.safeParse({ role: 'admin_finance' }).success, true);
});

test("identity and access group mapping derives legacy roles for Phase A compatibility", () => {
  assert.equal(
    deriveLegacyRoleFromIdentityAndAccessGroup('admin_staff', 'finance_admin'),
    'admin_finance'
  );
  assert.equal(
    deriveLegacyRoleFromIdentityAndAccessGroup('admin_staff', 'verifier_admin'),
    'admin_verifier'
  );
  assert.equal(
    deriveLegacyRoleFromIdentityAndAccessGroup('admin_staff', 'support_admin'),
    'admin_support'
  );
  assert.equal(
    deriveLegacyRoleFromIdentityAndAccessGroup('trainee', undefined),
    'trainee_access'
  );
  assert.equal(
    deriveLegacyRoleFromIdentityAndAccessGroup('admin_staff', undefined),
    undefined
  );
});

test("Phase B legacy role mapping derives account type and access grants", () => {
  assert.equal(deriveAccountTypeFromLegacyRole("trainee_access"), "trainee");
  assert.equal(deriveAccountTypeFromLegacyRole("admin_finance"), "admin_staff");
  assert.equal(deriveAccountTypeFromLegacyRole("admin_verifier"), "admin_staff");
  assert.equal(deriveAccountTypeFromLegacyRole("admin_support"), "admin_staff");
  assert.equal(deriveAccountTypeFromLegacyRole("super_admin"), "admin_staff");

  assert.deepEqual(deriveAccessGroupsFromLegacyRole("trainee_access"), ["trainee_offer_portal"]);
  assert.deepEqual(deriveAccessGroupsFromLegacyRole("admin_finance"), ["finance_admin"]);
  assert.deepEqual(deriveAccessGroupsFromLegacyRole("admin_verifier"), ["verifier_admin"]);
  assert.deepEqual(deriveAccessGroupsFromLegacyRole("admin_support"), ["support_admin"]);
  assert.deepEqual(deriveAccessGroupsFromLegacyRole("super_admin"), ["super_admin"]);

  assert.equal(
    deriveLegacyRoleFromAccountTypeAndAccessGroup("admin_staff", "finance_admin"),
    "admin_finance",
  );
  assert.equal(
    deriveLegacyRoleFromAccountTypeAndAccessGroup("trainee", "finance_admin"),
    "trainee_access",
  );
  assert.equal(
    deriveLegacyRoleFromAccountTypeAndAccessGroup("contractor", "support_admin"),
    undefined,
  );
});

test("Phase B migration adds account type and role-derived access grants without changing legacy role", async () => {
  const migration = await readFile(
    new URL("../migrations/0011_admin_account_type_access_grants.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "account_type" text/);
  assert.match(migration, /"role" = 'trainee_access' THEN 'trainee'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "admin_user_access_grants"/);
  assert.match(migration, /"admin_user_id" integer NOT NULL REFERENCES "admin_users"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /"access_group" text NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_user_access_grants_active_unique"/);
  assert.match(migration, /WHERE "revoked_at" IS NULL/);
  assert.match(migration, /'trainee_offer_portal'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /TO anon, authenticated/);
  assert.match(migration, /USING \(false\)/);
  assert.match(migration, /WITH CHECK \(false\)/);
  assert.match(migration, /WHEN 'admin_finance' THEN 'finance_admin'/);
  assert.match(migration, /WHEN 'admin_verifier' THEN 'verifier_admin'/);
  assert.match(migration, /WHEN 'admin_support' THEN 'support_admin'/);
  assert.match(migration, /WHEN 'trainee_access' THEN 'trainee_workspace'/);
  assert.match(migration, /WHEN 'super_admin' THEN 'super_admin'/);
  assert.doesNotMatch(migration, /DROP COLUMN "role"|ALTER TYPE "admin_role"/);
});

test("Phase B.1 migration adds trainee offer portal and accepted-offer workspace grants", async () => {
  const migration = await readFile(
    new URL("../migrations/0012_trainee_offer_portal_grants.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /'trainee_offer_portal'/);
  assert.match(migration, /"admin_users"\."role" = 'trainee_access'/);
  assert.match(migration, /"admin_users"\."status" = 'active'/);
  assert.match(migration, /"admin_engagement_documents"\."status" = 'accepted'/);
  assert.match(migration, /"admin_engagement_documents"\."accepted_at" IS NOT NULL/);
  assert.match(migration, /'offer_accepted_backfill'/);
  assert.match(migration, /"access_group" = 'trainee_workspace'/);
  assert.match(migration, /"revoked_at" IS NULL/);
  assert.match(migration, /intentionally not revoked/);
});

test("Phase 3B.6 migration adds engagement seed fields for offer letters", async () => {
  const migration = await readFile(
    new URL("../migrations/0013_engagement_seed_brand_defaults.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "position_title" text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "school_name" text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "program_or_major" text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "response_deadline" date/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "work_location" text/);
  assert.doesNotMatch(migration, /logo|company_name|company_email|company_phone|brand/i);
});

test("Phase 3B.7 template migration adds formal active offer template versions", async () => {
  const migration = await readFile(
    new URL("../migrations/0014_formal_offer_letter_template_typography.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /'CPT Internship Offer Letter'/);
  assert.match(migration, /'Default Offer Letter Template'/);
  assert.match(migration, /'active'/);
  assert.match(migration, /\b3,\s*\n\s*'Offer of Internship for \{\{engagement_title\}\}'/);
  assert.match(migration, /\b2,\s*\n\s*'Offer Letter for \{\{engagement_title\}\}'/);
  assert.match(migration, /internship position of \{\{engagement_title\}\}/);
  assert.match(migration, /training position of \{\{engagement_title\}\}/);
  assert.match(migration, /Your primary responsibilities will include:/);
  assert.match(migration, /"responsibilities_text"/);
  assert.match(migration, /"signatory_name"/);
  assert.match(migration, /"signatory_title"/);
  assert.match(migration, /"status" = 'archived'/);
  assert.doesNotMatch(migration, /dangerouslySetInnerHTML|raw html|rich text|html-to-pdf/i);
});

test("Phase B storage dual-writes account type and role-derived grants while preserving legacy non-trainee role auth", async () => {
  const storageSource = await readFile(new URL("./storage.ts", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(storageSource, /accountType: adminUser\.accountType \?\? deriveAccountTypeFromLegacyRole\(adminUser\.role\)/);
  assert.match(storageSource, /createRoleDerivedAccessGrants/);
  assert.match(storageSource, /syncRoleDerivedAccessGrants/);
  assert.match(storageSource, /ROLE_DERIVED_ACCESS_GRANT_SOURCE/);
  assert.match(storageSource, /ROLE_DERIVED_ACCESS_GRANT_SOURCES/);
  assert.match(storageSource, /getActiveAccessGroupsForAdminUser/);
  assert.match(routesSource, /accountType: serializedAdminUser\.accountType/);
  assert.match(routesSource, /accessGroups: serializedAdminUser\.accessGroups/);
  assert.match(routesSource, /adminUser: serializedAdminUser/);
  assert.match(routesSource, /requireRole\(\['super_admin'\]\)/);
  assert.match(routesSource, /requireRole\(\['super_admin', 'admin_finance'\]\)/);
  assert.match(routesSource, /requireRole\(\['super_admin', 'admin_verifier'\]\)/);
  assert.match(routesSource, /requireRole\(\['super_admin', 'admin_support'\]\)/);
  assert.doesNotMatch(routesSource, /requireAccessGroup\('finance_admin'\)|requireAccessGroup\('verifier_admin'\)|requireAccessGroup\('support_admin'\)|requireAccessGroup\('super_admin'\)/);
});

test("Phase B.1 offer acceptance grants trainee workspace before access-group runtime auth", async () => {
  const storageSource = await readFile(new URL("./storage.ts", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const offerLetterSource = await readFile(new URL("./offerLetterService.ts", import.meta.url), "utf8");

  assert.match(storageSource, /createTraineeWorkspaceGrantForAcceptedOffer/);
  assert.match(storageSource, /accessGroup: "trainee_workspace"/);
  assert.match(storageSource, /source: "offer_accepted"/);
  assert.match(storageSource, /documentId: document\.id/);
  assert.match(storageSource, /engagementId: document\.engagementId/);
  assert.match(storageSource, /existing\?\.status === "accepted"/);
  assert.match(storageSource, /\.onConflictDoNothing\(\)/);
  assert.match(storageSource, /revokeActiveTraineeAccessGrants/);
  assert.match(routesSource, /hasAcceptedOfferForCurrentTrainee/);
  assert.match(routesSource, /Offer acceptance is required to view trainee activity logs/);
  assert.match(routesSource, /Offer acceptance is required before submitting activity logs/);
  assert.match(routesSource, /engagement\.status !== 'active'/);
  assert.match(offerLetterSource, /if \(document\.status === "accepted"\)/);
  assert.match(offerLetterSource, /storage\.markOfferLetterAccepted\(input\.documentId, input\.adminUserId/);
  assert.match(routesSource, /requireAccessGroup\('trainee_workspace'\)/);
});

test("Phase C.1 access group middleware checks active server-side grants after authentication", async () => {
  const jwtAuthSource = await readFile(new URL("./jwtAuth.ts", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("./storage.ts", import.meta.url), "utf8");

  assert.match(jwtAuthSource, /export function requireAnyAccessGroup/);
  assert.match(jwtAuthSource, /export function requireAccessGroup/);
  assert.match(jwtAuthSource, /if \(!req\.user\)/);
  assert.match(jwtAuthSource, /storage\.getAdminUser\(parseInt\(req\.user\.id\)\)/);
  assert.match(jwtAuthSource, /adminUser\.status !== 'active'/);
  assert.match(jwtAuthSource, /storage\.getActiveAccessGroupsForAdminUser\(adminUser\.id\)/);
  assert.match(jwtAuthSource, /activeAccessGroups\.includes\(accessGroup\)/);
  assert.match(jwtAuthSource, /req\.activeAccessGroups = activeAccessGroups/);
  assert.match(jwtAuthSource, /export function requireRole/);
  assert.match(storageSource, /isNull\(adminUserAccessGrants\.revokedAt\)/);
});

test("Phase C.2 admin operations use explicit access groups without global super admin implication", async () => {
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const jwtAuthSource = await readFile(new URL("./jwtAuth.ts", import.meta.url), "utf8");

  const documentTemplateRoutePatterns = [
    /app\.get\("\/api\/admin\/document-templates", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/,
    /app\.get\("\/api\/admin\/document-templates\/:templateId", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/,
    /app\.post\("\/api\/admin\/document-templates", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/,
    /app\.patch\("\/api\/admin\/document-templates\/:templateId", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/,
    /app\.post\("\/api\/admin\/document-templates\/:templateId\/archive", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/,
  ];

  for (const pattern of documentTemplateRoutePatterns) {
    assert.match(routesSource, pattern);
  }

  assert.match(
    routesSource,
    /app\.post\("\/api\/admin\/engagements\/run-lifecycle-transitions", requireAuth, requireAnyAccessGroup\(\['super_admin', 'lifecycle_jobs'\]\)/,
  );

  assert.doesNotMatch(jwtAuthSource, /activeAccessGroups\.includes\("super_admin"\)[\s\S]*allowedAccessGroups\.includes/);
  assert.doesNotMatch(routesSource, /requireAccessGroup\('document_templates'\)|requireAccessGroup\('lifecycle_jobs'\)/);

  for (const forbidden of ['trainee_offer_portal', 'trainee_workspace', 'finance_admin', 'verifier_admin', 'support_admin']) {
    const adminOperationsBlock = routesSource.slice(
      routesSource.indexOf('"/api/admin/document-templates"'),
      routesSource.indexOf('app.put("/api/admin/users/:id"', routesSource.indexOf('"/api/admin/document-templates"')),
    );
    assert.equal(adminOperationsBlock.includes(forbidden), false, `${forbidden} must not authorize Admin Operations routes`);
  }

  assert.match(routesSource, /app\.get\("\/api\/admin\/finance", requireAuth, requireRole\(\['super_admin', 'admin_finance'\]\)/);
  assert.match(routesSource, /app\.get\("\/api\/admin\/verifier", requireAuth, requireRole\(\['super_admin', 'admin_verifier'\]\)/);
  assert.match(routesSource, /app\.get\("\/api\/admin\/support", requireAuth, requireRole\(\['super_admin', 'admin_support'\]\)/);
  assert.match(routesSource, /"\/api\/localguide\/admin\/cancellation-requests"[\s\S]*requireRole\(\["super_admin", "admin_finance"\]\)/);
});

test("create admin UI separates Identity Type, Access Groups, and Engagement fields", async () => {
  const source = await readFile(new URL("../client/src/pages/CreateAdmin.tsx", import.meta.url), "utf8");
  const identitySource = await readFile(new URL("../client/src/lib/adminIdentity.ts", import.meta.url), "utf8");
  const identityTypeSection = source.slice(
    source.indexOf('data-testid="select-identity-type"'),
    source.indexOf('{isAdminStaffIdentity &&')
  );
  const assignableAccessGroupSection = source.slice(
    source.indexOf('data-testid="select-assignable-access-group"'),
    source.indexOf('{isTraineeIdentity &&')
  );
  const defaultAccessGroupSection = source.slice(
    source.indexOf('Initial Access'),
    source.indexOf('<h2 className="text-lg font-medium text-foreground">Create Trainee Engagement Seed</h2>')
  );
  const workAuthorizationSection = source.slice(
    source.indexOf('data-testid="select-work-authorization-type"'),
    source.indexOf('data-testid="select-supervisor-admin"')
  );

  assert.match(source, />Identity Type</);
  assert.match(source, /Identity Type describes the person's relationship to the organization/);
  assert.match(identitySource, /Admin Staff/);
  assert.match(identitySource, /Trainee/);
  assert.match(source, /Assignable Access Groups/);
  assert.match(source, /Assignable Access Groups control which admin functions this person can use/);
  assert.match(identitySource, /Finance Admin/);
  assert.match(identitySource, /Verifier Admin/);
  assert.match(identitySource, /Support Admin/);
  assert.match(source, /Initial Access/);
  assert.match(identitySource, /Trainee Offer Portal/);
  assert.match(identitySource, /trainee_offer_portal/);
  assert.match(defaultAccessGroupSection, /DEFAULT_TRAINEE_ACCESS_GROUP\.label/);
  assert.match(defaultAccessGroupSection, /Auto-assigned for trainee accounts/);
  assert.match(defaultAccessGroupSection, /Trainee Workspace access is granted only after the offer letter is accepted/);
  assert.match(defaultAccessGroupSection, /This access group is assigned automatically and cannot be changed during trainee creation/);
  assert.match(defaultAccessGroupSection, /<Badge/);
  assert.doesNotMatch(defaultAccessGroupSection, /<Button|onClick|Switch|Checkbox|Toggle/);
  assert.match(source, /isTraineeIdentity &&/);
  assert.match(source, />Create Trainee Engagement Seed</);
  assert.match(source, />Offer Seed Facts</);
  assert.match(source, />Engagement Info</);
  assert.match(source, />Work Authorization</);
  assert.match(source, /End date is required for Trainee/);
  assert.match(source, /Trainee identity is for temporary interns or trainees/);
  assert.match(source, /Capture the reusable school, CPT, engagement, and offer seed facts/);
  assert.match(source, /payload\.deferSetupEmail = true/);
  assert.match(source, /fromCreate=1/);
  assert.match(source, /\? "Continue to Offer Letter"/);
  assert.match(source, /: "Create Admin User"/);
  assert.match(source, /data-testid="select-supervisor-admin"/);
  assert.doesNotMatch(source, /data-testid="input-supervisor-admin-id"/);
  assert.doesNotMatch(source, />Access Role</);
  assert.doesNotMatch(source, /Select an access role/);
  assert.doesNotMatch(source, /value="trainee_access">Trainee Access/);
  assert.doesNotMatch(source, /Account Type/);

  assert.match(identityTypeSection, /IDENTITY_TYPE_OPTIONS/);
  assert.match(assignableAccessGroupSection, /ASSIGNABLE_ACCESS_GROUP_OPTIONS/);
  assert.doesNotMatch(assignableAccessGroupSection, /trainee_access|Trainee Access/);
  assert.equal(assignableAccessGroupSection.includes('value="cpt"'), false);
  assert.equal(assignableAccessGroupSection.includes('value="opt"'), false);
  assert.equal(assignableAccessGroupSection.includes('value="stem_opt"'), false);
  assert.equal(assignableAccessGroupSection.includes('>CPT<'), false);
  assert.equal(assignableAccessGroupSection.includes('>OPT<'), false);
  assert.equal(assignableAccessGroupSection.includes('>STEM OPT<'), false);
  assert.doesNotMatch(defaultAccessGroupSection, /Finance Admin|Verifier Admin|Support Admin|Super Admin/);
  assert.match(workAuthorizationSection, /value="cpt">CPT/);
  assert.match(workAuthorizationSection, /value="opt">OPT/);
  assert.match(workAuthorizationSection, /value="stem_opt">STEM OPT/);

  for (const forbidden of ['cpt', 'opt', 'stem_opt']) {
    assert.equal(assignableAccessGroupSection.includes(`value="${forbidden}"`), false, `${forbidden} must not appear in assignable access groups`);
  }

  for (const required of [
    'form.setValue("accessGroup", undefined',
    'clearTraineeEngagementFields()',
    'deriveLegacyRoleFromIdentityAndAccessGroup',
    'role,',
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("trainee access does not gain existing sensitive sidebar routes", async () => {
  const source = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const sensitiveSections = [
    'Pending Requests',
    'Admin Management',
    'Admin Operations',
    'Finance Management',
    'Cancellation review',
    'Verifier Management',
    'Support Management',
  ];

  for (const section of sensitiveSections) {
    const index = source.indexOf(`title: "${section}"`);
    assert.notEqual(index, -1, `${section} should exist in Sidebar`);
    const nextTitleIndex = source.indexOf('title: "', index + 1);
    const block = source.slice(index, nextTitleIndex === -1 ? source.length : nextTitleIndex);
    assert.equal(block.includes('trainee_access'), false, `${section} must not allow trainee_access`);
  }

  assert.match(source, /title: "Trainee Workspace"/);
  assert.match(source, /href: "\/trainee"/);
  assert.match(source, /accessGroups: \['trainee_offer_portal', 'trainee_workspace'\]/);
  assert.doesNotMatch(source, /title: "Trainee Workspace"[\s\S]*roles: \['trainee_access'\]/);
});

test("trainee login redirects to trainee workspace and app defines safe route", async () => {
  const loginSource = await readFile(new URL("../client/src/pages/Login.tsx", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const protectedRouteSource = await readFile(new URL("../client/src/components/ProtectedRoute.tsx", import.meta.url), "utf8");
  const traineePageSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");

  assert.match(loginSource, /data\.user\.accessGroups \?\? \[\]/);
  assert.match(loginSource, /trainee_offer_portal/);
  assert.match(loginSource, /trainee_workspace/);
  assert.doesNotMatch(loginSource, /data\.user\.role === "trainee_access"/);
  assert.match(appSource, /path="\/trainee"/);
  assert.match(appSource, /allowedAccessGroups={\["trainee_offer_portal", "trainee_workspace"\]}/);
  assert.match(appSource, /hasTraineeAccess/);
  assert.doesNotMatch(appSource, /adminUser\?\.role === "trainee_access"/);
  assert.doesNotMatch(appSource, /allowedRoles=\{\[[^\]]*"trainee_access"[^\]]*"admin_finance"/);
  assert.match(protectedRouteSource, /allowedAccessGroups/);
  assert.match(protectedRouteSource, /accessGroups\.includes\(accessGroup\)/);
  assert.match(protectedRouteSource, /allowedRoles/);
  assert.match(traineePageSource, /Trainee Workspace/);
  assert.match(traineePageSource, /TabsTrigger value="overview"/);
  assert.match(traineePageSource, /TabsTrigger value="offer-letter"/);
  assert.match(traineePageSource, /TabsTrigger value="check-ins"/);
  assert.match(traineePageSource, /Current Engagement/);
  assert.match(traineePageSource, /Feedback Meeting Schedule/);
  assert.match(traineePageSource, /Absence Request/);
  assert.match(traineePageSource, /Learning Activity Log/);
  assert.match(traineePageSource, /Recent Learning Activity Logs/);
  assert.match(traineePageSource, /Please review and accept your offer letter to unlock the Trainee Workspace/);
  assert.match(traineePageSource, /Your offer has been accepted\. Learning Activity Logs will be available when your engagement becomes active/);
  assert.match(traineePageSource, /enabled: hasAcceptedOffer/);
  assert.match(traineePageSource, /Learning Activity Log submission is available when your engagement is active/);
  assert.match(traineePageSource, /No Learning Activity Logs submitted yet/);
  assert.match(traineePageSource, /Could not load your trainee workspace/);
  assert.match(traineePageSource, /End My Trainee Access/);
  assert.match(traineePageSource, /This will disable your trainee access/);
  assert.doesNotMatch(traineePageSource, /delete account|Delete Account|Clock In|Clock Out|\bPTO\b|\btimesheet\b|\bpayroll\b|\bshift\b/i);
});

test("backend sensitive routes and engagement management APIs do not allow trainee access", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const sensitivePatterns = [
    /app\.get\("\/api\/admin\/users", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.post\("\/api\/admin\/users", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.put\("\/api\/admin\/users\/:id", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.delete\("\/api\/admin\/users\/:id", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.get\("\/api\/admin\/approvals", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.put\("\/api\/admin\/approvals\/:id", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.get\("\/api\/admin\/finance", requireAuth, requireRole\(\['super_admin', 'admin_finance'\]\)/,
    /app\.get\("\/api\/admin\/verifier", requireAuth, requireRole\(\['super_admin', 'admin_verifier'\]\)/,
    /app\.get\("\/api\/admin\/support", requireAuth, requireRole\(\['super_admin', 'admin_support'\]\)/,
    /app\.get\("\/api\/admin\/users\/:id\/engagements", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.post\("\/api\/admin\/users\/:id\/engagements", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.patch\("\/api\/admin\/engagements\/:engagementId", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.post\("\/api\/admin\/engagements\/:engagementId\/events", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.get\("\/api\/admin\/engagements\/:engagementId\/activity-logs", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.get\("\/api\/admin\/engagements\/:engagementId\/documents", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.post\("\/api\/admin\/engagements\/:engagementId\/documents", requireAuth, requireRole\(\['super_admin'\]\)/,
  ];

  for (const pattern of sensitivePatterns) {
    assert.match(source, pattern);
  }
});

test("offer letter APIs use admin or trainee scoped permissions", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(source, /app\.get\("\/api\/admin\/document-templates", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/);
  assert.match(source, /app\.get\("\/api\/admin\/document-templates\/:templateId", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/);
  assert.match(source, /app\.post\("\/api\/admin\/document-templates", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/);
  assert.match(source, /app\.patch\("\/api\/admin\/document-templates\/:templateId", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/);
  assert.match(source, /app\.post\("\/api\/admin\/document-templates\/:templateId\/archive", requireAuth, requireAnyAccessGroup\(\['super_admin', 'document_templates'\]\)/);

  const previewStart = source.indexOf('"/api/admin/engagements/:engagementId/documents/preview-template"');
  assert.notEqual(previewStart, -1, "template preview route should exist");
  const previewBlock = source.slice(previewStart, source.indexOf(");", previewStart));
  assert.match(previewBlock, /requireRole\(\['super_admin'\]\)/);

  for (const required of [
    '"/api/admin/engagements/:engagementId/documents/:documentId/regenerate-pdf"',
    '"/api/admin/engagements/:engagementId/documents/:documentId/send"',
    '"/api/admin/engagements/:engagementId/documents/:documentId/download"',
    '"/api/admin/engagements/:engagementId/documents/:documentId/void"',
  ]) {
    const start = source.indexOf(required);
    assert.notEqual(start, -1, `${required} should exist`);
    const block = source.slice(start, source.indexOf(");", start));
    assert.match(block, /requireRole\(\['super_admin'\]\)/);
  }

  for (const required of [
    '"/api/trainee/me/documents"',
    '"/api/trainee/me/documents/:documentId/view"',
    '"/api/trainee/me/documents/:documentId/download"',
    '"/api/trainee/me/documents/:documentId/accept"',
  ]) {
    const start = source.indexOf(required);
    assert.notEqual(start, -1, `${required} should exist`);
    const block = source.slice(start, source.indexOf(");", start));
    assert.match(block, /requireAccessGroup\('trainee_offer_portal'\)/);
    assert.doesNotMatch(block, /requireRole\(\['trainee_access'\]\)/);
    assert.match(block, /req\.adminUser\.id/);
    assert.doesNotMatch(block, /req\.body\.adminUserId|req\.body\.engagementId|req\.params\.adminUserId/);
  }

  const traineeSanitizerStart = source.indexOf("function sanitizeTraineeDocument");
  const traineeSanitizerEnd = source.indexOf("function getRequestIp", traineeSanitizerStart);
  const traineeSanitizerBlock = source.slice(traineeSanitizerStart, traineeSanitizerEnd);
  assert.doesNotMatch(
    traineeSanitizerBlock,
    /mergeData|merge_data|templateTitle|template_body|templateBody|company_brand|companyBrand|assetPath|assetId|storageKey|logo|offerReadiness|resumeReviewed|discussionCompleted/,
  );
});

test("Phase 3B.6 company brand defaults are server-canonical and Step 2 stays narrow", async () => {
  const builderSource = await readFile(new URL("../client/src/components/offerLetter/OfferLetterBuilder.tsx", import.meta.url), "utf8");
  const mapperSource = await readFile(new URL("../client/src/components/offerLetter/offerLetterPreviewMapper.ts", import.meta.url), "utf8");
  const createSource = await readFile(new URL("../client/src/pages/CreateAdmin.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const validationSource = await readFile(new URL("./adminEngagementValidation.ts", import.meta.url), "utf8");
  const brandDefaultsSource = await readFile(new URL("./companyBrandDefaults.ts", import.meta.url), "utf8");
  const templateServiceSource = await readFile(new URL("./documentTemplateService.ts", import.meta.url), "utf8");
  const pdfSource = await readFile(new URL("./pdf/renderOfferLetterPdf.ts", import.meta.url), "utf8");

  assert.match(brandDefaultsSource, /YAOTU_COMPANY_BRAND_DEFAULTS/);
  assert.match(brandDefaultsSource, /companyName: "Yaotu Technologies, LLC"/);
  assert.match(brandDefaultsSource, /companyEmail: "info@ahhh-yaotu.com"/);
  assert.match(brandDefaultsSource, /companyPhone: "313-310-7902"/);
  assert.match(brandDefaultsSource, /defaultSignatoryTitle: "Founder & Manager"/);
  assert.match(brandDefaultsSource, /enabled: false/);
  assert.match(brandDefaultsSource, /assetPath: null/);
  assert.match(brandDefaultsSource, /TODO: Enable only after a canonical server-readable logo asset is added/);
  assert.match(brandDefaultsSource, /publicCompanyBrandDefaults/);
  assert.match(brandDefaultsSource, /companyBrandSnapshot/);
  assert.match(brandDefaultsSource, /companyBrandLogoAsset/);

  assert.match(templateServiceSource, /YAOTU_COMPANY_BRAND_DEFAULTS/);
  assert.match(templateServiceSource, /companyBrandSnapshot\(\)/);
  assert.match(templateServiceSource, /company_name: YAOTU_COMPANY_BRAND_DEFAULTS\.companyName/);
  assert.match(templateServiceSource, /company_email: YAOTU_COMPANY_BRAND_DEFAULTS\.companyEmail/);
  assert.match(templateServiceSource, /company_phone: YAOTU_COMPANY_BRAND_DEFAULTS\.companyPhone/);
  assert.match(templateServiceSource, /signatory_title: YAOTU_COMPANY_BRAND_DEFAULTS\.defaultSignatoryTitle/);

  assert.match(routesSource, /"\/api\/admin\/company-brand-defaults"/);
  assert.match(routesSource, /publicCompanyBrandDefaults\(\)/);
  assert.match(routesSource, /company_brand_defaults: publicCompanyBrandDefaults\(\)/);
  assert.match(pdfSource, /brandLogo/);
  assert.match(pdfSource, /doc\.image/);
  assert.match(pdfSource, /Company logo could not be rendered; omitting logo/);

  assert.match(createSource, /Create Trainee Engagement Seed/);
  assert.match(createSource, /School \/ CPT Info/);
  assert.match(createSource, /Offer Seed Facts/);
  assert.match(createSource, /positionTitle/);
  assert.match(createSource, /schoolName/);
  assert.match(createSource, /programOrMajor/);
  assert.match(createSource, /responseDeadline/);
  assert.match(createSource, /workLocation/);
  assert.match(createSource, /\/api\/admin\/company-brand-defaults/);

  assert.match(builderSource, /Reused from Engagement Seed/);
  assert.match(builderSource, /Company Brand Defaults/);
  assert.match(builderSource, /\/api\/admin\/company-brand-defaults/);
  assert.doesNotMatch(builderSource, /Yaotu Technologies, LLC|info@ahhh-yaotu\.com|313-310-7902|Founder & Manager/);
  assert.doesNotMatch(mapperSource, /companyPhone: ""|companyEmail: ""|signatoryTitle: ""/);
  const fieldPayloadStart = builderSource.indexOf("function fieldPayload");
  const fieldPayloadEnd = builderSource.indexOf("function focusField", fieldPayloadStart);
  const fieldPayloadBlock = builderSource.slice(fieldPayloadStart, fieldPayloadEnd);
  assert.doesNotMatch(
    fieldPayloadBlock,
    /companyPhone|companyEmail|signatoryTitle|engagementTitle|schoolName|programOrMajor|workLocation|responseDeadline/,
  );
  assert.doesNotMatch(builderSource + routesSource + validationSource, /offerReadiness|resumeReviewed|discussionCompleted|schoolDetailsConfirmed|responsibilitiesAligned/);
  assert.doesNotMatch(routesSource + validationSource, /resumeUpload|resumeParsing|rawResume|candidateLifecycle|rejectedCandidate/);
});

test("offer letter builder replaces old modal with document-first safe preview", async () => {
  const adminProfileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const builderSource = await readFile(new URL("../client/src/components/offerLetter/OfferLetterBuilder.tsx", import.meta.url), "utf8");
  const previewSource = await readFile(new URL("../client/src/components/offerLetter/OfferLetterDocumentPreview.tsx", import.meta.url), "utf8");
  const mapperSource = await readFile(new URL("../client/src/components/offerLetter/offerLetterPreviewMapper.ts", import.meta.url), "utf8");
  const pdfSource = await readFile(new URL("./pdf/renderOfferLetterPdf.ts", import.meta.url), "utf8");

  assert.match(adminProfileSource, /setLocation\(`\/admin-management\/profile\/\$\{adminId\}\/offer-letter\/new\?engagementId=\$\{engagement\.id\}`\)/);
  assert.doesNotMatch(adminProfileSource, /Final Title|Final Body|textarea-offer-letter-body|button-preview-offer-template/);

  assert.match(builderSource, /Offer Letter Builder/);
  assert.match(builderSource, /Missing Required Fields/);
  assert.match(builderSource, /Document Preview/);
  assert.match(builderSource, /fromCreate/);
  assert.match(builderSource, /Step 2 of 2: Create the offer letter for this trainee engagement/);
  assert.match(builderSource, /Skip for Now/);
  assert.match(builderSource, /Refresh Preview/);
  assert.match(builderSource, /setTimeout\(\(\) =>/);
  assert.match(builderSource, /documents\/preview-template/);
  assert.match(builderSource, /documentType: "offer_letter"/);
  assert.match(builderSource, /templateId: selectedTemplate\.id/);
  assert.match(builderSource, /disabled=\{createDisabled\}/);
  const createPayloadStart = builderSource.indexOf('documentType: "offer_letter"');
  const createPayloadEnd = builderSource.indexOf(');', createPayloadStart);
  const createPayloadBlock = builderSource.slice(createPayloadStart, createPayloadEnd);
  assert.doesNotMatch(createPayloadBlock, /title:\s*|body:\s*|offerReadiness|resumeReviewed|discussionCompleted/);

  assert.match(previewSource, /parseOfferLetterPlainText/);
  assert.match(previewSource, /stripLegacyOfferLetterTextHeader/);
  assert.match(previewSource, /sectionHeading/);
  assert.match(previewSource, /bulletList/);
  assert.match(previewSource, /numberedList/);
  assert.match(previewSource, /signatureBlock/);
  assert.match(previewSource, /acknowledgmentBlock/);
  assert.match(previewSource, /TokenizedText/);
  assert.match(previewSource, /data-variable/);
  assert.match(previewSource, /data-missing/);
  assert.doesNotMatch(previewSource, /dangerouslySetInnerHTML|innerHTML|ReactMarkdown|marked|markdown-to-jsx/i);

  assert.match(pdfSource, /OFFER_LETTER_PDF_TYPOGRAPHY/);
  assert.match(pdfSource, /BODY_FONT_SIZE: 10\.75/);
  assert.match(pdfSource, /TITLE_FONT_SIZE: 14\.5/);
  assert.match(pdfSource, /SECTION_FONT_SIZE: 11\.5/);
  assert.match(pdfSource, /parseOfferLetterPlainText/);
  assert.match(pdfSource, /renderListItem/);
  assert.match(pdfSource, /stripLegacyOfferLetterTextHeader/);
  assert.doesNotMatch(pdfSource, /\.text\("Trainee"/);
  assert.doesNotMatch(pdfSource, /\.text\("Engagement"/);
  assert.doesNotMatch(pdfSource, /\.text\("Offer Letter"/);
  assert.doesNotMatch(pdfSource, /Version \$\{input\.document\.version\}|Generated \$\{generatedAt\.toISOString\(\)\}/);

  assert.match(mapperSource, /VARIABLE_PATTERN/);
  assert.match(mapperSource, /tokenizeOfferLetterTemplateText/);
  assert.match(mapperSource, /serverPreview/);
  assert.doesNotMatch(mapperSource, /eval\(|new Function|dangerouslySetInnerHTML|innerHTML|marked|Markdown/i);
});

test("no migration was added for document-first offer letter builder", async () => {
  const migrationNames = await readdir(new URL("../migrations", import.meta.url));
  assert.equal(
    migrationNames.some((name) => /offer_letter_builder|document_first|phase_3b_4/i.test(name)),
    false,
  );
});

test("admin profile hides unsafe actions for accepted offer letters", async () => {
  const source = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");

  assert.match(
    source,
    /const canRegenerate = offerLetter && !\["accepted", "voided"\]\.includes\(offerLetter\.status\)/,
  );
  assert.match(
    source,
    /const canSend = offerLetter && \["draft", "sent", "viewed"\]\.includes\(offerLetter\.status\)/,
  );
  assert.match(
    source,
    /\{offerLetter && !\["accepted", "voided"\]\.includes\(offerLetter\.status\) && \(/,
  );
  assert.doesNotMatch(source, /\{offerLetter && offerLetter\.status !== "voided" && \(/);
});

test("offer letter route errors do not expose raw storage errors", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const start = source.indexOf("function handleOfferLetterRouteError");
  const end = source.indexOf("export async function registerRoutes", start);
  const block = source.slice(start, end);

  assert.match(block, /error instanceof z\.ZodError/);
  assert.match(block, /return res\.status\(400\)\.json\(\{ message: fallbackMessage \}\)/);
  assert.match(block, /console\.error\("\[offer-letter route\]"/);
  assert.match(block, /return res\.status\(500\)\.json\(\{ message: fallbackMessage \}\)/);
  assert.doesNotMatch(block, /error:\s*error|String\(error\)/);
});

test("lifecycle jobs are exposed only through admin operations", async () => {
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const sidebarSource = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const profileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const lifecycleJobsSource = await readFile(new URL("../client/src/pages/LifecycleJobs.tsx", import.meta.url), "utf8");
  const traineeSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");

  assert.match(appSource, /path="\/admin-operations\/lifecycle-jobs"/);
  assert.match(appSource, /allowedAccessGroups={\["super_admin", "lifecycle_jobs"\]}/);
  assert.match(sidebarSource, /title: "Admin Operations"/);
  assert.match(sidebarSource, /title: "Lifecycle Jobs"/);
  assert.match(sidebarSource, /href: "\/admin-operations\/lifecycle-jobs"/);
  assert.match(sidebarSource, /accessGroups: \['super_admin', 'lifecycle_jobs'\]/);
  assert.match(sidebarSource, /title: "Document Templates"/);
  assert.match(sidebarSource, /href: "\/admin-operations\/document-templates"/);
  assert.match(lifecycleJobsSource, /\/api\/admin\/engagements\/run-lifecycle-transitions/);
  assert.match(lifecycleJobsSource, /Run all due lifecycle transitions/);
  assert.match(lifecycleJobsSource, /Checks all due trainee engagements, not only one user/);
  assert.doesNotMatch(profileSource, /run-lifecycle-transitions|Run all due lifecycle transitions/);
  assert.doesNotMatch(traineeSource, /run-lifecycle-transitions|Run all due lifecycle transitions/);
});

test("document template management uses Admin Operations access group and renders plain-text previews", async () => {
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const sidebarSource = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const documentTemplatesSource = await readFile(new URL("../client/src/pages/DocumentTemplates.tsx", import.meta.url), "utf8");
  const adminProfileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const builderSource = await readFile(new URL("../client/src/components/offerLetter/OfferLetterBuilder.tsx", import.meta.url), "utf8");

  assert.match(appSource, /path="\/admin-operations\/document-templates"/);
  assert.match(appSource, /<DocumentTemplates \/>/);
  assert.match(appSource, /allowedAccessGroups={\["super_admin", "document_templates"\]}/);
  assert.match(appSource, /path="\/admin-management\/profile\/:id\/offer-letter\/new"/);
  assert.match(appSource, /<OfferLetterBuilderPage \/>/);
  assert.match(appSource, /path="\/admin-management\/profile\/:id"/);
  assert.match(appSource, /path="\/admin-management\/profile\/:id"[\s\S]*allowedRoles={\["super_admin"\]}/);

  const adminOperationsStart = sidebarSource.indexOf('title: "Admin Operations"');
  const adminOperationsEnd = sidebarSource.indexOf('title: "Finance Management"', adminOperationsStart);
  const adminOperationsBlock = sidebarSource.slice(adminOperationsStart, adminOperationsEnd);
  assert.match(adminOperationsBlock, /title: "Document Templates"/);
  assert.match(adminOperationsBlock, /href: "\/admin-operations\/document-templates"/);
  assert.match(adminOperationsBlock, /accessGroups: \['super_admin', 'admin_operations', 'document_templates', 'lifecycle_jobs', 'finance_admin', 'verifier_admin', 'support_admin'\]/);
  assert.match(adminOperationsBlock, /accessGroups: \['super_admin', 'document_templates'\]/);
  assert.match(sidebarSource, /visibleChildren\.length === 0/);
  assert.doesNotMatch(adminOperationsBlock, /roles: \['super_admin'\]|trainee_access|trainee_offer_portal|trainee_workspace/);

  assert.match(documentTemplatesSource, /\/api\/admin\/document-templates/);
  assert.match(documentTemplatesSource, /Edit \/ Create New Version/);
  assert.match(documentTemplatesSource, /Duplicate Template/);
  assert.match(documentTemplatesSource, /Archive Document Template/);
  assert.match(documentTemplatesSource, /Raw Template/);
  assert.match(documentTemplatesSource, /Sample Merged Preview/);
  assert.match(documentTemplatesSource, /TemplateBodyBlock/);
  assert.match(documentTemplatesSource, /whitespace-pre-wrap/);
  assert.doesNotMatch(documentTemplatesSource, /dangerouslySetInnerHTML|innerHTML|ReactMarkdown|marked|markdown-to-jsx/i);

  assert.match(adminProfileSource, /offer-letter\/new\?engagementId=/);
  assert.doesNotMatch(adminProfileSource, /Final Title|Final Body|button-view-offer-template|Preview Template/);
  assert.match(builderSource, /View Raw Template/);
  assert.match(builderSource, /Raw Template is the reusable plain-text template with variables/);
  assert.match(builderSource, /Document Preview is the final merged offer draft/);
  assert.match(builderSource, /template\.status !== "archived"/);
});

test("trainee workspace APIs are scoped to authenticated trainee", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  const routeExpectations = [
    {
      method: "get",
      route: '"/api/trainee/me/engagement"',
      access: /requireAnyAccessGroup\(\['trainee_offer_portal', 'trainee_workspace'\]\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/lifecycle-events"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/documents"',
      access: /requireAccessGroup\('trainee_offer_portal'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/documents/:documentId/view"',
      access: /requireAccessGroup\('trainee_offer_portal'\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/documents/:documentId/download"',
      access: /requireAccessGroup\('trainee_offer_portal'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/documents/:documentId/accept"',
      access: /requireAccessGroup\('trainee_offer_portal'\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/activity-logs"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/activity-logs"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/check-ins"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "get",
      route: '"/api/trainee/me/feedback-meetings/calendar.ics"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/feedback-schedule"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/feedback-schedule/change-request"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
    {
      method: "post",
      route: '"/api/trainee/me/feedback-meetings/:occurrenceId/absence-request"',
      access: /requireAccessGroup\('trainee_workspace'\)/,
    },
  ];

  for (const { method, route, access } of routeExpectations) {
    const routeStart = source.indexOf(route);
    assert.notEqual(routeStart, -1, `${route} should exist`);
    const methodStart = source.lastIndexOf(`app.${method}(`, routeStart);
    assert.notEqual(methodStart, -1, `app.${method} ${route} should exist`);
    const end = source.indexOf('\n  app.', routeStart + 1);
    const block = source.slice(methodStart, end === -1 ? source.length : end);

    assert.match(block, /requireAuth/);
    assert.match(block, access);
    assert.doesNotMatch(block, /requireRole\(\['trainee_access'\]\)/);
    assert.match(block, /req\.adminUser\.id/);
    assert.doesNotMatch(block, /req\.params\.adminUserId|req\.body\.adminUserId|req\.body\.engagementId/);
  }

  const postStart = source.indexOf('"/api/trainee/me/activity-logs"');
  const postEnd = source.indexOf('  // Admin management routes', postStart);
  const postBlock = source.slice(postStart, postEnd);

  assert.match(postBlock, /engagement\.status !== 'active'/);
  assert.match(postBlock, /validateActivityDateWithinEngagement/);
  assert.match(postBlock, /eventType: 'activity_log_submitted'/);
  assert.match(postBlock, /status: 'submitted'/);

  const endStart = source.indexOf('"/api/trainee/me/end-engagement"');
  const endEnd = source.indexOf('  // Admin management routes', endStart);
  const endBlock = source.slice(endStart, endEnd);

  assert.match(endBlock, /requireAuth/);
  assert.match(endBlock, /requireAnyAccessGroup\(\['trainee_offer_portal', 'trainee_workspace'\]\)/);
  assert.doesNotMatch(endBlock, /requireRole\(\['trainee_access'\]\)/);
  assert.match(endBlock, /traineeEndEngagementPayloadSchema/);
  assert.match(endBlock, /selfOffboardTraineeEngagement/);
  assert.match(endBlock, /adminUserId: req\.adminUser\.id/);
  assert.doesNotMatch(endBlock, /req\.params|req\.body\.adminUserId|req\.body\.engagementId|req\.body\.status|req\.body\.eventType/);
});

test("admin and assigned supervisor check-in APIs use scoped admin staff access", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(source, /const adminStaffAccessGroups: AdminAccessGroup\[\]/);
  assert.match(source, /function canAccessEngagementCheckIns/);
  assert.match(source, /adminUser\?\.role === 'super_admin' \|\| engagement\.supervisorAdminId === adminUser\?\.id/);

  const scopedRoutes = [
    '"/api/admin/engagements/:engagementId/check-ins"',
    '"/api/admin/feedback-slots"',
    '"/api/admin/feedback-slots/:slotId"',
    '"/api/admin/feedback-slots/:slotId"',
    '"/api/admin/engagements/:engagementId/feedback-meetings/:occurrenceId/status"',
  ];

  for (const route of scopedRoutes) {
    const routeStart = source.indexOf(route);
    assert.notEqual(routeStart, -1, `${route} should exist`);
    const appStart = source.lastIndexOf("app.", routeStart);
    const end = source.indexOf('\n  app.', routeStart + 1);
    const block = source.slice(appStart, end === -1 ? source.length : end);
    assert.match(block, /requireAuth/);
    assert.match(block, /requireAnyAccessGroup\(adminStaffAccessGroups\)/);
    assert.doesNotMatch(block, /requireRole\(\['super_admin'\]\)/);
  }

  const checkInsRoute = source.slice(
    source.indexOf('"/api/admin/engagements/:engagementId/check-ins"'),
    source.indexOf('"/api/admin/feedback-slots"'),
  );
  assert.match(checkInsRoute, /canAccessEngagementCheckIns\(req\.adminUser, engagement\)/);

  const createSlotRoute = source.slice(
    source.indexOf('"/api/admin/feedback-slots"'),
    source.indexOf('"/api/admin/feedback-slots/:slotId"'),
  );
  assert.match(createSlotRoute, /payload\.supervisorAdminId !== req\.adminUser\.id/);
  assert.match(createSlotRoute, /supervisor\.role === "trainee_access"/);

  const updateSlotRoute = source.slice(
    source.indexOf('"/api/admin/feedback-slots/:slotId"'),
    source.indexOf('"/api/admin/engagements/:engagementId/feedback-meetings/:occurrenceId/status"'),
  );
  assert.match(updateSlotRoute, /storage\.getFeedbackSlot\(slotId\)/);
  assert.match(updateSlotRoute, /findOverlappingActiveFeedbackSlot/);
  assert.match(updateSlotRoute, /storage\.countFeedbackSchedulesReferencingSlot/);
  assert.match(updateSlotRoute, /storage\.deleteFeedbackSlot/);

  const statusRoute = source.slice(
    source.indexOf('"/api/admin/engagements/:engagementId/feedback-meetings/:occurrenceId/status"'),
    source.indexOf('app.get\("/api/admin/company-brand-defaults"', source.indexOf('"/api/admin/engagements/:engagementId/feedback-meetings/:occurrenceId/status"')),
  );
  assert.match(statusRoute, /canAccessEngagementCheckIns\(req\.adminUser, engagement\)/);
  assert.match(statusRoute, /listFeedbackMeetingOccurrencesForEngagement\(engagementId\)/);
});

test("trainee feedback schedule captures exact meeting times inside supervisor ranges", async () => {
  const traineePageSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");
  const validationSource = await readFile(new URL("./adminEngagementValidation.ts", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(traineePageSource, /SelectValue placeholder="Select available range"/);
  assert.match(traineePageSource, /Availability Window/);
  assert.match(traineePageSource, /exact recurring Feedback Meeting start and end time inside that window/);
  assert.match(traineePageSource, /Available range:/);
  assert.match(traineePageSource, /input-feedback-meeting-start/);
  assert.match(traineePageSource, /input-feedback-meeting-end/);
  assert.match(traineePageSource, /selections,/);
  assert.doesNotMatch(traineePageSource, /slotIds/);

  assert.match(validationSource, /feedbackScheduleSelectionPayloadSchema/);
  assert.match(validationSource, /slotId: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(validationSource, /startTime: timeOfDaySchema/);
  assert.match(validationSource, /endTime: timeOfDaySchema/);
  assert.match(validationSource, /Selected Feedback Meeting times must be unique/);
  assert.doesNotMatch(validationSource, /slotIds: z\.array/);

  assert.match(routesSource, /selection\.startTime < slot\.startTime \|\| selection\.endTime > slot\.endTime/);
  assert.match(routesSource, /availabilityStartTime: slot\.startTime/);
  assert.match(routesSource, /availabilityEndTime: slot\.endTime/);
  assert.match(routesSource, /startTime: selection\.startTime/);
  assert.match(routesSource, /endTime: selection\.endTime/);
});

test("feedback meeting availability settings are centralized outside trainee profile", async () => {
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const sidebarSource = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const profileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../client/src/pages/FeedbackMeetingSlots.tsx", import.meta.url), "utf8");
  const editorSource = await readFile(new URL("../client/src/components/checkins/FeedbackAvailabilityEditor.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(appSource, /path="\/admin-operations\/feedback-meeting-slots"/);
  assert.match(appSource, /<FeedbackMeetingSlots \/>/);
  assert.match(sidebarSource, /title: "Feedback Meeting Availability"/);
  assert.match(sidebarSource, /href: "\/admin-operations\/feedback-meeting-slots"/);

  assert.match(profileSource, /link-feedback-slot-settings/);
  assert.match(profileSource, /\/admin-operations\/feedback-meeting-slots\?supervisorAdminId=/);
  assert.match(profileSource, /<FeedbackAvailabilityEditor/);
  assert.match(profileSource, /Supervisor Availability Windows/);
  assert.match(profileSource, /Selected Feedback Meeting Schedule/);
  assert.doesNotMatch(profileSource, /button-add-feedback-availability|input-feedback-availability-start|checkbox-feedback-availability-day/);

  assert.match(settingsSource, /querySupervisorIdFromLocation/);
  assert.match(settingsSource, /requestedSupervisorId/);
  assert.match(settingsSource, /Feedback Meeting Availability/);
  assert.match(settingsSource, /<FeedbackAvailabilityEditor/);
  assert.match(editorSource, /Add Availability Windows/);
  assert.match(editorSource, /Show inactive windows/);
  assert.match(editorSource, /formatAvailabilityTimeRange/);
  assert.match(editorSource, /End of Day/);
  assert.match(editorSource, /button-edit-feedback-availability/);
  assert.match(editorSource, /button-toggle-feedback-availability/);
  assert.match(editorSource, /button-delete-feedback-availability/);
  assert.match(editorSource, /Existing confirmed trainee schedules remain unchanged/);
  assert.match(editorSource, /GET", `\/api\/admin\/feedback-slots\?supervisorAdminId=/);

  assert.match(routesSource, /app\.get\("\/api\/admin\/feedback-slots", requireAuth, requireAnyAccessGroup\(adminStaffAccessGroups\)/);
  assert.match(routesSource, /supervisorAdminId !== req\.adminUser\.id/);
  assert.match(routesSource, /findOverlappingActiveFeedbackSlot/);
  assert.match(routesSource, /storage\.deleteFeedbackSlot/);
  assert.match(routesSource, /This availability window is referenced by trainee Feedback Meeting schedules/);
});

test("trainee feedback meeting calendar export is an ICS download from exact occurrences", async () => {
  const traineePageSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(traineePageSource, /button-download-feedback-calendar/);
  assert.match(traineePageSource, /Add to Calendar \(\.ics\)/);
  assert.match(traineePageSource, /\/api\/trainee\/me\/feedback-meetings\/calendar\.ics/);

  assert.match(routesSource, /app\.get\("\/api\/trainee\/me\/feedback-meetings\/calendar\.ics"/);
  assert.match(routesSource, /buildFeedbackMeetingsIcs/);
  assert.match(routesSource, /Content-Type", "text\/calendar; charset=utf-8"/);
  assert.match(routesSource, /DTSTART;TZID=/);
  assert.match(routesSource, /DTEND;TZID=/);
  assert.match(routesSource, /Trainee: /);
  assert.match(routesSource, /Supervisor: /);
  assert.match(routesSource, /occurrence\.status === "scheduled"/);
});

test("trainee engagement empty state and lifecycle metadata are sanitized", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const engagementStart = source.indexOf('"/api/trainee/me/engagement"');
  const engagementEnd = source.indexOf('"/api/trainee/me/lifecycle-events"', engagementStart);
  const engagementBlock = source.slice(engagementStart, engagementEnd);

  assert.match(engagementBlock, /return res\.json\(null\)/);
  assert.doesNotMatch(engagementBlock, /status\(404\)/);
  assert.match(source, /metadata: sanitizeTraineeLifecycleMetadata\(event\.metadata\)/);
  const sanitizerStart = source.indexOf("function sanitizeTraineeLifecycleMetadata");
  const sanitizerEnd = source.indexOf("function sanitizeActivityLog", sanitizerStart);
  const sanitizerBlock = source.slice(sanitizerStart, sanitizerEnd);

  assert.match(sanitizerBlock, /const safeKeys = new Set/);
  assert.doesNotMatch(sanitizerBlock, /password/);
  assert.doesNotMatch(sanitizerBlock, /token/);
  assert.doesNotMatch(sanitizerBlock, /hash/);
});

test("create admin route directly creates active setup account instead of pending approval", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/admin/users"');
  const end = source.indexOf('app.get("/api/admin/users/:id/engagements"', start);
  const createRouteBlock = source.slice(start, end);

  assert.match(createRouteBlock, /createAdminAccountForPasswordSetup/);
  assert.match(createRouteBlock, /sendAdminPasswordSetupEmail/);
  assert.match(createRouteBlock, /deferSetupEmail/);
  assert.match(createRouteBlock, /setupEmailDeferred/);
  assert.match(createRouteBlock, /admin: await serializeAdminUser\(delivery\.admin\)/);
  assert.match(createRouteBlock, /engagement: delivery\.engagement \?\? null/);
  assert.match(createRouteBlock, /Admin was created and activated, but password setup email failed/);
  assert.match(createRouteBlock, /if \(!setupEmailDeferred\)/);
  assert.match(createRouteBlock, /eventType: 'invitation_sent'/);
  assert.doesNotMatch(createRouteBlock, /createPendingAdminAccount/);
  assert.doesNotMatch(createRouteBlock, /createAdminUserWithApprovalAndEngagement/);
});

test("create admin duplicate email uses safe 409 response and field-level UI error", async () => {
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const createSource = await readFile(new URL("../client/src/pages/CreateAdmin.tsx", import.meta.url), "utf8");
  const routeStart = routesSource.indexOf('app.post("/api/admin/users"');
  const routeEnd = routesSource.indexOf('app.get("/api/admin/users/:id/engagements"', routeStart);
  const createRouteBlock = routesSource.slice(routeStart, routeEnd);
  const duplicateResponseStart = createRouteBlock.indexOf("if (isAdminEmailUniqueViolation(error))");
  const duplicateResponseBlock = createRouteBlock.slice(
    duplicateResponseStart,
    createRouteBlock.indexOf("console.error", duplicateResponseStart),
  );
  const duplicateUiStart = createSource.indexOf("if (isDuplicateEmailError(error))");
  const duplicateUiBlock = createSource.slice(
    duplicateUiStart,
    createSource.indexOf('title: "Error"', duplicateUiStart),
  );

  assert.notEqual(duplicateResponseStart, -1);
  assert.match(routesSource, /function isAdminEmailUniqueViolation/);
  assert.match(routesSource, /errorField\(error, "code"\) !== "23505"/);
  assert.match(routesSource, /admin_users_email/);
  assert.match(duplicateResponseBlock, /status\(409\)\.json/);
  assert.match(duplicateResponseBlock, /message: "An admin user with this email already exists\."/);
  assert.match(duplicateResponseBlock, /code: "ADMIN_EMAIL_EXISTS"/);
  assert.match(duplicateResponseBlock, /field: "email"/);
  assert.match(createRouteBlock, /res\.status\(400\)\.json\(\{ message: "Failed to create admin user" \}\)/);

  assert.notEqual(duplicateUiStart, -1);
  assert.match(createSource, /body\.code === "ADMIN_EMAIL_EXISTS" \|\| body\.field === "email"/);
  assert.match(createSource, /An admin user with this email already exists\. Use a different email or open the existing profile\./);
  assert.match(duplicateUiBlock, /form\.setError\("email"/);
  assert.match(duplicateUiBlock, /DUPLICATE_EMAIL_MESSAGE/);
  assert.match(duplicateUiBlock, /variant: "destructive"/);
  assert.doesNotMatch(duplicateUiBlock, /navigate\(|offer-letter\/new|admin-management/);
  assert.match(createSource, /CREATE_USER_GENERIC_ERROR_MESSAGE[\s\S]*Failed to create user\. Please check the form and try again\./);
});

test("delete admin page and route perform confirmed destructive deletion", async () => {
  const deleteSource = await readFile(new URL("../client/src/pages/DeleteAdmin.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const storageSource = await readFile(new URL("./storage.ts", import.meta.url), "utf8");

  assert.match(deleteSource, /apiRequest\("DELETE", `\/api\/admin\/users\/\$\{adminId\}`\)/);
  assert.match(deleteSource, /input-delete-admin-confirmation/);
  assert.match(deleteSource, /confirmation\.trim\(\) === expectedConfirmation/);
  assert.match(deleteSource, /disabled=\{!confirmed \|\| deleteMutation\.isPending\}/);
  assert.match(deleteSource, /button-confirm-delete-admin/);
  assert.doesNotMatch(deleteSource, /Admin deletion functionality will be implemented here/);

  const routeStart = routesSource.indexOf('app.delete("/api/admin/users/:id"');
  const routeEnd = routesSource.indexOf("  // Approval workflow routes", routeStart);
  const deleteRouteBlock = routesSource.slice(routeStart, routeEnd);
  assert.match(deleteRouteBlock, /requireRole\(\['super_admin'\]\)/);
  assert.match(deleteRouteBlock, /id === req\.adminUser\.id/);
  assert.match(deleteRouteBlock, /storage\.getAdminUser\(id\)/);
  assert.match(deleteRouteBlock, /status\(404\)\.json\(\{ message: "Admin user not found" \}\)/);
  assert.match(deleteRouteBlock, /storage\.deleteAdminUser\(id\)/);

  const storageStart = storageSource.indexOf("async deleteAdminUser");
  const storageEnd = storageSource.indexOf("async listAdminUsers", storageStart);
  const deleteStorageBlock = storageSource.slice(storageStart, storageEnd);
  assert.match(deleteStorageBlock, /db\.transaction/);
  assert.match(deleteStorageBlock, /adminEngagementDocuments/);
  assert.match(deleteStorageBlock, /adminActivityLogs/);
  assert.match(deleteStorageBlock, /adminLifecycleEvents/);
  assert.match(deleteStorageBlock, /adminUserAccessGrants/);
  assert.match(deleteStorageBlock, /adminUserApprovals/);
  assert.match(deleteStorageBlock, /adminEngagements/);
  assert.match(deleteStorageBlock, /adminUsers/);
});

test("admin profile lets super admin edit trainee engagement seed fields after Step 1", async () => {
  const profileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  assert.match(profileSource, /Edit Profile Info/);
  assert.match(profileSource, /button-edit-profile-info/);
  assert.match(profileSource, /input-edit-admin-name/);
  assert.match(profileSource, /input-edit-admin-email/);
  assert.match(profileSource, /apiRequest\("PUT", `\/api\/admin\/users\/\$\{admin\.id\}`/);
  assert.match(profileSource, /queryClient\.setQueryData\(\["\/api\/admin\/users", adminId\], updatedAdmin\)/);
  assert.match(profileSource, /Edit Engagement Seed/);
  assert.match(profileSource, /button-edit-engagement-/);
  assert.match(profileSource, /input-edit-position-title/);
  assert.match(profileSource, /input-edit-school-name/);
  assert.match(profileSource, /input-edit-program-or-major/);
  assert.match(profileSource, /input-edit-response-deadline/);
  assert.match(profileSource, /input-edit-work-location/);
  assert.match(profileSource, /textarea-edit-work-scope/);
  assert.match(profileSource, /select-edit-supervisor-admin/);
  assert.match(profileSource, /apiRequest\(\s*"PATCH",\s*`\/api\/admin\/engagements\/\$\{editingEngagement\.id\}`/);
  assert.match(profileSource, /positionTitle: engagementEditForm\.positionTitle \|\| null/);
  assert.match(profileSource, /schoolName: engagementEditForm\.schoolName \|\| null/);
  assert.match(profileSource, /programOrMajor: engagementEditForm\.programOrMajor \|\| null/);
  assert.match(profileSource, /responseDeadline: engagementEditForm\.responseDeadline \|\| null/);
  assert.match(profileSource, /workLocation: engagementEditForm\.workLocation \|\| null/);
  assert.match(profileSource, /queryKey: \["\/api\/admin\/users", adminId, "engagements"\]/);
  assert.match(routesSource, /app\.put\("\/api\/admin\/users\/:id"/);
  assert.match(routesSource, /isAdminEmailUniqueViolation\(error\)/);
  assert.match(routesSource, /An admin with this email already exists\./);
});

test("phase 3B.6 two-step trainee create defers setup and carries offer seed fields", async () => {
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const createSource = await readFile(new URL("../client/src/pages/CreateAdmin.tsx", import.meta.url), "utf8");
  const builderSource = await readFile(new URL("../client/src/components/offerLetter/OfferLetterBuilder.tsx", import.meta.url), "utf8");
  const profileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const traineeSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");
  const createRouteBlock = routesSource.slice(
    routesSource.indexOf('app.post("/api/admin/users"'),
    routesSource.indexOf('app.get("/api/admin/users/:id/engagements"'),
  );

  assert.match(createRouteBlock, /Setup email deferral is only supported for trainee creation/);
  assert.match(createRouteBlock, /setupEmailDeferred/);
  assert.match(createRouteBlock, /engagement: delivery\.engagement \?\? null/);
  assert.match(createSource, /payload\.deferSetupEmail = true/);
  assert.match(createSource, /input-position-title/);
  assert.match(createSource, /input-school-name/);
  assert.match(createSource, /input-program-or-major/);
  assert.match(createSource, /input-response-deadline/);
  assert.match(createSource, /input-work-location/);
  assert.match(createSource, /Continue to Offer Letter/);
  assert.match(createSource, /Trainee engagement created\. Continue by creating the offer letter/);
  assert.match(createSource, /\/admin-management\/profile\/\$\{admin\.id\}\/offer-letter\/new\?engagementId=\$\{engagement\.id\}&fromCreate=1/);
  assert.match(builderSource, /Step 2 of 2: Create the offer letter for this trainee engagement/);
  assert.match(builderSource, /Reused from Engagement Seed/);
  assert.match(builderSource, /Company Brand Defaults/);
  assert.match(builderSource, /data-testid="button-skip-offer-letter-for-now"/);
  assert.match(profileSource, /No offer letter has been created for this trainee yet/);
  assert.match(profileSource, /Create Offer Letter/);
  assert.match(traineeSource, /No offer letter is available yet/);
  assert.match(traineeSource, /enabled: hasAcceptedOffer/);
  assert.doesNotMatch(createSource + builderSource + profileSource + routesSource, /resumeUpload|resumeParsing|rawResume|candidateLifecycle|rejectedCandidate|DocuSign|signed-copy/i);
});
