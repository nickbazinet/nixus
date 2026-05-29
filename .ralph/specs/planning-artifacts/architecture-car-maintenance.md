---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-05-29'
scope: 'car-maintenance'
parentDocument: architecture-desktop.md
inputDocuments:
  - prd.md
  - architecture-desktop.md
  - project-context.md
  - ux-design-specification.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-05-29'
---

# Car Maintenance Module — Architecture Decision Document

_Scoped architecture addendum for FR49–FR61 (Car Maintenance Management). Extends [architecture-desktop.md](architecture-desktop.md). Builds collaboratively through step-by-step discovery._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

13 FRs (FR49–FR61) forming a self-contained maintenance tracking subsystem:

| Group | FRs | Architectural role |
|-------|-----|-------------------|
| Vehicle CRUD | FR49–FR50 | `vehicles` table; multi-vehicle with independent schedules |
| Task templates | FR51–FR52 | Seed data + per-vehicle task instances with customizable intervals |
| Odometer | FR53, FR56 | Mutable vehicle state; auto-update from service log with notification |
| Service logging | FR54–FR55 | Append-only service history; triggers schedule recalculation |
| Due evaluation | FR57–FR58 | Dual-threshold (km OR months); alert windows at 500 km / 14 days |
| Views | FR59 | Per-vehicle status + history UI |
| AI integration | FR60–FR61 | New chat tools querying maintenance data |

**Explicit non-requirements:**
- No link to passive assets (FR49)
- No OS push notifications (PRD §Maintenance Alert Evaluation)
- Alert UI placement and visual treatment specified in [ux-design-specification.md](ux-design-specification.md) § Car Maintenance Module

**Non-Functional Requirements:**

| NFR | Requirement | Architectural impact |
|-----|-------------|---------------------|
| NFR14 | Alert status evaluates within 1s of app launch | Synchronous Rust evaluation on startup; no background scheduler needed |
| NFR15 | Odometer auto-update within 1s with notification | Same transaction as service log insert; toast via IPC response or Tauri event |
| NFR5 | AI chat < 5s for data queries | Maintenance queries are local SQLite reads — no external latency |
| NFR11–NFR12 | Data integrity + backup | New tables included in existing SQLite backup/restore (file copy) |
| NFR16 | EN/FR i18n | All maintenance strings in i18n resource files |

**Scale & Complexity:**

- Primary domain: Desktop application (Tauri — React frontend, Rust backend)
- Complexity level: Medium
- Estimated new architectural components: 6
  1. SQLite schema (vehicles, maintenance_tasks, maintenance_service_logs)
  2. Rust `db/maintenance.rs` query layer
  3. Rust `commands/maintenance.rs` Tauri commands
  4. Alert evaluation service (Rust, called on launch + mutation)
  5. React routes/components (`/maintenance`, dashboard alert badge/card)
  6. AI chat tool extensions (`query_maintenance`, `query_maintenance_due`)

### Technical Constraints & Dependencies

- **Extends existing desktop stack** — SQLite/rusqlite, embedded migrations, Tauri IPC, TanStack Query, shadcn/ui (per architecture-desktop.md)
- **Follows established patterns** — feature-based frontend folders, one `db/` + `commands/` file per domain, snake_case IPC
- **Passive assets remain separate** — `passive_assets.asset_type = 'vehicle'` is for net worth only; no FK between assets and maintenance vehicles
- **AI tool-call pattern exists** — `execute_tool_call` in `chat.rs` currently handles `query_expenses`; maintenance tools follow same 1-round pattern
- **Alert evaluation triggers** — app launch, odometer update, service log create (PRD §Maintenance Alert Evaluation)
- **UX specified** — dashboard `MaintenanceAlertCard`, InnerTabNav entry, `/maintenance` page layout, status badge semantics, and service-log toast patterns defined in UX spec (2026-05-29)

### Cross-Cutting Concerns Identified

1. **Schedule calculation engine** — Pure Rust function: given task intervals, last service date/odometer, current odometer → status (ok / upcoming / due / overdue) and next due km/date. Must be deterministic and unit-testable.
2. **Template seeding strategy** — FR51 default intervals need a defined data source (see Decision D1 in step 4).
3. **Dashboard integration** — Alert summary query must be lightweight (NFR14); likely a single aggregated command returning worst-case alert per vehicle.
4. **i18n for task names** — 15 task types need translation keys; store task `type_key` not display string in DB.
5. **Backup compatibility** — Migration adds tables; existing backup/restore (file copy) automatically includes new data.
6. **AI context enrichment** — System prompt for `budget-helper` (or future agent) needs maintenance tool definitions and schema description.

---

## Starter Template Evaluation

### Primary Technology Domain

Desktop module extension within the existing Tauri 2 + React + Rust monorepo (`apps/desktop/`). Not a standalone application.

### Starter Options Considered

| Option | Verdict |
|--------|---------|
| `pnpm create tauri-app@latest` (create-tauri-app v4.7.0) | **Rejected** — would scaffold a duplicate app; project already initialized |
| `npx tauri init` in existing frontend | **Rejected** — Tauri backend already exists at `apps/desktop/src-tauri/` |
| Extend existing desktop patterns | **Selected** — follows architecture-desktop.md conventions |

### Selected Approach: Extend Existing Desktop App

**Rationale:** Car maintenance is MVP capability #10, specified but not yet implemented. All infrastructure (SQLite, IPC, TanStack Query, i18n, AI chat tool-call pattern, backup/restore) is in place. Implementation adds a migration, Rust db/commands modules, React route/components, and AI tool extensions — no new project scaffolding.

**Implementation entry point (not a starter command):**

```bash
# First story: add migration + Rust module skeleton + route stub
# apps/desktop/src-tauri/migrations/018_maintenance_tables.sql
# apps/desktop/src-tauri/src/db/maintenance.rs
# apps/desktop/src-tauri/src/commands/maintenance.rs
# apps/desktop/src/routes/maintenance.tsx
```

**Architectural decisions inherited from existing desktop app:**

| Category | Inherited decision |
|----------|-------------------|
| Language & runtime | TypeScript (strict) frontend; Rust 2021 backend |
| Styling | Tailwind 4 + shadcn/ui via `@nkbaz/shared` |
| Build tooling | Vite 7 (frontend), Cargo (backend), Tauri CLI 2.x bundling |
| Testing | Playwright E2E in `apps/desktop/tests/`; Rust `#[cfg(test)]` in modules |
| Code organization | Feature-based React folders; one `db/` + `commands/` file per domain |
| State management | TanStack Query for IPC data; React Hook Form for multi-field forms |
| Routing | TanStack Router file-based routes (add `/maintenance`) |
| IPC | Tauri commands (CRUD) + events only where streaming needed (not for maintenance) |

**Note:** First implementation story is migration `018_maintenance_tables.sql` plus module skeleton — not project initialization.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- D1: Embedded baseline library for default task intervals (FR51)
- D2: Three-table SQLite schema (`vehicles`, `maintenance_tasks`, `maintenance_service_logs`)
- D3: Pure Rust schedule evaluator with dual-threshold (km OR months) logic
- D4: Atomic service-log insert with optional odometer correction (FR55–FR56)

**Important Decisions (Shape Architecture):**
- D5: Tauri IPC command surface for CRUD + alert summary
- D6: AI chat tools (`query_maintenance_status`, `query_maintenance_history`)
- D7: Dashboard alert aggregation via single lightweight query
- D8: `/maintenance` route with feature-based React components

**Deferred Decisions (Post-MVP):**
- External manufacturer interval lookup — no stable free API; PRD specifies industry baselines only
- Dedicated maintenance AI agent — extend `budget-helper` tools for FR60–FR61
- Vehicle ↔ passive asset linking — explicitly excluded by FR49
- OS push notifications — PRD defers to in-app alerts only

### Data Architecture

#### D1: Default Interval Data Source (FR51 architecture dependency)

| Option | Verdict |
|--------|---------|
| External manufacturer lookup API | **Rejected** — network dependency, no reliable free API, overkill for industry baselines |
| SQLite seed table (`maintenance_task_templates`) | **Rejected** — adds table for static data that never changes at runtime |
| **Embedded Rust baseline library** | **Selected** |

**Decision:** Static baseline definitions in `src-tauri/src/maintenance/defaults.rs` as a `const DEFAULT_TASKS: &[TaskBaseline]` array. Each entry contains `task_type_key`, default `interval_km`, and default `interval_months`.

On vehicle registration (`create_vehicle`), the backend clones all 15 baselines into `maintenance_tasks` rows for that vehicle. User overrides (FR52) update the per-vehicle row's `interval_km` / `interval_months` columns — independent of the baseline source.

**Industry-baseline defaults:**

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

(`interval_km = 0` means time-only tasks — battery and wiper blades have no km threshold)

Display names are **not** stored in DB. Frontend resolves `task_type_key` → i18n key `maintenance.tasks.{task_type_key}`.

#### D2: Schema Design

**Migration:** `018_maintenance_tables.sql`

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

**Modeling rationale:**
- `maintenance_tasks` is the **instance** table — one row per task per vehicle, holding current intervals and last-service anchor points
- `maintenance_service_logs` is **append-only history** (FR59) — never updated after insert
- No FK to `passive_assets` (FR49)
- Odometer stored as integer km (not cents — not a monetary value)
- `ON DELETE CASCADE` from vehicle ensures clean removal

**Validation:** Rust backend validates all writes. At least one of `interval_km > 0` or `interval_months > 0` required per task (enforced on create/update).

#### D3: Schedule Evaluation Engine

**Decision:** Pure Rust function module `src-tauri/src/maintenance/evaluator.rs`. Status is **computed at read time**, not persisted. No background scheduler or alert state table.

```rust
pub enum TaskStatus { Ok, Upcoming, Due, Overdue }

pub struct TaskEvaluation {
    pub status: TaskStatus,
    pub next_due_date: Option<NaiveDate>,
    pub next_due_odometer_km: Option<i64>,
    pub km_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
}
```

**Dual-threshold logic (FR57):**

For each task, compute two independent due points from `last_service_*` + intervals:
- **Km due point:** `last_service_odometer_km + interval_km` (skip if `interval_km == 0`)
- **Date due point:** `last_service_date + interval_months` (skip if `interval_months == 0`)

Task is **overdue** when current odometer ≥ km due point OR today ≥ date due point (whichever applies).

Task is **upcoming** when within alert window: km remaining ≤ 500 OR days remaining ≤ 14 (FR58).

Task is **due** when km remaining ≤ 0 OR days remaining ≤ 0.

If never serviced (`last_service_*` NULL), base from vehicle `created_at` date and odometer 0.

**Evaluation triggers (PRD §Maintenance Alert Evaluation):**
- App launch — via `get_maintenance_alert_summary` on dashboard load
- Odometer update — return refreshed evaluations in command response
- Service log create — recalculate within same transaction

**NFR14 compliance:** With ≤5 vehicles × 15 tasks = 75 rows max, synchronous evaluation completes in microseconds. No caching layer needed.

#### D4: Service Log Transaction Semantics (FR55–FR56, NFR15)

**Decision:** Single SQLite transaction in `log_maintenance_service`:

1. Insert `maintenance_service_logs` row
2. Update `maintenance_tasks.last_service_date` and `last_service_odometer_km` for the task
3. If `service.odometer_km > vehicle.odometer_km`: update `vehicles.odometer_km`
4. Commit

**IPC response shape:**

```typescript
interface LogServiceResult {
  log: MaintenanceServiceLog;
  task: MaintenanceTask;
  odometer_updated: boolean;
  previous_odometer_km?: number;
  new_odometer_km?: number;
}
```

Frontend shows toast when `odometer_updated === true` (NFR15). Audit log entry for odometer auto-update (consistent with existing audit pattern).

### Authentication & Security

No module-specific decisions. Inherits single-user local app model:
- All data in encrypted-at-rest SQLite (OS-level encryption per architecture-desktop.md)
- No external API calls for maintenance data
- AI chat tools are read-only queries — no write actions for maintenance in MVP

### API & Communication Patterns

#### D5: Tauri IPC Commands

| Command | Purpose | FR |
|---------|---------|-----|
| `create_vehicle` | Register vehicle + seed 15 tasks from baseline | FR49 |
| `get_vehicles` | List all vehicles | FR50 |
| `get_vehicle` | Single vehicle with tasks + computed status | FR59 |
| `update_vehicle` | Edit nickname/make/model/year | FR49 |
| `update_vehicle_odometer` | Manual odometer update | FR53 |
| `delete_vehicle` | Remove vehicle + cascade tasks/logs | FR50 |
| `update_maintenance_task` | Customize intervals | FR52 |
| `log_maintenance_service` | Record service + recalculate + odometer check | FR54–FR56 |
| `get_service_history` | Service logs for a vehicle (newest first) | FR59 |
| `get_maintenance_alert_summary` | Aggregated alerts for dashboard | FR58 |

All commands follow existing patterns: `#[tauri::command(rename_all = "snake_case")]`, typed Rust errors → `AppError`, TanStack Query on frontend.

No Tauri events needed — maintenance has no streaming/progress requirements.

#### D6: AI Chat Tool Extensions (FR60–FR61)

**Decision:** Add two read-only tools to `execute_tool_call` in `commands/chat.rs` and document in `build_budget_helper_prompt`:

| Tool | Params | Returns |
|------|--------|---------|
| `query_maintenance_status` | `vehicle_id?`, `status_filter?` (`upcoming`/`due`/`overdue`/`all`) | Vehicles with tasks, computed status, next due km/date |
| `query_maintenance_history` | `vehicle_id` (required), `task_type_key?`, `limit?` | Service log entries |

System prompt addition: brief description of maintenance data model and when to use each tool. Maintenance context injected into existing chat `context` string (vehicle count, alert count).

Follows existing 1-round tool-call pattern — no multi-hop tool chains.

### Frontend Architecture

#### D7: Dashboard Alert Integration (FR58)

**Decision:** New `MaintenanceAlertCard` on dashboard (`routes/index.tsx`). UX visual treatment specified in [ux-design-specification.md](ux-design-specification.md) § Car Maintenance Module.

**Placement:** Full-width card after `YearToDateCard`, before the hero 2-column grid (Net Worth + Budget Remaining). Not a sidebar badge — alerts are part of the zero-click dashboard glance (Journey 3).

**Visual treatment:**

| `worst_status` | Card styling | Badge color |
|----------------|--------------|-------------|
| `ok` | Default card, muted copy | — |
| `upcoming` | `ring-1 ring-amber-500/30` | Amber |
| `due` | `ring-1 ring-rose-500/40` | Rose |
| `overdue` | `ring-1 ring-rose-500/60`, font-medium subtitle | Rose + "Overdue" label |

Card shows up to 2 vehicle alert rows (nickname, most urgent task i18n name, single urgency dimension). Entire card links to `/maintenance`. Empty states: no vehicles (prompt to add) or all ok ("All maintenance up to date").

Data source: `get_maintenance_alert_summary` returning:

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
      status: string;
      days_remaining?: number;
      km_remaining?: number;
    };
  }>;
}
```

Card links to `/maintenance`. Status colors align with task row badges on the maintenance page (amber = upcoming/due window, rose = due/overdue).

**Navigation:** Add `Maintenance` tab to `InnerTabNav.tsx` (Wrench icon) in the accounts/assets group — after Assets, before Net Worth. Route `/maintenance`. Do **not** modify sidebar nav item count; finance navigation uses InnerTabNav tabs per architecture-desktop.md.

#### D8: Maintenance View Structure

**Page layout (UX-defined):**

```
/maintenance
├── PageHeader (title, vehicle count subtitle, Add Vehicle CTA)
└── Stacked VehicleCard list (newest first, collapsible)
    └── VehicleCard
        ├── Header: nickname, make/model/year, inline odometer (OdometerUpdateForm)
        ├── MaintenanceTaskRow × 15 (sorted: overdue → due → upcoming → ok)
        └── ServiceHistoryTable (newest first, last 10 visible)
```

**Interaction patterns:**

| Action | UI pattern | Component |
|--------|------------|-----------|
| Add vehicle | SlideOver form | `AddVehicleForm` |
| Log service | Inline expand below task row | `LogServiceForm` |
| Edit intervals | Dialog | `EditIntervalDialog` |
| Update odometer | Inline edit on card header | `OdometerUpdateForm` |
| Delete vehicle | Destructive confirmation dialog | shadcn `Dialog` |

**Dashboard integration point in `index.tsx`:**

```tsx
<YearToDateCard ... />
<MaintenanceAlertCard ... />  {/* NEW — after YTD, before hero grid */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">  {/* hero section */}
```

**File structure:**

```
src/
├── routes/maintenance.tsx
├── components/maintenance/
│   ├── VehicleCard.tsx
│   ├── AddVehicleForm.tsx
│   ├── MaintenanceTaskRow.tsx
│   ├── EditIntervalDialog.tsx
│   ├── LogServiceForm.tsx
│   ├── ServiceHistoryTable.tsx
│   └── OdometerUpdateForm.tsx
├── hooks/
│   ├── useMaintenance.ts
│   └── useMaintenanceAlerts.ts
```

Query invalidation keys: `["maintenance"]`, `["maintenance-alerts"]`, `["maintenance", vehicleId]`.

i18n: all strings under `maintenance.*` namespace in `en.json` / `fr.json`.

### Infrastructure & Deployment

No module-specific decisions. New tables included automatically in existing SQLite backup/restore (file copy). No new dependencies, services, or environment variables.

### Decision Impact Analysis

**Implementation sequence:**
1. Migration `018_maintenance_tables.sql`
2. `maintenance/defaults.rs` + `maintenance/evaluator.rs` with unit tests
3. `db/maintenance.rs` query layer
4. `commands/maintenance.rs` Tauri commands + register in `main.rs`
5. TypeScript types (desktop `lib/types` or shared package)
6. React hooks + `/maintenance` route + InnerTabNav tab
7. Dashboard `MaintenanceAlertCard`
8. AI chat tool extensions + prompt update
9. i18n strings (EN + FR)
10. Playwright E2E: register vehicle → log service → verify alert clears

**Cross-component dependencies:**
- Evaluator must be complete before any command returns status
- `create_vehicle` depends on defaults.rs baseline seeding
- Dashboard card depends on `get_maintenance_alert_summary`
- AI tools depend on evaluator + db layer (same query functions, no duplication)
- Service log toast depends on `LogServiceResult.odometer_updated` response field
- TanStack Query invalidation must cover dashboard + maintenance views on any mutation

---

## Implementation Patterns & Consistency Rules

_Module-specific patterns extending [architecture-desktop.md](architecture-desktop.md). All agents implementing FR49–FR61 MUST follow these in addition to project-context.md rules._

### Pattern Categories Defined

**Critical Conflict Points Identified:** 12 areas where AI agents could make incompatible choices without these rules.

### Naming Patterns

**Database Naming Conventions:**
- Tables: `vehicles`, `maintenance_tasks`, `maintenance_service_logs` — snake_case, plural
- Columns: `snake_case` — `odometer_km`, `task_type_key`, `last_service_date`, `interval_months`
- Foreign keys: `{singular}_id` — `vehicle_id`, `task_id`
- Indexes: `idx_{table}_{columns}` — `idx_maintenance_tasks_vehicle`
- **Never** create `maintenance_vehicles` or `car_*` table prefixes

**Task Type Keys (canonical enum):**
- Format: `snake_case` string matching `defaults.rs` constants exactly
- Valid keys: `engine_oil_filter`, `transmission_fluid`, `brake_fluid`, `coolant`, `differential_fluid`, `power_steering_fluid`, `tire_rotation`, `tire_inspection`, `brake_inspection`, `engine_air_filter`, `cabin_air_filter`, `spark_plugs`, `suspension_inspection`, `battery_check`, `wiper_blades`
- **Never** store display names in DB — always `task_type_key` + i18n lookup
- **Never** use passive asset type `"vehicle"` as a task type key

**Rust Code Naming:**
- Structs: `Vehicle`, `MaintenanceTask`, `MaintenanceServiceLog`, `TaskEvaluation`, `LogServiceResult`
- Enums: `TaskStatus` with variants `Ok`, `Upcoming`, `Due`, `Overdue` (PascalCase)
- Status JSON serialization: `snake_case` — `"ok"`, `"upcoming"`, `"due"`, `"overdue"`
- Module: `maintenance/` containing `defaults.rs`, `evaluator.rs`
- DB module: `db/maintenance.rs`; Commands module: `commands/maintenance.rs`

**TypeScript/React Naming:**
- Components: `PascalCase` in `components/maintenance/`
- Hooks: `useMaintenance.ts`, `useMaintenanceAlerts.ts`
- Route file: `routes/maintenance.tsx` → path `/maintenance`
- i18n keys: `maintenance.tasks.engine_oil_filter`, `maintenance.status.upcoming`, etc.

**IPC Command Names:**
- All `snake_case`: `create_vehicle`, `get_maintenance_alert_summary`, `log_maintenance_service`

**AI Tool Names:**
- `query_maintenance_status`, `query_maintenance_history`
- **Never** write-action tools for maintenance in MVP

### Structure Patterns

**Rust Backend Organization (additions):**

```
src-tauri/src/
├── maintenance/
│   ├── mod.rs
│   ├── defaults.rs      # DEFAULT_TASKS + alert threshold constants
│   └── evaluator.rs     # evaluate_task() + unit tests
├── db/maintenance.rs
├── commands/maintenance.rs
migrations/018_maintenance_tables.sql
```

**Rules:**
- Schedule evaluation logic lives **only** in `maintenance/evaluator.rs`
- Alert thresholds (500 km, 14 days) defined in `defaults.rs` as `ALERT_KM_THRESHOLD` and `ALERT_DAYS_THRESHOLD`
- Commands call `db/maintenance.rs` — no SQL in commands
- `db/maintenance.rs` calls `evaluator.rs` when returning tasks with status

**Frontend Organization (additions):**

```
src/components/maintenance/          # Feature UI
src/components/dashboard/MaintenanceAlertCard.tsx
src/hooks/useMaintenance.ts
src/hooks/useMaintenanceAlerts.ts
src/routes/maintenance.tsx
```

**TanStack Query Keys:**

| Key | Invalidated when |
|-----|-----------------|
| `["maintenance"]` | create/delete vehicle |
| `["maintenance", vehicleId]` | update vehicle, log service, update intervals, update odometer |
| `["maintenance-alerts"]` | any maintenance mutation |
| `["maintenance-history", vehicleId]` | log service |

### Format Patterns

**IPC Response — MaintenanceTaskWithStatus:**

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
  next_due_date: string | null;
  next_due_odometer_km: number | null;
}
```

- Dates: `"YYYY-MM-DD"` strings; odometer: integer km; status computed server-side only
- `LogServiceResult.odometer_updated` drives toast — frontend never compares odometer values

### Process Patterns

- Never-serviced tasks anchor from vehicle `created_at` date and odometer 0
- Odometer auto-update: toast required when `odometer_updated === true` (NFR15)
- No Tauri events for maintenance — TanStack Query invalidation only
- Empty state and skeleton patterns match `assets.tsx` (see UX spec § Empty & Loading States)
- Odometer display: integer km, monospace, thousands separator — frontend never computes task status
- `LogServiceResult.odometer_updated` drives info toast (NFR15) with 4s duration; copy key `maintenance.toast.odometerUpdated`

### Enforcement Guidelines

**All AI Agents MUST:**
- Single source of truth for status in `evaluator.rs`
- Single source for thresholds and baselines in `defaults.rs`
- i18n for all display strings (EN + FR)
- No FK or sync between `vehicles` and `passive_assets`
- Playwright E2E: register → alert → log service → alert clears

### Pattern Examples

**Good:** `t(\`maintenance.tasks.${task.task_type_key}\`)` + status from IPC response

**Anti-pattern:** Frontend date math for due status; duplicate SQL in `chat.rs`; `maintenance_task_templates` table

---

## Project Structure & Boundaries

### Complete Project Directory Structure

New and modified files for the car maintenance module within the existing monorepo:

```
apps/desktop/
├── src/
│   ├── routes/
│   │   ├── maintenance.tsx                    # NEW — /maintenance route (FR59)
│   │   └── index.tsx                          # MODIFY — add MaintenanceAlertCard
│   ├── components/
│   │   ├── maintenance/                       # NEW — feature components
│   │   │   ├── VehicleCard.tsx                # FR50, FR59
│   │   │   ├── AddVehicleForm.tsx             # FR49
│   │   │   ├── MaintenanceTaskRow.tsx         # FR52, FR59
│   │   │   ├── EditIntervalDialog.tsx         # FR52
│   │   │   ├── LogServiceForm.tsx             # FR54
│   │   │   ├── ServiceHistoryTable.tsx        # FR59
│   │   │   └── OdometerUpdateForm.tsx         # FR53
│   │   ├── dashboard/
│   │   │   └── MaintenanceAlertCard.tsx       # NEW — FR58 dashboard alerts
│   │   └── shared/
│   │       └── InnerTabNav.tsx                # MODIFY — add /maintenance tab (Wrench icon)
│   ├── hooks/
│   │   ├── useMaintenance.ts                  # NEW
│   │   └── useMaintenanceAlerts.ts            # NEW
│   ├── lib/
│   │   └── types.ts                           # MODIFY — maintenance types
│   └── locales/
│       ├── en.json                            # MODIFY — maintenance.* keys
│       └── fr.json                            # MODIFY — maintenance.* keys
├── tests/
│   └── maintenance.spec.ts                    # NEW — Playwright E2E
└── src-tauri/
    ├── migrations/
    │   └── 018_maintenance_tables.sql         # NEW
    └── src/
        ├── lib.rs                             # MODIFY — mod maintenance; register commands
        ├── maintenance/                       # NEW
        │   ├── mod.rs
        │   ├── defaults.rs
        │   └── evaluator.rs
        ├── db/
        │   ├── mod.rs                         # MODIFY — pub mod maintenance; migration 018
        │   └── maintenance.rs                 # NEW
        ├── commands/
        │   ├── mod.rs                         # MODIFY — pub mod maintenance
        │   ├── maintenance.rs                 # NEW
        │   └── chat.rs                        # MODIFY — AI tool handlers
        ├── ai/
        │   └── chat.rs                        # MODIFY — prompt + format helpers
        └── models/
            └── mod.rs                         # MODIFY — Vehicle, MaintenanceTask structs
```

### Architectural Boundaries

**IPC Boundary (React ↔ Rust):** TanStack Query → `invoke()` only; status computed in Rust `evaluator.rs`; mutations return typed `LogServiceResult`.

**Component Boundaries:** `components/maintenance/` self-contained; no imports from `components/assets/`; dashboard card is read-only summary linking to `/maintenance`.

**Data Boundaries:** Maintenance tables isolated from `passive_assets`; odometer auto-updates logged to `audit_log`.

**AI Boundary:** `chat.rs` dispatches to `db/maintenance.rs`; read-only tools in MVP.

### Requirements to Structure Mapping

| FR | Primary files |
|----|---------------|
| FR49 | `AddVehicleForm.tsx`, `create_vehicle`, `defaults.rs` |
| FR50 | `maintenance.tsx`, `VehicleCard.tsx`, `get_vehicles` |
| FR51 | `defaults.rs`, seeded in `create_vehicle` |
| FR52 | `EditIntervalDialog.tsx`, `update_maintenance_task` |
| FR53 | `OdometerUpdateForm.tsx`, `update_vehicle_odometer` |
| FR54–FR56 | `LogServiceForm.tsx`, `log_maintenance_service`, `evaluator.rs` |
| FR57–FR58 | `evaluator.rs`, `MaintenanceAlertCard.tsx`, `get_maintenance_alert_summary` |
| FR59 | `maintenance.tsx`, `MaintenanceTaskRow.tsx`, `ServiceHistoryTable.tsx` |
| FR60–FR61 | `ai/chat.rs`, `chat.rs` tool handlers, `db/maintenance.rs` |

### Integration Points

**Dashboard:** `index.tsx` → `useMaintenanceAlerts()` → `get_maintenance_alert_summary` → `MaintenanceAlertCard`

**AI chat:** User query → Bedrock tool_call → `query_maintenance_status` / `query_maintenance_history` → db layer → formatted response

**Service log write:** INSERT log → UPDATE task anchors → conditional odometer UPDATE → audit log → invalidate query keys → toast

### Files explicitly NOT modified

- `passive_assets` db/commands/components
- `net_worth.rs`
- Backup/restore commands

### Development Workflow Integration

1. Migration + Rust modules + unit tests
2. TypeScript types + hooks + route stub
3. Maintenance UI components (per UX spec component strategy)
4. Dashboard `MaintenanceAlertCard` + InnerTabNav `/maintenance` tab
5. AI tools + prompt
6. i18n (EN + FR)
7. Playwright E2E

---

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** Brownfield extension aligns with Tauri 2 + SQLite + TanStack stack. Embedded baseline (D1) fits offline-first constraints. Computed-at-read-time status (D3) satisfies NFR14 without a scheduler. AI read-only tools fit existing 1-round tool-call pattern.

**Pattern Consistency:** Naming follows architecture-desktop conventions. Single `evaluator.rs` prevents duplicate due-date logic. i18n via `task_type_key` matches existing enum patterns.

**Structure Alignment:** One migration, one db file, one commands file mirrors other feature domains. InnerTabNav (not AppSidebar) matches actual finance navigation.

### Requirements Coverage Validation ✅

All FR49–FR61 architecturally supported. NFR14, NFR15, NFR5, NFR11–NFR12, NFR16 addressed.

### Implementation Readiness Validation ✅

D1–D8 documented. 19 new files and 11 modified files listed. 12 agent conflict points addressed with enforcement rules.

### Gap Analysis Results

**Important (non-blocking):** ~~UX alert visual treatment deferred to UX workflow~~ **Resolved** in ux-design-specification.md § Car Maintenance Module (2026-05-29); no maintenance epic/stories yet; optional cross-link from architecture-desktop.md.

**Critical gaps:** None.

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:** FR51 dependency resolved; testable schedule engine; clear passive-assets separation; no new dependencies.

### Implementation Handoff

**First Implementation Priority:**
1. `018_maintenance_tables.sql`
2. `maintenance/defaults.rs` + `maintenance/evaluator.rs` (with unit tests)
3. `db/maintenance.rs` + `commands/maintenance.rs`
4. Frontend hooks, route, components (follow UX spec page layout and component anatomy)
5. Dashboard alert card + InnerTabNav tab + AI tools + i18n + E2E

---
