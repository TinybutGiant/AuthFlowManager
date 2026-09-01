import { z } from "zod";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { WorkerV2ExecutionContext } from "../auth/access";
import { createDrizzleStaffPrincipalRepository } from "../auth/staffRepository";
import { withAuthflowDatabase } from "../db/authflow";
import type { WorkerV2Env } from "../db/types";
import {
  activateManagedStaff,
  createManagedStaff,
  getAssignableAccessGroups,
  getManagedStaff,
  listManagedStaff,
  parseStaffId,
  replaceManagedStaffGrants,
  StaffManagementError,
  suspendManagedStaff,
  updateManagedStaff,
  V2_ADMIN_ROLES,
} from "../staff/staffManagement";
import { createPgStaffManagementRepository } from "../staff/staffManagementRepository";

type JsonBody = Record<string, unknown> | Record<string, unknown>[];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_STAFF_BODY_BYTES = 16 * 1024;

const createStaffBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(255),
    role: z.enum(V2_ADMIN_ROLES).optional(),
    accessGroups: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const updateStaffBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(255).optional(),
    role: z.enum(V2_ADMIN_ROLES).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one staff field must be provided.",
  });

const replaceGrantsBodySchema = z
  .object({
    accessGroups: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const staffRouteModule = {
  name: "staff",
  basePath: "/api/v2/staff",
  routes: [
    "GET /api/v2/staff",
    "GET /api/v2/staff/:id",
    "POST /api/v2/staff",
    "PATCH /api/v2/staff/:id",
    "PUT /api/v2/staff/:id/grants",
    "POST /api/v2/staff/:id/suspend",
    "POST /api/v2/staff/:id/activate",
  ],
} as const;

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

function notFound(path: string) {
  return json(
    {
      status: "error",
      code: "NOT_FOUND",
      path,
    },
    { status: 404 },
  );
}

function staffPayload(staff: unknown) {
  return {
    status: "ok",
    staff,
    assignableAccessGroups: getAssignableAccessGroups(),
  };
}

function staffListPayload(staff: unknown[]) {
  return {
    status: "ok",
    staff,
    assignableAccessGroups: getAssignableAccessGroups(),
  };
}

function validationFailure(error: z.ZodError) {
  return json(
    {
      status: "error",
      code: "INVALID_REQUEST",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function staffManagementFailure(error: StaffManagementError) {
  return json(
    {
      status: "error",
      code: error.code,
    },
    { status: error.status },
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_STAFF_BODY_BYTES) {
    throw new StaffManagementError(
      "INVALID_UPDATE",
      "Request body is too large.",
      413,
    );
  }

  try {
    return await request.json();
  } catch {
    throw new StaffManagementError(
      "INVALID_UPDATE",
      "Request body must be valid JSON.",
      400,
    );
  }
}

function routeSegments(url: URL): string[] {
  return url.pathname
    .slice(staffRouteModule.basePath.length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

export async function handleStaffRoute(
  request: Request,
  env: WorkerV2Env,
  ctx: WorkerV2ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = routeSegments(url);

  try {
    return await withAuthflowDatabase(env, async (db, client) => {
      const authResult = await resolveStaffPrincipalWithRepository(
        request,
        env,
        ctx,
        createDrizzleStaffPrincipalRepository(db),
      );

      if (!authResult.ok) {
        return json(publicStaffAuthFailure(authResult), {
          status: authResult.status,
        });
      }

      const repository = createPgStaffManagementRepository(client);
      const principal = authResult.principal;

      try {
        if (segments.length === 0) {
          if (request.method === "GET" || request.method === "HEAD") {
            const staff = await listManagedStaff(repository, principal);
            return json(staffListPayload(staff));
          }

          if (request.method === "POST") {
            const body = createStaffBodySchema.safeParse(
              await readJsonBody(request),
            );
            if (!body.success) {
              return validationFailure(body.error);
            }

            const staff = await createManagedStaff(
              repository,
              principal,
              body.data,
            );
            return json(staffPayload(staff), { status: 201 });
          }

          return methodNotAllowed(["GET", "HEAD", "POST"]);
        }

        const staffId = parseStaffId(segments[0]);

        if (segments.length === 1) {
          if (request.method === "GET" || request.method === "HEAD") {
            const staff = await getManagedStaff(
              repository,
              principal,
              staffId,
            );
            return json(staffPayload(staff));
          }

          if (request.method === "PATCH") {
            const body = updateStaffBodySchema.safeParse(
              await readJsonBody(request),
            );
            if (!body.success) {
              return validationFailure(body.error);
            }

            const staff = await updateManagedStaff(
              repository,
              principal,
              staffId,
              body.data,
            );
            return json(staffPayload(staff));
          }

          return methodNotAllowed(["GET", "HEAD", "PATCH"]);
        }

        if (segments.length === 2 && segments[1] === "grants") {
          if (request.method !== "PUT") {
            return methodNotAllowed(["PUT"]);
          }

          const body = replaceGrantsBodySchema.safeParse(
            await readJsonBody(request),
          );
          if (!body.success) {
            return validationFailure(body.error);
          }

          const staff = await replaceManagedStaffGrants(
            repository,
            principal,
            staffId,
            body.data.accessGroups,
          );
          return json(staffPayload(staff));
        }

        if (segments.length === 2 && segments[1] === "suspend") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST"]);
          }

          const staff = await suspendManagedStaff(
            repository,
            principal,
            staffId,
          );
          return json(staffPayload(staff));
        }

        if (segments.length === 2 && segments[1] === "activate") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST"]);
          }

          const staff = await activateManagedStaff(
            repository,
            principal,
            staffId,
          );
          return json(staffPayload(staff));
        }

        return notFound(url.pathname);
      } catch (error) {
        if (error instanceof StaffManagementError) {
          return staffManagementFailure(error);
        }

        const errorType = error instanceof Error ? error.name : typeof error;
        console.error("Worker staff management request failed", {
          errorType,
        });
        return json(
          {
            status: "error",
            code: "STAFF_MANAGEMENT_UNAVAILABLE",
          },
          { status: 503 },
        );
      }
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker staff management database failed", { errorType });
    return json(
      {
        status: "error",
        code: "STAFF_MANAGEMENT_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
