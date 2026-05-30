# Story 17.3: Service Logging with Schedule Recalculation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to log a completed maintenance service with date and odometer,
so that my maintenance countdown resets and alerts update automatically.

## Acceptance Criteria

1. **Given** a task row on a vehicle card, **when** the user clicks "Log service", **then** `LogServiceForm` expands inline below the row with date (defaults today), odometer (defaults vehicle odometer), and optional notes (UX-DR6).

2. **Given** valid service data, **when** the user saves, **then** `log_maintenance_service` runs in a single SQLite transaction (D4): inserts service log, updates task `last_service_date` and `last_service_odometer_km`, and commits (FR54, FR55); task status recalculates to reflect the new anchor points via `evaluator.rs` (FR57); a success toast shows `maintenance.toast.serviceLogged`.

3. **Given** the logged service odometer exceeds the vehicle's stored odometer, **when** the transaction completes, **then** `vehicles.odometer_km` updates to the higher value (FR56); `LogServiceResult.odometer_updated` is `true` with `previous_odometer_km` and `new_odometer_km`; an info toast shows `maintenance.toast.odometerUpdated` with the new km value within 1 second (NFR15); toast duration is 4 seconds; an audit log entry records the odometer correction.

4. **Given** the logged service odometer does not exceed stored odometer, **when** the transaction completes, **then** `odometer_updated` is `false` and no odometer correction toast appears.

5. **Given** a service is logged for a task previously in upcoming/due/overdue status, **when** the task row refreshes, **then** status resets based on new last-service anchors (e.g., back to "On track" or "Upcoming").

6. **Given** any maintenance mutation from this story, **when** it completes, **then** TanStack Query keys `["maintenance"]`, `["maintenance", vehicleId]`, `["maintenance-alerts"]`, and `["maintenance-history", vehicleId]` invalidate.

7. **Given** invalid service data (negative odometer, non-integer odometer, empty date, or future date beyond validation rules), **when** the user attempts to save, **then** inline validation errors are shown and no IPC call occurs (frontend) or `AppError::Validation` is returned (backend).

8. **Given** the user presses Escape or clicks Cancel on `LogServiceForm`, **when** the action completes, **then** the inline form collapses without mutation and task row returns to default state.

## Tasks / Subtasks

- [x] **Task 1: Rust models and IPC input/output types** (AC: 2, 3, 4)
  - [x] 1.1 Add to `apps/desktop/src-tauri/src/models/mod.rs`:
    - `MaintenanceServiceLog` — `{ id, vehicle_id, task_id, service_date, odometer_km, notes, created_at }`
    - `LogMaintenanceServiceInput` — `{ task_id, service_date, odometer_km, notes? }`
    - `LogServiceResult` — `{ log, task, odometer_updated, previous_odometer_km?, new_odometer_km? }` where `task` includes computed status fields (`MaintenanceTaskWithStatus`)
  - [x] 1.2 Serialize `TaskStatus` as `snake_case` (`ok`, `upcoming`, `due`, `overdue`) per architecture

- [x] **Task 2: DB layer — `log_maintenance_service` transaction** (AC: 2, 3, 4, 7)
  - [x] 2.1 Implement `log_maintenance_service(conn, input) -> Result<LogServiceResult, AppError>` in `apps/desktop/src-tauri/src/db/maintenance.rs`
  - [x] 2.2 Validate: `task_id` exists; `service_date` is valid `YYYY-MM-DD`; `odometer_km >= 0` integer; task belongs to vehicle
  - [x] 2.3 Single transaction (D4):
    1. INSERT into `maintenance_service_logs` (append-only — never UPDATE)
    2. UPDATE `maintenance_tasks` SET `last_service_date`, `last_service_odometer_km`, `updated_at`
    3. If `input.odometer_km > vehicle.odometer_km`: UPDATE `vehicles.odometer_km`, set `odometer_updated = true`
    4. COMMIT
  - [x] 2.4 After commit, call `evaluator::evaluate_task()` with updated anchors and current vehicle odometer (use higher value if odometer was updated)
  - [x] 2.5 Return `LogServiceResult` with evaluated task status — frontend must NOT compute status

- [x] **Task 3: Tauri command + audit log** (AC: 2, 3)
  - [x] 3.1 Create or extend `apps/desktop/src-tauri/src/commands/maintenance.rs` with `log_maintenance_service`
  - [x] 3.2 When odometer auto-updates: call `audit_db::insert_audit_log(conn, "vehicle", vehicle_id, "update", Some(old_json), Some(new_json))` — log `{"field":"odometer_km","before":N,"after":M,"source":"service_log","task_id":X}` (non-blocking on audit failure, match account.rs pattern)
  - [x] 3.3 Register command in `apps/desktop/src-tauri/src/lib.rs` invoke_handler

- [x] **Task 4: TypeScript types and query keys** (AC: 2, 6)
  - [x] 4.1 Add interfaces to `apps/desktop/src/lib/types.ts`: `MaintenanceServiceLog`, `LogMaintenanceServiceInput`, `LogServiceResult`, `MaintenanceTaskWithStatus`
  - [x] 4.2 Add to `queryKeys` in `apps/desktop/src/lib/constants.ts`:
    - `maintenance: ["maintenance"] as const`
    - `maintenanceVehicle: (vehicleId: number) => ["maintenance", vehicleId] as const`
    - `maintenanceAlerts: ["maintenance-alerts"] as const`
    - `maintenanceHistory: (vehicleId: number) => ["maintenance-history", vehicleId] as const`
  - [x] 4.3 Create or extend `apps/desktop/src/hooks/useMaintenance.ts` with `useLogMaintenanceService()` mutation

- [x] **Task 5: `LogServiceForm` component** (AC: 1, 7, 8)
  - [x] 5.1 Create `apps/desktop/src/components/maintenance/LogServiceForm.tsx`
  - [x] 5.2 Inline panel below task row: date (`Input type="date"`, default today), odometer (`Input` integer + "km" label, default vehicle odometer), notes (`Textarea`, optional)
  - [x] 5.3 react-hook-form, `mode: "onSubmit"`; Enter saves, Escape cancels
  - [x] 5.4 Validation: odometer required, non-negative integer; date required; notes optional

- [x] **Task 6: Integrate into `MaintenanceTaskRow`** (AC: 1, 5, 8)
  - [x] 6.1 Add local state `isLogging` — toggled by "Log service" outline button
  - [x] 6.2 When `isLogging`, render `LogServiceForm` below row; pass `taskId`, `vehicleId`, `vehicleOdometerKm`, `onSuccess`, `onCancel`
  - [x] 6.3 On success: collapse form; task row reflects new status from invalidated query (no frontend status math)
  - [x] 6.4 Row state: `logging` when form expanded (UX-DR4)

- [x] **Task 7: Mutation handler — toasts and query invalidation** (AC: 2, 3, 4, 6)
  - [x] 7.1 `onSuccess` in `useLogMaintenanceService`:
    - Always: `toast.success(t("maintenance.toast.serviceLogged"))`
    - If `result.odometer_updated`: `toast.info(t("maintenance.toast.odometerUpdated", { km: formatOdometer(result.new_odometer_km) }), { duration: 4000 })`
    - Invalidate: `maintenance`, `maintenanceVehicle(vehicleId)`, `maintenanceAlerts`, `maintenanceHistory(vehicleId)`
  - [x] 7.2 Frontend never compares odometer values — use `LogServiceResult.odometer_updated` only (architecture rule)
  - [x] 7.3 Reuse or add `formatOdometer(km: number)` helper — integer km with thousands separator, no decimals

- [x] **Task 8: i18n (EN + FR)** (AC: 2, 3)
  - [x] 8.1 Add keys to `apps/desktop/src/locales/en.json` and `fr.json`:
    - `maintenance.logService.title`, `maintenance.logService.date`, `maintenance.logService.odometer`, `maintenance.logService.notes`, `maintenance.logService.save`, `maintenance.logService.cancel`
    - `maintenance.toast.serviceLogged`: "Service logged"
    - `maintenance.toast.odometerUpdated`: "Odometer updated to {{km}} based on service log"
    - `maintenance.validation.odometerRequired`, `maintenance.validation.odometerInvalid`, `maintenance.validation.dateRequired`
    - `maintenance.actions.logService`: "Log service" (if not already from Story 16.4)

- [x] **Task 9: Rust unit tests** (AC: 2, 3, 4, 5)
  - [x] 9.1 Add integration-style tests in `db/maintenance.rs` or dedicated test module:
    - Log service updates task anchors and inserts log row
    - Odometer auto-update when service odometer > vehicle odometer
    - No odometer update when service odometer ≤ vehicle odometer
    - Status recalculates (overdue → ok after service with fresh anchors)
  - [x] 9.2 Evaluator tests already exist in `evaluator.rs` — do not duplicate; test via `log_maintenance_service` return value

## Dev Notes

### Prerequisites (must exist before implementing)

**Epic 16 (all stories):**
- Migration `018_maintenance_tables.sql` applied (Story 16.1) — tables exist; `evaluator.rs` and `defaults.rs` complete
- `commands/maintenance.rs` with vehicle/task read commands (Story 16.2)
- `/maintenance` route, `VehicleCard`, `MaintenanceTaskRow` shell (Stories 16.3–16.4)
- `MaintenanceTaskRow` displays task status from IPC — status is server-computed only

**Epic 17 sibling stories (context, not blockers for backend):**
- **Story 17.1** (`EditIntervalDialog`, `update_maintenance_task`) — parallel; interval editing is independent of service logging
- **Story 17.2** (`OdometerUpdateForm`, `update_vehicle_odometer`) — parallel; manual odometer update is separate from auto-update in this story

**IMPORTANT:** Read existing maintenance files before implementing. Do NOT reimplement evaluator logic, vehicle CRUD, or page scaffolding. Extend what Epic 16 delivers.

---

### Architecture: D4 Transaction Semantics

[Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D4]

Single SQLite transaction in `log_maintenance_service`:

1. INSERT `maintenance_service_logs` row (append-only — FR59)
2. UPDATE `maintenance_tasks.last_service_date` + `last_service_odometer_km`
3. IF `service.odometer_km > vehicle.odometer_km`: UPDATE `vehicles.odometer_km`
4. COMMIT

**IPC response:**

```typescript
interface LogServiceResult {
  log: MaintenanceServiceLog;
  task: MaintenanceTaskWithStatus;
  odometer_updated: boolean;
  previous_odometer_km?: number;
  new_odometer_km?: number;
}
```

**Critical rules:**
- Frontend shows odometer toast ONLY when `odometer_updated === true` — never compare odometer client-side
- Status recalculation uses `evaluator.rs` after transaction — status is NOT persisted in DB
- `maintenance_service_logs` is append-only — no UPDATE/DELETE on history rows

---

### DB Implementation Pattern

Follow existing transaction pattern from `db/expense.rs` (`bulk_insert_imported_expenses`):

```rust
let tx = conn.unchecked_transaction().map_err(|e| AppError::Database { message: e.to_string() })?;
// ... inserts/updates within tx ...
tx.commit().map_err(|e| AppError::Database { message: e.to_string() })?;
```

All SQL in `db/maintenance.rs` — commands call DB layer only, no SQL in `commands/maintenance.rs`.

---

### Evaluator Integration

After transaction, build `TaskEvalInput` from updated task row:

```rust
let eval = evaluate_task(&TaskEvalInput {
    interval_km: task.interval_km,
    interval_months: task.interval_months,
    last_service_date: Some(input.service_date.clone()),
    last_service_odometer_km: Some(input.odometer_km),
    current_odometer_km: effective_odometer, // max(vehicle.odometer, input.odometer) after tx
    vehicle_created_at: vehicle.created_at,
    today: chrono::Local::now().date_naive(),
});
```

Map `TaskEvaluation` → `MaintenanceTaskWithStatus` fields on the returned task. Evaluator is at `apps/desktop/src-tauri/src/maintenance/evaluator.rs` (already implemented with unit tests).

---

### Audit Log for Odometer Auto-Update

[Source: Story 8.3 pattern + architecture-car-maintenance.md]

Only log when odometer is auto-corrected (not on every service log):

```rust
if odometer_updated {
    let old_json = serde_json::json!({"odometer_km": previous}).to_string();
    let new_json = serde_json::json!({
        "odometer_km": new,
        "source": "service_log",
        "task_id": task_id
    }).to_string();
    if let Err(e) = audit_db::insert_audit_log(&conn, "vehicle", vehicle_id, "update", Some(&old_json), Some(&new_json)) {
        tracing::error!("Failed to write audit log: {}", e);
    }
}
```

Use `entity_type = "vehicle"` (new type for audit — no migration needed; audit_log has no CHECK constraint on entity_type in current schema).

---

### Frontend: LogServiceForm UX

[Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § LogServiceForm, Journey 7]

- Inline expand below task row — NOT a dialog or separate page
- Default `service_date`: today (`new Date().toISOString().slice(0, 10)`)
- Default `odometer_km`: vehicle's current odometer from props
- Save (primary) / Cancel (ghost) buttons
- Enter saves, Escape cancels
- On save success: collapse form immediately; toasts fire in mutation `onSuccess` BEFORE any navigation

**Toast sequence when odometer auto-updates:**
1. `toast.success` — "Service logged" (3s default)
2. `toast.info` — "Odometer updated to 52,300 km..." (`duration: 4000`)

Both toasts fire in `onSuccess` synchronously — satisfies NFR15 (notification before navigate away).

---

### MaintenanceTaskRow Integration

`MaintenanceTaskRow` (from Story 16.4) should gain:

```tsx
const [isLogging, setIsLogging] = useState(false);

// In actions column:
<Button variant="outline" size="sm" onClick={() => setIsLogging(true)}>
  {t("maintenance.actions.logService")}
</Button>

// Below row (conditional):
{isLogging && (
  <LogServiceForm
    taskId={task.id}
    vehicleId={task.vehicle_id}
    defaultOdometerKm={vehicleOdometerKm}
    onSuccess={() => setIsLogging(false)}
    onCancel={() => setIsLogging(false)}
  />
)}
```

Pass `vehicleOdometerKm` from `VehicleCard` — the vehicle header odometer value.

---

### useMaintenance Hook Pattern

Mirror `useRecurringExpenses.ts` / `useAssets.ts` mutation pattern:

```typescript
export function useLogMaintenanceService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LogMaintenanceServiceInput) =>
      invoke<LogServiceResult>("log_maintenance_service", { input }),
    onSuccess: (result, variables) => {
      // toasts handled here or in component — prefer hook for consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenanceVehicle(result.log.vehicle_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenanceAlerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenanceHistory(result.log.vehicle_id) });
    },
  });
}
```

Note: `vehicleId` comes from `result.log.vehicle_id` after success — do not require caller to pass it for invalidation.

---

### Query Key Invalidation Matrix

| Mutation | Keys to invalidate |
|----------|-------------------|
| `log_maintenance_service` | `maintenance`, `maintenanceVehicle(id)`, `maintenanceAlerts`, `maintenanceHistory(id)` |

[Source: architecture-car-maintenance.md § TanStack Query Keys]

---

### i18n Copy (EN)

```json
{
  "maintenance": {
    "actions": {
      "logService": "Log service"
    },
    "logService": {
      "date": "Service date",
      "odometer": "Odometer at service",
      "notes": "Notes (optional)",
      "save": "Save",
      "cancel": "Cancel"
    },
    "toast": {
      "serviceLogged": "Service logged",
      "odometerUpdated": "Odometer updated to {{km}} based on service log"
    },
    "validation": {
      "odometerRequired": "Odometer is required",
      "odometerInvalid": "Enter a valid odometer reading (0 or greater)",
      "dateRequired": "Service date is required"
    }
  }
}
```

French equivalents required in `fr.json` — no missing keys (NFR16).

---

### Files to Create/Modify

| File | Action |
|------|--------|
| `apps/desktop/src-tauri/src/models/mod.rs` | ADD structs |
| `apps/desktop/src-tauri/src/db/maintenance.rs` | ADD `log_maintenance_service` |
| `apps/desktop/src-tauri/src/commands/maintenance.rs` | ADD command (create if missing) |
| `apps/desktop/src-tauri/src/lib.rs` | REGISTER command |
| `apps/desktop/src/lib/types.ts` | ADD TS interfaces |
| `apps/desktop/src/lib/constants.ts` | ADD query keys |
| `apps/desktop/src/hooks/useMaintenance.ts` | ADD mutation hook (create if missing) |
| `apps/desktop/src/components/maintenance/LogServiceForm.tsx` | CREATE |
| `apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx` | MODIFY — add Log service flow |
| `apps/desktop/src/locales/en.json` | ADD i18n keys |
| `apps/desktop/src/locales/fr.json` | ADD i18n keys |

**Do NOT modify:** `evaluator.rs`, migration files, dashboard components, AI chat tools.

---

### Testing Requirements

Per dev-standards skill:

1. `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero type errors
2. Rust unit tests for `log_maintenance_service` transaction paths
3. Playwright E2E (can be deferred to Story 18.2 E2E verification if maintenance page E2E scaffold doesn't exist yet) — at minimum manual test:
   - Log service on overdue task → status resets
   - Log service with odometer > stored → info toast with 4s duration + vehicle odometer updates in UI

Forms use `mode: "onSubmit"` — test validation by submitting, not blurring.

---

### Anti-Patterns (DO NOT)

- ❌ Frontend date/km math for task status — status comes from IPC only
- ❌ Compare odometer client-side to decide toast — use `LogServiceResult.odometer_updated`
- ❌ SQL in `commands/maintenance.rs` — belongs in `db/maintenance.rs`
- ❌ UPDATE or DELETE on `maintenance_service_logs` — append-only
- ❌ Duplicate evaluator logic anywhere outside `evaluator.rs`
- ❌ Link maintenance vehicles to `passive_assets`

---

### Project Structure Notes

Aligns with architecture-car-maintenance.md § Project Structure. Feature components live in `components/maintenance/`. Hooks in `hooks/useMaintenance.ts`. IPC command `log_maintenance_service` follows snake_case convention matching all other Tauri commands.

---

### References

- [Source: `_bmad-output/planning-artifacts/epics-car-maintenance.md` § Story 17.3]
- [Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D3, D4, D5, D8]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § Journey 7, LogServiceForm, Feedback Patterns]
- [Source: `_bmad-output/planning-artifacts/prd.md` § FR54–FR57, NFR15]
- [Source: `_bmad-output/planning-artifacts/epics-car-maintenance.md` § Stories 17.1, 17.2 — sibling context]
- [Source: `apps/desktop/src-tauri/src/maintenance/evaluator.rs` — existing evaluator]
- [Source: `apps/desktop/src-tauri/migrations/018_maintenance_tables.sql` — schema]
- [Source: `apps/desktop/src-tauri/src/db/audit.rs` — audit pattern]
- [Source: `apps/desktop/src/hooks/useRecurringExpenses.ts` — mutation/invalidation pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Query cache: `useLogMaintenanceService` refetches vehicle via `get_vehicle` after success and updates TanStack Query cache before invalidating keys (maintenance invalidation uses `refetchType: "none"` to avoid race with optimistic cache update).

### Completion Notes List

- Implemented `log_maintenance_service` D4 transaction: append-only service log insert, task anchor update, conditional vehicle odometer correction, post-commit evaluator status via `attach_task_status`.
- Added `log_maintenance_service` Tauri command with non-blocking audit log when odometer auto-corrects.
- Created inline `LogServiceForm` with react-hook-form validation; integrated into `MaintenanceTaskRow` with `isLogging` state and `data-state="logging"`.
- Added `useLogMaintenanceService` mutation with dual toasts (service logged + odometer info at 4s when applicable) and query key invalidation.
- Added 5 Rust integration tests + 6 Playwright service-logging tests.

### File List

- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/lib/types.ts
- apps/desktop/src/lib/constants.ts
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/components/maintenance/LogServiceForm.tsx
- apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts

## Change Log

- 2026-05-29: Story 17.3 — service logging with schedule recalculation, inline LogServiceForm, odometer auto-update with audit trail, query cache updates, EN/FR i18n, Rust + Playwright tests.
