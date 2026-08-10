---
baseline_commit: 314d9455053c2f8b6e62bda3820702f9f95075c7
---

# Story 26.2: Auth Models, Error Variant & Secure Session Storage

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the `CognitoSession`/`AuthState` models, an `AppError::Auth` variant, and keyring-backed session persistence inside `credentials.rs`,
so that every later auth story has one validated, sole-accessor storage primitive to build on.

**Scope:** Rust-only, backend-only, zero user-visible surface. **Exactly 3 files modified, 0 files created.**
**Files touched:** `apps/desktop/src-tauri/src/models/mod.rs`, `apps/desktop/src-tauri/src/error.rs`, `apps/desktop/src-tauri/src/credentials.rs`
**FRs:** FR1 (login-scoped) · **NFRs:** NFR2 (keyring-only secure storage), NFR4 (`sub` viable as durable identity key later)
**Epic:** [epics-login.md § Epic 26, Story 26.2 (lines 157-201)](../planning-artifacts/epics-login.md)
**Architecture:** [architecture-login.md](../planning-artifacts/architecture-login.md) · [architecture-credentials.md](../planning-artifacts/architecture-credentials.md)

---

## ⛔ CRITICAL FINDING — READ FIRST

**Both architecture documents say `keyring::Entry`. The real code does not use `keyring::Entry`.**

`apps/desktop/src-tauri/src/credentials.rs:1` is:

```rust
use keyring_core::{Entry, Error};
```

The crate split is real and both crates are already declared in `Cargo.toml` (`keyring = "4"`, `keyring-core = "1"`):

| Crate | Role in this codebase |
|---|---|
| `keyring_core` | The `Entry` / `Error` API. **This is what `credentials.rs` uses.** |
| `keyring` | Only used once, in `lib.rs:44`, to *install* the OS-native store: `keyring::use_native_store(false)` |

**Consequences you MUST respect:**

1. Write `Entry::new(...)` using the **already-present** `use keyring_core::{Entry, Error};` import. Do **not** add `use keyring::...`. Do **not** add any keyring crate to `Cargo.toml` — both are already there.
2. `keyring_core::Error` is `#[non_exhaustive]` — every `match` on it **must** have a catch-all `Err(e) => ...` arm or it will not compile.
3. `Entry::new()` returns `Result<Entry>`; it **never** returns `Error::NoEntry`. Only `get_password()` / `delete_credential()` return `Error::NoEntry`.
4. Entries only work after `keyring::use_native_store(false)` has run (done in `lib.rs` `setup()` at line 43-45 — **do not touch it**). Before it runs, `Entry::new` fails with `Error::NoDefaultStore`. **This is why unit tests must install `keyring_core::mock::Store` first** (see Testing Requirements).

**Where the architecture docs are still authoritative:** the keyring **sole-accessor rule** (`credentials.rs` is the only module that constructs an `Entry`) and the entry coordinates (`service = "nixus-auth"`, `account = "cognito-session"`, value = one JSON blob). Those are binding.

---

## ⛔ SCOPE BOUNDARY — DO NOT EXCEED

This story builds **primitives only**. It has **no callers** and **no IPC surface**. Later stories wire it up.

**DO NOT create or modify:**

| Do not touch | Owned by |
|---|---|
| `src-tauri/src/commands/auth.rs` (do not create) | Stories 26.4 / 26.5 |
| `src-tauri/src/commands/mod.rs` | Story 26.4 |
| `src-tauri/src/lib.rs` (no `generate_handler!` entry, no plugin registration) | Stories 26.3 / 26.4 / 26.5 |
| `src-tauri/Cargo.toml`, `tauri.conf.json`, `capabilities/default.json` | Story 26.3 |
| Anything under `apps/desktop/src/**` (`useAuth.ts`, `types.ts`, `constants.ts`, components, routes) | Epic 27 |
| Anything under `src-tauri/src/db/**`, any migration, any new table | Nothing — explicitly out of scope for the whole feature |
| `apps/desktop/tests/**` (Playwright) | Story 27.4 |

**Also do not:** add `aws-sdk-cognitoidentityprovider`; make any network call; add a `reqwest` call; read or write SQLite; write any token to a log, file, or `localStorage`.

---

## ⛔ REGRESSION GATE — EXISTING AI CREDENTIALS MUST NOT BREAK

`credentials.rs` already stores AI provider keys under a **different service name**. The two must never touch each other.

| | Existing (AI) | New (auth) |
|---|---|---|
| Service const | `KEYRING_SERVICE = "nkbaz-finance"` | `KEYRING_AUTH_SERVICE = "nixus-auth"` |
| Accounts | `aws_access_key_id`, `aws_secret_access_key`, `aws_region`, `openai_api_key` | `cognito-session` (single entry) |
| Value shape | one plain string per entry | one JSON blob |
| Error type returned | `keyring_core::Error` | `AppError` |
| Cleared by | `clear_credentials()` | `clear_cognito_session()` |

**Hard rules:**

- **Do NOT** add `"cognito-session"` to the `names` array in the existing `clear_credentials()` (credentials.rs:45-50). Clearing AI credentials must never sign the user out, and signing out must never wipe AI credentials.
- **Do NOT** reuse `KEYRING_SERVICE` for the session. Add a **second, separate** service constant.
- **Do NOT** refactor the five existing functions or change their signatures/return types. They return `Result<_, Error>` / `Option<_>` and are consumed by `commands/settings.rs:71,118,148` and `ai/mod.rs`. Changing them is out of scope and would ripple.
- The new functions returning `Result<_, AppError>` (not `keyring_core::Error`) is **intentional and required by AC** — it is a deliberate signature difference from the existing AI functions, not an inconsistency to "fix".

---

## Acceptance Criteria

1. **Given** `apps/desktop/src-tauri/src/models/mod.rs`
   **When** this story is implemented
   **Then** it defines `CognitoSession { access_token: String, id_token: String, refresh_token: String, expires_at: i64 }` with exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` and `snake_case` fields, matching the existing model convention
   **And** the struct is appended to the end of the file (the file is append-only by convention — see Git Intelligence)

2. **Given** the same file
   **When** the frontend-facing session state is defined
   **Then** it defines `AuthState` as `LoggedOut | LoggedIn { email: String, name: Option<String> } | SessionExpired` with `#[serde(tag = "status")]`, so the frontend receives plain tagged JSON such as `{ "status": "LoggedIn", "email": "...", "name": "..." }` with no custom envelope
   **And** variant names remain **PascalCase** — `#[serde(rename_all = "snake_case")]` is **NOT** applied (unlike the neighbouring `EmergencyFundStatus` enum at models/mod.rs:458-464), because Story 27.1's TypeScript union discriminates on the literals `"LoggedOut" | "LoggedIn" | "SessionExpired"`
   **And** `name` is **NOT** marked `#[serde(skip_serializing_if = "Option::is_none")]` — when absent it must serialize as `"name": null`, because Story 27.1's type is `name: string | null`, not an optional property

3. **Given** `AuthState` serialization
   **When** each variant is serialized with `serde_json`
   **Then** the exact JSON is:
   ```json
   {"status":"LoggedOut"}
   {"status":"LoggedIn","email":"user@example.com","name":"Nick"}
   {"status":"LoggedIn","email":"user@example.com","name":null}
   {"status":"SessionExpired"}
   ```
   **And** this is locked by a unit test asserting the exact strings

4. **Given** `apps/desktop/src-tauri/src/error.rs`
   **When** this story is implemented
   **Then** `AppError` gains an `Auth { message: String, recoverable: bool }` variant reusing the existing `recoverable` pattern already used by `AiService`
   **And** a matching arm is added to **both** the `fmt::Display` impl and the manual `Serialize` impl (both `match` blocks are exhaustive with no `_` arm, so omitting either will fail to compile)
   **And** no parallel/duplicate auth error type is introduced anywhere

5. **Given** an `AppError::Auth` crossing the IPC boundary
   **When** it is serialized
   **Then** it produces exactly `{"type":"auth","message":"<message>","recoverable":<bool>}` — a 3-entry map, `type` value `"auth"` in snake_case matching the existing `"ai_service"` / `"not_configured"` style
   **And** this is locked by a unit test asserting the exact string

6. **Given** `apps/desktop/src-tauri/src/credentials.rs`
   **When** this story is implemented
   **Then** it gains exactly these three public functions with exactly these signatures:
   ```rust
   pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError>
   pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError>
   pub fn clear_cognito_session() -> Result<(), AppError>
   ```
   **And** all three use a **single** keyring entry with service `nixus-auth` and account `cognito-session`, storing the whole session as one JSON blob via `serde_json` (atomic read/write — never one entry per token)

7. **Given** the keyring sole-accessor rule from `architecture-credentials.md`
   **When** this story is reviewed
   **Then** `Entry::new` is referenced **only** inside `credentials.rs` — no other module in the codebase constructs a keyring entry for `nixus-auth`
   **And** `grep -rn "Entry::new" apps/desktop/src-tauri/src` returns matches in `credentials.rs` only

8. **Given** no session has ever been stored
   **When** `load_cognito_session()` is called
   **Then** it returns `Ok(None)` rather than an error, so "never signed in" is a normal state and not a failure path
   **And** this is implemented by matching `Err(Error::NoEntry) => return Ok(None)` on the result of `get_password()`

9. **Given** a keyring entry containing malformed or non-deserializable JSON
   **When** `load_cognito_session()` is called
   **Then** it returns `AppError::Auth { recoverable: true, .. }` (the user can simply sign in again) and never panics
   **And** the error message does **not** interpolate the stored blob or the raw serde error (the blob contains tokens)

10. **Given** `clear_cognito_session()` is called when no entry exists
    **When** it executes
    **Then** it succeeds idempotently rather than erroring, by treating `Err(Error::NoEntry)` from `delete_credential()` as `Ok(())`

11. **Given** the whole story
    **When** any of the three functions handles a keyring failure
    **Then** it returns an `AppError::Auth` and there is **no** `.unwrap()`, `.expect()`, `panic!`, or `todo!` on any non-test path
    **And** `recoverable` is set per this table:

    | Situation | `recoverable` | Why |
    |---|---|---|
    | Stored JSON is malformed / undeserializable | `true` | user can just sign in again |
    | `get_password()` fails for any reason other than `NoEntry` (e.g. locked keychain) | `true` | transient; retry or re-sign-in resolves it |
    | `serde_json` serialization failure on store | `false` | programmer error, not user-fixable |
    | `Entry::new` fails (`NoDefaultStore` / `Invalid`) | `false` | environment/wiring bug, not user-fixable |
    | `delete_credential()` fails for any reason other than `NoEntry` | `false` | sign-out could not complete |

12. **Given** NFR2
    **When** this story completes
    **Then** no token value is written to SQLite, to any file in the app data directory, or to webview `localStorage`/`sessionStorage`
    **And** no `tracing::info!/debug!/warn!/error!` call in the new code logs a token, the JSON blob, or any part of it

13. **Given** the existing AI credential entries under service `nkbaz-finance`
    **When** `clear_cognito_session()` runs
    **Then** `load_aws_credentials()` and `load_openai_key()` still return their stored values — the two credential namespaces are independent
    **And** `clear_credentials()` is left byte-for-byte unchanged

14. **Given** the compilation-warnings policy in `docs/guidelines/warnings.md` and `docs/project-context.md` rule 9
    **When** `cargo build` runs (not `cargo test` — a plain build is what exposes these)
    **Then** it completes with **zero** new warnings
    **And** because the three new functions have no non-test caller until Stories 26.4/26.5, each carries a narrowly-scoped `#[allow(dead_code)]` with a `// WHY` comment naming the consuming story
    **And** the same treatment is applied to `AuthState` if — and only if — the build actually reports it as never constructed (`// WHY: constructed by get_auth_session in Story 26.5`)
    **And** no blanket module-level (`#![allow(dead_code)]`) or crate-level allow is introduced, and no `#[allow]` is added for a warning that did not actually occur

15. **Given** the story is verifiable on its own with no dependency on any later story
    **When** `cargo test` runs in `apps/desktop/src-tauri`
    **Then** unit tests covering store/load round-trip, `Ok(None)` on empty, malformed-JSON recoverable error, idempotent clear, AI-credential isolation, `AuthState` JSON shape, and `AppError::Auth` JSON shape all pass
    **And** the entire pre-existing test suite still passes

---

## Tasks / Subtasks

- [x] **Task 1: Read the three target files before editing** (AC #1, #4, #6)
  - [x] `models/mod.rs` — confirm it ends at line 734 and note the existing `#[derive(Debug, Clone, Serialize, Deserialize)]` shape and the `EmergencyFundStatus` enum at 458-464 (the enum you must **not** copy the `rename_all` from)
  - [x] `error.rs` — note the 7 existing variants, the exhaustive `Display` match (15-27) and the exhaustive manual `Serialize` match (31-90)
  - [x] `credentials.rs` — note `use keyring_core::{Entry, Error};` at line 1 and `KEYRING_SERVICE = "nkbaz-finance"` at line 3

- [x] **Task 2: `models/mod.rs` — add `CognitoSession` and `AuthState`** (AC #1, #2, #3)
  - [x] Append both types at the **end** of the file (after `MaintenanceAlertSummary`), not inserted mid-file
  - [x] `CognitoSession` with the 4 fields and exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`
  - [x] `AuthState` with `#[derive(Debug, Clone, Serialize, Deserialize)]` + `#[serde(tag = "status")]`, PascalCase variants, `name: Option<String>` with **no** `skip_serializing_if`
  - [x] Add a `// WHY` comment above `expires_at` explaining it is Unix epoch **seconds** as `i64` (not the project's ISO-8601-`String` date convention) because it is arithmetic input for the refresh check in Story 26.5
  - [x] Add a `#[cfg(test)] mod tests` at the end asserting the four exact `AuthState` JSON strings from AC #3
  - [x] After Task 6's `cargo build`, if and only if it reports `AuthState` variants as never constructed, add `#[allow(dead_code)]` on the enum with `// WHY: constructed by get_auth_session in Story 26.5`

- [x] **Task 3: `error.rs` — add the `Auth` variant across all three sites** (AC #4, #5)
  - [x] Add `Auth { message: String, recoverable: bool },` to the enum, placed directly after `AiService`
  - [x] Add the `Display` arm in the same relative position: `AppError::Auth { message, .. } => write!(f, "Authentication error: {}", message),`
  - [x] Add the `Serialize` arm in the same relative position, emitting a 3-entry map: `type` = `"auth"`, then `message`, then `recoverable`
  - [x] Add a `#[cfg(test)] mod tests` asserting `serde_json::to_string(&AppError::Auth { message: "x".into(), recoverable: true }).unwrap() == r#"{"type":"auth","message":"x","recoverable":true}"#`
  - [x] Do **not** hunt for other `match` sites — verified: the only exhaustive matches on `AppError` are the two in `error.rs`; every other match in the codebase (all inside `#[cfg(test)]` modules in `db/maintenance.rs`, `db/budget.rs`, `db/budget_template.rs`, `commands/import.rs`) already has a catch-all arm, so nothing else breaks

- [x] **Task 4: `credentials.rs` — add the auth entry constants and the three functions** (AC #6, #7, #8, #9, #10, #11, #12)
  - [x] Add imports: `use crate::error::AppError;` and `use crate::models::CognitoSession;` (keep the existing `use keyring_core::{Entry, Error};` — do not add a `keyring::` import)
  - [x] Add `const KEYRING_AUTH_SERVICE: &str = "nixus-auth";` and `const KEYRING_AUTH_ACCOUNT: &str = "cognito-session";` next to the existing `KEYRING_SERVICE` — do not modify `KEYRING_SERVICE`
  - [x] Implement the three functions per the copy-ready contract in Dev Notes → Exact Code Contract
  - [x] Verify each function's `match` on `keyring_core::Error` has a catch-all arm (`Error` is `#[non_exhaustive]`)
  - [x] Verify zero `.unwrap()` / `.expect()` / `panic!` outside `#[cfg(test)]`

- [x] **Task 5: Rust unit tests in `credentials.rs`** (AC #8, #9, #10, #13, #15)
  - [x] Add `#[cfg(test)] mod tests` with the mock-store bootstrap + serialization guard exactly as given in Dev Notes → Testing Requirements (the mock store is process-global; tests sharing one fixed entry **must** be serialized or they will flake)
  - [x] `load_returns_none_when_nothing_stored` → `Ok(None)`
  - [x] `store_then_load_round_trips` → all four field values equal
  - [x] `store_twice_overwrites_in_place` → second load returns the second session (atomic single-entry behaviour)
  - [x] `load_malformed_json_returns_recoverable_auth_error` → write junk directly via `Entry` inside the test, assert `AppError::Auth { recoverable: true, .. }` and assert the message does not contain the junk
  - [x] `clear_is_idempotent_when_absent` → `Ok(())`
  - [x] `clear_removes_session` → store, clear, load → `Ok(None)`
  - [x] `clear_cognito_session_leaves_ai_credentials_intact` → store AWS creds + OpenAI key + session, clear session, assert `load_aws_credentials()` and `load_openai_key()` still return `Some`

- [x] **Task 6: Verification and warning cleanup** (AC #7, #11, #12, #14, #15)
  - [x] `cd apps/desktop/src-tauri && cargo build` → capture output; resolve **every** new warning
  - [x] Confirm the three pre-placed `#[allow(dead_code)]` attributes correspond to warnings that genuinely occur; if a warning also names `AuthState`, add the allow there too with its `// WHY` comment. Do not add an allow for anything that did not warn, and never widen the scope beyond the individual item
  - [x] `cargo test` → all new + all pre-existing tests pass; paste real output into Dev Agent Record → Verification
  - [x] `grep -rn "Entry::new" apps/desktop/src-tauri/src` → matches in `credentials.rs` only (AC #7)
  - [x] `grep -rniE "access_token|id_token|refresh_token" apps/desktop/src-tauri/src --include=*.rs | grep -iE "info!|debug!|warn!|error!|println!"` → returns nothing (AC #12)
  - [x] `git diff --name-only` → exactly the 3 expected files, nothing else (AC: Scope Boundary)
  - [x] `git diff apps/desktop/src-tauri/src/credentials.rs` → confirm `clear_credentials()`, `KEYRING_SERVICE`, and the four existing AI function bodies are unchanged (AC #13)

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **`credentials.rs` is the only module that may construct a keyring `Entry`.** [Source: architecture-credentials.md#Keyring Entry Naming — "All keyring access is centralized in `src-tauri/src/credentials.rs`. No command or module accesses the keyring directly."] [Source: architecture-login.md#Implementation Patterns — the step-5 correction that overrides the earlier "commands/auth.rs writes to keyring" statement]
2. **Extend `AppError`; never introduce a parallel auth error type.** [Source: docs/project-context.md#5 Error Handling]
3. **`#[derive(Debug, Clone, Serialize, Deserialize)]` exactly, `snake_case` fields, models live in `models/mod.rs`.** [Source: docs/project-context.md#4 Rust Model Structs]
4. **No `.unwrap()` outside tests; propagate with `?` / `map_err`.** [Source: docs/project-context.md#Rust language rules]
5. **Zero compilation warnings before commit; `#[allow(dead_code)]` only when the item will be used soon.** [Source: docs/guidelines/warnings.md] [Source: docs/project-context.md#9 Compilation Warnings Policy]
6. **One JSON blob in one entry** — never four separate keyring entries for the four token fields. [Source: architecture-login.md#Authentication & Security — "Single `keyring` entry ... storing a JSON blob ... Atomic read/write"]

### Existing Code to Extend (DO NOT REINVENT)

`apps/desktop/src-tauri/src/credentials.rs` — full current content is 56 lines. Structure to preserve:

```rust
use keyring_core::{Entry, Error};

const KEYRING_SERVICE: &str = "nkbaz-finance";

pub fn store_aws_credentials(access_key: &str, secret_key: &str, region: &str) -> Result<(), Error>
pub fn load_aws_credentials() -> Option<(String, String, String)>
pub fn store_openai_key(api_key: &str) -> Result<(), Error>
pub fn load_openai_key() -> Option<String>
pub fn clear_credentials()   // iterates a fixed 4-name array; returns ()
```

Consumers you are **not** allowed to break: `commands/settings.rs:71` (`store_aws_credentials`), `:118` (`store_openai_key`), `:148` (`clear_credentials`), and `ai/mod.rs` (loaders at startup).

`apps/desktop/src-tauri/src/error.rs` — current variants: `Validation`, `Database`, `AiService { message, recoverable }`, `File`, `NotConfigured`, `InvalidCredentials`, `Unavailable`. `AiService` is your template for the `recoverable` pattern; its serialized form is `{"type":"ai_service","message":...,"recoverable":...}`. Both the `Display` and `Serialize` matches are exhaustive with no `_` arm — the compiler will force you to handle the new variant in both, which is the desired safety net.

`apps/desktop/src-tauri/src/lib.rs:43-45` — already installs the credential store. **Read it, do not edit it:**

```rust
// Initialize OS keychain store (must happen before any credential access)
keyring::use_native_store(false)
    .expect("failed to initialize keychain store");
```

### Exact Code Contract (copy-ready)

`models/mod.rs` — append at end of file:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitoSession {
    pub access_token: String,
    pub id_token: String,
    pub refresh_token: String,
    // Unix epoch seconds, not the project's ISO-8601 String date convention: this value is
    // compared against `now` to decide whether to refresh (Story 26.5), so it must be numeric.
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AuthState {
    LoggedOut,
    LoggedIn { email: String, name: Option<String> },
    SessionExpired,
}
```

`error.rs` — three edits:

```rust
// 1. in the enum, directly after AiService:
    Auth { message: String, recoverable: bool },

// 2. in impl fmt::Display, same relative position:
            AppError::Auth { message, .. } => write!(f, "Authentication error: {}", message),

// 3. in impl Serialize, same relative position:
            AppError::Auth { message, recoverable } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "auth")?;
                map.serialize_entry("message", message)?;
                map.serialize_entry("recoverable", recoverable)?;
                map.end()
            }
```

`credentials.rs` — added imports, constants, and functions:

```rust
use crate::error::AppError;
use crate::models::CognitoSession;

const KEYRING_AUTH_SERVICE: &str = "nixus-auth";
const KEYRING_AUTH_ACCOUNT: &str = "cognito-session";

fn auth_entry() -> Result<Entry, AppError> {
    Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT).map_err(|e| AppError::Auth {
        message: format!("Secure storage is unavailable: {e}"),
        recoverable: false,
    })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    let json = serde_json::to_string(session).map_err(|_| AppError::Auth {
        message: "Failed to encode session for secure storage.".to_string(),
        recoverable: false,
    })?;
    auth_entry()?.set_password(&json).map_err(|e| AppError::Auth {
        message: format!("Failed to save session to secure storage: {e}"),
        recoverable: false,
    })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    let json = match auth_entry()?.get_password() {
        Ok(json) => json,
        Err(Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(AppError::Auth {
                message: format!("Failed to read session from secure storage: {e}"),
                recoverable: true,
            })
        }
    };

    // The blob and the serde error are never interpolated: the blob contains tokens.
    serde_json::from_str::<CognitoSession>(&json)
        .map(Some)
        .map_err(|_| AppError::Auth {
            message: "Stored session could not be read. Please sign in again.".to_string(),
            recoverable: true,
        })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn clear_cognito_session() -> Result<(), AppError> {
    match auth_entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Auth {
            message: format!("Failed to clear session from secure storage: {e}"),
            recoverable: false,
        }),
    }
}
```

Two notes on the above:
- `Ok(()) | Err(Error::NoEntry) => Ok(())` is the idempotency requirement (AC #10) in one arm.
- `auth_entry()` is a private helper so the entry coordinates appear exactly once. It will **not** trigger a dead-code warning: rustc treats `#[allow(dead_code)]` items as live roots, so everything the three public functions call is considered reachable.

### Adding `AppError::Auth` Has No Ripple Beyond `error.rs`

Verified across the whole crate before writing this story:

- The **only** exhaustive matches on `AppError` are the two inside `error.rs` (`Display` at lines 15-27, `Serialize` at lines 31-90). The compiler will point you at both — that is the complete list of required edits.
- Every other `match` on `AppError` in the codebase lives in a `#[cfg(test)]` module (`db/maintenance.rs`, `db/budget.rs`, `db/budget_template.rs`, `commands/import.rs`) and already ends in a catch-all (`other => panic!(...)` / `_ => panic!(...)`). None of them need touching.
- **The frontend needs no change either.** There is no exhaustive TypeScript union for `AppError`; errors are duck-typed at the single call site `apps/desktop/src/hooks/useChat.ts:168` (`if (e?.type === "not_configured")`). Adding a variant cannot break `tsc`. Do not edit `apps/desktop/src/lib/types.ts`.

### On the English Message Strings

The `message` values you write are English literals produced in Rust, exactly like the existing `AppError::AiService` / `NotConfigured` / `Unavailable` messages. This does **not** violate the platform i18n rule, which governs strings rendered in JSX through i18next. Localised auth copy is Epic 27's responsibility (Stories 27.2 / 27.3 own all user-facing wording, keyed in `locales/en.json` + `locales/fr.json`). Do not add i18n keys, and do not try to localise from Rust.

### keyring-core 1.0.0 API Facts (verified against the vendored crate source)

Verified in `~/.cargo/registry/src/index.crates.io-*/keyring-core-1.0.0/`:

| Fact | Detail |
|---|---|
| `Entry::new(service, user) -> Result<Entry>` | `src/lib.rs:130`. Errors: `Error::Invalid` (bad service/user) or `Error::NoDefaultStore` (store not installed). **Never `NoEntry`.** |
| `entry.set_password(&str) -> Result<()>` | `src/lib.rs:212`. Creates the credential if absent, updates it if present — so `store_cognito_session` is a natural upsert; no delete-then-write dance needed. |
| `entry.get_password() -> Result<String>` | `src/lib.rs:261`. Returns `Err(Error::NoEntry)` when no credential matches; `Err(Error::BadEncoding)` when the blob is not UTF-8. |
| `entry.delete_credential() -> Result<()>` | `src/lib.rs:358`. Returns `Err(Error::NoEntry)` when there is nothing to delete. |
| `Error` is `#[non_exhaustive]` | `src/error.rs:25`. Variants include `PlatformFailure`, `NoStorageAccess`, `NoEntry`, `BadEncoding`, `BadDataFormat`, `BadStoreFormat`, `TooLong`, `Invalid`, `Ambiguous`, `NoDefaultStore`, `NotSupportedByStore`. **A catch-all match arm is mandatory.** |
| `keyring_core::mock` is ungated | `src/mock.rs`, declared as plain `pub mod mock;` — available in tests with no extra dependency and no feature flag. |
| `keyring_core::set_default_store(Arc<...>)` | `src/lib.rs:65`. Process-global. `mock::Store::new()` returns `Result<Arc<Store>>` which coerces directly, per the crate's own doc example. |
| `keyring = "4"` `use_native_store(not_keyutils: bool)` | `keyring-4.0.1/src/lib.rs:82`. Installs the OS store as the default. The `false` argument only matters on Linux (keyutils vs Secret Service); nixus targets macOS + Windows. |

### Testing Requirements

Rust unit tests are the **only** verification available for this story — it has no IPC surface and no UI, so Playwright cannot reach it. `docs/project-context.md` says the desktop app has no *frontend* unit test framework; the Rust side has 25 modules with `#[cfg(test)] mod tests` (e.g. `maintenance/evaluator.rs`, `db/budget.rs`), and `serde` shape assertions are an established pattern there (`task_status_serializes_as_snake_case` in `maintenance/evaluator.rs`).

Run from `apps/desktop/src-tauri`:

```bash
cargo build      # must produce zero new warnings
cargo test       # new tests + all pre-existing tests
```

**Mandatory test bootstrap for `credentials.rs`** — the mock store is process-global and all three functions target one fixed `nixus-auth`/`cognito-session` entry, so parallel tests would clobber each other. Install once, serialize always:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard, Once, OnceLock};

    static STORE_INIT: Once = Once::new();
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    // Serializes tests: the mock store is process-global and every test targets the
    // same fixed keyring entry, so concurrent tests would clobber each other.
    fn guard() -> MutexGuard<'static, ()> {
        STORE_INIT.call_once(|| {
            keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
        });
        let lock = TEST_LOCK.get_or_init(|| Mutex::new(()));
        let g = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = clear_cognito_session(); // start from a known-empty state
        g
    }

    fn sample() -> CognitoSession {
        CognitoSession {
            access_token: "at".to_string(),
            id_token: "it".to_string(),
            refresh_token: "rt".to_string(),
            expires_at: 1_800_000_000,
        }
    }
}
```

Every test body must start with `let _g = guard();`. For the malformed-JSON test, write the junk directly through `Entry` **inside this module** — that stays within `credentials.rs` and therefore does not violate the sole-accessor rule:

```rust
Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT)
    .unwrap()
    .set_password("not-json-at-all")
    .unwrap();
```

`.unwrap()` is acceptable here and only here — inside `#[cfg(test)]`.

For the AI-isolation test (AC #13), the mock store also backs `store_aws_credentials` / `store_openai_key`, so the assertion is a genuine end-to-end check of namespace separation.

### Project Structure Notes

Aligned with the architecture delta tree in `architecture-login.md#Delta to Existing Project Tree` — this story implements exactly the three `MODIFIED` rows that carry no plugin/command work:

```
apps/desktop/src-tauri/src/
├── error.rs            # MODIFIED: + AppError::Auth { message, recoverable }
├── credentials.rs      # MODIFIED: + store_cognito_session / load_cognito_session / clear_cognito_session
└── models/
    └── mod.rs          # MODIFIED: + CognitoSession, AuthState
```

**Documented variances (deliberate, do not "correct"):**

| Variance | Rationale |
|---|---|
| `expires_at: i64` instead of the "dates are always ISO-8601 `String`" rule | Mandated verbatim by the epic AC. It is a token-expiry instant used for arithmetic in Story 26.5's refresh check, not a user-facing date. Unix epoch **seconds**. |
| New functions return `Result<_, AppError>`; existing AI functions return `Result<_, keyring_core::Error>` / `Option<_>` | Mandated verbatim by the epic AC, and required so `commands/auth.rs` can `?`-propagate straight to its `Result<T, AppError>` command signature without a mapping layer. Existing functions are intentionally left alone. |
| A **second** service constant (`nixus-auth`) alongside `nkbaz-finance` | `architecture-login.md` fixes the auth entry coordinates as `service = "nixus-auth"`, `account = "cognito-session"`. Reusing the AI service name would entangle the two namespaces. |
| `AuthState` variants stay PascalCase while `EmergencyFundStatus` uses `rename_all = "snake_case"` | Story 27.1's TypeScript union discriminates on `"LoggedOut" \| "LoggedIn" \| "SessionExpired"`. Snake-casing here would silently break Epic 27. |
| Architecture docs say `keyring::Entry`; code uses `keyring_core::Entry` | See the CRITICAL FINDING section. The code is authoritative on the crate path; the docs are authoritative on the sole-accessor rule and entry coordinates. |
| `docs/project-context.md` says packages are scoped `@nkbaz/`; the repo now uses `@nixus/` (`apps/desktop/package.json` is `@nixus/desktop`) | The project was renamed after that doc was written. Irrelevant to this story (no frontend files touched) but noted so it is not "fixed" here. |

### Previous Story Intelligence

**Story 26.1 (Cognito User Pool & Public App Client Setup) has no story file yet and is not a prerequisite for this one.** It is an AWS-Console-only story: it provisions the User Pool, the public app client (no secret, Authorization Code + PKCE `S256`, Implicit disabled, refresh-token rotation disabled), the hosted domain, the Google social IdP, and the `nixus://auth/callback` / `nixus://auth/signout` URLs, and explicitly adds **no file to this repository** ("no infrastructure-as-code file is added to this repository"). [Source: epics-login.md#Story 26.1]

What that means for you:

- **Do not wait for it and do not depend on it.** This story makes no network call and needs no Cognito domain, client id, or region. If you find yourself wanting a config constant, you are out of scope — that lands in Story 26.4.
- The non-secret Cognito config (domain / client id / region) goes in build-time constants or a `tauri.conf.json`-adjacent file, **never** in the keyring. Only tokens go in the keyring. [Source: epics-login.md#Additional Requirements]
- No earlier story in Epic 26 has produced code, so there is no prior implementation pattern to inherit beyond the existing `credentials.rs` / `commands/settings.rs` chain described above.

### Downstream Consumer Contract (why the exact signatures matter)

Your three functions are the sole storage primitive for the rest of Epic 26. Changing a signature forces rework in two later stories:

| Consumer | Uses | Expects |
|---|---|---|
| Story 26.4 `handle_auth_callback` | `store_cognito_session(&session)` | Builds `CognitoSession` from the token response (computing `expires_at` from `expires_in`) and persists it. **It must never touch `keyring::Entry`.** [Source: epics-login.md#Story 26.4] |
| Story 26.5 `get_auth_session` | `load_cognito_session()` | `Ok(None)` ⇒ returns `AuthState::LoggedOut`; `Ok(Some(s))` with `expires_at` in the future ⇒ `AuthState::LoggedIn` from `id_token` claims; expired ⇒ refresh then `store_cognito_session` again (update in place); refresh failure ⇒ `AuthState::SessionExpired`. It must never surface a hard error that blocks startup. |
| Story 26.5 `sign_out` | `clear_cognito_session()` | `Ok(())` even when nothing was stored — hence the idempotency requirement in AC #10. |
| Story 27.1 `AuthState` TS type | your `#[serde(tag = "status")]` shape | `{ status: "LoggedOut" } \| { status: "LoggedIn"; email: string; name: string \| null } \| { status: "SessionExpired" }` |

`AuthState` is **defined** here but **constructed** in Story 26.5. Do not write a `get_auth_session`, do not parse a JWT, and do not add a `sub` field to `AuthState` — the `sub` claim is read at request time in 26.5, not persisted. [Source: architecture-login.md#Authentication & Security — "Profile data source: Populated directly from `id_token` JWT claims ... no separate persistence"]

### Git Intelligence

- Baseline: `314d945 chore: bump version to 0.3.2` (recorded in this file's frontmatter).
- `models/mod.rs` is **append-only** in practice: the last six commits touching it added `+70`, `+1`, `+27`, `+8/-2`, `+82`, `+195` lines and never removed structs. Append your two types at the end; do not reorganize the file.
- `credentials.rs` and `error.rs` have not changed in the last six commits touching them — both are stable, low-churn files. Keep your diffs minimal and additive so review is trivial.
- Commit convention: `type(scope): description`. Suggested message for this story: `feat(auth): add Cognito session models, AppError::Auth, and keyring session storage`. Version bumps are always a **separate** `chore: bump version to X.Y.Z` commit — **do not bump the version in this story** (that would require the 3-file bump ritual and is not part of this deliverable).

### Latest Tech Information

- `keyring = "4.0.1"` + `keyring-core = "1.0.0"` are already resolved in `Cargo.lock`. **Do not add or bump a keyring dependency.** The 4.x line is where the `Entry`/`Error` API moved out into `keyring-core`, which is exactly why the architecture docs' `keyring::Entry` phrasing is stale.
- `serde_json = "1"` is already a dependency — use it for the blob; do not add another JSON crate.
- `reqwest`, `urlencoding`, and `tokio` are already present (added for other features) — Story 26.4 will use them. **Not this story.**
- `serde`'s internally-tagged representation (`#[serde(tag = "status")]`) supports unit variants and struct variants, which is all `AuthState` uses. It does **not** support tuple or newtype-of-non-map variants — so if you are ever tempted to change a variant to a tuple shape, it will fail at compile time. Keep the struct-variant form.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.2: Auth Models, Error Variant & Secure Session Storage] — all 8 original acceptance criteria, reproduced and extended above
- [Source: _bmad-output/planning-artifacts/epics-login.md#Additional Requirements] — keyring sole-accessor rule; model/enum shapes; `AppError::Auth` variant; no-SQLite constraint; non-secret config placement
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.1] — Cognito provisioning context (no repo files, therefore not a code prerequisite)
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.4 / #Story 26.5] — downstream consumers of these three functions
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security] — single keyring entry, service/account names, JSON blob, atomic read/write, profile data from `id_token` claims
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Implementation Patterns & Consistency Rules] — the step-5 correction making `credentials.rs` the sole keyring accessor; `CognitoSession`/`AuthState` naming; `AppError::Auth { message, recoverable }`
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Delta to Existing Project Tree] — the three modified files that scope this story
- [Source: _bmad-output/planning-artifacts/architecture-credentials.md#Keyring Entry Naming] — "All keyring access is centralized in `src-tauri/src/credentials.rs`. No command or module accesses the keyring directly." + the inline-`Entry::new` anti-pattern
- [Source: _bmad-output/planning-artifacts/architecture-credentials.md#Architectural Boundaries] — `credentials.rs` as sole keyring interface
- [Source: docs/project-context.md#4 Rust Model Structs] — derive set, `snake_case` fields, models in `models/mod.rs`
- [Source: docs/project-context.md#5 Error Handling (AppError)] — extend `AppError`, `recoverable` pattern, serialized `{ type, message }` shape
- [Source: docs/project-context.md#9 Compilation Warnings Policy] and [Source: docs/guidelines/warnings.md] — zero warnings; scoped `#[allow(dead_code)]` only when the item will be used soon
- [Source: apps/desktop/src-tauri/src/credentials.rs:1-56] — current keyring module, `keyring_core` import, `KEYRING_SERVICE`, `clear_credentials` name array
- [Source: apps/desktop/src-tauri/src/error.rs:1-98] — `AppError` enum + exhaustive `Display` and manual `Serialize` impls
- [Source: apps/desktop/src-tauri/src/models/mod.rs:1-734] — model conventions; `EmergencyFundStatus` at 458-464 as the enum you must not copy `rename_all` from
- [Source: apps/desktop/src-tauri/src/lib.rs:43-45] — `keyring::use_native_store(false)` bootstrap (read-only for this story)
- [Source: apps/desktop/src-tauri/src/commands/settings.rs:71,118,148] — existing `credentials.rs` consumers that must keep compiling
- [Source: apps/desktop/src-tauri/Cargo.toml:39-42] — `keyring = "4"`, `keyring-core = "1"`, `serde_json`, `reqwest` already declared

---

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

Single warning surfaced by the first `cargo build`, resolved per AC #14 (see Verification below):

```
warning: enum `AuthState` is never used
   --> src/models/mod.rs:752:10
    |
752 | pub enum AuthState {
    |          ^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `nkbaz-finance` (lib) generated 1 warning
```

Resolution: added `#[allow(dead_code)]` **on the `AuthState` enum only**, with `// WHY: constructed by get_auth_session in Story 26.5. Remove the allow then.` No blanket/module-level allow was introduced.

`CognitoSession` did **not** warn — it is reachable through the three `#[allow(dead_code)]` session functions (rustc treats allowed items as live roots), so no allow was added there. `auth_entry()` likewise did not warn, confirming the Dev Notes prediction.

### Completion Notes List

**Scope honoured exactly: 3 files modified, 0 files created, 296 insertions / 0 deletions.** The diff is purely additive.

- **`models/mod.rs`** — appended `CognitoSession` and `AuthState` after `MaintenanceAlertSummary` (file was 734 lines; append-only convention preserved, nothing reorganized). `expires_at: i64` carries the mandated `// WHY` comment documenting Unix epoch **seconds** as a deliberate override of the ISO-8601-`String` date convention. `AuthState` uses `#[serde(tag = "status")]` with **PascalCase** variants — `rename_all = "snake_case"` deliberately NOT applied (unlike neighbouring `EmergencyFundStatus`), and `name: Option<String>` deliberately carries **no** `skip_serializing_if`, both because Story 27.1's TS union needs `"LoggedOut" | "LoggedIn" | "SessionExpired"` and `name: string | null`. A comment records both intentional deviations so a future reader does not "fix" them into an Epic 27 breakage.
- **`error.rs`** — `Auth { message: String, recoverable: bool }` added directly after `AiService` in the enum, plus matching arms in the same relative position in **both** the `fmt::Display` impl and the **existing hand-written** `impl Serialize` (extended `serialize_map`, 3-entry map, `type` = `"auth"` in snake_case matching `"ai_service"`). No `thiserror`, no parallel auth error type, no derive-based replacement of the hand-rolled impl.
- **`credentials.rs`** — added `KEYRING_AUTH_SERVICE = "nixus-auth"` / `KEYRING_AUTH_ACCOUNT = "cognito-session"` as a **second, separate** namespace next to the untouched `KEYRING_SERVICE = "nkbaz-finance"`, a private `auth_entry()` helper so the entry coordinates appear exactly once, and the three public functions with the exact AC #6 signatures returning `Result<_, AppError>`. One entry, one JSON blob, `serde_json` upsert via `set_password` (atomic — never one entry per token).

Behavioural guarantees implemented and test-locked:

- AC #8 — `Err(Error::NoEntry)` from `get_password()` → `Ok(None)`; "never signed in" is a normal state, not a failure path.
- AC #9/#12 — malformed blob → `AppError::Auth { recoverable: true }` with a fixed English string; the blob and the raw serde error are **never** interpolated (they contain tokens). Locked by an assertion that the message does not contain the junk.
- AC #10 — `Ok(()) | Err(Error::NoEntry) => Ok(())` makes `clear_cognito_session()` idempotent in a single arm.
- AC #11 — every `match` on the `#[non_exhaustive]` `keyring_core::Error` has a catch-all `Err(e)` arm; `recoverable` follows the AC #11 table exactly (malformed JSON `true`, non-`NoEntry` read failure `true`, serialization failure `false`, `Entry::new` failure `false`, non-`NoEntry` delete failure `false`). Zero `.unwrap()` / `.expect()` / `panic!` / `todo!` on any non-test path.
- AC #13 regression gate — `clear_credentials()`, `KEYRING_SERVICE`, and all four existing AI function bodies are byte-for-byte unchanged (0 deletions in the diff). `"cognito-session"` was **not** added to the `clear_credentials()` names array. Namespace independence is proven end-to-end by `clear_cognito_session_leaves_ai_credentials_intact`, which runs against the same mock store.
- AC #7 — `Entry::new` appears only in `credentials.rs` (11 matches, all in that file; match at line 189 is inside the `#[cfg(test)]` module, which still satisfies the sole-accessor rule).

14 new tests added (7 `credentials`, 3 `error`, 4 `models`), all passing; suite went 271 → **285 passed, 0 failed**. The `credentials` tests install the ungated `keyring_core::mock::Store` once via `Once` and serialize on a `Mutex` because the mock store is process-global and all three functions target one fixed entry — without serialization they would clobber each other and flake. The guard also clears both namespaces so each test starts from a known-empty state.

Deliberately NOT done, per the scope boundary: no `commands/auth.rs`, no `commands/mod.rs` / `lib.rs` / `generate_handler!` / plugin registration, no `Cargo.toml` / `tauri.conf.json` / `capabilities/default.json` change, no dependency added or bumped, no `AppResult<T>` alias, no version bump (stays `0.3.2`), no frontend file, no migration or SQLite write, no network call, no Cognito config constant, no JWT parsing, no `get_auth_session`, no i18n key. `_bmad-output/planning-artifacts/architecture-entitlements-licensing.md` was not touched. Nothing was committed or pushed.

**CRITICAL FINDING confirmed as written:** the code uses `keyring_core::{Entry, Error}`, not `keyring::Entry`. The already-present line-1 import was reused as-is; no `keyring::` import was added and no keyring crate was added to `Cargo.toml`. Both architecture docs remain stale on this point — real code won, exactly as the story directed.

**Pre-existing working-tree noise (not from this story):** `git status` also shows `docs/project-context.md`, `_bmad-output/planning-artifacts/architecture.md`, `architecture-credentials.md`, `architecture-entitlements-licensing.md`, and `sprint-status.yaml` as modified, plus untracked Epic 26/27 story files. File mtimes confirm those predate this story's edits (18:50–19:37 vs 19:52–19:53) — they are planning-phase artifacts from outside this story. Only `sprint-status.yaml` was touched by this workflow, and only to flip this story's status.

**Note for reviewers on `rustfmt`:** `rustfmt` is not installed for the active toolchain (`stable-aarch64-apple-darwin`), so the project does not gate on it. No toolchain component was installed. Formatting follows the surrounding code by hand.

### File List

| File | Change |
|---|---|
| `apps/desktop/src-tauri/src/models/mod.rs` | MODIFIED — appended `CognitoSession`, `AuthState`, and `#[cfg(test)] mod tests` (+67) |
| `apps/desktop/src-tauri/src/error.rs` | MODIFIED — `AppError::Auth` variant + `Display` arm + `Serialize` arm + `#[cfg(test)] mod tests` (+43) |
| `apps/desktop/src-tauri/src/credentials.rs` | MODIFIED — auth service/account consts, `auth_entry()`, three session functions, `#[cfg(test)] mod tests` (+186) |

No files created. No files deleted.

### Verification (real output)

**`cargo build`** — run from `apps/desktop/src-tauri` after touching all three modified files to force a real recompile:

```
$ touch src/models/mod.rs src/error.rs src/credentials.rs && cargo build
   Compiling nkbaz-finance v0.3.2 (/Users/nbazinet/projects/nixus/apps/desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.26s
```

Zero warnings (AC #14 satisfied).

**`cargo check`** — forced recompile:

```
$ touch src/models/mod.rs && cargo check
    Checking nkbaz-finance v0.3.2 (/Users/nbazinet/projects/nixus/apps/desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.25s
```

Zero warnings.

**`cargo test`** — full suite:

```
test models::tests::auth_state_logged_in_serializes_with_name ... ok
test models::tests::auth_state_logged_out_serializes_with_status_tag ... ok
test models::tests::auth_state_logged_in_serializes_absent_name_as_null ... ok
test models::tests::auth_state_session_expired_serializes_with_status_tag ... ok
...
test result: ok. 285 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s

     Running unittests src/main.rs (target/debug/deps/nkbaz_finance-a25f727057b147d6)
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests nkbaz_finance_lib
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

**`cargo test credentials`** — the seven new keyring tests (AC #8, #9, #10, #13, #15):

```
running 7 tests
test credentials::tests::clear_is_idempotent_when_absent ... ok
test credentials::tests::clear_removes_session ... ok
test credentials::tests::store_then_load_round_trips ... ok
test credentials::tests::load_malformed_json_returns_recoverable_auth_error ... ok
test credentials::tests::clear_cognito_session_leaves_ai_credentials_intact ... ok
test credentials::tests::store_twice_overwrites_in_place ... ok
test credentials::tests::load_returns_none_when_nothing_stored ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 278 filtered out; finished in 0.00s
```

**`cargo test error::tests`** — the `AppError::Auth` shape tests (AC #5):

```
test error::tests::auth_error_displays_with_authentication_prefix ... ok
test error::tests::auth_error_serializes_unrecoverable_flag ... ok
test error::tests::auth_error_serializes_with_type_message_and_recoverable ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 282 filtered out; finished in 0.00s
```

**AC #7 — `grep -rn "Entry::new" apps/desktop/src-tauri/src`:**

```
apps/desktop/src-tauri/src/credentials.rs:15:    Entry::new(KEYRING_SERVICE, "aws_access_key_id")?.set_password(access_key)?;
apps/desktop/src-tauri/src/credentials.rs:16:    Entry::new(KEYRING_SERVICE, "aws_secret_access_key")?.set_password(secret_key)?;
apps/desktop/src-tauri/src/credentials.rs:17:    Entry::new(KEYRING_SERVICE, "aws_region")?.set_password(region)?;
apps/desktop/src-tauri/src/credentials.rs:22:    let access_key = Entry::new(KEYRING_SERVICE, "aws_access_key_id")
apps/desktop/src-tauri/src/credentials.rs:26:    let secret_key = Entry::new(KEYRING_SERVICE, "aws_secret_access_key")
apps/desktop/src-tauri/src/credentials.rs:30:    let region = Entry::new(KEYRING_SERVICE, "aws_region")
apps/desktop/src-tauri/src/credentials.rs:38:    Entry::new(KEYRING_SERVICE, "openai_api_key")?.set_password(api_key)?;
apps/desktop/src-tauri/src/credentials.rs:43:    Entry::new(KEYRING_SERVICE, "openai_api_key")
apps/desktop/src-tauri/src/credentials.rs:57:        if let Ok(entry) = Entry::new(KEYRING_SERVICE, name) {
apps/desktop/src-tauri/src/credentials.rs:64:    Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT).map_err(|e| AppError::Auth {
apps/desktop/src-tauri/src/credentials.rs:189:        Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT)
```

All 11 matches are in `credentials.rs` — sole-accessor rule holds. Line 189 is the malformed-JSON test inside this module's `#[cfg(test)]` block, which the story explicitly sanctions.

**AC #12 — token-logging grep:**

```
$ grep -rniE "access_token|id_token|refresh_token" apps/desktop/src-tauri/src "--include=*.rs" | grep -iE "info!|debug!|warn!|error!|println!"
(no output, exit 1)
```

No token value reaches any log macro. (Note: the glob must be quoted under zsh — unquoted `--include=*.rs` triggers `zsh: no matches found`.)

**Scope boundary — `git diff --stat` on the three target files:**

```
 apps/desktop/src-tauri/src/credentials.rs | 186 ++++++++++++++++++++++++++++++
 apps/desktop/src-tauri/src/error.rs       |  43 +++++++
 apps/desktop/src-tauri/src/models/mod.rs  |  67 +++++++++++
 3 files changed, 296 insertions(+)
```

**296 insertions, 0 deletions** — proves AC #13 mechanically: nothing pre-existing was removed or rewritten in any of the three files.

**AC #13 — head of `git diff apps/desktop/src-tauri/src/credentials.rs`:**

```
@@ -1,6 +1,11 @@
 use keyring_core::{Entry, Error};
 
+use crate::error::AppError;
+use crate::models::CognitoSession;
+
 const KEYRING_SERVICE: &str = "nkbaz-finance";
+const KEYRING_AUTH_SERVICE: &str = "nixus-auth";
+const KEYRING_AUTH_ACCOUNT: &str = "cognito-session";
 
 pub fn store_aws_credentials(
@@ -54,3 +59,184 @@ pub fn clear_credentials() {
         }
     }
 }
+
+fn auth_entry() -> Result<Entry, AppError> {
```

Only two hunks, both additive: imports/constants above the untouched `KEYRING_SERVICE`, and new code appended after `clear_credentials()`'s closing brace. `clear_credentials()` and the four AI functions are unchanged.

### Review Findings

**Reviewer:** adversarial code review (`bmad-code-review`) · **Date:** 2026-08-09 · **Scope reviewed:** `models/mod.rs`, `error.rs`, `credentials.rs` (+296/-0)

#### Verdict

**ZERO BLOCKING FINDINGS.** All 15 acceptance criteria are met, every feature-wide guardrail holds, and the security requirement (no token / blob / serde-error ever reaching a message, `Display`, log, or panic on a shipping path) is satisfied — verified by reading the code and the vendored `keyring-core` source, not by trusting the Dev Agent Record. Nothing in this section requires a fix before merge. The four items below are NON-BLOCKING notes only.

#### Independent verification performed (not taken on trust)

| Check | Command / method | Result |
|---|---|---|
| Zero warnings | `cargo clean -p nkbaz-finance && cargo check` — forced a **real full recompile**, not a cached no-op | `Finished dev profile in 7.27s`, **0 warnings** ✅ |
| Allows are load-bearing, none gratuitous | `cargo rustc --lib -- --force-warn dead_code` (overrides `#[allow]`) | Reveals 9 items that *would* warn. With the 3 mandated function allows in place, `KEYRING_AUTH_SERVICE`, `KEYRING_AUTH_ACCOUNT`, `auth_entry`, `CognitoSession`, and `AppError::Auth` all become live roots and go silent; **only `AuthState` remains dead** → the 4th allow is genuinely required and **no allow was added for a warning that did not fire** ✅ (AC #14) |
| No blanket allow | `grep -rn "allow(dead_code)\|#!\[allow"` | Exactly 4 item-scoped allows (`credentials.rs:71,86,109`, `models/mod.rs:751`), each with a `// WHY` naming its consuming story. **No `#![allow]` anywhere** ✅ |
| Tests | `cargo test` | **285 passed; 0 failed** — 14 new (7 credentials, 3 error, 4 models) ✅ (AC #15) |
| Keyring sole-accessor | `grep -rn "keyring_core\|keyring::\|Entry::new"` | `Entry::new` = 11 matches, **all** in `credentials.rs`. `keyring_core` only at `credentials.rs:1,132`; `keyring::` only at `lib.rs:44` (untouched bootstrap) ✅ (AC #7) |
| Correct crate / no dep drift | `Cargo.toml` | Not in `git status`. Still `keyring = "4"`, `keyring-core = "1"`, `version = "0.3.2"`. No dep added or bumped, no version bump ✅ |
| Namespace isolation | diff + test | `KEYRING_SERVICE` untouched at `:6`; new `nixus-auth`/`cognito-session` consts at `:7-8`; `"cognito-session"` **not** added to `clear_credentials()`'s name array; 0 deletions in the diff proves the 5 existing AI functions are byte-for-byte unchanged ✅ (AC #13) |
| `AuthState` wire shape | `models/mod.rs:747-758` + 4 tests | `#[serde(tag = "status")]`, **no** `rename_all`, **no** `skip_serializing_if`. Tests assert the literal strings incl. `{"status":"LoggedIn","email":"user@example.com","name":null}` ✅ (AC #2, #3) |
| `CognitoSession` field types | `models/mod.rs:736-745` | `expires_at: i64` (not ISO-8601 `String`), `refresh_token: String` (not `Option`), derives exactly `Debug, Clone, Serialize, Deserialize`, appended at EOF ✅ (AC #1) |
| `AppError::Auth` | `error.rs:9, 22, 64-71` | Extends the **existing hand-written** `impl Serialize` via `serialize_map(Some(3))` in the neighbouring style; arm added to **both** exhaustive matches. No `thiserror`, no `AppResult<T>`, no parallel error enum (`grep -rn "AppResult\|thiserror"` → nothing) ✅ (AC #4, #5) |
| No `unwrap`/`panic` on non-test paths | `grep -n` line numbers | Every hit is ≥ line 132, i.e. inside `#[cfg(test)] mod tests` (opens at `credentials.rs:120`) ✅ (AC #11) |
| `recoverable` table | `credentials.rs:64-117` | Matches AC #11 row-for-row: malformed JSON `true`, non-`NoEntry` read `true`, serialize failure `false`, `Entry::new` failure `false`, non-`NoEntry` delete `false` ✅ |
| Scope containment | `git status --porcelain` | Under `apps/`: **only** the 3 target files. No `commands/*`, `lib.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, or `apps/desktop/src/**`. `architecture-entitlements-licensing.md` and the other dirty planning docs are pre-existing (excluded per review brief) ✅ |

#### Security verification — token leakage (highest priority, verified line-by-line)

The dev's claim that "the blob and the serde error are deliberately never interpolated" is **true**, and the interpolation that *does* exist is also safe:

- `credentials.rs:102-105` — the serde failure closure is `|_|` and the message is a fixed literal. The blob (`json`) is never referenced in any message. `credentials.rs:73-76` likewise. ✅ (AC #9)
- Zero `tracing::`/`info!`/`debug!`/`warn!`/`error!`/`println!` calls exist in any of the three files. ✅ (AC #12)
- The four `format!("… {}", e)` sites (`:65, :80, :93, :114`) interpolate **`keyring_core::Error`, not the secret**. I read `keyring-core-1.0.0/src/error.rs:78-113` to confirm its `Display` cannot surface stored bytes: `BadEncoding(_)` deliberately discards the bytes ("Password data is not valid UTF-8"); `BadDataFormat(_, err)` prints only the platform error, never the blob; `PlatformFailure`/`NoStorageAccess` print only the platform error; `TooLong`/`Invalid`/`BadStoreFormat`/`NotSupportedByStore` print attribute names and reasons. `Ambiguous(Vec<Entry>)` prints `{items:?}` — I checked the shipping stores: `apple-native-keyring-store-1.0.0/src/keychain.rs:63-67` `Cred` holds only `{domain, service, account}` (no secret), and the macOS keychain store never returns `Ambiguous` at all. **No shipping path leaks a token.** ✅
- `error.rs:22` `Display` prints only the caller-authored `message` — never a token. ✅

#### NON-BLOCKING notes (no fix required for this story)

1. **`set_password` failure is classified `recoverable: false` while the analogous read failure is `true`** — `credentials.rs:79-82` vs `:91-95`. AC #11's table has **no row for `set_password` failure**, so this is an unspecified choice, not a violation. But a locked/unavailable keychain is the same transient condition the read path explicitly calls "transient; retry or re-sign-in resolves it", so Story 26.4 will surface a non-retryable error for a retryable cause. *Suggested for 26.4, not now:* consider `recoverable: true` for the `set_password` path, or leave it and let 26.4 own the retry decision.
2. **`CognitoSession` derives `Debug`, so `{:?}` prints all four tokens** — mandated verbatim by AC #1, so this is not a defect here. Two forward-looking consequences: (a) `credentials.rs:202`'s `panic!("… got {:?}", other)` would print session fields on test failure (values are the fakes `"at"/"it"/"rt"`, and only on a failing test, so harmless today); (b) Stories 26.4/26.5 must never `tracing::*("{:?}", session)`. *Suggested:* have 26.4/26.5 add a hand-written redacting `Debug` if a logging need ever appears.
3. **The reverse isolation direction is untested** — `clear_cognito_session_leaves_ai_credentials_intact` (`:223`) proves sign-out does not wipe AI keys, which is what AC #13 demands. The regression gate's other half ("clearing AI credentials must never sign the user out") is guaranteed structurally (`clear_credentials()` iterates 4 fixed names under `KEYRING_SERVICE`, verified unchanged) but has no test. *Suggested:* a 3-line `clear_credentials_leaves_cognito_session_intact` test whenever this file is next touched.
4. **`guard()` adds `clear_credentials()` (`credentials.rs:137`) beyond the bootstrap the Dev Notes specified "exactly as given"** — a disclosed, benign deviation that makes test #7 more deterministic. Confirmed **not** a real-keychain hazard: `keyring::use_native_store` exists only inside `lib.rs`'s Tauri `setup()`, which never runs under `cargo test`, and `keyring_core::set_default_store` (lib.rs:65) unconditionally overwrites via `RwLock`, so `STORE_INIT.call_once` always installs the mock before any clearing. Developer keychain entries are never at risk.

#### Concurrency audit — the test guard is sound, not flaky

- `Once::call_once` installs the mock **before** the mutex is taken, and `Once` blocks late arrivals until init completes, so no test can ever run against `NoDefaultStore`.
- `TEST_LOCK` (`OnceLock<Mutex<()>>`) yields a `'static` guard; the lock is held across the clearing **and** the whole test body (`let _g = guard();` binds, not drops — correctly avoids the `let _ =` foot-gun).
- Poison recovery (`unwrap_or_else(|p| p.into_inner())`) prevents one failing test from cascading.
- **No other keyring-touching test exists in the crate to race with it** — verified: `ai/mod.rs` (the only other `credentials::` consumer, at `:33` and `:66`) has no `#[cfg(test)]` module, and the three test modules under `commands/` do not touch credentials. All 7 keyring tests serialize on the same mutex. Cannot flake under the parallel harness.
- Latent (not present today): the mock is installed process-globally, so if a future test installs a different store *after* `STORE_INIT` has already fired, these tests would silently target it. Worth a comment when Epic 26 adds more keyring tests.

#### Explicitly checked and found compliant (no finding)

Tests are **not gamed** — the models/error tests assert exact JSON literals (they would fail immediately if `rename_all`, `skip_serializing_if`, or a different `type` tag were introduced), the malformed-JSON test writes real junk through `Entry` and asserts the message does **not** contain it, and the AI-isolation test exercises both namespaces end-to-end against the same store. No hard-coded expectation bypasses real logic. Correct-by-design and excluded from findings per the review brief: unused/uncalled code (zero-surface story), no JWKS/JWT verification, no SQLite persistence, `keyring_core` over the stale docs' `keyring::Entry`, absent `rustfmt`, and the pre-existing dirty planning documents.

### Change Log

| Date | Change |
|------|--------|
| 2026-08-09 | Story created from epics-login.md Epic 26 / Story 26.2; status set to ready-for-dev |
| 2026-08-09 | Implemented all 6 tasks: `CognitoSession` + `AuthState` in `models/mod.rs`, `AppError::Auth` across enum/`Display`/hand-written `Serialize` in `error.rs`, and `store`/`load`/`clear_cognito_session` + `nixus-auth` namespace in `credentials.rs`. 14 new unit tests; suite 285 passed / 0 failed; `cargo build` and `cargo check` both zero warnings. 3 files modified, 0 created, 296 insertions / 0 deletions. Status set to review. |

