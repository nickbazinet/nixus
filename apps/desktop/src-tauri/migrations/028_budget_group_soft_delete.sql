ALTER TABLE budget_groups ADD COLUMN deleted_at TEXT NULL;

CREATE INDEX idx_budget_groups_deleted_at ON budget_groups(deleted_at);
