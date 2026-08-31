import {
  type AccessJwtResolverOptions,
  getVerifiedAccessEmail,
  type WorkerV2ExecutionContext,
} from "./access";
import { withAuthflowDatabase } from "../db/authflow";
import type { WorkerV2Env } from "../db/types";
import {
  buildStaffPrincipal,
  isActiveStaffUser,
  type StaffPrincipal,
  type StaffPrincipalRepository,
} from "./staffPrincipal";
import { createDrizzleStaffPrincipalRepository } from "./staffRepository";
import type { AdminAccessGroup } from "../../../shared/schema";

export type StaffAuthFailure =
  | {
      ok: false;
      status: 401;
      code: "ACCESS_REQUIRED";
      internalReason: "ACCESS_REQUIRED";
    }
  | {
      ok: false;
      status: 403;
      code: "STAFF_ACCESS_DENIED";
      internalReason:
        | "ACCESS_IDENTITY_UNAVAILABLE"
        | "ACCESS_JWT_CONFIG_MISSING"
        | "ACCESS_JWT_INVALID"
        | "STAFF_NOT_FOUND"
        | "STAFF_INACTIVE"
        | "STAFF_PERMISSION_MISSING";
    }
  | {
      ok: false;
      status: 503;
      code: "STAFF_AUTH_UNAVAILABLE";
      internalReason: "STAFF_REPOSITORY_ERROR";
    };

export type StaffAuthResult =
  | { ok: true; principal: StaffPrincipal }
  | StaffAuthFailure;

function accessDenied(
  internalReason: StaffAuthFailure["internalReason"],
): StaffAuthFailure {
  if (internalReason === "ACCESS_REQUIRED") {
    return {
      ok: false,
      status: 401,
      code: "ACCESS_REQUIRED",
      internalReason,
    };
  }

  if (internalReason === "STAFF_REPOSITORY_ERROR") {
    return {
      ok: false,
      status: 503,
      code: "STAFF_AUTH_UNAVAILABLE",
      internalReason,
    };
  }

  return {
    ok: false,
    status: 403,
    code: "STAFF_ACCESS_DENIED",
    internalReason,
  };
}

export async function resolveStaffPrincipalForEmail(
  normalizedEmail: string,
  repository: StaffPrincipalRepository,
): Promise<StaffAuthResult> {
  try {
    const staff = await repository.findStaffByNormalizedEmail(normalizedEmail);

    if (!staff) {
      return accessDenied("STAFF_NOT_FOUND");
    }

    if (!isActiveStaffUser(staff)) {
      return accessDenied("STAFF_INACTIVE");
    }

    const grants = await repository.loadAccessGrants(staff.id);

    return {
      ok: true,
      principal: buildStaffPrincipal(staff, grants),
    };
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker staff authorization failed", { errorType });
    return accessDenied("STAFF_REPOSITORY_ERROR");
  }
}

export async function resolveStaffPrincipalWithRepository(
  request: Request,
  env: WorkerV2Env,
  ctx: WorkerV2ExecutionContext,
  repository: StaffPrincipalRepository,
  options: AccessJwtResolverOptions = {},
): Promise<StaffAuthResult> {
  const accessEmail = await getVerifiedAccessEmail(request, env, ctx, options);

  if (!accessEmail.ok) {
    return accessEmail.code === "ACCESS_REQUIRED"
      ? accessDenied("ACCESS_REQUIRED")
      : accessDenied(accessEmail.code);
  }

  return await resolveStaffPrincipalForEmail(accessEmail.email, repository);
}

export async function resolveStaffPrincipalFromAuthflow(
  request: Request,
  env: WorkerV2Env,
  ctx: WorkerV2ExecutionContext,
  options: AccessJwtResolverOptions = {},
): Promise<StaffAuthResult> {
  const accessEmail = await getVerifiedAccessEmail(request, env, ctx, options);

  if (!accessEmail.ok) {
    return accessEmail.code === "ACCESS_REQUIRED"
      ? accessDenied("ACCESS_REQUIRED")
      : accessDenied(accessEmail.code);
  }

  try {
    return await withAuthflowDatabase(env, async (db) =>
      resolveStaffPrincipalForEmail(
        accessEmail.email,
        createDrizzleStaffPrincipalRepository(db),
      ),
    );
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("Worker staff authorization database failed", { errorType });
    return accessDenied("STAFF_REPOSITORY_ERROR");
  }
}

export function publicStaffAuthFailure(failure: StaffAuthFailure) {
  return {
    status: "error",
    code: failure.code,
  };
}

export function hasStaffPermission(
  principal: StaffPrincipal,
  permission: AdminAccessGroup,
): boolean {
  return principal.permissions.includes(permission);
}

export function hasAnyStaffPermission(
  principal: StaffPrincipal,
  permissions: AdminAccessGroup[],
): boolean {
  return permissions.some((permission) =>
    hasStaffPermission(principal, permission),
  );
}

export function authorizeStaffPermission(
  principal: StaffPrincipal,
  permission: AdminAccessGroup,
): { ok: true } | StaffAuthFailure {
  if (hasStaffPermission(principal, permission)) {
    return { ok: true };
  }

  return accessDenied("STAFF_PERMISSION_MISSING");
}
