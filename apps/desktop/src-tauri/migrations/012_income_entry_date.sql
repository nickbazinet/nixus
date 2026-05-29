-- Add date column and remove UNIQUE(source_id, month) constraint.
-- SQLite requires table rebuild to drop constraints.

CREATE TABLE income_entries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing rows: derive date from month (first of month)
INSERT INTO income_entries_new (id, source_id, amount_cents, date, month, created_at, updated_at)
SELECT id, source_id, amount_cents, month || '-01', month, created_at, updated_at
FROM income_entries;

DROP TABLE income_entries;
ALTER TABLE income_entries_new RENAME TO income_entries;

CREATE INDEX idx_income_entries_source_id ON income_entries(source_id);
CREATE INDEX idx_income_entries_month ON income_entries(month);
CREATE INDEX idx_income_entries_date ON income_entries(date);
