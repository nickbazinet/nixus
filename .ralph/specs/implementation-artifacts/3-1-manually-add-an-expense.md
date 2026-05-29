# Story 3.1: Manually Add an Expense

Status: review

## Story

As a user,
I want to manually add an expense entry with merchant, amount, category, and date,
So that I can track spending that isn't imported from CC statements.

## Acceptance Criteria

1. **Given** the user is on the Budget page viewing a category, **When** the user clicks an "Add Expense" action, **Then** a form appears with fields for merchant name, amount (MoneyInput), category (Select dropdown, pre-selected if adding from a category), and date (defaults to today).
2. **Given** the add expense form is displayed, **When** the user submits the form with valid data, **Then** the expense is saved to the `expenses` table and a success toast confirms the save (UX-DR16).
3. **Given** an expense is saved, **When** the Budget page re-renders, **Then** the budget category's spent amount updates immediately via TanStack Query invalidation.
4. **Given** the add expense form is displayed, **When** the user submits with empty merchant, zero/negative amount, or no category selected, **Then** validation errors are shown inline below the offending fields and submission is blocked.
5. **Given** Playwright is set up, **When** running `npx playwright test tests/expenses.spec.ts`, **Then** tests verify form rendering, successful submission, budget spent update, and validation errors.

## Tasks / Subtasks

- [x] Task 1: Create `expenses` table via SQL migration (AC: #1, #2)
  - [x] Add migration file `XXX_create_expenses.sql` in `src-tauri/migrations/`
  - [x] Create `expenses` table with columns: `id` (INTEGER PRIMARY KEY), `merchant` (TEXT NOT NULL), `amount_cents` (INTEGER NOT NULL), `budget_category_id` (INTEGER NOT NULL REFERENCES budget_categories(id)), `date` (TEXT NOT NULL — ISO 8601 date string), `source` (TEXT NOT NULL DEFAULT 'manual' — 'manual' or 'import'), `created_at` (TEXT NOT NULL DEFAULT current_timestamp)
  - [x] Add index: `idx_expenses_budget_category_id` on `budget_category_id`
  - [x] Add index: `idx_expenses_date` on `date`
  - [x] Verify migration applies on app startup
- [x] Task 2: Create Rust Expense model and DB functions (AC: #2)
  - [x] Add `Expense` struct to `src-tauri/src/models/mod.rs` with fields: `id`, `merchant`, `amount_cents`, `budget_category_id`, `date`, `source`, `created_at` — derive `Serialize`, `Deserialize`
  - [x] Add `CreateExpenseInput` struct (merchant, amount_cents, budget_category_id, date) for validated input
  - [x] Create `src-tauri/src/db/expense.rs` with `insert_expense(db, input) -> Result<Expense, AppError>` function
  - [x] Validate: merchant non-empty, amount_cents > 0, budget_category_id exists (FK check), date is valid ISO 8601
  - [x] Register module in `src-tauri/src/db/mod.rs`
- [x] Task 3: Create Tauri command for creating an expense (AC: #2, #3)
  - [x] Create `src-tauri/src/commands/expense.rs` with `create_expense` Tauri command
  - [x] Command calls `db::expense::insert_expense`, returns `Result<Expense, AppError>`
  - [x] Register command in `src-tauri/src/main.rs`
- [x] Task 4: Create TypeScript types and hook (AC: #1, #2, #3)
  - [x] Add `Expense` and `CreateExpenseInput` types to `src/lib/types.ts`
  - [x] Create `src/hooks/useExpenses.ts` with `useCreateExpense` mutation hook (TanStack Query)
  - [x] On success: invalidate `["expenses"]` and `["budgets"]` query keys so spent amounts refresh
  - [x] Add query key constants to `src/lib/constants.ts` if not already present
- [x] Task 5: Build Add Expense form component (AC: #1, #4)
  - [x] Create `src/components/expenses/AddExpenseForm.tsx`
  - [x] Use React Hook Form with fields: merchant (text input), amount (MoneyInput — monospace font, currency prefix, auto-format with commas on blur per UX-DR18), category (Select dropdown from budget categories), date (date input, defaults to today)
  - [x] Category dropdown: use shadcn Select; if > 7 categories, use shadcn Command (cmdk) for searchable selection
  - [x] If opened from within a specific category, pre-select that category in the dropdown
  - [x] Validation: merchant required, amount > 0, category required
  - [x] Show inline error alerts below fields on validation failure (UX-DR16)
  - [x] On successful submit: call `useCreateExpense` mutation, show success toast (bottom-right, auto-dismiss 4s, green border per UX-DR16)
- [x] Task 6: Integrate Add Expense into Budget page (AC: #1, #3)
  - [x] Add "Add Expense" button to the Budget page (page header or within category context)
  - [x] Wire form submission to trigger budget spent amount recalculation via query invalidation
- [x] Task 7: Write Playwright E2E tests (AC: #5)
  - [x] Create `tests/expenses.spec.ts`
  - [x] Test: clicking "Add Expense" opens the form with all four fields
  - [x] Test: submitting a valid expense shows a success toast and the expense appears in the category
  - [x] Test: the budget category's spent amount updates after adding the expense
  - [x] Test: form validation prevents submission with empty merchant or zero amount
  - [x] Run `npx playwright test tests/expenses.spec.ts` and confirm all pass

## Dev Notes

### Database Schema

```sql
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expenses_budget_category_id ON expenses(budget_category_id);
CREATE INDEX idx_expenses_date ON expenses(date);
```

- `amount_cents`: integer storage for financial precision (NFR13). `$45.99` stored as `4599`.
- `budget_category_id`: foreign key to `budget_categories(id)`. Enforced by SQLite with `PRAGMA foreign_keys = ON`.
- `source`: 'manual' for user-entered, 'import' for AI-imported (used later in Epic 6). Only 'manual' is relevant for this story.
- `date`: ISO 8601 date string (`"2026-03-14"`). Defaults to today in the frontend form, stored as-is.

### Rust Backend

- **Model** (`src-tauri/src/models/mod.rs`): Add `Expense` struct with serde `snake_case` serialization (matches JSON field naming convention).
- **DB** (`src-tauri/src/db/expense.rs`): Pure SQL functions. Validate FK existence with a query before insert. Return `AppError::Validation` for bad input, `AppError::Database` for SQL errors.
- **Command** (`src-tauri/src/commands/expense.rs`): Thin wrapper calling db functions. Returns `Result<Expense, AppError>`.

### Frontend Components

- **MoneyInput** (`src/components/shared/MoneyInput.tsx`): Should already exist or be created as a shared component. Monospace font (`font-mono`), `$` prefix inside the input, auto-format with commas on blur, stores integer cents internally. Per UX-DR18.
- **AddExpenseForm** (`src/components/expenses/AddExpenseForm.tsx`): React Hook Form. Four fields. Category dropdown uses shadcn `Select` for <= 7 categories, or shadcn `Command` (cmdk-based searchable combobox) for > 7 categories.
- **Category dropdown**: Fetches categories via `useBudgetCategories` hook (should exist from Epic 2). Pre-selects the current category if the form is opened from within a category context (passed as a prop).

### TanStack Query Integration

- Mutation: `useMutation` calling `invoke("create_expense", { input })`.
- On success: `queryClient.invalidateQueries({ queryKey: ["expenses"] })` and `queryClient.invalidateQueries({ queryKey: ["budgets"] })` to refresh spent amounts on BudgetCategoryRow.
- Query keys: `["expenses"]`, `["budgets"]` (must match whatever Epic 2 established).

### Scope Boundaries

**In scope:**
- `expenses` table creation (migration)
- Rust model, db functions, Tauri command for creating an expense
- TypeScript types, TanStack Query hook for create mutation
- AddExpenseForm component with React Hook Form + MoneyInput
- Category Select/Command dropdown
- Integration into Budget page with "Add Expense" action
- Success toast and validation error display
- Playwright E2E tests

**Out of scope (later stories):**
- Viewing expense lists grouped by category (Story 3.2)
- Editing or deleting expenses (Story 3.3)
- AI-imported expenses / `source: 'import'` (Epic 6)
- Audit log entries for expense creation (Epic 8)
- `get_expenses` query command (Story 3.2)

### Project Structure Notes

**Files to create:**
- `src-tauri/migrations/XXX_create_expenses.sql`
- `src-tauri/src/db/expense.rs`
- `src-tauri/src/commands/expense.rs`
- `src/components/expenses/AddExpenseForm.tsx`
- `src/hooks/useExpenses.ts`
- `tests/expenses.spec.ts`

**Files to modify:**
- `src-tauri/src/models/mod.rs` — add `Expense`, `CreateExpenseInput` structs
- `src-tauri/src/db/mod.rs` — register `expense` module
- `src-tauri/src/commands/mod.rs` — register `expense` module and export commands
- `src-tauri/src/main.rs` — register `create_expense` command
- `src/lib/types.ts` — add `Expense`, `CreateExpenseInput` types
- `src/lib/constants.ts` — add expense-related query keys
- `src/routes/budget.tsx` — add "Add Expense" button and form integration
- `src/components/shared/MoneyInput.tsx` — create if not already existing from Epic 2

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Database Schema, IPC Patterns, Frontend Organization, Naming Conventions]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR16 (Feedback Patterns), UX-DR18 (Financial Input Patterns), UX-DR25 (Data Display Patterns), Dropdowns/Select section]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed migration 003 to match story spec (added merchant, source, CHECK constraint, AUTOINCREMENT)
- Exposed existing `get_all_budget_categories` db function as Tauri command for category dropdown
- Used native HTML `<select>` with `<optgroup>` for category dropdown (project uses Base UI, not shadcn)
- Fixed Playwright test selectors to scope within form to avoid conflict with "Delete category" buttons

### Completion Notes List
- All 7 tasks complete. 5 Playwright E2E tests pass. 21 budget regression tests pass. Rust compiles clean. TypeScript compiles clean.
- AC #1: Add Expense button in budget page header opens form with merchant, amount (MoneyInput), category (select with optgroups), and date (defaults to today). Category pre-selection supported via `defaultCategoryId` prop.
- AC #2: Form submission calls `create_expense` Tauri command, saves to `expenses` table, shows success toast.
- AC #3: On success, TanStack Query invalidates `["expenses"]` and `["budget-status"]` keys, refreshing spent amounts.
- AC #4: Inline validation errors for empty merchant, zero amount, missing category via React Hook Form.
- AC #5: 5 Playwright tests cover form rendering, successful submission, budget spent update, and validation errors.

### File List
- src-tauri/migrations/003_expenses_table.sql (modified)
- src-tauri/src/models/mod.rs (modified)
- src-tauri/src/db/mod.rs (modified)
- src-tauri/src/db/expense.rs (created)
- src-tauri/src/db/budget.rs (modified — removed #[allow(dead_code)])
- src-tauri/src/commands/mod.rs (modified)
- src-tauri/src/commands/expense.rs (created)
- src-tauri/src/commands/budget.rs (modified — added get_all_budget_categories command)
- src-tauri/src/lib.rs (modified — registered new commands)
- src/lib/types.ts (modified)
- src/lib/constants.ts (modified)
- src/hooks/useExpenses.ts (created)
- src/components/expenses/AddExpenseForm.tsx (created)
- src/routes/budget.tsx (modified)
- tests/expenses.spec.ts (created)
