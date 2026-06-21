import { storage } from "./storage";
import type { AdminEngagement } from "@shared/schema";

export interface TraineeSelfOffboardingStorage {
  selfOffboardTraineeEngagement(
    adminUserId: number,
    input: { reason?: string | null; now?: Date }
  ): Promise<{ status: "ended" | "cancelled" | "already_ended"; engagement?: AdminEngagement }>;
}

export async function selfOffboardTraineeEngagement(input: {
  adminUserId: number;
  reason?: string | null;
  now?: Date;
  storage?: TraineeSelfOffboardingStorage;
}): Promise<{ status: "ended" | "cancelled" | "already_ended"; engagement?: AdminEngagement }> {
  const selfOffboardingStorage = input.storage ?? storage;
  return selfOffboardingStorage.selfOffboardTraineeEngagement(input.adminUserId, {
    reason: input.reason ?? null,
    now: input.now,
  });
}
