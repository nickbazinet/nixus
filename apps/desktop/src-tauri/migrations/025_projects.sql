CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    target_date TEXT,              -- ISO 8601, nullable (no deadline required)
    priority INTEGER NOT NULL DEFAULT 0,  -- lower = higher priority, user-orderable
    icon TEXT,
    color TEXT,
    archived_at TEXT,               -- nullable; soft-delete pattern (matches budget_category_soft_delete precedent from migration 022)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'suggested')),
    date TEXT NOT NULL,             -- ISO 8601
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_project_contributions_project_id ON project_contributions(project_id);
CREATE INDEX idx_project_contributions_account_id ON project_contributions(account_id);
