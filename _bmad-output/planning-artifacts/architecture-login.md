---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['docs/project-context.md', '_bmad-output/planning-artifacts/architecture-entitlements-licensing.md', '_bmad-output/planning-artifacts/architecture.md', '_bmad-output/planning-artifacts/architecture-credentials.md']
workflowType: 'architecture'
project_name: 'nixus'
user_name: 'Nbazinet'
date: '2026-08-09'
lastStep: 8
status: 'complete'
completedAt: '2026-08-09'
---

# Architecture Decision Document: Login / User Identity Feature

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Feature Brief (working, no formal PRD)

- **Goal:** Introduce user identity (login) as a foundation for future features — mobile push notifications, photo sync, community features. No cloud data sync is in scope yet.
- **Identity provider:** AWS Cognito, with email/password and Google as a federated sign-in option.
- **Existing (no-account) users:** shown a popup prompting them to create an account or continue "Offline." This is purely informational/messaging for now — no feature is gated by login status today. Copy signals that future features may require an account.
- **Profile:** a minimalist "User Profile" surface in the app once logged in.
- **Explicitly separate from** `architecture-entitlements-licensing.md` (LemonSqueezy + Keygen). That document's "no login form anywhere in the desktop app" statement is about licensing/entitlement checks specifically and needs an amendment noting a login system now exists as an unrelated concern — not a reversal of the licensing design.
- **Historical context:** `architecture.md` (April 2026) contains a stale, never-implemented Cognito + DynamoDB + Stripe design coupled to licensing — superseded for licensing purposes; may contain reusable Cognito/Tauri technical patterns but was not designed for this separate, narrower scope.

## Project Context Analysis

### Requirements Overview

**Functional Requirements (derived from working brief, no formal PRD):**
- FR1: User can create a Cognito account (email/password) or sign in with Google via Cognito federated identity.
- FR2: Existing (pre-feature) users see a one-time-per-session-ish popup offering "Create Account" or "Continue Offline" — informational only, no feature gating today.
- FR3: Logged-in user sees a minimalist Profile view (identity info, sign out).
- FR4: Login system is architecturally independent from entitlements/licensing (Keygen/LemonSqueezy) — no shared state, no shared "account" concept in code or data model.

**Non-Functional Requirements:**
- NFR1: Local-first posture preserved — no functionality regresses or requires network access if the user stays "Offline."
- NFR2: Tokens/credentials stored via OS-level secure storage (keyring), consistent with existing AI-key pattern — never in webview local storage.
- NFR3: Low ops burden — reuse managed AWS services (Cognito hosted infra), avoid building custom auth backend.
- NFR4: Design must not preclude future use of the Cognito `sub` as a stable identity key for later cloud features (sync, notifications, community) — but build none of that infrastructure now.

### Scale & Complexity

- Primary domain: Desktop (Tauri 2 / React 19 / Rust), AWS Cognito as external IdP
- Complexity level: Medium
- Estimated architectural components: Cognito user pool + Google IdP config (AWS-side), Rust-side auth/session commands + keyring-backed token store, OAuth/PKCE flow handling in a native webview, React auth state + Profile UI, offline/no-account popup + dismissal state persistence

### Technical Constraints & Dependencies

- No existing backend for user data — Cognito used purely as IdP for this pass, not paired with any user-data table/API.
- Must coexist with, not touch, the LemonSqueezy + Keygen entitlements/licensing system and its data.
- Native desktop app (not a browser) — standard web OAuth redirect flow doesn't apply directly; needs a Tauri-compatible auth flow (e.g., system browser + custom URI scheme deep link, or an in-app webview flow) for the Cognito Hosted UI / Google consent screen.
- Existing precedent for secret storage: `keyring` crate (already used for AI provider API keys).

### Cross-Cutting Concerns Identified

- Token lifecycle (access/id/refresh, expiry, refresh-on-launch) surfaced consistently across Rust IPC layer and React query/auth state.
- "Never signed in" vs. "signed in before, now offline/signed out" are distinct UX states for the popup.
- Amendment required to `architecture-entitlements-licensing.md` to note login's existence without altering its licensing design.

## Starter Template Evaluation

### Primary Technology Domain

Existing brownfield desktop app (Tauri 2 / React 19 / Rust) — no starter template applies.

### Technology Additions for This Feature

- **New dependency:** `tauri-plugin-deep-link` (official Tauri v2 plugin) — captures the OAuth redirect via custom URI scheme (`nixus://auth/callback`), supported on macOS + Windows (nixus's target platforms).
- **Reused, no new dependency:** `tauri-plugin-opener` (open Cognito Hosted UI in system browser), `reqwest` (token exchange REST calls), `keyring` (secure token storage — same pattern as AI provider keys).
- **Explicitly not adding:** `aws-sdk-cognitoidentityprovider` — Cognito Hosted UI + OAuth2 endpoints are plain REST/OAuth, no AWS SDK required client-side, keeps the dependency footprint minimal.

### Rationale

Cognito Hosted UI abstracts Google federation entirely on the AWS side — the app only ever talks to Cognito's OAuth endpoints, never Google's. This is the standard, security-recommended desktop pattern (Authorization Code + PKCE, system-browser flow, no embedded webview credential entry) and reuses three of nixus's four required capabilities from the existing dependency graph.

### Auth Flow Summary

1. Open Cognito's hosted sign-in page in the system browser (`tauri-plugin-opener`).
2. Cognito redirects back to a custom URI scheme (`nixus://auth/callback`) — captured via `tauri-plugin-deep-link`.
3. Rust exchanges the authorization code + PKCE verifier for tokens via Cognito's `/oauth2/token` REST endpoint (`reqwest`).
4. Tokens stored via `keyring`, following the existing AI-provider-key pattern.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Cognito app client type and grant (public client, Authorization Code + PKCE)
- Token storage shape and location (keyring, single JSON blob)
- Session refresh failure behavior (notify user explicitly)
- Popup display condition (every launch until an account exists — no persisted dismissal state needed)
- Profile/login entry point placement (top-right header icon)

**Important Decisions (Shape Architecture):**
- Frontend auth state pattern (TanStack Query, consistent with existing hook conventions)
- IPC command surface for auth

**Deferred Decisions (Post-MVP, explicitly out of scope for this pass):**
- Any cloud data sync, push notifications, or community features — Cognito `sub` is the future join key, but no infrastructure for these is built now
- Token revocation via Cognito's `/oauth2/revoke` on sign-out — nice-to-have, not blocking (local token deletion is sufficient for v1)
- Refresh token rotation handling — Cognito supports optional refresh token rotation; not enabled for v1 to keep the refresh flow simple (single long-lived refresh token, default rotation OFF)

### Authentication & Security

- **App client type:** Public client, **no client secret** — required for PKCE; a desktop app cannot safely store a client secret. Confirmed via AWS Cognito docs (public clients are for apps "without trusted server-side resources").
- **OAuth grant:** Authorization Code grant + PKCE (`code_challenge_method=S256`) — the AWS-recommended flow for native/desktop apps, supersedes the deprecated Implicit grant. A random `state` parameter is also generated per login attempt and verified on callback, as standard CSRF protection independent of PKCE (PKCE protects the code exchange; `state` protects the redirect itself).
- **Google federation:** Configured as a social IdP on the Cognito Hosted UI / Managed Login — nixus never talks to Google directly; Cognito owns the federation, keeping the app's OAuth surface to a single provider (Cognito).
- **Callback handling:** Custom URI scheme (`nixus://auth/callback`), captured via `tauri-plugin-deep-link`. No localhost redirect server needed since Cognito (not Google) is the direct OAuth party and accepts custom-scheme callback URLs.
- **Token exchange:** Rust-side `POST` to `https://<domain>.auth.<region>.amazoncognito.com/oauth2/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` — via `reqwest`. Never done from the frontend/webview.
- **Token storage:** Single `keyring` entry — service `nixus-auth`, account `cognito-session` — storing a JSON blob `{ access_token, id_token, refresh_token, expires_at }`. Atomic read/write, minimal keyring API surface, mirrors the existing AI-provider-key pattern in `architecture-credentials.md`.
- **Session refresh:** On app launch, if a stored session exists, Rust calls `/oauth2/token` with `grant_type=refresh_token`. On success, the keyring entry is updated in place.
- **Session refresh failure:** Explicit notification — the app surfaces a "your session expired, please sign in again" message (e.g. a toast, or state reflected in the profile icon) rather than silently dropping the session. The app itself continues to function fully (local-first); only the auth-related UI communicates the expired state.
- **Sign-out:** Rust command clears the `nixus-auth` keyring entry. Calling Cognito's `/oauth2/revoke` endpoint is deferred (not required for correctness — local token deletion is sufficient since no other party trusts these tokens yet).
- **Profile data source:** Populated directly from `id_token` JWT claims (`email`, `name`, `sub`) — no separate `GetUser` API call needed for a minimalist profile. `sub` is the durable identity key.
- **No backend component:** Unlike the superseded `architecture.md` plan, this introduces zero new AWS compute (no Lambda, no API Gateway, no DynamoDB) — Cognito's own Hosted UI/OAuth endpoints are the entire "backend" for this feature.
- **Cognito feature plan tier:** **Essentials** (not Lite), with **Managed Login** branding (not the classic Hosted UI). Essentials is the default tier for new user pools, stays within the free tier at nixus's scale (10,000 MAU cap applies to both Lite and Essentials), and is required for Managed Login's EN/FR localization support — matching the app's existing i18n requirement. Lite + classic Hosted UI would be cheaper at higher MAU but has no localization and no path to Managed Login without a branding-version migration (which invalidates active sessions for up to ~4 minutes during propagation) — not worth the future migration cost to save money at a scale nixus won't hit in v1.

### Frontend Architecture

- **Auth state management:** Modeled as a TanStack Query resource (`useAuthSession` in a new `hooks/useAuth.ts`, following the existing one-file-per-feature hook convention) backed by a Rust `get_auth_session` command. Mutations (`useSignIn`, `useSignOut`) invalidate the `auth.session` query key on success — consistent with existing query-key conventions in `lib/constants.ts`.
- **Popup component:** `<AccountPromptDialog>` built on the existing shared `Dialog` primitive (`@nixus/shared/ui`). Display condition: shown on every launch whenever `get_auth_session` resolves to "no session" — no persisted dismissal flag, no new SQLite table. "Continue Offline" simply closes the dialog for the current app session; it reappears on next launch until an account exists.
- **Profile/login entry point:** A small icon in the top-right of the app header/chrome (not the main sidebar nav, keeping the existing 9-item sidebar convention untouched). Logged-out state shows a generic/sign-in icon; logged-in state shows the user's identity and opens the minimalist Profile view (email, name, sign-out button).
- **IPC command surface (new, in `commands/auth.rs`):**
  - `start_login` — builds the PKCE-parameterized Cognito authorize URL, opens it via `tauri-plugin-opener`, returns nothing (deep-link callback drives the rest)
  - `handle_auth_callback` — invoked when the deep-link event fires with the callback URL; exchanges code for tokens, writes to keyring
  - `get_auth_session` — reads/validates/refreshes the keyring entry, returns current session state (`LoggedOut | LoggedIn { email, name } | SessionExpired`)
  - `sign_out` — clears the keyring entry
  - All follow the existing convention: `#[tauri::command(rename_all = "snake_case")]`, return `Result<T, AppError>`, no panics.

### Decision Impact Analysis

**Implementation Sequence:**
1. AWS-side: create Cognito User Pool, public app client (PKCE, no secret), configure Google as a social IdP, set callback/sign-out URLs to `nixus://auth/callback` / `nixus://auth/signout`.
2. Rust: `commands/auth.rs` (start_login, handle_auth_callback, get_auth_session, sign_out) + `tauri-plugin-deep-link` registration in `lib.rs` + `tauri.conf.json` scheme config.
3. Frontend: `hooks/useAuth.ts` (TanStack Query), `<AccountPromptDialog>`, header profile icon + minimalist Profile view.
4. Documentation: amend `architecture-entitlements-licensing.md` to note login's existence as a separate concern (see Amendment section below).

**Cross-Component Dependencies:**
- The deep-link callback (Rust) must emit an event the frontend can react to (e.g. to close the popup and refetch `auth.session`) — standard Tauri event emit/listen, no new pattern needed.
- `get_auth_session` is the single source of truth consumed by both the popup (show/hide) and the header icon (logged-in/out rendering) — avoids divergent state between the two UI surfaces.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

Most naming/structure/format conflicts are already resolved by `docs/project-context.md`'s existing, enforced conventions (snake_case IPC, `AppError`, kebab-case query keys, PascalCase components, feature-grouped files). This section covers only the patterns specific to auth that aren't already dictated, plus one correction to a step-4 decision that conflicted with an established precedent.

**Correction to prior decision:** `architecture-credentials.md` establishes `credentials.rs` as the **sole** module permitted to call `keyring_core::Entry` — "No command or module accesses the keyring directly." `commands/auth.rs` must NOT write to keyring directly as originally stated; it must call into `credentials.rs` instead. Revised:
- `credentials.rs` gains three new functions: `store_cognito_session(session: &CognitoSession)`, `load_cognito_session() -> Option<CognitoSession>`, `clear_cognito_session()` — using the same `service = "nixus-auth"`, `account = "cognito-session"` keyring entry as decided in step 4.
- `commands/auth.rs` orchestrates (build PKCE params → open browser → handle callback → call `credentials.rs` to persist/read/clear → return `Result<T, AppError>`), exactly mirroring the existing `commands/settings.rs` → `credentials.rs` chain for AI keys.

### Naming Patterns

- **Rust struct:** `CognitoSession { access_token, id_token, refresh_token, expires_at }` — `snake_case` fields, `#[derive(Debug, Clone, Serialize, Deserialize)]` per existing model convention (`src-tauri/src/models/mod.rs`).
- **Session state enum (serialized to frontend):** `AuthState` = `LoggedOut | LoggedIn { email: String, name: Option<String> } | SessionExpired` — serde default tagging (`#[serde(tag = "status")]`) so the frontend gets `{ "status": "LoggedIn", "email": "...", "name": "..." }`, consistent with how other IPC payloads are plain tagged JSON (no custom envelope).
- **TanStack Query key:** `["auth", "session"]` in `queryKeys.auth.session` (kebab-case-string-array convention, added to `lib/constants.ts` alongside existing keys).
- **Tauri event name:** `auth:callback-received` — colon-namespaced, matching the pattern of other Tauri-emitted events already in the desktop app (avoids collision with plain query-key-style strings).
- **Component files:** `components/auth/AccountPromptDialog.tsx`, `components/auth/ProfileMenu.tsx` — feature-grouped under `auth/`, matching the `components/{feature}/` convention.
- **Hook file:** `hooks/useAuth.ts` exporting `useAuthSession`, `useSignIn`, `useSignOut` — one file per feature, matching `useExpenses.ts`-style convention.
- **Rust command file:** `commands/auth.rs` — new file, one per feature, matching `commands/{feature}.rs`.

### Structure Patterns

- No new `db/` file — this feature has no SQLite-backed data model (session lives only in keyring, profile fields come from JWT claims at read time). This is consistent with `credentials.rs` already being SQLite-independent.
- No new route file for a full-page profile — the Profile view renders as a panel/popover anchored to the header icon (per step-4 UI decision), not a `routes/profile.tsx` route, since it's not part of the main sidebar navigation.

### Format Patterns

- **IPC command payloads:** plain `snake_case` JSON matching Rust field names, per existing `invoke<T>("cmd", { snake_case_arg })` convention — no deviation for auth.
- **Error handling:** auth-specific failures extend the existing `AppError` enum with a new variant, e.g. `AppError::Auth { message: String, recoverable: bool }` — reusing the `recoverable: bool` pattern already established for AI service errors, since "session expired" is a recoverable state (user can just sign in again) while a malformed callback URL is not.

### Process Patterns

- **Session refresh timing:** checked once on app launch (via `get_auth_session`), not polled — matches the local-first, no-unnecessary-network-calls posture.
- **Loading state:** the header icon shows a neutral/loading state until the first `get_auth_session` resolves, then settles into `LoggedOut`/`LoggedIn`/`SessionExpired` rendering — standard TanStack Query `isLoading` handling, no new pattern.

### Enforcement Guidelines

**All AI agents implementing this feature MUST:**
- Route all keyring access through `credentials.rs` — never call `keyring_core::Entry` from `commands/auth.rs` or anywhere else.
- Never construct the Cognito token exchange request in the frontend/webview — it happens exclusively in Rust.
- Reuse `AppError` (extended with an `Auth` variant) rather than introducing a parallel error type for auth.
- Use `queryKeys.auth.session` from `lib/constants.ts` — never hardcode `["auth", "session"]` inline in a hook or component.

### Pattern Examples

**Good:** `credentials.rs::store_cognito_session(&session)` called from `commands/auth.rs::handle_auth_callback`.
**Anti-pattern:** `keyring_core::Entry::new("nixus-auth", "cognito-session")` called inline inside `commands/auth.rs` — bypasses the sole-accessor boundary established in `architecture-credentials.md`.

## Project Structure & Boundaries

### Delta to Existing Project Tree

```
apps/desktop/src-tauri/
├── Cargo.toml                      # MODIFIED: + tauri-plugin-deep-link, + tauri-plugin-single-instance
├── tauri.conf.json                 # MODIFIED: + plugins.deep-link.desktop.schemes = ["nixus"]
├── capabilities/
│   └── default.json                # MODIFIED: + deep-link:default permission
└── src/
    ├── lib.rs                      # MODIFIED: register tauri_plugin_single_instance::init() (must be first plugin registered) + tauri_plugin_deep_link::init(), register auth commands
    ├── error.rs                    # MODIFIED: + AppError::Auth { message, recoverable }
    ├── credentials.rs              # MODIFIED: + store_cognito_session / load_cognito_session / clear_cognito_session
    ├── models/
    │   └── mod.rs                  # MODIFIED: + CognitoSession, AuthState structs
    └── commands/
        └── auth.rs                 # NEW: start_login, handle_auth_callback, get_auth_session, sign_out

apps/desktop/
├── package.json                    # MODIFIED: + @tauri-apps/plugin-deep-link
└── src/
    ├── lib/
    │   ├── constants.ts             # MODIFIED: + queryKeys.auth.session
    │   └── types.ts                 # MODIFIED: + AuthState type (mirrors Rust enum)
    ├── hooks/
    │   └── useAuth.ts               # NEW: useAuthSession, useSignIn, useSignOut
    ├── components/
    │   └── auth/
    │       ├── AccountPromptDialog.tsx  # NEW: offline/create-account popup
    │       └── ProfileMenu.tsx          # NEW: header icon + profile panel
    └── routes/
        └── __root.tsx                # MODIFIED: mounts <AccountPromptDialog /> and <ProfileMenu /> in the app shell/header
```

No new AWS infrastructure files in this repo — the Cognito User Pool, app client, domain, and Google IdP configuration are provisioned directly in the AWS Console/CLI (out-of-band, not part of this codebase), matching how the app already treats AWS Bedrock as an external managed dependency with no IaC checked in.

**Windows note:** nixus doesn't currently register `tauri-plugin-single-instance`. On Windows (and Linux), a deep-link redirect launches a *new* process rather than routing to the running instance — without single-instance handling, signing in could spawn a duplicate app window instead of completing login in the original one. `tauri-plugin-single-instance` must be added and registered *before* `tauri_plugin_deep_link::init()` in `lib.rs`. macOS is unaffected (deep links route to the existing process by OS default).

**Auto-updater interaction risk:** nixus already has `tauri-plugin-process` wired to a `relaunch()` call as part of the existing auto-update flow. Adding `tauri-plugin-single-instance` introduces a real interaction risk there: if the updater's relaunch spawns a new process before the old one has fully exited, single-instance handling could cause the new (updated) instance to focus/forward to the old (pre-update) instance instead of replacing it. This must be covered by a regression check against the existing update-and-relaunch path when `tauri-plugin-single-instance` is added — not assumed safe by default.

### Architectural Boundaries

**API Boundaries:**
- External: Cognito OAuth endpoints (`/oauth2/authorize`, `/oauth2/token`) — called exclusively from Rust (`commands/auth.rs` via `reqwest`). The webview never holds Cognito credentials or makes token requests.
- Internal: `commands/auth.rs` is the only module that calls Cognito's REST endpoints; `credentials.rs` is the only module that touches the keyring. Neither boundary is crossed by any other file.

**Component Boundaries:**
- `AccountPromptDialog` and `ProfileMenu` are both pure consumers of `useAuthSession()` — neither owns auth state, both re-render from the same TanStack Query cache entry (`["auth", "session"]`), preventing the two surfaces from drifting out of sync.
- `useAuth.ts` is the sole frontend module invoking `invoke("start_login" | "get_auth_session" | "sign_out")` — no component calls `invoke` directly for auth.

**Data Boundaries:**
- Auth data (tokens) lives exclusively in the OS keyring via `credentials.rs` — never in SQLite, never in webview `localStorage`/`sessionStorage`.
- Profile display data (email, name) is derived from the `id_token` claims at read time in `get_auth_session` — not persisted separately, so there's no cache-invalidation concern between "session" and "profile."
- Entitlements/licensing data (Keygen/LemonSqueezy) remains fully untouched — no shared table, no shared Rust module, no shared frontend hook between the two systems.

### Requirements to Structure Mapping

| Requirement | Frontend | Rust Command | Supporting Module |
|---|---|---|---|
| FR1: Cognito email/password + Google sign-in | `AccountPromptDialog.tsx`, `useAuth.ts` (`useSignIn`) | `start_login`, `handle_auth_callback` | `credentials.rs` |
| FR2: Offline/create-account popup | `AccountPromptDialog.tsx` | `get_auth_session` | — |
| FR3: Minimalist profile view | `ProfileMenu.tsx` | `get_auth_session`, `sign_out` | — |
| FR4: Independence from entitlements/licensing | N/A (absence of coupling) | N/A | Amendment to `architecture-entitlements-licensing.md` |

### Integration Points

**Internal Communication:**
- Rust → Frontend: `handle_auth_callback` (triggered by the `tauri-plugin-deep-link` `onOpenUrl` event) emits a Tauri event (`auth:callback-received`); `useAuth.ts` listens and invalidates `["auth", "session"]`, causing both `AccountPromptDialog` and `ProfileMenu` to refetch and re-render.
- Frontend → Rust: standard `invoke()` calls for `start_login`, `get_auth_session`, `sign_out`.

**External Integrations:**
- AWS Cognito Hosted UI / Managed Login (OAuth2 authorize + token endpoints) — the only new external dependency.
- Google, indirectly, as a federated IdP configured inside Cognito — nixus code never calls Google APIs directly.

**Data Flow:**
System browser (Cognito Hosted UI + Google consent) → custom URI scheme redirect → `tauri-plugin-deep-link` → `commands/auth.rs::handle_auth_callback` → `reqwest` POST to `/oauth2/token` → `credentials.rs::store_cognito_session` (keyring) → Tauri event → frontend refetch → UI reflects `LoggedIn` state.

### File Organization Patterns

- **Configuration:** Cognito domain/client-id/region are non-secret and can live in a build-time constant or `tauri.conf.json`-adjacent config file (not the keyring) — only tokens are secrets.
- **Source organization:** Auth code follows the existing feature-grouped pattern exactly (`components/auth/`, `commands/auth.rs`) — no new organizational pattern introduced.
- **Test organization:** Desktop has no unit test framework (Playwright E2E only, per `docs/project-context.md`) — auth E2E coverage (login popup, offline continue, sign-out) belongs in `apps/desktop/tests/`, matching existing E2E-only convention. Cognito calls themselves are not mocked in E2E per existing project conventions for external services; a dedicated test Cognito user pool (or a test user pool app client) is the responsibility of CI setup, not this architecture doc.
- **Asset organization:** No new static assets — profile icon can reuse the existing icon set already bundled in the shared UI package.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All decisions form one consistent flow — public Cognito client + PKCE + `state` → system browser → `tauri-plugin-deep-link` (with `tauri-plugin-single-instance` for Windows correctness) → Rust-only token exchange via `reqwest` → `credentials.rs`-mediated keyring storage → TanStack Query-driven UI. No step depends on a component not already decided.

**Pattern Consistency:** Naming (snake_case IPC, kebab-case query keys, PascalCase components), error handling (`AppError` extension, not a parallel type), and the keyring sole-accessor rule are all inherited from existing project conventions rather than invented — verified against `docs/project-context.md` and `architecture-credentials.md`.

**Structure Alignment:** The delta tree slots directly into existing directories (`commands/`, `components/{feature}/`, `hooks/`) with no new top-level structure. Boundaries (Rust-only Cognito calls, `credentials.rs`-only keyring access, single shared query key for both UI surfaces) are structurally enforced, not just documented conventions.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**
- FR1 (Cognito email/password + Google) → Hosted UI + social IdP config + PKCE flow ✅
- FR2 (offline/create-account popup) → `AccountPromptDialog` + `get_auth_session` ✅
- FR3 (minimalist profile) → `ProfileMenu` + JWT-claims-derived data ✅
- FR4 (independence from entitlements/licensing) → zero shared files/modules/state; enforced by the boundary section above ✅

**Non-Functional Requirements Coverage:**
- NFR1 (local-first preserved) → app is fully functional with no session; refresh failure surfaces a notice but never blocks functionality ✅
- NFR2 (secure token storage) → keyring only, via the established `credentials.rs` sole-accessor pattern ✅
- NFR3 (low ops burden) → zero new AWS compute; Cognito Hosted UI is the entire backend ✅
- NFR4 (future-proof identity key) → `sub` claim is the durable ID; no premature cloud infrastructure built ✅

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical decisions (client type, grant, token storage shape, refresh-failure behavior, popup cadence, entry-point placement) are recorded with rationale. No open "TBD" on any critical item.

**Structure Completeness:** Delta tree specifies every new/modified file down to the function level (`store_cognito_session`, `start_login`, etc.) — no generic placeholders.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns are each covered; the one conflict found (keyring sole-accessor violation) was caught and corrected in Step 5 rather than left inconsistent.

### Gap Analysis Results

**Critical Gaps:** None found.

**Important Gaps (found and resolved during this validation pass):**
- Missing OAuth `state` parameter for CSRF protection — added to the Authentication & Security section.
- Missing `tauri-plugin-single-instance` for correct Windows deep-link routing — added to the Project Structure delta and Cargo dependencies.

**Nice-to-Have Gaps (explicitly deferred, documented above as such, not blocking):**
- Token revocation via Cognito's `/oauth2/revoke` on sign-out (local deletion is sufficient for v1).
- Refresh token rotation support (Cognito feature, left disabled for v1 simplicity).
- A dedicated test/sandbox Cognito user pool for CI/E2E — this is a CI/ops setup task, not an architectural decision, and is called out as such rather than left silently unaddressed.

### Validation Issues Addressed

Both important gaps (CSRF `state` parameter, Windows single-instance handling) were fixed in-place in the relevant sections above during this validation pass, rather than deferred — both are small, well-understood additions with no architectural ripple effects.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — this is a well-bounded feature (auth + one popup + one profile view) with no formal PRD but a concrete, confirmed working brief, built entirely on established project conventions with only one new external dependency and no new backend surface.

**Key Strengths:**
- Zero new AWS compute — the lowest-ops-burden option that still supports Google federation.
- Full reuse of existing patterns (`credentials.rs`, `AppError`, TanStack Query, feature-grouped files) rather than introducing parallel conventions.
- Explicit, deliberate independence from the entitlements/licensing system, preventing a repeat of the confusion the superseded `architecture.md` plan caused.

**Areas for Future Enhancement:**
- When cloud sync/notifications/community features are eventually built, the Cognito `sub` becomes the join key for whatever new data store is introduced — no rework of this auth layer should be needed.
- Token revocation and rotation can be layered in later without breaking the current token shape.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented in this file.
- Route all keyring access through `credentials.rs` — never inline.
- Never perform the Cognito token exchange from the frontend/webview.
- Refer to this document, not `architecture.md`'s stale Cognito section, for all login-related questions.

**First Implementation Priority:**
AWS-side Cognito setup (User Pool, public app client with PKCE, Google social IdP, callback/sign-out URLs) — this has no code dependency and unblocks everything else.

---

## Amendment (2026-08-15): loopback HTTP redirect replaces the custom-scheme redirect

This document's Authentication & Security section states: "No localhost redirect server needed since Cognito (not Google) is the direct OAuth party and accepts custom-scheme callback URLs." That statement is superseded.

**Amended:** the OAuth redirect target is now `http://127.0.0.1:52847/callback` (RFC 8252 §7.3's loopback interface pattern), not `nixus://auth/callback`. Two problems with the direct custom-scheme redirect motivated this, both discovered in production after Windows users reported sign-in appearing to hang:

1. **The browser tab never reflects completion.** Cognito's Managed Login page is AWS-hosted UI with no supported way to inject a "you can close this tab" page or a `window.close()` call. Once it redirects to a custom scheme, the tab is left on that last page indefinitely — there is no page transition to control.
2. **Windows shows an OS-level "Open Nixus?" confirmation prompt** for the custom-scheme handoff, which a plain HTTP navigation does not trigger.

**What changed:**
- `COGNITO_REDIRECT_URI` (`commands/auth.rs`) is now `http://127.0.0.1:52847/callback`, sourced from a new `commands/auth_listener.rs` module.
- `commands/auth_listener.rs` binds a short-lived, single-request local HTTP listener (the `tiny_http` crate) during `start_login`, torn down after one request or a 5-minute timeout. It serves a static success page (`window.close()` plus a visible fallback message) and hands the captured `code`/`state` to the existing `complete_auth_callback` via the same `dispatch_deep_link_url` entry point the deep-link path already used.
- **AWS-side change required:** the Cognito app client's allowed callback URLs must include `http://127.0.0.1:52847/callback`. The port is fixed (not OS-assigned) because Cognito's callback allow-list requires an exact string match with no loopback wildcard support.
- `tauri-plugin-deep-link` and the single-instance wiring in `lib.rs` remain registered and functional — `nixus://auth/callback` is still recognized by `is_auth_callback_url` as a fallback shape, even though Cognito is no longer configured to send one. Retiring that plumbing entirely is a possible future follow-up, not done in this pass.

**Unaffected:** PKCE, the `state` CSRF check, the token exchange, `credentials.rs`'s keyring storage, and every frontend surface (`useAuth.ts`, `ProfileMenu.tsx`, `AccountPromptDialog.tsx`) are unchanged — this amendment is scoped entirely to how the authorization code reaches the app, not what happens once it does.
