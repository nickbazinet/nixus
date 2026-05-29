-- Recreate expenses table with correct schema (merchant, source columns)
-- Migration 003 created the table with 'description' instead of 'merchant' and missing 'source'
DROP INDEX IF EXISTS idx_expenses_budget_category_id;
DROP INDEX IF EXISTS idx_expenses_date;
DROP TABLE IF EXISTS expenses;

CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expenses_budget_category_id ON expenses(budget_category_id);
CREATE INDEX idx_expenses_date ON expenses(date);
