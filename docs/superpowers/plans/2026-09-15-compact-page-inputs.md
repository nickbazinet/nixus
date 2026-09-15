# Compact Page Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the three approved page-level money inputs visually proportional to their short values instead of stretching across wide cards.

**Architecture:** Preserve the shared `MoneyInput` default and all bounded form layouts. Apply the existing `className` extension point only at the two retirement pension fields and the budget category target, using `w-full max-w-48` so each field can shrink below its 12rem desktop cap.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS 4, Playwright.

## Global Constraints

- Change only page-level money fields in the retirement assumptions card and inline budget-category form.
- Keep dialogs, slide-overs, onboarding, free-text fields, and shared primitive defaults unchanged.
- Preserve labels, help text, validation, focus behavior, localization, and money formatting.
- Do not add dependencies or commit unless explicitly requested.

---

### Task 1: Page-level compact-width regression coverage

**Files:**
- Create: `apps/desktop/tests/compact-page-inputs.spec.ts`

**Interfaces:**
- Consumes: existing retirement and budget routes with browser-level Tauri IPC mocks.
- Produces: width assertions for `#retirement-government-pension`, `#retirement-employer-pension`, and the visible `#cat-target-<groupId>` control.

- [ ] Add focused retirement and budget fixtures that render the affected page-level forms at a wide desktop viewport.
- [ ] Assert each affected input has a rendered width no greater than 192 CSS pixels and that its containing card is wider than the input.
- [ ] Run `pnpm --filter @nixus/desktop exec playwright test tests/compact-page-inputs.spec.ts` and confirm the assertions fail because the controls still inherit `w-full`.

### Task 2: Focused compact sizing and release gates

**Files:**
- Modify: `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx`
- Modify: `apps/desktop/src/components/budget/BudgetGroupCard.tsx`
- Test: `apps/desktop/tests/compact-page-inputs.spec.ts`

**Interfaces:**
- Consumes: `MoneyInput`'s existing `className?: string` support.
- Produces: responsive `w-full max-w-48` sizing at exactly three call sites.

- [ ] Add `className="w-full max-w-48"` to both retirement pension `MoneyInput` instances and the inline budget target `MoneyInput`.
- [ ] Re-run the focused Playwright spec and confirm both page scenarios pass.
- [ ] Run `pnpm --filter @nixus/desktop exec tsc --noEmit`, `pnpm --filter @nixus/desktop build`, and `pnpm --filter @nixus/desktop exec playwright test` once.
- [ ] Drive the retirement and budget pages in Chrome at representative desktop widths; inspect normal and focus states and confirm there is no horizontal overflow.
