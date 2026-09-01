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
  'payroll_admin',
  'trainee_offer_portal',
  'trainee_workspace',
  'document_templates',
  'lifecycle_jobs'
));
