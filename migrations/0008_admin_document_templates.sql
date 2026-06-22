CREATE TABLE IF NOT EXISTS "admin_document_templates" (
  "id" serial PRIMARY KEY,
  "document_type" text NOT NULL DEFAULT 'offer_letter',
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "title_template" text NOT NULL,
  "body_template" text NOT NULL,
  "content_format" text NOT NULL DEFAULT 'plain_text',
  "allowed_variables" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_type_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_type_check"
    CHECK ("document_type" IN ('offer_letter'));

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_status_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_status_check"
    CHECK ("status" IN ('draft', 'active', 'archived'));

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_content_format_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_content_format_check"
    CHECK ("content_format" IN ('plain_text'));

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_name_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_name_check"
    CHECK (length(trim("name")) > 0 AND length("name") <= 200);

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_title_template_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_title_template_check"
    CHECK (length(trim("title_template")) > 0 AND length("title_template") <= 200);

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_body_template_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_body_template_check"
    CHECK (length(trim("body_template")) > 0 AND length("body_template") <= 20000);

ALTER TABLE "admin_document_templates"
  DROP CONSTRAINT IF EXISTS "admin_document_templates_version_check";

ALTER TABLE "admin_document_templates"
  ADD CONSTRAINT "admin_document_templates_version_check"
    CHECK ("version" > 0);

CREATE INDEX IF NOT EXISTS "idx_admin_document_templates_type_status"
  ON "admin_document_templates" ("document_type", "status");

ALTER TABLE "admin_document_templates" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_document_templates_no_direct_client_access" ON "admin_document_templates";
CREATE POLICY "admin_document_templates_no_direct_client_access"
  ON "admin_document_templates"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "template_id" integer REFERENCES "admin_document_templates" ("id");

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "template_version" integer;

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "template_name_snapshot" text;

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "template_title_snapshot" text;

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "template_body_snapshot" text;

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "merge_data" jsonb;

ALTER TABLE "admin_engagement_documents"
  ADD COLUMN IF NOT EXISTS "content_format" text;

UPDATE "admin_engagement_documents"
  SET "content_format" = 'plain_text'
  WHERE "content_format" IS NULL;

ALTER TABLE "admin_engagement_documents"
  ALTER COLUMN "content_format" SET DEFAULT 'plain_text';

ALTER TABLE "admin_engagement_documents"
  ALTER COLUMN "content_format" SET NOT NULL;

ALTER TABLE "admin_engagement_documents"
  DROP CONSTRAINT IF EXISTS "admin_engagement_documents_content_format_check";

ALTER TABLE "admin_engagement_documents"
  ADD CONSTRAINT "admin_engagement_documents_content_format_check"
    CHECK ("content_format" IN ('plain_text'));

ALTER TABLE "admin_engagement_documents"
  DROP CONSTRAINT IF EXISTS "admin_engagement_documents_template_version_check";

ALTER TABLE "admin_engagement_documents"
  ADD CONSTRAINT "admin_engagement_documents_template_version_check"
    CHECK ("template_version" IS NULL OR "template_version" > 0);

INSERT INTO "admin_document_templates" (
  "document_type",
  "name",
  "description",
  "status",
  "version",
  "title_template",
  "body_template",
  "content_format",
  "allowed_variables"
)
SELECT
  'offer_letter',
  'Default Offer Letter Template',
  'Default Phase 3B plain-text trainee offer letter template.',
  'active',
  1,
  '{{trainee_name}} Offer Letter',
  $$Dear {{trainee_name}},

We are pleased to offer you a trainee engagement with {{company_name}} as a {{engagement_title}}.

This engagement is expected to begin on {{start_date}} and end on {{end_date}}, unless ended earlier by either party or modified in writing. Your expected schedule is {{schedule_text}}, with an estimated commitment of {{expected_hours_per_week}} hours per week.

Your supervisor will be {{supervisor_name}}. During this engagement, your activities may include:

{{work_scope}}

The purpose of this trainee engagement is to provide supervised learning, practical exposure, and participation in limited, non-core tasks appropriate for your role and experience level. Your access to company systems will be limited to trainee-approved resources and may be modified or disabled at any time as part of standard access management.

{{compensation_text}}

If your participation depends on school approval, CPT, OPT, STEM OPT, or another work/training authorization, this offer is subject to your maintaining the required authorization before and during the engagement. You are responsible for coordinating with your school, DSO, or other relevant authority as needed.

During your engagement, you may have access to confidential, internal, or non-public information. You agree to keep such information confidential and to use it only for approved trainee activities. Additional confidentiality, IP assignment, or policy documents may be required separately.

This letter does not guarantee future employment, continued engagement, or any specific assignment beyond the dates and scope described above.

Please review this offer letter in your Trainee Workspace. If you agree, confirm your acceptance through the workspace.

Sincerely,

{{company_name}} Team$$,
  'plain_text',
  '[
    "trainee_name",
    "trainee_email",
    "engagement_type",
    "schedule_text",
    "start_date",
    "end_date",
    "expected_hours_per_week",
    "work_scope",
    "work_authorization_type",
    "supervisor_name",
    "supervisor_email",
    "engagement_title",
    "function_area",
    "compensation_text",
    "company_name"
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_document_templates"
  WHERE "document_type" = 'offer_letter'
    AND "name" = 'Default Offer Letter Template'
);
