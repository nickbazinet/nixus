# Story 16.4: Task Status Display on Vehicle Cards

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see each maintenance task's status and next due information on my vehicle cards,
So that I know what needs attention without logging a service first.

## Acceptance Criteria

1. **Given** a vehicle with seeded tasks  
   **When** its `VehicleCard` is expanded  
   **Then** 15 `MaintenanceTaskRow` components render sorted overdue → due → upcoming → ok, then alphabetical by i18n task name (UX-DR11)

2. **Given** a task row  
   **When** displayed  
   **Then** it shows: i18n task name, monospace next-due line, status badge, and "Log service" outline button (UX-DR4)  
   **And** status badges use: slate "On track" (ok), amber "Upcoming", amber outline "Due", rose "Overdue"

3. **Given** a never-serviced task  
   **When** displayed  
   **Then** next-due shows "Not yet serviced" with countdown anchored from vehicle registration date (evaluator returns `days_remaining` / `km_remaining`; frontend formats only)

4. **Given** a task with km threshold closer than time threshold  
   **When** displayed on the task row  
   **Then** only the more urgent dimension is shown (e.g., "480 km remaining" not both km and days)

5. **Given** a vehicle card header  
   **When** rendered  
   **Then** nickname (H3), make/model/year (muted), and odometer display as monospace integer km with thousands separator (UX-DR7 display-only at this stage — no inline edit)

6. **Given** multiple vehicles  
   **When** the page loads with one vehicle  
   **Then** that vehicle's card is expanded by default  
   **When** multiple vehicles exist  
   **Then** all cards show collapsed headers; user expands the one they need

7. **Given** task status values  
   **When** returned from IPC  
   **Then** status is computed server-side in Rust only — frontend never calculates due dates (architecture enforcement)

## Tasks / Subtasks

- [x] Task 1: TypeScript types and display helpers (AC: #4, #7)
  - [x] Add `MaintenanceTaskWithStatus`, `VehicleWithTasks` to `apps/desktop/src/lib/types.ts` matching architecture IPC shape
  - [x] Create `apps/desktop/src/lib/maintenanceUtils.ts` with:
    - [x] `formatOdometerKm(km: number): string` — integer, monospace-friendly, `toLocaleString("en-US")` + `" km"` suffix
    - [x] `getStatusSortOrder(status): number` — overdue=0, due=1, upcoming=2, ok=3
    - [x] `sortMaintenanceTasks(tasks, t): MaintenanceTaskWithStatus[]` — status order then `localeCompare` on `t(\`maintenance.tasks.${task_type_key}\`)`
    - [x] `pickUrgencyDisplay(task): { kind: 'km' | 'days' | 'never-serviced' | 'none'; ... }` — compare `km_remaining` vs `days_remaining` when both present; pick smaller remaining; never-serviced when `last_service_date === null`
    - [x] `formatNextDueLine(task, t): string` — maps IPC fields to i18n copy; relative dates within 14 days via `date-fns` (`formatDistanceToNow`, `format`); absolute otherwise per UX spec
  - [x] **Do not** import evaluator logic or recompute status/dates in TypeScript

- [x] Task 2: i18n keys EN + FR (AC: #2, #3, #4)
  - [x] Add `maintenance.tasks.*` for all 15 `task_type_key` values (see architecture D1)
  - [x] Add `maintenance.status.ok|upcoming|due|overdue` ("On track", "Upcoming", "Due", "Overdue")
  - [x] Add `maintenance.nextDue.notYetServiced`, `kmRemaining`, `daysRemaining`, `dueToday`, `dueNow`, `daysOverdue`, `kmOverdue`, `dueOnDate`
  - [x] Add `maintenance.actions.logService` for outline button label
  - [x] Verify no raw `task_type_key` appears in UI (NFR16)

- [x] Task 3: `MaintenanceTaskRow` component (AC: #1–#4, #7)
  - [x] Create `apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx`
  - [x] Props: `task: MaintenanceTaskWithStatus`, optional `onLogService?: (taskId: number) => void`
  - [x] Layout: task name (left) | next-due monospace line (secondary) | status `Badge` | outline `Button` "Log service"
  - [x] Badge classes: ok → slate/muted; upcoming → amber fill; due → amber outline; overdue → rose
  - [x] `data-testid="maintenance-task-row"` and `data-testid="maintenance-task-status-{status}"`
  - [x] Log service button: render with `data-testid="log-service-button"`; wire `onLogService` stub (no-op) — full `LogServiceForm` is Story 17.3
  - [x] **Do not** add interval edit icon (Story 17.1)

- [x] Task 4: Enhance `VehicleCard` collapsible task list (AC: #1, #5, #6)
  - [x] Update `apps/desktop/src/components/maintenance/VehicleCard.tsx` (created in Story 16.3)
  - [x] Header: nickname `<h3>`, make/model/year muted text, display-only odometer via `formatOdometerKm`
  - [x] Chevron toggle with `aria-expanded`; keyboard-accessible button (follow `BudgetCategoryRow` / `AutoCategorizedSummary` patterns)
  - [x] Expanded body: sorted `MaintenanceTaskRow` list (15 rows when data complete)
  - [x] Default expand logic: pass `defaultExpanded` from parent — `true` when vehicle count === 1, else `false`
  - [x] `data-testid="vehicle-card"`, `data-testid="vehicle-card-header"`, `data-testid="vehicle-card-tasks"`

- [x] Task 5: Wire into maintenance page (AC: #6)
  - [x] Update `apps/desktop/src/routes/maintenance.tsx` to pass `defaultExpanded={vehicles.length === 1}` to each `VehicleCard`
  - [x] Ensure `useMaintenance` / `get_vehicle` (Story 16.2) returns tasks with full `MaintenanceTaskWithStatus` fields

- [x] Task 6: Playwright tests (AC: all)
  - [x] Extend `apps/desktop/tests/maintenance.spec.ts` (or create if 16.3 added stub)
  - [x] Seed vehicle via UI (16.3 flow) or test helper
  - [x] Assert single vehicle card expanded by default; task rows count === 15
  - [x] Assert status badges render (at least ok/upcoming variants if test data allows)
  - [x] Assert next-due line is monospace (`font-mono` class present)
  - [x] Assert no raw `engine_oil_filter`-style keys in visible text
  - [x] Two-vehicle scenario: both collapsed initially; expand one → tasks visible

## Dev Notes

### Story Scope & Dependencies

This story is **frontend-only**. It completes the read-only task status UX on vehicle cards. It **depends on**:

| Prerequisite | Delivers |
|--------------|----------|
| **Story 16.1** (done — commit `056943e`) | `maintenance/evaluator.rs`, `defaults.rs`, migration `018_maintenance_tables.sql`, `db/maintenance.rs` skeleton |
| **Story 16.2** (must be done first) | `get_vehicle` / `get_vehicles` IPC returning `MaintenanceTaskWithStatus` with computed `status`, `km_remaining`, `days_remaining`, `next_due_date`, `next_due_odometer_km` |
| **Story 16.3** (must be done first) | `/maintenance` route, `VehicleCard` shell, `useMaintenance` hook, InnerTabNav tab, Add Vehicle flow |

**Out of scope for 16.4 (later stories):**

- `LogServiceForm` action wiring → Story 17.3
- `EditIntervalDialog` / interval edit icon → Story 17.1
- `OdometerUpdateForm` inline edit → Story 17.2
- `ServiceHistoryTable` → Story 17.4

### Architecture Compliance

- Status evaluation lives **only** in `apps/desktop/src-tauri/src/maintenance/evaluator.rs` — frontend consumes IPC fields verbatim
- IPC response shape (`MaintenanceTaskWithStatus`):

```typescript
interface MaintenanceTaskWithStatus {
  id: number;
  vehicle_id: number;
  task_type_key: string;
  interval_km: number;
  interval_months: number;
  last_service_date: string | null;
  last_service_odometer_km: number | null;
  status: 'ok' | 'upcoming' | 'due' | 'overdue';
  km_remaining: number | null;
  days_remaining: number | null;
  next_due_date: string | null;       // "YYYY-MM-DD"
  next_due_odometer_km: number | null;
}
```

- Never-serviced tasks: Rust anchors from vehicle `created_at` and odometer 0 — frontend shows `maintenance.nextDue.notYetServiced` when `last_service_date === null`, plus formatted countdown from IPC `km_remaining` / `days_remaining`
- Dual-threshold display rule: when both km and days remain, show **only** the dimension with the **smaller** remaining value (more urgent). Time-only tasks (`battery_check`, `wiper_blades`) show days only; km-only show km only

### UX Requirements (UX-DR4, UX-DR7, UX-DR11)

**Task row anatomy** ([ux-design-specification.md § Car Maintenance Module](_bmad-output/planning-artifacts/ux-design-specification.md)):

| Column | Implementation |
|--------|----------------|
| Task name | `t(\`maintenance.tasks.${task_type_key}\`)` |
| Next due | Monospace secondary line — one dimension only |
| Status | Badge per status semantics table |
| Actions | Outline "Log service" button (stub until 17.3) |

**Status badge semantics:**

| Status | Badge | Tailwind guidance |
|--------|-------|-------------------|
| ok | "On track" | slate/muted — e.g. `bg-slate-500/10 text-slate-600` |
| upcoming | "Upcoming" | amber fill — e.g. `bg-amber-500/10 text-amber-600` |
| due | "Due" | amber outline — e.g. `border-amber-500/50 text-amber-600 bg-transparent` |
| overdue | "Overdue" | rose — e.g. `bg-rose-500/10 text-rose-600` |

Follow existing `Badge` usage in `BudgetCategoryRow.tsx` — import from `@nixus/shared`.

**Odometer display (display-only):** Integer km, monospace, thousands separator — `"52,300 km"`. Use `formatOdometerKm`; do **not** add click-to-edit (17.2).

**Collapsible default state:** 1 vehicle → expanded; 2+ → all collapsed. Parent (`maintenance.tsx`) controls `defaultExpanded`; `VehicleCard` uses `useState(defaultExpanded)` — do not auto-expand on subsequent renders when list changes unless explicitly resetting.

**Date formatting:** Use `date-fns` (project standard). Relative copy when `|days_remaining| ≤ 14` ("Due in 11 days", "12 days overdue"); absolute otherwise ("Due Jun 3, 2026"). Never compute due dates — format `next_due_date` and `days_remaining` from IPC only.

### File Structure

```
apps/desktop/src/
├── components/maintenance/
│   ├── VehicleCard.tsx          # MODIFY — header + collapsible task list
│   └── MaintenanceTaskRow.tsx   # NEW
├── lib/
│   ├── types.ts                 # MODIFY — maintenance types
│   └── maintenanceUtils.ts      # NEW — sort/format helpers (no status math)
├── routes/maintenance.tsx       # MODIFY — defaultExpanded prop
└── locales/
    ├── en.json                  # MODIFY — maintenance.* keys
    └── fr.json                  # MODIFY — maintenance.* keys
```

**Do not modify:** Rust evaluator, `passive_assets`, dashboard, AI chat.

### Testing Standards

- Rust unit tests for evaluator already exist (Story 16.1) — no new Rust tests required for 16.4
- Playwright E2E in `apps/desktop/tests/maintenance.spec.ts`
- Use `data-testid` on vehicle cards, task rows, status badges (match assets page pattern)
- Run: `pnpm --filter @nkbaz/desktop test:e2e -- maintenance.spec.ts`

### Previous Story Intelligence

**Story 16.1 (implemented):**

- `evaluate_task()` in `evaluator.rs` returns `TaskStatus` + remaining fields; serializes as snake_case JSON
- Alert thresholds: `ALERT_KM_THRESHOLD = 500`, `ALERT_DAYS_THRESHOLD = 14` in `defaults.rs`
- 15 task type keys in `DEFAULT_TASKS` — frontend i18n must cover all keys exactly
- `db/maintenance.rs` is a skeleton — Story 16.2 fills query functions that call evaluator

**Story 16.2 (epic spec — IPC contract this story consumes):**

- `get_vehicle` returns vehicle + 15 tasks with computed status fields
- Tasks independent per vehicle (FR50)
- Validation errors as `AppError::Validation`

**Story 16.3 (epic spec — shell this story extends):**

- `/maintenance` route with PageHeader, stacked `VehicleCard` list, skeleton loading, empty state
- TanStack Query key `["maintenance"]`; invalidates on vehicle create
- InnerTabNav Maintenance tab (Wrench icon) after Assets

### Git Intelligence

Recent commit `056943e` (Story 16.1) established:

- Migration path: `apps/desktop/src-tauri/migrations/018_maintenance_tables.sql`
- Module registration in `lib.rs` and `db/mod.rs`
- Zero-warning discipline — maintain `cargo test` + no `dead_code` leaks when extending

No frontend maintenance files exist yet — 16.3 creates the shell; 16.4 adds task row components.

### Anti-Patterns (DO NOT)

- ❌ Frontend date/odometer math to derive `status`, `days_remaining`, or `next_due_date`
- ❌ Render raw `task_type_key` strings in UI
- ❌ Show both km and days on the same row when both thresholds apply
- ❌ Implement `LogServiceForm`, `EditIntervalDialog`, or `OdometerUpdateForm` in this story
- ❌ Import from `components/assets/` — maintenance is self-contained per architecture
- ❌ Duplicate SQL or evaluator logic in TypeScript helpers

### Project Structure Notes

- Package imports: `@nixus/shared` for `Badge`, `Button`, `Card` (not `@nkbaz/shared` — project renamed per recent commits)
- Collapsible pattern: manual `useState` + ChevronDown/Right (no Collapsible primitive in shared package) — see `BudgetCategoryRow.tsx`, `BudgetGroupCard.tsx`
- i18n: `useTranslation()` hook; keys under `maintenance.*` in both `en.json` and `fr.json`

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md § Story 16.4]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md § D3 Schedule Evaluation, D8 Maintenance View, Format Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md § Car Maintenance Module — Task row anatomy, VehicleCard, Data Display]
- [Source: apps/desktop/src-tauri/src/maintenance/evaluator.rs — IPC field semantics]
- [Source: apps/desktop/src/components/budget/BudgetCategoryRow.tsx — Badge + expand pattern]
- [Source: apps/desktop/src/routes/assets.tsx — skeleton/empty state pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright locator `[data-testid^='vehicle-card-']` matched nested header/tasks testids — fixed by scoping to `vehicle-card-header` count
- Multi-vehicle collapsed test uses pre-seeded mock vehicles on fresh page load (avoids stale expanded state when transitioning 1→2 vehicles)

### Completion Notes List

- Added `MaintenanceTaskWithStatus` / `VehicleWithTasks` types and `maintenanceUtils.ts` display helpers (sort, odometer format, urgency pick, next-due i18n formatting — no status math)
- Added EN/FR i18n for all 15 task types, status badges, next-due copy, and log service action
- Created `MaintenanceTaskRow` with status badges, monospace next-due line, and stub log service button
- Enhanced `VehicleCard` with collapsible chevron header, sorted 15-task list, and `defaultExpanded` prop
- Updated `useMaintenance` to fetch `get_vehicle` per vehicle for full task status fields
- Extended Playwright tests: 15 task rows, badges, monospace line, no raw keys, single expanded / multi collapsed scenarios
- Quality gates: `tsc --noEmit` pass, `cargo check && cargo test` 75 pass, `playwright test maintenance.spec.ts` 12 pass

### File List

- apps/desktop/src/lib/types.ts
- apps/desktop/src/lib/maintenanceUtils.ts
- apps/desktop/src/components/maintenance/MaintenanceTaskRow.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/routes/maintenance.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-05-29: Story 16.4 — task status display on vehicle cards (MaintenanceTaskRow, collapsible VehicleCard, i18n, E2E tests)
