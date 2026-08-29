ALTER TABLE "finance_audit_events"
  DROP CONSTRAINT IF EXISTS "finance_audit_events_entity_type_check";

ALTER TABLE "finance_audit_events"
  ADD CONSTRAINT "finance_audit_events_entity_type_check"
  CHECK ("entity_type" IN (
    'vendor',
    'recurring_expense',
    'vendor_bill',
    'expense_payment',
    'vendor_bill_application',
    'reconciliation_exception'
  ));

ALTER TABLE "finance_audit_events"
  DROP CONSTRAINT IF EXISTS "finance_audit_events_action_check";

ALTER TABLE "finance_audit_events"
  ADD CONSTRAINT "finance_audit_events_action_check"
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
    'voided',
    'posted',
    'cleared',
    'failed',
    'reversed',
    'applied',
    'investigating',
    'resolved',
    'waived',
    'reopened'
  ));
