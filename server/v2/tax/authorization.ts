import type { AdminAccessGroup } from "../../../shared/schema";
import type { StaffPrincipal } from "../auth/staffPrincipal";

const TAX_MANAGEMENT_GRANTS = [
  "super_admin",
  "tax_admin",
] as const satisfies readonly AdminAccessGroup[];

const taxManagementGrants = new Set<AdminAccessGroup>(TAX_MANAGEMENT_GRANTS);

export function canManageTax(principal: StaffPrincipal): boolean {
  return principal.permissions.some((permission) =>
    taxManagementGrants.has(permission),
  );
}
