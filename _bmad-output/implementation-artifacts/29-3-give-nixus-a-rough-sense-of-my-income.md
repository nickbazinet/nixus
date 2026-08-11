# Story 29.3: Give Nixus a rough sense of my income

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user who hasn't entered all my income data yet,
I want to pick an approximate yearly income bracket and say which currency it's in,
so that Nixus can reason about my situation at the right scale without me itemizing everything.

## Acceptance Criteria

1. **Given** I am on `/profile`
   **When** I open the income bracket selector
   **Then** I see five ranges: under 50k, 50k–99k, 100k–149k, 150k–249k, and 250k or more
   **And** each label is translated in English and French.

2. **Given** I select an income bracket
   **When** I look at the form
   **Then** a currency selector is presented with no pre-filled guess, because Nixus has no app-level display currency.

3. **Given** I select a bracket but no currency
   **When** I press Save
   **Then** it is rejected as `AppError::Validation { field: "income_bracket_currency" }`
   **And** the error is surfaced against the currency field.

4. **Given** I select a currency but no bracket
   **When** I press Save
   **Then** it saves successfully and the currency is inert.

5. **Given** I select both and press Save
   **When** the document is written
   **Then** `income_bracket` holds one of the five allow-listed codes
   **And** `income_bracket_currency` holds an uppercase ISO 4217 code.

6. **Given** an `income_bracket` value outside the allow-list is submitted
   **When** validation runs
   **Then** it is rejected as `AppError::Validation { field: "income_bracket" }`.

7. **Given** an `income_bracket_currency` value outside the curated allow-list is submitted
   **When** validation runs
   **Then** it is rejected as `AppError::Validation { field: "income_bracket_currency" }`.

8. **Given** the bracket is stored
   **When** the implementation is inspected
   **Then** it is a categorical string code, not an `_cents` integer, because it is a range rather than a monetary amount.

9. **Given** the currency selector is inspected
   **When** its option list is compared to the source of truth
   **Then** the options are exactly the codes in the single Rust allow-list const, and no default value is derived from locale, from an account, or from anything else.

10. **Given** both fields are cleared and Save is pressed
    **When** the document is written
    **Then** `income_bracket` and `income_bracket_currency` are both `null` (never `""`) and the save succeeds.

11. **Given** the two new form fields are inspected
    **When** their `name` props are read
    **Then** they are the `snake_case` IPC names `income_bracket` and `income_bracket_currency`, so `AppError::Validation { field }` maps straight to react-hook-form `setError(field)` with no translation table.

12. **Given** the i18n files are inspected
    **When** the locale-parity suite runs
    **Then** every new key exists in both `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`, with no key present in only one file.

## Tasks / Subtasks

- [x] Task 1 — Add the two allow-list consts to `profile_store.rs` as the single validation authority (AC: #5, #6, #7, #9)
  - [x] Add `const VALID_INCOME_BRACKETS: &[&str] = &["under_50k", "50k_99k", "100k_149k", "150k_249k", "250k_plus"];`
  - [x] Add `const VALID_INCOME_BRACKET_CURRENCIES: &[&str]` containing exactly: `CAD`, `USD`, `EUR`, `GBP`, `AUD`, `CHF`, `JPY`, `CNY`, `INR`, `MXN`, `BRL`, `SEK`, `NOK`, `DKK`, `NZD`, `SGD`, `HKD`, `ZAR`, `KRW`, `PLN` (20 codes, uppercase).
  - [x] Make both `pub` (or expose a `pub fn` accessor) only if a caller outside `profile_store.rs` needs them; otherwise keep private — no second copy anywhere.
- [x] Task 2 — Validate `income_bracket` in `profile_store::save_profile` (AC: #6, #8, #10)
  - [x] Trim the incoming value; an empty string becomes `None` before validation so "unset" has exactly one representation.
  - [x] If `Some(value)` and `!VALID_INCOME_BRACKETS.contains(&value)` → return `AppError::Validation { message: format!("Invalid income bracket: {}", value), field: Some("income_bracket".to_string()) }`, matching the `db/account.rs` allow-list style verbatim.
  - [x] Store the value as the raw categorical string — no numeric parsing, no `_cents` conversion, no range arithmetic.
- [x] Task 3 — Validate and normalize `income_bracket_currency` (AC: #5, #7, #10)
  - [x] Trim, then uppercase, then allow-list check — in that order — so any IPC caller (not just the Select) yields a stored uppercase ISO 4217 code.
  - [x] Empty string becomes `None` before validation.
  - [x] If `Some(code)` and `!VALID_INCOME_BRACKET_CURRENCIES.contains(&code)` → return `AppError::Validation { message: format!("Invalid income bracket currency: {}", code), field: Some("income_bracket_currency".to_string()) }`.
  - [x] Persist the normalized uppercase code, not the raw input.
- [x] Task 4 — Add the conditional-requirement rule as ONE reusable pattern (AC: #3, #4)
  - [x] `income_bracket = Some(_)` with `income_bracket_currency = None` → `AppError::Validation { message, field: Some("income_bracket_currency".to_string()) }`.
  - [x] `income_bracket_currency = Some(_)` with `income_bracket = None` → permitted; save succeeds and the currency is inert (no error, no clearing, no coercion).
  - [x] Express this as a small shared helper (e.g. `fn require_companion(dependent: Option<&str>, companion: Option<&str>, companion_field: &str) -> Result<(), AppError>`) so `profile_store.rs` carries ONE conditional-validation pattern. Story 29.2's `subdivision_code`-requires-`country_code` rule is the same shape — if 29.2 has already landed a helper, reuse it rather than adding a second ad-hoc branch; if it has not, write this one to be reusable by it.
- [x] Task 5 — Rust unit tests in `profile_store.rs`'s existing `#[cfg(test)] mod tests` using `tempfile` (AC: #3, #4, #5, #6, #7, #10)
  - [x] `valid_bracket_and_currency_are_saved` — asserts both persist and the stored currency is uppercase.
  - [x] `bracket_without_currency_is_rejected` — asserts `AppError::Validation` with `field == Some("income_bracket_currency")`.
  - [x] `currency_without_bracket_saves_and_is_inert` — asserts `Ok`, `income_bracket == None`, currency preserved.
  - [x] `invalid_bracket_code_is_rejected` — asserts `field == Some("income_bracket")`.
  - [x] `invalid_currency_code_is_rejected` — asserts `field == Some("income_bracket_currency")`.
  - [x] `both_income_fields_cleared_to_none` — asserts a save with both `None` succeeds and both round-trip as `None`.
- [x] Task 6 — Add the two fields to `components/profile/ProfileForm.tsx` (AC: #1, #2, #9, #11)
  - [x] Import `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `@nixus/shared/ui` — do not build a new select (project rule 8).
  - [x] Register the fields as `income_bracket` and `income_bracket_currency`. The Base UI `Select` is not a native `<input>`, so wire each through react-hook-form `Controller` (`value` / `onValueChange`) — `register()` alone will not track it.
  - [x] Bracket Select: five `SelectItem`s with values `under_50k`, `50k_99k`, `100k_149k`, `150k_249k`, `250k_plus`, labels via `t()`.
  - [x] Currency Select: options generated from the curated code list, each rendering its uppercase code verbatim. **No `defaultValue`, no fallback, no locale/account-derived guess** — initial value is `null` and the trigger shows the placeholder until the user picks.
  - [x] Render both Selects always, adjacent, as one visual unit — the currency field is NOT gated on a bracket being chosen, because a currency without a bracket is a permitted state and gating would make it unreachable.
  - [x] Map `""`/unselected to `null` before `invoke` (absent values are `null`, never empty strings).
  - [x] No autosave — both fields commit only via the existing explicit Save button (Epic 28 resolution).
- [x] Task 7 — Surface the server-side error on the right field (AC: #3, #11)
  - [x] Confirm the existing submit-error handler from Story 28.2 passes `AppError.field` straight to `setError(field, { message })`; because the form field names are the IPC names, `income_bracket_currency` resolves with no mapping table. Add no translation table.
- [x] Task 8 — Verify the type/IPC surface already carries both fields; extend only if it does not (AC: #5, #10)
  - [x] Confirm Rust `UpdateUserProfileInput` in `models/mod.rs` already has `income_bracket: Option<String>` and `income_bracket_currency: Option<String>` (created in Story 28.2 — expected present; derive stays exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`).
  - [x] Confirm the TypeScript profile input type in `apps/desktop/src/lib/types.ts` carries both fields; if 28.2 omitted them, add them there — this is the only additional file edit permitted by this story.
  - [x] No change to `commands/profile.rs`, `hooks/useProfile.ts`, `lib/constants.ts`, or `lib.rs`: full-replace save semantics already carry the whole document and no new command is introduced.
- [x] Task 9 — Add i18n keys to BOTH locale files (AC: #1, #12)
  - [x] `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` use a FLAT dotted-key format (e.g. `"profile.signIn": "Sign in"`). Add flat keys in the existing `profile.*` namespace — do not introduce `userProfile.*` and do not nest.
  - [x] Keys: `profile.incomeBracket`, `profile.incomeBracketPlaceholder`, `profile.incomeBracketCurrency`, `profile.incomeBracketCurrencyPlaceholder`, `profile.incomeBracketCurrencyRequired`, `profile.bracketUnder50k`, `profile.bracket50k99k`, `profile.bracket100k149k`, `profile.bracket150k249k`, `profile.bracket250kPlus`.
  - [x] No per-currency i18n keys are added — see Dev Notes.
  - [x] Run `pnpm --filter @nixus/desktop test` — the locale-parity suite in `src/locales/__tests__/` fails CI on any key present in only one file.
- [x] Task 10 — Extend the feature's own Playwright spec for the profile page (AC: #1, #2, #3)
  - [x] Assert the bracket Select exposes exactly five options and the currency Select opens with nothing selected.
  - [x] Assert a bracket-without-currency save surfaces the error message against the currency field, using the stubbed `save_user_profile` returning the `AppError` shape.
  - [x] Only the profile feature's own spec is touched. No other spec's Tauri mock needs updating: this story adds no IPC command and changes no always-mounted component, so the trap at `docs/project-context.md:295` does not apply.
- [x] Task 11 — Clean gates (project rules 7, 9)
  - [x] `cargo test` and `cargo clippy` clean — zero Rust warnings, no `.unwrap()` outside tests.
  - [x] `tsc` clean — zero TypeScript warnings; `noUnusedLocals`/`noUnusedParameters` are CI failures.
  - [x] No `console.log`.

## Dev Notes

**Why the bracket is a categorical string and NOT an `_cents` integer.** Project rule 1 (`docs/project-context.md#1-monetary-values--always-integers-cents`) is enforced strictly everywhere else in this codebase: every monetary field is `i64` cents with a `_cents` suffix. An implementer will plausibly reach for `income_bracket_min_cents` / `income_bracket_max_cents` out of habit. Do not. `income_bracket` is a **range label, not a monetary amount** — there is no value to add, subtract, or format, so rule 1 does not apply. Values are the five codes verbatim. Adding cut points later stays additive with no data migration. [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D7`]

**Why the currency field exists at all.** The bracket exists specifically to improve AI reasoning about the user's situation. A currency-less bucket is actively harmful in a worldwide app: ¥100,000 and US$100,000 differ by more than two orders of magnitude, so a wrong-scale figure produces confident wrong reasoning. Capturing the currency next to a currency-agnostic bucket set is one nullable field; per-currency bucket sets would be far more machinery for the same outcome. This is also why the bracket-requires-currency rule is a hard validation error rather than a soft warning. [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D7`]

**Why there is no default currency — do not try to derive one.** Nixus has **no app-level display currency**. Established facts, stated here so they are not re-investigated:
- The `config` table holds only `ai_provider`, `ai_configured`, `aws_region`, `onboarding_completed`, and an emergency-fund key. There is no currency row.
- `useFormatCurrency.ts` formats by **locale** (`en-CA` / `fr-CA`), not by a stored currency.
- Currency is a **per-account** property on `accounts` (CAD/USD), and the app performs **no FX conversion anywhere**.

Architecture decision D7 originally said to default the currency to "the app's current display currency". Gap analysis **G3** found that value does not exist and rejected the derived default outright: `income_bracket_currency` is an **explicit form field with no default**. Do not derive it from locale, from an account's currency, from the first account, or from anything else. [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#G3`]

**Curated currency list — decision already made, do not re-open.** The currency Select offers a curated short list of major currencies, **not** the full ISO 4217 set. Rationale to preserve: (a) there is no bundled ISO 4217 dataset in the repo and NFR6 forbids adding a new dependency or data file; (b) ~180 options is poor UX for a field that feeds five coarse brackets; (c) a curated list needs no new data file, script, crate, or npm package. The list is `CAD`, `USD` (already the accounts currencies), plus `EUR`, `GBP`, `AUD`, `CHF`, `JPY`, `CNY`, `INR`, `MXN`, `BRL`, `SEK`, `NOK`, `DKK`, `NZD`, `SGD`, `HKD`, `ZAR`, `KRW`, `PLN`. Codes are stored uppercase. The list lives in **one Rust const in `profile_store.rs`, which is the validation authority** — the frontend option list must be derived from or kept identical to it, never a second independent source of truth.

**Validation style to copy.** `apps/desktop/src-tauri/src/db/account.rs` is the reference pattern. It declares `const VALID_CURRENCIES: &[&str] = &["CAD", "USD"];` and `const VALID_ACCOUNT_TYPES: &[&str] = &[...]`, then guards with:

```rust
if !VALID_CURRENCIES.contains(&input.currency.as_str()) {
    return Err(AppError::Validation {
        message: format!("Invalid currency: {}", input.currency),
        field: Some("currency".to_string()),
    });
}
```

Mirror exactly this shape — module-level `const` allow-list, `.contains()` guard, `AppError::Validation` with `message` + `field: Some(...)`. Note that `account.rs` does not normalize case because its currency comes from a two-option control; this story additionally trims and uppercases **before** the allow-list check so AC #5 (stored uppercase) holds for any IPC caller, not just the Select.

**One conditional-validation pattern, not two.** This story's bracket-requires-currency rule is the same shape as Story 29.2's subdivision-requires-country rule, and both live in `profile_store.rs`. G3 explicitly calls this out: the store should end up with **one consistent conditional-requirement pattern rather than two ad-hoc ones**. Write the check as a reusable helper. Note this story does **not** depend on 29.1 or 29.2 — it depends on Story 28.2 only — so 29.2's rule may or may not exist yet. Either reuse its helper or write yours to be reused by it.

**No per-currency i18n keys.** ISO 4217 codes are language-neutral tokens; the Select renders the uppercase code verbatim in both EN and FR. The existing `accounts.currencyCAD` / `accounts.currencyUSD` keys in `en.json` are literal passthroughs (`"CAD"` / `"USD"`) and demonstrate that no translation happens — but they live in the `accounts.*` namespace and **must not be reused** for this field. The complete new-key list is in Task 9. Bracket labels deliberately carry **no currency symbol** (the currency is a separate field), e.g. EN `"Under 50,000"` / `"50,000 – 99,999"` / `"250,000 or more"`, FR `"Moins de 50 000"` / `"50 000 – 99 999"` / `"250 000 ou plus"`.

**What already exists (Story 28.2) — do not recreate.** `profile_store.rs`, `commands/profile.rs`, `components/profile/ProfileForm.tsx`, `hooks/useProfile.ts`, and the `UserProfile` / `UpdateUserProfileInput` models all already exist, and both `income_bracket` and `income_bracket_currency` are already declared on the models. The scope of this story is narrow: **add the two fields to `ProfileForm.tsx` and add their validation to `profile_store.rs`.**

**Storage and save semantics inherited from 28.2.** Profile data is one JSON document per Cognito `sub` under `app_data_dir/profiles/`, outside SQLite. `save_user_profile` has **full-replace** semantics — `None` clears the field, it does not mean "unchanged". Every profile field is nullable; the profile is progressive and the user fills in only what they choose. Absent values are `null`, never `""`. JSON/IPC fields are serde-default `snake_case` — do not copy `catalog.rs`'s `#[serde(rename_all = "camelCase")]`.

**Model conventions.** All structs in `models/mod.rs` derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields (confirmed: that derive line is repeated uniformly throughout the file). No derive change is needed for this story.

**Shared `Select` primitive.** `packages/shared/src/ui/select.tsx` wraps `@base-ui/react/select` and exports `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectGroupLabel`. `Select<Value>` forwards `SelectPrimitive.Root.Props<Value>`, and `SelectContent` already renders through a Portal/Positioner with `max-h-[min(var(--available-height),16rem)]` and `overflow-y-auto` — a 20-item currency list scrolls correctly with no extra work. `SelectTrigger` supports `aria-invalid` styling (`aria-invalid:border-over`), so the server-side error state renders without new CSS.

**Testing standards.** Rust unit tests go inline in `profile_store.rs`'s `#[cfg(test)] mod tests` using `tempfile`, matching `db/backup.rs`. Desktop unit tests run with `pnpm --filter @nixus/desktop test` (Vitest + jsdom; locale-parity specs live in `src/locales/__tests__/`). Playwright E2E runs against the plain Vite dev server with `window.__TAURI_INTERNALS__.invoke` stubbed per spec — there is no real IPC in that suite.

**Explicitly out of scope.** No country/subdivision work (Stories 29.1, 29.2). No TFSA work (Epic 30). No SQLite migration, table, or `db/` module. No audit-log call (a file-backed store has no `Connection` and no `i64 entity_id`; consistent with `credentials.rs` and `catalog.rs`). No new Rust crate, npm package, data file, or runtime network call. No new `AppError` variant. No `sprint-status.yaml` edit.

### Project Structure Notes

Files this story touches — nothing else:

| File | Change |
|------|--------|
| `apps/desktop/src-tauri/src/profile_store.rs` | UPDATE — two allow-list consts, bracket + currency validation, conditional-requirement helper, six unit tests |
| `apps/desktop/src/components/profile/ProfileForm.tsx` | UPDATE — two `Select` fields named `income_bracket` and `income_bracket_currency` |
| `apps/desktop/src/locales/en.json` | UPDATE — ten new flat `profile.*` keys |
| `apps/desktop/src/locales/fr.json` | UPDATE — the same ten keys |
| `apps/desktop/src/lib/types.ts` | UPDATE **only if** the profile input type is missing the two fields |
| `apps/desktop/tests/` (profile spec from 28.2) | UPDATE — bracket/currency assertions |

No new files. Alignment notes:
- Rust validation stays in the store layer, not in `commands/profile.rs` (thin orchestration only — project rule 3 by analogy; `profile_store.rs` is the sole accessor of `profiles/`).
- Component lives under `components/profile/` per the `components/{feature}/` convention; the `/profile` route file holds no form logic.
- i18n keys extend the existing `profile.*` namespace — no second namespace.
- No `queryKeys` change: `queryKeys.profile` already exists and `useSaveUserProfile.onSuccess` already invalidates it.

**Variance to record:** the currency allow-list is a curated 20-code subset rather than full ISO 4217, and this story trims+uppercases before allow-list checking whereas `db/account.rs` checks the raw string. Both deviations are deliberate and justified above (NFR6 / no bundled ISO 4217 dataset; AC #5 stored-uppercase guarantee).

### References

- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 29.3 Give Nixus a rough sense of my income`] — acceptance criteria 1–6 and 8 copied faithfully.
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory`] — FR2 (income bracket with its currency), FR5 (profile as AI insight context), NFR5 (EN/FR i18n for all field labels and income bracket values), NFR6 (zero new dependencies).
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements`] — income bracket allow-list and "not `_cents`" rationale; conditional validation rules in `profile_store.rs`; form field names are the `snake_case` IPC names; full-replace save semantics; no audit logging; no SQLite work; testing approach; serde casing.
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)`] — forward-dependency check: `29.3 → 28.2` only.
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#D7 · Income bracket carries its currency`] — allow-list, categorical-not-cents rationale, currency-less-bucket harm argument.
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#G3`] — the derived currency default is unimplementable; explicit field, conditionally required, mirroring the subdivision-requires-country rule; a currency without a bracket is permitted and inert.
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Format Patterns`] — `income_bracket_currency` is an uppercase ISO 4217 code; absent values are `null`, never `""`; snake_case JSON.
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Process Patterns`] — validation is server-authoritative; form field names are the IPC names so `AppError::Validation { field }` maps to `setError(field)`.
- [Source: `apps/desktop/src-tauri/src/db/account.rs:17` and `:141-146`] — `const VALID_CURRENCIES: &[&str] = &["CAD", "USD"];` and the `.contains()` + `AppError::Validation { message, field }` guard style to mirror.
- [Source: `apps/desktop/src-tauri/src/models/mod.rs`] — every model derives exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields.
- [Source: `packages/shared/src/ui/select.tsx`] — `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` exports, `@base-ui/react/select` primitive, scrolling popup, `aria-invalid` trigger styling.
- [Source: `apps/desktop/src/locales/en.json:40-46, :200-201`] — flat dotted-key format, existing `profile.*` namespace, `accounts.currencyCAD` / `accounts.currencyUSD` literal passthroughs.
- [Source: `docs/project-context.md#1-monetary-values--always-integers-cents`] — the rule that deliberately does NOT apply to `income_bracket`.
- [Source: `docs/project-context.md#5-error-handling-apperror`] — use the existing `AppError` enum; never ad-hoc error types.
- [Source: `docs/project-context.md#8-shared-ui-components`] — check `@nixus/shared/ui` first; never duplicate an existing component.
- [Source: `docs/project-context.md#Testing Rules`] — Vitest locale-parity specs in `src/locales/__tests__/`; Playwright against the Vite dev server with stubbed `invoke`.
- [Source: `docs/project-context.md:295`] — the always-mounted-component Tauri-mock trap, deliberately not triggered by this story.

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

- `[role="option"][aria-selected="true"]` is **not** empty when a Select's value is `null`: Base UI marks the standalone unset `SelectItem` as selected. The "no derived default" assertion therefore asserts the *selected option is the unset entry*, which is a stronger claim than "nothing is selected".
- Base UI leaves a closed Select popup **mounted**, so any spec that opens two selects sees the shared `profile.*Unset` label twice and trips Playwright strict mode. Scoping by `:visible` still flaked under full-suite load, because a closing popup keeps a non-empty bounding box for the length of its exit animation. The deterministic scope is the state attribute `[data-slot="select-content"][data-open]`. This latent race pre-existed in the Story 29.2 subdivision spec and was hardened, not weakened.

### Completion Notes List

- **The bracket is a categorical string, not cents.** `income_bracket` stores one of the five codes verbatim. No `_cents` field, no numeric parse, no range arithmetic — project rule 1 does not apply to a range label. A unit test asserts the persisted JSON value `is_string()`.
- **One conditional-validation pattern, not two.** Added `require_companion(dependent, companion, error_field, message)` and **refactored Story 29.2's subdivision-requires-country branch to call it**, so `profile_store.rs` now carries exactly one conditional-requirement primitive (G3). `error_field` is a parameter because the two rules blame opposite sides: a subdivision without a country is the subdivision's fault, while a bracket without a currency is reported against the currency. 29.2's message and field are unchanged — behaviour-preserving.
- **No derived currency default.** The currency `Select` has no `defaultValue`, no fallback and no locale/account inference. Verified by an E2E assertion that the selected option on a fresh profile is the unset entry, and by an assertion that an untouched form submits `null` for both fields.
- **One source of truth for the allow-lists.** `VALID_INCOME_BRACKETS` (5) and `VALID_INCOME_BRACKET_CURRENCIES` (20, uppercase) are private module-level consts in `profile_store.rs`, mirroring `db/account.rs`'s `.contains()` + `AppError::Validation { message, field }` guard style. No new IPC command was introduced (Task 8 forbids it), so the frontend list is a commented mirror, not an independent authority; unit tests pin both lengths and the uppercase/alpha-3 shape.
- **Deliberate deviation from `db/account.rs`:** the currency is trimmed **then uppercased then** allow-list-checked, so AC #5's stored-uppercase guarantee holds for any IPC caller, not just the Select. `valid_bracket_and_currency_are_saved` feeds `" cad "` and asserts `"CAD"` persists.
- **Both selects render unconditionally and adjacent** inside `data-testid="profile-income"`. Gating the currency on the bracket would make AC #4's permitted "currency without bracket" state unreachable from the UI while the store still allows it.
- **`profile.incomeBracketCurrencyRequired` is used as a non-blocking hint**, shown only while a bracket is chosen and the currency is not. It is not a second validation authority: it never blocks submit, carries no `aria-invalid`, and yields to the server error when one arrives. Validation stays server-authoritative.
- **12 i18n keys added** (the 10 the story listed, plus `profile.incomeBracketUnset` and `profile.incomeBracketCurrencyUnset`, which the unset `SelectItem`s require for AC #10 to be reachable from the UI). `en.json` and `fr.json` both went 1205 → 1217 keys. `profile-i18n.test.ts`'s `REQUIRED_KEYS` was extended, plus two new assertions: bracket labels contain no currency symbol or code, and exactly five `profile.bracket*` keys ship.
- **No per-currency i18n keys**, no `accounts.*` reuse. Codes render verbatim in both locales.
- **Task 8 needed no edits:** `UpdateUserProfileInput` (Rust), `commands/profile.rs`, `lib/types.ts` and `useProfile.ts` already carried both fields from Story 28.2, verified by grep. `save_user_profile` gained no parameters, so its existing `#[allow(clippy::too_many_arguments)]` is unchanged.
- **Fixture correction:** the 28.2 Playwright fixture used `income_bracket: "bracket-3"`, which the new allow-list rejects. Changed to `"100k_149k"` in `SAVED_PROFILE` and in the corresponding pass-through assertion.
- No SQLite migration, table, audit-log call, new `AppError` variant, new crate/package/data file, or network call. `sprint-status.yaml` untouched.

**Verification (all commands run with `PATH="/opt/homebrew/bin:$PATH"`):**

| Gate | Baseline | Result |
|------|----------|--------|
| `cargo test` | 402 passed, 0 failed | **411 passed; 0 failed; 0 ignored** (+9 income/companion tests) |
| `cargo clippy --all-targets` | 1 pre-existing warning | **1 warning, unchanged**: `deref which would be done by auto-deref` at `commands/backup.rs:106`. No new warning. |
| `tsc --noEmit` | clean | **clean, no output** |
| `pnpm --filter @nixus/desktop test` | 174 passed | **192 passed (11 files)** (+18 i18n assertions) |
| `pnpm --filter @nixus/desktop exec playwright test` | 379 passed, 0 failed | **389 passed, 1 failed** — the failure is `expenses.spec.ts:426` "budget category spent amount updates after adding an expense", untouched by this story and **passing 19/19 in isolation**. Suite total is now 390 (379 + 11 new profile specs); `tests/profile.spec.ts` passes **42/42**. |

Honest note: this Playwright suite flakes under full-suite load. Across four full runs the failing spec differed each time (`maintenance.spec.ts` twice, then `profile.spec.ts` twice — since fixed via `[data-open]` scoping — then `expenses.spec.ts`), and every implicated spec passed in isolation. The final full run's single failure is in `expenses.spec.ts`, which this story does not touch.

### File List

| File | Change |
|------|--------|
| `apps/desktop/src-tauri/src/profile_store.rs` | UPDATE — two allow-list consts, `require_companion` helper (also adopted by 29.2's subdivision rule), `validate_income_bracket`, `validate_income_bracket_currency`, wired into `save_profile`, 9 new unit tests |
| `apps/desktop/src/components/profile/ProfileForm.tsx` | UPDATE — `income_bracket` + `income_bracket_currency` `Controller`-wired Selects, mirrored option lists, non-blocking currency hint, both fields now submitted from the form |
| `apps/desktop/src/locales/en.json` | UPDATE — 12 new flat `profile.*` keys (1205 → 1217) |
| `apps/desktop/src/locales/fr.json` | UPDATE — the same 12 keys (1205 → 1217) |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | UPDATE — `REQUIRED_KEYS` extended; currency-symbol-free label assertion; exactly-five-bracket-keys assertion |
| `apps/desktop/tests/profile.spec.ts` | UPDATE — 11 new income specs, `chooseOption`/`openPopup` helpers, `SAVED_PROFILE` bracket fixture corrected to an allow-listed code, 29.2 subdivision option assertion scoped to its own popup |

No new files. `lib/types.ts`, `commands/profile.rs`, `hooks/useProfile.ts`, `models/mod.rs`, `lib/constants.ts` and `lib.rs` required no change.
