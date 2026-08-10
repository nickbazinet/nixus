---
baseline_commit: 9b45411e5d22d41705bd90eac8b78cf45e7c2238
---

# Story 27.1: Frontend Auth Session Hook & Query Key

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a single `useAuth.ts` hook exposing session state and sign-in/sign-out mutations,
so that every auth UI surface reads one TanStack Query cache entry and cannot drift out of sync.

**Scope:** Frontend TypeScript only. **Four files: two MODIFIED, two NEW.**

| File | Action |
|---|---|
| `apps/desktop/src/lib/constants.ts` | MODIFIED — `+ queryKeys.auth.session` |
| `apps/desktop/src/lib/types.ts` | MODIFIED — `+ AuthState` |
| `apps/desktop/src/hooks/useAuth.ts` | **NEW** — `useAuthSession`, `useSignIn`, `useSignOut` |
| `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` | **NEW** — Vitest coverage |

**Nothing else.** No component, no route, no `__root.tsx` change, no i18n key, no Playwright spec, no Rust, no dependency, no SQLite. This story renders no pixels and changes no runtime behaviour: nothing mounts these hooks until Stories 27.2/27.3.

**FRs:** enables FR2 + FR3 (login-scoped) — the shared data layer both consume · **NFRs:** NFR1 (nothing gated, nothing blocking)
**Epic:** [epics-login.md § Epic 27, Story 27.1](../planning-artifacts/epics-login.md)
**Architecture:** [architecture-login.md](../planning-artifacts/architecture-login.md) — § Frontend Architecture (lines 118-128), § Naming Patterns (lines 152-160), § Architectural Boundaries (lines 229-242), § Integration Points (lines 253-264), § Enforcement Guidelines (lines 177-188)
**Predecessors:** **26.2** (HARD — `AuthState` Rust shape), **26.4** (HARD — `start_login`, `auth:callback-received`), **26.5** (HARD — `get_auth_session`, `sign_out`)
**Successors:** 27.2 (`AccountPromptDialog`), 27.3 (`ProfileMenu`), 27.4 (E2E) — all consume this file and add nothing to it

---

## ⛔ PREREQUISITE GATE — RUN BEFORE WRITING ANY CODE

**Verified at story-creation time (2026-08-09): zero auth code exists anywhere in this repo.** `find apps/desktop/src apps/desktop/src-tauri/src -iname "*auth*"` → no files. Case-insensitive grep for `cognito|start_login|get_auth_session|sign_out|AuthState` across both trees → only false positives (the English word "authored" in `template_defaults.rs`, `models/mod.rs`, `OnboardingStarterTemplate.tsx`; one comment string in `commands/settings.rs`). `lib.rs`'s `generate_handler!` (lines 92-186, ~120 commands) contains no auth command. `queryKeys` has no `auth` entry (`constants.ts:1-61`). `lib/types.ts` (633 lines) has no `AuthState`.

```bash
cd /Users/nbazinet/projects/nixus
grep -n "start_login\|get_auth_session\|sign_out" apps/desktop/src-tauri/src/lib.rs
grep -n "pub enum AuthState" apps/desktop/src-tauri/src/models/mod.rs
grep -n "auth:callback-received" apps/desktop/src-tauri/src/commands/auth.rs
grep -rn "queryKeys.auth\|useAuthSession" apps/desktop/src
```

| Gate | Result | Action |
|---|---|---|
| `start_login`, `get_auth_session`, or `sign_out` missing from `generate_handler!` | **HARD STOP** | Report "Epic 26 is not done — Stories 26.4/26.5 must land first." Write **no** Rust and **no** stub command. |
| `AuthState` missing from `models/mod.rs` | **HARD STOP** | Same. Do not hand-write a TS type against a Rust enum that does not exist yet. |
| `AuthState` present but its `#[serde(tag = "status")]` variant tag values are **not** `"LoggedOut"` / `"LoggedIn"` / `"SessionExpired"` (e.g. someone added `rename_all = "snake_case"` and it emits `"logged_in"`) | — | Type the TS union against the **actual** tag values and record the deviation in Completion Notes. Do **not** silently ship a union that never matches. |
| `AuthState::LoggedIn`'s Rust field is `name: Option<String>` **with** `#[serde(skip_serializing_if = "Option::is_none")]` | — | Then the wire shape is `name?: string`, not `name: string \| null`. Read the actual attribute before typing AC #2. Story 26.2 specifies no `skip_serializing_if`, so `string \| null` is expected. |
| `useAuth.ts` or `queryKeys.auth` already present | — | Read first, edit surgically. Never overwrite. |

**Record the ACTUAL command signatures before typing TS against them:**

| Command | Rust signature (26.4/26.5) | Frontend call |
|---|---|---|
| `start_login` | `pub async fn start_login(app: tauri::AppHandle) -> Result<(), AppError>` | `invoke<void>("start_login")` — **no arguments object.** `AppHandle` is injected by Tauri, never sent from JS. |
| `get_auth_session` | `pub async fn get_auth_session() -> Result<AuthState, AppError>` | `invoke<AuthState>("get_auth_session")` — **no arguments object.** |
| `sign_out` | `pub fn sign_out(<managed pending-login state>) -> Result<(), AppError>` | `invoke<void>("sign_out")` — **no arguments object.** `State<T>` is injected by Tauri. |
| `handle_auth_callback` | registered in `generate_handler!` by 26.4 | ❌ **NEVER invoked from the frontend.** It is driven by the Rust deep-link seam. Calling it from JS would bypass the pending-attempt/`state` CSRF check. |

---

## Acceptance Criteria

1. **Query key added, nested under `auth`.** Given `apps/desktop/src/lib/constants.ts`, when this story is implemented, then `queryKeys` gains exactly one new entry, appended after `financialHealthDetail` (`constants.ts:60`) so the auth cluster is contiguous and last:
   ```ts
   auth: {
     session: ["auth", "session"] as const,
   },
   ```
   **And** the key array is exactly `["auth", "session"]` — never `["auth-session"]`, `["session"]`, or `["auth", "session", <anything>]`.
   **And** `as const` is present, matching all 39 existing entries (`constants.ts:1-61`, 100% consistent).
   **And** it is a bare tuple, **not** a factory function — `get_auth_session` takes no arguments.
   **And** **no other line of `constants.ts` changes** — no reordering, no reformatting, no renaming of any existing key.
   [Source: epics-login.md#Story 27.1 AC 1; architecture-login.md#Naming Patterns "TanStack Query key"; docs/project-context.md#6 TanStack Query Keys]

2. **`AuthState` TS discriminated union added.** Given `apps/desktop/src/lib/types.ts`, when this story is implemented, then it declares, appended at the end of the file after `AiConfig` (`types.ts:629-633`):
   ```ts
   export type AuthState =
     | { status: "LoggedOut" }
     | { status: "LoggedIn"; email: string; name: string | null }
     | { status: "SessionExpired" };
   ```
   **And** the discriminant property is `status` with **PascalCase** literal values, mirroring Rust's `#[serde(tag = "status")]` internally-tagged enum (Story 26.2) — `"LoggedIn"`, never `"logged_in"` or `"loggedIn"`.
   **And** `name` is `string | null`, **not** `name?: string` — Rust's `Option<String>` carries no `skip_serializing_if`, so the key is always present and serializes to JSON `null` (same convention as `types.ts:216` `last_amount_cents: number | null`).
   **And** it is a `type` alias with a union, **not** an `interface` — an interface cannot express a discriminated union, and narrowing on `status` is the whole point (27.3 needs `if (data.status === "LoggedIn")` to expose `email`).
   **And** no `sub` field is declared: `sub` is parsed in Rust as the durable identity key (NFR4) but is deliberately **not** exposed through `AuthState` (Story 26.5 marks it `#[allow(dead_code)]`). Adding it here would be a type lie.
   **And** no other interface in `types.ts` is edited, moved, or reformatted.
   [Source: epics-login.md#Story 27.1 AC 2, #Story 26.2 (`AuthState` shape, `#[serde(tag = "status")]`); architecture-login.md#Naming Patterns "Session state enum"]

3. **`useAuthSession()` reads the session under the shared key.** Given `apps/desktop/src/hooks/useAuth.ts`, when implemented, then it exports:
   ```ts
   export function useAuthSession() {
     const queryClient = useQueryClient();

     useEffect(/* AC #6 listener */);

     return useQuery({
       queryKey: queryKeys.auth.session,
       queryFn: () => invoke<AuthState>("get_auth_session"),
       // get_auth_session performs the Cognito refresh POST when the stored token has
       // expired, so a stale entry would re-POST on every window focus and reconnect.
       staleTime: Infinity,
     });
   }
   ```
   **And** `queryKey` is `queryKeys.auth.session` — the literal `["auth", "session"]` appears **nowhere** in `useAuth.ts` or in any component (AC #9's grep proves it).
   **And** `invoke` is called with **no** arguments object.
   **And** `staleTime: Infinity` is the **only** non-default query option. Do **not** add `retry`, `gcTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount`, `enabled`, `select`, or `placeholderData` — see §Conflict A for why `staleTime` is required and why each of the others is redundant or wrong.
   **And** the hook returns the `useQuery` result object unwrapped — no `data ?? { status: "LoggedOut" }` default, no `isLoading`-collapsing wrapper, no destructuring. 27.2 AC 3 and 27.3 AC 2 both need the raw `isLoading` to avoid a logged-out flash, and a synthesised `LoggedOut` default would make "still loading" indistinguishable from "no account" — the exact bug those ACs forbid.
   [Source: epics-login.md#Story 27.1 AC 3, #Story 27.2 AC 3, #Story 27.3 AC 2; architecture-login.md#Frontend Architecture, #Process Patterns "Loading state"; apps/desktop/src/hooks/useFinancialHealth.ts:6-12]

4. **`useSignIn()` and `useSignOut()` mutations.** Given the same file, when implemented, then it exports:
   ```ts
   export function useSignIn() {
     return useMutation({
       mutationFn: () => invoke<void>("start_login"),
     });
   }

   export function useSignOut() {
     const queryClient = useQueryClient();

     return useMutation({
       mutationFn: () => invoke<void>("sign_out"),
       onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
       },
     });
   }
   ```
   **And** both `mutationFn`s take **no parameter** and pass **no** arguments object to `invoke` — matching the three zero-arg Rust signatures in §Prerequisite Gate. The epic's "with `snake_case` arguments" clause does **not** mean arguments exist here; see §Conflict C before you add one.
   **And** neither `mutationFn` is declared `async`; each returns the `invoke` promise directly (every mutation in `useBudget.ts` / `useBudgetTemplates.ts` / `useFinancialHealth.ts` does it this way).
   **And** `useSignIn()` has **no** `onSuccess` and invalidates **nothing**: `start_login` only opens the system browser, so the session is unchanged at that moment. Invalidating here would fire a pointless `get_auth_session` (still `LoggedOut`) and could burn a refresh attempt. The `auth:callback-received` event (AC #6) is the only thing that reflects a completed sign-in.
   **And** neither hook contains a `try`/`catch`, a `toast`, a `t()` call, a `useTranslation()`, or any user-facing string — callers use `mutateAsync` in their own handler or read `mutation.error` (Stories 27.2/27.3 own all copy).
   [Source: epics-login.md#Story 27.1 AC 3-4; architecture-login.md#Frontend Architecture "Mutations (useSignIn, useSignOut) invalidate the auth.session query key on success"; docs/project-context.md#Hooks Pattern]

5. **Sign-out invalidates the session.** Given `useSignOut()`, when its `mutationFn` resolves, then `onSuccess` calls `queryClient.invalidateQueries({ queryKey: queryKeys.auth.session })` exactly once, so both `AccountPromptDialog` and `ProfileMenu` re-render from the refetched `LoggedOut` state.
   **And** it invalidates **nothing else** — not `queryClient.clear()`, not `queryClient.removeQueries()`, not `queryKeys.onboardingStatus`, not any budget/expense/maintenance key. Auth shares no data with any other domain (FR4); wiping unrelated caches on sign-out would be a gratuitous refetch storm and a licensing/login coupling smell.
   **And** it does **not** call `queryClient.setQueryData(queryKeys.auth.session, { status: "LoggedOut" })` — the keyring is the source of truth; an optimistic write that disagreed with Rust would be exactly the drift this story exists to prevent.
   [Source: epics-login.md#Story 27.1 AC 3 (final clause), #Story 27.3 AC 7, #Additional Requirements "Single source of truth"; architecture-login.md#Data Boundaries]

6. **`auth:callback-received` listener invalidates the session and unsubscribes on unmount.** Given the Tauri event emitted by Story 26.4 via `AppHandle::emit`, when the app is running, then `useAuth.ts` registers a `listen("auth:callback-received", …)` handler inside a `useEffect` that invalidates `queryKeys.auth.session` when it fires — so a browser sign-in reflects in the UI with no manual refresh:
   ```ts
   useEffect(() => {
     let cleaned = false;
     const unlisteners: UnlistenFn[] = [];

     const setup = async () => {
       const unlisten = await listen("auth:callback-received", () => {
         queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
       });

       if (cleaned) {
         unlisten();
       } else {
         unlisteners.push(unlisten);
       }
     };

     setup();

     return () => {
       cleaned = true;
       unlisteners.forEach((unlisten) => unlisten());
     };
   }, [queryClient]);
   ```
   **And** the `cleaned`-flag guard is mandatory, not optional: `listen()` is async, `<React.StrictMode>` is enabled (`main.tsx:21`) and double-invokes effects in dev, so an unguarded `unlisten` assignment leaks a listener on every mount/unmount/remount cycle. This is the exact idiom already used at `useImport.ts:46-79` and `useChat.ts:78-137`.
   **And** the effect's dependency array is `[queryClient]` (the `useQueryClient()` reference is stable, so this runs once per mount) — matching `RecurringApplyListener.tsx:9-26`. Never `[]` with a `queryClient` closure, never a missing array.
   **And** `listen` is imported as `import { listen, type UnlistenFn } from "@tauri-apps/api/event";` — never from bare `@tauri-apps/api`.
   **And** `listen` is called with **no type generic** and the handler reads **no** `event.payload`: 26.4 emits `()` (JS `null`) and its AC states the payload contains no token values. Reading it would invite someone to start shipping claims through the event later.
   **And** the event name string is exactly `"auth:callback-received"` — colon-namespaced, matching the `"recurring:applied"` precedent (`lib.rs:83`). No `auth:callback-failed` listener is added (26.4 §Conflict D: no such event exists).
   [Source: epics-login.md#Story 27.1 AC 5, #Story 26.4 (event emitted on success only, payload carries no tokens); architecture-login.md#Integration Points, #Naming Patterns "Tauri event name"; apps/desktop/src/hooks/useImport.ts:46-79; apps/desktop/src/components/shared/RecurringApplyListener.tsx:9-26]

7. **`useAuth.ts` is the sole frontend caller of the auth commands.** Given the module boundary rule, when this story is reviewed, then `useAuth.ts` is the only file under `apps/desktop/src/` that passes `"start_login"`, `"get_auth_session"`, or `"sign_out"` to `invoke`, and it never passes `"handle_auth_callback"`:
   ```bash
   grep -rn '"start_login"\|"get_auth_session"\|"sign_out"' apps/desktop/src   # → only hooks/useAuth.ts
   grep -rn '"handle_auth_callback"' apps/desktop/src                          # → zero matches
   grep -rn '\["auth", *"session"\]' apps/desktop/src                          # → only lib/constants.ts
   ```
   **And** no auth React context, provider, reducer, `useState` mirror, module-level `let`, or `zustand`-style store is introduced — the TanStack Query cache entry is the single source of truth (both surfaces read it; neither owns a copy).
   [Source: epics-login.md#Story 27.1 AC 6, #Additional Requirements "Single source of truth"; architecture-login.md#Component Boundaries, #Enforcement Guidelines]

8. **Errors surface as query error state, never as a crash.** Given `get_auth_session` returns `AppError::Auth` (Story 26.5 AC 12: malformed keyring JSON, undecodable `id_token`, or missing `email` claim), when `useAuthSession()` resolves, then the rejection is exposed through the standard TanStack Query `isError` / `error` state and produces no unhandled promise rejection and no thrown render.
   **And** `useAuthSession()` contains **no** `try`/`catch`, no `throwOnError`, no `onError`, and no error-shape parsing. The Tauri IPC rejection already arrives as the plain deserialized object `{ type: "auth", message, recoverable }` (`error.rs`'s hand-written `Serialize`), and TanStack Query stores rejections in `error` by default — no work is required to satisfy this AC beyond *not adding* anything.
   **And** no `getErrorMessage` / `isAppError` / `formatError` helper is added to `lib/types.ts`, `lib/utils.ts`, or a new `lib/errors.ts`. No such shared helper exists today (each consumer inline-casts: `useChat.ts:166`, `useImport.ts:91`, `CredentialsForm.tsx:23-36`); introducing one is a cross-cutting refactor outside this story's four-file footprint. Stories 27.2/27.3 decide how to *display* the error.
   **And** because nothing mounts these hooks yet, no error can reach the app shell in this story — the guarantee is structural, and Task 5's rejection test is what proves it.
   [Source: epics-login.md#Story 27.1 AC 7, #Story 26.5 AC 12; docs/project-context.md#5 Error Handling]

9. **Footprint is exactly four files and zero runtime behaviour change.** Given the desktop app, when this story completes, then `git diff --name-only` lists at most:
   ```
   apps/desktop/src/lib/constants.ts
   apps/desktop/src/lib/types.ts
   apps/desktop/src/hooks/useAuth.ts
   apps/desktop/src/hooks/__tests__/useAuth.test.tsx
   ```
   **And** **nothing** under `apps/desktop/src-tauri/`, `apps/web/`, `packages/`, `apps/desktop/src/components/`, `apps/desktop/src/routes/`, `apps/desktop/src/locales/`, or `apps/desktop/tests/` is modified — in particular `routes/__root.tsx`, `components/shared/TopBar.tsx`, `locales/en.json`, `locales/fr.json`, and `routeTree.gen.ts` are untouched.
   **And** no dependency is added to `apps/desktop/package.json` — `@tanstack/react-query`, `@tauri-apps/api`, `react`, and `vitest` are all already present; `@tauri-apps/plugin-deep-link` is Story 26.3's and is **not** imported here (the frontend listens to a plain Tauri event, not to the plugin's `onOpenUrl`).
   **And** because no component imports `useAuth.ts`, all 23 existing Playwright specs pass unchanged and their `window.__TAURI_INTERNALS__.invoke` stubs need no new `case` — see §Forward Risks for why that stops being true in 27.2.
   [Source: architecture-login.md#Delta to Existing Project Tree (lines 209-223); epics-login.md#Epic List "Why two epics"]

10. **Vitest coverage proves the four behaviours a type-check cannot.** Given `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` (new), when `pnpm --filter @nixus/desktop test` runs, then it proves:
    - `useAuthSession()` invokes `"get_auth_session"` **once** with **no** second argument, and its resolved `AuthState` reaches `data`
    - the resolved session is cached under `["auth", "session"]` (`queryClient.getQueryData(["auth", "session"])` is defined) — this is the only assertion that would catch a wrong key literal in `constants.ts`
    - `useSignIn().mutateAsync()` invokes `"start_login"` with no arguments and invalidates **nothing**
    - `useSignOut().mutateAsync()` invokes `"sign_out"` with no arguments and invalidates `["auth", "session"]`
    - firing the captured `"auth:callback-received"` handler invalidates `["auth", "session"]`
    - unmounting the tree calls every recorded `unlisten` function (proves AC #6's cleanup)
    - a rejected `get_auth_session` lands in `error` / `isError` rather than throwing (proves AC #8)
    - `"handle_auth_callback"` is never passed to `invoke`

    **And** it reuses the established harness idiom from `hooks/__tests__/useBudgetTemplates.test.tsx`: `vi.mock("@tauri-apps/api/core")`, headless harness components assigning hook results to module-scoped `let`s — **split into a mutations harness and a session harness** because `useAuthSession()` fetches and registers its listener on mount (Task 5) — `createRoot` + `act`, `new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })`, `vi.spyOn(queryClient, "invalidateQueries")`, and the bounded-poll `settleQueries` helper (**not** a single `setTimeout(0)` flush — that idiom measured a ~65% failure rate and was fixed in Story 25.2).
    **And** `@testing-library/react` is **not** imported — it is not a dependency of `@nixus/desktop`.
    **And** all pre-existing Vitest specs still pass unchanged.
    [Source: apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx:1-113, 25-2-frontend-hook-for-budget-templates.md#Review Findings (flaky-flush fix); apps/desktop/vitest.config.ts]

11. **Clean build.** Given the desktop app, when `pnpm --filter @nixus/desktop build` runs (`tsc && vite build`), then it completes with **zero** TypeScript errors or warnings — `strict` + `noUnusedLocals` + `noUnusedParameters` are on, so an unused `UnlistenFn` type import or an unused `AuthState` import is a hard failure.
    [Source: docs/project-context.md#7, #9; docs/guidelines/warnings.md]

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate (AC: all)**
  - [x] Run all four gate commands in §Prerequisite Gate. **HARD STOP** and report blocked if any Epic 26 command or `AuthState` is missing — do not stub Rust, do not hand-invent a command.
  - [x] Read `apps/desktop/src-tauri/src/models/mod.rs`'s `AuthState` and record the **actual** serde attributes and field types. Type AC #2 against reality.
  - [x] Read `apps/desktop/src-tauri/src/commands/auth.rs` and confirm the emit site is `app.emit("auth:callback-received", ())` (global emit, not `emit_to`) — a window-scoped emit would need `getCurrentWindow().listen` instead of the global `listen`.
  - [x] Read `apps/desktop/src/hooks/useFinancialHealth.ts` (31 lines) and `apps/desktop/src/hooks/useImport.ts:1-80` end to end. These are the two shapes you are copying: hook file structure, and the `cleaned`-flag listener.

- [x] **Task 1: Add the query key (AC: #1)**
  - [x] `apps/desktop/src/lib/constants.ts` — append the nested `auth: { session: ["auth", "session"] as const },` block after `financialHealthDetail` (line 60), inside the closing `}` of `queryKeys`.
  - [x] Do not touch any existing entry. Do not "normalise" existing flat keys into nested groups (see §Conflict B).

- [x] **Task 2: Add the `AuthState` type (AC: #2)**
  - [x] `apps/desktop/src/lib/types.ts` — append the `export type AuthState = …` union at the end of the file, after `AiConfig` (line 633).
  - [x] `name: string | null`; PascalCase `status` literals; no `sub`; `type` not `interface`.
  - [x] Touch no other declaration.

- [x] **Task 3: Create `apps/desktop/src/hooks/useAuth.ts` (AC: #3, #4, #5, #6, #7, #8)**
  - [x] Imports, in this exact order (house convention, verified across all 22 hook files):
        ```ts
        import { useEffect } from "react";
        import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
        import { invoke } from "@tauri-apps/api/core";
        import { listen, type UnlistenFn } from "@tauri-apps/api/event";
        import { queryKeys } from "@/lib/constants";
        import type { AuthState } from "@/lib/types";
        ```
  - [x] `useAuthSession()` — the AC #6 `useEffect` first, then the AC #3 `useQuery` return. `staleTime: Infinity` with the one-line WHY comment; nothing else.
  - [x] `useSignIn()` — mutation only, no `onSuccess`.
  - [x] `useSignOut()` — mutation + `onSuccess` invalidating `queryKeys.auth.session` only.
  - [x] Export exactly these three hooks. No default export, no extra helper export, no `AuthCallbackListener` component (that would be a `components/` file, out of footprint).
  - [x] Use the `@/` alias everywhere; never relative `../lib/constants`.
  - [x] Exactly one comment in the file — the `staleTime` WHY. No comments describing what the code does (`docs/project-context.md#Code Quality`).

- [x] **Task 4: Verify the boundary greps (AC: #7)**
  - [x] Run all three greps from AC #7 and paste the output into Completion Notes.

- [x] **Task 5: Create `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` (AC: #10)**
  - [x] Copy the harness scaffolding from `useBudgetTemplates.test.tsx:1-113`: `declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }`, `const invokeMock = vi.fn()`, `vi.mock("@tauri-apps/api/core", …)`, module-scoped `let`s for hook results, headless harness components returning `null`, `render()` wrapping in `QueryClientProvider` inside `act`, `beforeEach`/`afterEach`, `invalidatedKeys()`, `settleQueries()` bounded poll.
  - [x] **Split the harnesses — this is the #1 way to write a broken suite here.** `useAuthSession()` is a query, so it invokes `get_auth_session` **on mount**, and its `useEffect` registers the listener on mount. A single shared harness containing all three hooks would make `invokeMock.mock.calls[0]` equal `["get_auth_session"]` in every mutation test, and would register a listener the mutation tests never asked for. This is the exact trap `useBudgetTemplates.test.tsx:46-51` had to solve. Therefore:
        - `MutationsHarness` — calls `useSignIn()` + `useSignOut()` only. Rendered in `beforeEach`.
        - `SessionHarness` — calls `useAuthSession()` only. Rendered **inside** the session, listener, error and `handle_auth_callback` tests, never in `beforeEach`.
        - In mutation tests, assert with `expect(invokeMock).toHaveBeenCalledWith("start_login")` / `expect(invokeMock.mock.calls).toContainEqual(["sign_out"])`, or with `invokeMock.mock.calls[0]` **only** because `SessionHarness` is not mounted there. Never mix both.
  - [x] Additionally mock the event module so the handler is capturable and the unsubscribe is observable:
        ```ts
        const listenMock = vi.fn();
        vi.mock("@tauri-apps/api/event", () => ({
          listen: (...args: unknown[]) => listenMock(...args),
        }));
        ```
        In `beforeEach`, implement it as an async fn that records `[eventName, handler]` and returns a fresh `vi.fn()` unlisten, pushing that unlisten into an array the tests can assert on. **`listen` must return a Promise** — `await listen(...)` in the hook depends on it, and a sync return makes the `cleaned`-flag branch untestable.
  - [x] `type UnlistenFn` must **not** be re-exported from the mock factory (it is a type-only import in the hook and is erased at runtime; adding it to the factory is harmless but unnecessary — if `tsc` complains about the mock's shape, cast the factory return, do not change the hook).
  - [x] Because the listener registers inside an async `setup()`, flush before asserting on it: `await settleQueries(() => listenMock.mock.calls.length > 0)`. Adapt `settleQueries`' **default** predicate to this file's own state (`authSession !== undefined && !authSession.isLoading`) — the copied version defaults to `systemTemplates`, which does not exist here and would fail `tsc`.
  - [x] Tests to write:

  | Test | Mock behaviour | Assert |
  |---|---|---|
  | `reads the session through the zero-arg command` | `invokeMock` resolves `{ status: "LoggedOut" }` | render `SessionHarness`; `invokeMock.mock.calls[0]` equals `["get_auth_session"]`; `authSession.data` equals `{ status: "LoggedOut" }` |
  | `caches the session under the shared auth query key` | resolves `{ status: "LoggedIn", email: "a@b.c", name: null }` | render `SessionHarness`; `queryClient.getQueryData(["auth", "session"])` is defined and equals the payload |
  | `starts login without arguments and without invalidating the session` | resolves `null` | `SessionHarness` **not** rendered; `invokeMock.mock.calls[0]` equals `["start_login"]`; `invalidateSpy` not called |
  | `invalidates the session after signing out` | resolves `null` | `SessionHarness` **not** rendered; `invokeMock.mock.calls[0]` equals `["sign_out"]`; `invalidatedKeys()` equals `[["auth", "session"]]` |
  | `invalidates the session when the deep-link callback event fires` | resolves `{ status: "LoggedOut" }` | render `SessionHarness`; `listenMock` called with `"auth:callback-received"` as its first argument; invoking the captured handler produces an `["auth", "session"]` invalidation |
  | `unsubscribes the callback listener on unmount` | resolves `{ status: "LoggedOut" }` | render `SessionHarness`, flush, then `act(() => root.unmount())`; every recorded unlisten `vi.fn()` has been called. Guard `afterEach` with an `unmounted` flag so it does not unmount the same root twice. |
  | `surfaces a rejected session read as query error state` | rejects `{ type: "auth", message: "Your stored session could not be read.", recoverable: true }` | render `SessionHarness`; `authSession.isError` is `true`; `authSession.error` matches that object; no unhandled rejection |
  | `never invokes the deep-link callback command from the frontend` | resolves `{ status: "LoggedOut" }` | render `SessionHarness` and run both mutations; `invokeMock.mock.calls.every((call) => call[0] !== "handle_auth_callback")` is `true` |

  - [x] Do **not** import `@testing-library/react`. Do **not** add `vi.useFakeTimers()` (nothing debounces here). Do **not** add a second `vi.mock` factory for either specifier.

- [x] **Task 6: Verify and close out (AC: #9, #10, #11)**
  - [x] `pnpm --filter @nixus/desktop build` → zero TS errors/warnings.
  - [x] `pnpm --filter @nixus/desktop test` → all Vitest specs pass. Record the total in Completion Notes; do **not** hardcode an expected count.
  - [x] `cd apps/desktop && pnpm exec playwright test` → no regressions. This story adds no spec and mounts no hook, so the suite must be unchanged. If a spec newly fails with `Unknown command: get_auth_session`, something outside this story's footprint imported `useAuth.ts` — revert it.
  - [x] Confirm untouched: all of `apps/desktop/src-tauri/**`, `apps/web/**`, `packages/**`, `src/locales/*.json`, `src/components/**`, `src/routes/**`, `tests/**`, `routeTree.gen.ts`, `package.json`.
  - [x] `git diff --name-only` → at most the four paths in AC #9.
  - [x] **Do not commit.**

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **`invoke` comes from `@tauri-apps/api/core`; `listen` from `@tauri-apps/api/event`.** Never bare `@tauri-apps/api`. All 22 hook files use these exact specifiers.
2. **Query keys come from `queryKeys`.** `["auth", "session"]` must appear in exactly one file: `lib/constants.ts`. [docs/project-context.md#6, #Anti-Patterns]
3. **Every mutation's `onSuccess` invalidates all affected keys** — and *only* the affected keys. `useSignIn` affects none (see AC #4). [docs/project-context.md#Hooks Pattern]
4. **Zero Rust.** If you open anything under `src-tauri/`, stop — scope violation. Epic 26 owns every command, model, and the event emit.
5. **Zero UI, zero i18n.** No `.tsx` component, no `t()`, no `useTranslation`, no locale key. `locales/__tests__/` contains three i18n key-parity specs — touching `en.json`/`fr.json` here would drag them into scope for no reason.
6. **No auth state outside the query cache.** No context, provider, `useState` mirror, module-level singleton, or ref-counted listener registry. [architecture-login.md#Component Boundaries]
7. **`handle_auth_callback` is never invoked from JS.** It is reachable only through the Rust deep-link seam, which is what enforces the `state` CSRF check and the pending-attempt lookup.
8. **No comments explaining *what*; only *why*.** Exactly one WHY comment is warranted (the `staleTime` rationale). [docs/project-context.md#Code Quality]
9. **Zero TypeScript warnings.** `strict` + `noUnusedLocals` + `noUnusedParameters`. [docs/project-context.md#7, #9; docs/guidelines/warnings.md]
10. **Append, never rewrite.** `constants.ts` and `types.ts` are large shared files edited by many stories. Surgical inserts only.

### Four Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — `staleTime: Infinity` versus the "queryKey + queryFn only" house style.**
Story 25.2 established a binding convention that plain list queries set *nothing* beyond `queryKey`/`queryFn`, and `main.tsx:11` instantiates `new QueryClient()` with **no `defaultOptions`** — so library defaults apply: `staleTime: 0`, `refetchOnWindowFocus: true`, `refetchOnMount: true`, `refetchOnReconnect: true`, `retry: 3`.
That default set is **wrong for this specific query**, because `get_auth_session` is not a cheap read: when the stored token has expired it performs a `POST` to Cognito's `/oauth2/token` with a 10-second timeout (Story 26.5, Tasks 2/4). With `staleTime: 0`, every window focus, every reconnect, and every remount would re-attempt that network exchange — and in the `SessionExpired` state (a refresh token Cognito has rejected) it would re-attempt it *forever*, once per focus. That directly contradicts `architecture-login.md#Process Patterns` ("checked once on app launch, not polled — matches the local-first, no-unnecessary-network-calls posture") and `epics-login.md#Story 26.5` ("no polling loop, no background timer"). Note that 25.2's own reasoning for adding nothing was explicitly *"a refetch here costs one no-IO Rust call"* — that premise does not hold here, so the same reasoning points the other way.
**Resolution: set `staleTime: Infinity` and nothing else.** In TanStack Query v5, `refetchOnWindowFocus`, `refetchOnReconnect`, and `refetchOnMount` all refetch **only when the data is stale**, so `staleTime: Infinity` suppresses all three with one option — adding `refetchOnWindowFocus: false` alongside it is redundant noise. Explicit `invalidateQueries` (from `useSignOut` and from the callback event) ignores `staleTime` entirely, so the two paths that *must* refresh still do. Precedent that non-default options are acceptable when justified: `useSystemTemplateDetail` sets `enabled`, `useBudgetStatus` sets `placeholderData`.
**Do not also set `retry: false`.** Leaving `retry` at the default 3 means a deterministic `AppError::Auth` (malformed keyring) shows `isLoading` for a few seconds before `isError` — harmless, since nothing in the app is gated on this query (NFR1) and 27.2/27.3 render a neutral state while loading. Keeping the deviation to exactly one option keeps the diff reviewable.

**Conflict B — `queryKeys.auth.session` is nested, but all 39 existing `queryKeys` entries are flat.**
`constants.ts:1-61` is a single flat object: `budgetGroups`, `expenses`, `financialHealthDetail`, … There is no nested group anywhere. But `epics-login.md#Story 27.1 AC 1` and `architecture-login.md#Naming Patterns` both specify `queryKeys.auth.session` by name, and `architecture-login.md#Enforcement Guidelines` names it a MUST.
**Resolution: add the nested `auth` group exactly as specified, and change nothing else.** This story introduces the first nested grouping in `queryKeys`; that is a deliberate, documented variance, not licence to restructure. **Do not** flatten it to `authSession` (that would break the architecture's enforcement rule and every downstream story's reference), and **do not** migrate any existing flat key into a nested group (that is a repo-wide refactor touching 22 hook files, guaranteed to blow the four-file footprint). The kebab-case *string array* convention from `docs/project-context.md#6` is fully satisfied — the nesting is in the accessor, the emitted key is still `["auth", "session"]`.

**Conflict C — the epic says the mutations invoke `start_login` / `sign_out` "with `snake_case` arguments", but both commands take no arguments.**
`epics-login.md#Story 27.1` AC 3 reads "…mutations invoking `start_login` and `sign_out` with `snake_case` arguments". Read literally, that invites a dev to invent an arguments object. Checked against the actual Rust signatures (§Prerequisite Gate): `start_login(app: tauri::AppHandle)` and `sign_out(<managed state>)` both take only Tauri-injected parameters, which are **never** sent from JavaScript, and `get_auth_session()` takes nothing at all.
**Resolution: all three `invoke` calls pass no second argument.** The epic clause is the platform-wide `snake_case`-IPC rule (`docs/project-context.md#2`) stated pre-emptively, not a requirement that arguments exist. Passing `{}`, `{ app: … }`, or any invented field would be a defect: extra keys in the payload are silently ignored today but become a hard deserialization error the moment Epic 26 adds a real parameter, and `{ app: … }` would collide with Tauri's injected `AppHandle`. Task 5's tests assert the exact single-element call arrays (`["start_login"]`, `["sign_out"]`, `["get_auth_session"]`) precisely to lock this in.

**Conflict D — where does the `auth:callback-received` listener live?**
Three candidate homes: (a) inside `useAuthSession()`; (b) a fourth exported hook that exactly one caller must remember to mount; (c) a `components/shared/AuthCallbackListener.tsx` mounted in `__root.tsx`, mirroring `RecurringApplyListener.tsx`.
(c) is out of footprint — `architecture-login.md#Delta to Existing Project Tree` lists only `AccountPromptDialog.tsx` and `ProfileMenu.tsx` as new components, and `__root.tsx`'s modification is owned by 27.2/27.3. (b) creates a silent failure mode: if nobody mounts it, sign-in appears to hang forever with no error anywhere — the single worst defect available in this story.
**Resolution: (a) — the `useEffect` lives inside `useAuthSession()`.** Both `epics-login.md#Story 27.1 AC 5` and `architecture-login.md#Integration Points` attribute the listener to the *module* (`useAuth.ts`), not to a separate mount point, and this guarantees the listener exists whenever anything reads the session.
**Accepted consequence, do not "fix" it:** 27.2 and 27.3 will each call `useAuthSession()`, so two `listen` channels will be open. Both handlers invalidate the same key in the same tick, and TanStack Query keeps one in-flight fetch per query key, so the observable result is a single refetch. **Do not** add a module-level `let listenerCount`, a singleton promise, a ref-count, or a `useRef` guard to dedupe them — a module-level singleton in a hook is exactly the hidden-shared-state anti-pattern `architecture-login.md#Component Boundaries` forbids, and it would break the unmount-cleanup guarantee AC #6 requires. The `cleaned` flag handles StrictMode's double-invoke; per-consumer duplication is by design.

### Existing Code to Copy (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| Hook file shape (canonical, smallest) | `hooks/useFinancialHealth.ts:1-31` | 2 × `useQuery` + 1 × `useMutation`; import order `@tanstack/react-query` → `@tauri-apps/api/core` → `@/lib/constants` → `import type … from "@/lib/types"`; `invoke<void>("cmd", …)` for unit-returning commands; `onSuccess: () => { queryClient.invalidateQueries({ queryKey: … }); }` |
| Zero-arg query hook | `useBudgetTemplates.ts` (`useSystemTemplates`) | `queryFn: () => invoke<T[]>("list_system_templates")` — no args object |
| Zero-arg mutation | `useBudgetTemplates.ts` (`useExportBudgetTemplate`) | `mutationFn: () => invoke<T \| null>("export_budget_template")` — no parameter, not `async` |
| Listener + cleanup (multi) | `hooks/useImport.ts:46-79` | `let cleaned = false; const unlisteners: UnlistenFn[] = []; const setup = async () => { … if (cleaned) { fns.forEach(fn => fn()); } else { unlisteners.push(...fns); } }; setup(); return () => { cleaned = true; unlisteners.forEach(u => u()); };` — **copy this structure** |
| Listener + cleanup (second precedent) | `hooks/useChat.ts:78-137` | Same `cleaned`-flag idiom with two listeners |
| Listener + invalidate (simplest, but racy) | `components/shared/RecurringApplyListener.tsx:9-26` | `let unlisten: (() => void) \| undefined` + `unlisten?.()`. Shows the `[queryClient]` dep array and the invalidate-on-event intent, **but its unguarded assignment leaks a listener if unmount wins the race** — take the dep array from here, take the guard from `useImport.ts` |
| Rust event emit precedent | `src-tauri/src/lib.rs:13,83` | `use tauri::{Emitter, Manager};` + `let _ = app_handle.emit("recurring:applied", created.len());` — colon-namespaced global emit, exactly what 26.4 mirrors for `auth:callback-received` |
| Import specifier for events | `hooks/useImport.ts:3` | `import { listen, type UnlistenFn } from "@tauri-apps/api/event";` |
| `queryKeys` shape | `lib/constants.ts:1-61` | 39 entries, every one `as const`; bare tuples for zero-arg keys, arrow factories for parameterized ones; last entry `financialHealthDetail: ["financial-health", "detail"] as const` (line 60). No nesting yet — this story adds the first |
| `lib/types.ts` conventions | `types.ts:216` (`number \| null`), `:278` / `:339-343` / `:517` (string-literal unions), `:627` (`AiProvider`) | Read-only `Option<T>` → `T \| null`; `export type X = "a" \| "b"` for plain unions. **No object discriminated union exists yet** — `AuthState` is the first, and `type` (not `interface`) is required for it |
| `QueryClient` instantiation | `main.tsx:11` | `const queryClient = new QueryClient();` — no `defaultOptions` anywhere in the app (§Conflict A) |
| StrictMode is on | `main.tsx:21,28` | `<React.StrictMode>` wraps the tree → effects double-invoke in dev → the `cleaned` guard is load-bearing, not decorative |
| Hook unit-test harness | `hooks/__tests__/useBudgetTemplates.test.tsx:1-113` | `declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }`; `vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }))`; module-scoped `let` for hook results; `Harness` returning `null`; `render()` = `act(() => root.render(<QueryClientProvider …>))`; `new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })`; `vi.spyOn(queryClient, "invalidateQueries")`; `invalidatedKeys()`; **bounded-poll `settleQueries(isSettled)` — 20 macrotask flushes max, polling render-derived state, never the mock's call record** |
| Vitest config | `vitest.config.ts` | `environment: "jsdom"`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` → `./src`, **no `setupFiles`** (no jest-dom matchers; plain `expect` only) |
| Scripts | `package.json` | `"test": "vitest run"`, `"build": "tsc && vite build"`. Package is **`@nixus/desktop`** |
| Frontend error shape | `src-tauri/src/error.rs` | Hand-written `impl Serialize` emitting `{ type, message, … }`; the Tauri promise rejects with that already-deserialized plain object. `AppError::Auth` adds `recoverable: bool` (Story 26.2) |
| Ad-hoc error parsing (do **not** generalise here) | `useChat.ts:166`, `useImport.ts:91`, `components/settings/CredentialsForm.tsx:23-36` | Each consumer inline-casts `err as { type?: string; message?: string }`. There is **no** shared helper and this story does not add one (AC #8) |

### Testing standards

`docs/project-context.md#Testing Rules` ("No unit test framework in desktop — all testing is Playwright E2E") and `epics-login.md#Additional Requirements` / `architecture-login.md#File Organization Patterns` ("Playwright E2E only") are **stale for the frontend**. Verified reality: `apps/desktop/vitest.config.ts` exists, `"test": "vitest run"` is wired, `vitest ^3.2.4` + `jsdom ^25.0.1` are devDependencies, and five specs already run under `src/` (`hooks/__tests__/useBudgetTemplates.test.tsx`, `hooks/__tests__/useTrendsInsight.test.tsx`, and three `locales/__tests__/*-i18n.test.ts`). Story 25.2's review confirmed and relied on this.

**This story therefore ships a Vitest spec, and that is the correct call rather than a deviation**: AC #6's two hardest guarantees — that the event handler invalidates the right key, and that the listener is unsubscribed on unmount — are invisible to `tsc` and unreachable from Playwright (nothing renders the hook, and no browser-side assertion can observe a Tauri `unlisten` call). Record the stale-doc variance in Completion Notes.

Conventions to honour: `apps/desktop/src/hooks/__tests__/*.test.tsx`; Given/When/Then comments on non-obvious cases; assert invalidation via `vi.spyOn(queryClient, "invalidateQueries")`, never by observing refetches; no `@testing-library/react`; no fake timers.

**E2E is explicitly out of scope.** `epics-login.md#Story 27.4` owns the Playwright spec, and there is nothing to assert until 27.2/27.3 mount UI.

### Anti-patterns for this story (do not do these)

- Adding a `components/auth/*.tsx` file, editing `routes/__root.tsx`, or touching `components/shared/TopBar.tsx` — 27.2/27.3 own all three.
- Adding `auth.*` keys to `locales/en.json` / `fr.json`.
- Creating an auth React context/provider, a `useState` copy of the session, or a module-level `let currentSession`.
- Flattening `queryKeys.auth.session` to `queryKeys.authSession`, or restructuring existing flat keys into nested groups.
- Adding `retry`, `gcTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount`, `enabled`, `select`, `placeholderData`, `throwOnError`, or `onError` to `useAuthSession()`.
- Returning a massaged value from `useAuthSession()` (`data ?? { status: "LoggedOut" }`, a destructured `{ session, isLoading }`, a computed `isLoggedIn` boolean) — 27.2 AC 3 and 27.3 AC 2 need the raw query object.
- `queryClient.setQueryData(queryKeys.auth.session, …)` anywhere, or `queryClient.clear()` in `useSignOut`.
- Invalidating the session in `useSignIn().onSuccess`.
- Invoking `handle_auth_callback` from the frontend, or importing `@tauri-apps/plugin-deep-link` / calling `onOpenUrl` in the webview.
- Listening for an invented `auth:callback-failed` event (26.4 emits none).
- Reading `event.payload` in the callback handler.
- Registering the listener without the `cleaned` guard, with a `[]` dep array closing over `queryClient`, or with no dep array at all.
- Adding a `getErrorMessage` / `isAppError` helper to `lib/types.ts`, `lib/utils.ts`, or a new `lib/errors.ts`.
- Storing any token in the webview: no `localStorage`, no `sessionStorage`, no cookie, no `queryClient` persister. `AuthState` carries no token by design (NFR2).
- Adding any dependency, or touching `apps/desktop/package.json`.

### Forward Risks (flagged for 27.2 / 27.3 / 27.4 — do not solve here)

1. **All 23 existing Playwright specs will break the moment a mounted component calls `useAuthSession()`.** Each spec's `setupTauriMock(page)` stubs `window.__TAURI_INTERNALS__.invoke` with a `switch (cmd)` whose `default:` is `Promise.reject("Unknown command: " + cmd)` (see `tests/accounts.spec.ts`). Story 27.2 mounts `AccountPromptDialog` in `__root.tsx`, which runs on **every** route — so every spec will need a `case "get_auth_session": return Promise.resolve({ status: "LoggedOut" });`. That is 27.2's cost, not this story's, but it is the single largest regression risk in Epic 27 and must be budgeted. This story is safe precisely because nothing imports `useAuth.ts` yet (AC #9).
2. **`components/shared/TopBar.tsx` carries an explicit design comment stating the product has no login** ("No account avatar: this is one user, one machine, no login, and a person-shaped glyph in the chrome implies an account the product does not have"), and its `<header>` is `justify-center` with a single centred search trigger and no right-side slot. Story 27.3 must both restructure that layout and delete/replace that comment — a deliberate design reversal a reviewer needs to see justified, not a silent edit.
3. **`SessionExpired` is sticky until the user acts.** Story 26.5 never clears the keyring on refresh failure, so `get_auth_session` returns `SessionExpired` on every launch until the user signs in again or signs out. Combined with `staleTime: Infinity` here, the user sees the expired state once per launch and it will not self-heal — 27.3 AC 6 owns telling them so and giving them the affordance.
4. **A deep-link sign-in that *fails* is invisible to the UI.** 26.4 §Conflict D emits `auth:callback-received` on success only and invents no failure event, so a failed callback surfaces only in the log file. The session simply stays `LoggedOut`; 27.3's rendering is the only user-visible consequence. Do not add a failure-path listener here.

### Project Structure Notes

Files touched — exactly four, matching `architecture-login.md#Delta to Existing Project Tree` (lines 209-223) for the frontend half of this feature:

```
apps/desktop/src/
├── lib/
│   ├── constants.ts        # MODIFIED: + queryKeys.auth.session
│   └── types.ts            # MODIFIED: + AuthState
└── hooks/
    ├── useAuth.ts          # NEW: useAuthSession, useSignIn, useSignOut
    └── __tests__/
        └── useAuth.test.tsx  # NEW: Vitest coverage (not in the architecture delta — see variance below)
```

The delta tree's remaining frontend entries (`components/auth/AccountPromptDialog.tsx`, `components/auth/ProfileMenu.tsx`, `routes/__root.tsx`) belong to Stories 27.2 and 27.3 and must not appear in this story's diff.

Alignment and variances:

- **Aligned:** `hooks/use{Feature}.ts`, one file per feature domain exporting several hooks (22 such files today; `useBudget.ts` alone exports 9) — `useAuth.ts` is the auth domain file. Do **not** append these hooks to an existing hook file, and do **not** split them into `useAuthSession.ts` / `useSignIn.ts`.
- **Aligned:** all IPC data-shape types in `lib/types.ts`; all query keys in `lib/constants.ts`; `@/` alias everywhere; `queryClient.invalidateQueries({ queryKey })` object form; `invoke<T>` always generically typed.
- **Variance (accepted, architecture-mandated):** `queryKeys.auth.session` is the first **nested** group in a 39-entry flat object — §Conflict B.
- **Variance (accepted, architecture-mandated):** `AuthState` is the first **object discriminated union** in `lib/types.ts` (existing unions are string-literal only, e.g. `types.ts:278`, `:339-343`, `:517`, `:627`), and the first type whose discriminant values are PascalCase rather than `snake_case` — forced by Rust's `#[serde(tag = "status")]` without `rename_all` (Story 26.2, reconfirmed in 26.5 §Project Structure Notes). Do not "normalise" it to `snake_case`.
- **Variance (accepted, justified):** `staleTime: Infinity` is the only query option — §Conflict A.
- **Variance (accepted, stale-doc correction):** a Vitest spec ships even though `docs/project-context.md#Testing Rules`, `epics-login.md`, and `architecture-login.md` all say the desktop app has no frontend unit tests — §Testing standards.
- **Not applicable:** money/`_cents` conventions (this story surfaces no amount), SQLite/`db/`/audit-log conventions (no DB touched), `routeTree.gen.ts` (no route added), i18n (no user-facing string).
- **Package scope note:** the workspace scope is **`@nixus/`** (`@nixus/desktop`, `@nixus/shared`); `docs/project-context.md` is stale where it says `@nkbaz/`. Use `pnpm --filter @nixus/desktop …`.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.1: Frontend Auth Session Hook & Query Key] — all seven primary acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics-login.md#Epic 27: Account Prompt & Minimalist Profile] — epic objective; Epic 27 is frontend-only and consumes Epic 26's finished IPC contract
- [Source: _bmad-output/planning-artifacts/epics-login.md#Epic List "Why two epics"] — Epic 27 depends on Epic 26, disjoint file sets (`src-tauri/**` vs `apps/desktop/src/**`)
- [Source: _bmad-output/planning-artifacts/epics-login.md#Additional Requirements] — frontend structure (`hooks/useAuth.ts`, `queryKeys.auth.session`, `AuthState` in `lib/types.ts`), single source of truth, `auth:callback-received` event, no SQLite, no webview token storage
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.2: Auth Models, Error Variant & Secure Session Storage] — `AuthState` = `LoggedOut | LoggedIn { email, name: Option<String> } | SessionExpired` with `#[serde(tag = "status")]`; `AppError::Auth { message, recoverable }`
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.4: PKCE Login Launch & Callback Token Exchange] — `start_login` returns `Result<(), AppError>`; `auth:callback-received` emitted on success only, payload carries no tokens; `handle_auth_callback` is deep-link-driven
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.5: Session Read, Launch Refresh & Sign-Out Commands] — `get_auth_session` returns `AuthState` (never a hard error for LoggedOut/SessionExpired), refresh only when expired, bounded 10s timeout, `sign_out` clears the keyring only
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.2: Account Prompt Dialog with Continue Offline] — consumes `useAuthSession()`/`useSignIn()`; must not flash open while loading
- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 27.3: Header Profile Menu & Minimalist Profile View] — consumes `useAuthSession()`/`useSignIn()`/`useSignOut()`; needs raw `isLoading`; both surfaces re-render from the same `["auth", "session"]` entry
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Frontend Architecture (lines 118-128)] — `useAuthSession` as a TanStack Query resource; mutations invalidate `auth.session`; the four-command IPC surface
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Naming Patterns (lines 152-160)] — `["auth", "session"]` in `queryKeys.auth.session`; `auth:callback-received` colon-namespaced; `hooks/useAuth.ts` exporting the three hooks
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Enforcement Guidelines (lines 177-188)] — use `queryKeys.auth.session`, never hardcode `["auth", "session"]`; never build the token exchange in the webview
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Architectural Boundaries (lines 229-242)] — `useAuth.ts` is the sole frontend `invoke` caller for auth; both UI surfaces are pure consumers; tokens never in webview storage
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Integration Points (lines 253-264)] — `useAuth.ts` listens for `auth:callback-received` and invalidates `["auth", "session"]`
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Process Patterns (lines 172-175)] — refresh checked once on launch, never polled; loading state via standard TanStack Query `isLoading`
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Delta to Existing Project Tree (lines 209-223)] — the exact frontend file footprint
- [Source: _bmad-output/implementation-artifacts/26-5-session-read-launch-refresh-and-sign-out-commands.md#get_auth_session decision table] — the seven states this hook's `data`/`error` can hold; `AuthState` PascalCase tag values are deliberate
- [Source: _bmad-output/implementation-artifacts/26-4-pkce-login-launch-and-callback-token-exchange.md] — `start_login(app: AppHandle)`; `app.emit("auth:callback-received", ())`; §Conflict D (no failure event)
- [Source: _bmad-output/implementation-artifacts/25-2-frontend-hook-for-budget-templates.md#Conflict A] — the "queryKey + queryFn only" convention and the cost-based reasoning behind it
- [Source: _bmad-output/implementation-artifacts/25-2-frontend-hook-for-budget-templates.md#Review Findings] — the single-`setTimeout(0)` flush is flaky (~65%); use the bounded poll on render-derived state
- [Source: docs/project-context.md#2 Tauri IPC Commands] — `invoke<T>("cmd", { snake_case_arg })`, arg names must match the Rust signature exactly
- [Source: docs/project-context.md#6 TanStack Query Keys] — all keys in `lib/constants.ts`, kebab-case string arrays, never hardcoded in hooks, mutations invalidate all affected keys
- [Source: docs/project-context.md#7 TypeScript Strictness] — `strict`, `noUnusedLocals`, `noUnusedParameters`, `@/*` alias
- [Source: docs/project-context.md#Hooks Pattern (Desktop)] — one file exports all hooks for a feature; `useMutation` + `onSuccess` invalidation shape
- [Source: docs/project-context.md#Code Quality & Style Rules] — WHY-only comments, no `console.log`
- [Source: docs/guidelines/warnings.md] — zero-warning policy referenced by CLAUDE.md
- [Source: apps/desktop/src/lib/constants.ts:1-61] — 40 flat `as const` entries; insertion point after `financialHealthDetail` (line 60)
- [Source: apps/desktop/src/lib/types.ts:216, 278, 339-343, 517, 627-633] — `T | null` for read-only `Option<T>`; existing unions are string-literal only; `AiConfig` is the last declaration (insertion point)
- [Source: apps/desktop/src/hooks/useFinancialHealth.ts:1-31] — canonical minimal hook file: import order, `invoke<void>`, `onSuccess` invalidation
- [Source: apps/desktop/src/hooks/useImport.ts:3, 46-79] — `import { listen, type UnlistenFn } from "@tauri-apps/api/event";` and the `cleaned`-flag listener/cleanup idiom
- [Source: apps/desktop/src/hooks/useChat.ts:78-137, 166] — second `cleaned`-flag precedent; inline error cast
- [Source: apps/desktop/src/components/shared/RecurringApplyListener.tsx:9-26] — `[queryClient]` dep array + invalidate-on-event; mounted at `routes/__root.tsx:153`
- [Source: apps/desktop/src/main.tsx:11, 21, 28] — bare `new QueryClient()` (no `defaultOptions`); `<React.StrictMode>` enabled
- [Source: apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx:1-113] — the Vitest harness to copy: `invokeMock`, `Harness`, `render`, `invalidatedKeys`, bounded-poll `settleQueries`
- [Source: apps/desktop/vitest.config.ts] — jsdom, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` alias, no `setupFiles`
- [Source: apps/desktop/package.json] — `@nixus/desktop`; `"test": "vitest run"`; `"build": "tsc && vite build"`; `@tauri-apps/api ^2.11.0`, `@tanstack/react-query ^5.90.21`, `vitest ^3.2.4`, `jsdom ^25.0.1`; no `@testing-library/react`
- [Source: apps/desktop/src-tauri/src/lib.rs:13, 83, 92-186] — `use tauri::{Emitter, Manager};`, the `recurring:applied` emit precedent, and the `generate_handler!` list that must contain the three auth commands before this story runs
- [Source: apps/desktop/src-tauri/src/error.rs] — hand-written `impl Serialize` emitting `{ type, message, … }`; this is the object the frontend promise rejects with
- [Source: apps/desktop/src/components/shared/TopBar.tsx] — the "no account avatar / no login" design comment and the `justify-center` header with no right-side slot (Forward Risk 2)
- [Source: apps/desktop/tests/accounts.spec.ts] — `setupTauriMock` switch-statement stub with a rejecting `default:` (Forward Risk 1)

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

**Task 0 — Prerequisite gate: ALL ROWS PASS. Epic 26 is landed.**

```
$ grep -n "start_login\|get_auth_session\|sign_out" apps/desktop/src-tauri/src/lib.rs
244:            commands::auth::start_login,
246:            commands::auth::get_auth_session,
247:            commands::auth::sign_out,

$ grep -n "pub enum AuthState" apps/desktop/src-tauri/src/models/mod.rs
754:pub enum AuthState {

$ grep -n "auth:callback-received" apps/desktop/src-tauri/src/commands/auth.rs
424:    let _ = app.emit("auth:callback-received", ());
672:/// `auth:callback-received`, a `sign_out`) re-read the keyring with no network

$ grep -rn "queryKeys.auth\|useAuthSession" apps/desktop/src
(no matches — clean slate)
```

**Recorded actual Rust reality (typed TS against this, not against the spec prose):**

`models/mod.rs:751-758` —
```rust
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AuthState {
    LoggedOut,
    LoggedIn { email: String, name: Option<String> },
    SessionExpired,
}
```
No `rename_all` → tags are PascalCase `"LoggedOut"` / `"LoggedIn"` / `"SessionExpired"`. `name` carries **no** `skip_serializing_if` → wire shape is `name: string | null`, **not** `name?: string`. Rust's own unit tests at `models/mod.rs:764+` assert `{"status":"LoggedIn","email":"…","name":"Nick"}`. AC #2 typed exactly as specified; **no deviation to report.**

Emit site is `app.emit("auth:callback-received", ())` — a global `AppHandle::emit`, **not** `emit_to`. Therefore the global `listen` from `@tauri-apps/api/event` is correct; `getCurrentWindow().listen` would have been required for a window-scoped emit.

Command signatures (`commands/auth.rs`) — all three JS-visible commands take **only Tauri-injected parameters**:
```
266: pub async fn start_login(app: AppHandle) -> Result<(), AppError>
430: pub async fn handle_auth_callback(app: AppHandle, callback_url: String) -> Result<(), AppError>
677: pub async fn get_auth_session() -> Result<AuthState, AppError>
721: pub fn sign_out(app: AppHandle) -> Result<(), AppError>
```
(`sign_out` takes `AppHandle`, not the managed pending-login `State<T>` the gate table predicted — immaterial to the frontend: both are injected, neither is sent from JS.)

**Task 4 — boundary greps (AC #7):**

```
$ grep -rn '"start_login"\|"get_auth_session"\|"sign_out"' apps/desktop/src
apps/desktop/src/hooks/useAuth.ts:37:    queryFn: () => invoke<AuthState>("get_auth_session"),
apps/desktop/src/hooks/useAuth.ts:46:    mutationFn: () => invoke<void>("start_login"),
apps/desktop/src/hooks/useAuth.ts:54:    mutationFn: () => invoke<void>("sign_out"),

$ grep -rn '"handle_auth_callback"' apps/desktop/src
(zero matches, rc=1)

$ grep -rn '\["auth", *"session"\]' apps/desktop/src
apps/desktop/src/lib/constants.ts:62:    session: ["auth", "session"] as const,

$ grep -rn 'plugin-deep-link\|onOpenUrl' apps/desktop/src
(zero matches, rc=1)
```

**Task 6 — gates, real output:**

```
$ pnpm --filter @nixus/desktop exec tsc --noEmit
=== tsc exit: 0 ===        (no output; zero errors, zero warnings)

$ pnpm --filter @nixus/desktop build          # tsc && vite build
> @nixus/desktop@0.3.2 build
> tsc && vite build
vite v7.3.2 building client environment for production...
✓ 4304 modules transformed.
dist/index.html                           0.51 kB │ gzip:   0.31 kB
dist/assets/index-B8aDU6Y-.css           67.93 kB │ gzip:  12.98 kB
dist/assets/index-4oTFTl3N.js         1,854.42 kB │ gzip: 536.95 kB
✓ built in 7.42s
```
(The `chunks are larger than 500 kB` note is Vite's pre-existing bundle-size advisory on the whole app, not a TypeScript warning and not introduced here.)

```
$ pnpm --filter @nixus/desktop exec vitest run
 RUN  v3.2.4 /Users/nbazinet/projects/nixus/apps/desktop
 ✓ src/locales/__tests__/maintenance-i18n.test.ts (2 tests) 3ms
 ✓ src/locales/__tests__/danger-zone-i18n.test.ts (19 tests) 6ms
 ✓ src/locales/__tests__/budget-templates-i18n.test.ts (61 tests) 4ms
 ✓ src/lib/__tests__/agents.test.ts (4 tests) 2ms
 ✓ src/hooks/__tests__/useTrendsInsight.test.tsx (1 test) 14ms
 ✓ src/hooks/__tests__/useAuth.test.tsx (8 tests) 32ms
 ✓ src/hooks/__tests__/useBudgetTemplates.test.tsx (16 tests) 36ms

 Test Files  7 passed (7)
      Tests  111 passed (111)
```
111 total (103 pre-existing + 8 new). Every pre-existing spec passes unchanged.

```
$ cd apps/desktop && pnpm exec playwright test
  3 failed
    tests/chat.spec.ts:250:3 › money in an answer is tabular Inter, never monospace [AC4]
    tests/design-system.spec.ts:110:1 › spine colour tokens reach the document root
    tests/maintenance.spec.ts:1403:3 › multiple vehicles appear in garage list
  330 passed (1.7m)
```
No spec failed with `Unknown command: get_auth_session` — confirming nothing mounts these hooks (AC #9). Triage of the three failures in Completion Notes.

```
$ git diff --stat -- apps/desktop/src apps/web packages apps/desktop/tests
 apps/desktop/src/lib/constants.ts | 3 +++
 apps/desktop/src/lib/types.ts     | 5 +++++
 2 files changed, 8 insertions(+)
```
Pure additions; zero existing lines modified, reordered, or reformatted.

### Completion Notes List

**Outcome:** all 11 ACs satisfied. Footprint is exactly the four specified files — 2 modified (8 added lines, 0 changed), 2 new. Zero Rust, zero UI, zero i18n, zero dependency, zero Playwright spec, no version bump, no commit.

**Conflict resolutions recorded (all four re-confirmed against reality, none re-derived):**

- **§Conflict C (the one the epic actively invites you to get wrong).** `epics-login.md` Story 27.1 AC 3's "…mutations invoking `start_login` and `sign_out` with `snake_case` arguments" was resolved as the platform-wide IPC naming rule stated pre-emptively, **not** as a claim that arguments exist. Verified against the actual signatures: `start_login(app: AppHandle)`, `get_auth_session()`, `sign_out(app: AppHandle)` — every JS-visible parameter list is empty, since `AppHandle` is Tauri-injected and never crosses IPC. **All three `invoke` calls therefore pass no second argument.** Passing `{}` or an invented `{ app }` would be silently ignored today and become a hard deserialization error the moment Epic 26 adds a real parameter. Three tests assert the exact single-element call arrays (`["get_auth_session"]`, `["start_login"]`, `["sign_out"]`) to lock this in permanently.
- **§Conflict A.** `staleTime: Infinity` is the sole non-default query option, with the single WHY comment. No `retry`, `gcTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount`, `enabled`, `select`, `placeholderData`, `throwOnError`, or `onError`. In v5 the three refetch-on-* options only fire when data is stale, so one option suppresses all three; explicit `invalidateQueries` ignores `staleTime`, so both paths that must refresh still do. No `refetchInterval`, no polling, no background timer — launch-only refresh stays owned by Rust (26.5 AC 5).
- **§Conflict B.** `queryKeys.auth` added as the first **nested** group in the otherwise-flat 40-entry object, appended after `financialHealthDetail` so the auth cluster is contiguous and last. Not flattened to `authSession`; no existing flat key migrated.
- **§Conflict D.** The listener lives inside `useAuthSession()` (option a). No `AuthCallbackListener.tsx`, no fourth "remember to mount me" hook. Per-consumer duplication in 27.2/27.3 is accepted by design — no module-level `let`, singleton promise, ref-count, or `useRef` dedupe guard was added.

**The high-risk ACs, explicitly:**

- `useAuthSession()` returns the **raw `useQuery` result, unwrapped**. No `data ?? { status: "LoggedOut" }`, no `isLoading`-collapsing wrapper, no destructuring, no computed `isLoggedIn`. 27.2 AC 3 / 27.3 AC 2 need raw `isLoading`, and a synthesised `LoggedOut` default would make "still loading" indistinguishable from "no account".
- `useSignOut()` **invalidates only** `queryKeys.auth.session` — no `setQueryData`, no `queryClient.clear()`, no `removeQueries()`, no unrelated domain key. The keyring stays the single source of truth.
- `useSignIn()` has **no `onSuccess`** and invalidates nothing: `start_login` only opens the system browser, so sign-in completes asynchronously via the deep-link callback.
- Listener uses `@tauri-apps/api/event`'s `listen` — **not** `@tauri-apps/plugin-deep-link`'s `onOpenUrl` (that package is installed by 26.3 but is not imported here; grep confirms zero matches). No type generic, `event.payload` never read, no invented `auth:callback-failed` listener.
- Dependency array is exactly `[queryClient]` (per `RecurringApplyListener.tsx:9-26`), with the mandatory `cleaned` flag from `useImport.ts:46-79` — never `[]` closing over `queryClient`, never absent. StrictMode's double-invoke is what makes the guard load-bearing.
- `handle_auth_callback` is **never** invoked from JS; a dedicated test asserts it across every recorded call.
- Zero suppressions: no `as any`, no `@ts-ignore`, no `@ts-expect-error`.

**Test-harness notes:**

- `@testing-library/react` was **not** added and not imported. Used the in-repo idiom from `useBudgetTemplates.test.tsx`: raw `createRoot` + `act` with `IS_REACT_ACT_ENVIRONMENT`, headless harnesses assigning to module-scoped `let`s, `vi.mock("@tauri-apps/api/core", …)`.
- Harnesses are **split** as mandated: `MutationsHarness` (rendered in `beforeEach`) vs `SessionHarness` (rendered only inside the session/listener/error tests), so the mutation tests can legitimately assert on `invokeMock.mock.calls[0]`.
- `listen` is mocked as an **async** fn returning a fresh `vi.fn()` unlisten pushed onto `unlistenMocks`, which is what makes the hook's `await listen(...)` work and the unmount-cleanup assertion possible.
- `settleQueries`' default predicate was retargeted to this file's own state (`authSession !== undefined && !authSession.isLoading`); the bounded 20-flush poll was kept rather than the single `setTimeout(0)` that Story 25.2's review measured at ~65% flake.
- `afterEach` is guarded by an `unmounted` flag so the unmount test does not unmount the same root twice.
- **One real bug found and fixed by the suite during development:** the event-fire helper originally *returned* the captured handler instead of calling it, so the listener test failed with `expected [] to deeply equal [["auth","session"]]`. Renamed to `fireCallbackEvent()` which invokes it. Worth noting because the failure mode was a false negative in the test, not in the hook — the assertion was strong enough to catch its own harness defect.

**Playwright triage — effective result equals the verified baseline of 331 passed / 2 failed.**

Two of the three failures are the known pre-existing baseline failures at HEAD `9b45411`, both caused by that commit's rewrite of `packages/shared/src/styles/tokens.css` and unrelated to auth: `tests/chat.spec.ts:250` (tabular-Inter font assertion) and `tests/design-system.spec.ts:110` (spine colour tokens).

The third, `tests/maintenance.spec.ts:1403 › multiple vehicles appear in garage list`, is a **flake** — a slide-over close/animation timing race (`expect(vehicle-slide-over).not.toBeVisible()` polled 9× at 5 s). Re-run in isolation:
```
$ pnpm exec playwright test tests/maintenance.spec.ts -g "multiple vehicles appear in garage list"
  ✓  1 tests/maintenance.spec.ts:1403:3 › multiple vehicles appear in garage list (1.4s)
  1 passed (2.0s)
```
It is structurally impossible for this story to have caused it: the entire diff is 8 added lines in two files plus two files that **nothing imports** (AC #9's greps confirm no importer of `useAuth.ts`), so no component's render path changed at all.

**Documented variances (all pre-approved by the story, restated for the reviewer):**

1. **Vitest spec shipped** even though `docs/project-context.md#Testing Rules`, `epics-login.md`, and `architecture-login.md` all claim the desktop app is Playwright-E2E-only. Those docs are **stale for the frontend**: `apps/desktop/vitest.config.ts` exists, `"test": "vitest run"` is wired, and 6 spec files already ran under `src/` before this story. AC #6's two hardest guarantees (handler invalidates the right key; listener unsubscribes on unmount) are invisible to `tsc` and unreachable from Playwright.
2. **First nested `queryKeys` group** in a previously 100%-flat object (§Conflict B) — architecture-mandated.
3. **First object discriminated union in `lib/types.ts`**, and the first type with PascalCase discriminant values (existing unions are string-literal only). Forced by Rust's `#[serde(tag = "status")]` without `rename_all`; deliberately not normalised to `snake_case`.
4. **`staleTime: Infinity`** deviates from Story 25.2's "queryKey + queryFn only" convention (§Conflict A) — justified because `get_auth_session` can perform a 10 s Cognito refresh POST, unlike the no-IO reads that convention was written for.
5. **Package scope is `@nixus/*`**, not the `@nkbaz/*` in `docs/project-context.md`. That doc is stale; it was not "corrected" back and was not edited.

**Untouched, confirmed:** everything under `apps/desktop/src-tauri/`, `apps/web/`, `packages/`, `apps/desktop/src/components/`, `apps/desktop/src/routes/` (incl. `__root.tsx`, `routeTree.gen.ts`), `apps/desktop/src/locales/*.json`, `apps/desktop/tests/`, `apps/desktop/package.json`, and the `0.3.2` version in `package.json` / `tauri.conf.json` / `Cargo.toml`. The `src-tauri/**`, `package.json`, `pnpm-lock.yaml`, and `docs/project-context.md` entries in `git status` were **already dirty before this story began** (Epic 26's uncommitted work) and were not touched here. Nothing was committed or pushed.

**Forward risk restated for 27.2 (not solved here, by design):** the moment a mounted component calls `useAuthSession()`, every Playwright spec's `setupTauriMock` — whose `switch (cmd)` ends in `default: Promise.reject("Unknown command: " + cmd)` — will need `case "get_auth_session"`. That cost belongs to 27.2.

### File List

- `apps/desktop/src/lib/constants.ts` — MODIFIED: appended the nested `auth: { session: ["auth", "session"] as const }` group after `financialHealthDetail` (+3 lines, 0 existing lines changed)
- `apps/desktop/src/lib/types.ts` — MODIFIED: appended `export type AuthState` discriminated union after `AiConfig` (+5 lines, 0 existing lines changed)
- `apps/desktop/src/hooks/useAuth.ts` — NEW: `useAuthSession` (query + `auth:callback-received` listener), `useSignIn`, `useSignOut`
- `apps/desktop/src/hooks/__tests__/useAuth.test.tsx` — NEW: 8 Vitest cases covering the Task 5 table

### Review Findings

Adversarial review of Story 27.1's four files only: `lib/constants.ts` (+3), `lib/types.ts` (+5), `hooks/useAuth.ts` (NEW), `hooks/__tests__/useAuth.test.tsx` (NEW). Epic 26's `src-tauri/**`, `package.json`, `pnpm-lock.yaml`, `docs/project-context.md`, `CONTRIBUTING.md`, and the planning-artifact edits were read only to cross-check the wire contract, not reviewed. Nothing in the Dev Agent Record was trusted — every gate was re-run.

**Verdict: NO BLOCKING FINDINGS.** All 11 acceptance criteria are implemented as specified and independently verified, including the two highest-risk ones (AC 9 import isolation and AC 3's unwrapped `useQuery` return). The two findings below are NON-BLOCKING test-hardening items; neither is an AC violation and neither should hold the story. This is an unhedged pass.

#### BLOCKING

None.

#### NON-BLOCKING

**NB-1 — The `cleaned`-flag guard is correct but not regression-locked; the late-resolve branch is dead to the suite.** `apps/desktop/src/hooks/useAuth.ts:20-24` · `apps/desktop/src/hooks/__tests__/useAuth.test.tsx:193-208`
The hook's race handling is genuinely correct on both interleavings — verified by reading, not by assuming. If `listen()` resolves *before* unmount, the `unlisten` is pushed and the cleanup at useAuth.ts:31 calls it; if it resolves *after* unmount, `cleaned` is already `true` and useAuth.ts:21 calls `unlisten()` immediately. This is **not** the "skips assignment without unsubscribing" leak §AC 6 warns about. However, no test drives the second interleaving: because the `listen` mock resolves within the `settleQueries` poll that precedes every unmount, `cleaned` is always `false` when `setup()` completes. Mutating useAuth.ts:20-24 from `if (cleaned) { unlisten(); } else { unlisteners.push(unlisten); }` to `if (!cleaned) { unlisteners.push(unlisten); }` — i.e. reintroducing the exact leak AC 6 calls the guard "mandatory" for — leaves **all 8 tests passing**. The `unsubscribes the callback listener on unmount` test only covers the resolve-before-unmount path.
*Why not blocking:* the shipped code is correct, AC 6's requirement is met, and AC 10's list of eight required behaviours does not include this branch — Task 5's table asks only that "unmounting the tree calls every recorded `unlisten`", which it does. The guard's value is realised in dev StrictMode and in 27.2/27.3 remount cycles, not in a green/red assertion today.
*Fix (recommend folding into 27.2 or 27.4, no rework needed here):* add one case that defers resolution — hold `listen`'s resolver instead of returning immediately (`let release: (fn: UnlistenFn) => void; listenMock.mockImplementation(() => new Promise((r) => { release = r; }))`), render `SessionHarness`, `act(() => root.unmount())` with `unmounted = true`, *then* `await act(async () => release(unlistenSpy))`, and assert `unlistenSpy` was called. That test fails under the mutation above and passes against the current code.

**NB-2 — AC 10's "invokes `get_auth_session` **once**" is asserted for shape but not for count.** `apps/desktop/src/hooks/__tests__/useAuth.test.tsx:124-135`
AC 10's first bullet reads "invokes `"get_auth_session"` **once** with **no** second argument". The test asserts `invokeMock.mock.calls[0]` equals `["get_auth_session"]` — locking the zero-argument shape (mutation-proven, see Evidence D) — but never asserts the call count, so a duplicate fetch would pass. The sibling `starts login without arguments…` test does assert `toHaveBeenCalledTimes(1)` (useAuth.test.tsx:159), which makes the omission look accidental rather than considered. Task 5's binding table for this case asks only for `mock.calls[0]` and `authSession.data`, so the implementation matches the authoritative spec text and the "once" clause survives only in AC 10's prose.
*Why not blocking:* with a single mount and one query key, TanStack Query structurally guarantees one in-flight fetch, and `staleTime: Infinity` removes every refetch trigger — there is no realistic path to a second call. Purely a strictness gap in the assertion, not a defect.
*Fix:* add `expect(invokeMock).toHaveBeenCalledTimes(1);` at useAuth.test.tsx:133, alongside the existing call-array assertion.

#### Informational — reviewed and dismissed, no change requested

- **AC 7's third grep returns four hits the AC text does not predict, and that is correct.** `grep -rn '\["auth", *"session"\]' apps/desktop/src` yields `lib/constants.ts:62` **plus** `useAuth.test.tsx:146,147,173,190`. AC 7 states the expected output is "only `lib/constants.ts`". There is no violation: AC 10 explicitly *requires* the raw literal in the test ("`queryClient.getQueryData(["auth", "session"])` is defined — this is the only assertion that would catch a wrong key literal in `constants.ts`"), AC 3 scopes its prohibition to "`useAuth.ts` or … any component", the epic's clause is "no component or hook hardcodes", and `architecture-login.md#Enforcement Guidelines` says "never hardcode `["auth", "session"]` inline **in a hook or component**". A `__tests__` spec is neither. Mutation M5 (Evidence D) proves those four literals earn their place — flattening the key in `constants.ts` fails three tests. Flagged only so a future reviewer running AC 7's grep verbatim does not mistake the hits for a boundary breach.
- **`useAuthSession()` is imported by nothing.** This is AC 9, deliberate and load-bearing — it is the sole reason the Playwright suite is still at baseline. Not a defect; explicitly not reported as one.
- **`queryKeys.auth` makes the previously 100%-flat `queryKeys` object heterogeneous** (nested object beside 40 arrays/factories). Confirmed harmless: `grep` for `Object.keys(queryKeys)` / `Object.values(queryKeys)` / `Object.entries(queryKeys)` / `queryKeys[` / `typeof queryKeys` across `apps/desktop/src`, `apps/desktop/tests`, and `packages` returns **zero** matches, so no consumer iterates or index-accesses the object and no existing key resolution changes. §Conflict B is satisfied.
- **`setup()` is a floating promise with no `.catch()`** (useAuth.ts:27). Identical to the three in-repo precedents (`useImport.ts:73`, `useChat.ts`, `RecurringApplyListener.tsx:21`) and to AC 6's mandated code block, so not a deviation. Empirically harmless in the E2E harness — see the forward-risk refinement below.

#### Forward-risk refinement for 27.2 (informational, not a finding against 27.1)

The story's Forward Risk 1 is confirmed and can now be scoped more precisely. `@tauri-apps/api/event`'s `listen` is itself an IPC call — `event.js:76` does `invoke('plugin:event|listen', …)` — so a mounted `useAuthSession()` reaches the Playwright `setupTauriMock` switch **twice**, not once. But only `get_auth_session` will actually need a new `case`: `RecurringApplyListener` is already mounted unconditionally at `routes/__root.tsx:153`, and only 5 of the 23 specs stub `plugin:event` at all, so the other 18 already let `plugin:event|listen` fall through to `default: Promise.reject("Unknown command: …")` — with the suite at 331 green. That rejection is provably tolerated today. 27.2's mock work is therefore exactly `case "get_auth_session": return Promise.resolve({ status: "LoggedOut" });` across the specs, and adding a `plugin:event|listen` case is unnecessary.

#### Pre-existing / deferred — explicitly NOT this story's defects

- **2 Playwright failures**, both reproduced in this review's own full run: `tests/chat.spec.ts:250` (tabular-Inter font) and `tests/design-system.spec.ts:110` (spine colour tokens). Baseline at `9b45411` is `331 passed / 2 failed`; both trace to that commit's rewrite of `packages/shared/src/styles/tokens.css`. This story touches no CSS and no mounted component.
- **`tests/maintenance.spec.ts:1403` — flake, dev's triage confirmed.** It **passed** in this review's independent full-suite run, so no isolation re-run was needed to clear it. Structurally impossible for this story to have caused it: the diff is 8 added lines plus two files nothing imports.
- **Vite `chunks are larger than 500 kB` advisory** — pre-existing, app-wide, not a TypeScript diagnostic.
- **Epic 26 dirty tree** — `apps/desktop/src-tauri/**` (incl. untracked `commands/auth.rs`), `package.json`'s single `@tauri-apps/plugin-deep-link` line, `pnpm-lock.yaml`, `docs/project-context.md`, `CONTRIBUTING.md`, and the planning-artifact edits were already dirty before this story and are untouched by it. Verified: `git diff -- apps/desktop/package.json` is exactly one added dependency line, and it is 26.3's.
- **`docs/project-context.md#Testing Rules` is no longer stale.** Completion-Notes variance 1 is now moot in one respect: the current file (lines 288-295) already documents "Vitest + jsdom for unit tests … hook tests (`src/hooks/__tests__/*.test.ts`) — no `@testing-library/react` dependency, tests use `createRoot`/`act` directly". The Vitest spec is squarely in-convention, not a documented exception. That doc edit is not this story's.

#### Independently verified — evidence

**A. AC 9 — import isolation and suite integrity. The single highest-risk AC: CLEAN.**

| Check | Command | Result |
|---|---|---|
| Hook identifiers | `grep -rn --include=*.ts --include=*.tsx "useAuth\|useSignIn\|useSignOut" apps/desktop/src` | 12 hits, **all** in `hooks/useAuth.ts` (3 declarations) and `hooks/__tests__/useAuth.test.tsx` (9). Zero importers. |
| Auth command strings | `grep -rn '"start_login"\|"get_auth_session"\|"sign_out"\|"handle_auth_callback"' apps/desktop/src` | only `useAuth.ts:37,46,54` + the test's assertions. `"handle_auth_callback"` appears solely inside the test's negative assertion. |
| Wiring sites | `grep -n "auth\|Auth" routes/__root.tsx components/shared/TopBar.tsx main.tsx` | **zero matches** in all three |
| E2E specs | `grep -rn "get_auth_session\|useAuth" apps/desktop/tests` | **zero matches** |
| Full Playwright suite | `pnpm exec playwright test --reporter=list` | **331 passed / 2 failed (1.6m)** — byte-for-byte the verified `9b45411` baseline |
| The decisive check | `grep -c "Unknown command" /tmp/pw-full.log` | **0** — and `grep "get_auth_session\|start_login\|sign_out\|auth:callback"` over the whole log returns **zero** hits. No spec touched the auth surface at all. |

**B. AC 3 — the return value is the raw `useQuery` result. CLEAN.** `useAuth.ts:35-41` is `return useQuery({ … });` with no wrapper, no intermediate variable and no post-processing. Confirmed absent by reading the full 59-line file: no `data ?? { status: "LoggedOut" }`, no `select`, no destructuring into `{ session, isLoading }`, no computed `isLoggedIn`/`isAuthenticated`, no `isLoading`-collapsing return. `staleTime: Infinity` (useAuth.ts:40) is the only non-default option — no `retry`, `gcTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount`, `enabled`, `placeholderData`, `throwOnError`, `onError`, and no `try`/`catch`. 27.2 AC 3 / 27.3 AC 2 get the raw `isLoading` they need. `grep` for `refetchInterval|setInterval|setTimeout|localStorage|sessionStorage|oauth2|fetch(|PKCE` over `useAuth.ts` returns exactly one hit — the word "token" inside the `staleTime` WHY comment. No polling, no background timer, no webview token handling, no Cognito call from the frontend; launch-only refresh stays owned by Rust.

**C. AC 1/2 — key and type cross-checked against the Rust wire shape. EXACT MATCH.** `models/mod.rs:751-758` is `#[serde(tag = "status")]` with **no** `rename_all`, and `LoggedIn { email: String, name: Option<String> }` carries **no** `skip_serializing_if`. Rust's own literal-JSON tests at `models/mod.rs:764-800` pin all three variants, including `auth_state_logged_in_serializes_absent_name_as_null` → `{"status":"LoggedIn","email":"user@example.com","name":null}`. The TS union at `types.ts:635-638` is therefore correct as `name: string | null` — `name?: string` would have been the blocking error, and it was avoided. Tags are PascalCase, `type` not `interface`, no `sub` field. `constants.ts:61-63` is `auth: { session: ["auth", "session"] as const }`, nested, appended after `financialHealthDetail` (line 60). `git diff --numstat` = `3 0` and `5 0`: **pure additions, zero existing lines changed, reordered or reformatted.**

**D. AC 5/6/10 — the guards are load-bearing, proven by mutation.** SHA-256 of both new files captured before and re-verified `OK` after every mutation (`shasum -a 256 -c`); `constants.ts` likewise. All files byte-identical at close.

| # | Mutation | Result |
|---|---|---|
| M1 | delete `useSignOut`'s `onSuccess` invalidation | `invalidates the session after signing out` **FAILED** — `expected [] to deeply equal [["auth","session"]]` (7 passed / 1 failed) |
| M2 | `invoke<void>("start_login")` → `invoke<void>("start_login", {})` | `starts login without arguments…` **FAILED** — `expected ["start_login", {}] to deeply equal ["start_login"]` (7 passed / 1 failed) |
| M3 | drop `unlisteners.forEach((u) => u())` from the cleanup | `unsubscribes the callback listener on unmount` **FAILED** — `expected false to be true` (7 passed / 1 failed) |
| M4 | `if (cleaned) { unlisten(); } else { push }` → `if (!cleaned) { push }` (the late-resolve leak) | **8 passed — branch uncovered.** This is NB-1. |
| M5 | `constants.ts` key → `["auth-session"]` | **3 FAILED** (`caches the session under the shared auth query key`, `invalidates the session after signing out`, `invalidates the session when the deep-link callback event fires`) — AC 10's claim that `getQueryData` is what catches a wrong key literal is validated |

**E. AC 4/5 — cache coherence. CLEAN.** `useSignOut` (useAuth.ts:50-58) invalidates `queryKeys.auth.session` and nothing else: no `setQueryData`, no `queryClient.clear()`, no `removeQueries`, no unrelated domain key — the keyring stays the single source of truth. `useSignIn` (useAuth.ts:44-48) has **no** `onSuccess` and invalidates nothing, correctly deferring to the deep-link callback; `expect(invalidateSpy).not.toHaveBeenCalled()` at useAuth.test.tsx:161 locks it. `handle_auth_callback` is never invoked from JS, asserted across every recorded call at useAuth.test.tsx:248-250 — and that assertion is non-vacuous because the same test drives both mutations and the session query first, so `invokeMock.mock.calls` is non-empty when `.every()` runs.

**F. AC 3/§Conflict C — zero-argument IPC, cross-checked against the real signatures.** `commands/auth.rs:266` `start_login(app: AppHandle)`, `:677` `get_auth_session()`, `:721` `sign_out(app: AppHandle)` — every JS-visible parameter list is empty; `AppHandle` is Tauri-injected. All three registered at `lib.rs:244-247`. All three `invoke` calls pass no second argument and both `mutationFn`s take no parameter, neither declared `async`. The epic's "with `snake_case` arguments" trap was correctly resisted, and M2 proves an invented arguments object cannot slip in unnoticed. (`sign_out` takes `AppHandle`, not the `State<T>` the §Prerequisite Gate predicted — immaterial to the frontend, both injected; the dev recorded the discrepancy.)

**G. AC 6 — event listener. CLEAN.** `listen` + `type UnlistenFn` imported from `@tauri-apps/api/event` (useAuth.ts:4), never bare `@tauri-apps/api`; `@tauri-apps/plugin-deep-link` and `onOpenUrl` return **zero** matches across `apps/desktop/src` despite the package being installed by 26.3. Event name is exactly `"auth:callback-received"`, matching 26.4's global `app.emit("auth:callback-received", ())` at `commands/auth.rs:424` — a global emit, so the global `listen` is the right seam (a `emit_to` would have required `getCurrentWindow().listen`). No type generic, handler takes no parameter so `event.payload` cannot be read, no invented `auth:callback-failed` listener. Handler invalidates `queryKeys.auth.session` only. Dependency array is exactly `[queryClient]` (useAuth.ts:33), matching `RecurringApplyListener.tsx:26` — not `[]` closing over `queryClient`, not absent. Race analysis in NB-1.

**H. AC 10 — the suite is real, not decorative.** `pnpm --filter @nixus/desktop exec vitest run` → exit 0, **111 passed / 111 (7 files)**: 103 pre-existing + 8 new, every pre-existing spec unchanged. `@testing-library/react` is **not** imported and **not** in `package.json` — the only repo-wide match is the explanatory comment at useAuth.test.tsx:32, mirroring `useBudgetTemplates.test.tsx:32`. Harness is the in-repo idiom: `createRoot` + `act` + `IS_REACT_ACT_ENVIRONMENT`, `vi.mock("@tauri-apps/api/core")`, module-scoped `let`s, split `MutationsHarness`/`SessionHarness`, bounded-poll `settleQueries` (20 flushes, render-derived predicate) rather than the ~65%-flaky single `setTimeout(0)`. The `listen` mock **is** async (useAuth.test.tsx:99-103) and returns a fresh `vi.fn()` unlisten, so the hook's `await` resolves and the unmount assertion is observable. **The disclosed harness defect is fixed:** `fireCallbackEvent()` (useAuth.test.tsx:87-90) destructures the captured handler and **calls** it — `handler();` — so the listener test is not vacuous; M4's *lack* of failure is a branch-coverage gap, not a broken invoker. The unmount test guards `.every()` with `expect(unlistenMocks.length).toBeGreaterThan(0)` at useAuth.test.tsx:199, so it cannot pass vacuously on an empty array, and `afterEach` is guarded by the `unmounted` flag (useAuth.test.tsx:111,116,202) so the same root is never unmounted twice.

**I. AC 11 + scope + guardrails.**

| Check | Result |
|---|---|
| `pnpm --filter @nixus/desktop exec tsc --noEmit` | **exit 0, zero output** — zero errors, zero warnings under `strict` + `noUnusedLocals` + `noUnusedParameters` |
| `pnpm --filter @nixus/desktop build` (`tsc && vite build`) | **exit 0**, `✓ built in 6.40s`; only the pre-existing app-wide chunk-size advisory |
| Footprint | `git status --short apps/desktop/src apps/desktop/tests packages apps/web` → exactly `M constants.ts`, `M types.ts`, `?? useAuth.ts`, `?? useAuth.test.tsx`. **Four files.** Nothing in `components/`, `routes/` (incl. `__root.tsx`, `routeTree.gen.ts`), `locales/`, `tests/`, `packages/`, `apps/web/`. |
| Dependencies | `apps/desktop/package.json` diff is one line: `@tauri-apps/plugin-deep-link` (26.3's). **No** dependency added by this story; no `@testing-library/react`. |
| Type suppressions | `grep "as any\|@ts-ignore\|@ts-expect-error\|eslint-disable"` over both new files → **zero hits** |
| Version | `0.3.2` in `package.json:4`, `tauri.conf.json:4`, `Cargo.toml:3` — unchanged |
| Feature guardrails | no keyring access, no Cognito token exchange, no `fetch`, no PKCE, no `oauth2` URL, no `localStorage`/`sessionStorage`/cookie/persister anywhere in the frontend. No auth context, provider, reducer, `useState` mirror, module-level `let`, or ref-count dedupe — the query cache is the sole source of truth (§Conflict D honoured). No `t()`, `useTranslation`, toast, error boundary, or retry policy. |
| Convention parity | Compared against `useFinancialHealth.ts:1-31` (import order, `invoke<void>` for unit commands, `onSuccess` invalidation shape), `useBudgetTemplates.ts` (zero-arg query/mutation form, non-`async` `mutationFn`), `useImport.ts:3,46-79` (event specifier + `cleaned`-flag idiom, structurally identical) and `RecurringApplyListener.tsx:9-26` (`[queryClient]` dep array). `@/` alias throughout, never relative. Exactly one comment in the file — the `staleTime` WHY. Full parity; nothing to correct. |
| `docs/project-context.md` | §2 (IPC), §6 (keys in `constants.ts`, never hardcoded in a hook), §7 (strictness), §Hooks Pattern, §Code Quality, §Testing Rules all satisfied |

### Change Log

- 2026-08-09 — Story 27.1 implemented: added `queryKeys.auth.session`, the `AuthState` TS union, `hooks/useAuth.ts` (`useAuthSession` / `useSignIn` / `useSignOut` + deep-link callback listener), and 8 Vitest cases. `tsc --noEmit` clean; `vitest run` 111/111; Playwright at baseline (2 known pre-existing failures, 1 confirmed flake). Status → review.
- 2026-08-09 — Adversarial code review completed. **No blocking findings.** 2 non-blocking test-hardening items recorded (NB-1 `cleaned`-branch coverage gap, NB-2 missing `get_auth_session` call-count assertion). Gates independently re-run: `tsc --noEmit` exit 0, `build` exit 0, `vitest` 111/111, Playwright **331 passed / 2 failed** = exact `9b45411` baseline with **zero** `Unknown command` occurrences; `maintenance.spec.ts:1403` passed, confirming the flake. 5 mutations applied and reverted with SHA-256 verification.
