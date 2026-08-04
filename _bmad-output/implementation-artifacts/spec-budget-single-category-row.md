---
title: 'Budget: collapse duplicated category rows into one row'
type: 'refactor'
created: '2026-08-01'
status: 'in-review'
baseline_commit: 'ea8f35f'
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every budget category renders twice in a group card: an editable row (name + mini progress bar + target + delete) followed by a status row (chevron + same name + spent/target + badge + full progress bar). The repeated name and bar add no information and double the page height.

**Approach:** Merge them into one row per category that keeps every capability exactly once — inline-edit name, `spent / target` with the target inline-editable, status badge, one progress bar, delete button, chevron to expand expenses.

## Boundaries & Constraints

**Always:**
- Preserve behaviour: rename, edit target, delete, expand/collapse expenses, badge thresholds, bar colours, `role="progressbar"` attributes.
- Preserve existing `data-testid` values so both Playwright suites pass unmodified: `budget-category-row`, `budget-status-row`, `category-name`, `category-target`, `spent-target`, `status-badge`, `progress-bar`, `progress-bar-fill`, `category-expand-toggle`, `category-expenses`, `delete-category-button`, `archived-budget-category-row`, `archived-category-badge`.
- Archived (soft-deleted) categories stay read-only with their "Archived" badge, single row too.
- All strings via i18next.

**Ask First:** removing/renaming any `data-testid`; dropping any capability instead of de-duplicating it.

**Never:** touch Rust/DB/IPC/hooks; change the group header, add-category form, or delete dialogs; keep whole-row click-to-expand (conflicts with inline edit — the chevron becomes the affordance).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active category | status present, `target_cents > 0` | One row: name, `spent / target` (target editable), badge, bar, delete on hover | N/A |
| Status missing | no `statusByCategory` entry yet | Row renders with name + editable target, spent `$0.00`, ratio 0 | N/A |
| Zero target | `target_cents === 0` | Bar at 0% width | Ratio guarded to 0 |
| Archived | `status.is_deleted`, not in active list | Read-only row: muted name + "Archived" badge + spent/target + bar + expand | N/A |
| Click name or target | any | Inline editor opens; row does not expand/collapse | Click must not bubble to toggle |
| Click chevron | any | Expense list toggles; no editor opens | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/budget/BudgetCategoryRow.tsx` -- status row; becomes the single merged row component
- `apps/desktop/src/components/budget/BudgetGroupCard.tsx` -- duplicate editable row at lines ~242-316 moves into `BudgetCategoryRow`, leaving handler wiring
- `apps/desktop/src/components/shared/InlineEdit.tsx` -- `InlineEditText` / `InlineEditMoney`, reused as-is
- `apps/desktop/tests/budget.spec.ts` -- asserts `budget-category-row`, `category-target`, `spent-target`, `status-badge`, `progress-bar`
- `apps/desktop/tests/expenses.spec.ts` -- scopes `category-expand-toggle` inside `budget-status-row`

## Tasks & Acceptance

**Execution:**
- [x] `BudgetCategoryRow.tsx` -- props become `{ category: BudgetCategoryStatus; expenses?: Expense[]; striped?: boolean; archived?: boolean; onRename?: (name: string) => void; onUpdateTarget?: (cents: number) => void; onDelete?: () => void }`; render one header row (chevron + name + `spent / target` + badge + delete) above the progress bar and expense list; inline editors only when the matching handler is passed -- one row is the point of the change
- [x] `BudgetCategoryRow.tsx` -- keep `budget-status-row` on the outer wrapper, put `budget-category-row` on the header row, nest `category-target` inside the `spent-target` span -- avoids rewriting two E2E suites
- [x] `BudgetGroupCard.tsx` -- delete the duplicate editable row JSX and mini progress bar; render `BudgetCategoryRow` once per active category (`striped`, `onRename`, `onUpdateTarget`, `onDelete`) and once per archived status (`archived`, inside the `archived-budget-category-row` div) -- single source of row markup
- [x] `BudgetGroupCard.tsx` -- remove imports/locals left unused (`InlineEditText`, `InlineEditMoney`, `Badge`, `formatCurrency` if unreferenced) -- `noUnusedLocals` fails the build otherwise
- [x] `locales/en.json`, `locales/fr.json` -- add `budget.expandCategory` / `budget.collapseCategory` -- the chevron button needs an i18n `aria-label`
- [x] `shared/InlineEdit.tsx` -- `InlineEditMoney` edit-mode wrapper `div` → `span.inline-flex` -- keeps valid HTML nesting inside the `spent-target` span so the row does not reflow while editing

**Acceptance Criteria:**
- Given a group with categories, when the Budget page renders, then each category's name, progress bar, and target appear exactly once.
- Given a category row, when the target is clicked and a new value saved, then the row shows the new target and a success toast appears.
- Given a category row, when the chevron is clicked, then the expense list expands and no inline editor opens.
- Given the desktop app, when `pnpm --filter @nixus/desktop build` runs, then it exits 0 with no TS errors.
- Given the existing budget and expenses Playwright suites, when they run, then no test file needs editing and no previously passing test fails.

## Spec Change Log

## Design Notes

Amount pair keeps spend context while leaving the target editable:

```tsx
<span className="font-mono text-sm" data-testid="spent-target">
  {formatCurrency(category.spent_cents)} / {onUpdateTarget
    ? <InlineEditMoney value={category.target_cents} onSave={onUpdateTarget} data-testid="category-target" />
    : <span data-testid="category-target">{formatCurrency(category.target_cents)}</span>}
</span>
```

`BudgetGroupCard` must synthesize a status (`spent_cents: 0`, `is_deleted: false`) when `statusByCategory` has no entry, so a freshly created category renders immediately.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop build` -- expected: exit 0, no TS errors
- `pnpm --filter @nixus/desktop exec playwright test tests/budget.spec.ts` -- expected: no new failures vs. pre-change baseline
- `pnpm --filter @nixus/desktop exec playwright test tests/expenses.spec.ts` -- expected: no new failures vs. pre-change baseline

**Manual checks:**
- Screenshot the Budget page: one row per category; name, bar, and target each appear once; badge and delete-on-hover still work.
