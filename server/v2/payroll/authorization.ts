import type { AdminAccessGroup } from "../../../shared/schema";
import type { StaffPrincipal } from "../auth/staffPrincipal";

const PAYROLL_MANAGEMENT_GRANTS = [
  "super_admin",
  "payroll_admin",
] as const satisfies readonly AdminAccessGroup[];

const payrollManagementGrants = new Set<AdminAccessGroup>(
  PAYROLL_MANAGEMENT_GRANTS,
);

export function canManagePayroll(principal: StaffPrincipal): boolean {
  return principal.permissions.some((permission) =>
    payrollManagementGrants.has(permission),
  );
}
