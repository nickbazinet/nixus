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
