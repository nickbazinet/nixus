# Story 28.5: Understand that an account means Nixus Cloud

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user deciding whether to create an account,
I want the sign-in affordance to say "Sign In with Nixus Cloud",
so that I understand an account is the gateway to features that aren't purely local.

## Acceptance Criteria

1. **The signed-out affordance carries the brand term in both locales, untranslated.**
   **Given** I am signed out
   **When** I look at the top-right affordance
   **Then** it reads "Sign In with Nixus Cloud" in English and "Se connecter avec Nixus Cloud" in French
   **And** "Nixus Cloud" is not translated
   [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5; architecture-user-profile.md#D14; NFR8]

2. **The account-prompt dialog's primary action uses the same brand term.**
   **Given** the account-prompt dialog appears at launch
   **When** I read its primary action
   **Then** it uses the same "Nixus Cloud" brand term
   [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5; architecture-user-profile.md#D14 — `auth.createAccount` → "Create Nixus Cloud Account" / "Créer un compte Nixus Cloud"]

3. **The dialog body copy stays literally true beside the new label (FR8).**
   **Given** the dialog body copy is reviewed alongside the new label
   **When** compared against current behaviour
   **Then** it remains literally accurate: an account authenticates me, and no profile or financial data is transmitted
   [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5; FR8; NFR2]

4. **Locale parity holds — every affected key exists in both files.**
   **Given** new or changed i18n keys
   **When** the locale parity suite runs
   **Then** every key exists in both `en.json` and `fr.json` and the suite passes
   [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5; apps/desktop/src/locales/__tests__/profile-i18n.test.ts; apps/desktop/src/locales/__tests__/auth-i18n.test.ts]

5. **The E2E auth suite still passes, with label assertions updated.**
   **Given** the relabel lands
   **When** `tests/auth.spec.ts` runs
   **Then** it still passes, with any label assertion updated to the new copy
   [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5; apps/desktop/tests/auth.spec.ts:459,560]

## Tasks / Subtasks

- [x] **Task 1: Capture the pre-change test baseline** (AC: 4, 5)
  - [x] Run `pnpm --filter @nixus/desktop test` and record the file/test counts. Actual (working tree already includes Stories 28.1–28.4, so this is higher than the 27.4 baseline of 9 files/141): **10 files, 158 passed**.
  - [x] Run `pnpm --filter @nixus/desktop exec playwright test` and save the pass/fail list. Actual: **366 tests, 366 passed** on the clean baseline run (before edits). Done **before** editing anything.

- [x] **Task 2: Relabel the two keys in `apps/desktop/src/locales/en.json`** (AC: 1, 2, 4)
  - [x] `"profile.signIn": "Sign in"` → `"profile.signIn": "Sign In with Nixus Cloud"`.
  - [x] `"auth.createAccount": "Create Account"` → `"auth.createAccount": "Create Nixus Cloud Account"`.
  - [x] Changed **values only**. No key added, renamed, or restructured.
  - [x] No other line touched.

- [x] **Task 3: Relabel the same two keys in `apps/desktop/src/locales/fr.json`, in the same pass** (AC: 1, 2, 4)
  - [x] `"profile.signIn": "Se connecter"` → `"profile.signIn": "Se connecter avec Nixus Cloud"`.
  - [x] `"auth.createAccount": "Créer un compte"` → `"auth.createAccount": "Créer un compte Nixus Cloud"`.
  - [x] "Nixus Cloud" is not translated, accented, reordered, or hyphenated.
  - [x] Both locale files edited together in this pass.

- [x] **Task 4: FR8 accuracy review of the surrounding dialog copy — flag, do not silently rewrite** (AC: 3)
  - [x] Re-read `auth.promptBody` and `auth.promptFutureFeatures` (EN/FR) as rendered directly above the new button.
  - [x] Re-confirmed the Dev Notes "FR8 sentence-by-sentence verdict" sentence by sentence: both remain literally true — an account authenticates via Cognito OAuth/PKCE (only identity crosses the network); no profile or financial data is transmitted.
  - [x] No sentence became misleading beside the new label — **no revision required**. See Completion Notes List.
  - [x] Explicitly reviewed `auth.promptTitle` ("Nixus accounts are here" / "Les comptes Nixus sont arrivés"). Default action taken: **no change**. Flag recorded in Completion Notes List.

- [x] **Task 5: Lock the brand term with locale-suite assertions** (AC: 1, 2, 4)
  - [x] Added exact-value assertions in `profile-i18n.test.ts` for `profile.signIn` (EN/FR) plus an untranslated-brand `toContain("Nixus Cloud")` check on the FR value.
  - [x] Added exact-value assertions in `auth-i18n.test.ts` for `auth.createAccount` (EN/FR) plus the same untranslated-brand check.
  - [x] Added `apps/desktop/src/locales/__tests__/brand-i18n.test.ts`: case-sensitive sweep of every value in both locale files against the forbidden synonyms `Nixus Sync`, `Nixus Account`, `Nixus Online`, with a WHY comment explaining the case-sensitivity choice re: `auth.promptTitle`.
  - [x] `REQUIRED_KEYS` untouched in both existing suites — no key added/renamed/removed.

- [x] **Task 6: Update the literal-copy assertions in `apps/desktop/tests/auth.spec.ts`** (AC: 5)
  - [x] "the logged-out header icon renders a sign-in affordance with no error state": `aria-label` assertion updated to `"Sign In with Nixus Cloud"`.
  - [x] "sign-out invokes sign_out once and returns both surfaces to logged out": identical assertion updated.
  - [x] Both kept as exact-string `toHaveAttribute`, not weakened to regex/`toContain`.
  - [x] Test title at "Create Account invokes start_login exactly once…" left unrenamed.
  - [x] **Scope note (not anticipated by this story's original audit):** `apps/desktop/tests/profile.spec.ts:434` (added by Story 28.1, working-tree-only, not yet committed at story authoring time) also asserted `toHaveText("Sign in")` on `profile-sign-in-action`, which renders the same `profile.signIn` key via `routes/profile.tsx:79`. Updated to `"Sign In with Nixus Cloud"` — this is a relabel-caused break, not a widening of scope, and no other spec/mock was touched.

- [x] **Task 7: Visual verification in both locales, including at minimum window width** (AC: 1, 2)
  - [x] Verified programmatically (Playwright, dev server) rather than by hand: EN header renders `"Sign In with Nixus Cloud"` as both `aria-label` and visible text (same key, both sites).
  - [x] Switched to French (`localStorage.i18nextLng = "fr"`); header renders `"Se connecter avec Nixus Cloud"`.
  - [x] Dialog primary button and `auth.openingBrowser` pending-state copy unchanged (not touched by this story; already covered by Task 6/8's passing auth.spec.ts run).
  - [x] Resized to `1024×680` (app minimum) in French and measured bounding boxes of the profile trigger vs. the centred search field.
  - [x] **Overlap found — flagged, not fixed.** See Completion Notes List and Risk R4. Screenshot: `/tmp/visual-fr-min-width.png` (local artifact, not committed).

- [x] **Task 8: Quality gates** (AC: 1, 2, 3, 4, 5)
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — exit 0, zero output.
  - [x] `pnpm --filter @nixus/desktop test` — **11 files / 168 passed** (baseline 10/158 + 10 new assertions across profile-i18n, auth-i18n, and the new brand-i18n.test.ts; zero regressions).
  - [x] `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts` — **13/13 passed**.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` (full suite) — **366/366 passed** on the clean run; a later run showed 2 failures in `chat.spec.ts`/`expenses.spec.ts` unrelated to this change (known load flake), and both passed 100% when re-run in isolation (41/41). No new failures attributable to this story.
  - [x] Locale key parity confirmed programmatically: **en.json 1199 keys / fr.json 1199 keys**, identical key sets, both before and after this story's edits.
  - [x] `git diff --name-only` scope: `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`, `apps/desktop/src/locales/__tests__/profile-i18n.test.ts`, `apps/desktop/src/locales/__tests__/auth-i18n.test.ts`, `apps/desktop/src/locales/__tests__/brand-i18n.test.ts` (new), `apps/desktop/tests/auth.spec.ts`, `apps/desktop/tests/profile.spec.ts` (untracked file from 28.1, edited for the reason above), and this story file. No `.rs`, `Cargo.toml`, `package.json`, or `apps/web/` path touched by this story. (Other `.rs`/`.tsx`/`routeTree.gen.ts`/`sprint-status.yaml` diffs pre-exist from Stories 28.1–28.4 and were not modified in this pass.)

## Dev Notes

**What this story is.** A two-value i18n relabel plus the tests that lock it. No component, no Rust, no schema, no dependency, no configuration, no version bump. Architecture D14 is the whole specification: `profile.signIn` → "Sign In with Nixus Cloud" / "Se connecter avec Nixus Cloud"; `auth.createAccount` → "Create Nixus Cloud Account" / "Créer un compte Nixus Cloud", both locale files in the same change. [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#D14 (line 343); #Requirements-to-Structure map (line 571) — "FR7/FR8: `en.json`, `fr.json`" with no component column]

**Why the copy matters more than its size.** "Nixus Cloud" is being reserved as the canonical brand term for every future networked feature — sync, mobile notifications, photo sync, community. The relabel is deliberate groundwork: it tells the user an account is the gateway to non-local information **before** any such feature exists. That forward promise is exactly why FR8 exists — today only identity crosses the network, and the README claim "your data never leaves your machine" must stay literally true. Copy that overstates today's behaviour would trade a truthful product for a marketing word. [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Brand groundwork (line 33), FR7 (line 49), NFR8 (line 61); epics-user-profile.md FR8 (line 43), NFR2 (line 50)]

**No dependency on any other story.** Story 28.5 depends on already-shipped code only (Epics 26–27, `sprint-status.yaml`: `epic-27: done`) and is explicitly recorded as independent in the epic's forward-dependency walk: "28.5 is independent". It can be implemented at any point in Epic 28 — before 28.1, after 28.4, or in parallel — and nothing in 28.1–28.4, Epic 29, or Epic 30 gates it or is gated by it. [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04), line 127]

### Affected i18n keys — exact before/after

Both files are **flat dotted-key JSON** (`Record<string, string>`, 1190 lines each), not nested. Line numbers below are current as of this story's authoring and are given to locate the edit, not to be trusted blindly.

**Keys that CHANGE (2 of 14):**

| Key | Line | Current EN | New EN | Current FR | New FR |
| --- | --- | --- | --- | --- | --- |
| `profile.signIn` | 40 | `Sign in` | `Sign In with Nixus Cloud` | `Se connecter` | `Se connecter avec Nixus Cloud` |
| `auth.createAccount` | 57 | `Create Account` | `Create Nixus Cloud Account` | `Créer un compte` | `Créer un compte Nixus Cloud` |

**Keys that STAY — every remaining key in the two affected namespaces, with an explicit decision:**

| Key | Line | Current EN | Current FR | Decision and why |
| --- | --- | --- | --- | --- |
| `profile.accountMenu` | 41 | `Account menu for {{email}}` | `Menu du compte pour {{email}}` | **STAYS.** `aria-label` on the signed-in trigger. Describes a local UI surface, carries no "Nixus" prefix, so it is not an NFR8 synonym. Keeps its `{{email}}` placeholder (asserted by `profile-i18n.test.ts` `PLACEHOLDER_KEYS`). |
| `profile.loading` | 42 | `Loading account…` | `Chargement du compte…` | **STAYS.** Transient pending label, rendered icon-only (`showLabel` is false while loading, `ProfileMenu.tsx:172`). Brand noise here would resize the trigger on every launch. Single-character ellipsis `…` (U+2026) is test-enforced — do not retype as `...`. |
| `profile.signedInAs` | 43 | `Signed in as` | `Connecté en tant que` | **STAYS.** Menu section label shown only once already signed in; the brand promise has been made by then. |
| `profile.signOut` | 44 | `Sign out` | `Se déconnecter` | **STAYS.** Signing out is a local act; "Sign Out of Nixus Cloud" would imply the session lives elsewhere. |
| `profile.sessionExpired` | 45 | `Your session expired. Sign in again to reconnect.` | `Votre session a expiré. Reconnectez-vous.` | **STAYS.** Toast text for a user who already has an account. Asserted by `auth.spec.ts:580` as `/Your session expired/` — changing it breaks that test for no requirement. |
| `profile.sessionExpiredAction` | 46 | `Session expired — sign in again` | `Session expirée — se reconnecter` | **STAYS.** Not in D14's scope, and Story 28.1 reuses this exact copy for the `/profile` route's `SessionExpired` guard. Asserted by `auth.spec.ts:584` as `/Session expired/`. |
| `auth.promptTitle` | 54 | `Nixus accounts are here` | `Les comptes Nixus sont arrivés` | **STAYS — but FLAGGED.** See "Flagged for decision" below. Default action is no change. |
| `auth.promptBody` | 55 | `Nothing in Nixus requires an account today. Your data stays on this machine and every feature keeps working exactly as it does now, with or without one.` | `Aucune fonctionnalité de Nixus n'exige de compte aujourd'hui. Vos données restent sur cet appareil et tout continue de fonctionner exactement comme maintenant, avec ou sans compte.` | **STAYS — verbatim, and load-bearing.** This is the sentence that stops "Nixus Cloud" from implying cloud storage. Rewriting or softening it is the single most damaging thing this story could do (FR8, NFR2). Two assertions pin fragments of it: `auth-i18n.test.ts` requires `"Nothing in Nixus requires an account"` (EN) and `"n'exige de compte"` (FR). |
| `auth.promptFutureFeatures` | 56 | `Features we're exploring — mobile notifications, photo sync, and community features — may need an account later. Creating one now means it's ready when they arrive.` | `Des fonctionnalités à l'étude — notifications mobiles, synchronisation des photos et fonctionnalités communautaires — pourraient en exiger un plus tard. En créer un dès maintenant, c'est être prêt à leur arrivée.` | **STAYS — verbatim.** Already conditional and forward-looking ("exploring", "may", "later"), which is precisely the Nixus Cloud framing. `auth-i18n.test.ts` pins the fragments `mobile notifications` / `photo sync` / `community` (EN) and `notifications mobiles` / `photos` / `communautaires` (FR); a reworded sentence that drops any of them fails CI. |
| `auth.continueOffline` | 58 | `Continue Offline` | `Continuer hors ligne` | **STAYS.** "Offline" describes a state, not a product, so it is not a brand synonym and needs no alignment. It now reads as the deliberate counterweight to "Nixus Cloud", which is the intended contrast. |
| `auth.openingBrowser` | 59 | `Opening your browser…` | `Ouverture du navigateur…` | **STAYS.** Pending label on the same button as `auth.createAccount` (`AccountPromptDialog.tsx:112-113`). Adding the brand term to a transient pending state would make the button jump width mid-press. Single-character ellipsis `…` (U+2026) is test-enforced. |
| `auth.signInFailed` | 60 | `Could not open your browser to create an account. Please try again.` | `Impossible d'ouvrir votre navigateur pour créer un compte. Veuillez réessayer.` | **STAYS.** Error toast; already literally accurate. Brand terms in failure copy read as marketing at the worst moment. |

No key outside these two namespaces mentions sign-in or account creation: a repo-wide search for `profile.signIn` and `auth.createAccount` returns only `ProfileMenu.tsx`, `AccountPromptDialog.tsx`, the two locale files, the two locale test suites, and planning documents — no `apps/web` and no `packages/shared` hit.

### FR8 sentence-by-sentence verdict (Task 4 confirms, does not re-derive)

Read each sentence as the user reads it — immediately above a button that now says "Create Nixus Cloud Account".

| Sentence | Verdict beside the new label |
| --- | --- |
| EN "Nothing in Nixus requires an account today." / FR "Aucune fonctionnalité de Nixus n'exige de compte aujourd'hui." | **True.** Cognito login shipped in Epics 26–27 and gates nothing. NFR1 keeps it that way. |
| EN "Your data stays on this machine and every feature keeps working exactly as it does now, with or without one." / FR "Vos données restent sur cet appareil et tout continue de fonctionner exactement comme maintenant, avec ou sans compte." | **True, and now the most important sentence in the dialog.** Only identity crosses the network (OAuth/PKCE token exchange); no profile or financial data is transmitted. "Nixus Cloud" invites the inference that data is uploaded, and this sentence is the explicit denial of that inference. Keep verbatim. |
| EN "Features we're exploring — mobile notifications, photo sync, and community features — may need an account later." / FR "Des fonctionnalités à l'étude — … — pourraient en exiger un plus tard." | **True.** Conditional and future-tense; makes no claim about today. This is exactly the "gateway to non-local features" expectation the relabel is setting. |
| EN "Creating one now means it's ready when they arrive." / FR "En créer un dès maintenant, c'est être prêt à leur arrivée." | **True.** Claims readiness, not capability. |

Conclusion: **no revision is required** to `auth.promptBody` or `auth.promptFutureFeatures`. AC 3 is satisfied by verifying and recording this, not by editing copy.

### Flagged for decision (out of scope by default)

`auth.promptTitle` — EN "Nixus accounts are here", FR "Les comptes Nixus sont arrivés".

- **The tension.** NFR8 reserves "Nixus Cloud" and forbids the synonyms "Nixus Sync", "Nixus Account", and "Nixus Online". After this story, the dialog's title says "Nixus accounts" while its primary button says "Nixus Cloud Account" — the exact drift NFR8 was written to prevent, one line apart on the same surface.
- **Why it is not fixed here.** D14 and this story's ACs scope the change to `profile.signIn` and `auth.createAccount`. Widening a copy-only story to a third key on the agent's own judgement is precisely the silent rewrite AC 3 forbids.
- **Proposed revision, pending approval:** EN `"Nixus Cloud accounts are here"`, FR `"Les comptes Nixus Cloud sont arrivés"`.
- **Blast radius if approved:** value-only, no key added or renamed, so `auth-i18n.test.ts`'s "declares every auth key it ships" is unaffected; no test asserts this key's value; `auth.spec.ts:333` only asserts the dialog does not render raw `auth.` keys. Low risk — but still a decision, not a task.
- **Default action:** leave unchanged and record the flag in the Completion Notes List.

### Where the affected copy renders

- `apps/desktop/src/components/auth/ProfileMenu.tsx` — `profile.signIn` is read at **two** sites, and both are covered by the single value change:
  - **Line 167** — the `label` variable's fallback branch, applied as `aria-label={label}` at **line 182**. This is the accessible-name path, and it is what `auth.spec.ts:459` and `:560` assert.
  - **Line 192** — `{showLabel && t("profile.signIn")}`, the visible text. Rendered whenever the state is not `loading` (line 172), i.e. for `logged-out`, `session-expired`, and `unavailable`. Note the `session-expired` state shows `profile.sessionExpiredAction` as its `aria-label` (line 166) while line 192 renders `profile.signIn` as its visible text — that pre-existing asymmetry is out of scope and must not be "fixed" here.
  - **No component edit.** Both sites already call `t("profile.signIn")`; changing the locale value changes both. `size={showLabel ? "default" : "icon"}` (line 179) means the button widens with the label — see Risk R4.
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` — `auth.createAccount` renders at **line 114**, as the non-pending branch of the primary button's label (`data-testid="create-account-button"`, line 110). `auth.promptBody` renders at **line 87** (`DialogDescription`) and `auth.promptFutureFeatures` at **line 91**. **No component edit** — the architecture is explicit: "`components/auth/AccountPromptDialog.tsx` — only its i18n _values_ change (D14), not the component."

### Locale parity: why any one-sided key fails CI

`apps/desktop/src/locales/__tests__/` holds six `*-i18n.test.ts` suites run by vitest. Two cover this story's namespaces, and both are stricter than plain parity:

- **`profile-i18n.test.ts`** — declares `REQUIRED_KEYS` (7 `profile.*` keys) and asserts each is truthy in both locales; asserts no `profile.` key exists in one file only; and asserts the **shipped `profile.*` key set is exactly equal to `REQUIRED_KEYS`** (lines 58–65). It also asserts `profile.signIn` has a non-empty accessible name (`ARIA_LABEL_KEYS`), and — deliberately — that the neighbouring `auth.*` block is still intact (lines 102–117), because a careless JSON edit around lines 40–60 would still parse and would only surface as a raw key in the UI.
- **`auth-i18n.test.ts`** — the same three-way shape for the 7 `auth.*` keys, plus the ellipsis rule on `auth.openingBrowser`, plus fragment assertions on `auth.promptBody` and `auth.promptFutureFeatures`, plus a guard that user-identity copy never lands in the `accounts.*` namespace (`accounts.*` means a bank or investment account everywhere else in this app).

`t()` on a missing key renders the **raw key string** rather than throwing, so an EN-only addition or a typo ships silently and shows a user `profile.signIn` in the header. That is the failure mode these suites exist to make impossible — and the reason both locale files must move together. [Source: apps/desktop/src/locales/__tests__/auth-i18n.test.ts:10-13; docs/project-context.md#Testing Rules]

### auth.spec.ts assertion audit

Every assertion in the desktop Playwright suite that touches affected copy or could plausibly react to it, and its disposition:

| Location | Assertion | Disposition |
| --- | --- | --- |
| `auth.spec.ts:459` | `expect(trigger).toHaveAttribute("aria-label", "Sign in")` | **MUST UPDATE** → `"Sign In with Nixus Cloud"`. Exact string match; fails otherwise. |
| `auth.spec.ts:560` | `expect(trigger).toHaveAttribute("aria-label", "Sign in")` | **MUST UPDATE** → `"Sign In with Nixus Cloud"`. Same assertion, post-sign-out. |
| `auth.spec.ts:584` | `toHaveAttribute("aria-label", /Session expired/)` | No change — `profile.sessionExpiredAction` stays. |
| `auth.spec.ts:580` | toast `toContainText(/Your session expired/)` | No change — `profile.sessionExpired` stays. |
| `auth.spec.ts:331`, `:431` | `getByTestId("create-account-button")` visible / click | No change — testid, not text. |
| `auth.spec.ts:333`, `:469`, `:520` | `not.toContainText("auth.")` | Still passes — new values contain no raw-key prefix. |
| `auth.spec.ts:470`, `:521` | `not.toContainText("profile.")` | Still passes — same reason. |
| `auth.spec.ts:467` | header `not.toContainText(/expired\|error\|failed/i)` | Still passes — "Sign In with Nixus Cloud" matches none of those. |
| `auth.spec.ts:308-313` (`expectNoGating`) | `/upgrade\|paywall\|requires an account\|sign in to continue\|not entitled/i` count 0 | Still passes — neither new label matches. **Guardrail:** if Task 4 ever produces an approved copy revision, it must not introduce text matching this regex on any surface that stays mounted after the dialog is dismissed. |
| `auth.spec.ts:473-496` | centred-search drift `< 8px` | Still passes — see Risk R4; `ProfileMenu` is absolutely positioned, so its width cannot displace the search field. |
| `auth.spec.ts:422` | test **title** "Create Account invokes start_login…" | Leave as is. A title, not an assertion; renaming is diff noise. |

No other spec in `apps/desktop/tests/` references this copy: a case-insensitive search for `sign in` / `sign-in` / `signin` / `nixus cloud` across the whole directory returns hits in `auth.spec.ts` only.

### Risks and the mistakes to not make

- **R1 — Do not add, rename, or remove a key.** Both locale suites assert the shipped key set is **exactly** their `REQUIRED_KEYS` array (`profile-i18n.test.ts:58-65`, `auth-i18n.test.ts:49-54`). Introducing `profile.signInWithNixusCloud`, or renaming `auth.createAccount` to `auth.createNixusCloudAccount`, fails vitest immediately — and would also orphan the two component call sites. Change values in place.
- **R2 — Both locale files, one commit.** D14 is explicit, and the parity suite is the enforcement. Do not stage `en.json` and defer `fr.json`.
- **R3 — Do not translate, transliterate, or decorate the brand term in FR.** "Nixus Cloud" appears verbatim: not "Nuage Nixus", not "Nixus nuage", not "Nixus-Cloud". NFR8 also forbids introducing "Nixus Sync", "Nixus Account", or "Nixus Online" anywhere — desktop, web, or Cognito branding. Task 5's sweep makes that machine-checked for the desktop locale files.
- **R4 — The label triples in width; the layout must not be touched.** `TopBar.tsx:39` pins `ProfileMenu` with `absolute inset-y-0 right-page-x` precisely so it is **not** a flex sibling of the `justify-center` search row — which is why the drift assertion at `auth.spec.ts:473-496` is safe. The residual risk is **visual overlap**, not displacement: the search button is `w-full max-w-[480px]` centred (`TopBar.tsx:20`), `--spacing-page-x` is `20px`, and the FR label grows from 7 to 29 characters. At the app's `minWidth: 1024` (minus the sidebar) the right-pinned button can reach the centred field. Verify visually (Task 7). If it overlaps, **flag it — do not restructure the header**; component and layout changes are out of scope for a copy-only story.
- **R5 — No new `invoke()`, so no spec mock needs a new case.** Neither component gains an IPC call, so the always-mounted-component trap in `docs/project-context.md:295` is not triggered and no existing spec's `__TAURI_INTERNALS__.invoke` switch needs a new command. Do not add `get_auth_session` to unrelated specs' mocks: resolving it there would open the modal `AccountPromptDialog`, and Base UI's focus trap would `aria-hidden` the app, silently breaking every `getByRole`/`getByTestId` in those specs.
- **R6 — Preserve exact characters.** FR values use straight apostrophes (`n'exige`, `l'étude`, `d'ouvrir`) while some unrelated lines nearby use typographic ones; the pending-state keys use the single-character ellipsis `…` (U+2026), which is test-enforced. Only two lines are being edited, so the safest edit is a targeted single-line replacement, not a reformat, a re-serialisation, or a prettier pass over a 1190-line file.
- **R7 — Compilation warnings are CI failures.** `strict` + `noUnusedLocals` + `noUnusedParameters` apply to the new test file too; an unused import or local in `brand-i18n.test.ts` fails the build. No `console.log`. [Source: docs/project-context.md#7, #9, #Code Quality & Style Rules]

### Explicitly out of scope

- **`apps/web` marketing copy and AWS Cognito Managed Login branding.** "Nixus Cloud" spans three surfaces; **only desktop changes in this pass.** The other two are recorded as deferred follow-on alignment work, not silent debt — stated in the architecture's "Out of scope for this pass" list and in the epic's Documentation Obligations. Saying so here so nobody reviewing this story concludes it was missed. Do not touch `apps/web/`, and do not make any AWS-side configuration change. [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Brand surface spanning three codebases (line 91), line 166; epics-user-profile.md#Documentation Obligations (line 111)]
- **All later-story work.** No profile fields, no `/profile` route, no `ProfileMenu` navigation item (Story 28.1), no `profile_store.rs` / `json_store.rs` / `commands/profile.rs` / `current_subject()` (28.2), no `DatePicker` props or `birth_date` (28.3), no `delete_all_data` change (28.4), no country/subdivision/income (Epic 29), no TFSA anything (Epic 30). No Rust file is opened by this story.
- **Component and logic changes.** `ProfileMenu.tsx` and `AccountPromptDialog.tsx` are read-only reference here.
- **Version bump.** Not a release; the three-file version rule does not apply.

### Testing standards summary

- **Vitest** (`pnpm --filter @nixus/desktop test`) covers the locale suites in `src/locales/__tests__/*.test.ts` — jsdom, no `@testing-library/react`.
- **Playwright** (`pnpm --filter @nixus/desktop exec playwright test`) runs against the plain **Vite dev server on port 1420**, not a built Tauri binary; `window.__TAURI_INTERNALS__.invoke` is stubbed per-spec via `page.addInitScript`. There is no real IPC layer in this suite, so nothing here can be verified against actual Cognito.
- **Type check** (`pnpm --filter @nixus/desktop exec tsc --noEmit`) covers specs as well as `src/`.
- Baseline to beat, from Story 27.4's verified run: vitest **9 files / 141 passed**; Playwright **346 tests / 344 passed / 2 pre-existing `tokens.css` failures from commit `9b45411`**.
  [Source: docs/project-context.md#Testing Rules; _bmad-output/implementation-artifacts/27-4-auth-e2e-coverage-and-licensing-independence-amendment.md#Gates]

### Project Structure Notes

- **Locale files:** `apps/desktop/src/locales/{en,fr}.json` — the established i18n location (`docs/project-context.md#Desktop App Structure`). Flat dotted-key `Record<string, string>`. Keys stay in the existing `profile.*` and `auth.*` namespaces; the architecture forbids a second namespace such as `userProfile.*` precisely because `profile.signIn` and `profile.signOut` already live there.
- **Locale tests:** `apps/desktop/src/locales/__tests__/` — desktop deliberately uses a `__tests__/` directory for vitest specs. The "no `__tests__/` directories, co-locate instead" rule in `docs/project-context.md` applies to **`apps/web`** only; following it here would contradict the five existing suites.
- **One new file — `apps/desktop/src/locales/__tests__/brand-i18n.test.ts`.** Variance with rationale: both existing suites are **prefix-scoped by construction** (each filters keys by `profile.` / `auth.`), so neither can host a whole-locale synonym sweep without breaking its own "declares every key it ships" contract. A sixth sibling following the established `<domain>-i18n.test.ts` naming is the smallest change that expresses a cross-namespace invariant. No other new file, and no new directory.
- **E2E spec:** `apps/desktop/tests/auth.spec.ts` — edited in place, two lines. No new spec file; the behaviour is already covered, only the expected string moves.
- **Naming:** no new component, hook, route, query key, Rust module, model, or IPC command, so no naming-convention decision arises.
- **No conflicts detected** with the unified project structure. Nothing in this story creates a file outside an existing directory, and `routeTree.gen.ts`, `MIGRATIONS`, `Cargo.toml`, `package.json`, and `tauri.conf.json` are all untouched.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.5: Understand that an account means Nixus Cloud] — the five acceptance criteria, copied faithfully above.
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — FR7 (line 42), FR8 (line 43), NFR8 (line 56), inherited platform-wide i18n rule (line 58).
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — no new dependencies (line 63), no SQLite work (line 64), no configuration changes (line 93), testing expectations including "locale parity covered automatically by the existing suite in `src/locales/__tests__/`" (line 91), regression checks required in `tests/auth.spec.ts` (line 92).
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Documentation Obligations, line 111] — `apps/web` and Cognito Managed Login brand alignment tracked as deferred follow-on work.
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04), line 127] — "28.5 is independent"; no forward or backward story dependency.
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 28: Your Nixus Cloud Profile, lines 154-163] — epic goal and the FR7/FR8/NFR8 coverage claim.
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#D14 · "Nixus Cloud" relabel, line 343] — the exact four target strings, the same-change requirement for both locale files, the locale-parity CI failure mode, and "Nixus Cloud is untranslated in FR per NFR8".
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md, lines 33, 49, 61] — brand groundwork rationale, FR7, NFR8.
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md, lines 91, 156, 166] — brand surface spans three codebases; desktop only in this pass; `apps/web` + Cognito Managed Login explicitly out of scope.
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md, lines 401, 519, 537, 571, 633, 644] — keep the existing `profile.*` namespace; `en.json` modified for the D14 relabels; `AccountPromptDialog.tsx` values-only, not the component; FR7/FR8 map to locale files only.
- [Source: docs/project-context.md#i18n (Both Apps)] — all user-visible strings go through i18next; no hardcoded English in JSX.
- [Source: docs/project-context.md#Testing Rules] — vitest locale-parity specs live in `src/locales/__tests__/`; Playwright runs against the Vite dev server with `invoke` stubbed per-spec; line 295's always-mounted-component mock trap.
- [Source: docs/project-context.md#7 TypeScript Strictness, #9 Compilation Warnings Policy, #Code Quality & Style Rules] — `noUnusedLocals`/`noUnusedParameters` are CI failures; comment WHY not WHAT; no `console.log`.
- [Source: apps/desktop/src/locales/en.json:40,54-60] — current EN values, verbatim in the tables above.
- [Source: apps/desktop/src/locales/fr.json:40,54-60] — current FR values, verbatim in the tables above.
- [Source: apps/desktop/src/locales/__tests__/profile-i18n.test.ts:10-18,24-29,49-65,102-117] — `REQUIRED_KEYS`, `ARIA_LABEL_KEYS`, exact-key-set assertion, neighbouring-`auth.*`-block guard.
- [Source: apps/desktop/src/locales/__tests__/auth-i18n.test.ts:10-22,28,40-54,69-98] — `REQUIRED_KEYS`, ellipsis rule, exact-key-set assertion, `accounts.*` namespace guard, `promptBody`/`promptFutureFeatures` fragment assertions.
- [Source: apps/desktop/src/components/auth/ProfileMenu.tsx:162-193] — both `profile.signIn` render paths (`aria-label` via line 167→182, visible label at 192) and the `size` switch at 179.
- [Source: apps/desktop/src/components/auth/AccountPromptDialog.tsx:85-115] — `auth.promptBody` (87), `auth.promptFutureFeatures` (91), `auth.continueOffline` (102), pending/`auth.createAccount` branch (112-114).
- [Source: apps/desktop/src/components/shared/TopBar.tsx:15-41] — the centred `max-w-[480px]` search and the absolutely pinned `ProfileMenu`, with the in-code rationale for that pinning.
- [Source: apps/desktop/tests/auth.spec.ts:308-313,331,333,422,431,459,467-470,473-496,520-521,560,580,584] — the full assertion audit above.
- [Source: apps/desktop/playwright.config.ts] — `testDir: ./tests`, `webServer` on port 1420, `reuseExistingServer` outside CI.
- [Source: apps/desktop/src-tauri/tauri.conf.json] — window `width: 1280`, `height: 800`, `minWidth: 1024`, `minHeight: 680`, driving the Task 7 narrow-window check.
- [Source: packages/shared/src/styles/tokens.css:267] — `--spacing-page-x: 20px`, the right inset of the pinned profile button.
- [Source: _bmad-output/implementation-artifacts/27-2-account-prompt-dialog-with-continue-offline.md] — the story that introduced the `auth.*` keys and `AccountPromptDialog`.
- [Source: _bmad-output/implementation-artifacts/27-3-header-profile-menu-and-minimalist-profile-view.md:91-92,139-142] — the story that introduced the `profile.*` keys and the `ProfileMenu` state table, including `aria-label={t("profile.signIn")}` for both `logged-out` and `unavailable`.
- [Source: _bmad-output/implementation-artifacts/27-4-auth-e2e-coverage-and-licensing-independence-amendment.md:57,78,134-137,196,460-463] — the gate command forms, the "baseline first, diff after" discipline, the verified 141-vitest / 346-Playwright baseline with its 2 pre-existing failures, and the confirmation that locale files are flat dotted-key JSON.

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-sonnet-5

### Debug Log References

- `pnpm --filter @nixus/desktop test` (post-change): 11 files / 168 passed.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`: exit 0, no output.
- `pnpm --filter @nixus/desktop exec playwright test tests/auth.spec.ts`: 13/13 passed.
- `pnpm --filter @nixus/desktop exec playwright test` (full suite, clean run): 366/366 passed.
- `pnpm --filter @nixus/desktop exec playwright test` (full suite, second run): 364/366 passed, 2 failed (`chat.spec.ts:410`, `expenses.spec.ts:404`); re-run in isolation (`tests/expenses.spec.ts tests/chat.spec.ts`): 41/41 passed — confirmed pre-existing load flake, not a regression from this story.
- Locale parity check (Python, `json.load` + set comparison): en.json 1199 keys, fr.json 1199 keys, identical key sets, both before and after edits.
- Visual overlap check: temporary Playwright test appended to and removed from `auth.spec.ts` (never committed) measured bounding boxes at 1024×680 in French — profile trigger box `x:757.5–1004` overlaps search box `x:368–848` by ~90px. Screenshot saved to `/tmp/visual-fr-min-width.png` (local artifact only, not part of the repo).

### Completion Notes List

- **Task 4 (FR8 review) — no revision required.** Re-confirmed the Dev Notes' pre-verified sentence-by-sentence verdict: `auth.promptBody` and `auth.promptFutureFeatures` (EN + FR) remain literally true beside the new "Create Nixus Cloud Account" / "Créer un compte Nixus Cloud" label — today only identity crosses the network (Cognito OAuth/PKCE), no profile or financial data is transmitted, and the future-features sentence is already conditional/future-tense. Left both values byte-identical, per the story's instruction to verify rather than re-derive.
- **`auth.promptTitle` flag — recorded, no change made (default action).** EN "Nixus accounts are here" / FR "Les comptes Nixus sont arrivés" now sits one line above a button reading "Nixus Cloud Account" — the exact brand drift NFR8 exists to prevent, on the same surface. This story's ACs scope the change to `profile.signIn` and `auth.createAccount` only, so per the story's explicit instruction this is flagged, not fixed. **Proposed revision (pending approval, not applied):** EN → `"Nixus Cloud accounts are here"`, FR → `"Les comptes Nixus Cloud sont arrivés"`. Blast radius if approved: value-only change, no key added/renamed, no test asserts this key's exact value today.
- **Task 7 (visual verification) — layout overlap found and flagged, not fixed.** At the app's minimum window size (1024×680) in French, the right-pinned profile/sign-in button ("Se connecter avec Nixus Cloud", 29 characters vs. the previous 7) visually overlaps the centred search field. Measured bounding boxes: search `x: 368–848`, trigger `x: 757.5–1004` → ~90px overlap. Confirmed visually via screenshot (`/tmp/visual-fr-min-width.png`): the word "connecter" is partially obscured behind the search field's right edge. This matches the risk already called out in Dev Notes → "Risk R4". Per Task 7's explicit instruction, this is a header-layout issue and out of scope for this copy-only story — **not fixed here**. The existing `auth.spec.ts:473-496` centred-search-drift assertion still passes because it measures displacement (none — `ProfileMenu` is absolutely positioned), not overlap, so it does not catch this. Recommend a follow-up story/task to either shrink the search field's `max-w-[480px]` at narrow breakpoints or truncate/wrap the profile label.
- **Scope note — `profile.spec.ts:434` needed an update not anticipated by the story's original assertion audit.** That spec (added by in-flight Story 28.1 work already in the working tree, not yet committed when this story was authored) asserts `toHaveText("Sign in")` on `profile-sign-in-action`, which renders via `routes/profile.tsx:79`'s `t("profile.signIn")` — the same key this story relabels. Updated to `"Sign In with Nixus Cloud"`. This is the relabel breaking a real assertion, not scope creep: no other line in that spec, and no other spec, was touched.
- All quality gates green: `tsc --noEmit` clean; vitest 11 files/168 passed (baseline 10/158 + 10 new: 4 in `profile-i18n.test.ts`, 2 in `auth-i18n.test.ts`, 6 in new `brand-i18n.test.ts`); focused `auth.spec.ts` 13/13; full Playwright suite 366/366 on the clean baseline run, with a later run's 2 failures (`chat.spec.ts`, `expenses.spec.ts`) confirmed as a pre-existing unrelated load flake by isolated re-run (41/41 passed). Locale parity confirmed programmatically at 1199/1199 keys, identical sets, before and after.
- No component, Rust, schema, dependency, or configuration change made. `apps/web` and AWS/Cognito branding untouched, as required.

### File List

- `apps/desktop/src/locales/en.json` — modified: `profile.signIn`, `auth.createAccount` values.
- `apps/desktop/src/locales/fr.json` — modified: `profile.signIn`, `auth.createAccount` values.
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — added exact-value + untranslated-brand assertions for `profile.signIn`.
- `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` — added exact-value + untranslated-brand assertions for `auth.createAccount`.
- `apps/desktop/src/locales/__tests__/brand-i18n.test.ts` — new file: case-sensitive forbidden-synonym sweep across both locale files.
- `apps/desktop/tests/auth.spec.ts` — updated two `aria-label` assertions ("the logged-out header icon…", "sign-out invokes sign_out once…") to the new label.
- `apps/desktop/tests/profile.spec.ts` — updated one `toHaveText` assertion ("signed out on /profile shows the sign-in required state…") to the new label.
