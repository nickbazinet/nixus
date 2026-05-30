# Story 17.1: Customize Maintenance Intervals

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to customize the km and/or month interval for any maintenance task on my vehicle,
So that my schedule reflects my driving habits and manufacturer's recommendations.

## Acceptance Criteria

1. **Given** a task row on a vehicle card  
   **When** the user hovers and clicks the interval edit icon  
   **Then** `EditIntervalDialog` opens with km and months integer inputs pre-filled with current values (UX-DR5)  
   **And** helper text shows the industry baseline from `defaults.rs` (e.g., "8,000 km / 6 mo")

2. **Given** the edit dialog  
   **When** the user sets both km and months to zero and saves  
   **Then** validation prevents save with an inline error message (client-side and server-side)

3. **Given** valid interval values  
   **When** the user saves  
   **Then** `update_maintenance_task` updates the per-vehicle `maintenance_tasks` row (`interval_km`, `interval_months`) (FR52)  
   **And** the command response includes the task with **recomputed** status via `evaluator.rs` (FR57)  
   **And** a success toast shows `maintenance.toast.intervalUpdated`  
   **And** TanStack Query keys `["maintenance", vehicleId]` and `["maintenance-alerts"]` invalidate

4. **Given** a customized interval on vehicle A  
   **When** vehicle B's same `task_type_key` is viewed  
   **Then** vehicle B retains its own independent interval (FR50 — updates target a single `maintenance_tasks.id`)

## Tasks / Subtasks

- [x] Task 1: Baseline lookup helper in Rust (AC: #1)
  - [x] In `apps/desktop/src-tauri/src/maintenance/defaults.rs`, add `pub fn baseline_for(task_type_key: &str) -> Option<&'static TaskBaseline>`
  - [x] Add unit test: known key returns baseline; unknown key returns `None`
  - [x] Remove `#![allow(dead_code)]` from `defaults.rs` when functions are used

- [x] Task 2: DB layer — `update_maintenance_task` (AC: #2, #3, #4)
  - [x] In `apps/desktop/src-tauri/src/db/maintenance.rs`, implement `update_maintenance_task_intervals(conn, task_id, interval_km, interval_months) -> Result<MaintenanceTaskWithStatus, AppError>`
  - [x] Validate: `interval_km >= 0`, `interval_months >= 0`, and at least one `> 0` — else `AppError::Validation { message, field }`
  - [x] `UPDATE maintenance_tasks SET interval_km = ?1, interval_months = ?2, updated_at = datetime('now') WHERE id = ?3`
  - [x] Load vehicle row for `current_odometer_km` and `created_at`; load task row; call `evaluate_task()`; return DTO with status fields + `default_interval_km` / `default_interval_months` from `baseline_for(task_type_key)`
  - [x] Add `#[cfg(test)]` tests: valid update, both-zero rejected, unknown `task_id` error

- [x] Task 3: Tauri command + registration (AC: #3)
  - [x] Create or extend `apps/desktop/src-tauri/src/commands/maintenance.rs` with:
    ```rust
    #[tauri::command(rename_all = "snake_case")]
    pub fn update_maintenance_task(
        state: State<DbState>,
        task_id: i64,
        interval_km: i64,
        interval_months: i64,
    ) -> Result<MaintenanceTaskWithStatus, AppError>
    ```
  - [x] Command orchestrates only: lock DB → call `maintenance_db::update_maintenance_task_intervals` — **no SQL in commands**
  - [x] Register in `apps/desktop/src-tauri/src/lib.rs` `invoke_handler!` (add `mod commands::maintenance` if missing from Story 16.2)
  - [x] Add/extend serde structs in `models/mod.rs` (or dedicated maintenance models) matching IPC shape below

- [x] Task 4: TypeScript types, query keys, hook (AC: #3)
  - [x] Extend `MaintenanceTaskWithStatus` in `apps/desktop/src/lib/types.ts` with optional `default_interval_km` and `default_interval_months` (for baseline hint)
  - [x] Add to `queryKeys` in `apps/desktop/src/lib/constants.ts`:
    - `maintenance: ["maintenance"]`
    - `maintenanceVehicle: (vehicleId: number) => ["maintenance", vehicleId]`
    - `maintenanceAlerts: ["maintenance-alerts"]`
  - [x] Create `apps/desktop/src/hooks/useMaintenance.ts` (if not from 16.3) with `useUpdateMaintenanceTask()` mutation calling `invoke("update_maintenance_task", { task_id, interval_km, interval_months })`
  - [x] `onSuccess`: invalidate `queryKeys.maintenanceVehicle(vehicleId)` and `queryKeys.maintenanceAlerts`

- [x] Task 5: `EditIntervalDialog` component (AC: #1, #2)
  - [x] Create `apps/desktop/src/components/maintenance/EditIntervalDialog.tsx`
  - [x] Props: `open`, `onOpenChange`, `task: MaintenanceTaskWithStatus`, `vehicleId: number`
  - [x] shadcn `Dialog` + `react-hook-form` with integer `Input` fields (km, months), pre-filled from `task.interval_*`
  - [x] Helper text: `t("maintenance.interval.baselineHint", { km, months })` using `default_interval_*` from IPC (format km with `toLocaleString`, months as integer)
  - [x] Client validation: both zero → inline error `maintenance.interval.bothZeroError`; block submit
  - [x] Save calls `useUpdateMaintenanceTask`; success toast `maintenance.toast.intervalUpdated`; close dialog
  - [x] `data-testid="edit-interval-dialog"`, `data-testid="edit-interval-save"`

- [x] Task 6: Wire interval edit icon on `MaintenanceTaskRow` (AC: #1)
  - [x] Update `apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx` (Story 16.4)
  - [x] On row hover, show Pencil icon button (`aria-label` from i18n `maintenance.actions.editInterval`)
  - [x] Click opens `EditIntervalDialog` with local `useState` for open/task
  - [x] **Do not** implement `LogServiceForm` or odometer edit (Stories 17.2–17.3)

- [x] Task 7: i18n EN + FR (AC: #1–#3, NFR16)
  - [x] `maintenance.interval.baselineHint` — e.g. "Industry baseline: {{km}} km / {{months}} mo"
  - [x] `maintenance.interval.bothZeroError` — validation copy
  - [x] `maintenance.interval.kmLabel`, `maintenance.interval.monthsLabel`
  - [x] `maintenance.actions.editInterval`, `maintenance.dialog.editIntervalTitle`
  - [x] `maintenance.toast.intervalUpdated` (3s toast per UX feedback table)

- [x] Task 8: Playwright tests (AC: all)
  - [x] Extend `apps/desktop/tests/maintenance.spec.ts`
  - [x] With seeded vehicle + tasks (depends on 16.2/16.3 flow): open interval dialog, change oil change intervals, save
  - [x] Assert success toast / task row reflects new countdown (status from refreshed IPC)
  - [x] Assert both-zero shows inline error and does not call backend
  - [x] Two-vehicle test: customize task on vehicle A; vehicle B same task type unchanged

- [x] Task 9: Verify compilation and tests
  - [x] `cargo test` in `apps/desktop/src-tauri/` — maintenance db tests pass
  - [x] `pnpm --filter @nkbaz/desktop exec playwright test tests/maintenance.spec.ts`

## Dev Notes

### Story Scope & Dependencies

This story delivers **FR52** (customize intervals). It spans **Rust command + dialog UI** on the maintenance page.

| Prerequisite | Delivers |
|--------------|----------|
| **Story 16.1** (done — `056943e`) | Migration `018`, `defaults.rs`, `evaluator.rs`, `db/maintenance.rs` skeleton |
| **Story 16.2** (must be done first) | `commands/maintenance.rs` module, `get_vehicle` returning tasks with status fields; vehicle + task seeding |
| **Story 16.3** (must be done first) | `/maintenance` route, `VehicleCard`, `useMaintenance` query for vehicle list |
| **Story 16.4** (must be done first) | `MaintenanceTaskRow` shell — this story adds interval edit icon + dialog |

**Out of scope (later stories):**

- `OdometerUpdateForm` → Story 17.2
- `LogServiceForm` → Story 17.3
- `ServiceHistoryTable` → Story 17.4
- Dashboard `MaintenanceAlertCard` → Epic 18

If Story 16.2 is incomplete when starting dev, implement `update_maintenance_task` in the same `commands/maintenance.rs` file 16.2 introduces — do **not** duplicate command modules.

### Architecture Compliance

- **Single source for baselines:** `maintenance/defaults.rs` — dialog hint uses `default_interval_km` / `default_interval_months` on IPC DTO populated via `baseline_for()`, not a duplicated TS map
- **Single source for status:** `maintenance/evaluator.rs` — `update_maintenance_task` returns freshly evaluated `status`, `km_remaining`, `days_remaining`, `next_due_*`
- **Per-vehicle independence (FR50):** Update by `task_id` only; never bulk-update all vehicles for a `task_type_key`
- **Validation (architecture D2):** At least one of `interval_km > 0` or `interval_months > 0`; enforce in Rust and mirror in form
- **SQL location:** `db/maintenance.rs` only — commands orchestrate
- **IPC naming:** `update_maintenance_task`, `snake_case`, `Result<T, AppError>`

**Extended IPC shape for tasks (add fields in 17.1 if not in 16.2 yet):**

```typescript
interface MaintenanceTaskWithStatus {
  id: number;
  vehicle_id: number;
  task_type_key: string;
  interval_km: number;
  interval_months: number;
  default_interval_km: number;      // from DEFAULT_TASKS baseline
  default_interval_months: number;  // from DEFAULT_TASKS baseline
  last_service_date: string | null;
  last_service_odometer_km: number | null;
  status: 'ok' | 'upcoming' | 'due' | 'overdue';
  km_remaining: number | null;
  days_remaining: number | null;
  next_due_date: string | null;
  next_due_odometer_km: number | null;
}
```

**Time-only tasks (`battery_check`, `wiper_blades`):** Baseline has `interval_km = 0`; user may set km to 0 and keep `interval_months > 0` — valid.

### UX Requirements (UX-DR5)

**EditIntervalDialog anatomy** ([ux-design-specification.md § Car Maintenance Module](_bmad-output/planning-artifacts/ux-design-specification.md)):

| Element | Implementation |
|---------|----------------|
| Trigger | Pencil icon on `MaintenanceTaskRow`, visible on hover |
| Fields | Two integer inputs: km interval, months interval |
| Helper | Baseline hint from `default_interval_*` — formatted like "8,000 km / 6 mo" |
| Actions | Save (primary) / Cancel (ghost) |
| Validation | Inline error if both zero — standard form pattern |

**MaintenanceTaskRow state:** Default, hover (reveals edit icon), logging (17.3 — not this story).

**Toast:** `maintenance.toast.intervalUpdated` — success, ~3s (per UX feedback table).

### File Structure

```
apps/desktop/
├── src-tauri/src/
│   ├── maintenance/defaults.rs     # MODIFY — baseline_for()
│   ├── db/maintenance.rs           # MODIFY — update_maintenance_task_intervals + DTO builder
│   ├── commands/maintenance.rs     # MODIFY — update_maintenance_task command
│   ├── models/mod.rs               # MODIFY — MaintenanceTaskWithStatus struct
│   └── lib.rs                      # MODIFY — register command
├── src/
│   ├── components/maintenance/
│   │   ├── EditIntervalDialog.tsx  # NEW
│   │   └── MaintenanceTaskRow.tsx  # MODIFY — edit icon + dialog
│   ├── hooks/useMaintenance.ts     # MODIFY — useUpdateMaintenanceTask
│   ├── lib/types.ts                # MODIFY
│   └── lib/constants.ts            # MODIFY — queryKeys
└── locales/en.json, fr.json        # MODIFY — maintenance.interval.*, toast
```

### Testing Standards

- Rust unit tests in `db/maintenance.rs` for validation and post-update evaluation
- Existing `evaluator.rs` tests cover FR57 logic — no duplicate evaluator tests required unless update path needs integration test
- Playwright E2E in `apps/desktop/tests/maintenance.spec.ts`
- Run: `cargo test` + `pnpm --filter @nkbaz/desktop exec playwright test tests/maintenance.spec.ts`

### Previous Story Intelligence

**Story 16.1 (implemented):**

- `DEFAULT_TASKS` has 15 entries; `engine_oil_filter` baseline 8000 km / 6 mo
- `evaluate_task()` input uses per-row `interval_km` / `interval_months` — changing intervals immediately affects status output
- `db/maintenance.rs` comment: "full implementations added in Story 16.2" — 17.1 adds update path alongside 16.2 read paths

**Story 16.4 (ready-for-dev spec):**

- Explicitly defers interval edit icon to **this story** (17.1)
- `MaintenanceTaskRow` has stub Log service button until 17.3
- Frontend must not compute status — consume `update_maintenance_task` response or invalidate queries

**Epic 17 cross-story:**

- 17.2 shares `["maintenance", vehicleId]` invalidation pattern for odometer
- 17.3 adds service logging; also invalidates `maintenance-alerts`
- Implement query key constants once in `constants.ts` if 16.3 has not already

### Git Intelligence

Recent commit `056943e` (Story 16.1):

- Migration 018 registered as version 18 in `db/mod.rs`
- Pattern: `maintenance` module in `lib.rs`, skeleton `db/maintenance.rs`
- Maintain zero-warning `cargo test` discipline

### Anti-Patterns (DO NOT)

- ❌ Duplicate `DEFAULT_TASKS` intervals in TypeScript for baseline hint
- ❌ Frontend status/date math after interval change — use IPC response or query refetch
- ❌ Update intervals for all vehicles when user edits one task
- ❌ Store display names in DB — `task_type_key` + i18n only
- ❌ Implement odometer edit or service logging in this story
- ❌ SQL in `commands/maintenance.rs`

### Project Structure Notes

- UI imports from `@nixus/shared` (`Dialog`, `Button`, `Input`, `Label`)
- Toasts via `sonner` + `useTranslation()` — match `AddAssetForm.tsx` / `RecurringTemplateList.tsx`
- Dialog pattern reference: `apps/desktop/src/components/assets/AssetRow.tsx` (delete dialog)
- Form pattern: `react-hook-form` + integer inputs (parse with `parseInt` / `valueAsNumber`, reject non-integers)
- Package scope renamed to Nixus — use `@nixus/shared`, not `@nkbaz/shared`

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md § Story 17.1]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md § D1 Baselines, D2 Schema, D3 Evaluator, D5 IPC, D8 EditIntervalDialog]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md § EditIntervalDialog, MaintenanceTaskRow, Feedback Patterns]
- [Source: _bmad-output/implementation-artifacts/16-4-task-status-display-on-vehicle-cards.md — prerequisite task row]
- [Source: apps/desktop/src-tauri/src/maintenance/defaults.rs — baseline values]
- [Source: apps/desktop/src-tauri/src/maintenance/evaluator.rs — post-update status]
- [Source: apps/desktop/src/hooks/useAssets.ts — mutation + invalidation pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright interval countdown assertion adjusted for never-serviced km display format (no locale comma in i18n count interpolation)
- Two-vehicle E2E uses vehicle-card-{id} test ids and preserves expanded state from single-vehicle default

### Completion Notes List

- Added `baseline_for()` in Rust with unit tests; wired into `attach_task_status` for IPC baseline fields
- Implemented `update_maintenance_task_intervals` DB function with validation, evaluation, and 3 unit tests
- Added `update_maintenance_task` Tauri command registered in `lib.rs`
- Extended `MaintenanceTaskWithStatus` with `default_interval_km` / `default_interval_months` in Rust and TypeScript
- Added `useUpdateMaintenanceTask` mutation with query invalidation and success toast
- Built `EditIntervalDialog` with client-side both-zero validation
- Wired hover pencil icon on `MaintenanceTaskRow`; passes `vehicleId` from `VehicleCard`
- Added EN/FR i18n keys for interval editing UX
- Added 4 Playwright tests for interval editing flows

### File List

- apps/desktop/src-tauri/src/maintenance/defaults.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/lib/types.ts
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/components/maintenance/EditIntervalDialog.tsx
- apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-05-29: Story 17.1 implemented — customize maintenance intervals via EditIntervalDialog, Rust update command, E2E tests (Status → review)
