import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const MIGRATION_LEDGER_TABLE = "schema_migrations";
export const MIGRATION_ADVISORY_LOCK_KEY = "732481096541203";
export const MIGRATION_APPLICATION_MODES = ["applied", "adopted", "baseline"] as const;

export type MigrationApplicationMode = (typeof MIGRATION_APPLICATION_MODES)[number];

export type MigrationDbClient = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release?: () => void;
};

export type MigrationPool = {
  connect(): Promise<MigrationDbClient>;
  end?(): Promise<void>;
};

export type MigrationFile = {
  filename: string;
  version: number;
  checksumSha256: string;
  sql: string;
};

export type MigrationLedgerRow = {
  filename: string;
  checksum_sha256: string;
  applied_at: string | Date;
  execution_ms: number | null;
  application_mode: MigrationApplicationMode | string;
};

export type MigrationRunResult = {
  ledgerPresent: true;
  skipped: string[];
  applied: string[];
  latestMigration: string | null;
  pendingBeforeRun: string[];
};

export type MigrationStatus = {
  ledgerPresent: boolean;
  ledgeredMigrationCount: number;
  baselineRows: string[];
  applicationModeCounts: Record<string, number>;
  latestLedgeredMigration: string | null;
  pendingMigrations: string[];
  checksumMismatches: string[];
  orderingProblems: string[];
  transactionCompatibilityIssues: string[];
  adoptionTargets: Array<{ id: string; throughFilename: string; matched: boolean; failedChecks: string[] }>;
};

export type AdoptionResult = {
  targetId: string;
  throughFilename: string;
  adopted: string[];
  databaseName: string;
};

export class MigrationRunnerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MigrationRunnerError";
  }
}

const MIGRATION_FILENAME_PATTERN = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/;

const TRANSACTION_INCOMPATIBLE_PATTERNS = [
  {
    code: "CREATE_INDEX_CONCURRENTLY",
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  },
  {
    code: "REINDEX_CONCURRENTLY",
    pattern: /\bREINDEX\b[\s\S]*\bCONCURRENTLY\b/i,
  },
  {
    code: "VACUUM",
    pattern: /^\s*VACUUM\b/i,
  },
  {
    code: "CREATE_DATABASE",
    pattern: /^\s*CREATE\s+DATABASE\b/i,
  },
  {
    code: "DROP_DATABASE",
    pattern: /^\s*DROP\s+DATABASE\b/i,
  },
  {
    code: "ALTER_SYSTEM",
    pattern: /^\s*ALTER\s+SYSTEM\b/i,
  },
  {
    code: "EXPLICIT_TRANSACTION_CONTROL",
    pattern: /^\s*(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s*;/i,
  },
  {
    code: "START_TRANSACTION",
    pattern: /^\s*START\s+TRANSACTION\s*;/i,
  },
];

const LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS "schema_migrations" (
  "filename" text PRIMARY KEY,
  "checksum_sha256" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "execution_ms" integer,
  "application_mode" text NOT NULL,
  CONSTRAINT "schema_migrations_checksum_sha256_check"
    CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "schema_migrations_execution_ms_check"
    CHECK ("execution_ms" IS NULL OR "execution_ms" >= 0),
  CONSTRAINT "schema_migrations_application_mode_check"
    CHECK ("application_mode" IN ('applied', 'adopted', 'baseline'))
);
`;

const LEDGER_HARDENING_SQL = `
ALTER TABLE public."schema_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."schema_migrations" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public."schema_migrations" FROM authenticated;
  END IF;
END
$$;
`;

type LedgerAnalysis = {
  ledgeredMigrations: string[];
  skipped: string[];
  pending: MigrationFile[];
  latestLedgeredMigration: string | null;
  checksumMismatches: string[];
  orderingProblems: string[];
  modeProblems: string[];
};

type SchemaFingerprintCheck = {
  description: string;
  sql: string;
  params?: unknown[];
  validate(rows: any[]): boolean;
};

type AdoptionTarget = {
  id: string;
  description: string;
  throughFilename: string;
  checks: SchemaFingerprintCheck[];
};

export function canonicalizeSqlText(text: string) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function canonicalSqlSha256(text: string) {
  return createHash("sha256").update(canonicalizeSqlText(text), "utf8").digest("hex");
}

export function parseMigrationFilename(filename: string) {
  const match = MIGRATION_FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new MigrationRunnerError(
      "MIGRATION_FILENAME_INVALID",
      `Invalid migration filename "${filename}". Expected format like 0001_description.sql.`,
    );
  }
  return Number.parseInt(match[1], 10);
}

export function validateMigrationFilenames(filenames: string[]) {
  const seenVersions = new Map<number, string>();
  const parsed = filenames.map((filename) => {
    const version = parseMigrationFilename(filename);
    const existing = seenVersions.get(version);
    if (existing) {
      throw new MigrationRunnerError(
        "MIGRATION_VERSION_DUPLICATE",
        `Duplicate migration prefix ${String(version).padStart(4, "0")}: ${existing}, ${filename}.`,
      );
    }
    seenVersions.set(version, filename);
    return { filename, version };
  });

  return parsed.sort((first, second) => first.version - second.version || first.filename.localeCompare(second.filename));
}

export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const sqlFilenames = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql"));
  const ordered = validateMigrationFilenames(sqlFilenames);
  const migrations = await Promise.all(
    ordered.map(async ({ filename, version }) => {
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      return {
        filename,
        version,
        checksumSha256: canonicalSqlSha256(sql),
        sql,
      };
    }),
  );
  assertMigrationsTransactionCompatible(migrations);
  return migrations;
}

export function findTransactionCompatibilityIssues(migration: Pick<MigrationFile, "filename" | "sql">) {
  const lines = canonicalizeSqlText(migration.sql).split("\n");
  const issues: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) return;
    for (const { code, pattern } of TRANSACTION_INCOMPATIBLE_PATTERNS) {
      if (pattern.test(line)) {
        issues.push(`${migration.filename}:${index + 1}:${code}`);
      }
    }
  });

  return issues;
}

export function assertMigrationsTransactionCompatible(migrations: Array<Pick<MigrationFile, "filename" | "sql">>) {
  const issues = migrations.flatMap(findTransactionCompatibilityIssues);
  if (issues.length > 0) {
    throw new MigrationRunnerError(
      "MIGRATION_TRANSACTION_INCOMPATIBLE",
      `Cannot transaction-wrap current migration set:\n${issues.join("\n")}`,
    );
  }
}

function isMigrationApplicationMode(value: string): value is MigrationApplicationMode {
  return MIGRATION_APPLICATION_MODES.includes(value as MigrationApplicationMode);
}

function isNumberedMigrationFilename(filename: string) {
  return MIGRATION_FILENAME_PATTERN.test(filename);
}

async function ledgerTableExists(client: MigrationDbClient) {
  const result = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`,
  );
  return Boolean(result.rows[0]?.present);
}

async function ensureLedgerTable(client: MigrationDbClient) {
  await client.query(LEDGER_SQL);
  await hardenLedgerTable(client);
}

async function hardenLedgerTable(client: MigrationDbClient) {
  await client.query(LEDGER_HARDENING_SQL);
}

async function readLedgerRows(client: MigrationDbClient) {
  const result = await client.query<MigrationLedgerRow>(
    `
      SELECT "filename", "checksum_sha256", "applied_at", "execution_ms", "application_mode"
      FROM "schema_migrations"
      ORDER BY "filename"
    `,
  );
  return result.rows;
}

async function publicSchemaHasApplicationTables(client: MigrationDbClient) {
  const result = await client.query<{ present: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> 'schema_migrations'
      ) AS present
    `,
  );
  return Boolean(result.rows[0]?.present);
}

function analyzeLedger(migrations: MigrationFile[], rows: MigrationLedgerRow[]): LedgerAnalysis {
  const migrationsByFilename = new Map(migrations.map((migration) => [migration.filename, migration]));
  const ledgerByFilename = new Map<string, MigrationLedgerRow>();
  const checksumMismatches: string[] = [];
  const orderingProblems: string[] = [];
  const modeProblems: string[] = [];

  for (const row of rows) {
    if (!isMigrationApplicationMode(String(row.application_mode))) {
      modeProblems.push(`${row.filename}: unsupported application_mode ${row.application_mode}`);
    }
    if (ledgerByFilename.has(row.filename)) {
      orderingProblems.push(`${row.filename}: duplicate ledger row`);
    }
    ledgerByFilename.set(row.filename, row);

    const migration = migrationsByFilename.get(row.filename);
    if (migration) {
      if (row.checksum_sha256 !== migration.checksumSha256) {
        checksumMismatches.push(`${row.filename}: checksum mismatch`);
      }
    } else if (row.application_mode !== "baseline" || row.filename !== "db_dump.sql") {
      orderingProblems.push(`${row.filename}: ledgered migration is not present in repository migrations`);
    }
  }

  let firstMissingSeen = false;
  const skipped: string[] = [];
  const pending: MigrationFile[] = [];
  const ledgeredMigrations: string[] = [];
  let latestLedgeredMigration: string | null = null;

  for (const migration of migrations) {
    const ledgered = ledgerByFilename.has(migration.filename);
    if (ledgered && firstMissingSeen) {
      orderingProblems.push(`${migration.filename}: ledger has a non-contiguous migration prefix`);
    }
    if (ledgered) {
      skipped.push(migration.filename);
      ledgeredMigrations.push(migration.filename);
      latestLedgeredMigration = migration.filename;
    } else {
      firstMissingSeen = true;
      pending.push(migration);
    }
  }

  return {
    ledgeredMigrations,
    skipped,
    pending,
    latestLedgeredMigration,
    checksumMismatches,
    orderingProblems,
    modeProblems,
  };
}

function assertLedgerAnalysisClean(analysis: LedgerAnalysis) {
  const problems = [
    ...analysis.modeProblems,
    ...analysis.orderingProblems,
    ...analysis.checksumMismatches,
  ];
  if (problems.length > 0) {
    const code = analysis.checksumMismatches.length > 0
      ? "MIGRATION_CHECKSUM_MISMATCH"
      : "MIGRATION_LEDGER_INVALID";
    throw new MigrationRunnerError(code, problems.join("\n"));
  }
}

async function insertLedgerRow(
  client: MigrationDbClient,
  migration: Pick<MigrationFile, "filename" | "checksumSha256">,
  mode: MigrationApplicationMode,
  executionMs: number | null,
) {
  await client.query(
    `
      INSERT INTO "schema_migrations" (
        "filename",
        "checksum_sha256",
        "execution_ms",
        "application_mode"
      )
      VALUES ($1, $2, $3, $4)
    `,
    [migration.filename, migration.checksumSha256, executionMs, mode],
  );
}

async function acquireMigrationLock(client: MigrationDbClient) {
  await client.query(`SELECT pg_advisory_lock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);
}

async function releaseMigrationLock(client: MigrationDbClient) {
  await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);
}

async function withLockedMigrationClient<T>(
  pool: MigrationPool,
  callback: (client: MigrationDbClient) => Promise<T>,
) {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await acquireMigrationLock(client);
    lockAcquired = true;
    return await callback(client);
  } finally {
    if (lockAcquired) {
      await releaseMigrationLock(client);
    }
    client.release?.();
  }
}

export async function runMigrations(pool: MigrationPool, migrations: MigrationFile[]): Promise<MigrationRunResult> {
  assertMigrationsTransactionCompatible(migrations);

  return withLockedMigrationClient(pool, async (client) => {
    const hasLedger = await ledgerTableExists(client);
    if (!hasLedger) {
      const hasApplicationTables = await publicSchemaHasApplicationTables(client);
      if (!hasApplicationTables) {
        throw new MigrationRunnerError(
          "MIGRATION_BASELINE_MISSING",
          [
            "Migration ledger table public.schema_migrations is missing on an empty or unbaselined database.",
            "Normal migration execution will not execute db_dump.sql or numbered migrations automatically.",
            "Create a sanitized baseline/provisioning artifact, apply it explicitly, then seed a baseline ledger marker before running db:migrate.",
          ].join(" "),
        );
      }
      throw new MigrationRunnerError(
        "MIGRATION_LEDGER_MISSING",
        [
          "Migration ledger table public.schema_migrations is missing.",
          "Normal migration execution refuses to guess or replay migrations.",
          "Run db:migrate:status, then use the explicit adoption workflow for a verified pre-ledger database.",
        ].join(" "),
      );
    }

    await hardenLedgerTable(client);

    const rows = await readLedgerRows(client);
    if (rows.length === 0 && await publicSchemaHasApplicationTables(client)) {
      throw new MigrationRunnerError(
        "MIGRATION_LEDGER_EMPTY_ON_NONEMPTY_DATABASE",
        [
          "Migration ledger exists but has no rows while application tables already exist.",
          "Refusing to replay migrations from the beginning.",
          "Use db:migrate:status and the explicit adoption workflow to repair the ledger.",
        ].join(" "),
      );
    }

    const analysis = analyzeLedger(migrations, rows);
    assertLedgerAnalysisClean(analysis);

    const applied: string[] = [];
    for (const migration of analysis.pending) {
      const startedAt = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        const executionMs = Date.now() - startedAt;
        await insertLedgerRow(client, migration, "applied", executionMs);
        await client.query("COMMIT");
        applied.push(migration.filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new MigrationRunnerError(
          "MIGRATION_FAILED",
          `Migration ${migration.filename} failed and was rolled back: ${(error as Error).message}`,
        );
      }
    }

    const latestMigration =
      applied.length > 0
        ? applied[applied.length - 1]
        : analysis.latestLedgeredMigration;

    return {
      ledgerPresent: true,
      skipped: analysis.skipped,
      applied,
      latestMigration,
      pendingBeforeRun: analysis.pending.map((migration) => migration.filename),
    };
  });
}

export async function getMigrationStatus(pool: MigrationPool, migrations: MigrationFile[]): Promise<MigrationStatus> {
  let orderingProblems: string[] = [];
  try {
    validateMigrationFilenames(migrations.map((migration) => migration.filename));
  } catch (error) {
    orderingProblems = [(error as Error).message];
  }

  const transactionCompatibilityIssues = migrations.flatMap(findTransactionCompatibilityIssues);
  const client = await pool.connect();
  try {
    const hasLedger = await ledgerTableExists(client);
    const adoptionTargets = await evaluateAdoptionTargets(client);
    if (!hasLedger) {
      return {
        ledgerPresent: false,
        ledgeredMigrationCount: 0,
        baselineRows: [],
        applicationModeCounts: {},
        latestLedgeredMigration: null,
        pendingMigrations: migrations.map((migration) => migration.filename),
        checksumMismatches: [],
        orderingProblems,
        transactionCompatibilityIssues,
        adoptionTargets,
      };
    }

    const rows = await readLedgerRows(client);
    if (rows.length === 0 && await publicSchemaHasApplicationTables(client)) {
      orderingProblems.push(
        "schema_migrations is empty while public application tables exist; use explicit adoption before normal migration",
      );
    }
    const analysis = analyzeLedger(migrations, rows);
    const applicationModeCounts: Record<string, number> = {};
    for (const row of rows) {
      applicationModeCounts[row.application_mode] = (applicationModeCounts[row.application_mode] ?? 0) + 1;
    }

    return {
      ledgerPresent: true,
      ledgeredMigrationCount: analysis.ledgeredMigrations.length,
      baselineRows: rows
        .filter((row) => row.application_mode === "baseline")
        .map((row) => row.filename),
      applicationModeCounts,
      latestLedgeredMigration: analysis.latestLedgeredMigration,
      pendingMigrations: analysis.pending.map((migration) => migration.filename),
      checksumMismatches: analysis.checksumMismatches,
      orderingProblems: [...orderingProblems, ...analysis.orderingProblems, ...analysis.modeProblems],
      transactionCompatibilityIssues,
      adoptionTargets,
    };
  } finally {
    client.release?.();
  }
}

export async function adoptPreLedgerDatabase(
  pool: MigrationPool,
  migrations: MigrationFile[],
  options: { targetId?: string; confirmDatabaseName: string },
): Promise<AdoptionResult> {
  assertMigrationsTransactionCompatible(migrations);

  return withLockedMigrationClient(pool, async (client) => {
    const identity = await readDatabaseIdentity(client);
    if (identity.databaseName !== options.confirmDatabaseName) {
      throw new MigrationRunnerError(
        "MIGRATION_ADOPTION_CONFIRMATION_MISMATCH",
        `Refusing adoption: --confirm-database must match current_database() (${identity.databaseName}).`,
      );
    }

    const hasLedger = await ledgerTableExists(client);
    if (hasLedger) {
      const existingRows = await readLedgerRows(client);
      if (existingRows.length > 0) {
        throw new MigrationRunnerError(
          "MIGRATION_LEDGER_ALREADY_PRESENT",
          "Refusing adoption: public.schema_migrations already has ledger rows.",
        );
      }
    }

    const targetEvaluations = await evaluateAdoptionTargets(client);
    const matchedTargets = targetEvaluations.filter((target) => target.matched);
    const selected = options.targetId
      ? targetEvaluations.find((target) => target.id === options.targetId)
      : matchedTargets.length === 1
        ? matchedTargets[0]
        : null;

    if (!selected) {
      throw new MigrationRunnerError(
        "MIGRATION_ADOPTION_TARGET_AMBIGUOUS",
        `Refusing adoption: specify --target with one matched fingerprint (${matchedTargets.map((target) => target.id).join(", ") || "none"}).`,
      );
    }
    if (!selected.matched) {
      throw new MigrationRunnerError(
        "MIGRATION_ADOPTION_FINGERPRINT_FAILED",
        `Refusing adoption: fingerprint ${selected.id} did not match. Failed checks: ${selected.failedChecks.join("; ")}`,
      );
    }

    const throughIndex = migrations.findIndex((migration) => migration.filename === selected.throughFilename);
    if (throughIndex === -1) {
      throw new MigrationRunnerError(
        "MIGRATION_ADOPTION_TARGET_INVALID",
        `Adoption target ${selected.id} references missing migration ${selected.throughFilename}.`,
      );
    }
    const adopted = migrations.slice(0, throughIndex + 1);

    await client.query("BEGIN");
    try {
      await ensureLedgerTable(client);
      for (const migration of adopted) {
        await insertLedgerRow(client, migration, "adopted", null);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new MigrationRunnerError(
        "MIGRATION_ADOPTION_FAILED",
        `Adoption failed and was rolled back: ${(error as Error).message}`,
      );
    }

    return {
      targetId: selected.id,
      throughFilename: selected.throughFilename,
      adopted: adopted.map((migration) => migration.filename),
      databaseName: identity.databaseName,
    };
  });
}

export async function readDatabaseIdentity(client: MigrationDbClient) {
  const result = await client.query<{ database_name: string; server_addr: string | null; server_port: number | null }>(
    `
      SELECT
        current_database() AS database_name,
        inet_server_addr()::text AS server_addr,
        inet_server_port() AS server_port
    `,
  );
  const row = result.rows[0];
  return {
    databaseName: row?.database_name ?? "",
    serverAddr: row?.server_addr ?? null,
    serverPort: row?.server_port ?? null,
  };
}

async function evaluateAdoptionTargets(client: MigrationDbClient) {
  const targets = adoptionTargets();
  const results: MigrationStatus["adoptionTargets"] = [];
  for (const target of targets) {
    const failedChecks: string[] = [];
    for (const check of target.checks) {
      const result = await client.query(check.sql, check.params ?? []);
      if (!check.validate(result.rows)) {
        failedChecks.push(check.description);
      }
    }
    results.push({
      id: target.id,
      throughFilename: target.throughFilename,
      matched: failedChecks.length === 0,
      failedChecks,
    });
  }
  return results;
}

function adoptionTargets(): AdoptionTarget[] {
  return [
    {
      id: "pre_finance_0016",
      description: "Legacy admin lifecycle schema through 0016, before Finance/Personnel/Payroll/Tax tables.",
      throughFilename: "0016_feedback_checkins_rls.sql",
      checks: [
        ...adminLifecycleChecks(),
        ...financeV1Tables().map((table) => tableExistsCheck(table, false)),
      ],
    },
    {
      id: "finance_v1_0024",
      description: "Finance/Personnel/Payroll/Tax V1 schema through 0024.",
      throughFilename: "0024_tax_payment_reconciliation_audit_scope.sql",
      checks: [
        ...adminLifecycleChecks(),
        ...financeV1Tables().map((table) => tableExistsCheck(table, true)),
        tableRlsEnabledCheck("tax_liabilities"),
        tableRlsEnabledCheck("payroll_runs"),
        tableRlsEnabledCheck("vendor_bills"),
        tableRlsEnabledCheck("work_authorizations"),
        constraintContainsCheck("finance_audit_events", "finance_audit_events_entity_type_check", [
          "expense_payment",
          "vendor_bill_application",
          "reconciliation_exception",
        ]),
        constraintContainsCheck("personnel_audit_events", "personnel_audit_events_entity_type_check", [
          "work_authorization",
        ]),
        constraintContainsCheck("work_authorizations", "work_authorizations_type_check", [
          "stem_opt",
          "h1b",
          "other",
        ]),
        constraintContainsCheck("payroll_audit_events", "payroll_audit_events_entity_type_check", [
          "payroll_payment",
        ]),
        constraintContainsCheck("tax_audit_events", "tax_audit_events_entity_type_check", [
          "tax_agency_payment",
          "tax_payment_allocation",
          "reconciliation_exception",
        ]),
        constraintContainsCheck("tax_audit_events", "tax_audit_events_action_check", [
          "allocation_created",
          "reopened",
        ]),
      ],
    },
  ];
}

function financeV1Tables() {
  return [
    "legal_entities",
    "vendors",
    "recurring_expenses",
    "vendor_bills",
    "expense_payments",
    "vendor_bill_applications",
    "documents",
    "document_links",
    "external_record_refs",
    "workers",
    "employments",
    "compensation_terms",
    "work_authorizations",
    "payroll_runs",
    "payroll_run_workers",
    "payroll_result_lines",
    "payroll_payments",
    "tax_agencies",
    "tax_registrations",
    "tax_liabilities",
    "tax_agency_payments",
    "tax_payment_allocations",
    "tax_filings",
    "reconciliation_exceptions",
    "finance_audit_events",
    "personnel_audit_events",
    "payroll_audit_events",
    "tax_audit_events",
  ];
}

function adminLifecycleChecks() {
  return [
    ...[
      "admin_users",
      "admin_engagements",
      "admin_lifecycle_events",
      "admin_activity_logs",
      "admin_engagement_documents",
      "admin_document_templates",
      "admin_user_access_grants",
      "supervisor_feedback_slots",
      "engagement_feedback_schedules",
      "feedback_meeting_occurrences",
    ].map((table) => tableExistsCheck(table, true)),
    columnExistsCheck("admin_users", "account_type"),
    columnExistsCheck("admin_users", "password_setup_token_hash"),
    columnExistsCheck("admin_engagement_documents", "template_id"),
    columnExistsCheck("admin_engagement_documents", "merge_data"),
    columnExistsCheck("supervisor_feedback_slots", "timezone"),
    columnExistsCheck("feedback_meeting_occurrences", "absence_reason"),
    tableRlsEnabledCheck("supervisor_feedback_slots"),
    tableRlsEnabledCheck("engagement_feedback_schedules"),
    tableRlsEnabledCheck("feedback_meeting_occurrences"),
    policyExistsCheck("supervisor_feedback_slots", "supervisor_feedback_slots_no_direct_client_access"),
    policyExistsCheck("engagement_feedback_schedules", "engagement_feedback_schedules_no_direct_client_access"),
    policyExistsCheck("feedback_meeting_occurrences", "feedback_meeting_occurrences_no_direct_client_access"),
    constraintContainsCheck("admin_lifecycle_events", "admin_lifecycle_events_type_check", [
      "feedback_schedule_confirmed",
      "meeting_absence_requested",
      "early_offboarding_started",
    ]),
    constraintContainsCheck("admin_user_access_grants", "admin_user_access_grants_access_group_check", [
      "trainee_offer_portal",
      "trainee_workspace",
      "lifecycle_jobs",
    ]),
    constraintContainsCheck("admin_document_templates", "admin_document_templates_content_format_check", [
      "plain_text",
    ]),
    constraintContainsCheck("supervisor_feedback_slots", "supervisor_feedback_slots_day_check", [
      "day_of_week",
    ]),
    constraintContainsCheck("supervisor_feedback_slots", "supervisor_feedback_slots_status_check", [
      "active",
      "inactive",
    ]),
    constraintContainsCheck("engagement_feedback_schedules", "engagement_feedback_schedules_frequency_check", [
      "frequency_per_week",
    ]),
    constraintContainsCheck("feedback_meeting_occurrences", "feedback_meeting_occurrences_status_check", [
      "absence_requested",
      "completed",
      "missed",
    ]),
    indexExistsCheck("admin_user_access_grants", "idx_admin_user_access_grants_active_unique"),
    indexExistsCheck("supervisor_feedback_slots", "idx_supervisor_feedback_slots_supervisor"),
    indexExistsCheck("engagement_feedback_schedules", "idx_engagement_feedback_schedules_engagement"),
    indexExistsCheck("feedback_meeting_occurrences", "idx_feedback_meeting_occurrences_date"),
  ];
}

function tableExistsCheck(tableName: string, expected: boolean): SchemaFingerprintCheck {
  return {
    description: `table public.${tableName} ${expected ? "exists" : "is absent"}`,
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS ok
    `,
    params: [tableName],
    validate: (rows) => Boolean(rows[0]?.ok) === expected,
  };
}

function columnExistsCheck(tableName: string, columnName: string): SchemaFingerprintCheck {
  return {
    description: `column public.${tableName}.${columnName} exists`,
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS ok
    `,
    params: [tableName, columnName],
    validate: (rows) => Boolean(rows[0]?.ok),
  };
}

function tableRlsEnabledCheck(tableName: string): SchemaFingerprintCheck {
  return {
    description: `table public.${tableName} has RLS enabled`,
    sql: `
      SELECT COALESCE((
        SELECT c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = $1
        LIMIT 1
      ), false) AS ok
    `,
    params: [tableName],
    validate: (rows) => Boolean(rows[0]?.ok),
  };
}

function policyExistsCheck(tableName: string, policyName: string): SchemaFingerprintCheck {
  return {
    description: `policy public.${tableName}.${policyName} exists`,
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND p.polname = $2
      ) AS ok
    `,
    params: [tableName, policyName],
    validate: (rows) => Boolean(rows[0]?.ok),
  };
}

function indexExistsCheck(tableName: string, indexName: string): SchemaFingerprintCheck {
  return {
    description: `index public.${indexName} exists on public.${tableName}`,
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = $1
          AND indexname = $2
      ) AS ok
    `,
    params: [tableName, indexName],
    validate: (rows) => Boolean(rows[0]?.ok),
  };
}

function constraintContainsCheck(tableName: string, constraintName: string, requiredFragments: string[]): SchemaFingerprintCheck {
  return {
    description: `constraint public.${tableName}.${constraintName} contains ${requiredFragments.join(", ")}`,
    sql: `
      SELECT COALESCE(pg_get_constraintdef(c.oid), '') AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND c.conname = $2
      LIMIT 1
    `,
    params: [tableName, constraintName],
    validate: (rows) => {
      const definition = String(rows[0]?.definition ?? "");
      return requiredFragments.every((fragment) => definition.includes(fragment));
    },
  };
}
