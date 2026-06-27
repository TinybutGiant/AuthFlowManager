import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireRole, requireAccessGroup, requireAnyAccessGroup, jwtUtils } from "./jwtAuth";
import { insertAdminUserApprovalSchema, type AdminAccessGroup, type AdminRole } from "@shared/schema";
import {
  insertGuideApplicationApprovalSchema,
  updateGuideApplicationLiteSchema,
  updateGuideApplicationApprovalSchema,
  type ApplicationStatus,
  type AdminActionType
} from "../shared/main-schema";
import { z } from "zod";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { hashPasswordSetupToken } from './passwordSetup';
import { sendAdminPasswordSetupEmail } from './email';
import { runEngagementLifecycleTransitions } from './adminEngagementLifecycleService';
import { selfOffboardTraineeEngagement } from './traineeSelfOffboardingService';
import {
  AdminOnboardingError,
  approveCreateAdminRequest,
  assertCanLogin,
  completePasswordSetup,
  createAdminAccountForPasswordSetup,
  rejectCreateAdminRequest,
  resendPasswordSetupLink,
  sanitizeAdminUser,
} from './adminOnboardingService';
import {
  accessRoleSchema,
  adminUserUpdateSchema,
  documentTemplatePayloadSchema,
  documentTemplateUpdatePayloadSchema,
  engagementPayloadSchema,
  engagementTypeSchema,
  feedbackScheduleChangeRequestPayloadSchema,
  feedbackSchedulePayloadSchema,
  feedbackSlotPayloadSchema,
  feedbackSlotUpdatePayloadSchema,
  meetingAbsenceRequestPayloadSchema,
  meetingStatusUpdatePayloadSchema,
  offerLetterPayloadSchema,
  lifecycleEventPayloadSchema,
  templatePreviewPayloadSchema,
  traineeActivityLogPayloadSchema,
  traineeEndEngagementPayloadSchema,
  updateEngagementPayloadSchema,
  validateActivityDateWithinEngagement,
  validateTraineeEngagement,
  validateEngagementDates,
} from './adminEngagementValidation';
import {
  acceptOfferLetterForTrainee,
  createOfferLetterDocument,
  createOfferLetterDocumentFromTemplate,
  getOfferLetterDownload,
  OfferLetterError,
  regenerateOfferLetterPdf,
  sendOfferLetterDocument,
  viewOfferLetterForTrainee,
  voidOfferLetterDocument,
} from './offerLetterService';
import {
  archiveDocumentTemplate,
  createDocumentTemplate,
  DocumentTemplateError,
  previewOfferLetterTemplate,
  updateDocumentTemplate,
} from './documentTemplateService';
import { publicCompanyBrandDefaults } from './companyBrandDefaults';
import { deriveAccountTypeFromLegacyRole } from './adminAccessModel';

// Login/Register schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const createAdminUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: accessRoleSchema.exclude(['super_admin']),
  permissions: z.array(z.string()).optional(),
  engagement: z.unknown().optional(),
  deferSetupEmail: z.boolean().optional(),
});

const adminStaffAccessGroups: AdminAccessGroup[] = [
  'super_admin',
  'admin_operations',
  'finance_admin',
  'verifier_admin',
  'support_admin',
];

function canAccessEngagementCheckIns(adminUser: any, engagement: any) {
  return adminUser?.role === 'super_admin' || engagement.supervisorAdminId === adminUser?.id;
}

function errorField(error: unknown, field: string): string {
  if (!error || typeof error !== "object" || !(field in error)) {
    return "";
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isAdminEmailUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "cause" in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && cause !== error && isAdminEmailUniqueViolation(cause)) {
      return true;
    }
  }

  if (errorField(error, "code") !== "23505") {
    return false;
  }

  const constraint = errorField(error, "constraint");
  const table = errorField(error, "table");
  const detail = errorField(error, "detail");
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return (
    constraint.includes("admin_users_email") ||
    constraint.includes("admin_users_email_unique") ||
    (table === "admin_users" && detail.includes("email")) ||
    detail.includes("key (email)") ||
    message.includes("admin_users_email")
  );
}

const passwordSetupTokenSchema = z.object({
  token: z.string().min(20),
});

const completePasswordSetupSchema = passwordSetupTokenSchema.extend({
  password: z.string().min(8),
});

function safeDateOnly(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function sanitizeEngagementForTrainee(engagement: any, supervisor?: any) {
  return {
    id: engagement.id,
    engagement_type: engagement.engagementType,
    schedule_type: engagement.scheduleType,
    work_authorization_type: engagement.workAuthorizationType,
    start_date: safeDateOnly(engagement.startDate),
    end_date: safeDateOnly(engagement.endDate),
    expected_hours_per_week: engagement.expectedHoursPerWeek,
    work_scope: engagement.workScope,
    status: engagement.status,
    ended_at: engagement.endedAt,
    supervisor: supervisor
      ? {
          id: supervisor.id,
          name: supervisor.name,
          email: supervisor.email,
          role: supervisor.role,
        }
      : null,
    position_title: engagement.positionTitle,
    school_name: engagement.schoolName,
    program_or_major: engagement.programOrMajor,
    response_deadline: safeDateOnly(engagement.responseDeadline),
    work_location: engagement.workLocation,
  };
}

function sanitizeLifecycleEvent(event: any) {
  return {
    id: event.id,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    notes: event.notes,
    metadata: sanitizeTraineeLifecycleMetadata(event.metadata),
  };
}

function sanitizeTraineeLifecycleMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const safeKeys = new Set([
    'previous_status',
    'new_status',
    'start_date',
    'end_date',
    'reason',
    'activity_log_id',
    'activity_type',
    'activity_date',
    'channel',
    'purpose',
    'source',
    'already_inactive',
    'feedback_schedule_id',
    'feedback_meeting_occurrence_id',
    'occurrence_date',
    'status',
  ]);

  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(([key]) => safeKeys.has(key))
  );
}

function sanitizeActivityLog(log: any) {
  return {
    id: log.id,
    activity_type: log.activityType,
    activity_date: safeDateOnly(log.activityDate),
    duration_minutes: log.durationMinutes,
    summary: log.summary,
    learning_objective: log.learningObjective,
    status: log.status,
    reviewed_at: log.reviewedAt,
    created_at: log.createdAt,
  };
}

function sanitizeFeedbackSlot(slot: any, scheduleReferenceCount = 0) {
  return {
    id: slot.id,
    supervisor_admin_id: slot.supervisorAdminId,
    day_of_week: slot.dayOfWeek,
    start_time: slot.startTime,
    end_time: slot.endTime,
    timezone: slot.timezone,
    status: slot.status,
    schedule_reference_count: scheduleReferenceCount,
    has_schedule_references: scheduleReferenceCount > 0,
    created_at: slot.createdAt,
    updated_at: slot.updatedAt,
  };
}

async function sanitizeFeedbackSlotsWithReferences(slots: any[]) {
  return await Promise.all(slots.map(async (slot) => (
    sanitizeFeedbackSlot(slot, await storage.countFeedbackSchedulesReferencingSlot(slot.id))
  )));
}

function availabilityWindowsOverlap(
  first: { dayOfWeek: number; startTime: string; endTime: string; timezone: string },
  second: { dayOfWeek: number; startTime: string; endTime: string; timezone: string },
) {
  return (
    first.dayOfWeek === second.dayOfWeek &&
    first.timezone === second.timezone &&
    first.startTime < second.endTime &&
    second.startTime < first.endTime
  );
}

async function findOverlappingActiveFeedbackSlot(input: {
  supervisorAdminId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  excludeSlotId?: number;
}) {
  const slots = await storage.listFeedbackSlotsForSupervisor(input.supervisorAdminId);
  return slots.find((slot) => (
    slot.status === "active" &&
    slot.id !== input.excludeSlotId &&
    availabilityWindowsOverlap(input, slot)
  ));
}

function sanitizeFeedbackSchedule(schedule: any) {
  if (!schedule) return null;
  return {
    id: schedule.id,
    engagement_id: schedule.engagementId,
    admin_user_id: schedule.adminUserId,
    supervisor_admin_id: schedule.supervisorAdminId,
    frequency_per_week: schedule.frequencyPerWeek,
    timezone: schedule.timezone,
    selected_slots: Array.isArray(schedule.selectedSlots) ? schedule.selectedSlots : [],
    status: schedule.status,
    change_request_note: schedule.changeRequestNote,
    confirmed_at: schedule.confirmedAt,
    change_requested_at: schedule.changeRequestedAt,
    created_at: schedule.createdAt,
    updated_at: schedule.updatedAt,
  };
}

function sanitizeFeedbackMeetingOccurrence(occurrence: any) {
  return {
    id: occurrence.id,
    schedule_id: occurrence.scheduleId,
    engagement_id: occurrence.engagementId,
    admin_user_id: occurrence.adminUserId,
    supervisor_admin_id: occurrence.supervisorAdminId,
    occurrence_date: safeDateOnly(occurrence.occurrenceDate),
    start_time: occurrence.startTime,
    end_time: occurrence.endTime,
    timezone: occurrence.timezone,
    status: occurrence.status,
    absence_reason: occurrence.absenceReason,
    absence_note: occurrence.absenceNote,
    absence_requested_at: occurrence.absenceRequestedAt,
    status_updated_by: occurrence.statusUpdatedBy,
    status_updated_at: occurrence.statusUpdatedAt,
    created_at: occurrence.createdAt,
    updated_at: occurrence.updatedAt,
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateOnlyToUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatIcsTimestamp(value = new Date()) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatIcsLocalDateTime(date: string, time: string) {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string) {
  const maxLength = 75;
  if (line.length <= maxLength) return line;
  const segments = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    segments.push(remaining.slice(0, maxLength));
    remaining = ` ${remaining.slice(maxLength)}`;
  }
  segments.push(remaining);
  return segments.join("\r\n");
}

function buildFeedbackMeetingsIcs(input: {
  traineeName: string;
  supervisorName: string;
  occurrences: any[];
}) {
  const now = formatIcsTimestamp();
  const calendarName = `Feedback Meetings - ${input.traineeName}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yaotu Technologies//Feedback Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const occurrence of input.occurrences) {
    const timezone = occurrence.timezone || "UTC";
    const occurrenceDate = safeDateOnly(occurrence.occurrenceDate);
    if (!occurrenceDate) continue;
    const description = [
      `Trainee: ${input.traineeName}`,
      `Supervisor: ${input.supervisorName}`,
      `Timezone: ${timezone}`,
      "Description: Recurring Feedback Meeting scheduled in the Trainee Workspace.",
    ].join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:feedback-meeting-${occurrence.id}@yaotu-technologies`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${timezone}:${formatIcsLocalDateTime(occurrenceDate, occurrence.startTime)}`,
      `DTEND;TZID=${timezone}:${formatIcsLocalDateTime(occurrenceDate, occurrence.endTime)}`,
      `SUMMARY:${escapeIcsText(`Feedback Meeting with ${input.supervisorName}`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `STATUS:${occurrence.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function maxDateOnly(a: string, b?: string | null) {
  if (!b || b < a) return a;
  return b;
}

function generateFeedbackMeetingOccurrences(input: {
  engagement: any;
  selectedSlots: Array<{ id: number; dayOfWeek: number; startTime: string; endTime: string; timezone: string }>;
  timezone: string;
  now?: Date;
}) {
  const today = dateOnly(input.now ?? new Date());
  const startDate = maxDateOnly(today, safeDateOnly(input.engagement.startDate));
  const endDate = input.engagement.endDate ? safeDateOnly(input.engagement.endDate) : null;
  const generationEnd = dateOnly(addUtcDays(dateOnlyToUtc(startDate), 56));
  const boundedEnd = endDate && endDate < generationEnd ? endDate : generationEnd;

  return input.selectedSlots.flatMap((slot) => {
    const first = dateOnlyToUtc(startDate);
    const daysUntilSlot = (slot.dayOfWeek - first.getUTCDay() + 7) % 7;
    let occurrenceDate = addUtcDays(first, daysUntilSlot);
    const occurrences = [];

    while (dateOnly(occurrenceDate) <= boundedEnd) {
      occurrences.push({
        engagementId: input.engagement.id,
        adminUserId: input.engagement.adminUserId,
        supervisorAdminId: input.engagement.supervisorAdminId,
        occurrenceDate: dateOnly(occurrenceDate),
        startTime: slot.startTime,
        endTime: slot.endTime,
        timezone: slot.timezone || input.timezone,
        status: "scheduled",
      });
      occurrenceDate = addUtcDays(occurrenceDate, 7);
    }

    return occurrences;
  }).sort((a, b) => (
    a.occurrenceDate === b.occurrenceDate
      ? a.startTime.localeCompare(b.startTime)
      : a.occurrenceDate.localeCompare(b.occurrenceDate)
  ));
}

async function buildCheckInBundle(engagement: any) {
  const slots = engagement.supervisorAdminId
    ? await storage.listFeedbackSlotsForSupervisor(engagement.supervisorAdminId)
    : [];
  const schedule = await storage.getActiveFeedbackScheduleForEngagement(engagement.id);
  const occurrences = await storage.listFeedbackMeetingOccurrencesForEngagement(engagement.id);

  return {
    available_slots: slots.filter((slot) => slot.status === "active").map(sanitizeFeedbackSlot),
    selected_schedule: sanitizeFeedbackSchedule(schedule),
    meeting_occurrences: occurrences.map(sanitizeFeedbackMeetingOccurrence),
  };
}

function sanitizeAdminEngagementDocument(document: any) {
  return {
    id: document.id,
    engagement_id: document.engagementId,
    admin_user_id: document.adminUserId,
    document_type: document.documentType,
    status: document.status,
    title: document.title,
    body: document.body,
    version: document.version,
    template_id: document.templateId,
    template_version: document.templateVersion,
    template_name_snapshot: document.templateNameSnapshot,
    content_format: document.contentFormat,
    file_sha256: document.fileSha256,
    file_content_type: document.fileContentType,
    file_size_bytes: document.fileSizeBytes,
    has_pdf: Boolean(document.fileKey),
    sent_at: document.sentAt,
    viewed_at: document.viewedAt,
    accepted_at: document.acceptedAt,
    declined_at: document.declinedAt,
    voided_at: document.voidedAt,
    voided_by: document.voidedBy,
    created_by: document.createdBy,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

function sanitizeAdminDocumentTemplate(template: any) {
  return {
    id: template.id,
    document_type: template.documentType,
    name: template.name,
    description: template.description,
    status: template.status,
    version: template.version,
    title_template: template.titleTemplate,
    body_template: template.bodyTemplate,
    content_format: template.contentFormat,
    allowed_variables: Array.isArray(template.allowedVariables) ? template.allowedVariables : [],
    archived_at: template.archivedAt,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  };
}

async function serializeAdminUser(adminUser: any) {
  const safeAdmin = sanitizeAdminUser(adminUser);
  const accessGroups = await storage.getActiveAccessGroupsForAdminUser(adminUser.id);

  return {
    ...safeAdmin,
    accountType: adminUser.accountType ?? deriveAccountTypeFromLegacyRole(adminUser.role),
    accessGroups,
  };
}

function sanitizeTraineeDocument(document: any) {
  return {
    id: document.id,
    document_type: document.documentType,
    status: document.status,
    title: document.title,
    body: document.body,
    version: document.version,
    sent_at: document.sentAt,
    viewed_at: document.viewedAt,
    accepted_at: document.acceptedAt,
    declined_at: document.declinedAt,
  };
}

function getRequestIp(req: any) {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedIp = forwardedValue?.split(",")[0]?.trim();
  return forwardedIp || req.ip || null;
}

function sendOfferLetterPdf(res: any, result: Awaited<ReturnType<typeof getOfferLetterDownload>>) {
  res.setHeader("Content-Type", result.object.contentType || "application/pdf");
  res.setHeader("Content-Length", String(result.object.buffer.byteLength));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.send(result.object.buffer);
}

function handleOfferLetterRouteError(res: any, error: unknown, fallbackMessage: string) {
  if (error instanceof OfferLetterError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  if (error instanceof DocumentTemplateError) {
    return res.status(error.statusCode).json({ message: error.message, ...error.details });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: fallbackMessage });
  }

  console.error("[offer-letter route]", fallbackMessage, error);
  return res.status(500).json({ message: fallbackMessage });
}

async function hasAcceptedOfferForCurrentTrainee(adminUserId: number) {
  const engagement = await storage.getCurrentTraineeEngagement(adminUserId);
  if (!engagement) {
    return false;
  }

  return await storage.hasAcceptedOfferLetterForEngagement(engagement.id);
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      console.log('Login attempt for email:', email);
      
      const adminUser = await storage.getAdminUserByEmail(email);
      if (!adminUser) {
        console.log('Admin user not found for email:', email);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      console.log('Found admin user:', { id: adminUser.id, email: adminUser.email, status: adminUser.status });

      const isValid = await jwtUtils.comparePassword(password, adminUser.passwordHash);
      console.log('Password validation result:', isValid);
      
      if (!isValid) {
        console.log('Password validation failed for email:', email);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      try {
        assertCanLogin(adminUser);
      } catch (error) {
        if (error instanceof AdminOnboardingError) {
          console.log('Login blocked for email:', email, 'status:', adminUser.status, 'mustChangePassword:', adminUser.mustChangePassword);
          return res.status(error.statusCode).json({ message: error.message });
        }
        throw error;
      }

      // Update last login
      await storage.updateAdminUser(adminUser.id, { lastLoginAt: new Date() });
      const serializedAdminUser = await serializeAdminUser(adminUser);

      const token = jwtUtils.generateToken({ userId: adminUser.id.toString(), email: adminUser.email });
      
      res.json({ 
        token, 
        user: { 
          id: adminUser.id, 
          email: adminUser.email, 
          name: adminUser.name,
          role: adminUser.role,
          accountType: serializedAdminUser.accountType,
          accessGroups: serializedAdminUser.accessGroups,
        }
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(400).json({ message: "Login failed", error: error?.message });
    }
  });

  // 注册功能已移除 - 管理员账户只能由super_admin创建

  app.post('/api/auth/password-setup/validate', async (req, res) => {
    try {
      const { token } = passwordSetupTokenSchema.parse(req.body);
      const adminUser = await storage.getAdminUserByPasswordSetupTokenHash(hashPasswordSetupToken(token));

      if (!adminUser || adminUser.status !== 'active' || !adminUser.mustChangePassword) {
        return res.status(400).json({ message: "Invalid or expired password setup link" });
      }

      res.json({
        valid: true,
        email: adminUser.email,
        name: adminUser.name,
      });
    } catch (error: any) {
      res.status(400).json({ message: "Invalid password setup token", error: error?.message });
    }
  });

  app.post('/api/auth/password-setup/complete', async (req, res) => {
    try {
      const { token, password } = completePasswordSetupSchema.parse(req.body);
      const passwordHash = await bcrypt.hash(password, 12);
      await completePasswordSetup({ storage, token, passwordHash });

      res.json({ message: "Password has been set. You can now log in." });
    } catch (error: any) {
      if (error instanceof AdminOnboardingError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(400).json({ message: "Failed to set password", error: error?.message });
    }
  });

  app.get('/api/auth/user', requireAuth, async (req: any, res) => {
    try {
      const adminUser = await storage.getAdminUser(parseInt(req.user.id));
      if (!adminUser) {
        return res.status(404).json({ message: "Admin user not found" });
      }
      const serializedAdminUser = await serializeAdminUser(adminUser);
      
      res.json({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role,
        accountType: serializedAdminUser.accountType,
        accessGroups: serializedAdminUser.accessGroups,
        status: adminUser.status,
        mustChangePassword: adminUser.mustChangePassword,
        adminUser: serializedAdminUser
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    // For JWT, logout is handled client-side by removing the token
    res.json({ message: "Logged out successfully" });
  });

  // Trainee-scoped workspace routes. These never accept user ids or engagement ids
  // from trainee-controlled params/body; scope is always req.adminUser.id.
  app.get(
    "/api/trainee/me/engagement",
    requireAuth,
    requireAnyAccessGroup(['trainee_offer_portal', 'trainee_workspace']),
    async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.json(null);
      }

      const supervisor = engagement.supervisorAdminId
        ? await storage.getAdminUser(engagement.supervisorAdminId)
        : undefined;

      res.json(sanitizeEngagementForTrainee(engagement, supervisor));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trainee engagement" });
    }
  });

  app.get("/api/trainee/me/lifecycle-events", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const hasAcceptedOffer = await hasAcceptedOfferForCurrentTrainee(req.adminUser.id);
      if (!hasAcceptedOffer) {
        return res.status(403).json({ message: "Offer acceptance is required to view trainee lifecycle events." });
      }

      const events = await storage.listAdminLifecycleEvents(req.adminUser.id);
      res.json(events.slice(0, 50).map(sanitizeLifecycleEvent));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trainee lifecycle events" });
    }
  });

  app.get("/api/trainee/me/documents", requireAuth, requireAccessGroup('trainee_offer_portal'), async (req: any, res) => {
    try {
      const documents = await storage.listTraineeEngagementDocuments(req.adminUser.id);
      res.json(
        documents
          .filter((document) => document.documentType === "offer_letter" && document.status !== "draft")
          .map(sanitizeTraineeDocument)
      );
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trainee documents" });
    }
  });

  app.post("/api/trainee/me/documents/:documentId/view", requireAuth, requireAccessGroup('trainee_offer_portal'), async (req: any, res) => {
    try {
      const document = await viewOfferLetterForTrainee({
        storage,
        adminUserId: req.adminUser.id,
        documentId: parseInt(req.params.documentId),
      });
      res.json(sanitizeTraineeDocument(document));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to mark offer letter viewed");
    }
  });

  app.get("/api/trainee/me/documents/:documentId/download", requireAuth, requireAccessGroup('trainee_offer_portal'), async (req: any, res) => {
    try {
      const result = await getOfferLetterDownload({
        storage,
        requester: "trainee",
        adminUserId: req.adminUser.id,
        documentId: parseInt(req.params.documentId),
      });
      sendOfferLetterPdf(res, result);
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to download offer letter");
    }
  });

  app.post("/api/trainee/me/documents/:documentId/accept", requireAuth, requireAccessGroup('trainee_offer_portal'), async (req: any, res) => {
    try {
      const document = await acceptOfferLetterForTrainee({
        storage,
        adminUserId: req.adminUser.id,
        documentId: parseInt(req.params.documentId),
        ip: getRequestIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });
      res.json(sanitizeTraineeDocument(document));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to accept offer letter");
    }
  });

  app.get("/api/trainee/me/activity-logs", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const hasAcceptedOffer = await hasAcceptedOfferForCurrentTrainee(req.adminUser.id);
      if (!hasAcceptedOffer) {
        return res.status(403).json({ message: "Offer acceptance is required to view trainee activity logs." });
      }

      const logs = await storage.listAdminActivityLogs(req.adminUser.id);
      res.json(logs.map(sanitizeActivityLog));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trainee activity logs" });
    }
  });

  app.post("/api/trainee/me/activity-logs", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement || engagement.status !== 'active') {
        return res.status(400).json({
          message: "Activity log submission is available only when your engagement is active.",
        });
      }
      const hasAcceptedOffer = await storage.hasAcceptedOfferLetterForEngagement(engagement.id);
      if (!hasAcceptedOffer) {
        return res.status(400).json({
          message: "Offer acceptance is required before submitting activity logs.",
        });
      }

      const activityData = traineeActivityLogPayloadSchema.parse(req.body);
      const dateError = validateActivityDateWithinEngagement(activityData.activityDate, engagement);
      if (dateError) {
        return res.status(400).json({ message: "Invalid activity date", error: dateError });
      }

      const activityLog = await storage.createAdminActivityLogWithEvent(
        {
          engagementId: engagement.id,
          adminUserId: req.adminUser.id,
          activityType: activityData.activityType,
          activityDate: activityData.activityDate,
          durationMinutes: activityData.durationMinutes ?? null,
          summary: activityData.summary,
          learningObjective: activityData.learningObjective ?? null,
          status: 'submitted',
        },
        {
          eventType: 'activity_log_submitted',
          actorAdminId: req.adminUser.id,
          metadata: {
            activity_type: activityData.activityType,
            activity_date: activityData.activityDate,
          },
          notes: null,
        }
      );

      res.status(201).json(sanitizeActivityLog(activityLog));
    } catch (error: any) {
      res.status(400).json({ message: "Failed to submit activity log", error: error?.message });
    }
  });

  app.get("/api/trainee/me/check-ins", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.json({
          available_slots: [],
          selected_schedule: null,
          meeting_occurrences: [],
        });
      }

      const hasAcceptedOffer = await storage.hasAcceptedOfferLetterForEngagement(engagement.id);
      if (!hasAcceptedOffer) {
        return res.status(403).json({ message: "Offer acceptance is required to view check-ins." });
      }

      res.json(await buildCheckInBundle(engagement));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch feedback meeting check-ins" });
    }
  });

  app.get("/api/trainee/me/feedback-meetings/calendar.ics", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.status(404).json({ message: "Current engagement not found" });
      }
      const hasAcceptedOffer = await storage.hasAcceptedOfferLetterForEngagement(engagement.id);
      if (!hasAcceptedOffer) {
        return res.status(403).json({ message: "Offer acceptance is required before exporting feedback meetings." });
      }
      const schedule = await storage.getActiveFeedbackScheduleForEngagement(engagement.id);
      if (!schedule) {
        return res.status(404).json({ message: "Confirmed Feedback Meeting schedule not found" });
      }
      const supervisor = engagement.supervisorAdminId
        ? await storage.getAdminUser(engagement.supervisorAdminId)
        : null;
      const occurrences = await storage.listFeedbackMeetingOccurrencesForEngagement(engagement.id);
      const exportableOccurrences = occurrences.filter((occurrence) => occurrence.status === "scheduled");
      const ics = buildFeedbackMeetingsIcs({
        traineeName: req.adminUser.name,
        supervisorName: supervisor?.name ?? "Supervisor",
        occurrences: exportableOccurrences,
      });

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", 'attachment; filename="feedback-meetings.ics"');
      res.send(ics);
    } catch (error) {
      res.status(500).json({ message: "Failed to export Feedback Meeting calendar" });
    }
  });

  app.post("/api/trainee/me/feedback-schedule", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.status(404).json({ message: "Current engagement not found" });
      }
      if (!engagement.supervisorAdminId) {
        return res.status(400).json({ message: "A supervisor is required before selecting a feedback meeting schedule." });
      }
      const hasAcceptedOffer = await storage.hasAcceptedOfferLetterForEngagement(engagement.id);
      if (!hasAcceptedOffer) {
        return res.status(403).json({ message: "Offer acceptance is required before selecting a feedback meeting schedule." });
      }

      const payload = feedbackSchedulePayloadSchema.parse(req.body);
      const supervisorSlots = await storage.listFeedbackSlotsForSupervisor(engagement.supervisorAdminId);
      const slotSnapshots = payload.selections.map((selection) => {
        const slot = supervisorSlots.find((candidate) => (
          candidate.id === selection.slotId && candidate.status === "active"
        ));
        if (!slot) {
          return null;
        }
        if (selection.startTime < slot.startTime || selection.endTime > slot.endTime) {
          return null;
        }
        return {
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: selection.startTime,
          endTime: selection.endTime,
          timezone: slot.timezone,
          availabilityStartTime: slot.startTime,
          availabilityEndTime: slot.endTime,
          availabilityTimezone: slot.timezone,
        };
      });
      if (slotSnapshots.some((slot) => !slot)) {
        return res.status(400).json({ message: "Selected Feedback Meeting times must be within active supervisor availability windows." });
      }
      const selectedTimeKeys = slotSnapshots.map((slot) => (
        `${slot!.dayOfWeek}:${slot!.startTime}-${slot!.endTime}:${slot!.timezone}`
      ));
      if (new Set(selectedTimeKeys).size !== selectedTimeKeys.length) {
        return res.status(400).json({ message: "Selected feedback meeting times must be unique." });
      }
      for (let i = 0; i < slotSnapshots.length; i += 1) {
        for (let j = i + 1; j < slotSnapshots.length; j += 1) {
          const first = slotSnapshots[i]!;
          const second = slotSnapshots[j]!;
          const sameLocalMeetingDay = first.dayOfWeek === second.dayOfWeek && first.timezone === second.timezone;
          const overlaps = first.startTime < second.endTime && second.startTime < first.endTime;
          if (sameLocalMeetingDay && overlaps) {
            return res.status(400).json({ message: "Selected feedback meeting times must not overlap." });
          }
        }
      }
      const now = new Date();
      const occurrences = generateFeedbackMeetingOccurrences({
        engagement,
        selectedSlots: slotSnapshots.map((slot) => slot!),
        timezone: payload.timezone,
        now,
      });

      const result = await storage.confirmFeedbackScheduleWithOccurrences(
        {
          engagementId: engagement.id,
          adminUserId: req.adminUser.id,
          supervisorAdminId: engagement.supervisorAdminId,
          frequencyPerWeek: payload.frequencyPerWeek,
          timezone: payload.timezone,
          selectedSlots: slotSnapshots.map((slot) => slot!),
          status: "confirmed",
          confirmedAt: now,
        },
        occurrences,
        {
          eventType: "feedback_schedule_confirmed",
          actorAdminId: req.adminUser.id,
          occurredAt: now,
          metadata: {
            frequency_per_week: payload.frequencyPerWeek,
            timezone: payload.timezone,
            selected_times: slotSnapshots.map((slot) => ({
              slot_id: slot!.id,
              day_of_week: slot!.dayOfWeek,
              start_time: slot!.startTime,
              end_time: slot!.endTime,
              timezone: slot!.timezone,
            })),
          },
          notes: null,
        },
      );

      res.status(201).json({
        selected_schedule: sanitizeFeedbackSchedule(result.schedule),
        meeting_occurrences: result.occurrences.map(sanitizeFeedbackMeetingOccurrence),
      });
    } catch (error: any) {
      res.status(400).json({ message: "Failed to confirm feedback meeting schedule", error: error?.message });
    }
  });

  app.post("/api/trainee/me/feedback-schedule/change-request", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.status(404).json({ message: "Current engagement not found" });
      }
      const payload = feedbackScheduleChangeRequestPayloadSchema.parse(req.body ?? {});
      const schedule = await storage.requestFeedbackScheduleChange(
        engagement.id,
        req.adminUser.id,
        { note: payload.note ?? null },
      );
      if (!schedule) {
        return res.status(404).json({ message: "Confirmed feedback meeting schedule not found" });
      }
      res.json(sanitizeFeedbackSchedule(schedule));
    } catch (error: any) {
      res.status(400).json({ message: "Failed to request feedback meeting schedule change", error: error?.message });
    }
  });

  app.post("/api/trainee/me/feedback-meetings/:occurrenceId/absence-request", requireAuth, requireAccessGroup('trainee_workspace'), async (req: any, res) => {
    try {
      const engagement = await storage.getCurrentTraineeEngagement(req.adminUser.id);
      if (!engagement) {
        return res.status(404).json({ message: "Current engagement not found" });
      }
      const payload = meetingAbsenceRequestPayloadSchema.parse(req.body);
      const occurrence = await storage.requestFeedbackMeetingAbsence(
        parseInt(req.params.occurrenceId),
        engagement.id,
        req.adminUser.id,
        {
          reason: payload.reason,
          note: payload.note ?? null,
        },
      );
      if (!occurrence) {
        return res.status(404).json({ message: "Scheduled feedback meeting not found" });
      }
      res.json(sanitizeFeedbackMeetingOccurrence(occurrence));
    } catch (error: any) {
      res.status(400).json({ message: "Failed to submit absence request", error: error?.message });
    }
  });

  app.post(
    "/api/trainee/me/end-engagement",
    requireAuth,
    requireAnyAccessGroup(['trainee_offer_portal', 'trainee_workspace']),
    async (req: any, res) => {
    try {
      const payload = traineeEndEngagementPayloadSchema.parse(req.body ?? {});
      const result = await selfOffboardTraineeEngagement({
        adminUserId: req.adminUser.id,
        reason: payload.reason ?? null,
      });

      // TODO: Notify the supervisor/admin after self-offboarding once notification
      // recipients and copy are finalized. Do not emit email-sent events until an
      // actual delivery attempt exists.
      res.json({
        status: result.status,
        engagement: result.engagement ? sanitizeEngagementForTrainee(result.engagement) : null,
      });
    } catch (error: any) {
      res.status(400).json({ message: "Failed to end trainee engagement", error: error?.message });
    }
  });

  // Admin management routes (super_admin only)
  app.get("/api/admin/users", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { role, status } = req.query;
      const admins = await storage.listAdminUsers({ 
        role: role as any, 
        status: status as any 
      });
      res.json(await Promise.all(admins.map(serializeAdminUser)));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin users" });
    }
  });

  app.get("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const admin = await storage.getAdminUser(id);
      if (!admin) {
        return res.status(404).json({ message: "Admin user not found" });
      }
      res.json(await serializeAdminUser(admin));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin user" });
    }
  });

  app.post("/api/admin/users", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const validatedData = createAdminUserSchema.parse(req.body);
      const { engagement, deferSetupEmail, ...adminData } = validatedData;
      const engagementData = engagement !== undefined && engagement !== null
        ? engagementPayloadSchema.parse(engagement)
        : undefined;
      if (deferSetupEmail && adminData.role !== 'trainee_access') {
        return res.status(400).json({
          message: "Setup email deferral is only supported for trainee creation",
        });
      }
      z.object({
        role: accessRoleSchema,
        engagement: engagementPayloadSchema.optional(),
      }).superRefine(validateTraineeEngagement).parse({
        role: adminData.role,
        engagement: engagementData,
      });
      const placeholderPassword = crypto.randomBytes(32).toString('base64url');
      const passwordHash = await bcrypt.hash(placeholderPassword, 12);

      const adminUser = {
          ...adminData,
          passwordHash,
          createdBy: req.adminUser.id,
      };

      const delivery = await createAdminAccountForPasswordSetup({
        storage,
        adminUser,
        ...(engagementData
          ? {
              engagement: {
                ...engagementData,
                createdBy: req.adminUser.id,
              },
              event: {
                eventType: 'engagement_created',
                actorAdminId: req.adminUser.id,
                metadata: {},
                notes: null,
              },
            }
          : {}),
      });

      if (delivery.engagement) {
        try {
          await storage.createAdminLifecycleEvent({
            adminUserId: delivery.admin.id,
            engagementId: delivery.engagement.id,
            eventType: 'account_activated',
            actorAdminId: req.adminUser.id,
            metadata: { source: 'direct_create' },
            notes: null,
          });
        } catch (eventError) {
          console.warn("Failed to record account_activated lifecycle event:", eventError);
        }
      }

      const setupEmailDeferred = Boolean(deferSetupEmail && delivery.admin.role === 'trainee_access');
      const responseBody = {
        admin: await serializeAdminUser(delivery.admin),
        engagement: delivery.engagement ?? null,
        setupEmailDeferred,
      };

      if (!setupEmailDeferred) {
        const emailSent = await sendAdminPasswordSetupEmail({
          to: delivery.admin.email,
          name: delivery.admin.name,
          setupUrl: delivery.setupUrl,
          role: delivery.admin.role,
        });

        if (!emailSent) {
          return res.status(502).json({
            message: "Admin was created and activated, but password setup email failed. Use resend setup link after fixing email delivery.",
            ...responseBody,
          });
        }

        if (delivery.engagement) {
          try {
            await storage.createAdminLifecycleEvent({
              adminUserId: delivery.admin.id,
              engagementId: delivery.engagement.id,
              eventType: 'invitation_sent',
              actorAdminId: req.adminUser.id,
              metadata: { channel: 'email', purpose: 'password_setup', source: 'direct_create' },
              notes: null,
            });
          } catch (eventError) {
            console.warn("Failed to record invitation_sent lifecycle event:", eventError);
          }
        }
      }

      res.status(201).json(responseBody);
    } catch (error: any) {
      if (isAdminEmailUniqueViolation(error)) {
        return res.status(409).json({
          message: "An admin user with this email already exists.",
          code: "ADMIN_EMAIL_EXISTS",
          field: "email",
        });
      }

      console.error("[create admin user] Failed to create admin user", error);
      res.status(400).json({ message: "Failed to create admin user" });
    }
  });

  app.get("/api/admin/users/:id/engagements", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const adminId = parseInt(req.params.id);
      const engagements = await storage.listAdminEngagements(adminId);
      res.json(engagements);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin engagements" });
    }
  });

  app.post("/api/admin/users/:id/engagements", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const adminId = parseInt(req.params.id);
      const admin = await storage.getAdminUser(adminId);
      if (!admin) {
        return res.status(404).json({ message: "Admin user not found" });
      }

      const engagementData = engagementPayloadSchema.parse(req.body);
      const engagement = await storage.createAdminEngagementWithEvent(
        {
          ...engagementData,
          adminUserId: adminId,
          createdBy: req.adminUser.id,
        },
        {
          adminUserId: adminId,
          eventType: 'engagement_created',
          actorAdminId: req.adminUser.id,
          metadata: {},
          notes: null,
        }
      );
      res.status(201).json(engagement);
    } catch (error: any) {
      res.status(400).json({ message: "Failed to create admin engagement", error: error?.message });
    }
  });

  app.patch("/api/admin/engagements/:engagementId", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const existing = await storage.getAdminEngagement(engagementId);
      if (!existing) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }

      const updates = updateEngagementPayloadSchema.parse(req.body);
      const merged = {
        engagementType: updates.engagementType ?? existing.engagementType,
        startDate: updates.startDate !== undefined ? updates.startDate : existing.startDate,
        endDate: updates.endDate !== undefined ? updates.endDate : existing.endDate,
      };
      const validation = z
        .object({
          engagementType: engagementTypeSchema,
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
        })
        .superRefine(validateEngagementDates)
        .safeParse(merged);

      if (!validation.success) {
        return res.status(400).json({ message: "Invalid engagement update", error: validation.error.message });
      }

      const updated = await storage.updateAdminEngagementWithEvent(
        engagementId,
        updates,
        {
          eventType: 'engagement_updated',
          actorAdminId: req.adminUser.id,
          metadata: { changedFields: Object.keys(updates) },
          notes: null,
        }
      );

      if (!updated) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Failed to update admin engagement", error: error?.message });
    }
  });

  app.get("/api/admin/engagements/:engagementId/check-ins", requireAuth, requireAnyAccessGroup(adminStaffAccessGroups), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const engagement = await storage.getAdminEngagement(engagementId);
      if (!engagement) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }
      if (!canAccessEngagementCheckIns(req.adminUser, engagement)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      res.json(await buildCheckInBundle(engagement));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch engagement check-ins" });
    }
  });

  app.get("/api/admin/feedback-slots", requireAuth, requireAnyAccessGroup(adminStaffAccessGroups), async (req: any, res) => {
    try {
      const supervisorAdminId = req.query.supervisorAdminId
        ? parseInt(String(req.query.supervisorAdminId))
        : req.adminUser.id;
      if (!Number.isInteger(supervisorAdminId) || supervisorAdminId <= 0) {
        return res.status(400).json({ message: "Invalid supervisor id" });
      }
      if (req.adminUser.role !== "super_admin" && supervisorAdminId !== req.adminUser.id) {
        return res.status(403).json({ message: "Feedback Meeting availability can only be viewed for your own supervisor schedule." });
      }
      const supervisor = await storage.getAdminUser(supervisorAdminId);
      if (!supervisor || supervisor.status !== "active" || supervisor.role === "trainee_access") {
        return res.status(404).json({ message: "Supervisor not found" });
      }
      const slots = await storage.listFeedbackSlotsForSupervisor(supervisorAdminId);
      res.json(await sanitizeFeedbackSlotsWithReferences(slots));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Feedback Meeting availability" });
    }
  });

  app.post("/api/admin/feedback-slots", requireAuth, requireAnyAccessGroup(adminStaffAccessGroups), async (req: any, res) => {
    try {
      const payload = feedbackSlotPayloadSchema.parse(req.body);
      if (req.adminUser.role !== "super_admin" && payload.supervisorAdminId !== req.adminUser.id) {
        return res.status(403).json({ message: "Feedback Meeting availability can only be created for your own supervisor schedule." });
      }
      const supervisor = await storage.getAdminUser(payload.supervisorAdminId);
      if (!supervisor || supervisor.status !== "active" || supervisor.role === "trainee_access") {
        return res.status(400).json({ message: "Feedback Meeting availability must be tied to an active supervisor." });
      }
      const overlappingSlot = await findOverlappingActiveFeedbackSlot({
        supervisorAdminId: payload.supervisorAdminId,
        dayOfWeek: payload.dayOfWeek,
        startTime: payload.startTime,
        endTime: payload.endTime,
        timezone: payload.timezone,
      });
      if (overlappingSlot) {
        return res.status(409).json({ message: "Availability window overlaps an existing active window for this supervisor, weekday, and timezone." });
      }
      const slot = await storage.createFeedbackSlot({
        supervisorAdminId: payload.supervisorAdminId,
        dayOfWeek: payload.dayOfWeek,
        startTime: payload.startTime,
        endTime: payload.endTime,
        timezone: payload.timezone,
        status: "active",
        createdBy: req.adminUser.id,
      });
      res.status(201).json(sanitizeFeedbackSlot(slot));
    } catch (error: any) {
      res.status(400).json({ message: "Failed to create Feedback Meeting availability", error: error?.message });
    }
  });

  app.patch("/api/admin/feedback-slots/:slotId", requireAuth, requireAnyAccessGroup(adminStaffAccessGroups), async (req: any, res) => {
    try {
      const payload = feedbackSlotUpdatePayloadSchema.parse(req.body);
      const slotId = parseInt(req.params.slotId);
      const existing = await storage.getFeedbackSlot(slotId);
      if (!existing || (req.adminUser.role !== "super_admin" && existing.supervisorAdminId !== req.adminUser.id)) {
        return res.status(404).json({ message: "Feedback Meeting availability window not found" });
      }
      const merged = {
        supervisorAdminId: existing.supervisorAdminId,
        dayOfWeek: payload.dayOfWeek ?? existing.dayOfWeek,
        startTime: payload.startTime ?? existing.startTime,
        endTime: payload.endTime ?? existing.endTime,
        timezone: payload.timezone ?? existing.timezone,
        status: payload.status ?? existing.status,
      };
      if (merged.endTime <= merged.startTime) {
        return res.status(400).json({ message: "End time must be after start time" });
      }
      if (merged.status === "active") {
        const overlappingSlot = await findOverlappingActiveFeedbackSlot({
          ...merged,
          excludeSlotId: slotId,
        });
        if (overlappingSlot) {
          return res.status(409).json({ message: "Availability window overlaps an existing active window for this supervisor, weekday, and timezone." });
        }
      }
      const slot = await storage.updateFeedbackSlot(slotId, {
        dayOfWeek: payload.dayOfWeek,
        startTime: payload.startTime,
        endTime: payload.endTime,
        timezone: payload.timezone,
        status: payload.status,
      });
      if (!slot) {
        return res.status(404).json({ message: "Feedback Meeting availability window not found" });
      }
      const referenceCount = await storage.countFeedbackSchedulesReferencingSlot(slot.id);
      res.json(sanitizeFeedbackSlot(slot, referenceCount));
    } catch (error: any) {
      res.status(400).json({ message: "Failed to update Feedback Meeting availability", error: error?.message });
    }
  });

  app.delete("/api/admin/feedback-slots/:slotId", requireAuth, requireAnyAccessGroup(adminStaffAccessGroups), async (req: any, res) => {
    try {
      const slotId = parseInt(req.params.slotId);
      const existing = await storage.getFeedbackSlot(slotId);
      if (!existing || (req.adminUser.role !== "super_admin" && existing.supervisorAdminId !== req.adminUser.id)) {
        return res.status(404).json({ message: "Feedback Meeting availability window not found" });
      }
      const referenceCount = await storage.countFeedbackSchedulesReferencingSlot(slotId);
      if (referenceCount > 0) {
        return res.status(409).json({
          message: "This availability window is referenced by trainee Feedback Meeting schedules. Deactivate it instead.",
          scheduleReferenceCount: referenceCount,
        });
      }
      const deleted = await storage.deleteFeedbackSlot(slotId);
      if (!deleted) {
        return res.status(404).json({ message: "Feedback Meeting availability window not found" });
      }
      res.json({ deleted: true, id: slotId });
    } catch (error: any) {
      res.status(400).json({ message: "Failed to delete Feedback Meeting availability", error: error?.message });
    }
  });

  app.patch(
    "/api/admin/engagements/:engagementId/feedback-meetings/:occurrenceId/status",
    requireAuth,
    requireAnyAccessGroup(adminStaffAccessGroups),
    async (req: any, res) => {
      try {
        const engagementId = parseInt(req.params.engagementId);
        const occurrenceId = parseInt(req.params.occurrenceId);
        const payload = meetingStatusUpdatePayloadSchema.parse(req.body);
        const engagement = await storage.getAdminEngagement(engagementId);
        if (!engagement) {
          return res.status(404).json({ message: "Admin engagement not found" });
        }
        if (!canAccessEngagementCheckIns(req.adminUser, engagement)) {
          return res.status(403).json({ message: "Insufficient permissions" });
        }
        const occurrences = await storage.listFeedbackMeetingOccurrencesForEngagement(engagementId);
        if (!occurrences.some((occurrence) => occurrence.id === occurrenceId)) {
          return res.status(404).json({ message: "Feedback meeting occurrence not found" });
        }
        const occurrence = await storage.updateFeedbackMeetingOccurrenceStatus(occurrenceId, {
          status: payload.status,
          actorAdminId: req.adminUser.id,
        });
        if (!occurrence) {
          return res.status(404).json({ message: "Feedback meeting occurrence not found" });
        }
        res.json(sanitizeFeedbackMeetingOccurrence(occurrence));
      } catch (error: any) {
        res.status(400).json({ message: "Failed to update feedback meeting status", error: error?.message });
      }
    }
  );

  app.get("/api/admin/company-brand-defaults", requireAuth, requireRole(['super_admin']), async (_req: any, res) => {
    res.json(publicCompanyBrandDefaults());
  });

  app.get("/api/admin/document-templates", requireAuth, requireAnyAccessGroup(['super_admin', 'document_templates']), async (req: any, res) => {
    try {
      const documentType = req.query.documentType ? String(req.query.documentType) : undefined;
      if (documentType && documentType !== "offer_letter") {
        return res.status(400).json({ message: "Unsupported document template type" });
      }

      const templates = await storage.listAdminDocumentTemplates({ documentType });
      res.json(templates.map(sanitizeAdminDocumentTemplate));
    } catch (error) {
      console.error("[document-template route] Failed to fetch document templates", error);
      res.status(500).json({ message: "Failed to fetch document templates" });
    }
  });

  app.get("/api/admin/document-templates/:templateId", requireAuth, requireAnyAccessGroup(['super_admin', 'document_templates']), async (req: any, res) => {
    try {
      const template = await storage.getAdminDocumentTemplate(parseInt(req.params.templateId));
      if (!template) {
        return res.status(404).json({ message: "Document template not found" });
      }

      res.json(sanitizeAdminDocumentTemplate(template));
    } catch (error) {
      console.error("[document-template route] Failed to fetch document template", error);
      res.status(500).json({ message: "Failed to fetch document template" });
    }
  });

  app.post("/api/admin/document-templates", requireAuth, requireAnyAccessGroup(['super_admin', 'document_templates']), async (req: any, res) => {
    try {
      const payload = documentTemplatePayloadSchema.parse(req.body);
      const template = await createDocumentTemplate({
        storage,
        actorAdminId: req.adminUser.id,
        documentType: payload.documentType,
        name: payload.name,
        description: payload.description,
        status: payload.status,
        titleTemplate: payload.titleTemplate,
        bodyTemplate: payload.bodyTemplate,
        contentFormat: payload.contentFormat,
        allowedVariables: payload.allowedVariables,
      });
      res.status(201).json(sanitizeAdminDocumentTemplate(template));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to create document template");
    }
  });

  app.patch("/api/admin/document-templates/:templateId", requireAuth, requireAnyAccessGroup(['super_admin', 'document_templates']), async (req: any, res) => {
    try {
      const payload = documentTemplateUpdatePayloadSchema.parse(req.body);
      const template = await updateDocumentTemplate({
        storage,
        templateId: parseInt(req.params.templateId),
        actorAdminId: req.adminUser.id,
        updates: payload,
      });
      res.json(sanitizeAdminDocumentTemplate(template));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to update document template");
    }
  });

  app.post("/api/admin/document-templates/:templateId/archive", requireAuth, requireAnyAccessGroup(['super_admin', 'document_templates']), async (req: any, res) => {
    try {
      const template = await archiveDocumentTemplate({
        storage,
        templateId: parseInt(req.params.templateId),
      });
      res.json(sanitizeAdminDocumentTemplate(template));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to archive document template");
    }
  });

  app.get("/api/admin/engagements/:engagementId/documents", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const engagement = await storage.getAdminEngagement(engagementId);
      if (!engagement) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }

      const documents = await storage.listAdminEngagementDocuments(engagementId);
      res.json(documents.map(sanitizeAdminEngagementDocument));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch engagement documents" });
    }
  });

  app.post("/api/admin/engagements/:engagementId/documents/preview-template", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const payload = templatePreviewPayloadSchema.parse(req.body);
      const preview = await previewOfferLetterTemplate({
        storage,
        engagementId,
        templateId: payload.templateId,
        allowMissing: true,
        manualValues: {
          engagementTitle: payload.engagementTitle,
          functionArea: payload.functionArea,
          compensationText: payload.compensationText,
          schoolName: payload.schoolName,
          programOrMajor: payload.programOrMajor,
          workLocation: payload.workLocation,
          responseDeadline: payload.responseDeadline,
          responsibilitiesText: payload.responsibilitiesText,
          trainingAlignmentText: payload.trainingAlignmentText,
          signatoryName: payload.signatoryName,
        },
      });

      res.json({
        template_id: preview.template.id,
        template_version: preview.template.version,
        title: preview.title,
        body: preview.body,
        merge_data: preview.mergeData,
        company_brand_defaults: publicCompanyBrandDefaults(),
        used_variables: preview.usedVariables,
        missing_variables: preview.missingVariables,
      });
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to preview offer letter template");
    }
  });

  app.post("/api/admin/engagements/:engagementId/documents", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const payload = offerLetterPayloadSchema.parse(req.body);
      const document = "templateId" in payload
        ? await createOfferLetterDocumentFromTemplate({
            storage,
            engagementId,
            actorAdminId: req.adminUser.id,
            templateId: payload.templateId,
            manualValues: {
              engagementTitle: payload.engagementTitle,
              functionArea: payload.functionArea,
              compensationText: payload.compensationText,
              schoolName: payload.schoolName,
              programOrMajor: payload.programOrMajor,
              workLocation: payload.workLocation,
              responseDeadline: payload.responseDeadline,
              responsibilitiesText: payload.responsibilitiesText,
              trainingAlignmentText: payload.trainingAlignmentText,
              signatoryName: payload.signatoryName,
            },
            title: payload.title,
            body: payload.body,
          })
        : await createOfferLetterDocument({
            storage,
            engagementId,
            actorAdminId: req.adminUser.id,
            title: payload.title,
            body: payload.body,
          });

      res.status(201).json(sanitizeAdminEngagementDocument(document));
    } catch (error) {
      handleOfferLetterRouteError(res, error, "Failed to create offer letter");
    }
  });

  app.post(
    "/api/admin/engagements/:engagementId/documents/:documentId/regenerate-pdf",
    requireAuth,
    requireRole(['super_admin']),
    async (req: any, res) => {
      try {
        const document = await regenerateOfferLetterPdf({
          storage,
          engagementId: parseInt(req.params.engagementId),
          documentId: parseInt(req.params.documentId),
          actorAdminId: req.adminUser.id,
        });
        res.json(sanitizeAdminEngagementDocument(document));
      } catch (error) {
        handleOfferLetterRouteError(res, error, "Failed to regenerate offer letter PDF");
      }
    }
  );

  app.post(
    "/api/admin/engagements/:engagementId/documents/:documentId/send",
    requireAuth,
    requireRole(['super_admin']),
    async (req: any, res) => {
      try {
        const document = await sendOfferLetterDocument({
          storage,
          engagementId: parseInt(req.params.engagementId),
          documentId: parseInt(req.params.documentId),
          actorAdminId: req.adminUser.id,
        });
        res.json(sanitizeAdminEngagementDocument(document));
      } catch (error) {
        handleOfferLetterRouteError(res, error, "Failed to send offer letter");
      }
    }
  );

  app.get(
    "/api/admin/engagements/:engagementId/documents/:documentId/download",
    requireAuth,
    requireRole(['super_admin']),
    async (req: any, res) => {
      try {
        const result = await getOfferLetterDownload({
          storage,
          requester: "admin",
          engagementId: parseInt(req.params.engagementId),
          documentId: parseInt(req.params.documentId),
        });
        sendOfferLetterPdf(res, result);
      } catch (error) {
        handleOfferLetterRouteError(res, error, "Failed to download offer letter");
      }
    }
  );

  app.post(
    "/api/admin/engagements/:engagementId/documents/:documentId/void",
    requireAuth,
    requireRole(['super_admin']),
    async (req: any, res) => {
      try {
        const document = await voidOfferLetterDocument({
          storage,
          engagementId: parseInt(req.params.engagementId),
          documentId: parseInt(req.params.documentId),
          actorAdminId: req.adminUser.id,
        });
        res.json(sanitizeAdminEngagementDocument(document));
      } catch (error) {
        handleOfferLetterRouteError(res, error, "Failed to void offer letter");
      }
    }
  );

  app.get("/api/admin/users/:id/lifecycle-events", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const adminId = parseInt(req.params.id);
      const events = await storage.listAdminLifecycleEvents(adminId);
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lifecycle events" });
    }
  });

  app.post("/api/admin/engagements/:engagementId/events", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const engagement = await storage.getAdminEngagement(engagementId);
      if (!engagement) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }

      const eventData = lifecycleEventPayloadSchema.parse(req.body);
      const event = await storage.createAdminLifecycleEvent({
        adminUserId: engagement.adminUserId,
        engagementId: engagement.id,
        eventType: eventData.eventType,
        occurredAt: eventData.occurredAt,
        actorAdminId: req.adminUser.id,
        metadata: eventData.metadata ?? {},
        notes: eventData.notes ?? null,
      });

      res.status(201).json(event);
    } catch (error: any) {
      res.status(400).json({ message: "Failed to create lifecycle event", error: error?.message });
    }
  });

  app.get("/api/admin/engagements/:engagementId/activity-logs", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const engagementId = parseInt(req.params.engagementId);
      const engagement = await storage.getAdminEngagement(engagementId);
      if (!engagement) {
        return res.status(404).json({ message: "Admin engagement not found" });
      }

      const logs = await storage.listAdminActivityLogsForEngagement(engagementId);
      res.json(logs.map(sanitizeActivityLog));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch admin activity logs" });
    }
  });

  app.post("/api/admin/engagements/run-lifecycle-transitions", requireAuth, requireAnyAccessGroup(['super_admin', 'lifecycle_jobs']), async (_req: any, res) => {
    try {
      const result = await runEngagementLifecycleTransitions();
      res.json({
        activated_count: result.activatedCount,
        offboarded_count: result.offboardedCount,
        voided_offer_letters_count: result.voidedOfferLetterCount,
        errors: result.errors,
      });
    } catch (error: any) {
      res.status(500).json({
        message: "Failed to run engagement lifecycle transitions",
        error: error?.message,
      });
    }
  });

  app.put("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = adminUserUpdateSchema.parse(req.body);
      if (updates.role === 'trainee_access') {
        const engagements = await storage.listAdminEngagements(id);
        if (engagements.length === 0) {
          return res.status(400).json({
            message: "Failed to update admin user",
            error: "Engagement is required for Trainee Access",
          });
        }
      }
      
      const updatedAdmin = await storage.updateAdminUser(id, updates);
      res.json(await serializeAdminUser(updatedAdmin));
    } catch (error: any) {
      if (isAdminEmailUniqueViolation(error)) {
        return res.status(409).json({
          message: "An admin with this email already exists.",
          field: "email",
        });
      }
      res.status(400).json({ message: "Failed to update admin user", error: error?.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id === req.adminUser.id) {
        return res.status(400).json({ message: "You cannot delete your own admin account while signed in." });
      }
      const admin = await storage.getAdminUser(id);
      if (!admin) {
        return res.status(404).json({ message: "Admin user not found" });
      }
      await storage.deleteAdminUser(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("[delete admin user] Failed to delete admin user", error);
      res.status(400).json({ message: "Failed to delete admin user", error: error?.message });
    }
  });

  // Approval workflow routes
  app.get("/api/admin/approvals", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const { status } = req.query;
      const approvals = await storage.listApprovalRequests({ 
        status: status as any 
      });
      res.json(approvals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch approval requests" });
    }
  });

  app.post("/api/admin/approvals", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const validatedData = insertAdminUserApprovalSchema.parse({
        ...req.body,
        requestedBy: req.adminUser.id,
      });
      
      const approval = await storage.createApprovalRequest(validatedData);
      res.status(201).json(approval);
    } catch (error) {
      res.status(400).json({ message: "Failed to create approval request" });
    }
  });

  app.put("/api/admin/approvals/:id", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes } = req.body;
      if (status === 'approved') {
        const result = await approveCreateAdminRequest({
          storage,
          approvalId: id,
          approvedBy: req.adminUser.id,
          notes,
        });

        try {
          const [engagement] = await storage.listAdminEngagements(result.delivery.admin.id);
          if (engagement) {
            await storage.createAdminLifecycleEvent({
              adminUserId: result.delivery.admin.id,
              engagementId: engagement.id,
              eventType: 'account_activated',
              actorAdminId: req.adminUser.id,
              metadata: {},
              notes: null,
            });
          }
        } catch (eventError) {
          console.warn("Failed to record account_activated lifecycle event:", eventError);
        }

        const emailSent = await sendAdminPasswordSetupEmail({
          to: result.delivery.admin.email,
          name: result.delivery.admin.name,
          setupUrl: result.delivery.setupUrl,
          role: result.delivery.admin.role,
        });

        if (!emailSent) {
          return res.status(502).json({
            message: "Admin was activated, but password setup email failed. Use resend setup link after fixing email delivery.",
            approval: result.approval,
          });
        }

        try {
          const [engagement] = await storage.listAdminEngagements(result.delivery.admin.id);
          if (engagement) {
            await storage.createAdminLifecycleEvent({
              adminUserId: result.delivery.admin.id,
              engagementId: engagement.id,
              eventType: 'invitation_sent',
              actorAdminId: req.adminUser.id,
              metadata: { channel: 'email', purpose: 'password_setup' },
              notes: null,
            });
          }
        } catch (eventError) {
          console.warn("Failed to record invitation_sent lifecycle event:", eventError);
        }

        return res.json(result.approval);
      }

      if (status === 'rejected') {
        const approval = await rejectCreateAdminRequest({
          storage,
          approvalId: id,
          approvedBy: req.adminUser.id,
          notes,
        });
        return res.json(approval);
      }

      res.status(400).json({ message: "Unsupported approval status" });
    } catch (error) {
      if (error instanceof AdminOnboardingError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(400).json({ message: "Failed to update approval request" });
    }
  });

  app.post("/api/admin/users/:id/resend-setup-link", requireAuth, requireRole(['super_admin']), async (req: any, res) => {
    try {
      const delivery = await resendPasswordSetupLink({
        storage,
        adminId: parseInt(req.params.id),
      });

      const emailSent = await sendAdminPasswordSetupEmail({
        to: delivery.admin.email,
        name: delivery.admin.name,
        setupUrl: delivery.setupUrl,
        role: delivery.admin.role,
      });

      if (!emailSent) {
        return res.status(502).json({
          message: "Fresh setup token was generated, but password setup email failed. You can retry resend after fixing email delivery.",
        });
      }

      try {
        const [engagement] = await storage.listAdminEngagements(delivery.admin.id);
        if (engagement) {
          await storage.createAdminLifecycleEvent({
            adminUserId: delivery.admin.id,
            engagementId: engagement.id,
            eventType: 'invitation_sent',
            actorAdminId: req.adminUser.id,
            metadata: { channel: 'email', purpose: 'password_setup_resend' },
            notes: null,
          });
        }
      } catch (eventError) {
        console.warn("Failed to record invitation_sent lifecycle event:", eventError);
      }

      res.json({ message: "Password setup email resent" });
    } catch (error) {
      if (error instanceof AdminOnboardingError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(400).json({ message: "Failed to resend password setup email" });
    }
  });

  // Dashboard stats route
  app.get("/api/admin/stats", requireAuth, requireRole(['super_admin', 'admin_finance', 'admin_verifier', 'admin_support']), async (req: any, res) => {
    try {
      const totalAdmins = await storage.listAdminUsers({ status: 'active' });
      const pendingApprovals = await storage.listApprovalRequests({ status: 'pending' });
      
      res.json({
        totalAdmins: totalAdmins.length,
        pendingApprovals: pendingApprovals.length,
        activeSessions: 1, // Placeholder for JWT sessions
        systemHealth: "Healthy"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Role-specific management routes
  app.get("/api/admin/finance", requireAuth, requireRole(['super_admin', 'admin_finance']), async (req: any, res) => {
    res.json({ message: "Finance Management" });
  });

  app.get("/api/admin/verifier", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    res.json({ message: "Verifier Management" });
  });

  app.get("/api/admin/support", requireAuth, requireRole(['super_admin', 'admin_support']), async (req: any, res) => {
    res.json({ message: "Support Management" });
  });

  // Guide Application Management Routes
  // Get all guide applications with filtering
  app.get("/api/guide-applications", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { status, flaggedForReview, userId } = req.query;
      const filters: any = {};
      
      if (status) filters.status = status as ApplicationStatus;
      if (flaggedForReview !== undefined) filters.flaggedForReview = flaggedForReview === 'true';
      if (userId) filters.userId = parseInt(userId);
      
      // Clean expired locks before fetching applications (temporarily disabled until schema is synced)
      try {
        await storage.cleanExpiredLocks();
      } catch (error) {
        console.warn('Lock cleanup failed, probably due to missing columns:', (error as any).message);
      }
      
      const applications = await storage.listGuideApplications(filters);
      res.json(applications);
    } catch (error) {
      console.error('Error fetching guide applications:', error);
      res.status(500).json({ message: "Failed to fetch guide applications" });
    }
  });

  // Get a specific guide application
  app.get("/api/guide-applications/:id", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { readonly } = req.query;
      const adminId = parseInt(req.user.id);
      
      const application = await storage.getGuideApplication(id);
      
      if (!application) {
        return res.status(404).json({ message: "Guide application not found" });
      }
      
      // Security check: If not in readonly mode, check if application is locked by another admin
      if (readonly !== 'true') {
        const isLockedByOther = await storage.isApplicationLockedByOther(id, adminId);
        if (isLockedByOther) {
          return res.status(423).json({ 
            message: "Application is currently being reviewed by another admin",
            code: "LOCKED_BY_OTHER_ADMIN"
          });
        }
      }
      
      res.json(application);
    } catch (error) {
      console.error('Error fetching guide application:', error);
      res.status(500).json({ message: "Failed to fetch guide application" });
    }
  });

  // Acquire exclusive lock on application
  app.post("/api/guide-applications/:id/acquire-lock", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const adminId = parseInt(req.user.id);
      
      const lockedApplication = await storage.acquireApplicationLock(id, adminId);
      
      if (!lockedApplication) {
        // Check if it's locked by another admin
        const isLocked = await storage.isApplicationLockedByOther(id, adminId);
        if (isLocked) {
          return res.status(423).json({ message: "Application is currently being reviewed by another admin" });
        } else {
          return res.status(404).json({ message: "Application not found" });
        }
      }
      
      // Create a review record only if this is the first time this admin accesses this application
      const existingReviews = await storage.listGuideApplicationApprovals(id);
      const hasReviewedBefore = existingReviews.some(approval => 
        approval.adminId === adminId && approval.adminAction === 'review'
      );
      
      if (!hasReviewedBefore) {
        await storage.createGuideApplicationApproval({
          applicationId: id,
          userId: lockedApplication.userId,
          adminId: adminId,
          adminAction: 'review',
          note: `Started review process`
        });
      }
      
      res.json(lockedApplication);
    } catch (error) {
      console.error('Error acquiring application lock:', error);
      res.status(500).json({ message: "Failed to acquire application lock" });
    }
  });

  // Release exclusive lock on application
  app.post("/api/guide-applications/:id/release-lock", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const adminId = parseInt(req.user.id);
      
      await storage.releaseApplicationLock(id, adminId);
      res.json({ message: "Lock released successfully" });
    } catch (error) {
      console.error('Error releasing application lock:', error);
      res.status(500).json({ message: "Failed to release application lock" });
    }
  });

  // Update guide application (status, internal tags, flagged for review)
  app.put("/api/guide-applications/:id", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const updates = updateGuideApplicationLiteSchema.parse({
        id,
        ...req.body,
        updatedAt: new Date()
      });
      
      const updatedApplication = await storage.updateGuideApplication(id, updates);
      res.json(updatedApplication);
    } catch (error: any) {
      console.error('Error updating guide application:', error);
      res.status(400).json({ message: "Failed to update guide application", error: error?.message });
    }
  });

  // Get approval history for a specific application
  app.get("/api/guide-applications/:id/approvals", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { id } = req.params;
      const approvals = await storage.getApplicationApprovalHistory(id);
      res.json(approvals);
    } catch (error) {
      console.error('Error fetching approval history:', error);
      res.status(500).json({ message: "Failed to fetch approval history" });
    }
  });

  // Guide Application Approval Routes
  // Get all approvals (optionally filter by application)
  app.get("/api/guide-approvals", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const { applicationId } = req.query;
      const approvals = await storage.listGuideApplicationApprovals(applicationId);
      res.json(approvals);
    } catch (error) {
      console.error('Error fetching guide approvals:', error);
      res.status(500).json({ message: "Failed to fetch guide approvals" });
    }
  });

  // Create a new approval/review action
  app.post("/api/guide-approvals", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      // Get the application to fetch the userId if not provided
      const application = await storage.getGuideApplication(req.body.applicationId);
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      
      const validatedData = insertGuideApplicationApprovalSchema.parse({
        ...req.body,
        userId: application.userId, // Use userId from application
        adminId: parseInt(req.user.id) // Convert to number
      });
      
      const approval = await storage.createGuideApplicationApproval(validatedData);
      
      // Update the application status based on admin action
      if (validatedData.adminAction) {
        let newStatus: ApplicationStatus;
        switch (validatedData.adminAction) {
          case 'approve':
            newStatus = 'approved';
            // When approving, also update the user's guide status in main database
            try {
              await storage.updateUserGuideStatus(application.userId, true);
              console.log(`Updated user ${application.userId} guide status to true`);
            } catch (error) {
              console.error(`Failed to update user ${application.userId} guide status:`, error);
              // Continue with the approval process even if user update fails
            }
            break;
          case 'reject':
            newStatus = 'rejected';
            // When rejecting, ensure user guide status is false
            try {
              await storage.updateUserGuideStatus(application.userId, false);
              console.log(`Updated user ${application.userId} guide status to false`);
            } catch (error) {
              console.error(`Failed to update user ${application.userId} guide status:`, error);
            }
            break;
          case 'require_more_info':
            newStatus = 'needs_more_info';
            break;
          default:
            newStatus = 'pending';
        }
        
        await storage.updateGuideApplication(validatedData.applicationId, {
          id: validatedData.applicationId,
          applicationStatus: newStatus,
          updatedAt: new Date()
        });
      }
      
      res.status(201).json(approval);
    } catch (error: any) {
      console.error('Error creating guide approval:', error);
      res.status(400).json({ message: "Failed to create guide approval", error: error?.message });
    }
  });

  // Update an existing approval
  app.put("/api/guide-approvals/:id", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = updateGuideApplicationApprovalSchema.parse({
        id,
        ...req.body,
        updatedAt: new Date()
      });
      
      const updatedApproval = await storage.updateGuideApplicationApproval(id, updates);
      res.json(updatedApproval);
    } catch (error: any) {
      console.error('Error updating guide approval:', error);
      res.status(400).json({ message: "Failed to update guide approval", error: error?.message });
    }
  });

  // Get a specific approval
  app.get("/api/guide-approvals/:id", requireAuth, requireRole(['super_admin', 'admin_verifier']), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const approval = await storage.getGuideApplicationApproval(id);
      
      if (!approval) {
        return res.status(404).json({ message: "Guide approval not found" });
      }
      
      res.json(approval);
    } catch (error) {
      console.error('Error fetching guide approval:', error);
      res.status(500).json({ message: "Failed to fetch guide approval" });
    }
  });

  // ----- LocalGuide BFF: cancellation manual review (server-side only; no Stripe/DB in dashboard) -----
  const localGuideBase = process.env.LOCALGUIDE_API_BASE_URL?.replace(/\/$/, "");
  const localGuideAdminProxySecret = process.env.LOCALGUIDE_ADMIN_PROXY_SECRET;
  const localGuideAdminProxyIssuer = process.env.LOCALGUIDE_ADMIN_PROXY_ISSUER || "authflowmanager";
  const localGuideAdminProxyAudience = process.env.LOCALGUIDE_ADMIN_PROXY_AUDIENCE || "localguide-admin-proxy";
  const localGuideAdminProxyExpiresIn = process.env.LOCALGUIDE_ADMIN_PROXY_EXPIRES_IN || "5m";

  class LocalGuideProxyError extends Error {
    constructor(
      public statusCode: number,
      message: string,
    ) {
      super(message);
    }
  }

  async function localGuideProxyHeaders(req: any, includeJsonContentType: boolean): Promise<HeadersInit> {
    if (!localGuideBase || !localGuideAdminProxySecret) {
      throw new LocalGuideProxyError(
        503,
        "LocalGuide proxy is not configured. Set LOCALGUIDE_API_BASE_URL and LOCALGUIDE_ADMIN_PROXY_SECRET.",
      );
    }

    const adminUser = req.adminUser;
    if (!adminUser?.id || !adminUser?.email) {
      throw new LocalGuideProxyError(403, "Current admin identity is incomplete.");
    }

    const localGuideAdminProxyToken = jwt.sign(
      {
        adminId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
      localGuideAdminProxySecret,
      {
        expiresIn: localGuideAdminProxyExpiresIn,
        issuer: localGuideAdminProxyIssuer,
        audience: localGuideAdminProxyAudience,
        subject: String(adminUser.id),
      } as jwt.SignOptions,
    );

    const h: Record<string, string> = {
      Authorization: `Bearer ${localGuideAdminProxyToken}`,
      "x-admin-id": String(adminUser.id),
    };
    if (includeJsonContentType) {
      h["Content-Type"] = "application/json";
    }
    return h;
  }

  function handleLocalGuideProxyError(res: any, error: unknown) {
    if (error instanceof LocalGuideProxyError) {
      return res.status(error.statusCode).json({
        message: error.message,
      });
    }

    console.error("[LocalGuide proxy]", error);
    return res.status(502).json({
      message: "LocalGuide proxy request failed",
    });
  }

  app.get(
    "/api/localguide/admin/cancellation-requests",
    requireAuth,
    requireRole(["super_admin", "admin_finance"]),
    async (req: any, res) => {
      try {
        const qs = new URLSearchParams(req.query as Record<string, string>).toString();
        const path = `/api/v2/admin/cancellation-requests${qs ? `?${qs}` : ""}`;
        const headers = await localGuideProxyHeaders(req, false);
        const r = await fetch(`${localGuideBase}${path}`, { headers });
        const text = await r.text();
        res.status(r.status);
        res.type("application/json").send(text || "{}");
      } catch (error) {
        handleLocalGuideProxyError(res, error);
      }
    }
  );

  app.get(
    "/api/localguide/admin/cancellation-requests/:id",
    requireAuth,
    requireRole(["super_admin", "admin_finance"]),
    async (req: any, res) => {
      try {
        const id = encodeURIComponent(req.params.id);
        const headers = await localGuideProxyHeaders(req, false);
        const r = await fetch(`${localGuideBase}/api/v2/admin/cancellation-requests/${id}`, {
          headers,
        });
        const text = await r.text();
        res.status(r.status);
        res.type("application/json").send(text || "{}");
      } catch (error) {
        handleLocalGuideProxyError(res, error);
      }
    }
  );

  app.post(
    "/api/localguide/admin/cancellation-requests/:id/approve-refund",
    requireAuth,
    requireRole(["super_admin", "admin_finance"]),
    async (req: any, res) => {
      try {
        const id = encodeURIComponent(req.params.id);
        const headers = await localGuideProxyHeaders(req, true);
        const r = await fetch(
          `${localGuideBase}/api/v2/admin/cancellation-requests/${id}/approve-refund`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(req.body ?? {}),
          }
        );
        const text = await r.text();
        res.status(r.status);
        res.type("application/json").send(text || "{}");
      } catch (error) {
        handleLocalGuideProxyError(res, error);
      }
    }
  );

  app.post(
    "/api/localguide/admin/cancellation-requests/:id/reject-refund",
    requireAuth,
    requireRole(["super_admin", "admin_finance"]),
    async (req: any, res) => {
      try {
        const id = encodeURIComponent(req.params.id);
        const headers = await localGuideProxyHeaders(req, true);
        const r = await fetch(
          `${localGuideBase}/api/v2/admin/cancellation-requests/${id}/reject-refund`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(req.body ?? {}),
          }
        );
        const text = await r.text();
        res.status(r.status);
        res.type("application/json").send(text || "{}");
      } catch (error) {
        handleLocalGuideProxyError(res, error);
      }
    }
  );

  const httpServer = createServer(app);
  return httpServer;
}
