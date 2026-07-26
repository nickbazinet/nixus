ALTER TABLE budget_categories ADD COLUMN deleted_at TEXT NULL;

CREATE INDEX idx_budget_categories_deleted_at ON budget_categories(deleted_at);
