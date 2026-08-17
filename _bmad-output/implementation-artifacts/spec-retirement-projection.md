---
title: 'Retirement Projection'
type: 'feature'
created: '2026-08-17'
status: 'in-review'
baseline_commit: '659ea6a4'
context:
  - docs/guidelines/warnings.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have no way to see how fast they can retire based on how much they save. Nixus already computes avg monthly expenses/income and account balances (`get_projection_input`), but nothing translates that into "how much do I need, and when can I get there."

**Approach:** Add a `/insights/retirement` page under the existing Insights nav. Uses a dedicated `get_retirement_input` command — deliberately not the sibling Projection page's `get_projection_input` — because Retirement's avg income/expense figures need a **12-month trailing window** (recent spending) rather than `get_projection_input`'s unbounded lifetime average, which dilutes current spending with years of history. Compute a 6×6 matrix — rows = monthly savings tiers anchored to the user's current avg surplus, columns = years-to-retirement (5/10/15/20/25/30) — where each cell shows projected investment value vs. required nest egg (inflation-adjusted retirement spending, discounted as a present-value annuity over the years remaining until a target end-of-life age, minus pension offset — not a flat 25×; retiring earlier requires funding more years, so it needs a bigger multiplier, not the same one). Two new config-backed settings, both manual, user-editable estimates (no external API exists — Nixus has no bank/government integrations): expected annual pension income (CPP/OAS/Social Security), prefilled with a hardcoded CA reference default (same pattern as `tfsa/constants.rs`) when `country_code == "CA"`, and a current age — now a hard requirement to view the matrix at all, since the duration-based nest egg cannot be computed without an absolute age. Age prefers the existing `UserProfile.birth_date` when available.

## Boundaries & Constraints

**Always:**
- Nest egg formula: `annual_expenses_cents = avg_monthly_expense_cents * 12`; `future_annual_spend = annual_expenses_cents * 0.8 * (1 + 0.025)^years`; `gap_after_pension = max(0, future_annual_spend - pension_annual_cents)`; `nest_egg_required_cents = gap_after_pension * nest_egg_multiplier(current_age + years)`. Spending ratio (0.8) and inflation (2.5%) are fixed, matching the existing Projection page pattern — not user-editable.
- Duration-adjusted multiplier (replaces a flat 25×): `nest_egg_multiplier(retirement_age) = annuityFactor(r, max(1, TARGET_END_AGE - retirement_age))` where `annuityFactor(r, n) = (1 - (1+r)^-n) / r` (present value of an ordinary annuity) and `TARGET_END_AGE = 90`. `r` is calibrated once (bisection, not a magic literal) so a 30-year retirement duration still reproduces the traditional 25× figure — anchoring the new model to the familiar "4% rule" rather than inventing an unrelated number. Retiring earlier (more years remaining until `TARGET_END_AGE`) always requires a bigger multiplier than retiring later, all else equal.
- Growth rate for savings/investments: 7% annual (same rate as `tfsa`/`rrsp`/`fhsa`/`non_registered`/`crypto` in `src/lib/projection.ts`), compounded monthly.
- Avg monthly income/expense use a **12-month trailing window** via `get_retirement_input` (new command, backed by `aggregates::get_trailing_income_average_windowed`/`get_trailing_expense_average_windowed`) — not `get_projection_input`'s unbounded lifetime average. Deliberate divergence from the sibling Projection page: retirement math extrapolates *current* spending forward with inflation, so an all-time average would double-discount past spending that inflation has already eroded.
- Current invested capital = sum of `account_balances` where `account_type` in `["tfsa","rrsp","fhsa","non_registered","crypto"]` from `RetirementInput`. Excludes `real_estate`, `vehicle`, and cash-type accounts (illiquid or non-growth for this purpose).
- Projected value per cell = current invested capital grown at 7%/yr for `years`, plus future value of an ordinary monthly annuity of the tier's monthly amount at 7%/yr for `years*12` months.
- Savings tiers = `base * [0.5, 1, 1.5, 2, 2.5, 3]` rounded to nearest $50, where `base = max(round(avg_monthly_surplus_cents/100 to nearest 50), 100)` in dollars (floor $100 if surplus is ≤0 or unknown). The `base*1` row is visually pinned as "your current pace."
- Cell status: `achieved` (gap ≥ 0), `close` (gap ≥ -10% of nest egg required), else `shortfall`. Three fixed colors only — no continuous gradient. Cell displays the projected accumulated value at that pace/horizon (not the gap) so the user sees "how much you'd have," colored by status.
- Nest egg required is shown once per horizon column (a header row above the grid) since it does not vary by savings tier — avoids repeating an identical number in every cell of a column. It is no longer guaranteed to strictly increase left-to-right: inflation growth and the shrinking retirement-duration multiplier now compete as years-from-now increases.
- Headline sentence above the grid states the user's current avg monthly expense alongside the current-pace retirement outcome (earliest `achieved` column's year/age label, or "not within 30 years" if none achieved) — grounds the math in a number the user already recognizes.
- Pension input persists via `config` table (new key, generic `config::get`/`config::set`, same pattern as `EMERGENCY_FUND_TARGET_CONFIG_KEY`); default 0 for non-CA/unknown country. When `UserProfile.country_code == "CA"` and no config value has ever been set (config key absent, not merely 0), prefill the input with `CA_DEFAULT_PENSION_ANNUAL_CENTS` (hardcoded reference constant: avg CPP $877.01/mo + max OAS age 65-74 $751.97/mo = $19,548/yr as of Q3 2026, mirroring `tfsa/constants.rs`'s hardcoded-with-a-known-as-of-date pattern) — still fully editable, and once the user saves any value (including re-saving the same prefilled number) it is treated as set and never re-prefilled. Validate ≥ 0 on save. Field carries a visible, unconditional note: "your estimate — edit if your actual CPP/OAS/Social Security differs; not fetched automatically." When the CA default is showing unsaved, an additional supplementary note explains the prefill source — it never replaces the disclaimer above.
- Age resolution order: (1) if the user is logged in and `get_user_profile().birth_date` is set, compute `current_age = floor((today - birth_date) / 365.25)` and show it read-only with a note ("from your profile"); (2) else read a manual `retirement_age_override_years` config value if set; (3) else show an inline numeric input (18–100) that saves to that same config key on blur. Do not call `get_user_profile` behind a forced sign-in — call it opportunistically and treat any error/null as "unknown," falling through to (2)/(3).
- Age is mandatory to render the matrix: the duration-adjusted nest egg needs an absolute retirement age, so there is no degraded "years-only" fallback. When age is unresolved, show a dedicated prompt in place of the grid while still surfacing the age input (via `RetirementSettingsPanel`) so the user can supply it inline; the grid appears reactively once saved.
- Column labels are always `"Age {current_age + years}"` — no years-only fallback exists once the grid renders (age is guaranteed resolved at that point).
- All monetary cell values respect the existing values-privacy toggle via `useFormatCurrency`.
- Nav entry added as the 4th Insights child (`nav.insights` currently has 3; max 5 per `navigation.ts` D8 rule) — no new top-level destination.
- New i18n keys added to both `en.json` and `fr.json` — no hardcoded strings.

**Ask First:**
- None — formula, tiers, rates, and the target end age above are fixed defaults per approved brainstorm; no open decisions remain for this pass.

**Never:**
- No new SQLite table — `get_retirement_input` is a new query/command (justified above), but reads only existing tables (`accounts`, `expenses`, `income_entries`) via existing `aggregates.rs` helpers, windowed rather than unbounded; age/pension use the existing generic `config` table only.
- No forced sign-in to read age — `get_user_profile` is called opportunistically, never gates the page.
- No tooltips/hover popovers (no `Tooltip` primitive exists in `@nixus/shared` yet) — gap amount renders as compact text directly in the cell.
- No scenario save/compare, no editable inflation/withdrawal-rate/growth-rate/target-end-age inputs, no live network fetch for pension data — the CA reference default is a hardcoded, one-time prefill constant (like `tfsa/constants.rs`), never a live API call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Expense history + some tfsa/rrsp balance exist | 6×6 grid renders with colored cells + headline sentence | N/A |
| No expense history | `expense_month_count == 0` | Grid still renders using 0 base expenses; caution note shown that no spending history exists yet | Show note, same pattern as Projection page's "no cash flow history" alert; note never suppresses the grid |
| No retirement-eligible balances | No tfsa/rrsp/fhsa/non_registered/crypto accounts | Current invested capital = 0; grid computes from monthly contributions only | N/A |
| Pension entered | User sets pension > 0 | `nest_egg_required_cents` decreases accordingly across all columns after save | Reject negative input client + server side |
| Current surplus ≤ 0 | `avg_monthly_surplus_cents <= 0` | Tier base floors at $100/mo so the grid still shows meaningful comparisons | N/A |
| Age from profile | Logged in, `birth_date` set | Columns show "Age N", read-only note "from your profile" | N/A |
| Age from override | Logged out or no `birth_date` set, override saved | Columns show "Age N" from override | Reject age outside 18–100 |
| Age unknown | Logged out (or no `birth_date`), no override saved yet | Grid hidden behind an "enter your age" prompt; age input remains visible below to fill it in inline | N/A |
| CA pension prefill | `country_code == "CA"`, pension config key never set | Input prefills to $19,548/yr (editable); saving any value (even unchanged) marks it as user-set | N/A |
| Non-CA pension | `country_code != "CA"` or unknown | Input starts at $0, no prefill | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/retirement/constants.rs` -- new: `RETIREMENT_PENSION_CONFIG_KEY`, `RETIREMENT_AGE_OVERRIDE_CONFIG_KEY`
- `apps/desktop/src-tauri/src/db/aggregates.rs` -- add `get_trailing_income_average_windowed`/`get_trailing_expense_average_windowed(conn, months)` alongside the existing unbounded variants
- `apps/desktop/src-tauri/src/db/retirement.rs` -- new: `get_retirement_input(conn)` — account balances (unwindowed, reused query from `projection.rs`) + 12-month windowed income/expense averages
- `apps/desktop/src-tauri/src/models/mod.rs` -- new `RetirementInput` struct (deliberately not `ProjectionInput` — see Boundaries)
- `apps/desktop/src-tauri/src/commands/retirement.rs` -- new: `get_retirement_input`, `get_retirement_pension_cents`/`set_retirement_pension_cents`, `get_retirement_age_override`/`set_retirement_age_override`, all wrapping `config::get`/`config::set`; pension getter returns `Option<i64>` (`None` = never set) — CA-default prefill logic lives in the frontend, not here, since `UserProfile.country_code` requires an authenticated session the Rust config layer has no access to
- `apps/desktop/src-tauri/src/db/mod.rs`, `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/lib.rs` -- register new module/commands
- `apps/desktop/src/lib/types.ts` -- new `RetirementInput` interface (mirrors the Rust struct)
- `apps/desktop/src/lib/retirement.ts` -- new: pure calc, `computeRetirementMatrix(input: RetirementInput, pensionAnnualCents: number, currentAge: number)` (age is required, not nullable — see Boundaries); exports `nestEggMultiplier(retirementAge)` (duration-adjusted PV-annuity factor, calibrated via bisection) and `CA_DEFAULT_PENSION_ANNUAL_CENTS = 1_954_800` (avg CPP $877.01/mo + max OAS 65-74 $751.97/mo, as of Q3 2026 — dated comment, mirrors `tfsa/constants.rs`'s known-as-of pattern)
- `apps/desktop/src/hooks/useRetirementData.ts` -- new: `useRetirementInput` (invokes `get_retirement_input`) + opportunistic profile fetch (gated on `useAuthSession` status, never forces sign-in, excluded from `isPending` since a disabled query never resolves) + pension/age-override query+mutation; when pension is `null` and `country_code === "CA"`, surfaces `CA_DEFAULT_PENSION_ANNUAL_CENTS` as the display default (not yet persisted)
- `apps/desktop/src/components/retirement/RetirementMatrix.tsx` -- new: headline sentence (states current avg expense + outcome) + 6×6 grid, pinned current row, 3-color cells showing projected value, once-per-column nest-egg header row, `currentAge: number` required prop (always resolved by the time this renders)
- `apps/desktop/src/components/retirement/RetirementSettingsPanel.tsx` -- new: pension input (`MoneyInput`, unconditional disclaimer + supplementary CA-default note, prop-synced via `useEffect` + dirty-tracking to avoid the frozen-`useState` class of bug) + age input (same sync pattern; shown only when profile age unresolved)
- `apps/desktop/src/routes/insights.retirement.tsx` -- new route; empty state (no accounts) / age-required prompt (accounts exist, age unresolved) / grid+settings (age resolved), plus a non-blocking "no expense history" caution alert
- `apps/desktop/src/lib/navigation.ts` -- add `{ to: "/insights/retirement", labelKey: "nav.retirement" }` as 4th Insights child
- `apps/desktop/src/lib/constants.ts` -- add `queryKeys.retirementPension`, `queryKeys.retirementAgeOverride`, `queryKeys.retirementInput`
- `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json` -- add `nav.retirement`, `retirement.*` keys

## Tasks & Acceptance

**Execution:**
- [x] `db/aggregates.rs` -- add windowed trailing average variants, unit-tested against the unbounded ones
- [x] `db/retirement.rs`, `models/mod.rs` -- new `RetirementInput` + `get_retirement_input` query (12mo windowed averages + unwindowed account balances)
- [x] `commands/retirement.rs` -- add `RETIREMENT_PENSION_CONFIG_KEY = "retirement_pension_annual_cents"`, `RETIREMENT_AGE_OVERRIDE_CONFIG_KEY = "retirement_age_override_years"` as local module constants (simpler than a separate `retirement/constants.rs` module tree — only 2 keys, no evaluator/table infrastructure needed); expose `get_retirement_input`
- [x] `commands/retirement.rs` + `mod.rs` + `lib.rs` -- expose pension get (`Option<i64>`)/set (validate `cents >= 0`) and age-override get/set (validate `18 <= years <= 100`), all returning `AppError::Validation` on failure
- [x] `lib/types.ts`, `lib/retirement.ts` -- implement `RetirementInput` type, `CA_DEFAULT_PENSION_ANNUAL_CENTS`, tiers, nest-egg formula, per-cell projected value (current capital + annuity FV), status classification, headline resolution, age-vs-years column label per Boundaries rules; unit-test the I/O matrix edge cases including all age and pension-prefill scenarios
- [x] `hooks/useRetirementData.ts` -- fetch `RetirementInput` (new `get_retirement_input`, 12mo windowed), fetch `UserProfile` opportunistically gated on `useAuthSession` status (no sign-in gate forced), pension/age-override via query/mutation, invalidate on save
- [x] `components/retirement/RetirementMatrix.tsx` -- render headline + grid using `useFormatCurrency`; pin current-pace row with a distinct outline
- [x] `components/retirement/RetirementSettingsPanel.tsx` -- pension input (via shared `MoneyInput`) with disclaimer text; age input only rendered when profile age is unresolved
- [x] `routes/insights.retirement.tsx` -- `PageHeader` + empty state (reuse Projection page's empty-state pattern) + `RetirementMatrix` + `RetirementSettingsPanel`
- [x] `lib/navigation.ts` -- add retirement child under Insights
- [x] `lib/constants.ts`, `locales/en.json`, `locales/fr.json` -- add query keys + translation keys (parity required, verified by new `retirement-i18n.test.ts`)

**Acceptance Criteria:**
- Given accounts/expenses exist, when navigating to `/insights/retirement`, then a 6×6 grid renders with a headline sentence and the current-pace row visually pinned
- Given the user sets a pension amount and saves, when the page reloads, then all cells reflect the reduced nest egg requirement
- Given the user is logged in with `birth_date` set, then column headers show "Age N" derived from profile with no editable age input shown
- Given the user is logged out (or has no `birth_date`) and no override saved, then the grid is hidden behind an age-required prompt and an age input is shown; once saved, the grid appears with "Age N" columns
- Given `country_code == "CA"` and the pension has never been saved, then the pension field displays $19,548/yr by default, fully editable, and is not persisted until the user saves
- Given no tfsa/rrsp/fhsa/non_registered/crypto balances exist, then the grid still renders using $0 current capital without erroring
- Given no expense history, then a note is shown and the grid still renders
- Given two otherwise-identical users differing only in current age, when viewing the same horizon column, then the one retiring at a younger age shows a strictly larger nest egg required (duration-adjusted multiplier)

## Spec Change Log

- **Trigger:** Acceptance-audit review found 8 contract violations (V1–V8) plus user feedback that cell content didn't show accumulation and the headline lacked grounding context.
  - **V1/V2 (bad_spec → patch):** empty-state check was keyed on `expense_month_count === 0`, so a real user with accounts but no recorded expenses saw the empty state instead of the grid, and no "no expense history" note existed at all. **Amended:** emptiness now keys on `account_balances.length === 0` only (matching the Projection page); a separate caution `Alert` renders alongside the grid when `expense_month_count === 0`.
  - **V3/V4/V5 (patch):** `RetirementSettingsPanel`'s `useState(pensionAnnualCents)` / `useState(currentAge ?? 30)` captured only the first render's value (usually 0/unset before async data resolved) and never updated — the CA pension prefill and resolved age could never reach the input, and any incidental blur persisted a stray `0`/`30`. **Amended:** both fields now sync via `useEffect` keyed on the prop, gated by a `dirty` flag so an unedited blur never overwrites a real value; the age input no longer defaults to a fabricated `30`.
  - **V6 (patch):** the CA-default note replaced the required disclaimer text instead of supplementing it. **Amended:** the disclaimer always renders; the CA-default note is now an additional line shown only when the value is unsaved.
  - **V7 (patch):** `isPending` included the profile query's pending state, but a `enabled: false` query (logged-out users) never resolves `isPending` to `false` in React Query v5 — the page stayed in a loading state forever for the app's default signed-out path. **Amended:** `isPending` excludes the profile query; profile is treated as a non-blocking enhancement.
  - **V8 (bad_spec → patch, partial):** `computeRetirementMatrix`'s actual signature is 2-arg (`input`, `pensionAnnualCents`) — age/column-label logic lives in the UI layer, not in `lib/retirement.ts`, contradicting the Code Map's claimed 3-arg signature. **Amended:** Code Map corrected to reflect the actual split; added unit tests for `columnNestEggCents`, the zero-expense-history case, and the `close` status boundary (age/pension-prefill UI behavior is exercised at the component/hook level, not as pure-function tests, since that logic never moved into `retirement.ts`).
  - **User-requested (this round):** cells were showing the gap only, not what the user would actually accumulate, and the headline didn't reference a number the user already recognizes. **Amended:** cells now display `projectedValueCents` (colored by status); nest egg required is hoisted to a once-per-column header row (`columnNestEggCents`) since it doesn't vary by tier; headline text now states the user's current avg monthly expense alongside the retirement outcome.
  - **KEEP:** all frozen formula constants (0.8 spending ratio, 2.5% inflation, 25× multiplier, 7% growth, tier multipliers, ±10% close band) were confirmed correct by the audit and must survive unchanged; the eligible-account-type filter and the pension/age resolution order were also confirmed correct.

- **Trigger:** User challenged the model directly: "shouldn't retiring earlier need MORE money, not less?" — correct catch. The flat 25× multiplier ignored retirement duration entirely; it only compounded inflation for years-until-retirement, so later retirement columns always looked "more expensive" with no compensating effect for early retirees needing to fund more years of withdrawals.
  - **Amended:** replaced the flat 25× with a duration-adjusted present-value-of-annuity multiplier (`nestEggMultiplier`), calibrated via bisection so a 30-year retirement duration still reproduces 25× (anchoring to the familiar "4% rule" rather than an arbitrary new number). `TARGET_END_AGE = 90` (user-selected over 95/100). `computeRetirementMatrix` now requires `currentAge: number` (no longer nullable) — the duration math is impossible without an absolute age.
  - **Amended (fallback, user-selected):** age is now mandatory to view the matrix at all — no degraded "years-only" label fallback. When age is unresolved, the route shows a dedicated "set your age" prompt in place of the grid while keeping the age input visible (via `RetirementSettingsPanel`) so the user can supply it inline; the grid appears reactively once saved.
  - **KEEP:** the spending-ratio/inflation constants, growth rate, eligible account types, tier construction, cell-status thresholds, CA pension prefill, and pension resolution order are all unaffected by this change and must survive unchanged.

- **Trigger:** User noticed the headline's "$3,041.07/mo" didn't match the Spending Trends page's "$2,968.15" and asked why a new number was invented instead of reusing an existing one.
  - **Investigation:** it wasn't invented — `avg_monthly_expense_cents` was reused verbatim from `get_projection_input`, the same figure the sibling Projection page and Financial Health already use (an unbounded lifetime average via `aggregates::get_trailing_expense_average`). Spending Trends computes a *different*, pre-existing, selectable-window average (3/6/12mo) via its own module. The two numbers were already inconsistent in the app before this feature existed.
  - **User's follow-up concern:** an unbounded lifetime average dilutes current spending with years of (usually lower, pre-inflation) history — a real accuracy problem specifically for retirement math, which extrapolates "current" spending forward with inflation. Compounding inflation on top of an already-diluted-downward number double-discounts the past.
  - **Amended:** Retirement now has its own `get_retirement_input` command using a **12-month trailing window** (new `aggregates::get_trailing_*_average_windowed` helpers) instead of `get_projection_input`'s unbounded average — deliberately diverging from Projection/Financial Health for accuracy, with the divergence disclosed in Boundaries rather than left as a silent inconsistency. New `RetirementInput` type (Rust + TS) rather than reusing `ProjectionInput`, since the two now have genuinely different semantics.
  - **KEEP:** the nest-egg formula, duration-adjusted multiplier, tier construction, and all other constants are unaffected — only the *source* of `avg_monthly_income_cents`/`avg_monthly_expense_cents` changed.

## Design Notes

The matrix intentionally separates "what you'd need" (nest egg, one number per column, doesn't vary by row) from "what you'd have" (projected value, one number per cell, varies by both row and column). Putting both numbers in every cell was considered and rejected as redundant — the column header answers "how much for this age" once, and the cell's color plus number answers "does this pace get me there."

The duration-adjusted multiplier intentionally reuses the *same* calibrated rate (`DRAWDOWN_REAL_RATE`) for every duration rather than a hand-picked lookup table per age band — this keeps the model internally consistent (any duration maps through one formula) and makes the 30-year/25× anchor a verifiable constraint rather than an assertion.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec vitest run` -- ran (final): 248/248 passed (16 test files), including 13 `retirement.test.ts` and 4 `retirement-i18n.test.ts` cases
- `cargo test` (in `apps/desktop/src-tauri`) -- ran (final): 671/671 passed, including new `db::retirement`/`commands::retirement` tests and 4 new `aggregates` windowed-average tests
- `pnpm --filter @nixus/desktop build` -- ran (final): exit 0, `tsc` clean, `routeTree.gen.ts` correctly picked up `/insights/retirement`
- `cargo build` -- ran (final): exit 0, zero warnings

**Manual checks:**
- Confirmed via `curl` against the already-running dev server that `/insights/retirement` serves 200
- Playwright browser verification could not be run in this environment (the Playwright MCP server's `npx` spawn has no resolvable PATH here, and `/usr/local/bin` is root-owned so a symlink fix wasn't possible without sudo) — page has not been visually inspected in a live browser
