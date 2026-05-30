# Story 16.2: Vehicle Registration & CRUD Commands

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to register, view, edit, and delete vehicles with automatic maintenance schedule seeding,
So that each vehicle has a complete independent maintenance schedule from day one.

**Scope:** Rust backend only — `db/maintenance.rs`, `commands/maintenance.rs`, models, command registration, and unit tests. No React/TypeScript changes (Story 16.3). Do not implement `update_vehicle_odometer`, `update_maintenance_task`, `log_maintenance_service`, `get_service_history`, or `get_maintenance_alert_summary` (Epics 17–18).

## Acceptance Criteria

1. **Given** no vehicles exist  
   **When** `create_vehicle` is invoked with `nickname` and `odometer_km` (required) and optional `make`, `model`, `year`  
   **Then** a `vehicles` row is inserted  
   **And** exactly 15 `maintenance_tasks` rows are seeded from `maintenance::defaults::DEFAULT_TASKS` for that vehicle (FR51)  
   **And** each seeded task has `interval_km > 0` OR `interval_months > 0`

2. **Given** multiple vehicles exist  
   **When** `get_vehicles` is invoked  
   **Then** all vehicles are returned sorted by `created_at DESC` (newest first) (FR50)  
   **And** the response is `Vec<Vehicle>` only (no embedded tasks)

3. **Given** a vehicle exists  
   **When** `get_vehicle` is invoked with `id`  
   **Then** vehicle details and all 15 tasks are returned  
   **And** each task includes computed fields from `maintenance::evaluator::evaluate_task`: `status`, `km_remaining`, `days_remaining`, `next_due_date`, `next_due_odometer_km` (FR59 partial)  
   **And** `status` serializes as snake_case: `"ok"`, `"upcoming"`, `"due"`, `"overdue"`

4. **Given** a vehicle exists  
   **When** `update_vehicle` is invoked  
   **Then** `nickname`, `make`, `model`, and `year` can be updated  
   **And** `odometer_km` is **not** changed by this command (use `update_vehicle_odometer` in Epic 17)

5. **Given** a vehicle exists  
   **When** `delete_vehicle` is invoked  
   **Then** the vehicle and all related tasks and service logs are removed (SQLite `ON DELETE CASCADE`)  
   **And** an audit log entry is recorded (`entity_type`: `"vehicle"`, `action`: `"delete"`)

6. **Given** any write command  
   **When** validation fails (empty nickname, negative odometer, year outside 1900–2100)  
   **Then** `AppError::Validation` is returned with a descriptive `message` and optional `field`

7. **Given** `get_vehicle` or `delete_vehicle` with unknown `id`  
   **When** the command runs  
   **Then** `AppError` with an appropriate not-found style message is returned (match existing db patterns, e.g. income/asset)

8. **Given** implementation is complete  
   **When** `cargo test` runs in `apps/desktop/src-tauri/`  
   **Then** all existing tests pass and new maintenance db/command tests pass with zero compiler warnings

## Tasks / Subtasks

- [x] Task 1: Add maintenance models in `models/mod.rs` (AC: #1–#4)
  - [x] `Vehicle` — `id`, `nickname`, `make`, `model`, `year`, `odometer_km`, `created_at`, `updated_at`
  - [x] `MaintenanceTask` — row fields without computed status
  - [x] `MaintenanceTaskWithStatus` — task row + `status`, `km_remaining`, `days_remaining`, `next_due_date` (`Option<String>` ISO date), `next_due_odometer_km`
  - [x] `VehicleWithTasks` — `vehicle: Vehicle`, `tasks: Vec<MaintenanceTaskWithStatus>`
  - [x] `CreateVehicleInput` — `nickname`, `odometer_km`, optional `make`, `model`, `year`
  - [x] `UpdateVehicleInput` — `nickname`, `make`, `model`, `year` (no odometer)
  - [x] All derive `Debug, Clone, Serialize, Deserialize` per project-context

- [x] Task 2: Implement `db/maintenance.rs` query layer (AC: #1–#7)
  - [x] `insert_vehicle` — validate nickname (trim, non-empty), `odometer_km >= 0`, optional `year` in 1900–2100
  - [x] `seed_tasks_for_vehicle` — insert 15 rows from `DEFAULT_TASKS` in same transaction as vehicle insert
  - [x] `get_all_vehicles` — `ORDER BY created_at DESC`
  - [x] `get_vehicle_by_id` — not found → validation or database error consistent with peers
  - [x] `get_tasks_for_vehicle` — raw task rows for one `vehicle_id`
  - [x] `attach_task_status` — map task + vehicle context through `evaluate_task` (use `chrono::Local::now().date_naive()` for `today`)
  - [x] `get_vehicle_with_tasks` — compose vehicle + evaluated tasks
  - [x] `update_vehicle` — update metadata + `updated_at`; validate same rules as create
  - [x] `delete_vehicle` — `DELETE FROM vehicles WHERE id = ?`; return old JSON for audit (or fetch before delete)
  - [x] **No SQL in `commands/maintenance.rs`** — only in this file
  - [x] Unit tests: create + 15 tasks, get sort order, evaluator attachment on get_vehicle, validation errors, delete cascades tasks

- [x] Task 3: Implement `commands/maintenance.rs` (AC: #1–#7)
  - [x] `create_vehicle` — lock → `insert_vehicle` (transaction includes seed) → audit `create` → return `Vehicle`
  - [x] `get_vehicles` — lock → `get_all_vehicles`
  - [x] `get_vehicle` — lock → `get_vehicle_with_tasks` → return `VehicleWithTasks`
  - [x] `update_vehicle` — lock → capture old JSON → `update_vehicle` → audit `update`
  - [x] `delete_vehicle` — lock → capture old JSON → `delete_vehicle` → audit `delete`
  - [x] `#[tauri::command(rename_all = "snake_case")]` on all; `Result<T, AppError>`
  - [x] Audit `entity_type`: `"vehicle"` (not `"vehicles"`)

- [x] Task 4: Wire modules and register IPC (AC: #8)
  - [x] `pub mod maintenance;` in `commands/mod.rs`
  - [x] Register five commands in `lib.rs` `invoke_handler!`
  - [x] Remove `#![allow(dead_code)]` from `maintenance/defaults.rs` and `maintenance/evaluator.rs` once used
  - [x] Run `cargo check` and `cargo test` — zero warnings

## Dev Notes

### Prerequisites (Story 16.1 — DONE)

Commit `056943e` delivered:

| Artifact | Path | State |
|----------|------|--------|
| Migration 018 | `migrations/018_maintenance_tables.sql` | Registered as version 18 in `db/mod.rs` |
| Baselines | `maintenance/defaults.rs` | 15 `DEFAULT_TASKS`, `ALERT_KM_*` constants, tests |
| Evaluator | `maintenance/evaluator.rs` | `evaluate_task`, `TaskStatus`, `TaskEvaluation`, tests |
| DB skeleton | `db/maintenance.rs` | Stub comment only — **this story fills it** |
| Module | `lib.rs` | `mod maintenance` registered; **no IPC commands yet** |

Do **not** recreate migration 018 or rewrite evaluator logic unless fixing a defect.

### Critical Architecture Rules

- Schedule status computed **only** in `maintenance/evaluator.rs` — `db/maintenance.rs` calls `evaluate_task`, never duplicates threshold math
- Task seeding **only** from `DEFAULT_TASKS` — never hardcode 15 INSERTs inline in commands
- **No FK** to `passive_assets` — maintenance vehicles are standalone (FR49)
- Odometer is **integer km**, not cents — do not use `_cents` suffix
- `delete_vehicle` does **not** call `net_worth_db::record_net_worth_snapshot` (unlike accounts/assets)
- Display names for tasks are **not** stored — only `task_type_key` (i18n in frontend stories)

### `create_vehicle` Transaction Pattern

```rust
// Pseudocode — single transaction in db/maintenance.rs
conn.execute("BEGIN")?;
let vehicle = insert_vehicle_row(...)?;
for baseline in DEFAULT_TASKS {
    insert_task_row(vehicle.id, baseline.task_type_key, baseline.interval_km, baseline.interval_months)?;
}
conn.execute("COMMIT")?;
```

On failure, rollback. Commands layer only calls one db function (e.g. `insert_vehicle_with_tasks`).

### `get_vehicle` Evaluator Wiring

Build `TaskEvalInput` per task:

```rust
TaskEvalInput {
    interval_km: task.interval_km,
    interval_months: task.interval_months,
    last_service_date: task.last_service_date.clone(),
    last_service_odometer_km: task.last_service_odometer_km,
    current_odometer_km: vehicle.odometer_km,
    vehicle_created_at: vehicle.created_at.clone(),
    today: chrono::Local::now().date_naive(),
}
```

Map `TaskEvaluation` → JSON fields on `MaintenanceTaskWithStatus`. Format `next_due_date` as `"YYYY-MM-DD"` string when `Some`.

### Validation (in `db/maintenance.rs`)

| Field | Rule | `field` |
|-------|------|---------|
| `nickname` | trim; non-empty | `"nickname"` |
| `odometer_km` | `>= 0` | `"odometer_km"` |
| `year` | if `Some(y)`, `1900 <= y <= 2100` | `"year"` |

Match `AppError::Validation { message, field }` style from `db/income.rs` / `db/account.rs`.

### IPC Commands (this story only)

| Command | Returns |
|---------|---------|
| `create_vehicle` | `Vehicle` |
| `get_vehicles` | `Vec<Vehicle>` |
| `get_vehicle` | `VehicleWithTasks` |
| `update_vehicle` | `Vehicle` |
| `delete_vehicle` | `()` |

Parameter names for `invoke`: `nickname`, `odometer_km`, `make`, `model`, `year`, `id` — all snake_case.

### Audit Logging

Follow `commands/account.rs` / `commands/asset.rs`:

- **create:** `insert_audit_log(..., "vehicle", id, "create", None, Some(&json))`
- **update:** old JSON → new JSON, action `"update"`
- **delete:** old JSON, action `"delete"`
- Log failures: `tracing::error!` only — do not fail the command

### Files to Create/Modify

| File | Action |
|------|--------|
| `src-tauri/src/models/mod.rs` | ADD Vehicle, MaintenanceTask, MaintenanceTaskWithStatus, VehicleWithTasks, inputs |
| `src-tauri/src/db/maintenance.rs` | REPLACE stub with full query layer + tests |
| `src-tauri/src/commands/maintenance.rs` | NEW |
| `src-tauri/src/commands/mod.rs` | ADD `pub mod maintenance;` |
| `src-tauri/src/lib.rs` | REGISTER 5 commands in `invoke_handler!` |
| `maintenance/defaults.rs`, `evaluator.rs` | REMOVE `allow(dead_code)` when referenced |

**Do not modify:** `passive_assets`, frontend routes, i18n, `chat.rs` AI tools.

### Testing Requirements

- Rust `#[cfg(test)]` in `db/maintenance.rs` using in-memory SQLite (copy pattern from `db/income.rs` or `maintenance/evaluator.rs` test helpers)
- Cover: happy-path create (count tasks = 15), get_vehicles sort, get_vehicle status fields present, validation failures, delete removes vehicle + tasks
- Run: `cd apps/desktop/src-tauri && cargo test`
- Compilation: zero warnings per `docs/guidelines/warnings.md`

### Previous Story Intelligence (16.1)

- Migration uses `datetime('now')` for timestamps — pass full `created_at` string to evaluator (first 10 chars = date anchor for never-serviced tasks)
- `evaluator.rs` already tests time-only tasks (`battery_check`, `wiper_blades`) — reuse those baselines when seeding
- Story 16.1 left `db/maintenance.rs` as intentional stub; do not add SQL elsewhere
- All 63 tests passed at 16.1 completion — regression suite must stay green

### Git Intelligence

Recent commit `056943e` (Story 16.1) is the direct dependency. Patterns match account/asset command modules: db validation → command orchestration → audit.

### Out of Scope (do not implement here)

| Item | Story |
|------|-------|
| React `/maintenance` route, hooks, i18n | 16.3 |
| `MaintenanceTaskRow` / vehicle cards UI | 16.4 |
| `update_vehicle_odometer`, `log_maintenance_service`, interval edit | 17.x |
| `get_maintenance_alert_summary`, dashboard card | 18.x |
| AI `query_maintenance_*` tools | 19.x |
| TypeScript types / `queryKeys` | 16.3 (when frontend wires IPC) |

### Project Structure Notes

- Aligns with architecture-car-maintenance.md D5 (partial — vehicle CRUD subset only)
- One `db/` file + one `commands/` file per domain — same as budget, asset, income
- Future commands extend `commands/maintenance.rs` without splitting files

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md#Story 16.2]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md#D2, D3, D5]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md#Naming Patterns]
- [Source: docs/project-context.md#Tauri IPC Commands, Database Operations]
- [Source: apps/desktop/src-tauri/migrations/018_maintenance_tables.sql]
- [Source: apps/desktop/src-tauri/src/maintenance/defaults.rs]
- [Source: apps/desktop/src-tauri/src/maintenance/evaluator.rs]
- [Source: apps/desktop/src-tauri/src/commands/account.rs] — audit + command orchestration pattern

## Dev Agent Record

### Agent Model Used

Claude claude-4.6-opus-high-thinking (Cursor subagent)

### Debug Log References

- Added `Deserialize` to `TaskStatus` so `MaintenanceTaskWithStatus` can derive `Deserialize`

### Completion Notes List

- Implemented full vehicle CRUD query layer in `db/maintenance.rs` with transactional create + 15-task seeding from `DEFAULT_TASKS`
- Added `Vehicle`, `MaintenanceTask`, `MaintenanceTaskWithStatus`, `VehicleWithTasks`, and input models
- Created `commands/maintenance.rs` with audit logging (entity_type `"vehicle"`) following account/asset patterns
- Registered 5 IPC commands in `lib.rs`; removed `allow(dead_code)` from defaults/evaluator
- Added 11 unit tests in `db/maintenance.rs` covering create/seed, sort order, evaluator attachment, validation, cascade delete, not-found
- Rust: 75 tests pass, zero warnings (`RUSTFLAGS="-D warnings" cargo test`)
- TypeScript: `tsc --noEmit` passes
- Playwright: 160/186 pass; 26 failures are pre-existing UI tests (navigation, AI section, chat, net-worth tabs) unrelated to this backend-only story

### File List

- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/commands/mod.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src-tauri/src/maintenance/defaults.rs
- apps/desktop/src-tauri/src/maintenance/evaluator.rs

## Change Log

- 2026-05-29: Story 16.2 — vehicle registration CRUD commands, db query layer, models, IPC registration, unit tests (backend only)
