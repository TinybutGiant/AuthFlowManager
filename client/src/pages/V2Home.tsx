import { BadgeCheck, ReceiptText, Users, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  verifier: BadgeCheck,
};

export default function V2Home() {
  const [, setLocation] = useLocation();
  const staffQuery = useQuery({
    queryKey: ["v2", "auth", "me"],
    queryFn: fetchV2StaffPrincipal,
  });
  const staff = staffQuery.data?.staff;
  const visibleModules = staff
    ? V2_MODULES.filter((module) =>
        canAccessV2Module(staff.permissions, module),
      )
    : [];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="border-b pb-5">
        <h2 className="text-2xl font-semibold tracking-normal">V2 Home</h2>
      </section>

      {visibleModules.length === 0 ? (
        <section className="rounded-md border bg-white p-6 text-sm text-muted-foreground">
          No migrated modules are available for this staff identity.
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-3">
          {visibleModules.map((module) => {
            const Icon = moduleIcons[module.key];

            return (
              <article
                key={module.key}
                className="flex min-h-36 flex-col justify-between gap-5 rounded-md border bg-white p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg font-semibold tracking-normal">
                    {module.label}
                  </h3>
                </div>
                <Button
                  type="button"
                  className="w-fit"
                  onClick={() => setLocation(module.path)}
                >
                  Open
                </Button>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
