CREATE TABLE recurring_expense_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
    day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recurring_templates_active ON recurring_expense_templates(is_active);
