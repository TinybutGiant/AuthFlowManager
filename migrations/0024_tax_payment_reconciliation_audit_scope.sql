ALTER TABLE "tax_audit_events"
  DROP CONSTRAINT IF EXISTS "tax_audit_events_entity_type_check";

ALTER TABLE "tax_audit_events"
  ADD CONSTRAINT "tax_audit_events_entity_type_check"
    CHECK ("entity_type" IN (
      'tax_agency',
      'tax_registration',
      'tax_liability',
      'tax_agency_payment',
      'tax_payment_allocation',
      'tax_filing',
      'reconciliation_exception'
    ));

ALTER TABLE "tax_audit_events"
  DROP CONSTRAINT IF EXISTS "tax_audit_events_action_check";

ALTER TABLE "tax_audit_events"
  ADD CONSTRAINT "tax_audit_events_action_check"
    CHECK ("action" IN (
      'created',
      'updated',
      'activated',
      'deactivated',
      'closed',
      'submitted',
      'cleared',
      'failed',
      'reversed',
      'recognized',
      'disputed',
      'voided',
      'adjustment_created',
      'allocation_created',
      'ready',
      'filed',
      'accepted',
      'rejected',
      'amendment_created',
      'investigating',
      'resolved',
      'waived',
      'reopened'
    ));
