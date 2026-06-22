import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(templatePreviewPayloadSchema.safeParse({
    templateId: 1,
    engagementId: 2,
  }).success, false);
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

test("trainee access requires engagement, end date, supervisor, and work scope", () => {
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
    },
  }).success, false);
  assert.equal(traineeCreateSchema.safeParse({
    role: 'trainee_access',
    engagement: {
      engagementType: 'intern',
      workAuthorizationType: 'none',
      endDate: '2026-08-31',
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
  }).success, true);
  assert.equal(traineeCreateSchema.safeParse({ role: 'admin_finance' }).success, true);
});

test("create admin UI separates Access Role from Engagement fields", async () => {
  const source = await readFile(new URL("../client/src/pages/CreateAdmin.tsx", import.meta.url), "utf8");
  const accessRoleSection = source.slice(
    source.indexOf('data-testid="select-admin-role"'),
    source.indexOf('<h2 className="text-lg font-medium text-foreground">Engagement</h2>')
  );

  assert.match(source, />Access Role</);
  assert.match(source, /All Access Roles|Select an access role/);
  assert.match(accessRoleSection, /value="trainee_access">Trainee Access/);
  assert.match(source, /isTraineeAccess &&/);
  assert.match(source, />Engagement</);
  assert.match(source, /End date is required for Trainee Access/);
  assert.match(source, /Trainee Access is for temporary interns or trainees/);
  assert.match(source, /Engagement tracks start\/end dates, supervisor, work scope/);
  assert.match(source, /\? "Create Trainee User"/);
  assert.match(source, /: "Create Admin"/);
  assert.match(source, /data-testid="select-supervisor-admin"/);
  assert.match(source, /ROLE_DISPLAY_NAMES\[admin\.role\]/);
  assert.doesNotMatch(source, /data-testid="input-supervisor-admin-id"/);

  for (const forbidden of ['intern', 'contractor', 'employee', 'advisor', 'cpt', 'opt', 'stem_opt', 'full_time', 'part_time']) {
    assert.equal(accessRoleSection.includes(`value="${forbidden}"`), false, `${forbidden} must not appear in access role dropdown`);
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
  assert.match(source, /roles: \['trainee_access'\]/);
});

test("trainee login redirects to trainee workspace and app defines safe route", async () => {
  const loginSource = await readFile(new URL("../client/src/pages/Login.tsx", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const traineePageSource = await readFile(new URL("../client/src/pages/TraineeWorkspace.tsx", import.meta.url), "utf8");

  assert.match(loginSource, /data\.user\.role === "trainee_access" \? "\/trainee" : "\/"/);
  assert.match(appSource, /path="\/trainee"/);
  assert.match(appSource, /allowedRoles={\["trainee_access"\]}/);
  assert.doesNotMatch(appSource, /allowedRoles=\{\[[^\]]*"trainee_access"[^\]]*"admin_finance"/);
  assert.match(traineePageSource, /Trainee Workspace/);
  assert.match(traineePageSource, /Current Engagement/);
  assert.match(traineePageSource, /Activity Log/);
  assert.match(traineePageSource, /Recent Activity Logs/);
  assert.match(traineePageSource, /This is not a payroll timesheet/);
  assert.match(traineePageSource, /Activity log submission is available only when your engagement is active/);
  assert.match(traineePageSource, /No activity logs submitted yet/);
  assert.match(traineePageSource, /Could not load your trainee workspace/);
  assert.match(traineePageSource, /End My Trainee Access/);
  assert.match(traineePageSource, /This will disable your trainee access/);
  assert.doesNotMatch(traineePageSource, /delete account|Delete Account|Clock In|Clock Out/);
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
    /app\.post\("\/api\/admin\/engagements\/run-lifecycle-transitions", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.get\("\/api\/admin\/engagements\/:engagementId\/documents", requireAuth, requireRole\(\['super_admin'\]\)/,
    /app\.post\("\/api\/admin\/engagements\/:engagementId\/documents", requireAuth, requireRole\(\['super_admin'\]\)/,
  ];

  for (const pattern of sensitivePatterns) {
    assert.match(source, pattern);
  }
});

test("offer letter APIs use admin or trainee scoped permissions", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  for (const required of [
    '"/api/admin/document-templates"',
    '"/api/admin/document-templates/:templateId"',
    '"/api/admin/document-templates/:templateId/archive"',
    '"/api/admin/engagements/:engagementId/documents/preview-template"',
  ]) {
    const start = source.indexOf(required);
    assert.notEqual(start, -1, `${required} should exist`);
    const block = source.slice(start, source.indexOf(");", start));
    assert.match(block, /requireRole\(\['super_admin'\]\)/);
  }

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
    assert.match(block, /requireRole\(\['trainee_access'\]\)/);
    assert.match(block, /req\.adminUser\.id/);
    assert.doesNotMatch(block, /req\.body\.adminUserId|req\.body\.engagementId|req\.params\.adminUserId/);
  }

  const traineeSanitizerStart = source.indexOf("function sanitizeTraineeDocument");
  const traineeSanitizerEnd = source.indexOf("function getRequestIp", traineeSanitizerStart);
  const traineeSanitizerBlock = source.slice(traineeSanitizerStart, traineeSanitizerEnd);
  assert.doesNotMatch(
    traineeSanitizerBlock,
    /mergeData|merge_data|templateTitle|template_body|templateBody|offerReadiness|resumeReviewed|discussionCompleted/,
  );
});

test("CPT offer readiness checklist remains admin UI only", async () => {
  const adminProfileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const validationSource = await readFile(new URL("./adminEngagementValidation.ts", import.meta.url), "utf8");

  assert.match(adminProfileSource, /Offer Readiness/);
  assert.match(adminProfileSource, /Resume reviewed outside system/);
  assert.match(adminProfileSource, /Zoom\/discussion completed/);
  assert.match(adminProfileSource, /School\/CPT details confirmed/);
  assert.match(adminProfileSource, /Responsibilities aligned with student background/);
  assert.match(adminProfileSource, /Persist internally only after a safe admin-only metadata model exists/);
  assert.doesNotMatch(routesSource + validationSource, /offerReadiness|resumeReviewed|discussionCompleted|schoolDetailsConfirmed|responsibilitiesAligned/);
  assert.doesNotMatch(routesSource + validationSource, /resumeUpload|resumeParsing|rawResume|candidateLifecycle|rejectedCandidate/);
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
  assert.match(appSource, /allowedRoles={\["super_admin"\]}/);
  assert.match(sidebarSource, /title: "Admin Operations"/);
  assert.match(sidebarSource, /title: "Lifecycle Jobs"/);
  assert.match(sidebarSource, /href: "\/admin-operations\/lifecycle-jobs"/);
  assert.match(sidebarSource, /title: "Document Templates"/);
  assert.match(sidebarSource, /href: "\/admin-operations\/document-templates"/);
  assert.match(lifecycleJobsSource, /\/api\/admin\/engagements\/run-lifecycle-transitions/);
  assert.match(lifecycleJobsSource, /Run all due lifecycle transitions/);
  assert.match(lifecycleJobsSource, /Checks all due trainee engagements, not only one user/);
  assert.doesNotMatch(profileSource, /run-lifecycle-transitions|Run all due lifecycle transitions/);
  assert.doesNotMatch(traineeSource, /run-lifecycle-transitions|Run all due lifecycle transitions/);
});

test("document template management is super admin only and renders plain-text previews", async () => {
  const appSource = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const sidebarSource = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const documentTemplatesSource = await readFile(new URL("../client/src/pages/DocumentTemplates.tsx", import.meta.url), "utf8");
  const adminProfileSource = await readFile(new URL("../client/src/pages/AdminProfile.tsx", import.meta.url), "utf8");

  assert.match(appSource, /path="\/admin-operations\/document-templates"/);
  assert.match(appSource, /<DocumentTemplates \/>/);
  assert.match(appSource, /allowedRoles={\["super_admin"\]}/);

  const adminOperationsStart = sidebarSource.indexOf('title: "Admin Operations"');
  const adminOperationsEnd = sidebarSource.indexOf('title: "Finance Management"', adminOperationsStart);
  const adminOperationsBlock = sidebarSource.slice(adminOperationsStart, adminOperationsEnd);
  assert.match(adminOperationsBlock, /title: "Document Templates"/);
  assert.match(adminOperationsBlock, /href: "\/admin-operations\/document-templates"/);
  assert.match(adminOperationsBlock, /roles: \['super_admin'\]/);
  assert.doesNotMatch(adminOperationsBlock, /trainee_access/);

  assert.match(documentTemplatesSource, /\/api\/admin\/document-templates/);
  assert.match(documentTemplatesSource, /Edit \/ Create New Version/);
  assert.match(documentTemplatesSource, /Duplicate Template/);
  assert.match(documentTemplatesSource, /Archive Document Template/);
  assert.match(documentTemplatesSource, /Raw Template/);
  assert.match(documentTemplatesSource, /Sample Merged Preview/);
  assert.match(documentTemplatesSource, /TemplateBodyBlock/);
  assert.match(documentTemplatesSource, /whitespace-pre-wrap/);
  assert.doesNotMatch(documentTemplatesSource, /dangerouslySetInnerHTML|innerHTML|ReactMarkdown|marked|markdown-to-jsx/i);

  assert.match(adminProfileSource, /button-view-offer-template/);
  assert.match(adminProfileSource, /View Template shows the raw reusable template/);
  assert.match(adminProfileSource, /Preview Template shows the final merged offer draft/);
  assert.match(adminProfileSource, /template\.status !== "archived"/);
});

test("trainee workspace APIs are scoped to authenticated trainee", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");

  for (const route of [
    'app.get("/api/trainee/me/engagement"',
    'app.get("/api/trainee/me/lifecycle-events"',
    'app.get("/api/trainee/me/documents"',
    'app.post("/api/trainee/me/documents/:documentId/view"',
    'app.get("/api/trainee/me/documents/:documentId/download"',
    'app.post("/api/trainee/me/documents/:documentId/accept"',
    'app.get("/api/trainee/me/activity-logs"',
    'app.post("/api/trainee/me/activity-logs"',
  ]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `${route} should exist`);
    const end = source.indexOf('});', start);
    const block = source.slice(start, end);

    assert.match(block, /requireAuth, requireRole\(\['trainee_access'\]\)/);
    assert.match(block, /req\.adminUser\.id/);
    assert.doesNotMatch(block, /req\.params\.adminUserId|req\.body\.adminUserId|req\.body\.engagementId/);
  }

  const postStart = source.indexOf('app.post("/api/trainee/me/activity-logs"');
  const postEnd = source.indexOf('  // Admin management routes', postStart);
  const postBlock = source.slice(postStart, postEnd);

  assert.match(postBlock, /engagement\.status !== 'active'/);
  assert.match(postBlock, /validateActivityDateWithinEngagement/);
  assert.match(postBlock, /eventType: 'activity_log_submitted'/);
  assert.match(postBlock, /status: 'submitted'/);

  const endStart = source.indexOf('app.post("/api/trainee/me/end-engagement"');
  const endEnd = source.indexOf('  // Admin management routes', endStart);
  const endBlock = source.slice(endStart, endEnd);

  assert.match(endBlock, /requireAuth, requireRole\(\['trainee_access'\]\)/);
  assert.match(endBlock, /traineeEndEngagementPayloadSchema/);
  assert.match(endBlock, /selfOffboardTraineeEngagement/);
  assert.match(endBlock, /adminUserId: req\.adminUser\.id/);
  assert.doesNotMatch(endBlock, /req\.params|req\.body\.adminUserId|req\.body\.engagementId|req\.body\.status|req\.body\.eventType/);
});

test("trainee engagement empty state and lifecycle metadata are sanitized", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const engagementStart = source.indexOf('app.get("/api/trainee/me/engagement"');
  const engagementEnd = source.indexOf('app.get("/api/trainee/me/lifecycle-events"', engagementStart);
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
  assert.match(createRouteBlock, /Admin was created and activated, but password setup email failed/);
  assert.doesNotMatch(createRouteBlock, /createPendingAdminAccount/);
  assert.doesNotMatch(createRouteBlock, /createAdminUserWithApprovalAndEngagement/);
});
