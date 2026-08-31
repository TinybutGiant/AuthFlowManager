import { v2RouteModules } from "./routes";

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

export async function handleV2Request(request: Request): Promise<Response> {
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
