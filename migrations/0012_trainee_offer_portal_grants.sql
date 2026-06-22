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

INSERT INTO "admin_user_access_grants" (
  "admin_user_id",
  "access_group",
  "source",
  "metadata"
)
SELECT
  "admin_users"."id",
  'trainee_offer_portal',
  'legacy_role_backfill',
  jsonb_build_object('legacy_role', "admin_users"."role"::text)
FROM "admin_users"
WHERE "admin_users"."role" = 'trainee_access'
  AND "admin_users"."status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "admin_user_access_grants"
    WHERE "admin_user_access_grants"."admin_user_id" = "admin_users"."id"
      AND "admin_user_access_grants"."access_group" = 'trainee_offer_portal'
      AND "admin_user_access_grants"."revoked_at" IS NULL
  );

INSERT INTO "admin_user_access_grants" (
  "admin_user_id",
  "access_group",
  "source",
  "metadata"
)
SELECT DISTINCT ON ("admin_users"."id")
  "admin_users"."id",
  'trainee_workspace',
  'offer_accepted_backfill',
  jsonb_build_object(
    'engagement_id', "admin_engagement_documents"."engagement_id",
    'document_id', "admin_engagement_documents"."id"
  )
FROM "admin_users"
JOIN "admin_engagement_documents"
  ON "admin_engagement_documents"."admin_user_id" = "admin_users"."id"
WHERE "admin_users"."role" = 'trainee_access'
  AND "admin_users"."status" = 'active'
  AND "admin_engagement_documents"."document_type" = 'offer_letter'
  AND "admin_engagement_documents"."status" = 'accepted'
  AND "admin_engagement_documents"."accepted_at" IS NOT NULL
  AND "admin_engagement_documents"."voided_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "admin_user_access_grants"
    WHERE "admin_user_access_grants"."admin_user_id" = "admin_users"."id"
      AND "admin_user_access_grants"."access_group" = 'trainee_workspace'
      AND "admin_user_access_grants"."revoked_at" IS NULL
  )
ORDER BY "admin_users"."id", "admin_engagement_documents"."accepted_at" DESC;

-- Existing active trainee_workspace grants from 0011 are intentionally not revoked here.
-- Some legacy active engagements may predate offer-letter acceptance records. Reconcile
-- those grants after reviewing production data, then rely on Phase C requireAccessGroup
-- with an active admin user status gate for enforcement.
