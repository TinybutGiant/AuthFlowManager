import type { AdminRole } from "../types/admin";

export type IdentityType = "admin_staff" | "trainee";
export type AssignableAccessGroup = "finance_admin" | "verifier_admin" | "support_admin";

export const IDENTITY_TYPE_OPTIONS: Array<{ value: IdentityType; label: string }> = [
  { value: "admin_staff", label: "Admin Staff" },
  { value: "trainee", label: "Trainee" },
];

export const ASSIGNABLE_ACCESS_GROUP_OPTIONS: Array<{
  value: AssignableAccessGroup;
  label: string;
}> = [
  { value: "finance_admin", label: "Finance Admin" },
  { value: "verifier_admin", label: "Verifier Admin" },
  { value: "support_admin", label: "Support Admin" },
];

export const DEFAULT_TRAINEE_ACCESS_GROUP = {
  value: "trainee_offer_portal",
  label: "Trainee Offer Portal",
} as const;

export function deriveLegacyRoleFromIdentityAndAccessGroup(
  identityType: IdentityType | undefined,
  accessGroup: AssignableAccessGroup | undefined
): AdminRole | undefined {
  if (identityType === "trainee") {
    return "trainee_access";
  }

  if (identityType !== "admin_staff") {
    return undefined;
  }

  switch (accessGroup) {
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
