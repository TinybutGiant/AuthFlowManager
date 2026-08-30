ALTER TABLE "work_authorizations"
  DROP CONSTRAINT IF EXISTS "work_authorizations_type_check";

UPDATE "work_authorizations"
SET "authorization_type" = 'other'
WHERE "authorization_type" = 'other_employment_authorized';

ALTER TABLE "work_authorizations"
  ADD CONSTRAINT "work_authorizations_type_check"
    CHECK ("authorization_type" IN ('stem_opt', 'h1b', 'other'));

ALTER TABLE "personnel_audit_events"
  DROP CONSTRAINT IF EXISTS "personnel_audit_events_entity_type_check";

ALTER TABLE "personnel_audit_events"
  ADD CONSTRAINT "personnel_audit_events_entity_type_check"
    CHECK ("entity_type" IN ('worker', 'employment', 'compensation_term', 'work_authorization'));

ALTER TABLE "personnel_audit_events"
  DROP CONSTRAINT IF EXISTS "personnel_audit_events_action_check";

ALTER TABLE "personnel_audit_events"
  ADD CONSTRAINT "personnel_audit_events_action_check"
    CHECK ("action" IN (
      'created',
      'updated',
      'archived',
      'voided',
      'activated',
      'placed_on_leave',
      'returned_from_leave',
      'ended',
      'superseded'
    ));
