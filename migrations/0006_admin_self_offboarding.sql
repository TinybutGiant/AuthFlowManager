ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "ended_at" timestamp;

ALTER TABLE "admin_lifecycle_events"
  DROP CONSTRAINT IF EXISTS "admin_lifecycle_events_type_check";

ALTER TABLE "admin_lifecycle_events"
  ADD CONSTRAINT "admin_lifecycle_events_type_check"
    CHECK ("event_type" IN (
      'engagement_created',
      'engagement_updated',
      'invitation_sent',
      'account_activated',
      'onboarding_started',
      'engagement_activated',
      'permission_granted',
      'permission_revoked',
      'office_hour_attended',
      'training_completed',
      'offboarding_started',
      'access_disabled',
      'offboarding_email_sent',
      'offboarding_email_failed',
      'engagement_ended',
      'self_offboarding_requested',
      'early_offboarding_started',
      'engagement_cancelled',
      'activity_log_submitted',
      'offer_letter_created',
      'offer_letter_pdf_generated',
      'offer_letter_sent',
      'offer_letter_viewed',
      'offer_letter_accepted',
      'offer_letter_declined',
      'offer_letter_voided'
    ));
