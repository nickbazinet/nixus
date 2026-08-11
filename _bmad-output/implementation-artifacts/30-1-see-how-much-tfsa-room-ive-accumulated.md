# Story 30.1: See how much TFSA room I've accumulated

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Canadian Nixus user who has entered my date of birth,
I want to see the total TFSA contribution room I've accumulated over my lifetime,
so that entering my birthday gives me something useful right away.

## Acceptance Criteria

1. **Given** my country is Canada and my date of birth is set
   **When** I view `/profile`
   **Then** I see my cumulative lifetime TFSA limit displayed near the date-of-birth field

2. **Given** the figure is displayed
   **When** I read its label and supporting text
   **Then** it is described as the total room I have accumulated, explicitly **not** as remaining room
   **And** it states that Nixus does not track my contributions or withdrawals
   **And** both label and note are translated in English and French

3. **Given** I was born in 1985
   **When** the calculation runs
   **Then** it sums annual CRA limits from 2009 onward, because I turned 18 before TFSAs existed

4. **Given** I was born in 2000
   **When** the calculation runs
   **Then** it sums annual limits from the year I turned 18 onward, not from 2009

5. **Given** the calculation completes
   **When** the value is returned
   **Then** it is an `i64` in cents with a `_cents` suffixed field name

6. **Given** the calculation module is implemented
   **When** its tests run
   **Then** they cover the pre-1991 birth year, a birth year after 2009, a user who turns 18 in the current year, and the first year past the limits table's bound

7. **Given** I change my date of birth or country and press Save
   **When** the save succeeds
   **Then** the displayed figure refreshes rather than showing a stale value

8. **Given** the calculation needs the limits table
   **When** the implementation is inspected
   **Then** the table is a checked-in Rust const declaring the last year it covers
   **And** the computation happens in Rust, so the frontend cannot produce a divergent number

## Tasks / Subtasks

- [x] **Task 1 — Create the TFSA calculation module with the annual limits table** (AC: #3, #4, #5, #6, #8)
  - [x] Create `apps/desktop/src-tauri/src/tfsa/mod.rs` containing exactly `pub mod calculator;` and `pub mod constants;`, mirroring `src-tauri/src/financial_health/mod.rs`
  - [x] Create `apps/desktop/src-tauri/src/tfsa/constants.rs` with `pub const TFSA_FIRST_YEAR: i32 = 2009;`, `pub const KNOWN_THROUGH_YEAR: i32 = 2026;`, and `pub const ANNUAL_LIMITS_CENTS: &[(i32, i64)]` transcribed **verbatim** from the table in Dev Notes → "CRA annual TFSA limits table". Do not invent, round, or interpolate any entry.
  - [x] Add a `#[cfg(test)] mod tests` in `constants.rs` asserting the table is contiguous from `TFSA_FIRST_YEAR` through `KNOWN_THROUGH_YEAR` with no gaps and no duplicate years, and that its last entry's year equals `KNOWN_THROUGH_YEAR` — this is the guard that makes a half-updated table fail CI instead of shipping
  - [x] Create `apps/desktop/src-tauri/src/tfsa/calculator.rs` with a pure function `pub fn accumulated_limit(birth_date: &str, current_year: i32) -> Option<TfsaAccumulatedLimit>` — `current_year` is a **parameter, not read from the clock**, so the past-the-bound case is testable (see AC #6)
  - [x] Implement `eligible_from_year = max(birth_year + 18, TFSA_FIRST_YEAR)`; return `None` when `birth_date` does not parse as `YYYY-MM-DD`, when `current_year > KNOWN_THROUGH_YEAR`, or when `eligible_from_year > current_year`
  - [x] Sum `ANNUAL_LIMITS_CENTS` for every year in `eligible_from_year..=current_year` into `total_cents: i64`. Integer arithmetic only — no `f64` anywhere (project rule 1)
  - [x] Declare `mod tfsa;` in `apps/desktop/src-tauri/src/lib.rs` alongside the existing `mod financial_health;`
- [x] **Task 2 — Add the `TfsaAccumulatedLimit` model** (AC: #5)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add `pub struct TfsaAccumulatedLimit { pub total_cents: i64, pub eligible_from_year: i32, pub known_through_year: i32 }` deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields and **no** `#[serde(rename_all = ...)]`
- [x] **Task 3 — Add the session-gated IPC command** (AC: #1, #8)
  - [x] In `apps/desktop/src-tauri/src/commands/profile.rs` (created by Story 28.2), add `#[tauri::command(rename_all = "snake_case")] pub async fn get_tfsa_accumulated_limit(app: AppHandle) -> Result<Option<TfsaAccumulatedLimit>, AppError>`
  - [x] Resolve identity with `auth::current_subject().await?` — never accept a `sub` parameter — then read the profile via `profile_store::load_profile`
  - [x] Return `Ok(None)` unless `country_code.as_deref() == Some("CA")` **and** `birth_date` is `Some`; then delegate to `tfsa::calculator::accumulated_limit(&birth_date, chrono::Local::now().date_naive().year())`
  - [x] Keep the command a thin orchestrator: no limits-table logic, no year arithmetic, no `.unwrap()` — all of that lives in `tfsa/`
  - [x] Register `commands::profile::get_tfsa_accumulated_limit` in the `tauri::generate_handler![...]` list in `lib.rs`
- [x] **Task 4 — Frontend types, query key, and hook** (AC: #1, #7, #8)
  - [x] Add `TfsaAccumulatedLimit` to `apps/desktop/src/lib/types.ts` mirroring the Rust shape (`total_cents: number; eligible_from_year: number; known_through_year: number`)
  - [x] Add `tfsaAccumulatedLimit: ["tfsa-accumulated-limit"] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts`
  - [x] Add `useTfsaAccumulatedLimit()` to `apps/desktop/src/hooks/useProfile.ts` — `useQuery` returning `invoke<TfsaAccumulatedLimit | null>("get_tfsa_accumulated_limit")`. The hook performs **no** eligibility logic and **no** arithmetic
  - [x] In `useSaveUserProfile.onSuccess`, add `queryClient.invalidateQueries({ queryKey: queryKeys.tfsaAccumulatedLimit })` alongside the existing `queryKeys.profile` invalidation (AC #7)
  - [x] In `apps/desktop/src/hooks/useAuth.ts`, add `queryClient.removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit })` at **both** existing `removeQueries(queryKeys.profile)` call sites (sign-out and the `auth:callback-received` handler). `removeQueries`, never `invalidateQueries` — this is an identity change, not a data change
- [x] **Task 5 — Display the figure on the profile surface** (AC: #1, #2)
  - [x] Create `apps/desktop/src/components/profile/TfsaAccumulatedLimit.tsx` rendering `SubStat` from `@nixus/shared/ui` with `label`, `value`, and `caption`
  - [x] Format the value with `useFormatCurrency()` from `@/hooks/useFormatCurrency` and pass the resulting string as `value`; leave `masked` at its default `false` because `useFormatCurrency` already returns the masked placeholder when values are hidden — do not double-mask
  - [x] Render `null` when the hook returns `null`/`undefined` or is still loading. No skeleton, no empty state, no error text: absence is the designed outcome
  - [x] Mount it inside `components/profile/ProfileForm.tsx` immediately after the date-of-birth field so the payoff sits beside the input that produces it
- [x] **Task 6 — i18n keys in both locales** (AC: #2)
  - [x] Add the three `profile.tfsa*` keys from Dev Notes → "i18n keys" to `apps/desktop/src/locales/en.json` **and** `apps/desktop/src/locales/fr.json` in the same change
  - [x] Add them to `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/profile-i18n.test.ts`
- [x] **Task 7 — Unit tests** (AC: #3, #4, #6)
  - [x] `#[cfg(test)] mod tests` in `tfsa/calculator.rs`, styled after `financial_health/evaluator.rs`'s tests (plain `#[test]` fns, `assert_eq!` on concrete expected values — no `tempfile` needed, this module touches no filesystem)
  - [x] Test: birth year 1985, `current_year = KNOWN_THROUGH_YEAR` → `eligible_from_year == 2009` and `total_cents == 10_900_000`
  - [x] Test: birth year 2000, `current_year = KNOWN_THROUGH_YEAR` → `eligible_from_year == 2018` and `total_cents == 5_700_000`
  - [x] Test: turns 18 in the current year (birth year `KNOWN_THROUGH_YEAR - 18` = 2008) → `eligible_from_year == KNOWN_THROUGH_YEAR` and `total_cents == 700_000` (that single year's limit only)
  - [x] Test: `current_year = KNOWN_THROUGH_YEAR + 1` → `None`, and assert against `KNOWN_THROUGH_YEAR + 1` rather than a literal year so the test pins the bound and survives the annual table bump
  - [x] Test: unparseable / empty `birth_date` → `None` (no panic)
- [x] **Task 8 — Verification** (AC: all)
  - [x] `cargo test` and `cargo clippy` clean in `apps/desktop/src-tauri` — zero warnings (project rule 9)
  - [x] `pnpm --filter @nixus/desktop test` passes, including the locale-parity suite
  - [x] TypeScript build clean under `noUnusedLocals` / `noUnusedParameters`
  - [x] Confirm no SQLite migration, no `MIGRATIONS` change, no audit-log call, no new Rust crate, and no new npm package were introduced

## Dev Notes

### What this story is, in one sentence

A pure Rust calculation module plus one session-gated read command plus one read-only figure on the profile surface. **No storage, no migration, no new dependency, no network call.**

### CRA annual TFSA limits table — TRANSCRIBE, DO NOT GUESS

> ⚠️ **HUMAN VERIFICATION REQUIRED BEFORE MERGE.** These values were supplied from the story author's knowledge and were **not** fetched from canada.ca. A reviewer MUST verify every row against the CRA's published TFSA contribution-limit table before this story is merged. An incorrect row produces a silently wrong dollar figure in a finance app — the worst possible failure mode for this feature, because the number looks authoritative and nothing errors.

| Year | Annual limit | Cents |
| --- | --- | --- |
| 2009 | $5,000 | `500_000` |
| 2010 | $5,000 | `500_000` |
| 2011 | $5,000 | `500_000` |
| 2012 | $5,000 | `500_000` |
| 2013 | $5,500 | `550_000` |
| 2014 | $5,500 | `550_000` |
| 2015 | $10,000 | `1_000_000` |
| 2016 | $5,500 | `550_000` |
| 2017 | $5,500 | `550_000` |
| 2018 | $5,500 | `550_000` |
| 2019 | $6,000 | `600_000` |
| 2020 | $6,000 | `600_000` |
| 2021 | $6,000 | `600_000` |
| 2022 | $6,000 | `600_000` |
| 2023 | $6,500 | `650_000` |
| 2024 | $7,000 | `700_000` |
| 2025 | $7,000 | `700_000` |
| 2026 | $7,000 | `700_000` |

**`KNOWN_THROUGH_YEAR = 2026`.** This is the story's declared bound. Two rows deserve extra scrutiny during verification: **2015** is the one-off $10,000 year (it was reduced back to $5,500 for 2016 — a plausible place for a table to be silently wrong), and **2026** is the most recently announced limit and therefore the most likely to be wrong or unannounced at implementation time. If 2026 cannot be verified, drop the 2026 row **and** set `KNOWN_THROUGH_YEAR = 2025` together — the two must always move as a pair, which is exactly what the contiguity test in Task 1 enforces.

Derived totals used by the tests (recompute these if any row changes):

- 2009 → 2026 inclusive = **$109,000** = `10_900_000` cents
- 2018 → 2026 inclusive = **$57,000** = `5_700_000` cents
- 2026 alone = **$7,000** = `700_000` cents

### The calculation, stated precisely

```
eligible_from_year = max(birth_year + 18, 2009)
total_cents        = Σ ANNUAL_LIMITS_CENTS[y] for y in eligible_from_year..=current_year
```

- **`2009` is a floor, not an offset.** Someone who turned 18 in 2003 accrues nothing for 2003–2008; the TFSA program did not exist. Hence `max(...)`, not "years since 18".
- **Eligibility is by calendar year, not by birthday.** CRA room accrues for the whole year in which you turn 18, regardless of the month. So the calculation uses `birth_year + 18` and never compares month/day. This is deliberate and is why the "turns 18 in the current year" test expects a full year's limit rather than a prorated one.
  - Interaction worth knowing: Story 28.3's profile validation rejects an implied age under 18 using the *actual* age, so someone born in 2008 whose birthday has not yet passed cannot save a profile at all. The calculator therefore only ever sees birth years whose holder has genuinely turned 18 — but the calculator must still be correct on its own terms, because it is a pure function and its contract is year-based.
- **`current_year` is injected, never read inside the calculator.** `chrono::Local::now().date_naive().year()` is called once, in the command. This is the only way AC #6's "first year past the table bound" case is testable without freezing the system clock. Precedent for `Local::now()` usage: `src-tauri/src/db/maintenance.rs:258`, `src-tauri/src/ai/cc_parser.rs:175`.
- **Past the bound → `None`.** Never extrapolate from the last known limit. The figure is withheld.
- **Integer cents only.** `i64`, `_cents` suffix, no `f64` at any point (project rule 1 — `docs/project-context.md:73-77`). Note that `financial_health/constants.rs:32` does use an `f64` ratio; that is a percentage heuristic, not a monetary sum, and must **not** be taken as licence to use floats here.

### NFR9 — the standing maintenance obligation (read this)

**The CRA announces a new TFSA limit most Novembers, and this table goes stale most Januaries.** The `KNOWN_THROUGH_YEAR` bound is the entire safety mechanism: past it, the figure disappears instead of quietly under-reporting. That is a *correct* failure, but it is still a regression in user value, so:

- Every year a new CRA limit is announced, `ANNUAL_LIMITS_CENTS` gains a row **and** `KNOWN_THROUGH_YEAR` is bumped, in the same commit.
- The table refreshes via app release, exactly like the ISO 3166 dataset — but unlike ISO codes it changes nearly every year, not every few years ([Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10)`]).
- Do **not** add a runtime fetch, a TTL cache, or a `geo_catalog`-style refresh path for this. Runtime fetching is explicitly out of scope for this feature.

### Scope boundary against Story 30.2

This story owns the **happy path** and the mechanics that make it honest:

- In scope here: the limits table + bound, the calculator, the model, the command, the hook, the display, the four required unit tests.
- The command necessarily returns `None` for non-CA, missing-country, missing-`birth_date`, and past-the-bound inputs — that logic ships here because the happy path cannot be correct without it.
- **Story 30.2 owns the degradation acceptance surface**: the full matrix of non-CA / no-country / no-DOB / past-bound UI assertions, the no-session `AppError::Auth { recoverable: true }` assertion, the "TFSA account balance is not subtracted" assertion, and the cross-account carry-over assertion. Do not restate 30.2's matrix as this story's primary scope, and do not implement extrapolation here "so 30.2 has something to turn off".

### Hard prohibition: do not compute remaining room

**Never subtract a TFSA account balance, and never present a "remaining room" figure.** Nixus tracks balances, not contributions. A balance includes market growth (inflating it) and ignores withdrawals (deflating it), so remaining room is not computable from available data and would be wrong in both directions. The account-type plumbing that makes this tempting is real and nearby — `db/net_worth.rs:15` sums `'tfsa'` balances into investments, `db/net_worth.rs:73` maps the account type to a net-worth category, `models/mod.rs:248` holds `tfsa_cents` in `NetWorthBreakdown` — and none of it may be touched or read by this story. [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 30: TFSA Room Visibility`]

### Verified state of the codebase (grepped, not assumed)

`grep -rn "tfsa\|TFSA" apps/desktop/src-tauri/src` returns **only** account-type strings and net-worth category plumbing:

- `db/account.rs:10` — `"tfsa"` in the allowed account-type list
- `db/net_worth.rs:15`, `:73`, `:95`, `:118`, `:147` — net-worth aggregation and category mapping
- `models/mod.rs:248` — `tfsa_cents: i64` inside `NetWorthBreakdown`
- `db/financial_health.rs:384`, `budget/template_defaults.rs:32` — test fixture and a starter-template category name

**There is no contribution-room logic anywhere in the repository today.** This story creates the first of it. `src-tauri/src/` currently contains no `tfsa` directory, no `profile_store.rs`, and no `commands/profile.rs`; `src/hooks/` contains no `useProfile.ts` and `src/routes/` no `profile.tsx`. All of those arrive in Epics 28–29 — see Dependencies.

### Precedent to mirror: `financial_health/`

This is the closest existing example of a pure calculation module with a constants table and inline unit tests. Copy its shape.

`src-tauri/src/financial_health/mod.rs` is two lines and nothing else:

```rust
pub mod constants;
pub mod evaluator;
```

`financial_health/constants.rs` is the constants-plus-helpers-plus-tests pattern:

```rust
pub const DEFAULT_EMERGENCY_FUND_TARGET_MONTHS: i64 = 6;
pub const EMERGENCY_FUND_TARGET_CONFIG_KEY: &str = "emergency_fund_target_months";

pub fn credit_card_debt_buffer_cents(avg_monthly_expenses_cents: i64) -> i64 { /* ... */ }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn essential_patterns_match_housing_and_rent() {
        assert!(is_essential_group_name("Housing"));
```

`financial_health/evaluator.rs` is a pure function over a plain input struct, with `#[cfg(test)] mod tests` at line 106 using a `base_input()` builder and plain `assert_eq!`:

```rust
pub fn evaluate_waterfall(input: &WaterfallEvalInput) -> WaterfallEvaluation { /* ... */ }

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> WaterfallEvalInput { /* ... */ }

    #[test]
    fn build_emergency_fund_wins_when_coverage_below_target() {
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::BuildEmergencyFund);
```

One divergence to note deliberately: `evaluator.rs:6` applies `#[serde(rename_all = "snake_case")]` to a Rust **enum** (where it is meaningful, because variants are `PascalCase`). `TfsaAccumulatedLimit` is a struct whose fields are already `snake_case`, so it takes **no** `rename_all` attribute. Likewise, `maintenance/catalog.rs`'s `#[serde(rename_all = "camelCase")]` is a local exception that must not be copied ([Source: `architecture-user-profile.md#Format Patterns`]).

`financial_health` is registered as `mod financial_health;` at `lib.rs:7`; add `mod tfsa;` the same way.

### Command shape to mirror: `commands/financial_health.rs`

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_financial_health_summary(
    state: State<DbState>,
) -> Result<FinancialHealthSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?;
    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;
    Ok(financial_health_db::build_financial_health_summary(&figures, &evaluation))
}
```

Thin orchestration, `#[tauri::command(rename_all = "snake_case")]`, `Result<T, AppError>`, no panics. `get_tfsa_accumulated_limit` differs in two ways: it takes `app: AppHandle` rather than `State<DbState>` (there is no SQLite involvement — the profile store is file-backed), and it is `async` because `current_subject()` may refresh tokens ([Source: `architecture-user-profile.md#D4`]).

Registration goes in the existing `tauri::generate_handler![...]` list in `lib.rs:168`, which is a flat `commands::{module}::{fn}` list. Module declaration goes in `commands/mod.rs` — already done by Story 28.2 for `pub mod profile;`, so this story adds no new `commands/` module.

### Errors — reuse only

`AppError` (`src-tauri/src/error.rs:5-13`) already has every variant needed:

```rust
pub enum AppError {
    Validation { message: String, field: Option<String> },
    Database { message: String },
    AiService { message: String, recoverable: bool },
    Auth { message: String, recoverable: bool },
    File { message: String },
    NotConfigured,
    InvalidCredentials,
    Unavailable,
}
```

No-session propagates as `AppError::Auth { recoverable: true }` straight out of `current_subject()`. **Introduce no new variant.** An ineligible-but-valid state is `Ok(None)`, never an error — withholding the figure is a normal outcome, not a failure.

### Frontend: hook conventions

`hooks/useProfile.ts` is created by Story 28.2 exporting `useUserProfile`, `useSaveUserProfile`, `useCountries`, `useSubdivisions` ([Source: `architecture-user-profile.md#Naming Patterns`]). This story adds `useTfsaAccumulatedLimit` to that same file — one file per feature, per the `useExpenses.ts` convention.

Shape to follow, from `src/hooks/useFinancialHealth.ts`:

```typescript
export function useFinancialHealthSummary() {
  return useQuery({
    queryKey: queryKeys.financialHealthSummary,
    queryFn: () => invoke<FinancialHealthSummary>("get_financial_health_summary"),
  });
}

export function useSetEmergencyFundTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => invoke<void>("set_emergency_fund_target", { months }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
    },
  });
}
```

`queryKeys` in `src/lib/constants.ts` is a single flat object of kebab-case string arrays (`financialHealth: ["financial-health"] as const`, `accounts: ["accounts"] as const`, with the nested `auth: { session: [...] }` as the lone outlier). Add `tfsaAccumulatedLimit: ["tfsa-accumulated-limit"] as const` as a flat top-level entry, matching `queryKeys.profile: ["profile"]`. Never hardcode the key string in the hook (project rule 6).

**Invalidate on data change, remove on identity change** — these are different operations and must not be conflated ([Source: `architecture-user-profile.md#Communication Patterns`]):

- profile save succeeds → `invalidateQueries(queryKeys.tfsaAccumulatedLimit)` (AC #7)
- sign-out / `auth:callback-received` → `removeQueries(queryKeys.tfsaAccumulatedLimit)`, next to the existing `removeQueries(queryKeys.profile)`. Invalidation would leave the previous account's dollar figure rendered on screen while refetching.

### Frontend: currency formatting

`src/hooks/useFormatCurrency.ts`:

```typescript
export function useFormatCurrency() {
  const { hidden } = useValuesHidden();
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return useCallback(
    (cents: number) => (hidden ? MASKED : realFormatCurrency(cents, locale)),
    [hidden, locale],
  );
}
```

Two properties to know:

1. **It formats by locale, not by a stored currency.** `src/lib/formatCurrency.ts` maps `en → en-CA`, `fr → fr-CA` and hard-codes `currency: "CAD"`. For this figure that is exactly right — a TFSA limit is denominated in CAD by definition — and it is unrelated to the profile's `income_bracket_currency` field, which must not be consulted here.
2. **It already returns a masked placeholder (`"$••••"`) when values are hidden.** So pass its output as `SubStat`'s `value` and leave `masked` at its default `false`. Passing `masked` as well would mask an already-masked string.

### Frontend: the display component

`packages/shared/src/ui/stat.tsx` exports both `Stat` and `SubStat` (re-exported from `@nixus/shared/ui` at `index.ts:89`) with the same props:

```typescript
interface StatProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The figure. A string is masked character-by-character; a node is masked wholesale. */
  value: React.ReactNode
  label?: React.ReactNode
  caption?: React.ReactNode
  masked?: boolean
  /** Localized "Amount hidden". Required whenever `masked` can become true. */
  maskedLabel?: string
}
```

`label` / `value` / `caption` is precisely the "one derived figure with a caption" shape this story needs — do not invent markup for it (project rule 8).

**Use `SubStat`, not `Stat`.** `stat.tsx` carries an explicit in-file constraint: *"At most ONE Stat per surface — it is the single number that answers the surface's question."* The profile surface's question is answered by the form, not by this figure, so the 26px `SubStat` is the correct register. `SubStat` is documented as unlimited per surface, which also leaves room for Epic 30 follow-ons (RRSP/FHSA) without a later refactor.

### i18n keys

Three new keys, added to **both** `src/locales/en.json` and `src/locales/fr.json` in the same change. Locale files are flat dotted-key JSON. Extend the existing `profile.*` namespace — do **not** create a `tfsa.*` or `userProfile.*` namespace ([Source: `architecture-user-profile.md#Naming Patterns`]).

| Key | EN | FR |
| --- | --- | --- |
| `profile.tfsaAccumulatedLimit` | `Total TFSA room accumulated` | `Droits de cotisation CELI accumulés` |
| `profile.tfsaAccumulatedLimitCaption` | `Total room accumulated since {{year}} — not your remaining room.` | `Total des droits accumulés depuis {{year}} — il ne s'agit pas de vos droits restants.` |
| `profile.tfsaAccumulatedLimitNote` | `Nixus does not track your contributions or withdrawals.` | `Nixus ne suit pas vos cotisations ni vos retraits.` |

Wording constraints (AC #2), which are product requirements and not stylistic preferences:

- The label must say **accumulated** / **accumulés**. It must not say "available", "remaining", "restants", or "disponibles".
- The caption must carry the explicit negation of remaining room, and the note must state that contributions and withdrawals are not tracked. Nixus disclaims tax, legal, and investment advice (`README.md`), so honest labelling outranks showing a bigger, more impressive number.
- `{{year}}` is interpolated from `eligible_from_year`, which is exactly why the model returns it rather than only the total. Passing `known_through_year` to the UI is not required for AC #2 but is returned for 30.2 and for support diagnosis.
- Render caption and note as the `caption` slot (concatenated or as a fragment). Both must be visible, not tooltip-only.

`src/locales/__tests__/profile-i18n.test.ts` filters every key with the `profile.` prefix and enforces EN/FR parity, so a one-sided key **fails CI**. It also maintains an explicit `REQUIRED_KEYS` list — add the three new keys there so their absence is caught as a missing requirement rather than passing silently as parity-of-nothing. The suite additionally enforces conventions such as the single-character ellipsis in pending copy; the three keys above contain no ellipsis and no `aria-label` usage.

`en.json:40-46` already holds `profile.signIn`, `profile.accountMenu`, `profile.loading`, `profile.signedInAs`, `profile.signOut`, `profile.sessionExpired`, `profile.sessionExpiredAction` — the namespace exists and is the right home.

### Dependencies and sequencing

- **Depends on Story 28.3** — `birth_date` on the profile document, ISO 8601 `"YYYY-MM-DD"`, validated as not-in-future and implied age 18–120.
- **Depends on Story 29.1** — `country_code` on the profile document, ISO 3166-1 alpha-2, validated against the bundled dataset. The `country_code == "CA"` gate is mandatory for Canada-specific logic ([Source: `architecture-user-profile.md#D8`]).
- **Also requires from Epic 28**: `commands/profile.rs`, `profile_store::load_profile`, `commands::auth::current_subject()`, `hooks/useProfile.ts`, `routes/profile.tsx`, `components/profile/ProfileForm.tsx`. None of these exist in the repo today — verified.
- **Must not be scheduled before Epic 29.** Without `country_code` the figure would be permanently withheld and this epic would look broken rather than degraded ([Source: `epics-user-profile.md#Validation Notes (step-04)`]).
- Story 30.2 depends on this story.

### Testing standards

- **Rust:** inline `#[cfg(test)] mod tests`, plain `#[test]` functions with `assert_eq!`, matching `financial_health/evaluator.rs`. No `tempfile` — this module does no IO. No `.unwrap()` in non-test code.
- **Never hard-code a bare future year in the bound test.** Express it as `KNOWN_THROUGH_YEAR + 1` so the annual table bump does not silently invert the test's meaning.
- **No new Playwright spec is required by this story.** Story 28.2 introduces `tests/profile.spec.ts`; if that spec's Tauri mock enumerates commands, add a `get_tfsa_accumulated_limit` case to it. Every *other* existing spec stays untouched: the figure lives inside the `/profile` route, not in an always-mounted component, so the `project-context.md:295` mock trap does not apply.
- **Locale parity** is covered automatically by `src/locales/__tests__/`.
- **Zero warnings** from `cargo clippy` and from the TypeScript compiler before commit (project rule 9).

### Explicitly out of scope

No SQLite migration, no new table, no `MIGRATIONS` change, no audit-log call (`insert_audit_log` needs a `Connection` and an `i64 entity_id`; this story has neither and writes nothing), no new Rust crate, no new npm package, no `tauri.conf.json` or capability change, no new Tauri event, no network call, no RRSP/FHSA calculation, no extrapolation past the table bound, no remaining-room computation.

### Project Structure Notes

New and modified paths, all consistent with the delta tree in `architecture-user-profile.md#Delta to Existing Project Tree` plus the Amendment:

```
apps/desktop/src-tauri/src/
├── lib.rs                       # MODIFIED: + `mod tfsa;`; register
│                                #           commands::profile::get_tfsa_accumulated_limit
├── tfsa/                        # NEW: pure calculation module, no IO, no SQLite
│   ├── mod.rs                   # NEW: `pub mod calculator; pub mod constants;`
│   ├── constants.rs             # NEW: ANNUAL_LIMITS_CENTS, TFSA_FIRST_YEAR,
│   │                            #      KNOWN_THROUGH_YEAR + contiguity tests
│   └── calculator.rs            # NEW: accumulated_limit(birth_date, current_year) + tests
├── models/mod.rs                # MODIFIED: + TfsaAccumulatedLimit
└── commands/profile.rs          # MODIFIED (created in 28.2): + get_tfsa_accumulated_limit

apps/desktop/src/
├── lib/constants.ts             # MODIFIED: + queryKeys.tfsaAccumulatedLimit
├── lib/types.ts                 # MODIFIED: + TfsaAccumulatedLimit
├── hooks/useProfile.ts          # MODIFIED (created in 28.2): + useTfsaAccumulatedLimit;
│                                #          invalidate tfsaAccumulatedLimit on save success
├── hooks/useAuth.ts             # MODIFIED: removeQueries(tfsaAccumulatedLimit) at both
│                                #           existing removeQueries(profile) call sites
├── components/profile/
│   ├── TfsaAccumulatedLimit.tsx # NEW: SubStat display, renders null when withheld
│   └── ProfileForm.tsx          # MODIFIED (created in 28.2): mount it after date of birth
└── locales/en.json, fr.json     # MODIFIED: 3 new profile.tfsa* keys, both files
apps/desktop/src/locales/__tests__/profile-i18n.test.ts  # MODIFIED: + 3 REQUIRED_KEYS
```

**Deliberately not touched:** `src-tauri/migrations/`, `db/mod.rs` `MIGRATIONS`, `db/danger_zone.rs`, `db/audit.rs`, `db/backup.rs`, `db/net_worth.rs`, `db/account.rs`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `components/shared/AppSidebar.tsx`, `lib/navigation.ts`, and every existing `tests/*.spec.ts`.

**Variance from the naming convention, with rationale:** the calculation module is `src-tauri/src/tfsa/` — a top-level sibling of `financial_health/`, **not** `db/tfsa.rs`. Project rule 3 places SQL in `db/`; this module executes no SQL and reads no `Connection`, so `financial_health/` (pure computation over injected inputs) is the correct precedent. Rust file/module names are `snake_case`, satisfied by `tfsa/`, `constants.rs`, `calculator.rs`.

**No conflicts detected** between this story and the architecture document. The architecture's original statement that FR5 consumers are "not implemented in this pass" is superseded by its own Amendment (2026-08-10) and by `epics-user-profile.md`, both of which pull this consumer into scope.

### References

- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 30.1: See how much TFSA room I've accumulated` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory` — FR9, FR10, NFR9]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements` — TFSA calculation shape; TFSA IPC surface (Epic 30): `get_tfsa_accumulated_limit`, `{ total_cents, eligible_from_year, known_through_year }`, query key `tfsaAccumulatedLimit: ["tfsa-accumulated-limit"]`, invalidate on save / remove on session transition]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 30: TFSA Room Visibility` — balances must not be subtracted; known maintenance commitment]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)` — 30.1 depends on 28.3 and 29.1; must not precede Epic 29]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#UX Design Requirements` — figure appears adjacent to date of birth; caveat wording flagged for decision inside the story]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 30.2: Never be shown a misleading TFSA number` — degradation matrix owned by 30.2]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10): one FR5 consumer pulled into scope`]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D8` — `country_code == "CA"` gating requirement for Canada-specific consumers]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D4` — command shape, `async` because `current_subject()` may refresh tokens]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D5`, `#Communication Patterns` — invalidate on data change, remove on identity change]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D13` — reuse `AppError`, add no variant]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Naming Patterns`, `#Format Patterns` — `profile.*` i18n namespace; `snake_case` serde default; `camelCase` exception must not be copied]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Enforcement Guidelines` — `current_subject()` in Rust, never a `sub` IPC param; both locale files in one change]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)` — `i64` cents, `_cents` suffix, no floats]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` / `#Tauri IPC` — `rename_all = "snake_case"`, `Result<T, AppError>`, register in `lib.rs`]
- [Source: `docs/project-context.md#4. Rust Model Structs` — derive set, `snake_case` fields, models in `models/mod.rs`]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`, kebab-case arrays]
- [Source: `docs/project-context.md#8. Shared UI Components` — check `@nixus/shared/ui` first, never duplicate]
- [Source: `docs/project-context.md#9. Compilation Warnings Policy`]
- [Source: `docs/project-context.md#Testing Rules` — Vitest locale parity + hook tests; Playwright mock trap at line 295]
- [Source: `apps/desktop/src-tauri/src/financial_health/mod.rs`, `constants.rs`, `evaluator.rs` — module/constants/tests precedent to mirror]
- [Source: `apps/desktop/src-tauri/src/commands/financial_health.rs` — thin-command precedent]
- [Source: `apps/desktop/src-tauri/src/lib.rs:7`, `:168` — `mod financial_health;` declaration and `generate_handler!` list]
- [Source: `apps/desktop/src-tauri/src/error.rs:5-13` — `AppError` variants]
- [Source: `apps/desktop/src-tauri/src/models/mod.rs:243-255` — `NetWorthBreakdown` incl. `tfsa_cents`; model derive conventions]
- [Source: `apps/desktop/src-tauri/src/db/net_worth.rs:15`, `:73`, `:118` — `tfsa` exists only as an account type / net-worth category; no contribution-room logic exists]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:10` — `"tfsa"` account-type allow-list]
- [Source: `apps/desktop/src-tauri/src/db/maintenance.rs:258`, `apps/desktop/src-tauri/src/ai/cc_parser.rs:175` — `chrono::Local::now()` precedent for current-date resolution]
- [Source: `apps/desktop/src/hooks/useFinancialHealth.ts` — query/mutation hook shape]
- [Source: `apps/desktop/src/hooks/useFormatCurrency.ts`, `apps/desktop/src/lib/formatCurrency.ts` — locale-based formatting, CAD hard-coded, masks when values hidden]
- [Source: `apps/desktop/src/lib/constants.ts` — `queryKeys` flat kebab-case shape]
- [Source: `packages/shared/src/ui/stat.tsx`, `packages/shared/src/ui/index.ts:89` — `Stat` / `SubStat` API and the "at most ONE Stat per surface" constraint]
- [Source: `apps/desktop/src/locales/en.json:40-46` — existing `profile.*` namespace]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — parity suite, `REQUIRED_KEYS` list]
- [Source: `README.md` — Nixus is not tax, legal, or investment advice]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → **424 passed; 0 failed** (baseline 411 + 13 new: 6 in `tfsa/constants.rs`, 7 in `tfsa/calculator.rs`)
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` → 1 warning, the pre-existing `explicit_auto_deref` at `commands/backup.rs:106`. **No new warning.**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → clean, exit 0
- `pnpm --filter @nixus/desktop test` → **198 passed** (baseline 192 + 6 new in `profile-i18n.test.ts`)
- `pnpm --filter @nixus/desktop exec playwright test` → **393 passed, 0 failed** (baseline ~390 + 3 new). A first full-suite run also reported `expenses.spec.ts:479` failing; it passed in the clean full re-run and in isolation, so it is the known `expenses.spec.ts` flake, not a regression from this story.

### Completion Notes List

**⚠️ HUMAN VERIFICATION REQUIRED BEFORE MERGE.** `ANNUAL_LIMITS_CENTS` in `src-tauri/src/tfsa/constants.rs` was transcribed verbatim from this story's Dev Notes, which were supplied from model knowledge and were **not** fetched from canada.ca. A reviewer MUST verify every row against the CRA's published TFSA contribution-limit table before merge. The warning is preserved as a code comment above the table. Scrutinise 2015 (the one-off $10,000 year) and 2026 (most recently announced). If 2026 cannot be verified, drop the row **and** lower `KNOWN_THROUGH_YEAR` to 2025 in the same commit — the contiguity test enforces that they move as a pair.

**⚠️ NFR9 — standing annual maintenance obligation.** The CRA announces a new TFSA limit most Novembers and this table goes stale most Januaries. Past `KNOWN_THROUGH_YEAR` the figure **disappears** rather than under-reporting: a correct failure, but still a loss of user value. Every year a new limit is announced, `ANNUAL_LIMITS_CENTS` gains a row **and** `KNOWN_THROUGH_YEAR` is bumped, in the same commit. `tfsa::constants::tests` (`table_last_year_equals_known_through_year`, `table_years_are_contiguous_with_no_gaps_or_duplicates`, `table_covers_every_year_in_the_declared_range_exactly_once`) fails CI on a half-update. No runtime fetch, no TTL cache, no refresh path was added and none may be.

Implementation notes:

- **Calculation lives only in Rust.** `tfsa::calculator::accumulated_limit(birth_date, current_year)` is a pure function with `current_year` injected; the single `chrono::Local::now().date_naive().year()` call is in the command. The frontend performs no eligibility check and no arithmetic — it renders the value or renders nothing — so the two sides cannot produce divergent numbers (AC #8).
- **Calendar-year eligibility, no proration.** `eligible_from_year = max(birth_year + 18, TFSA_FIRST_YEAR)`. Month and day are never compared. `2009` is a floor, not an offset.
- **Integer cents throughout.** `total_cents: i64`, no `f64` at any point.
- **No remaining room, ever.** No TFSA account balance is read or subtracted; `db/net_worth.rs`, `db/account.rs` and `NetWorthBreakdown` were not touched. `TfsaAccumulatedLimit` has no remaining-room field, and the i18n label is asserted by test to exclude "available" / "remaining" / "restants" / "disponibles" while the caption carries the explicit negation and the note the no-tracking disclaimer, in both EN and FR (AC #2).
- **Degradation covered here** (the minimum the command's `Option` return requires): non-CA `country_code`, absent `country_code`, absent profile document, absent `birth_date`, unparseable `birth_date`, not-yet-18 in `current_year`, and `current_year > KNOWN_THROUGH_YEAR`. All answer `Ok(None)` → the component renders `null`. No-session propagates as `AppError::Auth { recoverable: true }` straight out of `current_subject()`; no new `AppError` variant.
- **Left to Story 30.2**: the exhaustive degradation *acceptance surface* — the full non-CA / no-country / no-DOB / past-bound UI assertion matrix, the explicit no-session `AppError::Auth { recoverable: true }` assertion, the "TFSA account balance is not subtracted" assertion, and the cross-account carry-over assertion. Three Playwright tests were added here (happy path, withheld-renders-nothing, FR translation), not the full matrix.
- **`get_tfsa_accumulated_limit` was removed from `FUTURE_PROFILE_COMMANDS`** in `tests/profile.spec.ts` and moved to a positive `toContain` assertion — that list's declared purpose is "commands later stories introduce", and this is now the shipping story. The two no-session assertions were strengthened to also require the command's absence.
- **Out of scope confirmed absent**: no SQLite migration, no `MIGRATIONS` change, no new table, no audit-log call, no new Rust crate, no new npm package, no `tauri.conf.json` or capability change, no new Tauri event, no network call, no new shared UI primitive (reused `SubStat`), no extrapolation past the bound.
- i18n: `en.json` and `fr.json` both went from 1217 to **1220** keys, verified equal.

### File List

New:

- `apps/desktop/src-tauri/src/tfsa/mod.rs`
- `apps/desktop/src-tauri/src/tfsa/constants.rs`
- `apps/desktop/src-tauri/src/tfsa/calculator.rs`
- `apps/desktop/src/components/profile/TfsaAccumulatedLimit.tsx`

Modified:

- `apps/desktop/src-tauri/src/lib.rs` — `mod tfsa;`; registered `commands::profile::get_tfsa_accumulated_limit`
- `apps/desktop/src-tauri/src/models/mod.rs` — `TfsaAccumulatedLimit`
- `apps/desktop/src-tauri/src/commands/profile.rs` — `get_tfsa_accumulated_limit`, `chrono::Datelike` import
- `apps/desktop/src/lib/types.ts` — `TfsaAccumulatedLimit`
- `apps/desktop/src/lib/constants.ts` — `queryKeys.tfsaAccumulatedLimit`
- `apps/desktop/src/hooks/useProfile.ts` — `useTfsaAccumulatedLimit`; invalidate on save success
- `apps/desktop/src/hooks/useAuth.ts` — `removeQueries` at both identity-transition sites
- `apps/desktop/src/components/profile/ProfileForm.tsx` — mounts the figure after the date-of-birth field
- `apps/desktop/src/locales/en.json` — 3 `profile.tfsa*` keys
- `apps/desktop/src/locales/fr.json` — 3 `profile.tfsa*` keys
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — 3 `REQUIRED_KEYS`, `{{year}}` placeholder guard, 2 wording assertions
- `apps/desktop/tests/profile.spec.ts` — mock case for the new command, 3 new tests, `FUTURE_PROFILE_COMMANDS` updated
