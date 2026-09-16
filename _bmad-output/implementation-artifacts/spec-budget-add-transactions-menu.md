---
title: 'Consolidate Budget transaction actions'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2b86f53c04b3a0a953e4259bbdafaabb1044735c'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Spending > Budget already exposes several competing calls to action, but statement import is absent even though it is a primary transaction-entry workflow.

**Approach:** Replace the summary strip's standalone Add Expense button with one Add transactions menu containing Import statement, Add expense manually, and Apply recurring expenses. Leave Add Group as the only page-header action and retain contextual per-category expense actions.

## Boundaries & Constraints

**Always:** Use the shared Base UI dropdown primitives, existing visual tokens, i18n, and the dedicated `/import` route. Preserve existing mutation success/error feedback and disable recurring application while its mutation is pending. Keep the menu keyboard-accessible and expose stable Playwright selectors.

**Ask First:** Any change to import processing, expense forms, recurring-expense behavior, navigation architecture, or the shared dropdown primitive.

**Never:** Add a new tab, card, banner, floating action, modal import flow, dependency, visual token, or standalone third header CTA. Do not remove contextual category-level Add Expense actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Menu discovery | Budget page is open | Add transactions opens a three-item menu; Add Group remains the sole header action | N/A |
| Statement import | User selects Import statement | Navigate to `/import` | Existing import route owns failures |
| Manual expense | User selects Add expense manually | Existing expense slide-over opens | Existing form handling remains unchanged |
| Recurring apply | User selects Apply recurring expenses | Existing mutation runs for the selected month and preserves success feedback | Existing error toast remains unchanged; item is disabled while pending |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/routes/spending.budget.tsx:83-136` -- owns header actions, selected-month recurring mutation, toasts, and summary callbacks; remove the standalone recurring button and pass its callback/state into the summary.
- `apps/desktop/src/components/budget/BudgetSummaryStrip.tsx:59-100` -- replace the summary Add Expense button with the shared dropdown composition.
- `apps/desktop/src/components/auth/ProfileMenu.tsx:149-286` -- read-only reference for Base UI trigger and router-Link-backed menu items.
- `apps/desktop/src/components/projects/ProjectRowMenu.tsx:71-113` -- read-only reference for concise icon-and-label action items.
- `apps/desktop/src/locales/en.json` and `fr.json` -- add the Add transactions trigger and manual-entry labels; reuse existing import and recurring labels.
- `apps/desktop/src/locales/__tests__/` -- lock bilingual availability of the new keys.
- `apps/desktop/tests/budget.spec.ts:23-324,1020-1051` -- IPC fixture and user-facing Budget flow coverage; add the recurring command stub and menu interaction scenario.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/budget.spec.ts` -- add a failing Given/When/Then menu-flow test before production changes.
- [x] `apps/desktop/src/locales/en.json`, `fr.json`, and a focused locale test -- define and verify bilingual menu copy.
- [x] `BudgetSummaryStrip.tsx` and `spending.budget.tsx` -- compose the approved menu and preserve existing callbacks, pending state, navigation, and toasts.

**Acceptance Criteria:**
- Given the Budget tab, when the user opens Add transactions, then exactly the three approved transaction-entry choices are available and Apply recurring is absent from the page header.
- Given each menu choice, when selected, then it performs its existing import, manual-entry, or recurring-expense behavior.
- Given keyboard navigation or a pending recurring mutation, when interacting with the menu, then focus semantics remain valid and duplicate recurring submissions are prevented.

## Spec Change Log

## Design Notes

The summary strip is the transaction-entry locus because it already pairs current spending totals with Add Expense. Consolidating all three ingestion methods there uses progressive disclosure while preserving Add Group as a structurally distinct budget-building action.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec playwright test tests/budget.spec.ts` -- focused interaction coverage passes.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero TypeScript errors.
- `pnpm --filter @nixus/desktop test` -- locale/unit tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- full desktop E2E suite passes.

**Manual checks (if no CLI):**
- Render Budget at desktop width and verify the header and summary preserve a clean one-primary-action hierarchy in both themes.

## Suggested Review Order

**Interaction hierarchy**

- The summary owns one progressive-disclosure entry point for all transaction methods.
  [`BudgetSummaryStrip.tsx:104`](../../apps/desktop/src/components/budget/BudgetSummaryStrip.tsx#L104)

- The page header now reserves its only action for budget structure.
  [`spending.budget.tsx:101`](../../apps/desktop/src/routes/spending.budget.tsx#L101)

- Existing recurring mutation feedback and selected-period behavior remain at the route boundary.
  [`spending.budget.tsx:83`](../../apps/desktop/src/routes/spending.budget.tsx#L83)

**Copy and accessibility**

- New menu labels remain bilingual and reuse the established import wording.
  [`en.json:189`](../../apps/desktop/src/locales/en.json#L189)

- Locale tests protect menu copy and interpolation assumptions.
  [`budget-add-transactions-i18n.test.ts:8`](../../apps/desktop/src/locales/__tests__/budget-add-transactions-i18n.test.ts#L8)

**Behavioral verification**

- Menu tests cover hierarchy, navigation, forms, recurring outcomes, keyboard use, and French width.
  [`budget.spec.ts:1200`](../../apps/desktop/tests/budget.spec.ts#L1200)

- Existing expense scenarios now enter through the consolidated manual-entry choice.
  [`expenses.spec.ts:395`](../../apps/desktop/tests/expenses.spec.ts#L395)
