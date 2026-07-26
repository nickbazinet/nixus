---
title: 'Fix budget category deletion'
type: 'bugfix'
created: '2026-07-26'
status: 'done'
baseline_commit: '1aa7b81154f2fd310c4df86531ea17310db9f8e5'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users report they can no longer delete budget categories. Deletion appears broken because SQLite foreign-key constraints block the delete when a category is referenced by expenses, recurring expense templates, or merchant category hints — and the UI always shows a generic "Failed to delete category" toast that hides the real reason.

**Approach:** Add explicit dependency checks in `delete_budget_category` with actionable validation errors, auto-clean safe metadata (merchant hints), and surface backend error messages in the budget UI so users know exactly what is blocking deletion and how to proceed.

## Boundaries & Constraints

**Always:**
- Money stays in cents (`i64` / `number`); no float currency
- Tauri commands use `#[tauri::command(rename_all = "snake_case")]`
- Existing group-delete behavior unchanged (must remove categories before deleting group)
- Applied recurring expenses are never deleted as a side effect of category deletion

**Ask First:**
- If product wants category deletion to reassign or delete existing expenses automatically (cascade) — that is a larger behavioral change and needs explicit approval

**Never:**
- Silently cascade-delete expenses when removing a category
- Change budget group deletion rules in this fix
- Add new UI surfaces (settings page, bulk reassignment wizard) — only fix delete + messaging

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Category with no expenses, recurring templates, or merchant hints | Category deleted; list refreshes; success toast | N/A |
| EXPENSES_BLOCK | Category has one or more expenses | Delete rejected before SQL DELETE | `Validation`: message like "Cannot delete category with expenses. Delete or reassign them first." |
| RECURRING_BLOCK | Category has recurring expense template(s) | Delete rejected | `Validation`: message like "Cannot delete category used by a recurring expense. Remove the template first." |
| HINTS_ONLY | Category has merchant_category_hints only | Hints deleted, then category deleted | N/A |
| NOT_FOUND | Invalid category id | Delete rejected | `Database`: "Budget category not found" |
| UI_ERROR | Any backend validation/database error | Toast shows backend `message`, dialog stays open until user dismisses | No generic-only toast |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/db/budget.rs` -- `delete_budget_category`; add dependency queries and hint cleanup in a transaction
- `apps/desktop/src-tauri/src/commands/budget.rs` -- IPC wrapper (likely unchanged signature)
- `apps/desktop/src/components/budget/BudgetGroupCard.tsx` -- `handleDeleteCategory` error handler; surface `err.message`
- `apps/desktop/src/hooks/useBudget.ts` -- `useDeleteBudgetCategory` mutation (likely unchanged)
- `apps/desktop/src/locales/en.json` / `fr.json` -- optional i18n keys if messages are user-facing from frontend; prefer backend validation messages passed through toast for this fix
- `apps/desktop/src-tauri/src/db/budget.rs` (tests) or new test module -- unit tests for dependency blocking
- `apps/desktop/tests/budget.spec.ts` -- extend mock + E2E for blocked delete messaging

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/budget.rs` -- Replace blind `DELETE` with dependency checks: count expenses and recurring templates; if either > 0 return `AppError::Validation` with actionable message; if only merchant hints exist, delete hints then category inside a transaction -- prevents opaque FK failures
- [x] `apps/desktop/src-tauri/src/db/budget.rs` -- Add unit tests for happy path, expense block, recurring block, and hints-only delete -- locks behavior without relying on E2E mocks that skip FK
- [x] `apps/desktop/src/components/budget/BudgetGroupCard.tsx` -- In `handleDeleteCategory` `onError`, show `err.message` in toast (fallback to existing string); do not close dialog on error so user can read message and cancel -- matches group-delete error surfacing pattern
- [x] `apps/desktop/src/locales/en.json` and `fr.json` -- Add translation keys for new validation messages if emitted from backend via a stable code, OR keep English backend messages and pass through toast (minimal scope: pass-through first)
- [x] `apps/desktop/tests/budget.spec.ts` -- Add test: category with mocked dependent expense rejects delete and shows specific error text in toast -- prevents regression to silent generic failure

**Acceptance Criteria:**
- Given a budget category with no linked expenses, recurring templates, or merchant hints, when the user confirms delete, then the category is removed and a success toast appears
- Given a budget category with at least one expense, when the user confirms delete, then deletion is blocked and the toast explains that expenses must be deleted or reassigned first
- Given a budget category with a recurring expense template, when the user confirms delete, then deletion is blocked and the toast explains the recurring template must be removed first
- Given a budget category with only merchant category hints, when the user confirms delete, then hints are cleaned up and the category is deleted successfully
- Given any validation error during delete, when the error toast appears, then the dialog remains open until the user explicitly cancels

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo test budget::` -- expected: new delete dependency tests pass
- `cd apps/desktop && pnpm exec playwright test budget.spec.ts -g "deleting a category"` -- expected: existing happy-path delete test still passes
- `cd apps/desktop && pnpm exec playwright test budget.spec.ts -g "blocked"` -- expected: new blocked-delete test passes (after adding)

**Manual checks:**
- In the running app, create a category, add an expense to it, attempt delete — confirm actionable error toast (not generic failure)
- Delete a category with no dependencies — confirm still works

## Suggested Review Order

**Dependency checks before delete**

- Pre-check expenses and recurring templates; return validation errors instead of opaque FK failures
  [`budget.rs:232`](../../apps/desktop/src-tauri/src/db/budget.rs#L232)

**UI error surfacing**

- Show backend validation message in toast; keep dialog open on failure
  [`BudgetGroupCard.tsx:141`](../../apps/desktop/src/components/budget/BudgetGroupCard.tsx#L141)

**Tests**

- Unit tests for blocked delete paths and hint cleanup
  [`budget.rs:369`](../../apps/desktop/src-tauri/src/db/budget.rs#L369)

- E2E test for actionable error toast when category has expenses
  [`budget.spec.ts:494`](../../apps/desktop/tests/budget.spec.ts#L494)
