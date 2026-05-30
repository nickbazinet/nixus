# Story 16.1: Maintenance Schema, Baselines & Schedule Evaluator

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the maintenance database schema, default task baselines, and schedule evaluation engine in place,
So that all maintenance IPC commands can compute accurate task status.

**Scope:** Rust-only backend foundation. No Tauri commands, no frontend, no i18n in this story. Story 16.2 adds vehicle CRUD commands and wires `db/maintenance.rs` query implementations.

## Acceptance Criteria

1. **Given** the desktop app database  
   **When** migration `018_maintenance_tables.sql` runs on startup  
   **Then** tables `vehicles`, `maintenance_tasks`, and `maintenance_service_logs` are created with columns, constraints, and indexes per architecture D2  
   **And** migration is registered as version **18** in `db/mod.rs` `MIGRATIONS`  
   **And** no FK references `passive_assets`

2. **Given** `maintenance/defaults.rs`  
   **When** loaded  
   **Then** `DEFAULT_TASKS` contains all 15 `task_type_key` entries with industry-baseline `interval_km` and `interval_months` per architecture D1  
   **And** `ALERT_KM_THRESHOLD` (500) and `ALERT_DAYS_THRESHOLD` (14) are defined as public constants  
   **And** each task has at least one of `interval_km > 0` or `interval_months > 0`  
   **And** `battery_check` and `wiper_blades` have `interval_km = 0` (time-only)

3. **Given** `maintenance/evaluator.rs`  
   **When** unit tests run (`cargo test maintenance`)  
   **Then** dual-threshold logic (FR57) correctly returns `ok`, `upcoming`, `due`, and `overdue` for km-only, time-only, and combined tasks  
   **And** never-serviced tasks anchor from vehicle `created_at` (date) and odometer 0 (km)  
   **And** combined tasks use **worst-of** status across applicable thresholds (km overdue wins over time ok; time upcoming wins over km ok)  
   **And** `TaskStatus` serializes to JSON as snake_case: `"ok"`, `"upcoming"`, `"due"`, `"overdue"`

4. **Given** `db/maintenance.rs` module skeleton  
   **When** registered in `db/mod.rs` (`pub mod maintenance`) and `lib.rs` (`mod maintenance`)  
   **Then** the module exists as the sole SQL home for maintenance (no SQL in `commands/` — commands added in Story 16.2)  
   **And** the module documents or exports the query function surface Story 16.2 will implement (see Dev Notes)  
   **And** includes at least one migration smoke test verifying all three tables exist after `018` runs

5. **Given** the full Rust backend  
   **When** `cargo check` and `cargo test` run in `apps/desktop/src-tauri/`  
   **Then** zero compiler warnings and all tests pass

## Tasks / Subtasks

- [x] Task 1: Migration 018 — maintenance tables (AC: #1)
  - [x] Create `apps/desktop/src-tauri/migrations/018_maintenance_tables.sql` per D2 schema below
  - [x] Register `(18, include_str!("../../migrations/018_maintenance_tables.sql"))` in `MIGRATIONS` in `db/mod.rs`
  - [x] Verify `UNIQUE(vehicle_id, task_type_key)` on `maintenance_tasks`
  - [x] Verify `ON DELETE CASCADE` from `vehicles` → tasks → service logs
  - [x] Confirm no reference to `passive_assets` anywhere in migration

- [x] Task 2: `maintenance/defaults.rs` — baseline library (AC: #2)
  - [x] Create `apps/desktop/src-tauri/src/maintenance/mod.rs` with `pub mod defaults; pub mod evaluator;`
  - [x] Create `defaults.rs` with `TaskBaseline` struct and `DEFAULT_TASKS: &[TaskBaseline]` (15 entries)
  - [x] Define `ALERT_KM_THRESHOLD: i64 = 500` and `ALERT_DAYS_THRESHOLD: i64 = 14`
  - [x] Unit tests: 15 entries, unique keys, each has nonzero interval, time-only tasks, threshold constants, sample baseline spot-check

- [x] Task 3: `maintenance/evaluator.rs` — schedule engine (AC: #3)
  - [x] Implement `TaskStatus` enum with `#[serde(rename_all = "snake_case")]`
  - [x] Implement `TaskEvalInput`, `TaskEvaluation`, and `evaluate_task()` per D3 dual-threshold logic
  - [x] `parse_anchor_date`: use `last_service_date` if set, else first 10 chars of `vehicle_created_at`
  - [x] Km anchor: `last_service_odometer_km.unwrap_or(0)` when never serviced
  - [x] `classify(remaining, threshold)`: `< 0` → Overdue, `== 0` → Due, `<= threshold` → Upcoming, else Ok
  - [x] `worst_of()` merges km and time statuses by severity rank
  - [x] Unit tests: km-only (ok/upcoming/due/overdue), time-only, combined (both directions), never-serviced, battery_check, wiper_blades

- [x] Task 4: `db/maintenance.rs` skeleton + migration test (AC: #4)
  - [x] Create `db/maintenance.rs` with module doc comment stating all maintenance SQL lives here
  - [x] Add `#[cfg(test)]` block with `setup_test_db()` applying migration 018 DDL
  - [x] Test `maintenance_tables_exist_after_migration` — query `sqlite_master` for three table names
  - [x] Document exported function surface (stubs or comments) for Story 16.2:
    - `insert_vehicle`, `get_all_vehicles`, `get_vehicle_by_id`, `update_vehicle`, `delete_vehicle`
    - `seed_tasks_for_vehicle` (clones `DEFAULT_TASKS`)
    - `get_tasks_for_vehicle`, `get_task_by_id`
    - `evaluate_task_with_status` (wraps `evaluator::evaluate_task`)
  - [x] Register `pub mod maintenance;` in `db/mod.rs`

- [x] Task 5: Module registration (AC: #4, #5)
  - [x] Add `mod maintenance;` in `lib.rs` (top-level domain module, alongside `mod db`)
  - [x] Run `cargo check` — zero warnings
  - [x] Run `cargo test maintenance` — all maintenance tests pass
  - [x] Run full `cargo test` — no regressions

## Dev Notes

### Critical Architecture Rules

- **Single source of truth for status:** `maintenance/evaluator.rs` only — never compute due status in frontend or commands
- **Single source for baselines/thresholds:** `maintenance/defaults.rs` only — never duplicate interval constants elsewhere
- **SQL placement:** All maintenance SQL in `db/maintenance.rs` — commands (Story 16.2+) call db functions, never write SQL inline
- **No passive_assets link:** `vehicles` is standalone (FR49). `passive_assets.asset_type = 'vehicle'` is net-worth only — no FK, no sync
- **Display names not in DB:** Frontend resolves `task_type_key` → i18n `maintenance.tasks.{task_type_key}` (Story 16.3+)
- **Status not persisted:** `TaskStatus` computed at read time; no alert state table

### Migration System

Current highest migration: **017** (`017_chat_agent_id.sql`). This story adds **018**.

Registration pattern in `apps/desktop/src-tauri/src/db/mod.rs`:

```rust
(18, include_str!("../../migrations/018_maintenance_tables.sql")),
```

Migration runner applies each version in a transaction and records in `schema_version`. Fresh DBs get all migrations sequentially on first launch.

### Migration 018 Schema (D2 — copy exactly)

```sql
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
```

**Modeling notes:**
- Odometer is integer km (not cents — not monetary)
- `maintenance_service_logs` is append-only history (FR59) — never UPDATE after insert
- At least one of `interval_km > 0` or `interval_months > 0` enforced on writes (Story 16.2 validation)

### DEFAULT_TASKS Baselines (D1)

| task_type_key | interval_km | interval_months |
|---------------|-------------|-----------------|
| engine_oil_filter | 8000 | 6 |
| transmission_fluid | 60000 | 48 |
| brake_fluid | 40000 | 24 |
| coolant | 80000 | 48 |
| differential_fluid | 60000 | 48 |
| power_steering_fluid | 80000 | 48 |
| tire_rotation | 10000 | 6 |
| tire_inspection | 10000 | 6 |
| brake_inspection | 20000 | 12 |
| engine_air_filter | 24000 | 12 |
| cabin_air_filter | 24000 | 12 |
| spark_plugs | 100000 | 60 |
| suspension_inspection | 20000 | 12 |
| battery_check | 0 | 12 |
| wiper_blades | 0 | 12 |

`TaskBaseline` struct:

```rust
pub struct TaskBaseline {
    pub task_type_key: &'static str,
    pub interval_km: i64,
    pub interval_months: i64,
}
```

### Evaluator Logic (D3 / FR57)

**Dual-threshold:** For each task, compute independent km and time due points from last-service anchors + intervals. Skip km eval when `interval_km == 0`; skip time eval when `interval_months == 0`.

**Status per dimension:**
- `remaining < 0` → Overdue
- `remaining == 0` → Due
- `0 < remaining <= threshold` → Upcoming (500 km or 14 days)
- else → Ok

**Combined status:** Take worst (highest severity) of km and time statuses.

**Never serviced:** Anchor date = vehicle `created_at` (date portion); anchor odometer = 0.

**Dependencies:** Uses `chrono::{NaiveDate, Months}` — already in project dependencies from other modules.

**Evaluation triggers (for later stories):** App launch, odometer update, service log create — no background scheduler (NFR14 satisfied by ≤5 vehicles × 15 tasks = 75 rows max).

### db/maintenance.rs Skeleton Pattern

Follow `db/asset.rs` / `db/recurring.rs` patterns. This story creates the module shell; Story 16.2 implements full query functions.

Minimum skeleton:

```rust
// Maintenance query layer — full implementations added in Story 16.2.
// All maintenance SQL lives here, not in commands/maintenance.rs.

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/018_maintenance_tables.sql")).unwrap();
        conn
    }

    #[test]
    fn maintenance_tables_exist_after_migration() {
        let conn = setup_test_db();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('vehicles', 'maintenance_tasks', 'maintenance_service_logs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }
}
```

Story 16.2 will add `Vehicle`, `MaintenanceTask`, `MaintenanceTaskWithStatus` structs to `models/mod.rs` and implement CRUD + seeding using `DEFAULT_TASKS`.

### Model Structs Preview (Story 16.2 — do NOT add in 16.1 unless needed for tests)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vehicle {
    pub id: i64,
    pub nickname: String,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i32>,
    pub odometer_km: i64,
    pub created_at: String,
    pub updated_at: String,
}
```

`MaintenanceTaskWithStatus` extends task row with evaluator fields (`status`, `km_remaining`, `days_remaining`, `next_due_date`, `next_due_odometer_km`) — computed in `db/maintenance.rs` by calling `evaluator::evaluate_task`.

### Module Registration

| File | Change |
|------|--------|
| `src-tauri/src/maintenance/mod.rs` | NEW — `pub mod defaults; pub mod evaluator;` |
| `src-tauri/src/maintenance/defaults.rs` | NEW |
| `src-tauri/src/maintenance/evaluator.rs` | NEW |
| `src-tauri/src/db/maintenance.rs` | NEW — skeleton + migration test |
| `src-tauri/src/db/mod.rs` | MODIFY — `pub mod maintenance;` + migration 018 |
| `src-tauri/src/lib.rs` | MODIFY — `mod maintenance;` |
| `src-tauri/migrations/018_maintenance_tables.sql` | NEW |

**Do NOT modify in this story:** `commands/`, frontend, `models/mod.rs` (unless test-only), `passive_assets`, `net_worth.rs`, backup/restore.

### Testing Requirements

**Rust unit tests only** — no Playwright in this story (no UI).

Run from `apps/desktop/src-tauri/`:

```bash
cargo test maintenance    # defaults + evaluator + db migration test
cargo test                # full suite, no regressions
cargo check               # zero warnings
```

**Required test coverage:**
- `defaults.rs`: 15 entries, unique keys, interval validation, time-only tasks, alert constants
- `evaluator.rs`: km-only all statuses, time-only all statuses, combined worst-of, never-serviced anchoring, battery_check, wiper_blades
- `db/maintenance.rs`: migration creates 3 tables

**Test pattern:** Follow `db/chat.rs` and `db/recurring.rs` — in-memory SQLite with `setup_test_db()` applying migration DDL via `include_str!`.

### Anti-Patterns — DO NOT

- Create `maintenance_task_templates` SQLite table — baselines are static Rust constants (D1 rejected seed table)
- Duplicate evaluator logic in commands, chat tools, or frontend
- Store display names in DB — use `task_type_key` + i18n
- Add FK from `vehicles` to `passive_assets`
- Use `car_*` or `maintenance_vehicles` table prefixes
- Add Tauri commands in this story — deferred to Story 16.2
- Persist computed `TaskStatus` in database

### Previous Epic Intelligence (Epic 15 — done)

Epic 15 established backend-first story patterns:
- Migration numbered sequentially in `MIGRATIONS` const
- DB layer in `db/*.rs`, commands orchestrate only
- `#[tauri::command(rename_all = "snake_case")]` + `Result<T, AppError>` (for Story 16.2)
- In-module `setup_test_db()` with migration DDL for unit tests
- Story 15.1 was Rust-only — same pattern applies here

### Git / Implementation State

Commit `056943e` (2026-05-29) may have partially implemented this story:
- Migration 018, `maintenance/defaults.rs`, `maintenance/evaluator.rs`, module registration
- `db/maintenance.rs` currently has comment-only skeleton — verify migration smoke test exists
- Remove `#![allow(dead_code)]` from defaults/evaluator once db layer imports them in Story 16.2

**Verification gate:** Even if code exists, confirm all ACs and run `cargo test maintenance` before marking done.

### Cross-Story Dependencies

| Story | Depends on 16.1 |
|-------|-----------------|
| 16.2 Vehicle CRUD | Migration, `DEFAULT_TASKS`, evaluator, `db/maintenance.rs` implementations |
| 16.3 Maintenance page UI | 16.2 commands + computed status from evaluator |
| 16.4 Task status on cards | Evaluator output shape |
| 17.x Service logging | Evaluator + schema |
| 18.x Dashboard alerts | Evaluator + `get_maintenance_alert_summary` (Story 18.1) |
| 19.x AI queries | db layer read functions |

### Scope Boundaries

**In scope:** Migration 018, `maintenance/defaults.rs`, `maintenance/evaluator.rs`, `db/maintenance.rs` skeleton, module registration, Rust unit tests.

**Out of scope:** Tauri commands, TypeScript types, React routes/components, i18n strings, Playwright E2E, `models/mod.rs` structs, AI chat tools, dashboard alert card.

### Project Structure Notes

All paths relative to monorepo root `/Users/nbazinet/projects/nixus`:

```
apps/desktop/src-tauri/
├── migrations/018_maintenance_tables.sql
└── src/
    ├── lib.rs                          # mod maintenance;
    ├── maintenance/
    │   ├── mod.rs
    │   ├── defaults.rs                 # DEFAULT_TASKS, ALERT_* constants
    │   └── evaluator.rs                # evaluate_task(), TaskStatus
    └── db/
        ├── mod.rs                      # pub mod maintenance; migration 18
        └── maintenance.rs              # SQL query layer skeleton
```

Aligns with `architecture-car-maintenance.md` § Structure Patterns and `architecture-desktop.md` § db/commands separation.

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md — Epic 16, Story 16.1]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md — D1, D2, D3, Implementation Patterns]
- [Source: _bmad-output/planning-artifacts/architecture-desktop.md — Migration system, db/ module patterns]
- [Source: _bmad-output/planning-artifacts/prd.md — FR57, FR58]
- [Source: docs/project-overview.md — Car maintenance capability #10, NFR14]
- [Source: apps/desktop/src-tauri/src/db/recurring.rs — setup_test_db pattern]
- [Source: apps/desktop/src-tauri/src/db/mod.rs — MIGRATIONS registration]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Verified partial implementation from prior commit; completed `db/maintenance.rs` skeleton with migration smoke test and Story 16.2 function surface documentation
- Added `task_status_serializes_as_snake_case` test to satisfy AC #3 JSON serialization requirement

### Completion Notes List

- Migration 018 creates `vehicles`, `maintenance_tasks`, and `maintenance_service_logs` with D2 schema, CASCADE FKs, and indexes — no `passive_assets` references
- `maintenance/defaults.rs` defines 15 baseline tasks, alert thresholds (500 km / 14 days), and 6 unit tests
- `maintenance/evaluator.rs` implements dual-threshold FR57 logic with worst-of merging, never-serviced anchoring, and 14 unit tests including JSON serialization
- `db/maintenance.rs` skeleton documents planned query surface for Story 16.2 and includes migration smoke test
- Module registration complete in `lib.rs` and `db/mod.rs`
- All quality gates passed: `cargo check` (zero warnings), `cargo test maintenance` (21 passed), `cargo test` (65 passed), `tsc --noEmit` (zero errors)
- Playwright skipped — Rust-only story with no frontend changes

### File List

- apps/desktop/src-tauri/migrations/018_maintenance_tables.sql
- apps/desktop/src-tauri/src/maintenance/mod.rs
- apps/desktop/src-tauri/src/maintenance/defaults.rs
- apps/desktop/src-tauri/src/maintenance/evaluator.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/db/mod.rs
- apps/desktop/src-tauri/src/lib.rs

## Change Log

- 2026-05-29: Implemented maintenance schema (migration 018), baseline library, schedule evaluator, and db layer skeleton with comprehensive Rust unit tests
