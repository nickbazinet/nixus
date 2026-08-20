# Epic 35 Context: Nixus Cloud Login & Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epics 33 and 34 delivered local profiles: a launch picker, automatic migration of existing data into a "Default" profile, and multiple fully isolated local profiles. This epic closes the loop by wiring the picker's "Log in with Nixus Cloud" action and adding a "Migrate to Nixus Cloud" path from inside a local profile. Signing in lands the user on a profile tied to that cloud account — created the first time, reopened (never duplicated) on every subsequent sign-in. Migrating produces a *new*, separate cloud-linked profile holding a copy of the local profile's data and AI keys as of that moment, leaving the original completely untouched and still available in the picker as a fallback. Nothing about the cloud account changes what the app does locally: this is dataset selection tied to an identity, not sync. The epic ends by proving the privacy claim still holds — that neither flow transmits any financial, car, or profile data anywhere.

## Stories

- Story 35.1: `LoginIntent` carries Login vs Migrate across the unchanged OAuth round-trip
- Story 35.2: "Log in with Nixus Cloud" from the picker
- Story 35.3: "Migrate to Nixus Cloud" from within a local profile
- Story 35.4: Cloud-linked profiles show whether their account is currently signed in
- Story 35.5: i18n cleanup for the new Cloud entry points
- Story 35.6: Verify no data leaves the machine

## Requirements & Constraints

- The existing Cognito sign-in/sign-up flow is reused *exactly as-is* for both entry points — no change to the hosted UI, app client, scopes, OAuth grant, PKCE, CSRF state check, token exchange, or session storage. Existing login E2E coverage must keep passing unmodified.
- No data leaves the machine, for cloud-linked profiles included. The only network calls this feature may make are the two Cognito OAuth endpoints already in use. Migration is entirely local filesystem plus local keyring.
- Signing in repeatedly with the same account must reopen the same profile rather than creating a duplicate.
- Migration must never mutate, convert, or delete the source profile — it stays listed with its own data and AI keys intact.
- Signing out of a cloud-linked profile leaves it marked cloud-linked-but-signed-out; it must never revert to a plain local profile. Signing back in with the same account reattaches it.
- Existing single-profile users are never forced through a cloud account to keep using the app as before.
- Local-profile identity stays a purely local concept: a cloud-linked profile *records* the cloud subject as an attribute, never uses it as its identity or directory key.
- The demographic Profile feature (name/DOB/income/location, keyed by cloud subject) is a different concept from a local profile and must never be conflated in naming, code, or copy.
- New user-facing strings live under the `datasets.*` i18n namespace and land in both locale files in the same change; retired keys are removed, not orphaned.

## Technical Decisions

- **One OAuth mechanism, branched after the callback.** Rather than two divergent flows, sign-in start carries an intent (`Login`, or `Migrate` with a source dataset id) held in-process by the loopback-redirect listener alongside the PKCE state/verifier, so the intent shares that listener's single-request/5-minute lifetime and can never outlive its attempt. Only the post-token-exchange branch differs. The legacy custom-scheme deep-link fallback carries no intent and always behaves as plain Login.
- **Login branch:** under the registry lock, find cloud-linked entries matching the account's subject. None → create a new dataset tagged cloud-linked with the subject and the account email (from the identity token) as its label. One or more → pick the most recently created as a deterministic tie-break. Multiple cloud-linked profiles sharing one subject is an accepted, documented edge case, not an error to prevent.
- **Migrate branch:** holds the registry lock for the *entire* copy, not just the final write. First re-check that the source profile is still the active one (a brief read-only peek at the active-dataset lock — the single sanctioned exception to lock ordering, never held across I/O); if the user switched away during the browser round-trip, abort and create nothing. Otherwise create the new dataset directory, checkpoint the source connection using the same sequence the backup export already uses, copy **only** the main database file (resolved by explicit source id, never via the active-dataset helper) — never a `-wal`/`-shm` sidecar — and copy the source's per-profile AI-provider keyring entries by an explicit enumerated list of the fixed key names already defined in the credential module (keyring entries cannot be enumerated at runtime). Tag the new entry cloud-linked with subject, label, and a back-reference to the source.
- **Lock ordering is load-bearing.** Both branches must release the registry lock *before* calling the dataset switch; holding it across the switch deadlocks the callback thread. Registry lock first, then released, then activate — never nested the other way.
- **Cognito session storage stays global and unscoped this pass.** There is exactly one machine-wide session as today; true per-account session isolation is explicit future work. Do not build per-profile session plumbing.
- **Signed-in/out badge is derived entirely Rust-side** by comparing the existing internal subject resolver's result to the profile's stored subject, returning only a boolean to the frontend. The auth wire type must not gain the subject, and no new Rust state may be introduced for this. A resolver error meaning "no session" reads as signed-out.
- **No new dependencies.** Everything builds on the existing auth, keyring, SQLite, Tauri event, and router/query stack.

## UX & Interaction Patterns

- The existing account-menu dropdown is *modified*, not replaced by a new component: in a local profile its cloud entry point reads "Migrate to Nixus Cloud" (replacing today's sign-in label, unconditionally — regardless of global auth state); in a cloud-linked profile it renders the signed-in/signed-out badge plus the existing sign-out action unchanged.
- The picker's cloud action is styled with the same shared-UI primitives and dark-theme tokens as the rest of the picker — no OS-native dialog, no parallel design system. No picker-specific mockup exists; layout and copy specifics are story-level decisions following existing conventions.
- After either flow succeeds, the user lands directly in the new/reopened profile's own entry view (empty dashboard or onboarding, per that profile's own state).

## Cross-Story Dependencies

- Epics 33 and 34 are hard prerequisites: this epic builds on the registry and its writer lock, the active-dataset lock and switch, the `dataset:switched` event, the picker route with its already-present-but-inert cloud action, and Epic 34's per-profile keyring naming (which Migrate copies).
- Story 35.1 gates 35.2 and 35.3 — neither branch can exist before the intent is plumbed through the round-trip.
- Story 35.4 depends on at least one cloud-linked profile existing, so it follows 35.2 or 35.3.
- Story 35.5 finishes the locale cleanup begun when the old account-prompt dialog was deleted in Epic 33; the old sign-in label can only be retired once 35.3 has made the migrate label unconditional.
- Story 35.6 verifies both completed flows end-to-end and therefore lands last.
- New root-level commands introduced here must be added to the Tauri mock cases across the existing Playwright specs, following the pattern established in Epic 33.
