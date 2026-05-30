# Story 5.1: Build Dashboard with Budget Status and Account Balances

Status: review

## Story

As a user,
I want to see my budget status and account balances on the dashboard when I open the app,
So that I get a complete financial snapshot at a glance.

## Acceptance Criteria

**Given** the user opens the app or navigates to Dashboard
**When** the dashboard loads
**Then** the dashboard is the landing page (default route `/`)
**And** a hero card shows "Budget Remaining" with the total remaining budget for the current month (DashboardMetricCard hero variant, UX-DR3)
**And** budget categories are displayed below with progress bars (BudgetCategoryRow, UX-DR4) showing top categories by spending
**And** the page header shows "Dashboard" with an "Import Statement" action button (UX-DR23)
**And** all data loads via parallel TanStack Query calls within 1 second (NFR1)
**And** cards show skeleton loading states while data fetches (UX-DR16)

**Given** no budget or expenses exist
**When** the dashboard loads
**Then** empty state cards display with action prompts (UX-DR19): "No budget yet. Create your first budget." with a link to Budget page

## Tasks / Subtasks

### [x] Task 1: Dashboard Aggregation Queries — Rust DB Layer
Create the `db/dashboard.rs` module with aggregation queries for budget summary data.

**AC reference:** "hero card shows Budget Remaining" + "budget categories with progress bars showing top categories"

- Create `src-tauri/src/db/dashboard.rs`:
  - `get_budget_summary(conn: &Connection, year: i32, month: i32) -> Result<BudgetSummary, AppError>` — returns total target cents, total spent cents, remaining cents for the current month
  - `get_top_budget_categories(conn: &Connection, year: i32, month: i32, limit: usize) -> Result<Vec<BudgetCategoryStatus>, AppError>` — returns top categories by spending with name, target_cents, spent_cents, percentage
  - Queries join `budget_categories` with `expenses` table, aggregating by category for the given month
  - All monetary calculations use integer arithmetic (NFR13)
- Register module in `src-tauri/src/db/mod.rs`

### [x] Task 2: Rust Models for Dashboard Data
Define structs for dashboard response types.

**AC reference:** All — these are the data contracts for dashboard display.

- Add to `src-tauri/src/models/mod.rs`:
  - `BudgetSummary { total_target_cents: i64, total_spent_cents: i64, remaining_cents: i64, month: String }`
  - `BudgetCategoryStatus { id: i64, name: String, group_name: String, target_cents: i64, spent_cents: i64, percentage: f64 }`
- All structs derive `Serialize`, `Deserialize`, `Debug`, `Clone`

### [x] Task 3: Tauri Commands for Dashboard
Expose dashboard data as Tauri commands.

**AC reference:** "all data loads via parallel TanStack Query calls"

- Create/update `src-tauri/src/commands/dashboard.rs`:
  - `#[tauri::command] fn get_budget_summary(state, year: i32, month: i32) -> Result<BudgetSummary, AppError>`
  - `#[tauri::command] fn get_top_budget_categories(state, year: i32, month: i32) -> Result<Vec<BudgetCategoryStatus>, AppError>`
- Register commands in `src-tauri/src/main.rs`
- Commands call db functions — no SQL in command handlers

### [x] Task 4: TypeScript Types and Query Keys
Define frontend types and constants for dashboard data.

**AC reference:** Data exchange uses snake_case JSON fields.

- Add to `src/lib/types.ts`:
  - `BudgetSummary { total_target_cents: number, total_spent_cents: number, remaining_cents: number, month: string }`
  - `BudgetCategoryStatus { id: number, name: string, group_name: string, target_cents: number, spent_cents: number, percentage: number }`
- Add query keys to `src/lib/constants.ts`: `["dashboard"]`, `["budget-summary", year, month]`, `["top-budget-categories", year, month]`

### [x] Task 5: TanStack Query Hooks for Dashboard
Wrap dashboard Tauri commands in TanStack Query hooks with parallel fetching.

**AC reference:** "all data loads via parallel TanStack Query calls within 1 second"

- Create `src/hooks/useDashboard.ts`:
  - `useBudgetSummary(year, month)` — query hook for `get_budget_summary`
  - `useTopBudgetCategories(year, month)` — query hook for `get_top_budget_categories`
- Hooks use the shared `invoke` helper from `src/hooks/useInvoke.ts`
- Both queries fire in parallel (separate `useQuery` calls, not sequential)

### [x] Task 6: DashboardMetricCard Component
Build the reusable metric card component with hero and secondary variants.

**AC reference:** "DashboardMetricCard hero variant, UX-DR3" + "cards show skeleton loading states"

- Create `src/components/dashboard/DashboardMetricCard.tsx`:
  - Props: `title: string`, `value: string`, `trend?: { direction: 'up' | 'down' | 'flat', percentage: string, description?: string }`, `variant: 'hero' | 'secondary'`, `href?: string`, `sparkline?: ReactNode`, `progressBar?: ReactNode`, `isLoading?: boolean`
  - Hero variant: `p-8` padding, 40px monospace semibold value
  - Secondary variant: `p-8` padding, 24px monospace value
  - Card title: muted foreground, 14px
  - Trend indicator: emerald `↑` for up, rose `↓` for down, muted for flat
  - Clickable with `role="link"` — navigates to `href` via TanStack Router
  - Hover state: subtle elevation change
  - Loading state: skeleton placeholder (pulsing gray blocks matching content shape)
  - Built on shadcn Card primitive with `shadow-sm`, `rounded-lg`
  - Descriptive `aria-label` (e.g., "Budget Remaining: $1,234, on track")

### [x] Task 7: BudgetCategoryRow Component (Dashboard Variant)
Build the budget category row for dashboard display.

**AC reference:** "budget categories displayed with progress bars (BudgetCategoryRow, UX-DR4) showing top categories"

- Create `src/components/dashboard/BudgetCategoryRow.tsx`:
  - Props: `name: string`, `targetCents: number`, `spentCents: number`
  - Category label (14px, font-weight 500)
  - Progress bar (8-10px height): teal (<75%), amber (75-100%), rose (>100%)
  - Amount text: monospace `"$523.45 / $700.00"` format using `formatCurrency()`
  - Status badge (shadcn Badge): "On track" (positive), "Warning" (warning), "Over" (destructive)
  - Progress bar: `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax`
  - Built on shadcn Progress or custom div with Tailwind

### [x] Task 8: Dashboard Page Layout — Route and Grid
Build the dashboard route as the landing page with grid layout.

**AC reference:** "dashboard is the landing page" + "page header shows Dashboard with Import Statement button"

- Update `src/routes/index.tsx` (dashboard is the index route):
  - Page header: "Dashboard" (H1) with "Import Statement" primary action button (teal, links to `/import`) (UX-DR23)
  - Content max-width 1280px, centered
  - Hero section: single hero card for "Budget Remaining" using DashboardMetricCard (hero variant)
  - Full-width section below: top budget categories using BudgetCategoryRow components
  - Budget Remaining hero card: displays `remaining_cents` formatted via `formatCurrency()`
  - Budget Remaining card: includes a progress bar showing overall budget utilization
  - Clicking Budget Remaining hero card navigates to Budget page

### [x] Task 9: Empty State Handling
Handle first-time and post-onboarding empty states.

**AC reference:** "empty state cards display with action prompts: No budget yet. Create your first budget."

- In `src/routes/index.tsx`:
  - Check if budget data exists (TanStack Query returns empty/zero values)
  - First-time (no onboarding completed): redirect to onboarding flow (or show onboarding CTA if onboarding not yet implemented — defer to Epic 8)
  - Post-onboarding with no expenses: show "No expenses yet. Import your first CC statement." with Import button (UX-DR19)
  - Post-onboarding with no budget: show "No budget yet. Create your first budget." with link to Budget page
  - Empty state: single-line message + action button inside a card, never blank white space

### [x] Task 10: Skeleton Loading States
Implement skeleton placeholders for all dashboard cards.

**AC reference:** "cards show skeleton loading states while data fetches (UX-DR16)"

- Each DashboardMetricCard renders a skeleton when `isLoading` is true
- Skeleton matches the card layout: gray pulsing blocks for title, value, and trend areas
- No full-page loading spinner — sidebar and page structure render immediately
- Each card/section manages its own loading state independently via TanStack Query `isPending`

### [x] Task 11: Playwright E2E Tests
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Add to `tests/dashboard.spec.ts`:
  - Test: Dashboard is the landing page when the app opens (route is `/`)
  - Test: "Budget Remaining" hero card is visible with a formatted dollar amount (with seeded data)
  - Test: Budget category rows with progress bars are displayed
  - Test: "Import Statement" button is visible in the page header
  - Test: Skeleton loading states appear briefly before data renders
  - Test: With empty database, empty state message and action link are visible
- Verify: `npx playwright test tests/dashboard.spec.ts` passes

## Dev Notes

### Architecture Guidance

This story establishes the dashboard as the app's landing page and home base. It implements the first half of the dashboard — budget status and the page structure. Story 5.2 adds net worth, secondary cards, and spending breakdown to complete the dashboard.

**Database:**
- `db/dashboard.rs` contains aggregation queries that join budget_categories with expenses. This is a read-only query module — no writes.
- Budget summary query: `SELECT SUM(target_cents) as total_target, COALESCE(SUM(spent), 0) as total_spent FROM budget_categories LEFT JOIN (SELECT budget_category_id, SUM(amount_cents) as spent FROM expenses WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? GROUP BY budget_category_id) ...`
- All monetary calculations stay in integer cents. The `percentage` field is the one exception — a float for display convenience.

**Rust Backend:**
- Commands in `src-tauri/src/commands/dashboard.rs` (or add to an existing dashboard command file if one exists).
- Queries in `src-tauri/src/db/dashboard.rs`.
- Commands call db functions. No SQL in commands.
- All commands return `Result<T, AppError>`. Use `?` operator, never `unwrap()`.

**Frontend:**
- TanStack Query fires multiple queries in parallel on dashboard load. Each hook is a separate `useQuery` call — TanStack Query parallelizes automatically.
- `formatCurrency(cents: number): string` from `src/lib/formatCurrency.ts` converts cents to `$X,XXX.XX`.
- JSON fields are `snake_case` — TypeScript types match Rust serde output directly.
- Dashboard route is `src/routes/index.tsx` — the default route (`/`).

**Performance (NFR1):**
- Dashboard must load and render all data within 1 second on subsequent visits.
- Parallel TanStack Query requests (not sequential).
- SQLite queries should be efficient — use indexes on `expenses.budget_category_id` and `expenses.date`.

**Dashboard Layout (UX-DR2):**
- Content max-width 1280px, centered
- Cards: white background, subtle border, `shadow-sm`, `rounded-lg`
- Hero cards: `p-8` padding, 40px monospace semibold values
- Hero numbers: Display size (32px), monospace (JetBrains Mono), semibold

### Scope Boundaries

**In scope:**
- Dashboard aggregation queries (Rust db + commands)
- DashboardMetricCard component (hero + secondary variants, skeleton loading)
- BudgetCategoryRow component for dashboard
- Dashboard route as landing page with Budget Remaining hero card
- Top budget categories with progress bars
- Empty state handling (no budget / no expenses)
- Skeleton loading states
- "Import Statement" button in page header
- Playwright E2E tests

**Out of scope (handled by Story 5.2):**
- Net Worth hero card
- Secondary cards (Cash, Investments, Assets)
- Spending breakdown by category section
- Sparkline on Net Worth card
- Clickable Net Worth card navigation

**Out of scope (other stories):**
- Net worth snapshot recording (Story 5.3)
- Net worth history page (Story 5.4)
- Actual import flow (Epic 6)
- Onboarding wizard (Epic 8) — use simple empty state CTA for now

### Project Structure Notes

**Files to create:**
- `src-tauri/src/db/dashboard.rs`
- `src-tauri/src/commands/dashboard.rs` (if not already existing)
- `src/components/dashboard/DashboardMetricCard.tsx`
- `src/components/dashboard/BudgetCategoryRow.tsx`
- `src/hooks/useDashboard.ts`

**Files to modify:**
- `src-tauri/src/models/mod.rs` — add BudgetSummary, BudgetCategoryStatus structs
- `src-tauri/src/db/mod.rs` — register dashboard module
- `src-tauri/src/commands/mod.rs` — register dashboard module
- `src-tauri/src/main.rs` — register dashboard Tauri commands
- `src/lib/types.ts` — add TypeScript types
- `src/lib/constants.ts` — add query keys
- `src/routes/index.tsx` — build dashboard page
- `tests/dashboard.spec.ts` — add E2E tests

### References

- Epic 5 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md`
- Architecture — dashboard data flow, parallel queries, db/dashboard.rs: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- UX — DashboardMetricCard (UX-DR3), BudgetCategoryRow (UX-DR4), page header (UX-DR23), skeleton loading (UX-DR16), empty states (UX-DR19), dashboard layout (UX-DR2), financial display (UX-DR25): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md`
- Dashboard Glance journey: UX spec Journey 3
- Dashboard Load Flow: Architecture doc — Data Flow section

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No issues encountered. Rust compiled clean. All 78 Playwright tests pass (8 new dashboard + 70 existing).

### Completion Notes List
- Task 1-3: Rust backend — `db/dashboard.rs` with `get_budget_summary` and `get_top_budget_categories` aggregation queries joining budget_categories with expenses. Commands registered in `lib.rs`.
- Task 2: Added `BudgetSummary` and `DashboardBudgetCategory` models. Named `DashboardBudgetCategory` to avoid collision with existing `BudgetCategoryStatus`.
- Task 4-5: TypeScript types mirror Rust structs. TanStack Query hooks fire in parallel via separate `useQuery` calls.
- Task 6: `DashboardMetricCard` with hero/secondary variants, skeleton loading, clickable navigation, trend indicator, progress bar slot.
- Task 7: `DashboardBudgetCategoryRow` — simplified dashboard variant without expand/collapse. Matches existing badge pattern (className, not variant).
- Task 8-10: Dashboard route as landing page with Budget Remaining hero card, top categories, empty states, skeleton loading. Import Statement button in header.
- Task 11: 8 Playwright E2E tests covering all ACs including skeleton states via delayed mock.

### File List
- `src-tauri/src/db/dashboard.rs` (new)
- `src-tauri/src/commands/dashboard.rs` (new)
- `src-tauri/src/db/mod.rs` (modified — registered dashboard module)
- `src-tauri/src/commands/mod.rs` (modified — registered dashboard module)
- `src-tauri/src/models/mod.rs` (modified — added BudgetSummary, DashboardBudgetCategory)
- `src-tauri/src/lib.rs` (modified — registered dashboard commands)
- `src/lib/types.ts` (modified — added BudgetSummary, DashboardBudgetCategory)
- `src/lib/constants.ts` (modified — added budgetSummary, topBudgetCategories query keys)
- `src/hooks/useDashboard.ts` (new)
- `src/components/dashboard/DashboardMetricCard.tsx` (new)
- `src/components/dashboard/BudgetCategoryRow.tsx` (new)
- `src/routes/index.tsx` (modified — full dashboard implementation)
- `tests/dashboard.spec.ts` (new — 8 E2E tests)

### Change Log
- 2026-03-15: Story 5.1 implemented — Dashboard with budget status hero card, top budget categories, empty states, skeleton loading, and Playwright E2E tests.
