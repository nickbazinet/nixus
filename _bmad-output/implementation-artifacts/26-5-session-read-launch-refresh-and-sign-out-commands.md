---
baseline_commit: 9b45411e5d22d41705bd90eac8b78cf45e7c2238
---

# Story 26.5: Session Read, Launch Refresh & Sign-Out Commands

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my session restored automatically when I reopen nixus, to be told plainly when it has expired, and to be able to sign out,
so that staying signed in is effortless and signing out is complete.

## Acceptance Criteria

1. **No session → `LoggedOut`.** Given the `get_auth_session` command, when it is invoked and no session is stored, then it returns `AuthState::LoggedOut` — not an error. [Source: epics-login.md#Story 26.5]

2. **Valid session → `LoggedIn` from JWT claims.** Given a stored session whose `expires_at` is still in the future, when `get_auth_session` is invoked, then it returns `AuthState::LoggedIn { email, name }` with values read from the `id_token` JWT claims **at request time** — no `GetUser` API call, no separate persistence of profile fields; and the `sub` claim is parsed and available as the durable identity key without any cloud/sync/notification infrastructure being introduced. [Source: epics-login.md#Story 26.5 (FR3 data source, NFR4); architecture-login.md#Authentication & Security]

3. **Expired session → refresh in place → `LoggedIn`.** Given a stored session whose access/id token has expired, when `get_auth_session` is invoked on app launch, then Rust `POST`s to `/oauth2/token` with `grant_type=refresh_token` and, on success, updates the existing `nixus-auth` keyring entry **in place** via `credentials.rs::store_cognito_session` and returns `AuthState::LoggedIn`. [Source: epics-login.md#Story 26.5; architecture-login.md#Authentication & Security "Session refresh"]

4. **Refresh failure → `SessionExpired`, never a hard error.** Given the refresh call fails or the refresh token is rejected/expired, when `get_auth_session` resolves, then it returns `AuthState::SessionExpired` (never a hard error that blocks app startup) so the UI can explicitly tell the user to sign in again (Story 27.3); and every non-auth feature of the app remains fully usable (NFR1). [Source: epics-login.md#Story 26.5; architecture-login.md#Authentication & Security "Session refresh failure"]

5. **Launch-only refresh — no polling.** Given the local-first, no-unnecessary-network posture, when the app is running, then the session is refreshed only on launch via `get_auth_session` — no polling loop, no background timer, no refresh scheduled from `lib.rs` `setup()`. [Source: epics-login.md#Story 26.5; architecture-login.md#Process Patterns "Session refresh timing"]

6. **Offline → bounded time → `SessionExpired`.** Given the machine is offline, when `get_auth_session` is invoked with a stored session, then the command returns within a bounded time (an explicit network timeout is applied, not an indefinite hang) and resolves to `SessionExpired` rather than hanging app startup. [Source: epics-login.md#Story 26.5]

7. **`sign_out` clears local state only.** Given the `sign_out` command, when invoked, then it calls `credentials.rs::clear_cognito_session`, discards any in-memory auth state left over from a pending login attempt, and returns `Ok(())`; and Cognito's `/oauth2/revoke` is **not** called (explicitly deferred for v1), and the Cognito hosted sign-out URL (`nixus://auth/signout`) is **not** opened. [Source: epics-login.md#Story 26.5; architecture-login.md#Authentication & Security "Sign-out", #Deferred Decisions]

8. **Post-sign-out state is clean.** Given `sign_out` completed, when `get_auth_session` is invoked afterwards, then it returns `AuthState::LoggedOut`, and no `nixus-auth` keyring entry remains on the system. [Source: epics-login.md#Story 26.5]

9. **Commands registered.** Given the new commands, when registered, then `get_auth_session` and `sign_out` join `start_login` and `handle_auth_callback` in `lib.rs`'s `tauri::generate_handler!` macro. [Source: epics-login.md#Story 26.5; docs/project-context.md#Tauri IPC "Register every new command in lib.rs"]

10. **No SQLite work.** Given no SQLite work is in scope for this feature, when this story completes, then no migration file, no `db/` module, and no new table has been added; neither command takes `State<DbState>` and neither writes an audit-log row. [Source: epics-login.md#Story 26.5; architecture-login.md#Structure Patterns]

11. **No token value is logged.** *(Derived — carries Story 26.4's logging rule into the refresh path, which handles the same token material.)* Given the refresh exchange runs, when any tracing statement executes, then no access, id, or refresh token value appears in `nkbaz-finance.log`; only the resolved `AuthState` variant name, HTTP status codes, and error `Display` strings are logged. [Source: epics-login.md#Story 26.4 (final AC); architecture-login.md#NFR2]

12. **Corrupt inputs surface as recoverable `AppError::Auth`, never a panic.** *(Derived — closes the gap between Story 26.2's malformed-JSON contract and Story 27.1's error-state contract.)* Given the keyring entry contains malformed JSON, or the stored `id_token` is not a decodable three-segment JWT, or the decoded claims lack `email`, when `get_auth_session` is invoked, then it returns `AppError::Auth { recoverable: true, .. }` with a user-presentable message and never panics; the frontend surfaces this through standard TanStack Query error state (Story 27.1) without blanking the app shell. [Source: epics-login.md#Story 26.2 (malformed JSON AC), #Story 27.1 (final AC); docs/project-context.md#Tauri IPC "never panic"]

13. **Zero new dependencies.** Given the existing dependency graph, when this story completes, then no crate has been added to `apps/desktop/src-tauri/Cargo.toml` — the refresh exchange uses the already-present `reqwest`, and JWT claim extraction uses the already-present `base64` + `serde_json`. No JWT library (`jsonwebtoken`, `jwt`, `jwt-simple`) and no `aws-sdk-cognitoidentityprovider` is added. [Source: architecture-login.md#Technology Additions for This Feature "Explicitly not adding"; epics-login.md#Additional Requirements]

## Tasks / Subtasks

- [x] **Task 1: Verify upstream story dependencies are merged before writing any code (AC: all)**
  - [x] Confirm `apps/desktop/src-tauri/src/models/mod.rs` contains `CognitoSession { access_token, id_token, refresh_token, expires_at: i64 }` and `AuthState` (`LoggedOut | LoggedIn { email: String, name: Option<String> } | SessionExpired`) with `#[serde(tag = "status")]` — from Story 26.2.
  - [x] Confirm `apps/desktop/src-tauri/src/error.rs` contains `AppError::Auth { message: String, recoverable: bool }` **and** that the variant is handled in both the `Display` impl and the manual `Serialize` impl (the `Serialize` impl is an exhaustive `match` — a missing arm is a compile error, a missing `Display` arm too). From Story 26.2.
  - [x] Confirm `apps/desktop/src-tauri/src/credentials.rs` exposes `store_cognito_session(&CognitoSession) -> Result<(), AppError>`, `load_cognito_session() -> Result<Option<CognitoSession>, AppError>`, `clear_cognito_session() -> Result<(), AppError>` — from Story 26.2.
  - [x] Read `apps/desktop/src-tauri/src/commands/auth.rs` (created by Story 26.4) end to end and record: the exact names of the Cognito config constants (domain, client id, region) and the token-endpoint URL builder, and the exact shape/location of the pending-login in-memory store (managed Tauri state vs. module-level `OnceLock`/`static`).
  - [x] If any of the above is missing, **stop and report blocked**. Do not stub, re-declare, or duplicate anything from 26.1–26.4.

- [x] **Task 2: Reuse Cognito config and build a timeout-bounded HTTP client (AC: 3, 6, 13)**
  - [x] Reuse the existing Story 26.4 constants/URL builder for the token endpoint (`https://<domain>.auth.<region>.amazoncognito.com/oauth2/token`) and `client_id`. Do **not** introduce a second copy of the domain/region/client-id constants.
  - [x] Build the refresh HTTP client with an explicit timeout: `reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build()`, mapping a builder failure to `AppError::Auth { recoverable: true, .. }`.
  - [x] Do **not** add any crate to `Cargo.toml`.

- [x] **Task 3: Add pure, unit-testable helper functions in `commands/auth.rs` (AC: 2, 3, 11, 12)**
  - [x] `fn is_session_expired(expires_at: i64, now_unix: i64) -> bool` returning `now_unix >= expires_at`. Take `now_unix` as a parameter (do **not** call `Utc::now()` inside) so it is testable.
  - [x] Private `#[derive(Debug, Clone, Deserialize)] struct IdTokenClaims { email: Option<String>, name: Option<String>, sub: String }` and `fn decode_id_token_claims(id_token: &str) -> Result<IdTokenClaims, AppError>`: split on `'.'`, require exactly 3 segments, decode segment index 1 with `base64::engine::general_purpose::URL_SAFE_NO_PAD`, then `serde_json::from_slice`. Any failure → `AppError::Auth { recoverable: true, .. }`.
  - [x] Private `#[derive(Debug, Deserialize)] struct TokenRefreshResponse { access_token: String, id_token: String, refresh_token: Option<String>, expires_in: i64 }` and `fn merge_refreshed_session(previous: &CognitoSession, response: TokenRefreshResponse, now_unix: i64) -> CognitoSession` that **preserves `previous.refresh_token` when `response.refresh_token` is `None`** and sets `expires_at = now_unix + response.expires_in`.
  - [x] Annotate `IdTokenClaims::sub` with `#[allow(dead_code)]` plus a one-line WHY comment (parsed per NFR4 as the durable identity key; not yet surfaced through `AuthState`) — required to keep the build warning-free.

- [x] **Task 4: Implement `get_auth_session` (AC: 1, 2, 3, 4, 5, 6, 10, 11, 12)**
  - [x] Signature: `#[tauri::command(rename_all = "snake_case")] pub async fn get_auth_session() -> Result<AuthState, AppError>` — no `State<DbState>`, no `AppHandle`.
  - [x] `credentials::load_cognito_session()?` → `None` ⇒ `Ok(AuthState::LoggedOut)`; `Err` ⇒ propagate (AC 12).
  - [x] Not expired ⇒ decode claims from the stored `id_token` and return `LoggedIn { email, name }`.
  - [x] Expired ⇒ `POST` form body `grant_type=refresh_token`, `client_id`, `refresh_token` (no `redirect_uri`, no `code_verifier`, no client secret) via `.form(&[...])`; on 2xx build the merged session, persist with `credentials::store_cognito_session`, decode claims from the **new** `id_token`, return `LoggedIn`.
  - [x] Transport error / timeout / non-2xx / unparseable token response ⇒ `tracing::error!` (status + error `Display` only) and return `Ok(AuthState::SessionExpired)`. **Do not** clear the keyring entry on refresh failure.
  - [x] Do not add any launch-time refresh call in `lib.rs` `setup()`, any `tauri::async_runtime::spawn` refresh loop, or any timer (AC 5).

- [x] **Task 5: Implement `sign_out` (AC: 7, 8)**
  - [x] Signature: `#[tauri::command(rename_all = "snake_case")] pub fn sign_out(/* pending-login state param iff Story 26.4 uses managed state */) -> Result<(), AppError>` — synchronous; it performs no network I/O.
  - [x] Call `credentials::clear_cognito_session()?` (idempotent per Story 26.2).
  - [x] Reset the Story 26.4 pending-login store to its empty value using the shape discovered in Task 1. Do not create a second store.
  - [x] Do not call `/oauth2/revoke` and do not open `nixus://auth/signout` or any hosted-UI logout URL.

- [x] **Task 6: Register both commands in `lib.rs` (AC: 9)**
  - [x] Add `commands::auth::get_auth_session,` and `commands::auth::sign_out,` to `tauri::generate_handler!` immediately after the Story 26.4 entries, keeping all four auth commands contiguous.
  - [x] Confirm `pub mod auth;` already exists in `apps/desktop/src-tauri/src/commands/mod.rs` (added by Story 26.4); add it only if absent.

- [x] **Task 7: Add Rust unit tests for the pure helpers (AC: 2, 3, 12)**
  - [x] Append/extend `#[cfg(test)] mod tests { use super::*; ... }` at the bottom of `commands/auth.rs`, matching the repo-wide idiom.
  - [x] Cover: expiry boundary (`now < expires_at` → not expired; `now == expires_at` and `now > expires_at` → expired); claims decode happy path from a hand-built unpadded base64url token; decode rejects a 2-segment string; decode rejects non-base64url garbage; decode rejects valid-base64-but-not-JSON; claims with `name` absent yield `None`; `merge_refreshed_session` preserves the previous `refresh_token` when the response omits it; `merge_refreshed_session` adopts a rotated `refresh_token` when present; `expires_at` equals `now_unix + expires_in`.
  - [x] Do **not** write tests that touch the network or the OS keyring — no test in this repo does, and no mocking crate is available.

- [x] **Task 8: Verify and close out (AC: all)**
  - [x] `cd apps/desktop/src-tauri && cargo test auth` — all new tests pass.
  - [x] `cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings` and `cargo check` — zero warnings.
  - [ ] Manual: temporarily add a `useEffect(() => { invoke("get_auth_session").then(console.log) }, [])` scratch call in a mounted component, run `pnpm --filter @nkbaz/desktop tauri dev`, and confirm the three observable states — (a) never signed in ⇒ `{ status: "LoggedOut" }`; (b) after a Story 26.4 sign-in ⇒ `{ status: "LoggedIn", email, name }`; (c) Wi-Fi off with a session whose `expires_at` was hand-set into the past ⇒ `{ status: "SessionExpired" }` returned in under ~10s. Then invoke `sign_out` and confirm `LoggedOut` plus no `nixus-auth` entry in Keychain Access. **NOT PERFORMED — requires an interactive GUI session (see Completion Notes).**
  - [x] **Revert the scratch `invoke` call** — `window.__TAURI__` is unavailable (`withGlobalTauri` is not enabled), which is why the temporary call is needed; it must not be committed. **N/A — no scratch call was ever added; zero frontend files were touched.**
  - [ ] Inspect `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log` and confirm no token substring appears. **NOT PERFORMED — the log file does not exist on this machine (see Completion Notes); verified by source inspection instead.**
  - [x] Confirm `git status` shows no new file under `src-tauri/src/db/`, no migration, and no `Cargo.toml` diff.

## Dev Notes

### Scope boundary

This story is **Rust-only** and adds no user-visible surface. It completes the Epic 26 IPC contract that Epic 27 consumes. There is **no Playwright work here** — auth E2E coverage is Story 27.4's deliverable, and with no UI mounted yet there is nothing for a spec to assert. [Source: epics-login.md#Story 27.4, #Epic List "Why two epics"]

### Hard dependency on Stories 26.1–26.4 (may not exist as files yet)

Stories 26.1–26.4 are being authored in parallel and their story files may be absent; `epics-login.md` is the authority for their contracts. This story **depends on all four** and cannot be implemented in isolation:

| Upstream | What it must have delivered | What 26.5 consumes |
|---|---|---|
| **26.1** — Cognito pool & public app client | User Pool, public client (no secret), PKCE `S256`, refresh-token rotation **disabled**, scopes `openid email profile`, hosted domain, Google social IdP; domain/client-id/region recorded as non-secret build-time config | The live `/oauth2/token` endpoint; `email`/`name`/`sub` present in `id_token`; rotation-off means the refresh response omits `refresh_token` |
| **26.2** — Models, error variant, keyring storage | `CognitoSession`, `AuthState`, `AppError::Auth`, and the three `credentials.rs` session functions | Every type and every storage call in this story |
| **26.3** — Deep-link + single-instance plugins | `nixus://` capture routed into the running process | Nothing directly; it is what makes a *fresh* sign-in possible so a session exists to refresh |
| **26.4** — PKCE launch & callback exchange | `commands/auth.rs` module, Cognito config constants + token-URL builder, the pending-login in-memory store, `auth:callback-received` event | The config constants and URL builder (reuse, never re-declare); the pending-login store (which `sign_out` must clear) |

**If Story 26.2 or 26.4 is not merged, this story is blocked — report it rather than stubbing.** Creating a local `CognitoSession`, a second set of Cognito constants, or a private keyring call would violate the single-source and sole-accessor boundaries below.

### Non-negotiable boundaries (violations are review failures)

- **Keyring sole accessor.** `credentials.rs` is the only module allowed to touch a keyring entry. Call `store_cognito_session` / `load_cognito_session` / `clear_cognito_session`. Never `keyring::Entry` / `keyring_core::Entry` from `commands/auth.rs`. Note the existing file imports `keyring_core::{Entry, Error}` (not `keyring::Entry`) — the architecture doc's `keyring::Entry` wording refers to the same concept. [Source: architecture-login.md#Implementation Patterns "Correction to prior decision", #Enforcement Guidelines; credentials.rs:1]
- **Rust-only token exchange.** The refresh `POST` happens exclusively in `commands/auth.rs`. Nothing about it moves to the webview. [Source: architecture-login.md#Architectural Boundaries]
- **One error type.** Extend nothing; use `AppError::Auth`. No parallel auth error enum. [Source: architecture-login.md#Enforcement Guidelines]
- **No second Cognito HTTP call site.** `commands/auth.rs` is the only module that calls Cognito REST endpoints. [Source: architecture-login.md#Architectural Boundaries]

### `get_auth_session` decision table (implement exactly this)

| Stored session | Token state | Network | Result |
|---|---|---|---|
| absent (`Ok(None)`) | — | — | `Ok(AuthState::LoggedOut)` |
| present | `now_unix < expires_at` | not touched | `Ok(LoggedIn { email, name })` from stored `id_token` claims |
| present | expired | refresh 2xx | persist merged session → `Ok(LoggedIn { .. })` from the **new** `id_token` |
| present | expired | refresh non-2xx (e.g. `400 invalid_grant`) | `Ok(SessionExpired)` — keyring entry **left in place** |
| present | expired | transport error / timeout (offline) | `Ok(SessionExpired)` — keyring entry **left in place** |
| load returned `Err` (malformed JSON) | — | — | propagate `AppError::Auth { recoverable: true }` |
| present | `id_token` undecodable or `email` claim missing | — | `AppError::Auth { recoverable: true }` |

Deliberate consequences to preserve, not "fix":

- **Never clear the keyring on refresh failure.** An offline launch must still be able to refresh successfully on a later online launch. `sign_out` is the *only* path that removes the entry, which is exactly why AC 8 pairs "after `sign_out`" with `LoggedOut`. A refreshed-but-rejected session therefore reports `SessionExpired` on every launch until the user signs in again (overwriting the entry) or signs out. Story 27.3 gives them that affordance. [Source: epics-login.md#Story 26.5, #Story 27.3]
- **"Refresh once on launch" is emergent, not flagged.** The network is touched only when `now_unix >= expires_at`, so later invalidations (the `auth:callback-received` event, a `sign_out` invalidation) re-read the keyring without a network call. Do **not** add a `has_refreshed` boolean, a launch guard, or a cached `AuthState` in memory. [Source: architecture-login.md#Process Patterns]
- **Concurrent invocations need no locking.** With refresh-token rotation disabled (Story 26.1), two overlapping refreshes are harmless — both use the same still-valid refresh token and both write an equivalent entry. Do not add a mutex, semaphore, or in-flight dedup.
- **`expires_at` is the single source of truth for expiry.** Do not read the `exp` claim out of the JWT to decide expiry; that would create two competing sources. Claims are read for `email` / `name` / `sub` only.
- **No clock-skew buffer.** Expiry is literally `now_unix >= expires_at`, matching AC 2's "still in the future". Tokens are used only for local claim reads in v1, so near-expiry is harmless; introducing a 60s early-refresh window would contradict AC 2.

### Cognito refresh contract (rotation disabled per Story 26.1)

```
POST https://<domain>.auth.<region>.amazoncognito.com/oauth2/token
Content-Type: application/x-www-form-urlencoded   (set automatically by reqwest .form())

grant_type=refresh_token&client_id=<client_id>&refresh_token=<stored refresh_token>
```

- **No** `redirect_uri`, **no** `code_verifier`, **no** client secret (public client).
- 2xx body: `{ access_token, id_token, expires_in, token_type }` — **`refresh_token` is absent** because rotation is off. `merge_refreshed_session` must carry the previous one forward; dropping it silently bricks all future refreshes. This is the single most likely defect in this story.
- Rejected/expired refresh token: `400` with `{"error":"invalid_grant"}` → `SessionExpired`, not an `AppError`.

### JWT claim extraction (no JWT crate)

`id_token` is `header.payload.signature`, base64url-encoded **without padding**.

- Use `base64::engine::general_purpose::URL_SAFE_NO_PAD`. Do **not** copy the `STANDARD` engine used in `commands/import.rs:84` — it rejects the `-` and `_` characters that appear in base64url and will fail on real Cognito tokens.
- `use base64::Engine;` is required to bring the `decode` method into scope (same as `commands/import.rs:10`).
- **Signature is not verified**, by design: the token was obtained by this app directly from Cognito over TLS (Story 26.4) and stored in the OS keyring, and no authorization decision is made from these claims — they populate a display-only profile panel. Do not add signature verification or a JWKS fetch; that would add a dependency (AC 13) and network I/O this story explicitly avoids. Record this as an accepted decision, not a TODO.
- `serde` ignores unknown JSON fields by default, so `IdTokenClaims` needs only `email`, `name`, `sub`.

### Existing patterns to copy (and the two places this story deviates)

Copy these verbatim in style:

- **Async command shape:** `#[tauri::command(rename_all = "snake_case")] pub async fn ... -> Result<T, AppError>` — see `commands/maintenance.rs:315` (`get_vehicle_models`).
- **HTTP failure handling:** inline `.map_err(|e| { tracing::error!("..."); AppError::... })?` plus an explicit `if !response.status().is_success()` branch — see `maintenance/catalog.rs:208-224`. There is **no** `From<reqwest::Error> for AppError` impl and none should be added; `error.rs:92` has only `From<rusqlite::Error>`.
- **Keyring error mapping:** commands map at the call site, e.g. `commands/settings.rs` does `.map_err(|e| AppError::AiService { message: e.to_string(), recoverable: false })?`. Story 26.2's functions already return `AppError`, so 26.5 just uses `?`.
- **Private wire-response structs live next to their usage,** not in `models/mod.rs` — `maintenance/catalog.rs:50-70` defines the private `NhtsaMakesResponse` / `NhtsaModelsResponse` deserialization structs locally. `TokenRefreshResponse` and `IdTokenClaims` therefore belong in `commands/auth.rs`; only the IPC-facing `CognitoSession` / `AuthState` live in `models/mod.rs`.
- **Tracing:** `tracing::error!` on every failure branch, logging error `Display` and HTTP status only. `credentials.rs` and `commands/settings.rs` never log secret material — hold that line (AC 11).

Deliberate deviations, both required by the ACs:

1. **Explicit `reqwest` timeout.** Every existing call site uses bare `reqwest::Client::new()` with **no timeout** (`maintenance/catalog.rs:210,250`). AC 6 requires a bounded response, so this story is the first to use `reqwest::Client::builder().timeout(...)`. This is an intentional improvement, not a style break — do not "align" it back to `Client::new()`.
2. **`expires_at: i64` is a Unix epoch-seconds integer.** `docs/project-context.md#Rust Model Structs` says date fields are ISO-8601 `String`s, but `epics-login.md#Story 26.2` explicitly specifies `expires_at: i64`. The epics win: it is a timestamp for arithmetic, not a displayed date. Do not convert it to a `String`. Compute with `chrono::Utc::now().timestamp()` (chrono is already a direct dependency).

### Anti-patterns for this story (do not do these)

- Adding `jsonwebtoken`, `jwt`, `oauth2`, `aws-sdk-cognitoidentityprovider`, or any other crate.
- Calling `keyring_core::Entry` / `keyring::Entry` from `commands/auth.rs`.
- Re-declaring the Cognito domain / client id / region / token URL that Story 26.4 already defines.
- Clearing the keyring entry when a refresh fails.
- Adding a refresh call, `tauri::async_runtime::spawn`, or timer in `lib.rs` `setup()`.
- Caching `AuthState` in a `static`/managed state, or adding a `has_refreshed` flag.
- Taking `State<DbState>`, writing an audit-log row, or adding a migration — the "audit log on every mutation" rule in `docs/project-context.md#3` applies to financial-data DB writes; auth performs none.
- Returning `Err(...)` for the offline or rejected-refresh paths (must be `Ok(SessionExpired)`).
- Adding `#[serde(rename_all = "snake_case")]` to `AuthState` (see Project Structure Notes).
- Calling `/oauth2/revoke`, wiring `nixus://auth/signout`, or enabling refresh-token rotation.
- Leaving the Task 8 scratch `invoke` call in the frontend.
- `.unwrap()` / `.expect()` / `panic!` on any input path.

### Testing standards

`docs/project-context.md#Testing Rules` says "no unit test framework in desktop", which is **out of date for the Rust side**: `src-tauri` contains ~271 `#[test]` functions across 25 modules. The enforced convention is:

- `#[cfg(test)] mod tests { use super::*; ... }` at the bottom of the same file (25/25 modules use this exact idiom).
- Descriptive snake_case test names that read as the assertion — e.g. `refresh_without_rotation_preserves_previous_refresh_token`. **No `test_` prefix.**
- Plain `#[test]` only. There are zero `#[tokio::test]` tests and no mocking crates (`mockito`/`wiremock`/`httpmock` are absent) — which is exactly why Task 3 pushes the logic into synchronous pure helpers instead of testing `get_auth_session` directly.
- No test in this repo touches the network or the OS keyring; `credentials.rs` and `ai/*` have no test modules at all. Keep it that way — the network/keyring branches are covered by the Task 8 manual matrix.

`cargo test`, `cargo clippy`, and `cargo check` are **not** in CI (`.github/workflows/release.yml` builds/signs only; `web-ci.yml` is scoped to `apps/web` + `packages/shared`). The zero-warning rule from `docs/guidelines/warnings.md` and `docs/project-context.md#9` is therefore procedural — run the gates in Task 8 manually.

### Project Structure Notes

Files touched — exactly three, all pre-existing after Story 26.4:

```
apps/desktop/src-tauri/src/
├── lib.rs                 # MODIFIED: + commands::auth::get_auth_session, + commands::auth::sign_out in generate_handler!
└── commands/
    ├── mod.rs             # VERIFY ONLY: `pub mod auth;` should already exist (Story 26.4)
    └── auth.rs            # MODIFIED: + get_auth_session, + sign_out, + pure helpers, + #[cfg(test)] mod tests
```

No new file is created by this story. `models/mod.rs`, `error.rs`, `credentials.rs`, `Cargo.toml`, `tauri.conf.json`, and `capabilities/default.json` are all **already final** after Stories 26.2/26.3 — touching them here signals a boundary violation. This matches the delta tree in `architecture-login.md#Delta to Existing Project Tree` exactly.

Alignment and variances:

- **Aligned:** `commands/{feature}.rs` one-file-per-feature; command registration in `lib.rs`; `snake_case` IPC; `Result<T, AppError>`; feature-local private wire structs.
- **Variance (accepted):** `expires_at: i64` instead of the ISO-8601 `String` date convention — see "Deliberate deviations" above.
- **Variance (accepted):** explicit `reqwest` timeout, unlike the existing untimed `Client::new()` call sites — see "Deliberate deviations" above.
- **Variance (accepted, owned by Story 26.2 but load-bearing here):** `AuthState` uses `#[serde(tag = "status")]` with **PascalCase variant names in the tag value** (`"LoggedOut"`, `"LoggedIn"`, `"SessionExpired"`). It is the first internally-tagged enum in the codebase; the two existing serialized enums (`maintenance/evaluator.rs:7` `TaskStatus`, `financial_health/evaluator.rs:6` `WaterfallStep`, `models/mod.rs:459` `EmergencyFundStatus`) all use `#[serde(rename_all = "snake_case")]`. Adding `rename_all` here would emit `"logged_in"` and break the discriminated union Story 27.1 defines (`{ status: "LoggedIn"; ... }`). Verify during Task 1 and do not "normalize" it.
- **Manual-verification constraint:** `withGlobalTauri` is not enabled in `tauri.conf.json`, so `window.__TAURI__` does not exist and these commands cannot be exercised from devtools. The Task 8 scratch `invoke` is the sanctioned workaround and must be reverted.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.5: Session Read, Launch Refresh & Sign-Out Commands] — all ten primary acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.1: Cognito User Pool & Public App Client Setup] — public client, no secret, rotation disabled, `openid email profile` scopes, sign-out URL exists but is unused in v1
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.2: Auth Models, Error Variant & Secure Session Storage] — `CognitoSession`/`AuthState` shapes, `AppError::Auth`, the three `credentials.rs` functions, `Ok(None)` and malformed-JSON contracts
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.4: PKCE Login Launch & Callback Token Exchange] — `commands/auth.rs` origin, Cognito config constants, pending-attempt in-memory store, `auth:callback-received`, no-token-logging rule
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.1: Frontend Auth Session Hook & Query Key] — `AuthState` TS discriminated union; `AppError::Auth` surfaces as TanStack Query error state
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.3: Header Profile Menu & Minimalist Profile View] — `SessionExpired` is explicitly communicated to the user; `name`-absent degrades to email-only
- [Source: _bmad-output/planning-artifacts/epics-login.md#Additional Requirements] — no AWS SDK, no SQLite, keyring sole-accessor, IPC surface list, refresh-on-launch, sign-out scope
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security] — token storage shape, `grant_type=refresh_token` on launch, in-place keyring update, explicit expiry notification, sign-out clears keyring only, `id_token` claims as the profile data source
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Implementation Patterns & Consistency Rules] — the `credentials.rs` sole-accessor correction and `commands/auth.rs` orchestration-only role
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Process Patterns] — refresh checked once on launch, never polled
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Architectural Boundaries] — Cognito REST only from `commands/auth.rs`; tokens never in SQLite or webview storage
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Deferred Decisions] — `/oauth2/revoke` and refresh-token rotation explicitly out of scope
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Delta to Existing Project Tree] — the three-file footprint for this story
- [Source: docs/project-context.md#2 Tauri IPC Commands] — `rename_all = "snake_case"`, `Result<T, AppError>`, never panic, register in `lib.rs`
- [Source: docs/project-context.md#5 Error Handling (AppError)] — reuse `AppError`, `recoverable: bool` semantics
- [Source: docs/project-context.md#9 Compilation Warnings Policy] — zero warnings; `#[allow(dead_code)]` only for soon-to-be-used code
- [Source: docs/guidelines/warnings.md] — compilation warning policy referenced by CLAUDE.md
- [Source: apps/desktop/src-tauri/src/credentials.rs:1-3] — `keyring_core::{Entry, Error}`, `KEYRING_SERVICE = "nkbaz-finance"` (the auth entry uses service `nixus-auth` per Story 26.2)
- [Source: apps/desktop/src-tauri/src/error.rs:4-13,31-90,92-98] — `AppError` variants, exhaustive manual `Serialize` match, only `From<rusqlite::Error>`
- [Source: apps/desktop/src-tauri/src/lib.rs:92-188] — `generate_handler!` list; insertion point for the auth commands
- [Source: apps/desktop/src-tauri/src/commands/maintenance.rs:315-325] — async Tauri command reference shape
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs:50-70,208-224,245-267] — private local wire-response structs; untimed `Client::new()` at lines 210 and 250; inline `.map_err` + `status().is_success()` error handling
- [Source: apps/desktop/src-tauri/src/commands/import.rs:10,83-85] — `use base64::Engine;` and engine-based decode (note: `STANDARD`, not the `URL_SAFE_NO_PAD` this story needs)
- [Source: apps/desktop/src-tauri/src/models/mod.rs:459-460, maintenance/evaluator.rs:7-8, financial_health/evaluator.rs:6-7] — existing enums all use `rename_all = "snake_case"`; `AuthState` intentionally does not
- [Source: apps/desktop/src-tauri/Cargo.toml:20-44] — `reqwest 0.12` (`json`, `rustls-tls`, `default-features = false`), `base64 0.22`, `serde_json 1`, `chrono 0.4`, `keyring 4`, `keyring-core 1` all already present; no JWT crate
- [Source: apps/desktop/src-tauri/tauri.conf.json:3-5] — `productName` `Nixus`, identifier `com.nbazinet.nkbaz-finance` (log path); `withGlobalTauri` absent

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

**Task 1 — upstream dependency gate: PASS (all four stories merged).** Recorded facts:

| Surface | Verified |
|---|---|
| `models/mod.rs:736-758` | `CognitoSession { access_token, id_token, refresh_token: String, expires_at: i64 }`; `AuthState` with `#[serde(tag = "status")]`, PascalCase tags, `LoggedIn { email: String, name: Option<String> }`. No `rename_all`. |
| `error.rs:9,22,64` | `AppError::Auth { message, recoverable }` present in the enum, the `Display` impl, **and** the hand-written exhaustive `impl Serialize`. |
| `credentials.rs:72,87,110` | All three session functions present; keyring service `nixus-auth`, account `cognito-session`, via the private `auth_entry()`. |
| `commands/auth.rs` (716 lines, read end to end) | Consts: `COGNITO_REGION`, `COGNITO_CUSTOM_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_HOSTED_UI_BASE_URL` (`https://auth.nixusapp.com`), `COGNITO_REDIRECT_URI`, `COGNITO_SIGNOUT_URI`, `COGNITO_SCOPES`, `TOKEN_EXCHANGE_TIMEOUT_SECS = 15`. **No `COGNITO_DOMAIN_PREFIX` exists** — 26.1 shipped a CUSTOM domain, so the token endpoint is `format!("{}/oauth2/token", COGNITO_HOSTED_UI_BASE_URL)` (`auth.rs:320`), never composed from prefix + region. Pending-login store = **managed Tauri state** `PendingLogin(pub Mutex<Option<PendingAttempt>>)`, registered at `lib.rs:81` via `app.manage(...)`, reached through the existing `pending_login_state(&AppHandle)` helper (which uses `try_state` to avoid a panic). |
| `lib.rs` | `generate_handler!` had 97 entries; `commands/mod.rs:3` already has `pub mod auth;`. |

**Live endpoint probe (credential-free, no secrets):**

```
$ curl -sS -X POST "https://auth.nixusapp.com/oauth2/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d grant_type=refresh_token -d "client_id=6525109r95las7odvuesf13joj" -d "refresh_token=invalid"
HTTP 400
{"error":"invalid_grant"}
```

Confirms the rejected-refresh shape the story predicted: a `400` with a JSON `error` field, which `refresh_session` maps to `Ok(AuthState::SessionExpired)` (never an `AppError`).

**Gates:**

```
$ cargo check --all-targets
    Checking nkbaz-finance v0.3.2 (/Users/nbazinet/projects/nixus/apps/desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.06s
```

Zero warnings.

```
$ cargo test
test result: ok. 329 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s
(+ main.rs 0 tests, doc-tests 0 tests)

$ cargo test auth
test result: ok. 54 passed; 0 failed; 0 ignored; 0 measured; 275 filtered out; finished in 0.00s
```

308 baseline → **329 passing**, i.e. 21 new tests, 0 failures, 0 regressions.

```
$ cargo clippy --all-targets -- -D warnings
error: deref which would be done by auto-deref
   --> src/commands/backup.rs:106:42
    = note: `-D clippy::explicit-auto-deref` implied by `-D warnings`

$ cargo clippy --all-targets -- -D warnings -A clippy::explicit_auto_deref
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.40s
```

The single clippy finding is **pre-existing and outside this story's footprint**: `commands/backup.rs` is untouched (absent from `git status`, unchanged since `HEAD` `9b45411`). With that one pre-existing lint allowed, clippy is clean across all targets, so **this story introduces zero clippy findings**. Fixing `backup.rs` was deliberately left alone — it is not one of the three files this story owns.

**Boundary verification (source grep):**

- `commands/auth.rs` contains **no** `keyring::Entry` / `keyring_core::Entry` reference (matches only appear inside prose comments); every keyring touch goes through `credentials::{load,store,clear}_cognito_session`.
- No `/oauth2/revoke` call. `COGNITO_SIGNOUT_URI` appears only in its own declaration and in tests — its `#[allow(dead_code)]` and WHY comment are untouched.
- The only `tauri::async_runtime::spawn` in the file is 26.4's deep-link dispatch at line 459 — no timer, no polling loop, nothing added to `lib.rs` `.setup()`.
- `git status` shows no new file under `src-tauri/src/db/`, no migration, and no `Cargo.toml` diff from this story (its diff is 26.3/26.4's `tauri-plugin-deep-link`, `sha2`, `rand`, `tauri-plugin-single-instance` — no JWT crate, no AWS SDK).
- `generate_handler!` now has **99** entries (97 + 2).

### Completion Notes List

**What was built.** Three files touched, exactly as the Project Structure Notes prescribe: `commands/auth.rs` (helpers + two commands + 21 tests), `lib.rs` (two `generate_handler!` lines), `commands/mod.rs` (verify-only — `pub mod auth;` already present, unchanged). Zero frontend files, zero SQLite work, zero new dependencies.

- `is_session_expired(expires_at, now_unix)` — pure, `now_unix` injected. No clock-skew buffer, and the JWT `exp` claim is deliberately never consulted, so `expires_at` stays the single source of truth for expiry.
- `IdTokenClaims` + `decode_id_token_claims` — payload segment only, `URL_SAFE_NO_PAD`, every failure mapped to `AppError::Auth { recoverable: true }`. `sub` is parsed and carried per NFR4 with `#[allow(dead_code)]` + a WHY comment (no consumer surfaces it yet).
- `logged_in_from_id_token` — builds `AuthState::LoggedIn` from claims **at request time**; no profile field is ever persisted separately and no `GetUser` call is made.
- `refresh_form` / `TokenRefreshResponse` / `merge_refreshed_session` — pure and unit-tested.
- `refresh_session` — the only network call, timeout-bounded, returns `Ok(None)` for all four failure modes.
- `get_auth_session` / `sign_out` — the two new `#[tauri::command(rename_all = "snake_case")]` entry points.

**AC coverage.** 1 ✅ `Ok(LoggedOut)` on `Ok(None)`. 2 ✅ claims read at request time; `sub` parsed. 3 ✅ `POST {COGNITO_HOSTED_UI_BASE_URL}/oauth2/token`, merged session written back through `store_cognito_session` (same service+account ⇒ in-place overwrite). 4 ✅ every refresh failure resolves to `Ok(SessionExpired)`. 5 ✅ network touched only when `now >= expires_at`; nothing added to `.setup()`. 6 ✅ explicit `reqwest` timeout. 7 ✅ `clear_cognito_session` + `PendingLogin` reset, no revoke, no hosted sign-out URL. 8 ✅ post-`sign_out` load returns `Ok(None)` ⇒ `LoggedOut`. 9 ✅ 99 handler entries. 10 ✅ no DB surface of any kind. 11 ✅ every new log line emits only an `AuthState` variant name, an HTTP status code, a `sanitize_error_code`d error code, or `e.is_timeout()` as a bare boolean. 12 ✅ four rejection paths → recoverable `AppError::Auth`; zero `unwrap`/`expect`/`panic!` outside `#[cfg(test)]`. 13 ✅ `Cargo.toml` untouched.

**The rotation-off carry-forward (the story's flagged most-likely defect).** `merge_refreshed_session` falls back to `previous.refresh_token` when the response omits **or empties** `refresh_token`. Because `CognitoSession::refresh_token` is a non-optional `String`, persisting `""` would have permanently bricked every later refresh. Three tests lock it: `refresh_without_rotation_preserves_previous_refresh_token`, `an_empty_rotated_refresh_token_falls_back_to_the_previous_one`, and `refresh_with_rotation_adopts_the_rotated_refresh_token` (so re-enabling rotation later is already handled).

**Accepted decisions (not TODOs).**

1. **The `id_token` signature is deliberately not verified and no JWKS is fetched.** The token was obtained by this app directly from Cognito over TLS (Story 26.4) and lives in the OS keyring; no authorization decision is made from these claims — they populate a display-only profile panel. Verification would require a JWT crate and network I/O, both of which AC 13 forbids. This is a closed decision, not deferred work.
2. **`name` legitimately absent.** A live token exchange against this pool returned claims `at_hash, aud, auth_time, cognito:username, email, email_verified, event_id, exp, iat, iss, jti, origin_jti, sub, token_use` — **no `name`**, because `email` is the pool's only required attribute and Google federation is deferred. Absent *and* empty `name` both map to `None`, never to an error or a blank string, so Story 27.3 falls back to email-only.
3. **Reused 26.4's `TOKEN_EXCHANGE_TIMEOUT_SECS` (15s) instead of the Task 2 subtask's literal `from_secs(10)`.** Introducing a second timeout constant for the same endpoint would create two competing budgets; 26.4's const doc comment already says it exists as the precedent for 26.5's launch refresh. AC 6 requires *a* bounded timeout, which 15s satisfies. The 26.4 `exchange_code_for_tokens` body was **not** refactored to share a client builder — that would mean editing reviewed 26.4 code — so the builder pattern is mirrored inline instead.
4. **`TokenRefreshResponse` does not derive `Debug`**, deviating from Task 3's literal `#[derive(Debug, Deserialize)]`. It holds the same bearer-credential material as 26.4's `TokenResponse`, whose missing `Debug` is a reviewed structural defence against token leakage; deriving `Debug` here would have punched a hole in exactly that defence. `IdTokenClaims` **does** derive `Debug` — claims are profile data, not credentials.
5. **`refresh_session` returns `Result<Option<CognitoSession>, AppError>`.** `Ok(None)` covers Task 4's four `SessionExpired` modes (transport, timeout, non-2xx, unparseable body); `Err` is reserved solely for Task 2's HTTP-client-builder failure, which is a local fault rather than a refresh outcome and matches 26.4's precedent of mapping it to `AppError::Auth { recoverable: true }`. This honours both task specs without either swallowing a local fault or turning a network failure into a startup blocker.
6. **`sign_out` takes `AppHandle`, not a `State<'_, PendingLogin>` parameter.** With a `State` parameter, an unmanaged state would fail the command *before* the keyring was cleared — precisely the thing AC 8 checks. Going through 26.4's existing `pending_login_state` helper (`try_state`-based) makes the keyring clear unconditional and the pending-login reset best-effort, and reuses the one store rather than creating a second.
7. **Stale `#[allow(dead_code)]` markers left in place.** `models/mod.rs:751` (`AuthState`) and `credentials.rs:71,86,109` carry "Remove the allow then" comments naming Story 26.5. Those allows are now genuinely stale, but the story's Project Structure Notes declare `models/mod.rs` and `credentials.rs` final after 26.2 and treat touching them as a boundary violation. An unnecessary `allow` emits no warning, so the zero-warning gate is unaffected. **Flagged for a follow-up cleanup rather than actioned here.**

**Not verified — requires a manual GUI step.** Task 8's interactive matrix was **not** performed and is **not** claimed as passing:

- The three observable `get_auth_session` states and the `sign_out` round-trip need `pnpm --filter @nixus/desktop tauri dev` plus a real browser sign-in, a real Keychain entry, and Wi-Fi toggling — none of which is reachable headlessly. No scratch `invoke` was added (zero frontend files touched), so there is also nothing to revert. **Recommend the reviewer run this matrix.** What *was* verified headlessly: the live `400 {"error":"invalid_grant"}` refresh rejection, and 21 unit tests covering every pure branch of the decision table.
- The log-file inspection could not run: `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log` does not exist on this machine (the app has never been launched here). AC 11 was instead verified by exhaustive source inspection of all 8 new logging statements — every one emits only a variant name, an HTTP status code, a sanitized error code, or a bare boolean, and no token binding is ever interpolated.

### File List

- `apps/desktop/src-tauri/src/commands/auth.rs` — MODIFIED: added `AuthState` to the `crate::models` import; added `IdTokenClaims`, `TokenRefreshResponse`, `is_session_expired`, `unreadable_session_error`, `decode_id_token_claims`, `logged_in_from_id_token`, `refresh_form`, `merge_refreshed_session`, `refresh_session`, `get_auth_session`, `sign_out`, and 21 tests inside the existing `#[cfg(test)] mod tests`.
- `apps/desktop/src-tauri/src/lib.rs` — MODIFIED: added `commands::auth::get_auth_session,` and `commands::auth::sign_out,` to `tauri::generate_handler!` (97 → 99 entries).

### Review Findings

Adversarial review of Story 26.5's additions only (`get_auth_session`, `sign_out`, the 5 pure helpers, the 21 new tests, and the 2 `generate_handler!` entries). Stories 26.1/26.3/26.4's code in `commands/auth.rs` was out of scope and not re-reviewed.

**Verdict: NO BLOCKING FINDINGS.** Every acceptance criterion this story owns is implemented as specified and independently verified. All findings below are NON-BLOCKING. This is not a hedged pass — nothing here should stop the story from moving on.

#### BLOCKING

None.

#### NON-BLOCKING

**NB-1 — `refresh_session` accepts an empty-string `id_token` where the 26.4 callback path rejects it.** `apps/desktop/src-tauri/src/commands/auth.rs:490, 575-583, 696-698`
`TokenRefreshResponse.id_token` is a non-optional `String`, so an *absent* `id_token` fails deserialization and correctly resolves to `SessionExpired` (auth.rs:641-654). An *empty* `id_token` (`"id_token": ""`) instead deserializes fine, is merged, and is persisted at auth.rs:696 before `logged_in_from_id_token` rejects it at auth.rs:698. Because the persisted entry then carries a valid `refresh_token` and a future `expires_at`, every subsequent `get_auth_session` re-enters the not-expired branch and returns the same recoverable `AppError::Auth` until the user signs in again or signs out — it never degrades to `SessionExpired` or `LoggedOut`. 26.4's `complete_auth_callback` guards exactly this shape (auth.rs:396-410, `if !id_token.is_empty() && !refresh_token.is_empty()`); the refresh path does not mirror it.
*Why not blocking:* the outcome is still AC 12-compliant (recoverable `AppError::Auth`, no panic, self-heals on the next sign-in), and Cognito's refresh grant with the `openid` scope always returns a non-empty `id_token` — confirmed against the live pool. No AC is violated.
*Fix:* in `refresh_session`, before calling `merge_refreshed_session`, treat `refreshed.id_token.is_empty()` (and, defensively, `refreshed.access_token.is_empty()`) as a non-completion — log and `return Ok(None)` so it resolves to `SessionExpired`, matching 26.4's guard.

**NB-2 — `sign_out` skips the in-memory `PendingLogin` reset when the keyring clear fails.** `apps/desktop/src-tauri/src/commands/auth.rs:711-720`
AC 7 requires `sign_out` to clear the keyring **and** discard leftover pending-login state. `credentials::clear_cognito_session()?` at auth.rs:711 short-circuits with `?`, so on a keyring platform fault the PKCE `code_verifier` + CSRF `state` from an abandoned `start_login` stay resident in `PendingLogin` and remain usable by a late deep-link callback. The chosen `AppHandle`-over-`State<'_, PendingLogin>` signature is otherwise correct and its rationale (Completion Note 6) holds up: an unmanaged state would fail the command before the keyring was touched, and `pending_login_state` uses `try_state`, so the keyring clear is genuinely unconditional with respect to state availability — verified in code.
*Why not blocking:* the failing branch requires a Keychain/credential-store fault, the command correctly returns `Err` so the user retries, and the pending attempt is single-use and already cleared by `complete_auth_callback` on every path.
*Fix:* move the `if let Ok(pending) = pending_login_state(&app)` block above the `clear_cognito_session()?` call. Both operations stay best-effort/`?` respectively, and the AC-8 property (keyring cleared) is unaffected by the reorder.

**NB-3 — `get_auth_session` / `sign_out` orchestration has no executed verification.** `apps/desktop/src-tauri/src/commands/auth.rs:665-724`
The 21 new tests cover only the pure helpers. The composition itself — the `!is_session_expired(...)` branch direction at auth.rs:676, the store-then-decode ordering at auth.rs:696-698, the `Ok(None)` → `SessionExpired` mapping at auth.rs:682-691, and the post-`sign_out` → `LoggedOut` round trip (AC 8) — is exercised by nothing that runs. A mutation to `!is_session_expired` fails zero tests. This is a structural consequence of the story's own Testing Standards (no network, no keyring, no mocking crate, no `#[tokio::test]`), which route this coverage to Task 8's interactive matrix — and Task 8's two GUI/log subtasks were correctly left unchecked rather than fabricated.
*Why not blocking:* per this story's explicit testing constraints and the instruction that the interactive matrix is not a gate. The dev's honesty here is the desired behaviour.
*Outstanding manual work (recommend before Epic 27 consumes the IPC contract):* run `pnpm --filter @nixus/desktop tauri dev` and walk the three observable states (`LoggedOut` / `LoggedIn` / hand-expired + Wi-Fi off → `SessionExpired` within ~15s), then `sign_out` → `LoggedOut` with no `nixus-auth` entry in Keychain Access, and grep `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log` for token substrings.

**NB-4 — Minor test-coverage gaps in the JWT decode suite.** `apps/desktop/src-tauri/src/commands/auth.rs:1061-1097`
Base64url residue-class coverage was independently computed for every decode test payload and is complete: `len % 4 == 0` (`claims_decode_from_an_unpadded_base64url_payload`, 100 chars; `claims_decode_a_payload_containing_base64url_specific_characters`, 56), `== 2` (`an_absent_name_claim_degrades_to_none`, 54; `a_json_payload_without_sub_is_rejected`, 34), `== 3` (`claims_decode_from_a_padded_base64url_payload`, 59; `an_empty_name_claim_degrades_to_none_rather_than_a_blank_string`, 67). Two shapes are untested but structurally covered: a **1-segment** token (`segments.len() != 3` handles it identically to the tested 2- and 4-segment cases) and a payload needing **two** padding characters (`trim_end_matches('=')` is count-agnostic; the padded test exercises one).
*Fix (optional):* add `decode_id_token_claims("notajwt")` and one 2-pad-char padded payload assertion.

**NB-5 — Cosmetic formatting defect in a 26.4 test.** `apps/desktop/src-tauri/src/commands/auth.rs:850`
`fn authorize_url_never_emits_a_raw_space_or_a_forbidden_param() {        let url = build_authorize_url(...)` — the body's first statement sits on the signature line. Not attributable to 26.5 (the file is untracked, so no diff exists) and not detectable by the project's gates, since `rustfmt` is not installed for the active toolchain and the project does not gate on it. Zero functional impact.
*Fix:* reflow when `rustfmt` is next available.

#### Pre-existing / deferred (explicitly NOT this story's defects)

- **`commands/backup.rs:106` — `clippy::explicit_auto_deref`.** Independently confirmed pre-existing: `git diff HEAD -- apps/desktop/src-tauri/src/commands/backup.rs` returns zero lines, i.e. the file is byte-identical to baseline `9b45411`. The project's hard gate is `cargo check` zero-warnings (passing), not `clippy -D warnings`. Tech debt, outside this story's three-file footprint.
- **Stale `#[allow(dead_code)]` markers naming Story 26.5** at `models/mod.rs:751` and `credentials.rs:71,86,109`. Now genuinely unnecessary (all four symbols have consumers), but those files were declared final after 26.2 and touching them would be a boundary violation. An unnecessary `allow` emits no warning, so the zero-warning gate is unaffected. Correctly left alone and flagged; follow-up cleanup.
- **2 Playwright failures** (`chat.spec.ts:250`, `design-system.spec.ts:110`) — baseline `331 passed / 2 failed` at `9b45411`; this story touches zero frontend files.

#### Independently verified — evidence

**A. Refresh-token carry-forward (the story's flagged most-likely defect) — CORRECT.** `merge_refreshed_session` (auth.rs:578-581) resolves all three cases: `None` → `previous.refresh_token`, `Some("")` → `previous.refresh_token` (via `.filter(|t| !t.is_empty())`), `Some(new)` → adopts `new` (so enabling rotation later will not break). Proven load-bearing by mutation, with the file restored byte-exactly afterwards (SHA-256 `3e0af251…59678988` before and after every mutation):

| Mutation | Result |
|---|---|
| `.unwrap_or_else(\|\| previous.refresh_token.clone())` → `.unwrap_or_else(String::new)` | `refresh_without_rotation_preserves_previous_refresh_token` **FAILED**, `an_empty_rotated_refresh_token_falls_back_to_the_previous_one` **FAILED** (42 passed / 2 failed) |
| whole expression → `previous.refresh_token.clone()` | `refresh_with_rotation_adopts_the_rotated_refresh_token` **FAILED** (43 passed / 1 failed) |
| `now_unix >= expires_at` → `now_unix > expires_at` | `expiry_is_inclusive_at_the_boundary` **FAILED** (43 passed / 1 failed) |
| `decode(segments[1]…)` → `decode(segments[0]…)` | 6 decode/profile tests **FAILED** (38 passed / 6 failed) |
| removed `#[allow(dead_code)]` on `IdTokenClaims::sub` | `warning: field 'sub' is never read` — the allow is genuinely load-bearing, not decorative |

Live credential-free probe re-run: `POST https://auth.nixusapp.com/oauth2/token` with `grant_type=refresh_token`, the public `client_id`, and `refresh_token=invalid` → **`HTTP 400` `{"error":"invalid_grant"}`**, exactly the shape `refresh_session` maps to `Ok(None)` → `SessionExpired`.

**B. `AuthState` decision table — every path returns the right variant.** No session → `Ok(LoggedOut)`, not an error (auth.rs:668-673, AC 1). Valid session → claims decoded from the stored `id_token` at request time, no `GetUser`, no separately persisted profile field, `sub` parsed (auth.rs:676-679, 481; AC 2 / NFR4). Expired → refresh → `credentials::store_cognito_session` (same service `nixus-auth` + account ⇒ in-place overwrite) → `LoggedIn` from the **new** `id_token` (auth.rs:682-700, AC 3). All four refresh failure modes → `Ok(AuthState::SessionExpired)` with the keyring entry left in place (auth.rs:611-654, 682-691; AC 4). `name` absent **and** `name: ""` both → `None`, never an error, never `""` (auth.rs:551). Malformed keyring JSON propagates `AppError::Auth { recoverable: true }` from `credentials.rs:104-108`; undecodable `id_token` and missing/empty `email` → `unreadable_session_error()` = `recoverable: true` (auth.rs:507-512, 542-545; AC 12). Zero `unwrap()`/`expect()`/`panic!` outside `#[cfg(test)]` — only infallible `unwrap_or`/`unwrap_or_else`. The `Result<Option<CognitoSession>, AppError>` signature was scrutinised: `Err` is reachable **only** from `reqwest::Client::builder().build()` (auth.rs:594-600), a local fault that Task 2 explicitly prescribes mapping to `AppError::Auth { recoverable: true }`; with `rustls-tls` + webpki roots it has no realistic runtime failure mode. No genuine `SessionExpired` condition leaks out as `Err`, and no genuine hard error is swallowed as `SessionExpired`. Neither command runs in `.setup()`, so no return value can block startup (NFR1).

**C. JWT decode — correct.** Only `segments[1]` is decoded (auth.rs:528-530); `URL_SAFE_NO_PAD` is the right engine for base64url; `trim_end_matches('=')` is necessary and correct because `NO_PAD` configures `decode_padding_mode: RequireNone` and would otherwise reject a padded payload. `segments.len() != 3` rejects 1-, 2-, and 4-segment tokens; non-base64 garbage and valid-base64-invalid-JSON both map to `AppError::Auth { recoverable: true }`. Uses the already-present `base64` + `serde_json`; no JWT crate. Signature verification and JWKS are deliberately absent and documented as a **closed accepted decision** at auth.rs:514-518 and Completion Note 1 — not a TODO — so it is correctly not reported as a finding. `expires_at` (`i64` epoch seconds) is compared against `chrono::Utc::now().timestamp()` with the correct direction (`now >= expires_at` ⇒ expired; a future expiry is **not** expired), boundary equality included and mutation-proven.

**D. Security (AC 11) — clean.** All 8 new log statements traced to origin: 4 × `info!` emitting only the literal resolved variant name (auth.rs:671, 678, 688, 699), `error!` with `e.is_timeout()` as a bare boolean (auth.rs:613-616), `error!` with `status.as_u16()` + `sanitize_error_code`d error code (auth.rs:630-637), `error!` with `status.as_u16()` only (auth.rs:648-651), `info!` literal in `sign_out` (auth.rs:722). No token, JWT segment, or claim value beyond what `AuthState` returns to the UI reaches any macro. `TokenRefreshResponse` has **no** `Debug` derive (auth.rs:487) and is consumed by value into `merge_refreshed_session` — it is not embedded in any `Debug` type, never `{:?}`-formatted, and never `.expect()`ed (`refresh_session` uses `match` at auth.rs:641, and `Result::unwrap` would only require `E: Debug` regardless). The only `{:?}` uses in the file are test-only panics on `AppError`/`AuthState`. `grep -n "keyring" commands/auth.rs` returns **8 comment lines and zero code references** — no `keyring::Entry`, no `keyring_core::Entry`; the sole-accessor rule holds. `refresh_form` (auth.rs:558-564) sends exactly `grant_type=refresh_token` + `client_id` + `refresh_token` — no `redirect_uri`, no `code_verifier`, no `client_secret`, and there is no `.header(` / `Authorization` / `basic_auth` / `bearer_auth` call anywhere in the file. The endpoint is `format!("{}/oauth2/token", COGNITO_HOSTED_UI_BASE_URL)` (auth.rs:605) — never composed from a prefix + region, and no `COGNITO_DOMAIN_PREFIX` exists.

**E. `sign_out` (AC 7, 8) — correct.** `credentials::clear_cognito_session()` → discard `PendingLogin` → `Ok(())` (auth.rs:709-724), keyring first (see NB-2 for the one ordering nit). No `/oauth2/revoke` anywhere. `app.opener().open_url` appears only in 26.4's `start_login`; `COGNITO_SIGNOUT_URI` is referenced only by its own declaration and two tests, with `#[allow(dead_code)]` + its `// WHY:` comment intact (auth.rs:35-36). AC 8's post-sign-out state verified by contract: `clear_cognito_session` maps `Err(Error::NoEntry)` → `Ok(())` (idempotent) and `load_cognito_session` maps `Err(Error::NoEntry)` → `Ok(None)` (credentials.rs:92, 118-120), so a subsequent `get_auth_session` necessarily takes the `LoggedOut` branch.

**F. AC 5 launch-only refresh — no polling.** `grep` for `spawn|interval|sleep|timer|Instant` in `commands/auth.rs` returns exactly one code hit: 26.3/26.4's `tauri::async_runtime::spawn` deep-link dispatch at auth.rs:459. `lib.rs` has two `spawn` call sites, both present at baseline `9b45411` (`spawn_background_catalog_refresh` and the recurring-apply `tauri::async_runtime::spawn`) — confirmed via `git show HEAD:…/lib.rs`. Nothing was scheduled from `.setup()` by this story; the network is touched only inside `get_auth_session` when `now >= expires_at`. No `has_refreshed` flag, no cached `AuthState`, no mutex.

**G. Scope, registration, gates.**

| Check | Result |
|---|---|
| `generate_handler!` entry count | **99** (97 + `get_auth_session` + `sign_out`), zero duplicates, no pre-existing entry removed or reordered; the 4 auth commands are contiguous and last |
| Plugin order / `.setup()` | single-instance registered **first**, then deep-link; `.setup()` body otherwise unchanged by this story (its diff is 26.3/26.4's) |
| `Cargo.toml` | Diff contains only `tauri-plugin-deep-link`, `sha2`, `rand`, `tauri-plugin-single-instance` (26.3/26.4). **No** `jsonwebtoken`/`jwt`/`jwt-simple`/`aws-sdk-cognitoidentityprovider`. `aws-config` is pre-existing at baseline. AC 13 ✅ |
| `models/mod.rs`, `error.rs`, `credentials.rs`, `commands/mod.rs` | untouched by this story; `AuthState` still `#[serde(tag = "status")]` with PascalCase tags and **no** `rename_all` — Story 27.1's TS union is safe |
| SQLite | no migration, no `db/` addition, no new table, no `State<DbState>`, no audit-log row (AC 10) |
| Frontend | `git status --porcelain -- apps/desktop/src apps/web packages` → empty |
| Version | `0.3.2` in `package.json`, `tauri.conf.json`, `Cargo.toml` |
| Test module | exactly **one** `#[cfg(test)] mod tests` (auth.rs:726); 44 tests in the module = 23 prior (26.1's 4 drift guards + 26.4's 19) + **21 new** — all pass |
| `cargo check --all-targets` | **0 warnings** (forced recompile via `touch src/lib.rs`; grep count of `^warning` = 0) |
| `cargo test` | **329 passed / 0 failed** (308 baseline + 21) |
| `#[allow(dead_code)]` | no blanket `#![allow(...)]` anywhere in `src/`; the one new allow (`IdTokenClaims::sub`) proven load-bearing by mutation and carries an accurate `// WHY:` |
| Test gaming | none found. The 21 tests assert real behaviour: 5 independent mutations each produced targeted, non-overlapping failures. `authorize_url_is_byte_exact` and `the_refresh_form_carries_only_the_three_required_fields` are intentional drift guards, not logic bypasses. `the_refresh_endpoint_is_the_hosted_ui_token_endpoint` is a tautological restatement of the const (weakest of the 21) but is a legitimate drift guard on a live-verified URL |
| Guidelines | `docs/guidelines/warnings.md` (zero warnings) and `docs/project-context.md` §2 (`rename_all = "snake_case"`, `Result<T, AppError>`, never panic, register in `lib.rs`), §5, §9 all satisfied |

**Deviations reviewed and accepted** (all 6 self-reported ones hold up): reuse of 26.4's `TOKEN_EXCHANGE_TIMEOUT_SECS = 15` rather than a second competing budget — AC 6 requires *a* bound, and `reqwest`'s builder `timeout` covers connect through body read, so an offline launch cannot hang; no `Debug` on `TokenRefreshResponse`; `Result<Option<_>>` refresh signature; `sign_out(AppHandle)`; padding stripped before decode; stale allows in already-final files left alone.

