---
title: "Retirement Matrix: Today's-Dollars Display with Future-Value Detail"
type: 'feature'
created: '2026-08-18'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '2c66d056'
context:
  - docs/guidelines/warnings.md
  - _bmad-output/implementation-artifacts/spec-retirement-projection.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Nest egg needed" and every cell show nominal (future-inflated) dollars, so later columns display bigger numbers than earlier ones even though, in today's purchasing power, retiring earlier genuinely needs more — the matrix's own legend claims "retiring earlier needs a bigger cushion" while the numbers say the opposite.

**Approach:** Per UX consult (Sally), deflate every displayed figure (header row + cells) to today's purchasing power (÷`(1+inflation)^years`), display-only — status stays computed on nominal figures, colors never change. Relabel the row, rewrite the legend, add a mechanism tooltip (row-label icon) plus a per-column "receipt" tooltip (the number itself as trigger) showing the future figure it was deflated from. Display-only change; formula/status logic untouched.

## Boundaries & Constraints

**Always:**
- `RetirementMatrixResult` gains `columnNestEggTodayCents: number[]`; `RetirementCell` gains `projectedValueTodayCents`. Existing `columnNestEggCents`/`projectedValueCents` (nominal) stay unchanged as the sole input to `cellStatus`.
- Deflation: `todayCents = round(nominalCents / (1+INFLATION_RATE_ANNUAL)^years)`, per column, applied identically to the header figure and every cell in that column.
- `RetirementMatrix.tsx` displays `*TodayCents` everywhere; nominal fields are display-inert (tooltip data only).
- Row label → "Nest egg needed (today's $)"; legend rewritten to state every amount is in today's dollars (both locales).
- Row-label icon: existing `MetricInfoTooltip` (add optional `contentClassName`, `max-w-sm` here) explains the mechanism once, covering all cells implicitly.
- Per-column receipt: new `AmountDetailTooltip` — the formatted figure itself is the trigger (dotted underline, not a new icon), `delay={150}`, `side="top"`, one per column (6 total), header row only. Interpolates `age`, `years`, `futureAmount` (nominal), `todaysAmount` (deflated), `rate` ("2.5%"). Suppressed (bare text) when `years===0` or both figures format identically.
- No tooltip/trigger on the 36 cells — header row only (cells don't invert; header did).
- New i18n keys both locales: `todaysDollarsInfoAria/Plain`, `nestEggFutureDetail`, `nestEggFutureDetailAria`; rewrite `nestEggNeeded`, `matrixLegend`. Parity via `retirement-i18n.test.ts`.

**Ask First:** None — confirmed via two UX consult rounds.

**Never:** No change to `cellStatus`, `nestEggRequiredCents`, `projectedValueCents`, or any formula constant — display-only. No tooltip/underline on cell values. No nominal/today's-$ toggle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Header + cells, any column | normal render | All figures shown deflated; colors unchanged from before this spec |
| Earlier vs later column | compare two columns' header figures | Earlier column's today's-$ figure >= later column's, when pension/anchor held equal (monotonic, matches intuition) |
| Hover/focus a header figure | years > 0, figures differ | Tooltip shows nominal + deflated + age + years + rate |
| years = 0 or figures equal | edge column | No underline/trigger; bare figure only |
| Row-label icon | any state | Mechanism tooltip, unchanged regardless of column |
| Status coloring | any cell | `achieved`/`close`/`shortfall` identical to pre-spec output (computed on nominals) |

</frozen-after-approval>

## Code Map

- Reference: `apps/desktop/src/components/financial-health/MetricInfoTooltip.tsx` (icon-trigger pattern to extend); `packages/shared/src/ui/tooltip.tsx` (portal behavior)
- `apps/desktop/src/lib/retirement.ts` -- modify: add today's-$ fields, deflation helper
- `apps/desktop/src/lib/__tests__/retirement.test.ts` -- add: deflation invariant, monotonicity, status-invariance under scaling
- `apps/desktop/src/components/financial-health/MetricInfoTooltip.tsx` -- modify: add optional `contentClassName`
- `apps/desktop/src/components/retirement/AmountDetailTooltip.tsx` -- new: per-column receipt trigger
- `apps/desktop/src/components/retirement/RetirementMatrix.tsx` -- modify: display today's-$ fields, wire both tooltips, relabel row
- `apps/desktop/src/locales/en.json`, `fr.json` -- rewrite `nestEggNeeded`/`matrixLegend`; add 4 keys
- `apps/desktop/src/locales/__tests__/retirement-i18n.test.ts` -- update `REQUIRED_KEYS`
- `apps/desktop/tests/retirement.spec.ts` -- add: deflated-value assertions, tooltip content, suppressed-trigger edge case

## Tasks & Acceptance

**Execution:**
- [x] `lib/retirement.ts`, `retirement.test.ts` -- deflation fields + invariant tests
- [x] `MetricInfoTooltip.tsx` -- `contentClassName` prop
- [x] `AmountDetailTooltip.tsx` -- new component
- [x] `RetirementMatrix.tsx` -- wire both tooltips, display today's-$ values, relabel row
- [x] `locales/en.json`, `fr.json`, `retirement-i18n.test.ts` -- copy + parity
- [x] `tests/retirement.spec.ts` -- e2e coverage per I/O matrix

**Acceptance Criteria:**
- Given any column, when rendered, then `status` coloring is byte-identical to the pre-spec output (nominal-based logic untouched)
- Given a column where `years > 0` and figures differ, when the header figure is focused via keyboard, then the tooltip is reachable and announces both amounts
- Given the new/rewritten i18n keys, then `retirement-i18n.test.ts` parity passes for both locales

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- ran: clean
- `pnpm --filter @nixus/desktop exec vitest run` -- ran: 336/336 passed (18 files), including 63 `retirement.test.ts` (8 new today's-$ cases) and 10 `retirement-i18n.test.ts` (2 new)
- `pnpm --filter @nixus/desktop build` -- ran: exit 0 (the >500 kB chunk warning is pre-existing)
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement.spec.ts` -- ran: 28/28 passed (19 pre-existing + 9 new)
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement-controls.spec.ts` -- ran: 15/15 passed (regression check — the sibling dynamic-controls spec reads the same grid)

**Manual checks (screenshot evidence, real Chromium at 1280px, age 40, $5,000/mo spend):**
- Header row now reads **$1,654,942.37 (Age 45) → $1,512,384.26 → $1,360,922.18 → $1,200,000.00 → $1,029,026.86 → $847,374.99 (Age 70)** — strictly decreasing, so retiring earlier reads as needing more, matching the legend. The nominal figures for the same run are humped (they *rise* from the Age 45 to Age 50 column), which is the contradiction this removes.
- Age 60 lands on exactly **$1,200,000.00** = $48,000 × 25 — at the calibration anchor (30-year duration) the deflated figure reproduces the traditional 4%-rule number in today's dollars, an independent check that the deflation cancels exactly the inflation the formula compounded.
- Age 70 receipt tooltip reads "Retiring at age 70, 30 years from now, you'd actually need $1,777,426.30 — which is $847,374.99 in today's dollars after 2.5%/yr inflation." $847,374.99 × 1.025^30 = $1,777,426, exact.
- Row-label icon tooltip renders at `max-w-sm` with the mechanism copy, arrow anchored to the icon.

**Status-invariance argument (the spec's first acceptance criterion):**
One deflation factor per column divides the projected value and the nest egg alike, so both the sign of the gap and its magnitude relative to the ±10% `close` band are preserved. `retirement.test.ts` pins this by restating `cellStatus` against the deflated pair across three pension/tax configurations and asserting it reproduces the shipped status for all 36 cells; `tests/retirement.spec.ts` additionally asserts every green cell reads at or above its column header and every non-green cell below it, which only holds while cells and header share one unit.

**Notes:**
- `deflateToTodayCents` is applied to the already-rounded nominal figures, so `projectedValueTodayCents === deflateToTodayCents(projectedValueCents, years)` holds exactly and is asserted as an invariant rather than recomputed with a tolerance.
- The receipt suppresses itself under the values-privacy toggle for free: both figures mask to the same string, so the equality guard drops the trigger rather than opening a popup of bullets. Covered by an e2e case.
- Deflation indexes off the *effective* horizon list, so the 6y/12y horizon zooms deflate by their own column years; pinned by a cross-zoom identity test.
- No mobile/375px review: the app shell has no responsive layout (desktop-only per README) and the matrix keeps its pre-existing `overflow-x-auto`.
