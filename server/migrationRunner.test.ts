import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresPool } from "./db-client";
import {
  canonicalSqlSha256,
  getMigrationStatus,
  MigrationRunnerError,
  parseMigrationFilename,
  runMigrations,
  validateMigrationFilenames,
  type MigrationDbClient,
  type MigrationFile,
  type MigrationLedgerRow,
  type MigrationPool,
} from "../scripts/migrationRunner";

function migration(filename: string, sql: string): MigrationFile {
  return {
    filename,
    version: parseMigrationFilename(filename),
    checksumSha256: canonicalSqlSha256(sql),
    sql,
  };
}

const POSTGRES_TEST_DATABASE_URL = process.env.MIGRATION_RUNNER_TEST_DATABASE_URL;

function assertDisposablePostgresTestUrl(connectionString: string) {
  let databaseName = "";
  try {
    const parsed = new URL(connectionString.replace(/^postgres:\/\//, "postgresql://"));
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("MIGRATION_RUNNER_TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!/(test|tmp|scratch|disposable|codex)/i.test(databaseName)) {
    throw new Error(
      "MIGRATION_RUNNER_TEST_DATABASE_URL must point to a disposable database whose name contains test, tmp, scratch, disposable, or codex.",
    );
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function withMigrationClient<T>(pool: MigrationPool, callback: (client: MigrationDbClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release?.();
  }
}

async function ensurePostgresRole(client: MigrationDbClient, roleName: string) {
  const existing = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [roleName],
  );
  if (existing.rows[0]?.exists) return false;

  await client.query(`CREATE ROLE ${quoteIdentifier(roleName)}`);
  return true;
}

async function readPostgresLedgerRows(pool: MigrationPool) {
  return withMigrationClient(pool, async (client) => {
    const result = await client.query<MigrationLedgerRow>(
      `
        SELECT "filename", "checksum_sha256", "applied_at", "execution_ms", "application_mode"
        FROM public."schema_migrations"
        ORDER BY "filename"
      `,
    );
    return result.rows.map((row) => ({
      ...row,
      applied_at: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
    }));
  });
}

async function readPostgresLedgerSecurity(pool: MigrationPool) {
  return withMigrationClient(pool, async (client) => {
    const result = await client.query<{ rls_enabled: boolean; force_rls: boolean }>(
      `
        SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'schema_migrations'
      `,
    );
    return result.rows[0];
  });
}

async function readPostgresLedgerPolicyCount(pool: MigrationPool) {
  return withMigrationClient(pool, async (client) => {
    const result = await client.query<{ policy_count: number }>(
      `
        SELECT count(*)::integer AS policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'schema_migrations'
      `,
    );
    return result.rows[0]?.policy_count ?? 0;
  });
}

async function readPostgresRoleTablePrivileges(pool: MigrationPool, roleName: string) {
  return withMigrationClient(pool, async (client) => {
    const result = await client.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `
        SELECT
          has_table_privilege($1, 'public.schema_migrations', 'SELECT') AS can_select,
          has_table_privilege($1, 'public.schema_migrations', 'INSERT') AS can_insert,
          has_table_privilege($1, 'public.schema_migrations', 'UPDATE') AS can_update,
          has_table_privilege($1, 'public.schema_migrations', 'DELETE') AS can_delete
      `,
      [roleName],
    );
    return result.rows[0];
  });
}

async function createEmptyPostgresMigrationLedger(client: MigrationDbClient) {
  await client.query(`
    CREATE TABLE public."schema_migrations" (
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
    )
  `);
}

async function assertRoleCannotReadPostgresLedger(pool: MigrationPool, roleName: string) {
  await withMigrationClient(pool, async (client) => {
    await client.query(`SET ROLE ${quoteIdentifier(roleName)}`);
    try {
      await assert.rejects(
        client.query(`SELECT "filename" FROM public."schema_migrations" LIMIT 1`),
        /permission denied|insufficient privilege/i,
      );
    } finally {
      await client.query("RESET ROLE");
    }
  });
}

class AsyncLock {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire() {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.locked = true;
  }

  release() {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

type FakeTransaction = {
  ledger: MigrationLedgerRow[];
  statements: string[];
};

class FakeMigrationDatabase implements MigrationPool {
  ledgerExists = true;
  ledgerRlsEnabled = false;
  revokedLedgerClientRoles: string[] = [];
  applicationTablesPresent = false;
  ledgerRows: MigrationLedgerRow[] = [];
  committedStatements: string[] = [];
  failSql = new Set<string>();
  lock = new AsyncLock();
  lockAcquireOrder: number[] = [];
  lockReleaseOrder: number[] = [];
  delaySql: ((sql: string) => Promise<void>) | null = null;
  private nextClientId = 1;

  async connect(): Promise<MigrationDbClient> {
    return new FakeMigrationClient(this, this.nextClientId++);
  }
}

class FakeMigrationClient implements MigrationDbClient {
  private transaction: FakeTransaction | null = null;

  constructor(
    private readonly db: FakeMigrationDatabase,
    private readonly clientId: number,
  ) {}

  async query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT pg_advisory_lock")) {
      await this.db.lock.acquire();
      this.db.lockAcquireOrder.push(this.clientId);
      return { rows: [] as T[], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT pg_advisory_unlock")) {
      this.db.lockReleaseOrder.push(this.clientId);
      this.db.lock.release();
      return { rows: [] as T[], rowCount: 1 };
    }

    if (normalized === "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present") {
      return { rows: [{ present: this.db.ledgerExists }] as T[], rowCount: 1 };
    }

    if (normalized.includes("FROM information_schema.tables") && normalized.includes("table_name <> 'schema_migrations'")) {
      return { rows: [{ present: this.db.applicationTablesPresent }] as T[], rowCount: 1 };
    }

    if (normalized.includes('FROM "schema_migrations"')) {
      return {
        rows: this.db.ledgerRows.map((row) => ({ ...row })) as T[],
        rowCount: this.db.ledgerRows.length,
      };
    }

    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS \"schema_migrations\"")) {
      this.db.ledgerExists = true;
      return { rows: [] as T[], rowCount: 0 };
    }

    if (
      normalized.startsWith('ALTER TABLE public."schema_migrations" ENABLE ROW LEVEL SECURITY;') &&
      normalized.includes('REVOKE ALL ON TABLE public."schema_migrations" FROM anon') &&
      normalized.includes('REVOKE ALL ON TABLE public."schema_migrations" FROM authenticated')
    ) {
      this.db.ledgerRlsEnabled = true;
      this.db.revokedLedgerClientRoles = ["anon", "authenticated"];
      return { rows: [] as T[], rowCount: 0 };
    }

    if (normalized === "BEGIN") {
      assert.equal(this.transaction, null);
      this.transaction = {
        ledger: this.db.ledgerRows.map((row) => ({ ...row })),
        statements: [],
      };
      return { rows: [] as T[], rowCount: 0 };
    }

    if (normalized === "COMMIT") {
      assert.notEqual(this.transaction, null);
      this.db.ledgerRows = this.transaction!.ledger;
      this.db.committedStatements.push(...this.transaction!.statements);
      this.transaction = null;
      return { rows: [] as T[], rowCount: 0 };
    }

    if (normalized === "ROLLBACK") {
      assert.notEqual(this.transaction, null);
      this.transaction = null;
      return { rows: [] as T[], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO \"schema_migrations\"")) {
      assert.notEqual(this.transaction, null);
      const [filename, checksumSha256, executionMs, applicationMode] = params ?? [];
      this.transaction!.ledger.push({
        filename: String(filename),
        checksum_sha256: String(checksumSha256),
        applied_at: new Date().toISOString(),
        execution_ms: executionMs === null ? null : Number(executionMs),
        application_mode: String(applicationMode),
      });
      return { rows: [] as T[], rowCount: 1 };
    }

    if (this.db.delaySql) {
      await this.db.delaySql(sql);
    }
    if (this.db.failSql.has(sql)) {
      throw new Error("synthetic migration failure");
    }
    if (this.transaction) {
      this.transaction.statements.push(sql);
    } else {
      this.db.committedStatements.push(sql);
    }
    return { rows: [] as T[], rowCount: 0 };
  }

  release() {
    return;
  }
}

test("migration canonical checksum is stable across LF and CRLF", () => {
  const lf = "SELECT 1;\nSELECT 2;\n";
  const crlf = "\ufeffSELECT 1;\r\nSELECT 2;\r\n";

  assert.equal(canonicalSqlSha256(lf), canonicalSqlSha256(crlf));
  assert.notEqual(canonicalSqlSha256(lf), canonicalSqlSha256("SELECT 1;\nSELECT  2;\n"));
});

test("migration ordering validates filenames and duplicate numeric prefixes", () => {
  assert.deepEqual(
    validateMigrationFilenames([
      "0002_second.sql",
      "0001_first.sql",
      "0010_tenth.sql",
    ]).map((item) => item.filename),
    ["0001_first.sql", "0002_second.sql", "0010_tenth.sql"],
  );

  assert.throws(() => validateMigrationFilenames(["notes.sql"]), /Invalid migration filename/);
  assert.throws(
    () => validateMigrationFilenames(["0001_first.sql", "0001_duplicate.sql"]),
    /Duplicate migration prefix/,
  );
});

test("fresh ledger runs pending migrations and records applied rows", async () => {
  const db = new FakeMigrationDatabase();
  const migrations = [
    migration("0001_first.sql", "CREATE TABLE first_table (id integer);"),
    migration("0002_second.sql", "CREATE TABLE second_table (id integer);"),
  ];

  const result = await runMigrations(db, migrations);

  assert.deepEqual(result.applied, ["0001_first.sql", "0002_second.sql"]);
  assert.deepEqual(db.committedStatements, migrations.map((item) => item.sql));
  assert.deepEqual(db.ledgerRows.map((row) => row.filename), ["0001_first.sql", "0002_second.sql"]);
  assert.deepEqual(db.ledgerRows.map((row) => row.application_mode), ["applied", "applied"]);
});

test("empty database without ledger fails closed with baseline guidance", async () => {
  const db = new FakeMigrationDatabase();
  db.ledgerExists = false;
  db.applicationTablesPresent = false;
  const migrations = [migration("0001_first.sql", "CREATE TABLE first_table (id integer);")];

  await assert.rejects(
    runMigrations(db, migrations),
    (error) => error instanceof MigrationRunnerError && error.code === "MIGRATION_BASELINE_MISSING",
  );
  assert.deepEqual(db.committedStatements, []);
  assert.deepEqual(db.ledgerRows, []);
});

test("empty ledger on nonempty application schema fails closed", async () => {
  const db = new FakeMigrationDatabase();
  db.applicationTablesPresent = true;
  const migrations = [migration("0001_first.sql", "CREATE TABLE first_table (id integer);")];

  await assert.rejects(
    runMigrations(db, migrations),
    (error) => error instanceof MigrationRunnerError && error.code === "MIGRATION_LEDGER_EMPTY_ON_NONEMPTY_DATABASE",
  );
  assert.deepEqual(db.committedStatements, []);
  assert.deepEqual(db.ledgerRows, []);
});

test("second ledger run skips already-ledgered migrations", async () => {
  const db = new FakeMigrationDatabase();
  const migrations = [migration("0001_first.sql", "CREATE TABLE first_table (id integer);")];

  await runMigrations(db, migrations);
  const second = await runMigrations(db, migrations);

  assert.deepEqual(second.skipped, ["0001_first.sql"]);
  assert.deepEqual(second.applied, []);
  assert.equal(db.committedStatements.length, 1);
});

test("existing ledger is hardened without changing ledger rows", async () => {
  const db = new FakeMigrationDatabase();
  const first = migration("0001_first.sql", "CREATE TABLE first_table (id integer);");
  db.ledgerRows.push({
    filename: first.filename,
    checksum_sha256: first.checksumSha256,
    applied_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    execution_ms: 5,
    application_mode: "applied",
  });
  const beforeRows = db.ledgerRows.map((row) => ({ ...row }));

  const result = await runMigrations(db, [first]);

  assert.deepEqual(result.skipped, ["0001_first.sql"]);
  assert.deepEqual(result.applied, []);
  assert.equal(db.ledgerRlsEnabled, true);
  assert.deepEqual(db.revokedLedgerClientRoles, ["anon", "authenticated"]);
  assert.deepEqual(db.ledgerRows, beforeRows);
  assert.deepEqual(db.committedStatements, []);
});

test("modified historical migration checksum fails closed", async () => {
  const db = new FakeMigrationDatabase();
  const original = migration("0001_first.sql", "CREATE TABLE first_table (id integer);");
  db.ledgerRows.push({
    filename: original.filename,
    checksum_sha256: original.checksumSha256,
    applied_at: new Date().toISOString(),
    execution_ms: 1,
    application_mode: "applied",
  });
  const modified = migration("0001_first.sql", "CREATE TABLE first_table (id bigint);");

  await assert.rejects(
    runMigrations(db, [modified]),
    (error) => error instanceof MigrationRunnerError && error.code === "MIGRATION_CHECKSUM_MISMATCH",
  );
  assert.deepEqual(db.committedStatements, []);
});

test("failed migration rolls back and is not ledgered", async () => {
  const db = new FakeMigrationDatabase();
  const first = migration("0001_first.sql", "CREATE TABLE first_table (id integer);");
  const failing = migration("0002_second.sql", "CREATE TABLE broken_table (id integer);");
  db.failSql.add(failing.sql);

  await assert.rejects(
    runMigrations(db, [first, failing]),
    (error) => error instanceof MigrationRunnerError && error.code === "MIGRATION_FAILED",
  );

  assert.deepEqual(db.committedStatements, [first.sql]);
  assert.deepEqual(db.ledgerRows.map((row) => row.filename), ["0001_first.sql"]);
});

test("retry after failure skips completed migrations and resumes pending migration", async () => {
  const db = new FakeMigrationDatabase();
  const first = migration("0001_first.sql", "CREATE TABLE first_table (id integer);");
  const second = migration("0002_second.sql", "CREATE TABLE second_table (id integer);");
  db.failSql.add(second.sql);

  await assert.rejects(runMigrations(db, [first, second]));
  db.failSql.clear();
  const retry = await runMigrations(db, [first, second]);

  assert.deepEqual(retry.skipped, ["0001_first.sql"]);
  assert.deepEqual(retry.applied, ["0002_second.sql"]);
  assert.deepEqual(db.ledgerRows.map((row) => row.filename), ["0001_first.sql", "0002_second.sql"]);
  assert.deepEqual(db.committedStatements, [first.sql, second.sql]);
});

test("concurrent migration runners are serialized by advisory lock", async () => {
  const db = new FakeMigrationDatabase();
  const slow = migration("0001_slow.sql", "CREATE TABLE slow_table (id integer);");
  let releaseSlowMigration!: () => void;
  const slowMigrationStarted = new Promise<void>((resolve) => {
    db.delaySql = async (sql) => {
      if (sql !== slow.sql) return;
      resolve();
      await new Promise<void>((release) => {
        releaseSlowMigration = release;
      });
    };
  });

  const first = runMigrations(db, [slow]);
  await slowMigrationStarted;
  const second = runMigrations(db, [slow]);

  await Promise.resolve();
  assert.deepEqual(db.lockAcquireOrder, [1]);

  releaseSlowMigration();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult.applied, ["0001_slow.sql"]);
  assert.deepEqual(secondResult.applied, []);
  assert.deepEqual(secondResult.skipped, ["0001_slow.sql"]);
  assert.deepEqual(db.lockAcquireOrder, [1, 2]);
  assert.deepEqual(db.lockReleaseOrder, [1, 2]);
  assert.deepEqual(db.committedStatements, [slow.sql]);
});

test(
  "PostgreSQL ledger hardening preserves runner access and blocks client roles",
  {
    skip: POSTGRES_TEST_DATABASE_URL
      ? false
      : "Set MIGRATION_RUNNER_TEST_DATABASE_URL to a disposable PostgreSQL database to run.",
  },
  async () => {
    assert.ok(POSTGRES_TEST_DATABASE_URL);
    assertDisposablePostgresTestUrl(POSTGRES_TEST_DATABASE_URL);

    const pool = createPostgresPool(POSTGRES_TEST_DATABASE_URL, {
      sslEnvNames: ["MIGRATION_RUNNER_TEST_DB_SSL", "DB_SSL"],
    });
    const createdRoles: string[] = [];

    try {
      await withMigrationClient(pool, async (client) => {
        await client.query(`DROP TABLE IF EXISTS public."migration_runner_second"`);
        await client.query(`DROP TABLE IF EXISTS public."migration_runner_first"`);
        await client.query(`DROP TABLE IF EXISTS public."schema_migrations"`);
        for (const roleName of ["anon", "authenticated"]) {
          if (await ensurePostgresRole(client, roleName)) {
            createdRoles.push(roleName);
          }
        }
      });

      const first = migration(
        "0001_ledger_security_first.sql",
        `CREATE TABLE public."migration_runner_first" ("id" integer PRIMARY KEY);`,
      );
      const second = migration(
        "0002_ledger_security_second.sql",
        `CREATE TABLE public."migration_runner_second" ("id" integer PRIMARY KEY);`,
      );

      await assert.rejects(
        runMigrations(pool, [first]),
        (error) => error instanceof MigrationRunnerError && error.code === "MIGRATION_BASELINE_MISSING",
      );
      const missingLedgerStatus = await getMigrationStatus(pool, [first, second]);
      assert.equal(missingLedgerStatus.ledgerPresent, false);
      assert.deepEqual(missingLedgerStatus.pendingMigrations, [
        first.filename,
        second.filename,
      ]);

      await withMigrationClient(pool, createEmptyPostgresMigrationLedger);
      const emptyLedgerStatus = await getMigrationStatus(pool, [first, second]);
      assert.equal(emptyLedgerStatus.ledgerPresent, true);
      assert.equal(emptyLedgerStatus.ledgeredMigrationCount, 0);
      assert.deepEqual(emptyLedgerStatus.pendingMigrations, [
        first.filename,
        second.filename,
      ]);

      const firstRun = await runMigrations(pool, [first]);
      assert.deepEqual(firstRun.applied, [first.filename]);

      const rowsAfterFirstRun = await readPostgresLedgerRows(pool);
      assert.equal(rowsAfterFirstRun.length, 1);
      assert.equal(rowsAfterFirstRun[0]?.filename, first.filename);
      assert.equal(rowsAfterFirstRun[0]?.checksum_sha256, first.checksumSha256);
      assert.equal(rowsAfterFirstRun[0]?.application_mode, "applied");

      assert.deepEqual(await readPostgresLedgerSecurity(pool), {
        rls_enabled: true,
        force_rls: false,
      });
      assert.equal(await readPostgresLedgerPolicyCount(pool), 0);
      assert.deepEqual(await readPostgresRoleTablePrivileges(pool, "anon"), {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
      assert.deepEqual(await readPostgresRoleTablePrivileges(pool, "authenticated"), {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
      await assertRoleCannotReadPostgresLedger(pool, "anon");
      await assertRoleCannotReadPostgresLedger(pool, "authenticated");

      const secondRunWithSameSet = await runMigrations(pool, [first]);
      assert.deepEqual(secondRunWithSameSet.applied, []);
      assert.deepEqual(await readPostgresLedgerRows(pool), rowsAfterFirstRun);
      const statusAfterFirstRun = await getMigrationStatus(pool, [first, second]);
      assert.equal(statusAfterFirstRun.latestLedgeredMigration, first.filename);
      assert.deepEqual(statusAfterFirstRun.pendingMigrations, [second.filename]);

      const secondRunWithNewMigration = await runMigrations(pool, [first, second]);
      assert.deepEqual(secondRunWithNewMigration.applied, [second.filename]);
      const rowsAfterSecondRun = await readPostgresLedgerRows(pool);
      assert.deepEqual(rowsAfterSecondRun[0], rowsAfterFirstRun[0]);
      assert.equal(rowsAfterSecondRun[1]?.filename, second.filename);
      assert.equal(rowsAfterSecondRun[1]?.checksum_sha256, second.checksumSha256);
      assert.equal(rowsAfterSecondRun[1]?.application_mode, "applied");
      const statusAfterSecondRun = await getMigrationStatus(pool, [first, second]);
      assert.equal(statusAfterSecondRun.latestLedgeredMigration, second.filename);
      assert.deepEqual(statusAfterSecondRun.pendingMigrations, []);
    } finally {
      await withMigrationClient(pool, async (client) => {
        await client.query(`DROP TABLE IF EXISTS public."migration_runner_second"`);
        await client.query(`DROP TABLE IF EXISTS public."migration_runner_first"`);
        await client.query(`DROP TABLE IF EXISTS public."schema_migrations"`);
        for (const roleName of [...createdRoles].reverse()) {
          await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`);
        }
      }).finally(async () => {
        await pool.end?.();
      });
    }
  },
);
