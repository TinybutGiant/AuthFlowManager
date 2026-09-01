import type { StaffPrincipal } from "../auth/staffPrincipal";

const FINANCE_MANAGEMENT_GRANTS = ["super_admin", "finance_admin"] as const;

export function canManageFinance(principal: StaffPrincipal): boolean {
  return principal.permissions.some((permission) =>
    FINANCE_MANAGEMENT_GRANTS.includes(
      permission as (typeof FINANCE_MANAGEMENT_GRANTS)[number],
    ),
  );
}
