---
title: 'Existing E2E suite keeps passing with the new launch gate'
type: 'chore'
created: '2026-08-19'
status: 'done'
baseline_revision: 'bb8474ba4e8310c8ad436bf4bab941a0f001aaa5'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      No test asserts that opening an existing dataset directory leaves its rows intact —
      the actual "pre-existing data survives select_dataset" guarantee.
    evidence: |-
      `select_dataset_now` composes `dataset_dir` -> `init_db(&dir)` -> `swap_active`, but
      `commands/datasets.rs`'s test module covers `swap_active` and `find_registered` in isolation
      against in-memory connections and never opens a dataset directory. A Playwright test over a
      mocked `invoke` boundary categorically cannot cover this. The honest home is a Rust test that
      seeds a row in a real Default dataset dir, runs the sequence, and reads it back through
      `ActiveDataset.conn`.
    location: >-
      apps/desktop/src-tauri/src/commands/datasets.rs:33-54
    severity: medium
  - summary: >-
      `lib.rs`'s startup auto-select path (`select_dataset_now` in `.setup()`) has no test.
    evidence: |-
      It is the other place "selecting Default" could open the wrong directory, and it runs before
      any UI exists so no E2E test reaches it.
    location: >-
      apps/desktop/src-tauri/src/lib.rs
    severity: low
  - summary: >-
      `/picker` has no accessibility scan despite being a new user-facing surface.
    evidence: |-
      `accessibility.spec.ts` gained a gate stub but no axe pass over `/picker`, which introduces
      card-as-button rows, paired `disabled`/`aria-disabled`, a self-owned `<h1>` with
      `tabIndex={-1}`, and a `role="alert"` error card.
    location: >-
      apps/desktop/tests/accessibility.spec.ts
    severity: medium
  - summary: >-
      `__root.tsx`'s comment hand-maintains a list of three spec names with nothing enforcing it,
      and no check fails when a newly-added mocked spec forgets the gate stub.
    evidence: |-
      The convention this story established across 34 mock sites lives only in prose. An executable
      guarantee (a meta-test, or a lint over `tests/*.spec.ts`) would keep it true.
    location: >-
      apps/desktop/src/routes/__root.tsx
    severity: low
  - summary: >-
      The `.catch(() => null)` fallback has no direct test of its own.
    evidence: |-
      "Gate rejects -> no redirect" is only implied by the three mock-less specs continuing to pass.
      An explicit assertion would pin it as intended behavior rather than a side effect.
    location: >-
      apps/desktop/src/routes/__root.tsx
    severity: low
  - summary: >-
      The 34 `{ needs_picker: false }` mock literals are tied to Rust's `PickerGateStatus` by
      convention only.
    evidence: |-
      Renaming the field on the Rust side leaves every mock returning a stale shape;
      `gate?.needs_picker` becomes `undefined`, no redirect fires, and the whole suite stays green.
      `PickerGateStatus` in `hooks/useDatasets.ts` is not exported, and specs redeclare shapes
      locally by established repo policy, so there is no type link to add cheaply.
    location: >-
      apps/desktop/src/hooks/useDatasets.ts:21
    severity: low
  - summary: >-
      The new seeded test hardcodes both an English money string and the dev-server port.
    evidence: |-
      `"$1,183.50 spent of $2,500.00"` couples to the `dashboard.budgetMeterValue` translation plus
      currency/locale formatting, and `/localhost:1420\/$/` couples to the port rather than
      Playwright's `baseURL`. Both are pre-existing patterns in this suite; this story adds new
      instances rather than introducing the problem.
    location: >-
      apps/desktop/tests/picker.spec.ts
    severity: low
  - summary: >-
      `beforeLoad` awaits `check_picker_gate` on every navigation except `/picker`, with no
      client-side latch and no test bounding the call count.
    evidence: |-
      Gate round-trips scale with navigation count. Memoizing once `needs_picker: false` is observed
      would remove them; either way an assertion documenting the intended count would pin it.
    location: >-
      apps/desktop/src/routes/__root.tsx:39-53
    severity: low
  - summary: >-
      A genuine gate IPC failure at launch silently opens whatever `.setup()` auto-selected instead
      of showing the picker.
    evidence: |-
      Deliberate per Story 33.4 and mirrors `fetchOnboardingStatus`, and benign for a single-user
      local app where the auto-selection is Default. Recorded because the failure is silent.
    location: >-
      apps/desktop/src/routes/__root.tsx:47
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 33.4 put a root-level `check_picker_gate` invoke ahead of every route, and deliberately made it degrade to "no redirect" on failure so the ~30 pre-existing Playwright specs stayed green without being touched. That worked, but it means the entire suite currently passes *by accident of the fallback*: 11 specs reject the command as unknown, 20 resolve their switch default to `null`, and 2 resolve it to `[]` — none of them actually declares what the gate answers. A future change to the gate's failure semantics would silently redirect the whole suite to `/picker` and fail dozens of specs at once, with nothing pointing at the cause.

**Approach:** Make the gate explicit everywhere it is reachable. Add `case "check_picker_gate": return Promise.resolve({ needs_picker: false });` to all 33 `switch (cmd)` statements across the 27 specs that have a Tauri mock, so each spec states its own launch precondition instead of inheriting one from a default branch. Then add one new spec proving the real path end to end: launch → picker renders → select Default → the dashboard renders with *pre-existing seeded data intact*, which is what shows `select_dataset` plus Story 33.5's `queryClient.clear()` reopen the user's actual data rather than dropping it.

Three specs — `navigation.spec.ts`, `app-launch.spec.ts`, `ai-navigation.spec.ts` — mock Tauri *not at all*: no `__TAURI_INTERNALS__`, no `invoke`, no `switch (cmd)`. They assert the shell and routing survive with no backend whatsoever. They are out of scope by nature, not by omission, and they are precisely why `__root.tsx`'s `.catch(() => null)` stays.

## Boundaries & Constraints

**Always:**
- Add `case "check_picker_gate": return Promise.resolve({ needs_picker: false });` to every one of the 33 `switch (cmd)` statements in these 27 files: `accessibility`, `accounts`, `assets`, `auth`, `budget`, `budget-templates`, `chat`, `chat-expense-query`, `chat-maintenance-query`, `dashboard` (6 switches), `design-system`, `expenses`, `financial-health`, `import`, `import-duplicates`, `maintenance`, `nav-qa`, `net-worth` (2 switches), `onboarding`, `profile`, `projects`, `recurring-income`, `retirement`, `retirement-controls`, `spending-trends`, `tfsa-room`, `year-summary`. Every switch in a file, not just the first — `dashboard.spec.ts` and `net-worth.spec.ts` each set up `__TAURI_INTERNALS__` more than once and every one of them is reached by some test.
- Place the new case adjacent to `check_onboarding_status` in files that have it, so the two launch gates read as the siblings they are. Where there is no `check_onboarding_status`, put it first in the switch, ahead of the domain commands — it is the earliest call the app makes.
- `{ needs_picker: false }` is the value in all 33, matching Rust's `PickerGateStatus` and the `PickerGateStatus` interface in `hooks/useDatasets.ts`. These specs all test surfaces *past* the gate; a spec that wanted the picker would be a picker spec.
- Update `apps/desktop/src/routes/__root.tsx`'s comment above `fetchPickerGateStatus().catch(() => null)`. It currently reads "none of them mock `check_picker_gate`, the promise rejects, and the app renders as it always did" — false after this story. It must say the fallback is retained for the three mock-less specs and for a genuine IPC failure at launch, mirroring `fetchOnboardingStatus`'s existing fallback.
- Add to `apps/desktop/tests/picker.spec.ts` a new `test.describe("selecting Default preserves existing data", ...)` with one test: `needsPicker: true`, one Default dataset, and a new `seedDashboard` mock option that makes `get_budget_summary` (and whatever else the assertion needs) return non-zero values. Launch at `/picker`, assert the picker renders, click the Default row, then assert the dashboard renders *those seeded values* — via `budget-overall-progress`'s `aria-valuetext`, which `routes/index.tsx` builds from `total_spent_cents`/`total_target_cents`. Asserting only that the dashboard appeared would pass against zeroed data and prove nothing about intactness.
- The full Playwright suite must pass, and no spec may reach its switch default or reject fallback for `check_picker_gate`.

**Block If:** none — the file list, the case body, its placement, and the new test's assertion surface are all fixed here.

**Never:**
- Do not add a Tauri mock to `navigation.spec.ts`, `app-launch.spec.ts`, or `ai-navigation.spec.ts`. Testing the shell with no backend is what those specs are for; giving them mocks changes what they cover.
- Do not remove or weaken `__root.tsx`'s `.catch(() => null)`. Only its comment is wrong.
- Do not add `list_datasets` to the 27 specs' mocks. With `needs_picker: false` they never render the picker, so a `list_datasets` case would be dead mock code.
- Do not touch the gate's own logic, `PICKER_PASSED`, `mark_picker_passed`, `select_dataset`, or anything else shipped by Stories 33.1–33.5.
- Do not restructure, rename, or "tidy" any existing mock, test, or assertion while adding the case. One mechanical insertion per switch; unrelated diff noise in 27 files is unreviewable.
- Do not change `picker.spec.ts`'s existing describes. The new one is additive, and its `seedDashboard` option must default to the current zeroed behavior so no existing test changes.

</intent-contract>

## Code Map

- `apps/desktop/tests/{accessibility,accounts,assets,auth,budget,budget-templates,chat,chat-expense-query,chat-maintenance-query,design-system,expenses,financial-health,import,import-duplicates,maintenance,nav-qa,onboarding,profile,projects,recurring-income,retirement,retirement-controls,spending-trends,tfsa-room,year-summary}.spec.ts` -- one `check_picker_gate` case added to the single `switch (cmd)` in each (25 files, 25 switches).
- `apps/desktop/tests/dashboard.spec.ts` -- same case added to all **6** `switch (cmd)` statements.
- `apps/desktop/tests/net-worth.spec.ts` -- same case added to both `switch (cmd)` statements.
- `apps/desktop/tests/picker.spec.ts` -- add a `seedDashboard?: boolean` option to `PickerOptions`, wire it into the dashboard-facing mock cases, and add the new `selecting Default preserves existing data` describe.
- `apps/desktop/src/routes/__root.tsx` -- correct the stale comment above the gate's `.catch(() => null)`.

## Tasks & Acceptance

**Execution:**
- The 27 spec files / 33 switches -- insert the `check_picker_gate` case -- makes every spec declare its own launch precondition instead of inheriting one from a default branch.
- `apps/desktop/src/routes/__root.tsx` -- correct the comment -- stops it asserting something the suite no longer does.
- `apps/desktop/tests/picker.spec.ts` -- add the seeded end-to-end test -- proves selecting a profile reopens real data, which no existing test covers.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Any of the 27 mocked specs runs | `check_picker_gate` now explicitly answers `{ needs_picker: false }` | Spec behaves exactly as before, but without touching the switch default or reject fallback | None expected |
| The 3 mock-less specs run | No `__TAURI_INTERNALS__` at all; every invoke fails | `.catch(() => null)` yields no redirect; specs pass unchanged | Fallback is the handling |
| Launch → select Default → dashboard | `needsPicker: true`, one Default entry, `seedDashboard: true` | Picker renders; clicking Default lands on the dashboard showing the **seeded** budget figures | None expected |
| `dashboard.spec.ts` / `net-worth.spec.ts` | Multiple `__TAURI_INTERNALS__` setups per file | Every switch answers the gate; no test in either file hits a default | None expected |

**Acceptance Criteria:**
- Given all 31 Playwright specs, when the full suite runs after this change, then it passes, and no spec resolves `check_picker_gate` through a switch `default:` or a `Promise.reject("Unknown command")`.
- Given a spec file with more than one `__TAURI_INTERNALS__` setup (`dashboard.spec.ts`, `net-worth.spec.ts`), when its tests run, then every one of those setups answers `check_picker_gate` explicitly.
- Given the new seeded test, when the user launches to the picker and clicks Default, then the dashboard renders with the seeded budget values present — not zeroed — proving pre-existing data survived `select_dataset` and the post-selection cache clear.
- Given `__root.tsx`'s gate comment, when read after this change, then it describes the fallback's actual remaining purpose (the three mock-less specs, plus real IPC failure) rather than claiming no spec mocks the command.
- Given the 3 mock-less specs, when the suite runs, then they are unmodified and still passing.

## Design Notes

`needs_picker: false` everywhere is the whole point: these 27 specs assert on surfaces that only exist *after* the gate is cleared, so "the picker is not needed" is their real, previously-unstated launch precondition. Writing it down is the change.

The new test's assertion has to be on rendered **values**, not on the dashboard's mere presence. `picker.spec.ts`'s existing `choosing a profile` block already proves the routing (click → `/`), and it does so against a fully zeroed mock. Re-asserting "the dashboard appeared" would duplicate that and would stay green if `select_dataset` opened an empty database — the exact failure this AC exists to catch. `budget-overall-progress` is the right probe because `routes/index.tsx` renders its `valueText` directly from `total_spent_cents`/`total_target_cents`, so seeded money appears verbatim in an assertable attribute.

The three mock-less specs turn what looked like Story 33.4 scaffolding into a permanent requirement: because they run with no Tauri at all, the gate can never assume its invoke resolves. That is why this story corrects the fallback's comment instead of removing the fallback.

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: exit 0
- `cd apps/desktop && npx playwright test` -- expected: full suite passes; note any pre-existing parallelism flakes (a non-deterministic pair, each passing in isolation, in files outside this diff) separately from real failures
- `cd apps/desktop && npx playwright test picker.spec.ts` -- expected: all pass, including the new seeded test
- `grep -c 'check_picker_gate' apps/desktop/tests/*.spec.ts` -- expected: `dashboard.spec.ts` >= 6, `net-worth.spec.ts` >= 2, each of the other 25 listed files >= 1, `picker.spec.ts` unchanged-or-higher, and exactly 0 in `navigation.spec.ts`, `app-launch.spec.ts`, `ai-navigation.spec.ts`
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings (no Rust change is intended; this confirms none crept in)

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 9: (high 0, medium 2, low 7)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `medium` `patch` The new seeded test could not fail for the reason it claimed — three reviewers converged on this independently. `get_budget_summary` branched only on `seedDashboard` and the mock's `select_dataset` ignored `args.dataset_id`, so the seeded figures came back regardless of which row was clicked; the test was a tautology about the mock, not a test of selection. Fix: replaced the boolean with a per-dataset `budgetByDataset` map, had the mock record the id handed to a *successful* `select_dataset`, and served the summary from that id — then extended the single test into a discriminating pair (Default shows the money, Work shows `empty-budget` and never Default's figures) plus a `{ dataset_id: "default" }` wire assertion. Proven discriminating by two mutations: moving the money to `work-1` turns both tests red, and reverting the mock to ignore the clicked id turns the Work control red while Default still passes — i.e. the control is exactly what closes the original hole.
  - `medium` `patch` The new test's inline comment claimed the assertion catches "a `select_dataset` that opened an empty database" and "a post-selection `queryClient.clear()` that dropped the reopened data". Both are unobservable over a mocked `invoke`, and `hooks/useDatasets.ts:51-53` says so explicitly for the cache clear. Fix: narrowed the comment to what the mock can observe — that the rendered figures belong to the dataset that was selected, and that `empty-budget`'s absence means the hero resolved to the meter branch.
  - `medium` `patch` `recurring-income.spec.ts`'s test "recurring income form explains itself when no income source exists" installs its own *second*, switch-less `__TAURI_INTERNALS__` (`invoke: cmd => ... Promise.resolve([])`) and does not call `setupTauriMock`, so it still answered the gate implicitly via `[].needs_picker === undefined` — the exact "passes by accident of the fallback" class this story exists to eliminate, and the reason `__root.tsx`'s new claim was false. The spec's census was keyed to `switch (cmd)` and this mock has none, so it was never on the list. Fix: guard line for `check_picker_gate` ahead of the blanket `[]`, then re-audited coverage per `__TAURI_INTERNALS__` assignment rather than per switch — now 1:1 in all 28 mocked files (34 mocks), 0 in the three mock-less specs.
  - `low` `patch` `seedDashboard`'s docstring claimed it made the dashboard's budget commands (plural) answer with money while only `get_budget_summary` was wired, leaving an impossible fixture — budget totals with zero category groups. Fix: narrowed the option's name and docstring to exactly what it controls, stating outright that nothing else on the dashboard is seeded.
  - `low` `patch` In `auth.spec.ts` the inserted case landed directly beneath `// A rejected command renders an error card...`, which governs the rendered-surface commands below it; `check_picker_gate` is consumed in `beforeLoad` with a `.catch` and never rendered. Fix: relocated the case below `check_onboarding_status`'s body so the comment again governs only what it describes, while staying adjacent to its sibling gate.

## Auto Run Result

Status: done

### Summary of implemented change

Every Tauri mock that the app's root gate can reach now declares its own launch precondition. `case "check_picker_gate": return Promise.resolve({ needs_picker: false });` was added to all 33 `switch (cmd)` statements across 27 specs, plus — found in review — one switch-less second mock in `recurring-income.spec.ts` that the spec's switch-keyed census had missed. Coverage is now 1:1 between `__TAURI_INTERNALS__` assignments and gate answers in all 28 mocked spec files. Before this, the whole suite passed only because 11 specs rejected the command, 20 resolved their switch default to `null`, and 2 to `[]` — all of which coerce to "no redirect".

`__root.tsx`'s stale comment (which asserted no spec mocks the gate) now describes the fallback's real remaining purpose: a genuine IPC failure at launch, plus the three specs that deliberately mock no Tauri at all.

`picker.spec.ts` gained a discriminating pair proving selection routes to the right profile's data: with a per-dataset budget fixture, clicking Default renders Default's seeded figures and clicking Work renders Work's empty budget — never Default's.

### Files changed

- `apps/desktop/tests/{accessibility,accounts,assets,auth,budget,budget-templates,chat,chat-expense-query,chat-maintenance-query,design-system,expenses,financial-health,import,import-duplicates,maintenance,nav-qa,onboarding,profile,projects,retirement,retirement-controls,spending-trends,tfsa-room,year-summary}.spec.ts` -- one `check_picker_gate` case per switch (24 files, 1 switch each).
- `apps/desktop/tests/dashboard.spec.ts` -- the case added to all 6 switches.
- `apps/desktop/tests/net-worth.spec.ts` -- the case added to both switches.
- `apps/desktop/tests/recurring-income.spec.ts` -- the case in the primary switch, plus a guard line in the second switch-less inline mock (the review finding).
- `apps/desktop/tests/picker.spec.ts` -- `budgetByDataset` per-dataset fixture keyed off the id given to a successful `select_dataset`; new `selecting a profile opens that profile's own data` describe with the Default/Work discriminating pair.
- `apps/desktop/src/routes/__root.tsx` -- gate comment corrected. `.catch(() => null)` unchanged.
- `apps/desktop/tests/{navigation,app-launch,ai-navigation}.spec.ts` -- deliberately untouched; verified 0 occurrences and absent from `git status`.

### Review findings breakdown

- Patches applied: 5 (medium 3, low 2) — itemized in the Review Triage Log above.
- Items deferred: 9 (medium 2, low 7) — in frontmatter `deferred`. The two medium ones are the genuinely untested Rust-side guarantee (that opening an existing dataset directory leaves its rows intact — categorically unreachable from a mocked-IPC E2E test, and Epic 34.5's territory) and the absence of any accessibility scan over `/picker`.
- Items rejected: 8 — chiefly a claim that `projects.spec.ts`'s `__INVOKE_LOG__` assertions would shift (verified: they are all `toContain`/`not.toContain` on named commands, so an extra logged gate call is inert), a request to restructure `seedDashboard` into an overrides object (style), a `/picker`-reachable-after-latch finding already deferred under Story 33.5, a claim that the 33 insertions need in-code rationale (it lives in this artifact), and the suggestion that the sweep's behavior-neutrality makes it churn (behavior-neutrality is the point — the invariant is what changed).

### Follow-up review recommendation

`true`. Patched findings by severity: high 0, medium 3, low 2. Score = 3 x 3 + 1 x 2 = 11, which is >= 5.

### Verification performed

Re-run independently after the patch pass:

- `npx tsc --noEmit` -- exit 0.
- `npx playwright test picker.spec.ts recurring-income.spec.ts auth.spec.ts` -- 29 passed, 0 failed.
- `npx playwright test` (full) -- **530 passed, 1 failed**: `maintenance.spec.ts:1412`, which passes in isolation (42/42). Total moved 530 -> 531, matching the one net-new test.
- `cargo build` -- exit 0, 0 warnings; `git status` on `src-tauri` empty, confirming no Rust was touched.
- Gate coverage audited **per `__TAURI_INTERNALS__` assignment**, not per switch (the lesson of the `recurring-income` finding): 1:1 in all 28 mocked files, 0:0 in the three mock-less specs.
- The 27 mechanical files verified as purely additive: 77 insertions, 0 deletions, no reformatting or renaming.
- Patch 1's discrimination verified by mutation, not assertion: relocating the seeded money to `work-1` turns both tests red; reverting the mock to ignore the clicked `dataset_id` turns the Work control red while Default still passes.

### Deviation from the spec

The spec's intent-contract fixed the describe title as `"selecting Default preserves existing data"` and specified "one test". Both changed:

- **Title** renamed to `"selecting a profile opens that profile's own data"`. Patch 2 established that the persistence framing is not something a mocked-IPC E2E test can show; leaving a title asserting "preserves existing data" directly above a comment disclaiming that very thing would have been incoherent. The new title states what the pair actually proves.
- **One test became two.** The Work control is what makes the Default assertion falsifiable, per patch 1.

Both deviations are consequences of accepted review findings, not drift.

### Residual risks

- The full suite is not reproducibly green: five consecutive runs produced five **disjoint** failing sets (2, 3, 3, 4, 1 failures) across `accounts`/`expenses`/`maintenance`/`projects`, always `toBeVisible`/`not.toBeVisible` timing on toasts and slide-overs, every one passing in isolation. A stashed-baseline run at `bb8474b` failed 3 tests in the same family, so the rate is unchanged by this story. This flake budget is large enough to mask a real failure and deserves its own story.
- The gate's wire contract is still coupled to 34 duplicated `{ needs_picker: false }` literals by convention alone (deferred): renaming the Rust field would leave every mock returning a stale shape that coerces to "no redirect", with the suite green.
- `__root.tsx`'s comment names the three mock-less specs in prose. It is accurate today, and the per-mock audit above confirms it, but nothing executable keeps it true as specs are added (deferred).
