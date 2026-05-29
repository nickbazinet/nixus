---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
scope: car-maintenance
inputDocuments:
  - prd.md
  - architecture-car-maintenance.md
  - architecture-desktop.md
  - ux-design-specification.md
---

# nkbaz-finance - Car Maintenance Module Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nkbaz-finance Car Maintenance Module, decomposing FR49–FR61 (and dashboard FR62) from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR49: User can register a vehicle for maintenance tracking as a standalone entity (nickname, make, model, year, current odometer) — not linked to passive assets
- FR50: User can manage multiple vehicles with independent maintenance schedules
- FR51: System provides default maintenance task templates with industry-baseline intervals (km and months), including: engine oil & filter, transmission fluid, brake fluid, coolant, differential/transfer case fluid, power steering fluid, tire rotation, tire inspection, brake inspection, engine air filter, cabin air filter, spark plugs, suspension/steering inspection, battery check, and wiper blades
- FR52: User can customize the interval (km and/or months) for any maintenance task on any vehicle
- FR53: User can manually update the current odometer reading for a vehicle
- FR54: User can log a completed maintenance event (task, date, odometer at service)
- FR55: System recalculates next due date and mileage for a task after a service is logged
- FR56: When a logged service odometer exceeds the vehicle's stored odometer, system updates the vehicle odometer to the higher value and notifies the user
- FR57: System evaluates maintenance due status using whichever threshold comes first — km or time
- FR58: System displays in-app alerts when a maintenance task is within 500 km or 14 days of due, or overdue
- FR59: User can view maintenance status (upcoming, due, overdue) and service history per vehicle
- FR60: User can query maintenance schedules and due dates via AI chat
- FR61: System can answer maintenance data queries with accurate, up-to-date information from the database
- FR62: User can view a maintenance alerts summary on the dashboard showing the count of approaching and overdue items across all vehicles

### NonFunctional Requirements

- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay) — applies to `/maintenance` route and InnerTabNav tab
- NFR5: AI chat responses return within 5 seconds for data queries — maintenance queries are local SQLite reads
- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted — applies to maintenance service logs and vehicle data
- NFR12: Database supports backup and restore capability — new maintenance tables included automatically in existing file-copy backup/restore
- NFR14: Maintenance alert status evaluates within 1 second of app launch
- NFR15: Odometer auto-update from service log (FR56) completes within 1 second and displays user notification before the user navigates away
- NFR16: All user-facing strings are available in English and French with no missing translation keys in shipped views — all `maintenance.*` keys

### Additional Requirements

- **Not a greenfield starter:** Extend existing Tauri 2 desktop app at `apps/desktop/` — first story is migration `018_maintenance_tables.sql`, not project scaffolding
- **Schema (D2):** Three tables — `vehicles`, `maintenance_tasks`, `maintenance_service_logs` — no FK to `passive_assets`
- **Default intervals (D1):** Embedded Rust baseline library in `maintenance/defaults.rs` — 15 task types with `task_type_key`, `interval_km`, `interval_months`; seeded on `create_vehicle`
- **Schedule evaluator (D3):** Pure Rust `maintenance/evaluator.rs` — status computed at read time (`ok`, `upcoming`, `due`, `overdue`); dual-threshold km OR months; alert windows 500 km / 14 days in `defaults.rs`
- **Service log transaction (D4):** Single SQLite transaction — insert log, update task anchors, conditional odometer update, audit log entry
- **IPC commands (D5):** `create_vehicle`, `get_vehicles`, `get_vehicle`, `update_vehicle`, `update_vehicle_odometer`, `delete_vehicle`, `update_maintenance_task`, `log_maintenance_service`, `get_service_history`, `get_maintenance_alert_summary` — all `snake_case`, `Result<T, AppError>`
- **AI tools (D6):** Read-only `query_maintenance_status`, `query_maintenance_history` in `commands/chat.rs` — 1-round tool-call pattern
- **Frontend structure (D8):** `routes/maintenance.tsx`, `components/maintenance/*`, `components/dashboard/MaintenanceAlertCard.tsx`, `hooks/useMaintenance.ts`, `hooks/useMaintenanceAlerts.ts`
- **TanStack Query keys:** `["maintenance"]`, `["maintenance", vehicleId]`, `["maintenance-alerts"]`, `["maintenance-history", vehicleId]`
- **Navigation:** Add Maintenance tab to `InnerTabNav` (Wrench icon) after Assets, before Net Worth — not sidebar
- **i18n:** All display strings via `maintenance.*` namespace; task names from `maintenance.tasks.{task_type_key}` — never store display names in DB
- **Evaluation triggers:** App launch, odometer update, service log create — no background scheduler
- **Playwright E2E:** Register vehicle → verify alert → log service → verify alert clears

### UX Design Requirements

- UX-DR1: `MaintenanceAlertCard` on dashboard — full-width after `YearToDateCard`, before hero grid; accent rings by `worst_status` (amber upcoming, rose due/overdue); up to 2 vehicle rows; entire card links to `/maintenance`
- UX-DR2: `/maintenance` page — PageHeader with vehicle count + Add Vehicle CTA; stacked collapsible `VehicleCard` list (newest first)
- UX-DR3: `AddVehicleForm` — SlideOver pattern (like Add Asset); required nickname + odometer; optional make/model/year; toast on create
- UX-DR4: `MaintenanceTaskRow` — task name (i18n), next due (monospace), status badge (slate/amber/rose), Log service button, interval edit icon on hover
- UX-DR5: `EditIntervalDialog` — km + months inputs with baseline hint; validation if both zero
- UX-DR6: `LogServiceForm` — inline expand below task row; date defaults today, odometer defaults vehicle odometer; info toast on odometer auto-update (4s duration)
- UX-DR7: `OdometerUpdateForm` — inline edit on VehicleCard header; monospace km display with thousands separator
- UX-DR8: `ServiceHistoryTable` — append-only, newest first, last 10 visible; columns Date, Task, Odometer, Notes
- UX-DR9: Empty states — no vehicles page, dashboard card no vehicles, all ok states per UX spec
- UX-DR10: Passive asset separation — no link to passive assets; optional muted helper on empty state only
- UX-DR11: Task list sort — overdue → due → upcoming → ok; within status, alphabetical by i18n task name
- UX-DR12: No maintenance onboarding step in MVP — module is opt-in

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR49 | Epic 16 | Register standalone vehicle |
| FR50 | Epic 16 | Multi-vehicle independent schedules |
| FR51 | Epic 16 | Default 15 task templates with baselines |
| FR52 | Epic 17 | Customize task intervals |
| FR53 | Epic 17 | Manual odometer update |
| FR54 | Epic 17 | Log completed maintenance event |
| FR55 | Epic 17 | Recalculate next due after service |
| FR56 | Epic 17 | Odometer auto-update from service log |
| FR57 | Epic 17 | Dual-threshold due evaluation |
| FR58 | Epic 18 | In-app alerts (approaching + overdue) |
| FR59 | Epic 16, 17 | Per-vehicle status + service history |
| FR60 | Epic 19 | AI chat maintenance queries |
| FR61 | Epic 19 | Accurate AI maintenance data responses |
| FR62 | Epic 18 | Dashboard alerts summary |

## Epic List

### Epic 16: Vehicle Registration & Maintenance Schedules
Users can register vehicles, receive pre-populated industry-baseline maintenance schedules, and view per-task status on the maintenance page.
**FRs covered:** FR49, FR50, FR51, FR59 (status view)
**UX-DRs addressed:** UX-DR2, UX-DR3, UX-DR4, UX-DR9, UX-DR10, UX-DR11

### Epic 17: Service Logging & Schedule Management
Users can customize intervals, update odometer readings, log completed services, and view service history — with automatic schedule recalculation and odometer correction.
**FRs covered:** FR52, FR53, FR54, FR55, FR56, FR57, FR59 (history)
**UX-DRs addressed:** UX-DR5, UX-DR6, UX-DR7, UX-DR8

### Epic 18: Dashboard Maintenance Alerts
Users see maintenance alert status at a glance on the dashboard without navigating away — knowing immediately if any vehicle needs attention.
**FRs covered:** FR58, FR62
**UX-DRs addressed:** UX-DR1, UX-DR9 (dashboard empty/all-ok states)

### Epic 19: AI Maintenance Queries
Users can ask natural language questions about maintenance schedules and due dates through the existing AI chat.
**FRs covered:** FR60, FR61

---

## Epic 16: Vehicle Registration & Maintenance Schedules

Users can register vehicles, receive pre-populated industry-baseline maintenance schedules, and view per-task status on the maintenance page.

### Story 16.1: Maintenance Schema, Baselines & Schedule Evaluator

As a developer,
I want the maintenance database schema, default task baselines, and schedule evaluation engine in place,
So that all maintenance IPC commands can compute accurate task status.

**Acceptance Criteria:**

**Given** the desktop app database
**When** migration `018_maintenance_tables.sql` runs
**Then** tables `vehicles`, `maintenance_tasks`, and `maintenance_service_logs` are created with columns, constraints, and indexes per architecture D2
**And** no FK references `passive_assets`

**Given** `maintenance/defaults.rs`
**When** loaded
**Then** `DEFAULT_TASKS` contains all 15 `task_type_key` entries with industry-baseline `interval_km` and `interval_months` per architecture D1
**And** `ALERT_KM_THRESHOLD` (500) and `ALERT_DAYS_THRESHOLD` (14) are defined as constants

**Given** `maintenance/evaluator.rs`
**When** unit tests run
**Then** dual-threshold logic (FR57) correctly returns `ok`, `upcoming`, `due`, and `overdue` for km-only, time-only, and combined tasks
**And** never-serviced tasks anchor from vehicle `created_at` and odometer 0
**And** time-only tasks (`battery_check`, `wiper_blades` with `interval_km = 0`) evaluate correctly

**Given** `db/maintenance.rs` module skeleton
**When** registered in `db/mod.rs` and `lib.rs`
**Then** the module exports query functions without SQL duplicated in commands

### Story 16.2: Vehicle Registration & CRUD Commands

As a user,
I want to register, view, edit, and delete vehicles with automatic maintenance schedule seeding,
So that each vehicle has a complete independent maintenance schedule from day one.

**Acceptance Criteria:**

**Given** no vehicles exist
**When** `create_vehicle` is invoked with nickname and odometer_km (required) and optional make, model, year
**Then** a `vehicles` row is inserted
**And** 15 `maintenance_tasks` rows are seeded from `DEFAULT_TASKS` for that vehicle (FR51)
**And** each task has at least one of `interval_km > 0` or `interval_months > 0`

**Given** multiple vehicles exist
**When** `get_vehicles` is invoked
**Then** all vehicles are returned sorted newest first (FR50)
**And** each vehicle's tasks are independent — no shared schedule state

**Given** a vehicle exists
**When** `get_vehicle` is invoked
**Then** the vehicle details and all 15 tasks are returned with computed status from `evaluator.rs` (FR59 partial)
**And** tasks include `status`, `km_remaining`, `days_remaining`, `next_due_date`, `next_due_odometer_km`

**Given** a vehicle exists
**When** `update_vehicle` is invoked
**Then** nickname, make, model, and year can be updated

**Given** a vehicle exists
**When** `delete_vehicle` is invoked
**Then** the vehicle and all related tasks and service logs are cascade-deleted
**And** an audit log entry is recorded

**Given** any write command
**When** validation fails (e.g., negative odometer, invalid year)
**Then** a typed `AppError::Validation` is returned with a descriptive message

### Story 16.3: Maintenance Page, Navigation & Add Vehicle

As a user,
I want a dedicated maintenance page accessible from the app navigation where I can add my first vehicle,
So that I can start tracking maintenance without leaving the finance app.

**Acceptance Criteria:**

**Given** the app renders InnerTabNav
**When** the accounts/assets tab group is displayed
**Then** a Maintenance tab appears after Assets and before Net Worth with Wrench icon and `nav.maintenance` label (UX-DR2)
**And** clicking it navigates to `/maintenance` instantly (NFR2)

**Given** no vehicles exist
**When** the user navigates to `/maintenance`
**Then** an empty state shows "No vehicles tracked yet." with centered Wrench icon and "Add Vehicle" primary CTA (UX-DR9)
**And** optional muted helper: "Maintenance tracking is separate from asset values in Net Worth." (UX-DR10)

**Given** the user clicks "Add Vehicle"
**When** the SlideOver opens
**Then** `AddVehicleForm` shows nickname (required), make, model, year (optional), odometer km (required, min 0) (UX-DR3)
**And** on save, `create_vehicle` is invoked and a success toast shows `maintenance.toast.vehicleCreated`
**And** TanStack Query keys `["maintenance"]` and `["maintenance-alerts"]` are invalidated

**Given** one or more vehicles exist
**When** the maintenance page loads
**Then** PageHeader shows "Maintenance" title, "{n} vehicles tracked" subtitle, and "Add Vehicle" button
**And** vehicles render as stacked `VehicleCard` components, newest first

**Given** the maintenance page
**When** loading data
**Then** skeleton cards display (`data-testid` on key elements) matching assets page loading pattern

**Given** all maintenance UI strings
**When** rendered in EN and FR
**Then** no raw `task_type_key` values appear — all labels use i18n keys under `maintenance.*` (NFR16)

### Story 16.4: Task Status Display on Vehicle Cards

As a user,
I want to see each maintenance task's status and next due information on my vehicle cards,
So that I know what needs attention without logging a service first.

**Acceptance Criteria:**

**Given** a vehicle with seeded tasks
**When** its `VehicleCard` is expanded
**Then** 15 `MaintenanceTaskRow` components render sorted overdue → due → upcoming → ok, then alphabetical by i18n task name (UX-DR11)

**Given** a task row
**When** displayed
**Then** it shows: i18n task name, monospace next-due line, status badge, and "Log service" outline button (UX-DR4)
**And** status badges use: slate "On track" (ok), amber "Upcoming", amber outline "Due", rose "Overdue"

**Given** a never-serviced task
**When** displayed
**Then** next-due shows "Not yet serviced" with countdown anchored from vehicle registration date

**Given** a task with km threshold closer than time threshold
**When** displayed on the task row
**Then** only the more urgent dimension is shown (e.g., "480 km remaining" not both km and days)

**Given** a vehicle card header
**When** rendered
**Then** nickname (H3), make/model/year (muted), and odometer display as monospace integer km with thousands separator (UX-DR7 display-only at this stage)

**Given** multiple vehicles
**When** the page loads with one vehicle
**Then** that vehicle's card is expanded by default
**When** multiple vehicles exist
**Then** all cards show collapsed headers; user expands the one they need

**Given** task status values
**When** returned from IPC
**Then** status is computed server-side in Rust only — frontend never calculates due dates (architecture enforcement)

---

## Epic 17: Service Logging & Schedule Management

Users can customize intervals, update odometer readings, log completed services, and view service history — with automatic schedule recalculation and odometer correction.

### Story 17.1: Customize Maintenance Intervals

As a user,
I want to customize the km and/or month interval for any maintenance task on my vehicle,
So that my schedule reflects my driving habits and manufacturer's recommendations.

**Acceptance Criteria:**

**Given** a task row on a vehicle card
**When** the user hovers and clicks the interval edit icon
**Then** `EditIntervalDialog` opens with km and months integer inputs pre-filled with current values (UX-DR5)
**And** helper text shows the industry baseline from defaults (e.g., "8,000 km / 6 mo")

**Given** the edit dialog
**When** the user sets both km and months to zero and saves
**Then** validation prevents save with an inline error message

**Given** valid interval values
**When** the user saves
**Then** `update_maintenance_task` updates the per-vehicle task row (FR52)
**And** task status recalculates immediately using new intervals
**And** a success toast shows `maintenance.toast.intervalUpdated`
**And** query keys `["maintenance", vehicleId]` and `["maintenance-alerts"]` invalidate

**Given** a customized interval
**When** another vehicle's same task type is viewed
**Then** that vehicle retains its own independent interval (FR50)

### Story 17.2: Manual Odometer Updates

As a user,
I want to manually update my vehicle's current odometer reading,
So that maintenance due calculations reflect my actual mileage.

**Acceptance Criteria:**

**Given** a vehicle card header showing odometer
**When** the user clicks the odometer value
**Then** `OdometerUpdateForm` shows an inline Input (UX-DR7)
**And** Enter saves, Escape cancels

**Given** a valid odometer value
**When** the user saves
**Then** `update_vehicle_odometer` updates `vehicles.odometer_km` (FR53)
**And** all task statuses recalculate with the new odometer
**And** a success toast shows `maintenance.toast.odometerManual`
**And** alert summary refreshes within 1 second (NFR14)

**Given** an invalid odometer (negative or non-integer)
**When** the user attempts to save
**Then** inline validation error is shown and no update occurs

**Given** the odometer display
**When** rendered
**Then** it shows integer km with thousands separator and "km" suffix — never decimals

### Story 17.3: Service Logging with Schedule Recalculation

As a user,
I want to log a completed maintenance service with date and odometer,
So that my maintenance countdown resets and alerts update automatically.

**Acceptance Criteria:**

**Given** a task row
**When** the user clicks "Log service"
**Then** `LogServiceForm` expands inline below the row with date (defaults today), odometer (defaults vehicle odometer), and optional notes (UX-DR6)

**Given** valid service data
**When** the user saves
**Then** `log_maintenance_service` runs in a single transaction (D4): inserts service log, updates task `last_service_date` and `last_service_odometer_km`, and commits (FR54, FR55)
**And** task status recalculates to reflect the new anchor points (FR57)
**And** a success toast shows `maintenance.toast.serviceLogged`

**Given** the logged service odometer exceeds the vehicle's stored odometer
**When** the transaction completes
**Then** `vehicles.odometer_km` updates to the higher value (FR56)
**And** `LogServiceResult.odometer_updated` is `true` with `previous_odometer_km` and `new_odometer_km`
**And** an info toast shows `maintenance.toast.odometerUpdated` with the new km value within 1 second (NFR15)
**And** toast duration is 4 seconds
**And** an audit log entry records the odometer correction

**Given** the logged service odometer does not exceed stored odometer
**When** the transaction completes
**Then** `odometer_updated` is `false` and no odometer correction toast appears

**Given** a service is logged for a task previously in upcoming/due/overdue status
**When** the task row refreshes
**Then** status resets based on new last-service anchors (e.g., back to "On track" or "Upcoming")

**Given** any maintenance mutation
**When** it completes
**Then** TanStack Query keys `["maintenance"]`, `["maintenance", vehicleId]`, `["maintenance-alerts"]`, and `["maintenance-history", vehicleId]` invalidate

### Story 17.4: Service History View

As a user,
I want to view the service history for each vehicle,
So that I can see when maintenance was last performed and at what mileage.

**Acceptance Criteria:**

**Given** a vehicle with logged services
**When** its card is expanded
**Then** `ServiceHistoryTable` displays columns: Date (short format, e.g., "Mar 14"), Task (i18n name), Odometer (monospace km), Notes (UX-DR8)
**And** entries are sorted newest first
**And** up to 10 entries are visible with "View all" if more exist

**Given** a vehicle with no service logs
**When** the history section renders
**Then** it shows "No service logged yet."

**Given** `get_service_history` command
**When** invoked for a vehicle
**Then** append-only log entries are returned — no update or delete operations on history (FR59)

**Given** a vehicle card footer
**When** rendered
**Then** "Edit vehicle" and "Delete vehicle" actions are available
**And** delete shows a destructive confirmation dialog before calling `delete_vehicle`

**Given** complete per-vehicle status and history
**When** the user views a vehicle card
**Then** FR59 is fully satisfied — status badges for all tasks plus complete service history

---

## Epic 18: Dashboard Maintenance Alerts

Users see maintenance alert status at a glance on the dashboard without navigating away — knowing immediately if any vehicle needs attention.

### Story 18.1: Maintenance Alert Summary Card on Dashboard

As a user,
I want to see a maintenance alerts summary on my dashboard when I open the app,
So that I know immediately if any vehicle needs attention without clicking through.

**Acceptance Criteria:**

**Given** the dashboard loads
**When** `get_maintenance_alert_summary` is invoked via `useMaintenanceAlerts()`
**Then** alert status evaluates within 1 second of app launch (NFR14, FR58)

**Given** vehicles exist with tasks in upcoming, due, or overdue status
**When** the dashboard renders
**Then** `MaintenanceAlertCard` appears full-width after `YearToDateCard` and before the hero 2-column grid (UX-DR1, FR62)
**And** subtitle shows alert count (e.g., "2 items need attention")
**And** up to 2 vehicle rows show nickname, most urgent task i18n name, and urgency text
**And** card styling applies accent ring per `worst_status`: amber for upcoming, rose for due/overdue

**Given** more than 2 vehicles have alerts
**When** the card renders
**Then** subtitle reads "2 of {n} vehicles need attention"

**Given** vehicles exist but all tasks are ok
**When** the dashboard renders
**Then** card shows "All maintenance up to date" with muted styling and no accent ring
**And** entire card still links to `/maintenance`

**Given** no vehicles are registered
**When** the dashboard renders
**Then** card shows "Track service schedules for your vehicles." with muted prompt (UX-DR9)
**And** card links to `/maintenance`

**Given** the alert card
**When** the user clicks anywhere on it
**Then** they navigate to `/maintenance`
**And** `role="link"` and descriptive `aria-label` include alert count and most urgent item

**Given** the card is loading
**When** data is fetching
**Then** a skeleton displays matching card layout (`data-testid="maintenance-alert-skeleton"`)

**Given** urgency text on dashboard rows
**When** rendered
**Then** only one dimension (km or days) is shown — the more urgent per server-side `most_urgent_task` computation
**And** text follows UX rules: "Due in {n} days", "{n} km remaining", "Overdue by {n} days", etc.

**Given** a maintenance mutation occurs (service logged, odometer updated, vehicle added/deleted)
**When** the user returns to or is on the dashboard
**Then** alert summary refreshes via TanStack Query invalidation of `["maintenance-alerts"]`

### Story 18.2: Maintenance End-to-End Verification

As a developer,
I want automated E2E coverage of the core maintenance workflow,
So that regressions in vehicle registration, alerting, and service logging are caught before release.

**Acceptance Criteria:**

**Given** Playwright test `apps/desktop/tests/maintenance.spec.ts`
**When** the test runs
**Then** it registers a vehicle with nickname and odometer
**And** verifies 15 tasks appear on the maintenance page
**And** verifies dashboard alert card reflects task status
**And** logs a service for a task
**And** verifies task status resets and dashboard alert updates accordingly

**Given** EN and FR locale files
**When** the maintenance module renders
**Then** all `maintenance.*`, `nav.maintenance`, and `dashboard.maintenance.*` keys exist in both `en.json` and `fr.json` with no missing keys (NFR16)

**Given** a database backup is exported after adding maintenance data
**When** the backup is restored
**Then** vehicles, tasks, and service logs are preserved (NFR12)

---

## Epic 19: AI Maintenance Queries

Users can ask natural language questions about maintenance schedules and due dates through the existing AI chat.

### Story 19.1: AI Maintenance Query Tools

As a user,
I want to ask the AI chat about my maintenance schedules and due dates,
So that I can get quick answers without navigating to the maintenance page.

**Acceptance Criteria:**

**Given** the user has registered vehicles with maintenance schedules
**When** they ask "When is my Civic due for an oil change?" in AI chat
**Then** the system invokes `query_maintenance_status` tool with appropriate filters (FR60)
**And** returns accurate vehicle nickname, task name, status, and next due km/date from the database (FR61, NFR5)

**Given** the user asks about service history
**When** they ask "When did I last change the oil on my Civic?"
**Then** `query_maintenance_history` is invoked with `vehicle_id` and optional `task_type_key`
**And** returns service log entries with date, odometer, and task name

**Given** `query_maintenance_status` tool definition
**When** registered in `execute_tool_call`
**Then** it accepts optional `vehicle_id` and `status_filter` (`upcoming`/`due`/`overdue`/`all`)
**And** returns vehicles with tasks and computed status — read-only, no write actions

**Given** the budget-helper system prompt
**When** updated in `ai/chat.rs`
**Then** maintenance data model and tool usage guidance are documented
**And** maintenance context (vehicle count, alert count) is injected into chat context string

**Given** no vehicles are registered
**When** the user asks a maintenance question
**Then** the AI responds accurately that no vehicles are tracked — no fabricated data (FR61)

**Given** the existing 1-round tool-call pattern
**When** maintenance tools are invoked
**Then** they follow the same pattern as `query_expenses` — no multi-hop tool chains
