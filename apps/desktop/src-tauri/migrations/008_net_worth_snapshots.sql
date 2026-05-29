CREATE TABLE net_worth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_cents INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_net_worth_snapshots_date ON net_worth_snapshots(snapshot_date);
