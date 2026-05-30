# Story 2.2: Edit and Delete Budget Categories, Groups, and Targets

Status: review

## Story

As a user,
I want to edit category names, targets, and group names, or delete categories and groups,
So that I can adjust my budget as needs change.

## Acceptance Criteria

**Given** the user views a budget category
**When** the user clicks the target amount
**Then** the value becomes an inline editable input field (UX-DR17)
**And** pressing Enter saves the updated target and shows a success toast
**And** pressing Escape cancels the edit without saving

**Given** the user wants to rename a category or group
**When** the user edits the name
**Then** the name updates in the database and the UI reflects the change immediately

**Given** the user wants to delete a category
**When** the user triggers the delete action
**Then** a destructive confirmation dialog appears (UX-DR15)
**And** confirming deletes the category from the database

**Given** the user wants to delete a group
**When** the group still contains categories
**Then** the system prevents deletion and shows an inline error: "Remove all categories first"

## Tasks / Subtasks

### [x] Task 1: Rust DB Queries — Update and Delete
Add update and delete functions to the budget db module.

**AC reference:** "name updates in the database" + "deletes the category from the database" + "prevents deletion"

- Add to `src-tauri/src/db/budget.rs`:
  - `update_budget_group(conn, id: i64, name: String) -> Result<BudgetGroup, AppError>`
  - `update_budget_category(conn, id: i64, name: Option<String>, target_cents: Option<i64>) -> Result<BudgetCategory, AppError>`
  - `delete_budget_category(conn, id: i64) -> Result<(), AppError>`
  - `delete_budget_group(conn, id: i64) -> Result<(), AppError>` — returns `AppError::Validation` if group has categories
- Validation: target_cents must be > 0 if provided, name must not be empty if provided
- Delete group checks: `SELECT COUNT(*) FROM budget_categories WHERE group_id = ?` — if > 0, return error

### [x] Task 2: Rust Models — Update Inputs
Add update input structs if needed.

**AC reference:** Supports partial updates (name only, target only, or both).

- Add to `src-tauri/src/models/mod.rs`:
  - `UpdateBudgetCategory { name: Option<String>, target_cents: Option<i64> }` (if not using direct params)
- Or use direct parameters in command signatures — choose the simpler approach

### [x] Task 3: Tauri Commands — Update and Delete
Expose update and delete operations.

**AC reference:** Frontend invokes these for edit/delete operations.

- Add to `src-tauri/src/commands/budget.rs`:
  - `#[tauri::command] fn update_budget_group(state, id: i64, name: String) -> Result<BudgetGroup, AppError>`
  - `#[tauri::command] fn update_budget_category(state, id: i64, name: Option<String>, target_cents: Option<i64>) -> Result<BudgetCategory, AppError>`
  - `#[tauri::command] fn delete_budget_category(state, id: i64) -> Result<(), AppError>`
  - `#[tauri::command] fn delete_budget_group(state, id: i64) -> Result<(), AppError>`
- Register new commands in `src-tauri/src/main.rs`

### [x] Task 4: TanStack Query Mutations
Add mutation hooks for update and delete operations.

**AC reference:** Frontend state updates via TanStack Query invalidation.

- Add to `src/hooks/useBudget.ts`:
  - `useUpdateBudgetGroup()` — mutation, invalidates `["budget-groups"]`
  - `useUpdateBudgetCategory()` — mutation, invalidates `["budget-categories", groupId]`
  - `useDeleteBudgetCategory()` — mutation, invalidates `["budget-categories", groupId]`
  - `useDeleteBudgetGroup()` — mutation, invalidates `["budget-groups"]`

### [x] Task 5: Inline Editing Component/Pattern
Implement the click-to-edit inline editing pattern.

**AC reference:** "value becomes an inline editable input field" + "Enter saves" + "Escape cancels" (UX-DR17)

- Implement inline editing within `BudgetGroupCard.tsx` or as a shared component:
  - Default state: displays the value as text
  - Click: switches to an input field with the current value selected
  - Enter: saves via mutation, shows success toast, returns to display state
  - Escape: reverts to original value, returns to display state
  - For target amounts: use MoneyInput pattern (monospace, currency prefix)
  - For names: use plain text Input
- This pattern will be reused in accounts/assets (Story 4.2), so consider a shared `InlineEdit` component in `src/components/shared/` if the abstraction is clean. If not, inline it in the budget components — do not over-abstract for a single use.

### [x] Task 6: Inline Editable Target Amount
Wire inline editing to the category target display.

**AC reference:** "clicks the target amount" + "Enter saves the updated target and shows a success toast"

- In `BudgetGroupCard.tsx`, each category row's target amount:
  - Click: target text becomes a MoneyInput pre-filled with current value
  - Enter: calls `useUpdateBudgetCategory({ id, target_cents })`, shows toast "Budget target updated to $700"
  - Escape: reverts to display mode
  - Value displayed via `formatCurrency()` in monospace

### [x] Task 7: Inline Editable Names
Wire inline editing to category and group names.

**AC reference:** "user edits the name" + "name updates in the database and the UI reflects the change immediately"

- Group name (H2 heading): click to edit, Enter saves via `useUpdateBudgetGroup()`
- Category name: click to edit, Enter saves via `useUpdateBudgetCategory({ id, name })`
- Success toast on save

### [x] Task 8: Delete Category with Confirmation Dialog
Implement category deletion with destructive confirmation.

**AC reference:** "destructive confirmation dialog appears (UX-DR15)" + "confirming deletes the category"

- Add a delete action to each category row (e.g., trash icon, visible on hover or as a menu action)
- On click: open shadcn Dialog with:
  - Title: "Delete Category"
  - Message: "Are you sure you want to delete {category name}? This cannot be undone."
  - Cancel button (outline) + Delete button (destructive rose, UX-DR15)
- Confirm: calls `useDeleteBudgetCategory()`, category disappears from UI
- Toast: "Category deleted"

### [x] Task 9: Delete Group with Guard
Implement group deletion with non-empty guard.

**AC reference:** "prevents deletion and shows an inline error: 'Remove all categories first'"

- Add a delete action to each group card header
- On click: calls `useDeleteBudgetGroup()` mutation
- If group has categories, backend returns `AppError::Validation { message: "Remove all categories first" }`
- Frontend displays inline error below the group header (rose text, UX error pattern)
- If group is empty: open destructive confirmation dialog (same pattern as category delete), then delete

### [x] Task 10: Playwright E2E Tests
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Append to `tests/budget.spec.ts`:
  - Test: Clicking a target amount makes it editable inline
  - Test: Pressing Enter saves the new value and shows a success toast
  - Test: Pressing Escape reverts the value without saving
  - Test: Deleting a category shows a confirmation dialog; confirming removes it from the page
  - Test: Deleting a group with categories shows the "Remove all categories first" error
- Verify: `npx playwright test tests/budget.spec.ts` passes

## Dev Notes

### Architecture Guidance

This story extends the patterns established in Story 2.1. No new database tables — only new commands and UI interactions.

**Inline Editing Pattern (UX-DR17):**
- Click a displayed value -> input appears in place -> Enter saves, Escape cancels.
- No modal, no separate edit page. The edit happens in place.
- Toast confirms the save (bottom-right, auto-dismiss 4s, green left border).
- This is the standard edit pattern used across the app (budget targets, account balances, asset values).

**Destructive Actions (UX-DR15):**
- Destructive buttons (rose filled) only appear inside confirmation dialogs.
- Dialog shows exactly what will be deleted — not a vague "Are you sure?".
- Confirmation uses shadcn Dialog component.

**Error Handling:**
- Delete group with categories: backend returns validation error, frontend shows inline (no modal).
- Update with invalid data: backend validates, returns field-level error.
- Errors rendered inline below the relevant element, rose text.

**Optimistic Updates (optional):**
- Inline edits can optionally use TanStack Query optimistic updates for snappy UX. If complexity is low, do it. If not, invalidation after mutation is fine.

### Scope Boundaries

**In scope:**
- Update and delete Tauri commands + db queries for groups and categories
- Inline editing of target amounts (MoneyInput) and names (text Input)
- Delete category with confirmation dialog
- Delete group with non-empty guard (inline error)
- TanStack Query mutations with invalidation
- Playwright tests

**Out of scope:**
- Creating groups/categories (Story 2.1 — already done)
- Progress bars, spent amounts (Story 2.3)
- Month navigation (Story 2.4)
- Reordering groups/categories via drag-and-drop (not in MVP)
- Deleting categories that have linked expenses (Epic 3 concern — cascading delete rules deferred)

### Project Structure Notes

**Files to create:**
- None expected (all files exist from Story 2.1). Possibly `src/components/shared/InlineEdit.tsx` if a shared component makes sense.

**Files to modify:**
- `src-tauri/src/db/budget.rs` — add update/delete queries
- `src-tauri/src/commands/budget.rs` — add update/delete commands
- `src-tauri/src/main.rs` — register new commands
- `src-tauri/src/models/mod.rs` — add update input structs if needed
- `src/hooks/useBudget.ts` — add mutation hooks
- `src/components/budget/BudgetGroupCard.tsx` — add inline editing + delete actions
- `src/routes/budget.tsx` — wire up delete group with error handling
- `tests/budget.spec.ts` — append E2E tests

### References

- Epic 2 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md` (lines 325-359)
- Architecture — IPC patterns, error handling: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- UX — inline editing (UX-DR17), button hierarchy / destructive pattern (UX-DR15), toast (UX-DR16): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md` (lines 915-918)
- Story 2.1 for prerequisite patterns: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/implementation-artifacts/2-1-create-budget-with-category-groups-and-targets.md`

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None

### Completion Notes List
- Task 2 used direct parameters instead of a separate update struct (simpler approach as suggested in the story)
- Created shared InlineEdit component (`InlineEditText` + `InlineEditMoney`) in `src/components/shared/InlineEdit.tsx` for reuse in Story 4.2
- Inline editing: click to edit, Enter saves, Escape cancels, blur saves
- Delete category uses shadcn Dialog with destructive confirmation (UX-DR15)
- Delete group with categories shows inline error from backend validation, empty groups show confirmation dialog
- All 11 Playwright tests pass (6 existing + 5 new)

### File List
- `src-tauri/src/db/budget.rs` — added update_budget_group, update_budget_category, delete_budget_category, delete_budget_group
- `src-tauri/src/commands/budget.rs` — added 4 Tauri commands for update/delete
- `src-tauri/src/lib.rs` — registered 4 new commands in invoke_handler
- `src/hooks/useBudget.ts` — added useUpdateBudgetGroup, useUpdateBudgetCategory, useDeleteBudgetCategory, useDeleteBudgetGroup
- `src/components/shared/InlineEdit.tsx` — new shared InlineEditText + InlineEditMoney components
- `src/components/budget/BudgetGroupCard.tsx` — added inline editing for names/targets, delete category with dialog, delete group with guard
- `src/components/ui/dialog.tsx` — installed via shadcn
- `tests/budget.spec.ts` — added mock handlers for update/delete + 5 new E2E tests
