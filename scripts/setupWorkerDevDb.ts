import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPostgresPool } from "../server/db-client";
import { loadMigrationFiles, runMigrations } from "./migrationRunner";

const { Client } = pg;

const containerName = "authflowmanager-v2-dev-pg";
const imageName = "postgres:17";
const host = "127.0.0.1";
const port = 55434;
const user = "postgres";
const password = "authflowdev";
const authflowDatabase = "authflowmanager_v2_authflow_dev";
const mainDatabase = "authflowmanager_v2_main_dev";
const localStaffEmail = "local-owner@authflowmanager.test";
const localStaffName = "Local V2 Owner";
const localLegalEntityName = "Yaotu Technologies, LLC";
const localVendorName = "Cloudflare";
const localRecurringExpenseName = "ahhh-yaotu.com domain renewal";
const localGuideApplicationId = "11111111-1111-4111-8111-111111111111";
const localGuideApplicationName = "Local Guide Applicant";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");
const authflowDatabaseUrl = `postgresql://${user}:${password}@${host}:${port}/${authflowDatabase}?sslmode=disable`;
const mainDatabaseUrl = `postgresql://${user}:${password}@${host}:${port}/${mainDatabase}?sslmode=disable`;
const adminDatabaseUrl = `postgresql://${user}:${password}@${host}:${port}/postgres?sslmode=disable`;

function runDocker(args: string[]) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function dockerStatus() {
  return runDocker([
    "ps",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Status}}",
  ]);
}

function ensureDockerAvailable() {
  try {
    runDocker(["info"]);
  } catch {
    throw new Error("Docker is not available. Start Docker Desktop, then rerun npm run worker:dev:db.");
  }
}

function ensureContainer() {
  const status = dockerStatus();
  if (!status) {
    runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${authflowDatabase}`,
      "-p",
      `${host}:${port}:5432`,
      imageName,
    ]);
    return;
  }

  if (!status.startsWith("Up ")) {
    runDocker(["start", containerName]);
  }
}

function clientFor(connectionString: string) {
  return new Client({
    connectionString: connectionString.replace("postgresql://", "postgres://"),
    ssl: false,
  });
}

function quoteIdent(identifier: string) {
  if (!/^[a-z0-9_]+$/i.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

async function waitForPostgres() {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = clientFor(adminDatabaseUrl);
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // Ignore cleanup failures while the container is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(`Postgres did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function ensureDatabase(databaseName: string) {
  const client = clientFor(adminDatabaseUrl);
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
    }
  } finally {
    await client.end();
  }
}

async function initializeAuthflowBaseline() {
  const client = clientFor(authflowDatabaseUrl);
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        CREATE ROLE anon;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      DO $$
      BEGIN
        CREATE ROLE authenticated;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      DO $$
      BEGIN
        CREATE ROLE service_role;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      DO $$
      BEGIN
        CREATE TYPE admin_role AS ENUM (
          'super_admin',
          'admin_finance',
          'admin_verifier',
          'admin_support',
          'trainee_access'
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'trainee_access';

      DO $$
      BEGIN
        CREATE TYPE admin_status AS ENUM (
          'pending',
          'active',
          'inactive',
          'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      CREATE TABLE IF NOT EXISTS admin_users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email varchar(255) UNIQUE NOT NULL,
        password_hash text NOT NULL,
        role admin_role NOT NULL,
        status admin_status NOT NULL DEFAULT 'pending',
        created_by integer,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        last_login_at timestamp,
        permissions text[]
      );

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

      INSERT INTO "schema_migrations" (
        "filename",
        "checksum_sha256",
        "execution_ms",
        "application_mode"
      )
      VALUES (
        'db_dump.sql',
        '0000000000000000000000000000000000000000000000000000000000000000',
        NULL,
        'baseline'
      )
      ON CONFLICT ("filename") DO NOTHING;
    `);
  } finally {
    await client.end();
  }
}

async function runAuthflowMigrations() {
  const migrations = await loadMigrationFiles(migrationsDir);
  const pool = createPostgresPool(authflowDatabaseUrl, {
    sslEnvNames: ["DB_SSL"],
  });

  try {
    const result = await runMigrations(pool, migrations);
    console.log(`Local AuthFlow migrations applied: ${result.applied.length}`);
    if (result.applied.length > 0) {
      console.log(`Latest local migration: ${result.latestMigration ?? "none"}`);
    }
  } finally {
    await pool.end();
  }
}

async function seedAuthflowDevData() {
  const client = clientFor(authflowDatabaseUrl);
  await client.connect();
  try {
    await client.query("BEGIN");

    const staff = await client.query<{ id: number }>(
      `
        INSERT INTO admin_users (
          name,
          email,
          password_hash,
          role,
          account_type,
          status
        )
        VALUES ($1, $2, NULL, 'super_admin', 'admin_staff', 'active')
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          password_hash = NULL,
          role = 'super_admin',
          account_type = 'admin_staff',
          status = 'active',
          updated_at = now()
        RETURNING id
      `,
      [localStaffName, localStaffEmail],
    );
    const staffId = staff.rows[0].id;

    for (const accessGroup of [
      "super_admin",
      "admin_operations",
      "finance_admin",
      "payroll_admin",
      "tax_admin",
      "verifier_admin",
    ]) {
      await client.query(
        `
          INSERT INTO admin_user_access_grants (
            admin_user_id,
            access_group,
            source,
            metadata,
            granted_by
          )
          SELECT $1, $2, 'v2_local_dev_seed', '{"localDev":true}'::jsonb, $1
          WHERE NOT EXISTS (
            SELECT 1
            FROM admin_user_access_grants
            WHERE admin_user_id = $1
              AND access_group = $2
              AND revoked_at IS NULL
          )
        `,
        [staffId, accessGroup],
      );
    }

    const entity = await client.query<{ id: number }>(
      `
        SELECT id
        FROM legal_entities
        WHERE lower(trim(legal_name)) = lower(trim($1))
        LIMIT 1
      `,
      [localLegalEntityName],
    );
    let legalEntityId = entity.rows[0]?.id;
    if (legalEntityId) {
      await client.query(
        `
          UPDATE legal_entities
          SET status = 'active',
              entity_type = 'llc',
              updated_at = now()
          WHERE id = $1
        `,
        [legalEntityId],
      );
    } else {
      const inserted = await client.query<{ id: number }>(
        `
          INSERT INTO legal_entities (
            legal_name,
            entity_type,
            status,
            created_by
          )
          VALUES ($1, 'llc', 'active', $2)
          RETURNING id
        `,
        [localLegalEntityName, staffId],
      );
      legalEntityId = inserted.rows[0].id;
    }

    const vendor = await client.query<{ id: number }>(
      `
        SELECT id
        FROM vendors
        WHERE lower(trim(name)) = lower(trim($1))
          AND status <> 'archived'
        LIMIT 1
      `,
      [localVendorName],
    );
    let vendorId = vendor.rows[0]?.id;
    if (vendorId) {
      await client.query(
        `
          UPDATE vendors
          SET vendor_type = 'cloud',
              status = 'active',
              website = 'https://www.cloudflare.com',
              notes = 'Local dev sample vendor.',
              updated_at = now()
          WHERE id = $1
        `,
        [vendorId],
      );
    } else {
      const inserted = await client.query<{ id: number }>(
        `
          INSERT INTO vendors (
            name,
            vendor_type,
            status,
            website,
            notes,
            created_by
          )
          VALUES ($1, 'cloud', 'active', 'https://www.cloudflare.com', 'Local dev sample vendor.', $2)
          RETURNING id
        `,
        [localVendorName, staffId],
      );
      vendorId = inserted.rows[0].id;
    }

    const recurring = await client.query<{ id: number }>(
      `
        SELECT id
        FROM recurring_expenses
        WHERE legal_entity_id = $1
          AND vendor_id = $2
          AND lower(trim(name)) = lower(trim($3))
        LIMIT 1
      `,
      [legalEntityId, vendorId, localRecurringExpenseName],
    );

    if (recurring.rows[0]?.id) {
      await client.query(
        `
          UPDATE recurring_expenses
          SET category_code = 'domain_infrastructure',
              cadence = 'annual',
              expected_amount_cents = 1046,
              currency = 'USD',
              variable_amount = true,
              next_billing_date = '2027-08-29',
              renewal_date = '2027-09-28',
              auto_renew = true,
              status = 'active',
              notes = 'Local dev recurring expense fixture.',
              updated_at = now()
          WHERE id = $1
        `,
        [recurring.rows[0].id],
      );
    } else {
      await client.query(
        `
          INSERT INTO recurring_expenses (
            legal_entity_id,
            vendor_id,
            name,
            category_code,
            cadence,
            expected_amount_cents,
            currency,
            variable_amount,
            next_billing_date,
            renewal_date,
            auto_renew,
            status,
            notes,
            created_by
          )
          VALUES (
            $1,
            $2,
            $3,
            'domain_infrastructure',
            'annual',
            1046,
            'USD',
            true,
            '2027-08-29',
            '2027-09-28',
            true,
            'active',
            'Local dev recurring expense fixture.',
            $4
          )
        `,
        [legalEntityId, vendorId, localRecurringExpenseName, staffId],
      );
    }

    await client.query("COMMIT");
    return { staffId, legalEntityId, vendorId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function initializeMainDevDatabase() {
  const client = clientFor(mainDatabaseUrl);
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        CREATE TYPE application_status_type AS ENUM (
          'drafted',
          'pending',
          'needs_more_info',
          'approved',
          'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      DO $$
      BEGIN
        CREATE TYPE admin_action_type AS ENUM (
          'review',
          'approve',
          'reject',
          'require_more_info'
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END
      $$;

      CREATE TABLE IF NOT EXISTS guide_applications (
        id uuid PRIMARY KEY,
        user_id integer NOT NULL,
        name varchar(100) NOT NULL,
        application_status application_status_type NOT NULL DEFAULT 'drafted',
        internal_tags text[],
        qualifications jsonb,
        flagged_for_review boolean DEFAULT false,
        locked_by integer,
        locked_at timestamptz,
        lock_expiry timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS destinations (
        id serial PRIMARY KEY,
        country_code varchar(2) NOT NULL,
        slug varchar(80) NOT NULL,
        name_en text NOT NULL,
        name_ja text,
        name_zh_cn text,
        timezone text NOT NULL,
        prefecture_code varchar(16),
        prefecture_name text,
        place_type text NOT NULL,
        status text NOT NULL,
        sort_order integer NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guide_application_service_areas (
        application_id uuid NOT NULL,
        destination_id integer NOT NULL,
        created_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guide_service_area_proposals (
        id serial PRIMARY KEY,
        application_id uuid,
        guide_id integer,
        raw_name text NOT NULL,
        normalized_name text NOT NULL,
        country_code varchar(2) NOT NULL,
        status text NOT NULL,
        resolved_destination_id integer,
        created_at timestamptz NOT NULL,
        resolved_at timestamptz,
        resolved_by integer
      );

      CREATE TABLE IF NOT EXISTS guide_application_approvals (
        id serial PRIMARY KEY,
        application_id uuid NOT NULL,
        user_id integer NOT NULL,
        admin_id integer,
        admin_action admin_action_type,
        note text,
        user_response jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  } finally {
    await client.end();
  }
}

async function seedMainDevData() {
  const client = clientFor(mainDatabaseUrl);
  await client.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO guide_applications (
          id,
          user_id,
          name,
          application_status,
          internal_tags,
          qualifications,
          flagged_for_review,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          101,
          $2,
          'pending',
          ARRAY['local-dev'],
          '{"certifications":{}}'::jsonb,
          false,
          now(),
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          application_status = 'pending',
          updated_at = now()
      `,
      [localGuideApplicationId, localGuideApplicationName],
    );

    const destination = await client.query<{ id: number }>(
      `
        SELECT id
        FROM destinations
        WHERE slug = 'tokyo'
          AND country_code = 'JP'
        LIMIT 1
      `,
    );
    let destinationId = destination.rows[0]?.id;
    if (destinationId) {
      await client.query(
        `
          UPDATE destinations
          SET name_en = 'Tokyo',
              timezone = 'Asia/Tokyo',
              place_type = 'city',
              status = 'active',
              sort_order = 1,
              updated_at = now()
          WHERE id = $1
        `,
        [destinationId],
      );
    } else {
      const inserted = await client.query<{ id: number }>(
        `
          INSERT INTO destinations (
            country_code,
            slug,
            name_en,
            timezone,
            place_type,
            status,
            sort_order,
            created_at,
            updated_at
          )
          VALUES ('JP', 'tokyo', 'Tokyo', 'Asia/Tokyo', 'city', 'active', 1, now(), now())
          RETURNING id
        `,
      );
      destinationId = inserted.rows[0].id;
    }

    await client.query(
      `
        INSERT INTO guide_application_service_areas (
          application_id,
          destination_id,
          created_at
        )
        SELECT $1, $2, now()
        WHERE NOT EXISTS (
          SELECT 1
          FROM guide_application_service_areas
          WHERE application_id = $1
            AND destination_id = $2
        )
      `,
      [localGuideApplicationId, destinationId],
    );

    await client.query(
      `
        INSERT INTO guide_service_area_proposals (
          application_id,
          raw_name,
          normalized_name,
          country_code,
          status,
          created_at
        )
        SELECT $1, 'Kamakura', 'kamakura', 'JP', 'pending', now()
        WHERE NOT EXISTS (
          SELECT 1
          FROM guide_service_area_proposals
          WHERE application_id = $1
            AND normalized_name = 'kamakura'
            AND status = 'pending'
        )
      `,
      [localGuideApplicationId],
    );

    await client.query("COMMIT");
    return { guideApplicationId: localGuideApplicationId, destinationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  ensureDockerAvailable();
  ensureContainer();
  await waitForPostgres();
  await ensureDatabase(authflowDatabase);
  await ensureDatabase(mainDatabase);
  await initializeAuthflowBaseline();
  await runAuthflowMigrations();
  const seed = await seedAuthflowDevData();
  await initializeMainDevDatabase();
  const mainSeed = await seedMainDevData();

  console.log("");
  console.log("Local V2 dev database is ready.");
  console.log(`Container: ${containerName}`);
  console.log(`AuthFlow DB: ${authflowDatabase}`);
  console.log(`Main DB: ${mainDatabase}`);
  console.log(`Local staff: ${localStaffEmail} (#${seed.staffId})`);
  console.log(`Legal entity: ${localLegalEntityName} (#${seed.legalEntityId})`);
  console.log(`Vendor: ${localVendorName} (#${seed.vendorId})`);
  console.log(`Guide application: ${mainSeed.guideApplicationId}`);
  console.log(`Destination: Tokyo (#${mainSeed.destinationId})`);
  console.log("");
  console.log("Next: npm run worker:dev");
  console.log("Open: http://127.0.0.1:8787/v2/finance");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
