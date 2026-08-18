---
title: 'Retirement Pension Start Age & After-Tax Income'
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

**Problem:** The retirement matrix counts the employer pension at ANY retirement age (a $40k/yr workplace pension makes retiring at 35 look fully funded) and treats all pension income as tax-free — neither matches reality: workplace pensions have their own payout-start age, and pension income is taxed.

**Approach:** Add two manual inputs beside the existing pension fields: an employer-pension start age (gates employer pension the same way government pension is already gated) and an estimated tax rate on pension income (applied before the gap calc). Supersedes the just-landed "employer pension is never age-gated" decision in `spec-retirement-projection.md`'s Change Log — that file is untouched; this is a separate, additive spec building on its current shared source files.

## Boundaries & Constraints

**Always:**
- `RetirementPensionInputs` gains `employerPensionStartAge: number` and `pensionTaxRatePercent: number` (0-100).
- `pensionForYearsCents` gates the employer term by `currentAge + years >= employerPensionStartAge` (mirrors the government gate); sums eligible gross, returns `round(grossEligible * (1 - pensionTaxRatePercent / 100))` — feeds the existing `gap_after_pension` unchanged.
- New Rust config keys `retirement_employer_pension_start_age_years` (18-100) and `retirement_pension_tax_rate_percent` (0-100); 4 new commands (get/set each) mirroring `get/set_retirement_age_override` exactly; registered in `lib.rs`.
- Client-side defaults when unset: start age `65`, tax rate `0`. Both editable, no lock-in dance (unlike the CA pension prefill — no country dependency here).
- New `RetirementSettingsPanel` inputs reuse the existing `useState`+`dirty`+`useEffect` sync pattern verbatim; always visible.
- Disclaimers: start-age notes "most workplace pensions start around 65"; tax-rate notes "0% likely overstates your net income — pension is usually taxed," not tax advice.
- New i18n keys in both locales (parity via `retirement-i18n.test.ts`).

**Ask First:** None — both defaults are disclosed, reversible UI defaults, not the frozen formula.

**Never:** No province/state or marginal tax-bracket tables (none exist; `architecture-user-profile.md` already rejects bracket modeling as prone to rot). No tax on investment-account withdrawals — pension income only. Does not modify `spec-retirement-projection.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Employer pension before start age | amount>0, column age < start age | Excluded from that column's pension |
| Employer pension at/after start age | column age >= start age | Included (pre-tax) in that column |
| Tax rate > 0 | e.g. 20% | Combined eligible pension reduced 20% before gap calc |
| Tax rate = 0 (default) | unset | Behavior matches pre-tax (gross) baseline |
| Both gates active | gov age<65, employer age<start age | Both excluded; nest egg computed with $0 pension |
| Config unset on first load | no prior save | Defaults 65 / 0% apply without requiring a settings visit |

</frozen-after-approval>

## Code Map

- Reference (mirror exactly): `apps/desktop/src-tauri/src/commands/retirement.rs` `get/set_retirement_age_override` (~92-119); `RetirementSettingsPanel.tsx` age-input dirty-sync block (~120-146)
- `apps/desktop/src/lib/retirement.ts` -- modify: extend `RetirementPensionInputs`, `pensionForYearsCents`
- `apps/desktop/src/lib/__tests__/retirement.test.ts` -- add cases per I/O matrix
- `apps/desktop/src-tauri/src/commands/retirement.rs`, `lib.rs` -- add 2 config keys + 4 commands, register
- `apps/desktop/src/hooks/useRetirementData.ts` -- add 2 hooks; extend `useRetirementSettings`
- `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx` -- add 2 inputs
- `apps/desktop/src/routes/insights.retirement.tsx` -- wire fields into `RetirementPensionInputs`
- `apps/desktop/src/lib/constants.ts` -- add 2 `queryKeys`
- `apps/desktop/src/locales/en.json`, `fr.json`, `__tests__/retirement-i18n.test.ts` -- add `retirement.employerPensionStartAgeLabel/Note`, `pensionTaxRateLabel/Note`; update `REQUIRED_KEYS`

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/commands/retirement.rs`, `lib.rs` -- add config keys + 4 commands, unit-tested (round-trip, default-none, range validation)
- [x] `apps/desktop/src/lib/retirement.ts` -- extend `RetirementPensionInputs`/`pensionForYearsCents`
- [x] `apps/desktop/src/lib/__tests__/retirement.test.ts` -- cover I/O matrix rows
- [x] `apps/desktop/src/hooks/useRetirementData.ts` -- new hooks + `useRetirementSettings` extension, defaults 65/0
- [x] `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx` -- 2 new inputs, dirty-sync
- [x] `apps/desktop/src/routes/insights.retirement.tsx` -- wire fields through
- [x] `apps/desktop/src/lib/constants.ts`, `locales/en.json`, `fr.json`, `retirement-i18n.test.ts` -- keys + parity

**Acceptance Criteria:**
- Given tax rate stays at the 0% default, then output matches the pre-tax baseline (backward-compatible)
- Given both new config keys are unset, then the page renders with defaults (65, 0%) with no settings visit required
- Given new i18n keys, then `retirement-i18n.test.ts` parity passes for both locales

## Spec Change Log

- **Trigger:** Implementation found two files outside the Code Map asserting the exact "employer pension is never age-gated" behavior this spec supersedes. Leaving them would have shipped a red suite, which `dev-standards` forbids.
  - **Amended (test-only, no intent change):** `lib/__tests__/retirement.test.ts`'s "applies the employer pension for every column regardless of age or gate" and "treats an employer pension identically to a government pension once past the gate age" now pin `employerPensionStartAge` low enough that every column qualifies — preserving each test's original intent (independence from the *government* gate) under the new start-age gate. `tests/retirement.spec.ts`'s "an employer pension lowers every column including pre-65 ones" became "…once its start age is met" and seeds start age 55; its old pre-65 claim is now covered by a new, inverted test asserting the gate holds.
  - **Amended (Code Map addition):** `tests/retirement.spec.ts` gained the 2 new commands in its Tauri `invoke` mock plus `employerPensionStartAge`/`pensionTaxRatePercent` seed options — the panel's new queries had to resolve for any e2e test to render the page.
  - **Deviation (justified):** the two range checks live in `validate_employer_pension_start_age`/`validate_pension_tax_rate_percent` free functions that the setters call, rather than inline in the command bodies as `set_retirement_age_override` does. A `#[tauri::command]` needs a `State<DbState>` no unit test can construct, so inline validation would make the spec-required "range validation" test unreachable. Command structure is otherwise mirrored exactly.
  - **KEEP:** the gate formula, the combined-single-rate tax model, both defaults (65 / 0), and every frozen constant from `spec-retirement-projection.md` are unchanged.

## Design Notes

Single shared tax rate on combined pension (not per-type, not bracket-based) — matches this feature's "single manual estimate, no external data source" philosophy and avoids the bracket-rot problem already documented in `architecture-user-profile.md`.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- ran: clean
- `pnpm --filter @nixus/desktop exec vitest run` -- ran: 285/285 passed (17 files), including 46 `retirement.test.ts` (was 34; +12 for the start-age gate and tax rate) and 5 `retirement-i18n.test.ts`
- `pnpm --filter @nixus/desktop build` -- ran: exit 0
- `cargo build` (`apps/desktop/src-tauri`) -- ran: exit 0, zero warnings
- `cargo test` (`apps/desktop/src-tauri`) -- ran: 682/682 passed (was 673; +9 `commands::retirement` tests for both new keys' round-trip, unset-default, inclusive bounds, out-of-range rejection, and key isolation from the 3 pre-existing retirement keys)
- `pnpm --filter @nixus/desktop exec playwright test tests/retirement.spec.ts` -- ran: 11/11 passed (was 8; +3 for the start-age default, the start-age gate holding pre-65, and the tax rate raising the nest egg)

**Manual checks:**
- Employer pension $40k/yr, start age 65, current age 30 -- age-35..55 exclude it, age-60+ includes it
- Tax rate 20% -- pension's nest-egg-reducing effect shrinks accordingly across eligible columns

Both manual checks are pinned as automated tests rather than left to a one-time hand check: the start-age exclusion/inclusion pair plus an exact-boundary case (`employerPensionStartAge: 50` counts at age 50, not 51) in `retirement.test.ts`'s "employer pension start age" block, and the 20% reduction in its "pension tax rate" block (`pensionForYearsCents` returns `gross * 0.8`). The tax block also pins that an *ineligible* pension contributes exactly 0 rather than a taxed fraction, that the two pensions are taxed as one combined figure, and that the result is always whole cents.
