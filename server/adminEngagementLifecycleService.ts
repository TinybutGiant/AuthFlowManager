import { storage, type IStorage } from "./storage";

export interface EngagementLifecycleTransitionError {
  engagementId: number;
  phase: "activation" | "offboarding" | "feedback_schedule";
  message: string;
}

export interface EngagementLifecycleTransitionResult {
  activatedCount: number;
  offboardedCount: number;
  voidedOfferLetterCount: number;
  errors: EngagementLifecycleTransitionError[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function activateDueEngagements(
  now = new Date(),
  lifecycleStorage: IStorage = storage
): Promise<{ activatedCount: number; errors: EngagementLifecycleTransitionError[] }> {
  const dueEngagements = await lifecycleStorage.listDueTraineeEngagementsForActivation(now);
  let activatedCount = 0;
  const errors: EngagementLifecycleTransitionError[] = [];

  for (const engagement of dueEngagements) {
    try {
      const hasAcceptedOfferLetter = await lifecycleStorage.hasAcceptedOfferLetterForEngagement(engagement.id);
      if (!hasAcceptedOfferLetter) {
        continue;
      }

      const activated = await lifecycleStorage.activateTraineeEngagementLifecycle(engagement.id, now);
      if (activated) {
        activatedCount += 1;
      }
    } catch (error) {
      errors.push({
        engagementId: engagement.id,
        phase: "activation",
        message: errorMessage(error),
      });
    }
  }

  return { activatedCount, errors };
}

export async function offboardExpiredEngagements(
  now = new Date(),
  lifecycleStorage: IStorage = storage
): Promise<{ offboardedCount: number; errors: EngagementLifecycleTransitionError[] }> {
  const expiredEngagements = await lifecycleStorage.listExpiredActiveTraineeEngagements(now);
  let offboardedCount = 0;
  const errors: EngagementLifecycleTransitionError[] = [];

  for (const engagement of expiredEngagements) {
    try {
      const offboarded = await lifecycleStorage.offboardTraineeEngagementLifecycle(engagement.id, now);
      if (offboarded) {
        offboardedCount += 1;
        // TODO: Send a polite offboarding email here once offboarding email copy
        // and delivery requirements are defined. Do not emit sent/failed events
        // until the email delivery attempt actually exists.
      }
    } catch (error) {
      errors.push({
        engagementId: engagement.id,
        phase: "offboarding",
        message: errorMessage(error),
      });
    }
  }

  return { offboardedCount, errors };
}

export async function voidOffersMissingFeedbackSchedule(
  now = new Date(),
  lifecycleStorage: IStorage = storage
): Promise<{ voidedOfferLetterCount: number; errors: EngagementLifecycleTransitionError[] }> {
  const overdueDocuments = await lifecycleStorage.listAcceptedOfferLettersMissingFeedbackSchedule(now);
  let voidedOfferLetterCount = 0;
  const errors: EngagementLifecycleTransitionError[] = [];

  for (const document of overdueDocuments) {
    try {
      const voided = await lifecycleStorage.voidOfferLetterForMissingFeedbackSchedule(document.id, now);
      if (voided) {
        voidedOfferLetterCount += 1;
      }
    } catch (error) {
      errors.push({
        engagementId: document.engagementId,
        phase: "feedback_schedule",
        message: errorMessage(error),
      });
    }
  }

  return { voidedOfferLetterCount, errors };
}

export async function runEngagementLifecycleTransitions(
  now = new Date(),
  lifecycleStorage: IStorage = storage
): Promise<EngagementLifecycleTransitionResult> {
  const missingFeedbackSchedules = await voidOffersMissingFeedbackSchedule(now, lifecycleStorage);
  const activation = await activateDueEngagements(now, lifecycleStorage);
  const offboarding = await offboardExpiredEngagements(now, lifecycleStorage);

  return {
    activatedCount: activation.activatedCount,
    offboardedCount: offboarding.offboardedCount,
    voidedOfferLetterCount: missingFeedbackSchedules.voidedOfferLetterCount,
    errors: [...missingFeedbackSchedules.errors, ...activation.errors, ...offboarding.errors],
  };
}
