CREATE TABLE budget_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE budget_categories (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES budget_groups(id),
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_budget_categories_group_id ON budget_categories(group_id);
