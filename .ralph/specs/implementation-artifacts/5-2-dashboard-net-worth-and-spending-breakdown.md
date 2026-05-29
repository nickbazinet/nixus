# Story 5.2: Dashboard Net Worth and Spending Breakdown

Status: review

## Story

As a user,
I want to see my total net worth and spending breakdown by category on the dashboard,
So that I understand my complete financial position and where money is going.

## Acceptance Criteria

**Given** the user has accounts, assets, and expenses
**When** the dashboard loads
**Then** a hero card shows "Net Worth" as the sum of all account balances + all passive asset values (DashboardMetricCard hero variant, UX-DR3, FR23)
**And** the net worth card includes a sparkline trend showing recent history (Recharts v3)
**And** 3 secondary cards show Cash (sum of chequing/savings), Investments (TFSA/RRSP/non-registered/crypto), and Assets (passive assets) totals (DashboardMetricCard secondary variant, UX-DR2)
**And** a spending breakdown section shows expenses by category for the current month (FR24)
**And** all account balances are visible on the dashboard (FR25)
**And** the dashboard grid uses 2-column hero + 3-column secondary layout (UX-DR2)
**And** clicking hero cards navigates to their detail pages (Net Worth, Budget)

## Tasks / Subtasks

### [x] Task 1: Net Worth Aggregation Queries — Rust DB Layer
Add net worth aggregation queries to support the dashboard display.

**AC reference:** "Net Worth as the sum of all account balances + all passive asset values" + "3 secondary cards show Cash, Investments, Assets"

- Create/update `src-tauri/src/db/net_worth.rs`:
  - `get_current_net_worth(conn: &Connection) -> Result<NetWorthCurrent, AppError>` — returns total net worth, cash total, investments total, assets total
  - Cash = sum of accounts where `account_type` is chequing/savings
  - Investments = sum of accounts where `account_type` is TFSA/RRSP/non-registered/crypto
  - Assets = sum of all passive asset `estimated_value_cents`
  - Total = cash + investments + assets
  - `get_recent_net_worth_snapshots(conn: &Connection, limit: i32) -> Result<Vec<NetWorthSnapshot>, AppError>` — returns recent snapshots for sparkline (last 6-12 data points)
- Register module in `src-tauri/src/db/mod.rs` if not already registered

### [x] Task 2: Spending Breakdown Query
Add a spending breakdown aggregation query.

**AC reference:** "spending breakdown section shows expenses by category for the current month (FR24)"

- Add to `src-tauri/src/db/dashboard.rs`:
  - `get_spending_breakdown(conn: &Connection, year: i32, month: i32) -> Result<Vec<SpendingByCategory>, AppError>` — returns each budget category with total spent cents for the month, sorted by amount descending
- Joins `expenses` with `budget_categories` grouped by category

### [x] Task 3: Rust Models for Net Worth and Spending
Define structs for net worth and spending breakdown data.

**AC reference:** All — these are the data contracts.

- Add to `src-tauri/src/models/mod.rs`:
  - `NetWorthCurrent { total_cents: i64, cash_cents: i64, investments_cents: i64, assets_cents: i64 }`
  - `NetWorthSnapshotSummary { total_cents: i64, snapshot_date: String }` (lightweight version for sparkline)
  - `SpendingByCategory { category_id: i64, category_name: String, spent_cents: i64 }`
- All structs derive `Serialize`, `Deserialize`, `Debug`, `Clone`

### [x] Task 4: Tauri Commands for Net Worth and Spending
Expose net worth and spending data as Tauri commands.

**AC reference:** "all data loads via parallel TanStack Query calls"

- Create/update `src-tauri/src/commands/net_worth.rs`:
  - `#[tauri::command] fn get_current_net_worth(state) -> Result<NetWorthCurrent, AppError>`
  - `#[tauri::command] fn get_recent_net_worth_snapshots(state, limit: i32) -> Result<Vec<NetWorthSnapshotSummary>, AppError>`
- Add to `src-tauri/src/commands/dashboard.rs`:
  - `#[tauri::command] fn get_spending_breakdown(state, year: i32, month: i32) -> Result<Vec<SpendingByCategory>, AppError>`
- Register all commands in `src-tauri/src/main.rs`

### [x] Task 5: TypeScript Types and Query Keys
Define frontend types for net worth and spending data.

**AC reference:** Data exchange uses snake_case JSON fields.

- Add to `src/lib/types.ts`:
  - `NetWorthCurrent { total_cents: number, cash_cents: number, investments_cents: number, assets_cents: number }`
  - `NetWorthSnapshotSummary { total_cents: number, snapshot_date: string }`
  - `SpendingByCategory { category_id: number, category_name: string, spent_cents: number }`
- Add query keys to `src/lib/constants.ts`: `["net-worth-current"]`, `["net-worth-snapshots-recent"]`, `["spending-breakdown", year, month]`

### [x] Task 6: TanStack Query Hooks
Wrap net worth and spending Tauri commands in TanStack Query hooks.

**AC reference:** "all data loads via parallel TanStack Query calls within 1 second"

- Create/update `src/hooks/useNetWorth.ts`:
  - `useCurrentNetWorth()` — query hook for `get_current_net_worth`
  - `useRecentNetWorthSnapshots(limit)` — query hook for `get_recent_net_worth_snapshots`
- Add to `src/hooks/useDashboard.ts`:
  - `useSpendingBreakdown(year, month)` — query hook for `get_spending_breakdown`
- All hooks fire in parallel on dashboard load

### [x] Task 7: Net Worth Sparkline Component
Build a small sparkline chart for the net worth hero card using Recharts v3.

**AC reference:** "net worth card includes a sparkline trend showing recent history (Recharts)"

- Create `src/components/dashboard/NetWorthSparkline.tsx`:
  - Small line chart (Recharts v3 `LineChart` or `AreaChart`) embedded inside the DashboardMetricCard
  - Shows last 6-12 data points from recent snapshots
  - No axes, no labels — just the trend line (sparkline style)
  - Line color: teal (primary) if trending up, rose if trending down
  - Compact size — fits within hero card below the value
  - Uses Recharts v3 API (NOT v2) — `import { LineChart, Line } from 'recharts'`

### [x] Task 8: Dashboard Grid Layout — Complete Layout
Extend the dashboard route with the full 2-column hero + 3-column secondary grid.

**AC reference:** "dashboard grid uses 2-column hero + 3-column secondary layout (UX-DR2)" + "clicking hero cards navigates to their detail pages"

- Update `src/routes/index.tsx`:
  - Hero section: CSS Grid 2-column layout
    - Left: "Net Worth" DashboardMetricCard (hero variant) — displays `total_cents` with sparkline, links to `/net-worth`
    - Right: "Budget Remaining" DashboardMetricCard (hero variant, from Story 5.1) — links to `/budget`
  - Secondary section: CSS Grid 3-column layout
    - "Cash" DashboardMetricCard (secondary variant) — displays `cash_cents`
    - "Investments" DashboardMetricCard (secondary variant) — displays `investments_cents`
    - "Assets" DashboardMetricCard (secondary variant) — displays `assets_cents`
  - Each secondary card shows a trend indicator (↑ emerald / ↓ rose / muted flat) if snapshot data available
  - Hero cards: `p-8`, 40px monospace values, clickable (`role="link"`)
  - Secondary cards: `p-8`, 24px monospace values
  - All cards: white background, subtle border, `shadow-sm`, `rounded-lg`
  - Grid responsive: 2-column hero at all sizes, 3-column secondary stacks to 2/1 at narrower window widths using `auto-fit`/`minmax()`

### [x] Task 9: Spending Breakdown Section
Add the spending breakdown section to the dashboard.

**AC reference:** "spending breakdown section shows expenses by category for the current month (FR24)"

- Add to `src/routes/index.tsx` (below secondary cards):
  - Full-width card: "Top Categories" or "Spending Breakdown"
  - List of categories with spent amounts, sorted by amount descending
  - Each row: category name + spent amount (monospace, right-aligned) + optional badge
  - Uses `formatCurrency()` for amounts
  - Reuse BudgetCategoryRow from Story 5.1 or create a simpler spending row component
  - Empty state: "No expenses this month" if no spending data

### [x] Task 10: Net Worth Trend Indicator on Hero Card
Add trend direction and percentage change to the Net Worth hero card.

**AC reference:** "Net Worth hero card" with trend context per UX-DR3 + UX-DR25

- Calculate trend from recent snapshots: compare current total to previous snapshot
- Trend direction: up (emerald ↑), down (rose ↓), flat (muted)
- Display: `"↑ +$10,942 (+2.3%)"` format where space allows (UX-DR25)
- Pass trend data to DashboardMetricCard's `trend` prop
- If no previous snapshot exists, omit trend indicator

### [x] Task 11: Playwright E2E Tests
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Append to `tests/dashboard.spec.ts`:
  - Test: "Net Worth" hero card displays with a formatted dollar amount (with seeded accounts/assets)
  - Test: 3 secondary cards (Cash, Investments, Assets) are visible with values
  - Test: Spending breakdown section shows expense categories
  - Test: Dashboard uses 2-column hero + 3-column secondary grid layout (verify grid CSS or card positions)
  - Test: Clicking the Net Worth hero card navigates to the Net Worth page (`/net-worth`)
  - Test: Clicking the Budget Remaining hero card navigates to the Budget page (`/budget`)
- Verify: `npx playwright test tests/dashboard.spec.ts` passes

## Dev Notes

### Architecture Guidance

This story completes the dashboard by adding net worth display, secondary breakdown cards, and the spending breakdown. It depends on Story 5.1 being complete (DashboardMetricCard, BudgetCategoryRow, dashboard route structure). It also depends on Epic 4 (accounts and assets) being implemented so there is data to aggregate.

**Database:**
- Net worth = SUM(accounts.balance_cents) + SUM(passive_assets.estimated_value_cents)
- Cash = accounts where type IN ('chequing', 'savings')
- Investments = accounts where type IN ('tfsa', 'rrsp', 'non_registered', 'crypto')
- Assets = passive_assets (all types)
- The exact account type values depend on how Epic 4 defined them — check `accounts.account_type` column values.
- Spending breakdown: `SELECT bc.name, SUM(e.amount_cents) FROM expenses e JOIN budget_categories bc ON e.budget_category_id = bc.id WHERE ... GROUP BY bc.id ORDER BY SUM(e.amount_cents) DESC`

**Rust Backend:**
- `db/net_worth.rs` handles net worth queries. `db/dashboard.rs` handles spending breakdown.
- `commands/net_worth.rs` for net worth commands.
- All commands return `Result<T, AppError>`.

**Frontend:**
- Dashboard fires 5+ parallel TanStack Query requests on load: budget summary, top categories, net worth current, recent snapshots, spending breakdown. All fire simultaneously.
- Recharts v3 for sparkline. Import from `'recharts'`. Use `LineChart` + `Line` or `AreaChart` + `Area`.
- DashboardMetricCard component (from Story 5.1) used for all cards — hero and secondary variants.

**Dashboard Layout (UX-DR2):**
- 2-column hero: Net Worth (left) + Budget Remaining (right)
- 3-column secondary: Cash, Investments, Assets
- Full-width: Top budget categories (from 5.1) + Spending breakdown
- Content max-width 1280px
- Cards: `p-8` for both hero and secondary, `shadow-sm`, `rounded-lg`
- Hero values: 40px monospace semibold
- Secondary values: 24px monospace

**Trend Indicators (UX-DR25):**
- Up: emerald color, `↑` prefix
- Down: rose color, `↓` prefix
- Flat: muted foreground, no arrow
- Format: `"↑ +$10,942 (+2.3%)"` — both absolute and percentage where space allows

### Scope Boundaries

**In scope:**
- Net Worth hero card with sparkline and trend
- 3 secondary cards (Cash, Investments, Assets)
- Spending breakdown section
- Complete 2-column hero + 3-column secondary grid layout
- Clickable hero cards navigating to detail pages
- Net worth aggregation queries (Rust db + commands)
- Spending breakdown query
- TanStack Query hooks for net worth and spending
- Recharts v3 sparkline component
- Playwright E2E tests

**Dependencies:**
- Story 5.1 (DashboardMetricCard, BudgetCategoryRow, dashboard route)
- Epic 4 (accounts and assets data — `accounts` and `passive_assets` tables must exist)

**Out of scope (handled by other stories):**
- Net worth snapshot recording (Story 5.3)
- Net worth history page with full chart (Story 5.4)
- Account balances list on dashboard (can be a simple list within secondary cards or defer to accounts page)
- AI-related features (Epics 6, 7)

### Project Structure Notes

**Files to create:**
- `src-tauri/src/db/net_worth.rs` (if not already existing)
- `src-tauri/src/commands/net_worth.rs` (if not already existing)
- `src/components/dashboard/NetWorthSparkline.tsx`
- `src/hooks/useNetWorth.ts`

**Files to modify:**
- `src-tauri/src/models/mod.rs` — add NetWorthCurrent, NetWorthSnapshotSummary, SpendingByCategory structs
- `src-tauri/src/db/mod.rs` — register net_worth module
- `src-tauri/src/db/dashboard.rs` — add spending breakdown query
- `src-tauri/src/commands/mod.rs` — register net_worth module
- `src-tauri/src/commands/dashboard.rs` — add spending breakdown command
- `src-tauri/src/main.rs` — register new Tauri commands
- `src/lib/types.ts` — add TypeScript types
- `src/lib/constants.ts` — add query keys
- `src/hooks/useDashboard.ts` — add spending breakdown hook
- `src/routes/index.tsx` — complete dashboard layout with hero grid, secondary cards, spending breakdown
- `tests/dashboard.spec.ts` — append E2E tests

### References

- Epic 5 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md`
- Architecture — dashboard load flow (parallel queries), db/dashboard.rs, db/net_worth.rs, commands/net_worth.rs: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- UX — DashboardMetricCard (UX-DR3), dashboard layout (UX-DR2), financial display (UX-DR25), page header (UX-DR23): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md`
- Dashboard Glance journey: UX spec Journey 3
- DashboardMetricCard component spec: UX spec — hero (p-8, 40px) and secondary (p-8, 24px) variants

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No issues. Rust compiled clean. All 84 Playwright tests pass (14 dashboard + 70 existing).

### Completion Notes List
- Task 1: `db/net_worth.rs` — `get_current_net_worth` aggregates cash (chequing/savings), investments (TFSA/RRSP/FHSA/non_registered/crypto), and assets (passive_assets). `get_recent_net_worth_snapshots` gracefully handles missing table (Story 5.3 creates it).
- Task 2: Added `get_spending_breakdown` to `db/dashboard.rs` — joins expenses with budget_categories grouped by category.
- Task 3: Added `NetWorthCurrent`, `NetWorthSnapshotSummary`, `SpendingByCategory` models.
- Task 4: Commands in `commands/net_worth.rs` and `commands/dashboard.rs`.
- Task 5-6: TypeScript types, query keys, hooks. `useNetWorth.ts` for net worth, `useSpendingBreakdown` in `useDashboard.ts`.
- Task 7: `NetWorthSparkline` using Recharts v3 `LineChart` — teal if up, rose if down.
- Task 8: Dashboard grid: 2-column hero (Net Worth + Budget Remaining), 3-column secondary (Cash, Investments, Assets).
- Task 9: Spending breakdown section with category rows.
- Task 10: Net worth trend from snapshots with absolute + percentage change.
- Task 11: 6 new E2E tests covering all ACs.

### File List
- `src-tauri/src/db/net_worth.rs` (new)
- `src-tauri/src/commands/net_worth.rs` (new)
- `src-tauri/src/db/dashboard.rs` (modified — added spending breakdown query)
- `src-tauri/src/commands/dashboard.rs` (modified — added spending breakdown command)
- `src-tauri/src/db/mod.rs` (modified — registered net_worth module)
- `src-tauri/src/commands/mod.rs` (modified — registered net_worth module)
- `src-tauri/src/models/mod.rs` (modified — added NetWorthCurrent, NetWorthSnapshotSummary, SpendingByCategory)
- `src-tauri/src/lib.rs` (modified — registered net_worth and spending_breakdown commands)
- `src/lib/types.ts` (modified — added NetWorthCurrent, NetWorthSnapshotSummary, SpendingByCategory)
- `src/lib/constants.ts` (modified — added netWorthCurrent, netWorthSnapshotsRecent, spendingBreakdown keys)
- `src/hooks/useNetWorth.ts` (new)
- `src/hooks/useDashboard.ts` (modified — added useSpendingBreakdown)
- `src/components/dashboard/NetWorthSparkline.tsx` (new)
- `src/routes/index.tsx` (modified — complete dashboard with hero grid, secondary cards, spending breakdown)
- `tests/dashboard.spec.ts` (modified — added 6 Story 5.2 tests)

### Change Log
- 2026-03-15: Story 5.2 implemented — Net Worth hero card with sparkline, secondary cards (Cash/Investments/Assets), spending breakdown, 2-col hero + 3-col secondary grid layout, clickable navigation.
