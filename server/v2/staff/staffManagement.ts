import type {
  AdminAccessGroup,
  AdminRole,
  AdminStatus,
} from "../../../shared/schema";
import { normalizeAccessEmail } from "../auth/access";
import type { StaffPrincipal } from "../auth/staffPrincipal";
import {
  hasStaffManagementAccess,
  isV2StaffAssignableAccessGroup,
  STAFF_MANAGEMENT_ACCESS_GROUPS,
  V2_STAFF_ASSIGNABLE_ACCESS_GROUPS,
} from "./permissions";

export const V2_ADMIN_ROLES = [
  "super_admin",
  "admin_finance",
  "admin_verifier",
  "admin_support",
  "trainee_access",
] as const satisfies readonly AdminRole[];

export const STAFF_ACTIVE_STATUS = "active" as const;
export const STAFF_SUSPENDED_STATUS = "inactive" as const;
export const STAFF_CREATED_STATUS = STAFF_SUSPENDED_STATUS;

export type V2StaffRecord = {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  accountType: string;
  accessGroups: AdminAccessGroup[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type StaffCreateInput = {
  name: string;
  email: string;
  role?: AdminRole;
  accessGroups?: string[];
};

export type StaffUpdateInput = {
  name?: string;
  email?: string;
  role?: AdminRole;
};

export type StaffManagementRepository = {
  listStaff(): Promise<V2StaffRecord[]>;
  getStaffById(id: number): Promise<V2StaffRecord | undefined>;
  findStaffByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<V2StaffRecord | undefined>;
  createStaff(
    input: {
      name: string;
      email: string;
      role: AdminRole;
      status: typeof STAFF_CREATED_STATUS;
      accessGroups: AdminAccessGroup[];
    },
    actorAdminId: number,
  ): Promise<V2StaffRecord>;
  updateStaff(
    id: number,
    input: { name: string; email: string; role: AdminRole },
    actorAdminId: number,
  ): Promise<V2StaffRecord | undefined>;
  setStaffStatus(
    id: number,
    status: typeof STAFF_ACTIVE_STATUS | typeof STAFF_SUSPENDED_STATUS,
    actorAdminId: number,
  ): Promise<V2StaffRecord | undefined>;
  replaceStaffGrants(
    id: number,
    accessGroups: AdminAccessGroup[],
    actorAdminId: number,
  ): Promise<V2StaffRecord | undefined>;
};

export type StaffManagementErrorCode =
  | "STAFF_MANAGEMENT_PERMISSION_MISSING"
  | "STAFF_NOT_FOUND"
  | "DUPLICATE_EMAIL"
  | "INVALID_ACCESS_GROUP"
  | "INVALID_ROLE"
  | "INVALID_STAFF_ID"
  | "INVALID_UPDATE"
  | "SELF_LOCKOUT";

export class StaffManagementError extends Error {
  readonly code: StaffManagementErrorCode;
  readonly status: number;

  constructor(
    code: StaffManagementErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "StaffManagementError";
    this.code = code;
    this.status = status;
  }
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function assertManageStaff(principal: StaffPrincipal) {
  if (hasStaffManagementAccess(principal.permissions)) {
    return;
  }

  throw new StaffManagementError(
    "STAFF_MANAGEMENT_PERMISSION_MISSING",
    "Staff management permission is required.",
    403,
  );
}

function assertRole(role: AdminRole) {
  if (V2_ADMIN_ROLES.includes(role)) {
    return;
  }

  throw new StaffManagementError(
    "INVALID_ROLE",
    "Role is not assignable.",
    400,
  );
}

function normalizeAssignableAccessGroups(
  accessGroups: readonly string[] = [],
): AdminAccessGroup[] {
  const normalized = new Set<AdminAccessGroup>();

  for (const rawAccessGroup of accessGroups) {
    const accessGroup = rawAccessGroup.trim();
    if (!isV2StaffAssignableAccessGroup(accessGroup)) {
      throw new StaffManagementError(
        "INVALID_ACCESS_GROUP",
        "Access group is not assignable in V2 staff management.",
        400,
      );
    }
    normalized.add(accessGroup);
  }

  return Array.from(normalized);
}

function assertNotEmptyName(name: string) {
  if (normalizeName(name).length > 0) return;

  throw new StaffManagementError(
    "INVALID_UPDATE",
    "Staff name is required.",
    400,
  );
}

function assertStaffId(id: number) {
  if (Number.isInteger(id) && id > 0) return;

  throw new StaffManagementError(
    "INVALID_STAFF_ID",
    "Staff ID is invalid.",
    400,
  );
}

function isSelf(principal: StaffPrincipal, targetStaffId: number): boolean {
  return principal.id === String(targetStaffId);
}

function assertNoSelfSuspension(
  principal: StaffPrincipal,
  targetStaffId: number,
) {
  if (!isSelf(principal, targetStaffId)) {
    return;
  }

  throw new StaffManagementError(
    "SELF_LOCKOUT",
    "You cannot suspend your own staff account.",
    409,
  );
}

function assertNoSelfGrantLockout(
  principal: StaffPrincipal,
  targetStaffId: number,
  nextAccessGroups: readonly AdminAccessGroup[],
) {
  if (!isSelf(principal, targetStaffId)) {
    return;
  }

  const keepsManagementAccess = STAFF_MANAGEMENT_ACCESS_GROUPS.some(
    (accessGroup) => nextAccessGroups.includes(accessGroup),
  );

  if (keepsManagementAccess) {
    return;
  }

  throw new StaffManagementError(
    "SELF_LOCKOUT",
    "You cannot remove your own staff management access.",
    409,
  );
}

async function assertNoDuplicateNormalizedEmail(
  repository: StaffManagementRepository,
  normalizedEmail: string,
  currentStaffId?: number,
) {
  const existing = await repository.findStaffByNormalizedEmail(normalizedEmail);
  if (!existing || existing.id === currentStaffId) {
    return;
  }

  throw new StaffManagementError(
    "DUPLICATE_EMAIL",
    "A staff account already exists for that email identity.",
    409,
  );
}

async function requireStaff(
  repository: StaffManagementRepository,
  id: number,
): Promise<V2StaffRecord> {
  const staff = await repository.getStaffById(id);
  if (staff) {
    return staff;
  }

  throw new StaffManagementError(
    "STAFF_NOT_FOUND",
    "Staff account was not found.",
    404,
  );
}

export function parseStaffId(value: string | undefined): number {
  const id = Number(value);
  assertStaffId(id);
  return id;
}

export function toStaffLifecycleLabel(status: AdminStatus): "active" | "suspended" | "pending" | "rejected" {
  if (status === STAFF_SUSPENDED_STATUS) {
    return "suspended";
  }

  return status;
}

export function getAssignableAccessGroups() {
  return V2_STAFF_ASSIGNABLE_ACCESS_GROUPS;
}

export async function listManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
): Promise<V2StaffRecord[]> {
  assertManageStaff(principal);
  return await repository.listStaff();
}

export async function getManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  id: number,
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertStaffId(id);
  return await requireStaff(repository, id);
}

export async function createManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  input: StaffCreateInput,
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertNotEmptyName(input.name);

  const name = normalizeName(input.name);
  const email = normalizeAccessEmail(input.email);
  const role = input.role ?? "admin_support";
  assertRole(role);
  const accessGroups = normalizeAssignableAccessGroups(input.accessGroups);
  await assertNoDuplicateNormalizedEmail(repository, email);

  return await repository.createStaff(
    {
      name,
      email,
      role,
      status: STAFF_CREATED_STATUS,
      accessGroups,
    },
    Number(principal.id),
  );
}

export async function updateManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  id: number,
  input: StaffUpdateInput,
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertStaffId(id);

  const existing = await requireStaff(repository, id);
  const name = input.name === undefined ? existing.name : normalizeName(input.name);
  assertNotEmptyName(name);
  const email =
    input.email === undefined
      ? normalizeAccessEmail(existing.email)
      : normalizeAccessEmail(input.email);
  if (isSelf(principal, id) && email !== normalizeAccessEmail(existing.email)) {
    throw new StaffManagementError(
      "SELF_LOCKOUT",
      "You cannot change your own Access email identity.",
      409,
    );
  }
  const role = input.role ?? existing.role;
  assertRole(role);
  await assertNoDuplicateNormalizedEmail(repository, email, id);

  const updated = await repository.updateStaff(
    id,
    { name, email, role },
    Number(principal.id),
  );

  if (updated) {
    return updated;
  }

  throw new StaffManagementError(
    "STAFF_NOT_FOUND",
    "Staff account was not found.",
    404,
  );
}

export async function replaceManagedStaffGrants(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  id: number,
  accessGroups: readonly string[],
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertStaffId(id);
  await requireStaff(repository, id);

  const normalizedAccessGroups = normalizeAssignableAccessGroups(accessGroups);
  assertNoSelfGrantLockout(principal, id, normalizedAccessGroups);

  const updated = await repository.replaceStaffGrants(
    id,
    normalizedAccessGroups,
    Number(principal.id),
  );

  if (updated) {
    return updated;
  }

  throw new StaffManagementError(
    "STAFF_NOT_FOUND",
    "Staff account was not found.",
    404,
  );
}

export async function activateManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  id: number,
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertStaffId(id);
  await requireStaff(repository, id);

  const updated = await repository.setStaffStatus(
    id,
    STAFF_ACTIVE_STATUS,
    Number(principal.id),
  );

  if (updated) {
    return updated;
  }

  throw new StaffManagementError(
    "STAFF_NOT_FOUND",
    "Staff account was not found.",
    404,
  );
}

export async function suspendManagedStaff(
  repository: StaffManagementRepository,
  principal: StaffPrincipal,
  id: number,
): Promise<V2StaffRecord> {
  assertManageStaff(principal);
  assertStaffId(id);
  assertNoSelfSuspension(principal, id);
  await requireStaff(repository, id);

  const updated = await repository.setStaffStatus(
    id,
    STAFF_SUSPENDED_STATUS,
    Number(principal.id),
  );

  if (updated) {
    return updated;
  }

  throw new StaffManagementError(
    "STAFF_NOT_FOUND",
    "Staff account was not found.",
    404,
  );
}
