import { z } from "zod";
import {
  addPayrollResultLine,
  addPayrollRunWorker,
  createPayrollCorrectionRun,
  createPayrollCorrectionRunPayloadSchema,
  createPayrollExternalRecordRef,
  createPayrollExternalRefPayloadSchema,
  createPayrollPaymentPayloadSchema,
  createPayrollResultLinePayloadSchema,
  createPayrollRun,
  createPayrollRunPayloadSchema,
  createPayrollRunWorkerPayloadSchema,
  finalizePayrollRun,
  getPayrollOverview,
  getPayrollRun,
  listPayrollEmploymentOptions,
  listPayrollLegalEntities,
  listPayrollRuns,
  listPayrollVendors,
  markPayrollRunReviewed,
  payrollEmploymentOptionQuerySchema,
  payrollPaymentTransitionPayloadSchema,
  payrollRunListQuerySchema,
  PayrollServiceError,
  recordPayrollPayment,
  removePayrollResultLine,
  removePayrollRunWorker,
  reversePayrollPayment,
  transitionPayrollPayment,
  updatePayrollPayment,
  updatePayrollPaymentPayloadSchema,
  updatePayrollResultLine,
  updatePayrollResultLinePayloadSchema,
  updatePayrollRun,
  updatePayrollRunPayloadSchema,
  updatePayrollRunWorker,
  updatePayrollRunWorkerPayloadSchema,
  type PayrollRepository,
} from "../../payrollService";
import { createPayrollRepository } from "../../payrollRepositoryFactory";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { WorkerV2ExecutionContext } from "../auth/access";
import { createDrizzleStaffPrincipalRepository } from "../auth/staffRepository";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import { withAuthflowDatabase } from "../db/authflow";
import type { WorkerV2Env } from "../db/types";
import { canManagePayroll } from "../payroll/authorization";

type JsonBody = unknown;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_PAYROLL_BODY_BYTES = 64 * 1024;

export const payrollRouteModule = {
  name: "payroll",
  basePath: "/api/v2/payroll",
  routes: [
    "GET /api/v2/payroll",
    "GET /api/v2/payroll/overview",
    "GET /api/v2/payroll/legal-entities",
    "GET /api/v2/payroll/vendors",
    "GET /api/v2/payroll/employment-options",
    "GET /api/v2/payroll/runs",
    "POST /api/v2/payroll/runs",
    "POST /api/v2/payroll/runs/corrections",
    "GET /api/v2/payroll/runs/:runId",
    "PATCH /api/v2/payroll/runs/:runId",
    "POST /api/v2/payroll/runs/:runId/review",
    "POST /api/v2/payroll/runs/:runId/finalize",
    "POST /api/v2/payroll/runs/:runId/workers",
    "PATCH /api/v2/payroll/run-workers/:runWorkerId",
    "DELETE /api/v2/payroll/run-workers/:runWorkerId",
    "POST /api/v2/payroll/run-workers/:runWorkerId/result-lines",
    "PATCH /api/v2/payroll/result-lines/:lineId",
    "DELETE /api/v2/payroll/result-lines/:lineId",
    "POST /api/v2/payroll/run-workers/:runWorkerId/payments",
    "PATCH /api/v2/payroll/payments/:paymentId",
    "POST /api/v2/payroll/payments/:paymentId/send",
    "POST /api/v2/payroll/payments/:paymentId/clear",
    "POST /api/v2/payroll/payments/:paymentId/fail",
    "POST /api/v2/payroll/payments/:paymentId/void",
    "POST /api/v2/payroll/payments/:paymentId/reverse",
    "POST /api/v2/payroll/external-record-refs",
  ],
} as const;

export const payrollIdParamSchema = z.coerce.number().int().positive();

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

function validationFailure(error: z.ZodError) {
  return json(
    {
      status: "error",
      code: "INVALID_REQUEST",
      message: "Invalid payroll request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function payrollFailure(error: PayrollServiceError) {
  return json(
    {
      status: "error",
      code: error.code,
      message: error.message,
    },
    { status: error.statusCode },
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_PAYROLL_BODY_BYTES) {
    throw new PayrollServiceError(
      413,
      "PAYROLL_REQUEST_TOO_LARGE",
      "Request body is too large.",
    );
  }

  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new PayrollServiceError(
      400,
      "PAYROLL_INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
}

function parseRunQuery(url: URL) {
  return payrollRunListQuerySchema.parse(Object.fromEntries(url.searchParams));
}

function parseEmploymentOptionsQuery(url: URL) {
  return payrollEmploymentOptionQuerySchema.parse(Object.fromEntries(url.searchParams));
}

function routeSegments(url: URL): string[] {
  return url.pathname
    .slice(payrollRouteModule.basePath.length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

async function parsedBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return schema.parse(await readJsonBody(request));
}

async function payrollPaymentTransitionBody(
  request: Request,
  status: "sent" | "cleared" | "failed" | "voided",
) {
  const body = await readJsonBody(request);
  const bodyObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  return payrollPaymentTransitionPayloadSchema.parse({
    ...bodyObject,
    status,
  });
}

export async function handlePayrollRouteWithRepository(
  request: Request,
  principal: StaffPrincipal,
  repository: PayrollRepository,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = routeSegments(url);
  const actorAdminId = Number(principal.id);

  if (!Number.isInteger(actorAdminId) || actorAdminId <= 0) {
    return json(
      {
        status: "error",
        code: "STAFF_ACCESS_DENIED",
      },
      { status: 403 },
    );
  }

  if (!canManagePayroll(principal)) {
    return json(
      {
        status: "error",
        code: "STAFF_ACCESS_DENIED",
      },
      { status: 403 },
    );
  }

  try {
    if (segments.length === 0 || (segments.length === 1 && segments[0] === "overview")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await getPayrollOverview(repository));
    }

    if (segments.length === 1 && segments[0] === "legal-entities") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listPayrollLegalEntities(repository));
    }

    if (segments.length === 1 && segments[0] === "vendors") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listPayrollVendors(repository));
    }

    if (segments.length === 1 && segments[0] === "employment-options") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listPayrollEmploymentOptions(
        repository,
        parseEmploymentOptionsQuery(url),
      ));
    }

    if (segments.length === 1 && segments[0] === "runs") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listPayrollRuns(repository, parseRunQuery(url)));
      }

      if (request.method === "POST") {
        const run = await createPayrollRun(repository, {
          ...(await parsedBody(request, createPayrollRunPayloadSchema)),
          actorAdminId,
        });
        return json(run, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "runs" && segments[1] === "corrections") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const run = await createPayrollCorrectionRun(repository, {
        ...(await parsedBody(request, createPayrollCorrectionRunPayloadSchema)),
        actorAdminId,
      });
      return json(run, { status: 201 });
    }

    if (segments.length === 2 && segments[0] === "runs") {
      const runId = payrollIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getPayrollRun(repository, runId));
      }

      if (request.method === "PATCH") {
        return json(await updatePayrollRun(repository, runId, {
          ...(await parsedBody(request, updatePayrollRunPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 3 && segments[0] === "runs") {
      const runId = payrollIdParamSchema.parse(segments[1]);
      const action = segments[2];

      if (action === "review" || action === "finalize") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }
        return json(action === "review"
          ? await markPayrollRunReviewed(repository, runId, actorAdminId)
          : await finalizePayrollRun(repository, runId, actorAdminId));
      }

      if (action === "workers") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }
        const workerResult = await addPayrollRunWorker(repository, runId, {
          ...(await parsedBody(request, createPayrollRunWorkerPayloadSchema)),
          actorAdminId,
        });
        return json(workerResult, { status: 201 });
      }
    }

    if (segments.length === 2 && segments[0] === "run-workers") {
      const runWorkerId = payrollIdParamSchema.parse(segments[1]);
      if (request.method === "PATCH") {
        return json(await updatePayrollRunWorker(repository, runWorkerId, {
          ...(await parsedBody(request, updatePayrollRunWorkerPayloadSchema)),
          actorAdminId,
        }));
      }

      if (request.method === "DELETE") {
        return json(await removePayrollRunWorker(repository, runWorkerId, actorAdminId));
      }

      return methodNotAllowed(["PATCH", "DELETE"]);
    }

    if (
      segments.length === 3 &&
      segments[0] === "run-workers" &&
      segments[2] === "result-lines"
    ) {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const line = await addPayrollResultLine(
        repository,
        payrollIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, createPayrollResultLinePayloadSchema)),
          actorAdminId,
        },
      );
      return json(line, { status: 201 });
    }

    if (
      segments.length === 3 &&
      segments[0] === "run-workers" &&
      segments[2] === "payments"
    ) {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const payment = await recordPayrollPayment(
        repository,
        payrollIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, createPayrollPaymentPayloadSchema)),
          actorAdminId,
        },
      );
      return json(payment, { status: 201 });
    }

    if (segments.length === 2 && segments[0] === "result-lines") {
      const lineId = payrollIdParamSchema.parse(segments[1]);
      if (request.method === "PATCH") {
        return json(await updatePayrollResultLine(repository, lineId, {
          ...(await parsedBody(request, updatePayrollResultLinePayloadSchema)),
          actorAdminId,
        }));
      }

      if (request.method === "DELETE") {
        return json(await removePayrollResultLine(repository, lineId, actorAdminId));
      }

      return methodNotAllowed(["PATCH", "DELETE"]);
    }

    if (segments.length === 2 && segments[0] === "payments") {
      const paymentId = payrollIdParamSchema.parse(segments[1]);
      if (request.method !== "PATCH") {
        return methodNotAllowed(["PATCH"]);
      }
      return json(await updatePayrollPayment(repository, paymentId, {
        ...(await parsedBody(request, updatePayrollPaymentPayloadSchema)),
        actorAdminId,
      }));
    }

    if (segments.length === 3 && segments[0] === "payments") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const paymentId = payrollIdParamSchema.parse(segments[1]);
      const action = segments[2];
      if (action === "reverse") {
        return json(await reversePayrollPayment(repository, paymentId, actorAdminId));
      }

      const statusByAction = {
        send: "sent",
        clear: "cleared",
        fail: "failed",
        void: "voided",
      } as const;
      const status = statusByAction[action as keyof typeof statusByAction];
      if (status) {
        return json(await transitionPayrollPayment(repository, paymentId, {
          ...(await payrollPaymentTransitionBody(request, status)),
          actorAdminId,
        }));
      }
    }

    if (segments.length === 1 && segments[0] === "external-record-refs") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const ref = await createPayrollExternalRecordRef(repository, {
        ...(await parsedBody(request, createPayrollExternalRefPayloadSchema)),
        actorAdminId,
      });
      return json(ref, { status: 201 });
    }

    return notFound(url.pathname);
  } catch (error) {
    if (error instanceof PayrollServiceError) {
      return payrollFailure(error);
    }

    if (error instanceof z.ZodError) {
      return validationFailure(error);
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Payroll request failed", { errorType });
    return json(
      {
        status: "error",
        code: "PAYROLL_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export async function handlePayrollRoute(
  request: Request,
  env: WorkerV2Env,
  ctx: WorkerV2ExecutionContext,
): Promise<Response> {
  try {
    return await withAuthflowDatabase(env, async (db) => {
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

      return await handlePayrollRouteWithRepository(
        request,
        authResult.principal,
        createPayrollRepository(db),
      );
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Payroll database failed", { errorType });
    return json(
      {
        status: "error",
        code: "PAYROLL_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
