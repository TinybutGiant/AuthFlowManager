import crypto from "crypto";

export const PASSWORD_SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function hashPasswordSetupToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createPasswordSetupToken(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashPasswordSetupToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_SETUP_TOKEN_TTL_MS),
  };
}

export function getAdminAppOrigin(): string {
  return (
    process.env.ADMIN_APP_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    process.env.PUBLIC_WEB_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    "http://localhost:5001"
  ).replace(/\/$/, "");
}

export function buildPasswordSetupUrl(token: string): string {
  return `${getAdminAppOrigin()}/set-password?token=${encodeURIComponent(token)}`;
}
