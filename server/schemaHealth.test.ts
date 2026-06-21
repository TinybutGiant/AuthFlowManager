import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("schema preflight checks Phase 2 admin lifecycle migration prerequisites", async () => {
  const source = await readFile(new URL("./schemaHealth.ts", import.meta.url), "utf8");

  for (const required of [
    "admin_activity_logs",
    "admin_engagement_documents",
    "admin_engagements",
    "admin_lifecycle_events",
    "must_change_password",
    "password_setup_token_hash",
    "password_setup_expires_at",
    "ended_at",
    "self_offboarding_requested",
    "early_offboarding_started",
    "engagement_cancelled",
    "activity_log_submitted",
    "file_key",
    "file_sha256",
    "file_size_bytes",
    "accepted_by",
    "offer_letter_created",
    "offer_letter_pdf_generated",
    "offer_letter_sent",
    "offer_letter_viewed",
    "offer_letter_accepted",
    "offer_letter_declined",
    "offer_letter_voided",
  ]) {
    assert.match(source, new RegExp(required));
  }

  assert.match(source, /Run `pnpm run db:migrate` and restart the server/);
});

test("server startup runs schema preflight before route registration", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /await assertAdminSchemaReady\(\)/);
  assert.ok(
    source.indexOf("await assertAdminSchemaReady()") < source.indexOf("registerRoutes(app)"),
    "schema check should run before routes are registered",
  );
});
