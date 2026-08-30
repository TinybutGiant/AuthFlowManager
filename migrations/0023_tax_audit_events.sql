CREATE TABLE IF NOT EXISTS "tax_audit_events" (
  "id" serial PRIMARY KEY,
  "actor_admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "action" text NOT NULL,
  "changes_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "tax_audit_events_entity_type_check"
    CHECK ("entity_type" IN ('tax_agency', 'tax_registration', 'tax_liability', 'tax_filing')),
  CONSTRAINT "tax_audit_events_entity_id_check"
    CHECK ("entity_id" > 0),
  CONSTRAINT "tax_audit_events_action_check"
    CHECK ("action" IN (
      'created',
      'updated',
      'activated',
      'deactivated',
      'closed',
      'recognized',
      'disputed',
      'voided',
      'adjustment_created',
      'ready',
      'filed',
      'accepted',
      'rejected',
      'amendment_created'
    )),
  CONSTRAINT "tax_audit_events_changes_object_check"
    CHECK (jsonb_typeof("changes_json") = 'object')
);

CREATE INDEX IF NOT EXISTS "idx_tax_audit_events_entity"
  ON "tax_audit_events" ("entity_type", "entity_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_tax_audit_events_actor"
  ON "tax_audit_events" ("actor_admin_user_id", "created_at");

ALTER TABLE "tax_audit_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "tax_audit_events" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE "tax_audit_events" TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE "tax_audit_events_id_seq" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON SEQUENCE "tax_audit_events_id_seq" TO service_role;

DROP POLICY IF EXISTS "tax_audit_events_no_direct_client_access" ON "tax_audit_events";
CREATE POLICY "tax_audit_events_no_direct_client_access"
  ON "tax_audit_events"
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
