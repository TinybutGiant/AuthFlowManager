import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { importSPKI, jwtVerify } from "jose";

import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import type { StaffPrincipalRepository } from "../auth/staffPrincipal";
import type {
  GuideApplicationReviewUpdate,
  GuideVerifierRepository,
} from "../verifier/repository";
import {
  handleVerifierRouteWithDependencies,
  verifierRouteModule,
  type VerifierRouteDependencies,
} from "./verifier";

const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";

function principal(permissions: StaffPrincipal["permissions"]): StaffPrincipal {
  return {
    id: "42",
    email: "verifier@example.com",
    role: "admin_support",
    permissions,
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

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function application(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: APPLICATION_ID,
    userId: 101,
    name: "Guide Applicant",
    applicationStatus: "pending",
    internalTags: null,
    qualifications: null,
    flaggedForReview: false,
    lockedBy: null,
    lockedAt: null,
    lockExpiry: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function approval(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 1,
    applicationId: APPLICATION_ID,
    userId: 101,
    adminId: 42,
    adminAction: "review",
    note: "Started review process",
    userResponse: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createRepo(options: {
  lockedByOther?: boolean;
  updateAllowed?: boolean;
  existingReviews?: boolean;
} = {}) {
  const calls: string[] = [];
  const approvals = options.existingReviews ? [approval()] : [];
  let currentApplication = application();

  const repo: GuideVerifierRepository = {
    transaction: async (work) => work(repo),
    cleanExpiredLocks: async () => {
      calls.push("cleanExpiredLocks");
    },
    listGuideApplications: async () => {
      calls.push("listGuideApplications");
      return [currentApplication as any];
    },
    getGuideApplication: async () => {
      calls.push("getGuideApplication");
      return {
        ...(currentApplication as any),
        serviceAreas: [],
        serviceAreaDestinationIds: [],
        serviceAreaProposals: [],
        customServiceAreaProposals: [],
      };
    },
    acquireApplicationLock: async (_applicationId, adminId) => {
      calls.push("acquireApplicationLock");
      if (options.lockedByOther) return undefined;
      currentApplication = application({
        lockedBy: adminId,
        lockedAt: new Date("2026-01-01T00:00:00.000Z"),
        lockExpiry: new Date("2026-01-02T00:00:00.000Z"),
      });
      return currentApplication as any;
    },
    releaseApplicationLock: async () => {
      calls.push("releaseApplicationLock");
    },
    isApplicationLockedByOther: async () => {
      calls.push("isApplicationLockedByOther");
      return options.lockedByOther ?? false;
    },
    updateApplicationReviewState: async (
      _applicationId,
      _adminId,
      updates: GuideApplicationReviewUpdate,
    ) => {
      calls.push("updateApplicationReviewState");
      if (!options.updateAllowed) return undefined;
      currentApplication = application({
        ...currentApplication,
        ...updates,
      });
      return currentApplication as any;
    },
    listDestinations: async () => {
      calls.push("listDestinations");
      return [];
    },
    listGuideApplicationApprovals: async () => {
      calls.push("listGuideApplicationApprovals");
      return approvals as any;
    },
    createGuideApplicationApproval: async (values) => {
      calls.push("createGuideApplicationApproval");
      const row = approval(values as any);
      approvals.push(row);
      return row as any;
    },
  };

  return { repo, calls, approvals };
}

function routeDeps(
  repo: GuideVerifierRepository,
  overrides: Partial<VerifierRouteDependencies> = {},
): VerifierRouteDependencies {
  return {
    env: {},
    localGuideFetch: fetch,
    withRepository: async (operation) => operation(repo),
    ...overrides,
  };
}

function keyPair() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

async function verifyStaffAssertion(token: string, publicKey: string) {
  const key = await importSPKI(publicKey, "RS256");
  return await jwtVerify(token, key, {
    issuer: "yaotu-admin",
    audience: "yaotu-localguide",
  });
}

test("V2 verifier route manifest is narrow and excludes unrelated admin proxies", () => {
  assert.equal(verifierRouteModule.basePath, "/api/v2/verifier");
  assert.ok(
    verifierRouteModule.routes.includes(
      "POST /api/v2/verifier/approvals",
    ),
  );
  assert.ok(
    verifierRouteModule.routes.includes(
      "POST /api/v2/verifier/service-area-proposals/:proposalId/map",
    ),
  );
  assert.equal(
    verifierRouteModule.routes.some((route) =>
      /cancellation|withdrawal|finance|payroll|tax|customer/i.test(route),
    ),
    false,
  );
});

test("V2 verifier denies requests without Cloudflare Access principal before staff lookup", async () => {
  let lookupCalled = false;
  const staffRepository: StaffPrincipalRepository = {
    async findStaffByNormalizedEmail() {
      lookupCalled = true;
      return undefined;
    },
    async loadAccessGrants() {
      throw new Error("not reached");
    },
  };

  const result = await resolveStaffPrincipalWithRepository(
    request("/api/v2/verifier/applications"),
    {},
    {},
    staffRepository,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.deepEqual(publicStaffAuthFailure(result), {
    status: "error",
    code: "ACCESS_REQUIRED",
  });
  assert.equal(lookupCalled, false);
});

test("V2 verifier authorizes only effective super_admin or verifier_admin grants", async () => {
  for (const denied of [
    principal([]),
    principal(["admin_operations"]),
    principal(["finance_admin"]),
    { ...principal(["verifier_admin"]), id: "not-a-number" },
  ]) {
    const { repo } = createRepo();
    const response = await handleVerifierRouteWithDependencies(
      request("/api/v2/verifier/applications"),
      denied,
      routeDeps(repo),
    );
    assert.equal(response.status, 403);
    assert.equal((await body(response)).code, "STAFF_ACCESS_DENIED");
  }

  for (const allowed of [principal(["verifier_admin"]), principal(["super_admin"])]) {
    const { repo } = createRepo();
    const response = await handleVerifierRouteWithDependencies(
      request("/api/v2/verifier/applications"),
      allowed,
      routeDeps(repo),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{ id: string }>;
    assert.equal(payload[0].id, APPLICATION_ID);
  }
});

test("V2 verifier lock route creates one review marker and reports lock conflicts", async () => {
  const first = createRepo();
  const firstResponse = await handleVerifierRouteWithDependencies(
    request(`/api/v2/verifier/applications/${APPLICATION_ID}/acquire-lock`, {
      method: "POST",
    }),
    principal(["verifier_admin"]),
    routeDeps(first.repo),
  );

  assert.equal(firstResponse.status, 200);
  assert.deepEqual(first.calls, [
    "acquireApplicationLock",
    "listGuideApplicationApprovals",
    "createGuideApplicationApproval",
  ]);
  assert.equal(first.approvals.length, 1);

  const conflict = createRepo({ lockedByOther: true });
  const conflictResponse = await handleVerifierRouteWithDependencies(
    request(`/api/v2/verifier/applications/${APPLICATION_ID}/acquire-lock`, {
      method: "POST",
    }),
    principal(["verifier_admin"]),
    routeDeps(conflict.repo),
  );

  assert.equal(conflictResponse.status, 423);
  assert.equal((await body(conflictResponse)).code, "APPLICATION_LOCKED");
});

test("V2 verifier review updates require the current staff lock", async () => {
  const allowed = createRepo({ updateAllowed: true });
  const allowedResponse = await handleVerifierRouteWithDependencies(
    jsonRequest(
      `/api/v2/verifier/applications/${APPLICATION_ID}/review`,
      "PATCH",
      { flaggedForReview: true },
    ),
    principal(["verifier_admin"]),
    routeDeps(allowed.repo),
  );

  assert.equal(allowedResponse.status, 200);
  assert.equal(((await body(allowedResponse)) as any).flaggedForReview, true);

  const denied = createRepo({ updateAllowed: false });
  const deniedResponse = await handleVerifierRouteWithDependencies(
    jsonRequest(
      `/api/v2/verifier/applications/${APPLICATION_ID}/review`,
      "PATCH",
      { flaggedForReview: true },
    ),
    principal(["verifier_admin"]),
    routeDeps(denied.repo),
  );

  assert.equal(deniedResponse.status, 423);
  assert.equal((await body(deniedResponse)).code, "APPLICATION_LOCK_REQUIRED");
});

test("V2 approval proxy signs RS256 assertion with minimum guide approval permission only", async () => {
  const { privateKey, publicKey } = keyPair();
  const captured: Request[] = [];
  const localGuideFetch: typeof fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    captured.push(upstreamRequest);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await handleVerifierRouteWithDependencies(
    jsonRequest("/api/v2/verifier/approvals", "POST", {
      applicationId: APPLICATION_ID,
      adminAction: "approve",
      note: "approved",
    }),
    principal(["verifier_admin", "finance_admin", "admin_operations"]),
    {
      env: {
        LOCALGUIDE_API_BASE_URL: "https://localguide.example",
        STAFF_ASSERTION_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
      },
      localGuideFetch,
      withRepository: async () => {
        throw new Error("approval proxy must not use MAIN_DB");
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0].url,
    "https://localguide.example/api/v2/guide-application-approvals-v2/staff-action",
  );
  assert.equal(captured[0].method, "POST");
  assert.deepEqual(await captured[0].json(), {
    applicationId: APPLICATION_ID,
    action: "approve",
    note: "approved",
  });

  const authHeader = captured[0].headers.get("authorization");
  assert.ok(authHeader?.startsWith("Bearer "));
  const token = authHeader.slice("Bearer ".length);
  const { payload, protectedHeader } = await verifyStaffAssertion(
    token,
    publicKey,
  );

  assert.equal(protectedHeader.alg, "RS256");
  assert.equal(payload.iss, "yaotu-admin");
  assert.equal(payload.aud, "yaotu-localguide");
  assert.equal(payload.sub, "42");
  assert.equal(payload.type, "staff");
  assert.equal(payload.role, "admin_verifier");
  assert.deepEqual(payload.permissions, ["guide.approve"]);
  assert.equal(
    Number(payload.exp) - Number(payload.iat) <= 300,
    true,
  );
});

test("V2 service-area proxy maps super_admin to exact guide.review permission, never wildcard", async () => {
  const { privateKey, publicKey } = keyPair();
  const captured: Request[] = [];
  const localGuideFetch: typeof fetch = async (input, init) => {
    captured.push(new Request(input, init));
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  };

  const response = await handleVerifierRouteWithDependencies(
    jsonRequest(
      "/api/v2/verifier/service-area-proposals/12/map",
      "POST",
      { destinationId: 30 },
    ),
    principal(["super_admin", "verifier_admin"]),
    {
      env: {
        LOCALGUIDE_API_BASE_URL: "https://localguide.example",
        STAFF_ASSERTION_PRIVATE_KEY: privateKey,
      },
      localGuideFetch,
      withRepository: async () => {
        throw new Error("service-area proxy must not use MAIN_DB");
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(
    captured[0].url,
    "https://localguide.example/api/v2/guide-applications/service-area-proposals/12/map",
  );
  assert.deepEqual(await captured[0].json(), { destinationId: 30 });

  const authHeader = captured[0].headers.get("authorization");
  assert.ok(authHeader?.startsWith("Bearer "));
  const { payload } = await verifyStaffAssertion(
    authHeader.slice("Bearer ".length),
    publicKey,
  );

  assert.equal(payload.role, "super_admin");
  assert.deepEqual(payload.permissions, ["guide.review"]);
});

test("V2 verifier proxy propagates upstream auth failure and handles network failure safely", async () => {
  const { privateKey } = keyPair();
  const upstreamDenied = await handleVerifierRouteWithDependencies(
    jsonRequest(
      "/api/v2/verifier/service-area-proposals/12/reject",
      "POST",
      {},
    ),
    principal(["verifier_admin"]),
    {
      env: {
        LOCALGUIDE_API_BASE_URL: "https://localguide.example",
        STAFF_ASSERTION_PRIVATE_KEY: privateKey,
      },
      localGuideFetch: async () =>
        new Response(JSON.stringify({ error: "Insufficient permissions" }), {
          status: 403,
        }),
      withRepository: async () => {
        throw new Error("proxy must not use MAIN_DB");
      },
    },
  );

  assert.equal(upstreamDenied.status, 403);
  assert.deepEqual(await upstreamDenied.json(), {
    error: "Insufficient permissions",
  });

  const networkFailure = await handleVerifierRouteWithDependencies(
    jsonRequest("/api/v2/verifier/approvals", "POST", {
      applicationId: APPLICATION_ID,
      adminAction: "approve",
    }),
    principal(["verifier_admin"]),
    {
      env: {
        LOCALGUIDE_API_BASE_URL: "https://localguide.example",
        STAFF_ASSERTION_PRIVATE_KEY: privateKey,
      },
      localGuideFetch: async () => {
        throw new Error("offline");
      },
      withRepository: async () => {
        throw new Error("proxy must not use MAIN_DB");
      },
    },
  );

  assert.equal(networkFailure.status, 502);
  assert.equal((await body(networkFailure)).code, "LOCALGUIDE_PROXY_FAILED");
});
