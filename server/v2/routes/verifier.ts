import { z } from "zod";
import {
  publicStaffAuthFailure,
  resolveStaffPrincipalFromAuthflow,
} from "../auth/authorize";
import type { WorkerV2ExecutionContext } from "../auth/access";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import type { WorkerV2Env } from "../db/types";
import { canUseGuideVerifier } from "../verifier/authorization";
import {
  withGuideVerifierDatabase,
  type GuideApplicationReviewUpdate,
  type GuideVerifierRepository,
} from "../verifier/repository";
import {
  localGuideBaseUrl,
  localGuidePermissionForOperation,
  localGuideStaffAssertionHeaders,
  LocalGuideProxyError,
  type LocalGuideOperation,
} from "../verifier/localGuideStaffAssertion";
import type { AdminActionType, ApplicationStatus } from "../verifier/schema";

type JsonBody = unknown;
type LocalGuideFetch = typeof fetch;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_VERIFIER_BODY_BYTES = 64 * 1024;
const MAX_LOCALGUIDE_RESPONSE_BYTES = 256 * 1024;

const applicationStatusSchema = z.enum([
  "drafted",
  "pending",
  "needs_more_info",
  "approved",
  "rejected",
]);

const adminActionSchema = z.enum([
  "review",
  "approve",
  "reject",
  "require_more_info",
]);

const applicationIdParamSchema = z.string().uuid();
const proposalIdParamSchema = z.coerce.number().int().positive();

const listApplicationsQuerySchema = z
  .object({
    status: applicationStatusSchema.optional(),
    flaggedForReview: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    userId: z.coerce.number().int().positive().optional(),
  })
  .strict();

const destinationQuerySchema = z
  .object({
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase())
      .default("JP"),
  })
  .strict();

const reviewUpdateSchema = z
  .object({
    internalTags: z
      .array(z.string().trim().min(1).max(2048))
      .nullable()
      .optional(),
    flaggedForReview: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one review field is required.",
  });

const guideApprovalProxyPayloadSchema = z
  .object({
    applicationId: applicationIdParamSchema,
    adminAction: adminActionSchema,
    note: z
      .preprocess(
        (value) => (value === null ? undefined : value),
        z.string().trim().max(4000).optional(),
      )
      .optional(),
  })
  .strict();

const mapServiceAreaProposalSchema = z
  .object({
    destinationId: z.coerce.number().int().positive(),
  })
  .strict();

const createDestinationFromProposalSchema = z
  .object({
    slug: z.string().trim().min(1).max(80).optional(),
    nameEn: z.string().trim().min(1).max(160),
    nameJa: z.string().trim().max(160).optional(),
    nameZhCn: z.string().trim().max(160).optional(),
    prefectureCode: z.string().trim().max(16).optional(),
    prefectureName: z.string().trim().max(160).optional(),
    placeType: z
      .enum(["city", "region", "prefecture", "island", "area"])
      .default("area"),
    sortOrder: z.coerce.number().int().default(1000),
    aliases: z.array(z.string().trim().min(1).max(160)).optional().default([]),
  })
  .strict();

export const verifierRouteModule = {
  name: "verifier",
  basePath: "/api/v2/verifier",
  routes: [
    "GET /api/v2/verifier",
    "GET /api/v2/verifier/applications",
    "GET /api/v2/verifier/applications/:id",
    "POST /api/v2/verifier/applications/:id/acquire-lock",
    "POST /api/v2/verifier/applications/:id/release-lock",
    "PATCH /api/v2/verifier/applications/:id/review",
    "GET /api/v2/verifier/applications/:id/approvals",
    "GET /api/v2/verifier/approvals",
    "POST /api/v2/verifier/approvals",
    "GET /api/v2/verifier/destinations",
    "POST /api/v2/verifier/service-area-proposals/:proposalId/map",
    "POST /api/v2/verifier/service-area-proposals/:proposalId/create-destination",
    "POST /api/v2/verifier/service-area-proposals/:proposalId/reject",
  ],
} as const;

export class GuideVerifierError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GuideVerifierError";
  }
}

export type VerifierRouteDependencies = {
  env: WorkerV2Env;
  localGuideFetch?: LocalGuideFetch;
  withRepository<T>(
    operation: (repository: GuideVerifierRepository) => Promise<T>,
  ): Promise<T>;
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
      message: "Invalid verifier request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function verifierFailure(error: GuideVerifierError | LocalGuideProxyError) {
  return json(
    {
      status: "error",
      code: error.code,
      message: error.message,
    },
    { status: error.statusCode },
  );
}

async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new GuideVerifierError(
      413,
      "VERIFIER_REQUEST_TOO_LARGE",
      "Request body is too large.",
    );
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      throw new GuideVerifierError(
        413,
        "VERIFIER_REQUEST_TOO_LARGE",
        "Request body is too large.",
      );
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await readBoundedText(request, MAX_VERIFIER_BODY_BYTES);
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new GuideVerifierError(
      400,
      "VERIFIER_INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_LOCALGUIDE_RESPONSE_BYTES) {
    throw new LocalGuideProxyError(
      502,
      "LOCALGUIDE_RESPONSE_TOO_LARGE",
      "LocalGuide response is too large.",
    );
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_LOCALGUIDE_RESPONSE_BYTES) {
      throw new LocalGuideProxyError(
        502,
        "LOCALGUIDE_RESPONSE_TOO_LARGE",
        "LocalGuide response is too large.",
      );
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function routeSegments(url: URL): string[] {
  return url.pathname
    .slice(verifierRouteModule.basePath.length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function parseObject<TSchema extends z.ZodTypeAny>(
  value: unknown,
  schema: TSchema,
): z.output<TSchema> {
  return schema.parse(value);
}

async function parsedBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return parseObject(await readJsonBody(request), schema);
}

function parseActorAdminId(principal: StaffPrincipal): number {
  const actorAdminId = Number(principal.id);
  if (!Number.isInteger(actorAdminId) || actorAdminId <= 0) {
    throw new GuideVerifierError(
      403,
      "STAFF_ACCESS_DENIED",
      "Current staff identity is invalid.",
    );
  }

  return actorAdminId;
}

async function acquireVerifierLock(
  repository: GuideVerifierRepository,
  applicationId: string,
  actorAdminId: number,
) {
  return await repository.transaction(async (tx) => {
    const lockedApplication = await tx.acquireApplicationLock(
      applicationId,
      actorAdminId,
    );

    if (!lockedApplication) {
      const lockedByOther = await tx.isApplicationLockedByOther(
        applicationId,
        actorAdminId,
      );
      throw new GuideVerifierError(
        lockedByOther ? 423 : 404,
        lockedByOther ? "APPLICATION_LOCKED" : "APPLICATION_NOT_FOUND",
        lockedByOther
          ? "Application is currently being reviewed by another staff member."
          : "Guide application not found.",
      );
    }

    const approvals = await tx.listGuideApplicationApprovals(applicationId);
    const alreadyReviewed = approvals.some(
      (approval) =>
        approval.adminId === actorAdminId &&
        approval.adminAction === "review",
    );

    if (!alreadyReviewed) {
      await tx.createGuideApplicationApproval({
        applicationId,
        userId: lockedApplication.userId,
        adminId: actorAdminId,
        adminAction: "review",
        note: "Started review process",
      });
    }

    return lockedApplication;
  });
}

async function getVerifierApplication(
  repository: GuideVerifierRepository,
  applicationId: string,
  actorAdminId: number,
  readonlyMode: boolean,
) {
  const application = await repository.getGuideApplication(applicationId);
  if (!application) {
    throw new GuideVerifierError(
      404,
      "APPLICATION_NOT_FOUND",
      "Guide application not found.",
    );
  }

  if (!readonlyMode) {
    const lockedByOther = await repository.isApplicationLockedByOther(
      applicationId,
      actorAdminId,
    );
    if (lockedByOther) {
      throw new GuideVerifierError(
        423,
        "APPLICATION_LOCKED",
        "Application is currently being reviewed by another staff member.",
      );
    }
  }

  return application;
}

async function updateVerifierReviewState(
  repository: GuideVerifierRepository,
  applicationId: string,
  actorAdminId: number,
  updates: GuideApplicationReviewUpdate,
) {
  const updated = await repository.updateApplicationReviewState(
    applicationId,
    actorAdminId,
    updates,
  );

  if (updated) return updated;

  const application = await repository.getGuideApplication(applicationId);
  if (!application) {
    throw new GuideVerifierError(
      404,
      "APPLICATION_NOT_FOUND",
      "Guide application not found.",
    );
  }

  throw new GuideVerifierError(
    423,
    "APPLICATION_LOCK_REQUIRED",
    "Current staff member does not hold an active review lock.",
  );
}

function operationPath(
  operation: LocalGuideOperation,
  segments: string[],
  parsedBodyValue: unknown,
) {
  if (operation === "guideApproval") {
    const body = parseObject(parsedBodyValue, guideApprovalProxyPayloadSchema);
    return {
      path: "/api/v2/guide-application-approvals-v2/staff-action",
      body: {
        applicationId: body.applicationId,
        action: body.adminAction as AdminActionType,
        ...(body.note ? { note: body.note } : {}),
      },
    };
  }

  const proposalId = proposalIdParamSchema.parse(segments[1]);
  const action = segments[2];

  if (action === "map") {
    return {
      path: `/api/v2/guide-applications/service-area-proposals/${proposalId}/map`,
      body: parseObject(parsedBodyValue, mapServiceAreaProposalSchema),
    };
  }

  if (action === "create-destination") {
    return {
      path: `/api/v2/guide-applications/service-area-proposals/${proposalId}/create-destination`,
      body: parseObject(parsedBodyValue, createDestinationFromProposalSchema),
    };
  }

  if (action === "reject") {
    return {
      path: `/api/v2/guide-applications/service-area-proposals/${proposalId}/reject`,
      body:
        parsedBodyValue && typeof parsedBodyValue === "object"
          ? parsedBodyValue
          : {},
    };
  }

  throw new GuideVerifierError(
    404,
    "NOT_FOUND",
    "Verifier service-area action not found.",
  );
}

async function forwardLocalGuideJson(input: {
  principal: StaffPrincipal;
  env: WorkerV2Env;
  fetcher: LocalGuideFetch;
  operation: LocalGuideOperation;
  path: string;
  body: unknown;
}) {
  const baseUrl = localGuideBaseUrl(input.env);
  const headers = await localGuideStaffAssertionHeaders({
    principal: input.principal,
    env: input.env,
    permission: localGuidePermissionForOperation(input.operation),
    includeJsonContentType: true,
  });

  try {
    const response = await input.fetcher(`${baseUrl}${input.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body ?? {}),
    });
    const text = await readBoundedResponseText(response);

    return new Response(text || "{}", {
      status: response.status,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    if (error instanceof LocalGuideProxyError) {
      throw error;
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker LocalGuide proxy request failed", { errorType });
    throw new LocalGuideProxyError(
      502,
      "LOCALGUIDE_PROXY_FAILED",
      "LocalGuide proxy request failed.",
    );
  }
}

export function createProductionVerifierRouteDependencies(
  env: WorkerV2Env,
): VerifierRouteDependencies {
  return {
    env,
    localGuideFetch: fetch,
    async withRepository(operation) {
      return await withGuideVerifierDatabase(env, async (repository) =>
        operation(repository),
      );
    },
  };
}

export async function handleVerifierRouteWithDependencies(
  request: Request,
  principal: StaffPrincipal,
  dependencies: VerifierRouteDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = routeSegments(url);

  try {
    const actorAdminId = parseActorAdminId(principal);

    if (!canUseGuideVerifier(principal)) {
      return json(
        {
          status: "error",
          code: "STAFF_ACCESS_DENIED",
        },
        { status: 403 },
      );
    }

    if (segments.length === 0) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }

      return json({
        status: "ok",
        module: "verifier",
      });
    }

    if (segments.length === 1 && segments[0] === "applications") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }

      const filters = listApplicationsQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      return json(
        await dependencies.withRepository((repository) =>
          repository.listGuideApplications({
            status: filters.status as ApplicationStatus | undefined,
            flaggedForReview: filters.flaggedForReview,
            userId: filters.userId,
          }),
        ),
      );
    }

    if (segments.length === 1 && segments[0] === "destinations") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }

      const query = destinationQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      return json(
        await dependencies.withRepository((repository) =>
          repository.listDestinations({
            countryCode: query.countryCode,
            status: "active",
          }),
        ),
      );
    }

    if (segments.length === 1 && segments[0] === "approvals") {
      if (request.method === "GET" || request.method === "HEAD") {
        const applicationId = url.searchParams.get("applicationId") ?? undefined;
        if (applicationId) {
          applicationIdParamSchema.parse(applicationId);
        }
        return json(
          await dependencies.withRepository((repository) =>
            repository.listGuideApplicationApprovals(applicationId),
          ),
        );
      }

      if (request.method === "POST") {
        const parsed = await readJsonBody(request);
        const target = operationPath("guideApproval", segments, parsed);
        return await forwardLocalGuideJson({
          principal,
          env: dependencies.env,
          fetcher: dependencies.localGuideFetch ?? fetch,
          operation: "guideApproval",
          ...target,
        });
      }

      return methodNotAllowed(["GET", "HEAD", "POST"]);
    }

    if (segments.length >= 2 && segments[0] === "applications") {
      const applicationId = applicationIdParamSchema.parse(segments[1]);

      if (segments.length === 2) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return methodNotAllowed(["GET", "HEAD"]);
        }

        const readonlyMode = url.searchParams.get("readonly") === "true";
        return json(
          await dependencies.withRepository((repository) =>
            getVerifierApplication(
              repository,
              applicationId,
              actorAdminId,
              readonlyMode,
            ),
          ),
        );
      }

      if (segments.length === 3 && segments[2] === "approvals") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return methodNotAllowed(["GET", "HEAD"]);
        }

        return json(
          await dependencies.withRepository((repository) =>
            repository.listGuideApplicationApprovals(applicationId),
          ),
        );
      }

      if (segments.length === 3 && segments[2] === "acquire-lock") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }

        return json(
          await dependencies.withRepository((repository) =>
            acquireVerifierLock(repository, applicationId, actorAdminId),
          ),
        );
      }

      if (segments.length === 3 && segments[2] === "release-lock") {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }

        await dependencies.withRepository((repository) =>
          repository.releaseApplicationLock(applicationId, actorAdminId),
        );
        return json({
          status: "ok",
          message: "Lock released successfully",
        });
      }

      if (segments.length === 3 && segments[2] === "review") {
        if (request.method !== "PATCH") {
          return methodNotAllowed(["PATCH"]);
        }

        const updates = await parsedBody(request, reviewUpdateSchema);
        return json(
          await dependencies.withRepository((repository) =>
            updateVerifierReviewState(
              repository,
              applicationId,
              actorAdminId,
              updates,
            ),
          ),
        );
      }
    }

    if (
      segments.length === 3 &&
      segments[0] === "service-area-proposals" &&
      ["map", "create-destination", "reject"].includes(segments[2])
    ) {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const parsed = await readJsonBody(request);
      const target = operationPath("serviceAreaProposal", segments, parsed);
      return await forwardLocalGuideJson({
        principal,
        env: dependencies.env,
        fetcher: dependencies.localGuideFetch ?? fetch,
        operation: "serviceAreaProposal",
        ...target,
      });
    }

    return notFound(url.pathname);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationFailure(error);
    }

    if (
      error instanceof GuideVerifierError ||
      error instanceof LocalGuideProxyError
    ) {
      return verifierFailure(error);
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker verifier request failed", { errorType });
    return json(
      {
        status: "error",
        code: "VERIFIER_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export async function handleVerifierRoute(
  request: Request,
  env: WorkerV2Env,
  ctx: WorkerV2ExecutionContext,
): Promise<Response> {
  const authResult = await resolveStaffPrincipalFromAuthflow(request, env, ctx);

  if (!authResult.ok) {
    return json(publicStaffAuthFailure(authResult), {
      status: authResult.status,
    });
  }

  return await handleVerifierRouteWithDependencies(
    request,
    authResult.principal,
    createProductionVerifierRouteDependencies(env),
  );
}
