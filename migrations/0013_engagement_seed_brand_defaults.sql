ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "position_title" text;

ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "school_name" text;

ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "program_or_major" text;

ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "response_deadline" date;

ALTER TABLE "admin_engagements"
  ADD COLUMN IF NOT EXISTS "work_location" text;
