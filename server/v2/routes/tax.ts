import { z } from "zod";
import {
  applyTaxPaymentAllocation,
  applyTaxPaymentAllocationPayloadSchema,
  createTaxAgency,
  createTaxAgencyPaymentPayloadSchema,
  createTaxAgencyPayloadSchema,
  createTaxExternalRecordRef,
  createTaxExternalRefPayloadSchema,
  createTaxFiling,
  createTaxFilingAmendment,
  createTaxFilingAmendmentPayloadSchema,
  createTaxFilingPayloadSchema,
  createTaxLiability,
  createTaxLiabilityAdjustment,
  createTaxLiabilityAdjustmentPayloadSchema,
  createTaxLiabilityPayloadSchema,
  createTaxReconciliationException,
  createTaxReconciliationExceptionPayloadSchema,
  createTaxRegistration,
  createTaxRegistrationPayloadSchema,
  getTaxAgency,
  getTaxAgencyPayment,
  getTaxFiling,
  getTaxLiability,
  getTaxOverview,
  getTaxRegistration,
  listTaxAgencies,
  listTaxAgencyPayments,
  listTaxFilings,
  listTaxLegalEntities,
  listTaxLiabilities,
  listTaxPaymentAllocations,
  listTaxReconciliationExceptions,
  listTaxRegistrations,
  recordTaxAgencyPayment,
  reverseTaxAgencyPayment,
  reverseTaxPaymentAllocation,
  TaxServiceError,
  taxAgencyListQuerySchema,
  taxAgencyPaymentListQuerySchema,
  taxAgencyPaymentTransitionPayloadSchema,
  taxFilingListQuerySchema,
  taxFilingTransitionPayloadSchema,
  taxLiabilityListQuerySchema,
  taxLiabilityTransitionPayloadSchema,
  taxPaymentAllocationListQuerySchema,
  taxReconciliationExceptionTransitionPayloadSchema,
  taxReconciliationListQuerySchema,
  taxRegistrationListQuerySchema,
  taxRegistrationTransitionPayloadSchema,
  transitionTaxAgencyPayment,
  transitionTaxFiling,
  transitionTaxLiability,
  transitionTaxReconciliationException,
  transitionTaxRegistration,
  updateTaxAgency,
  updateTaxAgencyPayment,
  updateTaxAgencyPaymentPayloadSchema,
  updateTaxAgencyPayloadSchema,
  updateTaxFiling,
  updateTaxFilingPayloadSchema,
  updateTaxLiability,
  updateTaxLiabilityPayloadSchema,
  updateTaxRegistration,
  updateTaxRegistrationPayloadSchema,
  type TaxRepository,
} from "../../taxService";
import { createTaxRepository } from "../../taxRepositoryFactory";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalWithRepository,
} from "../auth/authorize";
import type { WorkerV2ExecutionContext } from "../auth/access";
import { createDrizzleStaffPrincipalRepository } from "../auth/staffRepository";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import { withAuthflowDatabase } from "../db/authflow";
import type { WorkerV2Env } from "../db/types";
import { canManageTax } from "../tax/authorization";

type JsonBody = unknown;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_TAX_BODY_BYTES = 64 * 1024;

export const taxRouteModule = {
  name: "tax",
  basePath: "/api/v2/tax",
  routes: [
    "GET /api/v2/tax",
    "GET /api/v2/tax/overview",
    "GET /api/v2/tax/legal-entities",
    "GET /api/v2/tax/agencies",
    "POST /api/v2/tax/agencies",
    "GET /api/v2/tax/agencies/:agencyId",
    "PATCH /api/v2/tax/agencies/:agencyId",
    "GET /api/v2/tax/registrations",
    "POST /api/v2/tax/registrations",
    "GET /api/v2/tax/registrations/:registrationId",
    "PATCH /api/v2/tax/registrations/:registrationId",
    "POST /api/v2/tax/registrations/:registrationId/activate",
    "POST /api/v2/tax/registrations/:registrationId/deactivate",
    "POST /api/v2/tax/registrations/:registrationId/close",
    "GET /api/v2/tax/liabilities",
    "POST /api/v2/tax/liabilities",
    "GET /api/v2/tax/liabilities/:liabilityId",
    "PATCH /api/v2/tax/liabilities/:liabilityId",
    "POST /api/v2/tax/liabilities/:liabilityId/recognize",
    "POST /api/v2/tax/liabilities/:liabilityId/dispute",
    "POST /api/v2/tax/liabilities/:liabilityId/void",
    "POST /api/v2/tax/liabilities/:liabilityId/adjustments",
    "GET /api/v2/tax/payments",
    "POST /api/v2/tax/payments",
    "GET /api/v2/tax/payments/:paymentId",
    "PATCH /api/v2/tax/payments/:paymentId",
    "POST /api/v2/tax/payments/:paymentId/submit",
    "POST /api/v2/tax/payments/:paymentId/clear",
    "POST /api/v2/tax/payments/:paymentId/fail",
    "POST /api/v2/tax/payments/:paymentId/void",
    "POST /api/v2/tax/payments/:paymentId/reverse",
    "GET /api/v2/tax/payment-allocations",
    "POST /api/v2/tax/payment-allocations",
    "POST /api/v2/tax/payment-allocations/:allocationId/reverse",
    "GET /api/v2/tax/filings",
    "POST /api/v2/tax/filings",
    "GET /api/v2/tax/filings/:filingId",
    "PATCH /api/v2/tax/filings/:filingId",
    "POST /api/v2/tax/filings/:filingId/ready",
    "POST /api/v2/tax/filings/:filingId/file",
    "POST /api/v2/tax/filings/:filingId/accept",
    "POST /api/v2/tax/filings/:filingId/reject",
    "POST /api/v2/tax/filings/:filingId/amendments",
    "GET /api/v2/tax/reconciliation-exceptions",
    "POST /api/v2/tax/reconciliation-exceptions",
    "POST /api/v2/tax/reconciliation-exceptions/:exceptionId/investigate",
    "POST /api/v2/tax/reconciliation-exceptions/:exceptionId/resolve",
    "POST /api/v2/tax/reconciliation-exceptions/:exceptionId/waive",
    "POST /api/v2/tax/reconciliation-exceptions/:exceptionId/reopen",
    "POST /api/v2/tax/external-record-refs",
  ],
} as const;

export const taxIdParamSchema = z.coerce.number().int().positive();

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
      message: "Invalid tax request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function taxFailure(error: TaxServiceError) {
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
  if (contentLength && Number(contentLength) > MAX_TAX_BODY_BYTES) {
    throw new TaxServiceError(
      413,
      "TAX_REQUEST_TOO_LARGE",
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
    throw new TaxServiceError(
      400,
      "TAX_INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
}

function routeSegments(url: URL): string[] {
  return url.pathname
    .slice(taxRouteModule.basePath.length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function parseQuery<TSchema extends z.ZodTypeAny>(
  url: URL,
  schema: TSchema,
): z.output<TSchema> {
  return schema.parse(Object.fromEntries(url.searchParams));
}

async function parsedBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return schema.parse(await readJsonBody(request));
}

async function bodyWithStatus<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  status: string,
): Promise<z.output<TSchema>> {
  const body = await readJsonBody(request);
  const bodyObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  return schema.parse({
    ...bodyObject,
    status,
  });
}

export async function handleTaxRouteWithRepository(
  request: Request,
  principal: StaffPrincipal,
  repository: TaxRepository,
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

  if (!canManageTax(principal)) {
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
      return json(await getTaxOverview(repository));
    }

    if (segments.length === 1 && segments[0] === "legal-entities") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      return json(await listTaxLegalEntities(repository));
    }

    if (segments.length === 1 && segments[0] === "agencies") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxAgencies(
          repository,
          parseQuery(url, taxAgencyListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const agency = await createTaxAgency(repository, {
          ...(await parsedBody(request, createTaxAgencyPayloadSchema)),
          actorAdminId,
        });
        return json(agency, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "agencies") {
      const agencyId = taxIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getTaxAgency(repository, agencyId));
      }

      if (request.method === "PATCH") {
        return json(await updateTaxAgency(repository, agencyId, {
          ...(await parsedBody(request, updateTaxAgencyPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 1 && segments[0] === "registrations") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxRegistrations(
          repository,
          parseQuery(url, taxRegistrationListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const registration = await createTaxRegistration(repository, {
          ...(await parsedBody(request, createTaxRegistrationPayloadSchema)),
          actorAdminId,
        });
        return json(registration, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "registrations") {
      const registrationId = taxIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getTaxRegistration(repository, registrationId));
      }

      if (request.method === "PATCH") {
        return json(await updateTaxRegistration(repository, registrationId, {
          ...(await parsedBody(request, updateTaxRegistrationPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 3 && segments[0] === "registrations") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const statusByAction = {
        activate: "active",
        deactivate: "inactive",
        close: "closed",
      } as const;
      const status = statusByAction[segments[2] as keyof typeof statusByAction];
      if (status) {
        return json(await transitionTaxRegistration(
          repository,
          taxIdParamSchema.parse(segments[1]),
          {
            ...(await bodyWithStatus(request, taxRegistrationTransitionPayloadSchema, status)),
            actorAdminId,
          },
        ));
      }
    }

    if (segments.length === 1 && segments[0] === "liabilities") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxLiabilities(
          repository,
          parseQuery(url, taxLiabilityListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const liability = await createTaxLiability(repository, {
          ...(await parsedBody(request, createTaxLiabilityPayloadSchema)),
          actorAdminId,
        });
        return json(liability, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "liabilities") {
      const liabilityId = taxIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getTaxLiability(repository, liabilityId));
      }

      if (request.method === "PATCH") {
        return json(await updateTaxLiability(repository, liabilityId, {
          ...(await parsedBody(request, updateTaxLiabilityPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 3 && segments[0] === "liabilities") {
      const liabilityId = taxIdParamSchema.parse(segments[1]);
      const action = segments[2];

      if (action === "adjustments") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }
        const liability = await createTaxLiabilityAdjustment(
          repository,
          liabilityId,
          {
            ...(await parsedBody(request, createTaxLiabilityAdjustmentPayloadSchema)),
            actorAdminId,
          },
        );
        return json(liability, { status: 201 });
      }

      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const statusByAction = {
        recognize: "recognized",
        dispute: "disputed",
        void: "voided",
      } as const;
      const status = statusByAction[action as keyof typeof statusByAction];
      if (status) {
        return json(await transitionTaxLiability(repository, liabilityId, {
          ...(await bodyWithStatus(request, taxLiabilityTransitionPayloadSchema, status)),
          actorAdminId,
        }));
      }
    }

    if (segments.length === 1 && segments[0] === "payments") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxAgencyPayments(
          repository,
          parseQuery(url, taxAgencyPaymentListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const payment = await recordTaxAgencyPayment(repository, {
          ...(await parsedBody(request, createTaxAgencyPaymentPayloadSchema)),
          actorAdminId,
        });
        return json(payment, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "payments") {
      const paymentId = taxIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getTaxAgencyPayment(repository, paymentId));
      }

      if (request.method === "PATCH") {
        return json(await updateTaxAgencyPayment(repository, paymentId, {
          ...(await parsedBody(request, updateTaxAgencyPaymentPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 3 && segments[0] === "payments") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const paymentId = taxIdParamSchema.parse(segments[1]);
      const action = segments[2];
      if (action === "reverse") {
        return json(await reverseTaxAgencyPayment(repository, paymentId, actorAdminId));
      }

      const statusByAction = {
        submit: "submitted",
        clear: "cleared",
        fail: "failed",
        void: "voided",
      } as const;
      const status = statusByAction[action as keyof typeof statusByAction];
      if (status) {
        return json(await transitionTaxAgencyPayment(repository, paymentId, {
          ...(await bodyWithStatus(request, taxAgencyPaymentTransitionPayloadSchema, status)),
          actorAdminId,
        }));
      }
    }

    if (segments.length === 1 && segments[0] === "payment-allocations") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxPaymentAllocations(
          repository,
          parseQuery(url, taxPaymentAllocationListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const allocation = await applyTaxPaymentAllocation(repository, {
          ...(await parsedBody(request, applyTaxPaymentAllocationPayloadSchema)),
          actorAdminId,
        });
        return json(allocation, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (
      segments.length === 3 &&
      segments[0] === "payment-allocations" &&
      segments[2] === "reverse"
    ) {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      return json(await reverseTaxPaymentAllocation(
        repository,
        taxIdParamSchema.parse(segments[1]),
        actorAdminId,
      ));
    }

    if (segments.length === 1 && segments[0] === "filings") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxFilings(
          repository,
          parseQuery(url, taxFilingListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const filing = await createTaxFiling(repository, {
          ...(await parsedBody(request, createTaxFilingPayloadSchema)),
          actorAdminId,
        });
        return json(filing, { status: 201 });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length === 2 && segments[0] === "filings") {
      const filingId = taxIdParamSchema.parse(segments[1]);
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await getTaxFiling(repository, filingId));
      }

      if (request.method === "PATCH") {
        return json(await updateTaxFiling(repository, filingId, {
          ...(await parsedBody(request, updateTaxFilingPayloadSchema)),
          actorAdminId,
        }));
      }

      return methodNotAllowed(["GET", "HEAD", "PATCH"]);
    }

    if (segments.length === 3 && segments[0] === "filings") {
      const filingId = taxIdParamSchema.parse(segments[1]);
      const action = segments[2];

      if (action === "amendments") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }
        const filing = await createTaxFilingAmendment(repository, filingId, {
          ...(await parsedBody(request, createTaxFilingAmendmentPayloadSchema)),
          actorAdminId,
        });
        return json(filing, { status: 201 });
      }

      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const statusByAction = {
        ready: "ready",
        file: "filed",
        accept: "accepted",
        reject: "rejected",
      } as const;
      const status = statusByAction[action as keyof typeof statusByAction];
      if (status) {
        return json(await transitionTaxFiling(repository, filingId, {
          ...(await bodyWithStatus(request, taxFilingTransitionPayloadSchema, status)),
          actorAdminId,
        }));
      }
    }

    if (segments.length === 1 && segments[0] === "reconciliation-exceptions") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json(await listTaxReconciliationExceptions(
          repository,
          parseQuery(url, taxReconciliationListQuerySchema),
        ));
      }

      if (request.method === "POST") {
        const exception = await createTaxReconciliationException(repository, {
          ...(await parsedBody(request, createTaxReconciliationExceptionPayloadSchema)),
          actorAdminId,
        });
        return json(exception, { status: 201 });
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
        return json(await transitionTaxReconciliationException(
          repository,
          taxIdParamSchema.parse(segments[1]),
          action,
          {
            ...(await parsedBody(request, taxReconciliationExceptionTransitionPayloadSchema)),
            actorAdminId,
          },
        ));
      }
    }

    if (segments.length === 1 && segments[0] === "external-record-refs") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }
      const ref = await createTaxExternalRecordRef(repository, {
        ...(await parsedBody(request, createTaxExternalRefPayloadSchema)),
        actorAdminId,
      });
      return json(ref, { status: 201 });
    }

    return notFound(url.pathname);
  } catch (error) {
    if (error instanceof TaxServiceError) {
      return taxFailure(error);
    }

    if (error instanceof z.ZodError) {
      return validationFailure(error);
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Tax request failed", { errorType });
    return json(
      {
        status: "error",
        code: "TAX_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export async function handleTaxRoute(
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

      return await handleTaxRouteWithRepository(
        request,
        authResult.principal,
        createTaxRepository(db),
      );
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker Tax database failed", { errorType });
    return json(
      {
        status: "error",
        code: "TAX_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
