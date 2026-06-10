---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: complete
completedAt: '2026-06-09'
scope: alerts-notifications-background-agent
parentDocument: architecture-desktop.md
inputDocuments:
  - alerts-and-cross-module-summary-2026-06-09.md
  - architecture-desktop.md
  - architecture-car-maintenance.md
  - architecture-financial-decision-intelligence.md
  - prd.md
  - project-context.md
workflowType: architecture
project_name: nixus
user_name: Nbazinet
date: '2026-06-09'
---

# Alerts & Notifications — Architecture Decision Document

_Scoped architecture addendum for proactive local alerts, in-app delivery, OS notifications, and a background agent that survives window close. Extends [architecture-desktop.md](architecture-desktop.md). Implements the technical design behind [alerts-and-cross-module-summary-2026-06-09.md](alerts-and-cross-module-summary-2026-06-09.md)._

---

## Project Context Analysis

### Requirements Overview

**Functional scope (from planning summary):**

| Tier | Alert kinds | Module | Status |
|------|-------------|--------|--------|
| Tier 1 MVP | `import.reminder`, `budget.pace`, `maintenance.due_soon`, `maintenance.overdue` | Finance + Car | Partial — maintenance evaluation exists |
| Tier 1b | `odometer.stale`, `maintenance.projected_due` | Car | Spec only |
| Tier 2 | `runway.below_target`, `waterfall.surplus`, `snapshot.stale`, `recurring.drift` | Finance | Deferred |
| Delivery | In-app cards, notification center, OS notifications, tray agent | Cross-cutting | Not implemented |

**Explicit non-requirements:**
- Cloud push, email digests, SMS, webhooks
- Alerts from live bank transactions
- AI-generated alerts without deterministic backing
- Auto-mutation of user data from alerts

**Non-Functional Requirements:**

| NFR | Requirement | Architectural impact |
|-----|-------------|---------------------|
| NFR14 | Maintenance alert evaluation &lt; 1s | Full `run_cycle` target &lt; 500ms; scheduler staggered from launch |
| NFR11–NFR12 | Data integrity + backup | `alert_state` table included in SQLite backup/restore |
| NFR16 | EN/FR i18n | All alert copy via `title_key` / `body_key`; OS notifications use same keys |
| Local-only | No server | Tray-resident process; no network in alert pipeline |
| Quiet by default | UX + product | Master toggle on; OS opt-in; snooze/dismiss per instance |

**Scale & Complexity:**

- Primary domain: Desktop application (Tauri 2 — React frontend, Rust backend)
- Complexity level: Medium–High (cross-module, background lifecycle, dual delivery surfaces)
- Estimated new architectural components: 8
  1. `alerts/` Rust module (evaluator trait, scheduler, delivery)
  2. `alert_state` SQLite table + prefs in `config`
  3. `commands/alerts.rs` IPC layer
  4. System tray + hide-on-close lifecycle
  5. Tauri plugins: notification, autostart, tray-icon
  6. React `useAlerts` hook + notification center (Phase 2)
  7. Settings UI for alert preferences
  8. Evaluator adapters (finance, maintenance, future cross-module)

### Technical Constraints & Dependencies

- **Extends existing desktop stack** — SQLite/rusqlite, embedded migrations, Tauri IPC, TanStack Query (per architecture-desktop.md)
- **Maintenance evaluator exists** — `maintenance/evaluator.rs`; adapter pattern, no duplication
- **Background task precedent** — `spawn_background_catalog_refresh`, recurring apply on launch in `lib.rs`
- **Config table exists** — `db/config.rs` for prefs; no new prefs storage mechanism
- **PRD supersession** — Car maintenance addendum deferred OS push; this addendum enables opt-in OS notifications in Phase 2

### Cross-Cutting Concerns Identified

1. **Background lifecycle** — Process must survive window close without a separate daemon binary.
2. **Evaluator extensibility** — New alert types must plug in without changing scheduler/delivery.
3. **State deduplication** — Dismiss, snooze, and `last_fired` prevent notification fatigue.
4. **Dual delivery** — In-app events and OS notifications must stay in sync from one `run_cycle`.
5. **Deep linking** — OS notification click and in-app CTA share `DeepLink` struct.
6. **SQLite single-writer** — Scheduler holds `DbState` mutex briefly; stagger from other background tasks.

---

## Starter Template Evaluation

### Primary Technology Domain

Desktop module extension within the existing Tauri 2 + React + Rust monorepo (`apps/desktop/`). Not a standalone application or new project scaffold.

### Starter Options Considered

| Option | Verdict |
|--------|---------|
| `tauri-plugin-background-service` (community) | **Rejected** — extra dependency; tray-resident process sufficient for Phase 1–2 |
| Separate OS daemon binary (launchd/systemd) | **Deferred** — Phase 3 only if beta requires alerts after explicit Quit |
| Extend existing desktop patterns | **Selected** — follows architecture-desktop.md and car-maintenance addendum |

### Selected Approach: Extend Existing Desktop App

**Rationale:** Alert infrastructure layers onto existing SQLite, IPC, config, and maintenance evaluation. Implementation adds a migration, `alerts/` Rust module, tray lifecycle, Tauri plugins, React hooks, and settings — no new project scaffolding.

**Implementation entry point:**

```bash
# First story: alerts module skeleton + migration + tray
# apps/desktop/src-tauri/migrations/021_alert_state.sql
# apps/desktop/src-tauri/src/alerts/
# apps/desktop/src-tauri/src/commands/alerts.rs
# apps/desktop/src/hooks/useAlerts.ts
```

**Architectural decisions inherited from existing desktop app:**

| Category | Inherited decision |
|----------|-------------------|
| Language & runtime | TypeScript (strict) frontend; Rust 2021 backend |
| Styling | Tailwind 4 + shadcn/ui via `@nkbaz/shared` |
| Build tooling | Vite 7 (frontend), Cargo (backend), Tauri CLI 2.x |
| Testing | Playwright E2E; Rust `#[cfg(test)]` in evaluator modules |
| IPC | Tauri commands + events; `rename_all = "snake_case"` |
| State management | TanStack Query for IPC data; event-driven cache updates |

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

| ID | Decision | Choice |
|----|----------|--------|
| D1 | Background agent model | Tray-resident Tauri process (hide-on-close); not separate daemon |
| D2 | Alert evaluation architecture | `AlertEvaluator` trait + registry; pure read, deterministic |
| D3 | Alert state persistence | `alert_state` table + `config` prefs keys |
| D4 | Scheduler | Tokio task in `lib.rs` setup; configurable interval (default 60 min) |
| D5 | Delivery router | Single `run_cycle` → Tauri event (always) + OS notify (opt-in) |

**Important Decisions (Shape Architecture):**

| ID | Decision | Choice |
|----|----------|--------|
| D6 | OS notifications | `tauri-plugin-notification`; Rust-side delivery |
| D7 | Login autostart | `tauri-plugin-autostart`; user opt-in via settings |
| D8 | Maintenance integration | Adapter wraps existing `evaluator.rs`; no logic duplication |
| D9 | In-app notification center | Phase 2; bell icon + `alerts:updated` event subscription |
| D10 | Detached OS service | Phase 3 deferral; launchd/systemd only if beta demands |

### Technology Versions (verified 2026-06-09)

| Component | Version / source |
|-----------|----------------|
| Tauri | 2.11 (`apps/desktop/src-tauri/Cargo.toml`) |
| `tauri-plugin-notification` | Tauri 2 plugin (`tauri add notification`) |
| `tauri-plugin-autostart` | Tauri 2 plugin (`tauri add autostart`) |
| `tray-icon` | Tauri 2 built-in feature on `tauri` crate |
| Tokio | 1.50 (already in project) |

---

## Executive summary

Nixus needs a **generic, extensible alert framework** that:

1. Evaluates deterministic rules against local SQLite data (finance, maintenance, cross-module).
2. Delivers alerts to **in-app surfaces** (dashboard cards, future notification center) and optionally **OS notifications**.
3. Runs on a **background schedule** even when the main window is closed.

**Recommended background model:** a **tray-resident Tauri process** — not a separate OS daemon binary in Phase 1. Closing the window hides to the system tray; the Rust runtime keeps a Tokio scheduler alive. Login autostart is optional via `tauri-plugin-autostart`. Explicit **Quit** from the tray menu is the only path that stops background evaluation.

This is boring technology that ships: one process, one SQLite file, no cloud, no second installer. A true detached OS service (launchd / systemd) is deferred to Phase 3 only if beta feedback requires alerts after full quit.

---

## Problem statement

Today:

| Capability | Status |
|------------|--------|
| Maintenance alert evaluation | ✓ Rust `maintenance/evaluator.rs`, dashboard summary via `get_maintenance_alert_summary` |
| Finance alert evaluators | ✗ Not yet (`import.reminder`, `budget.pace`) |
| Generic alert registry / state | ✗ No `alert_state` table, no snooze/dismiss persistence |
| Background scheduler | Partial — one-shot recurring apply + catalog refresh on launch; no periodic alert tick |
| OS notifications | ✗ Not integrated |
| Survives window close | ✗ Closing window exits the process |

The product direction (proactive upkeep, local-only) requires a **unified pipeline** so new alert types plug in without duplicating delivery logic.

---

## Architectural goals

| Goal | Decision |
|------|----------|
| Local-only | All evaluation in Rust against SQLite; no server push |
| Extensible | Trait-based evaluators register by `alert_id` prefix (`finance.*`, `maintenance.*`) |
| Deterministic first | Rule evaluators before any LLM “insights” |
| Quiet by default | Master toggle on; OS notifications opt-in; respect snooze/dismiss |
| Action-oriented | Every alert carries `deep_link` + primary CTA key for i18n |
| Single-writer DB | Scheduler acquires `DbState` mutex briefly per tick — same pattern as existing commands |
| Cross-platform | macOS primary; Windows/Linux supported via Tauri plugins |

---

## Background agent model

### Option analysis

| Approach | Survives window close | Survives explicit Quit | Complexity | Recommendation |
|----------|----------------------|------------------------|------------|----------------|
| **A. Tray-resident process** | ✓ (hide-on-close) | ✗ | Low | **Phase 1 — default** |
| **B. Tray + autostart** | ✓ | ✗ (until next login) | Low | **Phase 1 — bundled with A** |
| **C. Separate OS daemon** (launchd/systemd helper) | ✓ | ✓ | High | Phase 3 — only if required |
| **D. Third-party `tauri-plugin-background-service`** | Varies | Varies | Medium | **Not recommended** — extra dependency; tray model sufficient |

### Selected: Tray-resident background agent (A + B)

```
┌──────────────────────────────────────────────────────────────────┐
│  Nixus process (single Tauri binary)                            │
│                                                                  │
│  ┌─────────────┐   hide on close    ┌─────────────────────────┐ │
│  │ Main window │ ◄────────────────► │ System tray             │ │
│  │ (React UI)  │   show on click    │ · badge (future)        │ │
│  └──────┬──────┘                    │ · Open / Quit menu      │ │
│         │ IPC                      └─────────────────────────┘ │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ AlertScheduler (Tokio task, `'static`, started in `setup`)   │ │
│  │ · tick every N min (default 60, configurable)                 │ │
│  │ · run on app launch (immediate first tick)                  │ │
│  │ · lock DbState → evaluate → deliver → release               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ SQLite       │  │ OS notify    │  │ Tauri events → React    │ │
│  │ alert_state  │  │ (opt-in)     │  │ in-app center/cards     │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

Login ──► tauri-plugin-autostart (optional, user setting) ──► process starts hidden in tray
```

**Window close behavior:**

- Intercept `CloseRequested` → `window.hide()` + `prevent_close()`.
- Tray menu offers **Open Nixus** and **Quit Nixus** (full `app.exit()`).
- First-run onboarding explains: “Nixus stays in the menu bar to remind you about upkeep.”

**Why not a separate daemon in Phase 1:**

- Second process complicates code signing, updates, and SQLite locking.
- Personal finance users expect “menu bar app” semantics (1Password, Bartender-style utilities).
- PRD defers OS push; tray agent satisfies “remind me when app isn’t open” for the common case.

---

## Core module design (Rust)

New top-level module: `src-tauri/src/alerts/`

```
alerts/
├── mod.rs              # public API, register evaluators, run_cycle()
├── models.rs           # Alert, AlertSeverity, AlertDelivery, DeepLink
├── state.rs            # alert_state CRUD (dismiss, snooze, last_fired)
├── prefs.rs            # config keys for alert preferences
├── scheduler.rs        # spawn_alert_scheduler(app_handle)
├── delivery.rs         # route to in-app event + OS notification
├── registry.rs         # Vec<Box<dyn AlertEvaluator>>
└── evaluators/
    ├── mod.rs
    ├── finance.rs      # import.reminder, budget.pace (Phase B)
    └── maintenance.rs  # wraps existing maintenance evaluator
```

### `AlertEvaluator` trait

```rust
pub trait AlertEvaluator: Send + Sync {
    /// Stable id prefix or full id, e.g. "import.reminder"
    fn id(&self) -> &'static str;

    /// Returns zero or more candidate alerts. Pure read + deterministic.
    fn evaluate(&self, conn: &Connection, prefs: &AlertPrefs) -> Result<Vec<Alert>, AppError>;
}
```

**Rules:**

- Evaluators MUST NOT mutate user data.
- Evaluators MUST be deterministic given the same DB snapshot and prefs.
- Cross-module evaluators live in `evaluators/cross_module.rs` later; they call existing db layers, never raw SQL from React.

### `Alert` model (serde, shared with frontend)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Alert {
    pub id: String,           // stable instance id, e.g. "maintenance.due_soon:vehicle:3:task:12"
    pub kind: String,           // catalog id, e.g. "maintenance.due_soon"
    pub severity: AlertSeverity, // info | warning | urgent
    pub title_key: String,      // i18n key
    pub body_key: String,       // i18n key
    pub body_args: Vec<String>, // interpolation tokens
    pub deep_link: DeepLink,
    pub created_at: String,     // ISO-8601
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeepLink {
    pub route: String,          // TanStack route, e.g. "/car", "/import"
    pub params: Option<serde_json::Value>,
}
```

Instance `id` encodes entity scope so dismiss/snooze is per-vehicle, per-category, etc.

### Evaluation cycle (`run_cycle`)

```
1. Load AlertPrefs from config (+ defaults)
2. IF master disabled → return empty
3. FOR EACH registered evaluator:
     candidates = evaluator.evaluate(conn, &prefs)
4. FOR EACH candidate:
     IF dismissed(id) OR snoozed_until(id) > now → skip
     IF last_fired(id) within dedupe window → skip
5. Sort by severity, apply per-domain caps (e.g. max 1 car alert per vehicle)
6. Persist last_fired for delivered alerts
7. delivery::deliver(alerts, prefs)
```

**Dedupe:** same `id` does not re-fire OS notification within 24h unless severity escalates (overdue > due_soon). Configurable via `alert_state.last_fired_at`.

**Per-vehicle cap** (from planning doc): pick highest priority among `overdue > due_soon > projected_due > odometer.stale`.

### Scheduler

```rust
// alerts/scheduler.rs
pub fn spawn_alert_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First tick shortly after startup (stagger 5s to avoid competing with recurring apply)
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            if let Err(e) = run_scheduled_cycle(&app) {
                tracing::error!("Alert scheduler tick failed: {}", e);
            }
            let interval_mins = load_tick_interval(&app).unwrap_or(60);
            tokio::time::sleep(Duration::from_secs(interval_mins * 60)).await;
        }
    });
}
```

Wire in `lib.rs` `setup` alongside existing background tasks:

```rust
alerts::scheduler::spawn_alert_scheduler(app.handle().clone());
```

---

## Persistence

### New migration: `021_alert_state.sql`

```sql
CREATE TABLE alert_state (
  alert_instance_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dismissed_at TEXT,
  snoozed_until TEXT,
  last_fired_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX idx_alert_state_kind ON alert_state(kind);
CREATE INDEX idx_alert_state_snoozed ON alert_state(snoozed_until);
```

### Config keys (`config` table, via `db/config.rs`)

| Key | Default | Description |
|-----|---------|-------------|
| `alerts.enabled` | `true` | Master toggle |
| `alerts.os_notifications` | `false` | OS notification opt-in |
| `alerts.tick_interval_minutes` | `60` | Background scheduler interval |
| `alerts.import_reminder_days` | `25` | Finance: import.reminder |
| `alerts.budget_pace_percent` | `80` | Finance: budget.pace threshold |
| `alerts.odometer_stale_days` | `30` | Car: odometer.stale |
| `alerts.projection_horizon_months` | `2` | Car: maintenance.projected_due |
| `alerts.autostart` | `false` | Launch at login (mirrors plugin state) |
| `alerts.run_in_background` | `true` | Hide-to-tray on close (vs quit) |

---

## Delivery layer

### Delivery router (`alerts/delivery.rs`)

```
deliver(alerts, prefs, app_handle):
  1. Always emit Tauri event `alerts:updated` with full active set (for React)
  2. IF prefs.os_notifications:
       FOR EACH alert where should_notify_os(alert):
         send via tauri-plugin-notification (Rust)
  3. IF window visible:
       optional — future in-app toast for high-severity only
```

**OS notification (Rust):**

```rust
use tauri_plugin_notification::NotificationExt;

app.notification()
    .builder()
    .title(&localized_title)  // resolve in Rust using Accept-Language or stored locale pref
    .body(&localized_body)
    .show()?;
```

On notification click: listen for `on_notification_click` / action → `window.show()` + emit `alerts:navigate` with `deep_link`.

**In-app (React):**

- **Phase 1:** existing dashboard cards consume `get_active_alerts` query; maintenance card migrates to generic hook.
- **Phase 2:** `NotificationCenter` (bell icon) subscribes to `alerts:updated` + TanStack Query cache invalidation.

### Tauri plugins & features to add

| Package | Purpose |
|---------|---------|
| `tauri-plugin-notification` | OS notifications |
| `tauri-plugin-autostart` | Launch at login |
| `tauri` feature `tray-icon` | System tray |

**Capabilities** (`src-tauri/capabilities/default.json`):

```json
"permissions": [
  "notification:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled"
]
```

---

## IPC contract

### Commands (`commands/alerts.rs`)

| Command | Purpose |
|---------|---------|
| `get_active_alerts` | Returns current non-dismissed, non-snoozed alerts (sorted) |
| `get_alert_preferences` | Returns `AlertPrefs` struct |
| `set_alert_preferences` | Partial update; syncs autostart plugin when `autostart` changes |
| `dismiss_alert` | Sets `dismissed_at` on instance id |
| `snooze_alert` | Sets `snoozed_until` (default 7 days) |
| `run_alert_check_now` | Manual refresh (settings/debug) |

All commands: `#[tauri::command(rename_all = "snake_case")]`.

### Events

| Event | Payload | Consumer |
|-------|---------|----------|
| `alerts:updated` | `Vec<Alert>` | Notification center, dashboard hooks |
| `alerts:navigate` | `DeepLink` | Router listener → programmatic navigation |

### Frontend hook

```typescript
// hooks/useAlerts.ts
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts', 'active'],
    queryFn: () => invoke<Alert[]>('get_active_alerts'),
    refetchInterval: 5 * 60_000, // fallback if event missed
  });
}

// listen in App shell
listen<Alert[]>('alerts:updated', ({ payload }) => {
  queryClient.setQueryData(['alerts', 'active'], payload);
});
```

---

## System tray integration

### `lib.rs` setup additions

1. Build tray menu: **Open**, **Check for alerts now** (optional), **Quit**.
2. `TrayIconBuilder::with_id("main")` using `app.default_window_icon()`.
3. `on_window_event` for `CloseRequested` → hide if `alerts.run_in_background == true`.
4. Badge (Phase 3): `tray.set_tooltip` with active alert count.

### User settings UI (`/settings` → Notifications section)

- Master enable
- Run in background (hide to tray)
- Launch at login
- OS notifications (with permission request flow)
- Per-category toggles (Phase 2)
- Import reminder interval, budget pace %, odometer stale days

---

## Evaluator registration (extensibility)

New alert types require **only**:

1. Implement `AlertEvaluator` in `evaluators/<domain>.rs`.
2. Register in `alerts/registry.rs` `fn all_evaluators() -> Vec<Box<dyn AlertEvaluator>>`.
3. Add i18n keys `alerts.<kind>.*` in `en.json` / `fr.json`.
4. Add catalog row in planning doc (documentation, not code).

No changes to scheduler, delivery, or IPC.

### Phase B evaluators (first implementations)

| Kind | Module | Notes |
|------|--------|-------|
| `import.reminder` | `evaluators/finance.rs` | Last import date from audit/import metadata |
| `budget.pace` | `evaluators/finance.rs` | Reuse budget status queries |
| `maintenance.due_soon` | `evaluators/maintenance.rs` | Wrap `get_maintenance_alert_summary` |
| `maintenance.overdue` | `evaluators/maintenance.rs` | Same source, filter by status |
| `odometer.stale` | `evaluators/maintenance.rs` | After `odometer_updated_at` migration |
| `maintenance.projected_due` | `evaluators/maintenance.rs` | km/month median logic |

---

## Interaction with existing architecture

| Existing component | Relationship |
|--------------------|--------------|
| `maintenance/evaluator.rs` | Stays pure; `alerts/evaluators/maintenance.rs` adapts output to `Alert` |
| `get_maintenance_alert_summary` | Kept for backward compat; internally may call shared evaluation |
| `financial_health/evaluator.rs` | Future Tier 2 alerts (`runway.below_target`) reuse same trait |
| `db/config.rs` | Alert prefs stored here |
| Background recurring apply (`lib.rs`) | Independent; scheduler stagger avoids lock contention |
| UX “passive by default” (financial health) | Alert **cards** remain calm; OS notifications opt-in only |

**PRD update needed:** Maintenance architecture says “No OS push notifications.” This addendum **supersedes** that for Phase D with explicit opt-in — align PRD when implementing.

---

## Security & privacy

- Notifications contain **no PII in logs**; log alert `kind` + `id` only.
- OS notification body uses localized strings; never raw account numbers.
- No network calls in alert pipeline.
- SQLite lock held for minimal time per tick (&lt; 100ms target on typical DB).

---

## Performance targets

| Metric | Target |
|--------|--------|
| Full evaluation cycle | &lt; 500ms for typical DB (NFR14 maintenance baseline) |
| Scheduler CPU | Negligible — wake once per hour |
| Memory | No unbounded caches; active alert list capped at 50 |

---

## Testing strategy

| Layer | Approach |
|-------|----------|
| Rust evaluators | Unit tests with in-memory SQLite + fixture data |
| `run_cycle` | Integration: dismiss/snooze/dedupe |
| Scheduler | Manual / test hook `run_alert_check_now` |
| Tray + hide-on-close | Playwright or manual macOS checklist |
| OS notifications | Manual on installed `.app` (plugin docs: dev mode shows PowerShell on Windows) |

---

## Implementation Patterns & Consistency Rules

_Module-specific patterns extending [architecture-desktop.md](architecture-desktop.md). All agents implementing the alert framework MUST follow these in addition to project-context.md rules._

### Pattern Categories Defined

**Critical Conflict Points Identified:** 14 areas where AI agents could make incompatible choices without these rules.

### Naming Patterns

**Alert catalog IDs:**
- Format: `domain.snake_case` — e.g. `import.reminder`, `maintenance.due_soon`, `odometer.stale`
- Instance IDs: `{kind}:{scope}` — e.g. `maintenance.due_soon:vehicle:3:task:12`
- **Never** use camelCase alert IDs

**Database naming:**
- Table: `alert_state` (singular concept, matches `config` pattern)
- Columns: `snake_case` — `alert_instance_id`, `snoozed_until`, `last_fired_at`
- Config keys: `alerts.{setting}` — e.g. `alerts.os_notifications`
- Migration: `021_alert_state.sql` (next sequential number)

**Rust module naming:**
- Top-level: `alerts/` (not `notifications/` — avoids confusion with OS plugin)
- Trait: `AlertEvaluator`; struct: `Alert`, `AlertPrefs`, `DeepLink`
- Commands file: `commands/alerts.rs` (not per-domain command files for dismiss/snooze)
- Evaluators: `alerts/evaluators/finance.rs`, `alerts/evaluators/maintenance.rs`

**TypeScript/React naming:**
- Hook: `useAlerts.ts`, `useAlertPreferences.ts`
- Components: `components/alerts/NotificationCenter.tsx`, `AlertCard.tsx`
- Settings section: `components/settings/AlertPreferencesSection.tsx`
- i18n keys: `alerts.{kind}.title`, `alerts.{kind}.body`, `alerts.{kind}.cta`

**IPC naming:**
- Commands: `get_active_alerts`, `get_alert_preferences`, `set_alert_preferences`, `dismiss_alert`, `snooze_alert`, `run_alert_check_now`
- Events: `alerts:updated`, `alerts:navigate`
- **Never** emit per-alert-type events — always batch via `alerts:updated`

### Structure Patterns

**Rust backend (additions):**

```
src-tauri/src/
├── alerts/
│   ├── mod.rs
│   ├── models.rs
│   ├── state.rs
│   ├── prefs.rs
│   ├── scheduler.rs
│   ├── delivery.rs
│   ├── registry.rs
│   └── evaluators/
│       ├── mod.rs
│       ├── finance.rs
│       └── maintenance.rs
├── commands/alerts.rs
migrations/021_alert_state.sql
```

**Rules:**
- Evaluators MUST NOT mutate data — read-only `evaluate(&Connection, &AlertPrefs)`
- Schedule evaluation for maintenance stays in `maintenance/evaluator.rs`; alerts module adapts output only
- OS notifications sent from `delivery.rs` in Rust — **not** from React
- Tray setup lives in `lib.rs` `setup` closure alongside existing background spawns

**Frontend (additions):**

```
src/hooks/useAlerts.ts
src/hooks/useAlertPreferences.ts
src/components/alerts/
src/components/settings/AlertPreferencesSection.tsx
```

**TanStack Query keys:**

| Key | Invalidated when |
|-----|-----------------|
| `["alerts", "active"]` | `alerts:updated` event, dismiss, snooze, manual refresh |
| `["alerts", "preferences"]` | settings save |

### Process Patterns

**Evaluation cycle:**
1. Load prefs → if disabled, return empty
2. Run all registered evaluators
3. Filter dismissed/snoozed/deduped
4. Apply per-domain caps (max 1 car alert per vehicle)
5. Persist `last_fired_at` → deliver

**Window close:**
- `CloseRequested` + `alerts.run_in_background=true` → `hide()`, not `exit()`
- Tray **Quit** → `app.exit(0)` — only user-initiated full stop

**Error handling:**
- Scheduler tick failures log via `tracing::error!` — never crash the process
- OS notification permission denied → skip OS delivery; in-app still works

---

## Project Structure & Boundaries

### Requirements → Component Mapping

| Requirement | Rust | React | Storage |
|-------------|------|-------|---------|
| Alert evaluation | `alerts/evaluators/*.rs` | — | SQLite reads |
| Alert state (dismiss/snooze) | `alerts/state.rs` | `useAlerts` mutations | `alert_state` |
| User preferences | `alerts/prefs.rs` | Settings section | `config` |
| Background scheduler | `alerts/scheduler.rs` | — | — |
| OS delivery | `alerts/delivery.rs` | permission UI in settings | — |
| In-app delivery | `alerts/delivery.rs` (emit) | `NotificationCenter`, dashboard cards | TanStack Query |
| Tray agent | `lib.rs` setup | — | — |
| Finance alerts | `evaluators/finance.rs` | dashboard cards | finance tables |
| Maintenance alerts | `evaluators/maintenance.rs` | existing maintenance card | maintenance tables |

### Component Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ React (apps/desktop/src)                                     │
│  useAlerts ──invoke──► commands/alerts.rs                   │
│  listen ◄──event── alerts:updated                             │
│  MUST NOT call maintenance/finance evaluators directly        │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC
┌──────────────────────────▼──────────────────────────────────┐
│ Rust (apps/desktop/src-tauri/src)                            │
│  commands/alerts.rs ──► alerts/mod.rs ──► db/* (read only)  │
│  alerts/scheduler.rs ──► run_cycle (background)              │
│  alerts/delivery.rs ──► tauri-plugin-notification           │
│  maintenance/evaluator.rs ◄── adapter only (no duplication) │
└─────────────────────────────────────────────────────────────┘
```

### Files to Create (Phase 1)

| File | Purpose |
|------|---------|
| `migrations/021_alert_state.sql` | `alert_state` table |
| `src/alerts/mod.rs` | Module root, `run_cycle` |
| `src/alerts/models.rs` | `Alert`, `DeepLink`, `AlertSeverity` |
| `src/alerts/state.rs` | dismiss/snooze/last_fired |
| `src/alerts/prefs.rs` | config key constants + load/save |
| `src/alerts/scheduler.rs` | `spawn_alert_scheduler` |
| `src/alerts/delivery.rs` | event emit + OS notify |
| `src/alerts/registry.rs` | evaluator registration |
| `src/alerts/evaluators/maintenance.rs` | adapter for existing evaluator |
| `src/commands/alerts.rs` | IPC commands |
| `src/hooks/useAlerts.ts` | TanStack Query + event listener |

### Files to Modify (Phase 1)

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Register alerts module, tray, scheduler, commands |
| `src-tauri/Cargo.toml` | `tray-icon` feature, notification + autostart plugins |
| `src-tauri/capabilities/default.json` | Plugin permissions |
| `src/routes/settings.tsx` | Alert preferences section (minimal Phase 1) |
| `src/locales/en.json`, `fr.json` | Alert i18n keys |

---

## Implementation phases

### Phase 1 — Framework + tray agent

- [ ] `alerts/` module skeleton (trait, models, state, registry)
- [ ] Migration `021_alert_state.sql` + prefs keys
- [ ] `spawn_alert_scheduler` + `run_cycle`
- [ ] IPC: `get_active_alerts`, prefs, dismiss, snooze
- [ ] Tray icon + hide-on-close
- [ ] `alerts:updated` event + `useAlerts` hook
- [ ] Maintenance evaluator adapter (parity with existing dashboard card)

### Phase 2 — Finance alerts + OS delivery

- [ ] `import.reminder` + `budget.pace` evaluators
- [ ] `tauri-plugin-notification` + settings opt-in
- [ ] Notification click → deep link navigation
- [ ] `tauri-plugin-autostart` + settings toggle
- [ ] In-app notification center (bell + history)

### Phase 3 — Polish (defer)

- [ ] Tray badge with alert count
- [ ] Quiet hours
- [ ] Detached OS service (only if users quit and still need alerts)
- [ ] Cross-module `get_upkeep_summary` widget

---

## Open decisions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Default tick interval | 60 min; immediate tick on launch |
| 2 | Close button behavior when `run_in_background=false` | Standard quit |
| 3 | Locale for OS notifications | Read `config` key `locale` or system default; Rust builds string via same keys as UI |
| 4 | Separate daemon | Defer; tray agent covers 90% of use cases |
| 5 | Notification sound | Silent by default on macOS |

---

## Related artifacts

- [Alerts & cross-module summary](alerts-and-cross-module-summary-2026-06-09.md)
- [Desktop architecture](architecture-desktop.md)
- [Car maintenance architecture](architecture-car-maintenance.md)
- [Tauri — System Tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri — Notifications plugin](https://v2.tauri.app/plugin/notification/)
- [Tauri — Autostart plugin](https://v2.tauri.app/plugin/autostart/)

---

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** Tray-resident agent (D1) aligns with Tauri 2 single-process model and existing background task patterns in `lib.rs`. `AlertEvaluator` trait (D2) composes with existing `maintenance/evaluator.rs` via adapter — no contradictory evaluation logic. `tauri-plugin-notification` + `tauri-plugin-autostart` are official Tauri 2 plugins compatible with current stack (Tauri 2.11).

**Pattern Consistency:** Naming follows architecture-desktop conventions (snake_case IPC, feature-based React folders, one `db/` layer per domain). Single `run_cycle` delivery path prevents in-app/OS drift. Config prefs reuse existing `db/config.rs`.

**Structure Alignment:** `alerts/` module mirrors `maintenance/` and `financial_health/` organization. IPC commands centralized in `commands/alerts.rs`. Tray lifecycle in `lib.rs` setup matches catalog refresh and recurring apply patterns.

### Requirements Coverage Validation ✅

**Planning summary coverage:** Tier 1 and Tier 1b alert kinds have evaluator homes defined. Tier 2 deferred with extension path via trait registry. Cross-module `get_upkeep_summary` deferred to Phase 3 — documented in planning artifact, not blocking Phase 1.

**Non-Functional Requirements:** NFR14 (fast evaluation), NFR11–NFR12 (backup includes new table), NFR16 (i18n keys), local-only, and quiet-by-default all architecturally addressed.

### Implementation Readiness Validation ✅

**Decision Completeness:** D1–D10 documented with technology versions. IPC contract, schema, scheduler, delivery, and tray behavior specified.

**Structure Completeness:** 11 new files and 5 modified files listed for Phase 1. Component boundaries and requirements mapping defined.

**Pattern Completeness:** 14 agent conflict points addressed with naming, structure, and process rules.

### Gap Analysis Results

**Important (non-blocking):**
- Locale resolution for OS notifications (Rust-side i18n loader) — open decision #3; recommend `config` locale key
- PRD and car-maintenance addendum still say “no OS push” — update when Phase 2 ships
- No epics/stories yet for alert framework — create via `/bmad-create-story`

**Critical gaps:** None.

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:** Extends proven desktop patterns; reuses maintenance evaluator; tray model avoids daemon complexity; trait registry enables incremental alert rollout.

**Areas for Future Enhancement:** Detached OS service, quiet hours, tray badge, cross-module upkeep widget.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow D1–D10 and implementation patterns exactly
- Never duplicate maintenance evaluation logic outside `maintenance/evaluator.rs`
- OS notifications from Rust `delivery.rs` only
- Register new evaluators in `registry.rs` — do not modify scheduler for new alert types

**First Implementation Priority:**
1. `021_alert_state.sql` + `alerts/` module skeleton
2. `spawn_alert_scheduler` + `run_cycle` with maintenance adapter
3. IPC commands + `useAlerts` hook
4. System tray + hide-on-close
5. Settings prefs (master toggle, run in background)
6. Phase 2: finance evaluators + OS notifications + autostart

---

**Workflow complete.** Next BMAD step: `/bmad-create-story` for **“Alert framework + tray background agent”** (Phase 1), or `/bmad-check-implementation-readiness` if epics need alignment first.
