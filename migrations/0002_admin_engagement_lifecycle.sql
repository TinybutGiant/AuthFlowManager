ALTER TYPE "admin_role" ADD VALUE IF NOT EXISTS 'trainee_access';

CREATE TABLE IF NOT EXISTS "admin_engagements" (
  "id" serial PRIMARY KEY,
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "engagement_type" text NOT NULL,
  "schedule_type" text,
  "work_authorization_type" text NOT NULL DEFAULT 'none',
  "start_date" date,
  "end_date" date,
  "supervisor_admin_id" integer REFERENCES "admin_users" ("id"),
  "work_scope" text,
  "expected_hours_per_week" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "admin_engagements_type_check"
    CHECK ("engagement_type" IN ('employee', 'intern', 'contractor', 'advisor', 'other')),
  CONSTRAINT "admin_engagements_schedule_check"
    CHECK ("schedule_type" IS NULL OR "schedule_type" IN ('full_time', 'part_time')),
  CONSTRAINT "admin_engagements_work_auth_check"
    CHECK ("work_authorization_type" IN ('none', 'cpt', 'opt', 'stem_opt', 'other')),
  CONSTRAINT "admin_engagements_status_check"
    CHECK ("status" IN ('draft', 'invited', 'active', 'offboarding', 'ended', 'cancelled')),
  CONSTRAINT "admin_engagements_intern_end_date_check"
    CHECK ("engagement_type" <> 'intern' OR "end_date" IS NOT NULL),
  CONSTRAINT "admin_engagements_date_order_check"
    CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date")
);

CREATE INDEX IF NOT EXISTS "idx_admin_engagements_admin_user_id"
  ON "admin_engagements" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "idx_admin_engagements_status"
  ON "admin_engagements" ("status");

CREATE TABLE IF NOT EXISTS "admin_lifecycle_events" (
  "id" serial PRIMARY KEY,
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "engagement_id" integer REFERENCES "admin_engagements" ("id"),
  "event_type" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "actor_admin_id" integer REFERENCES "admin_users" ("id"),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "admin_lifecycle_events_type_check"
    CHECK ("event_type" IN (
      'engagement_created',
      'engagement_updated',
      'invitation_sent',
      'account_activated',
      'permission_granted',
      'permission_revoked',
      'office_hour_attended',
      'training_completed',
      'offboarding_started',
      'access_disabled',
      'offboarding_email_sent',
      'engagement_ended'
    ))
);

CREATE INDEX IF NOT EXISTS "idx_admin_lifecycle_events_admin_user_id"
  ON "admin_lifecycle_events" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "idx_admin_lifecycle_events_engagement_id"
  ON "admin_lifecycle_events" ("engagement_id");

CREATE INDEX IF NOT EXISTS "idx_admin_lifecycle_events_occurred_at"
  ON "admin_lifecycle_events" ("occurred_at");
