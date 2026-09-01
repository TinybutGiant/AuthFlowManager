import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BadgeCheck, Home, Landmark, ReceiptText, Users, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canAccessV2Module,
  fetchV2StaffPrincipal,
  V2_MODULES,
  type V2ModuleKey,
} from "@/lib/v2StaffAccess";

const moduleIcons: Record<V2ModuleKey, LucideIcon> = {
  staff: Users,
  finance: ReceiptText,
  payroll: WalletCards,
  tax: Landmark,
  verifier: BadgeCheck,
};

function isActivePath(location: string, path: string) {
  return location === path || location.startsWith(`${path}/`);
}

export default function V2Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const staffQuery = useQuery({
    queryKey: ["v2", "auth", "me"],
    queryFn: fetchV2StaffPrincipal,
  });

  if (staffQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="text-sm text-muted-foreground">Loading V2...</div>
      </main>
    );
  }

  if (staffQuery.isError || !staffQuery.data?.staff) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <section className="mx-auto max-w-3xl rounded-md border bg-white p-6">
          <h1 className="text-lg font-semibold tracking-normal">
            Staff access unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {staffQuery.error instanceof Error
              ? staffQuery.error.message
              : "ACCESS_REQUIRED"}
          </p>
        </section>
      </main>
    );
  }

  const staff = staffQuery.data.staff;
  const visibleModules = V2_MODULES.filter((module) =>
    canAccessV2Module(staff.permissions, module),
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-normal">
                AuthFlowManager V2
              </h1>
              <p className="mt-1 break-all text-sm text-muted-foreground">
                {staff.email}
              </p>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="V2 navigation">
              <Button
                type="button"
                variant={location === "/v2" ? "default" : "outline"}
                onClick={() => setLocation("/v2")}
                aria-current={location === "/v2" ? "page" : undefined}
              >
                <Home className="h-4 w-4" />
                V2 Home
              </Button>
              {visibleModules.map((module) => {
                const Icon = moduleIcons[module.key];
                const active = isActivePath(location, module.path);

                return (
                  <Button
                    key={module.key}
                    type="button"
                    variant={active ? "default" : "outline"}
                    onClick={() => setLocation(module.path)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {module.label}
                  </Button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
