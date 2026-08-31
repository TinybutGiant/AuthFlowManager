import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import { normalizeAccessEmail, type WorkerV2ExecutionContext } from "./access";
import {
  authorizeStaffPermission,
  hasStaffPermission,
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "./authorize";
import type {
  StaffAccessGrantRecord,
  StaffPrincipalRepository,
  StaffUserRecord,
} from "./staffPrincipal";
import { handleV2Request } from "../app";
import type { WorkerV2Env } from "../db/types";

const TEST_ISSUER = "https://authflowmanager.cloudflareaccess.com";
const TEST_AUDIENCE = "authflowmanager-v2-aud";
const TEST_ENV: WorkerV2Env = {
  ACCESS_TEAM_DOMAIN: TEST_ISSUER,
  ACCESS_AUD: TEST_AUDIENCE,
};

class MemoryStaffRepository implements StaffPrincipalRepository {
  readonly staffByEmail = new Map<string, StaffUserRecord>();
  readonly grantsByAdminUserId = new Map<number, StaffAccessGrantRecord[]>();
  findCalls = 0;
  grantCalls = 0;
  lastLookupEmail: string | undefined;

  async findStaffByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<StaffUserRecord | undefined> {
    this.findCalls += 1;
    this.lastLookupEmail = normalizedEmail;
    return this.staffByEmail.get(normalizedEmail);
  }

  async loadAccessGrants(
    adminUserId: number,
  ): Promise<StaffAccessGrantRecord[]> {
    this.grantCalls += 1;
    return this.grantsByAdminUserId.get(adminUserId) ?? [];
  }
}

function accessCtx(email: string | undefined): WorkerV2ExecutionContext {
  return {
    access: {
      aud: "test-aud",
      getIdentity: async () => (email === undefined ? undefined : { email }),
    },
  };
}

function authRequest(token?: string): Request {
  const headers = new Headers();
  if (token) {
    headers.set("Cf-Access-Jwt-Assertion", token);
  }

  return new Request("https://authflowmanager.example/api/v2/auth/me", {
    headers,
  });
}

function staffRecord(
  overrides: Partial<StaffUserRecord> = {},
): StaffUserRecord {
  return {
    id: 7,
    email: "admin@example.com",
    role: "admin_finance",
    status: "active",
    ...overrides,
  };
}

async function createJwtFixture(options: {
  email?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  verifierKeyPair?: JwtKeyPair;
  signingKeyPair?: JwtKeyPair;
} = {}) {
  const verifierKeyPair = options.verifierKeyPair ?? (await createJwtKeyPair());
  const signingKeyPair = options.signingKeyPair ?? verifierKeyPair;
  const now = Math.floor(Date.now() / 1000);
  const payload =
    options.email === undefined ? {} : { email: options.email };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: signingKeyPair.kid })
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? TEST_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 300)
    .sign(signingKeyPair.privateKey);

  return { token, jwks: verifierKeyPair.jwks };
}

type JwtKeyPair = {
  kid: string;
  privateKey: CryptoKey;
  jwks: JWTVerifyGetKey;
};

let jwtKeyCounter = 0;

async function createJwtKeyPair(): Promise<JwtKeyPair> {
  jwtKeyCounter += 1;
  const kid = `test-key-${jwtKeyCounter}`;
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const jwks: JSONWebKeySet = { keys: [publicJwk] };

  return {
    kid,
    privateKey,
    jwks: createLocalJWKSet(jwks),
  };
}

test("denies requests without Cloudflare Access before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    TEST_ENV,
    {},
    repository,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(publicStaffAuthFailure(result).code, "ACCESS_REQUIRED");
  assert.equal(repository.findCalls, 0);
  assert.equal(repository.grantCalls, 0);
});

test("auth me route denies requests without Cloudflare Access", async () => {
  const response = await handleV2Request(
    new Request("https://authflowmanager.example/api/v2/auth/me"),
  );
  const body = (await response.json()) as { code: string; status: string };

  assert.equal(response.status, 401);
  assert.deepEqual(body, { status: "error", code: "ACCESS_REQUIRED" });
});

test("denies missing Access identity without database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    {},
    accessCtx(undefined),
    repository,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(publicStaffAuthFailure(result).code, "STAFF_ACCESS_DENIED");
  assert.equal(repository.findCalls, 0);
  assert.equal(repository.grantCalls, 0);
});

test("denies unknown staff and does not auto-provision", async () => {
  const repository = new MemoryStaffRepository();
  const { token, jwks } = await createJwtFixture({
    email: "staff-test@example.invalid",
  });
  const beforeStaffCount = repository.staffByEmail.size;
  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(publicStaffAuthFailure(result).code, "STAFF_ACCESS_DENIED");
  assert.equal(repository.findCalls, 1);
  assert.equal(repository.grantCalls, 0);
  assert.equal(repository.staffByEmail.size, beforeStaffCount);
});

test("normalizes Cloudflare Access email before staff lookup", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord());

  assert.equal(
    normalizeAccessEmail("  ADMIN@Example.COM  "),
    "admin@example.com",
  );
  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    {},
    accessCtx("  ADMIN@Example.COM  "),
    repository,
  );

  assert.equal(result.ok, true);
  assert.equal(repository.lastLookupEmail, "admin@example.com");
});

test("prefers ctx.access identity when JWT fallback header is also present", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord());

  const result = await resolveStaffPrincipalWithRepository(
    authRequest("not-a-jwt"),
    {},
    accessCtx("admin@example.com"),
    repository,
  );

  assert.equal(result.ok, true);
  assert.equal(repository.lastLookupEmail, "admin@example.com");
});

test("resolves active staff through Access identity and grants", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord({ id: 42 }));
  repository.grantsByAdminUserId.set(42, [
    { accessGroup: "finance_admin", revokedAt: null },
    { accessGroup: "verifier_admin", revokedAt: null },
  ]);

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    {},
    accessCtx("admin@example.com"),
    repository,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.principal, {
    id: "42",
    email: "admin@example.com",
    role: "admin_finance",
    permissions: ["finance_admin", "verifier_admin"],
  });
  assert.equal("passwordHash" in result.principal, false);
});

test("excludes revoked grants from StaffPrincipal permissions", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord({ id: 9 }));
  repository.grantsByAdminUserId.set(9, [
    { accessGroup: "finance_admin", revokedAt: null },
    { accessGroup: "super_admin", revokedAt: new Date("2026-01-01T00:00:00Z") },
  ]);

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    {},
    accessCtx("admin@example.com"),
    repository,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.principal.permissions, ["finance_admin"]);
});

test("denies inactive staff before loading grants", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set(
    "admin@example.com",
    staffRecord({ status: "inactive" }),
  );

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(),
    {},
    accessCtx("admin@example.com"),
    repository,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(publicStaffAuthFailure(result).code, "STAFF_ACCESS_DENIED");
  assert.equal(repository.grantCalls, 0);
});

test("checks authorization from grant permissions, not admin role", () => {
  const principal = {
    id: "1",
    email: "admin@example.com",
    role: "super_admin" as const,
    permissions: ["finance_admin" as const],
  };

  assert.equal(hasStaffPermission(principal, "finance_admin"), true);
  assert.equal(hasStaffPermission(principal, "verifier_admin"), false);
  assert.deepEqual(authorizeStaffPermission(principal, "verifier_admin"), {
    ok: false,
    status: 403,
    code: "STAFF_ACCESS_DENIED",
    internalReason: "STAFF_PERMISSION_MISSING",
  });
});

test("resolves valid Access JWT when ctx.access is absent", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord({ id: 31 }));
  repository.grantsByAdminUserId.set(31, [
    { accessGroup: "verifier_admin", revokedAt: null },
  ]);
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.principal.permissions, ["verifier_admin"]);
});

test("denies malformed Access JWT before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const { jwks } = await createJwtFixture();

  const result = await resolveStaffPrincipalWithRepository(
    authRequest("not-a-jwt"),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});

test("denies signed Access JWT with wrong issuer before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
    issuer: "https://other.cloudflareaccess.com",
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});

test("denies signed Access JWT with wrong audience before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
    audience: "wrong-audience",
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});

test("denies expired Access JWT before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});

test("denies JWT email signed by an untrusted key before database lookup", async () => {
  const repository = new MemoryStaffRepository();
  repository.staffByEmail.set("admin@example.com", staffRecord());
  const trusted = await createJwtKeyPair();
  const untrusted = await createJwtKeyPair();
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
    verifierKeyPair: trusted,
    signingKeyPair: untrusted,
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    TEST_ENV,
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});

test("denies Access JWT when verification configuration is missing", async () => {
  const repository = new MemoryStaffRepository();
  const { token, jwks } = await createJwtFixture({
    email: "admin@example.com",
  });

  const result = await resolveStaffPrincipalWithRepository(
    authRequest(token),
    {},
    {},
    repository,
    { jwks },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(repository.findCalls, 0);
});
