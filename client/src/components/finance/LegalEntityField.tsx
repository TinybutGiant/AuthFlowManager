import * as React from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type LegalEntityOption = {
  id: number;
  legalName: string;
  entityType?: string | null;
  status?: string | null;
};

export function legalEntityDisplayName(entity: LegalEntityOption) {
  return entity.legalName || `Legal entity #${entity.id}`;
}

export function getInitialLegalEntityId(
  legalEntities: LegalEntityOption[],
  existingId?: number | string | null,
) {
  if (existingId !== undefined && existingId !== null && String(existingId).trim() !== "") {
    return String(existingId);
  }
  return legalEntities.length === 1 ? String(legalEntities[0].id) : "";
}

export function parseRequiredLegalEntityId(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Legal entity is required. Configure an active legal entity before saving.");
  }
  return parsed;
}

export function LegalEntityField({
  legalEntities,
  value,
  onValueChange,
  label = "Legal entity",
  disabled = false,
  autoSelectSingle = true,
}: {
  legalEntities: LegalEntityOption[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  autoSelectSingle?: boolean;
}) {
  const singleEntity = legalEntities.length === 1 ? legalEntities[0] : null;
  const singleEntityId = singleEntity ? String(singleEntity.id) : "";

  React.useEffect(() => {
    if (autoSelectSingle && singleEntityId && value !== singleEntityId) {
      onValueChange(singleEntityId);
    }
  }, [autoSelectSingle, onValueChange, singleEntityId, value]);

  if (legalEntities.length === 0) {
    return (
      <div className="grid gap-2">
        <Label>{label}</Label>
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Legal entity configuration required
        </div>
      </div>
    );
  }

  if (singleEntity) {
    return (
      <div className="grid gap-2">
        <Label>{label}</Label>
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium">{legalEntityDisplayName(singleEntity)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">Auto-selected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder="Select legal entity" />
        </SelectTrigger>
        <SelectContent>
          {legalEntities.map((entity) => (
            <SelectItem key={entity.id} value={String(entity.id)}>
              {legalEntityDisplayName(entity)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
