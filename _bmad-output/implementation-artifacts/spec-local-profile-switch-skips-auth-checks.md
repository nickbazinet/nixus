---
title: 'Local profiles switch without authentication checks'
type: 'bugfix'
created: '2026-08-20'
status: 'done'
baseline_commit: '2d5a8409b59ea57459d35908910829fe41959117'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The always-mounted account menu calls `get_auth_session` before it knows whether the active profile is local. Opening a local profile therefore reads the OS secure store, may refresh Cognito tokens, and can surface authentication state even though local profiles are unauthenticated.

**Approach:** Resolve the active profile first and enable the auth-session query only for a confirmed `cloud-linked` profile. A confirmed local profile must immediately render the existing **Switch profile** action, without reading authentication credentials or exposing the account panel.

## Boundaries & Constraints

**Always:** Treat `get_active_profile` as the profile-kind authority. For `kind: "local"`, do not invoke `get_auth_session`, do not show identity, sign-out, migration, or session-expired UI, and route the existing Switch profile action to `/picker`. Preserve the current cloud-linked signed-in and signed-out badge, sign-in, identity, profile-link, and sign-out behavior. Keep the auth callback listener active when the session query is disabled so later cloud callbacks still invalidate the established caches.

**Ask First:** Any attempt to retain or relocate the local profile's **Migrate to Nixus Cloud** entry point, or to change auth behavior on `/profile` and retirement surfaces.

**Never:** Do not read the keyring for a local profile, infer local/cloud status from the machine-wide session, change Rust auth/session storage, alter Cognito flow mechanics, remove the `Migrate` intent from the shared auth hook, or broaden this fix into a profile-menu redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Local profile | Active profile is `local`, regardless of stored Cognito session | Render Switch profile directly; zero `get_auth_session` calls; no panel, migration, sign-out, or expiry toast | Clicking navigates to a usable `/picker`; no cloud flow starts |
| Cloud profile, signed in | Active profile is `cloud-linked`; matching session exists | Preserve signed-in badge, identity, profile link, and sign-out | Existing auth error handling remains unchanged |
| Cloud profile, signed out | Active profile is `cloud-linked`; no matching session | Preserve signed-out badge and Nixus Cloud sign-in action | Existing cloud-flow failure toast remains unchanged |
| Profile kind pending or unreadable | `get_active_profile` has not resolved or rejects | Do not start the auth query while kind is unknown; fail closed to the existing non-cloud Switch profile affordance after error | No keyring call and no auth-derived toast |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/auth/ProfileMenu.tsx` -- root cause at `ProfileMenu`: `useAuthSession()` is unconditional. Derive local/cloud behavior from `useActiveProfile()` first; local and unknown profiles must never expose the account panel. The current `cloudAction()` migration branch and `CloudUpload` rendering are local-menu-only behavior superseded by this fix.
- `apps/desktop/src/hooks/useAuth.ts` -- add an optional query `enabled` input to `useAuthSession`, defaulting to `true` for existing callers. Pass it only to `useQuery`; keep the `auth:callback-received` listener effect unconditional.
- `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` -- extend the existing real `QueryClientProvider` harness to prove a disabled session query performs no `get_auth_session` invoke while still registering the callback listener; retain a default-enabled assertion.
- `apps/desktop/tests/auth.spec.ts` -- IPC recorder already exposes `countIpcCalls`. Replace the signed-in-local migration expectation with a regression proving local profiles always show Switch profile and make zero session/auth calls. Supply cloud profile fixtures to tests that intentionally exercise session-derived menu states.
- `apps/desktop/tests/profile.spec.ts` -- profile-menu navigation tests that intentionally exercise a signed-in account must supply the existing cloud-linked fixture. Direct `/profile` session behavior is read-only for this change.
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- read-only evidence: `get_active_profile` already skips `current_subject()` for `DatasetKind::Local`; no Rust change is required.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src/hooks/useAuth.ts` and `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` -- make session lookup explicitly gateable and lock the disabled/default behavior with unit tests.
- [x] `apps/desktop/src/components/auth/ProfileMenu.tsx` -- gate session state on a confirmed cloud-linked profile and make local/unknown profiles use the direct Switch profile branch.
- [x] `apps/desktop/tests/auth.spec.ts` and `apps/desktop/tests/profile.spec.ts` -- add the local no-keyring regression and preserve explicit cloud-linked menu coverage.

**Acceptance Criteria:**
- Given a local active profile and any secure-store contents, when the header account area renders, then the visible action is Switch profile and `get_auth_session` is never invoked.
- Given a cloud-linked active profile, when its auth session resolves, then the existing signed-in/signed-out menu behavior remains unchanged.
- Given the active-profile query fails, when the header settles, then it offers Switch profile without querying authentication or exposing auth-derived UI.

## Spec Change Log

## Design Notes

This intentionally supersedes the earlier Epic 35 account-menu migration entry point for local profiles: the user's current requirement is stricter than FR5/UX-DR3 and makes local profiles wholly auth-unaware. The backend migration intent remains intact; only this header entry point stops exposing it.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: exit 0 with no diagnostics.
- `pnpm --filter @nixus/desktop test` -- expected: all Vitest suites pass, including disabled-session coverage.
- `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts tests/profile.spec.ts` -- expected: local profile makes zero `get_auth_session` calls and cloud-linked menu scenarios pass.

## Suggested Review Order

**Profile-kind gate**

- Resolve profile kind before enabling any account-session behavior.
  [`ProfileMenu.tsx:77`](../../apps/desktop/src/components/auth/ProfileMenu.tsx#L77)

- Keep local and unreadable profiles on the reversible picker path.
  [`ProfileMenu.tsx:242`](../../apps/desktop/src/components/auth/ProfileMenu.tsx#L242)

**Session boundary**

- Gate only the secure-store query while retaining callback invalidation.
  [`useAuth.ts:20`](../../apps/desktop/src/hooks/useAuth.ts#L20)

- Prove disabled readers never invoke the authentication command.
  [`useAuth.test.tsx:160`](../../apps/desktop/src/hooks/__tests__/useAuth.test.tsx#L160)

**Behavior preservation**

- Lock direct local switching and zero auth-session IPC end to end.
  [`auth.spec.ts:480`](../../apps/desktop/tests/auth.spec.ts#L480)

- Preserve cloud-linked signed-in, signed-out, loading, and expiry states.
  [`auth.spec.ts:668`](../../apps/desktop/tests/auth.spec.ts#L668)

- Keep profile-page navigation explicitly scoped to cloud-linked accounts.
  [`profile.spec.ts:476`](../../apps/desktop/tests/profile.spec.ts#L476)
