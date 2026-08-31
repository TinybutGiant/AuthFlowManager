import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

export type WorkerV2AccessIdentity = {
  email?: string;
  [claim: string]: unknown;
};

export type WorkerV2AccessContext = {
  readonly aud: string;
  getIdentity(): Promise<WorkerV2AccessIdentity | undefined>;
};

export type WorkerV2ExecutionContext = {
  readonly access?: WorkerV2AccessContext;
};

export type WorkerV2AccessJwtConfig = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

export type AccessJwtResolverOptions = {
  jwks?: JWTVerifyGetKey;
};

export type AccessEmailResult =
  | { ok: true; email: string }
  | {
      ok: false;
      status: 401 | 403;
      code:
        | "ACCESS_REQUIRED"
        | "ACCESS_IDENTITY_UNAVAILABLE"
        | "ACCESS_JWT_CONFIG_MISSING"
        | "ACCESS_JWT_INVALID";
    };

type AccessJwtPayload = JWTPayload & {
  email?: unknown;
};

export function normalizeAccessEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasUsableEmail(email: unknown): email is string {
  return typeof email === "string" && normalizeAccessEmail(email).length > 0;
}

function normalizeAccessTeamDomain(teamDomain: string | undefined): string | null {
  const trimmed = teamDomain?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const domain = trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(domain);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function readAccessJwtConfig(env: WorkerV2AccessJwtConfig):
  | { ok: true; issuer: string; audience: string }
  | { ok: false } {
  const issuer = normalizeAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = env.ACCESS_AUD?.trim();

  if (!issuer || !audience) {
    return { ok: false };
  }

  return { ok: true, issuer, audience };
}

async function getAccessEmailFromContext(
  ctx: WorkerV2ExecutionContext,
): Promise<AccessEmailResult> {
  let identity: WorkerV2AccessIdentity | undefined;
  try {
    identity = await ctx.access?.getIdentity();
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Access identity lookup failed", { errorType });
    return {
      ok: false,
      status: 403,
      code: "ACCESS_IDENTITY_UNAVAILABLE",
    };
  }

  if (!hasUsableEmail(identity?.email)) {
    return {
      ok: false,
      status: 403,
      code: "ACCESS_IDENTITY_UNAVAILABLE",
    };
  }

  return {
    ok: true,
    email: normalizeAccessEmail(identity.email),
  };
}

async function getAccessEmailFromJwt(
  request: Request,
  env: WorkerV2AccessJwtConfig,
  options: AccessJwtResolverOptions,
): Promise<AccessEmailResult> {
  const token = request.headers.get("cf-access-jwt-assertion");

  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "ACCESS_REQUIRED",
    };
  }

  const config = readAccessJwtConfig(env);
  if (!config.ok) {
    return {
      ok: false,
      status: 403,
      code: "ACCESS_JWT_CONFIG_MISSING",
    };
  }

  try {
    const jwks =
      options.jwks ??
      createRemoteJWKSet(
        new URL(`${config.issuer}/cdn-cgi/access/certs`),
      );
    const { payload } = await jwtVerify<AccessJwtPayload>(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    });

    if (!hasUsableEmail(payload.email)) {
      return {
        ok: false,
        status: 403,
        code: "ACCESS_IDENTITY_UNAVAILABLE",
      };
    }

    return {
      ok: true,
      email: normalizeAccessEmail(payload.email),
    };
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Access JWT verification failed", { errorType });
    return {
      ok: false,
      status: 403,
      code: "ACCESS_JWT_INVALID",
    };
  }
}

export async function getVerifiedAccessEmail(
  request: Request,
  env: WorkerV2AccessJwtConfig = {},
  ctx: WorkerV2ExecutionContext = {},
  options: AccessJwtResolverOptions = {},
): Promise<AccessEmailResult> {
  if (ctx.access) {
    return await getAccessEmailFromContext(ctx);
  }

  return await getAccessEmailFromJwt(request, env, options);
}
