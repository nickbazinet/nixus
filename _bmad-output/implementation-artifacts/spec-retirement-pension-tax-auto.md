---
title: 'Retirement Pension Tax: Auto-Estimate for Canada'
type: 'feature'
created: '2026-08-18'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '2c66d056'
context:
  - docs/guidelines/warnings.md
  - _bmad-output/implementation-artifacts/spec-retirement-pension-realism.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pension tax rate is fully manual (default 0%), silently assuming tax-free pension unless the user sets a rate.

**Approach:** Auto-estimate the tax rate for CA users via an algebraic "gross-up" over a small hardcoded tax-bracket table — no iteration: resolves the withdrawal/after-tax-pension circularity by computing "gross income needed to net the target spend" rather than taxing pension directly. A manual rate always overrides, persists until cleared; non-CA stays manual at 0% (unchanged). Narrowly reverses `spec-retirement-pension-realism.md`'s "no bracket tables" clause — one dated, override-backed, CA-only curve, not the open-ended province/marginal system that clause prevented.

## Boundaries & Constraints

**Always:**
- New `retirement-tax.ts`: `CA_RETIREMENT_TAX_BANDS` (~5 bands, blended federal+avg-provincial, dated comment; band 1 generous ~$22k/0%, informally absorbing personal/age/pension credits), `taxForCents(gross, bands)`, `grossUpCents(netTarget, bands)` (exact algebraic inverse, no bisection), `effectiveRateFor(gross, bands)`.
- Thresholds inflate by `(1+INFLATION_RATE_ANNUAL)^years` per column, matching `future_annual_spend`.
- `pensionTaxRatePercent` → `taxModel: {kind:"auto"} | {kind:"manual", ratePercent}`. `pensionForYearsCents` returns GROSS pension.
- `nestEggRequiredCents`: `auto` → `max(0, grossUpCents(futureAnnualSpend, indexedBands) - pensionGrossCents)`; `manual` → today's formula, identical at `ratePercent=0`.
- `useRetirementSettings` resolves: saved override → `manual(rate)`; no override + CA → `auto`; no override + non-CA → `manual(0)`.
- New `config::delete(conn, key)`; new `clear_retirement_pension_tax_rate_percent` mirroring the existing setter (deletes, not sets), registered in `lib.rs`.
- `RetirementSettingsPanel`: rate input unchanged; add "Use automatic estimate" (calls clear) when an override is saved; in `auto` mode show read-only "≈X% estimated" via `effectiveRateFor` at `years=0`.
- New i18n keys, both locales (parity via `retirement-i18n.test.ts`).

**Ask First:** None — CA-only scope, override-always-wins, no new persisted state: the approved conditions.

**Never:** No provinces/states, OAS clawback, or per-account withdrawal treatment (100% taxable assumed). No non-CA tables, no drawdown simulation. Bracket invariants tested separately from golden values, named with their "as of" year.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Auto mode, CA | no override, country=CA | Tax auto-estimated via gross-up; nest egg rises vs. 0%-tax baseline |
| Manual override set | user saves a rate | Applies as before; auto ignored until cleared |
| Cleared override | clicks "use automatic estimate" | Reverts to auto (CA) or 0% (non-CA); config key deleted |
| Non-CA | country != CA, no override | Manual, 0% — unchanged |
| Bracket roundtrip | any gross amount | `taxForCents`/`grossUpCents` are exact inverses |
| Long horizon | years=30 | Thresholds inflated; no bracket-creep vs. years=0 at equal real income |

</frozen-after-approval>

## Code Map

- Reference: `apps/desktop/src/lib/retirement.ts` (`pensionForYearsCents`, `nestEggRequiredCents`); `apps/desktop/src-tauri/src/db/config.rs` (`get`/`set`, mirror for `delete`); `apps/desktop/src-tauri/src/commands/retirement.rs` (setter, mirror for clear)
- `apps/desktop/src/lib/retirement-tax.ts` -- new: bands, `taxForCents`, `grossUpCents`, `effectiveRateFor`
- `apps/desktop/src/lib/retirement.ts` -- modify: `taxModel`, gross pension, auto/manual branch
- `apps/desktop/src/lib/__tests__/retirement.test.ts`, new `retirement-tax.test.ts` -- I/O matrix + invariants + golden values
- `apps/desktop/src-tauri/src/db/config.rs` -- add `delete`
- `apps/desktop/src-tauri/src/commands/retirement.rs`, `lib.rs` -- add + register clear command
- `apps/desktop/src/hooks/useRetirementData.ts` -- resolve `taxModel`, clear mutation
- `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx` -- auto-estimate action + readout
- `apps/desktop/src/routes/insights.retirement.tsx` -- wire `taxModel` through
- `apps/desktop/src/locales/en.json`, `fr.json`, `__tests__/retirement-i18n.test.ts` -- new keys + parity

## Tasks & Acceptance

**Execution:** (see Code Map for role/rationale of each; check off once implemented + tested)
- [x] `lib/retirement-tax.ts` + `retirement-tax.test.ts`
- [x] `db/config.rs` -- add `delete`
- [x] `commands/retirement.rs`, `lib.rs` -- clear command
- [x] `lib/retirement.ts` + `retirement.test.ts`
- [x] `hooks/useRetirementData.ts`
- [x] `RetirementSettingsPanel.tsx`
- [x] `routes/insights.retirement.tsx`
- [x] `constants.ts` (no-op, see Change Log), `en.json`, `fr.json`, `retirement-i18n.test.ts`

**Acceptance Criteria:**
- Given a manual rate saved before this spec shipped, then behavior is unchanged (override always wins)
- Given the bracket table's golden values, then the test name pins the "as of" year so staleness shows in CI, not silently
- Given new i18n keys, then `retirement-i18n.test.ts` parity passes for both locales

## Spec Change Log

- **Trigger:** `pensionForYearsCents` returning GROSS left the manual branch's withholding with nowhere testable to live, and `retirement-tax.ts` needed the matrix's inflation rate without importing the matrix.
  - **Deviation (justified):** added `pensionCountedForYearsCents` beside the spec-named `pensionForYearsCents`. Gross is what the auto gross-up must tax, but `manual` still has to withhold its rate somewhere; an exported sibling keeps that withholding assertable in exact cents (four I/O-matrix rows for manual mode need `gross * (1 - rate)` precisely, which the matrix's rounded per-column output cannot express). `nestEggRequiredCents` then reads as one subtraction whose branch only changes the *target* — net spend vs. grossed-up income need.
  - **Deviation (justified):** `indexBandsForYears(bands, years, inflationRateAnnual)` takes the rate as a parameter and `INFLATION_RATE_ANNUAL` became exported from `retirement.ts`, instead of `retirement-tax.ts` importing it. Importing would make a module cycle (`retirement.ts` -> `retirement-tax.ts` -> `retirement.ts`). `retirement-tax.test.ts` pins that the rate the bands are indexed by is the same one spending inflates at, which is the invariant the parameter could otherwise let drift.
  - **Deviation (justified):** `taxForCents`/`grossUpCents` return unrounded cents. Rounding either breaks the "exact inverses" acceptance criterion outright; the matrix already rounds exactly once at the end, the same treatment `futureAnnualSpend` gets. Their tests assert to a millionth of a cent.
  - **Deviation (justified):** added `autoEstimatedTaxRatePercent(annualExpensesCents)` to `retirement.ts` for the readout. `effectiveRateFor` needs a gross income to report a rate on, and the only meaningful one is the gross-up of today's retirement spend — which needs `SPENDING_RATIO_IN_RETIREMENT`, private to `retirement.ts`. Pinned to `years = 0` exactly as specified.
  - **Deviation (justified):** `constants.ts` needed no edit. The clear mutation invalidates the existing `queryKeys.retirementPensionTaxRate` (same key the getter reads), so there is no new query to register. Left in the task list as an explicit no-op rather than silently dropped.
  - **Deviation (justified, UI):** in `auto` mode the rate field renders empty, not `0`, and its note swaps to an auto-specific disclaimer. "Rate input unchanged" holds for the element, its `useState`+`dirty`+`useEffect` sync, and its save-on-blur; only the displayed value differs, because a `0` sitting in the field while tax is being applied reads as "no tax applied" — the exact misreading this spec exists to fix. Non-CA with no override still shows `0`, so the pre-spec default is visibly unchanged there.
  - **Amended (test-only, no intent change):** `retirement.test.ts`'s `describe("pension tax rate")` became `manual pension tax rate`, and its four exact-cents cases retargeted from `pensionForYearsCents` to `pensionCountedForYearsCents`. Every assertion is byte-identical; only the function that answers them moved, because the old one now returns gross. A new `leaves the pension itself gross, whatever the rate` case pins the half that changed.
  - **Amended (Code Map addition):** `tests/retirement.spec.ts` gained `clear_retirement_pension_tax_rate_percent` in its Tauri `invoke` mock plus 4 tests (auto readout on a CA profile, auto needing a bigger nest egg than a saved 0%, clearing handing the estimate back, clearing outside Canada reverting to 0%). The mock's `default` case resolves `null`, so without the explicit case the clear would have silently no-op'd and every new assertion would have been vacuous.
  - **KEEP:** the band values and their $22k/0% first band, override-always-wins, no new persisted state, CA-only scope, no provinces/OAS clawback/per-account treatment, no drawdown simulation, and every frozen constant from the two upstream specs.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- ran: clean
- `pnpm --filter @nixus/desktop exec vitest run` -- ran: 324/324 passed (18 files), was 285. New `retirement-tax.test.ts` 29; `retirement.test.ts` 46 -> 55; `retirement-i18n.test.ts` 5 -> 6
- `pnpm --filter @nixus/desktop build` -- ran: exit 0
- `cargo build` (`apps/desktop/src-tauri`) -- ran: exit 0, zero warnings
- `cargo test` (`apps/desktop/src-tauri`) -- ran: 686/686 passed, was 682 (+4 `commands::retirement`: clear returns the key to never-set rather than "0", clearing an unset key is a no-op, clearing leaves the other four retirement keys alone, and a cleared rate can be set again)
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement.spec.ts` -- ran: 15/15 passed, was 11
- `pnpm --filter @nixus/desktop exec playwright test` (full suite) -- ran: 503/504 passed. The one failure is `maintenance.spec.ts` "cancel collapses form without toast", which passes on its own re-run and touches no file in this spec's Code Map -- a pre-existing flake in the vehicle module, not a regression here

**Manual checks:**
- CA profile, no override: panel shows "≈X% estimated," nest egg above the old baseline; saving then clearing a rate reverts and deletes the config key

Both manual checks are pinned as automated tests rather than left to a one-time hand check. `tests/retirement.spec.ts` covers the readout appearing for a CA profile with an empty field and no clear action, the auto estimate needing a strictly larger age-70 nest egg than a manually saved 0% (compared numerically, not as differing strings), and a saved 40% clearing back to the estimate -- which the field can only empty out for if the getter now reports no stored rate, so it doubles as proof the deletion reached the config key rather than only the client cache. `retirement.test.ts`'s "automatic tax estimate" block pins the per-column algebra: the auto nest egg equals the gross-up of that column's own spend against thresholds indexed to that column's own horizon.
