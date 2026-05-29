# Story 5.4: Net Worth History Page with Trend Chart

Status: review

## Story

As a user,
I want to view my net worth history over time as a trend chart with category breakdown,
So that I can see how my financial position has changed.

## Acceptance Criteria

**Given** the user navigates to the Net Worth page
**When** net worth snapshots exist
**Then** a large trend line chart (Recharts v3) shows net worth over time (FR27)
**And** the page header shows "Net Worth" with the current total (UX-DR23)
**And** period tabs allow filtering: 6M, 1Y, ALL (UX-DR24)
**And** a NetWorthBreakdownBar (UX-DR9) shows the current composition as a stacked horizontal bar with proportional colored segments per category
**And** a legend grid below shows each category: name, color dot, dollar amount, percentage
**And** hovering a segment shows a tooltip with category name, amount, and percentage
**And** trend indicators show direction (up emerald / down rose) with absolute and percentage change (UX-DR25)

**Given** no snapshots exist
**When** the user views the Net Worth page
**Then** an empty state shows "No net worth history yet. Add accounts and assets to start tracking." (UX-DR19)

## Tasks / Subtasks

### Task 1: Net Worth History Query with Period Filtering
Add period-filtered query for net worth history.

**AC reference:** "period tabs allow filtering: 6M, 1Y, ALL"

- Add/update in `src-tauri/src/db/net_worth.rs`:
  - `get_net_worth_history(conn: &Connection, period: &str) -> Result<Vec<NetWorthSnapshot>, AppError>`
    - `period` accepts "6m", "1y", "all"
    - "6m": snapshots from last 6 months (`snapshot_date >= date('now', '-6 months')`)
    - "1y": snapshots from last 12 months
    - "all": all snapshots
    - Results ordered by `snapshot_date` ASC
  - `get_net_worth_change(conn: &Connection, period: &str) -> Result<NetWorthChange, AppError>` — computes absolute and percentage change over the selected period
    - Compares earliest snapshot in period to latest
    - Returns `{ absolute_change_cents: i64, percentage_change: f64, direction: String }` where direction is "up", "down", or "flat"

### Task 2: Rust Models for History and Change
Define structs for history query responses.

**AC reference:** "trend indicators show direction with absolute and percentage change"

- Add to `src-tauri/src/models/mod.rs`:
  - `NetWorthChange { absolute_change_cents: i64, percentage_change: f64, direction: String }`
- `NetWorthSnapshot` and `NetWorthBreakdown` structs should already exist from Story 5.3

### Task 3: Tauri Commands for History
Expose history and change queries as Tauri commands.

**AC reference:** Period tabs require parameterized queries.

- Add to `src-tauri/src/commands/net_worth.rs`:
  - `#[tauri::command] fn get_net_worth_history(state, period: String) -> Result<Vec<NetWorthSnapshot>, AppError>`
  - `#[tauri::command] fn get_net_worth_change(state, period: String) -> Result<NetWorthChange, AppError>`
- Register commands in `src-tauri/src/main.rs`

### Task 4: TypeScript Types and Query Keys
Define frontend types for history data.

**AC reference:** Data exchange uses snake_case JSON fields.

- Add to `src/lib/types.ts`:
  - `NetWorthChange { absolute_change_cents: number, percentage_change: number, direction: string }`
  - `NetWorthBreakdownCategory { name: string, cents: number, percentage: number, color: string }` (derived from breakdown_json on frontend)
- Add query keys to `src/lib/constants.ts`: `["net-worth-history", period]`, `["net-worth-change", period]`

### Task 5: TanStack Query Hooks for History
Wrap history commands in TanStack Query hooks.

**AC reference:** Period tabs change the query parameter.

- Add to `src/hooks/useNetWorth.ts`:
  - `useNetWorthHistory(period: string)` — query hook for `get_net_worth_history`, re-fetches when period changes
  - `useNetWorthChange(period: string)` — query hook for `get_net_worth_change`, re-fetches when period changes
- Both hooks key on `["net-worth-history", period]` and `["net-worth-change", period]` respectively
- Period is local UI state (React `useState`) — not a URL parameter (tabs don't change the URL, per UX-DR24)

### Task 6: Net Worth Trend Chart Component
Build the full-size trend chart using Recharts v3.

**AC reference:** "a large trend line chart (Recharts v3) shows net worth over time"

- Create `src/components/net-worth/NetWorthTrendChart.tsx`:
  - Props: `data: NetWorthSnapshot[]`, `isLoading?: boolean`
  - Recharts v3 `AreaChart` (or `LineChart`) with filled area below the line
  - X-axis: dates (formatted as "Mar 14" short format, UX-DR25)
  - Y-axis: dollar values (formatted with `formatCurrency()`, abbreviated for large values like "$450K")
  - Line color: teal (primary)
  - Fill: teal with low opacity gradient
  - Tooltip on hover: date + formatted net worth value
  - Responsive container — fills available width
  - Loading state: skeleton placeholder matching chart area
  - Uses Recharts v3 API: `import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'`
  - NOT Recharts v2 — v3 has different import patterns and API

### Task 7: NetWorthBreakdownBar Component
Build the stacked horizontal bar showing net worth composition by category.

**AC reference:** "NetWorthBreakdownBar (UX-DR9) shows current composition as stacked horizontal bar with proportional colored segments" + "legend grid below"

- Create `src/components/net-worth/NetWorthBreakdownBar.tsx`:
  - Props: `breakdown: NetWorthBreakdownCategory[]`, `isLoading?: boolean`
  - Stacked horizontal bar: single row of colored segments, width proportional to each category's percentage of total
  - Category colors (distinct per category):
    - Cash: Teal
    - TFSA: Sky blue
    - RRSP: Purple
    - Non-registered: Indigo
    - Crypto: Amber
    - Housing: Emerald
    - Business: Pink
    - Vehicles: Orange
    - Other: Slate
  - Hover on segment: tooltip with category name, dollar amount (`formatCurrency()`), and percentage
  - Legend grid below the bar:
    - CSS Grid layout (2-3 columns)
    - Each item: color dot + category name + dollar amount + percentage
    - Amounts in monospace, right-aligned
  - Each segment: `aria-label` with category name, amount, and percentage
  - Loading state: skeleton bar
  - Built with Tailwind (flexbox for the bar, grid for legend) — not Recharts (simpler for a single stacked bar)

### Task 8: Parse Breakdown JSON to Categories
Create a utility to transform `breakdown_json` into display-ready category data.

**AC reference:** "legend grid shows each category: name, color dot, dollar amount, percentage"

- Create `src/lib/parseNetWorthBreakdown.ts`:
  - Input: `breakdown_json` string from NetWorthSnapshot
  - Output: `NetWorthBreakdownCategory[]` with `name`, `cents`, `percentage`, `color`
  - Calculates percentage from each category's cents / total cents
  - Assigns colors based on category key (matching Task 7 color map)
  - Filters out categories with 0 value (don't show empty segments)
  - Sorts by value descending (largest segment first)

### Task 9: Period Tabs Component
Build the period filter tabs (6M | 1Y | ALL).

**AC reference:** "period tabs allow filtering: 6M, 1Y, ALL (UX-DR24)"

- In the Net Worth page (or as a small component):
  - Three tab buttons: "6M", "1Y", "ALL"
  - Active tab: teal/primary styling
  - Inactive tabs: ghost/muted styling
  - Clicking a tab updates local `period` state — triggers TanStack Query refetch
  - Tabs do NOT change the URL (UX-DR24)
  - Default selected: "1Y"
  - Built on shadcn Tabs component or simple button group

### Task 10: Net Worth Page Layout
Build the complete Net Worth page route.

**AC reference:** All — page composition.

- Update `src/routes/net-worth.tsx`:
  - Page header: "Net Worth" (H1) + current total in Display size (32px, monospace, semibold) (UX-DR23)
  - Trend indicator next to total: "↑ +$10,942 (+2.3%)" in emerald, or "↓" in rose (UX-DR25)
  - Period tabs (6M | 1Y | ALL) below header
  - Full-width card: NetWorthTrendChart
  - Below chart: NetWorthBreakdownBar with legend grid
  - Content max-width 1280px, centered
  - Cards: `p-6`, `shadow-sm`, `rounded-lg`
  - All data fetched via parallel TanStack Query hooks

### Task 11: Empty State
Handle the case when no snapshots exist.

**AC reference:** "empty state shows: No net worth history yet. Add accounts and assets to start tracking."

- In `src/routes/net-worth.tsx`:
  - If `useNetWorthHistory` returns empty array, show empty state
  - Centered card with message: "No net worth history yet. Add accounts and assets to start tracking."
  - Action buttons: "Add Account" (links to `/accounts`) + "Add Asset" (links to `/assets`)
  - Single-line message + action button pattern (UX-DR19)

### Task 12: Playwright E2E Tests
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Create/update `tests/net-worth.spec.ts`:
  - Test: Net Worth page displays with H1 title and current total (with seeded data)
  - Test: Trend chart element is rendered (Recharts SVG container present)
  - Test: Period tabs (6M, 1Y, ALL) are visible and clickable
  - Test: Clicking a different period tab updates the chart (data changes or re-renders)
  - Test: NetWorthBreakdownBar renders with colored segments
  - Test: Legend grid below bar shows category names, amounts, and percentages
  - Test: Hovering a bar segment shows a tooltip with category details
  - Test: With no snapshots, empty state message "No net worth history yet" is visible
  - Test: Empty state shows "Add Account" and "Add Asset" action buttons
- Verify: `npx playwright test tests/net-worth.spec.ts` passes

## Dev Notes

### Architecture Guidance

This story builds the dedicated Net Worth page at route `/net-worth`. It depends on Story 5.3 (snapshot recording) for data, and on Epic 4 (accounts/assets) for the underlying financial data. The NetWorthBreakdownBar and trend chart are the two main visual components.

**Database:**
- Queries filter `net_worth_snapshots` by date range using the `idx_net_worth_snapshots_date` index.
- `breakdown_json` is parsed on the frontend into display-ready categories. The Rust backend returns it as a raw string — the frontend handles the transformation.
- Period filtering uses SQLite date functions: `snapshot_date >= date('now', '-6 months')`.

**Rust Backend:**
- `db/net_worth.rs` handles history queries. `commands/net_worth.rs` exposes them.
- `get_net_worth_change` computes the trend by comparing first and last snapshots in the period.
- All commands return `Result<T, AppError>`.

**Frontend:**
- Recharts v3 for the trend chart. Key difference from v2: check import paths and API.
- NetWorthBreakdownBar is a custom Tailwind component (flexbox for stacked bar, grid for legend) — NOT a Recharts chart. A stacked horizontal bar is simpler to build with CSS than with a charting library.
- Period tabs use local React state (`useState`). When the period changes, TanStack Query automatically refetches because the period is part of the query key.
- `breakdown_json` parsing happens in a utility function (`parseNetWorthBreakdown.ts`) — keeps the component clean.

**Recharts v3 Notes:**
- Import: `import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'`
- Data format: array of objects with `snapshot_date` and `total_cents` fields
- Transform cents to dollars for chart display: `total_cents / 100`
- Custom tooltip formatter to show `formatCurrency()` values

**Net Worth Page Layout:**
- Route: `/net-worth` (`src/routes/net-worth.tsx`)
- Header: "Net Worth" H1 + current total (Display, 32px, monospace, semibold) + trend indicator
- Period tabs below header
- Trend chart in full-width card
- Breakdown bar + legend in card below chart
- Content max-width 1280px

**NetWorthBreakdownBar Colors (UX-DR9):**
- Cash: Teal (#0D9488)
- TFSA: Sky (#0EA5E9)
- RRSP: Purple (#9333EA)
- Non-registered: Indigo (#6366F1)
- Crypto: Amber (#F59E0B)
- Housing: Emerald (#059669)
- Business: Pink (#EC4899)
- Vehicles: Orange (#F97316)
- Other: Slate (#64748B)

**Trend Display (UX-DR25):**
- Up: emerald, "↑ +$10,942 (+2.3%)"
- Down: rose, "↓ -$5,231 (-1.1%)"
- Flat (< 0.1% change): muted, no arrow
- Both absolute and percentage shown

### Scope Boundaries

**In scope:**
- Net Worth page route (`/net-worth`)
- NetWorthTrendChart component (Recharts v3 area/line chart)
- NetWorthBreakdownBar component (stacked horizontal bar + legend grid)
- Period tabs (6M | 1Y | ALL)
- Breakdown JSON parsing utility
- Net worth history and change queries (Rust db + commands)
- TanStack Query hooks for history data
- Empty state handling
- Trend indicator (direction + absolute + percentage change)
- Playwright E2E tests

**Dependencies:**
- Story 5.3 (net_worth_snapshots table and recording logic)
- Epic 4 (accounts and assets data)
- Story 5.2 (useNetWorth hook may already exist — extend it)

**Out of scope:**
- Snapshot recording logic (Story 5.3)
- Dashboard display of net worth (Story 5.2)
- Editing accounts/assets from this page (Epic 4)
- Drill-down into specific categories (future enhancement)

### Project Structure Notes

**Files to create:**
- `src/components/net-worth/NetWorthTrendChart.tsx`
- `src/components/net-worth/NetWorthBreakdownBar.tsx`
- `src/lib/parseNetWorthBreakdown.ts`

**Files to modify:**
- `src-tauri/src/db/net_worth.rs` — add history and change queries
- `src-tauri/src/commands/net_worth.rs` — add history and change commands
- `src-tauri/src/models/mod.rs` — add NetWorthChange struct
- `src-tauri/src/main.rs` — register new commands
- `src/lib/types.ts` — add NetWorthChange, NetWorthBreakdownCategory types
- `src/lib/constants.ts` — add query keys
- `src/hooks/useNetWorth.ts` — add history and change hooks
- `src/routes/net-worth.tsx` — build complete net worth page
- `tests/net-worth.spec.ts` — add E2E tests

### References

- Epic 5 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md`
- Architecture — db/net_worth.rs, commands/net_worth.rs, net-worth route: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- UX — NetWorthBreakdownBar (UX-DR9), period tabs (UX-DR24), page header (UX-DR23), financial display (UX-DR25), empty states (UX-DR19): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md`
- NetWorthBreakdownBar component spec: UX spec — stacked bar with colored segments, legend grid, hover tooltips
- FR27: View net worth history over time as a trend
- FR28: View net worth breakdown by category

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No issues. Rust compiled clean. 6 Rust unit tests pass. 93 Playwright E2E tests pass (9 new net-worth + 84 existing).

### Completion Notes List
- Task 1: `get_net_worth_history` with period filtering (6m/1y/all) using SQLite date functions. `get_net_worth_change` computes absolute + percentage change.
- Task 2: Added `NetWorthChange` model.
- Task 3: Commands `get_net_worth_history` and `get_net_worth_change` registered.
- Task 4-5: TypeScript types, query keys, hooks. Period is part of query key for automatic refetch.
- Task 6: `NetWorthTrendChart` — Recharts v3 AreaChart with teal gradient fill, custom axis formatters, tooltip.
- Task 7: `NetWorthBreakdownBar` — custom Tailwind stacked bar with hover tooltips + legend grid (2-3 columns).
- Task 8: `parseNetWorthBreakdown` utility — transforms breakdown_json into display-ready categories with colors, percentages, sorted by value.
- Task 9: Period tabs (6M/1Y/ALL) as button group with local state.
- Task 10: Complete Net Worth page — header with current total + trend, period tabs, trend chart, breakdown bar.
- Task 11: Empty state with "Add Account" + "Add Asset" buttons.
- Task 12: 9 Playwright E2E tests covering all ACs.

### File List
- `src-tauri/src/db/net_worth.rs` (modified — added get_net_worth_history, get_net_worth_change)
- `src-tauri/src/commands/net_worth.rs` (modified — added history and change commands)
- `src-tauri/src/models/mod.rs` (modified — added NetWorthChange)
- `src-tauri/src/lib.rs` (modified — registered history and change commands)
- `src/lib/types.ts` (modified — added NetWorthSnapshot, NetWorthChange, NetWorthBreakdownCategory)
- `src/lib/constants.ts` (modified — added netWorthHistory, netWorthChange query keys)
- `src/lib/parseNetWorthBreakdown.ts` (new)
- `src/hooks/useNetWorth.ts` (modified — added useNetWorthHistory, useNetWorthChange)
- `src/components/net-worth/NetWorthTrendChart.tsx` (new)
- `src/components/net-worth/NetWorthBreakdownBar.tsx` (new)
- `src/routes/net-worth.tsx` (modified — complete net worth page)
- `tests/net-worth.spec.ts` (new — 9 E2E tests)

### Change Log
- 2026-03-15: Story 5.4 implemented — Net Worth history page with Recharts v3 trend chart, period filtering (6M/1Y/ALL), breakdown bar with colored segments and legend, trend indicators, empty state.
