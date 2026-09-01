import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import type { StaffPrincipal } from "../auth/staffPrincipal";
import {
  handleVerifierRouteWithDependencies,
  type VerifierRouteDependencies,
} from "../routes/verifier";
import {
  createGuideVerifierRepository,
  type GuideVerifierRepository,
} from "./repository";
import * as schema from "./schema";

const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_APPLICATION_ID = "223e4567-e89b-42d3-a456-426614174001";

function databaseUrl() {
  return process.env.MIGRATION_RUNNER_TEST_DATABASE_URL;
}

function assertDisposableDatabase(url: string) {
  const parsed = new URL(url.replace(/^postgres:\/\//, "postgresql://"));
  assert.match(
    parsed.pathname,
    /(test|tmp|scratch|disposable|codex)/i,
    "Stage 6 verifier integration tests require a disposable database name.",
  );
}

function principal(id: number): StaffPrincipal {
  return {
    id: String(id),
    email: `staff-${id}@example.com`,
    role: "admin_support",
    permissions: ["verifier_admin"],
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://worker.example${path}`, init);
}

function jsonRequest(path: string, method: string, body: unknown) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeDeps(repository: GuideVerifierRepository): VerifierRouteDependencies {
  return {
    env: {},
    localGuideFetch: async () => {
      throw new Error("not used");
    },
    withRepository: async (operation) => operation(repository),
  };
}

async function resetSchema(client: Client, schemaName: string) {
  await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);
  await client.query(`
    CREATE TYPE application_status_type AS ENUM (
      'drafted',
      'pending',
      'needs_more_info',
      'approved',
      'rejected'
    )
  `);
  await client.query(`
    CREATE TYPE admin_action_type AS ENUM (
      'review',
      'approve',
      'reject',
      'require_more_info'
    )
  `);
  await client.query(`
    CREATE TABLE guide_applications (
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
    )
  `);
  await client.query(`
    CREATE TABLE destinations (
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
    )
  `);
  await client.query(`
    CREATE TABLE guide_application_service_areas (
      application_id uuid NOT NULL,
      destination_id integer NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE guide_service_area_proposals (
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
    )
  `);
  await client.query(`
    CREATE TABLE guide_application_approvals (
      id serial PRIMARY KEY,
      application_id uuid NOT NULL,
      user_id integer NOT NULL,
      admin_id integer,
      admin_action admin_action_type,
      note text,
      user_response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function seedVerifierData(client: Client) {
  await client.query(
    `
      INSERT INTO guide_applications (
        id,
        user_id,
        name,
        application_status,
        flagged_for_review,
        created_at,
        updated_at
      )
      VALUES
        ($1, 101, 'Primary Applicant', 'pending', false, now(), now()),
        ($2, 102, 'Expired Lock Applicant', 'pending', false, now(), now())
    `,
    [APPLICATION_ID, SECOND_APPLICATION_ID],
  );
  const destination = await client.query<{ id: number }>(
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
  await client.query(
    `
      INSERT INTO guide_application_service_areas (
        application_id,
        destination_id,
        created_at
      )
      VALUES ($1, $2, now())
    `,
    [APPLICATION_ID, destination.rows[0].id],
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
      VALUES ($1, 'Kamakura', 'kamakura', 'JP', 'pending', now())
    `,
    [APPLICATION_ID],
  );
}

test("V2 verifier disposable PostgreSQL path preserves lock conflict, review update, release, and expiry behavior", async (t) => {
  const url = databaseUrl();
  if (!url) {
    t.skip("MIGRATION_RUNNER_TEST_DATABASE_URL is not configured");
    return;
  }

  assertDisposableDatabase(url);

  const client = new Client({ connectionString: url });
  const schemaName = `stage6_verifier_${process.pid}_${Date.now()}`;
  await client.connect();

  try {
    await resetSchema(client, schemaName);
    await seedVerifierData(client);

    const db = drizzle(client, { schema });
    const repository = createGuideVerifierRepository(db);
    const deps = routeDeps(repository);

    const acquired = await handleVerifierRouteWithDependencies(
      request(
        `/api/v2/verifier/applications/${APPLICATION_ID}/acquire-lock`,
        { method: "POST" },
      ),
      principal(42),
      deps,
    );
    assert.equal(acquired.status, 200);
    const acquiredBody = (await acquired.json()) as { lockedBy: number };
    assert.equal(acquiredBody.lockedBy, 42);

    const reviewMarkers = await client.query<{ value: string }>(
      `
        SELECT count(*)::text AS value
        FROM guide_application_approvals
        WHERE application_id = $1
          AND admin_id = 42
          AND admin_action = 'review'
      `,
      [APPLICATION_ID],
    );
    assert.equal(reviewMarkers.rows[0].value, "1");

    const conflictAcquire = await handleVerifierRouteWithDependencies(
      request(
        `/api/v2/verifier/applications/${APPLICATION_ID}/acquire-lock`,
        { method: "POST" },
      ),
      principal(77),
      deps,
    );
    assert.equal(conflictAcquire.status, 423);

    const conflictDetail = await handleVerifierRouteWithDependencies(
      request(`/api/v2/verifier/applications/${APPLICATION_ID}`),
      principal(77),
      deps,
    );
    assert.equal(conflictDetail.status, 423);

    const readonlyDetail = await handleVerifierRouteWithDependencies(
      request(`/api/v2/verifier/applications/${APPLICATION_ID}?readonly=true`),
      principal(77),
      deps,
    );
    assert.equal(readonlyDetail.status, 200);
    const detailBody = (await readonlyDetail.json()) as {
      serviceAreas: unknown[];
      serviceAreaProposals: unknown[];
    };
    assert.equal(detailBody.serviceAreas.length, 1);
    assert.equal(detailBody.serviceAreaProposals.length, 1);

    const validReviewUpdate = await handleVerifierRouteWithDependencies(
      jsonRequest(
        `/api/v2/verifier/applications/${APPLICATION_ID}/review`,
        "PATCH",
        { flaggedForReview: true, internalTags: ["pdf:https://example.com/evidence.pdf"] },
      ),
      principal(42),
      deps,
    );
    assert.equal(validReviewUpdate.status, 200);
    const validReviewBody = (await validReviewUpdate.json()) as {
      flaggedForReview: boolean;
      internalTags: string[];
    };
    assert.equal(validReviewBody.flaggedForReview, true);
    assert.deepEqual(validReviewBody.internalTags, [
      "pdf:https://example.com/evidence.pdf",
    ]);

    const staleReviewUpdate = await handleVerifierRouteWithDependencies(
      jsonRequest(
        `/api/v2/verifier/applications/${APPLICATION_ID}/review`,
        "PATCH",
        { flaggedForReview: false },
      ),
      principal(77),
      deps,
    );
    assert.equal(staleReviewUpdate.status, 423);

    const release = await handleVerifierRouteWithDependencies(
      request(
        `/api/v2/verifier/applications/${APPLICATION_ID}/release-lock`,
        { method: "POST" },
      ),
      principal(42),
      deps,
    );
    assert.equal(release.status, 200);

    const acquiredAfterRelease = await handleVerifierRouteWithDependencies(
      request(
        `/api/v2/verifier/applications/${APPLICATION_ID}/acquire-lock`,
        { method: "POST" },
      ),
      principal(77),
      deps,
    );
    assert.equal(acquiredAfterRelease.status, 200);
    assert.equal(
      ((await acquiredAfterRelease.json()) as { lockedBy: number }).lockedBy,
      77,
    );

    await client.query(
      `
        UPDATE guide_applications
        SET locked_by = 88,
            locked_at = now() - interval '2 days',
            lock_expiry = now() - interval '1 day'
        WHERE id = $1
      `,
      [SECOND_APPLICATION_ID],
    );

    const acquiredExpired = await handleVerifierRouteWithDependencies(
      request(
        `/api/v2/verifier/applications/${SECOND_APPLICATION_ID}/acquire-lock`,
        { method: "POST" },
      ),
      principal(77),
      deps,
    );
    assert.equal(acquiredExpired.status, 200);
    assert.equal(
      ((await acquiredExpired.json()) as { lockedBy: number }).lockedBy,
      77,
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.end();
  }
});
