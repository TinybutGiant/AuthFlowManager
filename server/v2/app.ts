import { v2RouteModules } from "./routes";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalFromAuthflow,
} from "./auth/authorize";
import type { WorkerV2ExecutionContext } from "./auth/access";
import { checkAuthflowDatabaseHealth } from "./db/authflow";
import { checkMainDatabaseHealth } from "./db/main";
import type { WorkerV2Env } from "./db/types";

type JsonBody = Record<string, unknown> | Record<string, unknown>[];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: JsonBody, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
    },
  });
}

function methodNotAllowed(allowed: string[]) {
  return json(
    {
      status: "error",
      code: "METHOD_NOT_ALLOWED",
      allowedMethods: allowed,
    },
    {
      status: 405,
      headers: {
        Allow: allowed.join(", "),
      },
    },
  );
}

export async function handleV2Request(
  request: Request,
  env: WorkerV2Env = {},
  ctx: WorkerV2ExecutionContext = {},
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }

    return json({
      status: "ok",
      runtime: "cloudflare-worker",
      boundary: "authflowmanager-v2",
    });
  }

  if (url.pathname === "/api/v2/runtime-info") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }

    return json({
      runtime: "cloudflare-worker",
      stage: "stage-1-boundary",
      routeModules: v2RouteModules.map((routeModule) => ({
        name: routeModule.name,
        basePath: routeModule.basePath,
        routeCount: routeModule.routes.length,
      })),
    });
  }

  if (url.pathname === "/api/v2/db-health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }

    const [authflow, main] = await Promise.all([
      checkAuthflowDatabaseHealth(env),
      checkMainDatabaseHealth(env),
    ]);
    const ok = authflow.ok && main.ok;

    return json(
      {
        status: ok ? "ok" : "error",
        endpoint: "temporary-internal-db-health",
        databases: {
          authflow,
          main,
        },
      },
      { status: ok ? 200 : 503 },
    );
  }

  if (url.pathname === "/api/v2/auth/me") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(["GET", "HEAD"]);
    }

    const authResult = await resolveStaffPrincipalFromAuthflow(
      request,
      env,
      ctx,
    );

    if (!authResult.ok) {
      return json(publicStaffAuthFailure(authResult), {
        status: authResult.status,
      });
    }

    return json({
      status: "ok",
      staff: authResult.principal,
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return json(
      {
        status: "error",
        code: "NOT_FOUND",
        path: url.pathname,
      },
      { status: 404 },
    );
  }

  return new Response(null, { status: 404 });
}
