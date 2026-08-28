---
title: 'Continue a valid Nixus Cloud session from the picker'
type: 'feature'
created: '2026-08-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b9b4a823aa08e02dcf0e4d071917e9fe7228293e'
context:
  - 'docs/project-context.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nixus securely persists Cognito sessions across restarts, but the launch picker ignores them and always starts a new browser login.

**Approach:** Resolve the existing session when the picker renders. For a valid or successfully refreshed session, replace the login CTA with “Continue as {{email}}” and reopen that account's cloud-linked profile without launching the browser; otherwise retain the current login and account-creation flow.

## Boundaries & Constraints

**Always:** Resolve identity and select the matching cloud-linked dataset Rust-side so the Cognito subject never crosses IPC. Reuse the existing session refresh, cloud dataset find-or-create, activation, picker-gate, cache-clearing, navigation, and localized error patterns. Preserve explicit picker choice on every launch.

**Ask First:** Any change to Cognito configuration, token lifetimes, token storage, logout semantics, or the global one-session model.

**Never:** Auto-open a cloud profile during startup, select a cloud dataset by email or frontend registry inspection, launch Hosted UI from Continue, expose `cognito_sub` as an auth response, or alter local-profile behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Restored session | `LoggedIn` with email | Show “Continue as email”; click activates that subject's cloud profile and navigates through existing gates | Failed activation stays on picker and shows the existing Cloud failure toast |
| Signed out | `LoggedOut` or unreadable query | Show existing login, signup, and browser-return note | Existing login failure behavior |
| Expired session | Refresh cannot restore tokens | Show existing login, signup, and browser-return note | User can reauthenticate normally |
| Resolving | Session query pending | Cloud actions remain inert until the result settles | No premature OAuth action or identity claim |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/commands/auth.rs` -- existing `resolve_session`; add the authenticated continuation command and reuse `cloud_link::resolve_intent(Login)`.
- `apps/desktop/src-tauri/src/commands/cloud_link.rs` -- read-only find/create/activate path that selects the subject-matched dataset and latches the picker.
- `apps/desktop/src-tauri/src/lib.rs` -- register the new Tauri command.
- `apps/desktop/src/lib/appError.ts` -- canonical `parseAppError` reader; the one place the typed rejection envelope is narrowed, used to tell an auth/session-invalid continuation failure from a local activation failure.
- `apps/desktop/src/hooks/useAuth.ts` -- shared session query and continuation mutation; clear profile-scoped frontend state after activation, and re-resolve the session on an auth-typed rejection only.
- `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` -- continuation mutation contract: zero-argument command, the post-activation sweep, and the auth-vs-local cache decision.
- `apps/desktop/src/components/picker/PickerCloudEntry.tsx` -- branch CTA copy, click behavior, the compact inert resolving state, browser guidance, and failure copy by `AuthState`.
- `apps/desktop/src/locales/{en,fr}.json` and `src/locales/__tests__/picker-i18n.test.ts` -- localized Continue and checking copy, plus the parity contract.
- `apps/desktop/tests/picker.spec.ts` -- persisted/signed-out/expired/unreadable behavior and IPC/navigation regression coverage.
- `apps/desktop/tests/auth.spec.ts` -- existing picker/auth mock surface that must accept the continuation command where relevant.
- `apps/desktop/tests/profile-isolation.spec.ts` -- local-only mock surface that must answer the picker's session read rather than reject it.

## Tasks & Acceptance

**Execution:**
- [x] Add failing picker and locale regression tests for restored, expired, signed-out, pending, and failed-continuation states.
- [x] Add and register a Rust continuation command that re-resolves the stored session and reuses the existing Login activation path.
- [x] Add the continuation mutation and session-aware picker CTA without changing styling or local-profile behavior.
- [x] Add EN/FR copy and keep the closed locale key set synchronized.
- [x] Run focused tests, typecheck, Rust tests, production build, and browser visual/interaction QA.

**Acceptance Criteria:**
- Given a valid persisted Cognito session, when the picker renders and Continue is activated, then no `start_login` call occurs and the account's existing cloud-linked profile opens.
- Given no usable session, when the picker settles, then the existing login/signup/browser-return flow remains unchanged.
- Given continuation fails, when the command rejects, then the user remains on the usable picker and receives localized feedback.

## Spec Change Log

## Design Notes

The valid-session state keeps the existing single filled primary control and removes signup/browser guidance because Continue remains inside the app. No token, spacing, color, or component-system change is required.

The unresolved state renders that same single primary and nothing else, disabled and labelled as a status. Carrying the login label plus the signup link and browser-return note there made the launch screen promise a browser round-trip to a user who was already signed in and then swap the block out from under them; withholding it also makes the inert composition exactly as tall as the Continue composition it usually becomes, so a signed-in launch does not reflow. The browser composition arrives whole, only once the session settles signed out or expired. Still no token, spacing, color, or component-system change — the resolving state reuses the existing disabled treatment, and the truncated Continue label carries a `title` so a pointer user can recover a clipped address.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop test` -- locale/unit suite passes.
- `pnpm --filter @nixus/desktop exec playwright test tests/picker.spec.ts tests/auth.spec.ts` -- auth/picker flows pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero TypeScript errors.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- Rust suite passes.
- `pnpm --filter @nixus/desktop build` -- production build succeeds.

## Suggested Review Order

**Picker state and interaction**

- Derives resolving, Continue, and browser-login states from one session result.
  [`PickerCloudEntry.tsx:74`](../../apps/desktop/src/components/picker/PickerCloudEntry.tsx#L74)

- Activates restored sessions without OAuth and reports typed failures accurately.
  [`PickerCloudEntry.tsx:131`](../../apps/desktop/src/components/picker/PickerCloudEntry.tsx#L131)

**Rust authorization boundary**

- Accepts only live or refreshed sessions before any profile activation.
  [`auth.rs:1042`](../../apps/desktop/src-tauri/src/commands/auth.rs#L1042)

- Resolves identity and activates the matching cloud profile entirely Rust-side.
  [`auth.rs:1073`](../../apps/desktop/src-tauri/src/commands/auth.rs#L1073)

- Registers the continuation command on the real Tauri IPC surface.
  [`lib.rs:337`](../../apps/desktop/src-tauri/src/lib.rs#L337)

**Frontend isolation and recovery**

- Clears prior profile state only after activation and resets stale auth selectively.
  [`useAuth.ts:227`](../../apps/desktop/src/hooks/useAuth.ts#L227)

**Localized states**

- Adds truthful checking and account-specific Continue labels without new visual tokens.
  [`en.json:93`](../../apps/desktop/src/locales/en.json#L93)

**Regression coverage**

- Proves restored sessions activate the correct cloud profile without browser login.
  [`picker.spec.ts:1715`](../../apps/desktop/tests/picker.spec.ts#L1715)

- Proves the checking state is inert, truthful, and geometrically stable.
  [`picker.spec.ts:1850`](../../apps/desktop/tests/picker.spec.ts#L1850)
