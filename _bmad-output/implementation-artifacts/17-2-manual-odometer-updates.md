# Story 17.2: Manual Odometer Updates

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to manually update my vehicle's current odometer reading,
So that maintenance due calculations reflect my actual mileage.

## Acceptance Criteria

1. **Given** a vehicle card header showing odometer, **When** the user clicks the odometer value, **Then** `OdometerUpdateForm` shows an inline `Input` (UX-DR7), **And** Enter saves, Escape cancels.
2. **Given** a valid odometer value (non-negative integer km), **When** the user saves, **Then** `update_vehicle_odometer` updates `vehicles.odometer_km` (FR53), **And** all task statuses recalculate with the new odometer (server-side via `evaluator.rs`), **And** a success toast shows `maintenance.toast.odometerManual`, **And** TanStack Query keys `["maintenance", vehicleId]` and `["maintenance-alerts"]` invalidate so alert summary refreshes within 1 second (NFR14).
3. **Given** an invalid odometer (negative or non-integer), **When** the user attempts to save, **Then** inline validation error is shown and no IPC call occurs.
4. **Given** the odometer display (non-edit mode), **When** rendered, **Then** it shows integer km with thousands separator and `" km"` suffix — never decimals (e.g., `52,300 km`).
5. **Given** the odometer is unchanged from the stored value, **When** the user saves, **Then** no mutation is sent and edit mode closes without toast.
6. **Given** keyboard accessibility, **When** the odometer display is focused, **Then** Enter enters edit mode; in edit mode Enter saves and Escape cancels (matches `AccountRow` / UX spec VehicleCard pattern).

## Tasks / Subtasks

- [x] Task 1: Implement `update_vehicle_odometer` in Rust db layer (AC: #2)
  - [x] Add `update_vehicle_odometer(conn, vehicle_id, odometer_km) -> Result<VehicleWithTasks, AppError>` to `apps/desktop/src-tauri/src/db/maintenance.rs`
  - [x] Validate `odometer_km >= 0`; return `AppError::Validation` if invalid
  - [x] UPDATE `vehicles.odometer_km` and `vehicles.updated_at`
  - [x] Re-fetch vehicle + all tasks; run each task through `maintenance/evaluator.rs::evaluate_task` with new `current_odometer_km`
  - [x] Return full `VehicleWithTasks` (same shape as `get_vehicle`) so frontend gets refreshed statuses without recalculating

- [x] Task 2: Implement `update_vehicle_odometer` Tauri command (AC: #2)
  - [x] Add command to `apps/desktop/src-tauri/src/commands/maintenance.rs` (create file if Story 16.2 not yet done)
  - [x] Signature: `update_vehicle_odometer(vehicle_id: i64, odometer_km: i64) -> Result<VehicleWithTasks, AppError>`
  - [x] Delegate to db layer only — no SQL in commands
  - [x] Register in `apps/desktop/src-tauri/src/lib.rs` invoke_handler

- [x] Task 3: Add TypeScript types and mutation hook (AC: #2)
  - [x] Ensure `VehicleWithTasks` (or equivalent) exists in `apps/desktop/src/lib/types.ts` with `odometer_km: number` and tasks including computed `status`, `km_remaining`, `days_remaining`
  - [x] Add `useUpdateVehicleOdometer` to `apps/desktop/src/hooks/useMaintenance.ts`
  - [x] On success: invalidate `["maintenance"]`, `["maintenance", vehicleId]`, `["maintenance-alerts"]`; show success toast via `maintenance.toast.odometerManual`

- [x] Task 4: Create `OdometerUpdateForm` component (AC: #1, #3, #4, #5, #6)
  - [x] Create `apps/desktop/src/components/maintenance/OdometerUpdateForm.tsx`
  - [x] Props: `vehicleId: number`, `odometerKm: number`, `onSuccess?: () => void`
  - [x] Display mode: monospace integer with `toLocaleString()` thousands separator + `" km"` suffix; dashed underline on hover; `role="button"`, `tabIndex={0}`, `data-testid="odometer-display-{vehicleId}"`
  - [x] Edit mode: shadcn `Input` type `number` min={0} step={1}; auto-focus and select on enter edit; `data-testid="odometer-input-{vehicleId}"`
  - [x] Enter saves; Escape cancels and restores original value
  - [x] Client validation: reject negative values and non-integers (parse with `Number.isInteger` after `parseInt`/`Number`)
  - [x] Show inline error below input on validation failure — do NOT call IPC
  - [x] Skip mutation if parsed value equals current `odometerKm`

- [x] Task 5: Integrate into `VehicleCard` header (AC: #1, #4)
  - [x] Replace display-only odometer from Story 16.4 with `OdometerUpdateForm` in `apps/desktop/src/components/maintenance/VehicleCard.tsx`
  - [x] Pass `vehicleId` and current `odometer_km` from vehicle prop
  - [x] Card header layout unchanged: nickname (H3), make/model/year (muted), odometer inline-editable

- [x] Task 6: i18n strings EN + FR (AC: #2, #3)
  - [x] Add to `apps/desktop/src/locales/en.json` and `fr.json`:
    - `maintenance.odometer.label` — aria-label for odometer control
    - `maintenance.odometer.invalid` — inline validation message
    - `maintenance.toast.odometerManual` — success toast (e.g., "Odometer updated")
  - [x] Toast duration: 3 seconds (per UX spec — 4s reserved for auto-update in Story 17.3)

- [x] Task 7: Rust unit tests (AC: #2)
  - [x] Add db/command tests: valid update persists odometer; negative odometer returns Validation error
  - [x] Verify task status changes when odometer crosses alert thresholds (e.g., km-only task moves from `ok` → `upcoming` when odometer increases)

- [x] Task 8: Playwright E2E tests (AC: #1–#4)
  - [x] Append to `apps/desktop/tests/maintenance.spec.ts` (create file if missing)
  - [x] Test: Click odometer → inline input appears
  - [x] Test: Enter new valid km → display updates with formatted value + success toast
  - [x] Test: Escape cancels without saving
  - [x] Test: Negative value shows inline error, no toast
  - [x] Mock `update_vehicle_odometer` in test harness if full backend not yet wired

## Dev Notes

### Prerequisites (Epic 16 + partial Epic 17)

This story assumes Epic 16 is implemented:

| Prerequisite | Story | What must exist |
|--------------|-------|-----------------|
| Schema + evaluator | 16.1 | `018_maintenance_tables.sql`, `maintenance/defaults.rs`, `maintenance/evaluator.rs` |
| Vehicle CRUD + IPC | 16.2 | `get_vehicle`, `create_vehicle`, `db/maintenance.rs` query functions |
| Maintenance page | 16.3 | `/maintenance` route, `useMaintenance.ts` hook skeleton |
| VehicleCard display | 16.4 | `VehicleCard.tsx` with **display-only** odometer in header |

**Story 17.1** (`17-1-customize-maintenance-intervals`) is **not required** for this story — odometer editing is independent of interval customization. No story file exists yet for 17.1.

**Current codebase state (2026-05-29):** Story 16.1 foundation exists (`defaults.rs`, `evaluator.rs`, migration `018_maintenance_tables.sql`); `db/maintenance.rs` is a skeleton stub; no `commands/maintenance.rs`, no frontend maintenance components yet. If Epic 16 is incomplete when dev starts, implement backend command + db function in this story but defer `VehicleCard` integration until 16.4 lands — or implement minimal `VehicleCard` stub for testing.

### Inline Odometer Edit Flow

```
VehicleCard header (display mode)
  └── "52,300 km" (monospace, tabIndex=0, dashed underline on hover)
       └── Click or Enter → Edit mode
            └── Input[type=number] pre-filled with 52300
                 ├── Enter → parse integer → validate ≥ 0
                 │    ├── invalid → inline error, stay in edit mode
                 │    └── valid → invoke update_vehicle_odometer → display mode + toast
                 └── Escape → cancel → display mode (original value)
```

**Do NOT reuse `InlineEditMoney`** — odometer is integer km, not currency cents. Follow the same Enter/Escape keyboard pattern as `InlineEditText` / `AccountRow` but with integer parsing instead of MoneyInput.

Reference implementations:
- `apps/desktop/src/components/shared/InlineEdit.tsx` — Enter/Escape/blur pattern
- `apps/desktop/src/components/accounts/AccountRow.tsx` — inline edit UX from Story 4.2

### Odometer Display Formatting

```typescript
function formatOdometerKm(km: number): string {
  return `${km.toLocaleString()} km`;
}
```

- Integer only — truncate/reject decimals on input
- Monospace + `tabular-nums` in display mode
- Locale-aware thousands separator via `toLocaleString()` (matches UX spec)

### Rust Command Contract

```rust
#[tauri::command]
pub fn update_vehicle_odometer(
    state: State<AppState>,
    vehicle_id: i64,
    odometer_km: i64,
) -> Result<VehicleWithTasks, AppError>
```

**Validation:**
- `odometer_km >= 0` → else `AppError::Validation("Odometer must be a non-negative integer")`
- Vehicle must exist → else `AppError::NotFound`

**Response:** Full vehicle with all 15 tasks and server-computed status fields — same as `get_vehicle`. Frontend must **never** recalculate task status after odometer change.

**No audit log required** for manual odometer update (audit log is specified for auto-update from service log in Story 17.3 / FR56 only).

### Evaluation Trigger (Architecture D3)

Odometer update is an evaluation trigger per PRD §Maintenance Alert Evaluation. The command response must include refreshed task evaluations so:
1. Task rows on the vehicle card update immediately (status badges, km/days remaining)
2. `["maintenance-alerts"]` invalidation causes dashboard alert summary to refresh on next fetch (NFR14)

### TanStack Query Invalidation

| Key | When |
|-----|------|
| `["maintenance"]` | odometer updated (vehicle list may show odometer in summary) |
| `["maintenance", vehicleId]` | odometer updated (task statuses changed) |
| `["maintenance-alerts"]` | odometer updated (alert thresholds may change) |

Do **not** invalidate `["maintenance-history", vehicleId]` — odometer update does not affect service history.

### Scope Boundaries

**In scope:** Manual odometer inline edit on VehicleCard, `update_vehicle_odometer` IPC, validation, toast, query invalidation, i18n keys listed above, unit + E2E tests for odometer flow.

**Out of scope:**
- Odometer auto-update from service log (Story 17.3 / FR56)
- Interval customization UI (Story 17.1 / FR52)
- Dashboard `MaintenanceAlertCard` (Epic 18) — only query invalidation prep
- Decreasing odometer below last service odometer — allowed by FR53; evaluator handles naturally (may show overdue/upcoming shifts)

### Anti-Patterns (Architecture Enforcement)

- **Never** compute task status on the frontend after odometer save — use IPC response or refetch
- **Never** store odometer as float or decimal in DB or UI
- **Never** put SQL in `commands/maintenance.rs` — db layer only
- **Never** use `MoneyInput` for odometer — integer km only
- **Never** skip `["maintenance-alerts"]` invalidation — NFR14 depends on it

### Project Structure Notes

Files created or modified:

| File | Action |
|------|--------|
| `apps/desktop/src-tauri/src/db/maintenance.rs` | Add `update_vehicle_odometer` |
| `apps/desktop/src-tauri/src/commands/maintenance.rs` | Add command (create if missing) |
| `apps/desktop/src-tauri/src/lib.rs` | Register command |
| `apps/desktop/src/lib/types.ts` | Ensure vehicle/task types |
| `apps/desktop/src/hooks/useMaintenance.ts` | Add `useUpdateVehicleOdometer` |
| `apps/desktop/src/components/maintenance/OdometerUpdateForm.tsx` | **New** |
| `apps/desktop/src/components/maintenance/VehicleCard.tsx` | Integrate OdometerUpdateForm |
| `apps/desktop/src/locales/en.json` | Add maintenance odometer keys |
| `apps/desktop/src/locales/fr.json` | Add maintenance odometer keys |
| `apps/desktop/tests/maintenance.spec.ts` | Append odometer tests |

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md — Epic 17, Story 17.2]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md — D3 Evaluation Triggers, D5 `update_vehicle_odometer`, D8 OdometerUpdateForm, TanStack Query keys]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — VehicleCard, OdometerUpdateForm, Toast patterns, Keyboard accessibility]
- [Source: _bmad-output/implementation-artifacts/4-2-edit-remove-update-account-balances.md — Inline edit Enter/Escape pattern]
- [Source: apps/desktop/src/components/shared/InlineEdit.tsx — Reusable inline edit keyboard handling]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright odometer save test initially failed because controlled number input required `clear()` before `fill()`; added local optimistic km state for immediate display update.

### Completion Notes List

- Implemented `update_vehicle_odometer` db function and Tauri command returning full `VehicleWithTasks` with server-evaluated task statuses.
- Added `OdometerUpdateForm` with inline edit UX (click/Enter to edit, Enter save, Escape cancel, client-side integer validation).
- Integrated into `VehicleCard` header; mutation hook updates query cache from IPC response and invalidates maintenance + alert keys.
- Added EN/FR i18n keys and 3-second success toast.
- Added 4 Rust unit tests and 4 Playwright E2E tests for odometer flow.

### File List

- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/components/maintenance/OdometerUpdateForm.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts

## Change Log

- 2026-05-29: Story 17.2 implemented — manual odometer inline edit, IPC command, tests, i18n.
