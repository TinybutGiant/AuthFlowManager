ALTER TABLE "admin_users"
  ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "password_setup_token_hash" text,
  ADD COLUMN IF NOT EXISTS "password_setup_expires_at" timestamp;

CREATE INDEX IF NOT EXISTS "idx_admin_users_password_setup_token_hash"
  ON "admin_users" ("password_setup_token_hash");
