import { z } from "zod";
import {
  applyCreditMemoPayloadSchema,
  applyExpensePaymentPayloadSchema,
  applyFinanceCreditToBill,
  applyFinancePaymentToBill,
  archiveFinanceVendor,
  cancelFinanceSubscription,
  cancelRecurringExpensePayloadSchema,
  createFinanceBill,
  createFinanceReconciliationException,
  createFinanceSubscription,
  createFinanceVendor,
  createExpensePaymentPayloadSchema,
  createReconciliationExceptionPayloadSchema,
  createRecurringExpensePayloadSchema,
  createVendorBillPayloadSchema,
  createVendorPayloadSchema,
  FinanceExpenseServiceError,
  financeBillApplicationResponse,
  financeBillResponse,
  financeBillTransitionPayloadSchema,
  financeIdParamSchema,
  financeListQuerySchema,
  financePaymentResponse,
  financeReconciliationExceptionResponse,
  financeSubscriptionResponse,
  financeVendorResponse,
  getFinanceOverview,
  listFinanceBillApplications,
  listFinanceBills,
  listFinanceLegalEntities,
  listFinancePayments,
  listFinanceReconciliationExceptions,
  listFinanceSubscriptions,
  listFinanceVendors,
  pauseFinanceSubscription,
  recordFinancePayment,
  reconciliationExceptionTransitionPayloadSchema,
  resumeFinanceSubscription,
  reverseFinanceBillApplication,
  reverseFinancePayment,
  transitionFinanceBillStatus,
  transitionFinanceReconciliationException,
  updateDraftFinanceBill,
  updateDraftVendorBillPayloadSchema,
  updateExpensePaymentPayloadSchema,
  updateExpensePaymentStatusPayloadSchema,
  updateFinancePayment,
  updateFinancePaymentStatus,
  updateFinanceSubscription,
  updateFinanceVendor,
  updateRecurringExpensePayloadSchema,
  updateVendorPayloadSchema,
  type FinanceExpenseRepository,
} from "../../financeExpenseService";
import { createFinanceExpenseRepository } from "../../financeExpenseRepositoryFactory";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { WorkerV2ExecutionContext } from "../auth/access";
import { createDrizzleStaffPrincipalRepository } from "../auth/staffRepository";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import { withAuthflowDatabase } from "../db/authflow";
import type { WorkerV2Env } from "../db/types";
import { canManageFinance } from "../finance/authorization";

type JsonBody = unknown;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_FINANCE_BODY_BYTES = 64 * 1024;

export const financeRouteModule = {
  name: "finance",
  basePath: "/api/v2/finance",
  routes: [
    "GET /api/v2/finance",
    "GET /api/v2/finance/overview",
    "GET /api/v2/finance/legal-entities",
    "GET /api/v2/finance/vendors",
    "POST /api/v2/finance/vendors",
    "PATCH /api/v2/finance/vendors/:vendorId",
    "POST /api/v2/finance/vendors/:vendorId/archive",
    "GET /api/v2/finance/subscriptions",
    "POST /api/v2/finance/subscriptions",
    "PATCH /api/v2/finance/subscriptions/:subscriptionId",
    "POST /api/v2/finance/subscriptions/:subscriptionId/pause",
    "POST /api/v2/finance/subscriptions/:subscriptionId/resume",
    "POST /api/v2/finance/subscriptions/:subscriptionId/cancel",
    "GET /api/v2/finance/bills",
    "POST /api/v2/finance/bills",
    "PATCH /api/v2/finance/bills/:billId",
    "POST /api/v2/finance/bills/:billId/receive",
    "POST /api/v2/finance/bills/:billId/approve",
    "POST /api/v2/finance/bills/:billId/dispute",
    "POST /api/v2/finance/bills/:billId/void",
    "GET /api/v2/finance/payments",
    "POST /api/v2/finance/payments",
    "PATCH /api/v2/finance/payments/:paymentId",
    "POST /api/v2/finance/payments/:paymentId/post",
    "POST /api/v2/finance/payments/:paymentId/clear",
    "POST /api/v2/finance/payments/:paymentId/fail",
    "POST /api/v2/finance/payments/:paymentId/void",
    "POST /api/v2/finance/payments/:paymentId/reverse",
    "GET /api/v2/finance/bill-applications",
    "POST /api/v2/finance/bill-applications/payment",
    "POST /api/v2/finance/bill-applications/credit",
    "POST /api/v2/finance/bill-applications/:applicationId/reverse",
    "GET /api/v2/finance/reconciliation-exceptions",
    "POST /api/v2/finance/reconciliation-exceptions",
    "POST /api/v2/finance/reconciliation-exceptions/:exceptionId/investigate",
    "POST /api/v2/finance/reconciliation-exceptions/:exceptionId/resolve",
    "POST /api/v2/finance/reconciliation-exceptions/:exceptionId/waive",
    "POST /api/v2/finance/reconciliation-exceptions/:exceptionId/reopen",
  ],
} as const;

export { financeIdParamSchema } from "../../financeExpenseService";

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
      message: "Invalid finance request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function financeFailure(error: FinanceExpenseServiceError) {
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
  if (contentLength && Number(contentLength) > MAX_FINANCE_BODY_BYTES) {
    throw new FinanceExpenseServiceError(
      413,
      "FINANCE_REQUEST_TOO_LARGE",
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
    throw new FinanceExpenseServiceError(
      400,
      "FINANCE_INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
}

function parseQuery(url: URL) {
  return financeListQuerySchema.parse(Object.fromEntries(url.searchParams));
}

function routeSegments(url: URL): string[] {
  return url.pathname
    .slice(financeRouteModule.basePath.length)
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

export async function handleFinanceRouteWithRepository(
  request: Request,
  principal: StaffPrincipal,
  repository: FinanceExpenseRepository,
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

  if (!canManageFinance(principal)) {
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
      return json(await getFinanceOverview(repository));
    }

    if (segments.length === 1 && segments[0] === "legal-entities") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listFinanceLegalEntities(repository));
    }

    if (segments.length === 1 && segments[0] === "vendors") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listFinanceVendors(repository, parseQuery(url)));
      }

      if (request.method === "POST") {
        const vendor = await createFinanceVendor(repository, {
          ...(await parsedBody(request, createVendorPayloadSchema)),
          actorAdminId,
        });
        return json(financeVendorResponse(vendor), { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "vendors") {
      if (request.method !== "PATCH") {
        return methodNotAllowed(["PATCH"]);
      }
      const vendor = await updateFinanceVendor(
        repository,
        financeIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, updateVendorPayloadSchema)),
          actorAdminId,
        },
      );
      return json(financeVendorResponse(vendor));
    }

    if (segments.length === 3 && segments[0] === "vendors" && segments[2] === "archive") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const vendor = await archiveFinanceVendor(
        repository,
        financeIdParamSchema.parse(segments[1]),
        actorAdminId,
      );
      return json(financeVendorResponse(vendor));
    }

    if (segments.length === 1 && segments[0] === "subscriptions") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listFinanceSubscriptions(repository, parseQuery(url)));
      }

      if (request.method === "POST") {
        const subscription = await createFinanceSubscription(repository, {
          ...(await parsedBody(request, createRecurringExpensePayloadSchema)),
          actorAdminId,
        });
        return json(financeSubscriptionResponse(subscription), { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "subscriptions") {
      if (request.method !== "PATCH") {
        return methodNotAllowed(["PATCH"]);
      }
      const subscription = await updateFinanceSubscription(
        repository,
        financeIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, updateRecurringExpensePayloadSchema)),
          actorAdminId,
        },
      );
      return json(financeSubscriptionResponse(subscription));
    }

    if (segments.length === 3 && segments[0] === "subscriptions") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const subscriptionId = financeIdParamSchema.parse(segments[1]);
      if (segments[2] === "pause") {
        return json(financeSubscriptionResponse(
          await pauseFinanceSubscription(repository, subscriptionId, actorAdminId),
        ));
      }
      if (segments[2] === "resume") {
        return json(financeSubscriptionResponse(
          await resumeFinanceSubscription(repository, subscriptionId, actorAdminId),
        ));
      }
      if (segments[2] === "cancel") {
        const subscription = await cancelFinanceSubscription(repository, subscriptionId, {
          ...(await parsedBody(request, cancelRecurringExpensePayloadSchema)),
          actorAdminId,
        });
        return json(financeSubscriptionResponse(subscription));
      }
    }

    if (segments.length === 1 && segments[0] === "bills") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listFinanceBills(repository, parseQuery(url)));
      }

      if (request.method === "POST") {
        const bill = await createFinanceBill(repository, {
          ...(await parsedBody(request, createVendorBillPayloadSchema)),
          actorAdminId,
        });
        return json(financeBillResponse(bill), { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "bills") {
      if (request.method !== "PATCH") {
        return methodNotAllowed(["PATCH"]);
      }
      const bill = await updateDraftFinanceBill(
        repository,
        financeIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, updateDraftVendorBillPayloadSchema)),
          actorAdminId,
        },
      );
      return json(financeBillResponse(bill));
    }

    if (segments.length === 3 && segments[0] === "bills") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const action = segments[2];
      if (
        action === "receive" ||
        action === "approve" ||
        action === "dispute" ||
        action === "void"
      ) {
        const bill = await transitionFinanceBillStatus(
          repository,
          financeIdParamSchema.parse(segments[1]),
          action,
          {
            ...(await parsedBody(request, financeBillTransitionPayloadSchema)),
            actorAdminId,
          },
        );
        return json(financeBillResponse(bill));
      }
    }

    if (segments.length === 1 && segments[0] === "payments") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listFinancePayments(repository, parseQuery(url)));
      }

      if (request.method === "POST") {
        const payment = await recordFinancePayment(repository, {
          ...(await parsedBody(request, createExpensePaymentPayloadSchema)),
          actorAdminId,
        });
        return json(financePaymentResponse(payment), { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "payments") {
      if (request.method !== "PATCH") {
        return methodNotAllowed(["PATCH"]);
      }
      const payment = await updateFinancePayment(
        repository,
        financeIdParamSchema.parse(segments[1]),
        {
          ...(await parsedBody(request, updateExpensePaymentPayloadSchema)),
          actorAdminId,
        },
      );
      return json(financePaymentResponse(payment));
    }

    if (segments.length === 3 && segments[0] === "payments") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const paymentId = financeIdParamSchema.parse(segments[1]);
      const action = segments[2];
      if (action === "reverse") {
        return json(financePaymentResponse(
          await reverseFinancePayment(repository, paymentId, actorAdminId),
        ));
      }
      const statusByAction = {
        post: "posted",
        clear: "cleared",
        fail: "failed",
        void: "voided",
      } as const;
      const status = statusByAction[action as keyof typeof statusByAction];
      if (status) {
        const payment = await updateFinancePaymentStatus(repository, paymentId, {
          ...updateExpensePaymentStatusPayloadSchema.parse({ status }),
          actorAdminId,
        });
        return json(financePaymentResponse(payment));
      }
    }

    if (segments.length === 1 && segments[0] === "bill-applications") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listFinanceBillApplications(repository, parseQuery(url)));
    }

    if (segments.length === 2 && segments[0] === "bill-applications") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      if (segments[1] === "payment") {
        const application = await applyFinancePaymentToBill(repository, {
          ...(await parsedBody(request, applyExpensePaymentPayloadSchema)),
          actorAdminId,
        });
        return json(financeBillApplicationResponse(application), { status: 201 });
      }

      if (segments[1] === "credit") {
        const application = await applyFinanceCreditToBill(repository, {
          ...(await parsedBody(request, applyCreditMemoPayloadSchema)),
          actorAdminId,
        });
        return json(financeBillApplicationResponse(application), { status: 201 });
      }
    }

    if (
      segments.length === 3 &&
      segments[0] === "bill-applications" &&
      segments[2] === "reverse"
    ) {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const application = await reverseFinanceBillApplication(
        repository,
        financeIdParamSchema.parse(segments[1]),
        actorAdminId,
      );
      return json(financeBillApplicationResponse(application));
    }

    if (segments.length === 1 && segments[0] === "reconciliation-exceptions") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listFinanceReconciliationExceptions(repository, parseQuery(url)));
      }

      if (request.method === "POST") {
        const exception = await createFinanceReconciliationException(repository, {
          ...(await parsedBody(request, createReconciliationExceptionPayloadSchema)),
          actorAdminId,
        });
        return json(financeReconciliationExceptionResponse(exception), { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 3 && segments[0] === "reconciliation-exceptions") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const action = segments[2];
      if (
        action === "investigate" ||
        action === "resolve" ||
        action === "waive" ||
        action === "reopen"
      ) {
        const exception = await transitionFinanceReconciliationException(
          repository,
          financeIdParamSchema.parse(segments[1]),
          action,
          {
            ...(await parsedBody(request, reconciliationExceptionTransitionPayloadSchema)),
            actorAdminId,
          },
        );
        return json(financeReconciliationExceptionResponse(exception));
      }
    }

    return notFound(url.pathname);
  } catch (error) {
    if (error instanceof FinanceExpenseServiceError) {
      return financeFailure(error);
    }

    if (error instanceof z.ZodError) {
      return validationFailure(error);
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker AP finance request failed", { errorType });
    return json(
      {
        status: "error",
        code: "FINANCE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export async function handleFinanceRoute(
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

      return await handleFinanceRouteWithRepository(
        request,
        authResult.principal,
        createFinanceExpenseRepository(db),
      );
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker AP finance database failed", { errorType });
    return json(
      {
        status: "error",
        code: "FINANCE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
