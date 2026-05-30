# Story 2.3: View Budget Status with Progress Bars

Status: review

## Story

As a user,
I want to see how much I've spent vs. my target for each budget category in the current month,
So that I can track my spending against my plan.

## Acceptance Criteria

**Given** the user has a budget with categories and targets
**When** the user views the Budget page for the current month
**Then** each category displays using the BudgetCategoryRow component (UX-DR4)
**And** a progress bar (8-10px height) shows spent vs. target, colored by status: teal (<75%), amber (75-100%), rose (>100%)
**And** "spent / target" amounts are displayed in monospace (e.g., "$523.45 / $700.00")
**And** a status badge shows the category state (on track, warning, over budget)
**And** the page header shows "Budget" with the current month (UX-DR23)

**Given** no expenses exist yet for the current month
**When** the user views the Budget page
**Then** all progress bars show 0% with teal color
**And** spent amounts show "$0.00"

## Tasks / Subtasks

### Task 1: Rust DB Query — Budget Status with Spent Amounts [x]
Create a query that returns categories with their spent totals for a given month.

**AC reference:** "spent vs. target for each category" + "spent amounts update to reflect the selected month"

- Add to `src-tauri/src/db/budget.rs`:
  - `get_budget_status(conn, year: i32, month: i32) -> Result<Vec<BudgetCategoryStatus>, AppError>`
  - SQL joins `budget_categories` with `expenses` table, aggregating `SUM(amount_cents)` for the given month
  - Returns each category with: `id`, `group_id`, `name`, `target_cents`, `spent_cents` (0 if no expenses)
  - Uses LEFT JOIN so categories with no expenses still appear with `spent_cents = 0`
  - Filters expenses by `date` column: `strftime('%Y', date) = ? AND strftime('%m', date) = ?`
- Note: This query depends on the `expenses` table existing (Epic 3, Story 3.1 creates it). If expenses table doesn't exist yet, the query should handle that gracefully or this story should be sequenced after Story 3.1's migration. If the expenses migration is included in Story 2.3 as a stub (empty table), document that clearly.

### Task 2: Rust Model — BudgetCategoryStatus [x]
Define the response model for budget status.

**AC reference:** Combines category data with computed spent amount.

- Add to `src-tauri/src/models/mod.rs`:
  - `BudgetCategoryStatus { id: i64, group_id: i64, name: String, target_cents: i64, spent_cents: i64 }`
  - Derives `Serialize`, `Deserialize`, `Debug`, `Clone`

### Task 3: Tauri Command — Get Budget Status [x]
Expose the budget status query as a Tauri command.

**AC reference:** Frontend needs budget status data for the current month.

- Add to `src-tauri/src/commands/budget.rs`:
  - `#[tauri::command] fn get_budget_status(state, year: i32, month: i32) -> Result<Vec<BudgetCategoryStatus>, AppError>`
- Register in `src-tauri/src/main.rs`

### Task 4: TypeScript Types and Query Hook [x]
Add frontend types and data fetching hook.

**AC reference:** Frontend displays status data via TanStack Query.

- Add to `src/lib/types.ts`:
  - `BudgetCategoryStatus { id: number, group_id: number, name: string, target_cents: number, spent_cents: number }`
- Add to `src/lib/constants.ts`: query key `["budget-status", year, month]`
- Add to `src/hooks/useBudget.ts`:
  - `useBudgetStatus(year: number, month: number)` — query hook calling `get_budget_status`

### Task 5: BudgetCategoryRow Component [x]
Build the component that displays a single category with progress bar and status.

**AC reference:** "BudgetCategoryRow component (UX-DR4)" + "progress bar (8-10px height)" + "spent / target" + "status badge"

- Create `src/components/budget/BudgetCategoryRow.tsx`:
  - Props: `category: BudgetCategoryStatus`
  - **Category label:** name (14px, font-weight 500)
  - **Progress bar:** 8-10px height, width = `Math.min(spent / target * 100, 100)`%
    - Color logic: `spent/target < 0.75` -> teal (`bg-teal-600`), `0.75-1.0` -> amber (`bg-amber-500`), `> 1.0` -> rose (`bg-rose-500`)
    - Background track: `bg-slate-100` (muted)
    - Accessibility: `role="progressbar"`, `aria-valuenow={spent}`, `aria-valuemin={0}`, `aria-valuemax={target}`
  - **Amount text:** monospace, `"$523.45 / $700.00"` format using `formatCurrency(spent_cents)` + `formatCurrency(target_cents)`
  - **Status badge:** shadcn Badge component
    - `spent/target < 0.75` -> "on track" (positive/emerald variant)
    - `0.75-1.0` -> "warning" (amber variant)
    - `> 1.0` -> "over budget" (destructive/rose variant)
  - Handle `target_cents = 0` edge case (avoid division by zero — show 0% progress)

### Task 6: Update Budget Page — Replace Simple Category List with BudgetCategoryRow [x]
Integrate BudgetCategoryRow into the budget page.

**AC reference:** "each category displays using the BudgetCategoryRow component" + "page header shows Budget with the current month"

- Update `src/routes/budget.tsx`:
  - Page header: "Budget — March 2026" (current month, UX-DR23)
  - Replace the simple category name + target display (from Story 2.1) with `BudgetCategoryRow` components
  - Fetch data using `useBudgetStatus(currentYear, currentMonth)` instead of (or in addition to) the raw categories
  - Group BudgetCategoryRows under their group headings (same card structure from 2.1)
- Update `src/components/budget/BudgetGroupCard.tsx`:
  - Render `BudgetCategoryRow` for each category instead of plain text

### Task 7: Empty State — No Expenses [x]
Handle the zero-expense case.

**AC reference:** "all progress bars show 0% with teal color" + "spent amounts show $0.00"

- When `spent_cents = 0`:
  - Progress bar width is 0%, background track visible, bar color teal
  - Amount text: "$0.00 / $700.00"
  - Badge: "on track" (positive)
- No special empty state needed — the component naturally handles 0 values

### Task 8: Playwright E2E Tests [x]
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Append to `tests/budget.spec.ts`:
  - Test: Budget categories display with a progress bar element
  - Test: Progress bar color is teal when spent < 75% of target (with 0 expenses, all teal)
  - Test: "spent / target" text is visible in monospace format
  - Test: Status badge text reflects the correct state ("on track" with no expenses)
  - Test: With no expenses, all progress bars show 0% and spent shows "$0.00"
- Note: Testing amber/rose states requires expenses to exist. Either seed test data via Tauri commands or defer color-state tests to after Epic 3. At minimum, test the teal/zero state.
- Verify: `npx playwright test tests/budget.spec.ts` passes

## Dev Notes

### Architecture Guidance

This is a read-only display story — no new write operations. The key new element is the SQL aggregation query that joins budget categories with expenses.

**SQL Query Pattern:**
```sql
SELECT bc.id, bc.group_id, bc.name, bc.target_cents,
       COALESCE(SUM(e.amount_cents), 0) AS spent_cents
FROM budget_categories bc
LEFT JOIN expenses e ON e.budget_category_id = bc.id
  AND strftime('%Y', e.date) = ?
  AND strftime('%m', e.date) = ?
GROUP BY bc.id
```

**Progress Bar Color Thresholds:**
- Teal (safe): `spent_cents / target_cents < 0.75`
- Amber (warning): `0.75 <= spent_cents / target_cents <= 1.0`
- Rose (over): `spent_cents / target_cents > 1.0`

These thresholds match the UX spec (BudgetCategoryRow component, lines 714-717).

**Dependency on Expenses Table:**
This story's query joins against the `expenses` table. If Story 3.1 hasn't been implemented yet, the `expenses` table won't exist. Options:
1. Include the `expenses` table migration as part of this story (just the schema, no CRUD)
2. Sequence this story after Story 3.1
3. Make the query handle a missing table gracefully

Option 1 is recommended — create the expenses table schema in the budget migration or as a separate migration, so the JOIN works. Story 3.1 then adds the CRUD commands.

**BudgetCategoryRow vs. DashboardMetricCard:**
BudgetCategoryRow is also used on the Dashboard (Epic 5). Build it as a standalone component in `src/components/budget/` so it can be imported by the dashboard later.

### Scope Boundaries

**In scope:**
- `get_budget_status` Rust db query (aggregation with expenses)
- `BudgetCategoryStatus` model
- `get_budget_status` Tauri command
- `BudgetCategoryRow` component with progress bar, amounts, badge
- Budget page integration showing status for current month
- Zero-expense empty state handling
- Playwright tests

**Out of scope:**
- Month navigation (Story 2.4)
- Creating/editing/deleting categories (Stories 2.1, 2.2)
- Adding expenses (Epic 3)
- Expanding a category row to show transactions (Story 3.2)
- Dashboard integration (Epic 5)

### Project Structure Notes

**Files to create:**
- `src/components/budget/BudgetCategoryRow.tsx`

**Files to modify:**
- `src-tauri/src/db/budget.rs` — add `get_budget_status` query
- `src-tauri/src/commands/budget.rs` — add `get_budget_status` command
- `src-tauri/src/main.rs` — register new command
- `src-tauri/src/models/mod.rs` — add `BudgetCategoryStatus` struct
- `src/lib/types.ts` — add `BudgetCategoryStatus` type
- `src/lib/constants.ts` — add query key
- `src/hooks/useBudget.ts` — add `useBudgetStatus` hook
- `src/components/budget/BudgetGroupCard.tsx` — use BudgetCategoryRow
- `src/routes/budget.tsx` — fetch and display budget status
- `tests/budget.spec.ts` — append E2E tests

**Possible migration file:**
- `src-tauri/migrations/XXX_expenses_table.sql` — if expenses table doesn't exist yet (see Dev Notes)

### References

- Epic 2 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md` (lines 361-389)
- UX — BudgetCategoryRow component spec: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md` (lines 703-719)
- UX — page header (UX-DR23), financial display (UX-DR25): UX spec
- Architecture — query patterns, TanStack Query keys: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md` (lines 389-393)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- cargo check: passes (only pre-existing warnings about unused code)
- Playwright: 16/16 tests pass (5 new tests for story 2-3)

### Completion Notes List
- Created expenses table migration (003_expenses_table.sql) as a stub schema so the LEFT JOIN in get_budget_status works. Story 3.1 will add CRUD commands for expenses.
- Added budget-status query invalidation to create/update/delete category mutations so the progress bars update immediately after category changes.
- Installed shadcn Badge component for status badges.
- Fixed existing monospace test that broke due to ambiguous selector (now targets category-target testid specifically).

### File List
- `src-tauri/migrations/003_expenses_table.sql` (created)
- `src-tauri/src/models/mod.rs` (modified — added BudgetCategoryStatus)
- `src-tauri/src/db/mod.rs` (modified — registered migration 3)
- `src-tauri/src/db/budget.rs` (modified — added get_budget_status query)
- `src-tauri/src/commands/budget.rs` (modified — added get_budget_status command)
- `src-tauri/src/lib.rs` (modified — registered get_budget_status in invoke_handler)
- `src/lib/types.ts` (modified — added BudgetCategoryStatus interface)
- `src/lib/constants.ts` (modified — added budgetStatus query key)
- `src/hooks/useBudget.ts` (modified — added useBudgetStatus hook, invalidation on mutations)
- `src/components/budget/BudgetCategoryRow.tsx` (created)
- `src/components/budget/BudgetGroupCard.tsx` (modified — renders BudgetCategoryRow per category)
- `src/routes/budget.tsx` (modified — fetches budget status, shows month in header)
- `src/components/ui/badge.tsx` (created by shadcn)
- `tests/budget.spec.ts` (modified — added get_budget_status mock + 5 new tests)
