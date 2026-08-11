---
baseline_commit: 835daccc2e96c73ce7b0c95e8c35b816d7055cf7
epic: 28
story: 1
---

# Story 28.1: Reach my profile from the account menu

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in Nixus user,
I want a Profile item in my account dropdown that opens a profile page,
so that I have a place to see and manage who I am in Nixus.

## Acceptance Criteria

Copied faithfully from `_bmad-output/planning-artifacts/epics-user-profile.md#Story 28.1`. AC 9 is derived (marked as such) and is not in the epic.

**AC 1 — Profile item exists and navigates.**
**Given** I am signed in
**When** I open the account dropdown in the top-right
**Then** I see a "Profile" item alongside "Sign out"
**And** selecting it navigates me to `/profile`

**AC 2 — No new IPC, `render`-prop composition, no mock churn.**
**Given** the Profile item is rendered
**When** the dropdown mounts
**Then** `ProfileMenu` makes no new `invoke()` call of any kind
**And** the item is a `DropdownMenuItem render={<Link to="/profile" />}`, not a nested anchor
**And** no existing Playwright spec's Tauri mock requires a new command case

**AC 3 — Signed out: no dropdown, no Profile item.**
**Given** I am not signed in
**When** I look at the top-right of the app
**Then** I see the sign-in button with no dropdown and no Profile item

**AC 4 — Loading never flashes the signed-out state.**
**Given** I navigate directly to `/profile` while my session is still resolving
**When** the page renders
**Then** I see a loading skeleton
**And** I never see the signed-out state flash before the signed-in state

**AC 5 — Signed out on `/profile`: guard state, no data requested.**
**Given** I navigate directly to `/profile` while signed out
**When** the page renders
**Then** I see a "sign in required" state with a sign-in action
**And** no profile data is requested or displayed

**AC 6 — Expired session reuses the shipped copy.**
**Given** my session has expired
**When** I open `/profile`
**Then** I see the sign-in required state using the existing `profile.sessionExpiredAction` copy

**AC 7 — Read-only email from the existing session; route stays outside the IA.**
**Given** I am signed in and on `/profile`
**When** the page renders
**Then** my email is displayed read-only, sourced from the existing session
**And** `/profile` does not appear in the sidebar or destination navigation

**AC 8 — Route addition is regression-free and the route tree is generated.**
**Given** the route file is added
**When** `accessibility.spec.ts`, `navigation.spec.ts`, and `nav-qa.spec.ts` run
**Then** they still pass, and `routeTree.gen.ts` is regenerated rather than hand-edited

**AC 9 — (Derived) The guard fails closed on an unusable session payload.**
*Rationale: `AuthState` has three states plus a loading state, but `useAuthSession()` also legitimately resolves `isError` or a payload with no `status` — `ProfileMenu.tsx:27-33` documents this as a **live path**, not defensive padding, because 24 of the 25 Playwright specs never stub `get_auth_session`. A strictly four-way branch whose fallback is "signed in" would render profile content to an unauthenticated webview.*
**Given** `useAuthSession()` reports `isError`, or resolves a payload whose `status` is not one of the three known values
**When** `/profile` renders
**Then** I see the sign-in required state with the `profile.signIn` action, never profile content
**And** no toast is fired for this state (matching `ProfileMenu`'s `unavailable` branch, which is deliberately silent)

**AC 10 — (Derived) Every new string ships in both locales and the profile i18n suite passes.**
*Rationale: `src/locales/__tests__/profile-i18n.test.ts:58-65` asserts the **exact set** of shipped `profile.*` keys equals a hardcoded array. Adding a key without extending that array fails vitest — a stricter constraint than plain EN/FR parity. Separately, `tests/auth.spec.ts:521` asserts the dropdown panel `not.toContainText("profile.")`, so a missing key renders the raw key and breaks a shipped E2E spec.*
**Given** new user-facing copy is added
**When** `pnpm --filter @nixus/desktop test` runs
**Then** every new key exists with a non-empty value in **both** `en.json` and `fr.json`, `REQUIRED_KEYS` in `profile-i18n.test.ts` declares each one, and all six locale suites pass

## Tasks / Subtasks

- [x] **Task 1: Confirm the shipped contracts this story consumes — do not stub anything (AC: 1, 4, 5, 6, 7, 9)**
  - [x] Confirm `apps/desktop/src/hooks/useAuth.ts` exports `useAuthSession()`, `useSignIn()`, `useSignOut()` and that `useAuthSession()` returns the **raw `useQuery` result** (no synthesised `LoggedOut` default) — verified at `useAuth.ts:8-42`. Read `isLoading` / `isError` / `data` directly.
  - [x] Confirm `apps/desktop/src/lib/types.ts:664-667` still declares `AuthState` as the three-arm union `{ status: "LoggedOut" } | { status: "LoggedIn"; email: string; name: string | null } | { status: "SessionExpired" }`.
  - [x] Confirm `apps/desktop/src/components/auth/ProfileMenu.tsx` exists (195 lines) and that its signed-in branch renders `DropdownMenuContent data-testid="profile-menu-panel"` at lines 116-157.
  - [x] Confirm `Skeleton`, `EmptyState`, `Button`, `Card`, `CardContent`, `DropdownMenuItem` are all exported from `packages/shared/src/ui/index.ts`. **They are** — do not create any component in `packages/shared/src/ui/`, and do not create an `Avatar` primitive (Story 27.3 AC 10 forbids it and no avatar/profile picture is in scope).
  - [x] Confirm `apps/desktop/src/components/profile/` does **not** exist yet — create it in Task 3.
  - [x] **Do not add `queryKeys.profile`, `hooks/useProfile.ts`, `lib/types.ts` profile mirrors, or any Rust file.** They belong to Story 28.2. This story adds **zero** new `invoke` call sites.

- [x] **Task 2: Add the "Profile" item to `apps/desktop/src/components/auth/ProfileMenu.tsx` (AC: 1, 2, 3)**
  - [x] Add exactly one import: `import { Link } from "@tanstack/react-router";`. **Add no lucide import** — reuse `User`, already imported at `ProfileMenu.tsx:4` for the loading trigger.
  - [x] Insert the new item **inside the existing signed-in branch only**, between the `<DropdownMenuSeparator />` at line 143 and the sign-out `DropdownMenuItem` at line 145, so Profile sits above Sign out:
    ```tsx
    <DropdownMenuItem
      render={<Link to="/profile" data-testid="profile-menu-profile" />}
    >
      <User aria-hidden="true" />
      {t("profile.menuItem")}
    </DropdownMenuItem>
    ```
  - [x] Use the `render` prop, **never** a nested `<Link>`/`<a>` child. `DropdownMenuItem`'s props are `MenuPrimitive.Item.Props` (`packages/shared/src/ui/dropdown-menu.tsx:76-84`), which extends `BaseUIComponentProps<'div', MenuItemState>` and therefore declares `render?: React.ReactElement | ComponentRenderFn`. Nesting an anchor inside a Base UI menu item breaks roving focus and typeahead.
  - [x] Do **not** add a second `DropdownMenuSeparator` between Profile and Sign out — one group, one separator (see Open Decision OD-2).
  - [x] Do **not** add `onClick`, `onSelect`, `invoke`, `useQuery`, `useMutation`, `queryKeys`, or any hook to this component. The only local state stays `open` (line 70). Closing is already handled by `onOpenChange={setOpen}` (line 98) — Base UI closes the menu on item activation. **Verify in `tauri dev`**: if the panel stays open after navigating, and only then, add `onClick={() => setOpen(false)}` mirroring the sign-out item's explicit close at lines 148-151, and record it in Completion Notes.
  - [x] Leave the logged-out / loading / session-expired / unavailable branch (lines 162-194) **completely unchanged** — AC 3 is satisfied structurally, because those states render a bare `<Button>` with no `DropdownMenu` wrapper at all.
  - [x] Do **not** touch `apps/desktop/src/components/shared/TopBar.tsx` — `ProfileMenu` is already mounted at `TopBar.tsx:40`, itself rendered by `__root.tsx:124` on every route.

- [x] **Task 3: Create `apps/desktop/src/components/profile/SignInRequired.tsx` (AC: 5, 6, 9)**
  - [x] `mkdir apps/desktop/src/components/profile/`.
  - [x] The component **must not** read `useAuthSession()`, `useQuery`, or any session state. The route owns the single branch point (`architecture-user-profile.md#Component Boundaries`: "Neither child re-checks session state, so there is one decision point rather than two that can disagree"). It receives its label and its state tag as props.
  - [x] Exact shape:
    ```tsx
    import { useTranslation } from "react-i18next";
    import { LogIn } from "lucide-react";
    import { Button, EmptyState } from "@nixus/shared";
    import { useSignIn } from "@/hooks/useAuth";

    interface SignInRequiredProps {
      /** Resolved by the route, not derived here: the route owns the session branch. */
      actionLabel: string;
      /** QA/E2E hook only, mirroring `data-auth-state` on `profile-menu-trigger`. */
      authState: "logged-out" | "session-expired" | "unavailable";
    }

    export function SignInRequired({ actionLabel, authState }: SignInRequiredProps) {
      const { t } = useTranslation();
      const signIn = useSignIn();

      return (
        <EmptyState
          icon={<LogIn />}
          title={t("profile.signInRequiredTitle")}
          description={t("profile.signInRequiredBody")}
          action={
            <Button
              size="sm"
              onClick={() => signIn.mutate()}
              data-testid="profile-sign-in-action"
            >
              {actionLabel}
            </Button>
          }
          data-testid="profile-sign-in-required"
          data-auth-state={authState}
        />
      );
    }
    ```
  - [x] Import from `@nixus/shared`, **never** `@nixus/shared/ui` — all 121 shared-UI import sites in `apps/desktop/src` use the bare specifier and zero use `/ui`.
  - [x] Pass exactly **one** `action`. `EmptyStateProps` (`packages/shared/src/ui/empty-state.tsx:5-11`) documents "Exactly one. Two competing actions in an empty state is a decision the user cannot make yet."
  - [x] `useSignIn()` calls the already-shipped `invoke("start_login")` and only on click. This does **not** violate architecture D11: that constraint bans new `invoke` in *always-mounted* components. `SignInRequired` mounts only on `/profile`, and `start_login` is an existing command already stubbed where it matters (`auth.spec.ts:159-162`).
  - [x] Do **not** render a second heading here — the route supplies the `<h1>` via `PageHeader`.

- [x] **Task 4: Create `apps/desktop/src/routes/profile.tsx` with the in-route guard (AC: 4, 5, 6, 7, 9)**
  - [x] File name `profile.tsx` (flat, dot-delimited routing — see the sibling `settings.ai-provider.tsx`) yields the path `/profile`. Use the `@/` alias for every import: 18 of the 29 files in `src/routes/` import through it, only 3 use relative `../components` (`__root.tsx`, `import.tsx`, `settings.ai-provider.tsx`), and the rest import no components at all. `docs/project-context.md#TypeScript` mandates the alias.
  - [x] Exact shape:
    ```tsx
    import { createFileRoute } from "@tanstack/react-router";
    import { useTranslation } from "react-i18next";
    import { Card, CardContent, Skeleton } from "@nixus/shared";
    import { PageHeader } from "@/components/shared/PageHeader";
    import { SignInRequired } from "@/components/profile/SignInRequired";
    import { useAuthSession } from "@/hooks/useAuth";

    export const Route = createFileRoute("/profile")({
      component: ProfilePage,
    });

    function ProfilePage() {
      const { t } = useTranslation();
      const session = useAuthSession();

      // Ordered, not a lookup table, and it fails closed: `isLoading` is tested first so the
      // signed-out state can never flash, and `logged-in` is the only positively-matched arm, so an
      // errored or unrecognised payload lands on the guard rather than on profile content.
      const status = session.data?.status;
      const guard = session.isLoading
        ? "loading"
        : status === "LoggedIn"
          ? "logged-in"
          : status === "SessionExpired"
            ? "session-expired"
            : status === "LoggedOut"
              ? "logged-out"
              : "unavailable";

      const account = session.data?.status === "LoggedIn" ? session.data : null;

      return (
        <div data-testid="profile-page" data-auth-state={guard}>
          {/* Rendered in every branch: `PageHeader` owns `SURFACE_HEADING_ID`, which the shell's
            * skip link and its route-change focus move both target (`__root.tsx:40-45`, 111-121). */}
          <PageHeader title={t("profile.title")} />

          <div className="mx-auto max-w-2xl">
            {guard === "loading" && (
              <Card>
                <CardContent>
                  <Skeleton rows={2} data-testid="profile-skeleton" />
                </CardContent>
              </Card>
            )}

            {guard === "logged-in" && account && (
              <Card>
                <CardContent>
                  <div className="space-y-1">
                    <p className="text-caption text-ink-dim">{t("profile.email")}</p>
                    <p
                      className="truncate text-body text-ink"
                      title={account.email}
                      data-testid="profile-email"
                    >
                      {account.email}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {guard === "session-expired" && (
              <SignInRequired
                authState="session-expired"
                actionLabel={t("profile.sessionExpiredAction")}
              />
            )}

            {(guard === "logged-out" || guard === "unavailable") && (
              <SignInRequired authState={guard} actionLabel={t("profile.signIn")} />
            )}
          </div>
        </div>
      );
    }
    ```
  - [x] The email block deliberately mirrors the identity block already shipped at `ProfileMenu.tsx:125-131` — plain `<p>` elements, `truncate`, and a `title` attribute carrying the full address. Do **not** use `Label` + `Input readOnly` here: the value is read text, not a control, and `Label` without an `htmlFor` target is an a11y defect.
  - [x] **Do not** copy or import `ProfileMenu`'s private `deriveState` helper (`ProfileMenu.tsx:34-55`). The route needs a different mapping (a full-page guard, not a clickable trigger) and importing a header component's internals into a route would invert the dependency. The inline chain above is the whole state machine.
  - [x] The `logged-in` arm is the content area Story 28.2 extends: `<ProfileForm />` mounts as a sibling **below** the email block inside the same `<Card>`. **Add no "coming soon" / "under construction" copy** — throwaway strings would need EN+FR keys, a `REQUIRED_KEYS` entry, and deletion two stories later.
  - [x] Do **not** call `invoke`, do **not** add a `loader`/`beforeLoad`, and do **not** add `validateSearch`. The guard is a render-time branch so `useAuthSession()`'s cached result is shared with `ProfileMenu` and `AccountPromptDialog`, and a `beforeLoad` redirect would fire before the session query resolves.
  - [x] Never add a wrapper that duplicates the shell's padding: `__root.tsx:140-146` already wraps every non-AI route in `mx-auto max-w-[1280px] px-page-x py-page-y`. The `mx-auto max-w-2xl` inner measure copies `settings.ai-provider.tsx:66`.
  - [x] Do **not** create `apps/desktop/src/routes/profile.index.tsx` or a `profile.tsx` + `Outlet` pair — `/profile` has no children in this story.

- [x] **Task 5: Regenerate `routeTree.gen.ts` — never hand-edit it (AC: 8)**
  - [x] Run `pnpm --filter @nixus/desktop dev` (or `build`) once so the TanStack Router plugin regenerates `apps/desktop/src/routeTree.gen.ts`. Rules: `docs/project-context.md#TanStack Router` ("never edit this file manually"), `#Anti-Patterns` ("Editing routeTree.gen.ts manually — it will be overwritten on next dev/build"), `architecture-user-profile.md#Development Workflow Integration` ("regenerates `routeTree.gen.ts` on the next dev/build run — never hand-edited").
  - [x] Confirm the regenerated diff contains a `/profile` entry and **only** mechanical additions. Commit the regenerated file; do not revert it.
  - [x] If `Link to="/profile"` is a TypeScript error before regeneration, that is expected — regenerate, do not cast, and do not use `to={"/profile" as never}`.

- [x] **Task 6: Add the five new `profile.*` keys to both locales (AC: 1, 5, 6, 10)**
  - [x] Flat dotted keys, inserted into the existing `profile.*` block in **both** files so the two diffs mirror each other. Do **not** nest objects. Do **not** open a `userProfile.*` namespace (`architecture-user-profile.md#Naming Patterns`).
  - [x] `apps/desktop/src/locales/en.json`:
    - `"profile.menuItem": "Profile"`
    - `"profile.title": "Profile"`
    - `"profile.email": "Email"`
    - `"profile.signInRequiredTitle": "Sign in to see your profile"`
    - `"profile.signInRequiredBody": "Your profile is tied to your Nixus account. Nothing else in Nixus needs one, and no profile data leaves this machine."`
  - [x] `apps/desktop/src/locales/fr.json`:
    - `"profile.menuItem": "Profil"`
    - `"profile.title": "Profil"`
    - `"profile.email": "Courriel"`
    - `"profile.signInRequiredTitle": "Connectez-vous pour voir votre profil"`
    - `"profile.signInRequiredBody": "Votre profil est lié à votre compte Nixus. Aucune autre fonctionnalité de Nixus n'en exige, et aucune donnée de profil ne quitte cet appareil."`
  - [x] **Reuse, do not re-add:** `profile.signIn`, `profile.sessionExpiredAction`, `profile.signOut`, `profile.signedInAs`, `profile.accountMenu`, `profile.loading`, `profile.sessionExpired` all already exist with EN+FR values.
  - [x] Do **not** touch `profile.signIn` or `auth.createAccount` values — the "Sign In with Nixus Cloud" relabel is Story 28.5's deliverable (architecture D14). The body copy above deliberately says "Nixus account", matching the shipped `auth.promptBody`, so 28.5 does not have to unpick this story's wording.
  - [x] No new key contains an ellipsis or a `{{placeholder}}`, so `ELLIPSIS_KEYS` and `PLACEHOLDER_KEYS` in `profile-i18n.test.ts` stay as they are.
  - [x] Verify counts stay equal: `en.json` and `fr.json` are both 1188 keys today and must both be 1193 after.

- [x] **Task 7: Extend `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` (AC: 10)**
  - [x] **Mandatory, not optional.** Lines 58-65 assert `profileKeys(en).sort()` equals `[...REQUIRED_KEYS].sort()` — an exact-set check. Shipping any `profile.*` key not listed in `REQUIRED_KEYS` fails `pnpm --filter @nixus/desktop test`.
  - [x] Append the five keys from Task 6 to the `REQUIRED_KEYS` array (lines 10-18), taking it from 7 entries to 12.
  - [x] Leave `ARIA_LABEL_KEYS`, `PLACEHOLDER_KEYS`, and `ELLIPSIS_KEYS` unchanged — none of the new keys is an `aria-label`, carries a placeholder, or ends in an ellipsis.
  - [x] Update the stale comment at line 59 ("ProfileMenu is the only consumer") — `routes/profile.tsx` and `components/profile/SignInRequired.tsx` are consumers now. Comment text only; change no assertion.
  - [x] Do not create a second i18n test file for this feature; `profile-i18n.test.ts` is the profile namespace's home.

- [x] **Task 8: Add `apps/desktop/tests/profile.spec.ts` — the only new spec (AC: 1, 2, 3, 4, 5, 6, 7, 9)**
  - [x] Copy the `setupTauriMock` harness shape from `apps/desktop/tests/auth.spec.ts:57-255` **into this file**. Redeclare `MockAuthState` locally — `auth.spec.ts:5-6` records that `apps/desktop/tests/` has no shared helper module and "a spec must not reach into `src/`".
  - [x] Two mock guards are load-bearing and must be copied verbatim (`auth.spec.ts:44-56`): every `plugin:` command resolves `null` (a truthy `plugin:updater` reply makes `UpdateChecker` open a Dialog whose focus trap `aria-hidden`s the whole app), and `transformCallback` + `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` must both exist (`useAuthSession` and `RecurringApplyListener` call `event.listen()` on mount).
  - [x] Stub **only** already-shipped commands: `get_auth_session`, `start_login`, `sign_out`, plus the shell/dashboard cases from `auth.spec.ts`. Add **no** `get_user_profile` / `save_user_profile` / `get_countries` / `get_subdivisions` case — they do not exist yet. Story 28.2 extends this file.
  - [x] Cover, one test each:
    - Signed in (`{ status: "LoggedIn", email: "user@example.com", name: "Test User" }`): click `profile-menu-trigger`, `profile-menu-profile` is visible, click it, `expect(page).toHaveURL(/\/profile$/)`, and `profile-email` has text `user@example.com`. (AC 1, 7)
    - Same flow, then assert the recorded IPC command list contains none of `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions` — reuse the `__IPC_CALLS` / `readIpcCommands` idiom from `auth.spec.ts:257-275`. (AC 2)
    - Signed out: `profile-menu-trigger` has `data-auth-state="logged-out"` and `page.getByTestId("profile-menu-profile")` has count 0. (AC 3)
    - `sessionDelayMs: 2000`, `page.goto("/profile")`: `profile-skeleton` is visible **and** `profile-sign-in-required` has count 0 while pending; after settle, the signed-in content appears. This is the only honest proof of "never see the signed-out state flash" — mirror the pending-window technique at `auth.spec.ts:400-418`. (AC 4)
    - Signed out on `/profile`: click `continue-offline-button` **first** — `AccountPromptDialog` is modal and `aria-hidden`s the shell, so assertions taken while it is open measure the focus trap, not the page (`auth.spec.ts:456-464`). Then `profile-sign-in-required` is visible with `data-auth-state="logged-out"`, `profile-sign-in-action` reads "Sign in", and `profile-email` has count 0. (AC 5, 9)
    - `{ status: "SessionExpired" }` on `/profile`: `profile-sign-in-required` has `data-auth-state="session-expired"` and `profile-sign-in-action` matches `/Session expired/`. No account-prompt dialog appears in this state. (AC 6)
    - No mock at all for `get_auth_session` (leave `session` undefined so it rejects, reproducing the other 24 specs): `/profile` renders `profile-sign-in-required` with `data-auth-state="unavailable"`, no toast, and no `profile-email`. (AC 9)
    - No raw keys leak: `expect(page.getByTestId("profile-page")).not.toContainText("profile.")`. (AC 10)
    - `/profile` is not navigation: `expect(page.locator('nav[aria-label="Finance navigation"]').getByRole("link", { name: /profil/i })).toHaveCount(0)` and the same for the sidebar rail. (AC 7)
  - [x] Do **not** add `/profile` to `nav-qa.spec.ts`'s `SURFACES` array (lines 97-110). Its mock `default` resolves `[]`, so `/profile` could only ever be screenshotted in the `unavailable` guard state — this spec covers all five states with real stubs instead. Record the exclusion in Completion Notes.

- [x] **Task 9: Regression verification — run these, do not assume (AC: 2, 8, 10)**
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors. `noUnusedLocals` and `noUnusedParameters` are on; an unused import is a CI failure (`docs/project-context.md#7`, `docs/guidelines/warnings.md`).
  - [x] `pnpm --filter @nixus/desktop build` (`tsc && vite build`) — zero TypeScript warnings. The pre-existing Vite 500 kB chunk-size advisory is not a regression.
  - [x] `pnpm --filter @nixus/desktop test` — all six locale suites plus the hook suites pass.
  - [x] `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts` — **all 13 tests must still pass unchanged.** Three assertions are the ones at risk and must be checked individually: `auth.spec.ts:521` `expect(panel).not.toContainText("profile.")` (fails if `profile.menuItem` is missing from `en.json`), `auth.spec.ts:519` `expect(page).toHaveURL(/localhost:1420\/$/)` (must still hold — merely *opening* the panel navigates nowhere), and `auth.spec.ts:538` `expect(page.getByTestId("profile-menu-name")).toHaveCount(0)` (a count on one specific testid, unaffected by an added sibling item).
  - [x] `pnpm --filter @nixus/desktop exec playwright test tests/accessibility.spec.ts tests/navigation.spec.ts tests/nav-qa.spec.ts` — all pass. Expected outcome is "green with no edits": all three use hardcoded route lists rather than crawling, and their link-count assertions are scoped to `nav[aria-label="Finance navigation"]` / `nav[data-slot="segmented-nav"]`, which the header dropdown is not inside. **Verify, do not assume** (`architecture-user-profile.md#Regression Checks Required`).
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — full suite. The pre-story baseline recorded in Story 27.3 is **331 passed / 2 failed**, the two failures being pre-existing token regressions at `chat.spec.ts:250` and `design-system.spec.ts:110` from commit `9b45411`. Report the new totals against that baseline; new specs from this story raise the pass count but must not raise the fail count.
  - [x] `git status --porcelain` must show **no** diff under `apps/desktop/src-tauri/`, `packages/shared/`, `apps/web/`, `apps/desktop/src/lib/`, `apps/desktop/src/hooks/`, `apps/desktop/src-tauri/migrations/`, and **no** change to `_bmad-output/implementation-artifacts/sprint-status.yaml`.
  - [x] Confirm no `console.log` was added (`docs/project-context.md#Code Quality`).

- [x] **Task 10: Comment-only truth repair in `tests/auth.spec.ts` (AC: 8)**
  - [x] `auth.spec.ts:518` reads *"A popover anchored to the icon, not a route: there is no routes/profile.tsx to land on."* That premise is reversed by this story. Reword it to state that opening the panel still performs no navigation even though `/profile` now exists.
  - [x] **Comment text only.** Change no assertion, no locator, no mock case, and no `switch` branch in this or any other existing spec — architecture D11's whole point is that no shipped spec's Tauri mock needs a new command case.

- [ ] **Task 11: Manual verification pass (AC: 1, 3, 4, 6, 7)**
  - [ ] `pnpm --filter @nixus/desktop tauri dev`, signed in: the dropdown shows Profile above Sign out; clicking Profile closes the panel and lands on `/profile` with the correct email; browser/keyboard back returns to the previous surface.
  - [ ] Keyboard: `Tab` reaches `profile-menu-trigger` after the search field; `Enter` opens the panel; `↓`/`↑` move between Profile and Sign out; `Enter` on Profile navigates; `Escape` closes and restores focus to the trigger; the focus ring is visible on both items.
  - [ ] Signed out: no dropdown at all, and `/profile` typed directly into the address bar shows the sign-in required state whose action opens the Cognito Hosted UI.
  - [ ] Switch the app language to French and re-check every string on `/profile` and in the dropdown, including via the OS accessibility inspector. No raw `profile.*` key may appear.
  - [ ] Confirm `/profile` appears in neither the sidebar rail nor the destination strip as a link, and note what the destination strip does render there (see Open Decision OD-1).

## Dev Notes

### Scope fence — exactly six files plus one generated file

| File | Action |
| --- | --- |
| `apps/desktop/src/components/auth/ProfileMenu.tsx` | MODIFIED — one import, one `DropdownMenuItem` |
| `apps/desktop/src/routes/profile.tsx` | NEW — route + in-route guard |
| `apps/desktop/src/components/profile/SignInRequired.tsx` | NEW |
| `apps/desktop/src/locales/en.json` | MODIFIED — 5 keys |
| `apps/desktop/src/locales/fr.json` | MODIFIED — same 5 keys |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | MODIFIED — `REQUIRED_KEYS` 7 → 12 |
| `apps/desktop/tests/profile.spec.ts` | NEW |
| `apps/desktop/tests/auth.spec.ts` | MODIFIED — one comment, zero assertions |
| `apps/desktop/src/routeTree.gen.ts` | REGENERATED by tooling — never hand-edited |

**Explicitly out of scope for this story** (later stories own them; adding any of them is a defect):

- Any Rust file. No `profile_store.rs`, no `json_store.rs`, no `commands/profile.rs`, no `current_subject()`, no `models/mod.rs` change, no `lib.rs` registration, no `danger_zone` change, no `Cargo.toml` change. (Stories 28.2, 28.4)
- Any profile form field — no first name, last name, date of birth, income bracket, currency, country, or subdivision input. (Stories 28.2, 28.3, 29.1–29.3)
- `hooks/useProfile.ts`, `queryKeys.profile`, `lib/types.ts` profile mirrors, `removeQueries` in `useAuth.ts`. (Story 28.2)
- `packages/shared/src/ui/date-picker.tsx` `captionLayout` / `startMonth` / `endMonth`. (Story 28.3)
- The "Sign In with Nixus Cloud" relabel of `profile.signIn` and `auth.createAccount`. (Story 28.5)
- `src-tauri/data/iso3166.json` and its generator script. (Epic 29)
- Any TFSA calculation, module, command, or copy. (Epic 30)
- Any SQLite migration or table. `db/mod.rs` `MIGRATIONS` and `db/danger_zone.rs` `WIPE_TABLES` / `PRESERVED_TABLES` are untouched (architecture D2).
- Any `Avatar` primitive or profile picture (architecture "Deferred Decisions"; Story 27.3 AC 10).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — the orchestrator owns it.

### This story is the deliberate smallest slice

> "Story 28.1 deliberately ships the page before any data. It relies only on the already-shipped `useAuthSession`, so it requires no Rust work and is immediately verifiable, which keeps Story 28.2 from having to build everything at once."
> [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 28 "Sequencing note"]

Forward-dependency check from the epics file: "28.1 depends on already-shipped code only." [Source: epics-user-profile.md#Validation Notes (step-04)]

### AC 2 is the constraint that keeps this story contained

> "Because this always-mounted component performs **no new IPC call**, no existing Playwright spec's Tauri mock requires updating — deliberately sidestepping the trap documented at `project-context.md:295`. All fetching happens inside the `/profile` route. This constraint must be preserved: do not move profile reads into `ProfileMenu`."
> [Source: architecture-user-profile.md#Frontend Architecture, D11]

The trap being sidestepped, verbatim:

> "**When adding any always-mounted root-level component that calls `invoke()` on load** (e.g. an app-shell dialog, header widget) — every existing spec's Tauri mock must add a case for the new command(s), or that spec's mock falls through to `Promise.reject("Unknown command")` and the new component renders in its error state. Audit all existing specs' mock switch statements before merging, not after."
> [Source: docs/project-context.md#Testing Rules (line 295)]

Measured facts that make this concrete: there are **25** spec files in `apps/desktop/tests/`. Exactly **one** (`auth.spec.ts`) stubs `get_auth_session` or references any `profile-menu-*` testid. Zero reference `/profile`. So in the other 24, `ProfileMenu` renders its `unavailable` branch — a bare `<Button>` with no `DropdownMenu` at all — and the new Profile item is not even mounted there.

### The existing `ProfileMenu` code the new item slots into

`apps/desktop/src/components/auth/ProfileMenu.tsx:143-157` — insert between the separator and the sign-out item:

```tsx
          <DropdownMenuSeparator />

          <DropdownMenuItem
            // Closed unconditionally rather than in onSuccess: sign-out can fail, and a panel
            // pinned open behind a failed request reads as a frozen app.
            onClick={() => {
              signOut.mutate();
              setOpen(false);
            }}
            data-testid="profile-menu-sign-out"
          >
            <LogOut aria-hidden="true" />
            {t("profile.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
```

Its existing imports (`ProfileMenu.tsx:1-16`) already include `User` from `lucide-react` and the whole `DropdownMenu*` family from `@nixus/shared`, so the only addition is `Link`:

```tsx
import { CircleUser, LogIn, LogOut, User } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nixus/shared";
```

Note the shipped trigger is `size="icon"` with `data-testid="profile-menu-trigger"` and a `data-auth-state` attribute on **every** branch (`ProfileMenu.tsx:99-111`, `176-193`). The new route reuses that `data-auth-state` convention on its own wrapper.

### The `render`-prop pattern the Profile item must follow (architecture G7)

> "**G7 — `DropdownMenuItem` composition was unspecified.** Nesting an anchor inside a menu item breaks keyboard semantics with `@base-ui/react`. **Resolved:** use the established `render` prop pattern already used by `SegmentedNavItem` — `<DropdownMenuItem render={<Link to="/profile" data-testid="profile-menu-profile" />}>` — rather than wrapping or nesting."
> [Source: architecture-user-profile.md#Gap Analysis Results, G7]

The in-repo precedent, `packages/shared/src/ui/segmented-nav.tsx:8-13` and `:33-59`:

```tsx
// These are REAL navigation links, not an ARIA tablist. `Tab` moves between them and `Enter`
// activates, and arrow keys are deliberately not bound: arrow-key movement is the tablist
// convention, and applying it to elements a screen reader still announces as "link" confuses anyone
// who knows the pattern. Pass the router's link through `render` — e.g. render={<Link to="..." />}.
function SegmentedNavItem({
  className,
  active = false,
  render,
  ...props
}: useRender.ComponentProps<"a"> & { active?: boolean }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">({ /* … */ }, props),
    render,
    /* … */
  })
}
```

And a live call site, `apps/desktop/src/routes/settings.ai-provider.tsx:50-62`:

```tsx
          <SegmentedNavItem
            key={item.id}
            active={item.id === active}
            render={
              <Link
                to="/settings/ai-provider"
                search={{ section: item.id }}
                data-testid={`settings-nav-${item.id}`}
              />
            }
          >
            {t(item.labelKey)}
          </SegmentedNavItem>
```

`DropdownMenuItem` reaches the same capability through a different type alias — worth knowing so its absence from the visible signature is not mistaken for absence of the feature. `packages/shared/src/ui/dropdown-menu.tsx:76-84`:

```tsx
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
```

`MenuPrimitive.Item.Props` extends `BaseUIComponentProps<'div', MenuItemState>`, which declares `render?: React.ReactElement | ComponentRenderFn<…>`. So `render={<Link/>}` type-checks and works — it is simply typed via `BaseUIComponentProps` rather than the literal `useRender.ComponentProps` that `Card` and `SegmentedNavItem` use.

### The four-way guard, and why it is really five arms

> "**G4 — The route guard was specified as a binary branch, but `AuthState` has three states plus a loading state.** As written, a signed-in user navigating directly to `/profile` would see a flash of "sign in required" while `useAuthSession` resolves, and `SessionExpired` had no defined rendering at all — while `current_subject()` returns `Err` for it, so the form would fail to load.
> **Resolved:** `routes/profile.tsx` branches four ways — `isLoading` → skeleton (never `SignInRequired`); `LoggedIn` → `ProfileForm`; `LoggedOut` → `SignInRequired`; `SessionExpired` → `SignInRequired` with the existing `profile.sessionExpiredAction` copy. `ProfileMenu` already models a loading state, so this follows an established precedent rather than inventing one."
> [Source: architecture-user-profile.md#Gap Analysis Results, G4]

The fifth arm (AC 9) comes from the shipped code, not from an abundance of caution. `apps/desktop/src/components/auth/ProfileMenu.tsx:27-33`, verbatim:

```
/**
 * `unavailable` is a live path, not defensive padding: this component sits in the always-rendered
 * header, so it runs under every Playwright spec, where `get_auth_session` either rejects or
 * resolves a payload with no `status`. That row must render a silent, benign affordance — a toast or
 * an error surface here would float over 23 unrelated specs, and Base UI's focus trap would
 * aria-hide the app if it were ever promoted to a dialog.
 */
```

Empirically: `accessibility.spec.ts` has no `get_auth_session` case and its mock `default` is `Promise.reject(\`Unknown command: ${cmd}\`)` → `isError`. `nav-qa.spec.ts` has no case and its `default` is `Promise.resolve([])` → `data` is `[]`, so `data?.status` is `undefined`. `navigation.spec.ts` installs **no Tauri mock at all** → `invoke` throws. All three land on the fifth arm, so it must render the guard and must be silent (no toast — `ProfileMenu` deliberately does not toast for `unavailable`, and Story 27.4's clean-profile assertions depend on that).

The route's branch order is load-bearing twice over: `isLoading` first satisfies AC 4's "never see the signed-out state flash", and matching `LoggedIn` **positively** (rather than treating it as the fallback) is what makes the guard fail closed for AC 9.

### The guard is UX; the real boundary is Rust — and there is no Rust yet

> "**The guard lives in the route, not the menu.** `/profile` is a real URL reachable by back-button or direct navigation, so the route itself renders a "sign in required" state whenever `useAuthSession()` is not `LoggedIn`. Hiding the menu entry is UX, not enforcement — the Rust-side `current_subject()` check is the actual boundary."
> [Source: architecture-user-profile.md#Frontend Architecture, D1]

Consequence for this story: because 28.1 reads **no** profile data at all, there is nothing for a bypassed frontend conditional to leak. AC 5's "no profile data is requested or displayed" is satisfied structurally — the story adds zero `invoke` call sites, so `/profile` cannot request profile data in any state.

### `/profile` stays outside the four-destination IA (rule D8)

`apps/desktop/src/lib/navigation.ts:1-12`, verbatim:

```
/**
 * The Finance information architecture.
 *
 * Ten tabs collapse to four destinations. This is not an invention: `InnerTabNav` already grouped
 * the ten into four divider-separated clusters, so the correct structure was already discovered —
 * it was just expressed as visual grouping instead of navigation, which meant the user still paid a
 * ten-item scan cost. Cluster membership is unchanged.
 *
 * Architecture rule D8 is binding: no fifth destination, ever. New capability nests inside an
 * existing destination as a sub-surface. The 4-tuple type below makes a fifth a compile error
 * rather than a code-review question.
 */
```

Enforced by the type at `navigation.ts:28` — `type FourDestinations = readonly [Destination, Destination, Destination, Destination];` — applied at `navigation.ts:67` via `] as const satisfies FourDestinations;`. Adding a fifth entry is a **TypeScript compile error**, not a review comment.

Architecture's "Not touched, deliberately" list names the three files by hand:

> "`components/shared/AppSidebar.tsx`, `DestinationNav.tsx`, `lib/navigation.ts` — rule D8; `/profile` is outside the four-destination IA."
> [Source: architecture-user-profile.md#Delta to Existing Project Tree]

The route file alone is sufficient. `DestinationNav.tsx:48` renders links by mapping `DESTINATIONS`, so a route absent from that array can never appear in the strip; `AppSidebar` likewise renders from its own fixed module list.

### `/profile` inherits the shell for free

`apps/desktop/src/routes/__root.tsx:122-150` mounts `AppSidebar`, `TopBar` (which mounts `ProfileMenu` at `TopBar.tsx:40`), `DestinationNav`, and a `<main>` whose non-AI branch wraps `<Outlet />` in `mx-auto max-w-[1280px] px-page-x py-page-y`. So `routes/profile.tsx` renders **content only** — no header, no sidebar, no page padding of its own.

`PageHeader` is required for the shell's a11y contract. `apps/desktop/src/components/shared/PageHeader.tsx:5-28`:

```tsx
/** The shell's skip link and its route-change focus move both target this id. */
export const SURFACE_HEADING_ID = "surface-heading";
```
```tsx
        {/* tabIndex -1 makes the heading a programmatic focus target: the shell persists across
         * navigation, so without this a keyboard user who activates a nav item stays on the nav
         * and has to tab through the whole chrome to reach content. */}
        <h1
          id={SURFACE_HEADING_ID}
          data-surface-heading=""
          tabIndex={-1}
          className={cn("text-h1 text-ink", focusRing)}
        >
```

`__root.tsx:40-45` falls back to `#surface-main` when a surface renders no `PageHeader`, so omitting it would not crash — it would silently degrade keyboard navigation. Render it in every guard arm.

### Shared primitives to reuse — build nothing

`docs/project-context.md#8`: "Check `@nixus/shared/ui` FIRST before creating any new UI component… Never duplicate a component that exists in `packages/shared/src/ui/`."

Verified exports (`packages/shared/src/ui/index.ts`, 33 component files, all barrelled): Accordion, Alert, AttentionRow, Badge, BulkBar, Button, Calendar, **Card / CardHeader / CardFooter / CardTitle / CardAction / CardDescription / CardContent**, Checkbox, DatePicker, Dialog family, **DropdownMenu family (incl. DropdownMenuItem)**, **EmptyState**, focusRing, **Input**, **Label**, Meter, Money, MaskedFigure, formatMoney, PillTabs, Popover, SegmentedNav, SegmentedNavItem, Select family, Separator, **Skeleton**, SlideOver, Toaster, Stat, SubStat, StepProgress, Switch, Table family, Tabs family, Tooltip family, NixusLogo, BuyMeACoffeeIcon. **There is no `Avatar` — and none is to be added.**

`Skeleton` (`packages/shared/src/ui/skeleton.tsx:5-18`):

```ts
interface SkeletonProps extends React.ComponentProps<"div"> {
  /**
   * Must match the real content count. The shipped app hardcodes 2–3 rows regardless of what is
   * loading, which is why nearly every list jumps when data lands.
   */
  rows?: number
}
```
```ts
function Skeleton({ rows = 1, className, ...props }: SkeletonProps)
```

`rows={2}` matches the two lines the signed-in arm renders (email label + email value), honouring the "must match the real content count" contract without needing the `lastRowCount` ref idiom that list surfaces use.

`EmptyState` (`packages/shared/src/ui/empty-state.tsx:5-11`):

```ts
interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Exactly one. Two competing actions in an empty state is a decision the user cannot make yet. */
  action?: React.ReactNode
}
```

The shape to mirror, `apps/desktop/src/components/income/IncomeEntryList.tsx:309-324`:

```tsx
    return (
      <EmptyState
        icon={<Wallet />}
        title={t("income.noEntriesThisMonth")}
        description={t("income.noEntriesHint")}
        action={
          onAddEntry ? (
            <Button size="sm" onClick={onAddEntry}>
              {t("income.addEntry")}
            </Button>
          ) : undefined
        }
        data-testid="income-entries-empty"
      />
    );
```

Because `EmptyStateProps` extends `React.ComponentProps<"div">`, both `data-testid` and `data-auth-state` pass through to the rendered element — no wrapper div is needed.

**Import specifier:** `apps/desktop/src` has **121** `from "@nixus/shared"` imports and **0** `from "@nixus/shared/ui"`. `packages/shared/src/index.ts` does `export * from "./ui"`, so the bare specifier is the whole surface. Use it.

### i18n: three separate mechanisms will catch a missing key

1. **Exact-set assertion.** `apps/desktop/src/locales/__tests__/profile-i18n.test.ts:58-65`:

```ts
  it("declares every profile key it ships", () => {
    // ProfileMenu is the only consumer, so an orphaned key here is copy the UI can never show —
    // and an undeclared one escapes every assertion above.
    const declared = [...REQUIRED_KEYS].sort();

    expect(profileKeys(en).sort()).toEqual(declared);
    expect(profileKeys(fr).sort()).toEqual(declared);
  });
```

   This is stricter than the parity rule quoted in the architecture. Adding a `profile.*` key to both locale files but not to `REQUIRED_KEYS` **still fails**. Task 7 is mandatory.

2. **EN/FR parity.** `profile-i18n.test.ts:49-56` plus the architecture constraint: "A locale-parity unit test suite (`src/locales/__tests__/`) fails CI if any key exists in `en.json` without an `fr.json` counterpart. Every new profile key must be added to both files in the same change." [Source: architecture-user-profile.md#Technical Constraints & Dependencies]

3. **Raw-key leak detection in E2E.** `apps/desktop/tests/auth.spec.ts:520-521`:

```ts
    await expect(panel).not.toContainText("auth.");
    await expect(panel).not.toContainText("profile.");
```

   i18next renders a missing key as the key string, so a `profile.menuItem` present only in `fr.json` (or misspelled) puts the literal text `profile.menuItem` inside `profile-menu-panel` and fails this shipped assertion. There is an equivalent header-wide sweep at `auth.spec.ts:470`.

The seven `profile.*` keys already shipped, EN | FR — reuse, do not redefine:

| Key | EN | FR |
| --- | --- | --- |
| `profile.signIn` | `Sign in` | `Se connecter` |
| `profile.accountMenu` | `Account menu for {{email}}` | `Menu du compte pour {{email}}` |
| `profile.loading` | `Loading account…` | `Chargement du compte…` |
| `profile.signedInAs` | `Signed in as` | `Connecté en tant que` |
| `profile.signOut` | `Sign out` | `Se déconnecter` |
| `profile.sessionExpired` | `Your session expired. Sign in again to reconnect.` | `Votre session a expiré. Reconnectez-vous.` |
| `profile.sessionExpiredAction` | `Session expired — sign in again` | `Session expirée — se reconnecter` |

`profile.sessionExpiredAction` is the key AC 6 names explicitly. It is already used as the trigger's `aria-label` at `ProfileMenu.tsx:166`; this story reuses it as the guard's button label. Do not clone it under a new name.

Locale files are **flat dotted-key JSON**, 1188 keys each today. Nested objects are not the convention.

### Regression surface — measured, not assumed

| Spec | Discovery mechanism | Mock `default` | Effect of this story |
| --- | --- | --- | --- |
| `auth.spec.ts` | hardcoded; the only spec stubbing `get_auth_session` (case at line 150) and the only one asserting `profile-menu-*` testids | `Promise.reject` | **The one at-risk spec.** Its `not.toContainText("profile.")` and URL assertions must be re-run. No mock case needed. |
| `accessibility.spec.ts` | hardcoded `page.goto()` per test (lines 195, 253, 278, 299, 322); no route iteration | `Promise.reject("Unknown command")` | Never visits `/profile`. `ProfileMenu` stays in `unavailable`, so the new item is not mounted. Green, no edits. |
| `navigation.spec.ts` | hardcoded local `destinations` (lines 10-15) and `subNavs` (lines 21-34) arrays that mirror but do **not** import `navigation.ts`; **installs no Tauri mock at all** | n/a | Count assertions at lines 53 and 124 are scoped to `nav[aria-label="Finance navigation"]` and `nav[data-slot="segmented-nav"]`. The header dropdown is a `role="menu"` popover in neither. Green, no edits. |
| `nav-qa.spec.ts` | hardcoded `SURFACES` list of 12 routes (lines 97-110), looped at line 125 | `Promise.resolve([])` | `/profile` is absent from `SURFACES`, so it is never screenshotted. Count assertions at lines 141 and 169 are `nav`-scoped. Green, no edits. |

Zero of the three reads `lib/navigation.ts`, crawls `<a>` elements, or enumerates the router's tree — so an unregistered route file is invisible to them by construction. Zero of the three references any `profile-menu` testid, so an added dropdown item breaks no count.

`architecture-user-profile.md#Regression Checks Required` demands verification rather than reasoning:

> "`tests/auth.spec.ts` asserts on `profile-menu-panel`, `profile-menu-email`, `profile-menu-name`, and `profile-menu-sign-out` by `data-testid`, and its one count assertion (`profile-menu-name` → `toHaveCount(0)`) is unaffected by an added item. No assertion enumerates dropdown children generically, so adding the Profile item should not break it — **verify, do not assume.**"

### E2E harness rules (from `docs/project-context.md#Testing Rules` and `auth.spec.ts`)

- Desktop E2E runs against the **plain Vite dev server on port 1420**, not a built Tauri binary. `window.__TAURI_INTERNALS__.invoke` is stubbed per-spec via `page.addInitScript`; there is no real IPC layer.
- Two mock guards, verbatim from `auth.spec.ts:44-56`, are the difference between a failing assertion and a dead page:

```
 * - Every `plugin:` command MUST resolve null. A truthy `plugin:updater` response makes
 *   `UpdateChecker` render an always-open Dialog, and Base UI's focus trap then puts
 *   `aria-hidden="true"` on the whole app — every getByRole/getByTestId elsewhere finds nothing.
 * - `transformCallback` and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` MUST exist.
 *   `RecurringApplyListener` and `useAuthSession` both call `event.listen()` on mount, which throws
 *   without them and takes the surface with it.
```

- `AccountPromptDialog` opens whenever the session resolves `LoggedOut`, and it is modal. `auth.spec.ts:456-464` records the consequence: *"The prompt is modal, so it aria-hides the rest of the shell. Dismiss before the sweep below so the clean-profile assertions are measuring the header and not the focus trap."* Any signed-out `/profile` assertion must click `continue-offline-button` first.
- Proving a pending window requires a delay, not a `waitForTimeout` — `auth.spec.ts:400-418` uses `sessionDelayMs` plus a `data-auth-state="loading"` assertion. AC 4 needs the same technique against `profile-page`'s `data-auth-state`.
- `auth.spec.ts` cannot be imported from: `apps/desktop/tests/` has no shared helper module and *"a spec must not reach into `src/`"* (`auth.spec.ts:5-6`). Copy the harness.
- Test-pattern reminders from `.claude/skills/dev-standards`: forms use `mode: "onSubmit"`; Base UI `Select` needs click-trigger + click-option, never `selectOption()`; scope locators to their container; allow ≥500 ms for intermediate states.

### Project rules that bear on this story

- **Rule 7 / 9 — strictness.** `noUnusedLocals` + `noUnusedParameters` are on; an unused import is a CI failure. All Rust and TypeScript warnings must be resolved before committing (`docs/guidelines/warnings.md`).
- **Rule 8 — shared UI first.** Reuse `Skeleton`, `EmptyState`, `Button`, `Card`; add nothing to `packages/shared/src/ui/`.
- **Rule 6 / TanStack Query.** No query key is added by this story. `queryKeys.auth.session` already exists at `lib/constants.ts:62-63`; only `hooks/useAuth.ts` may reference it — do **not** import `queryKeys` into the route or either component.
- **TanStack Router.** `routeTree.gen.ts` is generated; regenerate via dev/build.
- **i18n.** No hardcoded English in JSX, including `aria-label` values.
- **Code quality.** Comments explain WHY only, never what the code does. No `console.log`.
- **Naming.** Route files kebab-case (`profile.tsx` needs no hyphen); components PascalCase; JSON/IPC fields `snake_case` (not exercised here — no IPC).
- **No version bump.** This story ships no release, so `package.json` / `tauri.conf.json` / `Cargo.toml` versions stay as they are.

### Open decisions — record the outcome, do not silently redesign

**OD-1 · `/profile` inherits the Finance destination strip, and nothing in the architecture resolves it.**
`DestinationNav.tsx:92-144` special-cases `/car`, `/settings` (explicit `return null`), and `/ai`, then falls through to `FinanceNav`. `/profile` matches none of the three, so it renders the four Finance destination links. `isDestinationActive` (`navigation.ts:72-80`) matches nothing for `/profile` — `/` is `exact: true` — so `active` is `undefined`, `subSurfaces` is empty, and the strip paints with **no** `aria-current="page"` tab.
This does not violate AC 7 (`/profile` itself is not a link in the nav), but it is visibly different from the `/settings` precedent that architecture D1 cites, and `DestinationNav.tsx` appears on architecture's "Not touched, deliberately" list.
**Default for this story: do not modify `DestinationNav.tsx`.** The architecture's explicit no-touch instruction outranks a cosmetic improvement. Record the observed appearance in Completion Notes and escalate to the architect/UX rather than adding a `pathname.startsWith("/profile") → null` branch here.

**OD-2 · Dropdown item order and separators are unspecified.**
No UX specification exists for this feature (`epics-user-profile.md#UX Design Requirements` is deliberately empty of UX-DRs), and neither the epic nor the architecture fixes the order or the divider treatment. **Default for this story:** Profile above Sign out, sharing the single existing `DropdownMenuSeparator` that already divides the identity block from the actions — no second separator, no `DropdownMenuGroup` wrapper, no `DropdownMenuShortcut`. Rationale: the epic AC says "a 'Profile' item alongside 'Sign out'", and a destructive-ish action reads better last. Record it; a designer may reorder later.

**OD-3 · The signed-in content area is intentionally a bare email row.**
The epic defers "form section grouping and field order, first-visit empty-state copy" to the story that builds the form (28.2). **Default for this story:** one `Card` holding only the read-only email row, with no placeholder copy and no reserved space for the future form. Rationale: any interim string would need an EN key, an FR key, a `REQUIRED_KEYS` entry, and deletion in 28.2. If review wants a visible affordance, it belongs in 28.2 with the real form.

**OD-4 · No read-only explainer beside the email.**
Architecture states only that email is "displayed read-only, sourced from the Cognito `id_token`" and "never persisted". Whether the UI should also say *why* it cannot be edited is unspecified. **Default for this story:** no explainer key. Revisit alongside the form in 28.2, where an editable-vs-read-only contrast actually exists on screen.

### Project Structure Notes

**Alignment.** Every path this story creates already has a precedent: `routes/{feature}.tsx` (29 sibling route files, flat and dot-delimited), `components/{feature}/` (18 sibling feature folders — `profile/` is the nineteenth), `locales/{en,fr}.json` flat keys, `locales/__tests__/{feature}-i18n.test.ts` (6 siblings), `tests/{feature}.spec.ts` (25 siblings). Nothing new organisationally.

The architecture's delta tree for the whole feature lists these exact paths, of which this story implements the subset marked below:

```
apps/desktop/src/
├── components/
│   ├── auth/
│   │   └── ProfileMenu.tsx          # MODIFIED (this story): + "Profile" DropdownMenuItem as a
│   │                                #   Link to /profile. NO new invoke() call.
│   └── profile/
│       ├── ProfileForm.tsx          # NEW — Story 28.2, NOT this story
│       └── SignInRequired.tsx       # NEW (this story)
├── routes/
│   └── profile.tsx                  # NEW (this story): /profile route + in-route session guard
└── locales/
    ├── en.json                      # MODIFIED (this story): 5 new profile.* keys
    └── fr.json                      # MODIFIED (this story): same keys, FR values
```
[Source: architecture-user-profile.md#Delta to Existing Project Tree]

**Variances and conflicts, with rationale:**

1. **Architecture lists `tests/profile.spec.ts` as "stubbing the four new commands".** Those commands arrive in 28.2. This story creates the file stubbing only `get_auth_session` / `start_login` / `sign_out`; 28.2 extends the same file. Rationale: `.claude/skills/dev-standards` requires Playwright coverage for UI changes, and the epic's own framing calls this story "immediately verifiable" — which is only true if something verifies it. No existing spec is repurposed.
2. **Architecture's D1/G4 name `ProfileForm` as the `LoggedIn` rendering.** It does not exist yet, so the `LoggedIn` arm renders the read-only email row instead. This is exactly what the epic's sequencing note describes ("ships the page before any data"), not a divergence.
3. **`SignInRequired` is created here rather than in 28.2**, because the guard it serves is this story's deliverable. Its props are additive-friendly: 28.2 needs no change to it.
4. **Route import style.** `settings.ai-provider.tsx` and `import.tsx` use relative `../components/…`, but 18 of the 29 files in `src/routes/` import through the `@/` alias and only those two plus `__root.tsx` use a relative path. `docs/project-context.md#TypeScript` mandates the alias. Use `@/`.
5. **`auth.spec.ts` is edited.** Architecture says "Every existing `tests/*.spec.ts` — guaranteed by D11" is untouched. The edit here is a single stale **comment** (`auth.spec.ts:518`), not a mock case and not an assertion, so D11's actual guarantee — that no spec's Tauri mock needs a new command — holds intact. Flagged so review sees it as deliberate.
6. **`profile-i18n.test.ts` is edited.** Architecture says locale parity is "covered automatically by the existing suite". Inspection shows the suite is *not* fully automatic: it exact-set-matches a hardcoded array, so it must be extended. Flagged as a correction to the architecture's assumption.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.1: Reach my profile from the account menu] — the eight acceptance criteria, copied verbatim above
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 28: Your Nixus Cloud Profile] — sequencing note ("ships the page before any data"); resolved UX decision that the form uses an explicit Save button, not autosave (Story 28.2's concern, recorded here so it is not re-litigated)
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — FR1, FR2, FR4, FR7, FR8; NFR1, NFR2, NFR3, NFR5, NFR6, NFR8
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — `/profile` is a new route overturning Story 27.3; four-way route guard; `ProfileMenu` adds no `invoke`; frontend structure; no SQLite work; no new dependencies; regression checks required
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#UX Design Requirements] — no UX specification exists; entry point, dedicated route, no avatar, and the four-way guard are the only fixed constraints; form grouping and empty-state copy are flagged for decision inside stories
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)] — forward-dependency check confirming 28.1 depends on already-shipped code only
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Frontend Architecture] — D1 (dedicated `/profile` route, guard in the route), D11 (`ProfileMenu` adds a `Link` only, no new `invoke`)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Corrections to Prior Decisions] — Correction 1 (`sub` validated, never slugged) and Correction 2 (`get_location_catalog` not implemented); both are 28.2/29.x concerns, recorded so this story does not pre-empt them
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results] — G4 (four-way guard), G7 (`DropdownMenuItem render` prop), G1/G2/G3/G5/G6 (later stories)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Regression Checks Required] — "verify, do not assume" for `auth.spec.ts`; `accessibility.spec.ts` / `navigation.spec.ts` / `nav-qa.spec.ts` must be checked against the added route
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Enforcement Guidelines] — add no new `invoke()` to any always-mounted component; add every new i18n key to both locales in the same change; introduce no new dependency and no new `AppError` variant
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Delta to Existing Project Tree] — file-by-file delta and the "Not touched, deliberately" list
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Development Workflow Integration] — `routeTree.gen.ts` regenerates on the next dev/build run, never hand-edited
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Amendment (2026-08-10)] — one FR5 consumer (TFSA) pulled into scope for Epic 30; every storage, isolation, lifecycle, and boundary decision stands unchanged
- [Source: docs/project-context.md#Critical Implementation Rules] — rules 2 (Tauri IPC), 5 (`AppError`), 6 (query keys), 7 (TypeScript strictness), 8 (shared UI first), 9 (compilation warnings), 10 (version bumps)
- [Source: docs/project-context.md#Testing Rules] — line 294 (E2E runs against the Vite dev server with `invoke` stubbed per spec), line 295 (always-mounted `invoke()` forces a mock case in every spec)
- [Source: docs/project-context.md#Framework-Specific Patterns] — TanStack Router generated route tree; i18n through i18next with no hardcoded English
- [Source: docs/project-context.md#Anti-Patterns to Avoid] — never edit `routeTree.gen.ts`; never duplicate a `@nixus/shared/ui` component; never leave TS/Rust warnings
- [Source: docs/guidelines/warnings.md] — all compilation warnings must be resolved before committing
- [Source: apps/desktop/src/components/auth/ProfileMenu.tsx#deriveState (lines 27-55)] — the `unavailable` state is a live path, not defensive padding
- [Source: apps/desktop/src/components/auth/ProfileMenu.tsx#signed-in branch (lines 94-159)] — `DropdownMenuContent data-testid="profile-menu-panel"`, the identity block, the separator, and the sign-out item the new Profile item slots above
- [Source: apps/desktop/src/components/shared/TopBar.tsx:39-41] — `ProfileMenu` is already mounted, absolutely positioned so it does not displace the centred search field
- [Source: apps/desktop/src/hooks/useAuth.ts:8-59] — `useAuthSession` (raw `useQuery`, `staleTime: Infinity`, `auth:callback-received` listener), `useSignIn`, `useSignOut`
- [Source: apps/desktop/src/lib/types.ts:664-667] — the `AuthState` discriminated union
- [Source: apps/desktop/src/lib/constants.ts:62-63] — `queryKeys.auth.session`, the nested outlier; no profile key is added by this story
- [Source: apps/desktop/src/routes/__root.tsx:36-45, 107-158] — shell layout, `SURFACE_HEADING_ID` focus move, the centred measure wrapping every non-AI route
- [Source: apps/desktop/src/routes/settings.tsx, apps/desktop/src/routes/settings.ai-provider.tsx:1-74] — `createFileRoute` conventions, `PageHeader` usage, `mx-auto max-w-2xl` inner measure, and the `render={<Link/>}` call site
- [Source: apps/desktop/src/components/shared/PageHeader.tsx:1-34] — `SURFACE_HEADING_ID`, the `tabIndex={-1}` heading, optional `subtitle` and `actions`
- [Source: apps/desktop/src/components/shared/DestinationNav.tsx:92-144] — the `/car` / `/settings` / `/ai` special cases and the `FinanceNav` fallthrough that `/profile` will hit (OD-1)
- [Source: apps/desktop/src/lib/navigation.ts:1-12, 28, 67, 72-80] — rule D8, the `FourDestinations` tuple, `isDestinationActive`
- [Source: packages/shared/src/ui/segmented-nav.tsx:8-13, 33-59] — the `render`-prop pattern the Profile item follows
- [Source: packages/shared/src/ui/dropdown-menu.tsx:76-84] — `DropdownMenuItem` props (`MenuPrimitive.Item.Props`, which supplies `render` via `BaseUIComponentProps`)
- [Source: packages/shared/src/ui/skeleton.tsx:5-18] — `SkeletonProps.rows` and its "must match the real content count" contract
- [Source: packages/shared/src/ui/empty-state.tsx:5-11] — `EmptyStateProps` and the exactly-one-action rule
- [Source: packages/shared/src/ui/index.ts] — the full export barrel; no `Avatar` exists
- [Source: apps/desktop/src/components/income/IncomeEntryList.tsx:299-324] — `Skeleton` and `EmptyState` usage to mirror
- [Source: apps/desktop/src/components/expenses/ExpenseList.tsx:448-464] — `EmptyStateProps["action"]` typed-helper idiom
- [Source: apps/desktop/src/locales/__tests__/profile-i18n.test.ts:10-18, 49-65] — `REQUIRED_KEYS` and the exact-set assertion that makes Task 7 mandatory
- [Source: apps/desktop/src/locales/en.json, apps/desktop/src/locales/fr.json] — the seven shipped `profile.*` keys; 1188 keys per file
- [Source: apps/desktop/tests/auth.spec.ts:1-11, 44-56, 148-255, 400-418, 446-471, 499-539] — the mock harness to copy, the two load-bearing guards, the pending-window technique, the modal-dismissal requirement, and the three assertions to re-verify
- [Source: apps/desktop/tests/accessibility.spec.ts:33-80, 195-322] — hardcoded gotos, `default: Promise.reject`, no `get_auth_session` case
- [Source: apps/desktop/tests/navigation.spec.ts:4-15, 21-39, 53, 124] — hardcoded destination arrays, `nav`-scoped locators, count assertions, no Tauri mock at all
- [Source: apps/desktop/tests/nav-qa.spec.ts:32-92, 97-110, 125, 141, 169] — mock switch with `default: Promise.resolve([])`, the fixed `SURFACES` list, `nav`-scoped count assertions
- [Source: _bmad-output/implementation-artifacts/27-3-header-profile-menu-and-minimalist-profile-view.md] — previous-story intelligence: `ProfileMenu` state table, the "no `routes/profile.tsx`" decision this story overturns, the closed-without-execution Task 8 (which is why 24 specs never stub `get_auth_session`), and the 331-passed / 2-failed E2E baseline with its two pre-existing failures
- [Source: .claude/skills/dev-standards/SKILL.md] — quality gates (`tsc --noEmit`, full Playwright run, add tests for UI changes, fix broken tests in the same change) and the Base UI `Select` / `mode: "onSubmit"` test patterns
- [Source: CONTRIBUTING.md:176-186, 208-211] — `pnpm --filter @nixus/desktop exec playwright test [spec path]`, `pnpm --filter @nixus/desktop test`

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5` (OpenCode, Sisyphus-Junior executor)

### Debug Log References

**One real failure was found and diagnosed, not worked around.**

`tests/profile.spec.ts` → "an unusable session payload fails closed and stays silent" failed on the first run: `profile-sign-in-required` was not found within Playwright's 5 s default timeout.

Root cause: `src/main.tsx:11` constructs a bare `new QueryClient()`, so `get_auth_session` inherits the TanStack Query default of **3 retries with exponential backoff** (~1 s + 2 s + 4 s). `session.isLoading` therefore stays `true` for roughly 7 s before `isError` becomes observable, and the `unavailable` arm cannot render before then. Nothing about the guard is wrong — the entire retry window renders the skeleton, which is the fail-closed behaviour AC 9 requires.

Fix applied to the test, not to the product: assert the skeleton (and `profile-email` count 0) during the retry window, then wait for the guard with an explicit 20 s timeout. This is strictly stronger coverage than the original assertion, because it now proves the *pending* window also leaks no profile content.

### Completion Notes List

**Every AC verified. All quality gates green. Zero production-code deviations from the story's prescribed shapes.**

Verification output (all commands run from repo root; `pnpm` resolved via `/opt/homebrew/bin`):

- `pnpm --filter @nixus/desktop exec tsc --noEmit` → **exit 0, no output** (zero errors, zero warnings; `noUnusedLocals`/`noUnusedParameters` satisfied).
- `pnpm --filter @nixus/desktop build` (`tsc && vite build`) → **✓ built in 7.00s**. The only advisory is the pre-existing `(!) Some chunks are larger than 500 kB` Vite chunk-size notice, present before this story.
- `pnpm --filter @nixus/desktop test` → **Test Files 10 passed (10), Tests 151 passed (151)**, including `profile-i18n.test.ts (21 tests)` — up from 16, the five new `REQUIRED_KEYS` entries each adding an `it.each` case.
- `pnpm --filter @nixus/desktop exec playwright test tests/profile.spec.ts tests/auth.spec.ts tests/accessibility.spec.ts tests/navigation.spec.ts tests/nav-qa.spec.ts` → **54 passed (43.0s)**. `auth.spec.ts`'s 13 tests all pass unchanged, including the three at-risk assertions (`not.toContainText("profile.")`, the `localhost:1420/$` URL check, and `profile-menu-name` → `toHaveCount(0)`). `accessibility.spec.ts`, `navigation.spec.ts`, and `nav-qa.spec.ts` are green with no edits, as predicted.
- `pnpm --filter @nixus/desktop exec playwright test` (full suite) → **357 passed (1.8m), 0 failed.** Against Story 27.3's recorded baseline of 331 passed / 2 failed: the pass count rose (9 of the increase is this story's new spec) and the fail count went to **zero**. The two token regressions the baseline recorded at `chat.spec.ts:250` and `design-system.spec.ts:110` no longer reproduce — they were fixed between that baseline and this story's `baseline_commit`, not by this change.
- `git status --porcelain` → **no diff** under `apps/desktop/src-tauri/`, `packages/shared/`, `apps/web/`, `apps/desktop/src/lib/`, or `apps/desktop/src/hooks/` (verified with `git diff --stat` on those paths — empty).
- Locale key counts: **1193 in `en.json`, 1193 in `fr.json`** (1188 + 5, as Task 6 required), and the `profile.*` key sets are identical between the two files.
- No `console.log` added. No `as any`, no `@ts-ignore`, no `@ts-expect-error`. No new npm package, no new Rust crate, no Rust file touched, no migration.

Scope-fence notes:

- **`sprint-status.yaml` shows as modified in `git status`, but not by this agent.** The diff is purely the Epic 28/29/30 story registration block appended by the earlier sprint-planning step; it was already uncommitted before work began and was left untouched.
- **`ProfileMenu` needed no `onClick={() => setOpen(false)}`.** Base UI closes the menu on item activation, so the conditional escape hatch in Task 2 was not exercised. The component's only local state is still `open`, and it added exactly one import (`Link`) and one `DropdownMenuItem` — no hook, no `invoke`, no `useQuery`.
- **AC 2 holds structurally and is asserted.** `tests/profile.spec.ts` records the full IPC command list after navigating to `/profile` and asserts none of `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions` appears. This story adds zero `invoke` call sites; `SignInRequired`'s `useSignIn()` fires the already-shipped `start_login` on click only.
- **`nav-qa.spec.ts`'s `SURFACES` array was deliberately not extended** with `/profile`, as Task 8 required. Its mock `default` resolves `[]`, so `/profile` could only ever be screenshotted in the `unavailable` guard state; `profile.spec.ts` covers all five states with real stubs instead.
- **OD-1 recorded, `DestinationNav.tsx` untouched.** As predicted, `/profile` matches none of the `/car` / `/settings` / `/ai` special cases and so inherits the four Finance destination links with **no** `aria-current="page"` tab painted. AC 7 is unaffected (`/profile` itself is not a link in the nav — asserted in `profile.spec.ts`), but the cosmetic inconsistency versus the `/settings` precedent is real and is escalated to architect/UX rather than patched here.
- **OD-2, OD-3, OD-4 all taken at their documented defaults**: Profile above Sign out sharing the one existing separator; a bare read-only email row with no placeholder copy; no read-only explainer key.
- `routeTree.gen.ts` was **regenerated by the TanStack Router Vite plugin**, never hand-edited. Note for future runs: `pnpm build` is `tsc && vite build`, and `tsc` fails *before* the plugin can regenerate (`Link to="/profile"` is not yet in `FileRoutesByPath`). Running `pnpm exec vite build` directly regenerates the tree first; `tsc` then passes. The resulting diff is mechanical only — one import and the `/profile` entry across the route-map unions.

**Not done — requires a human:** Task 11's manual verification pass (`tauri dev` keyboard walkthrough, focus-ring inspection, French-language sweep via the OS accessibility inspector, and Cognito Hosted UI launch) is left unchecked. It cannot be executed headlessly. The Playwright suite covers the automatable equivalents of AC 1, 3, 4, 5, 6, 7, 9, and 10.

### File List

| File | Action |
| --- | --- |
| `apps/desktop/src/components/auth/ProfileMenu.tsx` | MODIFIED — `Link` import; Profile `DropdownMenuItem` via `render`, above Sign out |
| `apps/desktop/src/components/profile/SignInRequired.tsx` | NEW |
| `apps/desktop/src/routes/profile.tsx` | NEW — `/profile` route + five-arm in-route guard |
| `apps/desktop/src/locales/en.json` | MODIFIED — 5 new `profile.*` keys (1188 → 1193) |
| `apps/desktop/src/locales/fr.json` | MODIFIED — same 5 keys, FR values (1188 → 1193) |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | MODIFIED — `REQUIRED_KEYS` 7 → 12; stale consumer comment corrected |
| `apps/desktop/tests/profile.spec.ts` | NEW — 9 tests |
| `apps/desktop/tests/auth.spec.ts` | MODIFIED — one comment reworded, zero assertions changed |
| `apps/desktop/src/routeTree.gen.ts` | REGENERATED by the router plugin |
| `_bmad-output/implementation-artifacts/28-1-reach-my-profile-from-the-account-menu.md` | MODIFIED — task checkboxes, Dev Agent Record |

