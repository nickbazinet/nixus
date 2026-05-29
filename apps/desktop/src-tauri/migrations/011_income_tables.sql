CREATE TABLE income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  income_type TEXT NOT NULL CHECK(income_type IN ('employment', 'freelance', 'investment', 'other')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, month)
);

CREATE INDEX idx_income_entries_source_id ON income_entries(source_id);
CREATE INDEX idx_income_entries_month ON income_entries(month);
