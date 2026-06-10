---
status: draft
date: 2026-06-09
author: Nbazinet
project: nixus
scope: alerts-notifications + finance-car-cross-module
inputDocuments:
  - _bmad-output/planning-artifacts/research/market-canadian-pf-mint-alternatives-research-2026-06-09.md
  - _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md
  - _bmad-output/planning-artifacts/architecture-car-maintenance.md
  - _bmad-output/planning-artifacts/prd.md
relatedMarketingPosition: >-
  Proactive upkeep automation — "next action, not another chart" and
  "one app for life upkeep" (see marketing site ValuePillars, 2026-06-09).
---

# Alerts, Notifications & Cross-Module Intelligence — Summary

**Purpose:** Product planning reference for Nixus “next gen” differentiation vs reactive aggregators (Monarch, YNAB, etc.). Covers **local desktop notifications** and **Finance ↔ Car cross-module** behavior — what to build, in what order, and what to defer.

**Not in scope:** Push notifications via cloud, mobile alerts, email digests, or bank-sync triggers.

---

## Strategic frame

Monarch-style apps alert when **transactions post** (reactive). Nixus should alert when **upkeep is due** (proactive):

| Trigger type | Monarch / sync apps | Nixus direction |
|--------------|---------------------|-----------------|
| Transaction posted | ✓ Primary | ✗ No bank feed |
| Statement import overdue | — | ✓ Ritual reminder |
| Budget drift mid-month | Partial | ✓ Local threshold |
| Emergency fund drop | — | ✓ After snapshot |
| Waterfall priority shift | — | ✓ Surplus detected |
| Car service due | — | ✓ Already partial |
| Odometer stale (nudge to update) | — | ✓ Proposed |
| Projected service due (km/month rate) | — | ✓ Proposed |
| Cross-module (“can I afford repair?”) | — | ✓ Unique moat |

All alerts run **on-device** using SQLite + scheduled local checks. No server, no account, no telemetry required.

---

## Part 1 — Alert & notification system

### Design principles

1. **Local-only** — OS notification APIs (Tauri) or in-app banner; no cloud push.
2. **Action-oriented** — Every alert links to a screen or suggested next step, not just information.
3. **Quiet by default** — Pre-alpha: opt-in per category; respect Do Not Disturb / focus modes.
4. **Deterministic first** — Rule-based triggers before LLM-generated “insights.”
5. **Confirm before auto-action** — Alerts suggest; they never mutate data silently.

### Architecture sketch

```
┌─────────────────────────────────────────────────────────┐
│  Scheduler (app launch + daily background tick)         │
│  · last import date · budget month · car odometer       │
│  · emergency fund snapshot · user prefs (snooze/dismiss)│
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Alert evaluator (Rust, pure functions)                 │
│  · finance rules · maintenance rules · cross-module     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Delivery                                                 │
│  · In-app: dashboard cards + notification center (future) │
│  · OS: tauri-plugin-notification (optional, user opt-in)  │
└─────────────────────────────────────────────────────────┘
```

Persist `alert_state` (dismissed ids, snooze until, last fired) in SQLite `config` or dedicated table.

---

### Alert catalog (prioritized)

#### Tier 1 — MVP alerts (highest validation value)

| ID | Trigger | Message (EN example) | Deep link | Module |
|----|---------|----------------------|-----------|--------|
| `import.reminder` | No CC import in N days (default 25) and user has imported before | “Statements usually arrive around now — import this month’s CC?” | Import flow | Finance |
| `budget.pace` | Category or total spend > X% of budget with > Y days left in month (e.g. 80% / 12 days) | “Dining is at 85% with 10 days left” | Budget month view | Finance |
| `maintenance.due_soon` | Task within 500 km or 14 days (existing evaluator) | “Oil change due in ~400 km on Civic” | Garage / vehicle | Car |
| `maintenance.overdue` | Past due date or km | “Brake inspection overdue on Civic” | Garage / vehicle | Car |

**Notes:**

- Car maintenance alerts **partially exist** (dashboard summary card, schedule evaluator). Extend delivery to OS notifications + consistent copy.
- Import reminder is the **highest-leverage finance alert** — reinforces document-first ritual without Plaid.

#### Tier 1b — Odometer-aware alerts (Car module)

These complement `maintenance.due_soon` / `overdue`. The existing evaluator uses **current odometer + last service anchor** but cannot warn accurately if the odometer is stale, and km-based due dates feel abstract without a **projected calendar date**.

| ID | Trigger | Message (EN example) | Primary action | Module |
|----|---------|----------------------|----------------|--------|
| `odometer.stale` | Vehicle odometer not updated in **N days** (default 30) and vehicle has km-based tasks | “It’s been 6 weeks since you updated the odometer on **Civic** (last: 84,200 km). Update it now?” | Open odometer update for vehicle | Car |
| `maintenance.projected_due` | Sufficient odometer history to estimate **km/month**; next km-based task within projected window | “You drive ~820 km/month. Oil change on **Civic** is likely due in about **3 weeks** (~2,400 km left).” | Garage → task detail | Car |

**Why both matter**

| Alert | Problem it solves |
|-------|-------------------|
| `odometer.stale` | User forgets to log km → km-based schedules silently drift wrong |
| `maintenance.projected_due` | “Due in 2,400 km” is hard to plan; calendar estimate helps upkeep feel like finance rituals |

**`odometer.stale` — trigger logic**

```
IF vehicle has ≥1 task with interval_km > 0
AND days_since(odometer_updated_at) >= stale_threshold_days  -- default 30
AND NOT snoozed(odometer.stale, vehicle_id)
THEN fire alert
```

**Data note:** Today `vehicles.updated_at` changes on any vehicle edit, not only odometer. **Recommend** adding `vehicles.odometer_updated_at` (set on manual odometer update + service log when odometer changes). Until then, use `updated_at` as a best-effort proxy and document the limitation.

**UX:** Alert includes inline CTA — not “want me to update it?” (auto-write) but **“Update odometer”** opening the existing manual odometer form pre-filled with last value. Optional secondary: **“Snooze 2 weeks”** (user was on vacation, km unchanged).

**Copy variants (EN):**

- Short: “Civic odometer last updated 42 days ago (84,200 km).”
- Action: “Update odometer →”

**`maintenance.projected_due` — trigger logic**

Requires **≥2 odometer readings with dates** for the same vehicle:

| Source | Fields |
|--------|--------|
| Service logs | `service_date`, `odometer_km` |
| Manual odometer updates | `odometer_updated_at`, `odometer_km` (after history column exists) |

```
km_per_month = median monthly delta from readings (trim outliers; min 60 days span)
km_remaining = next_due_odometer_km - current_odometer_km  -- from existing evaluator
months_until = km_remaining / km_per_month
projected_date = today + months_until (round to weeks for copy)

IF km_per_month confidence >= threshold  -- e.g. ≥2 readings, ≥60 days apart
AND months_until <= projection_alert_months  -- default 2
AND task status is Ok or Upcoming (not already overdue on time axis)
THEN fire alert (once per task per projection window; snoozeable)
```

**Example messages (EN):**

- “Based on your driving (~820 km/month), **oil change** on Civic is likely due in about **3 weeks** (~2,400 km remaining).”
- Low confidence: “Update your odometer to improve due-date estimates for Civic.” (falls back to `odometer.stale` pattern)

**Relationship to existing alerts**

| Existing | New |
|----------|-----|
| `maintenance.due_soon` at 500 km / 14 days | Still fires on **raw km_remaining** — immediate, no projection |
| `maintenance.projected_due` | Fires **earlier**, calendar-framed, when driving rate is known |
| `odometer.stale` | Fires when **data is too old** to trust any km alert |

Show at most **one car alert per vehicle** on dashboard (pick highest priority: overdue > due_soon > projected_due > odometer.stale).

**Confidence & honesty (pre-alpha)**

- Always show **“~” / “about”** on projections; never exact dates as promises.
- If only one odometer reading exists, **do not project** — suggest odometer update instead.
- i18n keys: `alerts.odometer.stale.*`, `alerts.maintenance.projectedDue.*` (EN + FR).

**Schema addition (recommended for Phase B)**

```sql
-- Optional: odometer history for projection + audit trail
CREATE TABLE odometer_readings (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  odometer_km INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,  -- ISO date or datetime
  source TEXT NOT NULL        -- 'manual' | 'service_log'
);

-- On vehicles table
ALTER TABLE vehicles ADD COLUMN odometer_updated_at TEXT;
```

Append row on every manual odometer update and when service log updates vehicle km.

---

#### Tier 2 — Differentiation alerts (post-validation)

| ID | Trigger | Message example | Deep link |
|----|---------|-----------------|-----------|
| `runway.below_target` | Emergency fund months < user target (FR83) | “Runway is 2.1 months — target is 6” | Financial Health |
| `waterfall.surplus` | Positive savings capacity + waterfall next action | “You had $420 surplus last month — consider TFSA top-up” | Financial Health |
| `snapshot.stale` | No net worth snapshot in N days (e.g. 30) | “Net worth snapshot is 5 weeks old” | Net Worth |
| `recurring.drift` | Recurring template amount vs actual avg deviates > threshold | “Netflix charges look higher than your template” | Expenses |

#### Tier 3 — Future / optional

| ID | Trigger | Notes |
|----|---------|-------|
| `import.batch` | Multiple cards configured, only some imported | Needs multi-card metadata |
| `projection.deviation` | Actual net worth vs projection band | Requires projection module maturity |
| `ai.insight` | LLM summary of weekly changes | Only after deterministic alerts trusted; never auto-send |

---

### User preferences (minimal schema)

| Setting | Default | Storage |
|---------|---------|---------|
| Master enable | on | `config` |
| OS notifications | off (opt-in) | `config` |
| Import reminder days | 25 | `config` |
| Budget pace threshold | 80% | `config` |
| Odometer stale threshold | 30 days | `config` |
| Projected due horizon | 2 months | `config` |
| Min odometer history for projection | 2 readings, 60 days apart | evaluator constant |
| Snooze duration | 7 days | per-alert `alert_state` |
| Quiet hours | none | `config` (future) |

---

### Delivery surfaces

| Surface | Phase | UX |
|---------|-------|-----|
| Dashboard cards | Now | Maintenance alert card exists; add import reminder + budget pace |
| Financial Health panel | Now | Show runway/waterfall as persistent “status”, not just alert |
| In-app notification tray | Phase 2 | Bell icon, dismiss/snooze history |
| OS notifications (Tauri) | Phase 2 | Opt-in; deep link on click |
| Menu bar / tray badge | Phase 3 | Desktop-native “upkeep due” |

---

### Non-goals (explicit)

- Email/push without user mail client (mailto links OK on web only)
- SMS, Slack, Discord webhooks
- Alerts based on live bank transactions
- AI-generated alerts without deterministic backing

---

## Part 2 — Finance + Car cross-module intelligence

### Why this matters

No major PF aggregator combines **budget/runway** with **vehicle maintenance**. Nixus already has both modules in one shell — cross-module queries are a **defensible “next gen” story** for marketing and product.

### Cross-module data available today

| Finance | Car | Shared context |
|---------|-----|----------------|
| Budget categories & spend | Vehicle cards, tasks | Time (month), user |
| Emergency fund / runway (FR83–89) | Service due dates, odometer | — |
| Accounts & cash balances | Service log costs (if logged) | CAD amounts |
| AI chat tools (finance + maintenance) | Maintenance query tools | Conversation scope |

### Cross-module use cases (prioritized)

#### Tier 1 — Query / read (extend AI chat)

| User question | Data needed | Status |
|---------------|-------------|--------|
| “When is my Civic due for an oil change?” | Maintenance evaluator | ✓ Shipped |
| “How much did I spend on gas last month?” | Expenses by category | ✓ Shipped |
| “Can I afford a $600 brake job this month?” | Cash balance + budget remaining + optional runway | **Spec** |
| “What did car maintenance cost me this year?” | Service log sums | Partial (if costs logged) |

**Implementation:** New AI tool `evaluate_affordability` — inputs: amount_cents, optional category; outputs: liquid balance, budget headroom, runway months, plain-language summary. **No auto recommendation** — present figures only.

#### Tier 2 — Dashboard cross-links

| Surface | Behavior |
|---------|----------|
| Maintenance dashboard card | Show “estimated service cost” band if user enters typical costs (optional field) |
| Financial Health | Footnote: “Vehicle maintenance due in 14 days — see Garage” when task due |
| Garage vehicle card | Badge: “Transport budget 72% used this month” (pull finance category group) |

#### Tier 3 — Unified “life upkeep” view (future module)

Single scroll or sidebar section:

- **Due this month:** CC import ritual, budget review, car services, net worth snapshot
- **Completed:** Last import date, last snapshot, last service logged

This becomes the home for **Tier 1 alerts** aggregated in one place — the operational heart of “one app for life upkeep.”

---

### Cross-module architecture rules

1. **Finance commands never import maintenance DB directly in React** — cross-module reads go through a dedicated Rust aggregator (e.g. `commands/cross_module.rs` or extend `financial_health` with optional maintenance context).
2. **Car module stays standalone** — no hard dependency from maintenance → finance tables; aggregator composes at read time.
3. **AI tools declare module scope** — agent identity already scopes conversations; cross-module tools require both modules enabled.
4. **i18n for all cross-module copy** — EN + FR from day one.

### Suggested IPC / API shape (draft)

```rust
// commands/cross_module.rs
#[tauri::command(rename_all = "snake_case")]
fn get_upkeep_summary(state: State<DbState>) -> Result<UpkeepSummary, AppError>;

#[tauri::command(rename_all = "snake_case")]
fn evaluate_discretionary_purchase(
    state: State<DbState>,
    amount_cents: i64,
    category_hint: Option<String>,
) -> Result<PurchaseAffordability, AppError>;
```

```typescript
type UpkeepSummary = {
  finance: {
    last_import_date: string | null;
    import_due_suggested: boolean;
    budget_pace_warnings: BudgetPaceWarning[];
    runway_months: number | null;
  };
  maintenance: {
    overdue_count: number;
    due_soon_count: number;
    next_task: MaintenanceTaskSummary | null;
  };
};
```

---

## Recommended build sequence

### Phase A — Marketing truth (now → 4 weeks)

Align product surface with site copy already shipped:

- [ ] Surface Financial Health prominently on dashboard (if not already default-visible)
- [ ] Ensure maintenance alert card visible on finance dashboard
- [ ] Document cross-module AI questions in `/beta` FAQ or help (1–2 examples)

### Phase B — Alert MVP (4–8 weeks)

- [ ] `import.reminder` + `budget.pace` evaluators (Rust)
- [ ] Dashboard cards for both
- [ ] User prefs: master toggle + import interval
- [ ] Extend maintenance alerts to match finance card pattern
- [ ] `vehicles.odometer_updated_at` + optional `odometer_readings` table
- [ ] `odometer.stale` alert + inline “Update odometer” CTA
- [ ] `maintenance.projected_due` evaluator (km/month median, calendar copy)

### Phase C — Cross-module read path (8–12 weeks)

- [ ] `get_upkeep_summary` IPC + dashboard “Upkeep this month” widget
- [ ] AI tool: `evaluate_discretionary_purchase` for “can I afford…”
- [ ] Garage card shows transport budget % (optional)

### Phase D — OS notifications + tray (12+ weeks)

- [ ] Tauri notification plugin, opt-in
- [ ] In-app notification history with snooze

---

## Success metrics (validation)

| Signal | Target |
|--------|--------|
| Users who act on import reminder within 48h | ≥50% of testers who saw it |
| “Can I afford…” AI query used | ≥1 per engaged tester |
| Maintenance alert → service logged | ≥1 conversion in beta cohort |
| Odometer stale alert → odometer updated within 48h | ≥1 conversion in beta cohort |
| User quote mentions “upkeep” or “reminded me” | Qualitative win |

---

## Marketing alignment

Site pillars (2026-06-09) map directly:

| Pillar | Product proof |
|--------|---------------|
| Automation without bank access | Import reminder + document pipeline |
| Next action, not another chart | Runway + waterfall alerts |
| One app for life upkeep | Cross-module summary + garage + finance + **odometer-aware car alerts** |

**Do not market OS notifications until Phase D.** Market **dashboard-level proactive guidance** first — it’s shippable sooner and honest for pre-alpha.

---

## Open questions

1. Default import reminder interval — 25 days vs calendar “1st of month”?
2. Should service log **require** cost entry for affordability queries, or allow km/date-only?
3. Single “Upkeep” sidebar item vs keep modules separate with cross-links?
4. Notification sound/branding for desktop — subtle or silent only?
5. Odometer stale default — 30 days vs 45 for low-mileage drivers?
6. Project projection alerts when km/month variance is high (e.g. summer road trips)?

---

## Related artifacts

- [Market research — Canadian PF & Mint alternatives](./research/market-canadian-pf-mint-alternatives-research-2026-06-09.md)
- [Financial Decision Intelligence architecture](./architecture-financial-decision-intelligence.md)
- [Car maintenance architecture](./architecture-car-maintenance.md)
- [UX — `/beta` page](./ux-design-specification-beta-page-2026-06-09.md)

---

**Next step:** Pick Phase B alerts (`import.reminder` + `budget.pace`) as the first implementation story when moving from marketing copy to product delivery.
