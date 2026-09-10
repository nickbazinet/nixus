---
title: 'Collapse the suggested monthly split by default'
type: 'feature'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Suggested monthly split card opens at full height whenever it is shown, pushing the project list down even when the user does not need to review the recommendation.

**Approach:** Make the existing card an accessible disclosure that is collapsed by default. Reuse the Projects and Budget chevron-button convention, preserving all current content and behavior when expanded.

## Boundaries & Constraints

**Always:** Keep the card title visible while collapsed; expose the state through `aria-expanded` and localized expand/collapse labels; preserve every existing control and calculation unchanged when expanded; retain all unrelated working-tree edits.

**Ask First:** Any persistence of the disclosure state across navigation or application launches; any redesign of the card contents.

**Never:** Remove current content, actions, translations, tests, or unrelated in-progress changes; introduce a new dependency or shared abstraction; perform git operations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initial render | Suggestions exist | Card title and expand control are visible; body and footer are not rendered | N/A |
| Expand | User activates the disclosure | Existing intro, allocation rows, summary, account selector, and actions render unchanged | N/A |
| Collapse | Expanded card is activated again | Body and footer stop rendering; title remains visible | N/A |
| No suggestions | Empty suggestion list | Existing behavior remains: no card renders | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx` -- Add local default-collapsed state and the established chevron disclosure control; conditionally render the existing content/footer without changing their internals.
- `apps/desktop/src/routes/wealth.projects.tsx` -- Seed the panel expanded only when the user explicitly reopens a settled month's split.
- `apps/desktop/src/components/budget/BudgetGroupCard.tsx` -- Read-only precedent for ghost icon button, chevrons, `aria-expanded`, and conditional card content.
- `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` -- Add localized expand/collapse accessible names.
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` -- Keep explicit projects-surface translation coverage complete.
- `apps/desktop/tests/projects.spec.ts` -- Lock initial collapsed state, expansion/collapse behavior, and expand the panel before existing interior-flow assertions.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/projects.spec.ts` -- Add a failing disclosure behavior test and update existing setup to expand before interacting with the card body.
- [x] `apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx` -- Add the accessible default-collapsed disclosure using the existing project convention.
- [x] `apps/desktop/src/routes/wealth.projects.tsx` -- Preserve the explicit settled-card reopen flow by mounting the disclosure expanded.
- [x] `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`, and `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` -- Add and cover the accessible labels in both languages.

**Acceptance Criteria:**
- Given suggestions exist, when the Projects tab loads, then only the card header is initially visible and the toggle reports `aria-expanded="false"`.
- Given the card is collapsed, when the user activates its toggle, then every pre-existing body and footer control is visible and the toggle reports `aria-expanded="true"`.
- Given the card is expanded, when the user activates its toggle again, then the body and footer are hidden without losing or changing any existing card content in source.
- Given either supported locale, when assistive technology reaches the toggle, then its accessible name accurately describes the available expand or collapse action.

## Spec Change Log

- Review found that an explicit settled-card reopen would otherwise remount the new disclosure collapsed. Added the route integration and tests while preserving the default-collapsed state for ordinary and stale-month loads. Verification review also added rendered French expand/collapse accessible-name coverage.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop test -- projects-i18n.test.ts` -- expected: locale coverage passes.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero type errors.
- `pnpm --filter @nixus/desktop exec playwright test tests/projects.spec.ts` -- expected: all Projects scenarios pass.

**Manual checks:**
- At the minimum desktop viewport, confirm the collapsed card retains the established card/header appearance and that mouse and keyboard activation reveal and hide the unchanged body.

## Suggested Review Order

**Disclosure behavior**

- Seeds default and explicit-reopen states, then conditionally renders the unchanged panel body.
  [`SuggestedAllocationPanel.tsx:60`](../../apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx#L60)

- Connects settled-card reopening to the panel's initial expanded state.
  [`wealth.projects.tsx:188`](../../apps/desktop/src/routes/wealth.projects.tsx#L188)

**Accessibility and localization**

- Supplies English expand and collapse action names.
  [`en.json:1367`](../../apps/desktop/src/locales/en.json#L1367)

- Supplies equivalent French action names.
  [`fr.json:1367`](../../apps/desktop/src/locales/fr.json#L1367)

**Regression coverage**

- Verifies default collapse, keyboard toggling, state retention, and localized names.
  [`projects.spec.ts:1133`](../../apps/desktop/tests/projects.spec.ts#L1133)

- Verifies explicit confirmed and skipped settlement reopen paths start expanded.
  [`projects.spec.ts:1570`](../../apps/desktop/tests/projects.spec.ts#L1570)
