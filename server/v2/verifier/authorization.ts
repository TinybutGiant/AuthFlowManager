import type { StaffPrincipal } from "../auth/staffPrincipal";

const GUIDE_VERIFIER_GRANTS = ["super_admin", "verifier_admin"] as const;

export function canUseGuideVerifier(principal: StaffPrincipal): boolean {
  return principal.permissions.some((permission) =>
    GUIDE_VERIFIER_GRANTS.includes(
      permission as (typeof GUIDE_VERIFIER_GRANTS)[number],
    ),
  );
}
