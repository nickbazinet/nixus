---
title: 'Improve Date Picker Navigation Stability'
type: 'bugfix'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f84c93119571a9090fa17a0361a577a1124d5c1b'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The visible month-navigation buttons have only a 28px clickable box, so clicking near an arrow frequently misses. Months with different week counts also resize the calendar and make Base UI re-evaluate collision placement, which can move an open picker from below its field to above it while the pointer remains on a navigation arrow.

**Approach:** Preserve the compact visual controls while expanding each standard month arrow's effective pointer target to a 44px square. Render date-picker calendars with a fixed six-week grid so their height does not change between months; Base UI remains free to choose the safe side when the picker opens, but month navigation no longer causes a side change.

## Boundaries & Constraints

**Always:** Keep the existing visual treatment, focus ring, keyboard semantics, date value contract, dropdown-caption layout, and initial viewport collision avoidance. Apply the stable six-week behavior to the shared `DatePicker`, not unrelated standalone `Calendar` consumers. Cover both pointer targeting and month-height stability with Playwright.

**Ask First:** Any dependency upgrade, visible enlargement of the arrow buttons, or change that affects every shared popover.

**Never:** Disable collision avoidance and permit viewport clipping; use Base UI's internal unsupported `lazyFlip`; modify `MonthNavigator`; add a new component or dependency; alter date formatting, selection, validation, or storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Arrow-edge click | Pointer lands within the 44px target but outside the visible 28px arrow button | The corresponding adjacent month opens | No-op clicks are a test failure |
| Variable-length months | Navigate between months that naturally use five and six week rows | Calendar retains six rows and the open popover remains on its initial side | Picker stays usable within viewport collision rules |
| Dropdown caption | Date picker uses month/year dropdowns | Existing compact dropdown caption and navigation remain usable | No layout regression |

</frozen-after-approval>

## Code Map

- `packages/shared/src/ui/calendar.tsx` -- `button_previous` and `button_next` own the 28px standard-caption arrow boxes; add non-dropdown pseudo-element hit areas without changing their visible geometry.
- `packages/shared/src/ui/date-picker.tsx` -- shared date-field composition; pass `fixedWeeks` to `Calendar` so all date pickers have invariant month height while leaving standalone calendars unchanged.
- `packages/shared/src/ui/button.tsx` -- read-only evidence: button styles provide a 24px minimum target and disable pointer events on SVGs, so the target extension belongs on calendar navigation buttons.
- `packages/shared/src/ui/popover.tsx` -- read-only evidence: Base UI `Positioner` uses default collision flipping; do not weaken it or add unsupported `lazyFlip` plumbing.
- `apps/desktop/tests/import.spec.ts` -- existing date-picker flow coverage; extend it with edge-coordinate month clicks, six-row assertions, and stable-side geometry at a constrained viewport.
- `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md` -- interaction contract: compact desktop controls may separate visual size from hit area; preserve focus and Quiet Ledger styling.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/import.spec.ts` -- add failing scenarios for the expanded arrow targets and fixed-height month navigation before production changes.
- [x] `packages/shared/src/ui/calendar.tsx` -- expand only standard-caption arrow hit testing to 44px through transparent generated boxes, preserving the visible 28px controls and dropdown layout.
- [x] `packages/shared/src/ui/date-picker.tsx` -- enable react-day-picker's supported `fixedWeeks` behavior for shared date fields.

**Acceptance Criteria:**
- Given a standard date picker is open, when the pointer clicks any part of either arrow's 44px target, then the calendar moves exactly one month in that direction.
- Given a constrained viewport and an open date picker, when navigation crosses months with different natural week counts, then the calendar stays on the side of the field chosen when it opened.
- Given a keyboard or dropdown-caption user, when navigating the calendar, then existing focus, activation, and dropdown behavior remain unchanged.

## Spec Change Log

- 2026-09-15: Visual review exposed fixed-week padding days inheriting the day-button ink and long dropdown month names touching navigation arrows. The calendar now applies outside/selected ink directly to day buttons and reserves wider dropdown-caption gutters.

## Design Notes

The recommended approach fixes the resize trigger rather than fighting positioning. `fixedWeeks` keeps collision avoidance correct on open and removes month-to-month height changes. Disabling `collisionAvoidance.side` would stop flipping but could clip the picker; Base UI 1.4.0's `lazyFlip` is internal and unavailable to `Popover.Positioner`. For hit targets, a transparent pseudo-element preserves the current 28px visual square while providing the requested 44px pointer square; visibly enlarging the controls would create avoidable caption-layout changes.

## Verification

**Commands:**
- `pnpm --filter @nixus/shared exec tsc --noEmit` -- expected: zero type errors.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero type errors.
- `pnpm --filter @nixus/desktop exec playwright test tests/import.spec.ts` -- expected: date-picker interaction scenarios pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop suite passes.

**Manual checks (if no CLI):**
- At constrained and normal window heights, open a date picker above and below available-space thresholds, click both arrows at their visual edges, and confirm the popup does not cross the field while changing months.
