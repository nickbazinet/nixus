# Story 30.2: Never be shown a misleading TFSA number

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want the TFSA figure withheld whenever Nixus cannot compute it honestly,
so that I never make a financial decision on a number that is quietly wrong.

## Acceptance Criteria

1. **Given** my country is not Canada
   **When** I view `/profile`
   **Then** no TFSA figure is shown and nothing errors

2. **Given** I have not set a country
   **When** I view `/profile`
   **Then** no TFSA figure is shown

3. **Given** my country is Canada but my date of birth is not set
   **When** I view `/profile`
   **Then** no TFSA figure is shown, and the date-of-birth field is what invites me to provide it

4. **Given** the current year is later than the limits table's declared bound
   **When** the calculation runs
   **Then** the figure is withheld rather than extrapolated from the last known limit
   **And** the behaviour is covered by a test that pins the table bound

5. **Given** I have a TFSA account with a balance recorded in Nixus
   **When** the figure is computed
   **Then** that balance is **not** subtracted, because a balance includes market growth and ignores withdrawals, so remaining room is not computable from available data

6. **Given** I have no session
   **When** the TFSA figure is requested
   **Then** it returns `AppError::Auth { recoverable: true }` like every other profile read

7. **Given** I sign out and sign in as a different account
   **When** I view `/profile`
   **Then** any previously displayed figure is gone rather than carried over from the previous account

## Tasks / Subtasks

- [x] **Task 1 — Confirm Story 30.1 landed, and confirm what it already covers, before writing anything** (AC: #1–#7)
  - [x] Story 30.1 creates all of the following. **This story creates none of them — it hardens them.** If any is missing, 30.1 has not landed and this story cannot start:
    - `apps/desktop/src-tauri/src/tfsa/mod.rs` (`pub mod calculator;` + `pub mod constants;`)
    - `apps/desktop/src-tauri/src/tfsa/constants.rs` — `TFSA_FIRST_YEAR`, `KNOWN_THROUGH_YEAR`, `ANNUAL_LIMITS_CENTS`
    - `apps/desktop/src-tauri/src/tfsa/calculator.rs` — `pub fn accumulated_limit(birth_date: &str, current_year: i32) -> Option<TfsaAccumulatedLimit>`
    - `models::TfsaAccumulatedLimit`, `commands::profile::get_tfsa_accumulated_limit`, `queryKeys.tfsaAccumulatedLimit`, `useTfsaAccumulatedLimit`, `components/profile/TfsaAccumulatedLimit.tsx`
  - [x] Read the **Degradation matrix** in Dev Notes and check each row against 30.1's actual code and tests. Rows 5, 6, and 7 are already *implemented* by 30.1's calculator; rows 1, 2, 3, 4, 8, 9, and 10 are not covered at all. **Do not re-write anything 30.1 already wrote** — including its three positive calculation tests, its `bound + 1` test, its unparseable-date test, and its table-contiguity test.
  - [x] Note the actual `KNOWN_THROUGH_YEAR` value 30.1 checked in. 30.1's Dev Notes permit `2025` instead of `2026` if the 2026 CRA limit could not be verified before merge. Task 3's pin test asserts whatever value is really in the file — read it, do not assume.
  - [x] Record in the Completion Notes any divergence between 30.1's real symbol names and the names used in this story. Every path and identifier here comes from 30.1's story file, not from code that existed when this story was written.

- [x] **Task 2 — Move the country / date-of-birth gate out of the command into `tfsa/calculator.rs`** (AC: #1, #2, #3)
  - [x] Story 30.1 puts the eligibility gate in the command: *"Return `Ok(None)` unless `country_code.as_deref() == Some("CA")` **and** `birth_date` is `Some`; then delegate to `tfsa::calculator::accumulated_limit(…)`."* That is correct behaviour in the wrong place — it puts matrix rows 1–4 on the one code path that cannot be unit-tested without a keyring and an `AppHandle`. A degradation matrix must not live where it cannot be tested.
  - [x] Add one pure function to `tfsa/calculator.rs`, leaving 30.1's `accumulated_limit` **unchanged** so its existing tests keep passing untouched:
    ```rust
    /// The single decision point for shown-vs-withheld. Every withholding condition returns
    /// `None`; nothing here approximates, truncates, or defaults.
    /// `current_year` is a parameter rather than an inner clock read, matching
    /// `accumulated_limit` and `commands/auth.rs::is_session_expired`.
    pub fn accumulated_limit_for_profile(
        profile: Option<&UserProfile>,
        current_year: i32,
    ) -> Option<TfsaAccumulatedLimit>
    ```
  - [x] Body: `None` profile → `None`. `country_code.as_deref() != Some("CA")` → `None`. `birth_date` absent → `None`. Otherwise delegate to `accumulated_limit(birth_date, current_year)` and return its result verbatim — including its `None`s.
  - [x] Rewrite the command to hold **no** conditional: resolve identity → load profile → call `accumulated_limit_for_profile(profile.as_ref(), Local::now().date_naive().year())` → `Ok(..)`. The command keeps its exact signature `get_tfsa_accumulated_limit(app: AppHandle) -> Result<Option<TfsaAccumulatedLimit>, AppError>` and stays `async`.
  - [x] Country gate is **exact equality** with `"CA"`. Not `eq_ignore_ascii_case`, not `to_uppercase()`, not `starts_with`, not a match on alpha-3 `"CAN"`. Story 29.1 validates `country_code` against the bundled ISO 3166-1 alpha-2 dataset, so `"CA"` is the only value that can legitimately be stored — anything else withholds rather than guessing what the user meant.
  - [x] Every early return is `None`. **No branch may return a partial, truncated, defaulted, or estimated figure.** No `unwrap_or(0)`, no `unwrap_or_default()`, no "sum what we can" fallback.
  - [x] Add tests in `calculator.rs`'s existing `#[cfg(test)] mod tests`, using a `fn base_profile() -> UserProfile` fixture and struct-update syntax (the `evaluator.rs` pattern quoted in Dev Notes): `country_code: None` → `None`; `Some("US")` → `None`; `Some("FR")` → `None`; the near-misses `Some("ca")` and `Some("CAN")` → `None`; `Some("CA")` with `birth_date: None` → `None`; `profile: None` → `None`; plus one positive control — `Some("CA")` with a valid `birth_date` at `current_year == KNOWN_THROUGH_YEAR` → `Some(..)` — so the suite proves a gate rather than a function that always returns `None`.

- [x] **Task 3 — Pin the table bound to its literal value** (AC: #4)
  - [x] 30.1 already covers the *behaviour* past the bound: its calculator returns `None` when `current_year > KNOWN_THROUGH_YEAR`, and it tests `current_year == KNOWN_THROUGH_YEAR + 1 → None` alongside three cases at `current_year == KNOWN_THROUGH_YEAR → Some(..)`. That boundary pair exists — **do not duplicate it.**
  - [x] What is missing is a pin on the bound *value*. Add one test to `tfsa/constants.rs`'s existing `#[cfg(test)] mod tests`:
    ```rust
    #[test]
    fn limits_table_is_known_through_2026() {
        assert_eq!(KNOWN_THROUGH_YEAR, 2026);
    }
    ```
    Substitute the value actually checked in, and name the test after that year so the diff explains itself. Model: `financial_health/constants.rs::default_emergency_fund_target_is_six_months` (quoted in Dev Notes).
  - [x] **Reconcile with 30.1's instruction rather than contradicting it.** 30.1 requires the bound *behaviour* test to be written as `KNOWN_THROUGH_YEAR + 1` "so the test pins the bound and survives the annual table bump". That stays true. This test is the complement, and deliberately does **not** survive a bump: exactly one assertion in the whole suite names the year as a literal, so bumping the table cannot happen without editing a test that says the year out loud. Relative for behaviour; absolute for the bound value.
  - [x] **This test is the guard for NFR9.** The CRA announces a new limit most Novembers and this table goes stale most Januaries. Without the pin, a year rollover silently switches the feature off — or worse, a well-meaning table edit switches it back on with an unverified row. With it, the bump is a deliberate act with a reviewable diff.
  - [x] Add the far-future case 30.1 stops short of: `current_year == KNOWN_THROUGH_YEAR + 5` → `None`. A long-abandoned build must not degrade differently from a one-year-stale one.
  - [x] Confirm the withheld case is **withheld, not truncated**: no code path may sum through `KNOWN_THROUGH_YEAR` and present that as the total once the current year is past the bound. Understating a lifetime limit is as misleading as overstating it, and it is the more tempting mistake because it looks conservative.
  - [x] Do **not** add, reorder, re-verify, or re-specify any row of `ANNUAL_LIMITS_CENTS` — the table is Story 30.1's scope and is pre-existing here. 30.1's contiguity test (no gaps, no duplicates, last entry's year `== KNOWN_THROUGH_YEAR`) already exists; do not duplicate that either.

- [x] **Task 4 — Test the two withholding paths 30.1 implemented but left untested** (AC: #3, #4)
  - [x] 30.1's calculator returns `None` when `eligible_from_year > current_year`, but no test exercises it. Add: a `birth_date` implying the user turns 18 **after** the current year → `None`, **not** `Some { total_cents: 0 }`. `$0.00` and "cannot compute" render as different claims but are equally unhelpful next to retirement savings — and `$0.00` is the one that looks authoritative.
  - [x] Add: a `birth_date` in the future (e.g. `"2099-01-01"`) → `None`. It parses cleanly, so 30.1's parse guard does not catch it; the empty-range guard does. Prove that rather than assume it.
  - [x] Both are unreachable through the validated form path — Story 28.3 rejects a future date and an implied age under 18 on **write** — so these are defensive guards against a hand-edited document or one written by a downgraded build. That is exactly the class of bug this story exists to catch: it would never surface in manual testing.
  - [x] 30.1 already tests unparseable and empty `birth_date` → `None`. Do not duplicate it.
  - [x] Assert the read path never errors on a bad stored date: these cases return `Ok(None)`, never `Err`, consistent with `load_profile` treating an unreadable document as "no profile".

- [x] **Task 5 — Prove the session gate returns `AppError::Auth { recoverable: true }`** (AC: #6)
  - [x] Verify by reading the command that its **first** statement is `let sub = auth::current_subject().await?;` — before the profile read and before any calculation. `current_subject()` already produces `AppError::Auth { recoverable: true }` for `LoggedOut` and `SessionExpired` (architecture D3), so the correct implementation is `?` propagation with **no new error construction and no new `AppError` variant**. `error.rs` is not modified.
  - [x] Do not translate the error, do not downgrade it to `Ok(None)`, and do not add a `recoverable: false` path. No-session is the single row in the matrix that errors, and it errors for consistency with `get_user_profile` / `save_user_profile`.
  - [x] A Rust unit test of this path needs a keyring + `AppHandle` harness. **If Story 28.2 established one, reuse it. If it did not, do not invent one** — Task 8's E2E mock rejection is the honest verification. State in the Completion Notes which of the two happened; a reviewer needs to know whether this row is covered by a unit test or by an E2E stub.
  - [x] Confirm the error surfaces **no** user-facing message: `/profile`'s four-way guard renders `SignInRequired` for `LoggedOut` and `SessionExpired`, so `ProfileForm` — and therefore this query — never mounts on that path. Do not add a `toast.error`, an error banner, or a retry affordance for this query.

- [x] **Task 6 — Make "the balance is not subtracted" structurally impossible, then prove it** (AC: #5)
  - [x] Structural guarantee first: `tfsa/calculator.rs`, `tfsa/constants.rs`, and the command's TFSA path must take **no** `State<DbState>`, hold **no** `rusqlite::Connection`, and import nothing from `crate::db::`. A balance cannot be subtracted by code that cannot read a balance.
  - [x] Verify by inspection: `grep` the `tfsa/` module and `get_tfsa_accumulated_limit` for `DbState`, `Connection`, `rusqlite`, `crate::db::`, `balance_cents`, and `accounts`. All must be absent. Record the result in the Completion Notes — this is a five-second reviewer check, not a vibe.
  - [x] Add a purity test asserting the result is a function of `(country_code, birth_date, current_year)` alone: identical inputs → identical output, and the value equals the full accumulated total with nothing deducted. Model: `evaluator.rs::identical_inputs_produce_identical_output`.
  - [x] Add the end-to-end proof in Task 8: a `/profile` render whose Tauri mock reports a TFSA account carrying a balance, asserting the displayed figure equals the **full** stubbed accumulated limit, unreduced.
  - [x] Do **not** add a "remaining room" field, a "you may have contributed" hint, an estimate, or a subtraction toggle. Remaining room requires lifetime contribution *and* withdrawal history, which Nixus does not track. The figure is the accumulated limit or it is absent.
  - [x] Do **not** modify `db/net_worth.rs`, `db/account.rs`, or anything that reads `accounts`. They are read here only to understand why this guarantee needs to exist.

- [x] **Task 7 — Verify the identity-change cache removal instead of assuming it, and test it** (AC: #7)
  - [x] Story 30.1 Task 4 adds `queryClient.removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit })` at **both** sites in `apps/desktop/src/hooks/useAuth.ts` — `useSignOut().onSuccess` and the `auth:callback-received` listener inside `useAuthSession`. **Verify both are present.** Add whichever is missing; do not add a duplicate.
  - [x] **Story 30.1 ships no test for this.** Its unit tests are calculator-only. The behaviour AC #7 depends on is therefore currently asserted by nothing — which is the exact state this story exists to end, because a cached figure from a previous account would be both wrong and a privacy leak, as a dollar amount, beside someone's retirement savings.
  - [x] Extend `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` (existing suite: Vitest + jsdom, `createRoot`/`act`, `vi.spyOn` on `QueryClient` methods — no `@testing-library/react` in this app) with two assertions: `["tfsa-accumulated-limit"]` is among the **removed** keys after `signOut` resolves, and again after an `auth:callback-received` event fires.
  - [x] `removeQueries`, never `invalidateQueries`. Invalidation leaves the previous account's figure rendered while refetching.
  - [x] **Do not rely on `removeQueries({ queryKey: queryKeys.profile })` covering it.** TanStack Query matches by key **prefix**, and `["tfsa-accumulated-limit"]` shares no prefix with `["profile"]`. Assuming the Story 28.2 call reaches it is precisely how a stale figure survives an account switch.
  - [x] Leave `useAuthSession`'s `staleTime: Infinity` (`useAuth.ts:40`) untouched — its comment explains that a stale entry would re-POST the Cognito refresh on every window focus.
  - [x] Confirm 30.1's save path is unchanged: `useSaveUserProfile.onSuccess` **invalidates** `queryKeys.tfsaAccumulatedLimit`. Invalidate on data change, remove on identity change — different operations; conflating them breaks one AC or the other.

- [x] **Task 8 — Audit the frontend for a second decision point, then walk the matrix in E2E** (AC: #1, #2, #3, #5, #6, #7)
  - [x] Audit `components/profile/TfsaAccumulatedLimit.tsx` and `useTfsaAccumulatedLimit`. 30.1 specifies "render `null` when the hook returns `null`/`undefined` or is still loading. No skeleton, no empty state, no error text". Verify that is what shipped, and that the **only** gate is nullish data.
  - [x] **Remove any `country_code`, `birth_date`, or year condition from the frontend if one exists.** Any such check is a second decision point that can disagree with Rust in both directions — a figure rendered for a user Rust ruled out, or a blank where Rust returned a value.
  - [x] No arithmetic on the figure anywhere in TypeScript: no summing, no `?? 0`, no `|| 0`, no default, no placeholder amount, no recomputation. Formatting only, via `useFormatCurrency`, on a value the backend supplied. The type stays `TfsaAccumulatedLimit | null` — do not widen it to non-nullable with a synthesized default.
  - [x] No `enabled` flag referencing `country_code` or `birth_date`. The query mounts inside `ProfileForm`, under the route's `LoggedIn` branch, so no session `enabled` flag is needed either — verify that placement rather than adding a guard.
  - [x] On query error the component renders nothing: no toast, no inline error, no retry button, no skeleton that never resolves. (`toast.error` appears in 35 files in this app, all on mutations — do not make this query the first exception.)
  - [x] Extend `apps/desktop/tests/profile.spec.ts` — the existing spec introduced by 28.2 and extended by 30.1. Do **not** create a new spec file and do **not** modify any other spec: the figure lives inside the `/profile` route, not an always-mounted component, so the mock trap at `docs/project-context.md:295` does not apply. Verify that rather than assume it.
  - [x] One case per row, each stubbing `get_user_profile` and `get_tfsa_accumulated_limit` consistently, each asserting **both** that no figure renders **and** that no error text or toast appears:
    - `country_code: "US"`, `birth_date` set → limit `null` → no figure.
    - `country_code: null`, `birth_date` set → `null` → no figure.
    - `country_code: "CA"`, `birth_date: null` → `null` → no figure, and the date-of-birth field renders, present and empty.
    - `get_tfsa_accumulated_limit` rejects with `{ type: "auth", message: "…", recoverable: true }` → no figure, no toast, no error banner.
    - `country_code: "CA"`, `birth_date` set, `get_accounts` returning a TFSA account with a non-zero `balance_cents` → the rendered amount equals the full stubbed figure, proving the balance did not enter the number.
  - [x] Assert absence with `toHaveCount(0)` against a stable `data-testid` on 30.1's figure element (add one if 30.1 did not), never by scraping visible text for a dollar sign — a text-absence assertion passes for the wrong reason as soon as a currency format changes.
  - [x] **No new i18n key.** Every withholding row is silent, and the date-of-birth field's existing label is the invitation named in AC #3. If you are adding a `profile.tfsa*` key in this story, you are adding user-facing copy to a path the AC requires to be silent — and `profile-i18n.test.ts`'s `declares every profile key it ships` will fail CI on it anyway.

- [x] **Task 9 — Scope and quality gates** (AC: #1–#7)
  - [x] `cargo test` green, including `financial_health`, `db/net_worth.rs`, `error.rs`, and every 30.1 test — all untouched.
  - [x] `cargo build` and `cargo clippy` emit **zero** warnings; `pnpm --filter @nixus/desktop build` (`tsc && vite build`) emits zero warnings. `noUnusedLocals` / `noUnusedParameters` are on and warnings fail CI (project rule 9, `docs/guidelines/warnings.md`).
  - [x] `pnpm --filter @nixus/desktop test` green, including `src/locales/__tests__/` parity (with **zero** new keys) and `src/hooks/__tests__/useAuth.test.tsx`.
  - [x] Full Playwright suite green — `auth.spec.ts`, `accessibility.spec.ts`, `navigation.spec.ts`, `nav-qa.spec.ts` in particular.
  - [x] `git diff` proves no change to: `Cargo.toml`, `Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `src-tauri/migrations/`, `db/mod.rs` (`MIGRATIONS`), `db/danger_zone.rs` (`WIPE_TABLES` / `PRESERVED_TABLES`), `db/audit.rs`, `db/net_worth.rs`, `db/account.rs`, `error.rs`, `models/mod.rs`, `lib.rs`, `lib/constants.ts`, `lib/types.ts`, `tauri.conf.json`, `routeTree.gen.ts`, or any locale file. No migration, no table, no `insert_audit_log`, no new crate, no new npm package, no new `AppError` variant, no version bump.
  - [x] Confirm no second TFSA module, model, command, query key, hook file, component, or spec file was created. This story adds one pure function, tests, at most two `removeQueries` lines, and a null-guard audit.

## Dev Notes

### What this story is

Story 30.1 makes the honest number appear. This story makes every **dishonest** number impossible to appear. The deliverable is a complete, tested degradation matrix — not a feature.

The distinction being protected: Nixus can compute the **accumulated** lifetime TFSA limit exactly from a date of birth, because that is a sum of published annual CRA limits over a date-derived range. Nixus **cannot** compute **remaining** room, because it tracks account balances rather than contribution and withdrawal history. Every row below is a place where the second thing would get mistaken for the first, or where a partial input would get papered over with a guess.

In a finance app a quietly wrong dollar figure beside someone's retirement savings is worse than no figure. Every path in this matrix would otherwise pass unnoticed — nothing crashes, nothing logs, the number is just wrong.

[Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 30: TFSA Room Visibility`; `#Requirements Inventory` — FR10, NFR9]

### Degradation matrix — the deliverable

One row per condition. `Withheld` always means `Ok(None)` from the command, nothing rendered, and no user-facing error.

| # | Condition | Decided in | Command returns | UI renders | User-facing error | Proof required | Status after 30.1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `country_code == Some("CA")`, `birth_date` valid, `current_year <= KNOWN_THROUGH_YEAR` — the only shown case | Rust | `Ok(Some(..))` | figure + accumulated-not-remaining caption | none | 30.1's three positive calculation tests | **Done — 30.1** |
| 1 | `country_code == Some(x)`, `x != "CA"` | Rust | `Ok(None)` | nothing | none | unit tests for `"US"`, `"FR"`, and the near-misses `"ca"`, `"CAN"`; E2E `"US"` case | **Gap** — implemented in the untestable command branch, tested nowhere |
| 2 | `country_code == None` | Rust | `Ok(None)` | nothing | none | unit test; E2E case | **Gap** — same |
| 3 | `country_code == Some("CA")`, `birth_date == None` | Rust | `Ok(None)` | nothing; the DOB field is the invitation | none | unit test; E2E case asserting the DOB field renders empty | **Gap** — same |
| 4 | No profile document at all (`load_profile` → `None`) | Rust | `Ok(None)` | nothing | none | unit test with `profile: None` | **Gap** — same |
| 5 | `current_year > KNOWN_THROUGH_YEAR` | Rust | `Ok(None)` — never extrapolated, never truncated to the bound | nothing | none | boundary pair (`== bound` → `Some`, `bound + 1` → `None`); `bound + 5` → `None`; literal pin on the bound value | **Partly done** — 30.1 implements it and tests the boundary pair; **this story adds** the literal pin (AC #4's "test that pins the table bound") and the far-future case |
| 6 | `birth_date` present but unparseable as ISO `YYYY-MM-DD` | Rust | `Ok(None)` | nothing | none | 30.1's unparseable/empty test | **Done — 30.1** |
| 7 | `birth_date` in the future, or implying the user turns 18 after `current_year` | Rust | `Ok(None)`, **not** `Some { total_cents: 0 }` | nothing | none | unit tests for a future date and for an empty eligibility range | **Gap** — 30.1's `eligible_from_year > current_year` guard exists but nothing exercises it |
| 8 | No session (`LoggedOut` or `SessionExpired`) | Rust | `Err(AppError::Auth { recoverable: true })` | route renders `SignInRequired`; the form and this query never mount | none | E2E mock rejection asserting no figure and no toast; code review that `current_subject()` is the command's first statement | **Gap** |
| 9 | A TFSA account with a non-zero balance exists | Structural — the TFSA path cannot read SQLite | `Ok(Some(..))` with the **full** accumulated total | full figure, unreduced | none | absence grep for `DbState` / `Connection` / `crate::db::` / `balance_cents`; purity test; E2E with a TFSA balance in the mock | **Gap** |
| 10 | Sign out, then sign in as a different account | Frontend cache | refetched for the new `sub` | previous account's figure gone before any render | none | `useAuth.test.tsx` assertions that `["tfsa-accumulated-limit"]` is **removed** at both identity-change sites | **Partly done** — 30.1 adds both `removeQueries` lines; **this story verifies them and adds the only test** |

Row 8 is the only row that produces an error, and it still produces no *user-facing* error — `/profile`'s four-way guard renders `SignInRequired` on that path, so the form never mounts to show one. That is how AC #6 and "withholding must be silent" coexist.

Rows 0 and 6 are complete. Do not touch them.

[Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 30.2: Never be shown a misleading TFSA number`; `_bmad-output/implementation-artifacts/30-1-see-how-much-tfsa-room-ive-accumulated.md#Tasks / Subtasks` — Tasks 1, 3, 4, 5, 7]

### Row 7 is an addition beyond the literal ACs, stated rather than smuggled

Row 7 is not spelled out in the epic's seven ACs. It is in scope because the mandate is *every* path where the figure must be withheld rather than shown or guessed, and because FR10 requires that nothing errors.

Story 28.3 validates `birth_date` on **write** — parseable ISO 8601, not in the future, implied age 18–120. Nothing re-validates on **read**: `load_profile` returns any document that parses as JSON, and a hand-edited file or one written by a downgraded build can carry a future date. 30.1's calculator already handles both cases correctly (a future date parses, then trips the `eligible_from_year > current_year` guard), so **row 7 costs tests only, no implementation**. An untested defensive guard is how a correct guard silently becomes an incorrect one in a later refactor.

The important half is the *shape* of the answer: `None`, never `Some { total_cents: 0 }`. Zero is a claim — "you have accumulated no room" — and it is wrong. Absence is the only honest output.

[Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 28.3` — write-time DOB validation; `#Additional Requirements` — "Missing file is `Ok(None)`, not an error"; `30-1-see-how-much-tfsa-room-ive-accumulated.md#Task 1` — "return `None` when … `eligible_from_year > current_year`"]

### All degradation logic lives in Rust — the reason is structural, not stylistic

The command returns `Option<TfsaAccumulatedLimit>`. When the backend withholds, the frontend receives `null` and there is **no number in the payload to render**. That is the guarantee: the frontend structurally cannot display a figure the backend chose to withhold, because it never receives one.

The corollary is the rule that is easy to break: the frontend must not re-derive eligibility. A `country_code === "CA"` check in TypeScript creates a second decision point, and two decision points can disagree in both directions — a figure rendered for a user Rust ruled out, or a blank where Rust returned a value. The frontend's entire contribution to this matrix is `if (!data) return null;`.

> "All eligibility and degradation logic lives in Rust so the frontend cannot produce a divergent number; the frontend renders the value or nothing."
>
> — [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements`, TFSA IPC surface (Epic 30)]

Story 30.1's AC #8 says the same ("the computation happens in Rust, so the frontend cannot produce a divergent number"), as does the architecture amendment. Three documents; do not weaken it for the convenience of one conditional.

**Where the gate lives inside Rust is what Task 2 changes.** 30.1 placed the country/DOB gate in `commands/profile.rs`. Rust is still the authority, so the epic's requirement is met either way — but a command that takes an `AppHandle` and calls the keyring cannot be unit-tested here, so rows 1–4 would be provable only through an E2E stub of the very command under test. Moving the gate into `tfsa/calculator.rs` as `accumulated_limit_for_profile` costs one function, keeps the command a genuine thin orchestrator (project rule 3), and turns four matrix rows into three-line unit tests. 30.1's `accumulated_limit` is not modified, so none of its tests change.

[Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10)`; `docs/project-context.md#3. Database Operations Belong in db/ Only`]

### The `known_through_year` pin test is the NFR9 guard

NFR9, in full:

> "The annual TFSA limits table declares the last year it covers. Behaviour past that boundary is defined and non-guessing (the figure is withheld, not extrapolated), and the table is refreshed via app release like the ISO dataset."

And the standing liability the epic records:

> "**Known maintenance commitment:** the CRA limits table goes stale most Januaries. The 'known through year N' bound prevents a silently wrong figure, but the table must actually be bumped each year that a new limit is announced."

A bound alone prevents nothing if nobody notices the rollover. The pin does: on January 1st of the year after the bound the app withholds (correct), and any attempt to make the figure reappear must edit an assertion that names the year out loud. A silent year rollover becomes a deliberate act with a reviewable diff — which matters especially here, because 30.1's limits table ships with a `⚠️ HUMAN VERIFICATION REQUIRED BEFORE MERGE` warning on its most recent row.

The precedent is already in this repo — `apps/desktop/src-tauri/src/financial_health/constants.rs`:

```rust
pub const DEFAULT_EMERGENCY_FUND_TARGET_MONTHS: i64 = 6;
```

```rust
#[test]
fn default_emergency_fund_target_is_six_months() {
    assert_eq!(DEFAULT_EMERGENCY_FUND_TARGET_MONTHS, 6);
}
```

That test looks tautological and is not: it is the reason a change to the constant cannot land unnoticed. Copy the shape.

**Why this does not contradict 30.1.** 30.1 requires behaviour tests to be written relative to the const (`KNOWN_THROUGH_YEAR + 1`) so they survive the annual bump. Correct — a behaviour test that hard-codes `2027` inverts its own meaning after a bump. The pin is the single exception, and deliberately does *not* survive a bump: exactly one assertion in the suite names the year literally, and its failure is the notification.

[Source: `apps/desktop/src-tauri/src/financial_health/constants.rs`; `_bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory` (NFR9), `#Epic 30: TFSA Room Visibility`; `30-1-see-how-much-tfsa-room-ive-accumulated.md#Task 7`, `#CRA annual TFSA limits table`]

### `current_year` is a parameter, not a clock read — the precedent is in this codebase

30.1 already made `accumulated_limit(birth_date, current_year)` pure for this reason, and the new `accumulated_limit_for_profile` must match. `apps/desktop/src-tauri/src/commands/auth.rs` set the precedent and even documents it:

```rust
/// `now_unix` is a parameter rather than an inner `Utc::now()` so this is pure.
fn is_session_expired(expires_at: i64, now_unix: i64) -> bool {
    now_unix >= expires_at
}
```

The command supplies `chrono::Local::now().date_naive().year()`. `Local` (not `Utc`) matches the codebase convention for "today" — `commands/import.rs:372` (`let current_year = Local::now().year();`), `db/recurring.rs:150`, `db/yearly_summary.rs:182`. `Utc` would flip the figure a few hours early or late around New Year for users west of UTC: a small wrongness, in a story about not being wrong.

Do **not** introduce a clock-injection trait, a new time crate, or a `#[cfg(test)]` clock override. A plain `i32` parameter is the whole solution.

[Source: `apps/desktop/src-tauri/src/commands/auth.rs#L495-L502`; `apps/desktop/src-tauri/src/commands/import.rs#L372`; `apps/desktop/src-tauri/src/db/yearly_summary.rs#L182`]

### Test style: `evaluator.rs` is the model for the exhaustive matrix

`apps/desktop/src-tauri/src/financial_health/evaluator.rs` is the closest thing in this repo to what this story requires — a pure decision function whose entire correctness lives in an exhaustive inline `#[cfg(test)] mod tests`. 30.1 already points its calculator tests at this file; follow the same style for the new rows.

The shared fixture is what keeps a ten-case matrix readable. The equivalent here is a `fn base_profile() -> UserProfile` returning a valid CA profile with a valid `birth_date`, so each test states only the field under test:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> WaterfallEvalInput {
        WaterfallEvalInput {
            data_sufficient: true,
            coverage_months: Some(8.0),
            target_months: 6,
            credit_card_debt_cents: 0,
            avg_monthly_surplus_cents: 50000,
            liquid_savings_cents: 480000,
            avg_monthly_expenses_cents: 60000,
        }
    }
```

```rust
    #[test]
    fn build_emergency_fund_wins_when_coverage_below_target() {
        let input = WaterfallEvalInput {
            coverage_months: Some(3.0),
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::BuildEmergencyFund);
```

The boundary pair, one unit apart — the discipline `KNOWN_THROUGH_YEAR` / `+ 1` needs:

```rust
    #[test]
    fn small_cc_debt_within_buffer_advances_past_pay_debt() {
        let input = WaterfallEvalInput { credit_card_debt_cents: 30000, ..base_input() };
```

```rust
    #[test]
    fn cc_debt_one_cent_above_buffer_stays_on_pay_debt() {
        let input = WaterfallEvalInput { credit_card_debt_cents: 30001, ..base_input() };
```

The insufficient-data case asserts on **absence**, not on a substituted value — the assertion shape every withheld row needs (`assert!(result.is_none())`, never `assert_eq!(total_cents, 0)`):

```rust
    #[test]
    fn insufficient_expense_history_returns_build_emergency_fund_with_null_coverage() {
        let input = WaterfallEvalInput { data_sufficient: false, coverage_months: None, ..base_input() };
        let eval = evaluate_waterfall(&input);
        assert!(eval.reasoning_params.coverage_months.is_none());
    }
```

And the determinism test to copy for row 9's purity proof:

```rust
    #[test]
    fn identical_inputs_produce_identical_output() {
        let input = base_input();
        let first = evaluate_waterfall(&input);
        let second = evaluate_waterfall(&input);
        assert_eq!(first, second);
    }
```

Note the derive that makes `assert_eq!` on a whole result possible: `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]` on `WaterfallEvaluation`. `TfsaAccumulatedLimit` derives exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` per project rule 4 — **assert on its fields rather than widening the derive**; `models/mod.rs` is on this story's untouched list. `.unwrap()` is permitted in tests only.

[Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns`; `docs/project-context.md#4. Rust Model Structs`]

### Why "do not subtract the balance" must be a tested guarantee, not an assumption

TFSA account balances genuinely exist in this app. `apps/desktop/src-tauri/src/db/net_worth.rs` sums them into net worth today:

```rust
    let investments_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(balance_cents), 0) FROM accounts WHERE account_type IN ('tfsa', 'rrsp', 'fhsa', 'non_registered', 'crypto')",
        [],
        |row| row.get(0),
    )?;
```

breaks them out as their own net-worth category:

```rust
fn map_account_type_to_category(account_type: &str) -> &str {
    match account_type {
        "chequing" | "savings" => "cash",
        "crypto" => "crypto",
        "tfsa" => "tfsa",
```

```rust
            "tfsa" => breakdown.tfsa_cents += balance_cents,
```

and its own tests create one:

```rust
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('TFSA', 'Bank', 'tfsa', 200000)",
            [],
        ).unwrap();
```

`"tfsa"` is also in `db/account.rs`'s `VALID_ACCOUNT_TYPES`, so users create these accounts through the normal UI.

So a `tfsa_cents` figure is sitting right there, one join away, looking exactly like the thing you would subtract from a contribution limit to get "remaining room". It is not:

- A balance includes **market growth**, which is not contribution room consumed.
- A balance ignores **withdrawals**, which restore room in the following calendar year.
- A balance ignores contributions made in accounts Nixus does not know about.

Subtracting it produces a number wrong in both directions, with no way to tell which. That is why the architecture amendment states it twice, and why this story makes it structural: the `tfsa/` module takes no `DbState` and holds no `Connection`, so the subtraction is not merely forbidden — it is unreachable. The absence grep in Task 6 is what a reviewer can check in five seconds.

> "**TFSA account balances must not be subtracted** — a balance includes market growth and ignores withdrawals, so remaining room is not computable from available data."
>
> — [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 30: TFSA Room Visibility`]

[Source: `apps/desktop/src-tauri/src/db/net_worth.rs#L14-L18, #L69-L79, #L118, #L355`; `apps/desktop/src-tauri/src/db/account.rs#L10`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10)`]

### `AppError::Auth { recoverable: true }` — reuse, verbatim

`apps/desktop/src-tauri/src/error.rs` already carries the variant:

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

already serializes the way the frontend expects:

```rust
            AppError::Auth { message, recoverable } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "auth")?;
                map.serialize_entry("message", message)?;
                map.serialize_entry("recoverable", recoverable)?;
                map.end()
            }
```

and already has that wire shape pinned by a test in the same file:

```rust
    #[test]
    fn auth_error_serializes_with_type_message_and_recoverable() {
        let json = serde_json::to_string(&AppError::Auth {
            message: "x".to_string(),
            recoverable: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"type":"auth","message":"x","recoverable":true}"#);
    }
```

`error.rs` is **unchanged** by this story. `current_subject()` already produces this error for `LoggedOut` and `SessionExpired`, so the command's correct implementation is a single `?`. No new variant (architecture D13), no new message string, no error-mapping layer. The `{ type: "auth", recoverable: true }` shape above is what Task 8's E2E mock rejection must reproduce.

[Source: `apps/desktop/src-tauri/src/error.rs`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Authentication & Security` (D3, D13)]

### `useAuth.ts` — the two sites, and the prefix trap

Current file (unmodified at this story's authoring — every Epic 28/29/30 story is still `backlog`, and `grep removeQueries apps/desktop/src` returns nothing):

```typescript
// hooks/useAuth.ts:16-18
      const unlisten = await listen("auth:callback-received", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      });
```

```typescript
// hooks/useAuth.ts:50-59
export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<void>("sign_out"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    },
  });
}
```

By the time this story runs, both bodies should contain a `removeQueries` for `queryKeys.profile` (Story 28.2) **and** one for `queryKeys.tfsaAccumulatedLimit` (Story 30.1 Task 4). Verify both TFSA calls are present; add whichever is missing.

**The trap this story exists to close:** TanStack Query removes by key **prefix**. `queryKeys.profile` is `["profile"]`; the TFSA key is a flat top-level `["tfsa-accumulated-limit"]`. No shared prefix, so 28.2's call does not touch it. A dev reasoning "the profile cache is cleared, so the derived figure is too" ships the previous account's dollar amount — a wrong number and a privacy leak at once. That is why AC #7 is its own criterion, and why Task 7 requires the behaviour be **verified against `removeQueries` rather than assumed**.

The verification harness already exists — `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` drives the hooks directly with `createRoot`/`act` (no `@testing-library/react` in this app) and spies on the `QueryClient`:

```typescript
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;
```

```typescript
  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }
```

Story 28.2 adds the `removeQueries` equivalent of that spy and helper. This story asserts `["tfsa-accumulated-limit"]` appears in it after `signOut` resolves **and** after an `auth:callback-received` event. Two sites, two assertions — and they are the only test of row 10 anywhere in the feature.

Leave `staleTime: Infinity` on `useAuthSession` (`useAuth.ts:40`) alone; its comment explains that `get_auth_session` performs the Cognito refresh POST, so a stale entry would re-POST on every window focus.

[Source: `apps/desktop/src/hooks/useAuth.ts#L11-L59`; `apps/desktop/src/hooks/__tests__/useAuth.test.tsx`; `_bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md#Task 10`; `_bmad-output/implementation-artifacts/30-1-see-how-much-tfsa-room-ive-accumulated.md#Task 4`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Frontend Architecture` (D5)]

### Invariants — each is a task above, not a suggestion

1. **Withholding is silent.** No toast, no banner, no inline message, no retry button, and no new i18n key on any degradation path. A missing figure is a normal state, not a failure.
2. **`None` is the only withheld representation.** No `0`, no `-1`, no sentinel, no empty struct, no `total_cents: 0`.
3. **No approximation, ever.** No estimate, no best guess, no extrapolation past the bound, no truncation to the bound, no partial sum.
4. **No balance subtraction, structurally.** The `tfsa/` module and the command's TFSA path take no `DbState`, hold no `Connection`, and import nothing from `crate::db::`.
5. **One decision point, in Rust, in a pure function.** The frontend gates only on nullish data and performs no TFSA arithmetic.
6. **Exact `"CA"` equality.** Not case-insensitive, not alpha-3, not a prefix match.
7. **`current_year` is a parameter.** No clock read inside a pure function; `Local::now().date_naive().year()` at the command boundary only.
8. **`removeQueries` at both sites, as its own call.** Never `invalidateQueries` on an identity change; never assume the `profile` key covers the TFSA key.
9. **No new module, model, command, query key, hook file, component, spec file, or `AppError` variant.**
10. **No SQLite anything.** No migration, no table, no `MIGRATIONS` / `WIPE_TABLES` / `PRESERVED_TABLES` change, no `insert_audit_log`.
11. **No new dependency.** Zero Rust crates, zero npm packages.
12. **The limits table is not this story's scope.** Do not add, reorder, re-verify, or re-specify any annual limit.
13. **Zero compilation warnings**, Rust and TypeScript.

### Testing standards summary

- **Rust unit tests** inline in the existing `#[cfg(test)] mod tests` blocks of `tfsa/calculator.rs` and `tfsa/constants.rs`, styled on `financial_health/evaluator.rs`. New cases only: matrix rows 1–4 and 7, the `KNOWN_THROUGH_YEAR` literal pin, `bound + 5` → `None`, and the purity/determinism proof for row 9. Assert with `is_none()`, never against a zero value. No `tempfile` — this module touches no filesystem.
- **Do not duplicate 30.1's tests:** its three positive calculation cases, its `bound + 1` → `None` case, its unparseable/empty `birth_date` case, and its table-contiguity/last-year test all stay exactly as they are.
- **`.unwrap()` in tests only.** No `.unwrap()`, `.expect()`, or panic in the shipped path — `?` propagation with `AppError`.
- **Hook tests** in `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` (Vitest + jsdom, `createRoot`/`act`, no `@testing-library/react`): the two `removeQueries` assertions for row 10.
- **Playwright E2E** extends `apps/desktop/tests/profile.spec.ts` only. It runs against the plain Vite dev server on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per-spec — there is no real IPC layer, so every command in play must be stubbed. Assert absence via `toHaveCount(0)` on a stable `data-testid`, never via text scraping.
- **No existing spec may be modified** other than `profile.spec.ts`. The figure lives inside the `/profile` route, not an always-mounted component, so the mock trap at `docs/project-context.md:295` does not apply — verify rather than assume.
- **Locale parity** (`src/locales/__tests__/`) must pass with **zero** new keys. `profile-i18n.test.ts`'s `declares every profile key it ships` asserts the exact `profile.*` key set, which is a useful second guard on invariant 1.
- **Regression:** `cargo test` (`financial_health`, `db/net_worth.rs`, `error.rs`, and all 30.1 tests untouched and green), `pnpm --filter @nixus/desktop test`, and the full Playwright suite including `auth.spec.ts`, `accessibility.spec.ts`, `navigation.spec.ts`, `nav-qa.spec.ts`.

### Project Structure Notes

**Files created: none.** No module, no model, no command, no hook, no component, no spec, no data file. A new file in the `File List` means Task 1 was skipped.

**Files modified:**

| Path | Change |
| --- | --- |
| `apps/desktop/src-tauri/src/tfsa/calculator.rs` | `+ accumulated_limit_for_profile(profile: Option<&UserProfile>, current_year: i32)`; `+ base_profile()` test fixture; `+` tests for matrix rows 1–4 and 7 plus the purity proof. `accumulated_limit` itself is **unchanged** |
| `apps/desktop/src-tauri/src/tfsa/constants.rs` | `+ 1` literal pin test on `KNOWN_THROUGH_YEAR`, and the `bound + 5` case if it belongs beside it. The table and the existing contiguity test are unchanged |
| `apps/desktop/src-tauri/src/commands/profile.rs` | `get_tfsa_accumulated_limit` loses its `if country_code … && birth_date …` branch and calls `accumulated_limit_for_profile` instead. Signature unchanged, still `async`, still `AppHandle` |
| `apps/desktop/src/hooks/useAuth.ts` | Verify Story 30.1's two `removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit })` calls; add whichever is missing. No other change |
| `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` | `+ 2` assertions that `["tfsa-accumulated-limit"]` is removed on sign-out and on `auth:callback-received` |
| `apps/desktop/src/components/profile/TfsaAccumulatedLimit.tsx` | Audit: nullish-only gate, no eligibility condition, no arithmetic, no error surface. `+` a stable `data-testid` if 30.1 did not add one |
| `apps/desktop/src/hooks/useProfile.ts` | Audit only: `useTfsaAccumulatedLimit` typed `TfsaAccumulatedLimit \| null`, no `enabled` referencing `country_code` or `birth_date`, no error toast |
| `apps/desktop/tests/profile.spec.ts` | `+ 5` degradation cases in the existing spec's Tauri mock and assertions |

**Not touched, deliberately:** `src-tauri/Cargo.toml`, `Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `src-tauri/migrations/`, `db/mod.rs`, `db/danger_zone.rs`, `db/backup.rs`, `db/audit.rs`, `db/net_worth.rs`, `db/account.rs`, `db/financial_health.rs`, `financial_health/*`, `error.rs`, `models/mod.rs`, `lib.rs`, `tfsa/mod.rs`, `profile_store.rs`, `json_store.rs`, `credentials.rs`, `maintenance/catalog.rs`, `lib/constants.ts`, `lib/types.ts`, `routes/profile.tsx`, `components/profile/ProfileForm.tsx`, `components/auth/ProfileMenu.tsx`, `packages/shared/src/ui/*`, `locales/en.json`, `locales/fr.json`, `locales/__tests__/*`, `tauri.conf.json`, `routeTree.gen.ts`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, and every `tests/*.spec.ts` other than `profile.spec.ts`.

**Dependency and sequencing.** 30.2 → 30.1 → (28.3 for `birth_date`, 29.1 for `country_code`, 28.2 for `profile_store.rs`, `commands/profile.rs`, `useProfile.ts`, `ProfileForm.tsx`, `tests/profile.spec.ts`). Nothing depends on 30.2. Epic 30 must not be scheduled before Epic 29: without a country the figure would be permanently withheld and the epic would look broken rather than degraded. [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)`]

**Repository state at authoring time, so predictions are not mistaken for facts.** Every Epic 28, 29, and 30 story is `backlog` in `sprint-status.yaml`. `apps/desktop/src/hooks/useAuth.ts` contains no `removeQueries` call anywhere in the app today. `profile_store.rs`, `commands/profile.rs`, `tfsa/`, `useProfile.ts`, `components/profile/`, and `tests/profile.spec.ts` do not exist yet. Every path and identifier in this story that belongs to Stories 28.x / 29.1 / 30.1 is a **contract this story consumes**, taken from those story files rather than from code — verify each on disk in Task 1 before editing it.

**Variance from the architecture's delta tree, stated rather than silent.** `architecture-user-profile.md`'s delta tree predates the TFSA amendment and lists no `tfsa/` module, so neither 30.1's files nor this story's edits appear in it. The Amendment section at the end of that document is the authority: "The TFSA module is a pure read-side consumer of `get_user_profile` and introduces no new storage, no new dependency, and no new network surface." Every storage, isolation, lifecycle, and boundary decision in that document stands unchanged. 30.1 records the matching variance for placing the module at `src-tauri/src/tfsa/` rather than `db/tfsa.rs` — it executes no SQL, so `financial_health/` is the correct precedent.

**Refactor of a prior story's decision, recorded as a reversal rather than a divergence.** Task 2 moves the country/DOB gate from `commands/profile.rs` (30.1 Task 3) into `tfsa/calculator.rs`. Rationale: that gate's correctness is four rows of this story's matrix, and a command taking an `AppHandle` and calling the keyring cannot be unit-tested here. The refactor is additive to `calculator.rs`, leaves `accumulated_limit` and all its tests untouched, changes no IPC signature, and makes the command a genuine thin orchestrator per project rule 3. **Rejected:** leaving the gate in the command and covering rows 1–4 by E2E stubs alone — that would test the frontend's handling of a stubbed `null`, not Rust's decision to send one.

### References

- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 30.2: Never be shown a misleading TFSA number` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 30.1: See how much TFSA room I've accumulated` — the pre-existing calculation module, command, hook, display, and the four calculation tests 30.1 owns]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory` — FR10 (no DOB, no country, non-CA country, or a year beyond the known-limits table → figure not displayed and nothing errors); NFR9 (declared bound, non-guessing behaviour past it, refreshed via app release)]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements` — TFSA IPC surface (Epic 30): one session-gated `get_tfsa_accumulated_limit() -> Result<Option<TfsaAccumulatedLimit>, AppError>` returning `{ total_cents, eligible_from_year, known_through_year }` or `None`; all eligibility and degradation logic in Rust; query key `tfsaAccumulatedLimit: ["tfsa-accumulated-limit"]`, invalidated after a profile save and **removed** on session transitions alongside `queryKeys.profile`; no TFSA balance subtracted; no new `AppError` variant; no SQLite work; no audit logging; no new dependency]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 30: TFSA Room Visibility` — checked-in limits table with an explicit bound, withhold rather than extrapolate, balances must not be subtracted, and the standing January maintenance commitment]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#UX Design Requirements` — the figure sits adjacent to date of birth so the value of providing the field is visible where it is requested]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)` — forward-dependency check `30.2→30.1`; Epic 30 must not precede Epic 29]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10)` — one FR5 consumer pulled into scope; displayed only when `country_code == "CA"` and `birth_date` is set; accumulated not remaining; balances not subtracted; withheld past the bound; degrades silently; a pure read-side consumer adding no storage, dependency, or network surface]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Authentication & Security` — D3 `current_subject()` returns `AppError::Auth { recoverable: true }` for `LoggedOut` / `SessionExpired`, and `sub` never crosses IPC; D13 reuse `AppError`, add no variant]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Frontend Architecture` — D5 `removeQueries` not `invalidateQueries` on session change; D11 no new `invoke` in any always-mounted component; the four-way `/profile` route guard]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture` — D8 note: consumers of `birth_date` for TFSA room MUST gate on `country_code == "CA"` and degrade otherwise; date-of-birth validation rules]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Process Patterns` — missing document is `Ok(None)`, not an error; corrupt document returns `Ok(None)`; no `.unwrap()` outside tests; `tracing`, never `console.log`]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Communication Patterns` — invalidate on data change, remove on identity change; the two must not be conflated]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns` and `#File Organization Patterns` — Rust unit tests inline via `#[cfg(test)] mod tests`; one Playwright spec; locale parity via the existing suite]
- [Source: `_bmad-output/implementation-artifacts/30-1-see-how-much-tfsa-room-ive-accumulated.md#Tasks / Subtasks` — Task 1 (`tfsa/mod.rs`, `constants.rs` with `TFSA_FIRST_YEAR` / `KNOWN_THROUGH_YEAR` / `ANNUAL_LIMITS_CENTS`, `calculator.rs::accumulated_limit` and its three `None` conditions), Task 3 (the command's country/DOB branch this story relocates), Task 4 (`removeQueries` at both `useAuth.ts` sites; invalidate on save), Task 5 (the display renders `null` when withheld), Task 7 (the calculation and contiguity tests not to duplicate), and `#CRA annual TFSA limits table` (the human-verification warning on the most recent row)]
- [Source: `_bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md#Task 10` — the `removeQueries(queryKeys.profile)` calls this story's TFSA removals sit alongside; creates `profile_store.rs`, `commands/profile.rs`, `useProfile.ts`, `ProfileForm.tsx`, `tests/profile.spec.ts`]
- [Source: `_bmad-output/implementation-artifacts/28-3-record-my-date-of-birth-without-fighting-the-calendar.md` — `birth_date` is ISO 8601 `"YYYY-MM-DD"`, validated on write (not future, age 18–120), clearable to `null`]
- [Source: `_bmad-output/implementation-artifacts/29-1-tell-nixus-which-country-i-live-in.md` — `country_code` is an ISO 3166-1 alpha-2 uppercase code validated against the bundled dataset; Rust is the validation authority]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs` — the exhaustive `#[cfg(test)] mod tests` style this matrix must follow: shared fixture, one test per condition, boundary pairs one unit apart, absence assertions, determinism test]
- [Source: `apps/desktop/src-tauri/src/financial_health/constants.rs` — `default_emergency_fund_target_is_six_months`, the in-repo precedent for pinning a constant so a change cannot land unnoticed]
- [Source: `apps/desktop/src-tauri/src/db/net_worth.rs#L14-L18, #L69-L79, #L118, #L355` — TFSA account balances exist, are summed into investments, are their own net-worth category, and are created in tests; this is why "do not subtract balances" must be an explicit tested guarantee rather than an assumption]
- [Source: `apps/desktop/src-tauri/src/db/account.rs#L10` — `"tfsa"` is in `VALID_ACCOUNT_TYPES`, so users create TFSA accounts through the normal UI]
- [Source: `apps/desktop/src-tauri/src/error.rs` — `AppError::Auth { message, recoverable }`, its serialized `{ type, message, recoverable }` shape, and the test that pins it; unchanged by this story]
- [Source: `apps/desktop/src-tauri/src/commands/auth.rs#L495-L502` — "`now_unix` is a parameter rather than an inner `Utc::now()` so this is pure"; the precedent for `current_year: i32`]
- [Source: `apps/desktop/src-tauri/src/commands/import.rs#L372`, `apps/desktop/src-tauri/src/db/yearly_summary.rs#L182` — `Local::now().year()` is the codebase convention for the current year]
- [Source: `apps/desktop/src/hooks/useAuth.ts#L11-L59` — the two identity-change insertion points, and `staleTime: Infinity` with its documented reason]
- [Source: `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` — the existing `createRoot`/`act` harness and `QueryClient` spy pattern used to verify cache removal]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — `declares every profile key it ships` asserts the exact `profile.*` key set, so no undeclared key can be added]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)` — `i64` cents with a `_cents` suffix; display formatting in the UI layer only]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` and `#Framework-Specific Rules → Tauri IPC` — `rename_all = "snake_case"`, `Result<T, AppError>`, never panic]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — commands orchestrate only; logic belongs in the lower layer]
- [Source: `docs/project-context.md#4. Rust Model Structs` — models derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`]
- [Source: `docs/project-context.md#5. Error Handling (AppError)` — reuse `AppError`, never create ad-hoc error types; features degrade gracefully rather than blocking]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — all keys in `lib/constants.ts`; mutations invalidate every affected key]
- [Source: `docs/project-context.md#9. Compilation Warnings Policy` and `docs/guidelines/warnings.md` — zero Rust and TypeScript warnings before commit]
- [Source: `docs/project-context.md#Testing Rules → Desktop` and `docs/project-context.md:295` — Vitest hook/locale tests, Playwright against the Vite dev server with stubbed `invoke`, and the always-mounted-component mock trap]

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

None. No implementation failure required a debug cycle. Two self-inflicted test-authoring errors were fixed in place: `ROOM` was referenced outside the describe block that owned it, and the non-Canadian E2E row needed `countries: LOCATION_COUNTRIES` because the default fixture carries no `US` entry.

### Completion Notes List

**Divergences between this story's assumptions and what Story 30.1 actually shipped** (Task 1 required these be recorded rather than silently absorbed):

1. **Every symbol name matched.** `tfsa/mod.rs`, `tfsa/constants.rs` (`TFSA_FIRST_YEAR`, `KNOWN_THROUGH_YEAR`, `ANNUAL_LIMITS_CENTS`), `tfsa/calculator.rs::accumulated_limit`, `models::TfsaAccumulatedLimit`, `commands::profile::get_tfsa_accumulated_limit`, `queryKeys.tfsaAccumulatedLimit`, `useTfsaAccumulatedLimit`, and `components/profile/TfsaAccumulatedLimit.tsx` all exist exactly as named. No renames were needed.
2. **`KNOWN_THROUGH_YEAR` is `2026`**, not the permitted `2025` fallback. The pin test is therefore named `limits_table_is_known_through_2026`.
3. **Matrix row 7 was NOT entirely untested, contrary to the story's claim.** 30.1 already ships `not_yet_eighteen_in_the_current_year_withholds_the_figure`, which exercises the `eligible_from_year > current_year` guard. That test was left untouched and not duplicated. What was genuinely missing from row 7 was the *future* birth date (`"2099-01-01"`) and an explicit "`None`, not `Some { total_cents: 0 }`" assertion at a wider age gap — both added.
4. **Both `removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit })` calls were already present** in `useAuth.ts`, at `useSignOut().onSuccess` and inside the `auth:callback-received` listener. Nothing was added and no duplicate was introduced. `useAuth.ts` is therefore **unmodified** by this story — the story's own file table predicted a possible edit there and none was needed.
5. **Story 28.2 did NOT add the `removeQueries` spy** to `useAuth.test.tsx` that this story's Dev Notes predicted. Only `invalidateSpy` existed. The `removeSpy` / `removedKeys()` pair was added here as part of Task 7.
6. **The frontend audit found nothing to fix.** `TfsaAccumulatedLimit.tsx` already gated on `if (!data) return null;` alone, already carried the `data-testid="profile-tfsa-accumulated-limit"` this story would otherwise have added, and performed no arithmetic beyond `useFormatCurrency(data.total_cents)`. `useTfsaAccumulatedLimit` already had no `enabled` flag, no `?? 0`, and no error surface. No second decision point existed to remove, so `TfsaAccumulatedLimit.tsx` and `useProfile.ts` are both **unmodified**.

**What was already done by 30.1 and was PROVEN here rather than reimplemented:** matrix rows 0 and 6 (positive calculation, unparseable/empty `birth_date`) were left exactly as shipped. Row 5's boundary pair (`== bound` → `Some`, `bound + 1` → `None`) and the table-contiguity/last-year tests were not duplicated. `accumulated_limit` itself is byte-for-byte unchanged, and all seven of its original tests still pass untouched.

**Task 5 — how the no-session row is covered, stated explicitly because a reviewer needs to know:** by **E2E stub, not by a Rust unit test.** `grep -rn "tauri::test\|mock_builder\|mock_app" src/` returns nothing, so Story 28.2 established **no** keyring/`AppHandle` harness and none was invented here. Verification is (a) code review that `let sub = crate::commands::auth::current_subject().await?;` is the command's literal first statement, before the directory resolution and before any calculation, and (b) the new E2E case `a rejected session read shows no figure, no toast, and no error banner`, which rejects with the exact `{ type: "auth", message, recoverable: true }` wire shape from `error.rs`. `error.rs` is unmodified and no new `AppError` variant was added.

**Task 6 — the absence grep, recorded so it is a check and not a vibe:**

```
$ grep -nE "DbState|Connection|rusqlite|crate::db::|balance_cents|accounts" tfsa/*.rs
tfsa/calculator.rs:20:/// Takes no `State<DbState>` and holds no `Connection`, so subtracting a TFSA

$ awk '/pub async fn get_tfsa_accumulated_limit/,/^}/' commands/profile.rs \
    | grep -nE "DbState|Connection|rusqlite|crate::db::|balance_cents|accounts"
NO MATCHES (all absent)
```

The only match in the whole `tfsa/` module is the doc comment asserting the absence. Subtracting a balance is unreachable, not merely forbidden.

**The balance-not-subtracted guarantee is an actual test at two levels, not a comment:**
- Rust: `the_total_is_the_undeducted_sum_of_every_eligible_annual_limit` recomputes the undeducted sum straight from `ANNUAL_LIMITS_CENTS` and asserts `total_cents` equals it. Written as "no deduction" rather than "equals 10_900_000" so it cannot be satisfied by a coincidence.
- E2E: `a TFSA account carrying a balance does not reduce the displayed figure` stubs `get_accounts` with a `tfsa` account holding `balance_cents: 3_000_000` alongside the chequing account, and asserts the rendered figure still reads `109,000` and specifically **not** `79,000` (the exact number a subtraction would produce) and not `30,000`.
- A third E2E case, `the profile surface never asks for account balances at all`, asserts `get_accounts` and `get_current_net_worth` are never invoked from `/profile` — the frontend half of the same structural guarantee.

**The `KNOWN_THROUGH_YEAR` pin cannot silently start extrapolating:** `limits_table_is_known_through_2026` asserts against the **bound constant** (`assert_eq!(KNOWN_THROUGH_YEAR, 2026)`), and is the only assertion in the suite that names the year as a literal. Every behaviour test stays relative (`KNOWN_THROUGH_YEAR`, `+ 1`, `+ 5`) so it survives an annual bump; the pin deliberately does not, so bumping the table is impossible without editing a test that says the year out loud. `many_years_past_the_table_bound_still_withholds_the_figure` adds `+ 5`, so a long-abandoned build degrades identically to a one-year-stale one.

**No approximation anywhere.** Every early return in `accumulated_limit_for_profile` is `None`. No `unwrap_or(0)`, no `unwrap_or_default()`, no partial sum, no truncation to the bound, no `total_cents: 0` sentinel. Country matching is exact `== Some("CA")`; `country_matching_is_exact_so_near_misses_withhold_the_figure` pins `"ca"`, `"Ca"`, `"CAN"`, and `"CA "` all to `None`.

**Withholding is silent and no i18n key was added.** `en.json` and `fr.json` both hold **1220** keys, verified by recursive leaf count after the change — unchanged and equal. Every degradation E2E row asserts `toastCount(page)` is `0`, and absence is asserted by `toHaveCount(0)` on the `data-testid`, never by scraping for a dollar sign.

**Scope guards held.** No new file was created (Task 1's tripwire: a new file in the File List would mean Task 1 was skipped). No migration, no table, no `insert_audit_log`, no new crate, no npm package, no new `AppError` variant, no version bump, no `as any` / `@ts-ignore` / `@ts-expect-error`, no locale change, no `sprint-status.yaml` change, and no spec file other than `profile.spec.ts` touched. No existing test was weakened or deleted.

**Verification — real output:**

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → `test result: ok. 437 passed; 0 failed; 0 ignored` (baseline 424, **+13**: 11 in `calculator.rs`, 1 in `constants.rs`, and 1 more from the split matrix cases).
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` → exactly one warning, the pre-existing `explicit_auto_deref` at `commands/backup.rs:106`, which is out of scope. **Zero new warnings.**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → clean, exit 0, no output.
- `pnpm --filter @nixus/desktop test` → `Test Files 11 passed (11) / Tests 200 passed (200)` (baseline 198, **+2**: the two `removeQueries` assertions). Includes `profile-i18n.test.ts` (60) and every locale-parity suite.
- `pnpm --filter @nixus/desktop exec playwright test` → `398 passed`, `1 failed`: `expenses.spec.ts:778 › pressing Cancel in delete dialog does not remove the expense`. Re-run in isolation: `pnpm --filter @nixus/desktop exec playwright test expenses.spec.ts` → `19 passed (26.9s)`, including that exact test. **Confirmed a known load flake, not a regression** — it is in one of the three files flagged as flaky, it touches no profile or TFSA code, and it passes deterministically alone. Total is 399 (baseline 393 **+6** new degradation cases), so 398 passed + 1 flake accounts for all of them.
- `pnpm --filter @nixus/desktop exec playwright test profile.spec.ts` → `51 passed (45.6s)` with zero failures.

### File List

| Path | Change |
| --- | --- |
| `apps/desktop/src-tauri/src/tfsa/calculator.rs` | `+ accumulated_limit_for_profile(profile: Option<&UserProfile>, current_year: i32)` — the single shown-vs-withheld decision point, holding only `None` returns. `+ base_profile()` fixture. `+ 11` tests: positive control, no profile, unset country, non-CA countries, exact-match near misses, CA-with-no-DOB, pass-through of the calculator's own `None`s, `bound + 5`, future birth date, `None`-not-zero, determinism, and the undeducted-sum proof. `accumulated_limit` and all seven of its 30.1 tests are unchanged |
| `apps/desktop/src-tauri/src/tfsa/constants.rs` | `+ 1` test: `limits_table_is_known_through_2026`, the literal pin on the bound value. The table, `TFSA_FIRST_YEAR`, `KNOWN_THROUGH_YEAR`, the `⚠️ HUMAN VERIFICATION REQUIRED BEFORE MERGE` comment, and all six existing tests are unchanged |
| `apps/desktop/src-tauri/src/commands/profile.rs` | `get_tfsa_accumulated_limit` loses both of its conditional branches and the early `return Ok(None)`; it now resolves identity → loads the profile → calls `accumulated_limit_for_profile(profile.as_ref(), Local::now().date_naive().year())`. Signature, `async`, and `AppHandle` unchanged. The pre-existing WHY comment was updated to describe the relocated gate |
| `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` | `+ removeSpy` on `QueryClient["removeQueries"]` and a `removedKeys()` helper alongside the existing `invalidateSpy` / `invalidatedKeys()`. `+ 2` tests asserting `["tfsa-accumulated-limit"]` is **removed** — and explicitly **not** invalidated — after `signOut` resolves and after an `auth:callback-received` event |
| `apps/desktop/tests/profile.spec.ts` | `+ get_tfsa_accumulated_limit?: CommandOutcome` and `+ accounts?: unknown[]` mock options, both wired into the existing `invoke` switch. `+ 6` cases in a new `accumulated TFSA room degradation matrix` describe block within the same spec: non-CA country, unset country, CA-with-no-DOB (asserting the DOB field renders present and empty), an `AppError::Auth { recoverable: true }` rejection, the TFSA-balance-not-subtracted proof, and the no-account-reads proof |

**Unmodified, and deliberately so — each was audited and found already correct:** `apps/desktop/src/hooks/useAuth.ts` (both `removeQueries` calls already present), `apps/desktop/src/components/profile/TfsaAccumulatedLimit.tsx` (nullish-only gate and `data-testid` already shipped), `apps/desktop/src/hooks/useProfile.ts` (no `enabled` on eligibility, no arithmetic, no error toast; `invalidateQueries` on save left intact), `error.rs`, `models/mod.rs`, `lib.rs`, `tfsa/mod.rs`, `db/net_worth.rs`, `db/account.rs`, `lib/constants.ts`, `lib/types.ts`, `locales/en.json`, `locales/fr.json`, `Cargo.toml`, `Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `src-tauri/migrations/`, `tauri.conf.json`, `routeTree.gen.ts`, `sprint-status.yaml`, and every spec other than `profile.spec.ts`.

**Files created: none.**
