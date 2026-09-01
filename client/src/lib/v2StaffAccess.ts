import type { AdminAccessGroup, AdminRole } from "@/types/admin";

export type StaffPrincipal = {
  id: string;
  email: string;
  role: AdminRole;
  permissions: AdminAccessGroup[];
};

export type V2AuthMeResponse = {
  status: "ok";
  staff: StaffPrincipal;
};

export type V2ModuleKey = "staff" | "finance" | "payroll" | "verifier";

export type V2ModuleDefinition = {
  key: V2ModuleKey;
  label: string;
  path: string;
  permission: AdminAccessGroup;
};

export const V2_MODULES: V2ModuleDefinition[] = [
  {
    key: "staff",
    label: "Staff",
    path: "/v2/staff",
    permission: "admin_operations",
  },
  {
    key: "finance",
    label: "AP Billing",
    path: "/v2/finance",
    permission: "finance_admin",
  },
  {
    key: "payroll",
    label: "Payroll",
    path: "/v2/payroll",
    permission: "payroll_admin",
  },
  {
    key: "verifier",
    label: "Guide Verifier",
    path: "/v2/verifier",
    permission: "verifier_admin",
  },
];

export async function fetchV2StaffPrincipal(): Promise<V2AuthMeResponse> {
  const response = await fetch("/api/v2/auth/me", {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code =
      body && typeof body === "object" && "code" in body
        ? String((body as { code: unknown }).code)
        : response.statusText;
    throw new Error(code);
  }

  return body as V2AuthMeResponse;
}

export function canAccessV2Module(
  permissions: readonly AdminAccessGroup[],
  module: V2ModuleDefinition,
): boolean {
  return (
    permissions.includes("super_admin") ||
    permissions.includes(module.permission)
  );
}
