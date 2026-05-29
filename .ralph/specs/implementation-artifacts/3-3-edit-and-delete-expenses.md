# Story 3.3: Edit and Delete Expenses

Status: review

## Story

As a user,
I want to edit or delete existing expenses,
So that I can correct mistakes or remove duplicates.

## Acceptance Criteria

1. **Given** the user views an expense in the transaction list (expanded category), **When** the user hovers over the expense row, **Then** edit and delete action icons appear (contextual actions on hover).
2. **Given** the user clicks the edit icon on an expense, **When** the edit form appears, **Then** fields are pre-populated with the expense's current values (merchant, amount, category, date).
3. **Given** the user modifies expense fields in the edit form, **When** the user saves, **Then** the expense updates in the database, a success toast confirms the save, and the budget category's spent amount recalculates via TanStack Query invalidation.
4. **Given** the user changes the expense's category, **When** the save completes, **Then** both the old and new category's spent amounts recalculate.
5. **Given** the user clicks the delete icon on an expense, **When** the confirmation dialog appears, **Then** it uses a destructive button style (rose, UX-DR15) and clearly states the action.
6. **Given** the user confirms deletion, **When** the expense is deleted, **Then** it is removed from the database, the budget category's spent amount recalculates, and a success toast confirms "Expense deleted".
7. **Given** the user presses Escape or clicks Cancel in the delete confirmation dialog, **When** the dialog closes, **Then** no deletion occurs.
8. **Given** Playwright is set up, **When** running `npx playwright test tests/expenses.spec.ts`, **Then** tests verify hover actions, edit form pre-population, save, delete confirmation, and budget recalculation.

## Tasks / Subtasks

- [x] Task 1: Create Rust DB functions for update and delete (AC: #3, #4, #6)
  - [x] Add `update_expense(db, id, input) -> Result<Expense, AppError>` to `src-tauri/src/db/expense.rs`
  - [x] Validate: expense with `id` exists, merchant non-empty, amount_cents > 0, budget_category_id exists
  - [x] Add `delete_expense(db, id) -> Result<(), AppError>` to `src-tauri/src/db/expense.rs`
  - [x] Validate: expense with `id` exists before deleting; return `AppError::Validation` if not found
- [x] Task 2: Create Tauri commands for update and delete (AC: #3, #6)
  - [x] Add `update_expense` command to `src-tauri/src/commands/expense.rs`
  - [x] Accept parameters: `id: i64`, plus `UpdateExpenseInput` (merchant, amount_cents, budget_category_id, date)
  - [x] Return `Result<Expense, AppError>`
  - [x] Add `delete_expense` command to `src-tauri/src/commands/expense.rs`
  - [x] Accept parameter: `id: i64`
  - [x] Return `Result<(), AppError>`
  - [x] Register both commands in `src-tauri/src/main.rs`
- [x] Task 3: Create TypeScript mutation hooks (AC: #3, #6)
  - [x] Add `useUpdateExpense` mutation hook to `src/hooks/useExpenses.ts`
  - [x] Add `useDeleteExpense` mutation hook to `src/hooks/useExpenses.ts`
  - [x] Both mutations on success: invalidate `["expenses"]` and `["budgets"]` query keys
  - [x] Add `UpdateExpenseInput` type to `src/lib/types.ts`
- [x] Task 4: Add hover action icons to expense rows (AC: #1)
  - [x] Modify `ExpenseList` (from Story 3.2) to show edit and delete icon buttons on row hover
  - [x] Icons hidden by default, visible on `hover` (Tailwind: `opacity-0 group-hover:opacity-100`)
  - [x] Edit icon: pencil/edit icon (ghost button style)
  - [x] Delete icon: trash icon (ghost button style, destructive color on hover)
  - [x] Icons positioned on the right side of the row
- [x] Task 5: Build edit expense form (AC: #2, #3, #4)
  - [x] Create `src/components/expenses/EditExpenseForm.tsx` (or reuse AddExpenseForm with an `expense` prop for edit mode)
  - [x] Pre-populate fields with current expense values: merchant, amount (convert cents to dollars for display), category (pre-selected), date
  - [x] Use React Hook Form with same validation as AddExpenseForm (merchant required, amount > 0, category required)
  - [x] MoneyInput shows the current amount formatted; category dropdown shows current category selected
  - [x] On save: call `useUpdateExpense` mutation, show success toast
  - [x] On cancel (Escape or Cancel button): close form without saving
  - [x] Form appears inline within the expense list or as a dialog — follow the same pattern used in Epic 2 for budget editing
- [x] Task 6: Build delete confirmation dialog (AC: #5, #6, #7)
  - [x] Use shadcn `AlertDialog` for delete confirmation
  - [x] Dialog text: "Delete this expense?" with merchant name and amount for context
  - [x] Cancel button: outline style (secondary)
  - [x] Confirm button: destructive style (rose, UX-DR15)
  - [x] On confirm: call `useDeleteExpense` mutation, show success toast "Expense deleted"
  - [x] On cancel/Escape: close dialog, no action
- [x] Task 7: Write Playwright E2E tests (AC: #8)
  - [x] Append to `tests/expenses.spec.ts`
  - [x] Test: hovering over an expense row reveals edit and delete action icons
  - [x] Test: clicking edit opens the form pre-populated with the expense's current values
  - [x] Test: saving an edited expense updates the displayed values and shows a success toast
  - [x] Test: clicking delete shows a confirmation dialog with destructive button
  - [x] Test: confirming delete removes the expense from the list and shows "Expense deleted" toast
  - [x] Test: after deleting an expense, the budget category's spent amount decreases
  - [x] Test: pressing Cancel in the delete dialog does not remove the expense
  - [x] Run `npx playwright test tests/expenses.spec.ts` and confirm all pass

## Dev Notes

### Rust Backend

- **Update** (`src-tauri/src/db/expense.rs`):
  ```sql
  UPDATE expenses
  SET merchant = ?1, amount_cents = ?2, budget_category_id = ?3, date = ?4
  WHERE id = ?5
  ```
  Validate the expense exists before updating. If the category changed, both old and new category spent amounts will recalculate on the frontend via query invalidation.

- **Delete** (`src-tauri/src/db/expense.rs`):
  ```sql
  DELETE FROM expenses WHERE id = ?1
  ```
  Check `changes()` after delete — if 0 rows affected, return `AppError::Validation { message: "Expense not found" }`.

- **Models** (`src-tauri/src/models/mod.rs`): Add `UpdateExpenseInput` struct (same fields as `CreateExpenseInput`).

### Frontend Patterns

- **Hover-to-reveal actions**: Same pattern as Linear and as used in Epic 2 for budget edit/delete. Use Tailwind group hover:
  ```tsx
  <div className="group">
    {/* expense row content */}
    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
      <Button variant="ghost" size="icon">...</Button>
    </div>
  </div>
  ```

- **Edit form**: Can reuse `AddExpenseForm` by accepting an optional `expense` prop. When provided, pre-populate fields and change the submit handler to call `update_expense` instead of `create_expense`. The form title changes from "Add Expense" to "Edit Expense".

- **Delete confirmation**: Use shadcn `AlertDialog` (not `Dialog`). AlertDialog is the correct semantic choice for destructive confirmations — it traps focus and requires explicit user action. This matches the pattern used in Epic 2 Story 2.2 for budget category deletion.

### TanStack Query Invalidation

Both update and delete mutations must invalidate:
- `["expenses", year, month]` — refreshes the expense list in the expanded category
- `["budgets"]` — refreshes spent amounts on BudgetCategoryRow progress bars

If the user changes an expense's category (e.g., from "Food" to "Entertainment"), the invalidation handles both categories automatically since the full expense list and budget summary are refetched.

### Scope Boundaries

**In scope:**
- `update_expense` and `delete_expense` Rust db functions and Tauri commands
- `useUpdateExpense` and `useDeleteExpense` TanStack Query mutation hooks
- Hover-to-reveal edit/delete icons on expense rows
- Edit expense form (pre-populated, same fields as add form)
- Delete confirmation dialog (shadcn AlertDialog, destructive button)
- Success toasts for edit and delete
- Budget spent amount recalculation via query invalidation
- Playwright E2E tests

**Out of scope (other stories/epics):**
- Bulk delete or bulk edit (not in requirements)
- Undo delete (not in requirements)
- Audit log entries for expense edits/deletes (Epic 8)
- Inline editing of expense fields without a form (the UX spec uses inline editing for balance updates and budget targets, but expenses use a form-based edit since they have multiple fields)

### Project Structure Notes

**Files to create:**
- `src/components/expenses/EditExpenseForm.tsx` (or extend AddExpenseForm to handle edit mode)

**Files to modify:**
- `src-tauri/src/db/expense.rs` — add `update_expense`, `delete_expense` functions
- `src-tauri/src/commands/expense.rs` — add `update_expense`, `delete_expense` commands
- `src-tauri/src/main.rs` — register new commands
- `src-tauri/src/models/mod.rs` — add `UpdateExpenseInput` struct
- `src/lib/types.ts` — add `UpdateExpenseInput` type
- `src/hooks/useExpenses.ts` — add `useUpdateExpense`, `useDeleteExpense` mutation hooks
- `src/components/expenses/ExpenseList.tsx` — add hover action icons, wire edit/delete handlers
- `tests/expenses.spec.ts` — append new tests

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Commands (commands/expense.rs), DB (db/expense.rs), Error Handling (AppError)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR15 (Destructive button in confirmation dialogs), UX-DR16 (Success toasts, inline errors), UX-DR17 (Inline editing pattern reference), Linear's contextual actions on hover]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- EditExpenseForm built as inline component within ExpenseList (replaces expense row when editing)
- Used Dialog component (not AlertDialog since project doesn't have it) for delete confirmation
- Hover-to-reveal pattern matches BudgetGroupCard's delete button pattern (opacity-0 group-hover:opacity-100)

### Completion Notes List
- All 7 tasks complete. 16 Playwright E2E tests pass (7 new for 3-3). 46 total tests pass across all test files. Zero regressions.
- AC #1: Hover reveals pencil (edit) and trash (delete) icons on expense rows
- AC #2: Edit form pre-populates merchant, amount, category, date from existing expense
- AC #3: Save calls update_expense, shows "Expense updated" toast, invalidates queries
- AC #4: Category change handled via query invalidation (both old and new categories refresh)
- AC #5: Delete confirmation dialog shows expense details with destructive (rose) Delete button
- AC #6: Confirm delete removes expense, shows "Expense deleted" toast, budget spent recalculates
- AC #7: Cancel/Escape closes dialog without deletion
- AC #8: 7 new Playwright tests cover all acceptance criteria

### File List
- src-tauri/src/models/mod.rs (modified — added UpdateExpenseInput struct)
- src-tauri/src/db/expense.rs (modified — added update_expense, delete_expense functions)
- src-tauri/src/commands/expense.rs (modified — added update_expense, delete_expense commands)
- src-tauri/src/lib.rs (modified — registered new commands)
- src/lib/types.ts (modified — added UpdateExpenseInput type)
- src/hooks/useExpenses.ts (modified — added useUpdateExpense, useDeleteExpense hooks)
- src/components/expenses/ExpenseList.tsx (modified — added hover actions, inline edit form, delete dialog)
- tests/expenses.spec.ts (modified — added update/delete mocks and 7 new tests)
