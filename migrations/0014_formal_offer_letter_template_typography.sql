UPDATE "admin_document_templates"
SET
  "status" = 'archived',
  "archived_at" = COALESCE("archived_at", now()),
  "updated_at" = now()
WHERE "document_type" = 'offer_letter'
  AND "name" = 'CPT Internship Offer Letter'
  AND "status" = 'active'
  AND "version" < 3
  AND EXISTS (
    SELECT 1
    FROM "admin_document_templates" existing
    WHERE existing."document_type" = 'offer_letter'
      AND existing."name" = 'CPT Internship Offer Letter'
      AND existing."version" = 3
  );

WITH current_template AS (
  SELECT *
  FROM "admin_document_templates"
  WHERE "document_type" = 'offer_letter'
    AND "name" = 'CPT Internship Offer Letter'
    AND "status" = 'active'
    AND "version" < 3
  ORDER BY "version" DESC, "id" DESC
  LIMIT 1
),
archived_template AS (
  UPDATE "admin_document_templates"
  SET
    "status" = 'archived',
    "archived_at" = COALESCE("archived_at", now()),
    "updated_at" = now()
  WHERE "id" IN (SELECT "id" FROM current_template)
    AND NOT EXISTS (
      SELECT 1
      FROM "admin_document_templates" existing
      WHERE existing."document_type" = 'offer_letter'
        AND existing."name" = 'CPT Internship Offer Letter'
        AND existing."version" = 3
    )
  RETURNING *
)
INSERT INTO "admin_document_templates" (
  "document_type",
  "name",
  "description",
  "status",
  "version",
  "title_template",
  "body_template",
  "content_format",
  "allowed_variables",
  "created_by"
)
SELECT
  'offer_letter',
  'CPT Internship Offer Letter',
  'Formal CPT internship offer letter with renderer-level letterhead, polished typography, structured sections, primary responsibilities, CPT authorization contingency, and Trainee Workspace acceptance.',
  'active',
  3,
  'Offer of Internship for {{engagement_title}}',
  $$Subject: Offer of Internship for {{engagement_title}}

To: {{trainee_name}}
Email: {{trainee_email}}

Dear {{trainee_name}},

{{company_name}} is pleased to offer you the internship position of {{engagement_title}}, expected to begin on {{start_date}} and end on {{end_date}}, unless ended earlier by either party or modified in writing.

This offer is contingent on your receipt and maintenance of valid F-1 Curricular Practical Training (CPT) authorization from {{school_name}} and an updated Form I-20 reflecting this internship position. You may not begin training or work activities until the required CPT authorization is in effect. You are responsible for coordinating with your school/DSO and complying with all CPT reporting obligations.

1. Status, Schedule, and Location

* Position type: {{engagement_type}}
* Schedule: {{schedule_text}}
* Expected commitment: {{expected_hours_per_week}} hours per week
* Compensation: {{compensation_text}}
* Work location: {{work_location}}
* Supervisor: {{supervisor_name}} ({{supervisor_email}})
* Work authorization type: {{work_authorization_type}}

2. Primary Responsibilities

Your primary responsibilities will include:

{{responsibilities_text}}

3. Learning and Training Purpose

This internship position is intended to provide practical training related to your academic program in {{program_or_major}}. The responsibilities above are designed to align with your prior experience, academic training, and supervised learning objectives.

{{training_alignment_text}}

Your access to company systems will be limited to trainee-approved resources and may be modified or disabled as part of standard access management.

4. Employment-at-Will / Early Ending

This position is at-will. Either you or {{company_name}} may end the relationship at any time, with or without cause or notice, subject to applicable law and any school/CPT reporting requirements.

5. Employment Eligibility and CPT Compliance

You agree to provide any required employment eligibility documentation, including Form I-9 documents if applicable. If {{company_name}} participates in E-Verify or another employment eligibility verification process, you agree to complete the required steps. This offer remains contingent on your maintaining valid CPT authorization for the dates, location, and training scope described in this letter.

6. Confidentiality and Intellectual Property

During and after your internship position, you agree to keep confidential all proprietary, trade-secret, internal, or non-public information you may access. You agree to use such information only for approved trainee activities. You further agree that work product created within the scope of approved trainee activities may be assigned to {{company_name}}, subject to any separate written agreement or applicable law.

7. Entire Agreement

This letter summarizes the current terms of your internship position. It does not guarantee future employment, continued participation beyond the dates above, or any specific assignment beyond the scope described here.

Please review this offer letter in your Trainee Workspace. If you agree to these terms, confirm your acceptance through the workspace by {{response_deadline}}.

We look forward to working with you.

Sincerely,

{{signatory_name}}
{{signatory_title}}
{{company_name}}
Phone: {{company_phone}}
Email: {{company_email}}

Acknowledged and Accepted:

By accepting this offer through the Trainee Workspace, you acknowledge that you have read, understood, and accepted the terms of this offer letter.$$,
  'plain_text',
  '[
    "company_name",
    "engagement_title",
    "trainee_name",
    "trainee_email",
    "start_date",
    "end_date",
    "school_name",
    "program_or_major",
    "engagement_type",
    "schedule_text",
    "expected_hours_per_week",
    "compensation_text",
    "work_location",
    "supervisor_name",
    "supervisor_email",
    "work_authorization_type",
    "responsibilities_text",
    "training_alignment_text",
    "response_deadline",
    "signatory_name",
    "signatory_title",
    "company_phone",
    "company_email"
  ]'::jsonb,
  "created_by"
FROM archived_template
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_document_templates" existing
  WHERE existing."document_type" = 'offer_letter'
    AND existing."name" = 'CPT Internship Offer Letter'
    AND existing."version" = 3
);

UPDATE "admin_document_templates"
SET
  "status" = 'archived',
  "archived_at" = COALESCE("archived_at", now()),
  "updated_at" = now()
WHERE "document_type" = 'offer_letter'
  AND "name" = 'Default Offer Letter Template'
  AND "status" = 'active'
  AND "version" < 2
  AND EXISTS (
    SELECT 1
    FROM "admin_document_templates" existing
    WHERE existing."document_type" = 'offer_letter'
      AND existing."name" = 'Default Offer Letter Template'
      AND existing."version" = 2
  );

WITH current_template AS (
  SELECT *
  FROM "admin_document_templates"
  WHERE "document_type" = 'offer_letter'
    AND "name" = 'Default Offer Letter Template'
    AND "status" = 'active'
    AND "version" < 2
  ORDER BY "version" DESC, "id" DESC
  LIMIT 1
),
archived_template AS (
  UPDATE "admin_document_templates"
  SET
    "status" = 'archived',
    "archived_at" = COALESCE("archived_at", now()),
    "updated_at" = now()
  WHERE "id" IN (SELECT "id" FROM current_template)
    AND NOT EXISTS (
      SELECT 1
      FROM "admin_document_templates" existing
      WHERE existing."document_type" = 'offer_letter'
        AND existing."name" = 'Default Offer Letter Template'
        AND existing."version" = 2
    )
  RETURNING *
)
INSERT INTO "admin_document_templates" (
  "document_type",
  "name",
  "description",
  "status",
  "version",
  "title_template",
  "body_template",
  "content_format",
  "allowed_variables",
  "created_by"
)
SELECT
  'offer_letter',
  'Default Offer Letter Template',
  'Formal plain-text trainee offer letter template using primary responsibilities and renderer-level letterhead.',
  'active',
  2,
  'Offer Letter for {{engagement_title}}',
  $$Subject: Offer Letter for {{engagement_title}}

To: {{trainee_name}}
Email: {{trainee_email}}

Dear {{trainee_name}},

{{company_name}} is pleased to offer you the training position of {{engagement_title}}, expected to begin on {{start_date}} and end on {{end_date}}, unless ended earlier by either party or modified in writing.

1. Status, Schedule, and Location

* Position type: {{engagement_type}}
* Schedule: {{schedule_text}}
* Expected commitment: {{expected_hours_per_week}} hours per week
* Compensation: {{compensation_text}}
* Work location: {{work_location}}
* Supervisor: {{supervisor_name}} ({{supervisor_email}})
* Work authorization type: {{work_authorization_type}}

2. Primary Responsibilities

Your primary responsibilities will include:

{{responsibilities_text}}

3. Training Purpose and Authorization

This position is intended to provide supervised learning, practical exposure, and participation in limited training-related tasks appropriate for your role and experience level. If your participation depends on school approval, CPT, OPT, STEM OPT, or another work/training authorization, this offer is subject to your maintaining the required authorization before and during the position.

4. Confidentiality and Policies

During this position, you may have access to confidential, internal, or non-public information. You agree to keep such information confidential and to use it only for approved training activities. Additional confidentiality, IP assignment, or policy documents may be required separately.

5. Acceptance

This letter does not guarantee future employment, continued participation beyond the dates above, or any specific assignment beyond the scope described here. Please review this offer letter in your Trainee Workspace. If you agree, confirm your acceptance through the workspace.

Sincerely,

{{signatory_name}}
{{signatory_title}}
{{company_name}}

Acknowledged and Accepted:

By accepting this offer through the Trainee Workspace, you acknowledge that you have read, understood, and accepted the terms of this offer letter.$$,
  'plain_text',
  '[
    "company_name",
    "engagement_title",
    "trainee_name",
    "trainee_email",
    "engagement_type",
    "schedule_text",
    "start_date",
    "end_date",
    "expected_hours_per_week",
    "work_location",
    "work_authorization_type",
    "supervisor_name",
    "supervisor_email",
    "responsibilities_text",
    "compensation_text",
    "signatory_name",
    "signatory_title"
  ]'::jsonb,
  "created_by"
FROM archived_template
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_document_templates" existing
  WHERE existing."document_type" = 'offer_letter'
    AND existing."name" = 'Default Offer Letter Template'
    AND existing."version" = 2
);
