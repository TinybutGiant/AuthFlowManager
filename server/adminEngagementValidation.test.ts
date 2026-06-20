import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  accessRoleSchema,
  adminUserUpdateSchema,
  engagementPayloadSchema,
  lifecycleEventPayloadSchema,
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
    eventType: 'permission_granted',
    permissions: ['finance.*'],
  }).success, false);
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

  for (const forbidden of ['intern', 'contractor', 'employee', 'advisor', 'cpt', 'opt', 'stem_opt', 'full_time', 'part_time']) {
    assert.equal(accessRoleSection.includes(`value="${forbidden}"`), false, `${forbidden} must not appear in access role dropdown`);
  }
});

test("trainee access does not gain existing sensitive sidebar routes", async () => {
  const source = await readFile(new URL("../client/src/components/Sidebar.tsx", import.meta.url), "utf8");
  const sensitiveSections = [
    'Pending Requests',
    'Admin Management',
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
  assert.match(traineePageSource, /Your trainee access is active\./);
  assert.match(traineePageSource, /Training and activity features are not available yet\./);
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
  ];

  for (const pattern of sensitivePatterns) {
    assert.match(source, pattern);
  }
});

test("trainee approval requestData includes sanitized engagement snapshot", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('const engagementSnapshot = engagementData');
  const end = source.indexOf('const approvalRequest =', start);
  const snapshotBlock = source.slice(start, end);

  assert.match(snapshotBlock, /const engagementSnapshot = engagementData/);
  for (const field of [
    'engagement_type',
    'schedule_type',
    'work_authorization_type',
    'start_date',
    'end_date',
    'supervisor_admin_id',
    'expected_hours_per_week',
    'work_scope',
    'status',
  ]) {
    assert.match(snapshotBlock, new RegExp(`${field}:`));
  }

  assert.doesNotMatch(snapshotBlock, /password/i);
  assert.doesNotMatch(snapshotBlock, /token/i);
});
