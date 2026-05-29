# Story 3.2: View Expenses by Month Grouped by Category

Status: review

## Story

As a user,
I want to view all expenses for a given month grouped by budget category,
So that I can see where my money went.

## Acceptance Criteria

1. **Given** expenses exist for the selected month, **When** the user expands a budget category row (hover to expand, UX-DR4), **Then** recent transactions for that category are displayed below the category row.
2. **Given** a category is expanded, **When** the user views the transaction list, **Then** each expense shows merchant name, amount (monospace, right-aligned), and date (short format "Mar 14" per UX-DR25).
3. **Given** a category is expanded, **When** the user views the transaction list, **Then** the table rows have hover highlight (accent background) and numerical columns are right-aligned.
4. **Given** no expenses exist for a category in the selected month, **When** the user expands that category, **Then** a message displays "No expenses this month".
5. **Given** the user navigates between months using the month tabs (Story 2.4), **When** the month changes, **Then** the expense data within each category updates to reflect the selected month.
6. **Given** Playwright is set up, **When** running `npx playwright test tests/expenses.spec.ts`, **Then** tests verify category expansion, transaction display, empty state, and month filtering.

## Tasks / Subtasks

- [x] Task 1: Create Rust DB function to get expenses by month and category (AC: #1, #5)
  - [x] Add `get_expenses_by_month(db, year, month) -> Result<Vec<Expense>, AppError>` to `src-tauri/src/db/expense.rs`
  - [x] Query filters on `date` column using year-month range (e.g., `date >= '2026-03-01' AND date < '2026-04-01'`)
  - [x] Results ordered by `date DESC, created_at DESC` within each category
  - [x] Optionally add `get_expenses_by_category_and_month(db, category_id, year, month)` for per-category fetching
- [x] Task 2: Create Tauri command for fetching expenses (AC: #1, #5)
  - [x] Add `get_expenses` command to `src-tauri/src/commands/expense.rs`
  - [x] Accept parameters: `year: i32`, `month: u32`
  - [x] Return `Result<Vec<Expense>, AppError>`
  - [x] Register command in `src-tauri/src/main.rs`
- [x] Task 3: Create TypeScript query hook for fetching expenses (AC: #1, #5)
  - [x] Add `useExpensesByMonth(year, month)` query hook to `src/hooks/useExpenses.ts`
  - [x] Query key: `["expenses", year, month]`
  - [x] Returns expenses grouped by `budget_category_id` for easy rendering
  - [x] Create a utility to group expenses by category: `groupExpensesByCategory(expenses: Expense[]) -> Record<number, Expense[]>`
- [x] Task 4: Build expense list component for category expansion (AC: #1, #2, #3, #4)
  - [x] Create `src/components/expenses/ExpenseList.tsx`
  - [x] Renders a list/table of expenses for a single category
  - [x] Columns: Merchant (left-aligned), Date (short format "Mar 14", left-aligned), Amount (monospace, right-aligned)
  - [x] Amount formatted via `formatCurrency()` utility (cents to `$XX.XX`)
  - [x] Date formatted via `formatDate()` utility (ISO to "Mar 14" short format)
  - [x] Row hover: accent background (`bg-accent`)
  - [x] Empty state: "No expenses this month" message when no expenses for that category in the selected month
  - [x] No pagination — scroll within the expanded area (UX-DR25)
- [x] Task 5: Integrate expense list into BudgetCategoryRow expansion (AC: #1, #2, #3)
  - [x] Modify `BudgetCategoryRow` (from Epic 2) to support expand/collapse behavior
  - [x] On hover or click: expand the row to reveal `ExpenseList` below it
  - [x] Pass the category's expenses (filtered from the month query) to `ExpenseList`
  - [x] Collapse hides the expense list
- [x] Task 6: Wire month navigation to expense data (AC: #5)
  - [x] Ensure the month selected via month tabs (Story 2.4) is passed to `useExpensesByMonth`
  - [x] When month changes, expense data refreshes automatically via TanStack Query key change
  - [x] Category spent amounts in BudgetCategoryRow should already reflect the selected month (from Epic 2 Story 2.3)
- [x] Task 7: Write Playwright E2E tests (AC: #6)
  - [x] Append to `tests/expenses.spec.ts`
  - [x] Test: expanding a budget category row reveals the transaction list below it
  - [x] Test: each expense row shows merchant name, amount (right-aligned), and date
  - [x] Test: expanding a category with no expenses shows "No expenses this month"
  - [x] Test: navigating to a different month updates the expense data within categories
  - [x] Run `npx playwright test tests/expenses.spec.ts` and confirm all pass

## Dev Notes

### Rust Backend

- **DB query** (`src-tauri/src/db/expense.rs`): Add a `get_expenses_by_month` function. Use date range filtering:
  ```sql
  SELECT * FROM expenses
  WHERE date >= ?1 AND date < ?2
  ORDER BY date DESC, created_at DESC
  ```
  Where `?1` = first day of month (e.g., `"2026-03-01"`), `?2` = first day of next month (e.g., `"2026-04-01"`).

- **Command** (`src-tauri/src/commands/expense.rs`): Add `get_expenses` command accepting `year` and `month` parameters. Compute the date range in Rust and pass to the db function.

### Frontend Components

- **ExpenseList** (`src/components/expenses/ExpenseList.tsx`): A simple table/list component. Uses shadcn `Table` or a styled `div` list. Key styling:
  - Merchant column: left-aligned, normal font
  - Date column: left-aligned, muted color, short format ("Mar 14")
  - Amount column: right-aligned, monospace (`font-mono`), formatted as `$XX.XX`
  - Row hover: `hover:bg-accent` (Tailwind)

- **BudgetCategoryRow modification**: The existing BudgetCategoryRow from Epic 2 (UX-DR4) has "hover (row highlight for click-to-expand)" and "expanded (shows recent transactions in this category)" states defined in the UX spec. This story implements the expanded state.

### Data Flow

```
Month tabs (Story 2.4) → selected year/month
  → useExpensesByMonth(year, month) → invoke("get_expenses", { year, month })
  → Rust command → db::expense::get_expenses_by_month → Vec<Expense>
  → Frontend groups by budget_category_id
  → BudgetCategoryRow receives its category's expenses
  → On expand → renders ExpenseList with those expenses
```

### TanStack Query

- Query key: `["expenses", year, month]` — automatically refetches when month changes.
- This query is separate from the budget query. The budget spent amounts (BudgetCategoryRow progress bars) come from Epic 2's budget query which aggregates expense totals. This query returns individual expense rows for the expanded list.
- When an expense is created (Story 3.1) or modified (Story 3.3), both `["expenses"]` and `["budgets"]` keys must be invalidated.

### Category Subtotals

The BudgetCategoryRow already shows "spent / target" from Epic 2 Story 2.3. The spent amount is the sum of all expenses for that category in the selected month. This story does NOT change how the spent amount is calculated — it only adds the ability to see the individual expenses that make up that total.

### Scope Boundaries

**In scope:**
- `get_expenses_by_month` Rust db function and `get_expenses` Tauri command
- `useExpensesByMonth` TanStack Query hook
- `ExpenseList` component displaying expenses within an expanded category
- BudgetCategoryRow expand/collapse behavior showing expenses
- Month filtering (wired to existing month tabs from Story 2.4)
- Empty state for categories with no expenses
- Playwright E2E tests

**Out of scope (other stories):**
- Adding expenses (Story 3.1 — should be done first or in parallel)
- Editing or deleting expenses from the list (Story 3.3)
- Sortable columns (not required for MVP — UX spec says "sortable where relevant", but expansion list is compact)
- Standalone expenses page (expenses are viewed within the Budget page context per architecture mapping: `routes/budget.tsx`)

### Project Structure Notes

**Files to create:**
- `src/components/expenses/ExpenseList.tsx`

**Files to modify:**
- `src-tauri/src/db/expense.rs` — add `get_expenses_by_month` function
- `src-tauri/src/commands/expense.rs` — add `get_expenses` command
- `src-tauri/src/main.rs` — register `get_expenses` command
- `src/hooks/useExpenses.ts` — add `useExpensesByMonth` query hook
- `src/components/budget/BudgetCategoryRow.tsx` — add expand/collapse with ExpenseList
- `src/routes/budget.tsx` — wire month state to expense query, pass expenses to category rows
- `tests/expenses.spec.ts` — append new tests

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Database Queries (db/expense.rs), Frontend Organization, TanStack Query Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR4 (BudgetCategoryRow expanded state), UX-DR25 (Data Display Patterns: monospace, right-aligned, hover highlight, short dates, no pagination)]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Click-to-expand pattern on BudgetCategoryRow with chevron icons (ChevronRight/ChevronDown)
- Expanded state persists across month navigation (component stays mounted via same key)
- ExpenseList shows grouped expenses per category with empty state message

### Completion Notes List
- All 7 tasks complete. 9 Playwright E2E tests pass (4 new for 3-2). 21 budget regression tests pass. Rust and TS compile clean.
- AC #1: Click category row expand toggle reveals expense list below progress bar
- AC #2: Each expense shows merchant, amount (monospace right-aligned), date (short "Mar 14" format)
- AC #3: Row hover has accent background via `hover:bg-accent`
- AC #4: Empty state shows "No expenses this month"
- AC #5: Month navigation updates expenses via TanStack Query key `["expenses", year, month]`
- AC #6: 4 new Playwright tests cover expansion, display, empty state, and month filtering

### File List
- src-tauri/src/db/expense.rs (modified — added get_expenses_by_month)
- src-tauri/src/commands/expense.rs (modified — added get_expenses command)
- src-tauri/src/lib.rs (modified — registered get_expenses)
- src/hooks/useExpenses.ts (modified — added useExpensesByMonth, groupExpensesByCategory)
- src/lib/constants.ts (modified — added expensesByMonth query key)
- src/components/expenses/ExpenseList.tsx (created)
- src/components/budget/BudgetCategoryRow.tsx (modified — added expand/collapse with ExpenseList)
- src/components/budget/BudgetGroupCard.tsx (modified — accepts/passes expensesByCategory prop)
- src/routes/budget.tsx (modified — fetches monthly expenses, passes to group cards)
- tests/expenses.spec.ts (modified — added get_expenses mock and 4 new tests)
