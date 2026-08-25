# Epic 35 Context: Nixus Cloud Login & Migration

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic completes the "Log in with Nixus Cloud" action left inert by Epic 33's picker, and adds "Migrate to Nixus Cloud" as a replacement for today's "Sign In with Nixus Cloud" entry point in the account menu. Users can sign in from the picker and land on a dedicated cloud-linked profile (new or reopened, never duplicated), and can migrate any local profile's data into a new cloud-linked profile without touching or losing the original. Both flows reuse the existing Cognito PKCE sign-in mechanics completely unchanged, branching only after a successful callback. This matters because it's the boundary where local-first privacy guarantees must hold even as cloud identity enters the picture: no financial or profile data may ever leave the machine, and sign-out/re-sign-in must never leak one account's data into another profile or silently revert a cloud-linked profile back to plain local.

## Stories

- Story 35.1: `LoginIntent` carries Login vs Migrate across the unchanged OAuth round-trip
- Story 35.2: "Log in with Nixus Cloud" from the picker
- Story 35.3: "Migrate to Nixus Cloud" from within a local profile
- Story 35.4: Cloud-linked profiles show whether their account is currently signed in
- Story 35.5: i18n cleanup for the new Cloud entry points
- Story 35.6: Verify no data leaves the machine

## Requirements & Constraints

- No network call may transmit financial, car, or profile data for any profile, including cloud-linked ones. The only network calls this feature makes are Cognito's existing `/oauth2/authorize` and `/oauth2/token` endpoints — no new endpoint is introduced.
- The existing Cognito PKCE flow (`start_login`/`complete_auth_callback`/`get_auth_session`/`sign_out`, loopback-redirect callback) is reused exactly as-is for both "Log in with Nixus Cloud" and "Migrate to Nixus Cloud" — no change to the Cognito hosted UI, app client, scopes, or OAuth grant.
- Signing in again with the same Nixus Cloud account must reopen the same cloud-linked profile rather than duplicating it (most-recent tie-break if more than one already matches).
- Migrating a local profile creates a new, separate profile; the original local profile is left completely untouched and stays listed in the picker as a fallback.
- Signing out of a cloud-linked account marks that profile signed-out-but-still-cloud-linked; it never reverts to a plain local profile. Signing back in with the same account reattaches it, never creating a duplicate.
- The demographic "Profile" feature (name/DOB/income/location, keyed by Cognito `sub`) is a distinct concept from "local profile" (dataset selection) and must never be confused in naming, code, or UI copy.
- New UI strings live under a `datasets.*` namespace, added to `en.json` and `fr.json` together. `profile.signIn` is retired once ProfileMenu's local-dataset case always shows "Migrate to Nixus Cloud".

## Technical Decisions

- **`LoginIntent` (Login | Migrate{source_id})**: carried by `start_login`, stored in-process inside `commands/auth_listener.rs` alongside the existing PKCE `state`/verifier, sharing that listener's exact single-request/5-minute-timeout lifetime. It never outlives the login attempt it belongs to. PKCE, the `state` CSRF check, the token exchange, and `credentials.rs`'s session storage stay 100% unchanged. The legacy `nixus://auth/callback` deep-link fallback carries no intent and always behaves as `LoginIntent::Login`.
- **Post-callback branching (in `complete_auth_callback`)**:
  - Login: find-or-create a cloud-linked dataset by `cognito_sub`; if one or more already match, select the most-recently-created one (never create a duplicate). If none match, create a new dataset tagged `kind: "cloud-linked"`, `cognito_sub`, `label` = account email from the `id_token`.
  - Migrate: first re-confirm the source dataset is still the active one (abort with an error and create nothing if the user switched away during the browser round-trip); then create a new dataset, copy the source's `nkbaz-finance.db` (post-`wal_checkpoint`, main file only, never a `-wal`/`-shm` sidecar), copy the source's per-dataset AI-provider keyring entries by their known key names, tag the new dataset `kind: "cloud-linked"` with `cognito_sub`, `label`, and `linked_from: source_id`, then select it.
- **Lock ordering**: the registry lock and the `ActiveDataset` lock are distinct. Registry → ActiveDataset nesting is used only for Migrate's active-id re-check (a single quick read, never held across I/O). Every other case acquires the registry lock, fully releases it, and only then acquires the `ActiveDataset` lock. The reverse order is never used.
- **Cognito session scope stays global/unscoped this pass** — one keyring slot / `SESSION_CACHE`, not per-profile. True per-account session isolation (two accounts simultaneously signed in) is explicitly out of scope.
- **Signed-in/out badge derivation**: computed entirely on the Rust side. `commands/datasets.rs` calls the existing internal `commands::auth::current_subject()` and compares it to the active dataset's stored `cognito_sub`, returning only a boolean badge state to the frontend — never the `sub` itself, and no change to `AuthState`'s wire shape.
- **`ProfileMenu.tsx` is modified, not replaced**: when the active dataset's `kind == "local"`, its entry reads "Migrate to Nixus Cloud" (replacing "Sign In with Nixus Cloud") and triggers `LoginIntent::Migrate`; when `kind == "cloud-linked"`, it renders the signed-in/signed-out badge plus the existing unchanged `sign_out` action.
- The demographic `/profile` route/store (keyed by Cognito `sub`) stays anchored at the global root regardless of which dataset is active — it is explicitly not touched by this epic.
- This epic builds on Epic 33's registry, active-dataset lock, and picker infrastructure, and Epic 34's per-dataset AI-provider keyring convention (`"nkbaz-finance-<dataset_id>"`) which the Migrate copy path reuses.

## Cross-Story Dependencies

- Depends on Epic 33 (picker screen with an inert "Log in with Nixus Cloud" action, dataset registry, `select_dataset`, `queryClient.clear()` on switch) and Epic 34 (per-dataset AI-provider keyring naming, which Migrate's credential copy relies on).
- Story 35.1 (LoginIntent plumbing) is a prerequisite for both 35.2 (Login) and 35.3 (Migrate).
- Story 35.4 (signed-in/out badge) depends on 35.2 having created cloud-linked datasets to display state for.
- Story 35.5 (i18n) depends on the final label/copy decisions made across 35.2-35.4, and completes the retirement of `AccountPromptDialog`-related locale keys started in Epic 33's Story 33.5.
- Story 35.6 is a verification pass across the completed Login (35.2) and Migrate (35.3) flows; it has no code dependencies of its own but requires both to be functionally complete first.
