-- Allow service logs without a managed maintenance task (custom/ad-hoc services)
CREATE TABLE maintenance_service_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  custom_service_name TEXT,
  service_date TEXT NOT NULL,
  odometer_km INTEGER NOT NULL CHECK(odometer_km >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (task_id IS NOT NULL AND custom_service_name IS NULL)
    OR (
      task_id IS NULL
      AND custom_service_name IS NOT NULL
      AND length(trim(custom_service_name)) > 0
    )
  )
);

INSERT INTO maintenance_service_logs_new (
  id, vehicle_id, task_id, service_date, odometer_km, notes, created_at
)
SELECT id, vehicle_id, task_id, service_date, odometer_km, notes, created_at
FROM maintenance_service_logs;

DROP TABLE maintenance_service_logs;

ALTER TABLE maintenance_service_logs_new RENAME TO maintenance_service_logs;

CREATE INDEX idx_service_logs_vehicle ON maintenance_service_logs(vehicle_id);
CREATE INDEX idx_service_logs_task ON maintenance_service_logs(task_id);
