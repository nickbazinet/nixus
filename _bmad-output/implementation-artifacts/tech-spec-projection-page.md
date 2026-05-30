---
title: 'Projection Page — Net Worth Forecast'
type: 'feature'
created: '2026-04-04'
status: 'done'
baseline_commit: '409ea94e'
context:
  - docs/guidelines/warnings.md
---

# Projection Page — Net Worth Forecast

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to visualize future net worth based on current balances, average cash flow, and expected growth/depreciation rates per account and asset type.

**Approach:** Add a `/projection` route with a line chart showing projected net worth over a selectable time horizon (6m–20y). A single new Rust command returns the starting snapshot (balances by account type, assets by type, avg monthly income, avg monthly expenses). The frontend computes the projection using fixed Canadian-historical growth rates per category and renders the forecast with a visible assumptions panel.

## Boundaries & Constraints

**Always:**
- Growth rates: TFSA/RRSP/FHSA/non-registered/crypto = 7% annual; real_estate = 3.9% (Canadian historical); vehicles = -15% annual; chequing/savings/credit_card/business/other = 0%.
- Net monthly cash flow (avg income − avg expenses) added to cash pool each month.
- Averages computed from all available history in the system.
- Assumptions panel visible on the page showing rates and computed averages used.

**Ask First:**
- Changing any default growth rate values.
- Adding interactive rate adjustment controls (deferred to Goal 2).

**Never:**
- Scenario management, save/load, or comparison (Goal 2).
- Persisting projections to the database — all computation is frontend-only.
- Modifying existing pages or commands.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Accounts + assets + income + expenses exist | Line chart with projected net worth curve | N/A |
| No income/expense data | Zero history | Projection uses 0 net cash flow; chart still renders from asset growth alone | Show note: "No income/expense history — projection based on asset growth only" |
| No accounts or assets | Empty balances | Flat line at $0 if no cash flow, or rising line from cash flow only | Show note: "No accounts or assets found" |
| Single account type only | e.g. only TFSA | Projection applies 7% to TFSA, other categories absent | N/A |

</frozen-after-approval>

## Code Map

- `src-tauri/src/db/projection.rs` — new: query for projection starting data (balances by type, assets by type, avg income, avg expenses)
- `src-tauri/src/commands/projection.rs` — new: Tauri command wrapping the DB query
- `src-tauri/src/commands/mod.rs` — register projection module
- `src-tauri/src/lib.rs` — register command in generate_handler!
- `src/routes/projection.tsx` — new: route component with chart + assumptions panel
- `src/components/projection/ProjectionChart.tsx` — new: Recharts line chart for the forecast
- `src/components/projection/AssumptionsPanel.tsx` — new: card showing rates and averages used
- `src/hooks/useProjectionData.ts` — new: hook to fetch data + compute projection series
- `src/lib/projection.ts` — new: pure projection math (compound growth, monthly stepping)
- `src/components/shared/InnerTabNav.tsx` — add Projection tab to nav group 4

## Tasks & Acceptance

**Execution:**
- [ ] `src-tauri/src/db/projection.rs` — create query returning `ProjectionInput` (account balances by type, asset values by type, avg monthly income/expenses cents, month count) from SQLite
- [ ] `src-tauri/src/commands/projection.rs` + `mod.rs` + `lib.rs` — expose `get_projection_input` command
- [ ] `src/lib/projection.ts` — implement `computeProjection(input, months): ProjectionPoint[]` with monthly compound growth per category
- [ ] `src/hooks/useProjectionData.ts` — fetch via Tauri invoke, compute series for selected horizon
- [ ] `src/components/projection/ProjectionChart.tsx` — Recharts LineChart with time on X, dollars on Y, tooltip showing breakdown
- [ ] `src/components/projection/AssumptionsPanel.tsx` — display growth rates table + avg income/expense values
- [ ] `src/routes/projection.tsx` — page layout: PageHeader, PillTabs for horizon, chart, assumptions panel
- [ ] `src/components/shared/InnerTabNav.tsx` — add Projection entry in nav group 4 after Trends

**Acceptance Criteria:**
- Given accounts and assets exist, when navigating to /projection, then a line chart shows projected net worth over the default time horizon
- Given the user selects a different time horizon (6m, 1y, 2y, 5y, 10y, 20y), then the chart updates to reflect that period
- Given the assumptions panel is visible, then all growth rates and computed average income/expense values are displayed
- Given no income or expense history exists, then the chart still renders with a note explaining the limitation

## Verification

**Commands:**
- `cd src-tauri && cargo check` — expected: no compilation errors
- `npm run build` — expected: no TypeScript errors
- `npm run lint` — expected: no lint errors

**Manual checks:**
- Navigate to /projection — chart renders with projected net worth line
- Switch between time horizons — chart updates correctly
- Assumptions panel shows correct rates and averages matching system data
