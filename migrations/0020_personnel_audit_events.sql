CREATE TABLE IF NOT EXISTS "personnel_audit_events" (
  "id" serial PRIMARY KEY,
  "actor_admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "action" text NOT NULL,
  "changes_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "personnel_audit_events_entity_type_check"
    CHECK ("entity_type" IN ('worker', 'employment', 'compensation_term')),
  CONSTRAINT "personnel_audit_events_entity_id_check"
    CHECK ("entity_id" > 0),
  CONSTRAINT "personnel_audit_events_action_check"
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
    ))
);

CREATE INDEX IF NOT EXISTS "idx_personnel_audit_events_entity"
  ON "personnel_audit_events" ("entity_type", "entity_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_personnel_audit_events_actor"
  ON "personnel_audit_events" ("actor_admin_user_id", "created_at");

ALTER TABLE "personnel_audit_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "personnel_audit_events" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE "personnel_audit_events" TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE "personnel_audit_events_id_seq" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON SEQUENCE "personnel_audit_events_id_seq" TO service_role;

DROP POLICY IF EXISTS "personnel_audit_events_no_direct_client_access" ON "personnel_audit_events";
CREATE POLICY "personnel_audit_events_no_direct_client_access"
  ON "personnel_audit_events"
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
