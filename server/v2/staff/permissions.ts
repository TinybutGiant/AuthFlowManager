import type { AdminAccessGroup } from "../../../shared/schema";

export const EXISTING_ADMIN_ACCESS_GROUPS = [
  "finance_admin",
  "verifier_admin",
  "support_admin",
  "super_admin",
  "admin_operations",
  "payroll_admin",
  "tax_admin",
  "trainee_offer_portal",
  "trainee_workspace",
  "document_templates",
  "lifecycle_jobs",
] as const satisfies readonly AdminAccessGroup[];

export const V2_STAFF_ASSIGNABLE_ACCESS_GROUPS = [
  "super_admin",
  "admin_operations",
  "finance_admin",
  "payroll_admin",
  "tax_admin",
  "verifier_admin",
] as const satisfies readonly AdminAccessGroup[];

export const STAFF_MANAGEMENT_ACCESS_GROUPS = [
  "super_admin",
  "admin_operations",
] as const satisfies readonly AdminAccessGroup[];

const assignableAccessGroups = new Set<AdminAccessGroup>(
  V2_STAFF_ASSIGNABLE_ACCESS_GROUPS,
);
const managementAccessGroups = new Set<AdminAccessGroup>(
  STAFF_MANAGEMENT_ACCESS_GROUPS,
);

export function isV2StaffAssignableAccessGroup(
  value: string,
): value is AdminAccessGroup {
  return assignableAccessGroups.has(value as AdminAccessGroup);
}

export function hasStaffManagementAccess(
  permissions: readonly AdminAccessGroup[],
): boolean {
  return permissions.some((permission) =>
    managementAccessGroups.has(permission),
  );
}
