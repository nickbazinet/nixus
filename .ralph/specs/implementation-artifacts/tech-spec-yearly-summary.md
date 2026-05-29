---
title: 'Yearly Summary — YTD Dashboard Card + Year Summary Page'
slug: 'yearly-summary'
created: '2026-05-23'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'Rust / rusqlite (Tauri backend)'
  - 'React 19 / TanStack Router / TanStack Query'
  - 'Recharts (monthly spend chart reuse)'
  - 'i18next (en + fr translations)'
files_to_modify:
  - 'apps/desktop/src-tauri/src/db/yearly_summary.rs'
  - 'apps/desktop/src-tauri/src/commands/yearly_summary.rs'
  - 'apps/desktop/src-tauri/src/commands/mod.rs'
  - 'apps/desktop/src-tauri/src/lib.rs'
  - 'apps/desktop/src-tauri/src/models/mod.rs'
  - 'apps/desktop/src/lib/types.ts'
  - 'apps/desktop/src/lib/constants.ts'
  - 'apps/desktop/src/hooks/useYearlySummary.ts'
  - 'apps/desktop/src/components/yearly-summary/YearToDateCard.tsx'
  - 'apps/desktop/src/components/yearly-summary/YearSummaryMetrics.tsx'
  - 'apps/desktop/src/routes/year-summary.tsx'
  - 'apps/desktop/src/routes/index.tsx'
  - 'apps/desktop/src/components/shared/InnerTabNav.tsx'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/year-summary.spec.ts'
  - 'apps/desktop/tests/dashboard.spec.ts'
code_patterns:
  - 'Single Tauri command returns aggregated DTO (like get_spending_trends, get_projection_input)'
  - 'Year filter via strftime(''%Y'', date) = ? (see dashboard.rs)'
  - 'Income year range via date >= YYYY-01-01 AND date < (YYYY+1)-01-01 (see income.rs)'
  - 'Dashboard cards link to detail pages (CashFlowSummaryCard → /income pattern)'
  - 'Analytics pages use PageHeader + PillTabs for period selection (net-worth.tsx, spending-trends.tsx)'
  - 'All money in cents (_cents suffix), display via useFormatCurrency'
test_patterns:
  - 'Playwright E2E with __TAURI_INTERNALS__ invoke mocks (dashboard.spec.ts pattern)'
  - 'Rust unit tests in db module with in-memory SQLite (net_worth.rs #[cfg(test)] pattern)'
baseline_commit: 'HEAD'
context:
  - '.ralph/specs/project-context.md'
  - '.ralph/specs/planning-artifacts/prd.md'
  - '.ralph/specs/planning-artifacts/ux-design-specification.md'
---

# Tech-Spec: Yearly Summary — YTD Dashboard Card + Year Summary Page

**Created:** 2026-05-23

## Overview

### Problem Statement

Users have no calendar-year view of their finances. The dashboard is month-scoped, Spending Trends uses rolling 3/6/12-month windows, and Net Worth change is rolling-period based. There is no single place to answer: *How much did I spend this year? How much did I gain? What were my top 3 spending categories?*

### Solution

Add a **hybrid two-surface feature**:

1. **Dashboard YTD card** — compact glanceable summary for the current calendar year (spent, net worth gain, top 3 categories), linking to the detail page.
2. **`/year-summary` page** — full calendar-year view with year picker, hero metrics, monthly spend chart, and ranked category table. Placed in analytics nav group (alongside Spending Trends and Projection).

**"Gain" definition:** Net worth change from the start of the calendar year to now (current year) or end of year (historical years). Cash flow net (income − expenses) shown as secondary context on the detail page only.

### Scope

**In Scope:**

- New Rust DB module + Tauri command `get_yearly_summary(year: i32)`
- `YearToDateCard` on dashboard (current year only, no year picker on dashboard)
- New `/year-summary` route with year `PillTabs` picker
- i18n keys (en + fr)
- Playwright E2E tests for both surfaces
- Rust unit tests for year aggregation SQL

**Out of Scope:**

- Investment return / cost-basis tracking (no data model exists)
- Annual budget targets or budget-vs-actual for the year (budget targets are monthly)
- Year-over-year comparison ("+12% vs 2024") — future enhancement
- Rolling 12-month mode changes on Spending Trends
- AI chat tool integration for yearly queries
- Web app (`apps/web`) — desktop only

## Context for Development

### Codebase Patterns

| Pattern | Reference | Apply to |
|---------|-----------|----------|
| Month/year SQL filter | `db/dashboard.rs` — `strftime('%Y', date)` | Expense/income aggregation |
| Year date range | `db/income.rs` — `date >= ? AND date < ?` | Annual income total |
| Rolling → calendar gap | `db/spending_trends.rs` uses `date('now', '-N months')` | New year-scoped queries instead |
| Net worth delta | `db/net_worth.rs` — `get_net_worth_change` first/last snapshot diff | Adapt for calendar-year boundaries |
| Aggregated command DTO | `commands/spending_trends.rs` → `SpendingTrendsData` | `YearlySummaryData` struct |
| Dashboard link card | `CashFlowSummaryCard.tsx` | `YearToDateCard.tsx` |
| Analytics page layout | `spending-trends.tsx`, `net-worth.tsx` | `year-summary.tsx` |
| Nav group 4 | `InnerTabNav.tsx` lines 36–39 | Add Year Summary tab |

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src-tauri/src/db/dashboard.rs` | Year/month expense aggregation SQL |
| `apps/desktop/src-tauri/src/db/income.rs` | Income date-range query pattern |
| `apps/desktop/src-tauri/src/db/net_worth.rs` | Snapshot history + change calculation |
| `apps/desktop/src-tauri/src/db/spending_trends.rs` | Monthly totals by category |
| `apps/desktop/src/routes/index.tsx` | Dashboard layout — insert YTD card after CashFlowSummaryCard |
| `apps/desktop/src/routes/spending-trends.tsx` | Reuse SpendingTrendChart + CategorySpendTable |
| `apps/desktop/src/components/dashboard/CashFlowSummaryCard.tsx` | Link-card UX pattern |
| `apps/desktop/src/components/spending-trends/SpendingTrendChart.tsx` | Reuse for 12-month chart |
| `apps/desktop/src/components/spending-trends/CategorySpendTable.tsx` | Reuse with annual totals (see note below) |
| `apps/desktop/tests/dashboard.spec.ts` | Playwright mock pattern |

### Technical Decisions

1. **Single command, one round-trip:** `get_yearly_summary(year)` returns all data the dashboard card and detail page need. Avoid separate commands for YTD vs full year.

2. **Current year = YTD, past years = full calendar year:**
   - Expenses/income: `date >= '{year}-01-01' AND date <= '{end_date}'` where `end_date` is `date('now')` for current year, `'{year}-12-31'` for past years.
   - Implemented in Rust using `chrono::Local::now()` to detect current year.

3. **Net worth gain calculation:**
   - `start_cents`: Value from the snapshot with the latest `snapshot_date` that is `<= '{year}-01-01'`. If none exists, use the earliest snapshot in the year. If still none, return `null` gain (UI shows "—" with helper text).
   - `end_cents`: For current year → `get_current_net_worth().total_cents`. For past years → snapshot with the latest `snapshot_date` where `strftime('%Y', snapshot_date) = '{year}'`; if none, use `start_cents` (0 change).
   - `gain_cents = end_cents - start_cents` (only when both values exist).

4. **Top 3 categories:** Spend-only ranking (no budget targets). `LIMIT 3` in SQL, ordered by `spent_cents DESC`.

5. **CategorySpendTable reuse:** The component computes *averages* over `monthCount`. For the year-summary page, pass `monthCount` equal to the number of months with data in the year, OR add an optional `mode: 'total' | 'average'` prop. **Prefer:** add optional `label` prop and pass pre-aggregated annual totals transformed into the existing `MonthlySpendByCategory`-compatible shape (sum all months per category, pass as single-month rows with `monthCount=1`). Simpler: create a thin `YearlyCategoryTable` wrapper that ranks categories by total spend — avoids modifying shared component behavior.

6. **Available years for picker:** Query distinct years from `expenses.date` UNION `income_entries.date`, sorted descending. Always include current year even if no data yet.

7. **Dashboard placement:** Insert `YearToDateCard` immediately below `CashFlowSummaryCard` (line ~106 in `index.tsx`). Do not add a year picker to the dashboard header — month navigation stays unchanged.

## Implementation Plan

### Tasks

- [x] **Task 1: Rust models**
  - File: `apps/desktop/src-tauri/src/models/mod.rs`
  - Action: Add structs:
    ```rust
    pub struct YearlyCategorySpend {
        pub category_id: i64,
        pub category_name: String,
        pub spent_cents: i64,
    }

    pub struct YearlySummaryData {
        pub year: i32,
        pub is_current_year: bool,
        pub total_spent_cents: i64,
        pub total_income_cents: i64,
        pub cash_flow_net_cents: i64,       // income - spent
        pub net_worth_gain_cents: Option<i64>, // None if insufficient snapshot data
        pub net_worth_gain_available: bool,
        pub top_categories: Vec<YearlyCategorySpend>, // max 3
        pub monthly_totals: Vec<MonthlySpendTotal>,   // reuse existing struct
        pub all_categories: Vec<YearlyCategorySpend>, // full ranked list for detail page
        pub available_years: Vec<i32>,
    }
    ```

- [x] **Task 2: Rust DB module**
  - File: `apps/desktop/src-tauri/src/db/yearly_summary.rs` (new)
  - Action: Implement `get_yearly_summary(conn, year: i32) -> Result<YearlySummaryData, AppError>`:
    - `get_total_spent_for_year(conn, year, end_date)`
    - `get_total_income_for_year(conn, year, end_date)` — adapt from `income.rs` date range
    - `get_top_categories_for_year(conn, year, end_date, limit)` — reuse spending breakdown pattern without month filter
    - `get_monthly_totals_for_year(conn, year, end_date)` — 12 buckets Jan–Dec, zero-fill missing months
    - `get_net_worth_gain_for_year(conn, year, is_current_year)` — snapshot logic per Technical Decision #3
    - `get_available_years(conn)` — distinct years query
  - File: `apps/desktop/src-tauri/src/db/mod.rs`
  - Action: Add `pub mod yearly_summary;`
  - Notes: Add `#[cfg(test)]` module with in-memory DB tests for: empty year, partial year, top-3 ordering, gain with/without snapshots.

- [x] **Task 3: Tauri command**
  - File: `apps/desktop/src-tauri/src/commands/yearly_summary.rs` (new)
  - Action: `#[tauri::command(rename_all = "snake_case")] pub fn get_yearly_summary(state, year: i32)`
  - File: `apps/desktop/src-tauri/src/commands/mod.rs` — add `pub mod yearly_summary;`
  - File: `apps/desktop/src-tauri/src/lib.rs` — register in `generate_handler!`

- [x] **Task 4: TypeScript types + query key**
  - File: `apps/desktop/src/lib/types.ts` — mirror `YearlySummaryData` and `YearlyCategorySpend` interfaces
  - File: `apps/desktop/src/lib/constants.ts` — add `yearlySummary: (year: number) => ["yearly-summary", year] as const`

- [x] **Task 5: React hook**
  - File: `apps/desktop/src/hooks/useYearlySummary.ts` (new)
  - Action: `useYearlySummary(year: number)` — TanStack Query wrapping `invoke("get_yearly_summary", { year })`

- [x] **Task 6: YearToDateCard component**
  - File: `apps/desktop/src/components/yearly-summary/YearToDateCard.tsx` (new)
  - Action: Compact card showing:
    - Title: "2026 Year to Date" (i18n with year interpolation)
    - Three columns: Spent | Gained (net worth Δ, colored green/red) | Top 3 categories (name + amount, truncated list)
    - Footer link: "View full summary →"
    - Wrap in `<Link to="/year-summary">` (same pattern as CashFlowSummaryCard)
    - Loading skeleton, empty state when zero expenses ("No spending recorded yet this year")
    - When `net_worth_gain_available` is false: show "—" for gain with `title` tooltip explaining snapshot requirement
  - Props: accept `YearlySummaryData` + `isLoading`

- [x] **Task 7: Dashboard integration**
  - File: `apps/desktop/src/routes/index.tsx`
  - Action:
    - Import `useYearlySummary`, `YearToDateCard`
    - Call `useYearlySummary(now.getFullYear())`
    - Render `<YearToDateCard />` below `CashFlowSummaryCard` (after line 106)
    - Do NOT modify `MonthNavigator` or month-scoped hooks

- [x] **Task 8: Year summary detail page**
  - File: `apps/desktop/src/routes/year-summary.tsx` (new)
  - Action: Page layout:
    - `PageHeader` with title "Year Summary"
    - `PillTabs` for year selection (options from `available_years` in API response; default current year)
    - `YearSummaryMetrics` hero row: Spent | Income | Cash Flow Net | Net Worth Gain
    - `SpendingTrendChart` fed with `monthly_totals` (reuse as-is)
    - `YearlyCategoryTable` — ranked list of all categories with horizontal bars (extract simple table from CategorySpendTable pattern, showing annual totals not averages)
  - File: `apps/desktop/src/components/yearly-summary/YearSummaryMetrics.tsx` (new)
  - File: `apps/desktop/src/components/yearly-summary/YearlyCategoryTable.tsx` (new)
  - Notes: Route auto-registers via TanStack Router file-based routing when file is created.

- [x] **Task 9: Navigation**
  - File: `apps/desktop/src/components/shared/InnerTabNav.tsx`
  - Action: Add to nav group 4 (analytics), after Spending Trends:
    ```typescript
    { to: "/year-summary", labelKey: "nav.yearSummary", icon: CalendarDays }
    ```
    Import `CalendarDays` from `lucide-react`.

- [x] **Task 10: i18n**
  - Files: `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`
  - Action: Add keys under `yearSummary.*` and `nav.yearSummary`:
    - `nav.yearSummary`: "Year Summary" / "Résumé annuel"
    - `yearSummary.title`, `yearSummary.ytd`, `yearSummary.spent`, `yearSummary.gained`, `yearSummary.topCategories`, `yearSummary.viewFull`, `yearSummary.income`, `yearSummary.cashFlowNet`, `yearSummary.noGainData`, `yearSummary.noData`, `yearSummary.categories`

- [x] **Task 11: E2E tests**
  - File: `apps/desktop/tests/year-summary.spec.ts` (new)
  - Action: Mock `get_yearly_summary`, verify:
    - Page renders metrics and chart
    - Year pill tabs switch data
    - Empty state when no data
  - File: `apps/desktop/tests/dashboard.spec.ts`
  - Action: Add mock for `get_yearly_summary` in existing setup functions; verify YTD card renders with spent/gain/categories; verify link navigates to `/year-summary`

- [x] **Task 12: Rust unit tests**
  - File: `apps/desktop/src-tauri/src/db/yearly_summary.rs`
  - Action: Tests for:
    - Total spent sums only within year boundaries
    - Top 3 returns correct ordering
    - Monthly totals zero-fill missing months
    - Net worth gain returns `None` when no snapshots exist
    - Current year YTD excludes future dates

### Acceptance Criteria

- [x] **AC 1:** Given expenses exist in the current calendar year, when the user opens the dashboard, then a Year to Date card shows total spent, net worth gain (or "—" if no snapshots), and the top 3 spending categories by amount.

- [x] **AC 2:** Given the Year to Date card is visible, when the user clicks it, then they navigate to `/year-summary` showing the current year selected.

- [x] **AC 3:** Given the user is on `/year-summary`, when they select a different year via PillTabs, then all metrics, the monthly chart, and the category table update to reflect that calendar year.

- [x] **AC 4:** Given income and expense data exist for a year, when viewing the year summary page, then cash flow net (income − expenses) is displayed alongside spent and income totals.

- [x] **AC 5:** Given at least 2 net worth snapshots bracket the year (start baseline + end value), when viewing gain metrics, then net worth gain shows the absolute difference with green (positive) or red (negative) styling.

- [x] **AC 6:** Given no net worth snapshots exist before or during the year, when viewing gain metrics, then gain displays "—" with explanatory helper text (not an error state).

- [x] **AC 7:** Given no expenses exist for the current year, when the dashboard loads, then the YTD card shows an empty state with appropriate copy (no crash, no "$0" misleading top categories).

- [x] **AC 8:** Given the user switches dashboard months via MonthNavigator, when the month changes, then the YTD card data does NOT change (year-scoped, independent of month selection).

- [x] **AC 9:** Given the app locale is French, when viewing the year summary page, then all labels render in French.

- [x] **AC 10:** Given historical year 2024 is selected and it is not the current year, when viewing totals, then the date range is Jan 1 – Dec 31 2024 (not rolling 12 months, not YTD truncated to today).

## Additional Context

### Dependencies

- No new npm or Cargo dependencies
- Reuses existing: Recharts, PillTabs, DashboardMetricCard patterns, TanStack Router/Query
- Depends on existing tables: `expenses`, `income_entries`, `net_worth_snapshots`, `budget_categories`

### Testing Strategy

**Rust unit tests** (`yearly_summary.rs`):
- In-memory SQLite with seed data
- Boundary date tests (Dec 31 / Jan 1)
- Top-3 ordering with ties (stable order by name as tiebreaker)

**Playwright E2E:**
- Mock `get_yearly_summary` via `__TAURI_INTERNALS__` (existing pattern)
- Dashboard: card visibility + navigation
- Year summary page: year tab switching, empty state

**Manual verification:**
1. Open dashboard — confirm YTD card appears below cash flow, month navigator still works independently
2. Navigate to Year Summary tab — confirm chart shows Jan–Dec buckets
3. Select a past year with data — confirm full-year totals
4. Test with no net worth snapshots — confirm graceful "—" for gain

### Notes

**Risk: Sparse net worth snapshots.** Users who don't update balances regularly may see "—" for gain frequently. Mitigate with clear copy: "Update account balances to track year-over-year gain." Link to `/accounts`.

**Risk: CategorySpendTable averages.** Do not pass annual data through the average-computing component without adaptation. Use `YearlyCategoryTable` showing totals.

**Future enhancements (out of scope):**
- Year-over-year comparison badges ("↑ 8% vs 2024")
- Export year summary as PDF/CSV
- AI chat tool: `get_yearly_summary` exposed to chat agent
- Tax-year support (non-calendar fiscal year)

**Verification commands:**
```bash
cd apps/desktop/src-tauri && cargo test yearly_summary
cd apps/desktop && pnpm exec playwright test year-summary dashboard
cd apps/desktop && pnpm run build
```
