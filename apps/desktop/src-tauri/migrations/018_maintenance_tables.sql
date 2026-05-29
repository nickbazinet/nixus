CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER CHECK(year IS NULL OR (year >= 1900 AND year <= 2100)),
  odometer_km INTEGER NOT NULL DEFAULT 0 CHECK(odometer_km >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE maintenance_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  task_type_key TEXT NOT NULL,
  interval_km INTEGER NOT NULL DEFAULT 0 CHECK(interval_km >= 0),
  interval_months INTEGER NOT NULL DEFAULT 0 CHECK(interval_months >= 0),
  last_service_date TEXT,
  last_service_odometer_km INTEGER CHECK(last_service_odometer_km IS NULL OR last_service_odometer_km >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vehicle_id, task_type_key)
);

CREATE TABLE maintenance_service_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  service_date TEXT NOT NULL,
  odometer_km INTEGER NOT NULL CHECK(odometer_km >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_maintenance_tasks_vehicle ON maintenance_tasks(vehicle_id);
CREATE INDEX idx_service_logs_vehicle ON maintenance_service_logs(vehicle_id);
CREATE INDEX idx_service_logs_task ON maintenance_service_logs(task_id);
