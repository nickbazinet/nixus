-- Gives an applied recurring-income occurrence a persistent identity. Without it, "already
-- applied" could only be inferred from source+date+amount, so editing a template's amount or day
-- made the next backfill re-create every past occurrence and re-credit the linked account.
ALTER TABLE income_entries
ADD COLUMN recurring_income_template_id INTEGER
  REFERENCES recurring_income_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_income_entries_recurring_template
  ON income_entries(recurring_income_template_id, month);
