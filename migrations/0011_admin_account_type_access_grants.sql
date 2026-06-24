ALTER TABLE "admin_users"
ADD COLUMN IF NOT EXISTS "account_type" text;

UPDATE "admin_users"
SET "account_type" = CASE
  WHEN "role" = 'trainee_access' THEN 'trainee'
  ELSE 'admin_staff'
END
WHERE "account_type" IS NULL;

ALTER TABLE "admin_users"
ALTER COLUMN "account_type" SET DEFAULT 'admin_staff';

ALTER TABLE "admin_users"
ALTER COLUMN "account_type" SET NOT NULL;

ALTER TABLE "admin_users"
DROP CONSTRAINT IF EXISTS "admin_users_account_type_check";

ALTER TABLE "admin_users"
ADD CONSTRAINT "admin_users_account_type_check"
CHECK ("account_type" IN ('admin_staff', 'trainee', 'contractor', 'employee', 'advisor'));

CREATE TABLE IF NOT EXISTS "admin_user_access_grants" (
  "id" serial PRIMARY KEY,
  "admin_user_id" integer NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "access_group" text NOT NULL,
  "source" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "granted_by" integer REFERENCES "admin_users"("id"),
  "granted_at" timestamp NOT NULL DEFAULT now(),
  "revoked_by" integer REFERENCES "admin_users"("id"),
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

ALTER TABLE "admin_user_access_grants"
DROP CONSTRAINT IF EXISTS "admin_user_access_grants_access_group_check";

ALTER TABLE "admin_user_access_grants"
ADD CONSTRAINT "admin_user_access_grants_access_group_check"
CHECK ("access_group" IN (
  'finance_admin',
  'verifier_admin',
  'support_admin',
  'super_admin',
  'admin_operations',
  'trainee_offer_portal',
  'trainee_workspace',
  'document_templates',
  'lifecycle_jobs'
));

CREATE INDEX IF NOT EXISTS "idx_admin_user_access_grants_admin_user_id"
ON "admin_user_access_grants" ("admin_user_id");

CREATE INDEX IF NOT EXISTS "idx_admin_user_access_grants_access_group"
ON "admin_user_access_grants" ("access_group");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_user_access_grants_active_unique"
ON "admin_user_access_grants" ("admin_user_id", "access_group")
WHERE "revoked_at" IS NULL;

ALTER TABLE "admin_user_access_grants" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_user_access_grants_no_direct_client_access"
ON "admin_user_access_grants";

CREATE POLICY "admin_user_access_grants_no_direct_client_access"
ON "admin_user_access_grants"
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

INSERT INTO "admin_user_access_grants" (
  "admin_user_id",
  "access_group",
  "source",
  "metadata"
)
SELECT
  "admin_users"."id",
  CASE "admin_users"."role"
    WHEN 'super_admin' THEN 'super_admin'
    WHEN 'admin_finance' THEN 'finance_admin'
    WHEN 'admin_verifier' THEN 'verifier_admin'
    WHEN 'admin_support' THEN 'support_admin'
    WHEN 'trainee_access' THEN 'trainee_workspace'
  END,
  'legacy_role_backfill',
  jsonb_build_object('legacy_role', "admin_users"."role"::text)
FROM "admin_users"
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_user_access_grants"
  WHERE "admin_user_access_grants"."admin_user_id" = "admin_users"."id"
    AND "admin_user_access_grants"."access_group" = CASE "admin_users"."role"
      WHEN 'super_admin' THEN 'super_admin'
      WHEN 'admin_finance' THEN 'finance_admin'
      WHEN 'admin_verifier' THEN 'verifier_admin'
      WHEN 'admin_support' THEN 'support_admin'
      WHEN 'trainee_access' THEN 'trainee_workspace'
    END
    AND "admin_user_access_grants"."revoked_at" IS NULL
);
