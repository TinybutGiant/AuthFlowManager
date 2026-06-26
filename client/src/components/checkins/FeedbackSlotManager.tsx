import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import type { FeedbackSlot } from "@/types/admin";

interface FeedbackSlotForm {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  timezone: string;
}

interface FeedbackSlotManagerProps {
  supervisorAdminId?: number | string | null;
  mode?: "manage" | "readonly";
  emptyMessage?: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function defaultFeedbackSlotForm(): FeedbackSlotForm {
  return {
    dayOfWeek: "1",
    startTime: "10:00",
    endTime: "10:30",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function getFeedbackSlotFormError(form: FeedbackSlotForm) {
  if (!form.startTime || !form.endTime) {
    return "Start and end times are required.";
  }
  if (form.endTime <= form.startTime) {
    return "End time must be after start time.";
  }
  if (!form.timezone.trim()) {
    return "Timezone is required.";
  }
  return null;
}

export function formatFeedbackSlot(slot: FeedbackSlot | { dayOfWeek: number; startTime: string; endTime: string; timezone: string }) {
  const dayOfWeek = "day_of_week" in slot ? slot.day_of_week : slot.dayOfWeek;
  const startTime = "start_time" in slot ? slot.start_time : slot.startTime;
  const endTime = "end_time" in slot ? slot.end_time : slot.endTime;
  return `${DAY_LABELS[dayOfWeek]} ${startTime}-${endTime} ${slot.timezone}`;
}

export default function FeedbackSlotManager({
  supervisorAdminId,
  mode = "readonly",
  emptyMessage = "No active Feedback Meeting slots have been defined for this supervisor.",
}: FeedbackSlotManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [slotForm, setSlotForm] = useState<FeedbackSlotForm>(() => defaultFeedbackSlotForm());
  const supervisorId = supervisorAdminId ? String(supervisorAdminId) : "";
  const slotQueryKey = ["/api/admin/feedback-slots", supervisorId];
  const formError = getFeedbackSlotFormError(slotForm);
  const canManage = mode === "manage";

  const { data: slots = [], isLoading } = useQuery<FeedbackSlot[]>({
    queryKey: slotQueryKey,
    enabled: Boolean(supervisorId),
    retry: false,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/feedback-slots?supervisorAdminId=${supervisorId}`);
      return response.json() as Promise<FeedbackSlot[]>;
    },
  });

  const createSlotMutation = useMutation({
    mutationFn: async () => {
      if (!supervisorId) {
        throw new Error("Select a supervisor.");
      }
      const validationError = getFeedbackSlotFormError(slotForm);
      if (validationError) {
        throw new Error(validationError);
      }
      const response = await apiRequest("POST", "/api/admin/feedback-slots", {
        supervisorAdminId: Number(supervisorId),
        dayOfWeek: Number(slotForm.dayOfWeek),
        startTime: slotForm.startTime,
        endTime: slotForm.endTime,
        timezone: slotForm.timezone,
      });
      return response.json() as Promise<FeedbackSlot>;
    },
    onSuccess: () => {
      setSlotForm(defaultFeedbackSlotForm());
      queryClient.invalidateQueries({ queryKey: slotQueryKey });
      toast({
        title: "Feedback Meeting slot added",
        description: "The availability list has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not add Feedback Meeting slot",
        description: getApiErrorMessage(error, "Please check the slot values and try again."),
        variant: "destructive",
      });
    },
  });

  const updateSlotMutation = useMutation({
    mutationFn: async (input: { slotId: number; status: "active" | "inactive" }) => {
      const response = await apiRequest("PATCH", `/api/admin/feedback-slots/${input.slotId}`, {
        status: input.status,
      });
      return response.json() as Promise<FeedbackSlot>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: slotQueryKey });
      toast({
        title: "Feedback Meeting slot updated",
        description: "The availability list has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update Feedback Meeting slot",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const updateForm = (field: keyof FeedbackSlotForm, value: string) => {
    setSlotForm((current) => ({ ...current, [field]: value }));
  };

  const visibleSlots = canManage ? slots : slots.filter((slot) => slot.status === "active");

  if (!supervisorId) {
    return <p className="text-sm text-muted-foreground">Set a supervisor before viewing Feedback Meeting slots.</p>;
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[180px_140px_140px_1fr_120px]">
            <Select value={slotForm.dayOfWeek} onValueChange={(value) => updateForm("dayOfWeek", value)}>
              <SelectTrigger data-testid="select-feedback-slot-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              value={slotForm.startTime}
              onChange={(event) => updateForm("startTime", event.target.value)}
              data-testid="input-feedback-slot-start"
            />
            <Input
              type="time"
              value={slotForm.endTime}
              onChange={(event) => updateForm("endTime", event.target.value)}
              data-testid="input-feedback-slot-end"
            />
            <Input
              value={slotForm.timezone}
              onChange={(event) => updateForm("timezone", event.target.value)}
              data-testid="input-feedback-slot-timezone"
            />
            <Button
              variant="outline"
              onClick={() => createSlotMutation.mutate()}
              disabled={Boolean(formError) || createSlotMutation.isPending}
              data-testid="button-add-feedback-slot"
            >
              Add Slot
            </Button>
          </div>
          {formError && (
            <p className="text-sm text-destructive" data-testid="text-feedback-slot-error">
              {formError}
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Feedback Meeting slots...</p>
      ) : visibleSlots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="space-y-2" data-testid="list-feedback-slots">
          {visibleSlots.map((slot) => (
            <div
              key={slot.id}
              className={canManage
                ? "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                : "rounded-md bg-muted/40 p-2 text-sm"}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={canManage ? "font-medium" : undefined}>{formatFeedbackSlot(slot)}</span>
                {canManage && (
                  <Badge variant={slot.status === "active" ? "default" : "secondary"}>{slot.status}</Badge>
                )}
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateSlotMutation.mutate({
                    slotId: slot.id,
                    status: slot.status === "active" ? "inactive" : "active",
                  })}
                  disabled={updateSlotMutation.isPending}
                  data-testid={`button-toggle-feedback-slot-${slot.id}`}
                >
                  {slot.status === "active" ? "Disable" : "Enable"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
