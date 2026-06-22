import { pool } from "./db";

const REQUIRED_TABLES = [
  "admin_engagements",
  "admin_lifecycle_events",
  "admin_activity_logs",
  "admin_engagement_documents",
  "admin_document_templates",
] as const;

const REQUIRED_COLUMNS = [
  ["admin_users", "must_change_password"],
  ["admin_users", "password_setup_token_hash"],
  ["admin_users", "password_setup_expires_at"],
  ["admin_engagements", "ended_at"],
  ["admin_engagement_documents", "file_key"],
  ["admin_engagement_documents", "file_sha256"],
  ["admin_engagement_documents", "file_size_bytes"],
  ["admin_engagement_documents", "accepted_by"],
  ["admin_engagement_documents", "template_id"],
  ["admin_engagement_documents", "template_version"],
  ["admin_engagement_documents", "template_name_snapshot"],
  ["admin_engagement_documents", "template_title_snapshot"],
  ["admin_engagement_documents", "template_body_snapshot"],
  ["admin_engagement_documents", "merge_data"],
  ["admin_engagement_documents", "content_format"],
  ["admin_document_templates", "title_template"],
  ["admin_document_templates", "body_template"],
  ["admin_document_templates", "allowed_variables"],
  ["admin_document_templates", "content_format"],
] as const;

const REQUIRED_LIFECYCLE_EVENT_TYPES = [
  "onboarding_started",
  "engagement_activated",
  "offboarding_email_failed",
  "self_offboarding_requested",
  "early_offboarding_started",
  "engagement_cancelled",
  "activity_log_submitted",
  "offer_letter_created",
  "offer_letter_pdf_generated",
  "offer_letter_sent",
  "offer_letter_viewed",
  "offer_letter_accepted",
  "offer_letter_declined",
  "offer_letter_voided",
] as const;

export class SchemaNotReadyError extends Error {
  constructor(public readonly missingItems: string[]) {
    super(
      [
        "Database schema is missing required admin onboarding/lifecycle migrations.",
        ...missingItems.map((item) => `- ${item}`),
        "Run `pnpm run db:migrate` and restart the server.",
      ].join("\n"),
    );
    this.name = "SchemaNotReadyError";
  }
}

export async function assertAdminSchemaReady() {
  const missingItems: string[] = [];

  const tableResult = await pool.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [REQUIRED_TABLES],
  );
  const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
  for (const table of REQUIRED_TABLES) {
    if (!existingTables.has(table)) {
      missingItems.push(`table public.${table}`);
    }
  }

  const columnResult = await pool.query<{ table_name: string; column_name: string }>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          SELECT *
          FROM unnest($1::text[], $2::text[])
        )
    `,
    [
      REQUIRED_COLUMNS.map(([table]) => table),
      REQUIRED_COLUMNS.map(([, column]) => column),
    ],
  );
  const existingColumns = new Set(
    columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`),
  );
  for (const [table, column] of REQUIRED_COLUMNS) {
    if (!existingColumns.has(`${table}.${column}`)) {
      missingItems.push(`column public.${table}.${column}`);
    }
  }

  const constraintResult = await pool.query<{ constraint_definition: string }>(
    `
      SELECT pg_get_constraintdef(c.oid) AS constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'admin_lifecycle_events'
        AND c.conname = 'admin_lifecycle_events_type_check'
      LIMIT 1
    `,
  );
  const lifecycleEventConstraint = constraintResult.rows[0]?.constraint_definition ?? "";
  for (const eventType of REQUIRED_LIFECYCLE_EVENT_TYPES) {
    if (!lifecycleEventConstraint.includes(`'${eventType}'`)) {
      missingItems.push(`lifecycle event type ${eventType}`);
    }
  }

  if (missingItems.length > 0) {
    throw new SchemaNotReadyError(missingItems);
  }
}
