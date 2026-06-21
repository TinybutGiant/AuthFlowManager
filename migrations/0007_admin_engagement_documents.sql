CREATE TABLE IF NOT EXISTS "admin_engagement_documents" (
  "id" serial PRIMARY KEY,
  "engagement_id" integer NOT NULL REFERENCES "admin_engagements" ("id"),
  "admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "document_type" text NOT NULL DEFAULT 'offer_letter',
  "status" text NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "body" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "file_key" text,
  "file_sha256" text,
  "file_content_type" text DEFAULT 'application/pdf',
  "file_size_bytes" integer,
  "sent_at" timestamp,
  "viewed_at" timestamp,
  "accepted_at" timestamp,
  "accepted_by" integer REFERENCES "admin_users" ("id"),
  "accepted_ip" text,
  "accepted_user_agent" text,
  "declined_at" timestamp,
  "voided_at" timestamp,
  "voided_by" integer REFERENCES "admin_users" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "admin_engagement_documents_type_check"
    CHECK ("document_type" IN ('offer_letter')),
  CONSTRAINT "admin_engagement_documents_status_check"
    CHECK ("status" IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'voided')),
  CONSTRAINT "admin_engagement_documents_title_check"
    CHECK (length(trim("title")) > 0 AND length("title") <= 200),
  CONSTRAINT "admin_engagement_documents_body_check"
    CHECK (length(trim("body")) > 0 AND length("body") <= 20000),
  CONSTRAINT "admin_engagement_documents_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "admin_engagement_documents_file_size_check"
    CHECK ("file_size_bytes" IS NULL OR "file_size_bytes" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_admin_engagement_documents_engagement_id"
  ON "admin_engagement_documents" ("engagement_id");

CREATE INDEX IF NOT EXISTS "idx_admin_engagement_documents_admin_user_id"
  ON "admin_engagement_documents" ("admin_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_engagement_documents_version_unique"
  ON "admin_engagement_documents" ("engagement_id", "document_type", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_engagement_documents_current_offer_unique"
  ON "admin_engagement_documents" ("engagement_id", "document_type")
  WHERE "document_type" = 'offer_letter' AND "status" <> 'voided';

ALTER TABLE "admin_engagement_documents" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_engagement_documents_no_direct_client_access" ON "admin_engagement_documents";
CREATE POLICY "admin_engagement_documents_no_direct_client_access"
  ON "admin_engagement_documents"
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
      'offer_letter_voided'
    ));
