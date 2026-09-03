import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type WranglerConfig = {
  vars?: Record<string, string>;
  env?: Record<string, {
    vars?: Record<string, string>;
    hyperdrive?: Array<{
      binding: string;
      id: string;
      localConnectionString?: string;
    }>;
  }>;
};

async function readWranglerConfig(): Promise<WranglerConfig> {
  const text = await readFile(
    new URL("../../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  return JSON.parse(text) as WranglerConfig;
}

test("V2 local dev auth bypass is confined to the Wrangler local environment", async () => {
  const config = await readWranglerConfig();

  assert.equal(config.vars?.V2_LOCAL_DEV_AUTH, undefined);
  assert.equal(config.vars?.V2_LOCAL_DEV_STAFF_EMAIL, undefined);

  assert.equal(config.env?.local?.vars?.V2_LOCAL_DEV_AUTH, "true");
  assert.equal(
    config.env?.local?.vars?.V2_LOCAL_DEV_STAFF_EMAIL,
    "local-owner@authflowmanager.test",
  );
});

test("V2 local dev Hyperdrive bindings use fixed localhost dev databases", async () => {
  const config = await readWranglerConfig();
  const localHyperdrive = config.env?.local?.hyperdrive ?? [];
  const byBinding = new Map(localHyperdrive.map((binding) => [binding.binding, binding]));

  assert.equal(
    byBinding.get("AUTHFLOW_DB")?.localConnectionString,
    "postgresql://postgres:authflowdev@127.0.0.1:55434/authflowmanager_v2_authflow_dev?sslmode=disable",
  );
  assert.equal(
    byBinding.get("MAIN_DB")?.localConnectionString,
    "postgresql://postgres:authflowdev@127.0.0.1:55434/authflowmanager_v2_main_dev?sslmode=disable",
  );

  for (const binding of localHyperdrive) {
    assert.match(binding.localConnectionString ?? "", /^postgresql:\/\/postgres:authflowdev@127\.0\.0\.1:55434\//);
    assert.doesNotMatch(binding.localConnectionString ?? "", /supabase|pooler|render|ahhh-yaotu/i);
  }
});

test("worker dev database bootstrap never reads production database env vars", async () => {
  const source = await readFile(
    new URL("../../scripts/setupWorkerDevDb.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /55434/);
  assert.match(source, /authflowmanager_v2_authflow_dev/);
  assert.match(source, /authflowmanager_v2_main_dev/);
  assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|MAIN_DATABASE_URL)\b/);
  assert.doesNotMatch(source, /\b(?:DATABASE_URL|MAIN_DATABASE_URL)\b/);
});
