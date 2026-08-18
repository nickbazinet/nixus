---
title: 'Retirement Matrix Dynamic Controls'
type: 'feature'
created: '2026-08-18'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '2c66d056'
context:
  - docs/guidelines/warnings.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The retirement heatmap's 36 cells are entirely derived — rows from surplus, columns from a fixed `[5,10,15,20,25,30]`-year list — so users can't ask "what if I saved more" or "what if my horizon were shorter."

**Approach:** Per UX consultation (Sally), add two ephemeral, non-persisted controls above the grid: a `Slider` overriding the tier-ladder anchor, and a horizon-zoom `PillTabs` (6y/12y/30y, mirroring `insights.projection.tsx`) changing the year step. Grid recomputes live. Pinned row stays at `CURRENT_PACE_TIER_INDEX`; label/headline flip between "current pace" and "exploring."

## Boundaries & Constraints

**Always:**
- `computeRetirementMatrix(..., options?)` gains optional `{ anchorMonthlyCents?; horizons?: readonly number[] }`; omitted = today's exact output.
- Explicit `anchorMonthlyCents` bypasses the `$100` floor; rounds to `$50`; slider step `5000`c, range `0..max(2×derivedSurplusCents, 200_00)`.
- Horizon pills `["6y","12y","30y"]` → step 1/2/5yr, `horizons=[step..step*6]`; default `"30y"` matches today's `RETIREMENT_HORIZONS_YEARS`.
- Neither control persists (`useState` only); anchor re-syncs via `useEffect`+`dirty`, reusing `RetirementSettingsPanel`'s pattern verbatim.
- Pinned-row label toggles `"(current pace)"`/`"(exploring)"`; headline switches wording once anchor is touched (reuse `earliestAchievedYears` logic, new i18n keys).
- Reset chip shows only when anchor ≠ derived surplus; click reverts both.
- New `packages/shared/src/ui/slider.tsx` wraps `@base-ui/react/slider` (existing dep) per `switch.tsx` conventions; thumb `bg-brand-on` on `bg-brand` track; hit target ≥ `size-target-min`; `aria-valuetext` via `useFormatCurrency`.
- `<td>` gets `transition-colors` (existing reduced-motion override applies). New i18n keys in both locales (parity via `retirement-i18n.test.ts`).

**Ask First:** None — design confirmed via UX consult.

**Never:** No formula changes. No persistence of anchor/horizon. No per-cell/header inline editing. No Rust/backend changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Default load | untouched | Byte-identical to current output; "(current pace)" |
| Anchor dragged | slider moved | Live recompute; label/headline→"exploring"; reset chip appears |
| Reset clicked | click chip | Reverts anchor+label+headline+chip |
| Anchor = $0 | explicit override | All 6 rows $0; differ only by column |
| Horizon zoom | pick 6y/12y/30y | Columns→`+step..+step*6`; nest-egg row+colors recompute |
| Re-settle mid-explore | new surplus while dirty | Slider does not snap to new value |
| Values hidden | privacy on | Readout+rows mask via `useFormatCurrency`; drag still works |

</frozen-after-approval>

## Code Map

- Reference patterns: `packages/shared/src/ui/switch.tsx` (base-ui wrap), `pill-tabs.tsx` (reuse as-is), `apps/desktop/src/routes/insights.projection.tsx:23-39,73-86` (`PageHeader actions` placement), `.../RetirementSettingsPanel.tsx:24-38` (dirty-sync), `.../useFormatCurrency.ts` (masking)
- `packages/shared/src/ui/slider.tsx`, `index.ts` -- new `Slider` + export
- `apps/desktop/src/components/retirement/RetirementControls.tsx` -- new: anchor slider+reset chip+horizon pills
- `apps/desktop/src/components/retirement/RetirementMatrix.tsx` -- modify: `isExploring` prop, conditional label/headline, `transition-colors`
- `apps/desktop/src/routes/insights.retirement.tsx` -- modify: anchor/horizon state, dirty-sync, `useMemo` deps, `PageHeader actions`
- `apps/desktop/src/lib/retirement.ts` -- modify: `computeTiersMonthlyCents`/`computeRetirementMatrix` gain `options`
- `apps/desktop/src/lib/retirement.test.ts` -- add options/floor-bypass/horizon-step cases
- `apps/desktop/src/locales/en.json`, `fr.json` -- add 7 `retirement.*` keys: anchorLabel, anchorReset, horizonLabel, horizonNext6/12/30, exploringPace, headlineExploringWithAge, headlineExploringNotAchieved

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/ui/slider.tsx`, `index.ts` -- add `Slider` per `switch.tsx` conventions
- [x] `apps/desktop/src/lib/retirement.ts` -- add `options` bag; explicit anchor bypasses `$100` floor
- [x] `apps/desktop/src/lib/retirement.test.ts` -- test options defaults, floor bypass, horizon steps
- [x] `apps/desktop/src/components/retirement/RetirementControls.tsx` -- new control bar
- [x] `apps/desktop/src/components/retirement/RetirementMatrix.tsx` -- conditional label/headline, `transition-colors`
- [x] `apps/desktop/src/routes/insights.retirement.tsx` -- wire state (via new `useDirtyTrackedValue` hook), a control-bar `Card` above the grid (not `PageHeader actions` — didn't fit the header row alongside slider+chip+pills; see Verification)
- [x] `apps/desktop/src/locales/en.json`, `fr.json` -- add keys per Code Map (parity via `retirement-i18n.test.ts`)

**Acceptance Criteria:**
- Given `options` is omitted, then `computeRetirementMatrix` output is byte-identical to today's
- Given the anchor slider is focused, then `aria-valuetext` announces the dollar amount, or "Amount hidden" when values-privacy is on
- Given new i18n keys, then `retirement-i18n.test.ts` parity passes for both locales

## Spec Change Log

## Design Notes

Rejected: per-cell/header inline editing (`InlineEditMoney`) — breaks the ladder's regular scale. Resolved via UX consultation (Sally) before drafting.

## Verification

**Commands (ran, final):**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- clean
- `pnpm --filter @nixus/desktop exec vitest run` -- 273/273 passed (17 files)
- `pnpm --filter @nixus/desktop build` -- exit 0
- `cargo build` (`apps/desktop/src-tauri`) -- exit 0, zero warnings
- `cargo test` (`apps/desktop/src-tauri`) -- 673/673 passed
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement-controls.spec.ts tests/retirement.spec.ts tests/navigation.spec.ts` -- 32/32 passed

**Manual checks (done):**
- Dragged anchor slider on `/insights/retirement`; cell colors updated live, no debounce
- Toggled values-privacy + switched horizon pills; both updated without reload

**Matrix Test Audit:** all 7 I/O rows covered by `apps/desktop/tests/retirement-controls.spec.ts`; the "Re-settle mid-explore" row is covered by `useDirtyTrackedValue.test.tsx` (`does not overwrite the current value when the derived input changes while dirty`) after extracting the anchor dirty-sync logic into a reusable `apps/desktop/src/hooks/useDirtyTrackedValue.ts` hook.

**Deviations from Boundaries (implementer's judgment, not renegotiated):**
- Controls render in a `Card` above the grid, not `PageHeader actions` — a slider+readout+chip+pills doesn't fit the header's single-row layout.
- `isExploring`/reset-chip visibility use a value-comparison (`anchorCents !== derivedAnchorCents`) rather than the `dirty` flag, so dragging back onto the derived value returns to "current pace" instead of stranding the page in "exploring" with no reset affordance.
