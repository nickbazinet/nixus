# Story 18.2: Maintenance End-to-End Verification

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want automated E2E coverage of the core maintenance workflow,
so that regressions in vehicle registration, alerting, and service logging are caught before release.

## Acceptance Criteria

1. **Playwright E2E (`apps/desktop/tests/maintenance.spec.ts`)**
   - Registers a vehicle with nickname and odometer via the maintenance UI.
   - Verifies **15** `MaintenanceTaskRow` entries on `/maintenance` after registration.
   - Verifies `MaintenanceAlertCard` on the dashboard reflects alert state for seeded/upcoming tasks.
   - Logs a service for one task and verifies task status resets (e.g., back to on-track/upcoming).
   - Verifies dashboard alert summary updates after service log (alert count or “all up to date”).

2. **i18n parity (NFR16)**
   - All keys under `maintenance.*`, `nav.maintenance`, and `dashboard.maintenance.*` exist in both `apps/desktop/src/locales/en.json` and `fr.json` with matching structure (no missing FR keys).

3. **Backup / restore (NFR12)**
   - After inserting maintenance data (vehicle + tasks + at least one service log), exporting a DB backup and restoring it preserves row counts and representative field values for `vehicles`, `maintenance_tasks`, and `maintenance_service_logs`.

## Prerequisites (blocking)

Do **not** start this story until these are **done**:

| Story | Why |
|-------|-----|
| Epic 16 (16.1–16.4) | Schema, IPC, `/maintenance` UI, 15 seeded tasks |
| Epic 17 (17.1–17.4) | `log_maintenance_service`, schedule recalculation, history |
| **18.1** | `MaintenanceAlertCard`, `useMaintenanceAlerts()`, `get_maintenance_alert_summary` |

**18.1 story file:** Not created yet — use epic AC in [epics-car-maintenance.md](../planning-artifacts/epics-car-maintenance.md#story-182-maintenance-end-to-end-verification) and UX § MaintenanceAlertCard for dashboard behavior and `data-testid="maintenance-alert-skeleton"`.

## Tasks / Subtasks

### Task 1: Playwright E2E — `maintenance.spec.ts` (AC: #1)

- [x] Create `apps/desktop/tests/maintenance.spec.ts` following existing patterns in `onboarding.spec.ts`, `assets.spec.ts`, `dashboard.spec.ts`.
- [x] Implement `setupMaintenanceTauriMock(page)` via `page.addInitScript` that handles at minimum:
  - `create_vehicle`, `get_vehicles`, `get_vehicle`, `get_maintenance_alert_summary`
  - `log_maintenance_service` (with schedule reset + alert summary refresh)
  - Dashboard deps used on `/` and `/maintenance`: `get_yearly_summary`, `get_budget_summary`, `get_top_budget_categories`, `get_current_net_worth`, `get_recent_net_worth_snapshots`, `get_spending_breakdown`, `check_onboarding_status` (return `needs_onboarding: false`)
- [x] Mock must seed **15** tasks on `create_vehicle` using canonical `task_type_key` list from architecture (same keys as `defaults.rs`).
- [x] Mock evaluator: return at least one task in `upcoming` or `due` after create (e.g., high odometer + old `last_service` anchors, or manipulate dates) so dashboard alert card is non-empty before service log.
- [x] Test flow:
  1. Go to `/maintenance` → empty state → open Add Vehicle → fill nickname + odometer → save.
  2. Assert vehicle card visible; assert **15** task rows (use stable `data-testid` — add `data-testid="maintenance-task-row"` in 16.4 if missing).
  3. Go to `/` (dashboard) → assert `MaintenanceAlertCard` shows alert copy (not empty-state prompt).
  4. Return to `/maintenance` → expand vehicle → click “Log service” on alerted task → submit form → assert row status improves.
  5. Reload dashboard → assert alert summary changed (fewer items or “All maintenance up to date” / i18n equivalent).
- [x] Add `data-testid` hooks if implementers need them (recommend):
  - `maintenance-alert-card` (card root, from 18.1)
  - `maintenance-add-vehicle`, `maintenance-vehicle-card`, `maintenance-task-row`, `maintenance-log-service-form`

**Note:** Playwright runs the Vite dev server only (`playwright.config.ts`) — no native Tauri shell. Mocks are required unless the project later adds Tauri E2E. Mirror real IPC shapes from [architecture-car-maintenance.md](../planning-artifacts/architecture-car-maintenance.md) § Format Patterns.

### Task 2: i18n key parity test (AC: #2)

- [x] Add `apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts` (Vitest) **or** a focused check inside `maintenance.spec.ts` that:
  - Loads `en.json` and `fr.json`
  - Collects all keys matching prefixes: `maintenance`, `nav.maintenance`, `dashboard.maintenance`
  - Fails if any EN key is missing in FR (and optionally warn on extra FR-only keys)
- [x] Include all 15 task keys: `maintenance.tasks.{task_type_key}` for each canonical key.
- [x] Run with `pnpm --filter @nixus/desktop test` (Vitest) and ensure CI path includes it.

Reference task keys (must have EN+FR entries):

`engine_oil_filter`, `transmission_fluid`, `brake_fluid`, `coolant`, `differential_fluid`, `power_steering_fluid`, `tire_rotation`, `tire_inspection`, `brake_inspection`, `engine_air_filter`, `cabin_air_filter`, `spark_plugs`, `suspension_inspection`, `battery_check`, `wiper_blades`

### Task 3: Backup/restore regression for maintenance tables (AC: #3)

- [x] **Do not** rely on Playwright for backup/restore — native dialogs are not available in browser tests (see [8-2-database-backup-and-restore.md](./8-2-database-backup-and-restore.md) Dev Notes).
- [x] Add Rust integration test(s) in `apps/desktop/src-tauri/src/commands/backup.rs` (or `db/maintenance.rs` tests) that:
  1. Create temp SQLite DB with migration 018 tables + one vehicle, 15 tasks, 1 service log.
  2. `PRAGMA wal_checkpoint(TRUNCATE)` then `std::fs::copy` to backup path (same as `export_backup`).
  3. Replace / open restored copy and `SELECT COUNT(*)` on `vehicles`, `maintenance_tasks`, `maintenance_service_logs`.
  4. Assert nickname, `task_type_key`, and service log `odometer_km` match.
- [ ] Optional: extend `validate_backup_file` to assert `vehicles` table exists when schema version ≥ 18 (only if migration 018 is applied in test DB).

### Task 4: Verification gate

- [x] `pnpm --filter @nixus/desktop exec playwright test maintenance.spec.ts` passes.
- [x] `pnpm --filter @nixus/desktop test` passes (includes i18n test).
- [x] `cd apps/desktop/src-tauri && cargo test` passes (includes backup maintenance test).

## Dev Notes

### Scope boundary

This story is **verification only** — no new product features. Fix production bugs only if tests expose real defects. Do not implement Epic 19 (AI maintenance tools) here.

### Architecture compliance

- **Evaluator:** Status must come from Rust `maintenance/evaluator.rs` in production; mocks may simplify but must return the same JSON field names (`status`, `km_remaining`, `days_remaining`, `worst_status`, `most_urgent_task`, etc.).
- **Query keys:** After `log_maintenance_service`, mock should emulate invalidation behavior: dashboard reads fresh `get_maintenance_alert_summary`.
- **IPC names:** `snake_case` only — see D5 in architecture addendum.
- **Tables:** `vehicles`, `maintenance_tasks`, `maintenance_service_logs` — migration `018_maintenance_tables.sql` already in repo.

### E2E mock contract (minimum types)

Align mocks with:

```typescript
// Alert summary (dashboard)
interface MaintenanceAlertSummary {
  total_alert_count: number;
  vehicle_count: number;
  vehicles_with_alerts: number;
  worst_status: 'ok' | 'upcoming' | 'due' | 'overdue';
  rows: Array<{
    vehicle_id: number;
    nickname: string;
    most_urgent_task_key: string;
    most_urgent_status: string;
    urgency_text: string; // server-computed display string for tests, or match i18n in UI assertions
  }>;
}

// create_vehicle input
{ nickname: string; odometer_km: number; make?: string; model?: string; year?: number }

// log_maintenance_service input
{ vehicle_id: number; task_id: number; service_date: string; odometer_km: number; notes?: string }
```

Use `get_maintenance_alert_summary` return shape from implemented 18.1 backend — adjust mock when 18.1 lands.

### Dashboard assertions

- Card placement: after `YearToDateCard`, before hero grid (UX-DR1).
- Loading: `data-testid="maintenance-alert-skeleton"`.
- With alerts: subtitle like “N items need attention” (i18n `dashboard.maintenance.*`).
- After service log clearing alerts: “All maintenance up to date” or zero-count subtitle.

### i18n

- Locales: `apps/desktop/src/locales/en.json`, `fr.json`.
- Namespace pattern per [tech-spec-i18n-french-english.md](./tech-spec-i18n-french-english.md): flat dotted keys.
- FR must not show raw `task_type_key` in UI (NFR16) — tests can grep rendered page in EN and FR via Playwright locale toggle if sidebar language control is available in test harness.

### Backup / restore

- Commands: `export_backup`, `import_backup` in `apps/desktop/src-tauri/src/commands/backup.rs`.
- UI triggers in `AppSidebar.tsx` — manual only; automated coverage = Rust file copy round-trip.
- NFR11/NFR12: maintenance rows live in same SQLite file as finance data; file copy includes all tables.

### Previous story (18.1) intelligence

**Status:** Story file `18-1-maintenance-alert-summary-card-on-dashboard.md` does **not** exist yet (backlog).

**From Epic 18.1 (implement before this story):**

- `MaintenanceAlertCard` in `apps/desktop/src/components/dashboard/MaintenanceAlertCard.tsx`
- Hook `useMaintenanceAlerts()` → `invoke("get_maintenance_alert_summary")`
- Wire into `apps/desktop/src/routes/index.tsx` after `YearToDateCard`
- Invalidate `["maintenance-alerts"]` on any maintenance mutation (Epic 17.3)
- UX footer “View all →” on card (optional in epic AC; include per UX spec)

### Cross-epic dependencies (for mock realism)

| Command | Epic |
|---------|------|
| `create_vehicle`, `get_vehicles`, `get_vehicle` | 16.2 |
| `/maintenance` UI, Add Vehicle SlideOver | 16.3 |
| 15 task rows on `VehicleCard` | 16.4 |
| `log_maintenance_service` | 17.3 |

### Project structure

| Area | Path |
|------|------|
| E2E | `apps/desktop/tests/maintenance.spec.ts` |
| Vitest i18n | `apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts` |
| Rust backup test | `apps/desktop/src-tauri/src/commands/backup.rs` |
| Locales | `apps/desktop/src/locales/en.json`, `fr.json` |
| Migration | `apps/desktop/src-tauri/migrations/018_maintenance_tables.sql` |

### Testing standards

- Playwright: `apps/desktop/tests/`, dev server port **1420**, mock `__TAURI_INTERNALS__.invoke`.
- Rust: `#[cfg(test)]` in command/db modules; use `tempfile` for DB copies (already a dev-dep from Story 8.2).
- Do not decrease existing Playwright/Rust test pass counts.

### References

- [epics-car-maintenance.md](../planning-artifacts/epics-car-maintenance.md) — Story 18.2 AC
- [architecture-car-maintenance.md](../planning-artifacts/architecture-car-maintenance.md) — D1–D8, E2E sequence step 10, enforcement guidelines
- [ux-design-specification.md](../planning-artifacts/ux-design-specification.md) — § Car Maintenance Module, MaintenanceAlertCard, Journey 7
- [implementation-readiness-report-car-maintenance-2026-05-29.md](../planning-artifacts/implementation-readiness-report-car-maintenance-2026-05-29.md) — Story 18.2 bundles E2E + i18n + backup (accepted)
- [8-2-database-backup-and-restore.md](./8-2-database-backup-and-restore.md) — backup commands, why Playwright skips restore UI
- [tech-spec-i18n-french-english.md](./tech-spec-i18n-french-english.md) — locale file conventions

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Fixed `statusRank is not defined` in Playwright mock `buildMaintenanceAlertSummary` (scope bug).
- Added sessionStorage persistence for mock state across `page.reload()`.

### Completion Notes List

- Extended `setupMaintenanceTauriMock` with dashboard IPC mocks and `get_maintenance_alert_summary` evaluator aligned to Rust shape.
- Added E2E flow test: register vehicle → dashboard alerts → log service → alert count decreases.
- Added Vitest i18n parity test for `maintenance.*`, `nav.maintenance`, `dashboard.maintenance.*` keys (EN/FR).
- Added Rust `maintenance_data_survives_backup_copy_roundtrip` integration test in `db/maintenance.rs`.

### File List

- `apps/desktop/tests/maintenance.spec.ts` (modified)
- `apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts` (new)
- `apps/desktop/src-tauri/src/db/maintenance.rs` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/18-2-maintenance-end-to-end-verification.md` (modified)

### Change Log

- 2026-05-29: Story 18.2 verification — E2E maintenance flow test, i18n parity test, backup round-trip test.
