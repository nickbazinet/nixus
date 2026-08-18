---
title: 'Retirement Tax Rate Control: Honest Auto-Estimate UX'
type: 'feature'
created: '2026-08-18'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '2c66d056'
context:
  - docs/guidelines/warnings.md
  - _bmad-output/implementation-artifacts/spec-retirement-pension-tax-auto.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Use automatic estimate" lies for non-CA users — clicking it resets to a flat 0%, not an estimate, since no non-CA tax table exists. No signal exists either when 0% tax is silently in effect.

**Approach:** Per UX consult (Sally), gate the affordance on `autoEstimateAvailable` (= `isCanada`): non-CA never sees "auto"/estimate language, only a plain field. CA sees a verifiable `Use our estimate (X%)` button showing the number before clicking, plus an "Auto-estimated" badge when in effect. A `caution` "No tax applied" badge appears whenever the effective rate is 0%, any country. Also fixes an existing empty-blur dead end.

## Boundaries & Constraints

**Always:**
- New `RetirementSettingsPanelProps.autoEstimateAvailable: boolean` = existing `isCanada` (`useRetirementData.ts:197`), threaded through `insights.retirement.tsx`.
- Three states: **(1)** available, no override → field empty, `placeholder`=rounded estimate, `neutral` "Auto-estimated" badge, no button. **(2)** available + override → field shows saved value, button `Use our estimate ({{rate}}%)`, no badge unless rate is 0. **(3)** unavailable → field shows saved/0, no button, no "auto"/estimate language ever.
- Orthogonal, overrides state-1's badge: rate in effect === 0 → `caution` "No tax applied" badge instead.
- Caption: rate===0 (no auto badge) → zero-tax note; auto in use → note leading with "Using {{rate}}%…"; else → manual note.
- Button calls the existing clear mutation (rename `onUseAutomaticPensionTaxRate` → `onUseEstimatedPensionTaxRate`; no backend change), then moves focus to the input.
- Empty-blur: state 2 → same as clicking the button; state 3 → reverts draft to last saved value, never commits 0 silently.
- Badge via existing `badge.tsx` (`neutral`/`caution`) — no new primitive. Input gains `placeholder` (state 1) + `aria-describedby`; caption gains `aria-live="polite"`.
- i18n: rewrite `pensionTaxRateLabel` (drop "on pension income") and `pensionTaxRateNote`; add `pensionTaxRateAutoBadge`, `pensionTaxRateZeroBadge`, `pensionTaxRateZeroNote`, `pensionTaxRateUseEstimate`; delete `pensionTaxRateUseAutomatic`, `pensionTaxRateAutoEstimate`. Parity both locales.
- Test-id churn: `-use-auto`→`-use-estimate`, `-auto`(span)→`-badge`. Update referencing Playwright specs.

**Ask First:** None — confirmed via UX consult.

**Never:** No change to the tax math/bracket/gross-up formula (prior spec's frozen boundaries untouched). No new UI primitive. No inline "%" affix in the input (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| State 1: CA, no override | available, no override | Empty field w/ placeholder, "Auto-estimated" badge (caution if estimate rounds to 0), no button |
| State 2: CA, override > 0 | available, override, rate>0 | Field shows saved rate, "Use our estimate (X%)" button, no badge |
| State 2, override = 0 | available, override, rate=0 | Field shows 0, button shown, caution "No tax applied" badge |
| State 3: non-CA | unavailable | Field shows saved/0, no button, no auto badge; caution if rate=0 |
| Click estimate button | state 2, click | Clears override, reverts to state 1, focus moves to input |
| Empty-blur, state 2 | clear field, blur | Same as clicking the button |
| Empty-blur, state 3 | clear field, blur | Draft reverts to last saved value; nothing committed |

</frozen-after-approval>

## Code Map

- Reference: `packages/shared/src/ui/badge.tsx` (`neutral`/`caution`); `hooks/useRetirementData.ts:197` (`isCanada`); `components/retirement/RetirementControls.tsx:66-96` (`min-h-target-min` anti-reflow); `SuggestedAllocationPanel.tsx` (`aria-live` caption precedent)
- `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx` -- modify: new prop, 3-state layout, `Badge`, placeholder, empty-blur handling
- `apps/desktop/src/hooks/useRetirementData.ts` -- modify: expose `autoEstimateAvailable`, rename callback
- `apps/desktop/src/routes/insights.retirement.tsx` -- modify: wire new prop + renamed callback
- `apps/desktop/src/locales/en.json`, `fr.json` -- rewrite/add/delete keys per Boundaries
- `apps/desktop/src/locales/__tests__/retirement-i18n.test.ts` -- update `REQUIRED_KEYS`
- `apps/desktop/tests/retirement.spec.ts` -- update test-ids/assertions for the 3 states + empty-blur

## Tasks & Acceptance

**Execution:**
- [x] `hooks/useRetirementData.ts` -- expose `autoEstimateAvailable`, rename callback
- [x] `components/retirement/RetirementSettingsPanel.tsx` -- 3-state layout, `Badge`, placeholder, empty-blur fix
- [x] `routes/insights.retirement.tsx` -- wire new prop/callback
- [x] `locales/en.json`, `fr.json`, `retirement-i18n.test.ts` -- key rewrite/add/delete + parity
- [x] `tests/retirement.spec.ts` -- update test-ids, cover the 3 states + empty-blur

**Acceptance Criteria:**
- Given non-CA, then no "auto"/estimate button or badge ever renders, in any override state
- Given the in-effect rate is 0 for any country, then the caution "No tax applied" badge renders
- Given the renamed/deleted i18n keys, then `retirement-i18n.test.ts` parity passes for both locales

## Spec Change Log

- **Trigger:** the frozen Caption boundary and the state-3 "no estimate language ever" boundary each demanded copy the named i18n edits did not reach, and "rename callback" pointed at a hook field that serves both countries.
  - **Deviation (justified):** `useRetirementData.ts`'s callback was **not** renamed — `clearPensionTaxRate` stays. Boundaries name exactly one rename, the panel prop `onUseAutomaticPensionTaxRate` → `onUseEstimatedPensionTaxRate`, and that landed. The hook field is the one call site shared by both countries: outside Canada it clears to a flat 0%, so `useEstimated…` there would assert the very estimate this spec exists to stop promising. `clearPensionTaxRate` describes what the mutation does in both countries; the honest naming lives at the boundary that knows the country. `autoEstimateAvailable: isCanada` is what the hook actually gained.
  - **Deviation (justified):** `pensionTaxRateAutoNote` was rewritten too, though the i18n line names only `pensionTaxRateLabel` and `pensionTaxRateNote`. The frozen Caption boundary requires the auto caption to lead with "Using {{rate}}%…", and the old string carried no `{{rate}}` at all — it could not satisfy the boundary unchanged. The i18n test now pins `{{rate}}` in both this key and `pensionTaxRateUseEstimate`, replacing the deleted readout's placeholder check.
  - **Deviation (justified):** `pensionTaxRateLabel` lost "Estimated" as well as "on pension income", and `pensionTaxRateNote` lost "Your rough estimate". Both render in state 3, where the Boundaries forbid estimate language *ever* — trimming only the literally-named phrase would have left "Estimated tax rate" on screen for exactly the users who have no estimate. A new i18n test regexes `/estimat|automatic|automatique/i` against all four strings reachable in state 3 (`…Label`, `…Note`, `…ZeroBadge`, `…ZeroNote`), so the lie cannot walk back in through a copy edit.
  - **Deviation (justified):** empty-blur in state 2 does everything the button does **except** move focus. "Same as clicking the button" is the state change, not the focus change: refocusing the field the user just tabbed out of would hijack Tab and trap them in the control. Both paths share one `applyEstimatedPensionTaxRate()` handler; only the button's `onClick` adds the focus move, which it needs because it unmounts itself and would otherwise drop focus to `<body>`.
  - **Deviation (justified):** that shared handler is named `applyEstimatedPensionTaxRate`, not `use…`. A `use`-prefixed function called inside `if (showEstimateButton)` reads as a conditionally-invoked hook to `react-hooks/rules-of-hooks`.
  - **Deviation (justified):** `aria-describedby` names the badge **and** the caption whenever a badge is showing, not the caption alone. The badge is the state signal — a screen-reader user who never sees amber learns "No tax applied" only if the field points at it. Boundaries require the attribute without fixing its target count, and `aria-live` on the caption only helps users present for the change, not those arriving at the field afterwards.
  - **Deviation (justified):** the zero badge *replaces* the auto badge in one element rather than rendering a second one, so `-badge` is a single test-id whose text is asserted — which is what the frozen "orthogonal, overrides state-1's badge" wording and the single `-auto`(span)→`-badge` rename together imply.
  - **Amended (Code Map addition):** `tests/retirement.spec.ts` gained an `avgMonthlyExpenseCents` mock option. The matrix's state-1 row needs an estimate that *rounds to 0*, and the estimate is derived from spending — 0 spending is the only handle the mock had no way to reach.
  - **Amended (test replacement, forced by intent):** "clearing a saved rate outside Canada reverts to 0%, not an estimate" was deleted, not updated. It clicked a button that state 3 no longer renders — its removal is the feature. Two tests replace it: a saved 40% outside Canada showing no button, no badge, no placeholder and no estimate wording in its caption; and empty-blur there reverting to 40 rather than committing 0.
  - **Not fixed (out of scope):** a non-empty out-of-range blur (e.g. `150`) still no-ops and leaves the draft dirty. Boundaries name the empty-blur dead end only, and widening the fix would change save behavior no acceptance criterion covers.
  - **KEEP:** the tax math, bracket table, and gross-up formula untouched; no new UI primitive (`Badge` reused, `neutral`/`caution` only); no inline "%" affix; no backend change (the clear command and its config key are byte-identical); and every frozen constant from the three upstream specs.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- ran: clean
- `pnpm --filter @nixus/desktop exec vitest run` -- ran: 326/326 passed (18 files), was 324. `retirement-i18n.test.ts` 6 -> 8: the deleted readout's `{{rate}}` check became a two-key check over the button and caption, plus new guards for estimate language in state-3 strings and for orphaned keys in either locale
- `pnpm --filter @nixus/desktop build` -- ran: exit 0
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement.spec.ts` -- ran: 19/19 passed, was 15
- `pnpm --filter @nixus/desktop exec playwright test` (full suite) -- ran: 507/508 passed. The one failure is `maintenance.spec.ts` "negative value shows inline error without toast", which passes on its own re-run and fails inside the shared `createVehicle` helper -- the same pre-existing vehicle-module flake class the prior spec recorded, touching no file in this Code Map
- No Rust file changed, so `cargo build`/`cargo test` are unaffected -- the clear command was reused as-is

**Manual checks:**
- CA, no override -- badge reads "Auto-estimated," field shows placeholder number, no button
- Non-CA -- no button/badge ever appears; blank blur reverts to last saved value

Both are pinned as automated tests rather than one-time hand checks, and were additionally confirmed by browser screenshots of all six reachable renders at 1280px (state 1 with a 13% estimate; state 1 with a 0% estimate; state 2 at 40%; state 2 at 0%; state 3 at 40%; state 3 at 0%). The state-1 assertion reads the placeholder attribute and requires the caption to name that same number, so the field and its explanation cannot drift apart. The state-3 assertions are the acceptance criterion stated three ways -- no button, no badge, no placeholder -- because any one of them alone would still let estimate language reach a user who has no estimate.

**Known pre-existing issue (not introduced, not fixed here):** at a 375px viewport the sidebar stays fully expanded (~230px), leaving ~108px of content width, and every element on the page overflows -- matrix, headline, horizon tabs, search bar included. The tax-rate row overflows for that reason alone: the replaced button label ("Use automatic estimate") and the new one ("Use our estimate (13%)") are both 22 characters, and the added badge is `w-fit shrink-0`, narrower than the button already beside it. The fix belongs to the sidebar's breakpoint, which is outside this Code Map.
