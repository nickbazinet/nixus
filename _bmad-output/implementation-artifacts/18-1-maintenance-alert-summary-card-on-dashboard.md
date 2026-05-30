# Story 18.1: Maintenance Alert Summary Card on Dashboard

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see a maintenance alerts summary on my dashboard when I open the app,
So that I know immediately if any vehicle needs attention without clicking through.

**FRs:** FR58, FR62  
**UX-DRs:** UX-DR1, UX-DR9 (dashboard empty/all-ok states)  
**NFRs:** NFR14 (alert evaluation ≤1s on launch), NFR16 (EN + FR i18n for dashboard copy)

## Acceptance Criteria

1. **Given** the dashboard loads  
   **When** `get_maintenance_alert_summary` is invoked via `useMaintenanceAlerts()`  
   **Then** alert status evaluates within 1 second of app launch (NFR14, FR58)

2. **Given** vehicles exist with tasks in upcoming, due, or overdue status  
   **When** the dashboard renders  
   **Then** `MaintenanceAlertCard` appears full-width after `YearToDateCard` and before the hero 2-column grid (UX-DR1, FR62)  
   **And** subtitle shows alert count (e.g., "2 items need attention")  
   **And** up to 2 vehicle rows show nickname, most urgent task i18n name, and urgency text  
   **And** card styling applies accent ring per `worst_status`: amber for upcoming, rose for due/overdue  
   **And** footer shows "View all →" (UX spec; entire card is clickable)

3. **Given** more than 2 vehicles have alerts  
   **When** the card renders  
   **Then** subtitle reads "2 of {n} vehicles need attention"

4. **Given** vehicles exist but all tasks are ok  
   **When** the dashboard renders  
   **Then** card shows "All maintenance up to date" with muted styling and no accent ring  
   **And** entire card still links to `/maintenance`

5. **Given** no vehicles are registered  
   **When** the dashboard renders  
   **Then** card shows "Track service schedules for your vehicles." with muted prompt (UX-DR9)  
   **And** card links to `/maintenance`

6. **Given** the alert card  
   **When** the user clicks anywhere on it  
   **Then** they navigate to `/maintenance`  
   **And** `role="link"` and descriptive `aria-label` include alert count and most urgent item

7. **Given** the card is loading  
   **When** data is fetching  
   **Then** a skeleton displays matching card layout (`data-testid="maintenance-alert-skeleton"`)

8. **Given** urgency text on dashboard rows  
   **When** rendered  
   **Then** only one dimension (km or days) is shown — the more urgent per server-side `most_urgent_task` computation  
   **And** text follows UX rules: "Due in {n} days", "{n} km remaining", "Overdue by {n} days", etc.

9. **Given** a maintenance mutation occurs (service logged, odometer updated, vehicle added/deleted)  
   **When** the user returns to or is on the dashboard  
   **Then** alert summary refreshes via TanStack Query invalidation of `["maintenance-alerts"]`

## Tasks / Subtasks

- [x] Task 1: Backend — `get_maintenance_alert_summary` command (AC: #1, #8)  
  **Prerequisite check:** Story 16.1 is complete (migration 018, `defaults.rs`, `evaluator.rs`). If Epic 16.2 vehicle CRUD is not yet merged, implement only the read path needed for this story.  
  - [x] Add Rust structs in `db/maintenance.rs` (or `models` if project convention): `MaintenanceAlertSummary`, `VehicleAlertRow`, `MostUrgentTask` matching architecture contract (see Dev Notes)  
  - [x] Implement `get_maintenance_alert_summary(conn) -> Result<MaintenanceAlertSummary, AppError>` in `db/maintenance.rs`:  
    - Load all vehicles + tasks; evaluate each task via `maintenance::evaluator::evaluate_task`  
    - Count tasks with status `upcoming`, `due`, or `overdue` as alerts  
    - For each vehicle with alerts: pick `most_urgent_task` (worst status rank, then smaller remaining km/days)  
    - For `most_urgent_task`: expose **only one** of `days_remaining` or `km_remaining` — whichever dimension drove the worse status (matches UX "never show both")  
    - Sort vehicles by urgency (overdue → due → upcoming); return top 2 in `vehicles` array for card rows; include total vehicle count with alerts for subtitle  
    - Set `worst_status` = worst across all vehicles (or `ok` if none)  
  - [x] Add `#[tauri::command(rename_all = "snake_case")] fn get_maintenance_alert_summary(state: State<DbState>) -> Result<MaintenanceAlertSummary, AppError>` in `commands/maintenance.rs`  
  - [x] Register command in `lib.rs` `invoke_handler!`  
  - [x] Rust unit test: empty DB → `{ total_alerts: 0, worst_status: "ok", vehicles: [] }`  
  - [x] Rust unit test: vehicle with upcoming task → correct `worst_status` and `most_urgent_task`

- [x] Task 2: TypeScript types and query key (AC: #1)  
  - [x] Add `MaintenanceAlertSummary`, `VehicleAlertRow`, `MostUrgentTask` to `apps/desktop/src/lib/types.ts` (snake_case fields matching IPC JSON)  
  - [x] Add `maintenanceAlerts: ["maintenance-alerts"] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts`

- [x] Task 3: `useMaintenanceAlerts` hook (AC: #1, #9)  
  - [x] Create `apps/desktop/src/hooks/useMaintenanceAlerts.ts`:  
    ```typescript
    export function useMaintenanceAlerts() {
      return useQuery({
        queryKey: queryKeys.maintenanceAlerts,
        queryFn: () => invoke<MaintenanceAlertSummary>("get_maintenance_alert_summary"),
      });
    }
    ```  
  - [x] **Do not** add invalidation here — Epic 16/17 mutation hooks must invalidate `queryKeys.maintenanceAlerts`. If those hooks don't exist yet, add a comment in this story's completion notes listing required invalidation sites (see Dev Notes).

- [x] Task 4: `MaintenanceAlertCard` component (AC: #2–#8)  
  - [x] Create `apps/desktop/src/components/dashboard/MaintenanceAlertCard.tsx`  
  - [x] Props: `data?: MaintenanceAlertSummary`, `isLoading?: boolean`  
  - [x] **Loading:** skeleton matching card layout — title bar, subtitle pulse, 2 row pulses (`data-testid="maintenance-alert-skeleton"`)  
  - [x] **No vehicles:** muted prompt copy; link to `/maintenance` (pattern: `CashFlowSummaryCard` empty state + `YearToDateCard` link wrapper)  
  - [x] **All ok:** "All maintenance up to date"; default card, no accent ring; still links to `/maintenance`  
  - [x] **Has alerts:** accent ring classes per `worst_status`:  
    - `upcoming` → `ring-1 ring-amber-500/30`  
    - `due` → `ring-1 ring-rose-500/40`  
    - `overdue` → `ring-1 ring-rose-500/60` + font-medium subtitle  
  - [x] Render up to 2 rows from `data.vehicles`: nickname · i18n task name · urgency text · row badge (amber/rose)  
  - [x] Subtitle: `dashboard.maintenance.itemsNeedAttention` or `dashboard.maintenance.vehiclesNeedAttention` when >2 vehicles  
  - [x] Header row: title "Maintenance" (muted 14px) + footer "View all →" (primary 12px)  
  - [x] Wrap entire card in `<Link to="/maintenance">` with `role="link"` and dynamic `aria-label`  
  - [x] Create `formatMaintenanceUrgency(task, t)` helper (same file or `lib/maintenanceUrgency.ts`) — **frontend formats only**, never computes status:
    - `days_remaining > 0` → `dashboard.maintenance.dueInDays`  
    - `days_remaining === 0` → `dashboard.maintenance.dueToday`  
    - `km_remaining > 0` → `dashboard.maintenance.kmRemaining`  
    - `km_remaining === 0` → `dashboard.maintenance.dueNow`  
    - negative days → `dashboard.maintenance.overdueByDays`  
    - negative km → `dashboard.maintenance.kmOverdue`  
  - [x] Task names: `t(\`maintenance.tasks.${task_type_key}\`)` — never display raw keys  
  - [x] Add `data-testid="maintenance-alert-card"` on the card root

- [x] Task 5: Dashboard integration (AC: #2)  
  - [x] In `apps/desktop/src/routes/index.tsx`:  
    - Import `useMaintenanceAlerts` and `MaintenanceAlertCard`  
    - Call `const maintenanceAlerts = useMaintenanceAlerts();` alongside existing parallel queries  
    - Insert after `YearToDateCard` block, before hero grid comment:  
      ```tsx
      <div className="mb-4">
        <MaintenanceAlertCard
          data={maintenanceAlerts.data}
          isLoading={maintenanceAlerts.isPending}
        />
      </div>
      ```  
  - [x] Card is **not** month-aware — do not pass `selectedYear`/`selectedMonth` (maintenance is live snapshot like `netWorthCurrent`)

- [x] Task 6: i18n — EN + FR (AC: #6, #8, NFR16)  
  - [x] Add keys under `dashboard.maintenance.*` in `apps/desktop/src/locales/en.json` and `fr.json`:  
    - `title`, `viewAll`, `itemsNeedAttention`, `vehiclesNeedAttention`, `allUpToDate`, `noVehicles`, `dueInDays`, `dueToday`, `kmRemaining`, `dueNow`, `overdueByDays`, `kmOverdue`, `overdue` (row label)  
  - [x] Ensure `maintenance.tasks.*` keys exist for all 15 `task_type_key` values from `defaults.rs` (may land in Epic 16 — verify before marking done; add stubs if missing so card never shows raw keys)

- [x] Task 7: Verify (AC: all)  
  - [x] `cargo test` in `apps/desktop/src-tauri/` — evaluator + new alert summary tests pass  
  - [x] `pnpm --filter @nkbaz/desktop exec tsc --noEmit` — zero errors  
  - [x] Manual: dashboard with 0 vehicles → prompt card; with vehicle all ok → muted ok card; with alert → accent ring + rows  
  - [x] Manual: click card → navigates to `/maintenance` (route may be Epic 16.3 — 404 acceptable until then, but Link target must be `/maintenance`)

## Dev Notes

### Scope boundaries

**In scope:** Dashboard alert summary card, `useMaintenanceAlerts`, `get_maintenance_alert_summary` backend (if not already present), dashboard i18n keys, query key registration.

**Out of scope (other epics):**
- InnerTabNav Maintenance tab + `/maintenance` page UI → Epic 16.3–16.4  
- Service logging, odometer updates, interval edits → Epic 17  
- Playwright E2E maintenance flow → Story 18.2  
- AI maintenance tools → Epic 19  

This story **may** ship before `/maintenance` route exists; the card still links there per UX.

### Prerequisites and current codebase state

| Artifact | Status |
|----------|--------|
| Migration `018_maintenance_tables.sql` | ✅ Merged (Story 16.1) |
| `maintenance/defaults.rs` + `evaluator.rs` | ✅ Merged with unit tests |
| `db/maintenance.rs` query layer | ⚠️ Skeleton only — SQL not implemented |
| `commands/maintenance.rs` | ❌ Not present |
| Frontend maintenance hooks/components | ❌ Not present |

**Epic dependency:** Full card behavior requires at least one vehicle with evaluated tasks. For dev/testing, use `create_vehicle` from Epic 16.2 or seed test data via SQL. If implementing backend in this story, keep vehicle write commands in Epic 16.2 — only add the read aggregation command here unless blocked.

### IPC response contract

From [architecture-car-maintenance.md](../planning-artifacts/architecture-car-maintenance.md) § D7:

```typescript
interface MaintenanceAlertSummary {
  total_alerts: number;
  worst_status: 'ok' | 'upcoming' | 'due' | 'overdue';
  vehicles: Array<{
    vehicle_id: number;
    nickname: string;
    alert_count: number;
    most_urgent_task: {
      task_type_key: string;
      status: 'ok' | 'upcoming' | 'due' | 'overdue';
      days_remaining?: number;
      km_remaining?: number;
    };
  }>;
}
```

- `vehicles` array: **pre-sorted, max 2 entries** for dashboard display (server trims)  
- `total_alerts`: count of alert tasks across all vehicles (for subtitle)  
- Status computed **only** in `evaluator.rs` — frontend never calculates due dates  

### Dashboard placement (exact)

Current `index.tsx` order (lines ~102–119):

1. `CashFlowSummaryCard`
2. `YearToDateCard`
3. **→ INSERT `MaintenanceAlertCard` here**
4. Hero 2-column grid (Net Worth + Budget Remaining)

Match spacing: wrap in `<div className="mb-4">` like YTD card.

### UI patterns to reuse (do NOT reinvent)

**Clickable dashboard card:** Copy structure from `CashFlowSummaryCard.tsx` and `YearToDateCard.tsx`:
- `<Link to="..." className="block">` wrapping `<Card role="link" aria-label={...}>`
- Skeleton: pulse bars in `CardContent className="p-6"`
- `shadow-sm rounded-lg` base card class

**Badge styling:** Follow `apps/desktop/src/components/dashboard/BudgetCategoryRow.tsx` for amber/rose badge classes.

**shadcn imports:** `Card`, `CardContent`, `Badge` from `@nixus/shared` — same as other dashboard cards.

### Visual treatment (UX-DR1)

| `worst_status` | Card ring | Subtitle | Row badge |
|----------------|-----------|----------|-----------|
| `ok` | none (default) | muted | — |
| `upcoming` | `ring-1 ring-amber-500/30` | amber foreground | amber |
| `due` | `ring-1 ring-rose-500/40` | rose foreground | rose |
| `overdue` | `ring-1 ring-rose-500/60` | rose, font-medium | rose + "Overdue" |

Card anatomy (UX spec):

```
┌─────────────────────────────────────────────────────────────┐
│ Maintenance                                    View all → │
│ 2 items need attention                                      │
│ Civic · Engine oil & filter · Due in 11 days          amber │
│ RAV4 · Tire rotation · 420 km remaining               amber │
└─────────────────────────────────────────────────────────────┘
```

### Query invalidation contract

Epic 16/17 mutation hooks **must** invalidate `queryKeys.maintenanceAlerts` on success:

| Mutation | Epic | Also invalidate |
|----------|------|-----------------|
| `create_vehicle` | 16.3 | `["maintenance"]` |
| `delete_vehicle` | 16.2 | `["maintenance"]` |
| `update_vehicle_odometer` | 17.2 | `["maintenance", vehicleId]` |
| `update_maintenance_task` | 17.1 | `["maintenance", vehicleId]` |
| `log_maintenance_service` | 17.3 | `["maintenance", vehicleId]`, `["maintenance-history", vehicleId]` |

If implementing 18.1 before those hooks exist, document invalidation requirements in completion notes — Story 18.2 E2E will fail without them.

### Critical architecture rules

- All maintenance SQL in `db/maintenance.rs` — never in `commands/maintenance.rs`  
- Commands: `#[tauri::command(rename_all = "snake_case")]`, return `Result<T, AppError>`  
- DB lock: `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?`  
- No FK to `passive_assets`; no net worth changes  
- Odometer: integer km, monospace display with thousands separator on rows  
- NFR14: ≤5 vehicles × 15 tasks = 75 evaluations — synchronous Rust is sufficient, no cache  

### `most_urgent_task` dimension selection (server)

When both km and time thresholds apply, pick the dimension that contributed the **worse** status (same `worst_of` logic as evaluator). If tied, prefer km when `interval_km > 0`, else days. Only populate the chosen field in the IPC response — frontend uses whichever field is present.

### Accessibility

Example `aria-label` when alerts exist:  
`"Maintenance: 2 items need attention. Civic engine oil and filter due in 11 days."`

Build dynamically from `total_alerts`, first vehicle nickname, and formatted urgency — use i18n where possible for task name portion.

### Files to create/modify

| File | Action |
|------|--------|
| `apps/desktop/src-tauri/src/db/maintenance.rs` | Implement `get_maintenance_alert_summary` |
| `apps/desktop/src-tauri/src/commands/maintenance.rs` | NEW — Tauri command |
| `apps/desktop/src-tauri/src/commands/mod.rs` | Register module |
| `apps/desktop/src-tauri/src/lib.rs` | Register command in handler |
| `apps/desktop/src/lib/types.ts` | Add maintenance alert types |
| `apps/desktop/src/lib/constants.ts` | Add `maintenanceAlerts` query key |
| `apps/desktop/src/hooks/useMaintenanceAlerts.ts` | NEW |
| `apps/desktop/src/components/dashboard/MaintenanceAlertCard.tsx` | NEW |
| `apps/desktop/src/routes/index.tsx` | Insert card |
| `apps/desktop/src/locales/en.json` | `dashboard.maintenance.*` keys |
| `apps/desktop/src/locales/fr.json` | `dashboard.maintenance.*` keys |

**Do NOT modify:** `passive_assets`, `net_worth.rs`, sidebar nav, onboarding wizard.

### Testing guidance

- **Rust:** Unit tests for alert aggregation in `db/maintenance.rs` using in-memory SQLite (follow `evaluator.rs` test patterns)  
- **Frontend:** No new Playwright spec in this story (Story 18.2)  
- **Manual verification:** Seed one vehicle via future `create_vehicle` or direct SQL; confirm card updates when task would be within 500 km or 14 days per `ALERT_KM_THRESHOLD` / `ALERT_DAYS_THRESHOLD`  

### Git intelligence (Story 16.1)

Recent commit `056943e` added maintenance module foundation. Patterns established:
- `maintenance/` module with `defaults.rs`, `evaluator.rs`, `mod.rs`
- Migration 018 registered in `db/mod.rs` as version 18
- `evaluator.rs` uses `TaskStatus` enum with `#[serde(rename_all = "snake_case")]`
- `#![allow(dead_code)]` on evaluator until commands wire it up — remove allow when integrating

### Project Structure Notes

- Component lives in `components/dashboard/` (not `components/maintenance/`) — dashboard-specific summary card  
- Hook at `hooks/useMaintenanceAlerts.ts` (separate from future `useMaintenance.ts` for CRUD)  
- Aligns with architecture D7/D8 and UX § Implementation Notes  

### References

- [Source: epics-car-maintenance.md § Story 18.1](../planning-artifacts/epics-car-maintenance.md)
- [Source: architecture-car-maintenance.md § D7 Dashboard Alert Integration](../planning-artifacts/architecture-car-maintenance.md)
- [Source: ux-design-specification.md § Dashboard: MaintenanceAlertCard](../planning-artifacts/ux-design-specification.md)
- [Source: implementation-readiness-report-car-maintenance-2026-05-29.md — "View all →" footer note](../planning-artifacts/implementation-readiness-report-car-maintenance-2026-05-29.md)
- [Source: apps/desktop/src/components/dashboard/CashFlowSummaryCard.tsx — clickable card pattern]
- [Source: apps/desktop/src/components/yearly-summary/YearToDateCard.tsx — skeleton + link pattern]
- [Source: apps/desktop/src/routes/index.tsx — dashboard layout insertion point]
- [Source: apps/desktop/src-tauri/src/maintenance/evaluator.rs — status evaluation]
- [Source: project-context.md — IPC, query keys, i18n rules]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Implemented `get_maintenance_alert_summary` backend aggregation with `total_vehicles` and `vehicles_with_alerts` fields (required to distinguish empty vs all-ok states and >2 vehicle subtitle).
- Added `pick_single_urgency_dimension` to evaluator for single-dimension IPC responses.
- Epic 16/17 `useMaintenance.ts` mutation hooks already invalidate `queryKeys.maintenanceAlerts` — no hook changes needed.
- Dashboard Playwright mocks updated with `get_maintenance_alert_summary` empty response.

### File List

- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src-tauri/src/maintenance/evaluator.rs
- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/commands/maintenance.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/lib/types.ts
- apps/desktop/src/hooks/useMaintenanceAlerts.ts
- apps/desktop/src/lib/maintenanceUrgency.ts
- apps/desktop/src/components/dashboard/MaintenanceAlertCard.tsx
- apps/desktop/src/routes/index.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/dashboard.spec.ts

## Change Log

- 2026-05-29: Story 18.1 — dashboard maintenance alert summary card, backend command, hook, i18n (EN+FR).
