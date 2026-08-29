CREATE TABLE IF NOT EXISTS "legal_entities" (
  "id" serial PRIMARY KEY,
  "legal_name" text NOT NULL,
  "entity_type" text NOT NULL DEFAULT 'llc',
  "formation_state" text,
  "masked_tax_identifier" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "legal_entities_name_check"
    CHECK (length(trim("legal_name")) > 0),
  CONSTRAINT "legal_entities_entity_type_check"
    CHECK ("entity_type" IN ('llc', 'corporation', 'partnership', 'sole_proprietorship', 'other')),
  CONSTRAINT "legal_entities_status_check"
    CHECK ("status" IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS "vendors" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "vendor_type" text NOT NULL DEFAULT 'other',
  "status" text NOT NULL DEFAULT 'active',
  "website" text,
  "contact_email" text,
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "vendors_name_check"
    CHECK (length(trim("name")) > 0),
  CONSTRAINT "vendors_type_check"
    CHECK ("vendor_type" IN ('saas', 'cloud', 'payroll_provider', 'utility', 'professional_service', 'contractor_vendor', 'supplier', 'other')),
  CONSTRAINT "vendors_status_check"
    CHECK ("status" IN ('active', 'inactive', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendors_active_name_unique"
  ON "vendors" (lower(trim("name")))
  WHERE "status" <> 'archived';

CREATE TABLE IF NOT EXISTS "tax_agencies" (
  "id" serial PRIMARY KEY,
  "agency_code" text NOT NULL,
  "name" text NOT NULL,
  "jurisdiction_type" text NOT NULL,
  "jurisdiction_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_agencies_code_check"
    CHECK (length(trim("agency_code")) > 0),
  CONSTRAINT "tax_agencies_name_check"
    CHECK (length(trim("name")) > 0),
  CONSTRAINT "tax_agencies_jurisdiction_type_check"
    CHECK ("jurisdiction_type" IN ('federal', 'state', 'local', 'foreign', 'other')),
  CONSTRAINT "tax_agencies_jurisdiction_code_check"
    CHECK (length(trim("jurisdiction_code")) > 0),
  CONSTRAINT "tax_agencies_status_check"
    CHECK ("status" IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tax_agencies_code_unique"
  ON "tax_agencies" ("agency_code");

CREATE TABLE IF NOT EXISTS "workers" (
  "id" serial PRIMARY KEY,
  "admin_user_id" integer REFERENCES "admin_users" ("id"),
  "worker_code" text NOT NULL,
  "legal_name" text NOT NULL,
  "preferred_name" text,
  "personnel_email" text,
  "archived_at" timestamp,
  "voided_at" timestamp,
  "merged_into_worker_id" integer REFERENCES "workers" ("id"),
  "merged_at" timestamp,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "workers_code_check"
    CHECK (length(trim("worker_code")) > 0),
  CONSTRAINT "workers_legal_name_check"
    CHECK (length(trim("legal_name")) > 0),
  CONSTRAINT "workers_merge_not_self_check"
    CHECK ("merged_into_worker_id" IS NULL OR "merged_into_worker_id" <> "id"),
  CONSTRAINT "workers_merge_pair_check"
    CHECK (
      ("merged_into_worker_id" IS NULL AND "merged_at" IS NULL)
      OR ("merged_into_worker_id" IS NOT NULL AND "merged_at" IS NOT NULL)
    ),
  CONSTRAINT "workers_terminal_state_exclusive_check"
    CHECK (num_nonnulls("archived_at", "voided_at", "merged_at") <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workers_admin_user_unique"
  ON "workers" ("admin_user_id")
  WHERE "admin_user_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workers_code_unique"
  ON "workers" ("worker_code");

CREATE INDEX IF NOT EXISTS "idx_workers_merged_into_worker"
  ON "workers" ("merged_into_worker_id");

CREATE TABLE IF NOT EXISTS "employments" (
  "id" serial PRIMARY KEY,
  "worker_id" integer NOT NULL REFERENCES "workers" ("id"),
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "employee_classification" text NOT NULL DEFAULT 'employee',
  "payroll_participation" text NOT NULL DEFAULT 'not_enrolled',
  "status" text NOT NULL DEFAULT 'draft',
  "start_date" date NOT NULL,
  "end_date" date,
  "work_location" text,
  "primary_work_state" text,
  "primary_work_jurisdiction" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "employments_classification_check"
    CHECK ("employee_classification" IN ('employee', 'paid_intern', 'other_employee')),
  CONSTRAINT "employments_payroll_participation_check"
    CHECK ("payroll_participation" IN ('not_enrolled', 'eligible', 'active', 'inactive')),
  CONSTRAINT "employments_status_check"
    CHECK ("status" IN ('draft', 'active', 'on_leave', 'ended', 'voided')),
  CONSTRAINT "employments_date_order_check"
    CHECK ("end_date" IS NULL OR "start_date" <= "end_date"),
  CONSTRAINT "employments_ended_date_check"
    CHECK ("status" <> 'ended' OR "end_date" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "idx_employments_worker"
  ON "employments" ("worker_id");

CREATE INDEX IF NOT EXISTS "idx_employments_legal_entity"
  ON "employments" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_employments_status"
  ON "employments" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_employments_one_current_per_worker_entity"
  ON "employments" ("worker_id", "legal_entity_id")
  WHERE "status" IN ('draft', 'active', 'on_leave');

CREATE TABLE IF NOT EXISTS "compensation_terms" (
  "id" serial PRIMARY KEY,
  "employment_id" integer NOT NULL REFERENCES "employments" ("id"),
  "pay_basis" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "pay_frequency" text NOT NULL,
  "expected_hours_per_week" integer,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "compensation_terms_pay_basis_check"
    CHECK ("pay_basis" IN ('hourly', 'salary', 'stipend', 'other')),
  CONSTRAINT "compensation_terms_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "compensation_terms_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "compensation_terms_frequency_check"
    CHECK ("pay_frequency" IN ('hourly', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'annual', 'one_time', 'other')),
  CONSTRAINT "compensation_terms_hours_check"
    CHECK ("expected_hours_per_week" IS NULL OR "expected_hours_per_week" BETWEEN 1 AND 168),
  CONSTRAINT "compensation_terms_effective_order_check"
    CHECK ("effective_to" IS NULL OR "effective_from" <= "effective_to"),
  CONSTRAINT "compensation_terms_status_check"
    CHECK ("status" IN ('draft', 'active', 'superseded', 'voided'))
);

CREATE INDEX IF NOT EXISTS "idx_compensation_terms_employment"
  ON "compensation_terms" ("employment_id");

CREATE INDEX IF NOT EXISTS "idx_compensation_terms_effective_dates"
  ON "compensation_terms" ("effective_from", "effective_to");

CREATE TABLE IF NOT EXISTS "work_authorizations" (
  "id" serial PRIMARY KEY,
  "worker_id" integer NOT NULL REFERENCES "workers" ("id"),
  "employment_id" integer REFERENCES "employments" ("id"),
  "admin_engagement_id" integer REFERENCES "admin_engagements" ("id"),
  "authorization_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "valid_from" date,
  "valid_through" date,
  "worksite_scope" text,
  "masked_external_ref" text,
  "restricted_notes" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "supersedes_work_authorization_id" integer REFERENCES "work_authorizations" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "work_authorizations_type_check"
    CHECK ("authorization_type" IN ('stem_opt', 'h1b', 'other_employment_authorized', 'other')),
  CONSTRAINT "work_authorizations_status_check"
    CHECK ("status" IN ('draft', 'active', 'superseded', 'voided')),
  CONSTRAINT "work_authorizations_validity_order_check"
    CHECK ("valid_from" IS NULL OR "valid_through" IS NULL OR "valid_from" <= "valid_through"),
  CONSTRAINT "work_authorizations_supersedes_not_self_check"
    CHECK ("supersedes_work_authorization_id" IS NULL OR "supersedes_work_authorization_id" <> "id")
);

CREATE INDEX IF NOT EXISTS "idx_work_authorizations_worker"
  ON "work_authorizations" ("worker_id");

CREATE INDEX IF NOT EXISTS "idx_work_authorizations_employment"
  ON "work_authorizations" ("employment_id");

CREATE INDEX IF NOT EXISTS "idx_work_authorizations_admin_engagement"
  ON "work_authorizations" ("admin_engagement_id");

CREATE INDEX IF NOT EXISTS "idx_work_authorizations_valid_through"
  ON "work_authorizations" ("valid_through");

CREATE INDEX IF NOT EXISTS "idx_work_authorizations_supersedes"
  ON "work_authorizations" ("supersedes_work_authorization_id");

CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" serial PRIMARY KEY,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "pay_date" date NOT NULL,
  "run_kind" text NOT NULL DEFAULT 'regular',
  "source_type" text NOT NULL DEFAULT 'manual',
  "source_vendor_id" integer REFERENCES "vendors" ("id"),
  "correction_of_payroll_run_id" integer REFERENCES "payroll_runs" ("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "finalized_at" timestamp,
  "finalized_by" integer REFERENCES "admin_users" ("id"),
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "payroll_runs_period_order_check"
    CHECK ("period_start" <= "period_end"),
  CONSTRAINT "payroll_runs_kind_check"
    CHECK ("run_kind" IN ('regular', 'off_cycle', 'bonus', 'correction', 'adjustment')),
  CONSTRAINT "payroll_runs_source_type_check"
    CHECK ("source_type" IN ('provider', 'csv_import', 'manual', 'internal')),
  CONSTRAINT "payroll_runs_status_check"
    CHECK ("status" IN ('draft', 'reviewed', 'finalized')),
  CONSTRAINT "payroll_runs_correction_kind_check"
    CHECK (
      ("run_kind" = 'correction' AND "correction_of_payroll_run_id" IS NOT NULL)
      OR ("run_kind" <> 'correction' AND "correction_of_payroll_run_id" IS NULL)
    ),
  CONSTRAINT "payroll_runs_correction_not_self_check"
    CHECK ("correction_of_payroll_run_id" IS NULL OR "correction_of_payroll_run_id" <> "id"),
  CONSTRAINT "payroll_runs_finalized_pair_check"
    CHECK (
      ("status" = 'finalized' AND "finalized_at" IS NOT NULL)
      OR ("status" <> 'finalized')
    )
);

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_legal_entity"
  ON "payroll_runs" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_status"
  ON "payroll_runs" ("status");

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_correction_of"
  ON "payroll_runs" ("correction_of_payroll_run_id");

CREATE TABLE IF NOT EXISTS "payroll_run_workers" (
  "id" serial PRIMARY KEY,
  "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs" ("id"),
  "worker_id" integer NOT NULL REFERENCES "workers" ("id"),
  "employment_id" integer NOT NULL REFERENCES "employments" ("id"),
  "currency" text NOT NULL DEFAULT 'USD',
  "gross_pay_cents" integer NOT NULL DEFAULT 0,
  "employee_tax_cents" integer NOT NULL DEFAULT 0,
  "employer_tax_cents" integer NOT NULL DEFAULT 0,
  "deduction_cents" integer NOT NULL DEFAULT 0,
  "net_pay_cents" integer NOT NULL DEFAULT 0,
  "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "payroll_run_workers_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payroll_run_workers_amounts_nonnegative_check"
    CHECK (
      "gross_pay_cents" >= 0
      AND "employee_tax_cents" >= 0
      AND "employer_tax_cents" >= 0
      AND "deduction_cents" >= 0
      AND "net_pay_cents" >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payroll_run_workers_run_employment_unique"
  ON "payroll_run_workers" ("payroll_run_id", "employment_id");

CREATE INDEX IF NOT EXISTS "idx_payroll_run_workers_worker"
  ON "payroll_run_workers" ("worker_id");

CREATE INDEX IF NOT EXISTS "idx_payroll_run_workers_employment"
  ON "payroll_run_workers" ("employment_id");

CREATE TABLE IF NOT EXISTS "payroll_result_lines" (
  "id" serial PRIMARY KEY,
  "payroll_run_worker_id" integer NOT NULL REFERENCES "payroll_run_workers" ("id"),
  "line_category" text NOT NULL,
  "line_code" text NOT NULL,
  "description" text,
  "amount_effect" text NOT NULL DEFAULT 'increase',
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "quantity_microunits" integer,
  "rate_amount_cents" integer,
  "jurisdiction_code" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "payroll_result_lines_category_check"
    CHECK ("line_category" IN ('earning', 'deduction', 'employee_tax', 'employer_tax', 'reimbursement', 'other')),
  CONSTRAINT "payroll_result_lines_code_check"
    CHECK (length(trim("line_code")) > 0),
  CONSTRAINT "payroll_result_lines_amount_effect_check"
    CHECK ("amount_effect" IN ('increase', 'decrease')),
  CONSTRAINT "payroll_result_lines_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "payroll_result_lines_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payroll_result_lines_quantity_check"
    CHECK ("quantity_microunits" IS NULL OR "quantity_microunits" > 0),
  CONSTRAINT "payroll_result_lines_rate_check"
    CHECK ("rate_amount_cents" IS NULL OR "rate_amount_cents" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_payroll_result_lines_run_worker"
  ON "payroll_result_lines" ("payroll_run_worker_id");

CREATE INDEX IF NOT EXISTS "idx_payroll_result_lines_category"
  ON "payroll_result_lines" ("line_category");

CREATE TABLE IF NOT EXISTS "payroll_payments" (
  "id" serial PRIMARY KEY,
  "payroll_run_worker_id" integer NOT NULL REFERENCES "payroll_run_workers" ("id"),
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "payment_date" date,
  "method_type" text NOT NULL,
  "method_label" text,
  "institution_name" text,
  "masked_last4" text,
  "external_confirmation_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "processed_at" timestamp,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "payroll_payments_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "payroll_payments_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payroll_payments_method_type_check"
    CHECK ("method_type" IN ('payroll_provider', 'ach', 'check', 'manual', 'other')),
  CONSTRAINT "payroll_payments_status_check"
    CHECK ("status" IN ('pending', 'sent', 'cleared', 'failed', 'reversed', 'voided')),
  CONSTRAINT "payroll_payments_last4_check"
    CHECK ("masked_last4" IS NULL OR "masked_last4" ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS "idx_payroll_payments_run_worker"
  ON "payroll_payments" ("payroll_run_worker_id");

CREATE INDEX IF NOT EXISTS "idx_payroll_payments_status"
  ON "payroll_payments" ("status");

CREATE TABLE IF NOT EXISTS "tax_registrations" (
  "id" serial PRIMARY KEY,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "tax_agency_id" integer NOT NULL REFERENCES "tax_agencies" ("id"),
  "tax_type" text NOT NULL,
  "jurisdiction_type" text NOT NULL,
  "jurisdiction_code" text NOT NULL,
  "masked_account_ref" text,
  "effective_from" date,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'pending',
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_registrations_tax_type_check"
    CHECK ("tax_type" IN ('federal_withholding', 'social_security', 'medicare', 'futa', 'state_withholding', 'state_unemployment', 'local_payroll', 'other')),
  CONSTRAINT "tax_registrations_jurisdiction_type_check"
    CHECK ("jurisdiction_type" IN ('federal', 'state', 'local', 'foreign', 'other')),
  CONSTRAINT "tax_registrations_jurisdiction_code_check"
    CHECK (length(trim("jurisdiction_code")) > 0),
  CONSTRAINT "tax_registrations_effective_order_check"
    CHECK ("effective_from" IS NULL OR "effective_to" IS NULL OR "effective_from" <= "effective_to"),
  CONSTRAINT "tax_registrations_status_check"
    CHECK ("status" IN ('pending', 'active', 'inactive', 'closed'))
);

CREATE INDEX IF NOT EXISTS "idx_tax_registrations_legal_entity"
  ON "tax_registrations" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_tax_registrations_agency"
  ON "tax_registrations" ("tax_agency_id");

CREATE INDEX IF NOT EXISTS "idx_tax_registrations_tax_type"
  ON "tax_registrations" ("tax_type");

CREATE TABLE IF NOT EXISTS "tax_liabilities" (
  "id" serial PRIMARY KEY,
  "tax_registration_id" integer NOT NULL REFERENCES "tax_registrations" ("id"),
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "due_date" date,
  "component" text NOT NULL,
  "amount_effect" text NOT NULL DEFAULT 'increase',
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "source_type" text NOT NULL DEFAULT 'manual',
  "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "adjusts_tax_liability_id" integer REFERENCES "tax_liabilities" ("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "recognized_at" timestamp,
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_liabilities_period_order_check"
    CHECK ("period_start" <= "period_end"),
  CONSTRAINT "tax_liabilities_component_check"
    CHECK ("component" IN ('withholding', 'social_security', 'medicare', 'futa', 'suta', 'local_tax', 'penalty', 'interest', 'adjustment', 'other')),
  CONSTRAINT "tax_liabilities_amount_effect_check"
    CHECK ("amount_effect" IN ('increase', 'decrease')),
  CONSTRAINT "tax_liabilities_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "tax_liabilities_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "tax_liabilities_source_type_check"
    CHECK ("source_type" IN ('provider', 'csv_import', 'manual', 'internal')),
  CONSTRAINT "tax_liabilities_status_check"
    CHECK ("status" IN ('draft', 'recognized', 'disputed', 'voided')),
  CONSTRAINT "tax_liabilities_adjusts_not_self_check"
    CHECK ("adjusts_tax_liability_id" IS NULL OR "adjusts_tax_liability_id" <> "id")
);

CREATE INDEX IF NOT EXISTS "idx_tax_liabilities_registration"
  ON "tax_liabilities" ("tax_registration_id");

CREATE INDEX IF NOT EXISTS "idx_tax_liabilities_period"
  ON "tax_liabilities" ("period_start", "period_end");

CREATE INDEX IF NOT EXISTS "idx_tax_liabilities_adjusts"
  ON "tax_liabilities" ("adjusts_tax_liability_id");

CREATE TABLE IF NOT EXISTS "tax_agency_payments" (
  "id" serial PRIMARY KEY,
  "tax_registration_id" integer NOT NULL REFERENCES "tax_registrations" ("id"),
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "payment_date" date,
  "method_type" text NOT NULL,
  "method_label" text,
  "institution_name" text,
  "masked_last4" text,
  "confirmation_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "submitted_at" timestamp,
  "cleared_at" timestamp,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_agency_payments_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "tax_agency_payments_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "tax_agency_payments_method_type_check"
    CHECK ("method_type" IN ('provider', 'ach', 'check', 'card', 'manual', 'other')),
  CONSTRAINT "tax_agency_payments_status_check"
    CHECK ("status" IN ('pending', 'submitted', 'cleared', 'failed', 'reversed', 'voided')),
  CONSTRAINT "tax_agency_payments_last4_check"
    CHECK ("masked_last4" IS NULL OR "masked_last4" ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS "idx_tax_agency_payments_registration"
  ON "tax_agency_payments" ("tax_registration_id");

CREATE INDEX IF NOT EXISTS "idx_tax_agency_payments_status"
  ON "tax_agency_payments" ("status");

CREATE TABLE IF NOT EXISTS "tax_payment_allocations" (
  "id" serial PRIMARY KEY,
  "tax_liability_id" integer NOT NULL REFERENCES "tax_liabilities" ("id"),
  "tax_agency_payment_id" integer NOT NULL REFERENCES "tax_agency_payments" ("id"),
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "status" text NOT NULL DEFAULT 'active',
  "reversed_at" timestamp,
  "reversed_by" integer REFERENCES "admin_users" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_payment_allocations_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "tax_payment_allocations_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "tax_payment_allocations_status_check"
    CHECK ("status" IN ('active', 'reversed', 'voided')),
  CONSTRAINT "tax_payment_allocations_reversal_pair_check"
    CHECK (
      ("status" = 'reversed' AND "reversed_at" IS NOT NULL)
      OR ("status" <> 'reversed')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tax_payment_allocations_active_unique"
  ON "tax_payment_allocations" ("tax_liability_id", "tax_agency_payment_id")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "idx_tax_payment_allocations_liability"
  ON "tax_payment_allocations" ("tax_liability_id");

CREATE INDEX IF NOT EXISTS "idx_tax_payment_allocations_payment"
  ON "tax_payment_allocations" ("tax_agency_payment_id");

CREATE TABLE IF NOT EXISTS "tax_filings" (
  "id" serial PRIMARY KEY,
  "tax_registration_id" integer NOT NULL REFERENCES "tax_registrations" ("id"),
  "filing_type" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "due_date" date,
  "filed_at" timestamp,
  "accepted_at" timestamp,
  "confirmation_ref" text,
  "amends_tax_filing_id" integer REFERENCES "tax_filings" ("id"),
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_filings_type_check"
    CHECK (length(trim("filing_type")) > 0),
  CONSTRAINT "tax_filings_period_order_check"
    CHECK ("period_start" <= "period_end"),
  CONSTRAINT "tax_filings_status_check"
    CHECK ("status" IN ('draft', 'ready', 'filed', 'accepted', 'rejected', 'voided')),
  CONSTRAINT "tax_filings_amends_not_self_check"
    CHECK ("amends_tax_filing_id" IS NULL OR "amends_tax_filing_id" <> "id"),
  CONSTRAINT "tax_filings_filed_pair_check"
    CHECK ("status" NOT IN ('filed', 'accepted', 'rejected') OR "filed_at" IS NOT NULL),
  CONSTRAINT "tax_filings_accepted_pair_check"
    CHECK ("status" <> 'accepted' OR "accepted_at" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tax_filings_original_unique"
  ON "tax_filings" ("tax_registration_id", "filing_type", "period_start", "period_end")
  WHERE "amends_tax_filing_id" IS NULL AND "status" <> 'voided';

CREATE INDEX IF NOT EXISTS "idx_tax_filings_registration"
  ON "tax_filings" ("tax_registration_id");

CREATE INDEX IF NOT EXISTS "idx_tax_filings_amends"
  ON "tax_filings" ("amends_tax_filing_id");

CREATE TABLE IF NOT EXISTS "recurring_expenses" (
  "id" serial PRIMARY KEY,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "vendor_id" integer NOT NULL REFERENCES "vendors" ("id"),
  "category_code" text NOT NULL,
  "cadence" text NOT NULL,
  "expected_amount_cents" integer,
  "currency" text NOT NULL DEFAULT 'USD',
  "variable_amount" boolean NOT NULL DEFAULT false,
  "billing_day" integer,
  "next_billing_date" date,
  "renewal_date" date,
  "auto_renew" boolean NOT NULL DEFAULT false,
  "trial_ends_on" date,
  "cancellation_date" date,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "recurring_expenses_category_check"
    CHECK (length(trim("category_code")) > 0),
  CONSTRAINT "recurring_expenses_cadence_check"
    CHECK ("cadence" IN ('weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  CONSTRAINT "recurring_expenses_amount_check"
    CHECK ("expected_amount_cents" IS NULL OR "expected_amount_cents" > 0),
  CONSTRAINT "recurring_expenses_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "recurring_expenses_billing_day_check"
    CHECK ("billing_day" IS NULL OR "billing_day" BETWEEN 1 AND 31),
  CONSTRAINT "recurring_expenses_status_check"
    CHECK ("status" IN ('draft', 'trial', 'active', 'paused', 'cancelled', 'expired')),
  CONSTRAINT "recurring_expenses_cancelled_date_check"
    CHECK ("status" <> 'cancelled' OR "cancellation_date" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_vendor"
  ON "recurring_expenses" ("vendor_id");

CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_legal_entity"
  ON "recurring_expenses" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_status"
  ON "recurring_expenses" ("status");

CREATE TABLE IF NOT EXISTS "vendor_bills" (
  "id" serial PRIMARY KEY,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "vendor_id" integer NOT NULL REFERENCES "vendors" ("id"),
  "recurring_expense_id" integer REFERENCES "recurring_expenses" ("id"),
  "invoice_number" text,
  "bill_kind" text NOT NULL DEFAULT 'invoice',
  "issue_date" date,
  "due_date" date,
  "service_period_start" date,
  "service_period_end" date,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "category_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "credit_for_vendor_bill_id" integer REFERENCES "vendor_bills" ("id"),
  "notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "vendor_bills_kind_check"
    CHECK ("bill_kind" IN ('invoice', 'bill', 'credit_memo', 'statement', 'other')),
  CONSTRAINT "vendor_bills_service_period_order_check"
    CHECK ("service_period_start" IS NULL OR "service_period_end" IS NULL OR "service_period_start" <= "service_period_end"),
  CONSTRAINT "vendor_bills_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "vendor_bills_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "vendor_bills_category_check"
    CHECK (length(trim("category_code")) > 0),
  CONSTRAINT "vendor_bills_status_check"
    CHECK ("status" IN ('draft', 'received', 'approved', 'disputed', 'voided')),
  CONSTRAINT "vendor_bills_credit_not_self_check"
    CHECK ("credit_for_vendor_bill_id" IS NULL OR "credit_for_vendor_bill_id" <> "id"),
  CONSTRAINT "vendor_bills_credit_kind_check"
    CHECK ("credit_for_vendor_bill_id" IS NULL OR "bill_kind" = 'credit_memo')
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_bills_invoice_number_unique"
  ON "vendor_bills" ("vendor_id", lower(trim("invoice_number")))
  WHERE "invoice_number" IS NOT NULL AND "status" <> 'voided';

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_vendor"
  ON "vendor_bills" ("vendor_id");

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_legal_entity"
  ON "vendor_bills" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_recurring_expense"
  ON "vendor_bills" ("recurring_expense_id");

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_status"
  ON "vendor_bills" ("status");

CREATE TABLE IF NOT EXISTS "expense_payments" (
  "id" serial PRIMARY KEY,
  "legal_entity_id" integer NOT NULL REFERENCES "legal_entities" ("id"),
  "vendor_id" integer REFERENCES "vendors" ("id"),
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "direction" text NOT NULL DEFAULT 'outflow',
  "payment_date" date,
  "method_type" text NOT NULL,
  "method_label" text,
  "institution_name" text,
  "masked_last4" text,
  "external_confirmation_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "expense_payments_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "expense_payments_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "expense_payments_direction_check"
    CHECK ("direction" IN ('outflow', 'refund')),
  CONSTRAINT "expense_payments_method_type_check"
    CHECK ("method_type" IN ('provider', 'ach', 'check', 'card', 'wire', 'manual', 'other')),
  CONSTRAINT "expense_payments_status_check"
    CHECK ("status" IN ('pending', 'posted', 'cleared', 'failed', 'reversed', 'voided')),
  CONSTRAINT "expense_payments_last4_check"
    CHECK ("masked_last4" IS NULL OR "masked_last4" ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS "idx_expense_payments_vendor"
  ON "expense_payments" ("vendor_id");

CREATE INDEX IF NOT EXISTS "idx_expense_payments_legal_entity"
  ON "expense_payments" ("legal_entity_id");

CREATE INDEX IF NOT EXISTS "idx_expense_payments_status"
  ON "expense_payments" ("status");

CREATE TABLE IF NOT EXISTS "vendor_bill_applications" (
  "id" serial PRIMARY KEY,
  "target_vendor_bill_id" integer NOT NULL REFERENCES "vendor_bills" ("id"),
  "expense_payment_id" integer REFERENCES "expense_payments" ("id"),
  "credit_vendor_bill_id" integer REFERENCES "vendor_bills" ("id"),
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "status" text NOT NULL DEFAULT 'active',
  "reversed_at" timestamp,
  "reversed_by" integer REFERENCES "admin_users" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "vendor_bill_applications_exactly_one_source_check"
    CHECK (num_nonnulls("expense_payment_id", "credit_vendor_bill_id") = 1),
  CONSTRAINT "vendor_bill_applications_amount_positive_check"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "vendor_bill_applications_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "vendor_bill_applications_status_check"
    CHECK ("status" IN ('active', 'reversed', 'voided')),
  CONSTRAINT "vendor_bill_applications_credit_not_target_check"
    CHECK ("credit_vendor_bill_id" IS NULL OR "credit_vendor_bill_id" <> "target_vendor_bill_id"),
  CONSTRAINT "vendor_bill_applications_reversal_pair_check"
    CHECK (
      ("status" = 'reversed' AND "reversed_at" IS NOT NULL)
      OR ("status" <> 'reversed')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_bill_payment_applications_active_unique"
  ON "vendor_bill_applications" ("target_vendor_bill_id", "expense_payment_id")
  WHERE "status" = 'active' AND "expense_payment_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_bill_credit_applications_active_unique"
  ON "vendor_bill_applications" ("target_vendor_bill_id", "credit_vendor_bill_id")
  WHERE "status" = 'active' AND "credit_vendor_bill_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_vendor_bill_applications_target"
  ON "vendor_bill_applications" ("target_vendor_bill_id");

CREATE INDEX IF NOT EXISTS "idx_vendor_bill_applications_payment"
  ON "vendor_bill_applications" ("expense_payment_id");

CREATE INDEX IF NOT EXISTS "idx_vendor_bill_applications_credit"
  ON "vendor_bill_applications" ("credit_vendor_bill_id");

CREATE TABLE IF NOT EXISTS "documents" (
  "id" serial PRIMARY KEY,
  "storage_provider" text NOT NULL DEFAULT 'r2',
  "file_key" text NOT NULL,
  "file_sha256" text NOT NULL,
  "file_content_type" text NOT NULL,
  "file_size_bytes" integer NOT NULL,
  "original_filename" text,
  "document_type" text NOT NULL,
  "sensitivity_class" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "voided_at" timestamp,
  "voided_by" integer REFERENCES "admin_users" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "documents_storage_provider_check"
    CHECK ("storage_provider" IN ('r2', 'external')),
  CONSTRAINT "documents_file_key_check"
    CHECK (length(trim("file_key")) > 0),
  CONSTRAINT "documents_sha256_check"
    CHECK ("file_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "documents_file_size_check"
    CHECK ("file_size_bytes" > 0),
  CONSTRAINT "documents_type_check"
    CHECK (length(trim("document_type")) > 0),
  CONSTRAINT "documents_sensitivity_check"
    CHECK ("sensitivity_class" IN ('ordinary_finance', 'employment', 'payroll', 'tax', 'work_authorization')),
  CONSTRAINT "documents_status_check"
    CHECK ("status" IN ('active', 'voided')),
  CONSTRAINT "documents_voided_pair_check"
    CHECK (
      ("status" = 'voided' AND "voided_at" IS NOT NULL)
      OR ("status" <> 'voided')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_documents_file_key_unique"
  ON "documents" ("file_key");

CREATE INDEX IF NOT EXISTS "idx_documents_sha256"
  ON "documents" ("file_sha256");

CREATE INDEX IF NOT EXISTS "idx_documents_sensitivity"
  ON "documents" ("sensitivity_class");

CREATE TABLE IF NOT EXISTS "document_links" (
  "id" serial PRIMARY KEY,
  "document_id" integer NOT NULL REFERENCES "documents" ("id"),
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "link_type" text NOT NULL,
  "required_sensitivity_class" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "voided_at" timestamp,
  "voided_by" integer REFERENCES "admin_users" ("id"),
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "document_links_entity_type_check"
    CHECK ("entity_type" IN (
      'legal_entities',
      'workers',
      'employments',
      'compensation_terms',
      'work_authorizations',
      'payroll_runs',
      'payroll_run_workers',
      'payroll_result_lines',
      'payroll_payments',
      'tax_agencies',
      'tax_registrations',
      'tax_liabilities',
      'tax_agency_payments',
      'tax_payment_allocations',
      'tax_filings',
      'vendors',
      'recurring_expenses',
      'vendor_bills',
      'expense_payments',
      'vendor_bill_applications',
      'documents',
      'reconciliation_exceptions'
    )),
  CONSTRAINT "document_links_entity_id_check"
    CHECK ("entity_id" > 0),
  CONSTRAINT "document_links_link_type_check"
    CHECK (length(trim("link_type")) > 0),
  CONSTRAINT "document_links_sensitivity_check"
    CHECK ("required_sensitivity_class" IN ('ordinary_finance', 'employment', 'payroll', 'tax', 'work_authorization')),
  CONSTRAINT "document_links_status_check"
    CHECK ("status" IN ('active', 'voided')),
  CONSTRAINT "document_links_voided_pair_check"
    CHECK (
      ("status" = 'voided' AND "voided_at" IS NOT NULL)
      OR ("status" <> 'voided')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_links_active_unique"
  ON "document_links" ("document_id", "entity_type", "entity_id", "link_type")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "idx_document_links_entity"
  ON "document_links" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "external_record_refs" (
  "id" serial PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "source_type" text NOT NULL,
  "source_vendor_id" integer REFERENCES "vendors" ("id"),
  "source_namespace" text NOT NULL DEFAULT 'default',
  "external_record_type" text NOT NULL,
  "external_record_id" text NOT NULL,
  "imported_at" timestamp,
  "payload_hash" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "external_record_refs_entity_type_check"
    CHECK ("entity_type" IN (
      'legal_entities',
      'workers',
      'employments',
      'compensation_terms',
      'work_authorizations',
      'payroll_runs',
      'payroll_run_workers',
      'payroll_result_lines',
      'payroll_payments',
      'tax_agencies',
      'tax_registrations',
      'tax_liabilities',
      'tax_agency_payments',
      'tax_payment_allocations',
      'tax_filings',
      'vendors',
      'recurring_expenses',
      'vendor_bills',
      'expense_payments',
      'vendor_bill_applications',
      'documents',
      'reconciliation_exceptions'
    )),
  CONSTRAINT "external_record_refs_entity_id_check"
    CHECK ("entity_id" > 0),
  CONSTRAINT "external_record_refs_source_type_check"
    CHECK ("source_type" IN ('provider', 'csv_import', 'manual', 'internal')),
  CONSTRAINT "external_record_refs_namespace_check"
    CHECK (length(trim("source_namespace")) > 0),
  CONSTRAINT "external_record_refs_external_type_check"
    CHECK (length(trim("external_record_type")) > 0),
  CONSTRAINT "external_record_refs_external_id_check"
    CHECK (length(trim("external_record_id")) > 0),
  CONSTRAINT "external_record_refs_payload_hash_check"
    CHECK ("payload_hash" IS NULL OR length(trim("payload_hash")) > 0),
  CONSTRAINT "external_record_refs_status_check"
    CHECK ("status" IN ('active', 'superseded', 'voided'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_external_record_refs_namespace_unique"
  ON "external_record_refs" (
    "source_type",
    COALESCE("source_vendor_id", 0),
    "source_namespace",
    "external_record_type",
    "external_record_id"
  )
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "idx_external_record_refs_entity"
  ON "external_record_refs" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_external_record_refs_vendor"
  ON "external_record_refs" ("source_vendor_id");

CREATE TABLE IF NOT EXISTS "reconciliation_exceptions" (
  "id" serial PRIMARY KEY,
  "domain" text NOT NULL,
  "expected_entity_type" text,
  "expected_entity_id" integer,
  "actual_entity_type" text,
  "actual_entity_id" integer,
  "currency" text,
  "expected_amount_cents" integer,
  "actual_amount_cents" integer,
  "difference_amount_cents" integer,
  "reason_code" text NOT NULL,
  "summary" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "owner_admin_id" integer REFERENCES "admin_users" ("id"),
  "resolved_at" timestamp,
  "resolved_by" integer REFERENCES "admin_users" ("id"),
  "resolution_notes" text,
  "created_by" integer REFERENCES "admin_users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "reconciliation_exceptions_domain_check"
    CHECK ("domain" IN ('payroll', 'tax', 'ap', 'documents', 'provider_sync')),
  CONSTRAINT "reconciliation_exceptions_expected_entity_type_check"
    CHECK (
      "expected_entity_type" IS NULL
      OR "expected_entity_type" IN (
        'legal_entities',
        'workers',
        'employments',
        'compensation_terms',
        'work_authorizations',
        'payroll_runs',
        'payroll_run_workers',
        'payroll_result_lines',
        'payroll_payments',
        'tax_agencies',
        'tax_registrations',
        'tax_liabilities',
        'tax_agency_payments',
        'tax_payment_allocations',
        'tax_filings',
        'vendors',
        'recurring_expenses',
        'vendor_bills',
        'expense_payments',
        'vendor_bill_applications',
        'documents',
        'reconciliation_exceptions'
      )
    ),
  CONSTRAINT "reconciliation_exceptions_actual_entity_type_check"
    CHECK (
      "actual_entity_type" IS NULL
      OR "actual_entity_type" IN (
        'legal_entities',
        'workers',
        'employments',
        'compensation_terms',
        'work_authorizations',
        'payroll_runs',
        'payroll_run_workers',
        'payroll_result_lines',
        'payroll_payments',
        'tax_agencies',
        'tax_registrations',
        'tax_liabilities',
        'tax_agency_payments',
        'tax_payment_allocations',
        'tax_filings',
        'vendors',
        'recurring_expenses',
        'vendor_bills',
        'expense_payments',
        'vendor_bill_applications',
        'documents',
        'reconciliation_exceptions'
      )
    ),
  CONSTRAINT "reconciliation_exceptions_expected_entity_pair_check"
    CHECK (
      ("expected_entity_type" IS NULL AND "expected_entity_id" IS NULL)
      OR ("expected_entity_type" IS NOT NULL AND "expected_entity_id" IS NOT NULL AND "expected_entity_id" > 0)
    ),
  CONSTRAINT "reconciliation_exceptions_actual_entity_pair_check"
    CHECK (
      ("actual_entity_type" IS NULL AND "actual_entity_id" IS NULL)
      OR ("actual_entity_type" IS NOT NULL AND "actual_entity_id" IS NOT NULL AND "actual_entity_id" > 0)
    ),
  CONSTRAINT "reconciliation_exceptions_has_entity_check"
    CHECK ("expected_entity_id" IS NOT NULL OR "actual_entity_id" IS NOT NULL),
  CONSTRAINT "reconciliation_exceptions_currency_check"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "reconciliation_exceptions_amounts_nonnegative_check"
    CHECK (
      ("expected_amount_cents" IS NULL OR "expected_amount_cents" >= 0)
      AND ("actual_amount_cents" IS NULL OR "actual_amount_cents" >= 0)
    ),
  CONSTRAINT "reconciliation_exceptions_reason_check"
    CHECK (length(trim("reason_code")) > 0),
  CONSTRAINT "reconciliation_exceptions_summary_check"
    CHECK (length(trim("summary")) > 0),
  CONSTRAINT "reconciliation_exceptions_status_check"
    CHECK ("status" IN ('open', 'investigating', 'resolved', 'waived', 'voided')),
  CONSTRAINT "reconciliation_exceptions_resolved_pair_check"
    CHECK (
      ("status" IN ('resolved', 'waived') AND "resolved_at" IS NOT NULL)
      OR ("status" NOT IN ('resolved', 'waived'))
    )
);

CREATE INDEX IF NOT EXISTS "idx_reconciliation_exceptions_expected_entity"
  ON "reconciliation_exceptions" ("expected_entity_type", "expected_entity_id");

CREATE INDEX IF NOT EXISTS "idx_reconciliation_exceptions_actual_entity"
  ON "reconciliation_exceptions" ("actual_entity_type", "actual_entity_id");

CREATE INDEX IF NOT EXISTS "idx_reconciliation_exceptions_status"
  ON "reconciliation_exceptions" ("status");

CREATE INDEX IF NOT EXISTS "idx_reconciliation_exceptions_domain"
  ON "reconciliation_exceptions" ("domain");

DO $$
DECLARE
  table_name text;
  sequence_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'legal_entities',
    'vendors',
    'tax_agencies',
    'workers',
    'employments',
    'compensation_terms',
    'work_authorizations',
    'payroll_runs',
    'payroll_run_workers',
    'payroll_result_lines',
    'payroll_payments',
    'tax_registrations',
    'tax_liabilities',
    'tax_agency_payments',
    'tax_payment_allocations',
    'tax_filings',
    'recurring_expenses',
    'vendor_bills',
    'expense_payments',
    'vendor_bill_applications',
    'documents',
    'document_links',
    'external_record_refs',
    'reconciliation_exceptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE %I TO service_role', table_name);

    sequence_name := table_name || '_id_seq';
    IF to_regclass(sequence_name) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I FROM anon, authenticated', sequence_name);
      EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE %I TO service_role', sequence_name);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_no_direct_client_access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name || '_no_direct_client_access',
      table_name
    );
  END LOOP;
END $$;
