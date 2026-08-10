---
baseline_commit: 9b45411e5d22d41705bd90eac8b78cf45e7c2238
---

# Story 27.3: Header Profile Menu & Minimalist Profile View

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in user,
I want a small profile entry point in the top-right of the app header that shows who I am and lets me sign out,
so that my identity is visible and reversible without hunting through settings.

## Acceptance Criteria

1. **Mounted top-right in the persistent app header; sidebar untouched.** Given the app shell rooted at `apps/desktop/src/routes/__root.tsx`, when this story is implemented, then `apps/desktop/src/components/auth/ProfileMenu.tsx` renders as a small icon pinned to the **top-right of the persistent header** — concretely inside the `<header>` of `apps/desktop/src/components/shared/TopBar.tsx`, which `__root.tsx:123` renders on every route; and `apps/desktop/src/components/shared/AppSidebar.tsx` is **unchanged** — no nav item, no footer control, no account row is added to the rail. [Source: epics-login.md#Story 27.3; architecture-login.md#Frontend Architecture "Profile/login entry point"]

2. **Pending → neutral, non-flickering state.** Given `useAuthSession()` has not yet resolved (`isLoading`), when the header renders, then the trigger renders a neutral/loading affordance (standard TanStack Query `isLoading` handling) and never renders the logged-in or logged-out appearance first — no flicker between states on launch. [Source: epics-login.md#Story 27.3; architecture-login.md#Process Patterns "Loading state"; 27-1 AC 3 (the hook returns the raw `useQuery` result with no `LoggedOut` default, precisely so this AC is satisfiable)]

3. **`LoggedOut` → sign-in affordance that calls `useSignIn()`.** Given `useAuthSession()` resolves to `{ status: "LoggedOut" }`, when the header renders, then the trigger shows a generic sign-in affordance, and activating it calls `useSignIn()` — no menu/panel opens in this state. [Source: epics-login.md#Story 27.3]

4. **`LoggedIn` → anchored panel with email, optional name, sign out.** Given `useAuthSession()` resolves to `{ status: "LoggedIn", email, name }`, when the user activates the trigger, then a minimalist profile **panel/popover anchored to the trigger** opens showing the account email, the name when present, and a sign-out action; and it is **not** implemented as a `routes/profile.tsx` route, a full page, or a centered modal. [Source: epics-login.md#Story 27.3 (FR3); architecture-login.md#Structure Patterns "No new route file"]

5. **Absent `name` degrades to email-only.** Given the panel is open with a `LoggedIn` session whose `name` is `null`, when it renders, then it shows email only — no empty row, no `null`/`undefined` text, no blank line reserved for the missing name. [Source: epics-login.md#Story 27.3]

6. **`SessionExpired` is explicitly communicated, never silent.** Given `useAuthSession()` resolves to `{ status: "SessionExpired" }`, when the header renders, then the user is explicitly told the session expired and that they should sign in again — via **both** a distinguishable trigger state (accessible label + visual treatment) **and** a toast shown **once per occurrence** (not re-fired on every query refetch or re-render); and every other part of the app remains fully functional in this state (NFR1). Activating the trigger in this state calls `useSignIn()`. [Source: epics-login.md#Story 27.3; architecture-login.md#Authentication & Security "Session refresh failure"; 26-5 story `get_auth_session` decision table]

7. **Sign out returns the header to logged-out and closes the panel.** Given the user activates sign-out from the panel, when `useSignOut()` succeeds, then `queryKeys.auth.session` is invalidated (by the Story 27.1 hook — not by this component), the panel closes, and the trigger returns to its logged-out appearance. [Source: epics-login.md#Story 27.3, #Story 27.1]

8. **One auth state, two consumers, zero drift.** Given both `AccountPromptDialog` (Story 27.2) and `ProfileMenu` are mounted, when the session state changes from any source (`auth:callback-received` event, sign-out, launch refresh), then both surfaces re-render from the same `["auth", "session"]` TanStack Query cache entry; and `ProfileMenu` holds **no copy of auth state** — its only local state is UI-local panel open/closed, and it shares no state, context, or props with `AccountPromptDialog`. [Source: epics-login.md#Story 27.3, #Additional Requirements "Single source of truth"; architecture-login.md#Component Boundaries]

9. **Reuses the bundled icon set — no new asset.** Given the trigger and panel need iconography, when implemented, then icons come from the already-installed `lucide-react` set used throughout the app; no file is added to `apps/desktop/public/` or `apps/desktop/src/assets/`, and no SVG is inlined as a new asset. [Source: epics-login.md#Story 27.3; architecture-login.md#File Organization Patterns "Asset organization"]

10. **Reuses shared UI primitives — nothing reinvented.** Given `docs/project-context.md#8 Shared UI Components`, when implemented, then the trigger and panel are composed from primitives already exported by `@nixus/shared` (`Button`, `DropdownMenu` family); and **no new component is added to `packages/shared/src/ui/`** — in particular no `Avatar` primitive is created (none exists today and none is needed). [Source: docs/project-context.md#8; packages/shared/src/ui/index.ts]

11. **Every string is i18n'd in both locales.** Given all user-facing strings in the trigger, panel, and toast, when implemented, then each resolves from an i18next key present in **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` with a non-empty value, and no literal English text appears in the JSX (including `aria-label` values); and a parity test enforces this. [Source: epics-login.md#Story 27.3, #Requirements Inventory "Inherited i18n rule"; docs/project-context.md#i18n]

12. **The stale "no account avatar" rationale comment is removed.** Given `apps/desktop/src/components/shared/TopBar.tsx:13-14` currently asserts *"No account avatar: this is one user, one machine, no login, and a person-shaped glyph in the chrome implies an account the product does not have"*, when this story is implemented, then that comment is **deleted** (its premise is reversed by Epic 26/27); and no replacement comment restates behaviour the code already shows — per `docs/project-context.md#Code Quality`, comments explain WHY only. [Source: apps/desktop/src/components/shared/TopBar.tsx:13-14; docs/project-context.md#Code Quality & Style Rules]

13. **No regression in the existing header or E2E suite.** *(Derived — adding an always-mounted `invoke("get_auth_session")` call into the persistent header changes the IPC surface of every existing Playwright spec.)* Given the 20 existing spec files in `apps/desktop/tests/` that stub `window.__TAURI_INTERNALS__.invoke`, when this story is implemented, then each stub resolves `get_auth_session` to `{ status: "LoggedOut" }`, the full Playwright suite passes, and the ⌘K search trigger remains centered in the header, keyboard-reachable, and functional; and `ProfileMenu` renders a safe neutral affordance (no crash, no error toast, no thrown render) when the query errors or returns a payload whose `status` it does not recognize. [Source: apps/desktop/tests/accessibility.spec.ts:33-80 (`default: return Promise.reject("Unknown command: ...")`); epics-login.md#Story 27.1 (query error must not blank the app shell)]

14. **Scope fence — no auth plumbing, no route, no E2E spec.** Given Stories 27.1, 27.2, and 27.4 own adjacent work, when this story completes, then `ProfileMenu.tsx` contains **no** `invoke` call, **no** Tauri `listen`, and **no** `queryKeys` reference; no `routes/profile.tsx` exists; no Rust file, `lib/constants.ts`, `lib/types.ts`, or `hooks/useAuth.ts` is modified; and no new `apps/desktop/tests/*.spec.ts` file is created (auth E2E is Story 27.4's deliverable). [Source: epics-login.md#Story 27.1 (hook is the sole `invoke` caller), #Story 27.4; architecture-login.md#Component Boundaries]

## Tasks / Subtasks

- [x] **Task 1: Verify the Story 27.1 hook contract exists before writing any component code (AC: 3, 4, 6, 7, 8, 14)**
  - [x] Confirm `apps/desktop/src/hooks/useAuth.ts` exports `useAuthSession()`, `useSignIn()`, and `useSignOut()`. Per Story 27.1 AC 3 the hook returns the **raw `useQuery` result** — no `data ?? { status: "LoggedOut" }` default and no wrapper — so read `isLoading` / `isError` / `data` directly here (use `isLoading`, matching 27.1's wording, not the `isPending` alias). `useSignIn()` has no `onSuccess`; `useSignOut()` owns the `queryKeys.auth.session` invalidation.
  - [x] Confirm `apps/desktop/src/lib/types.ts` exports `AuthState` as `{ status: "LoggedOut" } | { status: "LoggedIn"; email: string; name: string | null } | { status: "SessionExpired" }`.
  - [x] Confirm `apps/desktop/src/lib/constants.ts` has `queryKeys.auth.session`. Do **not** import it here — only the hook may reference it.
  - [x] **If `hooks/useAuth.ts` is absent, stop and report blocked.** Do not create a local hook, do not call `invoke("get_auth_session")` from the component, do not add a temporary `useState` stand-in for auth state.

- [x] **Task 2: Create `apps/desktop/src/components/auth/ProfileMenu.tsx` — state machine and trigger (AC: 2, 3, 6, 9, 10, 13, 14)**
  - [x] Create the `apps/desktop/src/components/auth/` directory if Story 27.2 has not already.
  - [x] Imports only: `useEffect`/`useRef`/`useState` from `react`; `useTranslation` from `react-i18next`; `toast` from `sonner`; `CircleUser`, `LogIn`, `LogOut`, `User` from `lucide-react`; `Button`, `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from `"@nixus/shared"`; `cn` from `"@/lib/utils"`; the three hooks from `"@/hooks/useAuth"`. **No `invoke`, no `@tauri-apps/api`, no `queryKeys`.**
  - [x] Implement exactly the state table in Dev Notes → "ProfileMenu state table". Derive state with a **defensive** read (`session?.status`) and a `default`/fallback branch — the payload can legitimately be `null` or `[]` under the existing E2E stubs (AC 13).
  - [x] Every branch renders the **same** `data-testid="profile-menu-trigger"` element plus a `data-auth-state` attribute (`loading` | `logged-out` | `logged-in` | `session-expired` | `unavailable`) so Story 27.4 has one stable selector.
  - [x] Trigger shape follows the in-repo precedent verbatim: `<Button variant="ghost" size="icon-sm" aria-label={…}>` with a bare lucide icon child carrying `aria-hidden="true"` (see `AccountRow.tsx:157-169`). Do not set an explicit `size-*` class on the icon — `Button`'s CVA already sizes bare `<svg>` children.
  - [x] `loading` state: `disabled` trigger, `User` icon, `aria-label={t("profile.loading")}`, no menu.
  - [x] `logged-out` / `session-expired` / `unavailable`: plain `<Button>` (no `DropdownMenu` wrapper) whose `onClick` calls `signIn.mutate()`; `LogIn` icon. `session-expired` additionally gets `className={cn("text-caution-ink")}` — `--color-caution-ink` is the project's warning token (`tokens.css:329`); do **not** use `text-over-ink`, which is the over-budget/error red, or a raw hex.

- [x] **Task 3: Implement the anchored profile panel for the `LoggedIn` state (AC: 4, 5, 7, 8, 10)**
  - [x] Wrap the trigger in `<DropdownMenu open={open} onOpenChange={setOpen}>` with `const [open, setOpen] = useState(false)` — this is the **only** local state permitted in this component.
  - [x] `<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("profile.accountMenu", { email })} data-testid="profile-menu-trigger" data-auth-state="logged-in" />}>` containing `<CircleUser aria-hidden="true" />`.
  - [x] `<DropdownMenuContent align="end" className="w-64" data-testid="profile-menu-panel">` — **the explicit width is required**: `DropdownMenuContent`'s base class is `w-(--anchor-width) … min-w-32`, so without an override the panel inherits the ~28px icon-button width and clamps to 128px, truncating every email. See Dev Notes → "Panel width gotcha".
  - [x] Identity block: `<DropdownMenuGroup>` → `<DropdownMenuLabel>{t("profile.signedInAs")}</DropdownMenuLabel>` → email row as a non-interactive element with `data-testid="profile-menu-email"`, `className="truncate px-1.5 py-1 text-body text-ink"`, and `title={email}`. Render the name row **only** when `name` is a non-empty string, with `data-testid="profile-menu-name"` (AC 5). Do **not** use `DropdownMenuItem` for identity rows — they are not actionable.
  - [x] `<DropdownMenuSeparator />`, then `<DropdownMenuItem data-testid="profile-menu-sign-out" onClick={…}>` with a `LogOut` icon (`aria-hidden="true"`) and `{t("profile.signOut")}`.
  - [x] Sign-out handler: `signOut.mutate(undefined, { onSuccess: () => setOpen(false) })`, and call `setOpen(false)` unconditionally as well so the panel never hangs open on failure. Do **not** invalidate any query key here — Story 27.1's `useSignOut()` owns invalidation (AC 7, 14).
  - [x] `DropdownMenuGroup`, `DropdownMenuLabel`, and `DropdownMenuSeparator` have **zero existing consumers** in `apps/desktop` — verify in the running app that `DropdownMenuLabel` (Base UI `Menu.GroupLabel`) renders correctly inside `DropdownMenuGroup`. If Base UI errors or mis-associates the label, replace the identity block with plain `<div>` children of `DropdownMenuContent` and record the fallback in Completion Notes. — **Verified statically against `@base-ui/react@1.4.0` source, not in a running app** (see Completion Notes → "Base UI `Menu.Group` / `Menu.GroupLabel` verification"). No fallback needed; the `DropdownMenuGroup` wrapper shipped as specified.

- [x] **Task 4: Fire the `SessionExpired` notice exactly once per occurrence (AC: 6)**
  - [x] `const expiredNotifiedRef = useRef(false)`.
  - [x] `useEffect` keyed on the derived status: when it becomes `"SessionExpired"` and `expiredNotifiedRef.current` is `false`, call `toast.error(t("profile.sessionExpired"))` and set the ref to `true`; when the status is anything else, reset the ref to `false`.
  - [x] Import `toast` from `"sonner"` directly (the app-wide `<Toaster />` is already mounted once in `apps/desktop/src/main.tsx:25` — do **not** mount another).
  - [x] Do **not** toast for the `unavailable` (query-error / unrecognized payload) branch — Story 27.4 asserts no auth error state is displayed on a clean profile, and the existing E2E stubs would surface a toast in all 20 specs (AC 13).

- [x] **Task 5: Pin the trigger to the top-right of `TopBar.tsx` without moving the search field (AC: 1, 12, 13)**
  - [x] Edit `apps/desktop/src/components/shared/TopBar.tsx`. Delete the comment on lines 13-14 (AC 12).
  - [x] Add `relative` to the `<header>` class list, keeping `justify-center` intact: `className="relative flex h-14 shrink-0 items-center justify-center bg-chrome px-page-x"`.
  - [x] After the search `</button>` and before `</header>`, add:
        `<div className="absolute inset-y-0 right-page-x flex items-center"><ProfileMenu /></div>`
        (`right-page-x` resolves via `--spacing-page-x: 20px` in `packages/shared/src/styles/tokens.css:267`, the same token `px-page-x` already uses.)
  - [x] **Do not** switch the header to `justify-between`, a grid, or add a spacer element — the search `<button>` is `w-full max-w-[480px]`, so any change to the flex distribution shifts or resizes it and changes the shell's appearance on every route.
  - [x] Add `import { ProfileMenu } from "@/components/auth/ProfileMenu";` using the `@/` alias (never a relative `../` path — `docs/project-context.md#TypeScript`).
  - [x] Do **not** add props to `TopBarProps` and do **not** modify `apps/desktop/src/routes/__root.tsx` — `ProfileMenu` is self-contained, matching the `UpdateChecker.tsx` precedent.

- [x] **Task 6: Add the seven `profile.*` keys to both locales (AC: 11)**
  - [x] Insert the block below into `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`, in both files immediately after the existing `topbar.*` keys (en.json:38-39 / fr.json:38-39), so the two diffs mirror each other. Keys are **flat dotted strings**, not nested objects.
  - [x] `en.json`: `"profile.signIn": "Sign in"`, `"profile.accountMenu": "Account menu for {{email}}"`, `"profile.loading": "Loading account…"`, `"profile.signedInAs": "Signed in as"`, `"profile.signOut": "Sign out"`, `"profile.sessionExpired": "Your session expired. Sign in again to reconnect."`, `"profile.sessionExpiredAction": "Session expired — sign in again"`.
  - [x] `fr.json`: `"profile.signIn": "Se connecter"`, `"profile.accountMenu": "Menu du compte pour {{email}}"`, `"profile.loading": "Chargement du compte…"`, `"profile.signedInAs": "Connecté en tant que"`, `"profile.signOut": "Se déconnecter"`, `"profile.sessionExpired": "Votre session a expiré. Reconnectez-vous."`, `"profile.sessionExpiredAction": "Session expirée — se reconnecter"`.
  - [x] `profile.loading` must use the single-character ellipsis `…` (U+2026), never `...` — enforced by the parity test and matching the convention in `budget-templates-i18n.test.ts:89-96`.
  - [x] Do **not** add keys under a prefix Story 27.2 may claim (it owns the account-prompt dialog copy). `profile.*` is this story's namespace and its only namespace.

- [x] **Task 7: Add the i18n parity test (AC: 11)**
  - [x] Create `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` mirroring `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts` (same `import enLocale from "../en.json"` / `Record<string, string>` cast shape).
  - [x] Assert: all seven `REQUIRED_KEYS` are truthy in both locales; no key with the `profile.` prefix exists in one locale but not the other; the set of shipped `profile.*` keys equals the declared `REQUIRED_KEYS` set (no orphans); `profile.accountMenu` keeps the `{{email}}` placeholder in both locales; `profile.loading` contains `\u2026` and does not contain `...` in both locales.
  - [x] Run `pnpm --filter @nixus/desktop test` — the new file plus the six existing test files must all pass.

- [x] **Task 8: Teach the existing Playwright stubs about `get_auth_session` (AC: 13)** — **CLOSED WITHOUT EXECUTION by orchestrator directive.** No file under `apps/desktop/tests/` was touched. Full rationale and the substitute route to AC 13 are in Completion Notes → "Documented deviation from Task 8". The three stub-editing subtasks below are deliberately left unchecked because they were not performed.
  - [ ] In each of the **20** spec files that define `window.__TAURI_INTERNALS__.invoke`, add `case "get_auth_session": return Promise.resolve({ status: "LoggedOut" });` to the `switch`. Files: `accessibility`, `accounts`, `assets`, `budget-templates`, `budget`, `chat-expense-query`, `chat-maintenance-query`, `chat`, `dashboard`, `design-system`, `expenses`, `financial-health`, `import-duplicates`, `import`, `maintenance`, `nav-qa`, `net-worth`, `onboarding`, `spending-trends`, `year-summary`. — **NOT DONE.** A resolved `{ status: "LoggedOut" }` is precisely the trigger condition for Story 27.2's already-merged `AccountPromptDialog`, mounted in `routes/__root.tsx` on every route. Adding this case would open that **modal** in all 20 specs, and Base UI's focus trap `aria-hidden="true"`s the rest of the app.
  - [ ] Several files declare **more than one** stub — `dashboard.spec.ts` (5 `__TAURI_INTERNALS__` sites), `import.spec.ts` (3), `accounts.spec.ts` (2), `net-worth.spec.ts` (2). Grep `__TAURI_INTERNALS__` and patch **every** `switch`, not just the first in each file. — **NOT DONE** (moot: no stub was patched).
  - [ ] This is mandatory for the 8 files whose `default` branch is `Promise.reject("Unknown command: …")` (`accessibility`, `accounts`, `assets`, `budget-templates`, `budget`, `expenses`, `maintenance`, `onboarding`) and still required for the rest, whose `default` resolves `null`/`[]` and would otherwise silently exercise the `unavailable` fallback. — **NOT DONE, and the premise is inverted:** exercising the `unavailable`/`loading` fallback is exactly what keeps the suite green, and it is now the empirical proof of AC 13's "safe neutral affordance" clause (331 passed / 2 failed — baseline unchanged).
  - [x] `ai-navigation.spec.ts`, `app-launch.spec.ts`, and `navigation.spec.ts` define **no** stub at all (`window.__TAURI_INTERNALS__` is absent, so `invoke` throws). Leave them alone — they already tolerate failing IPC for existing hooks, and they are the strongest proof that the `unavailable` branch must render silently. — Satisfied; and the same treatment was extended to all 23 spec files.
  - [x] Do **not** create a new spec file and do **not** add auth assertions — Story 27.4 owns auth E2E coverage (AC 14). — Satisfied: `git status --porcelain -- apps/desktop/tests` is empty.


- [x] **Task 9: Verify and close out (AC: all)**
  - [x] `pnpm --filter @nixus/desktop build` (runs `tsc && vite build`) — zero TypeScript errors and zero warnings (`noUnusedLocals`/`noUnusedParameters` are on; `docs/guidelines/warnings.md`). — Zero TS errors (`tsc --noEmit` and `tsc` in `build` both exit 0). The only build output is Vite's pre-existing 500 kB chunk-size advisory on the 1.86 MB app bundle, which is unrelated to this story's ~5 kB of source.
  - [x] `pnpm --filter @nixus/desktop test` — all vitest suites pass.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — full E2E suite passes with no new failures. — **331 passed / 2 failed / 333 total**, byte-identical to the pre-story baseline; both failures are the pre-existing `chat.spec.ts:250` and `design-system.spec.ts:110` token regressions from commit `9b45411`.
  - [ ] Manual matrix in `pnpm --filter @nixus/desktop tauri dev`: (a) never signed in ⇒ sign-in icon top-right, clicking it opens the Cognito Hosted UI in the system browser; (b) after a successful sign-in ⇒ icon flips to the account glyph without a manual refresh, clicking it opens an end-aligned panel showing the full email (not truncated at 128px) and the name; (c) a session whose `expires_at` was hand-set into the past with Wi-Fi off ⇒ expired trigger state **plus exactly one** toast, and the dashboard/budget/expenses surfaces all still work; (d) sign out from the panel ⇒ panel closes and the icon returns to the sign-in state; (e) switch the app language to French via the sidebar control and re-check every string, including the trigger's accessible name via the OS/devtools accessibility inspector. — **NOT VERIFIED — requires manual GUI steps** (a live Cognito sign-in, a hand-expired keyring entry, Wi-Fi off, and an OS accessibility inspector) that cannot be performed in this environment. See Completion Notes → "Not verified — requires manual GUI steps".
  - [ ] Keyboard/a11y pass: Tab reaches the trigger after the search field, `Enter`/`Space` opens the panel, arrow keys move between the sign-out item, `Escape` closes and returns focus to the trigger, and the focus ring is visible. Confirm the skip-link is still the first tab stop and the sidebar collapse button the second (`apps/desktop/tests/accessibility.spec.ts:123-136`). — **PARTIALLY VERIFIED.** The skip-link/rail tab-stop assertions pass unchanged (`accessibility.spec.ts:123-136`, green in the full run). Panel keyboard behaviour is **not verified** — the `logged-in` panel is unreachable in the E2E suite without an auth mock, which is Story 27.4's deliverable; roving focus, typeahead, `Escape`-to-close and focus restoration come from Base UI `Menu` rather than from code added here.

  - [x] Confirm with `git status` that no file was added under `apps/desktop/src/routes/`, `packages/shared/src/ui/`, `apps/desktop/public/`, `apps/desktop/src-tauri/`, or `apps/desktop/tests/`, and that `hooks/useAuth.ts`, `lib/constants.ts`, `lib/types.ts`, and `routes/__root.tsx` show no diff.
  - [x] Confirm no `console.log` remains (`docs/project-context.md#Code Quality`).

## Dev Notes

### Scope boundary

Frontend-only, five files: one new component, one modified header, two locale files, one new test — plus the mechanical `get_auth_session` line added to the existing Playwright stubs. No Rust, no IPC, no query keys, no route, no shared-package change, no auth E2E spec.

### Hard dependencies (files may not exist yet — Epic 27 is being authored in parallel)

| Upstream | Contract this story consumes | If missing |
|---|---|---|
| **26.5** (merged) | `get_auth_session` returns `AuthState` = `LoggedOut` \| `LoggedIn { email, name }` \| `SessionExpired`; `sign_out` clears the keyring; refresh failure yields `SessionExpired` and **never clears the entry**, so an expired session reports `SessionExpired` on *every* launch until the user signs in or out — AC 6's affordance is that escape hatch | Blocked |
| **27.1** | `hooks/useAuth.ts` → `useAuthSession()` (raw `useQuery` result on `queryKeys.auth.session`, `staleTime: Infinity`, **no** synthesised `LoggedOut` default), `useSignIn()` (no `onSuccess`, invalidates nothing), `useSignOut()` (invalidates the key on success); `lib/types.ts` → `AuthState` discriminated union; `useAuth.ts` also listens for `auth:callback-received` and invalidates | **Blocked — report, do not stub** |
| **27.2** | `components/auth/AccountPromptDialog.tsx` in the same directory, reading the same query key | Not blocking — the two must share **nothing** but the cache entry (AC 8) |
| **27.4** | Auth Playwright coverage, incl. asserting the logged-out header icon | Not blocking — this story only supplies the stable `data-testid`/`data-auth-state` selectors |

### `ProfileMenu` state table (implement exactly this)

| `useAuthSession()` | `data-auth-state` | Trigger | Activation | Panel | Toast |
|---|---|---|---|---|---|
| `isLoading` (first resolve) | `loading` | `User`, `disabled`, `aria-label={t("profile.loading")}` | — | none | none |
| `{ status: "LoggedOut" }` | `logged-out` | `LogIn`, `aria-label={t("profile.signIn")}` | `signIn.mutate()` | none | none |
| `{ status: "LoggedIn", email, name }` | `logged-in` | `CircleUser`, `aria-label={t("profile.accountMenu", { email })}` | opens `DropdownMenu` | email + optional name + Sign out | none |
| `{ status: "SessionExpired" }` | `session-expired` | `LogIn` + `text-caution-ink`, `aria-label={t("profile.sessionExpiredAction")}` | `signIn.mutate()` | none | `profile.sessionExpired`, **once** |
| `isError`, or `data` is `null`/`[]`/unknown `status` | `unavailable` | `LogIn`, `aria-label={t("profile.signIn")}` | `signIn.mutate()` | none | **none** |

The `unavailable` row is not defensive padding — it is a live path. See "E2E stub blast radius" below.

### Where the header actually is (variance from the architecture delta tree)

`architecture-login.md#Delta to Existing Project Tree` lists `routes/__root.tsx` as the file that "mounts `<ProfileMenu />` in the app shell/header", and epics AC 1 is phrased against `__root.tsx`. That document predates knowledge of `TopBar.tsx`. Ground truth:

- `apps/desktop/src/routes/__root.tsx:106-156` is the shell. Its only provider is `ValuesVisibilityProvider`; it renders `<AppSidebar />` (121), `<TopBar onSearchClick={…} />` (123), `<DestinationNav />` (124), `<main>` (127), then `<FloatingChatBar />` (151), `<UpdateChecker />` (152), `<RecurringApplyListener />` (153). There is **no** auth/session provider anywhere.
- `apps/desktop/src/components/shared/TopBar.tsx:16` is the actual `<header>`, rendered on every route. Its single child is the centered ⌘K search button (17-35).

**Decision: mount inside `TopBar.tsx`, leave `__root.tsx` untouched.** That is the literal "top-right of the app header/chrome" the architecture asked for, and it keeps `__root.tsx`'s prop surface unchanged — matching the `UpdateChecker.tsx` precedent of a self-contained, unconditionally-mounted component. Record this variance in Completion Notes; do not "fix" it by adding a second mount in `__root.tsx`.

`PageHeader.tsx` is a per-route `<h1>` block rendered inside each surface — **not** the app header. Do not touch it.

### Layout: keep the search field exactly where it is

The `<header>` is `flex … justify-center` with one `w-full max-w-[480px]` child. Switching to `justify-between`, a grid, or adding a left spacer all shift or resize the search field on every route — a visible, unrequested shell regression. Use `relative` on the header + an `absolute inset-y-0 right-page-x` wrapper for the trigger. The search field's centering, width, hover, focus ring, and ⌘K handling (owned by `__root.tsx:74-83`) then stay byte-for-byte unaffected.

No custom titlebar is involved: `tauri.conf.json` sets no `decorations` key (native OS titlebar) and `data-tauri-drag-region` appears **nowhere** in `apps/desktop/src`. No drag-region exclusion styling is needed.

### Panel width gotcha (most likely visual defect in this story)

`packages/shared/src/ui/dropdown-menu.tsx:44` gives `DropdownMenuContent` the base classes `w-(--anchor-width) max-h-(--available-height) min-w-32`. Anchored to an `icon-sm` button the computed width collapses to the 128px floor — long enough for "Sign out", far too narrow for an email. Pass `className="w-64"` and `truncate` + `title={email}` on the email row. Every existing consumer (`AccountRow.tsx:170`, `AssetRow.tsx:150`, `VehicleDetailPanel.tsx:154`) uses bare `align="end"` because their triggers are wide table cells — do not copy that detail blindly.

### Reuse map — exact primitives, exact specifier

- Import specifier is **`"@nixus/shared"`** (root), not `"@nixus/shared/ui"`. `packages/shared/src/index.ts` re-exports `./ui`, and every app consumer uses the root (`TopBar.tsx:3`, `AccountRow.tsx:5-20`, `main.tsx:7`). `docs/project-context.md` still says `@nkbaz/shared` — **that scope no longer exists**; the workspace is `@nixus/*` (`packages/shared/package.json:2`, `apps/desktop/package.json:2`).
- `Button` variants: `default | outline | secondary | ghost | destructive | link`. Sizes: `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`. Header icon-button convention is `variant="ghost" size="icon-sm"`.
- `DropdownMenu` family exported: `DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent`. `DropdownMenuContent` accepts `align`/`alignOffset`/`side`/`sideOffset`.
- **Use `DropdownMenu`, not `Popover`.** Base UI `Menu` gives roving-focus arrow-key navigation, typeahead, `Escape`-to-close, and focus restoration for free; `packages/shared/src/ui/popover.tsx:15-20` exposes only `sideOffset` and has no menu semantics. `DropdownMenu` is also the sole in-repo precedent for an icon-button-anchored menu. "Panel/popover anchored to the icon" in the architecture describes the *form factor*, not the `Popover` primitive.
- **Do not use `Dialog`.** `packages/shared/src/ui/dialog.tsx:10-11` states: *"Destructive confirms only… Modal-heavy workflows are a named anti-pattern."* Sign-out is reversible (just sign in again) and needs no confirm step — AC 4 requires an anchored panel, not a modal.
- **No `Avatar` primitive exists** in `packages/shared/src/ui/` and none may be created (AC 10). Use a lucide glyph.
- Icon convention: bare lucide element with `aria-hidden="true"` and no size class inside a `Button`/`DropdownMenuItem` (their CVA applies `[&_svg:not([class*='size-'])]:size-4`); explicit `size-4` only outside those wrappers, as `TopBar.tsx:27` does. `User`, `CircleUser`, `LogIn`, `LogOut` all exist in the installed `lucide-react ^0.577.0`.
- Copy the composition at `apps/desktop/src/components/accounts/AccountRow.tsx:157-187` — `DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={…} data-testid={…} />}` wrapping the icon, then `DropdownMenuContent align="end"` with icon+label `DropdownMenuItem`s. Note the `render` prop (Base UI's slot mechanism), not `asChild`.
- `DropdownMenuGroup` / `DropdownMenuLabel` / `DropdownMenuSeparator` have **no existing consumer** in `apps/desktop` — this story is the first. `DropdownMenuLabel` wraps Base UI `Menu.GroupLabel`, which expects a `Menu.Group` ancestor; hence the `DropdownMenuGroup` wrapper in Task 3, with the plain-`<div>` fallback if it misbehaves.
- Toast: `import { toast } from "sonner"` (raw package, as `AccountRow.tsx:4,94` does); the styled `<Toaster />` is already mounted once in `main.tsx:25`.

### E2E stub blast radius (the regression this story is most likely to cause)

Mounting `ProfileMenu` puts an `invoke("get_auth_session")` on **every route load in every Playwright spec**. 20 spec files stub `window.__TAURI_INTERNALS__.invoke` with a hand-written `switch`:

- 8 end with `default: return Promise.reject("Unknown command: " + cmd)` (`accessibility.spec.ts:77-78` and siblings) → the query rejects, TanStack Query retries, console fills with rejections.
- 12 end with `default: return Promise.resolve(null)` (or `[]` in `nav-qa.spec.ts:90`) → `data` is `null`/`[]`, so `data.status` is `undefined`.
- 3 more (`ai-navigation`, `app-launch`, `navigation`) define **no stub at all** → `window.__TAURI_INTERNALS__` is undefined and `invoke` throws outright.

All three paths must land on the `unavailable` row of the state table: a plain sign-in-looking button, **no toast, no error text, no thrown render**. A toast here would float over the UI in 23 specs and can trip `getByRole`/visibility assertions — the same class of failure the comment at `accessibility.spec.ts:6-8` documents for `UpdateChecker`'s dialog (a truthy updater response makes Base UI's focus trap set `aria-hidden="true"` on the whole app). Task 8 then makes the 20 stubs explicit so the header exercises the real `LoggedOut` path.

### i18n facts

- Both locale files are **flat** `Record<string, string>` maps whose keys contain literal dots — `"profile.signOut"`, never a nested `{ "profile": { "signOut": … } }` object. `en.json` currently has ~1153 keys; `fr.json` mirrors it. Init: `apps/desktop/src/lib/i18n.ts` (`fallbackLng: "en"`).
- Interpolation is `{{name}}`-style: `"accounts.rowActions": "Actions for {{name}}"` consumed as `t("accounts.rowActions", { name: account.name })` (`AccountRow.tsx:163`).
- **There is no global EN/FR parity check.** Parity is enforced per-feature by hand-written vitest suites in `apps/desktop/src/locales/__tests__/` (`danger-zone-i18n.test.ts`, `maintenance-i18n.test.ts`, `budget-templates-i18n.test.ts`). A new namespace ships with **no** protection unless Task 7 adds it — which is why AC 11 requires the test, not just the keys.
- `aria-label` values count as user-facing strings and must be translated (AC 11). The `data-testid` and `data-auth-state` attributes must **not** be.

### Testing standards

- `docs/project-context.md#Testing Rules` claims "no unit test framework in desktop" — **out of date.** `apps/desktop/package.json` has `"test": "vitest run"` with `vitest ^3.2.4` + `jsdom ^25.0.1`, `vitest.config.ts` includes `src/**/*.test.{ts,tsx}` with `environment: "jsdom"` and the `@` alias, and six suites already exist.
- `@testing-library/react` is **not** a dependency (`useBudgetTemplates.test.tsx:32` says so explicitly). Component tests here use raw `createRoot` + `act` with `IS_REACT_ACT_ENVIRONMENT`, and mock IPC via `vi.mock("@tauri-apps/api/core", …)`.
- **A `ProfileMenu` render test is deliberately out of scope.** It would require mocking `@/hooks/useAuth` and driving Base UI's portal-rendered `Menu` through `act` in jsdom with no `@testing-library/react` — high cost, brittle, and Story 27.4 owns real coverage of these surfaces via Playwright. The mandatory automated gate for this story is the i18n parity suite (Task 7); behaviour is verified by the Task 9 manual matrix.
- Do not add `@testing-library/react`, `jest-axe`, or any test dependency.
- No CI gate runs `vitest` or `playwright` for `apps/desktop` (`.github/workflows/web-ci.yml` is scoped to `apps/web` + `packages/shared`; `release.yml` builds/signs only). The zero-warning and green-suite requirements are therefore procedural — run them in Task 9.

### Anti-patterns for this story (do not do these)

- Creating `apps/desktop/src/routes/profile.tsx`, or a full-page/modal profile surface.
- Calling `invoke`, importing `@tauri-apps/api/*`, importing `queryKeys`, or invalidating a query key from `ProfileMenu.tsx`.
- Adding a local `useState`/`useReducer`/context copy of auth state, or sharing state, context, or props with `AccountPromptDialog`.
- Creating an `Avatar` (or any) component in `packages/shared/src/ui/`, or adding a new SVG/PNG asset.
- Using `Popover` or `Dialog` instead of `DropdownMenu` for the panel.
- Leaving `DropdownMenuContent` at its default `w-(--anchor-width)` width.
- Changing the header's `justify-center`, adding spacers, or altering the search button's classes.
- Adding props to `TopBarProps`, or editing `routes/__root.tsx`, `hooks/useAuth.ts`, `lib/constants.ts`, `lib/types.ts`, or `AppSidebar.tsx`.
- Rendering a name row when `name` is `null` or `""`.
- Toasting on query error, or re-firing the `SessionExpired` toast on every refetch/re-render.
- Adding literal English (including in `aria-label`), or adding a key to only one locale file.
- Writing `...` instead of `…` in `profile.loading`.
- Creating a new `apps/desktop/tests/*.spec.ts`, or adding auth assertions to existing specs beyond the `get_auth_session` stub case.
- Restating the deleted `TopBar.tsx` rationale comment, or leaving a `console.log`.
- Relative `../../` imports instead of the `@/` alias.

### Project Structure Notes

```
apps/desktop/src/
├── components/
│   ├── auth/
│   │   └── ProfileMenu.tsx        # NEW: trigger + anchored profile panel
│   └── shared/
│       └── TopBar.tsx             # MODIFIED: + relative, + absolute right slot, − stale comment (13-14)
├── locales/
│   ├── en.json                    # MODIFIED: + 7 profile.* keys (after topbar.* at :38-39)
│   ├── fr.json                    # MODIFIED: + the same 7 keys, same position
│   └── __tests__/
│       └── profile-i18n.test.ts   # NEW: EN/FR parity + placeholder + ellipsis assertions
└── routes/
    └── __root.tsx                 # UNCHANGED (see variance below)

apps/desktop/tests/*.spec.ts       # MODIFIED (20 files): + case "get_auth_session" in the invoke stub
```

Alignment and variances:

- **Aligned:** `components/{feature}/` grouping (`components/auth/`, matching architecture-login.md); PascalCase component file; flat dotted i18n keys; shared-UI-first reuse; `@/` alias; `data-testid` on every interactive element; no comments that restate code.
- **Variance (accepted):** the trigger is mounted in `components/shared/TopBar.tsx`, not `routes/__root.tsx` as the architecture delta tree states. `TopBar` *is* the persistent header `__root.tsx` renders; mounting there satisfies "top-right of the app header/chrome" and avoids touching the shell's prop surface. See "Where the header actually is".
- **Variance (accepted):** this story modifies 20 Playwright spec files that the architecture delta tree does not list. Unavoidable consequence of putting an IPC-backed component in the always-rendered header; the change is one `case` line per stub, with no assertion changes.
- **Doc drift to work around, not propagate:** `docs/project-context.md` still names the `@nkbaz/*` scope (real: `@nixus/*`) and still claims desktop has no unit test framework (real: vitest is configured with six suites). Follow the code, not the doc; do not "fix" the doc in this story.
- **Product-stance reversal:** `TopBar.tsx:13-14` explicitly forbade an account glyph. Epics 26/27 supersede it. Deleting that comment is AC 12, not an incidental diff — a reviewer who finds it surviving alongside a profile icon will read the change as contradicting itself.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.3: Header Profile Menu & Minimalist Profile View] — all primary acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.1: Frontend Auth Session Hook & Query Key] — `useAuthSession`/`useSignIn`/`useSignOut` contract, `AuthState` union, `useAuth.ts` as sole `invoke` caller, query error must not blank the shell
- [Source: _bmad-output/implementation-artifacts/27-1-frontend-auth-session-hook-and-query-key.md#Acceptance Criteria 3-5,8] — hook returns the raw `useQuery` result with no `LoggedOut` default (so `isLoading` is distinguishable from "no account"), `staleTime: Infinity`, `useSignIn()` invalidates nothing, `useSignOut().onSuccess` invalidates `queryKeys.auth.session`, errors surface as `isError`/`error` with no thrown render
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.2: Account Prompt Dialog with Continue Offline] — the second consumer of `["auth", "session"]`; decoupling requirement
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.4: Auth E2E Coverage & Licensing Independence Amendment] — owns auth Playwright coverage; asserts the logged-out header icon and absence of an auth error state
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.5: Session Read, Launch Refresh & Sign-Out Commands] — `LoggedOut`/`LoggedIn`/`SessionExpired` semantics; `SessionExpired` persists across launches until sign-in or sign-out
- [Source: _bmad-output/planning-artifacts/epics-login.md#UX Design Requirements] — top-right icon, panel-not-route, sidebar untouched, reuse bundled icon set; visual specifics flagged for UX review
- [Source: _bmad-output/planning-artifacts/epics-login.md#Requirements Inventory] — FR3, NFR1, inherited EN/FR i18n rule
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Frontend Architecture] — small top-right header icon, logged-out vs logged-in rendering, profile panel content (email, name, sign-out)
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Structure Patterns] — no `routes/profile.tsx`; panel anchored to the header icon
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Component Boundaries] — both surfaces are pure consumers of `useAuthSession()`; neither owns auth state
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Process Patterns] — neutral/loading trigger until the first `get_auth_session` resolves
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security] — session-expiry must be surfaced explicitly (toast and/or profile-icon state) while the app keeps working
- [Source: _bmad-output/planning-artifacts/architecture-login.md#File Organization Patterns] — no new static assets; reuse the shared package's bundled icon set
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Delta to Existing Project Tree] — `components/auth/ProfileMenu.tsx` NEW; `__root.tsx` listed as the mount point (see accepted variance)
- [Source: _bmad-output/implementation-artifacts/26-5-session-read-launch-refresh-and-sign-out-commands.md#get_auth_session decision table] — exact conditions producing each `AuthState`
- [Source: docs/project-context.md#8 Shared UI Components] — check `@nixus/shared` first; never duplicate a `packages/shared/src/ui/` component
- [Source: docs/project-context.md#7 TypeScript Strictness] — strict + `noUnusedLocals`/`noUnusedParameters`; `@/*` alias
- [Source: docs/project-context.md#i18n (Both Apps)] — every user-visible string through i18next; `const { t } = useTranslation()`
- [Source: docs/project-context.md#Code Quality & Style Rules] — WHY-only comments, no `console.log`, zero warnings
- [Source: docs/guidelines/warnings.md] — compilation-warning policy referenced by CLAUDE.md
- [Source: apps/desktop/src/routes/__root.tsx:106-156] — shell structure, `<TopBar>` at 123, `UpdateChecker`/`RecurringApplyListener` self-contained-mount precedent, ⌘K handler at 74-83
- [Source: apps/desktop/src/components/shared/TopBar.tsx:1-38] — the `<header>`, its `justify-center` layout, the search button, and the stale "no account avatar" comment at 13-14
- [Source: apps/desktop/src/components/accounts/AccountRow.tsx:4-20,157-187] — canonical icon-button-anchored `DropdownMenu`, `render={<Button variant="ghost" size="icon-sm" …/>}`, `align="end"`, `toast` from `sonner`, `@nixus/shared` root import
- [Source: packages/shared/src/ui/dropdown-menu.tsx:21-50,56-74,76-97,223-234,252-268] — `DropdownMenuContent`'s `w-(--anchor-width) … min-w-32` base class and `align`/`side` props; `DropdownMenuLabel` = `Menu.GroupLabel`; full export list
- [Source: packages/shared/src/ui/button.tsx:20-38] — exact `variant` and `size` keys
- [Source: packages/shared/src/ui/dialog.tsx:10-11] — "Destructive confirms only… Modal-heavy workflows are a named anti-pattern"
- [Source: packages/shared/src/ui/popover.tsx:15-20] — exposes only `sideOffset`; no menu semantics
- [Source: packages/shared/src/index.ts:1-3, packages/shared/package.json:2,7-23] — root export re-exports `./ui`; package is `@nixus/shared`
- [Source: packages/shared/src/styles/tokens.css:200,265-272,327-332] — `--spacing-page-x: 20px` and `--spacing-target-min: 24px` are declared inside `@theme`, so `right-page-x`/`pr-page-x` are valid utilities; `--color-caution-ink` (warning) vs `--color-over-ink` (over-budget/error)
- [Source: apps/desktop/src/locales/en.json:38-39, fr.json:38-39] — flat dotted keys; `topbar.*` insertion neighbourhood
- [Source: apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts:1-6,89-96,108-179] — parity-test template, ellipsis convention, placeholder assertions
- [Source: apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx:1-32] — `createRoot`+`act` test idiom; `@testing-library/react` is not a dependency
- [Source: apps/desktop/vitest.config.ts:1-15, apps/desktop/package.json:6-9] — vitest is configured for desktop (`src/**/*.test.{ts,tsx}`, jsdom, `@` alias)
- [Source: apps/desktop/tests/accessibility.spec.ts:1-84,123-136] — the `__TAURI_INTERNALS__.invoke` stub with `default: Promise.reject("Unknown command: …")`, the `UpdateChecker`/`aria-hidden` cautionary note, and the first-two-tab-stops assertions
- [Source: apps/desktop/tests/nav-qa.spec.ts:89-91, dashboard.spec.ts:98-99, net-worth.spec.ts:49-50,195-196] — stubs whose `default` resolves `null`/`[]`, producing the `unavailable` state
- [Source: apps/desktop/src/main.tsx:7,25] — `<Toaster />` from `@nixus/shared` mounted once, outside the router
- [Source: apps/desktop/src/components/shared/AppSidebar.tsx:158-268] — the rail's 3 nav items + 5 footer controls + collapse toggle; must remain unchanged

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5` (Sisyphus-Junior executor, `bmad-dev-story` workflow)

### Debug Log References

None. No debugging session was required — no gate failed on first run.

### Completion Notes List

#### Documented deviation from Task 8 (the only deviation that changes what shipped)

**Task 8 was closed without execution, by explicit orchestrator directive. No file under `apps/desktop/tests/` was touched** (`git status --porcelain -- apps/desktop/tests` → empty).

Task 8 asked for `case "get_auth_session": return Promise.resolve({ status: "LoggedOut" });` in 20 spec stubs. That instruction was written before Story 27.2 merged. It is now actively harmful:

- Story 27.2's `AccountPromptDialog` is mounted in `routes/__root.tsx` on **every** route, and its guard (`AccountPromptDialog.tsx:50-55`) fires on a **successfully-resolved** `{ status: "LoggedOut" }` — exactly the payload Task 8 wanted the stubs to return.
- It is a `Dialog`. Base UI's focus trap sets `aria-hidden="true"` on the rest of the app, so every unrelated `getByRole`/`getByTestId` in the suite resolves zero elements. This was measured during 27.2's review: a loosened guard took `accessibility.spec.ts` from 15/15 to 8 passed / 7 failed with exactly that failure mode. The same hazard is documented in-repo at `accessibility.spec.ts:3-9` for `UpdateChecker`.

**AC 13 was satisfied the other way instead** — by making the component provably safe in the states the untouched stubs actually produce, and proving the suite is unchanged:

- All 23 spec files end their `invoke` switch in `default: return Promise.reject(...)`, `Promise.resolve(null)`, `[]`, or define no stub at all. `get_auth_session` therefore never resolves a recognised payload, so `ProfileMenu` spends every spec in `loading` (during TanStack Query's 3 default retries) and then `unavailable`.
- Both rows render one plain `ghost`/`icon-sm` `Button`: no menu, no toast, no error text, no thrown render. `deriveState()` reaches `unavailable` through a `default:` branch, so a `null`, `[]`, or unknown-`status` payload lands there too.
- Empirical proof: full suite **331 passed / 2 failed / 333 total** — identical to the pre-story baseline. The ⌘K trigger's own spec coverage and `accessibility.spec.ts:123-136` (skip-link first tab stop, rail second) are green.

Story 27.4 owns all auth E2E and will write its own dedicated `get_auth_session` mocks alongside a suppression for `AccountPromptDialog`.

#### Selectors shipped for Story 27.4 (use these verbatim — no component edit needed)

| Selector | Where | Notes |
|---|---|---|
| `data-testid="profile-menu-trigger"` | **every** state, one element | The single stable trigger selector. |
| `data-auth-state="loading" \| "logged-out" \| "logged-in" \| "session-expired" \| "unavailable"` | on the trigger | State is readable without inspecting the icon. |
| `data-testid="profile-menu-panel"` | `DropdownMenuContent` | Portal-rendered; `logged-in` only. |
| `data-testid="profile-menu-email"` | email row inside the panel | Also carries `title={email}`. |
| `data-testid="profile-menu-name"` | name row inside the panel | **Count 0** when `name` is `null`, `""`, or whitespace-only (AC 5). |
| `data-testid="profile-menu-sign-out"` | `DropdownMenuItem` | Calls `useSignOut()`. |

27.4 note: under a stub that resolves `{ status: "LoggedOut" }`, `AccountPromptDialog` will also open and aria-hide the app. Suppress it (its `dismissed` path, or route to `/onboarding`, which it already excludes) before asserting on the header.

#### State table — implemented exactly, with a strict `status` match

`deriveState(isLoading, isError, status)` in `ProfileMenu.tsx` is ordered `isLoading` → `isError` → `switch (status)` → `default`, so an unrecognised or absent `status` can only reach `unavailable`. `isError` is checked before the payload, so a stale-`data`-plus-failed-refetch pair reports `unavailable` rather than a state the backend no longer confirms.

- `loading` → `disabled` trigger, `User` glyph, `aria-label={t("profile.loading")}`, no menu, no toast.
- `logged-out` → `LogIn`, `t("profile.signIn")`, `onClick` → `signIn.mutate()`, no menu.
- `logged-in` → `CircleUser`, `t("profile.accountMenu", { email })`, opens the anchored `DropdownMenu`.
- `session-expired` → `LogIn` + `text-caution-ink` (`--color-caution-ink`, `tokens.css:329` — the warning token, not `text-over-ink`), `t("profile.sessionExpiredAction")`, `signIn.mutate()`, plus exactly one toast.
- `unavailable` → identical to `logged-out`, and **explicitly no toast**.

#### AC 6 — the expiry toast fires once per occurrence

`useEffect` keyed on the **derived status string**, not on the query object, guarded by `expiredNotifiedRef`. Entering `session-expired` fires `toast.error(t("profile.sessionExpired"))` and arms the ref; any other status disarms it. A refetch that re-reports `SessionExpired` (the Rust side never clears the keyring entry on refresh failure, so it reports expiry on every launch) does not re-announce. React StrictMode's double-invoked effect does not double-toast either — refs survive the remount, so the second pass sees the ref already armed. The effect never runs for `unavailable`, which is what keeps `sonner` out of the 23 existing specs.

#### AC 5 — absent name renders nothing at all

`const displayName = account.name?.trim() ?? ""` and `{displayName ? <div …/> : null}`. `null`, `""`, and whitespace-only all produce **zero** `profile-menu-name` elements — not an empty one — which is what 27.4's count-0 assertion needs. `name` is legitimately `null` for email/password Cognito users.

#### Base UI `Menu.Group` / `Menu.GroupLabel` verification (Task 3's open question)

`DropdownMenuGroup` / `DropdownMenuLabel` / `DropdownMenuSeparator` had zero `apps/desktop` consumers before this story. Task 3 asked for a running-app check; that was **not** performed. The contract was instead verified against the installed source, `@base-ui/react@1.4.0`:

- `menu/group/MenuGroupContext.js` → `useMenuGroupRootContext()` throws *"Menu group parts must be used within `<Menu.Group>`"* when the context is absent. `DropdownMenuLabel` is wrapped in `DropdownMenuGroup`, so it cannot hit that throw.
- `menu/group/MenuGroup.js` renders `<div role="group" aria-labelledby={labelId}>` and provides `setLabelId`; `menu/group-label/MenuGroupLabel.js` registers its generated id through that setter and renders `role="presentation"`. The association is correct by construction, not mis-associated.

No fallback to plain `<div>` children was needed. The `DropdownMenuGroup` wrapper shipped as specified.

#### Micro-simplification of Task 3's sign-out snippet (no AC impact)

Task 3 suggested `signOut.mutate(undefined, { onSuccess: () => setOpen(false) })` **and** an unconditional `setOpen(false)`. The unconditional call runs synchronously and already closes the panel, which makes the `onSuccess` callback provably dead code (a second `setOpen(false)` on already-`false` state that React bails out of). Shipped as `signOut.mutate(); setOpen(false);` with a WHY comment. Both AC 7 requirements still hold — the panel closes, and it closes on failure too — and no invalidation happens here: `useSignOut()` (Story 27.1) owns `queryKeys.auth.session`.

#### Not verified — requires manual GUI steps

The Task 9 manual matrix (a)-(e) was **not performed**. It needs a live Cognito Hosted UI round trip, a keyring entry hand-edited to a past `expires_at`, Wi-Fi disabled, the OS/devtools accessibility inspector, and the sidebar language toggle inside a running `tauri dev` window — none of which are available in this environment. Specifically unverified: the panel's rendered width against a real long email, the icon flip after a real callback, the single-toast expiry path end to end, and the French accessible names as read by an accessibility inspector. The keyboard pass is only partially verified: the skip-link/rail tab-stop assertions pass, but the `logged-in` panel's roving focus, `Escape`-to-close and focus restoration are unexercised (they are Base UI `Menu` behaviour, not code added here) and are Story 27.4's coverage. **These are stated as unverified rather than claimed as passing.**

#### Accepted variance carried forward from Dev Notes

`ProfileMenu` is mounted in `components/shared/TopBar.tsx`, **not** `routes/__root.tsx` as `architecture-login.md#Delta to Existing Project Tree` states. `TopBar` *is* the persistent `<header>` that `__root.tsx:123` renders on every route, so this is the literal "top-right of the app header" the architecture asked for, and it leaves the shell's prop surface untouched (the `UpdateChecker` precedent). `__root.tsx` was not modified by this story; its only diff is Story 27.2's `AccountPromptDialog` mount.

Header layout: `<header>` gained `relative` and the trigger sits in an `absolute inset-y-0 right-page-x` wrapper. `justify-center` is intact and the search `<button>`'s classes are byte-for-byte unchanged, so the ⌘K field neither shifts nor resizes. `right-page-x` resolves through `--spacing-page-x: 20px` (`tokens.css:267`), which `cn`'s `extendTailwindMerge` already registers as a spacing key. The stale "no account avatar" rationale comment (old `TopBar.tsx:13-14`) is deleted with no replacement (AC 12).

#### Scope fence audit (AC 14)

`ProfileMenu.tsx` contains no `invoke`, no `@tauri-apps/api` import, no `listen`, no `queryKeys`, no `as any`, no `@ts-ignore`/`@ts-expect-error`, and no `console.log`. Imports are exactly the allowlist from Task 2. Its only local state is `useState(false)` for panel open/closed plus the `expiredNotifiedRef` notification latch — no copy of auth state, and nothing shared with `AccountPromptDialog` but the `["auth", "session"]` cache entry (AC 8). No route file, no new `packages/shared/src/ui/` component, no `Avatar`, no new asset, no new dependency, no version bump. `git diff` confirms zero lines added by this story to `hooks/useAuth.ts`, `lib/constants.ts`, `lib/types.ts`, `routes/__root.tsx`, `AccountPromptDialog.tsx`, `packages/shared/src/ui/`, `apps/desktop/public/`, `apps/desktop/src-tauri/`, or `apps/desktop/tests/` (the diffs those first four files show are Stories 27.1/27.2's uncommitted work: `+queryKeys.auth.session`, `+AuthState`, `+AccountPromptDialog` import and mount).

#### Gate output (verbatim)

`pnpm --filter @nixus/desktop exec tsc --noEmit`

```
EXIT=0
```

`pnpm --filter @nixus/desktop test`

```
 RUN  v3.2.4 /Users/nbazinet/projects/nixus/apps/desktop

 ✓ src/locales/__tests__/maintenance-i18n.test.ts (2 tests) 2ms
 ✓ src/locales/__tests__/danger-zone-i18n.test.ts (19 tests) 2ms
 ✓ src/locales/__tests__/profile-i18n.test.ts (16 tests) 3ms
 ✓ src/locales/__tests__/auth-i18n.test.ts (14 tests) 4ms
 ✓ src/locales/__tests__/budget-templates-i18n.test.ts (61 tests) 4ms
 ✓ src/lib/__tests__/agents.test.ts (4 tests) 2ms
 ✓ src/hooks/__tests__/useTrendsInsight.test.tsx (1 test) 12ms
 ✓ src/hooks/__tests__/useAuth.test.tsx (8 tests) 35ms
 ✓ src/hooks/__tests__/useBudgetTemplates.test.tsx (16 tests) 45ms

 Test Files  9 passed (9)
      Tests  141 passed (141)
```

125 pre-existing + 16 new = 141. No pre-existing test changed.

`pnpm --filter @nixus/desktop exec playwright test`

```
  2 failed
    tests/chat.spec.ts:250:3 › AI Chat Page — Story 7.1 › money in an answer is tabular Inter, never monospace [AC4]
    tests/design-system.spec.ts:110:1 › spine colour tokens reach the document root ────────────────
  331 passed (1.4m)
```

**331 passed / 2 failed / 333 total — exact baseline match.** Both failures are pre-existing and unrelated to auth: `chat.spec.ts:250` expects `font-variant-numeric: tabular-nums` and gets `normal`; `design-system.spec.ts:110` expects the old spine palette (`#FAF8F5`/`#5B54D6`) and gets the new one (`#F1F5F9`/`#4F46E5`). Both trace to commit `9b45411` rewriting `packages/shared/src/styles/tokens.css`. Neither was fixed and neither is counted as this story's regression.

`pnpm --filter @nixus/desktop build`

```
> tsc && vite build
✓ 4307 modules transformed.
dist/assets/index-Dn7xw9xY.js               1,862.00 kB │ gzip: 539.39 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 6.22s
```

Zero TypeScript errors. The chunk-size line is Vite's pre-existing advisory on the 1.86 MB app bundle, not a compilation warning introduced here.

### File List

| File | Action |
|---|---|
| `apps/desktop/src/components/auth/ProfileMenu.tsx` | **NEW** — trigger state machine + anchored profile panel |
| `apps/desktop/src/components/shared/TopBar.tsx` | MODIFIED — `relative` header, absolute right slot mounting `<ProfileMenu />`, stale rationale comment deleted (AC 12) |
| `apps/desktop/src/locales/en.json` | MODIFIED — 7 flat `profile.*` keys after `topbar.searchAriaLabel` |
| `apps/desktop/src/locales/fr.json` | MODIFIED — the same 7 keys, mirrored position |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | **NEW** — 16 EN/FR parity, orphan, placeholder, aria-label and ellipsis assertions |

Exactly five files. Nothing under `apps/desktop/tests/`, `apps/desktop/src/routes/`, `packages/shared/`, `apps/desktop/public/`, or `apps/desktop/src-tauri/`.

### Change Log

| Date | Change |
|---|---|
| 2026-08-09 | Story 27.3 implemented: header profile menu (`ProfileMenu.tsx`) with the full 5-state trigger table, anchored `DropdownMenu` identity panel, once-per-occurrence `SessionExpired` toast, and a silent `unavailable` branch; mounted top-right in `TopBar.tsx`; 7 `profile.*` keys added to both locales; `profile-i18n.test.ts` parity suite added. Task 8 (Playwright stub edits) closed without execution by orchestrator directive — see Completion Notes. Gates: `tsc --noEmit` 0 errors, vitest 141/141, Playwright 331 passed / 2 failed (baseline match). Status → review. |

### Review Findings

**Verdict: NO BLOCKING FINDINGS.** Nothing in this change is a correctness bug, a security issue, a spec/AC violation, or a regression. Every claim in the Dev Agent Record was re-verified independently — all four gates re-run from scratch, the Base UI dependency read in `node_modules` **and** exercised in a real browser, and three mutation tests executed. Six NON-BLOCKING items are recorded below; none of them blocks the story.

Reviewer conduct: **no file under `apps/` was modified by this review.** Three mutation experiments temporarily edited `fr.json`, `ProfileMenu.tsx`, and `TopBar.tsx`; all three were restored and confirmed **bit-for-bit identical by SHA-256** before this report was written (`ProfileMenu.tsx` `84f93aaa…c1671`, `TopBar.tsx` `51e0f63f…ab106`, `en.json` `147b1125…64bd64`, `fr.json` `b5ff079b…4813bf`, `profile-i18n.test.ts` `1c02ea48…59d0ac` — `shasum -c` reports `OK` on all five). Final `git status --porcelain` is identical to the pre-review listing. Runtime evidence was gathered with standalone Playwright probes held **outside** the repo (in `$TMPDIR`), stubbing `window.__TAURI_INTERNALS__` via `addInitScript` — no new spec file, no edit under `apps/desktop/tests/`.

#### A. Regression risk — VERIFIED CLEAN, and the inert path is proven by measurement

- **Full Playwright suite: exact baseline match. `331 passed / 2 failed / 333 total`** (333 result lines counted in the log). The only 2 failures are the documented pre-existing pair — `tests/chat.spec.ts:250` (tabular-Inter) and `tests/design-system.spec.ts:110` (spine colour tokens), both from `9b45411` — and are **not** counted as this story's regression. **Zero new failures.** `tests/maintenance.spec.ts:1403` **passed** (`✓ 249 … multiple vehicles appear in garage list`), so the known flake did not fire and no isolation re-run was needed.
- `git status --porcelain -- apps/desktop/tests/` → **0 lines.** Task 8's 20 spec edits were genuinely not performed, exactly as the orchestrator directed.
- **The `unavailable` branch is measurably inert.** A probe replicating `accessibility.spec.ts`'s stub (`default: Promise.reject("Unknown command: …")`), watching the DOM every frame for 14 s — long enough to cross TanStack Query's 3 retries — measured: `triggerCount: 1`, `data-auth-state="unavailable"`, `aria-label="Sign in"`, `disabled: false`, **`toastEverAppeared: 0`**, `profile-menu-panel` count `0`, `consoleErrors: []`, no thrown render. `toast.error` cannot reach the `isError`/unrecognised-`status` state: the effect's first statement returns early for every `state !== "session-expired"`, and `unavailable` is the only state the E2E stubs can produce besides `loading`.
- **Mutation test — the probe is sensitive, so the zero above is real.** Loosening the guard to `if (state !== "session-expired" && state !== "unavailable")` flipped the same probe to **`toastEverAppeared: 1`, text `"Your session expired. Sign in again to reconnect."`** A point-in-time count would have missed it (sonner self-dismisses at 4 s), which is why the probe latches every frame.
- **Margin measured, and it is larger than assumed.** Under that mutation `accessibility.spec.ts` still passed **15/15**: its assertions land ~300 ms after load, while the component is still in `loading` and the retry chain has ~7 s left to run. So the suite's green status rests on **two** silent branches, not one — `loading` covers the entire lifetime of the fast specs, `unavailable` covers any spec that idles past the retry window. Both are silent; neither renders a menu.
- **This story adds zero new IPC calls.** `AccountPromptDialog` (27.2, mounted in `__root.tsx` on every route) already calls `useAuthSession()`, and TanStack Query dedupes by `queryKey`, so `get_auth_session` was already firing on every route load before 27.3. AC 13's premise ("adding an always-mounted `invoke` … changes the IPC surface of every existing spec") was already true at 27.2; 27.3 only adds a second subscriber.
- `console.log` / `console.error` / `console.warn` / `console.debug` / `console.info`: **0 hits** across all three source files.

#### B. State decision table (AC 3, 4, 6, 13) — VERIFIED ROW BY ROW, all five states observed in a live browser

`deriveState` (`ProfileMenu.tsx:34-55`) is ordered `isLoading` → `isError` → `switch (status)` → `default`, and the switch matches the **exact** `status` strings. Measured, not inferred:

| State | Observed | Verdict |
|---|---|---|
| `isLoading` | `data-auth-state="loading"`, `aria-label="Loading account…"`, `disabled: true`, `pointer-events: none`, `User` glyph, no panel, no toast | ✅ |
| `{ status: "LoggedOut" }` | `logged-out`, `aria-label="Sign in"`, `LogIn`, `onClick → signIn.mutate()`, **no `DropdownMenu` wrapper at all** so no menu can open | ✅ |
| `{ status: "LoggedIn", … }` | `logged-in`, `aria-label="Account menu for a.very.long.address…@example-domain.test"`, `CircleUser`, click opens `role="menu"` popup | ✅ |
| `{ status: "SessionExpired" }` | `session-expired`, `aria-label="Session expired — sign in again"`, settled `color: rgb(131, 79, 6)` = `--caution-ink` `#834F06`, `LogIn`, `disabled: false`, panel count `0`, exactly 1 toast | ✅ |
| `isError` / unrecognised `status` | `unavailable`, `aria-label="Sign in"`, benign, panel `0`, toast `0`, no throw | ✅ |

- **Unrecognised future `status` cannot crash or open the panel.** The `default:` arm returns `unavailable`, and the panel is gated on `state === "logged-in" && account` where `account` is itself the narrowed `status === "LoggedIn"` payload — a `null` / `[]` / `{status:"Something"}` response can reach neither branch.
- `text-caution-ink` resolves correctly. An earlier sample read `rgb(125,119,110)`; that was a mid-flight `transition-colors` interpolation between `--ink-disabled` `#7B8798` and `--caution-ink` `#834F06` (consistent t≈0.28 on all three channels). Re-measured past the 150 ms window it settles at `rgb(131, 79, 6)` — the exact light-theme token, ≈6.8:1 against the `#FFFFFF` chrome, comfortably over the 3:1 non-text floor. `tailwind-merge` correctly dropped the `ghost` variant's `text-ink`, so the caution colour is not being overridden.
- **`isError`-before-data precedence: matches the story's literal requirement (AC 13) — see NON-BLOCKING #1** for the UX tradeoff.

#### C. AC 6 — the expiry toast fires exactly ONCE, verified under React StrictMode

`main.tsx:21` wraps the app in `React.StrictMode`, so effects are genuinely double-invoked in dev. A probe resolving `{ status: "SessionExpired" }` and counting every `[data-sonner-toast]` node ever inserted (cumulative `WeakSet` latch, not a point-in-time count) measured:

- **After mount: `total: 1`** — `"Your session expired. Sign in again to reconnect."` The `expiredNotifiedRef` survives StrictMode's mount → unmount → mount because `useRef`'s initial value is created once per instance; the second effect pass sees the latch already armed.
- **After two in-app route changes plus a click on the trigger: still `total: 1`.** `TopBar` lives in the `__root` layout so `ProfileMenu` re-renders without remounting; the effect body's `state !== "session-expired"` early-return is never taken, so the latch is never disarmed.
- **Refetch cannot re-toast.** The effect's dependency array is `[state, t]` — the *derived string*, not the query object. A refetch of an existing query leaves `isPending` false, so `isLoading` stays false and `state` stays `"session-expired"`; React skips the effect entirely on an unchanged dep, and even if `t`'s identity churned the ref guard blocks the second toast. `staleTime: Infinity` additionally prevents `refetchOnWindowFocus` from firing at all.
- Panel count `0` in this state, and `role="dialog"` count `0` — 27.2's `AccountPromptDialog` correctly stays shut on `SessionExpired`.
- Toast plumbing is correct: `import { toast } from "sonner"` only; the sole `<Toaster />` is `main.tsx:25` (`sonner@2.0.7` confirmed installed). **No second `Toaster` was mounted** — `grep` finds `Toaster` nowhere in this story's diff.

#### D. AC 4, 5 — panel shape, Base UI contract, and the missing-`name` case: ALL VERIFIED IN A LIVE BROWSER

- **`ls apps/desktop/src/routes/`** shows no `profile.tsx`; the panel is a `DropdownMenuContent` anchored to the trigger with `align="end"`, observed as `role="menu"` — not a route, not a page, not a centered modal.
- **The Base UI `Menu.Group` / `Menu.GroupLabel` question is settled twice over, and the dev's claim is correct.** Static: `@base-ui/react@1.4.0` `menu/group/MenuGroupContext.js` throws `'Base UI: MenuGroupRootContext is missing. Menu group parts must be used within <Menu.Group>.'` on an absent context, and `MenuGroupLabel.js` calls `useMenuGroupRootContext()` unconditionally — so omitting `DropdownMenuGroup` **would** have thrown the first time a signed-in user opened the panel. Runtime: the panel opened cleanly and reported `groupPresent: true`, `aria-labelledby="base-ui-_r_8_"` resolving to the element whose text is `"Signed in as"` with `role="presentation"`. Correct association, no throw, no fallback needed.
- **AC 5 is satisfied as a count-0, not an empty node.** Four runs against the real component: `name: "Nicolas Bazinet"` → `profile-menu-name` count **1**; `name: null` → count **0**; `name: ""` → count **0**; `name: "   "` (whitespace-only) → count **0**. `profile-menu-email` count is **1** in all four. This is exactly what Story 27.4's count-0 assertion needs.
- **Panel width gotcha handled.** Measured `243.2 px` — the `w-64` override beat the base `w-(--anchor-width) … min-w-32`, so the 53-character test address rendered in full with `title` set. Without the override it would have clamped to 128 px.
- **Identity rows are not menu items.** `menuItemCount: 1` (`["Sign out"]`) and `emailIsMenuItem: false`; roving focus and typeahead therefore cannot strand the keyboard on non-actionable text. On open, focus moves to the popup (`activeElement` = `profile-menu-panel`).
- **Cache ownership is clean.** `grep -E "queryKeys|useQueryClient|invalidateQueries|setQueryData|\.clear\(|invoke|@tauri-apps|listen"` over `ProfileMenu.tsx` → **0 hits.** `useSignOut()` (`hooks/useAuth.ts:50-58`) owns the `queryKeys.auth.session` invalidation, as AC 7 requires.
- **The panel closes even if sign-out fails.** `onClick` is `signOut.mutate(); setOpen(false);` — the close is unconditional and synchronous, so a rejected mutation cannot pin the panel open. Task 3's extra `onSuccess: () => setOpen(false)` was dropped as provably dead; the AC-relevant behaviour is unchanged.
- No `Avatar` or any other component was added to `packages/shared/src/ui/` (`packages/` shows no diff), and no asset was added to `public/` or `src/assets/`. Icons are `lucide-react` only.

#### E. AC 13 — the ⌘K trigger: proven unmoved by measurement, not by reading the diff

`TopBar.tsx` was temporarily reverted to `HEAD` and the header re-measured, then restored (SHA-256 verified). Search-button geometry is **byte-identical before and after the story** at all three widths:

| Viewport | search `x` | width | right | centerX | header centre | pre-story identical? |
|---|---|---|---|---|---|---|
| 1024 (`minWidth` in `tauri.conf.json`) | 368 | 480 | 848 | 608 | 608 | ✅ identical |
| 1280 (Playwright default) | 496 | 480 | 976 | 736 | 736 | ✅ identical |
| 1600 | 656 | 480 | 1136 | 896 | 896 | ✅ identical |

- **Still perfectly centred:** `centerX === headerCenter` at every width. `relative` cannot affect a flex container's layout of its in-flow children, and the new wrapper is `position: absolute`, hence out of flow — the measurements confirm the reasoning.
- **No overlap and no click interception at any supported width.** The trigger occupies `x 976→1004` at 1024 px, a **128 px gap** from the search field's right edge (`848`); it right-aligns at exactly `viewport − 20 px`, so `right-page-x` resolves as intended. `document.elementFromPoint` at the search button's right edge, over the `⌘K` `<kbd>`, and at its centre returns `topbar-search-trigger` / `KBD` / `SPAN` — the absolute wrapper is never the hit target. (Analytically, overlap would require a viewport under ~576 px; `minWidth` is 1024.)
- **Tokens are real, not silently dropped.** The built stylesheet contains `.right-page-x{right:var(--spacing-page-x)}` and `.text-caution-ink{color:var(--caution-ink)}`; `--spacing-page-x: 20px` (`tokens.css:267`) and `--caution-ink: #834F06` (`tokens.css:95`, `--color-caution-ink` at `:329`) both exist. This is the repo's first `right-page-x` usage, so the check mattered — Tailwind v4 does generate it from the `@theme` spacing namespace.
- **Tab order is correct and unchanged.** `skip-to-content` is index 0 in both the pre- and post-story documents; `topbar-search-trigger` is index **10** in both; `profile-menu-trigger` inserts at **11**, immediately after the search field and before the surface content. Nothing was pushed ahead of the skip link or the rail — consistent with `accessibility.spec.ts:123-136` passing in the full run.
- **The deleted comment was genuinely stale and nothing was lost.** It asserted *"this is one user, one machine, no login"* — a premise Epic 26/27 reverses; leaving it beside a profile glyph would have made the file contradict itself. The replacement comment explains **why** absolute positioning was chosen over a flex sibling (a WHY comment, not a restatement of the code), which is what `docs/project-context.md#Code Quality` asks for. `AppSidebar.tsx` and every other shared component are absent from `git status`.

#### F. Imports and boundaries — VERIFIED CLEAN, and stricter than the handoff claimed

- `ProfileMenu.tsx:1-16` is **exactly** the Task 2 allowlist and nothing else: `useEffect`/`useRef`/`useState`, `useTranslation`, `toast`, `CircleUser`/`LogIn`/`LogOut`/`User`, the 8 `@nixus/shared` primitives, `cn`, and the three `useAuth` hooks. **Correction to the handoff:** the file contains **no** `import type { AuthState }` — there is no import beyond the sanctioned list at all. `deriveState`'s third parameter inlines the union literal instead (see NON-BLOCKING #2).
- `grep -E "invoke|@tauri-apps|oauth2|[Cc]ognito|fetch\(|queryKeys|listen"` over `ProfileMenu.tsx` → **0 hits.** No token exchange, no IPC, no network from the webview.
- `grep -E "\bas any\b|@ts-ignore|@ts-expect-error"` (word-bounded) across all three source files → **0 hits.**
- Prior stories untouched by 27.3: `git diff` on `hooks/useAuth.ts`, `lib/types.ts`, `lib/constants.ts`, `routes/__root.tsx` contains **zero** lines matching `profile` or `topbar` (`__root.tsx`'s only diff is 27.2's `AccountPromptDialog` import and mount). `AccountPromptDialog.tsx` and `locales/__tests__/auth-i18n.test.ts` are unmodified. Nothing under `apps/desktop/src-tauri/` is attributable to this story.
- **No dependency added.** `apps/desktop/package.json`'s only diff is `@tauri-apps/plugin-deep-link` (Story 26.3's). `@testing-library/react` and `jest-axe` are absent from every manifest — and correctly so; no component render test was written.
- Version is `0.3.2` in `apps/desktop/package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- No file added under `routes/`, `packages/shared/src/ui/`, `public/`, `src/assets/`, `src-tauri/`, or `tests/`.

#### G. i18n (AC 11) — VERIFIED, including a mutation test of the parity suite

- All 7 keys present in **both** locales as **flat dotted strings**. Parsed with an order-preserving loader: `en.json` and `fr.json` each hold **1167** keys, **0** duplicates, **0** non-string values (so no nested `profile: { … }` object), and the `profile.*` block is in the story's specified order immediately after `topbar.searchAriaLabel`.
- **Insertions only, zero deletions:** `git diff --numstat` reports `14 0` for each locale (7 `profile.*` + 27.2's 7 `auth.*`). No pre-existing key was modified, moved, or removed.
- **27.2's `auth.*` block is intact and unmoved** — all 7 keys present in both locales in their original order, still positioned after `update.failed`. Not re-reviewed, only checked for disturbance; none found.
- Every value matches the story text verbatim in both languages. The French reads naturally and idiomatically: *Se connecter / Menu du compte pour {{email}} / Chargement du compte… / Connecté en tant que / Se déconnecter / Votre session a expiré. Reconnectez-vous. / Session expirée — se reconnecter*. Register and gender agreement are correct; `sessionExpired` compresses "Sign in again to reconnect" into the single imperative *Reconnectez-vous*, which is the more natural French and loses no meaning.
- **`profile.loading` verified at the byte level, not visually:** `en` = `4c…6e 74 e2 80 a6`, `fr` = `43…74 65 e2 80 a6` — `e2 80 a6` is U+2026 in both, and `"..."` appears in neither.
- `profile.accountMenu` carries `{{email}}` in both locales, and `ProfileMenu.tsx:104` passes it: `t("profile.accountMenu", { email: account.email })`. Confirmed rendered at runtime as `"Account menu for a.very.long.address…@example-domain.test"`.
- **No literal English in the JSX.** Both `aria-label` values route through `t()` (`:104`, `:177`); the only bare string literals in the file are `data-testid` / `data-auth-state` values and Tailwind classes, which correctly must not be translated.
- **The parity suite is load-bearing.** Deleting `"profile.signOut"` from `fr.json` produced **3 failures** — the required-key case, the cross-locale parity case, and the no-orphans case (`AssertionError: profile.signOut missing in fr.json`). `fr.json` restored; SHA-256 `b5ff079b…4813bf` matches the pre-review baseline. The file mirrors `budget-templates-i18n.test.ts`'s shape (same `Record<string, string>` cast, same `it.each` idiom, same ellipsis convention).

#### H. Gates and standards — ALL RE-RUN FROM SCRATCH, all green

| Gate | Result |
|---|---|
| `pnpm --filter @nixus/desktop exec tsc --noEmit` | **exit 0**, zero errors |
| `pnpm --filter @nixus/desktop test` | **141 passed / 9 files** — 125 pre-existing + 16 new, matching the claim exactly; `profile-i18n.test.ts` 16 tests |
| `pnpm --filter @nixus/desktop exec playwright test` | **331 passed / 2 failed / 333** — exact baseline match |
| `as any` / `@ts-ignore` / `@ts-expect-error` (word-bounded) | 0 real hits |
| Hex/rgb/hsl literals, inline `style={{…}}` | 0 hits — styling is tokens and shared-primitive classes only |
| Relative `../` imports | 0 hits — `@/` alias throughout |

**Selectors for Story 27.4 all exist and are spelled exactly as recorded**, confirmed by live DOM query, not by reading the source: `profile-menu-trigger` (single element in all five states, carrying `data-auth-state` with each of `loading` / `logged-out` / `logged-in` / `session-expired` / `unavailable` observed), `profile-menu-panel`, `profile-menu-email`, `profile-menu-name`, `profile-menu-sign-out`. One further datum 27.4 will want: with a `LoggedIn` stub the app is **not** `aria-hidden` and `role="dialog"` count is `0`, so the profile panel — unlike a `Dialog` — does not need the `AccountPromptDialog` suppression dance.

`docs/project-context.md` was consulted; its "no unit test framework in desktop", "no `__tests__/` directories", and `@nkbaz/*` scope claims are stale, and following the real setup (`vitest` + `src/locales/__tests__/` + `@nixus/*`) is **not** reported as a violation.

#### NON-BLOCKING findings

1. **`ProfileMenu.tsx:42-44` — a failed refetch discards a known-good session.** `isError` is tested before `session.data`, so a signed-in user whose background refetch fails drops from `logged-in` to `unavailable`: the `CircleUser` glyph becomes a `LogIn` glyph labelled "Sign in", and an open panel unmounts. This **is** the story's literal requirement (AC 13: "renders a safe neutral affordance … when the query errors"), so it is correct as specified, and exposure is small because `staleTime: Infinity` means the only refetch is a deliberate invalidation. Recorded as a UX tradeoff, not a defect. If a future story wants last-known-good behaviour, the fix is to move the `isError` test after the `switch` and let a present `data` win — but that would then need its own AC.
2. **`ProfileMenu.tsx:37` — the `status` union is duplicated instead of derived.** The parameter is typed `"LoggedOut" | "LoggedIn" | "SessionExpired" | undefined` rather than `AuthState["status"] | undefined`. Behaviour today is correct, but if `lib/types.ts` gains a fourth variant, `tsc` will not flag this file — the new state silently lands in `unavailable`. Fix: `import type { AuthState } from "@/lib/types"` and type the parameter `AuthState["status"] | undefined`. (This is the import the handoff believed was already present; adding it is a one-line, type-only change that makes the union self-maintaining.)
3. **`ProfileMenu.tsx:148-151` — sign-out failure is silent.** The panel closes unconditionally (correct per Task 3 and AC 7), but a rejected `sign_out` produces no toast and no visible change, and `useSignOut()` (27.1) has no `onError`. The trigger stays on the account glyph, so the UI does not lie — the user simply gets no feedback. No AC requires failure feedback here; worth a follow-up alongside 27.1's mutation, not a change to this file.
4. **`ProfileMenu.tsx:125-140` — the display name never reaches an accessible name.** The email and name rows are plain `<div>`s inside `role="group"` inside `role="menu"` — deliberately not `DropdownMenuItem`s, as the story mandates — so screen readers browsing the menu by role never focus them. The email is mitigated (the trigger's accessible name is "Account menu for {{email}}" and the group is labelled "Signed in as"); the name is not surfaced anywhere in the accessibility tree. Cheapest fix if desired: extend `profile.accountMenu` interpolation or add an `aria-label` to the group. Do not convert the rows to menu items — that reintroduces the roving-focus problem the current shape avoids.
5. **`ProfileMenu.tsx:175` — the `loading` trigger inherits the shared `Button`'s disabled chrome.** Native `disabled` activates `disabled:border-line disabled:bg-card` from `button.tsx`'s base CVA. Measured in the header: `background rgb(255,255,255)`, `border rgb(226,232,240)`, `pointer-events: none`. In the light theme `--card` equals `--chrome`, so the visible artefact is only a faint 1 px 28 px outline — subtle, not a jarring box; in dark, `--card #172033` on `--chrome #111A2B` is a slightly lighter chip. It persists ~7 s in every E2E spec (the retry chain) and only as long as `get_auth_session` takes in the real app. Assessed as **acceptable** — it is the design system's sanctioned disabled treatment and AC 2 only forbids showing the logged-in/logged-out appearance first, which it does not. If the orchestrator wants it invisible: add `disabled:border-transparent disabled:bg-transparent` to the trigger's `cn()`.
6. **`profile-i18n.test.ts:102-117` — cross-story coupling.** The final test asserts on 27.2's seven `auth.*` key names. The intent is sound (a clobbered neighbour would still parse and still pass every other assertion) and it is documented in a comment, but it means a legitimate rename in 27.2's namespace fails 27.3's suite. Acceptable as written; a looser guard (assert the `auth.` prefix count, not the individual names) would decouple them.

#### Outstanding manual work — correctly declared, not defects

The dev left Task 9's manual matrix (a)–(e) and the `logged-in` keyboard pass unchecked and enumerated them explicitly rather than fabricating results. That is the right call and is **not** counted against the story. Still genuinely outstanding, and each needs something this environment cannot provide:

- (a)–(d) a live Cognito Hosted UI round trip, a keyring entry hand-set to a past `expires_at`, and Wi-Fi disabled inside a running `tauri dev` window.
- (e) the French accessible names as read by an OS/devtools accessibility inspector, plus the sidebar language toggle.
- The `logged-in` panel's roving focus, `Escape`-to-close, and focus restoration — Base UI `Menu` behaviour rather than code added here, and Story 27.4's coverage once it has an auth mock.

This review closed part of that gap out-of-band: the panel was opened in a real Chromium with a stubbed `LoggedIn` payload, which confirmed the anchored panel renders, the long email is not truncated, focus enters the popup on open, the name row is absent for `null`/`""`/whitespace, and the `SessionExpired` toast fires exactly once. What remains unverified is the true Tauri-runtime and screen-reader behaviour.

#### Explicitly not reported as findings

Task 8's non-execution (orchestrator-overridden, and honestly documented in Completion Notes with the `AccountPromptDialog` focus-trap rationale — AC 13 is instead satisfied by the measured inert path); the 2 pre-existing Playwright failures at baseline `9b45411`; Vite's app-wide 500 kB chunk advisory; the pre-existing dirty planning docs; the clippy lint at `src-tauri/src/commands/backup.rs:106`; and the absence of `@testing-library/react` / `jest-axe` / an auth Playwright spec (27.4's deliverable). The `Status:` field and `sprint-status.yaml` were left untouched.

