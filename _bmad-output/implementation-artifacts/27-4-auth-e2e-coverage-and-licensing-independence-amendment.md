# Story 27.4: Auth E2E Coverage & Licensing Independence Amendment

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a maintainer,
I want end-to-end coverage of the offline/profile paths plus a written record that login and licensing are separate systems,
so that the local-first guarantee is enforced by tests and nobody re-conflates login with entitlements later.

## Acceptance Criteria

### Prerequisites & scope shape

1. **This is the last story of the feature and it verifies, it does not build.** Given Stories 26.1–26.5 (Cognito/AWS setup, models + `AppError::Auth` + keyring session storage, deep-link + single-instance plugins, PKCE login + callback exchange, session read/refresh/sign-out) and Stories 27.1–27.3 (`hooks/useAuth.ts`, `AccountPromptDialog`, `ProfileMenu`) are all implemented and merged, when this story starts, then the only new artifact it produces is one Playwright spec plus two documentation edits — it implements no feature code. If `apps/desktop/src/hooks/useAuth.ts`, `apps/desktop/src/components/auth/AccountPromptDialog.tsx`, or `apps/desktop/src/components/auth/ProfileMenu.tsx` is missing, **stop and report the missing prerequisite** rather than creating it here. [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.4; #Epic List "Why two epics"]

2. **One new self-contained spec file.** Given `apps/desktop/tests/` is the only desktop E2E location, when this story is implemented, then exactly one new file `apps/desktop/tests/auth.spec.ts` is added, it declares its own local `setupTauriMock(page, …)` helper inside the spec file, and it imports nothing from any other spec. There is no shared fixtures/helpers module in `apps/desktop/tests/` — all 23 existing specs hand-roll their own mock, and this one must too. [Source: docs/project-context.md#Testing Rules; apps/desktop/tests/ (flat directory, 23 `*.spec.ts`, no helpers); apps/desktop/tests/budget-templates.spec.ts:32-136]

3. **The mock reproduces the shell's full IPC surface or the whole suite goes dark.** Given the spec drives the real app shell, when `setupTauriMock` installs `window.__TAURI_INTERNALS__` via `page.addInitScript`, then it: returns `Promise.resolve(null)` for **every** `cmd.startsWith("plugin:")`; defines `transformCallback: () => 1`; defines `window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }`; defines `convertFileSrc: (path: string) => path`; resolves `check_onboarding_status` with `{ needs_onboarding: false, setup_incomplete: false }`; resolves every dashboard/budget command the target surfaces call; and falls back to `Promise.reject("Unknown command: " + cmd)`. A truthy `plugin:updater` response makes `UpdateChecker` mount an always-open `Dialog` whose focus trap sets `aria-hidden="true"` on the whole app, and a missing `transformCallback` makes every `event.listen()` the shell registers throw on mount. [Source: apps/desktop/tests/budget-templates.spec.ts:22-31,67-76,129-134; apps/desktop/tests/onboarding.spec.ts:105-113; apps/desktop/src/routes/__root.tsx:152-153]

### Account prompt & Continue Offline (FR2, NFR1)

4. **A launch with no session shows the prompt.** Given `get_auth_session` resolves `{ status: "LoggedOut" }`, when the spec does `page.goto("/")`, then `page.getByTestId("account-prompt-dialog")` is visible and contains both a `create-account-button` and a `continue-offline-button`. [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md#AC 1a; epics-login.md#Story 27.2]

5. **"Continue Offline" closes it, and nothing is persisted.** Given the dialog is open, when `continue-offline-button` is clicked, then `account-prompt-dialog` has count 0; and after `page.reload()` with the same `LoggedOut` mock the dialog is visible again (every-launch cadence); and the spec asserts no dismissal flag was written on **two** axes: (a) web storage gains no auth key — snapshot `Object.keys(localStorage)` before the click and after, and assert the delta is empty **and** that no key matches `/auth|cognito|offline|session/i`; do **not** assert `localStorage.length === 0`, because the app legitimately owns `i18nextLng`, `theme`, `values-hidden`, and `finance.onboarding.dismissed`; and (b) the recorded IPC log (`window.__IPC_CALLS`, see Task 2) gains no write command from the dismissal — nothing matching `/^(set|save|create|update|complete|delete)_/`. [Source: epics-login.md#Story 27.2 (AC 6, AC 7); architecture-login.md#Frontend Architecture "no persisted dismissal flag, no new SQLite table"; apps/desktop/src/lib/i18n.ts:18-19; apps/desktop/src/contexts/ValuesVisibilityContext.tsx:26,40; apps/desktop/src/components/dashboard/SetupIncompleteBanner.tsx:16,35; apps/desktop/src/main.tsx:6,22 (`next-themes` ThemeProvider)]

6. **After dismissing, the app is fully usable with no gating — this is the NFR1 assertion.** Given "Continue Offline" was clicked, when the spec continues, then the dashboard at `/` renders its real content (`page.getByTestId("budget-overall-progress")` visible), navigation to `/spending/budget` renders that surface (`page.getByTestId("add-group-button")` visible), and a **scoped** gating sweep finds nothing: `await expect(page.getByText(/upgrade|paywall|requires an account|sign in to continue|not entitled/i)).toHaveCount(0)`. No feature is gated, no degraded state is shown, and no further auth command is required to use the app. Scope the sweep to that copy pattern — do **not** assert a blanket `getByRole("alert")` count of 0, because legitimate non-auth banners (e.g. `setup-incomplete-banner`) can occupy that role and would produce a false failure. [Source: epics-login.md#Story 27.4 (AC 1), #Story 27.2 (AC 8); architecture-login.md NFR1; apps/desktop/tests/dashboard.spec.ts:474-476; apps/desktop/tests/budget.spec.ts:248,255; apps/desktop/tests/onboarding.spec.ts:491-506]

7. **The dialog is absent for a signed-in user and never flashes while loading.** Given `get_auth_session` resolves `{ status: "LoggedIn", email: "…", name: "…" }`, when the shell renders, then `account-prompt-dialog` has count 0. And given `get_auth_session` is delayed (`delayMs`) so the pending window is observable, when the shell first paints, then `account-prompt-dialog` has count 0 for the whole pending window and only appears after the resolution if the resolved status is `LoggedOut`. [Source: epics-login.md#Story 27.2 (AC 2, AC 3); apps/desktop/tests/budget-templates.spec.ts:56-65 (`delayMs` settle helper)]

### Sign-in launch boundary (FR1 edge)

8. **"Create Account" is asserted only up to the launch of the external Hosted UI.** Given external services are never mocked-through in this suite, when `create-account-button` is clicked, then the spec asserts that `start_login` was invoked **exactly once** — recorded by pushing onto a `window.__IPC_CALLS` array inside the mock, read back with `page.evaluate`, exactly as `onboarding.spec.ts` records `window.__APPLIED_TEMPLATE_CALLS`; and the spec asserts **nothing** about Cognito, Google, the browser that opens, the callback URL, the token exchange, or the `auth:callback-received` event. No test navigates to any `amazoncognito.com` URL. [Source: epics-login.md#Story 27.4 (AC 3); architecture-login.md#File Organization Patterns "Cognito calls themselves are not mocked in E2E"; apps/desktop/tests/onboarding.spec.ts:100-103,175-179]

9. **A dedicated test Cognito pool is recorded as a CI task, not delivered here.** Given a real sign-in E2E would need its own user pool/app client, when this story completes, then that need is written down in this story's Completion Notes as an explicitly deferred CI/ops setup task, and **no** AWS resource, CI workflow, secret, or environment variable is created by this story. [Source: epics-login.md#Story 27.4 (AC 3); architecture-login.md#Gap Analysis Results "a dedicated test/sandbox Cognito user pool for CI/E2E — this is a CI/ops setup task"]

### Header profile entry point (FR3)

10. **The logged-out header icon renders clean.** Given `get_auth_session` resolves `{ status: "LoggedOut" }`, when the header renders, then the `ProfileMenu` trigger is visible in the header, it presents a sign-in affordance, and **no** auth error state is displayed anywhere on a clean never-signed-in profile — asserted with scoped queries: the session-expired element has count 0, the `<header>` does not match `/expired|error|failed/i`, and no `sonner` toast is present. Keep these assertions scoped to the header and to auth copy; a blanket `getByRole("alert")` count of 0 would collide with unrelated app banners. [Source: epics-login.md#Story 27.4 (AC 2), #Story 27.3 (AC 3)]

11. **The centred search trigger is not displaced by the profile icon — header regression check.** Given `TopBar` is `flex … items-center justify-center` with a single `max-w-[480px]` search button as its only child before this feature, when the header renders with `ProfileMenu` mounted, then `topbar-search-trigger` is still visible, still clickable, and still opens the chat bar (⌘K surface), and its horizontal centre is within **8px** of the `<header>`'s horizontal centre (`boundingBox()` arithmetic). 8px is deliberate: a bare right-hand icon added to a `justify-center` row shifts the centre by roughly half the icon's footprint (≥16px for any tappable target meeting the project's `min-h-target-min`), so a looser threshold would let the regression through while a tighter one would trip on subpixel rounding. [Source: apps/desktop/src/components/shared/TopBar.tsx:16-35; apps/desktop/src/routes/__root.tsx:123; epics-login.md#Story 27.3 (AC 1)]

12. **The signed-in profile panel shows identity and signs out.** Given `get_auth_session` resolves `{ status: "LoggedIn", email: "user@example.com", name: "Test User" }`, when the trigger is activated, then a panel/popover opens showing `user@example.com` and `Test User` and a sign-out action; and it is a popover anchored to the icon, not a page — asserted by `expect(page).toHaveURL(/\/$/)` (the URL does not change) and by the absence of any `routes/profile` navigation. [Source: epics-login.md#Story 27.3 (AC 4); architecture-login.md#Structure Patterns "not a `routes/profile.tsx` route"]

13. **A missing `name` claim degrades to email-only with no empty row.** Given `get_auth_session` resolves `{ status: "LoggedIn", email: "user@example.com", name: null }`, when the panel opens, then the email is shown, and the panel renders no blank/`null` name row — asserted by the name element having count 0 (not merely empty text). [Source: epics-login.md#Story 27.3 (AC 5)]

14. **Sign-out invokes `sign_out` once and returns the header to logged out.** Given the panel is open on a `LoggedIn` session, when the sign-out action is activated and the mock flips its `get_auth_session` answer to `{ status: "LoggedOut" }` after the `sign_out` call, then `sign_out` is recorded exactly once in `window.__IPC_CALLS`, the panel closes, the trigger returns to its sign-in appearance, and — because the session query was invalidated — `account-prompt-dialog` becomes visible again. That last assertion is what proves both surfaces read the one `["auth", "session"]` cache entry rather than holding private copies. [Source: epics-login.md#Story 27.3 (AC 7, AC 8); architecture-login.md#Cross-Component Dependencies "single source of truth"]

15. **`SessionExpired` tells the user plainly and does not break the app (NFR1).** Given `get_auth_session` resolves `{ status: "SessionExpired" }`, when the shell renders, then the user is explicitly told the session expired and to sign in again (via the header/panel state and/or a `sonner` toast, matching whatever Story 27.3 shipped), **and** the dashboard at `/` plus `/spending/budget` still render their real content with no gating — the same positive assertions as AC 6. The session is never silently dropped. [Source: epics-login.md#Story 27.3 (AC 6); architecture-login.md#Authentication & Security "Session refresh failure"]

16. **No raw i18n key leaks into any auth surface.** Given every auth string resolves from `en.json`/`fr.json`, when the dialog and the profile panel render, then neither contains the literal substring `auth.` — asserted with `await expect(locator).not.toContainText("auth.")`, mirroring the `not.toContainText("settings.template")` guard already used for the same class of bug. [Source: apps/desktop/tests/budget-templates.spec.ts:409; epics-login.md#Story 27.2 (AC 5), #Story 27.3 (AC 10)]

### Regression & blast radius

17. **The existing 23 specs still pass and none of them is edited.** Given `pnpm --filter @nixus/desktop exec playwright test` is the full desktop suite, when this story completes, then a baseline run captured **before** the change and a run after it show the same set of passing tests plus the new `auth.spec.ts` tests, and `git diff --name-only apps/desktop/tests/` lists **only** the new `auth.spec.ts`. Do not add an auth mock to an existing spec, and do not delete or weaken an existing assertion. [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md#AC 10, Task 8; apps/desktop/playwright.config.ts]

18. **No production source change, with exactly two allowed exceptions.** Given this is a verification story, when it completes, then `git status` shows changes limited to: `apps/desktop/tests/auth.spec.ts` (new), `_bmad-output/planning-artifacts/architecture.md` (AC 21), and this story file. Two exceptions are permitted and must each be called out in Completion Notes: (a) adding a missing `data-testid` to `components/auth/ProfileMenu.tsx` if Story 27.3 shipped it without test-addressable hooks; (b) fixing a real FR4 coupling violation found in AC 19. Nothing under `src-tauri/`, no `package.json`/`Cargo.toml` diff, no new dependency, no new static asset, no migration. [Source: epics-login.md#Story 27.4 (AC 5) "any violation found is fixed rather than documented as acceptable"; architecture-login.md#Delta to Existing Project Tree]

### FR4 — login/licensing independence

19. **The independence audit is executed with commands and results recorded, not asserted from memory.** Given FR4, when the codebase is audited, then each of these five dimensions is checked with a literal search whose command and result are written into this story's Completion Notes, and each returns clean: (i) **no shared Rust module** — no auth file references `entitlement|license|licence|keygen|lemonsqueezy|tier|subscription|NotEntitled`, and no licensing file references auth symbols; (ii) **no shared frontend hook** — `hooks/useAuth.ts` imports nothing licensing-related and no `useEntitlement`/`useLicense`/`FeatureGate`/`Paywall`/`isPro` symbol references auth; (iii) **no shared query key** — `queryKeys.auth.session` is `["auth","session"]` and is disjoint from any `["license", …]` key; (iv) **no shared database table** — `git diff` over `apps/desktop/src-tauri/migrations/` from before Epic 26 shows **zero** new migration files, and no auth code writes to the `config` table; (v) **no shared "account" concept** — no type, field, or table joins a Cognito `sub`/`email` to a licensing identity. [Source: epics-login.md#Story 27.4 (AC 5), FR4; architecture-login.md#Data Boundaries]

20. **The audit uses the correct definition of coupling, so shared infrastructure is not misreported as a violation.** Given three collision points exist by design, when the audit is written up, then it states explicitly that the following are **shared infrastructure, not coupling**, and are acceptable: `credentials.rs` hosting both `store_cognito_session` (keyring service `nixus-auth`) and the existing AI-key functions (keyring service `nkbaz-finance`) — and, later, the planned Keygen license blob — because the entries are distinct and no function reads the other's data; and `AppError` carrying both `Auth { message, recoverable }` and the future `NotEntitled { module }` as sibling variants of the one project-wide error enum. Coupling means a **shared entry, shared identity, shared state, or a control-flow dependency** — one system reading, writing, or gating on the other's data. Anything meeting that definition is a violation and must be fixed under AC 18(b). [Source: architecture-login.md#Implementation Patterns "Correction to prior decision"; architecture-entitlements-licensing.md#Data Architecture (license blob "via the existing OS-keychain `keyring`/`credentials.rs` pattern"), #Naming Patterns (`AppError::NotEntitled`); apps/desktop/src-tauri/src/credentials.rs:3; apps/desktop/src-tauri/src/error.rs:5-13]

21. **The stale platform Cognito design is marked not authoritative — this is the one doc edit this story owns.** Given `_bmad-output/planning-artifacts/architecture.md#Authentication & Security` still presents an April-2026 Cognito + DynamoDB + Stripe design whose desktop rows actively contradict the shipped feature, when this story completes, then that section carries a clearly visible superseded marker that: names it as **not authoritative** for login; points to `architecture-login.md` as the **sole** reference for login questions and `architecture-entitlements-licensing.md` for licensing; and explicitly flags the two rows a future reader would otherwise copy — "Desktop auth flow: System browser OAuth → **localhost redirect**" (the shipped flow uses the `nixus://auth/callback` custom URI scheme via `tauri-plugin-deep-link`) and "Token storage (desktop): **tauri-plugin-stronghold**" (the shipped storage is the OS keyring via `credentials.rs`). [Source: epics-login.md#Story 27.4 (AC 6); architecture-login.md#Implementation Handoff "Refer to this document, not `architecture.md`'s stale Cognito section"; _bmad-output/planning-artifacts/architecture.md:218-228]

22. **The licensing amendment is verified, not rewritten.** Given the amendment required by FR4 **already exists** in `architecture-entitlements-licensing.md` (dated 2026-08-09, immediately below the `### Authentication & Security` section at line 150), when this story runs, then it is read and confirmed to satisfy all three requirements — it notes login now exists as an unrelated concern, it states the "no login form anywhere in the desktop app" rule described the licensing/entitlement model specifically and is **not** reversed, and it confirms the LemonSqueezy + Keygen design is unchanged — and the confirmation is recorded in Completion Notes. **Do not add a second amendment block and do not reword the existing one** unless a stated requirement is genuinely absent; if one is absent, extend the existing block in place. [Source: epics-login.md#Story 27.4 (AC 4); _bmad-output/planning-artifacts/architecture-entitlements-licensing.md:150]

23. **Deferred items stay deferred.** Given the deferred list in `architecture-login.md`, when this story completes, then Cognito `/oauth2/revoke` token revocation, refresh-token rotation, and all cloud sync / push-notification / community work remain unimplemented and unmentioned as deliverables — this story adds no code or test that presumes any of them. [Source: epics-login.md#Story 27.4 (AC 7); architecture-login.md#Deferred Decisions]

## Tasks / Subtasks

- [x] **Task 1: Verify prerequisites and capture the regression baseline (AC: 1, 17)**
  - [x] Confirm these exist: `apps/desktop/src/hooks/useAuth.ts` (exports `useAuthSession`, `useSignIn`, `useSignOut`), `apps/desktop/src/components/auth/AccountPromptDialog.tsx`, `apps/desktop/src/components/auth/ProfileMenu.tsx`, `apps/desktop/src/lib/constants.ts` → `queryKeys.auth.session`, `apps/desktop/src/lib/types.ts` → `AuthState`, `apps/desktop/src-tauri/src/commands/auth.rs`, and `start_login`/`handle_auth_callback`/`get_auth_session`/`sign_out` in `lib.rs`'s `generate_handler!`. Any miss → stop and report.
  - [x] Read `_bmad-output/implementation-artifacts/27-3-*.md` if it exists and harvest the **actual** `ProfileMenu` `data-testid` strings and `auth.*` i18n keys it shipped. Read `apps/desktop/src/components/auth/ProfileMenu.tsx` and `AccountPromptDialog.tsx` directly and treat the source as final over any document.
  - [x] Run `pnpm --filter @nixus/desktop exec playwright test` and save the pass/fail list as the baseline. Do this **before** writing anything.

- [x] **Task 2: Write the mock harness in `apps/desktop/tests/auth.spec.ts` (AC: 2, 3)**
  - [x] `import { test, expect, type Page } from "@playwright/test";` — the exact import line used by `budget-templates.spec.ts:1`.
  - [x] Define a local `type AuthOutcome` / `interface AuthOptions` and a local `settle(outcome)` helper supporting `{ kind: "resolve" | "reject", value/error, delayMs? }`, copied in shape from `budget-templates.spec.ts:7-65`. `delayMs` is what makes AC 7's no-flash window observable.
  - [x] `setupTauriMock(page, options)` uses `page.addInitScript((opts) => { … }, options)` and installs `__TAURI_EVENT_PLUGIN_INTERNALS__`, then `__TAURI_INTERNALS__` with `transformCallback`, `invoke`, `convertFileSrc`.
  - [x] First line of `invoke`: `if (cmd.startsWith("plugin:")) return Promise.resolve(null);`.
  - [x] Inside the init script, create `const ipcCalls: { cmd: string; args: unknown }[] = []` and expose it as `window.__IPC_CALLS`, pushing **every** non-`plugin:` `invoke` call before dispatching it — the `window.__APPLIED_TEMPLATE_CALLS` idiom from `onboarding.spec.ts:100-103`, widened to the whole command surface. Recording everything (not just auth) is what makes AC 5's "no write command fired" assertion possible; derive auth-specific counts by filtering (`__IPC_CALLS.filter(c => c.cmd === "start_login")`).
  - [x] `get_auth_session` returns the configured `AuthState`; make the value mutable so Task 6 can flip it to `LoggedOut` after `sign_out` resolves. `start_login` and `sign_out` resolve `null` unless an outcome overrides them.
  - [x] Resolve the non-auth commands the target surfaces need, copying the value shapes verbatim from `budget-templates.spec.ts:95-128`: `check_onboarding_status` → `{ needs_onboarding: false, setup_incomplete: false }`, `get_budget_groups`, `get_budget_categories`, `get_budget_status`, `get_budget_summary`, `get_top_budget_categories`, `get_accounts`, `get_assets`, `get_current_net_worth`, `get_recent_net_worth_snapshots`, `get_spending_breakdown`, `get_expenses`, `get_latest_expense`, `get_all_budget_categories`, `get_net_worth_history`, `get_net_worth_change`, `get_db_status`. Add whatever else the dashboard/budget surfaces request — a rejected command shows as an error card, which would silently weaken AC 6.
  - [x] `default: return Promise.reject("Unknown command: " + cmd);`

- [x] **Task 3: `test.describe("account prompt on launch")` (AC: 4, 5, 6, 7, 16)**
  - [x] `LoggedOut` → `page.goto("/")` → `account-prompt-dialog` visible, `create-account-button` and `continue-offline-button` visible, dialog `not.toContainText("auth.")`.
  - [x] Click `continue-offline-button` → `expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0)`.
  - [x] Same test (or a sibling): snapshot `Object.keys(localStorage)` via `page.evaluate` before and after the click, assert the delta is empty and that no key matches `/auth|cognito|offline|session/i` (the app legitimately owns `i18nextLng`, `theme`, `values-hidden`, `finance.onboarding.dismissed` — never assert an empty storage), assert `__IPC_CALLS` gained no `/^(set|save|create|update|complete|delete)_/` command, then `page.reload()` and assert the dialog is visible again.
  - [x] After dismissal: `budget-overall-progress` visible on `/`; navigate to `/spending/budget`; `add-group-button` visible; then the no-gating sweep — `await expect(page.getByText(/upgrade|paywall|requires an account|sign in to continue/i)).toHaveCount(0)` and `await expect(page.getByRole("alert")).toHaveCount(0)`.
  - [x] `LoggedIn` → dialog `toHaveCount(0)`.
  - [x] Delayed `get_auth_session` (`delayMs: 500`) → dialog `toHaveCount(0)` while pending, then present once it resolves `LoggedOut`. Prove the pending window was real by asserting a loading affordance or by reading `__IPC_CALLS` before the resolution — do not rely on a bare `waitForTimeout`.

- [x] **Task 4: `test.describe("sign-in launch")` (AC: 8)**
  - [x] `LoggedOut` → click `create-account-button` → `expect(await page.evaluate(() => (window as any).__IPC_CALLS.filter((c: any) => c.cmd === "start_login").length)).toBe(1)`.
  - [x] Assert the app did not navigate: `await expect(page).toHaveURL(/localhost:1420\/$/)`.
  - [x] Add a one-line comment stating that everything past `start_login` — Hosted UI, Google, callback, token exchange — is deliberately out of E2E scope because external services are not mocked in this suite.
  - [x] Assert nothing about `handle_auth_callback` or the `auth:callback-received` event.

- [x] **Task 5: `test.describe("header profile entry point")` (AC: 10, 11, 16)**
  - [x] `LoggedOut` → profile trigger visible in the header with a sign-in affordance.
  - [x] Clean-profile assertion: no session-expired element, `expect(page.getByRole("alert")).toHaveCount(0)`, header `not.toContainText(/expired/i)`.
  - [x] Header regression: `topbar-search-trigger` visible; click it and assert the chat bar surface opens; then compare `boundingBox()` centres of `topbar-search-trigger` and the `<header>` and assert the delta is `< 8`.
  - [x] Profile trigger and panel `not.toContainText("auth.")`.

- [x] **Task 6: `test.describe("profile panel and sign out")` (AC: 12, 13, 14)**
  - [x] `LoggedIn` with `name: "Test User"` → activate trigger → panel visible, contains `user@example.com` and `Test User`, and a sign-out action; `await expect(page).toHaveURL(/localhost:1420\/$/)` proves popover-not-route.
  - [x] `LoggedIn` with `name: null` → panel shows the email and the name element has `toHaveCount(0)`.
  - [x] Sign-out: mock flips its stored `AuthState` to `{ status: "LoggedOut" }` when `sign_out` is invoked → activate sign-out → `sign_out` recorded exactly once, panel `toHaveCount(0)`, trigger back to the sign-in affordance, and `account-prompt-dialog` becomes visible (proves the shared `["auth","session"]` cache entry).

- [x] **Task 7: `test.describe("expired session")` (AC: 15)**
  - [x] `SessionExpired` → assert the explicit "session expired, sign in again" message using whatever affordance Story 27.3 shipped (header/panel state and/or the `sonner` toast — `sonner` is already a dependency and `UpdateChecker.tsx` is the in-repo precedent).
  - [x] Then repeat AC 6's usability sweep verbatim: `/` renders `budget-overall-progress`, `/spending/budget` renders `add-group-button`, and the gating/paywall sweep finds nothing.

- [x] **Task 8: FR4 independence audit (AC: 19, 20)**
  - [x] Run and record, for `apps/desktop/src-tauri/src` and `apps/desktop/src`: a search for `entitlement|licen[cs]e|keygen|lemonsqueezy|NotEntitled|isPro|FeatureGate|Paywall|subscription|tier` and confirm the only hits are unrelated (e.g. an unrelated word inside prose). Note: as of story creation both the licensing feature **and** all auth code were absent from the codebase — so if licensing is still unimplemented, say exactly that in the write-up instead of claiming a two-sided audit.
  - [x] Confirm the reverse direction: no licensing symbol references `useAuth`, `AuthState`, `CognitoSession`, `get_auth_session`, `sign_out`, `cognito`, or `sub`.
  - [x] Confirm `git status`/`git log` shows **zero** new files under `apps/desktop/src-tauri/migrations/` across Epics 26–27, and that no auth code writes to the `config` table.
  - [x] Confirm `queryKeys.auth.session === ["auth","session"]` and that no licensing key shares that namespace.
  - [x] Confirm the two by-design collisions are intact and correct — `credentials.rs` uses `KEYRING_SERVICE = "nkbaz-finance"` for AI keys and a separate `nixus-auth`/`cognito-session` entry for the session, with no function reading across; `AppError::Auth` is a sibling variant, not a wrapper around any licensing error. Write these up as **shared infrastructure, not coupling**, per AC 20.
  - [x] Any genuine violation: fix it, then re-run Task 1's baseline comparison and note the fix under AC 18(b).

- [x] **Task 9: Documentation verification and the one doc edit (AC: 21, 22, 23)**
  - [x] Read `_bmad-output/planning-artifacts/architecture-entitlements-licensing.md:150` and confirm the 2026-08-09 amendment covers all three required statements. Record the confirmation. Do **not** add a second amendment block.
  - [x] Edit `_bmad-output/planning-artifacts/architecture.md`: insert a blockquote superseded marker directly under the `### Authentication & Security` heading (line 218) — before the decision table — naming the section not authoritative, pointing to `architecture-login.md` (login, sole reference) and `architecture-entitlements-licensing.md` (licensing), and explicitly correcting the "localhost redirect" and "tauri-plugin-stronghold" rows. Match the existing blockquote-amendment style used at `architecture-entitlements-licensing.md:150`.
  - [x] Change nothing else in `architecture.md` — leave the stale table in place, marked.
  - [x] Confirm nothing in this story implements `/oauth2/revoke`, refresh-token rotation, or any sync/notification/community work.

- [x] **Task 10: Gates (AC: 9, 17, 18)**
  - [x] Iterate on the new spec alone while writing it: `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts`. `webServer.reuseExistingServer` is true outside CI, so a desktop `pnpm run dev` already listening on port 1420 will be reused — make sure the server on 1420 is the desktop app's.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — full suite, diffed against Task 1's baseline. Any pre-existing spec that newly fails means the new spec is leaking state or a header/layout change broke it. Fix the cause, never the old spec.
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — the spec is type-checked TypeScript under `strict` + `noUnusedLocals` + `noUnusedParameters`; an unused local in the mock is a CI-class failure.
  - [x] `pnpm --filter @nixus/desktop test` (vitest) — must still pass; this story adds no vitest file.
  - [x] `git status` matches AC 18's allowed file list exactly.
  - [x] Record in Completion Notes: the audit results (Task 8), the amendment confirmation (Task 9), and the deferred "dedicated test Cognito user pool / app client for CI" task (AC 9).

## Dev Notes

### The single most important fact about this test suite

**Desktop Playwright specs run against the plain Vite dev server, not the Tauri runtime.** `playwright.config.ts` sets `webServer.command: 'pnpm run dev'`, `port: 1420`, `baseURL: 'http://localhost:1420'`. There is no Rust process, no keyring, no real IPC, no deep link. Every spec fabricates `window.__TAURI_INTERNALS__.invoke` in `page.addInitScript`.

Consequences that shape every AC above:

- You cannot test the deep-link callback, the PKCE exchange, or the keyring. Those are Epic 26's Rust concerns with no E2E surface — which is exactly why AC 8 stops at `start_login`.
- You *can* test every frontend state transition precisely, because you control the `AuthState` the mock returns.
- "Relaunch" in AC 5 means `page.reload()` — `addInitScript` re-runs, the component's `useState` dismissal is discarded, and the every-launch cadence reproduces faithfully.

[Source: apps/desktop/playwright.config.ts; apps/desktop/tests/budget-templates.spec.ts:32-135]

### Two mock omissions that break the entire page, not just one test

1. **Any `plugin:` command resolving truthy.** `__root.tsx:152` mounts `<UpdateChecker />`. A truthy `plugin:updater|check` response makes it render an always-open `Dialog`; Base UI's focus trap then sets `aria-hidden="true"` on the app root, and *every* `getByRole`/`getByTestId` in the file returns nothing. Guard with `if (cmd.startsWith("plugin:")) return Promise.resolve(null);` as the first statement in `invoke`.
2. **Missing `transformCallback`.** `__root.tsx:153` mounts `<RecurringApplyListener />`, which calls `event.listen()` on mount. Without `transformCallback: () => 1` and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`, the listener throws during mount and takes the surface down.

Both are documented in-repo as hard-won lessons. Copy the guards; do not re-derive them. [Source: apps/desktop/tests/budget-templates.spec.ts:22-31,67-74; apps/desktop/tests/onboarding.spec.ts:105-113]

### Two runtime details that affect timing assertions

- **Toasts work.** `<Toaster />` from `@nixus/shared` is mounted in `main.tsx:25`, outside the router. If Story 27.3 signals `SessionExpired` with a `sonner` toast (AC 15), it will render in E2E — assert it with a text/role query, and remember it lives outside the `<header>` subtree, so a header-scoped locator will not find it.
- **Rejected queries retry.** `main.tsx:11` creates a bare `new QueryClient()` with no `retry` override, so TanStack Query v5's default of 3 retries with exponential backoff applies. A `get_auth_session` rejection therefore takes seconds to settle into the error state, and stays `pending`/`fetching` throughout — which is precisely why the 23 existing specs never render an auth surface, and why an error-path test (if you add one) must `await expect(...)` rather than assert synchronously.

[Source: apps/desktop/src/main.tsx:7,11,25; apps/desktop/package.json (`sonner ^2.0.7`, `@tanstack/react-query ^5.90.21`, `@playwright/test ^1.58.2`)]

### Why the existing 23 specs are unaffected — and how you could break that

Every existing spec's `invoke` mock ends in `default: return Promise.reject("Unknown command: …")`. So in those specs `get_auth_session` **rejects**, putting `useAuthSession()` into TanStack Query's *error* state. Story 27.2 built `AccountPromptDialog` on a strict positive match — it renders only on a successfully-resolved `{ status: "LoggedOut" }` — so it stays `null` in all of them. `ProfileMenu` must behave the same way for the header.

This is load-bearing. If the full-suite run in Task 10 shows new failures across many files, the likely cause is an auth surface rendering in the error/loading state, or `ProfileMenu` altering the header layout (AC 11). Fix the component (that is the AC 18(b) exception), never the old spec — and specifically **never** silence a failure by adding a `get_auth_session` case to someone else's mock. [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md#AC 10, "Anti-patterns"; apps/desktop/tests/budget.spec.ts]

### IPC contract this spec mocks

| Command | Args | Resolves | Notes |
|---|---|---|---|
| `get_auth_session` | none | `AuthState` | `{ "status": "LoggedOut" }` \| `{ "status": "LoggedIn", "email": string, "name": string \| null }` \| `{ "status": "SessionExpired" }` — serde `#[serde(tag = "status")]`, plain tagged JSON, no envelope |
| `start_login` | none | `null` | Opens the Hosted UI in the **system** browser from Rust. In E2E it is a recorded no-op |
| `sign_out` | none | `null` | Clears the keyring entry. `useSignOut()` invalidates `queryKeys.auth.session` on success |
| `handle_auth_callback` | `{ url }` | `null` | **Not mocked, not exercised** — deep-link driven, unreachable from the Vite harness |

Errors serialize as `{ type, message, … }`; the auth variant is `AppError::Auth { message, recoverable }` → `{ "type": "auth", "message": "…", "recoverable": bool }`, a sibling of the existing `validation` / `database` / `ai_service` / `file` / `not_configured` / `invalid_credentials` / `unavailable` types. Reject with that object shape if you add an error-path test. [Source: architecture-login.md#Naming Patterns, #IPC command surface; apps/desktop/src-tauri/src/error.rs:5-13,54-60; epics-login.md#Story 26.2, #Story 26.5]

### Selectors and keys

Known-fixed by Story 27.2 (`AccountPromptDialog`):

| Selector | Element |
|---|---|
| `account-prompt-dialog` | `DialogContent` |
| `create-account-button` | Primary action → `useSignIn()` |
| `continue-offline-button` | Secondary action → local `setDismissed(true)` |

i18n keys it added to both `en.json` and `fr.json`: `auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`, `auth.createAccount`, `auth.continueOffline`, `auth.openingBrowser`, `auth.signInFailed`. Locale files are **flat dotted-key JSON** (`Record<string, string>`), not nested.

`ProfileMenu` (Story 27.3) selectors are **not fixed by any document you can trust** — 27.3's story file may not exist yet. Task 1 requires reading `ProfileMenu.tsx` and taking the source as authoritative. If it shipped without `data-testid` hooks, add them following the established `<entity>-<part>` convention — `profile-menu-trigger`, `profile-menu-panel`, `profile-menu-email`, `profile-menu-name`, `profile-menu-sign-out`, `profile-menu-session-expired` — and note the addition under AC 18(a). Do not invent parallel selectors that disagree with the component. [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md#AC 1a, Task 5; apps/desktop/src/locales/en.json]

### The header is the real regression risk

`TopBar.tsx` is a single-child, `justify-center` flex row:

```
<header className="flex h-14 shrink-0 items-center justify-center bg-chrome px-page-x">
  <button … data-testid="topbar-search-trigger" …>  // max-w-[480px], the ⌘K search field
```

Adding a right-hand icon to a `justify-center` row pushes the search field off-centre. AC 11 exists to catch that with `boundingBox()` arithmetic rather than a screenshot.

That file also carries a comment that Story 27.3 should have removed:

```
// No account avatar: this is one user, one machine, no login, and a person-shaped glyph in the
// chrome implies an account the product does not have.
```

If it is still there after 27.3, flag it in Completion Notes as a documentation defect. Do not rewrite `TopBar.tsx` for it — the project's comment rule is "only comment WHY", and this comment now asserts something false. [Source: apps/desktop/src/components/shared/TopBar.tsx:13-14,16-35; docs/project-context.md#Code Quality & Style Rules]

### Surfaces to use for the "app still works" assertions

- `/` — the dashboard (`routes/index.tsx`). Its `beforeLoad` calls `fetchOnboardingStatus()` and `throw redirect({ to: "/onboarding" })` when `needs_onboarding` is true. **Your mock must return `needs_onboarding: false`** or every test lands on the wizard instead. Stable selector after load: `budget-overall-progress`.
- `/spending/budget` — the budget surface (`routes/spending.budget.tsx`). Stable selector: `add-group-button`.

`AccountPromptDialog` is deliberately suppressed on `/onboarding` (Story 27.2 guards on the router pathname, because a modal there aria-hides the wizard and bricks first run). Do not write a test that expects the prompt at `/onboarding`. [Source: apps/desktop/src/routes/index.tsx:34-43; apps/desktop/tests/dashboard.spec.ts:474-476; apps/desktop/tests/budget.spec.ts:248,255; 27-2-account-prompt-dialog-with-continue-offline.md#Edge cases]

### FR4 audit — what "independence" actually means here

At the time this story was written, a full repository sweep found **neither** subsystem in code: no auth files (only `credentials.rs`, which stores AWS/OpenAI **API keys** under keyring service `nkbaz-finance`, plus a `TopBar.tsx` comment asserting the product has no login), and **no** entitlements/licensing implementation at all — no Rust module, no commands, no hooks, no migrations. `architecture-entitlements-licensing.md` is a design document with nothing built behind it.

So write the audit honestly. If licensing is still unimplemented when you run it, the finding is: *"auth code introduces zero references to entitlement/licensing concepts; licensing has no implementation to couple to; the amendment is the artifact that protects the boundary going forward."* Do not stage a two-sided audit you cannot actually perform — AC 19 asks for recorded commands and real results, and a fabricated cross-check is exactly the "lying about completion" failure this story exists to prevent.

The three places the two systems are *designed* to meet, none of which is coupling (AC 20):

| Collision point | Auth side | Licensing side (planned) | Verdict |
|---|---|---|---|
| `credentials.rs` | keyring service `nixus-auth`, account `cognito-session` | Keygen license blob "via the existing `keyring`/`credentials.rs` pattern"; AI keys already use service `nkbaz-finance` | **Shared storage utility, distinct entries.** Fine — as long as no function reads across services |
| `AppError` | `Auth { message, recoverable }` | `NotEntitled { module }` | **Sibling variants of the one project-wide enum.** Fine — the project rule is "never create ad-hoc error types" |
| SQLite | none — auth adds no table, no migration, no `db/` module | non-secret license metadata cached in the existing `config` table | **Fine while auth writes nothing to SQLite.** An auth write to `config` *would* be a violation |

Coupling = a shared keyring entry, a shared identity/`sub`, shared state, or one system reading/writing/gating on the other's data. That is the bar. [Source: architecture-login.md#Data Boundaries, #Implementation Patterns "Correction to prior decision"; architecture-entitlements-licensing.md#Data Architecture, #Authentication & Security, #Naming Patterns; apps/desktop/src-tauri/src/credentials.rs:1-13; apps/desktop/src-tauri/src/error.rs:5-13; docs/project-context.md#5]

### Documentation state — verify one, edit the other

- `architecture-entitlements-licensing.md:150` — the FR4 amendment **already exists** (2026-08-09) and already covers all three required statements. This story confirms it. Adding a second block would be duplicate work that makes the doc worse.
- `architecture.md#Authentication & Security` (line 218) — **no** superseded marker exists. Its table still says desktop auth uses a **localhost redirect** and stores tokens in **tauri-plugin-stronghold**, both of which contradict the shipped design (`nixus://auth/callback` via `tauri-plugin-deep-link`; OS keyring via `credentials.rs`). This is the one real doc edit AC 21 requires. `architecture.md`'s front matter still reads `project_name: 'nkbaz-finance'` and dates to 2026-04-14 — it is a historical document, so mark the section rather than rewriting the table.

### Out of scope — do not do these

- Creating `useAuth.ts`, `AccountPromptDialog.tsx`, `ProfileMenu.tsx`, or anything under `src-tauri/` (Epics 26 / Stories 27.1–27.3).
- Testing the Cognito Hosted UI, Google consent, the deep-link callback, `handle_auth_callback`, the token exchange, or the `auth:callback-received` event.
- Provisioning a test Cognito user pool, adding a CI workflow, or adding secrets/env vars (AC 9 records the need; it does not satisfy it).
- Implementing `/oauth2/revoke`, refresh-token rotation, or any sync/notification/community feature.
- Adding an auth vitest locale test — Story 27.2 already owns `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` and the `auth.*` key parity contract.
- Adding `@testing-library/react` or any other dependency to `apps/desktop`.
- Editing any file in `apps/desktop/tests/` other than the new `auth.spec.ts`.

### Project Structure Notes

```
apps/desktop/
└── tests/
    └── auth.spec.ts                 # NEW — the only code artifact of this story

_bmad-output/planning-artifacts/
├── architecture.md                  # MODIFIED — superseded marker under "### Authentication & Security"
└── architecture-entitlements-licensing.md   # VERIFIED ONLY — amendment already present at line 150
```

Flat `tests/` directory, one spec per feature, no shared helper module — `auth.spec.ts` matches the existing 23 files exactly.

**Stale documentation to distrust (verified against source):**

1. `docs/project-context.md#Testing Rules` says *"No unit test framework in desktop — all testing is Playwright E2E."* **Stale.** `apps/desktop` has `vitest.config.ts` (`environment: "jsdom"`, `include: ["src/**/*.test.{ts,tsx}"]`), a `"test": "vitest run"` script, and six test files under `src/**/__tests__/`. `epics-login.md`'s "no frontend unit tests" is stale the same way. This does not change this story's deliverable — the E2E spec is what AC 2 requires — but do not assert "desktop has no unit tests" anywhere.
2. `docs/project-context.md` and both architecture docs say the shared package is `@nkbaz/shared` and the desktop package is `@nkbaz/desktop`. **Stale.** They are `@nixus/shared` and `@nixus/desktop`. Every pnpm filter in this story uses `@nixus/desktop`. Desktop convention imports from the package **root** (`import { Button } from "@nixus/shared"`), not the `/ui` subpath, despite what `epics-login.md#Story 27.2` says.
3. `architecture-login.md#Delta to Existing Project Tree` shows `ProfileMenu` mounted in `routes/__root.tsx`. In reality the app header is `components/shared/TopBar.tsx`, rendered from `__root.tsx:123`; a top-right icon lands in `TopBar`. Read the source, not the tree.
4. `docs/project-context.md#5` lists the `AppError` types without `auth` — correct as of before Epic 26; `AppError::Auth` is added by Story 26.2.
5. Neither vitest, `tsc`, nor Playwright runs for `apps/desktop` in CI (the release workflow only builds/signs; the web CI workflow is scoped to `apps/web` + `packages/shared`). Task 10's gates are **manual and mandatory** — nothing downstream will catch a skipped run.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.4: Auth E2E Coverage & Licensing Independence Amendment] — the seven source ACs: E2E spec scope, header assertion, sign-in launch boundary + CI pool deferral, licensing amendment, FR4 audit with "violations fixed not documented", `architecture.md` staleness marking, deferred items
- [Source: _bmad-output/planning-artifacts/epics-login.md#Requirements Inventory] — FR2/FR3/FR4 and NFR1 (login-scoped, **not** the global PRD's FR1–FR4); "Testing: Playwright E2E only, in `apps/desktop/tests/`; Cognito is not mocked; a dedicated test pool is a CI setup task, out of scope"
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.2] — `AccountPromptDialog` behaviour: every-launch cadence, no persisted dismissal, no gating after Continue Offline
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.3] — `ProfileMenu` behaviour: loading/LoggedOut/LoggedIn/SessionExpired states, email + optional name, sign-out invalidation, panel-not-route, shared cache entry
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security] — session refresh-failure notice, sign-out clears keyring only, `id_token` claims as the profile data source, `/oauth2/revoke` deferred
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Frontend Architecture] — `useAuthSession`/`useSignIn`/`useSignOut`, `["auth","session"]`, popup display condition, top-right header entry point, panel-not-route
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Naming Patterns] — `AuthState` serde `#[serde(tag = "status")]` tagged-JSON shape consumed by the mock
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Data Boundaries] — tokens in the keyring only, never SQLite/`localStorage`; "entitlements/licensing data remains fully untouched — no shared table, no shared Rust module, no shared frontend hook"
- [Source: _bmad-output/planning-artifacts/architecture-login.md#File Organization Patterns] — "auth E2E coverage (login popup, offline continue, sign-out) belongs in `apps/desktop/tests/`"; external services are not mocked
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Implementation Handoff] — "Refer to this document, not `architecture.md`'s stale Cognito section, for all login-related questions" (AC 21)
- [Source: _bmad-output/planning-artifacts/architecture-entitlements-licensing.md:150] — the 2026-08-09 amendment to verify (AC 22)
- [Source: _bmad-output/planning-artifacts/architecture-entitlements-licensing.md#Data Architecture, #Authentication & Security, #Naming Patterns] — license blob via `keyring`/`credentials.rs`, metadata in the `config` table, `AppError::NotEntitled` — the three by-design collision points of AC 20
- [Source: _bmad-output/planning-artifacts/architecture.md:218-228] — the stale `### Authentication & Security` table, including the "localhost redirect" and "tauri-plugin-stronghold" rows to correct
- [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md] — fixed `data-testid` values, the `auth.*` key list, the strict-positive render guard that keeps the 23 existing specs green, the `/onboarding` suppression, and its explicit hand-off of all auth E2E to this story
- [Source: apps/desktop/playwright.config.ts] — `testDir: './tests'`, `webServer.command: 'pnpm run dev'`, port 1420, `baseURL: http://localhost:1420`
- [Source: apps/desktop/tests/budget-templates.spec.ts:1,7-65,67-76,95-134] — the canonical `setupTauriMock` shape: outcome union, `settle`/`delayMs`, `plugin:` guard, `transformCallback`, command switch, reject fallback
- [Source: apps/desktop/tests/onboarding.spec.ts:100-103,105-113] — the `window.__APPLIED_TEMPLATE_CALLS` recorded-invocation idiom reused as `window.__IPC_CALLS`
- [Source: apps/desktop/tests/dashboard.spec.ts:474-476; apps/desktop/tests/budget.spec.ts:248,255] — `budget-overall-progress` on `/` and `add-group-button` on `/spending/budget`, the two "app still works" anchors
- [Source: apps/desktop/src/routes/__root.tsx:106-155] — shell composition: `TopBar` at 123, `UpdateChecker`/`RecurringApplyListener` at 152-153, `#surface-main` at 128
- [Source: apps/desktop/src/components/shared/TopBar.tsx:13-14,16-35] — the `justify-center` single-child header and the now-false "no login" comment
- [Source: apps/desktop/src/routes/index.tsx:34-43] — the `beforeLoad` onboarding redirect the mock must defuse with `needs_onboarding: false`
- [Source: apps/desktop/src-tauri/src/credentials.rs:1-13] — `KEYRING_SERVICE = "nkbaz-finance"`, `keyring_core::Entry`, sole-accessor module
- [Source: apps/desktop/src-tauri/src/error.rs:5-13,54-60] — current `AppError` variants and the `{ type, message, recoverable }` serialization the mock's reject shape must match
- [Source: docs/project-context.md#Testing Rules, #Code Quality & Style Rules, #TypeScript, #5, #6] — desktop tests in `apps/desktop/tests/`, zero-warning policy, `strict`/`noUnusedLocals`/`noUnusedParameters`, `AppError` reuse, query keys from `constants.ts`
- [Source: apps/desktop/package.json; apps/desktop/vitest.config.ts; package.json] — real package names `@nixus/desktop`/`@nixus/shared`, the `sonner` toast dependency, and the vitest setup that contradicts the "no unit tests" claim

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

Two iterations were needed on the new spec; both were locator problems in the spec, never product defects.

1. **Strict-mode violation on `getByRole("link", { name: "Spending" })`** — resolved to 2 elements: the destination-nav link (`href="/spending/budget"`) and the dashboard's year-to-date card (`data-testid="ytd-card-empty"`, `href="/insights/year-summary"`), whose accessible name also contains the word. Fixed by adding `exact: true` and extracting a `spendingLink(page)` helper that records why.
2. **Client-side vs. full-page navigation for the "still usable after dismissal" assertions** — `page.goto("/spending/budget")` re-runs `addInitScript`, discards `AccountPromptDialog`'s `dismissed` state, and re-opens the modal, whose body copy ("Nothing in Nixus **requires an account** today…") matches the AC 6 gating regex and would have produced a false failure. Switched to clicking the nav link so the dismissal survives, which is also the faithful reading of "after dismissing, the app is fully usable".

Final: `13 passed (11.8s)` for `tests/auth.spec.ts` in isolation.

### Completion Notes List

**Prerequisite verification (AC 1) — all present, nothing created.** `apps/desktop/src/hooks/useAuth.ts` (exports `useAuthSession` returning the raw `useQuery` result, `useSignIn`, `useSignOut`), `apps/desktop/src/components/auth/AccountPromptDialog.tsx` (mounted at `routes/__root.tsx:155`), `apps/desktop/src/components/auth/ProfileMenu.tsx` (mounted at `components/shared/TopBar.tsx` inside an absolutely-positioned right-hand wrapper), `lib/constants.ts:61-63` → `queryKeys.auth.session = ["auth","session"]`, `lib/types.ts:635-638` → `AuthState`, `src-tauri/src/commands/auth.rs`, and `start_login`/`handle_auth_callback`/`get_auth_session`/`sign_out` at `src-tauri/src/lib.rs:244-247`. No HALT condition triggered.

**Selectors taken from source, not from documents.** Story 27.3 shipped every test hook this spec needs, so **AC 18(a) was not used** — `ProfileMenu.tsx` is unmodified. Confirmed present: `profile-menu-trigger` (also carrying `data-auth-state="loading|logged-out|logged-in|session-expired|unavailable"`), `profile-menu-panel`, `profile-menu-email`, `profile-menu-name`, `profile-menu-sign-out`. **`profile-menu-session-expired` does not exist and was not added**: 27.3 communicates expiry through the trigger's `data-auth-state="session-expired"`, its `aria-label` from `profile.sessionExpiredAction`, the `text-caution-ink` colour, and a `sonner` toast from `profile.sessionExpired`. AC 15 asserts what actually ships — the `data-auth-state`, the `aria-label`, and the toast — rather than a selector from the Dev Notes' hypothetical list.

**AC 5 note — `name` is `null`-legitimate.** Verified in `src-tauri/src/commands/auth.rs:474-476`: the pool's only required attribute is `email` and Google federation is deferred, so AC 13 asserts `profile-menu-name` has **count 0**, not empty text.

**AC 9 — deferred CI/ops task, explicitly recorded and NOT delivered here.** A real end-to-end sign-in test needs **a dedicated test/sandbox Cognito user pool plus its own public app client**, a CI-only callback registration, and a disposable test user credential in CI secrets. None of that was created by this story: no AWS resource, no CI workflow, no secret, no environment variable. It stays deferred as a CI/ops setup task. Consequently the spec stops at `start_login` — it asserts the command fired exactly once and asserts **nothing** about Cognito, the identity provider, the system browser, the `nixus://auth/callback` deep link, `handle_auth_callback`, the PKCE token exchange, or the `auth:callback-received` event. `countIpcCalls(page, "handle_auth_callback")` is asserted to be `0`. No test navigates to any `amazoncognito.com` or `auth.nixusapp.com` URL.

**AC 17 — regression gate: PASS, zero new failures.**

| Run | Total | Passed | Failed |
|---|---|---|---|
| Baseline (HEAD `9b45411`, no frontend change) | 333 | 331 | 2 |
| After (`tests/auth.spec.ts` added) | 346 | 344 | 2 |
| Delta | +13 | +13 | 0 |

`+13` is exactly the new spec's test count (`grep -c "tests/auth.spec.ts" → 13`). The 2 failures are the **same two pre-existing, auth-unrelated** ones in both runs and were deliberately left alone:

- `tests/chat.spec.ts:250` — "money in an answer is tabular Inter, never monospace [AC4]"
- `tests/design-system.spec.ts:110` — "spine colour tokens reach the document root"

Both stem from commit `9b45411` rewriting `packages/shared/src/styles/tokens.css` without updating the specs asserting against those tokens. Out of scope here, and not counted as a regression. The known intermittent slide-over flake `tests/maintenance.spec.ts:1403` **passed** in the after-run (`✓ 253 … multiple vehicles appear in garage list (2.0s)`).

`git status --porcelain apps/desktop/tests/` → `?? apps/desktop/tests/auth.spec.ts` only. `git diff --name-only apps/desktop/tests/` → **empty**: zero existing specs edited, no assertion deleted or weakened, and no `get_auth_session` case added to any other spec's mock (the 27.2/27.3 decision that keeps the strict-positive render guard load-bearing is preserved intact).

**AC 18 — no production source change. Neither exception was needed.**
- (a) missing `data-testid` on `ProfileMenu.tsx` — **not used**, 27.3 shipped all five hooks.
- (b) FR4 coupling fix — **not used**, the audit found no violation.

Final change set: `apps/desktop/tests/auth.spec.ts` (new), `_bmad-output/planning-artifacts/architecture.md` (AC 21), this story file, and `_bmad-output/implementation-artifacts/sprint-status.yaml` (status bookkeeping). Nothing under `src-tauri/`, no `package.json`/`Cargo.toml` diff from this story, no new dependency (specifically no `@testing-library/react`, no `jest-axe`), no new static asset, no migration. App version stays `0.3.2`. No `as any`, `@ts-ignore`, or `@ts-expect-error` in the new spec.

**Two Task-checklist bullets were deliberately not followed, because their own ACs forbid them.** Task 3 and Task 5 each list `await expect(page.getByRole("alert")).toHaveCount(0)`, but AC 6 says "do **not** assert a blanket `getByRole("alert")` count of 0, because legitimate non-auth banners (e.g. `setup-incomplete-banner`) can occupy that role" and AC 10 says "a blanket `getByRole("alert")` count of 0 would collide with unrelated app banners". The ACs are the contract, so the sweeps are scoped instead: `expectNoGating()` matches only `/upgrade|paywall|requires an account|sign in to continue|not entitled/i`, and the clean-profile check asserts `[data-auth-state="session-expired"]` count 0, `<header>` `not.toContainText(/expired|error|failed/i)`, and `[data-sonner-toast]` count 0.

**Documentation defect flagged in the Dev Notes is already fixed.** `TopBar.tsx`'s "No account avatar: this is one user, one machine, no login…" comment was removed by Story 27.3. Nothing to flag, and `TopBar.tsx` was not touched.

---

#### AC 19 / AC 20 — FR4 login/licensing independence audit

Every command below was actually run from the repo root and its real result recorded. `rg` is not installed on this machine, so `grep` is used throughout. **State of the world: auth is fully implemented; licensing is still entirely unimplemented** — `architecture-entitlements-licensing.md` is a design document with nothing built behind it. So this is honestly a **one-sided audit**: it proves the auth implementation introduces zero references to entitlement/licensing concepts and creates nothing for a future licensing implementation to collide with. It is not a two-sided cross-check, because there is no second side yet. The amendment plus this write-up are the artifacts that protect the boundary going forward.

**(i) No shared Rust module.**

```
$ grep -rniE "entitlement|licen[cs]e|keygen|lemonsqueezy|NotEntitled|subscription|\btier\b" \
    apps/desktop/src-tauri/src/commands/auth.rs apps/desktop/src-tauri/src/credentials.rs \
    apps/desktop/src-tauri/src/error.rs apps/desktop/src-tauri/src/models/mod.rs
→ exit 1, no output. CLEAN.

$ grep -rniE "entitlement|licen[cs]e|keygen|lemonsqueezy|NotEntitled|isPro|FeatureGate|Paywall|subscription" \
    apps/desktop/src-tauri/src --include="*.rs"
→ 2 hits, both unrelated:
   db/recurring.rs:367                  "… VALUES (1, 'Subscriptions', 5000)"   # a household budget-category name in a test fixture
   financial_health/constants.rs:69     assert!(!is_essential_group_name("Subscriptions"))
CLEAN — no licensing concept, no reverse reference. No licensing Rust file exists to check the other direction.
```

**(ii) No shared frontend hook.**

```
$ grep -nE "^import" apps/desktop/src/hooks/useAuth.ts
→ react, @tanstack/react-query, @tauri-apps/api/core, @tauri-apps/api/event, @/lib/constants, @/lib/types
   Nothing licensing-related. CLEAN.

$ grep -rniE "entitlement|licen[cs]e|keygen|lemonsqueezy|NotEntitled|isPro|FeatureGate|Paywall|subscription" \
    apps/desktop/src --include="*.ts" --include="*.tsx"
→ 1 hit: locales/__tests__/auth-i18n.test.ts:80  "// invitation into a paywall, which NFR1 forbids."  (prose in a comment)
CLEAN. No useEntitlement / useLicense / FeatureGate / Paywall / isPro symbol exists.

$ grep -rn "useAuthSession\|useSignIn\|useSignOut\|AuthState" apps/desktop/src --include="*.ts" --include="*.tsx"
→ AccountPromptDialog.tsx, ProfileMenu.tsx, hooks/useAuth.ts, hooks/__tests__/useAuth.test.tsx, lib/types.ts
CLEAN — the only consumers of auth state are the two auth components. Zero non-auth consumer, therefore no
control-flow path on which login state could gate any other decision, licensing or otherwise.
```

**(iii) No shared query key.** `lib/constants.ts:61-63` → `auth: { session: ["auth","session"] }`. Read the full `queryKeys` object: 40-odd namespaces, none of them `license`/`licence`/`entitlement`/`subscription`, and none beginning with `"auth"` other than the session key itself.

```
$ grep -rn '"license"\|"licence"\|"entitlement"\|"subscription"' apps/desktop/src --include="*.ts" --include="*.tsx"
→ exit 1, no output. CLEAN — the planned ["license","status"] namespace does not exist yet and is disjoint from ["auth","session"] by construction.
```

**(iv) No shared database table.**

```
$ ls apps/desktop/src-tauri/migrations/            → 22 files, 001_…sql through 022_budget_category_soft_delete.sql
$ git status --porcelain apps/desktop/src-tauri/migrations/   → empty (no added/modified/deleted migration)
$ git log --oneline -8 -- apps/desktop/src-tauri/migrations/  → newest is 0081d17, which predates Epic 26
→ ZERO new migration files across Epics 26–27. CLEAN.

$ grep -niE "config|sqlite|\bconn\b|execute\(|INSERT |UPDATE |SELECT |db::|Pool" apps/desktop/src-tauri/src/commands/auth.rs
→ 12 hits, every one of them prose in a comment ("Cognito configuration", "App-client misconfiguration",
   "Sign-in is not configured correctly", and notably line 70: "the verifier and state never reach the keyring,
   SQLite, a file, or a log"). No db:: import, no Pool, no execute(, no SQL statement anywhere.
CLEAN — auth touches SQLite not at all, so it cannot write to the `config` table that licensing plans to cache metadata in.
```

**(v) No shared "account" concept.** `CognitoSession` (`models/mod.rs:737-745`) holds `access_token`, `id_token`, `refresh_token`, `expires_at` — nothing else. `AuthState::LoggedIn` (`models/mod.rs:754-758`) holds `email` and `Option<String> name` — nothing else.

```
$ grep -rnw "sub" apps/desktop/src-tauri/src/commands/auth.rs apps/desktop/src-tauri/src/models/mod.rs
→ auth.rs:481  `sub: String,` inside the private id_token-claims struct, carrying `#[allow(dead_code)]` and the
   comment "parsed per NFR4 as the durable identity key, but `AuthState` does not surface it yet". Remaining hits
   are test-fixture JWT payload literals.
CLEAN — the Cognito `sub` is parsed and then discarded. It is never persisted to the keyring, never written to
SQLite, and never surfaced across the IPC boundary, so no type, field, or table joins a Cognito identity to a
licensing identity.
```

**AC 20 — the three by-design collision points, verified intact and correctly classified as SHARED INFRASTRUCTURE, NOT COUPLING.** Coupling means a shared entry, a shared identity, shared state, or a control-flow dependency — one system reading, writing, or gating on the other's data. None of the three meets that bar:

| # | Collision point | What was actually read | Verdict |
|---|---|---|---|
| 1 | `credentials.rs` hosts both auth and AI-key storage — and will later host the Keygen license blob | `credentials.rs:6-8`: `KEYRING_SERVICE = "nkbaz-finance"` (AI keys: `aws_access_key_id`, `aws_secret_access_key`, `aws_region`, `openai_api_key`) vs. `KEYRING_AUTH_SERVICE = "nixus-auth"` + `KEYRING_AUTH_ACCOUNT = "cognito-session"`. `clear_credentials()` iterates the four AI names under `nkbaz-finance` only; `auth_entry()`/`store_cognito_session`/`load_cognito_session`/`clear_cognito_session` touch only `nixus-auth`/`cognito-session`. **No function reads or deletes across services.** | **Shared storage utility, distinct entries. ACCEPTABLE.** The sole-accessor `credentials.rs` pattern itself is likewise shared infrastructure, not coupling — it is the project's one keyring gateway, and a third tenant (the Keygen blob) under its own distinct entry changes nothing. |
| 2 | `AppError` carries auth and (future) licensing variants | `error.rs:5-13`: `Auth { message, recoverable }` sits as a plain sibling of `Validation`, `Database`, `AiService`, `File`, `NotConfigured`, `InvalidCredentials`, `Unavailable`. It wraps no licensing error and no licensing error wraps it. The planned `NotEntitled { module }` would be another sibling. | **Sibling variants of the one project-wide enum. ACCEPTABLE** — the project rule is "never create ad-hoc error types". |
| 3 | SQLite | Auth adds no table, no migration, no `db/` module, and performs no SQL at all (see (iv)). Licensing plans to cache non-secret metadata in the existing `config` table. | **ACCEPTABLE while auth writes nothing to SQLite.** Verified: it writes nothing. An auth write to `config` *would* be a violation. |

**No genuine violation was found, so AC 18(b) was not exercised and no fix was made.**

---

#### AC 21 / AC 22 — documentation

**AC 22 — `architecture-entitlements-licensing.md` verified, NOT edited.** The 2026-08-09 amendment is present at line 150, immediately below `### Authentication & Security`. Read in full and confirmed to satisfy all three required statements: it notes login now exists as an unrelated concern ("A separate, unrelated **login/user-identity feature** (AWS Cognito, email/password + Google federation) has since been architected in `architecture-login.md`"); it states the no-login rule described the licensing/entitlement model specifically and does **not** reverse it ("The 'No traditional login' statement above describes the licensing/entitlement model specifically and is unchanged"); and it confirms the LemonSqueezy + Keygen design is unchanged ("entitlement checks still key off the LemonSqueezy email + Keygen license/machine activation, with no dependency on user identity"). It closes with the independence statement this story's audit substantiates: "The two systems share no code, no data model, and no 'account' concept — a user may be logged in via Cognito, licensed via Keygen, both, or neither, independently." **No second amendment block was added and not one word of the existing one was reworded.** This file is left byte-for-byte as it was.

**AC 21 — `architecture.md#Authentication & Security` amended, extended in place.** Contrary to this story's Dev Notes ("no superseded marker exists"), a `> **Superseded (2026-08-09):**` blockquote was already present in the working tree directly under the heading, already correcting the "localhost redirect" and "tauri-plugin-stronghold" rows. It was missing two of AC 21's three required statements: the explicit "not authoritative" framing, and naming `architecture-login.md` as the **sole** reference for login questions. Following AC 22's discipline of extending rather than duplicating, a second paragraph was appended **inside the same blockquote** — no new block, nothing reworded, and the stale table left in place exactly as it was, marked. The addition states the section is not authoritative for login, names `architecture-login.md` as the sole login reference and `architecture-entitlements-licensing.md` as the licensing reference, and re-flags the two rows a future reader would otherwise copy, with the shipped reality spelled out for each: the `nixus://auth/callback` custom URI scheme via `tauri-plugin-deep-link` with no localhost listener, and the OS keyring under service `nixus-auth` via `credentials.rs`. Verified while writing it: `grep -rni "stronghold" apps/desktop/package.json apps/desktop/src-tauri/Cargo.toml` → exit 1, so the claim that `tauri-plugin-stronghold` is not a dependency is true.

**AC 23 — deferred items stay deferred.** `grep -niE "revoke|rotation|\bsync\b|notification|community" apps/desktop/tests/auth.spec.ts` → exit 1, no output. The new spec adds no code and no assertion that presumes Cognito `/oauth2/revoke` token revocation, refresh-token rotation, or any cloud-sync / push-notification / community work. `grep -rn "oauth2/revoke"` over `src/` and `src-tauri/src/` returns exactly one hit — a comment at `commands/auth.rs:715` documenting that it is deferred — confirming it remains unimplemented.

---

#### Gates (Task 10) — all run, real output

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm --filter @nixus/desktop exec tsc --noEmit` | **exit 0, zero output.** Clean under `strict` + `noUnusedLocals` + `noUnusedParameters` |
| Unit | `pnpm --filter @nixus/desktop test` | **9 files, 141 passed (141)**, 1.15s. No vitest file added by this story |
| New spec | `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts` | **13 passed (11.8s)** |
| Full suite | `pnpm --filter @nixus/desktop exec playwright test` | **346 tests: 344 passed, 2 failed (1.5m)** — the 2 pre-existing baseline failures, zero new |
| Blast radius | `git diff --name-only apps/desktop/tests/` | **empty** — no existing spec edited |

Not run: `cargo` gates. This story touches nothing under `src-tauri/`, so the Rust suite (329 tests, zero warnings) is untouched by construction — asserting a fresh Rust result would be noise, not verification. Nothing in this story required interactive GUI verification; every assertion above was produced by a command that was actually executed.

### File List

| File | Action |
|---|---|
| `apps/desktop/tests/auth.spec.ts` | **NEW** — 13 tests across 5 `describe` blocks; the only code artifact of this story |
| `_bmad-output/planning-artifacts/architecture.md` | MODIFIED — AC 21 superseded marker extended in place under `### Authentication & Security` |
| `_bmad-output/implementation-artifacts/27-4-auth-e2e-coverage-and-licensing-independence-amendment.md` | MODIFIED — checkboxes, Status, Dev Agent Record, audit write-up |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | MODIFIED — `27-4-…` → `review` |

### Review Findings

**Adversarial code review — 2026-08-09. Verdict: ZERO BLOCKING findings.**

Nothing in this story blocks it. Every load-bearing claim in the Dev Agent Record was re-derived from source or re-executed rather than trusted, including six mutation experiments that prove the new tests can actually fail. Three NON-BLOCKING observations are recorded below; none is a correctness, security, spec, or regression defect, and none needs to be fixed for this story to close.

#### BLOCKING

None. Stated unambiguously: there are **no** correctness bugs, **no** security issues, **no** AC or guardrail violations, and **no** regressions in this change set.

#### NON-BLOCKING

- [ ] [Review][Non-Blocking] AC 7's "count 0 for the **whole** pending window" is asserted as one sample, not a continuous negative [apps/desktop/tests/auth.spec.ts:400-418] — `:412` proves the sample lands inside a genuinely pending window (`data-auth-state="loading"`), then `:413` checks the dialog once. Playwright cannot express a continuous negative over a window without polling, mutation M4 proves the window is real, and `AccountPromptDialog`'s `!session.isSuccess` early return makes a flash structurally impossible — so the residual risk is nil. Optional hardening: repeat `toHaveCount(0)` immediately before the `logged-out` transition, or use `expect.poll`. No functional gap; no action required.
- [ ] [Review][Non-Blocking] `expectNoGating`'s regex is matched by the app's own prompt copy, and the trap is documented only at the call site [apps/desktop/tests/auth.spec.ts:308-314] — `auth.promptBody` is "Nothing in Nixus **requires an account** today…", which satisfies `/requires an account/i`. The spec correctly sidesteps this with client-side navigation and explains why at `:384-385`, but `expectNoGating`'s own doc comment does not warn a future caller. Concrete fix (cosmetic): add one line to the helper's comment — "callers must ensure the account prompt is not open; its body copy matches this regex."
- [ ] [Review][Non-Blocking] Five assertions bind to English copy [apps/desktop/tests/auth.spec.ts:300, 459, 560, 580, 584] — `"Sign in"`, `/Your session expired/`, `/Session expired/`, `name: "Spending"`. This matches the established in-repo convention (all 23 existing specs assert English) and EN/FR parity is separately owned by `profile-i18n.test.ts` / `auth-i18n.test.ts`, so it is consistent rather than wrong. Recorded only so a future change to the default locale has a known blast radius.

---

#### Verification performed (independent of the Dev Agent Record)

**AC 17 — regression gate: PASS, reproduced first-hand.** Full suite run by the reviewer: `Running 346 tests using 6 workers` → **344 passed, 2 failed (1.5m)**, matching the reported 346/344/2 against the 333/331/2 baseline (+13/+13/0). All 13 `auth.spec.ts` tests enumerated as passing in that run. The 2 failures are exactly `tests/chat.spec.ts:250` and `tests/design-system.spec.ts:110`; the log shows the latter as a `tokens.css` colour-token delta (`caution #B45309→#A16207`, `good`, `ink`, `ink-dim`, `line`), confirming the `9b45411` root cause. **No third failure** — `tests/maintenance.spec.ts:1403` passed, so no isolation re-run was needed. `git diff --name-only -- apps/desktop/tests/` → empty; `git status --porcelain -- apps/desktop/tests/` → `?? apps/desktop/tests/auth.spec.ts` only. Test count verified: 13 tests, 5 `describe` blocks.

**The 13 tests are REAL — six mutation experiments, every one produced the required failure.** All mutations were reverted from pristine copies and every touched file verified byte-identical by `shasum -a 256 -c` (checked twice, all four OK).

| # | Mutation | Result | Proves |
|---|---|---|---|
| M1 | Removed `sessionAfterSignOut` so the mock never flips state | FAILED at `:558` | AC 14 detects a non-flipping mock |
| M2 | Replaced `useSignOut`'s `invalidateQueries` with `void queryClient` | FAILED at `:559` | AC 14 detects a skipped invalidation |
| M3 | Gave `AccountPromptDialog` its own `["auth-private","session"]` query key | **FAILED at `:565` exactly**, while `:558-560` still passed | **Decisive.** The dialog-reappears assertion is real, isolated, and detects the precise "two private copies" defect it exists to catch |
| M4 | Removed `sessionDelayMs: 2000` | FAILED at `:411` | The pending window is observable **only** because of the delay; AC 7 is not racing or passing by luck. 2000ms vs a 5000ms assertion timeout is a deterministic margin |
| M5 | Made `profile-menu-name` always render (empty node) | FAILED at `:538` | AC 13's `toHaveCount(0)` catches an empty node; `toHaveText("")` would not have |
| M6 | Swapped client-side nav for `page.goto("/spending/budget")` | FAILED inside `expectNoGating` at `:313` ("locator resolved to 1 element") | `expectNoGating` is a real firing assertion, **and** Debug Log entry #2 is honest and its fix correct |

**AC 8 — launch boundary respected.** `start_login` count `1` (`:435`), `handle_auth_callback` count `0` (`:441`), `toHaveURL(/localhost:1420\/$/)` (`:442`). Zero external-domain references anywhere in the spec (`amazoncognito|nixusapp|accounts.google|googleapis|cognito-idp|oauth2|.com/` → no hits; `grep -i http` → no hits at all). Nothing asserted about Cognito, Google, the browser, the callback, the token exchange, or `auth:callback-received`. `handle_auth_callback` being asserted to 0 correctly proves the frontend never bypasses the pending-attempt/`state` CSRF check.

**AC 6 / AC 15 — positive content, not "no error".** `budget-overall-progress` (`:381`, `:396`, `:594`) and `add-group-button` (`:387`, `:598`) are asserted visible. `SessionExpired` gates nothing: `:590-600` asserts full usability and `:587` asserts `account-prompt-dialog` count 0. NFR1 upheld.

**AC 10 — scoping correct, and the two skipped Task bullets were RIGHT.** Asserted: `[data-auth-state="session-expired"]` count 0 (`:466`), `<header>` not matching `/expired|error|failed/i` (`:467`), `[data-sonner-toast]` count 0 (`:468`). There is **no** blanket `getByRole("alert")` anywhere — the only occurrence of that string is the comment at `:305` explaining its omission. AC 6 (line 29) and AC 10 (line 41) of this story explicitly forbid it. Task 3 (line 94) and Task 5 (line 106) contradict their own ACs; following the AC was correct and is **not** reported as a violation.

**AC 15 — asserted against what shipped, verified against `ProfileMenu.tsx`.** `profile-menu-session-expired` genuinely does **not** exist (`grep -rn "profile-menu" apps/desktop/src/` → exactly 5 hits: trigger `:25`, panel `:119`, email `:128`, name `:136`, sign-out `:152`). The three asserted affordances all genuinely exist: `data-auth-state={state}` (`:180`) yields `session-expired`; `aria-label` from `t("profile.sessionExpiredAction")` (`:166`) = "Session expired — sign in again", matching `/Session expired/`; `toast.error(t("profile.sessionExpired"))` (`:90`) = "Your session expired. Sign in again to reconnect.", matching `/Your session expired/`. Asserting shipped reality over the Dev Notes' hypothetical selector was correct — the alternative would have been a failing or vacuous test.

**Conventions and hygiene.** `plugin:` guard is the first statement of `invoke` (`:144`); `transformCallback: () => 1` (`:142`); `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` (`:138-139`); `convertFileSrc` (`:252`); `default: reject` (`:249`). The `settle`/`delayMs` helper matches `budget-templates.spec.ts:56-65` in shape. `window.__IPC_CALLS` uses the identical cast idiom to `onboarding.spec.ts:101-102`'s `__APPLIED_TEMPLATE_CALLS`. The only import is `@playwright/test` — nothing is reached from another spec or from `src/`. No `test.skip`/`test.fixme`/`test.only`/`describe.only`, no commented-out assertions. Word-boundary grep for `as any` / `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` → exit 1, clean; the `window as unknown as {…}` reads are the established repo idiom (both precedent specs also score 0 on `as any`) and each is `?? []`-guarded, so it is genuinely narrow rather than a disguised `any`.

**Mock wire-format fidelity — EXACT.** `MockAuthState` (`:8-11`) matches Rust `AuthState` (`models/mod.rs:750-758`): `#[serde(tag = "status")]`, PascalCase `LoggedOut`/`LoggedIn`/`SessionExpired`, `name: Option<String>` with a source comment confirming no `skip_serializing_if` so the wire shape is `name: string | null`. Identical to `lib/types.ts:635-638`. No test asserts against a shape the app never receives.

**AC 19 / AC 20 — the FR4 conclusion is CORRECT, re-derived from source.**
- `clear_credentials()` (`credentials.rs:49-61`) iterates exactly the four `nkbaz-finance` AI names and never touches the auth entry.
- `auth_entry()` (`:63-68`) resolves only `nixus-auth`/`cognito-session`; `store_cognito_session` / `load_cognito_session` / `clear_cognito_session` (`:72`/`:87`/`:110`) route exclusively through it, and lines 63-128 contain **zero** `KEYRING_SERVICE` references. No cross-read in either direction. The Rust suite even locks this with `clear_cognito_session_leaves_ai_credentials_intact` (`:223`).
- `AppError::Auth { message, recoverable }` (`error.rs:5-13`) is a plain sibling of `Validation`/`Database`/`AiService`/`File`/`NotConfigured`/`InvalidCredentials`/`Unavailable`; it wraps nothing and nothing wraps it.
- **Zero SQL in auth:** `grep -nE "rusqlite|\bconn\b|\.execute\(|\.query\(|DbState|\.prepare\(|db::|Pool|Connection" commands/auth.rs` → 1 hit, a doc comment at `:674` that literally reads "Takes no `State<DbState>` and writes no…". Auth cannot write to the `config` table licensing plans to use.
- **`sub` never persisted:** `CognitoSession` (`models/mod.rs:736-746`) = `access_token`, `id_token`, `refresh_token`, `expires_at` — no `sub` field. `AuthState::LoggedIn { email, name }` only. `sub` exists solely at `commands/auth.rs:481` inside the private `IdTokenClaims` struct under `#[allow(dead_code)]`; every other hit is a test JWT payload literal. No shared identity key, therefore no coupling by the stated definition.
- Cross-gating sweep: frontend → 1 hit, prose in `auth-i18n.test.ts:80`; backend → 2 hits, both `'Subscriptions'` as a budget-category name (`db/recurring.rs:367`, `financial_health/constants.rs:69`) — exactly the documented false positives. Auth-state consumers are only `AccountPromptDialog.tsx`, `ProfileMenu.tsx`, `useAuth.ts`, `useAuth.test.tsx`, `lib/types.ts`; zero non-auth consumer, so no control-flow path exists on which login could gate anything.
- `queryKeys.auth.session = ["auth","session"]` (`constants.ts:61-63`), disjoint from all 40-odd other namespaces. Zero migrations added (`git status -- migrations/` empty; 22 files unchanged).
- The write-up names all three collision points as **shared infrastructure, not coupling** — including the `credentials.rs` sole-accessor pattern itself and the future Keygen blob — using the correct definition verbatim. It is honestly reported as **one-sided** (line 364). **No violation was missed; AC 18(b) correctly not exercised.**

**AC 18 — no production source change.** `find apps/desktop/src apps/desktop/src-tauri/src apps/desktop/tests package.json Cargo.toml tauri.conf.json -newermt "2026-08-09 23:18"` returns only the four files the reviewer itself restored — nothing under `apps/` carries an mtime inside 27.4's implementation window (`architecture.md` 23:30, story file 23:33). `ProfileMenu.tsx` carries all five testids and **not** `profile-menu-session-expired` — the tell, since that is the one testid AC 18(a) would have licensed adding; its absence is affirmative evidence the exception was unused. Story 27.3's File List claims `ProfileMenu.tsx` as its own NEW artifact; 27.4's does not, and `profile-i18n.test.ts` still reports exactly 16 tests, matching 27.3. *Honest limitation:* because `ProfileMenu.tsx` is untracked (uncommitted from 27.3), byte-identity cannot be proven by `git` — the evidence above is unanimous, and the reviewer restored it byte-exactly (`sha256 84f93aaa…`). `package.json` diff = `@tauri-apps/plugin-deep-link` only; `Cargo.toml` diff = deep-link, single-instance, `sha2`, `rand`; `tauri.conf.json` diff = the `nixus` scheme — all Epic 26, none from 27.4. No `@testing-library/react`, no `jest-axe`, no new asset, no migration, no CI workflow, no `.env`/secret/key file (AC 9 compliant). Version `0.3.2` confirmed in `package.json:4`, `tauri.conf.json:4`, `Cargo.toml:3`.

**AC 21 / AC 22 — doc amendments verified.** `architecture.md` diff is **+4 / −0**; zero deletions proves the stale April-2026 table survives (the `Desktop auth flow | System browser OAuth → localhost redirect` row is still present). `grep -c "Superseded (2026-08-09)"` = **1** (no duplicate block). `cat -e` confirms valid Markdown: heading / blank / `>` para 1 / `>` / `>` para 2 / **blank** / table — the blank line terminates the blockquote so the table is not swallowed. The marker states the section is not authoritative for login, names `architecture-login.md` as the **sole** login reference and `architecture-entitlements-licensing.md` for licensing, and re-flags both stale rows with shipped reality; its claim that `tauri-plugin-stronghold` is not a dependency is TRUE (`grep -rni stronghold` over `package.json` + `Cargo.toml` → exit 1). The Completion Note that paragraph 1 pre-existed in the working tree is independently corroborated by **Story 26.2's own working-tree audit** (26-2 line 613), which records `architecture.md` as already-modified planning-phase noise with mtimes 18:50–19:37 — so extending in place rather than duplicating was correct, and the story-creation-time Dev Note at line 246 was itself the stale statement. `architecture-entitlements-licensing.md` is **UNTOUCHED**: `git diff --stat` → `2 ++` (its pre-existing insertions), `grep -c "Amendment (2026-08-09)"` = **1**. No secret, token, client secret, or credential appears in either doc edit or in the spec (`eyJ|access_token|id_token|refresh_token|client_secret|Bearer |AKIA|sk-` → exit 1).

**Gates re-run by the reviewer.** `pnpm --filter @nixus/desktop exec tsc --noEmit` → **exit 0, zero output**. `pnpm --filter @nixus/desktop test` → **9 files, 141 passed (141)**. Full Playwright suite → **346 / 344 passed / 2 pre-existing failures**.

**Explicitly not reported as findings** (confirmed correct, per scope): the 2 pre-existing `tokens.css` Playwright failures from `9b45411`; the clippy lint at `src-tauri/src/commands/backup.rs:106`; the Vite chunk advisory; Stories 26.1–27.3's uncommitted working-tree files; the absence of a `get_auth_session` mock in the 20 other specs (the orchestrator's override of 27.3 Task 8 is preserved, which is correct — adding it would open a modal whose focus trap `aria-hidden`s the app); the two skipped Task-checklist bullets (their ACs genuinely forbid the blanket assertion); Google federation, a real Cognito round-trip, JWT signature verification, `/oauth2/revoke`, refresh-token rotation, and account linking (all deferred or out of scope).

**No file was modified by this review other than this `### Review Findings` section.** Six temporary mutations were applied and reverted; all four affected files verified byte-identical afterward, and the working tree was left exactly as found.

## Change Log

| Date | Change |
|---|---|
| 2026-08-09 | Added `apps/desktop/tests/auth.spec.ts` — 13 E2E tests covering the account prompt and Continue Offline (FR2/NFR1), the `start_login` launch boundary (FR1 edge), the header profile entry point and its centring regression check (FR3), the signed-in panel and sign-out cache-sharing proof, and the `SessionExpired` path. No production source change. |
| 2026-08-09 | Executed the FR4 login/licensing independence audit across all five dimensions with recorded commands and real results; classified the three by-design collision points as shared infrastructure, not coupling. No violation found, so no fix was required. |
| 2026-08-09 | Extended the existing superseded marker under `architecture.md#Authentication & Security` in place (AC 21) to state the section is not authoritative for login, name `architecture-login.md` as the sole login reference, and re-flag the stale `localhost redirect` and `tauri-plugin-stronghold` rows. Verified the `architecture-entitlements-licensing.md` amendment (AC 22) without editing it. |
| 2026-08-09 | Gates: `tsc --noEmit` clean; vitest 141 passed; full Playwright suite 344 passed / 2 pre-existing failures out of 346 vs. a 331/2/333 baseline — zero new failures. Status → `review`. |

