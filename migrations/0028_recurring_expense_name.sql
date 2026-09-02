-- Cloudflare V2 is the authoritative writer for Recurring Expenses.
-- After 0028, new Recurring Expense writes must be performed in Cloudflare V2.
-- The frozen legacy Render create-subscription form is intentionally not
-- compatibility-preserved for this new NOT NULL identity invariant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "recurring_expenses" LIMIT 1) THEN
    RAISE EXCEPTION '0028_recurring_expense_name requires explicit recurring expense names before migration';
  END IF;
END $$;

ALTER TABLE "recurring_expenses"
  ADD COLUMN "name" text NOT NULL;

ALTER TABLE "recurring_expenses"
  ADD CONSTRAINT "recurring_expenses_name_check"
  CHECK (btrim("name") <> '');
