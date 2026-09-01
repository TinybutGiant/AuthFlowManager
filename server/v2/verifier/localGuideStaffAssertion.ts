import { SignJWT, importPKCS8 } from "jose";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import type { WorkerV2Env } from "../db/types";

export type LocalGuideStaffRole =
  | "super_admin"
  | "admin_verifier";

export type LocalGuideStaffPermission =
  | "guide.review"
  | "guide.approve";

export type LocalGuideOperation =
  | "guideApproval"
  | "serviceAreaProposal";

export class LocalGuideProxyError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LocalGuideProxyError";
  }
}

export function localGuidePermissionForOperation(
  operation: LocalGuideOperation,
): LocalGuideStaffPermission {
  switch (operation) {
    case "guideApproval":
      return "guide.approve";
    case "serviceAreaProposal":
      return "guide.review";
  }
}

export function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new LocalGuideProxyError(
      503,
      "LOCALGUIDE_CONFIG_MISSING",
      "LocalGuide API base URL is not configured.",
    );
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("invalid protocol");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new LocalGuideProxyError(
      503,
      "LOCALGUIDE_CONFIG_INVALID",
      "LocalGuide API base URL is invalid.",
    );
  }
}

function readPrivateKey(env: WorkerV2Env): string {
  const privateKey = env.STAFF_ASSERTION_PRIVATE_KEY;
  if (!privateKey?.trim()) {
    throw new LocalGuideProxyError(
      503,
      "STAFF_ASSERTION_CONFIG_MISSING",
      "LocalGuide staff assertion private key is not configured.",
    );
  }

  const normalized = normalizePem(privateKey);
  if (!/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(normalized)) {
    throw new LocalGuideProxyError(
      503,
      "STAFF_ASSERTION_KEY_INVALID",
      "LocalGuide staff assertion private key must be a private-key PEM.",
    );
  }

  return normalized;
}

function parseExpiresInSeconds(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return 300;

  const match = /^(\d+)([sm])?$/.exec(trimmed);
  if (!match) {
    throw new LocalGuideProxyError(
      503,
      "STAFF_ASSERTION_EXPIRATION_INVALID",
      "LocalGuide staff assertion expiration is invalid.",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const seconds = unit === "m" ? amount * 60 : amount;

  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 300) {
    throw new LocalGuideProxyError(
      503,
      "STAFF_ASSERTION_EXPIRATION_INVALID",
      "LocalGuide staff assertion expiration must be between 1 and 300 seconds.",
    );
  }

  return seconds;
}

export function localGuideBaseUrl(env: WorkerV2Env): string {
  return normalizeBaseUrl(env.LOCALGUIDE_API_BASE_URL);
}

export function localGuideRoleForPrincipal(
  principal: StaffPrincipal,
): LocalGuideStaffRole {
  if (principal.permissions.includes("super_admin")) {
    return "super_admin";
  }

  return "admin_verifier";
}

export async function createLocalGuideStaffAssertion(input: {
  principal: StaffPrincipal;
  env: WorkerV2Env;
  permission: LocalGuideStaffPermission;
  now?: Date;
}): Promise<string> {
  const actorAdminId = Number(input.principal.id);
  if (!Number.isInteger(actorAdminId) || actorAdminId <= 0) {
    throw new LocalGuideProxyError(
      403,
      "STAFF_ACCESS_DENIED",
      "Current staff identity is invalid.",
    );
  }

  const issuer = input.env.STAFF_ASSERTION_ISSUER?.trim() || "yaotu-admin";
  const audience =
    input.env.STAFF_ASSERTION_AUDIENCE?.trim() || "yaotu-localguide";
  const expiresInSeconds = parseExpiresInSeconds(
    input.env.STAFF_ASSERTION_EXPIRES_IN,
  );
  const issuedAt = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const signingKey = await importPKCS8(readPrivateKey(input.env), "RS256");

  return await new SignJWT({
    type: "staff",
    role: localGuideRoleForPrincipal(input.principal),
    permissions: [input.permission],
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(String(actorAdminId))
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresInSeconds)
    .sign(signingKey);
}

export async function localGuideStaffAssertionHeaders(input: {
  principal: StaffPrincipal;
  env: WorkerV2Env;
  permission: LocalGuideStaffPermission;
  includeJsonContentType: boolean;
}): Promise<Headers> {
  const token = await createLocalGuideStaffAssertion(input);
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });

  if (input.includeJsonContentType) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}
