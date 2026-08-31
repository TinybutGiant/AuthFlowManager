import type {
  AdminAccessGroup,
  AdminRole,
  AdminStatus,
} from "../../../shared/schema";
import { normalizeAccessEmail } from "./access";

export type StaffUserRecord = {
  id: number;
  email: string;
  role: AdminRole;
  status: AdminStatus;
};

export type StaffAccessGrantRecord = {
  accessGroup: string;
  revokedAt: Date | null;
};

export type StaffPrincipal = {
  id: string;
  email: string;
  role: AdminRole;
  permissions: AdminAccessGroup[];
};

export type StaffPrincipalRepository = {
  findStaffByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<StaffUserRecord | undefined>;
  loadAccessGrants(adminUserId: number): Promise<StaffAccessGrantRecord[]>;
};

export function isActiveStaffUser(staff: StaffUserRecord): boolean {
  return staff.status === "active";
}

export function effectiveGrantPermissions(
  grants: StaffAccessGrantRecord[],
): AdminAccessGroup[] {
  return Array.from(
    new Set(
      grants
        .filter((grant) => grant.revokedAt === null)
        .map((grant) => grant.accessGroup as AdminAccessGroup),
    ),
  );
}

export function buildStaffPrincipal(
  staff: StaffUserRecord,
  grants: StaffAccessGrantRecord[],
): StaffPrincipal {
  return {
    id: String(staff.id),
    email: normalizeAccessEmail(staff.email),
    role: staff.role,
    permissions: effectiveGrantPermissions(grants),
  };
}
