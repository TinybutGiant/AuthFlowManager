import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import type { AdminUser, FeedbackSlot } from "@/types/admin";

interface AvailabilityBulkForm {
  dayOfWeeks: string[];
  startTime: string;
  endTime: string;
  timezone: string;
}

interface AvailabilityEditForm {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  timezone: string;
}

interface FeedbackAvailabilityEditorProps {
  supervisorAdminId?: number | string | null;
  mode?: "manage" | "readonly";
  emptyMessage?: string;
  supervisorOptions?: AdminUser[];
  selectedSupervisorId?: string;
  onSupervisorChange?: (value: string) => void;
  showSupervisorSelector?: boolean;
}

export const FEEDBACK_AVAILABILITY_DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function defaultBulkForm(): AvailabilityBulkForm {
  return {
    dayOfWeeks: ["1"],
    startTime: "19:00",
    endTime: "23:59",
    timezone: defaultTimezone(),
  };
}

function editFormFromWindow(window: FeedbackSlot): AvailabilityEditForm {
  return {
    dayOfWeek: String(window.day_of_week),
    startTime: window.start_time,
    endTime: window.end_time,
    timezone: window.timezone,
  };
}

function formatClockTime(value: string, options: { endOfDay?: boolean } = {}) {
  if (options.endOfDay && value === "23:59") return "End of Day";
  const [hourRaw, minute = "00"] = value.split(":");
  const hour = Number(hourRaw);
  if (!Number.isInteger(hour)) return value;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

export function formatAvailabilityTimeRange(window: Pick<FeedbackSlot, "start_time" | "end_time"> | { startTime: string; endTime: string }) {
  const startTime = "start_time" in window ? window.start_time : window.startTime;
  const endTime = "end_time" in window ? window.end_time : window.endTime;
  return `${formatClockTime(startTime)} - ${formatClockTime(endTime, { endOfDay: true })}`;
}

export function formatFeedbackAvailabilityWindow(window: FeedbackSlot | {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
}) {
  const dayOfWeek = "day_of_week" in window ? window.day_of_week : window.dayOfWeek;
  const timezone = window.timezone;
  return `${FEEDBACK_AVAILABILITY_DAY_LABELS[dayOfWeek]} ${formatAvailabilityTimeRange(window)} ${timezone}`;
}

function windowsOverlap(
  first: { dayOfWeek: number; startTime: string; endTime: string; timezone: string },
  second: FeedbackSlot,
) {
  return (
    first.dayOfWeek === second.day_of_week &&
    first.timezone === second.timezone &&
    first.startTime < second.end_time &&
    second.start_time < first.endTime
  );
}

function findOverlappingWindow(
  candidate: { dayOfWeek: number; startTime: string; endTime: string; timezone: string },
  windows: FeedbackSlot[],
  excludeWindowId?: number,
) {
  return windows.find((window) => (
    window.status === "active" &&
    window.id !== excludeWindowId &&
    windowsOverlap(candidate, window)
  ));
}

function getBulkFormError(form: AvailabilityBulkForm, windows: FeedbackSlot[]) {
  if (form.dayOfWeeks.length === 0) return "Select at least one weekday.";
  if (!form.startTime || !form.endTime) return "Start and end times are required.";
  if (form.endTime <= form.startTime) return "End time must be after start time.";
  if (!form.timezone.trim()) return "Timezone is required.";
  for (const dayOfWeek of form.dayOfWeeks) {
    const overlappingWindow = findOverlappingWindow({
      dayOfWeek: Number(dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
      timezone: form.timezone.trim(),
    }, windows);
    if (overlappingWindow) {
      return `${FEEDBACK_AVAILABILITY_DAY_LABELS[Number(dayOfWeek)]} overlaps ${formatAvailabilityTimeRange(overlappingWindow)}.`;
    }
  }
  return "";
}

function getEditFormError(form: AvailabilityEditForm, windows: FeedbackSlot[], currentWindow: FeedbackSlot) {
  if (!form.startTime || !form.endTime) return "Start and end times are required.";
  if (form.endTime <= form.startTime) return "End time must be after start time.";
  if (!form.timezone.trim()) return "Timezone is required.";
  if (currentWindow.status === "active") {
    const overlappingWindow = findOverlappingWindow({
      dayOfWeek: Number(form.dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
      timezone: form.timezone.trim(),
    }, windows, currentWindow.id);
    if (overlappingWindow) {
      return `This window overlaps ${formatFeedbackAvailabilityWindow(overlappingWindow)}.`;
    }
  }
  return "";
}

export default function FeedbackAvailabilityEditor({
  supervisorAdminId,
  mode = "readonly",
  emptyMessage = "No active Feedback Meeting availability windows have been defined for this supervisor.",
  supervisorOptions = [],
  selectedSupervisorId,
  onSupervisorChange,
  showSupervisorSelector = false,
}: FeedbackAvailabilityEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bulkForm, setBulkForm] = useState<AvailabilityBulkForm>(() => defaultBulkForm());
  const [showInactive, setShowInactive] = useState(false);
  const [editingWindowId, setEditingWindowId] = useState<number | null>(null);
  const [editForms, setEditForms] = useState<Record<number, AvailabilityEditForm>>({});
  const supervisorId = supervisorAdminId ? String(supervisorAdminId) : "";
  const queryKey = ["/api/admin/feedback-slots", supervisorId];
  const canManage = mode === "manage";

  const { data: windows = [], isLoading } = useQuery<FeedbackSlot[]>({
    queryKey,
    enabled: Boolean(supervisorId),
    retry: false,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/feedback-slots?supervisorAdminId=${supervisorId}`);
      return response.json() as Promise<FeedbackSlot[]>;
    },
  });

  const bulkFormError = getBulkFormError(bulkForm, windows);

  const createWindowsMutation = useMutation({
    mutationFn: async () => {
      if (!supervisorId) throw new Error("Select a supervisor.");
      const validationError = getBulkFormError(bulkForm, windows);
      if (validationError) throw new Error(validationError);
      const createdWindows = await Promise.all(bulkForm.dayOfWeeks.map(async (dayOfWeek) => {
        const response = await apiRequest("POST", "/api/admin/feedback-slots", {
          supervisorAdminId: Number(supervisorId),
          dayOfWeek: Number(dayOfWeek),
          startTime: bulkForm.startTime,
          endTime: bulkForm.endTime,
          timezone: bulkForm.timezone.trim(),
        });
        return response.json() as Promise<FeedbackSlot>;
      }));
      return createdWindows;
    },
    onSuccess: (createdWindows) => {
      setBulkForm((current) => ({
        ...defaultBulkForm(),
        timezone: current.timezone,
      }));
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Availability windows added",
        description: `${createdWindows.length} Feedback Meeting availability window${createdWindows.length === 1 ? "" : "s"} added.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not add availability windows",
        description: getApiErrorMessage(error, "Please check the availability window values and try again."),
        variant: "destructive",
      });
    },
  });

  const updateWindowMutation = useMutation({
    mutationFn: async (input: { windowId: number; updates: Partial<{ dayOfWeek: number; startTime: string; endTime: string; timezone: string; status: "active" | "inactive" }> }) => {
      const response = await apiRequest("PATCH", `/api/admin/feedback-slots/${input.windowId}`, input.updates);
      return response.json() as Promise<FeedbackSlot>;
    },
    onSuccess: (window) => {
      setEditingWindowId(null);
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Availability window updated",
        description: window.has_schedule_references
          ? "Existing confirmed trainee schedules remain unchanged unless manually updated."
          : "The supervisor availability list has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update availability window",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });

  const deleteWindowMutation = useMutation({
    mutationFn: async (windowId: number) => {
      const response = await apiRequest("DELETE", `/api/admin/feedback-slots/${windowId}`);
      return response.json() as Promise<{ deleted: boolean; id: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Availability window deleted",
        description: "The unreferenced availability window has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not delete availability window",
        description: getApiErrorMessage(error, "Deactivate referenced windows instead of deleting them."),
        variant: "destructive",
      });
    },
  });

  const updateBulkForm = (field: keyof AvailabilityBulkForm, value: string) => {
    setBulkForm((current) => ({ ...current, [field]: value }));
  };

  const toggleBulkDay = (dayOfWeek: string, checked: boolean) => {
    setBulkForm((current) => {
      const daySet = new Set(current.dayOfWeeks);
      if (checked) {
        daySet.add(dayOfWeek);
      } else {
        daySet.delete(dayOfWeek);
      }
      return {
        ...current,
        dayOfWeeks: Array.from(daySet).sort((a, b) => Number(a) - Number(b)),
      };
    });
  };

  const startEditing = (window: FeedbackSlot) => {
    setEditingWindowId(window.id);
    setEditForms((current) => ({
      ...current,
      [window.id]: current[window.id] ?? editFormFromWindow(window),
    }));
  };

  const updateEditForm = (windowId: number, field: keyof AvailabilityEditForm, value: string) => {
    setEditForms((current) => ({
      ...current,
      [windowId]: {
        ...(current[windowId] ?? {
          dayOfWeek: "1",
          startTime: "10:00",
          endTime: "10:30",
          timezone: defaultTimezone(),
        }),
        [field]: value,
      },
    }));
  };

  const saveEdit = (window: FeedbackSlot) => {
    const form = editForms[window.id] ?? editFormFromWindow(window);
    const validationError = getEditFormError(form, windows, window);
    if (validationError) return;
    updateWindowMutation.mutate({
      windowId: window.id,
      updates: {
        dayOfWeek: Number(form.dayOfWeek),
        startTime: form.startTime,
        endTime: form.endTime,
        timezone: form.timezone.trim(),
      },
    });
  };

  const groupedWindows = useMemo(() => {
    const visibleWindows = showInactive ? windows : windows.filter((window) => window.status === "active");
    return FEEDBACK_AVAILABILITY_DAY_LABELS.map((label, dayOfWeek) => ({
      label,
      windows: visibleWindows.filter((window) => window.day_of_week === dayOfWeek),
    })).filter((group) => group.windows.length > 0);
  }, [showInactive, windows]);

  if (!supervisorId) {
    return <p className="text-sm text-muted-foreground">Select a supervisor before viewing Feedback Meeting availability.</p>;
  }

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="space-y-4 rounded-md border border-border p-4" data-testid="form-feedback-availability-bulk">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(260px,1fr)]">
            {showSupervisorSelector && (
              <div>
                <Label htmlFor="feedback-availability-supervisor">Supervisor</Label>
                <Select value={selectedSupervisorId ?? supervisorId} onValueChange={onSupervisorChange}>
                  <SelectTrigger id="feedback-availability-supervisor" data-testid="select-feedback-availability-supervisor">
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

            <div>
              <Label>Weekdays</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                {FEEDBACK_AVAILABILITY_DAY_LABELS.map((label, dayOfWeek) => (
                  <label key={label} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Checkbox
                      checked={bulkForm.dayOfWeeks.includes(String(dayOfWeek))}
                      onCheckedChange={(checked) => toggleBulkDay(String(dayOfWeek), checked === true)}
                      data-testid={`checkbox-feedback-availability-day-${dayOfWeek}`}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_160px_1fr_auto]">
            <div>
              <Label htmlFor="feedback-availability-start">Start Time</Label>
              <Input
                id="feedback-availability-start"
                type="time"
                value={bulkForm.startTime}
                onChange={(event) => updateBulkForm("startTime", event.target.value)}
                data-testid="input-feedback-availability-start"
              />
            </div>
            <div>
              <Label htmlFor="feedback-availability-end">End Time</Label>
              <Input
                id="feedback-availability-end"
                type="time"
                value={bulkForm.endTime}
                onChange={(event) => updateBulkForm("endTime", event.target.value)}
                data-testid="input-feedback-availability-end"
              />
            </div>
            <div>
              <Label htmlFor="feedback-availability-timezone">Timezone</Label>
              <Input
                id="feedback-availability-timezone"
                value={bulkForm.timezone}
                onChange={(event) => updateBulkForm("timezone", event.target.value)}
                data-testid="input-feedback-availability-timezone"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => createWindowsMutation.mutate()}
                disabled={Boolean(bulkFormError) || createWindowsMutation.isPending}
                data-testid="button-add-feedback-availability"
              >
                {createWindowsMutation.isPending ? "Adding..." : "Add Availability Windows"}
              </Button>
            </div>
          </div>

          {bulkFormError && (
            <p className="text-sm text-destructive" data-testid="text-feedback-availability-error">{bulkFormError}</p>
          )}
        </div>
      )}

      {canManage && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Supervisor Availability Windows</p>
            <p className="text-xs text-muted-foreground">Existing confirmed trainee schedules remain unchanged when these windows are edited or deactivated.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} data-testid="switch-show-inactive-availability" />
            <span>Show inactive windows</span>
          </label>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Feedback Meeting availability...</p>
      ) : groupedWindows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="space-y-4" data-testid="list-feedback-availability">
          {groupedWindows.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-sm font-semibold">{group.label}</p>
              <div className="space-y-2">
                {group.windows.map((window) => {
                  const isEditing = editingWindowId === window.id;
                  const editForm = editForms[window.id] ?? editFormFromWindow(window);
                  const editError = getEditFormError(editForm, windows, window);
                  const hasReferences = Boolean(window.has_schedule_references);

                  return (
                    <div key={window.id} className="rounded-md border border-border p-3 text-sm" data-testid={`row-feedback-availability-${window.id}`}>
                      {isEditing ? (
                        <div className="space-y-3">
                          {hasReferences && (
                            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <p>Existing confirmed trainee schedules remain unchanged unless manually updated.</p>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[180px_140px_140px_1fr]">
                            <Select value={editForm.dayOfWeek} onValueChange={(value) => updateEditForm(window.id, "dayOfWeek", value)}>
                              <SelectTrigger data-testid={`select-edit-feedback-availability-day-${window.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FEEDBACK_AVAILABILITY_DAY_LABELS.map((label, dayOfWeek) => (
                                  <SelectItem key={label} value={String(dayOfWeek)}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="time"
                              value={editForm.startTime}
                              onChange={(event) => updateEditForm(window.id, "startTime", event.target.value)}
                              data-testid={`input-edit-feedback-availability-start-${window.id}`}
                            />
                            <Input
                              type="time"
                              value={editForm.endTime}
                              onChange={(event) => updateEditForm(window.id, "endTime", event.target.value)}
                              data-testid={`input-edit-feedback-availability-end-${window.id}`}
                            />
                            <Input
                              value={editForm.timezone}
                              onChange={(event) => updateEditForm(window.id, "timezone", event.target.value)}
                              data-testid={`input-edit-feedback-availability-timezone-${window.id}`}
                            />
                          </div>
                          {editError && <p className="text-sm text-destructive">{editError}</p>}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => saveEdit(window)} disabled={Boolean(editError) || updateWindowMutation.isPending}>
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingWindowId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{formatAvailabilityTimeRange(window)}</span>
                              <Badge variant={window.status === "active" ? "default" : "secondary"}>{window.status}</Badge>
                              {hasReferences && <Badge variant="outline">{window.schedule_reference_count} schedule reference{window.schedule_reference_count === 1 ? "" : "s"}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">{window.timezone}</p>
                            {hasReferences && canManage && (
                              <p className="text-xs text-amber-700">Editing or deactivating this window will not change existing confirmed trainee schedules.</p>
                            )}
                          </div>

                          {canManage && (
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => startEditing(window)} data-testid={`button-edit-feedback-availability-${window.id}`}>
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateWindowMutation.mutate({
                                  windowId: window.id,
                                  updates: { status: window.status === "active" ? "inactive" : "active" },
                                })}
                                disabled={updateWindowMutation.isPending}
                                data-testid={`button-toggle-feedback-availability-${window.id}`}
                              >
                                {window.status === "active" ? "Deactivate" : "Activate"}
                              </Button>
                              {!hasReferences && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => deleteWindowMutation.mutate(window.id)}
                                  disabled={deleteWindowMutation.isPending}
                                  data-testid={`button-delete-feedback-availability-${window.id}`}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
