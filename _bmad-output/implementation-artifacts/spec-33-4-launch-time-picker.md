---
title: 'The launch-time picker screen'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'fd4308b60841a7b082239e6b624892b08a4b55b9'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing shows the user which local profile they're about to use. The app always opens straight to the dashboard (or onboarding), with no picker in front of it — there is also no way yet to even ask the backend "which datasets exist" (`list_datasets` doesn't exist).

**Approach:** Add a new chrome-free `/picker` route listing every dataset registry entry (via a new `list_datasets` command), gated in front of every launch by a new, minimal, in-memory "has the picker been passed this run" flag (`check_picker_gate` command) — decoupled from `ActiveDataset` on purpose, since the backend still auto-selects `"default"` at startup exactly as Story 33.3 left it (removing that auto-select, and re-deriving `AiState` on a real switch, are explicitly Story 34.2's job, not this one). A "Log in with Nixus Cloud" action is present but inert (Epic 35 wires it). Clicking a listed dataset does nothing yet (Story 33.5's job). `AccountPromptDialog` is suppressed on `/picker` (not yet deleted — Story 33.5 deletes it). The existing ~30 Playwright specs are expected to keep passing **unmodified** by degrading gracefully when the new command is unmocked (mirroring `check_onboarding_status`'s existing `.catch(() => null)` pattern) — updating every spec's mock switch is explicitly Story 33.6's job.

## Boundaries & Constraints

**Always:**
- `list_datasets` and `check_picker_gate` are the only two new Tauri commands. `list_datasets(app) -> Result<Vec<Dataset>, AppError>` wraps Story 33.2's already-implemented `datasets::load_registry(&app)`. `check_picker_gate() -> PickerGateStatus { needs_picker: bool }` reads a new, standalone `static PICKER_PASSED: AtomicBool` in `commands/datasets.rs` (default `false`) — mirrors `check_onboarding_status`'s `{ needs_onboarding: bool }` shape exactly.
- The picker gate lives in `routes/__root.tsx`'s own `beforeLoad` (root `beforeLoad` runs before every child route's, including `/`'s existing `check_onboarding_status` check — this is what makes the picker gate run first without touching `index.tsx`). A failed/unmocked `check_picker_gate` call degrades to "no redirect" (`.catch(() => null)`), exactly like `fetchOnboardingStatus`'s existing fallback — this is what keeps the ~30 existing Playwright specs green without modification.
- The redirect only fires when `needs_picker` is true **and** the current path isn't already `/picker` (avoids a redundant self-redirect once other stories add real navigation away from the picker).
- `routes/__root.tsx`'s `RootLayout` gains one boolean, `isPicker = pathname === "/picker"`, and conditionally omits `AppSidebar`, the `TopBar`/`DestinationNav` pair, `FloatingChatBar`, and `AccountPromptDialog` when true. `UpdateChecker`/`RecurringApplyListener` stay mounted unconditionally (non-visual). `<main>`'s existing `isAiChat` edge-to-edge styling branch is extended to also cover `isPicker` (full-bleed, no border, no centered max-width column) — reuse the branch, don't duplicate it.
- `AccountPromptDialog.tsx`'s existing `pathname === "/onboarding"` suppression check gains `|| pathname === "/picker"` — the same one-line pattern, not a rewrite. It is not deleted this story (Story 33.5's job).
- The picker lists every entry's `label` from the registry as a plain, non-interactive row this story — no `onClick`, no button semantics on the rows themselves (Story 33.5 turns them into working buttons). The "Log in with Nixus Cloud" action is a real `Button` from `@nixus/shared`, rendered `disabled` with `aria-disabled`.
- New i18n keys go under a `picker.*` flat-key namespace (matching this repo's flat, dotted-string locale-file convention — not nested objects) in both `en.json`/`fr.json`, with a dedicated `picker-i18n.test.ts` mirroring `auth-i18n.test.ts`'s exact assertion style.

**Block If:** none — scope, command shapes, and every UI decision are fully specified; no decision here requires human input.

**Never:**
- Do not remove or touch `lib.rs`'s existing auto-select-`"default"`-at-startup call, `ActiveDataset`, or `select_dataset`/`select_dataset_now` — Story 33.3's backend is correct and unchanged. The new `PICKER_PASSED` flag is deliberately a **separate** piece of state (per the epic's own AD-14 wording, "a Rust-side flag... *alongside* `ActiveDataset`"), not a re-read of `ActiveDataset.id`.
- Do not wire the "Log in with Nixus Cloud" button's click handler (Epic 35) or make dataset rows clickable (Story 33.5) — both must remain visually present but non-functional this story.
- Do not delete `AccountPromptDialog.tsx`, its i18n-parity test, or the `auth.*`/`profile.signIn` locale keys — Story 33.5's job, not this one.
- Do not update the ~30 existing Playwright specs' Tauri mocks — Story 33.6's job. This story's own Design must make that unnecessary for the existing suite to stay green (see Boundaries).
- Do not add a new `AppError` variant.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/commands/datasets.rs` -- add `static PICKER_PASSED: AtomicBool = AtomicBool::new(false);`, `pub(crate) fn mark_picker_passed()` (`#[allow(dead_code)]` — Story 33.5 is its first caller), private `fn picker_passed() -> bool`, `#[derive(Serialize)] pub struct PickerGateStatus { pub needs_picker: bool }`, `#[tauri::command(rename_all = "snake_case")] pub fn check_picker_gate() -> PickerGateStatus`, `#[tauri::command(rename_all = "snake_case")] pub fn list_datasets(app: AppHandle) -> Result<Vec<Dataset>, AppError>` (one line: `datasets::load_registry(&app)`).
- `apps/desktop/src-tauri/src/lib.rs` -- register `commands::datasets::check_picker_gate` and `commands::datasets::list_datasets` in `generate_handler!`, next to the existing `commands::datasets::select_dataset` entry. No other change.
- `apps/desktop/src/hooks/useDatasets.ts` -- NEW. `interface Dataset { id: string; label: string; kind: "local" | "cloud-linked"; cognito_sub: string | null; linked_from: string | null; is_default: boolean; created_at: string }`, `interface PickerGateStatus { needs_picker: boolean }`, `fetchPickerGateStatus()` = `invoke<PickerGateStatus>("check_picker_gate")`, `fetchDatasets()` = `invoke<Dataset[]>("list_datasets")`, `useDatasets()` = `useQuery({ queryKey: queryKeys.datasets, queryFn: fetchDatasets })`. Mirrors `useOnboardingStatus.ts`'s exact shape.
- `apps/desktop/src/lib/constants.ts` -- add `datasets: ["datasets"] as const,` to `queryKeys`.
- `apps/desktop/src/routes/__root.tsx` -- add `beforeLoad` to `createRootRoute({...})` per the intent-contract; in `RootLayout`, add `isPicker`, gate the 4 named renders, extend the `isAiChat` styling branches to `isAiChat || isPicker`.
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` -- extend the pathname guard by one clause.
- `apps/desktop/src/routes/picker.tsx` -- NEW. `createFileRoute("/picker")({ component: () => <DatasetPicker /> })`, no loader of its own (the gate lives in `__root.tsx`).
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- NEW. Centered column composition matching `OnboardingWizard.tsx`'s visual language (logo badge via the same `bg-logo-gradient` span, `text-h1` title, `text-body text-ink-dim` subtitle) — but full-bleed/chrome-free per `__root.tsx`'s new layout, not the shell-wrapped `mx-auto max-w-2xl py-8` treatment. Uses `useDatasets()`; renders each entry's `label` in a `Card` row (non-interactive); renders a `disabled` `Button` "Log in with Nixus Cloud" (`data-testid="picker-login-cloud-button"`).
- `apps/desktop/src/locales/en.json` and `fr.json` -- add `picker.title`, `picker.subtitle`, `picker.loginWithCloud` (flat keys, English/French copy).
- `apps/desktop/src/locales/__tests__/picker-i18n.test.ts` -- NEW, mirroring `auth-i18n.test.ts`'s structure: asserts the 3 new keys' exact EN/FR values and cross-locale key parity.
- `apps/desktop/tests/picker.spec.ts` -- NEW Playwright spec, self-contained mock (no shared helper exists in this repo, per existing convention) covering the I/O matrix below.

## Tasks & Acceptance

**Execution:**
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- add the flag + two commands -- gives the frontend both the "should I show the picker" signal and the registry contents to render.
- `apps/desktop/src-tauri/src/lib.rs` -- register both commands -- makes them invokable.
- `apps/desktop/src/hooks/useDatasets.ts` -- add the fetchers/hook -- the IPC boundary the route and component both call through.
- `apps/desktop/src/lib/constants.ts` -- add the query key -- keeps the "no hardcoded query key strings" rule.
- `apps/desktop/src/routes/__root.tsx` -- add the gate + shell-skip -- the actual redirect-and-hide-chrome behavior the AC describes.
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` -- suppress on `/picker` -- prevents a second, unrelated modal from covering the new screen.
- `apps/desktop/src/routes/picker.tsx` + `apps/desktop/src/components/picker/DatasetPicker.tsx` -- the screen itself -- lists registry entries, styled with existing dark-theme primitives, with the inert Cloud action.
- `apps/desktop/src/locales/{en,fr}.json` + `picker-i18n.test.ts` -- the three new strings, in both languages, with a parity test.
- `apps/desktop/tests/picker.spec.ts` -- E2E coverage of the gate firing, the chrome being absent, the list rendering, and the inert button — see the I/O matrix.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gate unset, fresh launch | `check_picker_gate` mocked → `{ needs_picker: true }` | App redirects to `/picker` before any dashboard/onboarding content renders; no sidebar/TopBar/DestinationNav visible | No error expected |
| Gate already passed | `check_picker_gate` mocked → `{ needs_picker: false }` | No redirect; normal routing (e.g. to `/` or `/onboarding`) proceeds untouched | No error expected |
| `check_picker_gate` unmocked (existing specs) | Command not stubbed → rejects | Degrades to "no redirect" — existing specs' behavior is completely unchanged | Caught and swallowed, never surfaced |
| Registry has entries | `list_datasets` mocked → one `Dataset` (`id: "default"`, `label: "Default"`, `kind: "local"`) | Picker renders that label in the list | No error expected |
| Registry is empty | `list_datasets` mocked → `[]` | Picker renders with no dataset rows and the inert Cloud action still visible (never an error state — an empty list is not a failure) | No error expected |

**Acceptance Criteria:**
- Given the app launches and `check_picker_gate` reports `needs_picker: true`, when the root route resolves, then the user lands on `/picker` before the dashboard, onboarding wizard, or any other view renders, with no `AppSidebar`/`TopBar`/`DestinationNav` visible.
- Given the picker is showing, when it loads, then it lists every entry returned by `list_datasets`, styled with `@nixus/shared` primitives and dark-theme tokens — no OS-native dialog.
- Given the picker is showing, when it renders, then a "Log in with Nixus Cloud" `Button` is visible and `disabled`.
- Given any existing Playwright spec that does not mock `check_picker_gate`, when it runs, then its behavior is byte-for-byte unchanged from before this story (no new redirect, no new failure).
- Given `pnpm --filter @nixus/desktop test` (vitest, including the new `picker-i18n.test.ts`) and `cargo build`/`cargo test`, when they run, then all pass with zero warnings.

## Design Notes

The picker gate is deliberately **not** a read of `ActiveDataset` — `PICKER_PASSED` is a separate flag, matching the epic's own AD-14 wording ("a Rust-side flag... alongside `ActiveDataset`"). Reusing `ActiveDataset.id.is_some()` would require first removing `lib.rs`'s auto-select-`"default"`-at-startup call (since that call already makes `ActiveDataset.id` `Some` before the frontend ever loads), which would in turn break the AI-client-init and recurring-apply code that assumes a connection exists immediately after `.setup()` — a cascade explicitly out of scope here and assigned to Story 34.2 by the Story 33.3 review. The standalone flag avoids all of that: the backend keeps auto-selecting Default exactly as today (the app stays fully functional underneath), while the frontend is unconditionally shown the picker first, every launch, until something (Story 33.5) calls `mark_picker_passed()`.

`mark_picker_passed()` has no caller yet this story — same precedent as Story 33.1's `dataset_dir` and Story 33.2's originally-unused pieces: build the half a sibling story needs next, `#[allow(dead_code)]` with a comment naming that story, per `docs/guidelines/warnings.md`'s "add an ignore when the method is genuinely used soon" branch.

The graceful-degradation design (`.catch(() => null)` on `check_picker_gate`) is why this story does not need to touch any of the ~30 existing Playwright specs: every one of them boots the app without mocking the new command, the promise rejects, the catch swallows it, and `needs_picker` reads as `null` — falsy, so no redirect fires, and every existing assertion continues to run against the app exactly as it rendered before this story shipped. This is the same mechanism `index.tsx` already relies on for `check_onboarding_status`.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings
- `cd apps/desktop/src-tauri && cargo test` -- expected: all pass, including new `commands::datasets::tests::*` for the picker-gate flag
- `cd apps/desktop && pnpm test` -- expected: all vitest suites pass, including the new `picker-i18n.test.ts`
- `cd apps/desktop && pnpm playwright test` -- expected: the full existing suite passes unmodified, plus the new `picker.spec.ts`

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (medium 4, low 3)
- defer: ~14 (reverse-guard on `/picker` once passable, `isPicker` exact-match vs `startsWith` for a future child route, `list_datasets`' wire DTO carrying unused `cognito_sub`/`linked_from`, QA-sweep coverage for `/picker` in `nav-qa.spec.ts`/`accessibility.spec.ts`, managed-state vs bare-static flag preference, and other forward-looking items — all correctly assigned to Story 33.5/33.6/34.x or judged too low-risk/low-value to act on now)
- reject: ~15 (several verified false against the actual code or matching already-accepted precedent: `redirect()` omitting `replace: true` matches `index.tsx`'s own existing onboarding redirect; the logo-badge span matches `OnboardingWizard.tsx`'s established pattern rather than introducing new duplication; `SeqCst` ordering is safe, not a bug; the bare-`static` flag matches 2 prior stories' precedent in this exact file; Story 33.6's AC naming an anticipated command differently than what got built is expected, not a defect)
- addressed_findings:
  - `[medium]` `[patch]` New i18n keys used a `picker.*` namespace; renamed to `datasets.*` to match this feature's established naming convention (code says `Dataset`/`datasets`, user-facing copy says "profile") — added a test locking both halves of that split.
  - `[medium]` `[patch]` `UpdateChecker` was left mounted unconditionally on `/picker` despite rendering a focus-trapping `Dialog` when an update is available (verified against its source — it is not purely non-visual as the spec assumed) — now suppressed the same way `FloatingChatBar`/`AccountPromptDialog` already are.
  - `[medium]` `[patch]` `Cmd/Ctrl+K` stayed bound on `/picker` with `FloatingChatBar` unmounted, so pressing it would leave `chatOpen` stuck true for whatever surface the user lands on next — guarded the handler to no-op while `isPicker`.
  - `[medium]` `[patch]` A failed `list_datasets` read rendered identically to a successfully-empty registry, with no way to tell "no profiles" from "couldn't read the registry" — added a distinguishable branch, iterated once more from `EmptyState` (wrong semantic — its own source comment says it "never reads as broken") to `Alert variant="over"`, matching this codebase's established convention for read failures.
  - `[low]` `[patch]` `AccountPromptDialog`'s docstring said the shell mounts it "unconditionally", no longer true once `/picker` was excluded — reworded.
  - `[low]` `[patch]` `PickerGateStatus`'s doc comment falsely claimed it "mirrors `OnboardingStatus`'s single-boolean shape" (`OnboardingStatus` has two fields) — reworded to an accurate claim.
  - `[low]` `[patch]` The picker's own scroll container (the real scroller once `<main>` goes `overflow-hidden` on this route) had no `tabIndex`, unlike the shell's `<main>` — added `tabIndex={-1}` matching that existing convention.

## Auto Run Result

**Summary:** Adds the launch-time picker: two new commands (`list_datasets`, wrapping Story 33.2's already-tested `load_registry`; `check_picker_gate`, backed by a new standalone `PICKER_PASSED` flag deliberately kept separate from `ActiveDataset` per AD-14's own wording), a root-level `beforeLoad` gate that redirects to `/picker` before any other route resolves (degrading gracefully to "no redirect" on an unmocked/failed check — the exact mechanism that keeps all ~30 pre-existing Playwright specs green without touching any of them), and the picker screen itself: chrome-free, lists registry entries by label, an inert "Log in with Nixus Cloud" action. Dataset rows are deliberately non-interactive and `mark_picker_passed()` has no caller yet — both are Story 33.5's job, one story away in this same run. One review pass found no bad_spec/intent_gap (the "gate never opens until 33.5" state was confirmed to be the correct, unavoidable consequence of splitting "show the picker" from "make it navigable" across two stories, not a defect) and closed 7 patches, the most consequential being a real bug (`UpdateChecker`'s dialog could cover the gate) and a genuine test-coverage/UX gap (failed vs. empty registry were indistinguishable).

**Files changed:**
- `apps/desktop/src-tauri/src/commands/datasets.rs` — `list_datasets`, `PICKER_PASSED`/`mark_picker_passed`/`picker_passed`, `PickerGateStatus`/`check_picker_gate`; 2 new tests.
- `apps/desktop/src-tauri/src/lib.rs` — registers both commands.
- `apps/desktop/src/hooks/useDatasets.ts` (new) — `Dataset`/`PickerGateStatus` types, fetchers, `useDatasets()`.
- `apps/desktop/src/lib/constants.ts` — `queryKeys.datasets`.
- `apps/desktop/src/routes/__root.tsx` — root `beforeLoad` gate; `isPicker`/`isFullBleed` shell-skip covering `AppSidebar`, `TopBar`+`DestinationNav`, `FloatingChatBar`, `UpdateChecker`, `AccountPromptDialog`; Cmd/Ctrl+K inert on `/picker`.
- `apps/desktop/src/components/auth/AccountPromptDialog.tsx` — suppressed on `/picker` (not deleted — Story 33.5).
- `apps/desktop/src/routes/picker.tsx` + `apps/desktop/src/components/picker/DatasetPicker.tsx` (new) — the screen: pending/error/list/inert-action states, `datasets.*` i18n namespace.
- `apps/desktop/src/locales/{en,fr}.json` + `apps/desktop/src/locales/__tests__/picker-i18n.test.ts` (new) — 4 keys (`datasets.title`/`subtitle`/`loginWithCloud`/`loadError`), parity-tested.
- `apps/desktop/tests/picker.spec.ts` (new) — 11 E2E tests; zero pre-existing specs modified.

**Review findings breakdown:** bad_spec: 0, patch: 7 (all applied, one iterated to match established convention), defer: ~14 (all forward-looking, correctly assigned to Stories 33.5/33.6/34.x), reject: ~15 (several independently verified false against the real code, not just dismissed).

**Follow-up review recommendation:** `true` — this pass's patch severities (4 medium, 3 low) score `3×4 + 1×3 = 15`, well past the "5 or more" threshold.

**Verification performed:**
- `cargo build` — exit 0, zero warnings (re-run independently after implementation and after both patch rounds)
- `cargo test` — 715 passed, 0 failed
- `npx tsc --noEmit` — clean
- `pnpm test` (vitest) — 350 passed / 19 files, including the renamed `picker-i18n.test.ts` (14 tests)
- `npx playwright test picker.spec.ts` — 11/11 passed; `npx playwright test auth.spec.ts` (the spec most likely to interact with the new gate/dialog suppression) — 13/13 passed
- Full Playwright suite run twice during implementation, both times exactly 3 failures out of ~527 — proven pre-existing by stashing all changes and re-running on the baseline commit (also exactly 3 failures, a different 3 each time); all of this story's own new tests pass in isolation every time

**Residual risks (deferred, not blocking):**
- The app is unreachable past `/picker` until Story 33.5 lands (no click handler, no other caller of `mark_picker_passed`) — this is the story boundary working as designed, not a gap, and resolves in the very next story processed in this run.
- The fail-open `.catch(() => null)` gate check is a deliberate, low-practical-risk tradeoff (the command can only fail in an unmocked test environment or a genuinely broken IPC bridge, never in a correctly-built production app) that trades a theoretical FR1 ("no launch path bypasses it") gap for not having to touch the ~30 pre-existing Playwright specs — Story 33.6's explicit job.
- `/picker` has no reverse guard (nothing redirects away from it once the gate is passed) — inert today since the gate can never actually pass yet; becomes relevant once Story 33.5 makes `/picker` a place a user could navigate back to mid-session.
