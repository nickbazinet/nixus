---
title: 'Choosing a profile opens the app scoped to it'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'e48baa6e72d755394937697793d6dd3156eaa1e5'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      `mark_picker_passed` has no active-dataset guard and can be invoked independent of
      `select_dataset`.
    evidence: |-
      It is a public, argument-less Tauri command that unconditionally sets `PICKER_PASSED`.
      Low practical risk: the only caller is this app's own bundled webview, not an external
      API surface.
    location: >-
      apps/desktop/src-tauri/src/commands/datasets.rs:128-131
    severity: low
  - summary: >-
      There is no in-session path back to `/picker` once the gate latches.
    evidence: |-
      By design (AD-14): the picker is a launch-time-only gate. Flagged for awareness in case
      a future "switch profile without restarting" UX is desired.
    location: >-
      apps/desktop/src/routes/__root.tsx
    severity: low
  - summary: >-
      A failed `mark_picker_passed` shows "could not be opened" even though `select_dataset`
      already succeeded and swapped the backend connection.
    evidence: |-
      Only reachable via an IPC transport failure, since `mark_picker_passed`'s Rust body is an
      infallible atomic store. Already exercised and accepted by
      `useDatasets.test.ts`'s "surfaces a failed latch as a failed selection" test.
    location: >-
      apps/desktop/src/hooks/useDatasets.ts:55-63
    severity: low
  - summary: >-
      `queryClient.clear()` also clears the mutation cache mid-flight, leaving a sub-millisecond
      window between settle and navigation.
    evidence: |-
      Empirically unobservable: the delayed-selection E2E test (`selectDatasetDelayMs: 2000`)
      passed, and Playwright's native click() actionability guard means a real double-click
      cannot land in that window.
    location: >-
      apps/desktop/src/hooks/useDatasets.ts:61
    severity: low
  - summary: >-
      Cloud-linked dataset entries will be clickable and indistinguishable from local ones once
      Epic 35 introduces them.
    evidence: |-
      Not reachable today: there is no registry-write path yet to create a second or
      cloud-linked profile. Epic 35's wiring job.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: low
  - summary: >-
      Re-clicking the already-active dataset needlessly reopens it and wipes the query cache.
    evidence: |-
      Minor inefficiency, not a correctness bug — the reopen is idempotent.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: low
  - summary: >-
      An empty dataset registry renders no actionable control besides the inert Cloud button —
      a dead end.
    evidence: |-
      Creating additional profiles is explicitly Epic 34.1's job ("Create additional local
      profiles from the picker"), not this story's.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: medium
  - summary: >-
      No pending/busy affordance (spinner, label change, `aria-live`) on the specific row being
      opened while `select_dataset` runs.
    evidence: |-
      Real accessibility gap for what can be a multi-second SQLite open+migrate. Needs a UX/copy
      decision (per-row vs. global indicator) rather than a mechanical fix.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: medium
  - summary: >-
      The picker-gate E2E mock's latch resets on `page.reload()`, so the product requirement
      "a relaunch shows the picker again" has no test at the mock or real-launch level.
    evidence: |-
      Pre-existing test-infrastructure gap predating this story, not introduced by it.
    location: >-
      apps/desktop/tests/picker.spec.ts
    severity: low
  - summary: >-
      The deleted `auth-i18n.test.ts`'s guard against `accounts.*`-namespace collisions was not
      preserved elsewhere.
    evidence: |-
      Defensive test for a hypothetical future mistake with no currently-active key to protect;
      low value.
    location: >-
      apps/desktop/src/locales/__tests__/auth-i18n.test.ts (deleted)
    severity: low
  - summary: >-
      `picker-i18n.test.ts`'s new "retires the auth.* namespace entirely" assertion is a
      repo-wide invariant asserted from a picker-scoped file.
    evidence: |-
      Epic 35's Cloud-login wiring will need to update or remove it when it reintroduces
      `auth.*` keys.
    location: >-
      apps/desktop/src/locales/__tests__/picker-i18n.test.ts
    severity: low
  - summary: >-
      `brand-i18n.test.ts`'s case-sensitivity carve-out comment points at
      `profile.signInRequiredBody` with no assertion tying the two.
    evidence: |-
      The exception could be tightened to a case-insensitive check, or the comment made
      self-verifying.
    location: >-
      apps/desktop/src/locales/__tests__/brand-i18n.test.ts
    severity: low
  - summary: >-
      `picker.spec.ts`'s failed-selection test hardcodes the English toast copy, duplicating
      `picker-i18n.test.ts`'s job and never exercising the French string.
    evidence: |-
      Minor test-quality nit; low value to fix now.
    location: >-
      apps/desktop/tests/picker.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 33.4's picker lists profiles but nothing happens when one is clicked — rows are deliberately non-interactive, and `mark_picker_passed` (Story 33.4's own flag-setter) has no caller yet, so the app is permanently stuck at `/picker`.

**Approach:** Make dataset rows real buttons. Clicking one calls `select_dataset`, then (newly exposed as a Tauri command) `mark_picker_passed`, then clears the entire TanStack Query cache (AD-7 — nothing from a previous dataset may survive), then navigates to `/`, whose existing `check_onboarding_status` gate (unchanged, now genuinely reading the freshly-selected dataset) decides dashboard vs. onboarding wizard exactly as it already does today. `AccountPromptDialog.tsx` — fully superseded by the picker's own (still-inert) Cloud action — is deleted outright, along with its dedicated i18n-parity test and every one of its locale keys (all seven are demonstrably orphaned by this deletion, not only the five the epic text names — verified by grep before writing this spec).

## Boundaries & Constraints

**Always:**
- `commands/datasets.rs::mark_picker_passed` becomes a real `#[tauri::command(rename_all = "snake_case")]`, its `#[allow(dead_code)]` removed (it now has a genuine caller), registered in `lib.rs`'s `generate_handler!`.
- The click flow, in order: `invoke("select_dataset", { dataset_id })` → on success, `invoke("mark_picker_passed")` → `queryClient.clear()` → `navigate({ to: "/" })`. If `select_dataset` itself rejects (unknown id, open/migrate failure), the flow stops there — `mark_picker_passed` is never called, the cache is never cleared, and the user stays on `/picker` with a toast.
- This sequencing lives in a new `useSelectDataset()` mutation hook in `hooks/useDatasets.ts` (mirroring `useSignIn`/`useCompleteOnboarding`'s existing shape: the hook owns the IPC calls and the cache clear; the calling component owns navigation and error toasting — matching `OnboardingWizard.tsx`'s `exitToDashboard` precedent exactly).
- Dataset rows in `DatasetPicker.tsx` become real, keyboard-operable buttons (a native `<button>`, not a `div` with a synthetic click handler) wrapping each `Card`'s existing content — find and match whatever this codebase's established "clickable card row" pattern is before inventing a new one. Disabled while a selection is in flight (`selectDataset.isPending`), so a double-click can't race two selections.
- `check_onboarding_status`'s existing gate in `index.tsx` is untouched — it already runs after the picker gate (Story 33.4), and because `queryClient.clear()` ran first, it queries the dataset the user just picked, not a stale cache entry.
- `AccountPromptDialog.tsx` is deleted (the file, its import and JSX in `__root.tsx`, and the now-pointless `pathname === "/picker"` guard clause added for it in Story 33.4). Its dedicated i18n test (`locales/__tests__/auth-i18n.test.ts`) is deleted in full. All seven `auth.*` keys it referenced (`promptTitle`, `promptBody`, `promptFutureFeatures`, `createAccount`, `continueOffline`, `openingBrowser`, `signInFailed`) are removed from both `en.json`/`fr.json` — verified by grep to have zero other consumers, so none are orphaned by removing only the five the epic text enumerates and leaving two behind.
- `tests/auth.spec.ts`'s `"account prompt on launch"` and `"sign-in launch"` `describe` blocks are removed — both exist solely to test `AccountPromptDialog`'s now-deleted markup (`account-prompt-dialog`, `continue-offline-button`, `create-account-button` test ids). Every other `describe` block in that file (`"header profile entry point"`, `"profile panel and sign out"`, `"expired session"`) is untouched — they test the unrelated `ProfileMenu`/header components.

**Block If:** none — the sequencing, deletions, and every file touched are fully specified; no decision here requires human input.

**Never:**
- Do not touch `select_dataset`/`select_dataset_now`'s own logic, `ActiveDataset`, or `DbState` — Story 33.3's backend is correct and unchanged.
- Do not wire "Log in with Nixus Cloud" — still Epic 35's job.
- Do not update the ~30 *other* pre-existing Playwright specs for the picker-gate commands — still Story 33.6's job. This story's own required spec edit (removing `AccountPromptDialog`'s tests) is a direct, unavoidable consequence of deleting the component under test, not scope creep into that story.
- Do not add a new `AppError` variant.
- Do not remove `profile.signIn` or any other non-`auth.*`-prefixed locale key — only the seven orphaned `auth.*` keys.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/commands/datasets.rs` -- `mark_picker_passed` gains `#[tauri::command(rename_all = "snake_case")]`, loses `#[allow(dead_code)]`.
- `apps/desktop/src-tauri/src/lib.rs` -- register `commands::datasets::mark_picker_passed` in `generate_handler!`, next to `check_picker_gate`.
- `apps/desktop/src/hooks/useDatasets.ts` -- add `useSelectDataset()`: `useMutation({ mutationFn: async (datasetId: string) => { await invoke<void>("select_dataset", { dataset_id: datasetId }); await invoke<void>("mark_picker_passed"); }, onSuccess: () => queryClient.clear() })`.
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- rows become buttons calling `useSelectDataset().mutateAsync(entry.id)`, then `navigate({ to: "/" })` on success, `toast.error(t("datasets.selectFailed"))` on failure (new key, same `datasets.*` namespace as Story 33.4's other picker copy).
- `apps/desktop/src/routes/__root.tsx` -- remove the `AccountPromptDialog` import, its JSX, and the `!isPicker &&` guard around it (the whole line goes, not just the condition).
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` -- DELETE.
- `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` -- DELETE.
- `apps/desktop/src/locales/en.json`, `fr.json` -- remove all seven `auth.*` keys listed above.
- `apps/desktop/tests/auth.spec.ts` -- remove the `"account prompt on launch"` (5 tests) and `"sign-in launch"` (1 test) `describe` blocks in full; leave every other block untouched.
- `apps/desktop/tests/picker.spec.ts` -- extend with the new click-to-select flow per the I/O matrix below; the existing "presentational this story" comment/assumption in the current tests is now stale and should be corrected alongside the new tests, not left contradicting them.

## Tasks & Acceptance

**Execution:**
- `apps/desktop/src-tauri/src/commands/datasets.rs` + `lib.rs` -- expose `mark_picker_passed` as a command -- gives the frontend the only remaining piece it needs to complete the gate's lifecycle.
- `apps/desktop/src/hooks/useDatasets.ts` -- add `useSelectDataset` -- the reusable selection+cache-clear sequence.
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- wire rows to it, navigate on success, toast on failure -- the actual user-facing behavior this story delivers.
- `apps/desktop/src/routes/__root.tsx` + `apps/desktop/src/components/auth/AccountPromptDialog.tsx` (deleted) + `locales/__tests__/auth-i18n.test.ts` (deleted) + `en.json`/`fr.json` -- remove the superseded dialog end to end -- AD-14's "deleted, not left dormant."
- `apps/desktop/tests/auth.spec.ts` -- remove the two now-obsolete `describe` blocks -- keeps the suite honest about what still exists.
- `apps/desktop/tests/picker.spec.ts` -- add coverage per the I/O matrix -- proves the new flow rather than asserting it by inspection.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Click a row, selection succeeds | `select_dataset` resolves, `mark_picker_passed` resolves | Cache cleared, navigates to `/`; onboarded dataset lands on the dashboard | No error expected |
| Click a row, `select_dataset` rejects | e.g. mocked to reject | User stays on `/picker`; a toast reports failure; `mark_picker_passed` is never called (cache is not cleared, no navigation) | Toast shown, no navigation |
| Click a row for an unonboarded dataset | Selected dataset's `check_onboarding_status` reports `needs_onboarding: true` | Lands on `/onboarding`, not the dashboard | No error expected |
| Double-click a row | Second click while `selectDataset.isPending` | Row is disabled; only one `select_dataset` call is made | No error expected |

**Acceptance Criteria:**
- Given the picker is showing at least one profile, when the user clicks it, then `select_dataset` is called, and on success `mark_picker_passed` is called, the query cache is cleared, and the app navigates to `/` — never a raw page reload.
- Given the newly-selected dataset's own onboarding state, when the dashboard route resolves, then it shows the dashboard or the onboarding wizard according to that state, via the existing unmodified `check_onboarding_status` gate.
- Given `AccountPromptDialog.tsx` and its dedicated i18n test exist today, when this story ships, then both are deleted and every `auth.*` key either referenced (the epic's named five, plus the two more this repo's own grep shows are equally orphaned) is removed from both locale files.
- Given the full test suite, when it runs after this change, then `cargo build`/`cargo test` are clean, `pnpm test` passes with no reference to any deleted `auth.*` key, and `tests/auth.spec.ts` plus `tests/picker.spec.ts` both pass with no test asserting behavior of a component that no longer exists.

## Design Notes

`mark_picker_passed` being called as a *second*, separate `invoke` after `select_dataset` — rather than folding the flag-set into `select_dataset_now` itself — is deliberate and unchanged from Story 33.4's reasoning: `select_dataset` is also `lib.rs`'s own startup auto-selector for `"default"`, and that call must never mark the gate passed, or the picker would never appear at all. Only the picker's own click path may mark it.

The "clickable card row" implementation should match whatever pattern already exists in this codebase for a card that behaves like a button (there almost certainly is one, given how many list-style surfaces this app already has) — investigate before inventing a bespoke `onClick`-on-a-`div` pattern, which would be both a new precedent and an accessibility regression next to a native `<button>`.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings
- `cd apps/desktop/src-tauri && cargo test` -- expected: all pass
- `cd apps/desktop && npx tsc --noEmit` -- expected: clean
- `cd apps/desktop && pnpm test` -- expected: all pass; confirm no remaining reference to any deleted `auth.*` key anywhere in `src/`
- `cd apps/desktop && npx playwright test auth.spec.ts picker.spec.ts` -- expected: all pass
- `grep -rn "AccountPromptDialog\|auth\.promptTitle\|auth\.promptBody\|auth\.promptFutureFeatures\|auth\.createAccount\|auth\.continueOffline\|auth\.openingBrowser\|auth\.signInFailed" apps/desktop/src apps/desktop/tests` -- expected: empty

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 13: (high 0, medium 2, low 11)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `medium` `patch` `useSelectDataset()` was verified only through the extracted `selectDatasetMutationOptions` factory against a hand-built `QueryClient`; the hook itself, wired to the real `useQueryClient()`, had zero coverage. Two independent reviewers demonstrated this by substituting `new QueryClient()` for `useQueryClient()` and having every existing test still pass. Fix: add a rendered-hook unit test using the repo's established `useAuth.test.tsx` harness (`createRoot` + `act` + `QueryClientProvider`) asserting the *provider's* client is cleared on success.
  - `medium` `patch` Deleting the "account prompt on launch" describe block also deleted the only test of `ProfileMenu`'s loading state (`data-auth-state="loading"` while `get_auth_session` is pending) — unrelated, pre-existing behavior that happened to share the test. Fix: restore a minimal version in `auth.spec.ts` using the already-wired `sessionDelayMs` option, asserting only the `profile-menu-trigger` state transition, with no reference to the deleted dialog.
  - `medium` `patch` Deleting the "sign-in launch" describe block removed the only test asserting `start_login` is invoked exactly once and nothing further. `ProfileMenu.tsx`'s own header trigger calls the same `useSignIn().mutate()` when logged out, so this is pre-existing, still-live behavior left uncovered. Fix: restore the call-count assertion in `auth.spec.ts`, retargeted at clicking `profile-menu-trigger` instead of the deleted dialog's button.
  - `low` `patch` `DatasetPicker.tsx`'s `selectEntry` wraps only `mutateAsync` in try/catch; `navigate({ to: "/" })` sits outside it and a rejection would become an unhandled promise rejection. Fix: bring navigation inside the try, or attach a `.catch`.
  - `low` `patch` Disabled picker rows keep `Card`'s `interactive` hover background (`hover:bg-hover`) since only `disabled:cursor-default` was added. Fix: also cancel the hover background for the disabled state.
  - `low` `patch` Disabled picker rows set only the native `disabled` attribute, unlike the adjacent inert Cloud button's `disabled` + `aria-disabled` convention. Fix: add `aria-disabled={selectDataset.isPending || undefined}` to match.
  - `low` `patch` `tests/retirement.spec.ts:50`'s comment still explains its `get_auth_session` stub in terms of "the modal account prompt", a component this story deleted. Fix: update the comment.
  - `low` `patch` `useDatasets.test.ts`'s two failure-path assertions use `rejects.toBeDefined()`, which passes for any thrown value including an unrelated `TypeError`. Fix: assert on the propagated error's shape instead.
  - `low` `patch` `picker.spec.ts`'s mock `invoke` signature declares `args: Record<string, unknown>` as required, though `mark_picker_passed` is invoked with none. Fix: `args?: Record<string, unknown>`, matching `retirement.spec.ts`'s existing type.

## Auto Run Result

Status: done

### Summary of implemented change

The launch-time picker's rows are now working buttons. Clicking one invokes `select_dataset`, then — on success only — the newly-exposed `mark_picker_passed` command, then clears the whole TanStack Query cache, then navigates to `/`, where the pre-existing, unmodified `check_onboarding_status` gate decides dashboard vs. onboarding wizard for the profile just opened. A failed open stops the flow before the latch, leaves the gate up, keeps the cache, and toasts, so the user stays on a screen that still works.

`AccountPromptDialog` is deleted end to end — the component, its `__root.tsx` mount and the `!isPicker` guard that existed only for it, its dedicated i18n-parity test, all seven of its `auth.*` locale keys in both locales, and every Playwright test and helper that existed only to drive it.

### Files changed

- `apps/desktop/src-tauri/src/commands/datasets.rs` -- `mark_picker_passed` becomes a real `#[tauri::command]`, `#[allow(dead_code)]` removed, stale "no caller yet" comment replaced with the invariant for why it stays separate from `select_dataset`.
- `apps/desktop/src-tauri/src/lib.rs` -- `mark_picker_passed` registered in `generate_handler!`.
- `apps/desktop/src/hooks/useDatasets.ts` -- adds `useSelectDataset()` plus an extracted `selectDatasetMutationOptions(queryClient)`: two ordered invokes, `clear()` on success, navigation and toasting left to the caller.
- `apps/desktop/src/hooks/__tests__/useDatasets.test.tsx` -- NEW. 7 tests: 4 driving the options factory through `MutationObserver`, 3 driving the hook itself through a real `QueryClientProvider` so the provider-client wiring is pinned.
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- rows become `Card interactive render={<button>}` (the repo's existing clickable-card convention, per `GarageVehicleRow`), all rows `disabled` + `aria-disabled` while a selection is in flight, hover and cursor both cancelled when disabled, navigation awaited inside the try.
- `apps/desktop/src/routes/__root.tsx` -- `AccountPromptDialog` import, JSX and `!isPicker` guard removed.
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` -- DELETED.
- `apps/desktop/src/locales/__tests__/auth-i18n.test.ts` -- DELETED (its only subject is gone).
- `apps/desktop/src/locales/en.json`, `fr.json` -- seven `auth.*` keys removed; `datasets.selectFailed` added.
- `apps/desktop/src/locales/__tests__/picker-i18n.test.ts` -- covers `datasets.selectFailed`, asserts it differs from `datasets.loadError`, and asserts the `auth.*` namespace is now empty.
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` -- its "neighbouring block intact" guard repointed from the deleted `auth.*` block to `update.*`.
- `apps/desktop/src/locales/__tests__/brand-i18n.test.ts` -- case-sensitivity carve-out comment repointed off the deleted key.
- `apps/desktop/src/components/auth/ProfileMenu.tsx` -- docstring reference to the deleted dialog removed.
- `apps/desktop/tests/auth.spec.ts` -- the two dialog-only describe blocks and two orphaned helpers removed; the header's `loading → logged-out` transition and its `start_login`-exactly-once assertion re-established against `profile-menu-trigger`.
- `apps/desktop/tests/picker.spec.ts` -- new `choosing a profile` block (5 tests) with a latching gate mock mirroring the real `AtomicBool`; the stale "presentational this story" assertion inverted to assert real buttons.
- `apps/desktop/tests/profile.spec.ts`, `apps/desktop/tests/retirement.spec.ts` -- references to and commentary about the deleted dialog removed.

### Review findings breakdown

- Patches applied: 9 (medium 3, low 6) — see the Review Triage Log entry above for each.
- Items deferred: 13 (medium 2, low 11) — recorded in frontmatter `deferred`. The two medium ones are the empty-registry dead end (Epic 34.1's job) and the absence of a per-row busy affordance during a potentially slow SQLite open.
- Items rejected: 11 — chiefly a false diff/working-tree mismatch report (a reviewer's own temporary edit, since reverted; the tree was confirmed clean), a "no reset path to the picker" finding that is AD-14 by design, a claim that no Rust test pins the latch (`commands/datasets.rs` already has one), and requests to force a second click past `disabled` or to test native `<button>` keyboard activation.

### Follow-up review recommendation

`true`. Patched findings by severity: high 0, medium 3, low 6. Score = 3 x 3 + 1 x 6 = 15, which is >= 5. No high-severity patch was applied, so the score alone drives this.

### Verification performed

Re-run independently after the patch pass, not taken from the implementer's report:

- `cargo build` -- exit 0, **0 warnings** (`grep -c '^warning'` = 0).
- `cargo test` -- 715 passed, 0 failed.
- `npx tsc --noEmit` -- exit 0, no output.
- `pnpm test` -- 344 passed across 19 files (341 before this story; +3 net after deleting the 11-test `auth-i18n.test.ts` and adding the 7-test hook suite plus new picker-i18n cases).
- `npx playwright test auth.spec.ts picker.spec.ts profile.spec.ts retirement.spec.ts` -- 95 passed, 0 failed.
- The spec's grep sweep for `AccountPromptDialog` and all seven `auth.*` keys across `apps/desktop/src` and `apps/desktop/tests` -- empty (exit 1).
- All 9 patches additionally confirmed by reading the post-patch diff file-by-file rather than trusting the summary.

### Residual risks

- The full Playwright suite (527 passed) shows 2 failures per run that are non-deterministic — a different pair each run, each passing in isolation, none in files this story touched. Pre-existing suite parallelism flakiness, not a regression from this change, and out of scope here.
- `queryClient.clear()` fires while the picker is still mounted, one microtask before `navigate`. Empirically no second `list_datasets` call and no skeleton flash (confirmed with a 2s delayed selection), but the ordering is timing-dependent rather than structurally guaranteed.
- Per-dataset `localStorage` keys (`finance.onboarding.dismissed`, `car.onboarding.dismissed`, `nixus:import-draft.v1`) are not cleared on a profile switch, unlike `DangerZone`'s reset path which pairs `clear()` with a `localStorage.removeItem`. Not reachable today — no registry-write path exists yet, so a second profile cannot be created — but it becomes a genuine cross-profile leak the moment Epic 34.1 lands. Epic 34.4/34.5 (end-to-end isolation) is where this must be closed.
