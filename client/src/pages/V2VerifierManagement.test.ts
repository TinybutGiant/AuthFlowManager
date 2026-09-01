import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managementSource = readFileSync(
  "client/src/pages/V2VerifierManagement.tsx",
  "utf8",
);
const detailSource = readFileSync(
  "client/src/pages/V2VerifierApplicationDetail.tsx",
  "utf8",
);
const appSource = readFileSync("client/src/App.tsx", "utf8");
const verifierSources = `${managementSource}\n${detailSource}`;

test("V2 verifier pages use only the Access-backed V2 verifier API surface", () => {
  assert.match(managementSource, /const V2_VERIFIER_BASE = "\/api\/v2\/verifier"/);
  assert.match(detailSource, /const V2_VERIFIER_BASE = "\/api\/v2\/verifier"/);
  assert.match(managementSource, /"\/api\/v2\/auth\/me"/);
  assert.match(appSource, /\/v2\/verifier/);

  for (const requiredPath of [
    "/applications",
    "/approvals",
    "/destinations?countryCode=JP",
    "/acquire-lock",
    "/release-lock",
    "/review",
    "/service-area-proposals/",
    "/map",
    "/create-destination",
    "/reject",
  ]) {
    assert.match(verifierSources, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(
    verifierSources,
    /apiRequest|tokenManager|localStorage|auth_token|useAuth/,
  );
  assert.doesNotMatch(
    verifierSources,
    /\/api\/guide-applications|\/api\/guide-approvals|\/api\/destinations\?/,
  );
  assert.doesNotMatch(
    verifierSources,
    /\/api\/localguide\/admin|cancellation|withdrawal|finance|payroll|tax/i,
  );
  assert.match(verifierSources, /credentials: "same-origin"/);
});
