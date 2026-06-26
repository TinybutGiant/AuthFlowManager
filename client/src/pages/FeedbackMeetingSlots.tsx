import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarDays } from "lucide-react";
import FeedbackSlotManager from "@/components/checkins/FeedbackSlotManager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import type { AdminUser } from "@/types/admin";

function querySupervisorIdFromLocation(location: string) {
  const query = location.includes("?")
    ? location.slice(location.indexOf("?") + 1)
    : window.location.search.replace(/^\?/, "");
  return new URLSearchParams(query).get("supervisorAdminId") ?? "";
}

export default function FeedbackMeetingSlots() {
  const { user } = useAuth();
  const [location] = useLocation();
  const currentAdmin = (user as any)?.adminUser as AdminUser | undefined;
  const isSuperAdmin = currentAdmin?.role === "super_admin";
  const [selectedSupervisorId, setSelectedSupervisorId] = useState("");
  const requestedSupervisorId = useMemo(() => querySupervisorIdFromLocation(location), [location]);

  const { data: admins = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: Boolean(isSuperAdmin),
    retry: false,
  });

  const supervisorOptions = useMemo(() => (
    admins.filter((admin) => admin.status === "active" && admin.role !== "trainee_access")
  ), [admins]);

  useEffect(() => {
    if (!currentAdmin) return;
    if (!isSuperAdmin) {
      setSelectedSupervisorId(String(currentAdmin.id));
      return;
    }
    if (requestedSupervisorId && supervisorOptions.some((admin) => String(admin.id) === requestedSupervisorId)) {
      setSelectedSupervisorId(requestedSupervisorId);
      return;
    }
    if (!selectedSupervisorId && supervisorOptions.length > 0) {
      setSelectedSupervisorId(String(supervisorOptions[0].id));
    }
  }, [currentAdmin, isSuperAdmin, requestedSupervisorId, selectedSupervisorId, supervisorOptions]);

  const selectedSupervisor = isSuperAdmin
    ? supervisorOptions.find((admin) => String(admin.id) === selectedSupervisorId)
    : currentAdmin;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Feedback Meeting Slots</h1>
        <p className="text-muted-foreground">Supervisor availability for trainee Feedback Meeting schedules.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Supervisor Availability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSuperAdmin && (
            <div className="max-w-md">
              <Select value={selectedSupervisorId} onValueChange={setSelectedSupervisorId}>
                <SelectTrigger data-testid="select-feedback-slot-supervisor">
                  <SelectValue placeholder="Select supervisor" />
                </SelectTrigger>
                <SelectContent>
                  {supervisorOptions.map((admin) => (
                    <SelectItem key={admin.id} value={String(admin.id)}>
                      {admin.name} - {admin.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedSupervisor && (
            <div className="rounded-md border border-border p-3 text-sm">
              <span className="text-muted-foreground">Supervisor: </span>
              <span className="font-medium">{selectedSupervisor.name}</span>
              <span className="text-muted-foreground"> - {selectedSupervisor.email}</span>
            </div>
          )}

          <FeedbackSlotManager supervisorAdminId={selectedSupervisorId} mode="manage" />
        </CardContent>
      </Card>
    </div>
  );
}
