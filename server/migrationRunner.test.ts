import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSqlSha256,
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
