---
title: 'Show category groups during AI statement import'
type: 'feature'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '400ded218601ca997d710454305254f923ad84de'
context:
  - 'docs/project-context.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Import review shows only category names. When two budget groups contain categories with the same name, users cannot tell which category the AI selected or which one they are choosing.

**Approach:** Keep the category as the primary value, show its parent group as always-visible muted context, and reuse the existing grouped-dropdown pattern already used by expense forms. Resolve group names client-side from existing category and group data; no AI or backend contract changes are needed.

## Boundaries & Constraints

**Always:** Show the parent group anywhere Import displays or selects a category: auto-categorized rows, flagged review cards, merchant-wide assignment, bulk assignment, unreadable-line entry, and AI category proposals. Keep category names visually primary, group names secondary, and group dropdown options under `SelectGroupLabel` headings. Preserve keyboard behavior, labels, validation, selection state, and English/French parity.

**Ask First:** Any change to the approved always-visible presentation or to category/group persistence semantics.

**Never:** Change the AI response schema, Rust commands, database queries, category identity, import confirmation behavior, or unrelated expense/budget UI. Do not combine group and category into a new persisted value.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Duplicate names | `Group A` and `Group B` both contain `Cat C` | Closed Import controls show `Cat C` with the selected group in muted text; open menus place each `Cat C` under its own group heading | N/A |
| No category selected | Flagged/manual row has no category id | Existing placeholder and validation remain; no stale group caption appears | Existing blocked/required state remains unchanged |
| AI proposes category | Proposal references an existing group id or a new group name | Proposal copy identifies both proposed category and parent group | Existing creation retry/error behavior remains unchanged |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/expenses/ExpenseList.tsx:182-220` -- shipped reference for `SelectGroup` and `SelectGroupLabel`; read-only pattern source.
- `apps/desktop/src/components/import/AutoCategorizedSummary.tsx:168-207` -- expanded auto-categorized category selector.
- `apps/desktop/src/components/import/TransactionReviewCard.tsx:128-195` -- flagged selector and proposed-category message.
- `apps/desktop/src/components/import/MerchantGroup.tsx:43-100` -- repeated-merchant category assignment.
- `apps/desktop/src/routes/import.tsx:191-219,592-729,769-945` -- category/group data loading, bulk assignment, and unreadable-line selection.
- `apps/desktop/src/hooks/useBudget.ts:13-18` -- existing `useBudgetGroups()` query to reuse.
- `apps/desktop/src/lib/types.ts:1-16` -- canonical `BudgetGroup` and `BudgetCategory` shapes.
- `apps/desktop/tests/import.spec.ts:3-228,484-535` -- Import mocks and user-visible review coverage.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/import.spec.ts` -- add two same-named categories in different groups, mock `get_budget_groups`, and first prove closed values, group headings, and proposal group context fail without the feature.
- [x] `apps/desktop/src/components/import/ImportCategorySelect.tsx` -- compose the existing Select primitives into a reusable Import-only selector with grouped options and an always-visible muted selected-group label.
- [x] `apps/desktop/src/components/import/{AutoCategorizedSummary,TransactionReviewCard,MerchantGroup}.tsx` -- replace flat selectors with the shared Import selector while preserving each control's existing behavior.
- [x] `apps/desktop/src/routes/import.tsx` -- load groups with `useBudgetGroups`, pass them to every Import category surface, use the shared selector for bulk/manual controls, and resolve proposal group names.
- [x] `apps/desktop/src/locales/{en,fr}.json` -- add parallel proposal copy that includes category and group placeholders.

**Acceptance Criteria:**
- Given duplicate category names in different groups, when any Import review category is visible, then its parent group is visible without opening the menu.
- Given the category menu is opened, when duplicate names are listed, then each appears under the correct group heading and selecting either preserves its distinct category id.
- Given an AI category proposal, when its group is existing or newly proposed, then the proposal identifies that group without changing creation behavior.
- Given English or French locale, when the feature renders, then all static copy is localized and category/group user data is unchanged.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero type errors.
- `pnpm --filter @nixus/desktop exec playwright test tests/import.spec.ts` -- expected: all Import scenarios pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production build exits successfully.

**Manual checks (if no CLI):**
- At 1024px (the shipped Tauri `minWidth`) and 1280px, inspect the Import review with duplicate names; group context remains legible, controls do not overflow, and keyboard selection works.

## Suggested Review Order

**Selector behavior**

- Centralizes grouped options, resilient fallbacks, label hierarchy, and accessible context.
  [`ImportCategorySelect.tsx:58`](../../apps/desktop/src/components/import/ImportCategorySelect.tsx#L58)

- Fetches existing groups and threads them through every Import category surface.
  [`import.tsx:218`](../../apps/desktop/src/routes/import.tsx#L218)

- Preserves visible group context in the compact bulk-assignment control.
  [`import.tsx:779`](../../apps/desktop/src/routes/import.tsx#L779)

**Review surfaces**

- Reuses the selector for auto-categorized transactions without changing row behavior.
  [`AutoCategorizedSummary.tsx:173`](../../apps/desktop/src/components/import/AutoCategorizedSummary.tsx#L173)

- Shows group-aware flagged selections and honest proposed-category group copy.
  [`TransactionReviewCard.tsx:154`](../../apps/desktop/src/components/import/TransactionReviewCard.tsx#L154)

- Applies the same grouped selection to repeated-merchant assignment.
  [`MerchantGroup.tsx:39`](../../apps/desktop/src/components/import/MerchantGroup.tsx#L39)

**Verification**

- Proves duplicate identity, fallback availability, long labels, sticky headings, and keyboard flow.
  [`import.spec.ts:792`](../../apps/desktop/tests/import.spec.ts#L792)

- Pins English/French key and interpolation parity for the new copy.
  [`import-category-group-i18n.test.ts:19`](../../apps/desktop/src/locales/__tests__/import-category-group-i18n.test.ts#L19)
