import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPostgresPool } from "../../db-client";
import { comparePassword, hashPassword } from "../../passwordHash";

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

async function readPasswordlessMigration() {
  return await readFile(
    new URL("../../../migrations/0025_admin_passwordless_staff.sql", import.meta.url),
    "utf8",
  );
}

test("passwordless staff migration only drops admin password hash NOT NULL", async () => {
  const migration = await readPasswordlessMigration();

  assert.match(
    migration,
    /ALTER TABLE "admin_users"\s+ALTER COLUMN "password_hash" DROP NOT NULL;/,
  );
  assert.doesNotMatch(migration, /\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bDROP TABLE\b/i);
});

test(
  "passwordless staff migration accepts null password hash on disposable PostgreSQL",
  {
    skip: POSTGRES_TEST_DATABASE_URL
      ? false
      : "Set MIGRATION_RUNNER_TEST_DATABASE_URL to a disposable PostgreSQL database to run.",
  },
  async () => {
    assert.ok(POSTGRES_TEST_DATABASE_URL);
    assertDisposablePostgresTestUrl(POSTGRES_TEST_DATABASE_URL);
    const migration = await readPasswordlessMigration();
    const pool = createPostgresPool(POSTGRES_TEST_DATABASE_URL, {
      sslEnvNames: ["MIGRATION_RUNNER_TEST_DB_SSL", "DB_SSL"],
    });
    const client = await pool.connect();

    try {
      const existingHash = await hashPassword("existing-password");
      await client.query("BEGIN");
      await client.query(
        `CREATE TEMP TABLE "admin_users" ("id" integer PRIMARY KEY, "password_hash" text NOT NULL) ON COMMIT DROP`,
      );
      await client.query(
        `INSERT INTO "admin_users" ("id", "password_hash") VALUES (1, $1)`,
        [existingHash],
      );
      await client.query(migration);
      const existing = await client.query<{ password_hash: string }>(
        `SELECT "password_hash" FROM "admin_users" WHERE "id" = 1`,
      );
      assert.equal(existing.rows[0]?.password_hash, existingHash);
      assert.equal(
        await comparePassword("existing-password", existing.rows[0]?.password_hash),
        true,
      );

      await client.query(
        `INSERT INTO "admin_users" ("id", "password_hash") VALUES (2, NULL)`,
      );
      const passwordless = await client.query<{ password_hash: string | null }>(
        `SELECT "password_hash" FROM "admin_users" WHERE "id" = 2`,
      );
      assert.equal(passwordless.rows[0]?.password_hash, null);
      assert.equal(
        await comparePassword("anything", passwordless.rows[0]?.password_hash),
        false,
      );
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  },
);
