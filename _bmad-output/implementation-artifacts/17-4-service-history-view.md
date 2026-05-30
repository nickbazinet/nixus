# Story 17.4: Service History View

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to view the service history for each vehicle,
so that I can see when maintenance was last performed and at what mileage.

## Acceptance Criteria

1. **Given** a vehicle with logged services  
   **When** its card is expanded  
   **Then** `ServiceHistoryTable` displays columns: Date (short format, e.g., "Mar 14"), Task (i18n name), Odometer (monospace km), Notes (UX-DR8)  
   **And** entries are sorted newest first  
   **And** up to 10 entries are visible with "View all" if more exist

2. **Given** a vehicle with no service logs  
   **When** the history section renders  
   **Then** it shows "No service logged yet."

3. **Given** `get_service_history` command  
   **When** invoked for a vehicle  
   **Then** append-only log entries are returned — no update or delete operations on history (FR59)

4. **Given** a vehicle card footer  
   **When** rendered  
   **Then** "Edit vehicle" and "Delete vehicle" actions are available  
   **And** delete shows a destructive confirmation dialog before calling `delete_vehicle`

5. **Given** complete per-vehicle status and history  
   **When** the user views a vehicle card  
   **Then** FR59 is fully satisfied — status badges for all tasks (Stories 16.4 / prior work) plus complete service history

## Tasks / Subtasks

- [x] Backend: `get_service_history` (AC: #1, #3)
  - [x] Add `MaintenanceServiceLogEntry` struct to `apps/desktop/src-tauri/src/models/mod.rs` (include `task_type_key` via JOIN)
  - [x] Implement `get_service_history(conn, vehicle_id)` in `apps/desktop/src-tauri/src/db/maintenance.rs`
  - [x] SQL: SELECT from `maintenance_service_logs` JOIN `maintenance_tasks` ON `task_id`, WHERE `vehicle_id = ?`, ORDER BY `service_date DESC`, `created_at DESC`
  - [x] No UPDATE/DELETE functions for service logs — append-only (FR59)
  - [x] Add `get_service_history` Tauri command in `apps/desktop/src-tauri/src/commands/maintenance.rs` (create file if Stories 16.2–17.3 have not yet)
  - [x] Register command in `apps/desktop/src-tauri/src/lib.rs` invoke_handler

- [x] Frontend types and query hook (AC: #1, #3)
  - [x] Add `MaintenanceServiceLogEntry` interface to `apps/desktop/src/lib/types.ts`
  - [x] Add `maintenanceHistory: (vehicleId: number) => ["maintenance-history", vehicleId] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts`
  - [x] Add `useServiceHistory(vehicleId: number)` in `apps/desktop/src/hooks/useMaintenance.ts` (create hook file if missing) — `invoke("get_service_history", { vehicle_id: vehicleId })`, `enabled: vehicleId > 0`

- [x] `ServiceHistoryTable` component (AC: #1, #2)
  - [x] Create `apps/desktop/src/components/maintenance/ServiceHistoryTable.tsx`
  - [x] Props: `vehicleId: number`, optional `className`
  - [x] Use `useServiceHistory(vehicleId)`; skeleton rows while loading
  - [x] Table layout: Date | Task | Odometer | Notes — follow `CategorySpendTable` Card/table styling (no shadcn Table export required; semantic `<table>` or grid is fine)
  - [x] Date: `format(parseISO(entry.service_date), "MMM d")` via `date-fns` (same pattern as expense forms)
  - [x] Task: `t(\`maintenance.tasks.${entry.task_type_key}\`)` — never raw `task_type_key`
  - [x] Odometer: `font-mono` + `{entry.odometer_km.toLocaleString()} km` (integer, thousands separator)
  - [x] Notes: show `entry.notes` or em dash when null/empty
  - [x] Sort: trust server order (newest first); do not re-sort client-side
  - [x] Pagination: `showAll` local state; display `entries.slice(0, showAll ? undefined : 10)`; if `entries.length > 10` and `!showAll`, show ghost/outline "View all" button (`maintenance.history.viewAll`)
  - [x] Empty: centered muted text `maintenance.history.empty` — "No service logged yet."
  - [x] `data-testid="service-history-table"`, row testids `service-history-row-{id}`

- [x] Vehicle card footer: Edit + Delete (AC: #4)
  - [x] Extend `VehicleCard.tsx` (from Story 16.3/16.4) with footer row below history: text buttons or ghost buttons "Edit vehicle" · "Delete vehicle"
  - [x] Create `EditVehicleForm.tsx` — SlideOver reusing `AddVehicleForm` field set (nickname required, make/model/year optional, odometer read-only or omitted on edit per AC — edit only nickname/make/model/year per Story 16.2 `update_vehicle`)
  - [x] Edit opens SlideOver; on save call `update_vehicle`; toast `maintenance.toast.vehicleUpdated`; invalidate `["maintenance"]`, `["maintenance", vehicleId]`, `["maintenance-alerts"]`
  - [x] Delete: `Dialog` + `DialogDescription` pattern from `ExpenseList.tsx` (destructive confirm button)
  - [x] On confirm: `delete_vehicle`; toast `maintenance.toast.vehicleDeleted`; invalidate `["maintenance"]`, `["maintenance-alerts"]` (history key drops with vehicle)
  - [x] `data-testid="edit-vehicle-button"`, `delete-vehicle-button`, `delete-vehicle-dialog`, `confirm-delete-vehicle-button`

- [x] Integrate history into expanded card body (AC: #1, #5)
  - [x] In `VehicleCard` expanded body: task list (`MaintenanceTaskRow` × 15) then `ServiceHistoryTable` below tasks (UX page structure)
  - [x] Only fetch history when card is expanded (`enabled: isExpanded` on query) to avoid N+1 on collapsed cards

- [x] i18n EN + FR (AC: #1, #2, #4)
  - [x] `maintenance.history.empty`, `maintenance.history.viewAll`, `maintenance.history.columns.date|task|odometer|notes`
  - [x] `maintenance.editVehicle`, `maintenance.deleteVehicle`, `maintenance.deleteVehicleConfirm`, `maintenance.toast.vehicleUpdated`, `maintenance.toast.vehicleDeleted`
  - [x] Ensure all 15 `maintenance.tasks.*` keys exist if not added in Story 16.3

- [x] Playwright E2E (AC: #1–#4)
  - [x] Extend or create `apps/desktop/tests/maintenance.spec.ts`
  - [x] Flow: register vehicle → log service (Story 17.3 UI) → expand card → assert history row shows date, task name, odometer
  - [x] Flow: vehicle with no logs → assert empty history message
  - [x] Flow: delete vehicle → confirm dialog → vehicle removed from list

## Dev Notes

### Critical prerequisites (Stories 16.1–17.3)

This story **completes FR59 (history + footer)** and assumes prior stories delivered:

| Prerequisite | Required artifacts |
|--------------|-------------------|
| 16.1 | Migration `018_maintenance_tables.sql`, `maintenance/defaults.rs`, `maintenance/evaluator.rs` — **DONE** (commit `056943e`) |
| 16.2 | `commands/maintenance.rs`, `delete_vehicle`, `update_vehicle`, vehicle CRUD |
| 16.3 | `routes/maintenance.tsx`, `VehicleCard` shell, `AddVehicleForm`, InnerTabNav tab |
| 16.4 | `MaintenanceTaskRow` with server-side status badges |
| 17.3 | `log_maintenance_service`, `LogServiceForm`, invalidates `["maintenance-history", vehicleId]` |

If `commands/maintenance.rs` or `useMaintenance.ts` do not exist yet, create them following `commands/asset.rs` + `useAssets.ts` patterns. Do **not** reimplement evaluator or schema in this story.

### Architecture compliance (D5, D8, FR59)

- **Append-only history:** `maintenance_service_logs` has no UPDATE path. This story adds **read-only** `get_service_history` only. UI must not show edit/delete on history rows.
- **IPC:** `#[tauri::command(rename_all = "snake_case")]` → `get_service_history(state, vehicle_id: i64) -> Result<Vec<MaintenanceServiceLogEntry>, AppError>`
- **SQL in `db/maintenance.rs` only** — not in commands file
- **Task names:** DB returns `task_type_key`; frontend resolves i18n — never store display names in DB
- **Query key:** `["maintenance-history", vehicleId]` — invalidate on `log_maintenance_service` (Story 17.3); this story wires the consumer

[Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D5, D8, TanStack Query Keys]

### `MaintenanceServiceLogEntry` shape

**Rust (`models/mod.rs`):**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceServiceLogEntry {
    pub id: i64,
    pub vehicle_id: i64,
    pub task_id: i64,
    pub task_type_key: String,
    pub service_date: String,      // YYYY-MM-DD
    pub odometer_km: i64,
    pub notes: Option<String>,
    pub created_at: String,
}
```

**TypeScript (`lib/types.ts`):** mirror with snake_case fields matching IPC JSON.

### `db/maintenance.rs` — `get_service_history`

```rust
pub fn get_service_history(
    conn: &Connection,
    vehicle_id: i64,
) -> Result<Vec<MaintenanceServiceLogEntry>, AppError> {
    // Verify vehicle exists (optional but consistent with other getters)
    let mut stmt = conn.prepare(
        "SELECT l.id, l.vehicle_id, l.task_id, t.task_type_key,
                l.service_date, l.odometer_km, l.notes, l.created_at
         FROM maintenance_service_logs l
         INNER JOIN maintenance_tasks t ON l.task_id = t.id
         WHERE l.vehicle_id = ?1
         ORDER BY l.service_date DESC, l.created_at DESC",
    )?;
    // map rows to MaintenanceServiceLogEntry
}
```

No `LIMIT` in SQL — frontend truncates to 10 with "View all" (matches UX-DR8 and epic AC).

### `ServiceHistoryTable` — UI pattern

Follow existing table-in-Card pattern (`CategorySpendTable.tsx`), not a new design system primitive:

- Section heading optional: `maintenance.history.title` (e.g., "Service history")
- Loading: 3 pulse rows inside card
- "View all" toggles `showAll` — same UX pattern as `ConversationListPanel` (`chat.showMore` / local `showAll` state)
- Notes column: truncate long text with `truncate max-w-[200px]` and `title` attribute for full text on hover

[Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § ServiceHistoryTable, Data Display]

### Vehicle footer — Edit & Delete

**Edit vehicle:** Reuse SlideOver from `@nixus/shared` (same as `AddVehicleForm` / `assets.tsx`). Fields per Story 16.2 `update_vehicle`: nickname, make, model, year — **do not** change odometer in edit form (odometer has dedicated `OdometerUpdateForm` in Story 17.2).

**Delete vehicle:** Mirror `ExpenseList.tsx` destructive dialog:

```tsx
<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
  <DialogContent data-testid="delete-vehicle-dialog">
    <DialogHeader>
      <DialogTitle>{t("maintenance.deleteVehicle")}</DialogTitle>
      <DialogDescription>
        {t("maintenance.deleteVehicleConfirm", { nickname: vehicle.nickname })}
        {" "}{t("budget.cannotBeUndone")}
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</Button>
      <Button variant="destructive" onClick={handleDelete} data-testid="confirm-delete-vehicle-button">
        {t("common.delete")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Audit log:** `delete_vehicle` must record audit entry in Story 16.2 — this story only calls the command; verify `entity_type` is `"vehicle"` (or consistent name chosen in 16.2).

**Invalidation on delete:**

```typescript
queryClient.invalidateQueries({ queryKey: ["maintenance"] });
queryClient.invalidateQueries({ queryKey: ["maintenance-alerts"] });
// No need to invalidate maintenance-history — vehicle is gone
```

### Anti-patterns (DO NOT)

- Client-side task status or due-date calculation — status comes from IPC only
- Edit/delete UI on service log rows — FR59 append-only
- Storing task display names in DB or returning them from Rust
- Duplicating SQL in `commands/maintenance.rs`
- FK or sync to `passive_assets`
- `maintenance_vehicles` or `car_*` table prefixes

### File structure (this story)

```
apps/desktop/src-tauri/src/
  db/maintenance.rs          # ADD get_service_history
  commands/maintenance.rs    # ADD command (file may be new)
  models/mod.rs              # ADD MaintenanceServiceLogEntry
  lib.rs                     # REGISTER command

apps/desktop/src/
  components/maintenance/
    ServiceHistoryTable.tsx  # NEW
    EditVehicleForm.tsx      # NEW
    VehicleCard.tsx          # MODIFY — history + footer
  hooks/useMaintenance.ts    # ADD useServiceHistory, useUpdateVehicle, useDeleteVehicle if missing
  lib/types.ts               # MODIFY
  lib/constants.ts           # MODIFY queryKeys
  locales/en.json, fr.json   # MODIFY

apps/desktop/tests/
  maintenance.spec.ts        # NEW or EXTEND
```

### Testing requirements

Per `dev-standards` skill:

1. `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
2. `cargo test` in `apps/desktop/src-tauri` — existing maintenance evaluator tests must still pass
3. Playwright: cover history display, empty state, delete confirmation
4. Forms: `mode: "onSubmit"`; scope locators to card/dialog containers

### Previous story intelligence (17.3)

Story 17.3 establishes:

- `log_maintenance_service` transaction (insert log + update task anchors + optional odometer bump)
- Query invalidation includes `["maintenance-history", vehicleId]` — **this story implements the query that 17.3 invalidates**
- `LogServiceForm` inline below task row — history table is separate section below all tasks

### Git intelligence (16.1)

Commit `056943e` landed:

- `018_maintenance_tables.sql`
- `maintenance/defaults.rs` (15 tasks, `ALERT_KM_THRESHOLD=500`, `ALERT_DAYS_THRESHOLD=14`)
- `maintenance/evaluator.rs` with unit tests
- `db/maintenance.rs` skeleton (2-line stub — **implement queries here**)

### Project context reference

- Brownfield Tauri 2 + React; feature folder `components/maintenance/`
- i18n: all strings under `maintenance.*` (NFR16)
- Compilation: follow `docs/guidelines/warnings.md` — zero Rust warnings

### References

- [Source: `_bmad-output/planning-artifacts/epics-car-maintenance.md` § Story 17.4]
- [Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D5, D8, FR59 mapping]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § VehicleCard, ServiceHistoryTable, Empty states]
- [Source: `apps/desktop/src/components/expenses/ExpenseList.tsx` — delete dialog pattern]
- [Source: `apps/desktop/src/components/chat/ConversationListPanel.tsx` — "show more" pagination pattern]
- [Source: `apps/desktop/src/hooks/useAssets.ts` — mutation + invalidation pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Fixed Playwright false positives: empty history text "No service logged yet." matched substring "Service logged" in prior logging tests; updated to `{ exact: true }`.

### Completion Notes List

- Implemented read-only `get_service_history` backend with `MaintenanceServiceLogEntry` (JOIN for `task_type_key`), Tauri command, and 3 Rust unit tests.
- Added `ServiceHistoryTable` with Card/table layout, date-fns formatting, 10-entry pagination, and lazy fetch when card expanded.
- Extended `VehicleCard` with service history section, edit SlideOver (`EditVehicleForm`), and destructive delete dialog.
- Added `useServiceHistory`, `useUpdateVehicle`, `useDeleteVehicle` hooks with correct query invalidation.
- Added EN/FR i18n keys for history, edit/delete, and toasts.
- Extended Playwright mock + 4 new E2E tests (history empty, history row, delete, edit).

### File List

- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/lib/types.ts
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/components/maintenance/ServiceHistoryTable.tsx
- apps/desktop/src/components/maintenance/EditVehicleForm.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts

## Change Log

- 2026-05-29: Story 17.4 — service history view, vehicle edit/delete footer, E2E coverage (FR59 complete)
