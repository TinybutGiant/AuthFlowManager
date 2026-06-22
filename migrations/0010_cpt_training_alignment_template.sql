UPDATE "admin_document_templates"
SET
  "version" = "version" + 1,
  "body_template" = $$
{{company_name}}
{{work_location}}

Subject: Offer of Internship for {{engagement_title}}

To: {{trainee_name}}
Email: {{trainee_email}}

Dear {{trainee_name}},

{{company_name}} is pleased to offer you a trainee internship engagement as {{engagement_title}}, expected to begin on {{start_date}} and end on {{end_date}}, unless ended earlier by either party or modified in writing.

This offer is subject to your receipt and maintenance of valid F-1 Curricular Practical Training (CPT) authorization from {{school_name}} and an updated Form I-20 reflecting this engagement. You may not begin training or work activities until the required CPT authorization is in effect. You are responsible for coordinating with your school/DSO and complying with all CPT reporting obligations.

1. Status, Schedule, and Location

* Engagement type: {{engagement_type}}
* Schedule: {{schedule_text}}
* Expected commitment: {{expected_hours_per_week}} hours per week
* Compensation: {{compensation_text}}
* Work location: {{work_location}}
* Supervisor: {{supervisor_name}} ({{supervisor_email}})
* Work authorization type: {{work_authorization_type}}

2. Primary Responsibilities

During this engagement, your primary responsibilities and learning activities may include:

{{responsibilities_text}}

3. Learning and Training Purpose

This engagement is intended to provide practical training related to your academic background in {{program_or_major}}. The responsibilities below are designed to align with your prior experience, academic training, and supervised learning objectives:

{{training_alignment_text}}

This trainee engagement is intended to provide supervised practical training, learning exposure, and limited training-related participation appropriate for your role and experience level. Your access to company systems will be limited to trainee-approved resources and may be modified or disabled as part of standard access management.

4. Employment-at-Will / Early Ending

This engagement is at-will. Either you or {{company_name}} may end the relationship at any time, with or without cause or notice, subject to applicable law and any school/CPT reporting requirements.

5. Employment Eligibility and CPT Compliance

You agree to provide any required employment eligibility documentation, including Form I-9 documents if applicable. If {{company_name}} participates in E-Verify or another employment eligibility verification process, you agree to complete the required steps. This offer remains contingent on your maintaining valid CPT authorization for the dates, location, and scope described in this letter.

6. Confidentiality and Intellectual Property

During and after your engagement, you agree to keep confidential all proprietary, trade-secret, internal, or non-public information you may access. You agree to use such information only for approved trainee activities. You further agree that work product created within the scope of approved trainee activities may be assigned to {{company_name}}, subject to any separate written agreement or applicable law.

7. Entire Agreement

This letter summarizes the current terms of your trainee internship engagement. It does not guarantee future employment, continued engagement beyond the dates above, or any specific assignment beyond the scope described here.

Please review this offer letter in your Trainee Workspace. If you agree to these terms, confirm your acceptance through the workspace by {{response_deadline}}.

We look forward to your contribution to {{company_name}}.

Sincerely,

{{signatory_name}}
{{signatory_title}}
{{company_name}}
Phone: {{company_phone}}
Email: {{company_email}}

Acknowledged and Accepted:

By accepting this offer through the Trainee Workspace, you acknowledge that you have read, understood, and accepted the terms of this offer letter.
$$,
  "allowed_variables" = '[
    "company_name",
    "work_location",
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
  "updated_at" = now()
WHERE "document_type" = 'offer_letter'
  AND "name" = 'CPT Internship Offer Letter'
  AND (
    "body_template" NOT LIKE '%{{program_or_major}}%'
    OR "body_template" NOT LIKE '%{{training_alignment_text}}%'
  );
