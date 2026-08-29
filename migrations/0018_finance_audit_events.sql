CREATE TABLE IF NOT EXISTS "finance_audit_events" (
  "id" serial PRIMARY KEY,
  "actor_admin_user_id" integer NOT NULL REFERENCES "admin_users" ("id"),
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "action" text NOT NULL,
  "changes_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "finance_audit_events_entity_type_check"
    CHECK ("entity_type" IN ('vendor', 'recurring_expense', 'vendor_bill')),
  CONSTRAINT "finance_audit_events_entity_id_check"
    CHECK ("entity_id" > 0),
  CONSTRAINT "finance_audit_events_action_check"
    CHECK ("action" IN (
      'created',
      'updated',
      'archived',
      'paused',
      'resumed',
      'cancelled',
      'received',
      'approved',
      'disputed',
      'voided'
    )),
  CONSTRAINT "finance_audit_events_changes_object_check"
    CHECK (jsonb_typeof("changes_json") = 'object')
);

CREATE INDEX IF NOT EXISTS "idx_finance_audit_events_entity"
  ON "finance_audit_events" ("entity_type", "entity_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_finance_audit_events_actor"
  ON "finance_audit_events" ("actor_admin_user_id", "created_at");

ALTER TABLE "finance_audit_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "finance_audit_events" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE "finance_audit_events" TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE "finance_audit_events_id_seq" FROM anon, authenticated;
GRANT ALL PRIVILEGES ON SEQUENCE "finance_audit_events_id_seq" TO service_role;

DROP POLICY IF EXISTS "finance_audit_events_no_direct_client_access" ON "finance_audit_events";
CREATE POLICY "finance_audit_events_no_direct_client_access"
  ON "finance_audit_events"
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
