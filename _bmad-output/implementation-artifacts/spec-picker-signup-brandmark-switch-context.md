---
title: 'Picker signup link, brand wordmark heading, and switch-profile expansion'
type: 'feature'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ed5e851420aca9f454452511f0112cfa2081e90c'
context:
  - 'docs/project-context.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The launch screen offers only sign-in (no account-creation entry), renders "Welcome to Nixus" as plain text instead of the app's logo wordmark, and always starts with local profiles collapsed — even when the user deliberately came from "Switch profile" to change profiles.

**Approach:** Add an "Or create an account" link under the Cloud button that launches Cognito's `/signup` entry through the existing PKCE attempt, render the heading with `NixusLogo` followed by "ixus" exactly as the app shell does, and expand the local section by default only when the picker was reached from "Switch profile".

## Boundaries & Constraints

**Always:** Reuse the existing PKCE verifier/state/loopback-listener attempt and the unchanged callback and token exchange; keep the redirect URI, client id, scope, `response_type`, `code_challenge_method`, and callback handling byte-identical to sign-in. Keep every current picker behavior, test id, and EN/FR parity. Preserve collapsed-by-default local profiles on ordinary launches.

**Ask First:** Any change to the Cognito app client, redirect URI, scopes, token exchange, or any need for a new backend command beyond parameterizing the authorize URL.

**Never:** Duplicate the OAuth flow, add a second listener or attempt, persist the disclosure state, gate local functionality behind an account, send profile data on either cloud click, or add new shared primitives.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Create account | User activates the signup link | `start_login` runs one attempt whose authorize URL uses the `/signup` path with the same PKCE, state, redirect, client id, and scope | Existing localized cloud-failure toast |
| Sign in | User activates the primary CTA | Existing sign-in authorize URL and payload unchanged | Unchanged |
| Callback | Either entry completes in the browser | Same callback, state check, token exchange, and navigation | Unchanged |
| Switch profile | Picker reached from the account menu | Local profiles are expanded on arrival, Cloud CTA still primary | Registry failure still stated truthfully |
| Ordinary launch | Picker reached from the launch gate | Local profiles collapsed exactly as today | Unchanged |
| Heading | Any picker render | One `<h1>` showing the logo mark followed by "ixus", no raw duplicate "Nixus" wordmark text | Unchanged |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/commands/auth.rs:145` -- `build_authorize_url`; constants at `:20-55`; `start_login`/`begin_attempt` at `:364`; byte-exact URL tests at `:1084-1125` must be extended, not bypassed.
- `apps/desktop/src-tauri/src/commands/auth_listener.rs:187` -- loopback attempt lifecycle; must be shared by both entries, never duplicated.
- `apps/desktop/src-tauri/src/commands/cloud_link.rs:28` -- `resolve_intent`; `Login` already find-or-creates a cloud dataset, so a new user needs no new intent variant.
- `apps/desktop/src/hooks/useAuth.ts:84` -- `useSignIn` and the `start_login` payload shape.
- `apps/desktop/src/components/picker/DatasetPicker.tsx:178` -- brand mark and `<h1>`; `:146` cloud handler; disclosure state at `:75`.
- `apps/desktop/src/components/shared/AppSidebar.tsx:157` -- the canonical logo + "ixus" wordmark markup to reuse.
- `apps/desktop/src/routes/picker.tsx` -- add `validateSearch` here, following `routes/car.garage.tsx:24`; the root retains only `period`.
- `apps/desktop/src/components/auth/ProfileMenu.tsx:269` -- "Switch profile" navigation that must carry the context.
- `apps/desktop/src/components/shared/CloudSignInNavigator.tsx` -- read-only; already intent-agnostic.
- `apps/desktop/tests/picker.spec.ts:762` -- gradient-count assertion (currently exactly 2) and the picker IPC mock surface.
- `apps/desktop/tests/auth.spec.ts:484` -- switch-profile navigation and no-keyring-IPC assertions.
- `apps/desktop/src/locales/{en,fr}.json:86` and `src/locales/__tests__/picker-i18n.test.ts:19` -- closed key set and heading string assertions.
- `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md:465` -- gradient "never on a surface" rule that this heading intentionally amends for the launch wordmark.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/commands/auth.rs` -- parameterize the authorize URL so a signup entry uses the `/signup` path with identical parameters; extend the byte-exact tests to cover both entries.
- [x] `apps/desktop/src/hooks/useAuth.ts` -- carry the entry choice on the existing `start_login` call without adding a second command or listener.
- [x] `apps/desktop/src/routes/picker.tsx` + `ProfileMenu.tsx` -- add a typed picker search param and pass it from "Switch profile" only.
- [x] `apps/desktop/src/components/picker/DatasetPicker.tsx` -- add the low-emphasis "Or create an account" link, the logo wordmark heading, and context-driven default expansion.
- [x] Locales, locale test, `picker.spec.ts`, `auth.spec.ts` -- add EN/FR copy and coverage for signup payload, heading mark, both entry contexts, and the updated gradient count.
- [x] `DESIGN.md` / `EXPERIENCE.md` -- record the launch-surface wordmark exception and the switch-profile expansion rule.

**Acceptance Criteria:**
- Given the picker, when the signup link is activated, then exactly one attempt starts and its authorize URL uses the `/signup` path with the same client id, redirect URI, scope, `code_challenge_method`, and a fresh PKCE/state pair.
- Given either cloud entry, when the browser callback returns, then the existing state verification, token exchange, and navigation run unchanged.
- Given the picker heading, when rendered, then it shows the logo mark followed by "ixus" and no duplicated plain-text brand name.
- Given navigation from "Switch profile", when the picker loads, then local profiles are already expanded and the Cloud CTA remains the primary action.
- Given an ordinary gated launch, when the picker loads, then local profiles remain collapsed and no disclosure state is persisted between runs.

## Design Notes

The user-supplied URL fixes the contract: same query parameters, different path segment (`/signup`). Treat it as one authorize-URL variant, not a second flow. The logo wordmark deliberately amends `DESIGN.md`'s "gradient never on a surface" rule for this one heading, matching the shell; record it rather than leaving the contract contradicted.

## Verification

**Commands:**
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- authorize-URL tests pass for both entries.
- `pnpm --filter @nixus/desktop test` -- locale and unit suites pass.
- `pnpm --filter @nixus/desktop exec playwright test tests/picker.spec.ts tests/auth.spec.ts` -- picker and auth suites pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero errors.
- `pnpm --filter @nixus/desktop build` -- build succeeds.

**Manual checks:**
- Screenshots of the launch entry and the switch-profile entry in light and dark at 1280×800 and 1024×680 show the wordmark heading, the signup link, and the correct default expansion without clipping.
