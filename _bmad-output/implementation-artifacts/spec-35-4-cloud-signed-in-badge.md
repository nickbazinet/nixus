---
title: 'Cloud-linked profiles show whether their account is signed in'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '40e072a24af8d648186979ec353600843ad0a0b2'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Show, in the existing account menu, whether the active cloud-linked profile's own Nixus Cloud account is currently signed in — derived Rust-side, with local profiles left entirely auth-unaware.

## Requirements

- A new `get_active_profile` command returns the active dataset's id, kind, label, and a bare `is_signed_in` boolean.
- The boolean compares `commands::auth::current_subject()` to the entry's stored `cognito_sub`. A resolver error means "no session" and reads as signed-out. The subject never crosses IPC and `AuthState`'s wire shape is unchanged (AD-10). No new Rust state.
- A local profile always reads `false`, whatever the machine-wide session says, and the subject is not even resolved for it.
- A cloud-linked profile renders the panel in both states: signed-in shows the badge plus the unchanged sign-out action; signed-out shows the badge plus a sign-in action that reattaches via `LoginIntent::Login`.
- Signing out re-reads the derived badge, and the profile stays cloud-linked — it never reverts to a plain local profile.

## Acceptance

- Badge follows the subject match, not the mere presence of a session.
- Signing back in with the same account reattaches the same profile (Story 35.2's find-or-create), never a duplicate.
- Specs that do not mock `get_active_profile` degrade to the plain sign-in affordance rather than failing.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo test --lib` — 776 pass
- `cd apps/desktop && pnpm vitest run` — 367 pass
- `cd apps/desktop && npx playwright test tests/auth.spec.ts tests/profile.spec.ts` — 56 pass

## Auto Run Result

Status: done

`commands::datasets::get_active_profile` reads the active id from `DbState`, looks the entry up in the registry through the existing `find_registered`, and derives `is_signed_in` in the pure `is_signed_in(entry, current_subject)` helper — cloud-linked, non-null stored subject, and an exact match. `current_subject()` is only awaited for a cloud-linked entry, so a local profile's menu cannot trigger the refresh POST that resolver may perform.

Frontend: `useActiveProfile` caches under `["active-profile"]`, invalidated by both `auth:callback-received` and `sign_out`, and wiped by the existing `dataset:switched` sweep. ProfileMenu renders the panel whenever there is identity *or* a cloud badge to show, exposes `data-cloud-status` on the trigger, and offers migrate/sign-in/sign-out per state — never migrate on an already-linked profile.

A pending or failed `get_active_profile` deliberately falls back to plain Login, which is what keeps the other 27 Playwright specs (which mock no such command) rendering a working header. Tests: the pure helper's four branches, the raw-JSON payload assertion proving no subject crosses IPC, and four Playwright cases covering both badge states. Follow-up review recommendation: `true`.
