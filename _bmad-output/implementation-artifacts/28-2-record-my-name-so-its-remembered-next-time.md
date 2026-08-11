# Story 28.2: Record my name so it's remembered next time

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in Nixus user,
I want to enter my first and last name on my profile and have it saved,
so that Nixus knows who I am and I never have to re-enter it.

## Acceptance Criteria

**AC1**

**Given** I am signed in with no profile yet
**When** I open `/profile`
**Then** the name fields are empty and no error is shown
**And** `get_user_profile` returns `null` rather than failing

**AC2**

**Given** I enter a first and last name
**When** I press Save
**Then** the values persist to `app_data_dir/profiles/<sub>.json`
**And** they are still there after I quit and relaunch the app

**AC3**

**Given** a save occurs
**When** the document is written
**Then** it is written atomically via the shared `write_json_atomic` helper in the new `json_store.rs`
**And** `maintenance/catalog.rs` uses that same helper, with its existing tests still passing unchanged

**AC4**

**Given** any profile command runs
**When** it needs to know which account is active
**Then** it resolves the `sub` itself via `commands::auth::current_subject()`
**And** `sub` is never accepted as an IPC parameter and is never added to `AuthState`

**AC5**

**Given** a resolved `sub`
**When** it is used as a filename
**Then** it is validated against `^[A-Za-z0-9_-]{1,128}$` and used verbatim
**And** it is never slugged or otherwise transformed
**And** a non-conforming value is rejected as `AppError::Validation { field: "cognito_sub" }`

**AC6**

**Given** a profile document whose internal `cognito_sub` does not match its filename
**When** it is read
**Then** it is treated as "no profile" rather than returning another account's data

**AC7**

**Given** a profile document that exists but cannot be parsed
**When** I open `/profile`
**Then** the page renders with empty fields rather than an error
**And** the unparseable file is renamed to `<sub>.json.corrupt` and a warning is logged
**And** the original bytes are not deleted

**AC8**

**Given** I sign out and sign in as a different account
**When** I open `/profile`
**Then** I see that account's own name, never the previous account's
**And** the cached profile query was removed with `removeQueries`, not `invalidateQueries`

**AC9**

**Given** I have a saved profile and I clear a name field and press Save
**When** the document is written
**Then** the field is cleared — save is a full replace, and `None` means empty
**And** `created_at` is carried forward unchanged while `updated_at` is set to now

**AC10**

**Given** I sign out and sign back in as the **same** account
**When** I open `/profile`
**Then** my name is still there, because profile documents are retained on sign-out (NFR7)
**And** no profile data was deleted at any point during sign-out

**AC11**

**Given** a profile document is written for the first time
**When** its contents are inspected
**Then** it contains `schema_version: 1` and its own `cognito_sub` (FR6)
**And** a document read with an unrecognized future `schema_version` is treated as "no profile" rather than parsed optimistically

**AC12**

**Given** no session exists
**When** `get_user_profile` or `save_user_profile` is invoked
**Then** it returns `AppError::Auth { recoverable: true }` and touches no file

**AC13**

**Given** the feature is complete
**When** the repository is inspected
**Then** no SQLite migration was added, `MIGRATIONS` is unchanged, no audit-log entry is written, and no new crate or npm package was introduced

## Tasks / Subtasks

- [ ] **Task 1 — `src-tauri/src/json_store.rs`: extract the shared atomic-write helper** (AC: #3)
  - [ ] Create `apps/desktop/src-tauri/src/json_store.rs` with exactly one item: `pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError>`.
  - [ ] Move the body verbatim from `maintenance/catalog.rs:150-169`. Keep every step in the same order: `path.parent()` → `create_dir_all(parent)` → `path.with_extension("json.tmp")` → `serde_json::to_string_pretty` → `fs::write(tmp)` → `fs::rename(tmp, path)`. Behaviour must not change.
  - [ ] Generalize only the four `AppError::File` message strings, which currently say "catalog" (e.g. `"Failed to serialize catalog data"` → `"Failed to serialize JSON data"`). No existing test asserts on these strings — verify that before editing (`rg "Failed to write catalog temp file" apps/desktop`).
  - [ ] Declare `mod json_store;` in `src-tauri/src/lib.rs`, in the existing alphabetical `mod` block (`mod financial_health; mod json_store; mod maintenance;` — lib.rs:1-9).
  - [ ] In `maintenance/catalog.rs`: delete the private `write_json_atomic` (lines 150-169) and add `use crate::json_store::write_json_atomic;`. The three call sites (`write_meta`, `write_makes`, `write_models`) stay unchanged.
  - [ ] Confirm `use serde::{Deserialize, Serialize};` in `catalog.rs` still has a consumer for `Serialize` (it does — the model derives) so no unused-import warning appears (project rule 9).

- [ ] **Task 2 — `commands/auth.rs`: add `current_subject()` without changing `get_auth_session` behaviour** (AC: #4, #12)
  - [ ] Extract the body of `get_auth_session` (auth.rs:676-713) into a private helper so the two entry points cannot disagree:
        `enum ResolvedSession { None, Live(CognitoSession), Refreshed(CognitoSession), Expired }` and
        `async fn resolve_session() -> Result<ResolvedSession, AppError>`.
  - [ ] `resolve_session` performs exactly today's sequence: `credentials::load_cognito_session()?` → `None` ⇒ `ResolvedSession::None`; not expired ⇒ `Live`; expired + `refresh_session(&session).await?` returns `None` ⇒ `Expired`; `Some(refreshed)` ⇒ `credentials::store_cognito_session(&refreshed)?` then `Refreshed`.
  - [ ] Rewrite `get_auth_session` on top of it, preserving all four `info!` lines byte-for-byte: `"Auth session resolved: LoggedOut"`, `"Auth session resolved: LoggedIn"`, `"Auth session resolved: SessionExpired"`, `"Auth session resolved: LoggedIn (session refreshed)"`.
  - [ ] Add `pub(crate) async fn current_subject() -> Result<String, AppError>`: `Live(s) | Refreshed(s)` ⇒ `decode_id_token_claims(&s.id_token)?.sub`; `None | Expired` ⇒ `AppError::Auth { message: "You need to be signed in to view your profile.", recoverable: true }`.
  - [ ] An empty `sub` claim is rejected with the existing `unreadable_session_error()` (recoverable `Auth`), not as a `Validation` error — an empty claim is a session defect, not user input.
  - [ ] `current_subject` does **not** validate the charset. That check lives in `profile_store.rs` so there is exactly one validation point regardless of caller (architecture: "validation lives in `profile_store.rs`, not the command layer").
  - [ ] Remove the `#[allow(dead_code)]` on `IdTokenClaims::sub` (auth.rs:480-481) and its now-stale `WHY` comment — the consumer has landed (project rule 9).
  - [ ] Do **not** add `sub` to `AuthState` (models/mod.rs:785-789) and do **not** add a `sub` field to any command signature.
  - [ ] Add unit tests next to the existing ones in `auth.rs`'s `mod tests`: `current_subject` maps `LoggedOut`/`SessionExpired` to `recoverable: true`, and the pure `sub`-from-claims path returns the claim (reuse the existing `id_token_with_payload` helper).

- [ ] **Task 3 — `models/mod.rs`: add `UserProfile` and `UpdateUserProfileInput`** (AC: #9, #11)
  - [ ] Append to `src-tauri/src/models/mod.rs`, before the `#[cfg(test)] mod tests` block, deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields (project rule 4).
  - [ ] `pub struct UserProfile { pub schema_version: u32, pub cognito_sub: String, pub first_name: Option<String>, pub last_name: Option<String>, pub birth_date: Option<String>, pub income_bracket: Option<String>, pub income_bracket_currency: Option<String>, pub country_code: Option<String>, pub subdivision_code: Option<String>, pub created_at: String, pub updated_at: String }`
  - [ ] `pub struct UpdateUserProfileInput { pub first_name: Option<String>, pub last_name: Option<String>, pub birth_date: Option<String>, pub income_bracket: Option<String>, pub income_bracket_currency: Option<String>, pub country_code: Option<String>, pub subdivision_code: Option<String> }` — the seven mutable fields; `schema_version`, `cognito_sub`, `created_at`, `updated_at` are store-owned.
  - [ ] Do **not** add `#[serde(rename_all = "camelCase")]`. That attribute on `catalog.rs::VehicleCatalogStatus` (catalog.rs:41-47) is a local exception and must not be copied.
  - [ ] Do **not** add `#[serde(skip_serializing_if = "Option::is_none")]` — an unset field must serialize as `null`, so `""` and `null` never both mean "unset".

- [ ] **Task 4 — `src-tauri/src/profile_store.rs`: the sole accessor of `profiles/`** (AC: #2, #5, #6, #7, #9, #11)
  - [ ] Create `apps/desktop/src-tauri/src/profile_store.rs` and declare `mod profile_store;` in `lib.rs`'s alphabetical `mod` block (after `mod models;`).
  - [ ] Free functions taking an explicit directory — never resolving `app_data_dir` themselves, so they are unit-testable against a `tempfile::TempDir` exactly like `db/backup.rs`:
        `pub const PROFILE_SCHEMA_VERSION: u32 = 1;`
        `pub fn profiles_dir(app_data_dir: &Path) -> PathBuf` → `app_data_dir.join("profiles")`
        `pub fn load_profile(dir: &Path, sub: &str) -> Result<Option<UserProfile>, AppError>`
        `pub fn save_profile(dir: &Path, sub: &str, input: &UpdateUserProfileInput) -> Result<UserProfile, AppError>`
        `pub fn delete_all_profiles(dir: &Path) -> Result<(), AppError>`
        `fn profile_path(dir: &Path, sub: &str) -> PathBuf` → `dir.join(format!("{sub}.json"))`
        `fn validate_sub(sub: &str) -> Result<(), AppError>`
  - [ ] `validate_sub` implements `^[A-Za-z0-9_-]{1,128}$` with no regex crate (NFR6): `!sub.is_empty() && sub.len() <= 128 && sub.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')`. On failure return `AppError::Validation { message: "Invalid account identifier".to_string(), field: Some("cognito_sub".to_string()) }` — never echo the `sub` into the message.
  - [ ] Never call `catalog.rs::make_slug` (catalog.rs:77-97) or any other transform on the `sub`. Validation over transformation, because transformation is many-to-one and could collide two accounts onto one file.
  - [ ] `load_profile`: `validate_sub(sub)?` → if the file is absent return `Ok(None)` (first run is not a failure) → read to string → on `serde_json` failure run the corrupt-file path below → if `doc.schema_version != PROFILE_SCHEMA_VERSION` emit `tracing::warn!` and return `Ok(None)` **without renaming or touching the file** (a future version is unreadable, not corrupt) → if `doc.cognito_sub != sub` emit `tracing::warn!` and return `Ok(None)` **without renaming** → otherwise `Ok(Some(doc))`.
  - [ ] Corrupt-file path: best-effort `std::fs::remove_file` of any pre-existing `<sub>.json.corrupt`, then `std::fs::rename(<sub>.json, <sub>.json.corrupt)`, then `tracing::warn!` and `Ok(None)`. The pre-delete is required because Windows `std::fs::rename` fails when the destination exists, while Unix silently replaces it. If the rename itself fails, log `warn!` and still return `Ok(None)` — never delete the original bytes and never return `Err`, which would brick the page with no path out.
  - [ ] `save_profile`: `validate_sub(sub)?` → `std::fs::create_dir_all(dir)` mapped to `AppError::File` → `let existing = load_profile(dir, sub)?` → build the document → `crate::json_store::write_json_atomic(&profile_path(dir, sub), &profile)?` → return the document. Never hand-roll `std::fs::write`.
  - [ ] Full-replace semantics: every one of the seven fields is taken from `input`. `None` clears the field; there is no merge. `created_at` = `existing.map(|p| p.created_at)` carried forward verbatim, else `now`. `updated_at` = `now` on every save, including the very first. `schema_version` = `PROFILE_SCHEMA_VERSION`. `cognito_sub` = the validated `sub`.
  - [ ] Timestamps use `chrono::Utc::now().to_rfc3339()`, matching `catalog.rs`'s `cached_at` (catalog.rs:300) — this store has no SQLite `datetime('now')` available.
  - [ ] Normalize every incoming `Option<String>`: `trim()`, and an empty result becomes `None`. Absent values are `null`, never `""` — one representation for "unset". Rust re-normalizes even though the form already does it, because validation is server-authoritative.
  - [ ] Field validation for `birth_date`, `income_bracket`, `income_bracket_currency`, `country_code`, and `subdivision_code` is **out of scope** — Stories 28.3 and 29.1–29.3 own it. This story stores those five fields opaquely.
  - [ ] No length or charset bound on `first_name` / `last_name`: no requirement specifies one, and inventing a limit would reject legitimate names. Trim + empty→`None` is the only normalization. Recorded as a deliberate variance, not an omission.
  - [ ] `delete_all_profiles` = `std::fs::remove_dir_all(dir)`, treating `ErrorKind::NotFound` as success; any other IO error maps to `AppError::File`. It removes the **whole directory recursively** — a `*.json` glob would leave `.json.corrupt` and `.json.tmp` PII behind. It is wired into `delete_all_data` by Story 28.4, so in this story it has no caller: add `#[allow(dead_code)]` with a `WHY` comment naming Story 28.4, following the precedent at `credentials.rs:70-71`. Do **not** touch `commands/danger_zone.rs` in this story.
  - [ ] `profile_store.rs` is the only module allowed to do file IO under `profiles/`. No command, no `danger_zone`, no other module.
  - [ ] Never call `keyring_core::Entry` here or anywhere outside `credentials.rs`.

- [ ] **Task 5 — `profile_store.rs` unit tests with `tempfile`** (AC: #1, #5, #6, #7, #9, #11)
  - [ ] Add `#[cfg(test)] mod tests { use super::*; use tempfile::TempDir; }` inline, matching `db/backup.rs:132-136`. `tempfile = "3"` is already a dependency — do not add it.
  - [ ] `load_returns_none_when_no_document_exists` — fresh `TempDir`, `load_profile` is `Ok(None)`, and the directory is not created as a side effect.
  - [ ] `save_then_load_round_trips` — save first/last name, reload, assert both values plus `schema_version == 1` and `cognito_sub == sub`.
  - [ ] `first_write_contains_schema_version_and_cognito_sub` — read the raw file with `std::fs::read_to_string`, `serde_json::from_str::<serde_json::Value>`, assert `["schema_version"] == 1` and `["cognito_sub"] == sub`, and assert the keys are `snake_case` (`first_name` present, `firstName` absent).
  - [ ] `clearing_a_field_writes_null_and_is_a_full_replace` — save both names, then save with `first_name: None`, assert the reloaded `first_name` is `None` and `last_name` also follows the new input.
  - [ ] `created_at_is_carried_forward_and_updated_at_is_bumped` — capture `created_at` from the first save, save again, assert `created_at` is byte-identical and `updated_at != created_at` (sleep 1ms or compare with the second save's return value if the clock resolution collides — prefer asserting `updated_at >= created_at` **and** `created_at` unchanged).
  - [ ] `an_unparseable_document_is_renamed_and_read_as_no_profile` — write `b"{ not json"`, assert `load_profile` is `Ok(None)`, `<sub>.json` is gone, `<sub>.json.corrupt` exists **with the original bytes intact**.
  - [ ] `a_second_corruption_replaces_the_previous_corrupt_file` — pre-create `<sub>.json.corrupt`, corrupt again, assert `Ok(None)` and no error (the Windows rename edge).
  - [ ] `a_future_schema_version_reads_as_no_profile_without_renaming` — hand-write a valid document with `schema_version: 2`, assert `Ok(None)`, `<sub>.json` still exists, and no `.corrupt` file was created.
  - [ ] `a_cognito_sub_mismatch_reads_as_no_profile` — write a document whose internal `cognito_sub` is another value, assert `Ok(None)` and that no field of the other account's document is returned.
  - [ ] `an_invalid_sub_charset_is_rejected_on_load_and_on_save` — table-drive `"a/b"`, `"../etc"`, `"a.b"`, `""`, `"x".repeat(129)`; assert `AppError::Validation { field: Some("cognito_sub") }` from both `load_profile` and `save_profile`, and that no file was created.
  - [ ] `no_tmp_file_survives_a_successful_save` — after `save_profile`, assert `<sub>.json.tmp` does not exist (the atomic-write contract).
  - [ ] `.unwrap()` is permitted inside `#[cfg(test)]` only, matching the existing convention.

- [ ] **Task 6 — `commands/profile.rs`: the two commands** (AC: #1, #2, #4, #12)
  - [ ] Create `apps/desktop/src-tauri/src/commands/profile.rs` and add `pub mod profile;` to `commands/mod.rs`'s alphabetical list (between `pub mod projection;` and `pub mod recurring;` — i.e. after `pub mod onboarding;`, keeping the list sorted).
  - [ ] Private helper mirroring `commands/import.rs:40-44`:
        `fn resolve_profiles_dir(app: &AppHandle) -> Result<PathBuf, AppError> { Ok(crate::profile_store::profiles_dir(&app.path().app_data_dir().map_err(|e| AppError::File { message: format!("Failed to resolve app data dir: {}", e) })?)) }`
  - [ ] `#[tauri::command(rename_all = "snake_case")] pub async fn get_user_profile(app: AppHandle) -> Result<Option<UserProfile>, AppError>` — `let sub = crate::commands::auth::current_subject().await?;` **before** resolving any path, so a no-session call touches no file (AC12); then `profile_store::load_profile(&dir, &sub)`.
  - [ ] `#[tauri::command(rename_all = "snake_case")] pub async fn save_user_profile(app: AppHandle, first_name: Option<String>, last_name: Option<String>, birth_date: Option<String>, income_bracket: Option<String>, income_bracket_currency: Option<String>, country_code: Option<String>, subdivision_code: Option<String>) -> Result<UserProfile, AppError>` — resolve the `sub` first, assemble `UpdateUserProfileInput` inside the command, then `profile_store::save_profile(&dir, &sub, &input)`.
  - [ ] Flat scalar parameters, not a struct parameter — matching `commands/account.rs:81-88`. Both commands are `async` because `current_subject()` may perform a token refresh.
  - [ ] Commands orchestrate only: no file IO, no validation, no `std::fs` call, no panic, no `.unwrap()`.
  - [ ] No `insert_audit_log` call and no `State<DbState>` parameter — a file-backed store has neither a `Connection` nor an `i64 entity_id`, and profile values must never enter `nkbaz-finance.db` (project rule 3 governs SQLite mutations; this is not one).
  - [ ] Register both in `lib.rs`'s `tauri::generate_handler!`, appended after `commands::auth::sign_out,` (lib.rs:268-272): `commands::profile::get_user_profile, commands::profile::save_user_profile,`.

- [ ] **Task 7 — `lib/constants.ts` + `lib/types.ts`: query key and IPC mirrors** (AC: #1, #8)
  - [ ] `apps/desktop/src/lib/constants.ts`: add `profile: ["profile"] as const,` as a flat top-level entry inside `queryKeys` (place it beside the existing `auth` entry at constants.ts:62-64). Do **not** nest it under `auth` — the nested `auth.session` shape is the outlier, not the convention.
  - [ ] `apps/desktop/src/lib/types.ts`: append `UserProfile` and `UpdateUserProfileInput` mirroring the Rust shapes exactly, next to the existing `AuthState` union (types.ts:664-667). All seven mutable fields are `string | null`; `schema_version: number`; `cognito_sub`, `created_at`, `updated_at` are `string`.
  - [ ] Field names stay `snake_case` in TypeScript, matching every other IPC type in this file.

- [ ] **Task 8 — `hooks/useProfile.ts`: the only frontend module invoking the profile commands** (AC: #1, #2, #9)
  - [ ] Create `apps/desktop/src/hooks/useProfile.ts` exporting `useUserProfile()` and `useSaveUserProfile()`, following `hooks/useAccounts.ts`.
  - [ ] `useUserProfile` = `useQuery({ queryKey: queryKeys.profile, queryFn: () => invoke<UserProfile | null>("get_user_profile") })`. No `enabled` guard is needed: the `/profile` route from Story 28.1 renders `SignInRequired` unless the session is `LoggedIn`, so the query only mounts behind the guard.
  - [ ] `useSaveUserProfile` = `useMutation({ mutationFn: (input: UpdateUserProfileInput) => invoke<UserProfile>("save_user_profile", { first_name: input.first_name, last_name: input.last_name, birth_date: input.birth_date, income_bracket: input.income_bracket, income_bracket_currency: input.income_bracket_currency, country_code: input.country_code, subdivision_code: input.subdivision_code }), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.profile }) })`.
  - [ ] `invalidateQueries` here is correct and deliberate: invalidate on **data** change, remove on **identity** change. The two are different operations and must not be conflated.
  - [ ] Import `queryKeys` from `@/lib/constants` — never hardcode the key string (project rule 6). Use the `@/` alias, never a relative `../`.
  - [ ] No component may call `invoke` for these commands directly.

- [ ] **Task 9 — `components/profile/ProfileForm.tsx`: name fields with an explicit Save button** (AC: #1, #2, #9)
  - [ ] Create `apps/desktop/src/components/profile/ProfileForm.tsx` and render it from the `LoggedIn` branch of `routes/profile.tsx` (the route and its four-way guard already exist from Story 28.1 — do not re-check session state inside the form; there must be exactly one decision point).
  - [ ] `react-hook-form` `useForm<ProfileFormData>` with **exactly** the `snake_case` IPC field names: `first_name`, `last_name`. This is what makes `AppError::Validation { field }` map straight to `setError(field)` with no translation table.
  - [ ] `defaultValues` from `useUserProfile()` data with `?? ""`; call `reset({ first_name: data?.first_name ?? "", last_name: data?.last_name ?? "" })` in an effect when the query resolves, so an in-flight fetch does not leave the inputs permanently empty.
  - [ ] Explicit Save button (`type="submit"`), **not** autosave — Epic 28's resolved decision. Label via the existing `t("common.save")`; pending label via the new `t("profile.saving")`; disable while `isPending`.
  - [ ] `onSubmit` maps `""` → `null` for both names, then submits the full seven-field input: the two form fields plus `birth_date`, `income_bracket`, `income_bracket_currency`, `country_code`, `subdivision_code` read from the loaded `UserProfile` (`data?.birth_date ?? null`, …). Save is a full replace, so passing them through is what keeps Stories 28.3 and 29.x purely additive instead of having this story's save silently clear fields it does not render.
  - [ ] `onError`: if the error is `{ type: "validation", field }` and `field` is `"first_name"` or `"last_name"`, call `setError(field, { message })`; otherwise `toast.error(t("toast.saveFailed"))`. Reuse the local `getErrorMessage` shape from `components/settings/CredentialsForm.tsx:23-36` rather than inventing a new error reader.
  - [ ] `onSuccess`: `toast.success(t("toast.saveSuccess"))` — both toast keys already exist in both locales.
  - [ ] Use `Input`, `Label`, and `Button` from `@nixus/shared` — never a local re-implementation (project rule 8). Set `aria-invalid={!!errors.first_name}` as `AddIncomeSourceForm.tsx` does.
  - [ ] Add a `data-testid` on the form and on the Save button for the Story 28.1 Playwright spec to extend.
  - [ ] Do **not** add a date-of-birth field, a `DatePicker`, or any country/income control — Stories 28.3 and 29.x own those.

- [ ] **Task 10 — `hooks/useAuth.ts`: remove the profile cache on every identity change** (AC: #8, #10)
  - [ ] In `useSignOut().onSuccess` (useAuth.ts:55-57): add `queryClient.removeQueries({ queryKey: queryKeys.profile });` alongside the existing `invalidateQueries({ queryKey: queryKeys.auth.session })`.
  - [ ] In the `auth:callback-received` listener inside `useAuthSession` (useAuth.ts:16-18): add the same `removeQueries` call alongside the existing session invalidation.
  - [ ] `removeQueries`, never `invalidateQueries`, for `queryKeys.profile`. Invalidation leaves the previous account's name rendered while refetching — a real, visible cross-account leak. This is the single place frontend code can break account isolation.
  - [ ] Sign-out must not delete any profile document (NFR7 / decision D6): verify `commands::auth::sign_out` (auth.rs:721-737) is untouched and that nothing in the sign-out path calls `profile_store`.

- [ ] **Task 11 — i18n: three new `profile.*` keys in both locales** (AC: #1, #2)
  - [ ] Add to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`, as flat dotted keys inside the existing `profile.*` block (en.json:40-46):
        `profile.firstName` — "First name" / "Prénom"
        `profile.lastName` — "Last name" / "Nom"
        `profile.saving` — "Saving…" / "Enregistrement…"
  - [ ] Reuse `common.save`, `toast.saveSuccess`, and `toast.saveFailed` — all three already exist in both locales. Do not add duplicates.
  - [ ] `profile.saving` must use the single-character ellipsis `\u2026`, not three periods — the locale suite asserts this.
  - [ ] Extend the `profile.*` namespace only. Do not introduce `userProfile.*`.
  - [ ] **Required, or CI fails:** update `apps/desktop/src/locales/__tests__/profile-i18n.test.ts`. Its `declares every profile key it ships` test (lines 58-65) asserts the shipped `profile.*` key set equals `REQUIRED_KEYS` exactly, so three new keys break it until added. Add all three to `REQUIRED_KEYS` and add `profile.saving` to `ELLIPSIS_KEYS` (line 37).
  - [ ] Run `pnpm --filter @nixus/desktop test` and confirm the locale-parity suite passes — it fails on any key present in one locale only.

- [ ] **Task 12 — Regression verification and constraint audit** (AC: #3, #13)
  - [ ] Run the `catalog.rs` tests and confirm all five still pass unchanged after the `write_json_atomic` move — it is a pure move, so any failure means the extraction was not behaviour-neutral (`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml catalog`).
  - [ ] Run the full Rust suite, including the existing `auth.rs` tests, and confirm the `get_auth_session` refactor changed no behaviour.
  - [ ] `cargo clippy` and `tsc` clean: zero warnings, including `noUnusedLocals` / `noUnusedParameters` (project rules 7 and 9).
  - [ ] Audit and confirm, by inspection: `src-tauri/migrations/` has no new file; `db/mod.rs`'s `MIGRATIONS` array is unchanged; `db/danger_zone.rs`'s `WIPE_TABLES` / `PRESERVED_TABLES` are unchanged; no `insert_audit_log` call was added; `Cargo.toml` and every `package.json` dependency list is unchanged; `error.rs` gained no `AppError` variant.
  - [ ] Confirm `keyring_core::Entry` appears nowhere outside `credentials.rs` (`rg "keyring_core::Entry" apps/desktop/src-tauri/src`).
  - [ ] Confirm `ProfileMenu.tsx`, `TopBar`, and every other always-mounted component gained no `invoke()` call, so no existing Playwright spec's Tauri mock needs a new case (`project-context.md:295`).
  - [ ] Manual verification of AC2 and AC10: save a name, quit and relaunch the app, confirm it is still there; sign out and back in as the same account, confirm it is still there; inspect `app_data_dir/profiles/<sub>.json` and confirm the filename is the raw Cognito UUID.

## Dev Notes

### Dependency and sequencing

This story depends **only on Story 28.1**, which already shipped `apps/desktop/src/routes/profile.tsx` with its four-way session guard (`isLoading` → skeleton, `LoggedIn` → form area, `LoggedOut` / `SessionExpired` → `SignInRequired`), the `ProfileMenu` navigation `Link`, and the read-only email display. This story fills the `LoggedIn` branch with a real form and builds the entire storage foundation beneath it. Nothing in 28.3, 28.4, 28.5, or Epics 29–30 is required, and none of their work belongs here.

This is deliberately the largest story in the feature. Splitting it was considered and rejected during epic planning: every smaller split either produces a story with no user value or defers `removeQueries` to a later story, which would ship a real cross-account data leak in the interim. [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)]

### Two superseded architecture statements — read these before coding

`architecture-user-profile.md` contains two earlier statements that its own later sections overturn. Following the earlier text produces a colliding filename scheme:

1. **D2 originally said to slug the `sub`** via `catalog.rs::make_slug`. **Superseded.** "Slugging is a many-to-one mapping, so two distinct `sub` values could collapse to the same filename and one account would read another's profile — the exact failure NFR3 exists to prevent. `make_slug` is safe for vehicle makes (display strings, collisions harmless) and unsafe for identity keys. … **Validation over transformation, because transformation can collide.**" [Source: architecture-user-profile.md#Corrections to Prior Decisions]
2. **Step 6 said the save path "validates → merges"** while D4 called it whole-document. **Resolved as full replace** in gap G1: "The form always submits every field, so `None` means the field is cleared. Partial updates are not supported. `created_at` is the only value carried over from an existing document; `updated_at` is always set to now." [Source: architecture-user-profile.md#Gap Analysis Results]

Gap G5 adds the trap this creates: "Under full-replace semantics an agent could plausibly regenerate `created_at` on every save, silently destroying it."

### The sole-accessor pattern `profile_store.rs` must mirror

`credentials.rs` is the only module in the repo that touches the keyring. `profile_store.rs` must hold the same relationship to `profiles/`. Note the shape: a private `Entry` factory, thin public functions, every error mapped to a single `AppError` variant, and never a secret or a raw blob in a message.

```rust
// credentials.rs:63-106
fn auth_entry() -> Result<Entry, AppError> {
    Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT).map_err(|e| AppError::Auth {
        message: format!("Secure storage is unavailable: {}", e),
        recoverable: false,
    })
}

pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    let json = serde_json::to_string(session).map_err(|_| AppError::Auth {
        message: "Failed to encode session for secure storage.".to_string(),
        recoverable: false,
    })?;
    auth_entry()?
        .set_password(&json)
        .map_err(|e| AppError::Auth { /* … */ })
}

pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    let json = match auth_entry()?.get_password() {
        Ok(json) => json,
        Err(Error::NoEntry) => return Ok(None),          // ← absent is Ok(None), not an error
        Err(e) => return Err(AppError::Auth { /* … */ recoverable: true }),
    };

    // The blob and the serde error are deliberately never interpolated: the blob holds tokens.
    serde_json::from_str::<CognitoSession>(&json)
        .map(Some)
        .map_err(|_| AppError::Auth { /* … */ })
}
```

Two conventions to carry over verbatim: **absent means `Ok(None)`**, and **the payload is never interpolated into an error message**. In `profile_store.rs` the analogue is that a rejected `sub` must not be echoed into `AppError::Validation`'s message, and a corrupt document's bytes must not reach a log line.

Also note the `#[allow(dead_code)]` convention at `credentials.rs:70-71`, which is the exact precedent for `delete_all_profiles` in this story:

```rust
// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
```

### The existing `sub` extraction and the keyring load + refresh path to reuse

The `sub` claim is already parsed and already dead-coded, waiting for exactly this consumer:

```rust
// commands/auth.rs:471-482
#[derive(Debug, Clone, Deserialize)]
struct IdTokenClaims {
    email: Option<String>,
    name: Option<String>,
    // WHY the allowance: parsed per NFR4 as the durable identity key, but
    // `AuthState` does not surface it yet (no cloud/sync/notification consumer
    // exists). Remove the allow when a consumer lands.
    #[allow(dead_code)]
    sub: String,
}
```

`sub: String` is non-optional, so a token without the claim already fails to decode — the existing test `a_json_payload_without_sub_is_rejected` pins that.

`get_auth_session` is the load-and-refresh path `current_subject()` must reuse rather than duplicate. It is the whole function, and Task 2's refactor must preserve every branch and every log line:

```rust
// commands/auth.rs:676-713
#[tauri::command(rename_all = "snake_case")]
pub async fn get_auth_session() -> Result<AuthState, AppError> {
    let session = match credentials::load_cognito_session()? {
        Some(session) => session,
        None => {
            info!("Auth session resolved: LoggedOut");
            return Ok(AuthState::LoggedOut);
        }
    };

    if !is_session_expired(session.expires_at, Utc::now().timestamp()) {
        let state = logged_in_from_id_token(&session.id_token)?;
        info!("Auth session resolved: LoggedIn");
        return Ok(state);
    }

    let refreshed = match refresh_session(&session).await? {
        Some(refreshed) => refreshed,
        None => {
            // The keyring entry is left in place on purpose: an offline launch
            // must still be able to refresh successfully on a later online
            // launch. `sign_out` is the only path that removes the entry.
            info!("Auth session resolved: SessionExpired");
            return Ok(AuthState::SessionExpired);
        }
    };

    credentials::store_cognito_session(&refreshed)?;

    let state = logged_in_from_id_token(&refreshed.id_token)?;
    info!("Auth session resolved: LoggedIn (session refreshed)");
    Ok(state)
}
```

`current_subject()`'s target signature and contract: `pub(crate) async fn current_subject() -> Result<String, AppError>` — "It follows the same keyring-load-and-refresh path and returns the `id_token` `sub` claim, or `AppError::Auth { recoverable: true }` when the state is `LoggedOut` or `SessionExpired`." [Source: architecture-user-profile.md#Authentication & Security] It is `async` because a refresh may fire, which is why both commands are `async` too.

`AuthState` must not gain a `sub`. It is a serde-tagged enum whose wire shape Story 27.1's TypeScript union depends on:

```rust
// models/mod.rs:778-789
// Variants stay PascalCase on purpose: Story 27.1's TypeScript union discriminates on the
// literals "LoggedOut" | "LoggedIn" | "SessionExpired", so `rename_all` must NOT be applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AuthState {
    LoggedOut,
    LoggedIn { email: String, name: Option<String> },
    SessionExpired,
}
```

### The `write_json_atomic` body to move — and the `camelCase` attribute NOT to copy

Move this verbatim out of `maintenance/catalog.rs` into `json_store.rs` as `pub(crate)`:

```rust
// maintenance/catalog.rs:150-169  →  json_store.rs
fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::File {
        message: "Invalid catalog file path".to_string(),
    })?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::File {
        message: format!("Failed to create parent dir: {}", e),
    })?;

    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| AppError::File {
        message: format!("Failed to serialize catalog data: {}", e),
    })?;
    std::fs::write(&tmp_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write catalog temp file: {}", e),
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| AppError::File {
        message: format!("Failed to finalize catalog file: {}", e),
    })?;
    Ok(())
}
```

Note `path.with_extension("json.tmp")`: `Path::with_extension` **replaces** the extension, so `<sub>.json` becomes `<sub>.json.tmp` only because the `sub` charset allow-list excludes `.`. The charset validation is load-bearing for the temp-path scheme, not just for path traversal.

Its three call sites (`write_meta`, `write_makes`, `write_models` at catalog.rs:118-148) all pre-create the directory themselves and then call the helper, which creates the parent again — harmless and unchanged.

The one thing in `catalog.rs` that must **not** be copied:

```rust
// maintenance/catalog.rs:41-47  — LOCAL EXCEPTION, DO NOT COPY
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleCatalogStatus {
    pub available: bool,
    pub cached_at: Option<String>,
    pub stale: bool,
}
```

"An agent reading `catalog.rs` as the template for this feature would plausibly inherit it." [Source: architecture-user-profile.md#Format Patterns] `UserProfile` and `UpdateUserProfileInput` use serde-default `snake_case`, matching the project-wide "JSON / IPC fields: snake_case" rule.

The other thing not to reuse from `catalog.rs` is `make_slug` (catalog.rs:77-97) — see the Corrections note above.

### Validation style to mirror

`db/account.rs` is the house style for field validation: an allow-list `const`, a trim, and `AppError::Validation` carrying the exact IPC field name.

```rust
// db/account.rs:117-146
pub fn insert_account(conn: &Connection, input: &CreateAccountInput) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }
    // …
    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }
```

One deviation for `cognito_sub`: do **not** interpolate the offending value into the message the way `insert_account` does for `account_type`. `AppError::Validation`'s message crosses IPC to the UI, and the `sub` is an identity key.

`db/account.rs`'s `#[cfg(test)] mod tests` (lines 310-406) shows the conventions: `use super::*;`, one behaviour per `#[test]`, descriptive snake_case test names that read as assertions, and a fixture helper at the bottom of the module.

### Tempfile test pattern to follow

```rust
// db/backup.rs:132-136, 192-213
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{run_migrations, MIGRATIONS};
    use tempfile::TempDir;

    #[test]
    fn restore_replaces_data_and_cleans_up() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        // …
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on success"
        );
    }
```

Note the two habits worth copying: `.expect("…")` with a reason rather than bare `.unwrap()`, and asserting on the **absence** of leftover files, not only on the happy path. The `no_tmp_file_survives_a_successful_save` test in Task 5 is the direct analogue.

`tempfile = "3"` is already in `Cargo.toml`. Adding it would violate NFR6.

### Command orchestration shape

`commands/account.rs` is the shape to mirror — flat scalar parameters, input struct assembled inside the command, `db`/store call, return:

```rust
// commands/account.rs:80-101 (abridged)
#[tauri::command(rename_all = "snake_case")]
pub fn update_account(
    state: State<DbState>,
    id: i64,
    name: String,
    institution: String,
    account_type: String,
    currency: String,
) -> Result<Account, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?;
    let input = UpdateAccountInput { name, institution, account_type, currency };
    let result = account_db::update_account(&conn, id, &input)?;
    // …
}
```

Two differences for `commands/profile.rs`, both deliberate:

- **No `State<DbState>`** and **no `audit_db::insert_audit_log`** call. Every command in `account.rs` writes an audit row (project rule 3), and this one must not: "`insert_audit_log` requires a `Connection` and an `i64 entity_id`; a file-backed store has neither. This is consistent with both precedents — `credentials.rs` and `catalog.rs` mutate user-scoped state without audit entries." The side benefit is load-bearing: "with no audit rows, profile values never enter `nkbaz-finance.db` at all, so they cannot leak into a backup through the audit trail." [Source: architecture-user-profile.md#D10]
- **`AppHandle` instead of `State`**, with the directory resolved exactly as `commands/import.rs:40-44` does:

```rust
fn resolve_app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::File {
        message: format!("Failed to resolve app data dir: {}", e),
    })
}
```

Resolve the `sub` **before** the directory in both commands, so AC12's "touches no file" is structural rather than incidental.

### Error variants — reuse only

```rust
// error.rs:4-14
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

`Auth { recoverable: true }` for no-session, `Validation { message, field }` for field errors, `File` for IO. No new variant. [Source: architecture-user-profile.md#D13]

`Validation` serializes to `{ "type": "validation", "message": …, "field": … }` (error.rs:41-50) and `Auth` to `{ "type": "auth", "message": …, "recoverable": … }` (error.rs:64-70). The `field` key is what `ProfileForm` reads to call `setError`.

### Model derive conventions

Every struct in `models/mod.rs` derives exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields and `String` ISO-8601 dates:

```rust
// models/mod.rs:12-20
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetCategory {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
    pub target_cents: i64,
    pub sort_order: i32,
    pub created_at: String,
}
```

`CognitoSession` (models/mod.rs:768-776) documents the one place the project deviates from string dates, and why — worth reading before choosing a timestamp type. `UserProfile`'s `created_at` / `updated_at` are `String` (RFC 3339), matching the rule and `catalog.rs`'s `cached_at`.

`birth_date` is an ISO 8601 `String` (`"1985-03-14"`), never a timestamp — the field exists in the model in this story but is only populated from 28.3.

### Frontend hook conventions

`hooks/useAccounts.ts` is the template: one file per feature, `queryKeys` imported from `@/lib/constants`, snake_case `invoke` args, `onSuccess` invalidating every affected key.

```typescript
// hooks/useAccounts.ts:56-73
export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAccountInput) =>
      invoke<Account>("update_account", {
        id: input.id,
        name: input.name,
        institution: input.institution,
        account_type: input.account_type,
        currency: input.currency,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
    },
  });
}
```

`hooks/useAiConfig.ts` is an **anti-example** for this story — it hardcodes `queryKey: ["ai-config"]` instead of using `queryKeys`, violating project rule 6. Do not follow it:

```typescript
// hooks/useAiConfig.ts:5-10 — DO NOT COPY THE HARDCODED KEY
export function useAiConfig() {
  return useQuery({
    queryKey: ["ai-config"],
    queryFn: () => invoke<AiConfig>("get_ai_config"),
  });
}
```

The `useAuth.ts` edits are surgical. Current state:

```typescript
// hooks/useAuth.ts:16-18
      const unlisten = await listen("auth:callback-received", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      });

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

Both bodies gain `queryClient.removeQueries({ queryKey: queryKeys.profile });`. "Invalidation keeps stale data rendered while refetching, which would briefly show one account's name to another. This is the only place in the feature where account isolation can be broken by frontend code, so it is a hard requirement." [Source: architecture-user-profile.md#D5]

Note that `useAuthSession` sets `staleTime: Infinity` (useAuth.ts:40) with a documented reason — do not change it.

### Query key shape

```typescript
// lib/constants.ts:59-65
  financialHealth: ["financial-health"] as const,
  financialHealthSummary: ["financial-health", "summary"] as const,
  financialHealthDetail: ["financial-health", "detail"] as const,
  auth: {
    session: ["auth", "session"] as const,
  },
};
```

`profile: ["profile"] as const` goes in flat and top-level. The nested `auth` object is "the outlier, not the dominant convention." [Source: architecture-user-profile.md#Naming Patterns]

### Form conventions and the field-name invariant

`components/income/AddIncomeSourceForm.tsx` is the closest existing form, and it already names its fields after the IPC parameters:

```typescript
// components/income/AddIncomeSourceForm.tsx:23-47 (abridged)
interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

const { register, handleSubmit, control, formState: { errors } } =
  useForm<IncomeSourceFormData>({
    defaultValues: { name: "", income_type: "employment" },
    mode: "onBlur",
  });
```

`ProfileForm` must do the same with `first_name` and `last_name`, because "form field names are the `snake_case` IPC names, so an `AppError::Validation { field }` maps to `setError(field)` with no translation table between naming conventions." [Source: architecture-user-profile.md#Process Patterns]

For reading the typed error off a rejected `invoke`, reuse the existing local reader shape:

```typescript
// components/settings/CredentialsForm.tsx:23-36
interface AppError {
  type?: string;
  message?: string;
}

function getErrorMessage(err: unknown): { type: string; message: string } {
  const e = err as AppError;
  const message =
    e?.message ?? (typeof err === "string" ? err : JSON.stringify(err, null, 2));
  return { type: e?.type ?? "unknown", message: message ?? "An unexpected error occurred" };
}
```

`ProfileForm`'s version additionally reads `field`.

### Explicit invariants — each one is a task above, not a suggestion

| Invariant | Where enforced | Failure if violated |
| --- | --- | --- |
| `sub` matches `^[A-Za-z0-9_-]{1,128}$` and is used **verbatim** as the filename, never slugged | `profile_store::validate_sub` | Slugging is many-to-one; two accounts collide onto one file and one reads the other's profile |
| `sub` is never an IPC parameter and never added to `AuthState` | `commands/profile.rs` signatures, `models/mod.rs` | Account isolation drops from an invariant to a convention the webview can bypass |
| `removeQueries`, not `invalidateQueries`, for `queryKeys.profile` on session transitions | `hooks/useAuth.ts` (both sites) | The previous account's name renders during refetch — a visible cross-account leak |
| Full-replace save: `None` clears; `created_at` carried forward; `updated_at` always bumped | `profile_store::save_profile` | Either a cleared field silently persists, or `created_at` is destroyed on every save |
| `schema_version: 1` written; an unrecognized future version reads as "no profile" | `profile_store` load/save | A newer document parsed optimistically yields silently wrong data |
| Same-account sign-out then sign-in retains the profile (D6) | `sign_out` untouched; no `profile_store` call on the sign-out path | Every sign-out permanently destroys data with no cloud copy to restore from |
| Corrupt file renamed to `<sub>.json.corrupt`, `warn!` logged, original bytes preserved, `Ok(None)` returned | `profile_store::load_profile` | Silent deletion destroys data; a hard error bricks the page with no path out |
| No session ⇒ `AppError::Auth { recoverable: true }`, no file touched | `commands/profile.rs` (resolve `sub` first) | A no-session call creates directories or leaks the existence of a profile |
| No SQLite migration, no audit-log entry, no new crate, no new npm package | Task 12 audit | Profile PII enters `nkbaz-finance.db` and therefore backups; NFR6 breaks |

### Testing standards

- **Rust:** inline `#[cfg(test)] mod tests` using `tempfile`, matching `db/backup.rs`. `.unwrap()` only inside tests. Six mandatory cases plus the extras in Task 5: no document, round-trip save/load, cleared field, corrupt file, `cognito_sub` mismatch, invalid `sub` charset.
- **Vitest:** the locale-parity suite in `src/locales/__tests__/` runs automatically and fails CI on any one-sided key. `profile-i18n.test.ts` additionally asserts the exact shipped `profile.*` key set, so it **must** be updated in the same change.
- **Playwright:** the profile spec created by Story 28.1 is extended to stub `get_user_profile` and `save_user_profile`. No existing spec is modified — this story adds no `invoke()` to any always-mounted component, which is what keeps the whole existing suite untouched (`project-context.md:295`).
- **Not in this story:** the dedicated delete-all test (Story 28.4), date-of-birth validation tests (28.3), dataset tests (Epic 29), TFSA calculation tests (Epic 30).

### Project Structure Notes

New files, all in existing conventional locations:

```
apps/desktop/src-tauri/src/json_store.rs          # NEW: pub(crate) write_json_atomic
apps/desktop/src-tauri/src/profile_store.rs       # NEW: sole accessor of app_data_dir/profiles/
apps/desktop/src-tauri/src/commands/profile.rs    # NEW: get_user_profile, save_user_profile
apps/desktop/src/hooks/useProfile.ts              # NEW: useUserProfile, useSaveUserProfile
apps/desktop/src/components/profile/ProfileForm.tsx  # NEW
```

Modified files:

```
apps/desktop/src-tauri/src/lib.rs                 # + mod json_store; mod profile_store;
                                                  # + two commands in generate_handler!
apps/desktop/src-tauri/src/commands/mod.rs        # + pub mod profile;
apps/desktop/src-tauri/src/commands/auth.rs       # + current_subject(); resolve_session() refactor;
                                                  #   retires #[allow(dead_code)] on IdTokenClaims::sub
apps/desktop/src-tauri/src/maintenance/catalog.rs # - private write_json_atomic; + use crate::json_store
apps/desktop/src-tauri/src/models/mod.rs          # + UserProfile, UpdateUserProfileInput
apps/desktop/src/lib/constants.ts                 # + queryKeys.profile
apps/desktop/src/lib/types.ts                     # + UserProfile, UpdateUserProfileInput
apps/desktop/src/hooks/useAuth.ts                 # + removeQueries(queryKeys.profile) ×2
apps/desktop/src/routes/profile.tsx               # renders ProfileForm in the LoggedIn branch
apps/desktop/src/locales/en.json                  # + 3 profile.* keys
apps/desktop/src/locales/fr.json                  # + the same 3 keys, FR values
apps/desktop/src/locales/__tests__/profile-i18n.test.ts  # + 3 keys to REQUIRED_KEYS, 1 to ELLIPSIS_KEYS
```

Naming alignment: `profile_store.rs` is a **top-level sibling to `credentials.rs`**, deliberately not `db/profile.rs` (no SQLite involvement) and not a new `stores/` directory. `json_store.rs` is likewise top-level, shared by two file-backed stores so neither carries its own atomic-write implementation. Everything else follows `commands/{feature}.rs`, `components/{feature}/`, `hooks/use{Feature}.ts`.

**Deliberately not touched:** `src-tauri/migrations/`, `db/mod.rs` (`MIGRATIONS`), `db/danger_zone.rs` (`WIPE_TABLES` / `PRESERVED_TABLES`), `db/backup.rs`, `commands/backup.rs`, `db/audit.rs`, `commands/danger_zone.rs`, `error.rs`, `credentials.rs`, `components/auth/ProfileMenu.tsx`, `components/shared/AppSidebar.tsx`, `DestinationNav.tsx`, `lib/navigation.ts`, `packages/shared/src/ui/date-picker.tsx`, `Cargo.toml`, every `package.json`, `tauri.conf.json`, and every existing `tests/*.spec.ts`.

Backup exclusion and restore survival need no code: `export_backup` copies `nkbaz-finance.db` only, and `restore_from_file` swaps that same file, so profiles are excluded from backups and survive restores as **structural consequences** of the storage choice rather than behaviours maintained by code.

**Detected variances, recorded deliberately:**

1. **`delete_all_profiles` ships with no caller** in this story and therefore needs `#[allow(dead_code)]` with a `WHY` comment naming Story 28.4. Project rule 9 permits this ("add `#[allow(dead_code)]` only if it will be used"), and `credentials.rs:70-71` is the precedent. The alternative — deferring the function to 28.4 — would split the store's public surface across two stories.
2. **`save_user_profile` takes all seven fields** while this story's form renders two. That is architecture D4's signature, kept intact so 28.3 and 29.x are purely additive. `ProfileForm` passes the other five through from the loaded profile so full-replace never clears a field this story does not render.
3. **No length or charset bound on the name fields.** No requirement specifies one, so none is invented. Flagged rather than silently chosen.
4. **A future-`schema_version` document is overwritten by a subsequent save**, because it reads as "no profile" and `created_at` therefore restarts. Accepted: there is no `schema_version` 2 and the architecture explicitly defers a migration path ("No migration path defined for `schema_version` 2 — correct to defer, since there is no second version to migrate to").
5. **The four `AppError::File` messages in `write_json_atomic` are reworded** from "catalog" to neutral text. This is the only non-verbatim part of an otherwise pure move; no test asserts on them.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.2: Record my name so it's remembered next time] — all thirteen AC blocks, copied verbatim
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — FR3, FR4, FR6, NFR2, NFR3, NFR6, NFR7
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — new Rust modules, models, IPC surface, `current_subject`, validated-not-slugged `sub`, in-document integrity guard, full-replace semantics, no new `AppError` variant, no audit logging, untouched backup/restore, cache isolation, frontend structure, form field names, serde casing, testing
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 28: Your Nixus Cloud Profile] — explicit Save button (resolved UX decision), 28.1 sequencing note
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)] — accepted story-sizing exception, FR6 and NFR7 AC additions
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Corrections to Prior Decisions] — Correction 1: `sub` validated, never slugged (supersedes D2)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results] — G1 full replace, G2 recursive delete, G4 four-way guard, G5 `created_at` preservation; regression checks required
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture] — D2 storage layout, document shape, in-document `cognito_sub` guard
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Authentication & Security] — D3 `sub` never crosses IPC, `current_subject()` signature, D6 sign-out retention, D13 error reuse
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#API & Communication Patterns] — D4 command signatures, whole-document semantics
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Frontend Architecture] — D5 `removeQueries`, D11 no new `invoke` in `ProfileMenu`
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Naming Patterns] — module placement, store function signatures, query-key shape, i18n namespace
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns] — `write_json_atomic` promotion to `json_store.rs`, test layout
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Format Patterns] — `snake_case` JSON, the `camelCase` anti-pattern, `null` not `""`
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Process Patterns] — corrupt-document handling, missing file is `Ok(None)`, server-authoritative validation, form field names
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Enforcement Guidelines] — the eight MUSTs
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Project Structure & Boundaries] — delta tree, "not touched, deliberately", data boundaries
- [Source: docs/project-context.md#Critical Implementation Rules] — rules 2 (IPC), 3 (commands orchestrate), 4 (model derives), 5 (`AppError`), 6 (query keys), 7 (TS strictness), 8 (shared UI), 9 (warnings)
- [Source: docs/project-context.md#Testing Rules] — Vitest locale parity, Playwright against the Vite dev server with stubbed `invoke`, the always-mounted-component mock trap at line 295
- [Source: apps/desktop/src-tauri/src/credentials.rs#L63-L118] — sole-accessor pattern, `Ok(None)` on absent, never interpolate the payload, `#[allow(dead_code)]` convention
- [Source: apps/desktop/src-tauri/src/commands/auth.rs#L467-L482] — `IdTokenClaims` and the dead-coded `sub`
- [Source: apps/desktop/src-tauri/src/commands/auth.rs#L669-L737] — `get_auth_session` load + refresh path; `sign_out`
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs#L41-L47] — the `camelCase` local exception not to copy
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs#L77-L97] — `make_slug`, not to be reused for identity keys
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs#L118-L169] — `write_json_atomic` and its three call sites
- [Source: apps/desktop/src-tauri/src/db/account.rs#L117-L146] — validation style
- [Source: apps/desktop/src-tauri/src/db/account.rs#L310-L406] — `#[cfg(test)]` conventions
- [Source: apps/desktop/src-tauri/src/db/backup.rs#L132-L213] — `tempfile` test pattern, absence assertions
- [Source: apps/desktop/src-tauri/src/commands/account.rs#L80-L109] — command orchestration shape
- [Source: apps/desktop/src-tauri/src/commands/import.rs#L40-L44] — `app_data_dir` resolution
- [Source: apps/desktop/src-tauri/src/commands/mod.rs#L1-L22] — module declaration list
- [Source: apps/desktop/src-tauri/src/error.rs#L4-L99] — `AppError` variants and their wire shapes
- [Source: apps/desktop/src-tauri/src/models/mod.rs#L12-L20] — derive conventions
- [Source: apps/desktop/src-tauri/src/models/mod.rs#L768-L789] — `CognitoSession`, `AuthState`
- [Source: apps/desktop/src-tauri/src/lib.rs#L1-L9] — module declarations
- [Source: apps/desktop/src-tauri/src/lib.rs#L268-L272] — command registration
- [Source: apps/desktop/src/hooks/useAuth.ts#L11-L59] — the two `removeQueries` insertion points
- [Source: apps/desktop/src/hooks/useAccounts.ts#L56-L73] — hook conventions
- [Source: apps/desktop/src/hooks/useAiConfig.ts#L5-L10] — hardcoded-query-key anti-example
- [Source: apps/desktop/src/lib/constants.ts#L59-L65] — `queryKeys` shape
- [Source: apps/desktop/src/lib/types.ts#L656-L667] — IPC type mirrors, `AuthState` union
- [Source: apps/desktop/src/components/income/AddIncomeSourceForm.tsx#L23-L47] — `react-hook-form` conventions with snake_case field names
- [Source: apps/desktop/src/components/settings/CredentialsForm.tsx#L23-L36] — typed error reader for `invoke` rejections
- [Source: apps/desktop/src/locales/__tests__/profile-i18n.test.ts#L10-L65] — the exhaustive `profile.*` key assertion that must be updated
- [Source: apps/desktop/src/locales/en.json#L40-L46, #L61-L62, #L577-L578] — existing `profile.*` block and the reusable `common.save` / `toast.*` keys

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → **375 passed; 0 failed** (baseline 352 + 23 new: 16 `profile_store`, 6 `current_subject`, 1 `profiles_dir`). All five `maintenance::catalog` tests pass unchanged after the `write_json_atomic` move, and all pre-existing `commands::auth` tests pass unchanged after the `resolve_session` refactor.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` → **1 warning, pre-existing and unrelated**: `explicit_auto_deref` at `commands/backup.rs:106`, introduced by commit `c983604` (2026-08-04). `commands/backup.rs` is on this story's "deliberately not touched" list and the line sits in the `restore_from_file` call path, so it was left alone. Every file this story added or modified produces **zero** clippy warnings and zero rustc warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → clean, no output.
- `pnpm --filter @nixus/desktop test` → **155 passed (10 files)**; `profile-i18n.test.ts` 25 passed. `en.json` and `fr.json` are 1196 keys each (1193 + 3), parity verified programmatically.
- `pnpm --filter @nixus/desktop exec playwright test` → **366 passed; 0 failed** (baseline 357, +9 from this story).

### Completion Notes List

All 13 AC blocks and all 12 tasks are implemented. Notes on the decisions that were not purely mechanical:

- **`current_subject` gained a pure seam.** `current_subject()` is `resolve_session().await?` piped into a new private `subject_from_resolved(ResolvedSession)`. The keyring makes `current_subject` itself untestable, so the branch logic Task 2 asks to test lives in the pure half. `get_auth_session` was rewritten as a single `match` over `ResolvedSession` and all four `info!` strings are byte-identical to before.
- **`#[allow(dead_code)]` on `IdTokenClaims::sub` retired** along with its stale `WHY` comment, per Task 2 / project rule 9.
- **`#[allow(clippy::too_many_arguments)]` on `save_user_profile`.** Eight parameters is one over clippy's default threshold. The signature is architecture D4's and is deliberately flat-scalar (matching `commands/account.rs`), so the lint is suppressed at the one site rather than the signature being reshaped into a struct parameter. This is a variance not anticipated by the story.
- **`load_profile` distinguishes "absent" from "unreadable".** `ErrorKind::NotFound` is `Ok(None)`; any other IO error (e.g. a permissions fault) is `AppError::File`. Silently swallowing a permissions error as "no profile" would let a subsequent save overwrite a document the process merely could not read.
- **`profile.saving` added to `ELLIPSIS_KEYS`** as well as `REQUIRED_KEYS`, and the existing consumer-list comment in `profile-i18n.test.ts` was extended to name `ProfileForm.tsx`.
- **`tests/profile.spec.ts` was modified, and this was unavoidable.** Story 28.1's spec contains `reaching /profile requests no profile data`, which asserts `get_user_profile` is *never* invoked. AC1 requires exactly the opposite once the form ships. The test was not weakened — it was **split into two stronger tests**: one asserting `get_user_profile` *is* requested while `get_countries` / `get_subdivisions` (Epic 29) still are not, and a new `the account dropdown itself requests no profile data` that pins the `project-context.md:295` invariant directly on the always-mounted `ProfileMenu`. `setupTauriMock` also gained `get_user_profile` / `save_user_profile` cases. No other spec was touched, and no assertion was removed or relaxed.
- **Manual verification of AC2/AC10 (quit-relaunch and same-account sign-out/sign-in) was not performed** — it needs a real Cognito session and a built Tauri binary, neither available in this environment. The behaviour is covered structurally instead: `save_then_load_round_trips` proves durability across process boundaries (the document is read back from disk, not from memory), `sign_out` was verified untouched, and nothing on the sign-out path references `profile_store` (`delete_all_profiles` ships with no caller). Flagged rather than claimed.

Constraint audit (Task 12), all confirmed by inspection:

- `src-tauri/migrations/` — no new file. `db/mod.rs` `MIGRATIONS` — unchanged. `db/danger_zone.rs` `WIPE_TABLES` / `PRESERVED_TABLES` — unchanged. `db/backup.rs`, `commands/backup.rs`, `commands/danger_zone.rs`, `db/audit.rs` — unchanged.
- No `insert_audit_log` call added; `commands/profile.rs` takes no `State<DbState>`.
- `error.rs` unchanged — no new `AppError` variant.
- `Cargo.toml` and every `package.json` unchanged — no new crate, no new npm package.
- `keyring_core::Entry` appears nowhere outside `credentials.rs` (verified by grep over `src-tauri/src`).
- `ProfileMenu.tsx`, `TopBar`, and every other always-mounted component gained no `invoke()` call — now pinned by a test.
- No `as any`, `@ts-ignore`, or `@ts-expect-error` introduced. No `.unwrap()` outside `#[cfg(test)]`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` not modified by this story.

### File List

New:

```
apps/desktop/src-tauri/src/json_store.rs
apps/desktop/src-tauri/src/profile_store.rs
apps/desktop/src-tauri/src/commands/profile.rs
apps/desktop/src/hooks/useProfile.ts
apps/desktop/src/components/profile/ProfileForm.tsx
```

Modified:

```
apps/desktop/src-tauri/src/lib.rs
apps/desktop/src-tauri/src/commands/mod.rs
apps/desktop/src-tauri/src/commands/auth.rs
apps/desktop/src-tauri/src/maintenance/catalog.rs
apps/desktop/src-tauri/src/models/mod.rs
apps/desktop/src/lib/constants.ts
apps/desktop/src/lib/types.ts
apps/desktop/src/hooks/useAuth.ts
apps/desktop/src/routes/profile.tsx
apps/desktop/src/locales/en.json
apps/desktop/src/locales/fr.json
apps/desktop/src/locales/__tests__/profile-i18n.test.ts
apps/desktop/tests/profile.spec.ts
```

