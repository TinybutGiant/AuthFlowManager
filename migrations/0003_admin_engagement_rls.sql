ALTER TABLE "admin_engagements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_lifecycle_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_engagements_no_direct_client_access" ON "admin_engagements";
CREATE POLICY "admin_engagements_no_direct_client_access"
  ON "admin_engagements"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "admin_lifecycle_events_no_direct_client_access" ON "admin_lifecycle_events";
CREATE POLICY "admin_lifecycle_events_no_direct_client_access"
  ON "admin_lifecycle_events"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
