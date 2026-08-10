---
baseline_commit: 314d9455053c2f8b6e62bda3820702f9f95075c7
---

# Story 26.4: PKCE Login Launch & Callback Token Exchange

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to click sign-in and complete email/password or Google authentication in my system browser,
so that I end up signed in to nixus without ever typing credentials into the app itself.

**Scope:** Rust-only. No frontend files, no SQLite, no migration, no new UI. **Files touched:** `apps/desktop/src-tauri/src/commands/auth.rs` (**NEW** — `start_login`, `handle_auth_callback`), `apps/desktop/src-tauri/src/commands/mod.rs` (+ `pub mod auth;`), `apps/desktop/src-tauri/src/lib.rs` (register 2 commands in `generate_handler!`, `.manage()` the pending-attempt state, wire the Story 26.3 deep-link seam), `apps/desktop/src-tauri/Cargo.toml` (+ `sha2`, + `rand`).

**FRs:** FR1 (login-scoped) · **NFRs:** NFR2 (keyring-only storage), NFR3 (no new AWS compute), NFR4 (`sub` remains reachable via `id_token`)
**Epic:** [epics-login.md § Epic 26, Story 26.4 (lines 244-296)](../planning-artifacts/epics-login.md)
**Architecture:** [architecture-login.md](../planning-artifacts/architecture-login.md) — § "Authentication & Security" (lines 104-117), § "IPC command surface" (lines 123-128), § "Enforcement Guidelines" (lines 177-188), § "Data Flow" (line 264)
**Predecessors:** **26.1** (HARD — Cognito User Pool, public app client, hosted domain, Google IdP, and the recorded non-secret domain/client-id/region values; no story file — AWS-side only) · [**26.2**](26-2-auth-models-error-variant-and-secure-session-storage.md) (HARD — `CognitoSession`, `AuthState`, `AppError::Auth`, `credentials::store_cognito_session`) · [**26.3**](26-3-deep-link-and-single-instance-plugin-registration.md) (HARD — `tauri-plugin-deep-link` + `tauri-plugin-single-instance` registration and the callback-URL handler seam this story replaces)
**Successor:** **26.5** consumes the session this story writes (`get_auth_session`, `sign_out`). Do **not** implement 26.5's commands here.

---

## ⛔ CRITICAL CONTEXT — READ FIRST

**1. Path correction — the backend is NOT at repo root.** There is no `/src-tauri` at the repo root. The Tauri backend lives at **`apps/desktop/src-tauri/`**. Every path in this story is relative to the repo root `/Users/nbazinet/projects/nixus`.

**2. This is greenfield: zero auth code exists today.** Verified by exhaustive search — there are **no** matches for `cognito`, `oauth`, `pkce`, `deep_link`/`deep-link`, `CognitoSession`, `AuthState`, or `AppError::Auth` anywhere in `apps/desktop/src` or `apps/desktop/src-tauri/src`. `commands/auth.rs` does not exist. `hooks/useAuth.ts` does not exist. Nothing to refactor — everything is new construction on top of existing conventions.

**3. Story 26.1 is AWS-side only (no story file); 26.2 and 26.3 exist as story files but are still `backlog` in `sprint-status.yaml`.** This story is **not implementable standalone**. Run the Prerequisite Gate below and hard-stop if the surfaces it depends on are absent. Do **not** implement 26.2's models/error variant/credentials functions or 26.3's plugin registration inside this story — that duplicates work and creates merge conflicts.

**4. `docs/project-context.md` is stale on the pnpm scope.** It says `@nkbaz/desktop` / `@nkbaz/shared`. The **actual** package names are **`@nixus/desktop`** and **`@nixus/shared`** (verified in `apps/desktop/package.json`, `packages/shared/package.json`). Use `@nixus/*` in every command. The Rust crate is `nkbaz-finance` (lib `nkbaz_finance_lib`) and the **existing** keyring service constant is `"nkbaz-finance"` — those legacy names are correct and must not be renamed.

**5. `AppError` is hand-rolled — NOT `thiserror`.** `thiserror` is not a dependency. `apps/desktop/src-tauri/src/error.rs` defines `#[derive(Debug)] pub enum AppError` with a **manually written** `impl Serialize` that emits a `"type"` discriminant via `serialize_map`. Story 26.2 extends that hand-written impl with the `Auth` arm. Do not introduce `thiserror`, do not add a parallel error enum, do not add an `AppResult<T>` alias (no such alias exists in this codebase — every signature spells out `Result<T, AppError>`).

---

## ⛔ PREREQUISITE GATE

Run before writing any code:

```bash
cd /Users/nbazinet/projects/nixus
# 26.2 surfaces
grep -n "Auth {" apps/desktop/src-tauri/src/error.rs
grep -n "CognitoSession\|AuthState" apps/desktop/src-tauri/src/models/mod.rs
grep -n "store_cognito_session\|load_cognito_session\|clear_cognito_session" apps/desktop/src-tauri/src/credentials.rs
# 26.3 surfaces
grep -n "deep.link\|single.instance" apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/default.json
# 26.1 recorded non-secret config (domain / client id / region)
grep -rn "amazoncognito\|COGNITO_\|cognito" apps/desktop/src-tauri/src apps/desktop/src-tauri/tauri.conf.json apps/desktop/src/lib 2>/dev/null
# existing patterns this story must mirror
sed -n '200,300p' apps/desktop/src-tauri/src/maintenance/catalog.rs   # the ONLY reqwest usage in the repo
sed -n '1,60p'    apps/desktop/src-tauri/src/credentials.rs
sed -n '1,60p'    apps/desktop/src-tauri/src/error.rs
sed -n '17,95p'   apps/desktop/src-tauri/src/lib.rs                   # Builder chain + .setup() + .manage()
grep -n "^pub mod" apps/desktop/src-tauri/src/commands/mod.rs
grep -n "reqwest\|base64\|sha2\|rand\|urlencoding\|chrono\|tauri-plugin-opener" apps/desktop/src-tauri/Cargo.toml
```

| Gate | Result | Action |
|---|---|---|
| `AppError::Auth { message, recoverable }` missing from `error.rs` | **HARD STOP** | Report "Story 26.2 is not done." Do not add the variant here. |
| `CognitoSession` / `AuthState` missing from `models/mod.rs` | **HARD STOP** | Report "Story 26.2 is not done." Do not define the models here. |
| `credentials::store_cognito_session` missing | **HARD STOP** | Report "Story 26.2 is not done." **Never** work around it by calling `keyring_core::Entry` from `auth.rs` — that violates the sole-accessor rule. |
| `tauri-plugin-deep-link` / `tauri-plugin-single-instance` not in `Cargo.toml` + `lib.rs`, or `plugins.deep-link.desktop.schemes` missing from `tauri.conf.json`, or `deep-link:default` missing from `capabilities/default.json` | **HARD STOP** | Report "Story 26.3 is not done." Do not register the plugins here. |
| Story 26.3's callback-URL handler seam exists but under a different name than assumed below | — | Adapt to the real name; replace its body with the call into `handle_auth_callback`'s inner function. Do **not** create a second parallel handler. |
| Cognito **domain / client id / region** not recorded anywhere the app can read at build time | **HARD STOP** | Report "Story 26.1 is not done — non-secret Cognito config not recorded." **Do NOT invent placeholder values** (`example`, `TODO`, `your-domain`) — a hardcoded fake produces a silently broken authorize URL that looks implemented. Pure logic can still be written and unit-tested via the injected-config design in §"Testable Seams" below, but the story is not completable without the real values. |
| `refresh_token` field on `CognitoSession` is `String` (not `Option<String>`) | — | Expected. See AC #8 — a token response without a refresh token must be rejected, not stored as `""`. |

---

## Acceptance Criteria

1. **Given** the new `apps/desktop/src-tauri/src/commands/auth.rs` module
   **When** `start_login` is invoked
   **Then** it generates a cryptographically random PKCE `code_verifier` (32 random bytes, base64url-no-pad encoded → 43 chars, within RFC 7636's 43-128 range), derives the `code_challenge` as `base64url_no_pad(SHA256(code_verifier))`, and generates an independent cryptographically random `state`
   **And** both the `code_verifier` and the `state` are retained **in memory only** for the pending attempt — never written to the keyring, SQLite, a file, or a log
   **And** the command is declared `#[tauri::command(rename_all = "snake_case")]`, is `async`, returns `Result<(), AppError>`, and contains no `.unwrap()`, `.expect()`, or `panic!` on any non-test path

2. **Given** `start_login` has generated the PKCE parameters
   **When** it builds the authorize URL
   **Then** the URL is `https://<domain>.auth.<region>.amazoncognito.com/oauth2/authorize` with **exactly** these percent-encoded query parameters: `response_type=code`, `client_id=<client id>`, `redirect_uri=nixus://auth/callback`, `scope=openid email profile`, `code_challenge=<challenge>`, `code_challenge_method=S256`, `state=<state>`
   **And** the space-separated `scope` value is correctly percent-encoded (`openid%20email%20profile`), not emitted raw
   **And** no `client_secret` and no `nonce`, `identity_provider`, `prompt`, or `resource` parameter is included

3. **Given** the authorize URL
   **When** `start_login` opens it
   **Then** it opens in the **system browser** from **Rust** via `tauri-plugin-opener` (`use tauri_plugin_opener::OpenerExt;` → `app.opener().open_url(&url, None::<&str>)`), taking `app: tauri::AppHandle` as a command parameter
   **And** it is **never** opened in an embedded webview, a new Tauri window, or via the frontend `openUrl()` JS API
   **And** an opener failure returns `AppError::Auth { recoverable: true, .. }` and clears the pending attempt so no stale verifier is left behind

4. **Given** the Hosted UI opened by `start_login`
   **When** the user completes either the email/password form or the Google button
   **Then** Cognito redirects to `nixus://auth/callback` with `code` and `state`, and Story 26.3's deep-link handler seam routes that URL into this story's `handle_auth_callback` logic (FR1)
   **And** `handle_auth_callback` is **also** exposed as `#[tauri::command(rename_all = "snake_case")]` taking the callback URL as a `String`, so it is invocable over IPC for manual verification without a real browser round-trip

5. **Given** `handle_auth_callback` receives a callback URL whose `state` does not match the pending attempt's `state`
   **When** it validates the callback
   **Then** it aborts **before any network call**, returns `AppError::Auth { recoverable: false, .. }`, and discards the pending verifier
   **And** no keyring read or write occurs

6. **Given** the app has **no pending login attempt** (the user relaunched the app between `start_login` and the redirect, or the app was cold-started by the deep link)
   **When** `handle_auth_callback` processes an otherwise well-formed callback URL
   **Then** it returns `AppError::Auth { recoverable: true, .. }` with a message telling the user to sign in again, makes **no** network call, and writes nothing to the keyring
   **And** the app does not crash and remains fully usable (NFR1)

7. **Given** a callback URL that is malformed (unparseable), missing `code`, or carries an OAuth `error` parameter (Cognito returns e.g. `?error=invalid_request&error_description=...` to the redirect URI)
   **When** `handle_auth_callback` processes it
   **Then** it returns `AppError::Auth` with a user-presentable message derived from `error`/`error_description` when present, writes nothing to the keyring, and clears the pending attempt

8. **Given** a valid callback whose `state` matches the pending attempt
   **When** `handle_auth_callback` exchanges the code
   **Then** Rust `POST`s to `https://<domain>.auth.<region>.amazoncognito.com/oauth2/token` via `reqwest` with `Content-Type: application/x-www-form-urlencoded` and body params `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`
   **And** the request carries **no** `client_secret` parameter and **no** `Authorization` header (public client)
   **And** the `reqwest::Client` is built with an explicit request timeout (15s) so the command cannot hang indefinitely
   **And** the exchange happens exclusively in Rust — no token request originates from the frontend/webview
   **And** the pending attempt is **consumed (single-use)**: it is cleared before returning on every path (success and failure), so a replayed callback URL cannot re-run the exchange

9. **Given** a `200` token response
   **When** the session is persisted
   **Then** `handle_auth_callback` builds a `CognitoSession` with `expires_at = Utc::now().timestamp() + expires_in` (Unix seconds, `i64`) and calls `credentials::store_cognito_session(&session)`
   **And** it **never** references `keyring::Entry` / `keyring_core::Entry` directly (sole-accessor rule from `architecture-credentials.md`, re-confirmed in `architecture-login.md` lines 148-150)
   **And** if the response is missing `id_token` or `refresh_token`, it returns `AppError::Auth { recoverable: true, .. }` and stores **nothing** — an empty-string refresh token must never be persisted, because Story 26.5's `grant_type=refresh_token` call would then fail permanently

10. **Given** a successful token exchange **and** a successful store
    **When** the frontend needs to react
    **Then** the app emits the Tauri event `auth:callback-received` (exact colon-namespaced name) via `AppHandle::emit`, following the existing `recurring:applied` precedent in `lib.rs`
    **And** the event payload contains **no** token values
    **And** no event is emitted on any failure path, and no additional event name is invented

11. **Given** a failed token exchange — transport/network error, or a non-2xx response
    **When** `handle_auth_callback` returns
    **Then** it returns `AppError::Auth` with `recoverable` set per this mapping, and any previously stored session in the keyring is left **untouched** (no delete, no overwrite):
    | Failure | `recoverable` |
    |---|---|
    | transport error / timeout / DNS | `true` |
    | non-2xx with `error` = `invalid_grant` (code expired — Cognito codes are valid 5 minutes — or already consumed) | `true` |
    | non-2xx with `error` = `invalid_request` | `true` |
    | non-2xx with `error` = `invalid_client`, `unauthorized_client`, or `unsupported_grant_type` (app-client misconfiguration) | `false` |
    | 2xx body that fails to deserialize | `true` |
    **And** the app does not crash

12. **Given** the new commands
    **When** registered
    **Then** `commands/mod.rs` declares `pub mod auth;` (alphabetically between `asset` and `backup`)
    **And** `commands::auth::start_login` and `commands::auth::handle_auth_callback` both appear in `lib.rs`'s `tauri::generate_handler!` macro
    **And** the pending-attempt state is registered in `lib.rs`'s existing `.setup(...)` closure via `app.manage(...)`, mirroring the existing `app.manage(DbState(Mutex::new(conn)))` / `app.manage(Mutex::new(ai_state))` pattern

13. **Given** the token exchange succeeds
    **When** anything is logged or traced
    **Then** no `access_token`, `id_token`, `refresh_token`, `code`, `code_verifier`, or raw callback URL value is written to application logs at any level
    **And** no `tracing::*!("{:?}", …)` is applied to `CognitoSession`, the token-response struct, or the pending-attempt struct (all of which derive `Debug`)
    **And** logging is limited to: event names, HTTP status codes, Cognito `error` codes, and fixed context strings

14. **Given** the non-secret Cognito configuration (domain, client id, region)
    **When** this story is implemented
    **Then** those values are read from the build-time location Story 26.1 recorded them in — **not** from the keyring, **not** from SQLite, and **not** hardcoded as invented placeholders
    **And** `redirect_uri` is exactly `nixus://auth/callback` and the requested scope string is exactly `openid email profile`

15. **Given** the pure (I/O-free) logic in this story
    **When** tests are written
    **Then** `commands/auth.rs` contains a `#[cfg(test)] mod tests` block (matching the existing `assert_eq!`/`assert!` + `use super::*;` convention in `financial_health/evaluator.rs` and `budget/template_defaults.rs`) covering: verifier length is 43 and contains no `=`/`+`/`/`; `challenge == base64url_no_pad(SHA256(verifier))`; two successive generations differ; the authorize URL contains all seven required params with `code_challenge_method=S256` and correctly encoded scope; callback parsing extracts `code`+`state`; callback parsing surfaces an `error` parameter; a missing `code` is rejected; a mismatched `state` is rejected
    **And** these tests run under plain `cargo test` from `apps/desktop/src-tauri/` with no network access and no real Cognito configuration

16. **Given** the repo
    **When** verification runs
    **Then** `cd apps/desktop/src-tauri && cargo check --all-targets` and `cargo test` both succeed and emit **zero** compiler warnings — including no `dead_code` warning for any new helper (if a helper is genuinely unused, delete it; only add `#[allow(dead_code)]` when a later story will consume it), per `docs/guidelines/warnings.md` and project-context rule 9
    **And** `pnpm --filter @nixus/desktop build` still completes with zero TypeScript errors (no frontend files change, so this is a regression check only)
    **And** no new file appears under `apps/desktop/src-tauri/migrations/` or `apps/desktop/src-tauri/src/db/`, and `sprint-status.yaml` is not modified by the dev agent as part of code work
    **And** nothing is committed

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate** — run every command in §Prerequisite Gate; hard-stop per the table if 26.1/26.2/26.3 surfaces are missing. Record which gates passed in Completion Notes.
- [x] **Task 1: Dependencies** (AC #1)
  - [x] `apps/desktop/src-tauri/Cargo.toml`: add `sha2 = "0.10"` (pin to the 0.10 line — 0.10.9 is already in `Cargo.lock` transitively, so this adds no new build unit) and `rand = "0.9"`
  - [x] Confirm **no** other crate is added: `base64 = "0.22"`, `reqwest = "0.12"`, `chrono = "0.4"`, `urlencoding = "2"`, `keyring`/`keyring-core`, `tauri-plugin-opener = "2"` are already direct deps. `aws-sdk-cognitoidentityprovider` is **forbidden**.
- [x] **Task 2: `commands/auth.rs` — config + pure PKCE/URL/parse helpers** (AC #1, #2, #7, #14, #15)
  - [x] Define the non-secret `CognitoConfig { domain, region, client_id }` source from 26.1's recorded location, plus `const REDIRECT_URI: &str = "nixus://auth/callback"` and `const OAUTH_SCOPE: &str = "openid email profile"` — **consumed 26.1's already-shipped `COGNITO_*` const block instead of defining a new struct; see Completion Notes deviation D2**
  - [x] `fn generate_pkce() -> PendingAttempt` — 32 random bytes → base64url-no-pad verifier; challenge = base64url-no-pad(SHA256(verifier)); independent 32-byte random `state`
  - [x] `fn build_authorize_url(cfg: &CognitoConfig, challenge: &str, state: &str) -> String` — pure, no `AppHandle`, unit-testable — **shipped as `build_authorize_url(code_challenge, state)`; pure, no `AppHandle`, config read from consts (deviation D2)**
  - [x] `fn parse_callback(url: &str) -> Result<CallbackParams, AppError>` — pure; extracts `code`/`state`, surfaces `error`/`error_description`, rejects malformed/missing-`code`
- [x] **Task 3: Pending-attempt state** (AC #1, #5, #6, #8, #12)
  - [x] `pub struct PendingLogin(pub Mutex<Option<PendingAttempt>>)` with `Default`; register via `app.manage(...)` inside `lib.rs`'s existing `.setup()` closure
  - [x] Single-use semantics: `take()` the attempt at the start of callback handling so every return path (success and failure) leaves it cleared
- [x] **Task 4: `start_login` command** (AC #1, #2, #3)
  - [x] `#[tauri::command(rename_all = "snake_case")] pub async fn start_login(app: tauri::AppHandle) -> Result<(), AppError>`
  - [x] Generate → store pending → build URL → `app.opener().open_url(&url, None::<&str>)`; on opener error clear the pending attempt and return `AppError::Auth { recoverable: true, .. }`
- [x] **Task 5: `handle_auth_callback` + inner Rust-callable fn** (AC #4, #5, #6, #7, #8, #9, #10, #11)
  - [x] `pub async fn complete_auth_callback(app: &tauri::AppHandle, callback_url: &str) -> Result<(), AppError>` — the real logic, callable from Story 26.3's deep-link seam
  - [x] `#[tauri::command(rename_all = "snake_case")] pub async fn handle_auth_callback(app: tauri::AppHandle, callback_url: String) -> Result<(), AppError>` — thin wrapper delegating to `complete_auth_callback`
  - [x] Order of operations: take pending → no pending ⇒ `recoverable: true` error → parse callback → `error` param / missing `code` ⇒ error → `state` mismatch ⇒ `recoverable: false` error (**before** any network call) → POST `/oauth2/token` → non-2xx ⇒ map per AC #11 table → deserialize → missing `id_token`/`refresh_token` ⇒ `recoverable: true` error → build `CognitoSession` with `expires_at` → `credentials::store_cognito_session(&session)?` → `app.emit("auth:callback-received", ())` — **implemented exactly as written; AC #5 and AC #6 are separate code paths with opposite `recoverable` values (see resolved item R1)**
  - [x] `reqwest::Client::builder().timeout(Duration::from_secs(15)).build()` + `.form(&params)`; check `response.status().is_success()` explicitly before parsing (reqwest does not error on 4xx/5xx)
- [x] **Task 6: Wiring** (AC #12)
  - [x] `commands/mod.rs`: add `pub mod auth;` alphabetically between `asset` and `backup` — **already present at line 3 from Story 26.3; file left UNCHANGED (a duplicate would not compile)**
  - [x] `lib.rs`: add `commands::auth::start_login` and `commands::auth::handle_auth_callback` to `generate_handler!`; add the `.manage()` line in `.setup()`
  - [x] Replace the body of Story 26.3's deep-link seam so a received `nixus://auth/callback` URL calls `commands::auth::complete_auth_callback(&app_handle, &url).await`, logging (not panicking, not leaking the URL) on `Err`
- [x] **Task 7: Secret-safety audit** (AC #13) — grep the new module for any `tracing::` call whose format args could carry a token, code, verifier, or the raw callback URL; remove them.
- [x] **Task 8: Tests** (AC #15) — add the `#[cfg(test)] mod tests` block with the nine cases enumerated in AC #15.
- [x] **Task 9: Verification** (AC #16) — from `apps/desktop/src-tauri/`: `cargo check --all-targets` then `cargo test` (both zero-warning); then `pnpm --filter @nixus/desktop build`; confirm no migration/`db/` file added, `sprint-status.yaml` untouched, nothing committed.

---

## Dev Notes

### Established Codebase Patterns to Reuse (Binding)

| Concern | Existing precedent | File |
|---|---|---|
| reqwest call | `reqwest::Client::new()` per call, explicit `response.status().is_success()` check, `tracing::error!` the raw error then collapse to a generic `AppError` | `maintenance/catalog.rs:208-267` (the **only** reqwest usage in the repo) |
| Command shape | `#[tauri::command(rename_all = "snake_case")]`, `async` when awaiting I/O, `Result<T, AppError>`, `AppHandle` param when app services are needed | `commands/settings.rs:44`, `:99`, `:166`; `commands/maintenance.rs:304` |
| Module wiring | `pub mod <name>;` alphabetical in `commands/mod.rs`; fully-qualified `commands::<mod>::<fn>` in `lib.rs`'s `generate_handler!` (lines 92-188) | `commands/mod.rs:1-20`, `lib.rs:92-188` |
| Managed state | `app.manage(DbState(Mutex::new(conn)))`, `app.manage(Mutex::new(ai_state))` inside `.setup()` | `lib.rs:60-61` |
| Tauri event emit | `let _ = app_handle.emit("recurring:applied", created.len());` — colon-namespaced name, `use tauri::Emitter;` | `lib.rs:78` |
| Keyring | `credentials.rs` is the **sole** module touching `keyring_core::Entry`; commands call `credentials::*` and map errors to `AppError` at the call site | `credentials.rs:1-56`, `commands/settings.rs:71-75` |
| Rust unit tests | `#[cfg(test)] mod tests { use super::*; … }`, plain `assert_eq!`/`assert!`, local fixture builder fns, no mocking crate; run with `cargo test` | `financial_health/evaluator.rs:106+`, `budget/template_defaults.rs` |
| Logging | `tracing::{info,warn,error}!` fully qualified at the call site; daily rolling file appender, `EnvFilter::new("info")` | `lib.rs:34-41`, `catalog.rs:212` |

**Deliberate new precedents this story sets** (call these out in Completion Notes):
- First `reqwest` **POST** and first `.form()` body in the codebase. `.form()` is available on `reqwest` 0.12 even with `default-features = false` (`serde_urlencoded` is unconditional), so **no Cargo feature change is needed**.
- First `reqwest::Client::builder().timeout(...)` — every existing call is timeout-less. This is required so Story 26.5's "bounded time when offline" AC has a precedent to follow.
- First **Rust-side** `tauri-plugin-opener` usage (existing use is frontend-only, `AppSidebar.tsx:19,255`). **Note:** `capabilities/default.json` permissions (`opener:default`) gate the **JS/IPC** surface only — a Rust `app.opener().open_url(...)` call needs **no** capability change.

### New Dependencies Required

Add to `apps/desktop/src-tauri/Cargo.toml` — **these two only**:

```toml
sha2 = "0.10"
rand = "0.9"
```

Already direct deps — do **not** re-add or bump: `base64 = "0.22"`, `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }`, `chrono = { version = "0.4", features = ["serde"] }`, `urlencoding = "2"`, `keyring = "4"`, `keyring-core = "1"`, `tauri-plugin-opener = "2"`.

Forbidden: `aws-sdk-cognitoidentityprovider` (architecture-login.md line 71), `thiserror`, `oauth2`, `openidconnect`, any JWT crate (this story never decodes the `id_token` — that is Story 26.5's job).

### PKCE Implementation Reference

```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};

// 32 random bytes → 43-char base64url-no-pad verifier (RFC 7636 allows 43-128).
let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
```

`rand::random::<[u8; 32]>()` needs no trait import on `rand` 0.9. `URL_SAFE_NO_PAD` yields exactly the unreserved-character alphabet PKCE requires (no `=`, `+`, or `/`). `state` must be generated **independently** of the verifier — never derive one from the other.

### Exact Cognito Contracts (verified against current AWS documentation)

**`GET /oauth2/authorize`** — required for this flow: `response_type=code`, `client_id`, `redirect_uri`, plus `state`, `scope`, `code_challenge`, `code_challenge_method=S256`. Cognito supports **only** `S256` (never `plain`). If `code_challenge` is sent without `code_challenge_method`, or the method is not `S256`, Cognito redirects to the callback with `?error=invalid_request`. Cognito accepts custom-scheme callback URLs such as `myapp://example`, which is why no localhost loopback server is needed.

**`POST /oauth2/token`** — `HTTPS POST` only, `Content-Type: application/x-www-form-urlencoded`. For a **public client with no secret**, `client_id` goes in the **body** and there is **no** `Authorization` header. Body: `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri` (must byte-match the `redirect_uri` used at `/oauth2/authorize`).

Success (`200`):
```json
{ "access_token": "…", "id_token": "…", "refresh_token": "…", "token_type": "Bearer", "expires_in": 3600 }
```
`refresh_token` is returned **only** for `grant_type=authorization_code` — which is this story's grant, so its absence is a real error worth surfacing (AC #9), not an expected case.

Failure (`400`):
```json
{ "error": "invalid_request|invalid_client|invalid_grant|unauthorized_client|unsupported_grant_type" }
```
Notable: **the authorization code is valid for five minutes** and is single-use — a slow or replayed callback yields `invalid_grant`, which is why that maps to `recoverable: true` in AC #11.

Suggested response types (both `Deserialize`-only, both must be excluded from all logging):
```rust
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Deserialize)]
struct TokenErrorResponse { error: Option<String>, error_description: Option<String> }
```

### Testable Seams

Keep every I/O-free step a free function that takes its inputs explicitly — this is what makes AC #15's tests possible without Cognito or a running app:

- `generate_pkce() -> PendingAttempt` — no `AppHandle`, no state
- `build_authorize_url(cfg: &CognitoConfig, challenge: &str, state: &str) -> String` — config **injected**, not read from a global, so tests can pass a fake `CognitoConfig` even before 26.1's real values exist
- `parse_callback(url: &str) -> Result<CallbackParams, AppError>` — pure string → params
- `token_error_to_app_error(status, body) -> AppError` — pure mapping of AC #11's table

Only `start_login`, `complete_auth_callback`, and the thin `handle_auth_callback` wrapper should touch `AppHandle`, `reqwest`, or `credentials`.

### Secret-Safety Rules (Binding, NFR2)

- **Never** log `access_token`, `id_token`, `refresh_token`, `code`, `code_verifier`, `code_challenge`, or the raw callback URL. The callback URL contains the authorization code — `tracing::error!("bad callback: {}", url)` is a **leak** and is forbidden.
- `CognitoSession`, `PendingAttempt`, and `TokenResponse` all derive/could derive `Debug`; `tracing::*!("{:?}", …)` on any of them is forbidden.
- Log only: fixed context strings, HTTP status codes, Cognito `error` codes, and whether a pending attempt existed.
- Tokens go to the OS keyring via `credentials::store_cognito_session` **only** — never SQLite, never the app data dir, never webview storage, never a Tauri event payload.
- `AppError::Auth`'s `message` crosses the IPC boundary to the UI — it must be user-presentable and must never embed a token, code, or verifier.

### Conflicts Resolved Here (Binding)

**Conflict A — `handle_auth_callback` must be callable from both a Tauri command and a Rust plugin handler.** Story 26.3's deep-link seam runs in Rust and cannot conveniently invoke a `#[tauri::command]`. Resolved by putting the logic in a plain `pub async fn complete_auth_callback(app: &AppHandle, callback_url: &str)` that resolves its state via `app.state::<PendingLogin>()`, with `handle_auth_callback` as a thin `#[tauri::command]` wrapper. This satisfies the epic's "registered in `generate_handler!`" AC while keeping one implementation — no duplicated exchange logic.

**Conflict B — the epic's ACs presuppose a pending attempt exists, but the app may have restarted or been cold-started by the deep link.** Story 26.3's own AC requires a cold-start URL to still be captured, so the no-pending-attempt case is reachable. Resolved as AC #6: distinct from a `state` mismatch — no pending attempt is `recoverable: true` (benign, user retries), while a mismatched `state` is `recoverable: false` (a genuine CSRF signal, per architecture-login.md line 107).

**Conflict C — `credentials.rs` today stores one keyring entry per scalar value under service `"nkbaz-finance"`, but the Cognito session is a single JSON blob under service `"nixus-auth"` / account `"cognito-session"`.** That new shape is Story 26.2's deliverable. This story only calls `credentials::store_cognito_session` and must not reimplement, second-guess, or extend the storage layer.

**Conflict D — failures reaching the user.** The epic emits `auth:callback-received` on **success only**, and there is no UI yet (Epic 27). A deep-link-initiated failure therefore surfaces only in the log file for now. Resolved by keeping to the spec: emit on success only, log failures without secrets, and record the gap in Completion Notes for Epic 27 to address via `SessionExpired`/`LoggedOut` rendering. **Do not invent an `auth:callback-failed` event.**

**Conflict E — existing reqwest calls have no timeout, but a hung token exchange would be a bad user experience and Story 26.5 requires bounded time.** Resolved by adding an explicit 15s timeout here and flagging it as an intentional new convention rather than silently matching the timeout-less precedent.

### Scope Boundaries — Do NOT Build

- No `get_auth_session`, no `sign_out`, no `grant_type=refresh_token` call, no JWT/`id_token` claim decoding, no `sub` extraction — all Story 26.5.
- No `hooks/useAuth.ts`, no `queryKeys.auth.session`, no `AuthState` TS type, no `AccountPromptDialog`, no `ProfileMenu`, no `__root.tsx` change, no i18n keys — all Epic 27. **This story adds zero frontend files.**
- No `CognitoSession`/`AuthState` model definitions, no `AppError::Auth` variant, no `credentials.rs` functions — Story 26.2.
- No plugin registration, no `tauri.conf.json` scheme config, no `capabilities/default.json` change — Story 26.3.
- No `/oauth2/revoke` call, no refresh-token rotation, no cloud sync/notifications/community work — explicitly deferred in architecture-login.md lines 99-102, 313-316.
- No SQLite migration, no `db/` module, no new table, no audit-log row (the project-wide audit-log rule applies to SQLite mutations; this story performs none).
- No IaC for Cognito — provisioned out-of-band, exactly as AWS Bedrock is treated.

### Testing

Desktop has **no frontend unit tests for auth in scope** and Playwright E2E for the login flow is Story 27.4's deliverable — Cognito is not mocked in this project's E2E suite, and a dedicated test user pool is an explicitly out-of-scope CI task. `architecture-login.md` line 270 says "desktop has no unit test framework," but that statement is about the **frontend**; the Rust backend does contain `#[cfg(test)] mod tests` blocks in pure-logic modules (`financial_health/evaluator.rs`, `budget/template_defaults.rs`, `maintenance/*.rs`, `db/*.rs`). This story therefore ships **Rust unit tests for the pure PKCE/URL/parse/error-mapping functions** (AC #15) — matching real codebase practice — and adds no E2E spec. Manual verification of the full browser round-trip is Story 26.1's already-completed responsibility plus Story 27.4's E2E scope.

Manual smoke check available without a browser (AC #4's second clause makes this possible): invoke `start_login`, copy the `state` from the opened URL, then invoke `handle_auth_callback` with a hand-built `nixus://auth/callback?code=…&state=…` to exercise the mismatch/missing-code/no-pending paths.

### Project Structure Notes

Matches `architecture-login.md`'s delta tree (lines 194-223) exactly, minus the files owned by 26.2/26.3:

```
apps/desktop/src-tauri/
├── Cargo.toml                  # MODIFIED: + sha2, + rand
└── src/
    ├── lib.rs                  # MODIFIED: .manage(PendingLogin), 2 commands in generate_handler!, deep-link seam body
    └── commands/
        ├── mod.rs              # MODIFIED: + pub mod auth;  (alphabetical: asset → auth → backup)
        └── auth.rs             # NEW: start_login, handle_auth_callback, complete_auth_callback, pure helpers, tests
```

No variance from the architecture's structure. The only naming note: the crate/keyring legacy name is `nkbaz-finance` while the new keyring service is `nixus-auth` — both are intentional and neither should be "harmonized."

### Sprint Status

`sprint-status.yaml` already contains `epic-26` and all five `26-*` entries at `backlog` (lines 221-227). Per this story-creation run's explicit instruction, **`sprint-status.yaml` was intentionally not modified and the epic was not marked in-progress.** The dev agent should follow the normal `bmad-dev-story` workflow for status transitions when implementation begins.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.4: PKCE Login Launch & Callback Token Exchange (lines 244-296)] — all base acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics-login.md#Additional Requirements (lines 46-65)] — dependency policy, keyring sole-accessor rule, Rust-only token exchange, no-SQLite rule, non-secret config placement
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.2 / 26.3 / 26.5] — predecessor and successor contracts
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security (lines 104-117)] — public client, PKCE S256, `state` CSRF param, token exchange shape, keyring entry, deferred revoke/rotation
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Frontend Architecture → IPC command surface (lines 123-128)] — `start_login` / `handle_auth_callback` responsibilities
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Implementation Patterns & Consistency Rules (lines 142-188)] — keyring sole-accessor correction, `AppError::Auth` shape, event name, enforcement guidelines
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Project Structure & Boundaries (lines 190-264)] — delta tree, Windows single-instance note, data flow
- [Source: docs/project-context.md#Tauri IPC (rules 2, 5, 9)] — `rename_all = "snake_case"`, `Result<T, AppError>`, register in `lib.rs`, zero-warnings policy
- [Source: docs/guidelines/warnings.md] — compilation-warnings gate
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs:208-267] — the codebase's only reqwest pattern
- [Source: apps/desktop/src-tauri/src/error.rs:1-98] — hand-rolled `AppError` + manual `Serialize`
- [Source: apps/desktop/src-tauri/src/credentials.rs:1-56] — keyring sole-accessor module
- [Source: apps/desktop/src-tauri/src/lib.rs:17-188] — Builder chain, `.setup()`/`.manage()`, `recurring:applied` emit precedent, `generate_handler!` list
- [Source: AWS Cognito developer guide — "The redirect and authorization endpoint" (`/oauth2/authorize`)] — parameter list, S256-only, `?error=` redirect behavior
- [Source: AWS Cognito developer guide — "The token issuer endpoint" (`/oauth2/token`)] — form-encoded body, public-client `client_id`-in-body, success/error payloads, 5-minute code lifetime, refresh token only on `authorization_code`
- [Source: tauri-apps/plugins-workspace `plugins/opener/src/lib.rs`] — `use tauri_plugin_opener::OpenerExt; app.opener().open_url(url, None::<&str>)`

---

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

No debugging session was required. Two compile iterations only:

1. `expect_err` on `parse_callback` failed with `E0277: CallbackParams doesn't implement Debug`. **Not** fixed by deriving `Debug` — `CallbackParams` holds the authorization code, and AC #13 forbids a `Debug` path to it. Fixed by adding a test-only `reject_callback(url) -> AppError` helper that pattern-matches instead.
2. No other errors. `cargo check --all-targets` was warning-free on the first successful compile.

### Completion Notes List

#### ✅ R1 — RESOLVED BEFORE REVIEW: AC #5 and AC #6 carry opposite `recoverable` values

Flagged during dev, resolved before review: **story AC #5 / AC #6 followed as written; the orchestrator's instruction had conflated the two cases.**

The dev task brief for this run directed `recoverable: true` for "a mismatched **or absent** `state`", which collapsed two acceptance criteria that the story deliberately keeps separate. An interim build shipped that collapsed behaviour; it was corrected before review. The two cases are now **independent code paths with opposite flags**, matching AC #5, AC #6, [epics-login.md § Story 26.4](../planning-artifacts/epics-login.md), and [architecture-login.md line 107](../planning-artifacts/architecture-login.md):

| Case | Function | `recoverable` | Rationale |
|---|---|---|---|
| **AC #6** — no pending attempt at all (app relaunched between `start_login` and the redirect, or cold-started by the deep link) | `no_pending_attempt_error()` | **`true`** | Benign; signing in again always fixes it. Message tells the user to sign in again. |
| **AC #5** — a pending attempt exists but the callback's `state` does not match it, **or** the callback has no `state` | `verify_state()` | **`false`** | CSRF signal. A retry cannot make a forged redirect legitimate, so the message deliberately promises no retry. |

Kept as two separate functions specifically so the distinction cannot be re-collapsed by a future refactor, with docstrings on each stating that they carry opposite flags on purpose.

**Security clauses hold on BOTH paths, unchanged:**
- The pending attempt is `take()`n at `complete_auth_callback`'s first statement, so both paths (and every other) leave the slot empty — single-use is preserved.
- `verify_state` is called via `?` **before** `exchange_code_for_tokens`, so a mismatch aborts with **no network call**.
- **No keyring read or write occurs on either path.** The only keyring call in the module is `store_cognito_session`, reached solely after a successful exchange.

**Pinned independently by two tests:**
- `a_state_mismatch_is_unrecoverable` — asserts `recoverable == false` for both a mismatched `state` and an absent `state`.
- `an_absent_pending_attempt_is_recoverable` — asserts `recoverable == true` and that the message tells the user to sign in again.

`CallbackParams` still has **no** `Debug` derive; `verify_state` returns `Result<(), AppError>`, so `expect_err` is available without one. The `reject_callback` helper remains in use for the `parse_callback` tests.

#### D2 — `CognitoConfig` struct not created; 26.1's shipped consts consumed instead

Task 2 and §Testable Seams called for an injected `CognitoConfig { domain, region, client_id }` so tests could run "even before 26.1's real values exist". 26.1 **is** done and shipped a `pub const` block in this same file, so a config struct would have been a second, competing source of truth for the same values. `build_authorize_url(code_challenge, state)` is still **pure** (no `AppHandle`, no state, no I/O) and fully unit-testable, which is the property the seam existed to provide. AC #14 is satisfied: values are read from the build-time location 26.1 recorded them in.

#### D3 — Custom domain, so no `<domain>.auth.<region>.amazoncognito.com` URL and no `COGNITO_REGION` use

26.1 provisioned a **custom domain** (`auth.nixusapp.com`, Route53 + ACM), not a Cognito prefix domain. Everywhere AC #2/#8 say `https://<domain>.auth.<region>.amazoncognito.com/...`, the code uses `COGNITO_HOSTED_UI_BASE_URL`. Composing a prefix+region URL would produce a dead host. Consequence: **`COGNITO_REGION` is never read by the app**, so its `#[allow(dead_code)]` had to stay — 26.1's WHY comment (which promised 26.4 would consume it) was corrected in place to state the real reason. `COGNITO_CUSTOM_DOMAIN`'s allow also stays: it is read only by a `#[cfg(test)]` drift guard.

#### Task 0 — Prerequisite gate: ALL GATES PASSED

| Gate | Evidence | Result |
|---|---|---|
| `AppError::Auth { message, recoverable }` in `error.rs` | `error.rs:9` (variant), `:22` (Display), `:64` (hand-written `Serialize` arm) | ✅ PASS |
| `CognitoSession` / `AuthState` in `models/mod.rs` | `models/mod.rs:737` (`CognitoSession`, `expires_at: i64`), `:754` (`AuthState`, `#[serde(tag = "status")]`) | ✅ PASS |
| `credentials::store_cognito_session` | `credentials.rs:72` (+ `load` `:87`, `clear` `:110`), service `nixus-auth` / account `cognito-session` | ✅ PASS |
| deep-link + single-instance plugins | `Cargo.toml:33,50`; `lib.rs:25` (single-instance FIRST), `:41` (deep-link); `tauri.conf.json:27`; `capabilities/default.json:12` (`deep-link:default`) | ✅ PASS |
| Cognito non-secret config recorded | 7 `pub const COGNITO_*` in `commands/auth.rs:20-38` | ✅ PASS |
| 26.3 handler seam name | Real name is `dispatch_deep_link_url(&AppHandle, &str, &str)`, **not** the name AC #4 assumed. Adapted: body replaced, signature and both `lib.rs` call sites (`:126` `on_open_url`, `:137` `get_current` cold start) untouched. No second parallel handler created. | ✅ ADAPTED |
| `CognitoSession.refresh_token` is `String` not `Option` | `models/mod.rs:740` | ✅ EXPECTED (drives AC #9 rejection) |

Also confirmed **`commands/mod.rs:3` already contains `pub mod auth;`** — the file was left **unchanged**; adding it again would be a duplicate-definition compile error. The story's scope line calling `commands/auth.rs` "**NEW**" is stale: the file already existed with 26.1's const block, 26.3's `dispatch_deep_link_url`, and 26.3's 4 drift-guard tests. All were preserved; only additions were made.

#### Verification evidence (real output, AC #16)

```
$ cargo check --all-targets
    Checking nkbaz-finance v0.3.2 (/Users/nbazinet/projects/nixus/apps/desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.33s
EXIT=0
```
Zero warnings. Also re-run earlier after `touch src/commands/auth.rs src/lib.rs` to force full recompilation, then grepped for `warning|error` — **no matches**.

```
$ cargo test
test result: ok. 308 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.46s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out   (bin)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out   (doc)
```
289 baseline → **308** (+19 new; 23 total in `commands::auth::tests`, including 26.1's 4 originals, all still passing). Both output blocks above are from the final run **after** the R1 fix.

```
$ pnpm --filter @nixus/desktop exec tsc --noEmit
TSC_EXIT=0

$ pnpm --filter @nixus/desktop build
✓ 4304 modules transformed.
✓ built in 9.62s
```
(The `chunks are larger than 500 kB` notice is a pre-existing Vite bundle-size hint, not a TypeScript error. No frontend file was changed.)

**Live end-to-end verification of the URL contracts (headless, real AWS):**

```
$ # exact URL shape produced by build_authorize_url()
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}" \
  "https://auth.nixusapp.com/oauth2/authorize?response_type=code&client_id=6525109r95las7odvuesf13joj&redirect_uri=nixus%3A%2F%2Fauth%2Fcallback&scope=openid%20email%20profile&code_challenge=$CHALLENGE&code_challenge_method=S256&state=$STATE"
302 https://auth.nixusapp.com/login?response_type=code&client_id=6525109r95las7odvuesf13joj&redirect_uri=nixus%3A%2F%2Fauth%2Fcallback&scope=openid%20email%20profile&code_challenge=7OC2kXgVftBPYaYpVlFyR8DIIdG45ZJKXHPfQVlsXL0&code_challenge_method=S256&state=1pB7PCBkGmF3W516Fichz3yva4T_ZQ_s5hWOj-qWy-c
```
**302 to Managed Login with all seven params preserved** — proves the authorize URL is live and accepted (not a dead host, not `?error=invalid_request`). Verifier/challenge/state were all 43 chars.

```
$ # exact token-exchange shape: form-encoded, client_id in body, no secret, no Authorization header
$ curl -s -X POST https://auth.nixusapp.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=...&code=deadbeef-not-a-real-code&code_verifier=$VERIFIER&redirect_uri=nixus%3A%2F%2Fauth%2Fcallback"
{"error":"invalid_grant"}
http_status=400
```
Confirms the token endpoint accepts the exact body shape this story sends, and that its error payload is precisely what `TokenErrorResponse` deserializes — `invalid_grant` being the code AC #11 maps to `recoverable: true`. The byte-exact authorize URL was then frozen as a unit test (`authorize_url_is_byte_exact`).

#### ⚠️ NOT VERIFIED — requires a manual GUI step

- **AC #3 (system browser actually opens)** and **AC #4's full browser round-trip** (real Cognito login → real `nixus://auth/callback` deep link → keyring write → `auth:callback-received` emit) were **not** executed. They need a GUI app launch, an interactive Hosted UI login, and OS-level custom-scheme handling, none of which are available headlessly here. Compiled correctness of `app.opener().open_url(...)` and both endpoint contracts are verified above, but the end-to-end human path is **unverified** and should be smoke-tested by a human before Epic 27 builds UI on top.
- **AC #10 (`auth:callback-received` actually reaches a listener)** is unverified for the same reason — there is no frontend listener yet (Epic 27). The emit call is present and on the success path only.

#### New precedents this story sets

- First `reqwest` **POST** and first `.form()` body in the repo. `.form()` works on `reqwest` 0.12 with `default-features = false` (`serde_urlencoded` is unconditional) — **no Cargo feature change needed**, as predicted.
- First `reqwest::Client::builder().timeout(...)` (15s). Every pre-existing call is timeout-less; Story 26.5's "bounded time when offline" AC now has a precedent (Conflict E).
- First **Rust-side** `tauri-plugin-opener` use. Confirmed no `capabilities/default.json` change is needed — `opener:default` gates the JS/IPC surface only.
- First use of `Manager::try_state` instead of `state`. `state()` panics when unmanaged; a deep-link callback must never crash the app (AC #6 / NFR1), so the pending-login slot is resolved fallibly.
- `sha2`/`rand` resolved to `sha2 0.10.9` / `rand 0.9.4`, both **already in `Cargo.lock` transitively** → zero new build units, exactly as the story predicted. `rand` 0.9's `rand::random::<[u8; 32]>()` needs no trait import and draws from `ThreadRng`, which `impl CryptoRng` (verified in the vendored crate source) — satisfying AC #1's "cryptographically random".

#### Secret-safety audit result (Task 7 / AC #13)

Enumerated every `info!`/`warn!`/`error!`/`format!`/`panic!` in the module. Findings:

- **`PendingAttempt`, `TokenResponse`, and `CallbackParams` deliberately do NOT derive `Debug`.** AC #13 assumed they would and forbade `{:?}` on them; removing the derive makes the leak *structurally impossible* rather than policy-enforced. The only `{:?}` in the file is on `AppError` inside two test-only assertion helpers.
- **`TokenErrorResponse` omits `error_description`.** It is never deserialized, so Cognito free text cannot reach the UI or the log. AC #7's "message derived from `error`/`error_description`" is satisfied via the `error` **code** → fixed-message mapping in `oauth_error_to_app_error`. Locked by a test asserting the description text never appears in the user-facing message.
- **The `tauri_plugin_opener::Error` is discarded, not logged.** Verified in the vendored crate source that `Error::ForbiddenUrl`'s `Display` **embeds the URL** — which carries the `code_challenge` and `state`. Only a fixed string is logged.
- **The `reqwest` transport error is not logged either** — only `e.is_timeout()` (a bool), preserving 26.3's boolean-presence-flag discipline.
- **Hardening added beyond the ACs:** `sanitize_error_code()` bounds a logged OAuth `error` code to 40 chars and strips everything outside `[A-Za-z0-9_-]`. The `error` param is the one URL-derived value that reaches the log, and a hostile local `nixus://` deep link could otherwise inject newlines to forge log lines. Covered by `error_codes_are_bounded_and_stripped_of_log_forging_characters`.
- Logging is limited to: fixed context strings, HTTP status codes, sanitized Cognito `error` codes, `is_timeout()`, and 26.3's existing boolean presence flags. No `code`, `state`, `code_verifier`, `code_challenge`, token, raw callback URL, or `error_description` value reaches any log, `format!`, or panic path.
- `AppError::Auth`'s `message` is always a hardcoded `&'static str` — no dynamic value ever crosses IPC to the UI.
- **No `keyring::Entry` / `keyring_core::Entry` reference anywhere in `auth.rs`** (grep-confirmed); persistence goes solely through `credentials::store_cognito_session`. Sole-accessor rule intact.
- No `.unwrap()`, `.expect()`, or `panic!` on any non-test path (grep-confirmed; only `unwrap_or`/`unwrap_or_else` combinators, which cannot panic).

#### Behavioural notes

- **Single-use replay protection:** the pending attempt is `take()`n before anything else, so every return path — success and failure — leaves the slot empty. A replayed callback URL therefore hits the "no pending attempt" branch instead of re-running the exchange.
- **No dedup logic added,** per the task brief: 26.3's review established from the installed crate sources that Windows/Linux cold launch delivers via `get_current()` only while macOS cold/warm and Windows warm deliver via `on_open_url` only, so no platform double-dispatches.
- **`dispatch_deep_link_url` now filters on the callback path** (`is_auth_callback_url`) before spawning the exchange, so `nixus://auth/signout` (Story 26.5) and any future scheme path cannot reach the token exchange. Covered by a unit test.
- **AC #11 "previously stored session left untouched" holds by construction:** the only keyring call in the module is `store_cognito_session` on the success path. No failure path performs any keyring read, write, or delete.
- **Conflict D gap confirmed and still open:** a deep-link-initiated failure surfaces only in the log file. No `auth:callback-failed` event was invented. Epic 27 must render `SessionExpired`/`LoggedOut` to close this.
- **`credentials.rs` was deliberately NOT edited**, per the task brief's "do not touch" rule — so the `#[allow(dead_code)]` on `store_cognito_session` remains even though this story now consumes it. It produces **no warning** (an `allow` on a used item is inert), so the zero-warning gate is unaffected. Story 26.5 should remove it.

### File List

| File | Change |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | MODIFIED — added `sha2 = "0.10"` and `rand = "0.9"` inside `[dependencies]`; the `[target."cfg(...)".dependencies]` table remains the last table in the file (verified by re-reading the whole file after editing) |
| `apps/desktop/src-tauri/Cargo.lock` | MODIFIED — regenerated by cargo; `rand 0.9.4` / `sha2 0.10.9` promoted to direct deps of `nkbaz-finance`, no new packages resolved |
| `apps/desktop/src-tauri/src/commands/auth.rs` | MODIFIED — added `PendingAttempt`, `PendingLogin`, `CallbackParams`, `TokenResponse`, `TokenErrorResponse`, `generate_pkce`, `build_authorize_url`, `sanitize_error_code`, `oauth_error_to_app_error`, `parse_callback`, `no_pending_attempt_error`, `verify_state`, `is_auth_callback_url`, `pending_login_state`, `lock_poisoned`, `start_login`, `exchange_code_for_tokens`, `complete_auth_callback`, `handle_auth_callback`, `TOKEN_EXCHANGE_TIMEOUT_SECS`; replaced `dispatch_deep_link_url`'s body (name + signature unchanged); removed `#[allow(dead_code)]` from the 4 now-consumed `COGNITO_*` consts and corrected the WHY text on the 2 that keep it; added 19 tests into the **existing** `#[cfg(test)] mod tests` (26.1's 4 drift guards untouched) |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFIED — added `app.manage(commands::auth::PendingLogin::default());` in the existing `.setup()` closure after the two existing `app.manage` calls; appended `commands::auth::start_login` and `commands::auth::handle_auth_callback` to `generate_handler!` (95 → **97** entries). Builder chain order, plugin registration order (single-instance first), and both `dispatch_deep_link_url` call sites unchanged |

**Deliberately NOT modified:** `commands/mod.rs` (already had `pub mod auth;`), `models/mod.rs`, `error.rs`, `credentials.rs`, `tauri.conf.json`, `capabilities/default.json`, any file under `apps/desktop/src/`, any migration or `src/db/` file, `package.json` / `tauri.conf.json` / `Cargo.toml` version (`0.3.2` unchanged), `architecture-entitlements-licensing.md`. Nothing was committed.

---

## Review Findings

**Reviewer:** `bmad-code-review` (adversarial, independent verification — Dev Agent Record treated as unverified claims)
**Scope reviewed:** `src/commands/auth.rs` (716 lines, read in full — untracked, so no `git diff`), `src/lib.rs` (26.4's `+2` handler entries and `+1 app.manage` only), `Cargo.toml`, `Cargo.lock`
**Verdict:** ✅ **NO BLOCKING FINDINGS.** Zero correctness bugs, zero security issues, zero spec/AC violations, zero regressions. 7 NON-BLOCKING observations, none of which should hold the story.

### BLOCKING

**None.** Stated explicitly and unambiguously: nothing in this change set blocks. No blocker was manufactured to fill this section.

Every high-risk claim in the Dev Agent Record was re-derived from primary sources rather than trusted:

| Claim independently verified | Method | Result |
|---|---|---|
| `rand::random::<[u8;32]>()` is cryptographically secure | Read vendored `rand-0.9.4/src/lib.rs:141` → `rng().random()`; `src/rngs/thread.rs:194` → `impl CryptoRng for ThreadRng {}` | ✅ CSPRNG confirmed |
| `opener::Error::ForbiddenUrl`'s `Display` embeds the URL (so discarding it is required) | Read vendored `tauri-plugin-opener-2.5.4/src/error.rs` → `#[error("Not allowed to open url {}{}", .url, …)]` | ✅ Confirmed; `auth.rs:279` uses `.is_err()` and logs only a fixed string |
| `challenge == base64url_no_pad(SHA256(ASCII verifier))`, not the raw pre-encoding bytes | `auth.rs:99-100` hashes `code_verifier.as_bytes()` (the encoded string) — **plus mutation test**: replaced the digest input, `challenge_is_base64url_no_pad_sha256_of_the_verifier` + `two_successive_generations_differ` FAILED, then restored (SHA256 `7f6479e6…` matched byte-exact) | ✅ Correct, and the guard genuinely fails |
| `code_challenge_method=S256` is guarded | Mutation test: `S256`→`plain` ⇒ `authorize_url_contains_every_required_param` + `authorize_url_is_byte_exact` FAILED, then restored | ✅ Guard is real, not gamed |
| The emitted authorize URL is accepted by the live pool | `curl` on the byte-exact `%20`-scope form → `HTTP/2 302`, `location: https://auth.nixusapp.com/login?…` with all seven params preserved. No `invalid_scope`, no `redirect_mismatch` | ✅ Live-verified |
| `urlencoding::encode` does not mangle base64url `-`/`_` (would corrupt every real challenge/state) | Ran `urlencoding` 2 standalone on real 43-char values → returned verbatim | ✅ Challenge/state travel intact |
| The AC 5 / AC 6 split, and `verify_state` before any network call | Line numbers: `take()` at `:377` (first statement) → `parse_callback` `:388` → `verify_state` `:389` → `exchange_code_for_tokens` `:391` | ✅ Proven by ordering, not by claim |
| `tauri::async_runtime::spawn` cannot panic | Read `tauri-2.11.2/src/async_runtime.rs:279` → `RUNTIME.get_or_init(default_runtime)`, lazy init, no `.expect()` on an unset runtime | ✅ Panic-free |
| `generate_handler!` = 97, no entry removed or reordered | `awk` over the macro body → 97; `sort\|uniq -d` → no duplicates; diff shows `+2` appended lines and zero `-` lines in that region | ✅ 95→97 |
| `[target."cfg(…)"]` is still the LAST table in `Cargo.toml` | Read all 53 lines: `sha2`/`rand` at `:45-46`, target table at `:51-52`, nothing after `:52` | ✅ No key silently absorbed |
| Zero new build units from `sha2`/`rand` | `Cargo.lock` diff: only `+ "rand 0.9.4"` and `+ "sha2 0.10.9"` added to `nkbaz-finance`'s dep list; **no new `[[package]]` entry** for either. All 9 new packages belong to 26.3's deep-link/single-instance chain | ✅ Confirmed |
| Remaining `#[allow(dead_code)]` are load-bearing | `cargo rustc --lib -- --force-warn dead_code` → fires on `COGNITO_REGION`, `COGNITO_CUSTOM_DOMAIN`, `COGNITO_SIGNOUT_URI`. Each WHY text matches reality (region unused because of the custom domain; the other two read only from `#[cfg(test)]`) | ✅ All three genuinely needed; no blanket `#![allow]` anywhere in `src/` |
| Gates | `cargo check --all-targets` after `touch`-forced full recompile → **0 warnings**; `cargo test` → **308 passed / 0 failed**, 23 `commands::auth::tests` | ✅ Matches the Dev Agent Record exactly |

**Security lane — clean.** Every `info!`/`warn!`/`error!`/`format!`/`panic!` site in the module was enumerated (20 hits) and each traced to its origin. No `code`, `state`, `code_verifier`, `code_challenge`, `access_token`, `id_token`, `refresh_token`, or `error_description` value can reach any of them. `PendingAttempt`, `PendingLogin`, `CallbackParams`, `TokenResponse`, and `TokenErrorResponse` all confirmed to have **no** `Debug` derive, and no containing struct, `.expect()`, or `unwrap` panic message reintroduces a formatting path — the only `{:?}` occurrences (`:503`, `:510`) are on `AppError` inside `#[cfg(test)]` helpers. `sanitize_error_code` (`:127`) strips CR/LF and everything outside `[A-Za-z0-9_-]` and bounds to 40 chars *after* filtering, and is applied at **both** sites where a URL- or response-derived error code reaches a log (`:198`, `:350`); no bypass found. `grep -n keyring src/commands/auth.rs` returns only two comments — no `keyring::Entry`/`keyring_core::Entry` reference, all persistence via `credentials::store_cognito_session` (`:420`), the module's sole keyring call and reachable only after a successful exchange, so AC 5/AC 6/AC 11's "keyring untouched" holds by construction. No `client_secret` in the authorize URL or the token body; no `.header(`/`bearer_auth`/`Authorization` anywhere. `code_verifier` and `state` live only in the `Mutex<Option<PendingAttempt>>` — never serialized, stored, or logged.

**The `is_auth_callback_url` filter is not too strict** — the one item that *would* have been blocking (a filter that silently breaks all sign-in). Verified empirically against real `url::Url` parsing, since both `lib.rs` call sites pass `Url::as_str()`: `nixus://auth/callback?code=abc&state=xyz` round-trips **byte-identically** (non-special schemes get no trailing-slash normalisation and no case folding), `nixus://auth/callback/?code=abc` is handled by `trim_end_matches('/')`, `nixus://AUTH/CALLBACK?code=abc` by `eq_ignore_ascii_case`, and `nixus://auth/signout` is correctly rejected. Legitimate Cognito callbacks pass; 26.5's sign-out URI cannot reach the exchange. No dedup logic was added, and both `dispatch_deep_link_url` call sites (`lib.rs:126` `on_open_url`, `lib.rs:137` `get_current` cold start) are intact with the 26.3 name and signature preserved and no second parallel handler (`grep` finds exactly one definition, two call sites).

### NON-BLOCKING

1. **`auth.rs:441`, `:450` — the URL `path` is the one URL-derived string logged without filtering.** Everything else that reaches a log is a fixed string, a status code, a bool, or `sanitize_error_code`-filtered. `path` is safe today for two reasons I verified rather than assumed: `split_once('?')` strips the query (so `code`/`state` can never appear), and both call sites hand over `url::Url::as_str()`, which keeps control characters percent-encoded (`?code=a%0AINJECTED` stays `%0A`) — so log-forging is structurally impossible. But that safety rests on an *implicit upstream invariant*, not an enforced one: any future caller passing a raw `&str` would open a log-injection hole, and a URL with no `?` at all logs its entirety. Fix (defense-in-depth): route `path` through the same filtering as `sanitize_error_code`, or log a fixed discriminator instead of the path.
2. **`auth.rs:542-547` — `state_is_generated_independently_of_the_verifier` cannot detect derivation.** It asserts only `state != code_verifier` and `len == 43`; a hostile `state = base64(sha256(verifier))` implementation would pass it. Independence is genuinely established (two separate `rand::random` draws at `:99` and `:103`, plus `two_successive_generations_differ`), so the property holds — but this particular guard does not enforce it. Fix: drop it or repoint it, since its name overstates what it checks.
3. **`auth.rs:396-398` — an empty-string `access_token` on a `200` would be persisted.** The emptiness check covers only `id_token` and `refresh_token` (exactly what AC 9 mandates). `access_token` is non-`Option` so a *missing* one fails deserialization, but `""` deserializes fine. Unreachable with real Cognito. Fix: add `&& !tokens.access_token.is_empty()` if belt-and-braces is wanted.
4. **`auth.rs:275` — double-clicking "Sign in" produces a security-flavoured error for a benign action.** The second click supersedes the first attempt, so completing the *older* browser tab hits AC 5's `recoverable: false` path with "could not be verified and was rejected for your security." Spec-mandated (AC 5 requires `recoverable: false` for any `state` mismatch) and correctly implemented — but Epic 27 should consider softening this presentation, or the UI should disable the button while an attempt is in flight.
5. **`auth.rs:186-191` — duplicate query parameters resolve last-wins.** `?state=bad&state=good` yields `good`. Not exploitable: an attacker must already know the valid `state` to forge a passing one, at which point they hold the callback anyway. Cognito never emits duplicates. Noted for completeness only.
6. **`auth.rs:229` — `verify_state` uses `==`, not a constant-time comparison.** Correct as-is: `state` is a local CSRF nonce, not a secret compared against an attacker-controlled timing oracle. Recorded only because the security lane enumerates it.
7. **`auth.rs:591` — formatting glitch.** `fn authorize_url_never_emits_a_raw_space_or_a_forbidden_param() {        let url = …` puts the first statement on the brace line. Cosmetic; `rustfmt` is not installed for the active toolchain and the project does not gate on it.

### Outstanding manual work (not defects — correctly flagged as unverified by the dev, not claimed as done)

- **AC 3** — that the system browser actually opens. Needs a GUI launch.
- **AC 4** — the full interactive round-trip (real Hosted UI login → real `nixus://auth/callback` deep link → keyring write). Needs a bundled app; macOS deep links do not fire under `tauri dev`.
- **AC 10** — `auth:callback-received` reaching a listener. The emit is present, on the success path only, with an empty payload (`:424`, the module's only `.emit(`), but no listener exists until Epic 27.
- **Conflict D remains open** — a deep-link-initiated failure surfaces only in the log file. Correct per spec (no `auth:callback-failed` event was invented); Epic 27 must render `SessionExpired`/`LoggedOut` to close it.

### Explicitly checked and confirmed in scope-compliance

`commands/mod.rs`, `models/mod.rs`, `error.rs`, `credentials.rs` carry no 26.4 edits. 26.1's const block and all 4 drift-guard tests are intact (`:471-498`), and the 19 new tests live inside the **single** existing `#[cfg(test)] mod tests` (one test module in the file — a second would not compile). No file under `apps/desktop/src/`, no migration, no `src/db/` change, no `State<DbState>` usage. Version is `0.3.2` in `package.json`, `tauri.conf.json`, and `Cargo.toml`. No forbidden dependency: `aws-sdk-cognitoidentityprovider`, any JWT crate, `url`, and `thiserror` are all absent from `[dependencies]` (`url`/`thiserror` appear in `Cargo.lock` only as transitive deps of 26.3's deep-link plugin). Both commands are `#[tauri::command(rename_all = "snake_case")]`, `async`, return `Result<(), AppError>`, and `handle_auth_callback` (`:429-432`) is a thin two-line delegation to `complete_auth_callback`. All 8 tests AC 14/15 require are present, plus 11 extras. Nothing was committed; `Status:` and `sprint-status.yaml` were left untouched by this review.

