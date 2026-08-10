---
baseline_commit: 9b45411e5d22d41705bd90eac8b78cf45e7c2238
---

# Story 27.2: Account Prompt Dialog with Continue Offline

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an existing user without an account,
I want a launch-time prompt offering to create an account or continue offline,
so that I learn an account now exists and may unlock future features, without losing access to anything today.

## Acceptance Criteria

1. **`LoggedOut` → dialog shown, built on the shared `Dialog` primitive.** Given the app launches and `useAuthSession()` resolves to `{ status: "LoggedOut" }`, when the app shell renders, then `apps/desktop/src/components/auth/AccountPromptDialog.tsx` is displayed, composed from the existing shared `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter` primitives imported from `@nixus/shared` — no new dialog, modal, overlay, backdrop, or portal component is written, and `DialogOverlay`/`DialogPortal` are not rendered by hand because `DialogContent` already wraps its children in both (FR2). [Source: epics-login.md#Story 27.2; architecture-login.md#Frontend Architecture; docs/project-context.md#8 Shared UI Components; packages/shared/src/ui/dialog.tsx:51-99]

1a. **Both `DialogTitle` and `DialogDescription` are rendered, and the dialog is test-addressable.** Given the dialog renders, then it renders **both** `DialogTitle` and `DialogDescription` — the primitive wires `aria-labelledby`/`aria-describedby` from exactly those two nodes, and omitting either ships an unlabelled modal; and `DialogContent` carries `data-testid="account-prompt-dialog"` with the two actions carrying `data-testid="create-account-button"` and `data-testid="continue-offline-button"`, following the established `<entity>-dialog` / `confirm-<action>-button` convention so Story 27.4's spec has stable selectors. [Source: packages/shared/src/ui/dialog.tsx:13-15; apps/desktop/src/components/accounts/AccountRow.tsx:191-218; apps/desktop/tests/expenses.spec.ts:715-721]

2. **`LoggedIn` → dialog not shown.** Given `useAuthSession()` resolves to `LoggedIn`, when the app shell renders, then the dialog is **not** displayed. [Source: epics-login.md#Story 27.2]

3. **Loading → no flash.** Given `useAuthSession()` is still loading, when the app shell renders, then the dialog does not flash open before the first resolution. [Source: epics-login.md#Story 27.2; architecture-login.md#Process Patterns "Loading state"]

4. **Exactly two actions, with non-gating copy, fully translated.** Given the dialog is displayed, when the user reads it, then it offers exactly two actions — "Create Account" and "Continue Offline"; and the copy states that no feature currently requires an account while signalling that future features (such as mobile notifications, photo sync, and community features) may; and every string resolves from an i18n key present in **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`, with no missing keys and no hardcoded English in the JSX. [Source: epics-login.md#Story 27.2, #Requirements Inventory "Inherited: all user-facing strings … English and French"; docs/project-context.md#i18n]

5. **"Create Account" → `useSignIn()`, neutral pending state, never blocks the app.** Given the user clicks "Create Account", when the action fires, then `useSignIn()` from `hooks/useAuth.ts` is called (which opens the Cognito Hosted UI in the system browser per Story 26.4) and the dialog shows a neutral pending state while the mutation is in flight and then closes on success — it never blocks the app, and it never calls `invoke` directly. [Source: epics-login.md#Story 27.2, #Story 27.1 (module boundary rule); architecture-login.md#Architectural Boundaries "Component Boundaries"]

6. **"Continue Offline" → session-only close, nothing persisted.** Given the user clicks "Continue Offline", when the action fires, then the dialog closes for the current app session only; and **no** dismissal flag is persisted — no new SQLite table, no migration, no settings row, no `localStorage`/`sessionStorage` key, no file in the app data directory, and no Rust command call of any kind. [Source: epics-login.md#Story 27.2; architecture-login.md#Frontend Architecture "no persisted dismissal flag, no new SQLite table", #Structure Patterns]

7. **Every-launch cadence.** Given the user chose "Continue Offline" and later relaunches the app while still having no account, when the app starts, then the dialog is shown again. [Source: epics-login.md#Story 27.2, #UX Design Requirements; architecture-login.md#Core Architectural Decisions "Popup display condition (every launch until an account exists)"]

8. **Zero gating, zero regression, zero network requirement (NFR1).** Given the user has dismissed the dialog with "Continue Offline", when they use the app, then every existing feature — budget, expenses, accounts, net worth, AI, maintenance — behaves exactly as before, with no gating, no degraded state, and no network requirement. [Source: epics-login.md#Story 27.2 (NFR1); architecture-login.md#NFR1]

9. **Copy and layout flagged for UX review; cadence and structure are not.** Given no UX specification covers this dialog, when it is implemented, then the exact copy and layout are flagged for UX review in the Completion Notes, noting that the every-launch-until-an-account-exists cadence and the two-action structure are fixed architectural decisions and **not** open for redesign. [Source: epics-login.md#Story 27.2, #UX Design Requirements; architecture-login.md#Core Architectural Decisions]

10. **Render guard is a strict positive match — the 23 existing Playwright specs still pass.** *(Derived — closes the highest-severity regression risk in this story; see Dev Notes "The regression that will happen if you get the render guard wrong".)* Given `useAuthSession()` is in any state other than a successfully-resolved `{ status: "LoggedOut" }` — loading, `isError`, `LoggedIn`, or `SessionExpired` — when the app shell renders, then the dialog returns `null` and mounts no overlay; and `pnpm --filter @nixus/desktop exec playwright test` passes with no new failures, because all 23 existing specs mock `__TAURI_INTERNALS__.invoke` with `default: return Promise.reject("Unknown command: …")` and therefore put `get_auth_session` into the query **error** state. [Source: apps/desktop/tests/budget.spec.ts#setupTauriMock; apps/desktop/tests/accessibility.spec.ts; epics-login.md#Story 27.2 (AC 2, AC 3)]

11. **`SessionExpired` → dialog not shown.** *(Derived — `epics-login.md` specifies only the `LoggedOut` and `LoggedIn` branches, leaving the third `AuthState` variant unspecified.)* Given `useAuthSession()` resolves to `{ status: "SessionExpired" }`, when the app shell renders, then the dialog is **not** displayed — the user already has an account, so inviting them to create one is wrong; communicating the expired session is Story 27.3's deliverable and must not be duplicated here. [Source: epics-login.md#Story 27.1 (`AuthState` union), #Story 27.3 (`SessionExpired` messaging is 27.3's AC)]

12. **The dialog never stacks on top of first-run onboarding.** *(Derived from AC 8 — a modal `Dialog` aria-hides the whole app, so opening it over `/onboarding` makes an existing feature unreachable, which AC 8 forbids.)* Given a brand-new install whose `beforeLoad` redirects to `/onboarding`, when the shell renders that route, then the dialog is suppressed and first-run onboarding is fully completable; and the prompt appears normally on every other route. [Source: apps/desktop/src/routes/index.tsx:35-42; apps/desktop/tests/budget.spec.ts#setupTauriMock "a truthy updater response opens a modal Dialog that aria-hides the whole app"; epics-login.md#Story 27.2 (NFR1 AC)]

13. **i18n parity is enforced by a test, not by review.** *(Derived — makes AC 4's "no missing keys" mechanically verifiable, following the three existing locale specs.)* Given the new `auth.*` keys, when `pnpm --filter @nixus/desktop test` runs, then a new `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` asserts every required key exists and is truthy in both locales, asserts no `auth.`-prefixed key exists in one locale but not the other, and asserts pending copy uses the single-character ellipsis `\u2026` rather than `...`. [Source: apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts; apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts]

14. **Zero new dependencies, zero new assets, no Rust or backend change.** Given the existing dependency graph, when this story completes, then `apps/desktop/package.json` gains no dependency, no static asset is added, and nothing under `apps/desktop/src-tauri/` is modified — this story is frontend-only. [Source: architecture-login.md#Delta to Existing Project Tree, #File Organization Patterns "No new static assets"; epics-login.md#Epic List "Why two epics"]

15. **A failed sign-in launch is surfaced, not swallowed.** *(Derived — `start_login` returns `Result<(), AppError>` and can fail, e.g. the opener fails; AC 5's "never blocks" must not become a silently dead button.)* Given "Create Account" is clicked and the `useSignIn()` mutation rejects, when it settles, then the dialog stays open, the pending state clears, and the failure is surfaced through a translated `toast.error(...)` using the existing `sonner` pattern — the app keeps working and no unhandled promise rejection is logged. [Source: epics-login.md#Story 26.4 (`start_login` returns `Result<(), AppError>`); apps/desktop/src/components/shared/UpdateChecker.tsx:75]

16. **No `TopBar`, sidebar, or route change.** *(Derived — protects the Story 27.3 / Story 27.2 file boundary and the "sidebar untouched" decision.)* Given this story's scope, when it completes, then `components/auth/ProfileMenu.tsx` is **not** created, `components/shared/TopBar.tsx` and `components/shared/AppSidebar.tsx` are unmodified, the 9-item sidebar gains no entry, and no file is added under `apps/desktop/src/routes/` — `routes/__root.tsx` is modified only to mount the dialog. [Source: epics-login.md#Story 27.3; architecture-login.md#Delta to Existing Project Tree, #UX Design Requirements "existing 9-item sidebar is untouched"]

17. **Focus is not orphaned on dismissal — this dialog has no trigger element.** *(Derived — the primitive's `finalFocus` default returns focus to the element that opened the dialog, and an auto-opening launch dialog has none.)* Given the dialog is dismissed by any affordance (either button, ESC, or backdrop), when it unmounts, then keyboard focus lands on a real, reachable element rather than being lost to a detached node, the rest of the app is no longer `aria-hidden`, and tabbing continues to work — verified manually. If focus is orphaned, pass `finalFocus` on `DialogContent` targeting the shell's main column (`#surface-main`, already `tabIndex={-1}` for exactly this purpose) rather than removing the focus trap. [Source: packages/shared/src/ui/dialog.tsx:17-18 (explicit warning against overriding `finalFocus` without an equivalent target); apps/desktop/src/routes/__root.tsx:35,127-129; apps/desktop/tests/accessibility.spec.ts]

## Tasks / Subtasks

- [x] **Task 1: Verify the Story 27.1 hook contract exists before writing any component code (AC: 1, 2, 3, 5, 11)**
  - [x] Confirm `apps/desktop/src/hooks/useAuth.ts` exists and exports `useAuthSession()` (TanStack Query, keyed by `queryKeys.auth.session`) and `useSignIn()` (mutation invoking `start_login`).
  - [x] Confirm `apps/desktop/src/lib/types.ts` exports `AuthState` as the discriminated union `{ status: "LoggedOut" } | { status: "LoggedIn"; email: string; name: string | null } | { status: "SessionExpired" }`.
  - [x] Confirm `apps/desktop/src/lib/constants.ts` has `queryKeys.auth.session`.
  - [x] Note the contract Story 27.1 fixes, so you do not duplicate or fight it: `useSignIn()` is a **bare mutation** — it has no `onSuccess`, invalidates nothing, and contains no `try`/`catch`, no `toast`, no `t()`, and no user-facing string. **Story 27.2 owns all copy and all error presentation for the sign-in launch** — that is why AC 15 is this story's job and not the hook's. `useAuthSession()` is a plain `useQuery` with `staleTime: Infinity` and no `onError`/`throwOnError`, so rejections land in `isError`/`error` and remain stable for the app session.
  - [x] If `useAuth.ts` is absent, **stop and report blocked**. Do not create it, do not stub it, and do not call `invoke("get_auth_session")` or `invoke("start_login")` from the component — Story 27.1 owns that module and `useAuth.ts` is the only frontend module permitted to invoke auth commands.

- [x] **Task 2: Create `apps/desktop/src/components/auth/AccountPromptDialog.tsx` (AC: 1, 4, 10, 11, 12)**
  - [x] New directory `apps/desktop/src/components/auth/`; new file `AccountPromptDialog.tsx` exporting `export function AccountPromptDialog()` — **no props** (it reads its own state, mirroring `UpdateChecker`).
  - [x] Import the primitives from the shared package root exactly as `UpdateChecker.tsx:5-13` does: `import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button } from "@nixus/shared";`. Do **not** import from `@nkbaz/shared` or `@nkbaz/shared/ui` (see Dev Notes "Two stale facts in `docs/project-context.md`").
  - [x] Declare all hooks before any early return: `const { t } = useTranslation();`, `const session = useAuthSession();`, `const signIn = useSignIn();`, `const [dismissed, setDismissed] = useState(false);`, and `const pathname = useRouterState({ select: (s) => s.location.pathname });` (import `useRouterState` from `@tanstack/react-router`, same as `__root.tsx:6`).
  - [x] Compute the render guard as a **strict positive match** and early-return `null`:
        `if (!session.isSuccess || session.data?.status !== "LoggedOut" || dismissed || pathname === "/onboarding") return null;`
  - [x] Render `<Dialog open onOpenChange={() => setDismissed(true)}>` wrapping `<DialogContent showCloseButton={false} data-testid="account-prompt-dialog">`, then `<DialogHeader>` with `<DialogTitle>{t("auth.promptTitle")}</DialogTitle>` and `<DialogDescription>{t("auth.promptBody")}</DialogDescription>`, a paragraph for `t("auth.promptFutureFeatures")`, and a `<DialogFooter>`.
  - [x] `DialogTitle` and `DialogDescription` are both mandatory — the primitive derives `aria-labelledby`/`aria-describedby` from exactly those nodes (AC 1a). Do not replace `DialogDescription` with a plain `<p>`.
  - [x] Footer holds exactly two buttons in this order, matching the `UpdateChecker.tsx:110-117` secondary-then-primary convention: `<Button variant="outline" onClick={() => setDismissed(true)} data-testid="continue-offline-button">{t("auth.continueOffline")}</Button>` then the primary `<Button data-testid="create-account-button">` for "Create Account". Leave `DialogFooter`'s own `showCloseButton` at its `false` default.
  - [x] Use the default `<Button>` variant for the primary action — **not** `variant="destructive"`. Every other `Dialog` in this app is a delete confirm and uses `destructive`; this one is an invitation.
  - [x] `DialogContent` has no `size` prop; its width is `sm:max-w-sm`. This dialog carries more copy than a delete confirm, so if the text is cramped, widen it with a className override (e.g. `className="sm:max-w-md"`) — `cn()` merges via `tailwind-merge`. Note the chosen width in the AC 9 UX-review flag.
  - [x] Do not add a third visible action, a "don't show again" checkbox, a link, or a close "X" — AC 4 says exactly two actions.

- [x] **Task 3: Wire "Continue Offline" as session-only, persistence-free dismissal (AC: 6, 7)**
  - [x] Dismissal is the component's `useState` boolean and nothing else. The `__root.tsx` shell persists across navigation (`__root.tsx:37`), so this survives route changes and is discarded on app relaunch — which is exactly the every-launch cadence.
  - [x] Route the ESC-key / backdrop path (`onOpenChange`) to the same `setDismissed(true)` handler so keyboard dismissal has identical semantics. Both paths are enabled by default (`modal` defaults to `true`, `disablePointerDismissal` defaults to `false`) — do not disable either. The signature is `(open: boolean, eventDetails) => void`, but ignore the argument as `UpdateChecker.tsx:83` does: the dialog is only mounted when it should be open, so any `onOpenChange` fire is a close request.
  - [x] Do not use `onClose` — `Dialog` has no such prop. (`SlideOver` does, which is a common mix-up in this codebase.)
  - [x] Verify by inspection that the file contains no `invoke(`, no `localStorage`, no `sessionStorage`, no `document.cookie`, and no mutation call on this path.

- [x] **Task 4: Wire "Create Account" to `useSignIn()` with a pending state and error toast (AC: 5, 15)**
  - [x] Story 27.1 specifies that callers drive `useSignIn()` from their own handler, since the hook carries no callbacks and no copy. Use `mutateAsync` in an `async` click handler:
        `try { await signIn.mutateAsync(); setDismissed(true); } catch { toast.error(t("auth.signInFailed")); }`
        (`signIn.mutate(undefined, { onSuccess, onError })` is an acceptable equivalent — do not do both.)
  - [x] Import `toast` from `"sonner"`, matching `UpdateChecker.tsx:14`. The `catch` is mandatory: without it, `mutateAsync`'s rejection becomes an unhandled promise rejection (AC 15).
  - [x] While `signIn.isPending`, set `disabled` on **both** footer buttons and swap the primary label to `t("auth.openingBrowser")`.
  - [x] Closing on success (not on click) is what makes the pending state observable and satisfies AC 5. It also makes `dismissed` sticky for the rest of the app session, which is why a later sign-out (Story 27.3) does not pop this prompt back up mid-session — that is intended, not a bug to fix.
  - [x] Do not `await` the browser round-trip or add a timeout; `start_login` resolves as soon as the system browser is opened. Do not invalidate `queryKeys.auth.session` here either — Story 27.1 deliberately omits that, because the session is still `LoggedOut` at this moment and the `auth:callback-received` listener is what reflects a completed sign-in.

- [x] **Task 5: Add the seven `auth.*` keys to both locale files (AC: 4, 13)**
  - [x] Edit `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`. These are **flat** JSON objects with dotted string keys (e.g. `"settings.templateExportTitle": "…"`) — do **not** introduce a nested `auth: { … }` object; the locale tests read them as `Record<string, string>`.
  - [x] Add, in both files: `auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`, `auth.createAccount`, `auth.continueOffline`, `auth.openingBrowser`, `auth.signInFailed`.
  - [x] `auth.promptBody` must state that nothing in the app requires an account today. `auth.promptFutureFeatures` must name mobile notifications, photo sync, and community features as *possible future* requirements (AC 4).
  - [x] `auth.openingBrowser` must end with the single-character ellipsis `…` (U+2026), never `...` — enforced by the Task 6 test and by the existing convention in `budget-templates-i18n.test.ts:85-96`.
  - [x] Write real French, not English placeholders or machine-mangled strings. Keep both files' insertion points adjacent to related keys so the diff is reviewable.

- [x] **Task 6: Add `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` (AC: 13)**
  - [x] Copy the structure of `budget-templates-i18n.test.ts`: `import enLocale from "../en.json"; import frLocale from "../fr.json";` cast to `Record<string, string>`.
  - [x] `it.each(REQUIRED_KEYS)` asserting each of the seven keys is truthy in both locales, with the same `` `${key} missing in en.json` `` message style.
  - [x] A parity test: no key starting with `auth.` exists in one locale and not the other, plus `expect(enKeys.length).toBeGreaterThan(0)` so the test cannot pass vacuously.
  - [x] An ellipsis test for `auth.openingBrowser`: `not.toContain("...")` and `toContain("\u2026")`.
  - [x] A declared-coverage test asserting the set of shipped `auth.`-prefixed keys equals `REQUIRED_KEYS`, so an orphaned or undeclared key fails the build.

- [x] **Task 7: Mount the dialog in `routes/__root.tsx` (AC: 1, 12, 16)**
  - [x] Add `import { AccountPromptDialog } from "../components/auth/AccountPromptDialog";` alongside the existing sibling imports (`__root.tsx:8-13`), matching their relative-path style rather than switching to `@/`.
  - [x] Render `<AccountPromptDialog />` as a self-closing sibling next to `<UpdateChecker />` and `<RecurringApplyListener />` (`__root.tsx:151-153`) — inside `ValuesVisibilityProvider`, outside `<main>`, so it is present on every route and inside the router context that `useRouterState` needs.
  - [x] Change nothing else in `__root.tsx`. Do not touch `TopBar`, `AppSidebar`, `DestinationNav`, or the focus-management logic.

- [x] **Task 8: Verify and close out (AC: all)**
  - [x] `pnpm --filter @nixus/desktop build` (runs `tsc && vite build`) — zero TypeScript errors and zero warnings. `noUnusedLocals`/`noUnusedParameters` are on, so an unused import fails the build.
  - [x] `pnpm --filter @nixus/desktop test` — the new `auth-i18n.test.ts` passes and the three existing locale specs still pass.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — **full suite**, compared against a pre-change baseline run. Any new failure means the render guard is wrong (AC 10). Do not "fix" a failing spec by adding a `get_auth_session` mock to it; Story 27.4 owns auth E2E.
  - [ ] Manual, `pnpm --filter @nixus/desktop tauri dev` with no `nixus-auth` keyring entry present: the dialog appears once the session query resolves, with no visible flash beforehand; "Continue Offline" closes it; navigating across several destinations does not reopen it; relaunching the app shows it again.
  - [ ] Manual: with the dialog dismissed, exercise budget, expenses, accounts, net worth, and maintenance and confirm nothing is gated or degraded (AC 8). Confirm no `nixus-auth`-related row, file, or `localStorage` key was created (AC 6) — check devtools Application → Local Storage is untouched.
  - [ ] Manual: switch the app language to French and confirm every string in the dialog renders translated, with no raw `auth.*` key and no English fallback visible (AC 4).
  - [ ] Manual: click "Create Account" and confirm the system browser opens, the primary button showed its pending label, and the dialog closed on success. With a `LoggedIn` session present, confirm the dialog never appears (AC 2).
  - [ ] Manual: on a database that still needs onboarding, confirm the app lands on `/onboarding` with **no** dialog over it and that onboarding completes (AC 12).
  - [ ] Keyboard/a11y pass: the dialog is reachable and dismissable with the keyboard, ESC closes it with the same session-only semantics, and after dismissal focus sits on a real element and the shell is no longer `aria-hidden` (AC 17). Confirm both `data-testid`s resolve in devtools so Story 27.4 has selectors to target.
  - [x] `git status` shows changes limited to: one new component, one new test, `en.json`, `fr.json`, `__root.tsx`. Nothing under `src-tauri/`, no `package.json` diff, no new asset (AC 14, 16).
  - [x] Record the AC 9 UX-review flag in Completion Notes: copy wording, dialog layout, and the `showCloseButton={false}` choice are open for UX/product review; the every-launch cadence and the two-action structure are not.

## Dev Notes

### Scope boundary

Frontend-only, five files, one of them new-directory. This story renders the FR2 surface and nothing else. It does **not** create `hooks/useAuth.ts` (Story 27.1), does **not** create `ProfileMenu.tsx` or touch the header (Story 27.3), and does **not** write a Playwright spec (Story 27.4 owns all auth E2E, including the "Continue Offline then use the app" assertion). Nothing under `src-tauri/` changes — Epic 26 is finished and its IPC contract is consumed, not modified. [Source: epics-login.md#Epic List "Why two epics", #Story 27.4; architecture-login.md#Delta to Existing Project Tree]

This is the **first** auth-related UI in the app: there is no `AccountPrompt`, `useAuthSession`, sign-in, or "Continue Offline" code anywhere in `apps/desktop/src` today, so there is no prior auth art to extend — only the generic patterns cited below. Relatedly, `components/shared/TopBar.tsx:13` still carries the now-outdated comment *"No account avatar: this is one user, one machine, no login…"*. Leave it alone; Story 27.3 owns `TopBar` and that comment.

### Dependency on Story 27.1

Story 27.1 (`27-1-frontend-auth-session-hook-and-query-key.md`) owns the hook module this story consumes. Its contract, which you must consume as-is rather than reshape:

| From Story 27.1 | Exact shape this story relies on |
|---|---|
| `hooks/useAuth.ts` → `useAuthSession()` | Plain `useQuery` invoking `get_auth_session` under `queryKeys.auth.session` (`["auth", "session"]`), `staleTime: Infinity`, no `onError`/`throwOnError` — so a rejection lands in `isError`/`error` and the resolved value is stable for the app session |
| `hooks/useAuth.ts` → `useSignIn()` | **Bare** mutation invoking `start_login`; no `onSuccess`, invalidates nothing, and contains no `try`/`catch`, `toast`, `t()`, or user-facing string — callers use `mutateAsync` in their own handler or read `mutation.error` |
| `hooks/useAuth.ts` → `auth:callback-received` listener | Registered inside `useAuth.ts`; invalidates `queryKeys.auth.session` when a browser sign-in completes, and unsubscribes on unmount. This story registers **no** listener of its own |
| `lib/types.ts` → `AuthState` | `{ status: "LoggedOut" } \| { status: "LoggedIn"; email: string; name: string \| null } \| { status: "SessionExpired" }` |
| `lib/constants.ts` → `queryKeys.auth.session` | `["auth", "session"]` |

Two direct consequences for this story: **all** sign-in copy and error presentation belong here (hence AC 15), and this story must not add an invalidation, a listener, or a `setQueryData` call — Story 27.1 deliberately omits invalidation on `start_login` because the session is still `LoggedOut` at that moment.

**If `useAuth.ts` is not merged, this story is blocked — report it rather than stubbing.** Creating a local `useAuthSession`, calling `invoke("get_auth_session")` from the component, or hardcoding `["auth", "session"]` each violate a boundary that is explicitly enforced in review (Story 27.1 ships a `grep` check for the last one). [Source: 27-1-frontend-auth-session-hook-and-query-key.md; epics-login.md#Story 27.1; architecture-login.md#Enforcement Guidelines, #Architectural Boundaries]

### The regression that will happen if you get the render guard wrong

This is the single most likely defect in this story, and it fails 20+ tests at once.

All 23 Playwright specs run against the **plain Vite dev server** (`playwright.config.ts` → `webServer.command: 'pnpm run dev'`, `baseURL: http://localhost:1420`), not the Tauri runtime. Each spec stubs `window.__TAURI_INTERNALS__.invoke` with a hand-written command switch whose fallback is:

```ts
default:
  return Promise.reject(`Unknown command: ${cmd}`);
```

No spec mocks `get_auth_session`, so in every existing spec `useAuthSession()` lands in **`isError`**, with `data === undefined`. Consequently:

- ✅ `if (!session.isSuccess || session.data?.status !== "LoggedOut" || …) return null;` → renders nothing → all specs unaffected.
- ❌ `if (session.data?.status === "LoggedIn") return null;` → renders the dialog in all 23 specs.
- ❌ `if (session.isLoading) return null;` (then show otherwise) → renders the dialog in all 23 specs.

`budget.spec.ts` already documents why the failure mode is catastrophic rather than cosmetic: *"Plugin commands (updater, etc.) must resolve null: a truthy updater response opens a modal Dialog that aria-hides the whole app."* `accessibility.spec.ts` records the same hazard from the other side — an always-open `Dialog` engages Base UI's focus trap, which sets `aria-hidden="true"` on the rest of the app and silently breaks unrelated `getByRole` queries unless the Tauri mock keeps the dialog shut. A modal `Dialog` therefore makes every `getByTestId` / `getByRole` query in the suite fail. Treat the full-suite Playwright run in Task 8 as a hard gate, and diff it against a baseline captured **before** your change. [Source: apps/desktop/playwright.config.ts; apps/desktop/tests/budget.spec.ts; apps/desktop/tests/accessibility.spec.ts]

The same strict-positive guard is also what satisfies AC 3 (no flash before first resolution) and AC 11 (`SessionExpired` shows nothing) — one condition, four ACs. Do not decompose it into separate branches.

### Two stale facts in `docs/project-context.md` (verified against the working tree)

`docs/project-context.md` is dated 2026-05-18 and predates a package rename. **The code wins.** Both of these will silently waste time or break the build if followed as written:

1. **Package scope is `@nixus/…`, not `@nkbaz/…`.** `packages/shared/package.json` declares `"name": "@nixus/shared"` and `apps/desktop/package.json` declares `"name": "@nixus/desktop"`. So: import from `@nixus/shared`, and every command is `pnpm --filter @nixus/desktop …`. The doc's `@nkbaz/shared/ui` / `@nkbaz/desktop` strings, and `epics-login.md`'s and `architecture-login.md`'s `@nkbaz/shared/ui` references, all resolve to the same shared package — the intent is right, the specifier is not.
2. **A `./ui` subpath export does exist**, but the established desktop convention is the package root: `UpdateChecker.tsx`, `routes/index.tsx`, and `__root.tsx` all import `Dialog`, `Button`, `Card`, `focusRing` from `"@nixus/shared"`. Follow the root-import convention; do not introduce a second style.

A third stale fact matters for Task 6: the doc says *"No unit test framework in desktop — all testing is Playwright E2E"* and *"No `__tests__/` directories"*. Both are out of date for the desktop app, which has `vitest.config.ts` (`environment: "jsdom"`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`), a `"test": "vitest run"` script, and six test files under `src/**/__tests__/`. `epics-login.md`'s "no frontend unit tests — Playwright E2E only" is stale in the same way. [Source: packages/shared/package.json; apps/desktop/package.json; apps/desktop/vitest.config.ts; apps/desktop/src/locales/__tests__/]

### The `Dialog` primitive's own usage contract — read this before "correcting" the choice

`packages/shared/src/ui/dialog.tsx:10-11` carries a design comment that looks like it forbids this story:

> *"Destructive confirms only — delete account / asset / vehicle. Modal-heavy workflows are a named anti-pattern; create and edit belong in a SlideOver, and a recoverable error belongs inline."*

**Use `Dialog` anyway. Do not substitute `SlideOver`.** Three reasons, in order of authority:

1. `architecture-login.md#Frontend Architecture` names the primitive explicitly: *"`<AccountPromptDialog>` built on the existing shared `Dialog` primitive"*, and `epics-login.md#Story 27.2` makes it AC 1. That is a recorded architectural decision.
2. `UpdateChecker.tsx` is already a non-destructive, informational, auto-opening `Dialog` — so the "destructive confirms only" line describes the *dominant* case, not an absolute rule, and this story's precedent is that component rather than the delete confirms.
3. The comment's actual target is **create/edit form workflows**, which is what `SlideOver` exists for (`AddScheduleTaskDialog.tsx` and `EditIntervalDialog.tsx` are named `*Dialog` but use `SlideOver`). This story presents a decision, not a form.

Consequences of the delete-confirm dominance that you must *not* copy blindly:

- Existing dialogs use `variant="destructive"` for the primary button (`DangerZone.tsx`, `AccountRow.tsx`, `ExpenseList.tsx`). Use the **default** `Button` variant here — "Create Account" is an invitation, not a destruction.
- Existing dialogs reuse `common.cancel` / `common.delete`. This story's labels are feature-specific, so they belong under `auth.*`.
- `DialogContent` has no `size` prop; the single width is `w-full max-w-[calc(100%-2rem)] sm:max-w-sm`. Widen via `className` if needed; do not add a variant to the shared primitive.

Also load-bearing, from the same file:

- `DialogContent` internally renders `DialogPortal` + `DialogOverlay` + the Base UI `Popup`. Never render the overlay or portal yourself.
- `dialog.tsx:13-15` requires **both** `DialogTitle` and `DialogDescription`; they are what supply `aria-labelledby` / `aria-describedby`.
- `dialog.tsx:17-18` warns against overriding `finalFocus` without an equivalent target. Its default returns focus to the element that opened the dialog — and this dialog has **no trigger**, which is why AC 17 exists and why `#surface-main` (already `tabIndex={-1}`) is the sanctioned fallback target.
- `Dialog`'s controlled props are `open` and `onOpenChange`. There is no `onClose` and no `isOpen`. (`SlideOver` *does* take `onClose` — do not cross the two.)

[Source: packages/shared/src/ui/dialog.tsx:10-18,51-99,101-108; apps/desktop/src/components/shared/UpdateChecker.tsx; apps/desktop/src/components/settings/DangerZone.tsx:181-239; apps/desktop/src/components/accounts/AccountRow.tsx:191-218; apps/desktop/src/components/maintenance/AddScheduleTaskDialog.tsx]

### Copy this exact pattern: `UpdateChecker.tsx`

`apps/desktop/src/components/shared/UpdateChecker.tsx` is the closest existing analog — a propless, shell-mounted, launch-time modal that gates its own rendering. Mirror it rather than inventing a shape:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@nixus/shared";
import { Button } from "@nixus/shared";
import { toast } from "sonner";

export function UpdateChecker() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("idle");
  // …
  if (stage === "idle" || !update) return null;      // ← self-gating early return

  return (
    <Dialog open onOpenChange={() => stage === "available" && setStage("idle")}>
      <DialogContent showCloseButton={stage === "available"}>
        <DialogHeader>
          <DialogTitle>{/* t(...) */}</DialogTitle>
          <DialogDescription>{/* t(...) */}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setStage("idle")}>{t("update.notNow")}</Button>
          <Button onClick={handleUpdate}>{t("update.updateRestart")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

What to carry over verbatim: `<Dialog open onOpenChange={…}>` (the `open` prop is passed bare, because the component early-returns instead of rendering a closed dialog); `DialogContent`'s `showCloseButton` prop; secondary button as `variant="outline"` placed *before* the default-variant primary in `DialogFooter`; `toast.error(t(...))` from `sonner` for failures; `useTranslation()` with **no namespace argument**. [Source: apps/desktop/src/components/shared/UpdateChecker.tsx:1-121]

Set `showCloseButton={false}` here so the two footer buttons are the only visible actions (AC 4). ESC and backdrop dismissal must still work for accessibility, routed through `onOpenChange` to the identical session-only handler — dismissal semantics are the same whichever affordance the user reaches for, and nothing is persisted either way. Flag the close-button choice in the AC 9 UX note.

### i18n: flat dotted keys, both locales, single-character ellipsis

`apps/desktop/src/locales/en.json` and `fr.json` are **flat** maps of dotted string keys — the locale tests type them as `Record<string, string>` and index them directly (`en["settings.templateExportTitle"]`). Add the seven `auth.*` keys as top-level entries in both files. Do not nest.

| Key | Purpose |
|---|---|
| `auth.promptTitle` | Dialog title |
| `auth.promptBody` | States that no feature requires an account today (AC 4) |
| `auth.promptFutureFeatures` | Names mobile notifications, photo sync, community features as *possible future* requirements (AC 4) |
| `auth.createAccount` | Primary action label |
| `auth.continueOffline` | Secondary action label |
| `auth.openingBrowser` | Pending label while `useSignIn()` is in flight — must end in `…` (U+2026) |
| `auth.signInFailed` | `toast.error` copy when the mutation rejects (AC 15) |

The ellipsis rule is a real, tested convention, not a style preference: `budget-templates-i18n.test.ts:85-96` asserts pending copy contains `\u2026` and does not contain `...`, with the note *"A mixed convention is invisible in review and permanent once shipped."*

**"Account" is already an overloaded word in this app — keep the namespaces apart.** The locale files ship ~40 `accounts.*` keys (`accounts.addAccount` = "Add an account", `accounts.editAccount`, `accounts.nameRequired` = "Account name is required", `nav.accounts`, `dashboard.goToAccounts`) and every one of them means a **bank or investment account**, not a user identity. Do not reuse, extend, or grep-and-copy any `accounts.*` key for this dialog, and do not add a user-identity string under that prefix. The `auth.*` prefix is currently unused in both locale files — it is yours, and keeping it clean is what makes AC 13's declared-coverage assertion meaningful.

The `Toaster` is already mounted once, in `apps/desktop/src/main.tsx:25` (imported from `@nixus/shared`), with `sonner ^2.0.7` as a direct dependency — so `toast.error(...)` works out of the box. Do not mount a second `Toaster`.

[Source: apps/desktop/src/locales/en.json, fr.json; apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts; apps/desktop/src/main.tsx:7,25; apps/desktop/package.json]

### Known modal interactions

- **`/onboarding` (must handle — AC 12).** `routes/index.tsx` `beforeLoad` calls `fetchOnboardingStatus()` and `throw redirect({ to: "/onboarding" })` when `needs_onboarding` is true, and `__root.tsx` renders the shell on that route too. An un-suppressed modal there aria-hides onboarding and bricks first run — which AC 8 forbids. Suppress via the router pathname (`useRouterState`, already the in-file idiom at `__root.tsx:85-86`) rather than adding a second async dependency; `useOnboardingStatus()` exists but introduces a race and falls back to `needs_onboarding: false` on error.
- **`UpdateChecker` (accept, do not engineer around).** Both dialogs can open on the same launch, since `check()` resolves asynchronously. Do not build a modal queue, a context, or a z-index coordinator — that is scope creep for a rare, self-clearing overlap where both dialogs are dismissable. Just confirm in Task 8 that dismissing both leaves the app usable and not `aria-hidden`.

### Anti-patterns for this story (do not do these)

- Writing a new dialog/modal/overlay/backdrop/portal component, or copying one into `components/auth/` — `Dialog` already exists in `@nixus/shared`, and `DialogContent` renders the portal and overlay itself.
- Swapping `Dialog` for `SlideOver` because of the "destructive confirms only" comment in `dialog.tsx` — see "The `Dialog` primitive's own usage contract" above.
- Using `variant="destructive"` for "Create Account", or reusing `common.cancel` for "Continue Offline".
- Using `onClose`, `isOpen`, or `setOpen` prop names — `Dialog` takes `open` + `onOpenChange`.
- Omitting `DialogDescription` (or replacing it with a plain `<p>`) — it supplies `aria-describedby`.
- Disabling the focus trap (`modal={false}`) or backdrop dismissal to "fix" a focus problem — target `#surface-main` with `finalFocus` instead (AC 17).
- Adding a `size` prop or a new width variant to the shared `Dialog` primitive.
- Importing from `@nkbaz/shared` or `@nkbaz/shared/ui` (wrong package name) — use `@nixus/shared`.
- Calling `invoke(...)` for `get_auth_session` or `start_login` from the component, or hardcoding `["auth", "session"]`.
- Persisting dismissal *anywhere*: `localStorage`, `sessionStorage`, a settings row, a migration, a new table, a Rust command, a cookie, or a module-level `let`/`static` that would outlive a relaunch differently than component state.
- Any render guard that shows the dialog while loading, on query error, or on `SessionExpired`.
- Registering a second `auth:callback-received` listener, invalidating `queryKeys.auth.session`, or calling `setQueryData` on it — Story 27.1 owns all of that.
- Leaving `mutateAsync` uncaught (unhandled promise rejection), or adding a `try`/`catch`/`toast` inside `useAuth.ts` instead of in this component.
- Adding a "don't show this again" checkbox, a third button, or a close "X" — the cadence and two-action structure are fixed decisions.
- Adding a `get_auth_session` mock to an existing Playwright spec to make it pass, or editing any file in `apps/desktop/tests/` at all.
- Creating `ProfileMenu.tsx`, editing `TopBar.tsx`/`AppSidebar.tsx`, adding a sidebar item, or adding a `routes/*.tsx` file.
- Putting a user-identity string under the `accounts.*` prefix, or reusing an existing `accounts.*` key — that prefix means bank/investment accounts throughout this app.
- Mounting a second `<Toaster />` — one already exists in `main.tsx:25`.
- Nesting the new locale keys under an `auth: { … }` object.
- Using `...` instead of `…` in pending copy.
- Leaving English text in JSX, or adding a key to `en.json` only.
- Gating, disabling, or degrading any existing feature based on auth state (NFR1).
- Leaving an unused import or variable — `noUnusedLocals`/`noUnusedParameters` make it a build failure.

### Testing standards

- **Vitest (this story's automated deliverable).** `apps/desktop/vitest.config.ts` uses `environment: "jsdom"`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, with the `@` → `./src` alias. Tests live in `__tests__/` beside what they cover (`src/locales/__tests__/`, `src/hooks/__tests__/`, `src/lib/__tests__/`). Run with `pnpm --filter @nixus/desktop test`.
- **No component render test.** `@testing-library/react` is **not** a desktop dependency (only `vitest` + `jsdom` + `@playwright/test`). Do not add it — that is a dependency decision outside this story (AC 14). The dialog's *behaviour* is covered by Story 27.4's Playwright spec plus the Task 8 manual matrix; the dialog's *copy contract* is covered by the Task 6 locale test.
- **Playwright is a regression gate here, not a deliverable.** Run the full suite and compare to baseline (AC 10). Authoring new auth specs belongs to Story 27.4.
- Neither `vitest`, `tsc`, nor Playwright for the desktop app runs in CI (`.github/workflows/release.yml` builds/signs only; `web-ci.yml` is scoped to `apps/web` + `packages/shared`), so the zero-warning rule from `docs/guidelines/warnings.md` and `docs/project-context.md#9` is **procedural** — the Task 8 gates must be run by hand.

### Project Structure Notes

Files touched — exactly five:

```
apps/desktop/src/
├── components/
│   └── auth/
│       └── AccountPromptDialog.tsx      # NEW (new directory): propless, self-gating launch dialog
├── locales/
│   ├── en.json                          # MODIFIED: + 7 auth.* keys
│   ├── fr.json                          # MODIFIED: + the same 7 auth.* keys, in French
│   └── __tests__/
│       └── auth-i18n.test.ts            # NEW: key-presence, locale parity, ellipsis convention
└── routes/
    └── __root.tsx                       # MODIFIED: + import and + <AccountPromptDialog /> sibling
```

This matches `architecture-login.md#Delta to Existing Project Tree` exactly, minus the entries owned by Stories 27.1 (`hooks/useAuth.ts`, `lib/constants.ts`, `lib/types.ts`) and 27.3 (`components/auth/ProfileMenu.tsx`, the `__root.tsx` header mount). The `auth-i18n.test.ts` file is an addition to that tree, consistent with the three existing locale specs.

Alignment and variances:

- **Aligned:** `components/{feature}/` feature grouping; PascalCase component file; `useTranslation()` with no namespace; shared-UI-first (`@nixus/shared`); flat dotted locale keys; `__tests__/` co-location; propless shell-mounted component mirroring `UpdateChecker`/`RecurringApplyListener`.
- **Variance (documented, code is authoritative):** package specifier is `@nixus/shared` / `@nixus/desktop`, not the `@nkbaz/*` written in `docs/project-context.md`, `epics-login.md`, and `architecture-login.md` — see "Two stale facts" above.
- **Variance (documented, code is authoritative):** the desktop app has Vitest and `__tests__/` directories, contradicting `docs/project-context.md#Testing Rules` and `epics-login.md#Additional Requirements` — which is what makes AC 13 implementable.
- **Variance (accepted, derived):** `/onboarding` suppression and the `SessionExpired` branch are not in `epics-login.md`'s AC list. Both are derived from ACs that *are* specified (NFR1 non-regression; the `AuthState` union with `SessionExpired` messaging owned by 27.3) and are called out here rather than left to interpretation.
- **Relative-path imports in `__root.tsx`:** that file uses `../components/...` for siblings while most files use the `@/` alias. Match the file you are editing.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.2: Account Prompt Dialog with Continue Offline] — all nine primary acceptance criteria
- [Source: _bmad-output/implementation-artifacts/27-1-frontend-auth-session-hook-and-query-key.md] — the authored upstream contract: `useAuthSession()` as a plain `useQuery` with `staleTime: Infinity` and no error handling; `useSignIn()` as a bare mutation with no `onSuccess`, no invalidation, and no copy ("Stories 27.2/27.3 own all copy"); the `auth:callback-received` listener lives in the hook; the `grep` check forbidding an inline `["auth", "session"]`
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.1: Frontend Auth Session Hook & Query Key] — `useAuthSession`/`useSignIn` contract, `AuthState` union, `queryKeys.auth.session`, "`useAuth.ts` is the only frontend module calling `invoke` for auth"
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.3: Header Profile Menu & Minimalist Profile View] — `ProfileMenu`/header is out of scope here; `SessionExpired` messaging is 27.3's AC
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.4: Auth E2E Coverage & Licensing Independence Amendment] — all auth Playwright specs belong to 27.4
- [Source: _bmad-output/planning-artifacts/epics-login.md#UX Design Requirements] — every-launch cadence, "Continue Offline" closes for the session only, copy must signal future features without gating today, no UX spec exists
- [Source: _bmad-output/planning-artifacts/epics-login.md#Requirements Inventory] — FR2, NFR1, inherited EN+FR i18n rule
- [Source: _bmad-output/planning-artifacts/epics-login.md#Epic List] — Epic 27 is frontend-only and consumes Epic 26's finished IPC contract
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Frontend Architecture] — `<AccountPromptDialog>` on the shared `Dialog` primitive; shown on every launch while `get_auth_session` resolves to no session; no persisted dismissal flag, no new SQLite table
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Core Architectural Decisions] — "Popup display condition (every launch until an account exists — no persisted dismissal state needed)" as a critical, blocking decision
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Architectural Boundaries] — `AccountPromptDialog` is a pure consumer of `useAuthSession()` and owns no auth state; both surfaces read one cache entry
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Enforcement Guidelines] — use `queryKeys.auth.session`, never hardcode `["auth", "session"]`; no token exchange from the webview
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Structure Patterns, #File Organization Patterns] — no new `db/` file, no new route, no new static asset
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Delta to Existing Project Tree] — the frontend file delta this story implements a subset of
- [Source: docs/project-context.md#8 Shared UI Components] — check the shared package FIRST; never duplicate a component that exists in `packages/shared/src/ui/`
- [Source: docs/project-context.md#i18n] — all user-visible strings through i18next, no hardcoded English in JSX, `const { t } = useTranslation()`
- [Source: docs/project-context.md#6 TanStack Query Keys, #7 TypeScript Strictness, #9 Compilation Warnings Policy] — query-key rule, `noUnusedLocals`/`noUnusedParameters`, zero-warning gate
- [Source: docs/guidelines/warnings.md] — compilation warning policy referenced by CLAUDE.md
- [Source: packages/shared/src/ui/dialog.tsx:10-18,51-99,101-108,154-165] — the "destructive confirms only" design comment and why this story is a sanctioned exception; mandatory `DialogTitle` + `DialogDescription` for `aria-labelledby`/`aria-describedby`; the `finalFocus` override warning; `DialogContent`'s `showCloseButton` default `true` and internal portal+overlay; `DialogFooter`'s own `showCloseButton` default `false`; `sm:max-w-sm` single width; full export list (no `DialogBody`)
- [Source: packages/shared/src/ui/button.tsx] — available variants `default | outline | secondary | ghost | destructive | link`
- [Source: apps/desktop/src/components/shared/UpdateChecker.tsx:1-121] — the propless shell-mounted launch-dialog pattern to copy: `@nixus/shared` imports, self-gating `return null`, `<Dialog open onOpenChange>`, `DialogContent showCloseButton`, `variant="outline"` secondary before primary in `DialogFooter`, `toast.error(t(...))` from `sonner`; the only existing non-destructive, auto-opening `Dialog`
- [Source: apps/desktop/src/components/accounts/AccountRow.tsx:191-218, apps/desktop/src/components/settings/DangerZone.tsx:181-239, apps/desktop/src/components/expenses/ExpenseList.tsx:341-343,655-679] — the three real delete-confirm `Dialog` usages: `open`/`onOpenChange` state idiom, `data-testid` on `DialogContent`, `variant="outline"` + `variant="destructive"` footer pairing (the `destructive` part is what this story deliberately does not copy)
- [Source: apps/desktop/src/components/maintenance/AddScheduleTaskDialog.tsx, EditIntervalDialog.tsx] — files named `*Dialog` that actually use `SlideOver` (which takes `onClose`, not `onOpenChange`); the create/edit case this story is not
- [Source: apps/desktop/src/lib/i18n.ts] — single default `translation` namespace, `en`/`fr` resources, `fallbackLng: "en"`, `load: "languageOnly"` — hence `useTranslation()` with no namespace argument
- [Source: apps/desktop/src/routes/__root.tsx:6,8-13,35,37,85-86,127-129,151-153] — `useRouterState` pathname idiom, sibling relative imports, "the shell persists across navigation", `#surface-main` with `tabIndex={-1}`, and the `<UpdateChecker /> / <RecurringApplyListener />` mount point
- [Source: apps/desktop/src/routes/index.tsx:34-42] — `beforeLoad` redirect to `/onboarding` when `needs_onboarding`, and `@nixus/shared` root-import convention
- [Source: apps/desktop/src/hooks/useOnboardingStatus.ts:6-30] — `needs_onboarding`/`setup_incomplete` shape and its error fallback (why pathname suppression is preferred)
- [Source: apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts:1-6,85-96,108-139] — flat `Record<string, string>` locale typing, `it.each` required-key assertions, locale-parity checks, declared-coverage check, single-character-ellipsis convention
- [Source: apps/desktop/src/locales/en.json, apps/desktop/src/locales/fr.json] — flat dotted-key structure, EN + FR are the only locales
- [Source: apps/desktop/vitest.config.ts] — `jsdom`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` → `./src`
- [Source: apps/desktop/playwright.config.ts] — specs run against the Vite dev server on `localhost:1420`, not the Tauri runtime
- [Source: apps/desktop/tests/budget.spec.ts (setupTauriMock), apps/desktop/tests/accessibility.spec.ts, apps/desktop/tests/expenses.spec.ts:715-721] — `__TAURI_INTERNALS__.invoke` stub with `default: Promise.reject("Unknown command: …")`; the recorded warning that a truthy modal response "aria-hides the whole app" and that Base UI's focus trap silently breaks unrelated `getByRole` queries; the `getByTestId("<entity>-dialog")` assertion convention Story 27.4 will follow
- [Source: apps/desktop/src/components/shared/TopBar.tsx:13] — the pre-feature "one user, one machine, no login" comment: confirms no auth UI exists today and that this story introduces the first such surface
- [Source: apps/desktop/package.json, packages/shared/package.json] — `@nixus/desktop` / `@nixus/shared`, the `./ui` subpath export, `"test": "vitest run"`, no `@testing-library/react`

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

Baseline commit: `9b45411e5d22d41705bd90eac8b78cf45e7c2238` (working tree already carried Epic 26 + Story 27.1 changes; no frontend changes of this story's own were present at baseline).

**Gate 1 — TypeScript / build (Task 8):**

```
$ pnpm --filter @nixus/desktop exec tsc --noEmit
EXIT=0            # no output, zero errors

$ pnpm --filter @nixus/desktop build
> @nixus/desktop@0.3.2 build
> tsc && vite build
vite v7.3.2 building client environment for production...
transforming...
✓ 4306 modules transformed.
dist/index.html                                 0.51 kB │ gzip:   0.31 kB
dist/assets/Inter-latin-8kRkwJBP.woff2         48.43 kB
dist/assets/Inter-latin-ext-B_-bZUTo.woff2     85.27 kB
dist/assets/index-Xbv2hNb-.css                 68.00 kB │ gzip:  12.99 kB
dist/assets/index-CU3xYvi4.js               1,857.30 kB │ gzip: 537.88 kB
(!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 9.91s
```

The single `(!)` line is Vite's pre-existing whole-bundle chunk-size advisory (1.86 MB bundle); this story adds ~3 KB and did not introduce it. No `tsc` diagnostic, no `noUnusedLocals`/`noUnusedParameters` failure.

**Gate 2 — Vitest (Task 8, AC 13):**

```
$ pnpm --filter @nixus/desktop test
> vitest run
 RUN  v3.2.4 /Users/nbazinet/projects/nixus/apps/desktop

 ✓ src/locales/__tests__/auth-i18n.test.ts (14 tests) 3ms
 ✓ src/locales/__tests__/maintenance-i18n.test.ts (2 tests) 3ms
 ✓ src/locales/__tests__/danger-zone-i18n.test.ts (19 tests) 3ms
 ✓ src/locales/__tests__/budget-templates-i18n.test.ts (61 tests) 6ms
 ✓ src/lib/__tests__/agents.test.ts (4 tests) 1ms
 ✓ src/hooks/__tests__/useTrendsInsight.test.tsx (1 test) 12ms
 ✓ src/hooks/__tests__/useAuth.test.tsx (8 tests) 25ms
 ✓ src/hooks/__tests__/useBudgetTemplates.test.tsx (16 tests) 28ms

 Test Files  8 passed (8)
      Tests  125 passed (125)
   Duration  4.63s
```

111 pre-existing + 14 new = 125. Zero pre-existing test touched.

**Gate 3 — full Playwright suite (Task 8, AC 10) — the render-guard regression gate:**

```
$ pnpm --filter @nixus/desktop exec playwright test --reporter=line
…
[333/333] tests/maintenance.spec.ts:2051:3 › Vehicle catalog › manual toggle preserves custom make and model on save
  2 failed
    tests/chat.spec.ts:250:3 › AI Chat Page — Story 7.1 › money in an answer is tabular Inter, never monospace [AC4]
    tests/design-system.spec.ts:110:1 › spine colour tokens reach the document root ────────────────
  331 passed (1.4m)
```

**331 passed / 2 failed / 333 total — an exact match to the pre-change baseline.** The two failures are the documented pre-existing ones caused by commit `9b45411` rewriting `packages/shared/src/styles/tokens.css` (tabular-Inter font assertion; spine colour tokens). Neither is auth-related, neither was touched, and no new failure appeared. `tests/maintenance.spec.ts:1403` (the known slide-over-animation flake) passed on this run. **No file under `apps/desktop/tests/` was read for modification or edited, and no `get_auth_session` mock was added anywhere.**

**Gate 4 — forbidden-pattern scan of the new component:**

```
$ grep -nE 'invoke\(|localStorage|sessionStorage|document\.cookie|\bas any\b|@ts-ignore|@ts-expect-error|@tauri-apps|setQueryData|invalidateQueries|@nkbaz|useOnboardingStatus|DialogOverlay|DialogPortal|variant="destructive"|Toaster|onClose|isOpen' \
    apps/desktop/src/components/auth/AccountPromptDialog.tsx
48:  // existing feature unreachable. Pathname rather than useOnboardingStatus() — that hook adds a
```

The sole hit is the identifier `useOnboardingStatus()` inside a comment explaining why it is deliberately *not* used. No `invoke(`, no storage API, no cookie, no `as any`/`@ts-ignore`/`@ts-expect-error`, no `@tauri-apps` import, no `setQueryData`/`invalidateQueries`, no `@nkbaz` specifier, no hand-rendered overlay/portal, no `destructive` variant, no second `Toaster`, no `onClose`/`isOpen` prop.

**Gate 5 — scope containment (`git status`, AC 14 / AC 16):**

```
$ git diff --stat -- apps/desktop/src
 apps/desktop/src/lib/constants.ts   | 3 +      # pre-existing (Story 27.1)
 apps/desktop/src/lib/types.ts       | 5 +      # pre-existing (Story 27.1)
 apps/desktop/src/locales/en.json    | 7 +      # THIS STORY
 apps/desktop/src/locales/fr.json    | 7 +      # THIS STORY
 apps/desktop/src/routes/__root.tsx  | 2 +      # THIS STORY
$ git status --porcelain -- apps/desktop/src | grep '^??'
?? apps/desktop/src/components/auth/                       # THIS STORY (new dir)
?? apps/desktop/src/hooks/__tests__/useAuth.test.tsx        # pre-existing (Story 27.1)
?? apps/desktop/src/hooks/useAuth.ts                        # pre-existing (Story 27.1)
?? apps/desktop/src/locales/__tests__/auth-i18n.test.ts     # THIS STORY
$ ls apps/desktop/src/components/auth/
AccountPromptDialog.tsx                                     # no ProfileMenu.tsx
$ git status --porcelain -- .../TopBar.tsx .../AppSidebar.tsx apps/desktop/tests/ apps/desktop/src/routes/
   M apps/desktop/src/routes/__root.tsx                     # the only route-dir change
$ grep -c '"profile\.' apps/desktop/src/locales/{en,fr}.json
0 / 0
$ grep -n '"version"' apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json; grep -n '^version' .../Cargo.toml
apps/desktop/package.json:4:  "version": "0.3.2"
apps/desktop/src-tauri/tauri.conf.json:4:  "version": "0.3.2"
3:version = "0.3.2"
```

Exactly five files belong to this story. `apps/desktop/package.json`'s one-line diff (`@tauri-apps/plugin-deep-link`) pre-dates this story — it is Story 26.3's, and it was already `M` in `git status` before any edit here. Nothing under `apps/desktop/src-tauri/` was touched by this story, no `apps/desktop/tests/` file was touched, no static asset was added, no dependency was added, no `profile.*` key was added, and the version stayed at `0.3.2` in all three manifests.

**Gate 6 — locale integrity:**

```
$ node -e "…"
en keys 1160 fr keys 1160
en auth [ promptTitle, promptBody, promptFutureFeatures, createAccount, continueOffline, openingBrowser, signInFailed ]
fr auth [ promptTitle, promptBody, promptFutureFeatures, createAccount, continueOffline, openingBrowser, signInFailed ]
en nested auth object? undefined          # flat dotted keys, no nested `auth: {…}`
ellipsis en "Opening your browser…"
ellipsis fr "Ouverture du navigateur…"
```

1153 → 1160 in both files (7 keys each, perfect parity). `en.auth` is `undefined`, proving no nested object was introduced.

### Completion Notes List

**What was implemented**

- **`apps/desktop/src/components/auth/AccountPromptDialog.tsx` (NEW, new directory).** Propless, self-gating, shell-mounted launch dialog composed *only* from `@nixus/shared`'s `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter` / `Button` (AC 1). No new dialog, modal, overlay, backdrop, or portal component was written, and `DialogOverlay`/`DialogPortal` are not hand-rendered — `DialogContent` already wraps children in both. Both `DialogTitle` and `DialogDescription` are rendered, so the primitive's `aria-labelledby`/`aria-describedby` wiring is intact (AC 1a). `data-testid`s ship exactly as Story 27.4 needs them: `account-prompt-dialog` on `DialogContent`, `create-account-button`, `continue-offline-button` (AC 1a). Width widened to `sm:max-w-md` via `className` (no `size` prop added to the shared primitive) because this dialog carries three blocks of copy rather than a one-line delete confirm.
- **Render guard — one strict positive match, four ACs (AC 3, 10, 11, 12).** `if (!session.isSuccess || session.data?.status !== "LoggedOut" || dismissed || pathname === "/onboarding") return null;`. It is a strict equality check on a *successfully resolved* payload, so the dialog mounts nothing while pending (AC 3), nothing on `isError`, nothing for `LoggedIn` (AC 2), nothing for `SessionExpired` (AC 11 — expiry messaging stays Story 27.3's), and nothing on an unrecognised `status`. `/onboarding` suppression uses the router pathname via `useRouterState` — the in-file idiom at `__root.tsx:85-86` — deliberately **not** `useOnboardingStatus()`, whose second async dependency races and falls back to `needs_onboarding: false` on error (AC 12).
- **"Continue Offline" (AC 6, 7).** A single component-level `useState` boolean and nothing else. No SQLite table, migration, settings row, `localStorage`/`sessionStorage`/cookie, app-data file, module-level mutable, or Rust call — verified by the Gate 4 grep. The `__root.tsx` shell persists across navigation so the dismissal survives route changes, and it is discarded on relaunch, which *is* the every-launch cadence (AC 7). ESC and backdrop dismissal route through the same `onOpenChange → setDismissed(true)` handler, so all three affordances have identical semantics; neither `modal` nor `disablePointerDismissal` was altered.
- **"Create Account" (AC 5, 15).** `await signIn.mutateAsync()` inside an `async` handler, then `setDismissed(true)` on success — closing on success rather than on click is what makes the pending state observable. The `catch` is present and surfaces `toast.error(t("auth.signInFailed"))` through the already-mounted `sonner` `Toaster` (`main.tsx:25`), so a rejected `start_login` cannot become an unhandled promise rejection or a silently dead button (AC 15). While `signIn.isPending`, **both** footer buttons carry `disabled` + `aria-disabled` (the `DangerZone.tsx` idiom) and the primary label swaps to `t("auth.openingBrowser")`. No `invoke`, no `@tauri-apps` import, no token/PKCE/Cognito URL work, no invalidation, no `setQueryData`, and no second `auth:callback-received` listener — Story 27.1's module is consumed exactly as-is.
- **Default `Button` variant for the primary action**, not `destructive`: every other `Dialog` in this app is a delete confirm; this one is an invitation. `showCloseButton={false}` on `DialogContent` so the two footer buttons are the only visible actions (AC 4). Secondary (`variant="outline"`) precedes the primary, per `UpdateChecker.tsx:110-117`.
- **Seven flat `auth.*` keys in both `en.json` and `fr.json`** (AC 4), inserted immediately after the `update.*` block — the other launch-dialog copy — so the diff reads in context. Flat dotted strings, no nested `auth: {…}` object. Real French, not placeholders. `auth.promptBody` states plainly that nothing in Nixus requires an account today; `auth.promptFutureFeatures` names mobile notifications, photo sync, and community features as *possible future* requirements. `auth.openingBrowser` ends in U+2026 in both locales. No string is hardcoded in the JSX and no `aria-label` carries English — the component's only text nodes are `t()` calls.
- **`apps/desktop/src/locales/__tests__/auth-i18n.test.ts` (NEW, 14 tests)** mirroring `budget-templates-i18n.test.ts`: `Record<string, string>` casts, `it.each(REQUIRED_KEYS)` presence-and-truthiness in both locales, a bidirectional `auth.`-prefix parity check guarded by `expect(enKeys.length).toBeGreaterThan(0)` so it cannot pass vacuously, a declared-coverage check (shipped `auth.*` set must equal `REQUIRED_KEYS`, in *both* locales) so an orphaned or undeclared key fails the run, the U+2026 ellipsis assertion, a guard that no user-identity string leaked into the `accounts.*` namespace, and two copy-contract assertions pinning AC 4's non-gating promise and the three named future features (AC 13).
- **`routes/__root.tsx` — two lines.** One relative-path import matching its siblings, and `<AccountPromptDialog />` as a self-closing sibling after `<UpdateChecker />` / `<RecurringApplyListener />`: inside `ValuesVisibilityProvider`, outside `<main>`, inside the router context `useRouterState` needs. `TopBar`, `AppSidebar`, `DestinationNav`, and the focus-management logic are untouched (AC 16).

**AC 17 — focus is not orphaned. `finalFocus` was needed, and here is the evidence.**

`finalFocus={() => document.getElementById("surface-main")}` is passed on `DialogContent`. This was **not** a precaution — it fixes a genuinely orphaned focus, derived from the resolved dependency's source rather than guessed:

- `@base-ui/react@1.4.0` `DialogPopup.js:116` maps `finalFocus` straight onto `FloatingFocusManager`'s `returnFocus`.
- `FloatingFocusManager.js:432-447` `getReturnElement()`: for the **boolean default** (`returnFocus = true`, i.e. `finalFocus` unset) it returns `domReference || getPreviouslyFocusedElement()`.
- This dialog auto-opens and has **no trigger**, so `domReference` is `null`.
- `addPreviouslyFocusedElement()` (`:66-69`) *explicitly skips `<body>`*: `if (element && getNodeName(element) !== 'body')`. At launch nothing has been focused, so `activeElement(doc) === doc.body` and **nothing is recorded**; `getPreviouslyFocusedElement()` returns `undefined`.
- So `getReturnElement()` returns `null` → `getFirstTabbableElement(null)` returns `null` → the `isHTMLElement(tabbableReturnElement)` guard at `:462` fails → **`focus()` is never called and focus is left on `<body>`.** That is exactly AC 17's orphaned condition.
- With the function form passed, `resolveRef(el)` returns the element, `hasExplicitReturnFocus` becomes `true` (non-boolean), the guard passes, and focus is restored into the shell's main column for both button clicks and ESC. The focus trap was **not** weakened — `modal` and `disablePointerDismissal` are untouched.
- `"surface-main"` is duplicated as a local constant because `MAIN_ID` is module-private to `__root.tsx`, and Task 7 forbids any other change to that file. This is called out as a follow-up candidate: promoting `MAIN_ID` to a shared constant (as `SURFACE_HEADING_ID` already is in `PageHeader.tsx`) would remove the duplication.
- Note on `<main tabIndex={-1}>`: `tabbable`'s `isTabbable()` rejects `tabindex="-1"`, so `getFirstTabbableElement` lands on the first tabbable descendant of `#surface-main` rather than on `<main>` itself. Either way focus lands on a real, connected, reachable element inside the shell and tabbing continues — which is what AC 17 requires.

**AC 9 — flagged for UX/product review (copy and layout only).**

Open for review: the exact wording of all seven `auth.*` strings, including the EN Title-Case action labels ("Create Account" / "Continue Offline" — chosen to match AC 4 verbatim; the locale files carry both Title Case, e.g. "Save Template"/"Add Vehicle"/"Test Connection", and sentence case, e.g. "Not now", so either casing has precedent); the three-block layout (title, description, separate `text-caption text-ink-dim` future-features paragraph); the `sm:max-w-md` width override; and the `showCloseButton={false}` choice that leaves the two footer buttons as the only visible affordances. **Not open for redesign:** the every-launch-until-an-account-exists cadence, the persistence-free dismissal, and the exactly-two-action structure — all three are recorded architectural decisions in `architecture-login.md#Core Architectural Decisions`.

**AC 8 — no gating introduced.** Nothing in this change reads auth state outside `AccountPromptDialog.tsx`; no existing component, route, query, or Rust command was made conditional on a session. The 331-passing Playwright run exercises budget, expenses, accounts, net worth, maintenance, import, chat, and nav in a session state (`isError`) where the dialog is `null`, and every one of those specs behaves exactly as it did at baseline.

**NOT VERIFIED — requires a manual GUI step. These six Task 8 subtasks are left unchecked and must be run by a human before this story is accepted:**

1. `pnpm --filter @nixus/desktop tauri dev` with no `nixus-auth` keyring entry: dialog appears after the session query resolves with no visible flash; "Continue Offline" closes it; navigating destinations does not reopen it; relaunch shows it again.
2. With the dialog dismissed, exercise budget / expenses / accounts / net worth / maintenance and confirm nothing is gated or degraded (AC 8); confirm devtools → Application → Local Storage is untouched (AC 6).
3. Switch the app language to French and confirm every dialog string renders translated with no raw `auth.*` key and no English fallback (AC 4).
4. Click "Create Account" and confirm the system browser opens, the primary button showed its pending label, and the dialog closed on success; with a `LoggedIn` session present, confirm the dialog never appears (AC 2).
5. On a database that still needs onboarding, confirm the app lands on `/onboarding` with no dialog over it and that onboarding completes (AC 12).
6. Keyboard/a11y pass in a real window: ESC closes with session-only semantics, focus after dismissal sits on a real element, the shell is no longer `aria-hidden`, and both `data-testid`s resolve in devtools.

The static and automated evidence for the ACs behind these items is recorded above (the strict-positive guard, the Gate 4 grep, the Gate 6 locale parity, the `finalFocus` source derivation, and the exact-baseline Playwright run), but the on-screen behaviour itself was **not** observed in this session and is not claimed as verified. Story 27.4 owns the Playwright coverage that will automate items 1, 4, 5, and 6.

**Cross-story boundaries respected:** no `hooks/useAuth.ts` / `lib/types.ts` / `lib/constants.ts` change (27.1); no `ProfileMenu.tsx`, no `TopBar.tsx`/`AppSidebar.tsx` edit, no `profile.*` key, no `SessionExpired` messaging (27.3); no Playwright spec written and no file under `apps/desktop/tests/` touched (27.4); nothing under `src-tauri/` (Epic 26); no dependency added — in particular no `@testing-library/react`, hence no component render test.

### File List

- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` — NEW (new directory)
- `apps/desktop/src/routes/__root.tsx` — MODIFIED (import + `<AccountPromptDialog />` mount)
- `apps/desktop/src/locales/en.json` — MODIFIED (+7 `auth.*` keys)
- `apps/desktop/src/locales/fr.json` — MODIFIED (+7 `auth.*` keys, French)
- `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` — NEW

### Review Findings

**Verdict: NO BLOCKING FINDINGS.** Every claim in the Dev Agent Record was re-verified independently (gates re-run from scratch, dependency source read in `node_modules`, both mutation tests executed). Nothing in this change is a correctness bug, security issue, spec/AC violation, or regression. The story is approved on the automated evidence; the six enumerated manual GUI items remain genuinely outstanding and are listed as such, not as defects.

Reviewer did not modify any file under `apps/`. The two mutation tests temporarily edited `AccountPromptDialog.tsx` and `fr.json`; both were restored and confirmed **bit-for-bit identical by SHA-256** before this report was written.

#### A. Render guard (AC 2, 3, 10, 11, 12) — VERIFIED CORRECT, and proven load-bearing

The guard is the strict positive match, verbatim at `AccountPromptDialog.tsx:50-57`:

```ts
if (!session.isSuccess || session.data?.status !== "LoggedOut" || dismissed || pathname === "/onboarding") return null;
```

- **Strict positive match confirmed.** It renders only on a successfully-resolved `{ status: "LoggedOut" }`. `null` is returned for pending/`isLoading` (AC 3), `isError` (AC 10), `LoggedIn` (AC 2), `SessionExpired` (AC 11), and any unrecognised future `status` — the last because the test is `!== "LoggedOut"` rather than an enumeration of known variants. It is **not** any of the looser forms: no `!data`, no `!isLoggedIn`, no `|| isError`, no `!isLoading && !data`.
- **Rules of hooks: safe.** All five hooks are at `:30-34` (`useTranslation`, `useAuthSession`, `useSignIn`, `useState`, `useRouterState`); the early return is at `:56`. An `awk` scan of lines >57 returns zero `use[A-Z]…(` call sites, so no hook sits below the return. `handleCreateAccount` (`:59`) is a plain function, not a hook.
- **Full Playwright suite: exact baseline match.** `331 passed / 2 failed / 333 total`. The 2 failures are precisely the documented pre-existing pair — `tests/chat.spec.ts:250` (tabular-Inter) and `tests/design-system.spec.ts:110` (spine colour tokens) — not reported as this story's regression. `tests/maintenance.spec.ts:1403` **passed** (`✓ 249 … multiple vehicles appear in garage list`), so the known flake did not fire.
- **`Unknown command` grep: ZERO hits** across the entire 411-line suite output. `get_auth_session` also appears zero times, and `account-prompt-dialog` / `AccountPrompt` appear zero times — the dialog never surfaced in any spec.
- **Mutation test — the guard is load-bearing, not incidental.** Replacing it with the wrong form the Dev Notes warn about (`session.data?.status === "LoggedIn" || …`) took `accessibility.spec.ts` from **15 passed / 0 failed → 8 passed / 7 failed**, with exactly the documented failure mode: `Error: element(s) not found … waiting for getByRole('table')` — the modal `aria-hidden`-ing the app rather than one assertion failing. `AccountPromptDialog.tsx` then restored; SHA-256 `76f35d7c…6ce9e1` matches the pre-review baseline.

#### B. Scope containment — VERIFIED CLEAN

Exactly five files belong to this story. Every boundary the sibling stories depend on holds:

| Check | Result |
|---|---|
| `git status --porcelain -- apps/desktop/tests/` | **0 lines** — no spec touched, no `get_auth_session` mock added anywhere |
| `profile.*` keys in `en.json` / `fr.json` | **0 / 0** — no collision with Story 27.3's diff on the same two files |
| `components/auth/ProfileMenu.tsx` | absent — directory holds only `AccountPromptDialog.tsx` |
| `TopBar.tsx` / `AppSidebar.tsx` | not in `git status` |
| `hooks/useAuth.ts`, `lib/types.ts`, `lib/constants.ts` | unchanged by this story (Story 27.1's, consumed as-is) |
| `apps/desktop/src-tauri/` | untouched by this story (Epic 26) |
| `apps/desktop/package.json` | one-line diff is `@tauri-apps/plugin-deep-link` (Story 26.3's, expected). `@testing-library/react` **absent** — and correctly no component render test |
| New route file / static asset / Playwright spec | none — `routes/` shows only `M __root.tsx` |
| Version | `0.3.2` in `package.json`, `tauri.conf.json`, `Cargo.toml` |

`__root.tsx` is a true +2: one relative-path import matching its siblings, and `<AccountPromptDialog />` at `:155`, inside `ValuesVisibilityProvider`, outside `<main>`, adjacent to `<UpdateChecker />` / `<RecurringApplyListener />` — inside the router context `useRouterState` requires.

#### C. Composition + accessibility (AC 1, 1a, 17) — VERIFIED CORRECT

- Composed only from `@nixus/shared` primitives. **No** hand-rendered `DialogOverlay`/`DialogPortal` — correct, because `DialogContent` already wraps children in both (`packages/shared/src/ui/dialog.tsx:60-61`). No new dialog/modal/overlay/backdrop/portal component written.
- **Both** `DialogTitle` (`:86`) and `DialogDescription` (`:87`) are rendered, so the primitive's `aria-labelledby`/`aria-describedby` wiring (`dialog.tsx:13-15`) is intact. No unlabelled modal.
- `data-testid` values verified byte-exactly with `grep -F`: `account-prompt-dialog` on `DialogContent`, `create-account-button`, `continue-offline-button`. All three are exact — Story 27.4's selectors are safe.
- **AC 17 / `finalFocus` — the dev's central technical claim is CORRECT.** Independently verified against the actually-installed `@base-ui/react@1.4.0` (`node_modules/.pnpm/@base-ui+react@1.4.0_…`), not against the story text:
  - `dialog/popup/DialogPopup.js:110` → `returnFocus: finalFocus`. **Mapping confirmed.**
  - `FloatingFocusManager.js:425-441` `getReturnElement()`: for a boolean `returnFocus` it is `const el = domReference || getPreviouslyFocusedElement(); return el && el.isConnected ? el : null;`. **Confirmed.**
  - `addPreviouslyFocusedElement()` at `:60-73` guards with `if (element && getNodeName(element) !== 'body')` — **`<body>` is explicitly skipped. Confirmed.**
  - `:390` captures `activeElement(doc)` on mount and feeds it to that function; at launch that is `<body>`, so nothing is recorded and `getPreviouslyFocusedElement()` returns `undefined`.
  - This dialog renders no `DialogTrigger`, so `domReference` is `null`.
  - Therefore `getReturnElement()` → `null` → `getFirstTabbableElement(null)` returns `null` (`:73-75`) → the `isHTMLElement(tabbableReturnElement)` guard at `:456` fails → **`focus()` is never called and focus is orphaned on `<body>`.** The override was necessary, not decorative complexity.
  - With the function form, `hasExplicitReturnFocus` (`:455`) is `true`, which makes the `!hasExplicitReturnFocus && …` ternary at `:460` evaluate to `true`, so the focus call proceeds. Confirmed.
  - The focus trap was **not** weakened: no `modal={false}`, no `disablePointerDismissal`, no `finalFocus={false}` anywhere in the file. `#surface-main` is a valid target (`__root.tsx:36,129-130`, `tabIndex={-1}`).
  - **Additional verification the Dev Agent Record does not mention, resolving in its favour:** the backdrop path could have defeated `finalFocus`, because `onOpenChangeLocal` (`:401-422`) sets `preventReturnFocusRef.current = true` on `REASONS.outsidePress`. It does so **only when `focus({ preventScroll })` is unsupported**; in Chromium/WebKit it is supported, so the flag is set to `false` and focus return still fires. AC 17 therefore holds for all three affordances, not just two.
- Dismissal paths are consistent: ESC and backdrop both arrive via `onOpenChange` → `setDismissed(true)` (`:74`), the identical handler the "Continue Offline" button uses (`:97`). One state, one semantic, nothing persisted on any path. `showCloseButton={false}` keeps the two footer buttons as the only visible actions (AC 4), and also suppresses the primitive's own untranslated `<span className="sr-only">Close</span>`.

#### D. AC 12 — `/onboarding` suppression — VERIFIED CORRECT

Suppression uses the router pathname via `useRouterState({ select: (s) => s.location.pathname })` (`:34`), matching the in-file idiom at `__root.tsx:86`. `useOnboardingStatus()` is **not** used — it appears only inside a comment at `:48` explaining the deliberate omission, so the race and its `needs_onboarding: false` error fallback are avoided.

The exact `===` comparison was checked for the nested/trailing-slash gap and **there is none**: `routes/` contains a single flat `onboarding.tsx`, and `routeTree.gen.ts:395-398` declares `id`/`path`/`fullPath` all `'/onboarding'` with no children. No `/onboarding/step-2`-style route exists to miss, and TanStack Router's default trailing-slash normalisation means `location.pathname` will not carry a trailing slash. Should nested onboarding routes ever be added, this line must become a prefix check — noted for whoever adds them, not a defect today.

#### E. i18n (AC 4, 13) — VERIFIED CORRECT

- **Flat dotted strings**, not nested: `typeof en.auth` and `typeof fr.auth` are both `undefined`.
- **Perfect parity.** 7 `auth.*` keys in each file; `en`-only and `fr`-only difference sets are both `[]`; all 14 values are `string`. Key totals moved `1153 → 1160` in both files, and `git diff --numstat` reports **7 insertions / 0 deletions** for each — so no pre-existing key was modified, reordered destructively, or removed. Both files still parse as JSON.
- **U+2026 verified at the byte level**, not by string comparison: `hexdump` shows `e2 80 a6` terminating both `"Opening your browser…"` and `"Ouverture du navigateur…"`. A scan of all 14 `auth.*` values found zero occurrences of `...`.
- **French is genuine and idiomatic**, read as a French speaker would: correct negative construction in `Aucune fonctionnalité … n'exige de compte`, correct partitive pronoun in `pourraient en exiger un`, and `Impossible d'ouvrir votre navigateur … Veuillez réessayer.` matches the register of the neighbouring `update.failed`. No placeholders, no machine-mangling.
- **No hardcoded English in the JSX, including `aria-label`.** The component contains zero `aria-label` attributes and zero bare JSX text nodes — every string is a `t()` call.
- `auth-i18n.test.ts` mirrors `budget-templates-i18n.test.ts` (`Record<string, string>` casts, `it.each` presence assertions, bidirectional prefix parity guarded by `expect(enKeys.length).toBeGreaterThan(0)`, declared-coverage equality in both locales, U+2026 assertion). **Mutation-tested:** deleting `auth.continueOffline` from `fr.json` failed **3 tests** (required-key, parity, declared-coverage) at `auth-i18n.test.ts:53`. `fr.json` restored; SHA-256 `a4f278aa…35b20e` matches baseline, and vitest returned to `125 passed`.

#### F. Copy + behaviour (AC 4, 5, 6, 15) — VERIFIED CORRECT

- Exactly two actions, secondary (`variant="outline"`) before the default-variant primary. No third action, no checkbox, no link, no close "X". Default variant — not `destructive` — is correct for an invitation.
- Copy satisfies AC 4 on both halves: `auth.promptBody` states "Nothing in Nixus requires an account today", and `auth.promptFutureFeatures` names mobile notifications, photo sync, and community features as *possible future* requirements. The locale test pins both contracts.
- **"Create Account" goes through `useSignIn()`.** Grep for `invoke(`, `@tauri-apps`, `oauth2`, `cognito`/`Cognito`, `fetch(` returns **zero hits** — Cognito token exchange stays in Rust. Also zero `setQueryData`, zero `invalidateQueries`, and no hardcoded `["auth", "session"]`, so Story 27.1's module boundary is intact (`useAuthSession()` is consumed as the raw `useQuery` result, reading `isSuccess`/`data` directly, exactly as 27.1 intended).
- **"Continue Offline" persists nothing.** Zero `localStorage`, `sessionStorage`, `document.cookie`, and no module-level mutable state. This matches what the story actually specifies — AC 6 requires dismissal to be session-only and AC 7 requires the prompt to return on the next launch — so a component `useState` boolean is the correct implementation, not an omission.
- Pending state: `signIn.isPending` sets `disabled` **and** `aria-disabled={… || undefined}` on both buttons and swaps the primary label to `t("auth.openingBrowser")`. The `aria-disabled={x || undefined}` form is a genuine repo convention (27 usages; `DangerZone.tsx:150,166,222,230` as cited), not an invention.
- **Dismissing mid-flight cannot produce an unhandled promise rejection.** `mutateAsync()` is awaited inside an unconditional `try`/`catch` (`:60-71`), so a rejection is always consumed and surfaced as `toast.error(t("auth.signInFailed"))` through the single root `Toaster` (AC 15). If the user ESCs while pending, the late `setDismissed` is a no-op and a late toast still renders, because the `Toaster` lives in `main.tsx`, outside this component.
- No `SessionExpired` messaging, no `profile.*` copy, no `useSignOut` — Story 27.3's surface is untouched. `SessionExpired` appears only in the `:38` comment explaining the exclusion.

#### G. Gates + standards — VERIFIED

| Gate | Result |
|---|---|
| `pnpm --filter @nixus/desktop exec tsc --noEmit` | `EXIT=0`, no output |
| `pnpm --filter @nixus/desktop test` | **125 passed / 125** (8 files); `auth-i18n.test.ts` contributes 14 |
| Full Playwright | `331 passed / 2 failed / 333` — exact baseline match |
| `\bas any\b` / `@ts-ignore\b` / `@ts-expect-error\b` (word-boundary) | **zero hits** — the prose false positive the dev flagged does not recur under `\b` anchoring |
| Colour/hex/`rgb()`/`hsl()`/arbitrary-px/inline `style={{}}` | **zero hits** |
| `<Toaster` mounts app-wide | **exactly 1** (`main.tsx:25`) |

Styling uses only existing tokens: `text-caption` and `text-ink-dim` resolve to `tokens.css:246` and `:303` and are already paired in 8 sibling files (`DangerZone`, `SettingRow`, `CredentialsForm`, …); `sm:max-w-md` is a stock Tailwind step merged over the primitive's `sm:max-w-sm` via `cn()`/`tailwind-merge`, so no `size` prop was added to the shared `Dialog`. Composition matches `AccountRow.tsx:191-218` (the `open`/`onOpenChange` idiom, `data-testid` on `DialogContent`, outline-then-primary footer). Import style is correct on both sides of the boundary: `@/hooks/useAuth` in the component (the dominant convention, 61 uses vs 1) and a relative path in `__root.tsx`, matching that file's own siblings. `docs/project-context.md:291` in fact already documents the Vitest/`__tests__` setup and the deliberate absence of `@testing-library/react`, so the implementation follows the real, documented standard.

#### NON-BLOCKING findings

1. **`MAIN_ID` literal duplicated across two files.** `AccountPromptDialog.tsx:18` declares `const MAIN_ID = "surface-main"` because `__root.tsx:36`'s `MAIN_ID` is module-private — confirmed: it is not exported. A silent rename in `__root.tsx` would break `finalFocus` with no compile error, degrading AC 17 back to orphaned focus. The duplication was forced by Task 7 ("change nothing else in `__root.tsx`") and the dev self-flagged it. *Fix (follow-up story):* promote `MAIN_ID` to an exported constant, exactly as `PageHeader.tsx:6` already does with `export const SURFACE_HEADING_ID`, and import it in both places.
2. **Two stale line citations in the Dev Agent Record.** It cites `DialogPopup.js:116` and `FloatingFocusManager.js:66-69`; in the installed ESM build these are `:110` and `:60-73`. The mechanism and the conclusion are correct — the offsets are a CJS-vs-ESM build difference. *Fix:* none required; if the Record is edited later, cite `esm/dialog/popup/DialogPopup.js:110` and `esm/floating-ui-react/components/FloatingFocusManager.js:60-73,425-441,456`.
3. **ESC/backdrop stay live while `signIn.isPending`, though both buttons are disabled.** Verified benign — no unhandled rejection (F above), and a late failure toast still surfaces, which is arguably more correct than swallowing it. Called out only so the manual keyboard pass makes it a conscious decision rather than an accident. *Fix:* none unless UX prefers locking dismissal during the browser launch.
4. **AC 12 has a first-run timing window that static analysis cannot close.** `index.tsx`'s `beforeLoad` redirect to `/onboarding` and `get_auth_session` resolve independently, so manual item 5 should specifically watch for a brief dialog flash over the pre-redirect shell, not merely confirm the steady state on `/onboarding`. The guard is exactly what the story specifies; no change is warranted on present evidence.
5. **Minor French style.** `auth.promptFutureFeatures` repeats "fonctionnalités" twice ("Des fonctionnalités à l'étude — … et fonctionnalités communautaires"). Grammatical and clear, slightly clunky. Already inside AC 9's copy-review flag; e.g. "Des nouveautés à l'étude — …" would remove the echo.

#### Outstanding manual work (not defects)

The six unchecked Task 8 subtasks are genuinely outstanding and require a real GUI: `tauri dev` launch cadence, post-dismissal feature sweep plus Local Storage check, French UI pass, browser-open/pending-label pass, `/onboarding` overlay check, and the in-window keyboard/a11y pass. The dev correctly left these unchecked and enumerated them (Completion Notes items 1-6) rather than claiming them — that is the desired behaviour, and Story 27.4 will automate items 1, 4, 5, and 6. Note that item 6's focus-return behaviour now has source-level backing from section C above, so the manual pass is a confirmation rather than an open question.

## Change Log

| Date | Change |
|---|---|
| 2026-08-09 | Story 27.2 implemented: `AccountPromptDialog` on the shared `Dialog` primitive with a strict-positive `LoggedOut` render guard, session-only "Continue Offline" dismissal, `useSignIn()`-backed "Create Account" with pending state and error toast, `/onboarding` suppression, `finalFocus` → `#surface-main`, 7 `auth.*` keys in EN + FR, and a 14-test locale contract spec. Gates: `tsc --noEmit` clean, `build` clean, vitest 125/125, Playwright 331 passed / 2 failed / 333 — exact baseline match, zero regression. Status → review. |

