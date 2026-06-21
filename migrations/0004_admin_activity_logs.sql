CREATE TABLE IF NOT EXISTS "admin_activity_logs" (
  "id" serial PRIMARY KEY,
  "engagement_id" integer NOT NULL REFERENCES "admin_engagements" ("id"),
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "activity_type" text NOT NULL,
  "activity_date" date NOT NULL,
  "duration_minutes" integer,
  "summary" text NOT NULL,
  "learning_objective" text,
  "status" text NOT NULL DEFAULT 'submitted',
  "reviewed_by" integer REFERENCES "admin_users" ("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "admin_activity_logs_type_check"
    CHECK ("activity_type" IN (
      'office_hour',
      'training',
      'learning',
      'research',
      'documentation',
      'draft_work',
      'meeting',
      'other'
    )),
  CONSTRAINT "admin_activity_logs_duration_check"
    CHECK ("duration_minutes" IS NULL OR ("duration_minutes" > 0 AND "duration_minutes" <= 480)),
  CONSTRAINT "admin_activity_logs_status_check"
    CHECK ("status" IN ('submitted', 'reviewed')),
  CONSTRAINT "admin_activity_logs_summary_check"
    CHECK (length(trim("summary")) > 0 AND length("summary") <= 2000),
  CONSTRAINT "admin_activity_logs_learning_objective_check"
    CHECK ("learning_objective" IS NULL OR length("learning_objective") <= 1000)
);

CREATE INDEX IF NOT EXISTS "idx_admin_activity_logs_admin_user_id"
  ON "admin_activity_logs" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "idx_admin_activity_logs_engagement_id"
  ON "admin_activity_logs" ("engagement_id");

CREATE INDEX IF NOT EXISTS "idx_admin_activity_logs_activity_date"
  ON "admin_activity_logs" ("activity_date");

ALTER TABLE "admin_activity_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_activity_logs_no_direct_client_access" ON "admin_activity_logs";
CREATE POLICY "admin_activity_logs_no_direct_client_access"
  ON "admin_activity_logs"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

ALTER TABLE "admin_lifecycle_events"
  DROP CONSTRAINT IF EXISTS "admin_lifecycle_events_type_check";

ALTER TABLE "admin_lifecycle_events"
  ADD CONSTRAINT "admin_lifecycle_events_type_check"
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
      'engagement_ended',
      'activity_log_submitted'
    ));
