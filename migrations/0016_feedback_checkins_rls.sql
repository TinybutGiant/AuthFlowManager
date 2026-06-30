ALTER TABLE "supervisor_feedback_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_feedback_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_meeting_occurrences" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "supervisor_feedback_slots" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "engagement_feedback_schedules" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "feedback_meeting_occurrences" FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE "supervisor_feedback_slots_id_seq" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE "engagement_feedback_schedules_id_seq" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE "feedback_meeting_occurrences_id_seq" FROM anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE "supervisor_feedback_slots" TO service_role;
GRANT ALL PRIVILEGES ON TABLE "engagement_feedback_schedules" TO service_role;
GRANT ALL PRIVILEGES ON TABLE "feedback_meeting_occurrences" TO service_role;

GRANT ALL PRIVILEGES ON SEQUENCE "supervisor_feedback_slots_id_seq" TO service_role;
GRANT ALL PRIVILEGES ON SEQUENCE "engagement_feedback_schedules_id_seq" TO service_role;
GRANT ALL PRIVILEGES ON SEQUENCE "feedback_meeting_occurrences_id_seq" TO service_role;

DROP POLICY IF EXISTS "supervisor_feedback_slots_no_direct_client_access"
ON "supervisor_feedback_slots";

CREATE POLICY "supervisor_feedback_slots_no_direct_client_access"
ON "supervisor_feedback_slots"
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "engagement_feedback_schedules_no_direct_client_access"
ON "engagement_feedback_schedules";

CREATE POLICY "engagement_feedback_schedules_no_direct_client_access"
ON "engagement_feedback_schedules"
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "feedback_meeting_occurrences_no_direct_client_access"
ON "feedback_meeting_occurrences";

CREATE POLICY "feedback_meeting_occurrences_no_direct_client_access"
ON "feedback_meeting_occurrences"
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
