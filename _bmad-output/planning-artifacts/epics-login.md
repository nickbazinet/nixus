---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
requirementsConfirmed: true
epicsApproved: true
storiesApproved: true
validated: true
inputDocuments:
  - architecture-login.md
  - architecture-credentials.md
  - architecture-entitlements-licensing.md
  - docs/project-context.md
scope: login
parentDocument: architecture-desktop.md
---

# nixus - Login / User Identity Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nixus Login / User Identity feature, decomposing the requirements embedded in `architecture-login.md` into implementable stories. Scoped addendum — parent epics live in `epics.md`; this file follows the same pattern as `epics-car-maintenance.md` and `epics-budget-templates.md`.

**No PRD exists for this feature and none is planned.** `architecture-login.md` carries a confirmed working brief plus its own numbered FR1–FR4 / NFR1–NFR4 set (see its "Project Context Analysis" section), and that set is the authoritative requirements source used below. **These identifiers are login-scoped**: they are local to `architecture-login.md` and are *not* the global PRD's FR1–FR4/NFR1–NFR4 (which cover budget management). Wherever this document says "FR2" it means "login FR2".

**No UX design specification exists for this feature.** `ux-design-specification.md` predates this feature and contains no UX-DRs for the account prompt, header profile entry point, or profile panel. UX decisions that were already fixed in `architecture-login.md` (popup cadence, top-right header entry point, panel-not-route profile) are carried into acceptance criteria verbatim; anything beyond those is flagged for UX review inside the relevant story rather than invented here.

## Requirements Inventory

### Functional Requirements

- FR1: User can create a Cognito account (email/password) or sign in with Google via Cognito federated identity.
- FR2: Existing (pre-feature) users see a one-time-per-session-ish popup offering "Create Account" or "Continue Offline" — informational only, no feature gating today.
- FR3: Logged-in user sees a minimalist Profile view (identity info, sign out).
- FR4: Login system is architecturally independent from entitlements/licensing (Keygen/LemonSqueezy) — no shared state, no shared "account" concept in code or data model.

### NonFunctional Requirements

- NFR1: Local-first posture preserved — no functionality regresses or requires network access if the user stays "Offline."
- NFR2: Tokens/credentials stored via OS-level secure storage (keyring), consistent with existing AI-key pattern — never in webview local storage.
- NFR3: Low ops burden — reuse managed AWS services (Cognito hosted infra), avoid building custom auth backend.
- NFR4: Design must not preclude future use of the Cognito `sub` as a stable identity key for later cloud features (sync, notifications, community) — but build none of that infrastructure now.
- Inherited: all user-facing strings available in English and French with no missing translation keys in shipped views (platform-wide i18n rule from `docs/project-context.md`).

### Additional Requirements

- **Not a greenfield starter:** extend the existing Tauri 2 / React 19 / Rust desktop app at `apps/desktop/` — no scaffolding story. No starter template applies.
- **No new AWS infrastructure in this repo:** the Cognito User Pool, public app client, hosted domain, and Google social IdP are provisioned out-of-band in the AWS Console/CLI, exactly as AWS Bedrock is already treated (no IaC checked in).
- **New dependencies:** `tauri-plugin-deep-link` (captures `nixus://auth/callback`) and `tauri-plugin-single-instance` (required so a Windows deep-link redirect routes to the running process instead of spawning a duplicate app window — must be registered *before* `tauri_plugin_deep_link::init()`), plus `@tauri-apps/plugin-deep-link` on the frontend.
- **Explicitly not added:** `aws-sdk-cognitoidentityprovider` — Cognito's Hosted UI and OAuth2 endpoints are plain REST/OAuth; reuse `reqwest`, `tauri-plugin-opener`, and `keyring` instead.
- **OAuth flow:** public app client with **no client secret**, Authorization Code grant + PKCE (`code_challenge_method=S256`), plus a per-attempt random `state` verified on callback for CSRF protection. Implicit grant is not used.
- **Token exchange is Rust-only:** `POST https://<domain>.auth.<region>.amazoncognito.com/oauth2/token` via `reqwest` from `commands/auth.rs`. The webview never holds Cognito credentials nor makes token requests.
- **Keyring sole-accessor rule (correction recorded in `architecture-login.md` step 5):** `credentials.rs` is the only module permitted to call `keyring_core::Entry`. `commands/auth.rs` must call new `credentials.rs` functions `store_cognito_session`, `load_cognito_session`, `clear_cognito_session` — never the keyring directly. Single entry: service `nixus-auth`, account `cognito-session`, value = JSON `{ access_token, id_token, refresh_token, expires_at }`.
- **New Rust models** in `models/mod.rs`: `CognitoSession { access_token, id_token, refresh_token, expires_at }` and `AuthState` = `LoggedOut | LoggedIn { email, name } | SessionExpired`, serialized with `#[serde(tag = "status")]`, `#[derive(Debug, Clone, Serialize, Deserialize)]`, `snake_case` fields.
- **New error variant:** `AppError::Auth { message: String, recoverable: bool }` — reusing the existing `recoverable` pattern (session expiry is recoverable; a malformed callback URL is not). No parallel auth error type.
- **New IPC surface** in `commands/auth.rs`, all `#[tauri::command(rename_all = "snake_case")]` returning `Result<T, AppError>` with no panics: `start_login`, `handle_auth_callback`, `get_auth_session`, `sign_out` — all registered in `lib.rs`'s `tauri::generate_handler!`.
- **Session refresh:** checked once on app launch via `get_auth_session` (`grant_type=refresh_token`), never polled. On success the keyring entry is updated in place. On failure the user is explicitly told the session expired — the app keeps working.
- **Sign-out:** clears the keyring entry only. Cognito `/oauth2/revoke` is deferred; refresh-token rotation stays disabled for v1.
- **Profile data source:** `id_token` JWT claims (`email`, `name`, `sub`) read at request time — no `GetUser` API call, no separate persistence, so there is no session/profile cache-invalidation concern. `sub` is the durable identity key (NFR4).
- **No SQLite work:** no new `db/` module, no migration, no table — session lives only in the keyring and profile fields come from JWT claims. No dismissal flag is persisted for the popup.
- **Frontend structure:** `hooks/useAuth.ts` (`useAuthSession`, `useSignIn`, `useSignOut`), `components/auth/AccountPromptDialog.tsx`, `components/auth/ProfileMenu.tsx`, mounted from `routes/__root.tsx`. New `queryKeys.auth.session` (`["auth", "session"]`) in `lib/constants.ts` and `AuthState` type in `lib/types.ts`.
- **Single source of truth:** both the popup and the header icon read the same `["auth", "session"]` query entry — no second auth state anywhere, so the two surfaces cannot drift.
- **Tauri event:** `auth:callback-received` (colon-namespaced) emitted from the deep-link handler; `useAuth.ts` listens and invalidates `["auth", "session"]`.
- **Non-secret config:** Cognito domain, client id, and region are non-secret and live in build-time constants / `tauri.conf.json`-adjacent config — only tokens go in the keyring.
- **Testing:** desktop has no Rust-side UI test framework and no frontend unit tests — Playwright E2E only, in `apps/desktop/tests/`. Cognito is not mocked (existing convention for external services); a dedicated test user pool/app client is a CI setup task, explicitly out of scope for these stories.
- **Documentation obligation:** `architecture-entitlements-licensing.md` must be amended to note that a login system now exists as an unrelated concern — its "no login form anywhere in the desktop app" statement is about licensing/entitlement checks and is *not* reversed. `architecture.md`'s stale April 2026 Cognito+DynamoDB+Stripe design remains superseded and must not be used as a reference.

### UX Design Requirements

No feature-specific UX design specification exists — this section is intentionally empty of UX-DRs. The UX constraints that *are* fixed come from `architecture-login.md`'s decisions and appear as acceptance criteria in Epic 27:

- Popup shows on **every launch** while no account exists (no persisted dismissal state); "Continue Offline" closes it for the current app session only.
- Login/profile entry point is a **small icon in the top-right app header/chrome** — the existing 9-item sidebar is untouched.
- Profile renders as a **panel/popover anchored to that icon**, not a `routes/profile.tsx` route.
- Copy must signal that future features may require an account, while making clear nothing is gated today.
- Profile icon reuses the existing bundled shared-UI icon set — no new static assets.

Visual specifics beyond the above (exact copy, dialog layout, icon choice) are flagged for UX review inside Stories 27.2 and 27.3 rather than specified here.

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 (login-scoped) | Epic 26 | Cognito Hosted UI + Google social IdP, PKCE login, deep-link callback, token exchange, secure session storage, refresh, sign-out |
| FR2 (login-scoped) | Epic 27 | `AccountPromptDialog` driven by `get_auth_session`, "Create Account" / "Continue Offline", no gating |
| FR3 (login-scoped) | Epic 27 | `ProfileMenu` header icon + minimalist profile panel from `id_token` claims, sign out |
| FR4 (login-scoped) | Epic 27 | Verified zero coupling to Keygen/LemonSqueezy + amendment to `architecture-entitlements-licensing.md` |

| NFR | Epic | How it is satisfied |
|-----|------|---------------------|
| NFR1 (local-first) | Epic 26, 27 | No feature gated by auth; refresh failure surfaces a notice only; E2E asserts full app usability after "Continue Offline" |
| NFR2 (secure storage) | Epic 26 | Keyring-only storage via `credentials.rs` sole-accessor; nothing in webview storage |
| NFR3 (low ops) | Epic 26 | Cognito Hosted UI is the entire backend — zero new AWS compute, no AWS SDK client-side |
| NFR4 (future identity key) | Epic 26 | `sub` claim captured and exposed as the durable id; no cloud/sync/notification infrastructure built |

## Epic List

### Epic 26: Cognito Account Sign-In
Users can create a nixus account with email/password or sign in with Google, and their session is securely stored and silently restored on every launch — with an explicit, non-blocking notice when it expires.
**FRs covered:** FR1 (login-scoped)
**NFRs addressed:** NFR2, NFR3, NFR4, NFR1 (no gating introduced)

### Epic 27: Account Prompt & Minimalist Profile
Users who have no account are invited (never forced) to create one on launch and can keep working offline, and signed-in users can see who they are and sign out from a top-right header entry point — with login proven independent of entitlements/licensing.
**FRs covered:** FR2, FR3, FR4 (login-scoped)
**NFRs addressed:** NFR1, inherited i18n rule

**Why two epics:** Epic 26 is entirely Rust/AWS with no user-visible surface; Epic 27 is entirely frontend and consumes Epic 26's finished IPC contract. They touch disjoint file sets (`src-tauri/**` vs. `apps/desktop/src/**`), so this split creates no file churn — and Epic 26 is independently verifiable via IPC before any UI exists. Epic 27 depends on Epic 26 but not the reverse; neither epic depends on a future epic.

---

## Epic 26: Cognito Account Sign-In

Users can create a nixus account with email/password or sign in with Google, and their session is securely stored and silently restored on every launch — with an explicit, non-blocking notice when it expires.

### Story 26.1: Cognito User Pool & Public App Client Setup

As a developer,
I want the AWS-side Cognito User Pool, PKCE public app client, hosted domain, and Google social IdP provisioned and documented,
So that the desktop app has a working OAuth endpoint to talk to before any code is written.

**Acceptance Criteria:**

**Given** the AWS Console/CLI for the nixus AWS account
**When** this story is implemented
**Then** a Cognito User Pool exists with email/password sign-up enabled and email as the sign-in attribute
**And** no infrastructure-as-code file is added to this repository (Cognito is provisioned out-of-band, matching how AWS Bedrock is already treated)

**Given** the new User Pool
**When** the app client is created
**Then** it is a **public** client with **no client secret**, with the Authorization Code grant enabled and the Implicit grant disabled
**And** PKCE with `code_challenge_method=S256` is the supported code-exchange method
**And** refresh token rotation is left **disabled** (v1 decision)

**Given** the app client's allowed callback and sign-out URLs
**When** configured
**Then** the callback URL is exactly `nixus://auth/callback` and the sign-out URL is exactly `nixus://auth/signout`
**And** the requested OAuth scopes include `openid`, `email`, and `profile` so that `sub`, `email`, and `name` are present in the `id_token`

**Given** Google as a federated provider
**When** configured
**Then** Google is registered as a **social IdP on the Cognito Hosted UI / Managed Login** and enabled for this app client
**And** nixus never calls Google APIs directly — Cognito owns the federation

**Given** the hosted domain
**When** configured
**Then** `https://<domain>.auth.<region>.amazoncognito.com` serves the Hosted UI, and both the email/password form and the "Continue with Google" button render on it

**Given** the non-secret configuration values (domain, client id, region)
**When** this story completes
**Then** they are recorded where the app can read them at build time (build-time constants or a `tauri.conf.json`-adjacent config file), **not** in the keyring, and **not** committed as secrets
**And** the sign-in and Google flows are manually verified end-to-end in a browser against the Hosted UI, redirecting to `nixus://auth/callback` with a `code` and `state` in the query string

**Given** zero new AWS compute is permitted for this feature (NFR3)
**When** this story completes
**Then** no Lambda, API Gateway, or DynamoDB resource has been created — Cognito's own endpoints are the entire backend

### Story 26.2: Auth Models, Error Variant & Secure Session Storage

As a developer,
I want the `CognitoSession`/`AuthState` models, an `AppError::Auth` variant, and keyring-backed session persistence inside `credentials.rs`,
So that every later auth story has one validated, sole-accessor storage primitive to build on.

**Acceptance Criteria:**

**Given** `apps/desktop/src-tauri/src/models/mod.rs`
**When** this story is implemented
**Then** it defines `CognitoSession { access_token: String, id_token: String, refresh_token: String, expires_at: i64 }` with `#[derive(Debug, Clone, Serialize, Deserialize)]` and `snake_case` fields, matching the existing model convention

**Given** the same file
**When** the frontend-facing session state is defined
**Then** it defines `AuthState` as `LoggedOut | LoggedIn { email: String, name: Option<String> } | SessionExpired` with `#[serde(tag = "status")]`, so the frontend receives plain tagged JSON such as `{ "status": "LoggedIn", "email": "...", "name": "..." }` with no custom envelope

**Given** `apps/desktop/src-tauri/src/error.rs`
**When** this story is implemented
**Then** `AppError` gains an `Auth { message: String, recoverable: bool }` variant reusing the existing `recoverable` pattern
**And** no parallel/duplicate auth error type is introduced anywhere

**Given** `apps/desktop/src-tauri/src/credentials.rs`
**When** this story is implemented
**Then** it gains `store_cognito_session(session: &CognitoSession) -> Result<(), AppError>`, `load_cognito_session() -> Result<Option<CognitoSession>, AppError>`, and `clear_cognito_session() -> Result<(), AppError>`
**And** all three use a single keyring entry with service `nixus-auth` and account `cognito-session`, storing the session as one JSON blob (atomic read/write)

**Given** the keyring sole-accessor rule from `architecture-credentials.md`
**When** this story is reviewed
**Then** `keyring_core::Entry` is referenced **only** inside `credentials.rs` — no other module in the codebase constructs a keyring entry for `nixus-auth`

**Given** no session has ever been stored
**When** `load_cognito_session()` is called
**Then** it returns `Ok(None)` rather than an error, so "never signed in" is a normal state and not a failure path

**Given** a keyring entry containing malformed or non-deserializable JSON
**When** `load_cognito_session()` is called
**Then** it returns `AppError::Auth { recoverable: true, .. }` (the user can simply sign in again) and never panics

**Given** `clear_cognito_session()` is called when no entry exists
**When** it executes
**Then** it succeeds idempotently rather than erroring

**Given** NFR2
**When** this story completes
**Then** no token value is written to SQLite, to any file in the app data directory, or to webview `localStorage`/`sessionStorage`

### Story 26.3: Deep Link & Single-Instance Plugin Registration

As a developer,
I want the `nixus://` custom URI scheme captured reliably on macOS and Windows,
So that a Cognito redirect reaches the already-running app instead of being lost or spawning a duplicate window.

**Acceptance Criteria:**

**Given** `apps/desktop/src-tauri/Cargo.toml`
**When** this story is implemented
**Then** it adds `tauri-plugin-deep-link` and `tauri-plugin-single-instance`
**And** `apps/desktop/package.json` adds `@tauri-apps/plugin-deep-link`
**And** `aws-sdk-cognitoidentityprovider` is **not** added

**Given** `apps/desktop/src-tauri/tauri.conf.json`
**When** this story is implemented
**Then** `plugins.deep-link.desktop.schemes` is set to `["nixus"]`
**And** `apps/desktop/src-tauri/capabilities/default.json` grants the `deep-link:default` permission

**Given** `apps/desktop/src-tauri/src/lib.rs`
**When** the plugins are registered
**Then** `tauri_plugin_single_instance::init()` is registered **first**, before `tauri_plugin_deep_link::init()`
**And** the single-instance handler focuses the existing window and forwards the received argv/URL to the running instance

**Given** a running app instance on Windows
**When** the OS opens `nixus://auth/callback?code=...&state=...`
**Then** the URL is delivered to the existing process and **no** second app window is created

**Given** a running app instance on macOS
**When** the OS opens the same URL
**Then** it is delivered to the existing process via the deep-link `onOpenUrl` path

**Given** the deep-link handler registered in this story
**When** a `nixus://` URL arrives
**Then** the handler records/forwards the received URL through a single well-named function seam that Story 26.4 replaces with the real token exchange
**And** this story is verifiable on its own: manually opening `nixus://auth/callback?code=test&state=test` while the app runs produces observable evidence (log line or emitted event) that the URL was received, with no dependency on any later story

**Given** the app is launched cold (not already running) by a `nixus://` URL
**When** it starts up
**Then** the URL is still captured after initialization rather than dropped silently

### Story 26.4: PKCE Login Launch & Callback Token Exchange

As a user,
I want to click sign-in and complete email/password or Google authentication in my system browser,
So that I end up signed in to nixus without ever typing credentials into the app itself.

**Acceptance Criteria:**

**Given** the new `apps/desktop/src-tauri/src/commands/auth.rs` module
**When** `start_login` is invoked
**Then** it generates a cryptographically random PKCE `code_verifier`, derives the `S256` `code_challenge`, generates a random `state`, and retains both verifier and state in memory for the pending attempt
**And** it builds the Cognito authorize URL (`/oauth2/authorize`) with `response_type=code`, `client_id`, `redirect_uri=nixus://auth/callback`, `scope=openid email profile`, `code_challenge`, `code_challenge_method=S256`, and `state`
**And** it opens that URL in the **system browser** via `tauri-plugin-opener` — never in an embedded webview
**And** it returns `Result<(), AppError>` with no panics, following `#[tauri::command(rename_all = "snake_case")]`

**Given** the Hosted UI opened by `start_login`
**When** the user completes either the email/password form or the Google button
**Then** Cognito redirects to `nixus://auth/callback` with `code` and `state`, and the Story 26.3 deep-link handler routes it to `handle_auth_callback` (FR1)

**Given** `handle_auth_callback` receives a callback URL whose `state` does not match the pending attempt's `state`
**When** it validates the callback
**Then** it aborts before any network call and returns `AppError::Auth { recoverable: false, .. }`, discarding the pending verifier

**Given** a callback URL that is malformed, missing `code`, or carries an OAuth `error` parameter
**When** `handle_auth_callback` processes it
**Then** it returns `AppError::Auth` with a user-presentable message and does not write anything to the keyring

**Given** a valid callback with a matching `state`
**When** `handle_auth_callback` exchanges the code
**Then** Rust `POST`s to `https://<domain>.auth.<region>.amazoncognito.com/oauth2/token` via `reqwest` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `code_verifier`
**And** the request carries **no client secret** (public client)
**And** the exchange happens exclusively in Rust — no token request originates from the frontend/webview

**Given** a successful token response
**When** the session is persisted
**Then** `handle_auth_callback` builds a `CognitoSession` (computing `expires_at` from the response's `expires_in`) and calls `credentials.rs::store_cognito_session` — it never touches `keyring_core::Entry` directly

**Given** a successful token exchange and store
**When** the frontend needs to react
**Then** the app emits the Tauri event `auth:callback-received`

**Given** a failed token exchange (network error or non-2xx from Cognito)
**When** `handle_auth_callback` returns
**Then** it returns `AppError::Auth` with a recoverable flag appropriate to the failure, leaves any previously stored session untouched, and does not crash the app

**Given** the new commands
**When** registered
**Then** `start_login` and `handle_auth_callback` appear in `lib.rs`'s `tauri::generate_handler!` macro

**Given** the token exchange succeeds
**When** the tokens are logged or traced
**Then** no access, id, or refresh token value is written to application logs

### Story 26.5: Session Read, Launch Refresh & Sign-Out Commands

As a user,
I want my session restored automatically when I reopen nixus, to be told plainly when it has expired, and to be able to sign out,
So that staying signed in is effortless and signing out is complete.

**Acceptance Criteria:**

**Given** the `get_auth_session` command
**When** invoked and no session is stored
**Then** it returns `AuthState::LoggedOut` — not an error

**Given** a stored session whose `expires_at` is still in the future
**When** `get_auth_session` is invoked
**Then** it returns `AuthState::LoggedIn { email, name }` with values read from the `id_token` JWT claims at request time — no `GetUser` API call and no separate persistence of profile fields (FR3 data source)
**And** the `sub` claim is parsed and available as the durable identity key without any cloud/sync/notification infrastructure being introduced (NFR4)

**Given** a stored session whose access/id token has expired
**When** `get_auth_session` is invoked on app launch
**Then** Rust `POST`s to `/oauth2/token` with `grant_type=refresh_token` and, on success, updates the existing `nixus-auth` keyring entry in place via `credentials.rs::store_cognito_session` and returns `AuthState::LoggedIn`

**Given** the refresh call fails or the refresh token is rejected/expired
**When** `get_auth_session` resolves
**Then** it returns `AuthState::SessionExpired` (never a hard error that blocks app startup) so the UI can explicitly tell the user to sign in again (Story 27.3)
**And** every non-auth feature of the app remains fully usable (NFR1)

**Given** the local-first, no-unnecessary-network posture
**When** the app is running
**Then** the session is refreshed only on launch via `get_auth_session` — no polling loop, no background timer

**Given** the machine is offline
**When** `get_auth_session` is invoked with a stored session
**Then** the command returns within a bounded time (a network timeout is applied, not an indefinite hang) and resolves to `SessionExpired` rather than hanging app startup

**Given** the `sign_out` command
**When** invoked
**Then** it calls `credentials.rs::clear_cognito_session`, discards any in-memory session state, and returns `Ok(())`
**And** Cognito's `/oauth2/revoke` is **not** called (explicitly deferred for v1)

**Given** `sign_out` completed
**When** `get_auth_session` is invoked afterwards
**Then** it returns `AuthState::LoggedOut`, and no `nixus-auth` keyring entry remains on the system

**Given** the new commands
**When** registered
**Then** `get_auth_session` and `sign_out` join `start_login` and `handle_auth_callback` in `lib.rs`'s `tauri::generate_handler!` macro

**Given** no SQLite work is in scope for this feature
**When** this story completes
**Then** no migration file, no `db/` module, and no new table has been added

---

## Epic 27: Account Prompt & Minimalist Profile

Users who have no account are invited (never forced) to create one on launch and can keep working offline, and signed-in users can see who they are and sign out from a top-right header entry point — with login proven independent of entitlements/licensing.

### Story 27.1: Frontend Auth Session Hook & Query Key

As a developer,
I want a single `useAuth.ts` hook exposing session state and sign-in/sign-out mutations,
So that every auth UI surface reads one TanStack Query cache entry and cannot drift out of sync.

**Acceptance Criteria:**

**Given** `apps/desktop/src/lib/constants.ts`
**When** this story is implemented
**Then** it adds `queryKeys.auth.session` resolving to `["auth", "session"]`, following the existing key convention
**And** no component or hook hardcodes `["auth", "session"]` inline anywhere

**Given** `apps/desktop/src/lib/types.ts`
**When** this story is implemented
**Then** it defines an `AuthState` TypeScript type mirroring the Rust enum as a discriminated union on `status`: `{ status: "LoggedOut" } | { status: "LoggedIn"; email: string; name: string | null } | { status: "SessionExpired" }`

**Given** `apps/desktop/src/hooks/useAuth.ts`
**When** implemented
**Then** it exports `useAuthSession()` as a TanStack Query hook invoking `get_auth_session` under `queryKeys.auth.session`
**And** it exports `useSignIn()` and `useSignOut()` mutations invoking `start_login` and `sign_out` with `snake_case` arguments
**And** `useSignOut()` invalidates `queryKeys.auth.session` on success

**Given** the `auth:callback-received` Tauri event emitted in Story 26.4
**When** the app is running
**Then** `useAuth.ts` registers a listener for it and invalidates `queryKeys.auth.session` when it fires, so the UI reflects a completed browser sign-in without a manual refresh
**And** the listener is unsubscribed on unmount (no duplicate listeners across re-renders)

**Given** the module boundary rule
**When** this story is reviewed
**Then** `useAuth.ts` is the **only** frontend module calling `invoke` for `start_login`, `get_auth_session`, or `sign_out` — no component invokes an auth command directly

**Given** `get_auth_session` returns an `AppError::Auth`
**When** `useAuthSession()` resolves
**Then** the error is exposed through standard TanStack Query error state and does not throw an unhandled rejection or blank the app shell

### Story 27.2: Account Prompt Dialog with Continue Offline

As an existing user without an account,
I want a launch-time prompt offering to create an account or continue offline,
So that I learn an account now exists and may unlock future features, without losing access to anything today.

**Acceptance Criteria:**

**Given** the app launches and `useAuthSession()` resolves to `{ status: "LoggedOut" }`
**When** the app shell renders
**Then** `components/auth/AccountPromptDialog.tsx` is displayed, built on the existing shared `Dialog` primitive from `@nixus/shared/ui` (FR2)

**Given** `useAuthSession()` resolves to `LoggedIn`
**When** the app shell renders
**Then** the dialog is **not** displayed

**Given** `useAuthSession()` is still loading
**When** the app shell renders
**Then** the dialog does not flash open before the first resolution

**Given** the dialog is displayed
**When** the user reads it
**Then** it offers exactly two actions — "Create Account" and "Continue Offline"
**And** the copy states that no feature currently requires an account, while signalling that future features (such as mobile notifications, photo sync, and community features) may
**And** all copy comes from i18n keys present in both `locales/en.json` and `locales/fr.json`, with no missing keys

**Given** the user clicks "Create Account"
**When** the action fires
**Then** `useSignIn()` is called (opening the Cognito Hosted UI in the system browser per Story 26.4) and the dialog closes or shows a neutral pending state rather than blocking the app

**Given** the user clicks "Continue Offline"
**When** the action fires
**Then** the dialog closes for the current app session only
**And** **no** dismissal flag is persisted — no new SQLite table, no settings row, no local-storage key

**Given** the user chose "Continue Offline" and later relaunches the app while still having no account
**When** the app starts
**Then** the dialog is shown again (every-launch cadence, per the architecture decision)

**Given** the user has dismissed the dialog with "Continue Offline"
**When** they use the app
**Then** every existing feature — budget, expenses, accounts, net worth, AI, maintenance — behaves exactly as before, with no gating, no degraded state, and no network requirement (NFR1)

**Given** no UX specification covers this dialog
**When** it is implemented
**Then** the exact copy and layout are flagged for UX review, noting that cadence ("every launch until an account exists") and the two-action structure are fixed architectural decisions and not open for redesign

### Story 27.3: Header Profile Menu & Minimalist Profile View

As a signed-in user,
I want a small profile entry point in the top-right of the app header that shows who I am and lets me sign out,
So that my identity is visible and reversible without hunting through settings.

**Acceptance Criteria:**

**Given** `apps/desktop/src/routes/__root.tsx`
**When** this story is implemented
**Then** `components/auth/ProfileMenu.tsx` is mounted as a small icon in the **top-right of the app header/chrome**
**And** the existing 9-item sidebar navigation is unchanged — no sidebar entry is added

**Given** `useAuthSession()` has not yet resolved
**When** the header renders
**Then** the icon shows a neutral/loading state (standard TanStack Query `isLoading` handling) and does not flicker between logged-in and logged-out appearances

**Given** `useAuthSession()` resolves to `LoggedOut`
**When** the header renders
**Then** the icon shows a generic sign-in affordance, and activating it calls `useSignIn()`

**Given** `useAuthSession()` resolves to `LoggedIn`
**When** the user activates the icon
**Then** a minimalist profile **panel/popover anchored to the icon** opens showing the account email, the name when present, and a sign-out action (FR3)
**And** it is not implemented as a `routes/profile.tsx` route or a full page

**Given** the profile panel is open with a `LoggedIn` session whose `name` claim is absent
**When** it renders
**Then** it degrades gracefully to email-only without rendering an empty or `null` name row

**Given** `useAuthSession()` resolves to `SessionExpired`
**When** the header renders
**Then** the user is explicitly told the session expired and they should sign in again (via the icon state and/or a toast) — the session is never silently dropped
**And** the rest of the app remains fully functional while in this state (NFR1)

**Given** the user activates sign-out from the panel
**When** `useSignOut()` succeeds
**Then** `queryKeys.auth.session` is invalidated, the header returns to its logged-out appearance, and the profile panel closes

**Given** both `AccountPromptDialog` and `ProfileMenu` are mounted
**When** the session state changes from any source (sign-in callback event, sign-out, launch refresh)
**Then** both surfaces re-render from the same `["auth", "session"]` cache entry, and neither holds its own copy of auth state

**Given** the icon and panel need an icon asset
**When** implemented
**Then** it reuses the existing icon set already bundled in the shared UI package — no new static asset is added

**Given** all user-facing strings in the panel
**When** implemented
**Then** they resolve from i18n keys present in both `locales/en.json` and `locales/fr.json`, with no missing keys
**And** the exact icon choice and panel layout are flagged for UX review, since no UX-DR specifies them (the top-right placement and panel-not-route form are fixed architectural decisions)

### Story 27.4: Auth E2E Coverage & Licensing Independence Amendment

As a maintainer,
I want end-to-end coverage of the offline/profile paths plus a written record that login and licensing are separate systems,
So that the local-first guarantee is enforced by tests and nobody re-conflates login with entitlements later.

**Acceptance Criteria:**

**Given** `apps/desktop/tests/` (Playwright E2E is the only test framework for the desktop app)
**When** this story is implemented
**Then** a new spec covers: launching with no session shows `AccountPromptDialog`; "Continue Offline" closes it; and a core existing flow (for example viewing the budget or dashboard) still works afterwards with no auth gating (NFR1)

**Given** the same spec file
**When** the header entry point is exercised
**Then** it asserts the logged-out header icon renders and that no auth-related error state is displayed on a clean, never-signed-in profile

**Given** external services are not mocked in this project's E2E suite
**When** the sign-in path is covered
**Then** the test asserts only up to the point of launching the external Hosted UI (the browser-side Cognito/Google interaction is out of scope for E2E)
**And** the need for a dedicated test Cognito user pool/app client is recorded as a CI setup task, explicitly outside this story's deliverable

**Given** `_bmad-output/planning-artifacts/architecture-entitlements-licensing.md`
**When** this story is implemented
**Then** it gains an amendment noting that a login/user-identity system now exists as an **unrelated** concern
**And** the amendment states explicitly that its "no login form anywhere in the desktop app" rule was about licensing/entitlement checks and is **not** reversed — the LemonSqueezy + Keygen design is unchanged (FR4)

**Given** the independence requirement (FR4)
**When** the codebase is audited as part of this story
**Then** it is confirmed and recorded that login and entitlements share no Rust module, no frontend hook, no query key, no database table, and no "account" concept
**And** any violation found is fixed rather than documented as acceptable

**Given** `architecture.md`'s superseded April 2026 Cognito + DynamoDB + Stripe design
**When** this story completes
**Then** the amendment/notes direct future readers to `architecture-login.md` as the sole reference for login questions, keeping the stale section clearly marked as not authoritative

**Given** the deferred items recorded in `architecture-login.md`
**When** this story completes
**Then** token revocation via `/oauth2/revoke`, refresh-token rotation, and all cloud sync/notification/community work remain explicitly out of scope and are not implemented here

---
