import type { AdminAccessGroup, AdminAccountType, AdminRole } from "@shared/schema";

export const ROLE_DERIVED_ACCESS_GRANT_SOURCE = "legacy_role";
export const LEGACY_ROLE_BACKFILL_ACCESS_GRANT_SOURCE = "legacy_role_backfill";
export const ROLE_DERIVED_ACCESS_GRANT_SOURCES = [
  ROLE_DERIVED_ACCESS_GRANT_SOURCE,
  LEGACY_ROLE_BACKFILL_ACCESS_GRANT_SOURCE,
];

export function deriveAccountTypeFromLegacyRole(role: AdminRole): AdminAccountType {
  return role === "trainee_access" ? "trainee" : "admin_staff";
}

export function deriveAccessGroupsFromLegacyRole(role: AdminRole): AdminAccessGroup[] {
  switch (role) {
    case "super_admin":
      return ["super_admin"];
    case "admin_finance":
      return ["finance_admin"];
    case "admin_verifier":
      return ["verifier_admin"];
    case "admin_support":
      return ["support_admin"];
    case "trainee_access":
      return ["trainee_workspace"];
  }
}

export function deriveLegacyRoleFromAccountTypeAndAccessGroup(
  accountType: AdminAccountType,
  accessGroup?: AdminAccessGroup,
): AdminRole | undefined {
  if (accountType === "trainee") {
    return "trainee_access";
  }

  if (accountType !== "admin_staff") {
    return undefined;
  }

  switch (accessGroup) {
    case "super_admin":
      return "super_admin";
    case "finance_admin":
      return "admin_finance";
    case "verifier_admin":
      return "admin_verifier";
    case "support_admin":
      return "admin_support";
    default:
      return undefined;
  }
}
