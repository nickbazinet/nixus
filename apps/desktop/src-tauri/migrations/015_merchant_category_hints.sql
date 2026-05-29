CREATE TABLE merchant_category_hints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant TEXT NOT NULL,
    budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
    confidence_score REAL NOT NULL DEFAULT 1.0,
    usage_count INTEGER NOT NULL DEFAULT 1,
    last_updated TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant, budget_category_id)
);

CREATE INDEX idx_merchant_hints_merchant ON merchant_category_hints(merchant);
