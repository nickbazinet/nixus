ALTER TABLE expenses
ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE income_entries
ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_expenses_account_id ON expenses(account_id);
CREATE INDEX idx_income_entries_account_id ON income_entries(account_id);
