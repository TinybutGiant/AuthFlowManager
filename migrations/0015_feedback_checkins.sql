CREATE TABLE IF NOT EXISTS "supervisor_feedback_slots" (
  "id" serial PRIMARY KEY,
  "supervisor_admin_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "day_of_week" integer NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "timezone" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "supervisor_feedback_slots_day_check"
    CHECK ("day_of_week" BETWEEN 0 AND 6),
  CONSTRAINT "supervisor_feedback_slots_time_check"
    CHECK (
      "start_time" ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND "end_time" ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND "start_time" < "end_time"
    ),
  CONSTRAINT "supervisor_feedback_slots_status_check"
    CHECK ("status" IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS "idx_supervisor_feedback_slots_supervisor"
  ON "supervisor_feedback_slots" ("supervisor_admin_id");
CREATE INDEX IF NOT EXISTS "idx_supervisor_feedback_slots_status"
  ON "supervisor_feedback_slots" ("status");

CREATE TABLE IF NOT EXISTS "engagement_feedback_schedules" (
  "id" serial PRIMARY KEY,
  "engagement_id" integer NOT NULL REFERENCES "admin_engagements" ("id"),
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "supervisor_admin_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "frequency_per_week" integer NOT NULL,
  "timezone" text NOT NULL,
  "selected_slots" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'confirmed',
  "change_request_note" text,
  "confirmed_at" timestamp,
  "change_requested_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "engagement_feedback_schedules_frequency_check"
    CHECK ("frequency_per_week" IN (1, 2)),
  CONSTRAINT "engagement_feedback_schedules_status_check"
    CHECK ("status" IN ('confirmed', 'change_requested', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "idx_engagement_feedback_schedules_engagement"
  ON "engagement_feedback_schedules" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_engagement_feedback_schedules_admin_user"
  ON "engagement_feedback_schedules" ("admin_user_id");
CREATE INDEX IF NOT EXISTS "idx_engagement_feedback_schedules_supervisor"
  ON "engagement_feedback_schedules" ("supervisor_admin_id");
CREATE INDEX IF NOT EXISTS "idx_engagement_feedback_schedules_status"
  ON "engagement_feedback_schedules" ("status");

CREATE TABLE IF NOT EXISTS "feedback_meeting_occurrences" (
  "id" serial PRIMARY KEY,
  "schedule_id" integer NOT NULL REFERENCES "engagement_feedback_schedules" ("id"),
  "engagement_id" integer NOT NULL REFERENCES "admin_engagements" ("id"),
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "supervisor_admin_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "occurrence_date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "timezone" text NOT NULL,
  "status" text NOT NULL DEFAULT 'scheduled',
  "absence_reason" text,
  "absence_note" text,
  "absence_requested_at" timestamp,
  "status_updated_by" integer REFERENCES "admin_users" ("id"),
  "status_updated_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "feedback_meeting_occurrences_status_check"
    CHECK ("status" IN ('scheduled', 'absence_requested', 'excused', 'completed', 'missed', 'cancelled')),
  CONSTRAINT "feedback_meeting_occurrences_time_check"
    CHECK (
      "start_time" ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND "end_time" ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND "start_time" < "end_time"
    )
);

CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_schedule"
  ON "feedback_meeting_occurrences" ("schedule_id");
CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_engagement"
  ON "feedback_meeting_occurrences" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_admin_user"
  ON "feedback_meeting_occurrences" ("admin_user_id");
CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_supervisor"
  ON "feedback_meeting_occurrences" ("supervisor_admin_id");
CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_status"
  ON "feedback_meeting_occurrences" ("status");
CREATE INDEX IF NOT EXISTS "idx_feedback_meeting_occurrences_date"
  ON "feedback_meeting_occurrences" ("occurrence_date");

ALTER TABLE "admin_lifecycle_events"
  DROP CONSTRAINT IF EXISTS "admin_lifecycle_events_type_check";

ALTER TABLE "admin_lifecycle_events"
  ADD CONSTRAINT "admin_lifecycle_events_type_check"
    CHECK ("event_type" IN (
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
      'feedback_schedule_confirmed',
      'feedback_schedule_change_requested',
      'meeting_absence_requested',
      'meeting_status_updated'
    ));
