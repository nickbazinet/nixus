-- Recurring templates can repeat on a weekly cadence, not only on a day of the month.
--
-- `frequency` is one of 'monthly', 'weekly', 'biweekly', 'every_four_weeks'. Validated in Rust and
-- not by a CHECK: adding a cadence later would otherwise need a full table rebuild, and every
-- existing row is monthly through the default.
--
-- `start_date` (YYYY-MM-DD) is the first date the schedule may record. For a weekly cadence it is
-- also the anchor every later occurrence is counted from, so it is always set. For a monthly one it
-- is NULL until the schedule is edited; NULL keeps the original rule of starting at `created_at`.
-- `day_of_month` stays NOT NULL and is simply unused by a weekly cadence.
ALTER TABLE recurring_expense_templates ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE recurring_expense_templates ADD COLUMN start_date TEXT;

ALTER TABLE recurring_income_templates ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE recurring_income_templates ADD COLUMN start_date TEXT;
