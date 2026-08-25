---
title: 'Keep Nixus Cloud accounts bound to isolated cloud profiles'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
baseline_commit: 'fc736001f4a9bfc3b56eb35dee907e099549f7f3'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A completed Nixus Cloud sign-in can leave the prior local dataset active and present it under the new account, sign-out can leave the user inside `/profile`, and cloud-linked datasets can be exposed as though they were local. Together these states risk showing one account's cached or persisted data while another account appears signed in.

**Approach:** Make the authenticated Cognito subject and active cloud-linked dataset an atomic pairing: expose successful sign-in only after the matching dataset is active, reject unauthorized cloud-dataset selection, and clear profile-scoped state before sign-out returns to the `/picker` landing page.

## Boundaries & Constraints

**Always:** A cloud-linked dataset may be active only when its `cognito_sub` matches the stored session subject. Cloud login creates or reopens a `cloud-linked` dataset, activates it before success is emitted, and never lists it among local profiles. Sign-out preserves the dataset's cloud-linked identity but clears account-scoped frontend state, re-arms the picker gate, and lands on `/picker`.

**Ask First:** Any change to Cognito scopes, hosted UI, token storage format, dataset registry format, or the accepted multiple-cloud-datasets-per-subject behavior.

**Never:** Introduce cloud sync, transmit financial/profile data, convert a cloud-linked dataset to local, delete data on sign-out, key authorization by dataset id instead of Cognito subject, or rely on frontend filtering as the security boundary.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| First Cloud login | Valid session; no matching dataset | Create and activate a `cloud-linked` dataset before success/navigation | Clear the new session and emit failure if activation fails |
| Repeat login | Matching subject already linked | Reopen the existing matching cloud profile | Never duplicate it |
| Different account | Another subject's cloud dataset exists | Hide it from local choices and reject direct activation | Return a typed authorization error; retain picker state |
| Sign-out | User is on `/profile` in a cloud profile | Sweep scoped state, re-arm gate, navigate to `/picker` | Stay fail-closed if navigation cannot complete |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/commands/auth.rs:525-602,1012-1025` -- `complete_auth_callback` currently emits `auth:callback-received` before propagating `resolve_intent` failure; `sign_out` clears only the global session.
- `apps/desktop/src-tauri/src/commands/cloud_link.rs:28-100` -- resolves Login/Migrate to a subject-linked dataset and activates it.
- `apps/desktop/src-tauri/src/commands/datasets.rs:34-63,119-124,255-334` -- trusted activation seam, public selection command, picker gate, and active-profile kind/status projection.
- `apps/desktop/src-tauri/src/datasets.rs:477-576` -- provisions/finds cloud-linked registry entries by Cognito subject.
- `apps/desktop/src/hooks/useAuth.ts:29-122` -- auth events and sign-out cache handling; sign-out has no navigation.
- `apps/desktop/src/lib/datasetSwitch.ts:19-31` -- canonical full Query cache and profile-local-storage sweep.
- `apps/desktop/src/components/shared/CloudSignInNavigator.tsx:21-50` -- success navigates to `/`; failure must never emit the success event.
- `apps/desktop/src/components/datasets/DatasetPicker.tsx` -- local-profile list must exclude cloud-linked rows.
- `apps/desktop/src/routes/profile.tsx:17-30` -- currently replaces content in place after sign-out rather than leaving the route.
- `apps/desktop/src/hooks/__tests__/useAuth.test.tsx`, `apps/desktop/tests/auth.spec.ts`, `apps/desktop/tests/picker.spec.ts`, `apps/desktop/tests/profile-isolation.spec.ts` -- regression surfaces for cache order, routing, picker classification, and cross-account isolation.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/commands/auth.rs` -- fail closed before emitting login success and re-arm the picker gate during sign-out.
- [x] `apps/desktop/src-tauri/src/commands/datasets.rs` -- enforce subject authorization at the public cloud-dataset selection boundary and unit-test all dataset-kind/session combinations.
- [x] `apps/desktop/src/hooks/useAuth.ts` -- use the canonical scoped-state sweep before navigating successful sign-out to `/picker`.
- [x] `apps/desktop/src/components/picker/DatasetPicker.tsx` -- render only local datasets in the local-profile list.
- [x] Auth, picker, and isolation tests -- lock event ordering, failed activation, sign-out routing, cloud-row exclusion, and different-account denial before production edits.

**Acceptance Criteria:**
- Given a Cloud login, when dataset activation fails, then no success event or home navigation occurs, the new session is cleared, and prior data is never shown under the new identity.
- Given a signed-in account, when a cloud dataset belongs to another subject, then public selection rejects it even if invoked directly.
- Given a cloud-linked profile on `/profile`, when the user signs out, then scoped caches are cleared before `/picker` renders and the profile remains cloud-linked.
- Given first and repeat login for one subject, when login completes, then the active profile is cloud-linked and the repeat login reopens rather than duplicates it.

## Spec Change Log

## Design Notes

Required success order: store session → resolve/find cloud dataset → activate and emit `dataset:switched` → emit `auth:callback-received`. Any failure after session storage clears that session and emits failure only. The public `select_dataset` command is the authorization boundary; the internal activation seam remains trusted for startup and the post-login flow.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop test` -- all desktop unit tests pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` -- Rust auth/dataset tests pass without warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero type errors.
- `pnpm --filter @nixus/desktop exec playwright test` -- all desktop E2E tests pass, including cross-account and sign-out flows.
- `pnpm --filter @nixus/desktop tauri build` -- desktop artifact builds successfully without warnings.
