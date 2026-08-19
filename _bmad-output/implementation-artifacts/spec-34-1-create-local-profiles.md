---
title: 'Create additional local profiles from the picker'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '3ef830decfadf766890370d13b7e089c0a2c2a17'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      The failure window *after* the directory and database exist is still unpinned, so the
      specified "registry written last" ordering is not actually proven by a test.
    evidence: |-
      The shipped failure test makes `create_dir_all` itself fail, which is the pre-provision
      window. Deterministically failing only `init_db` after the directory exists is not possible
      without injectable provisioning, because the dataset id is random and cannot be pre-planted.
      Closing this needs `create_dataset_at` to accept a provisioning closure the test can fail.
    location: >-
      apps/desktop/src-tauri/src/datasets.rs
    severity: medium
  - summary: >-
      The auto-generated profile label is hardcoded English while the rest of the UI is bilingual.
    evidence: |-
      A French user sees the button as "Nouveau profil local" but the row it produces reads
      "Local Profile 1". The label is backend-minted and *stored in the registry* as data, so
      localizing it means storing a kind plus an index and translating at render time. Deferred
      rather than patched because the epic's acceptance criterion specifies the literal string
      `"Local Profile <n>"`, so changing it needs a product decision, not a code fix.
    location: >-
      apps/desktop/src-tauri/src/datasets.rs
    severity: medium
  - summary: >-
      No busy affordance while a create is in flight - no spinner, label change, `aria-busy`, or
      `aria-live` announcement, and no announcement of the outcome.
    evidence: |-
      Unlike select, create does not navigate, so a screen-reader user gets silence for both the
      in-flight window and the result while a new row silently appears below the focused button.
      Same class as the picker-row pending-affordance item already deferred under Story 33.5;
      the two should be solved together.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: medium
  - summary: >-
      `next_local_label` has no uniqueness guard, so a local entry whose label is not
      `"Local Profile <n>"` makes the counter skip or duplicate.
    evidence: |-
      Not reachable from the app today - `next_local_label` is the only writer of local labels, so
      every label conforms. Becomes reachable if a hand-edited registry or a future labelling
      feature lands. The count-vs-max-plus-one coupling is already recorded in the function's own
      doc comment.
    location: >-
      apps/desktop/src-tauri/src/datasets.rs
    severity: low
  - summary: >-
      `REGISTRY_LOCK` is a process-local mutex, so the read-modify-write is only atomic within one
      running instance.
    evidence: |-
      A second process or any external writer can still produce a lost update despite the atomic
      file write. Low risk in practice because the app forwards argv to the already-running
      instance rather than starting a second one, but the boundary is undocumented and no advisory
      file lock is taken.
    location: >-
      apps/desktop/src-tauri/src/datasets.rs
    severity: low
  - summary: >-
      The picker discards the underlying `AppError` when a create fails, so the distinguishing
      cause is unrecoverable in the field.
    evidence: |-
      `catch { toast.error(...) }` logs nothing, so "failed to create directory" versus a migration
      failure versus permissions or disk-full are indistinguishable, and "Please try again" is the
      wrong guidance for the non-transient cases. Matches the existing `selectEntry` catch shipped
      in Story 33.5, so changing it means introducing a frontend logging pattern that does not yet
      exist anywhere in this app.
    location: >-
      apps/desktop/src/components/picker/DatasetPicker.tsx
    severity: low
  - summary: >-
      New dataset directories are created with default filesystem permissions despite holding
      financial data.
    evidence: |-
      Pre-existing and consistent - the app data root already holds Default's database with default
      permissions - so this is a whole-app decision rather than something this story introduced.
    location: >-
      apps/desktop/src-tauri/src/datasets.rs
    severity: low
  - summary: >-
      The `create_dataset` command wrapper itself has no Rust test.
    evidence: |-
      Its load-bearing claims - that it resolves `global_root`, never takes `DbState`'s lock, and
      neither selects nor activates - are verifiable by reading (it calls only `global_root` and
      `create_dataset_at`), but asserting the active dataset is unchanged after a create would need
      a Tauri app harness this suite does not have.
    location: >-
      apps/desktop/src-tauri/src/commands/datasets.rs
    severity: low
  - summary: >-
      The "no free-text label input" test is a weak proxy for the naming non-goal.
    evidence: |-
      It asserts `input`/`textarea` counts are zero across the picker, so it breaks the moment any
      unrelated search or filter field lands there, and it would still pass against a
      `contenteditable`, a rename dialog, or a rename control on another surface.
    location: >-
      apps/desktop/tests/picker.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epic 33 built the whole dataset-scoping foundation — path authority, registry, active-dataset lock, launch picker, selection — but the registry has no write path at all. `datasets.rs` can bootstrap the single Default entry and read entries back; nothing can append one. So the machine is permanently single-profile, and every isolation story in Epic 34 is unprovable because a second profile cannot be brought into existence.

**Approach:** Add the registry's first mutator. `create_dataset` mints a lowercase UUID v4, creates `<root>/datasets/<uuid>/`, runs the existing unmodified `init_db` against it to get a fresh migrated empty database, and appends a full-schema `Dataset` entry — the whole read-modify-write held under the one existing `REGISTRY_LOCK` (AD-3), never split into a read then a separate write. The picker gains a "+ New local profile" action that calls it and re-reads the list, so the new row appears immediately and is selectable exactly like any other. Because the new dataset is genuinely empty, opening it lands in the onboarding wizard through the existing unmodified `check_onboarding_status` gate — no onboarding code changes.

The label is auto-generated `"Local Profile <n>"` and there is no free-text input anywhere: naming and renaming are explicit non-goals this pass.

## Boundaries & Constraints

**Always:**
- Add `create_dataset_at(root: &Path) -> Result<Dataset, AppError>` to `datasets.rs`, and a thin `create_dataset(app: AppHandle) -> Result<Dataset, AppError>` `#[tauri::command]` in `commands/datasets.rs` registered in `lib.rs`'s `generate_handler!`. The pure `root`-based function holds all the logic so it is unit-testable against a `TempDir`, mirroring `bootstrap_registry_at`/`bootstrap_registry`.
- `create_dataset_at` acquires `REGISTRY_LOCK` **once, for the entire read-modify-write**, and reads through the non-locking internal `load_registry_entries` — never through `load_registry`, which resolves its own path and would read outside the guard. Use the same `unwrap_or_else(|poisoned| poisoned.into_inner())` recovery as `bootstrap_registry_at`, for the same stated reason.
- Order of operations inside the guard: read entries → derive label → mint id → create the directory → `init_db(&dir)` and **drop the returned `Connection` immediately** → append the entry → `write_json_atomic`. The registry entry is written *last*, only after the directory and migrated database exist, so a mid-way failure can never leave a registry entry pointing at a dataset that does not work. `init_db`'s connection is dropped because `select_dataset` opens its own; holding it here would leak a handle for the life of the process.
- Mint the id as a canonical lowercase hyphenated UUID v4 derived from `rand::random::<[u8; 16]>()`, setting the version nibble to `4` and the variant bits to `10`. **Do not add the `uuid` crate** — it is only a transitive dependency, this epic forbids new dependencies, and `rand::random::<[u8; N]>()` is already this codebase's own idiom (`commands/auth.rs`'s PKCE verifier and state). The result must satisfy the existing `is_valid_dataset_id` (ASCII alphanumeric plus `-`), and a test must assert that.
- Label is exactly `format!("Local Profile {}", n)` where `n` = (count of existing entries with `is_default == false` **and** `kind == DatasetKind::Local`) + 1. Count, not max-plus-one — that is what the AC specifies, and it is safe because deletion is a non-goal this pass. Cloud-linked entries and Default are excluded from the count.
- The new entry is `kind: DatasetKind::Local`, `cognito_sub: None`, `linked_from: None`, `is_default: false`, `created_at: Utc::now().to_rfc3339()` — matching `default_dataset_entry`'s construction style.
- Add `useCreateDataset()` to `hooks/useDatasets.ts`: invokes `create_dataset`, and on success **invalidates `queryKeys.datasets`** — not `queryClient.clear()`. This story adds a profile to the list; it does not switch the active dataset, so clearing the whole cache would be wrong. Navigation and error toasting stay with the caller, matching `useSelectDataset`.
- `DatasetPicker.tsx` gains a "+ New local profile" control between the profile list and the inert Cloud button. Creating must leave the user on the picker with the new row visible — it must **not** auto-select or navigate. Disable it (both `disabled` and `aria-disabled`, matching the rows and the Cloud button) while either a create or a select is in flight, and disable the rows while a create is in flight, so the two mutations cannot interleave. On failure, `toast.error(t("datasets.createFailed"))`.
- New keys `datasets.newLocalProfile` and `datasets.createFailed` in **both** `en.json` and `fr.json`, added to `picker-i18n.test.ts`'s `REQUIRED_KEYS`. User-facing copy says "profile", never "dataset" — the existing `picker-i18n.test.ts` assertion enforces this.
- Rust tests in `datasets.rs`'s existing `mod tests` against a `TempDir`: the first create yields label `"Local Profile 1"`; a second yields `"Local Profile 2"`; the minted id passes `is_valid_dataset_id`; the directory and a migrated non-empty-schema database exist at `datasets/<id>/`; the registry afterwards contains Default plus the new entries with the new one's `is_default == false` and `kind == Local`; and Default's own entry is left byte-identical.
- A Playwright test in `picker.spec.ts`: picker → click "+ New local profile" → a second row appears → selecting it lands on the onboarding wizard (not the dashboard), proving a fresh dataset is genuinely unonboarded.

**Block If:** none — the id scheme, label rule, lock discipline, operation order, and every file are fixed here.

**Never:**
- Do not add the `uuid` crate or any other dependency.
- Do not add free-text label input, a rename affordance, or a delete/remove affordance anywhere. All are explicit non-goals.
- Do not modify `init_db`, the migrations runner, or any domain module to become dataset-aware. Isolation comes only from which directory `init_db` is pointed at.
- Do not modify `select_dataset`, `select_dataset_now`, `ActiveDataset`, `DbState`, `check_picker_gate`, `mark_picker_passed`, or `bootstrap_registry` behavior.
- Do not call `active_dataset_dir()` anywhere in this story's Rust code — creation is not scoped to the active dataset, and that helper takes `DbState`'s lock.
- Do not have `create_dataset` select, activate, or navigate to the new dataset. Creating and opening are separate user actions.
- Do not touch `check_onboarding_status` or any onboarding code. A fresh dataset is unonboarded because it is empty, not because anything special-cases it.
- Do not ever create, move, or delete Default's directory as a whole — it is the app data root, and the registry plus every other dataset live inside it.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/datasets.rs` -- add `create_dataset_at(root)` plus a private `new_dataset_id()` UUID-v4 minter and a private label helper; extend `mod tests`.
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- add the `create_dataset` command wrapping `create_dataset_at(&global_root(&app)?)`.
- `apps/desktop/src-tauri/src/lib.rs` -- register `commands::datasets::create_dataset` next to `list_datasets`.
- `apps/desktop/src/hooks/useDatasets.ts` -- add `useCreateDataset()`: invoke `create_dataset`, `invalidateQueries({ queryKey: queryKeys.datasets })` on success.
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- add the "+ New local profile" control, wire it, and cross-disable it against the row selection.
- `apps/desktop/src/locales/en.json`, `fr.json` -- `datasets.newLocalProfile`, `datasets.createFailed`.
- `apps/desktop/src/locales/__tests__/picker-i18n.test.ts` -- both new keys in `REQUIRED_KEYS`.
- `apps/desktop/tests/picker.spec.ts` -- mock `create_dataset` (appending to the mock registry so the list genuinely grows) and add the create → appears → select → onboarding test.

## Tasks & Acceptance

**Execution:**
- `datasets.rs` -- `create_dataset_at` + id minter + label helper -- the registry's first mutator, which is what unblocks all of Epic 34.
- `commands/datasets.rs` + `lib.rs` -- expose it -- gives the picker something to call.
- `hooks/useDatasets.ts` -- `useCreateDataset` -- create-then-refresh-the-list, without disturbing the active dataset.
- `DatasetPicker.tsx` + locales + `picker-i18n.test.ts` -- the "+ New local profile" affordance -- the actual user-facing capability.
- `datasets.rs` `mod tests` + `picker.spec.ts` -- prove label sequencing, id validity, on-disk layout, registry integrity, and that a fresh profile opens unonboarded.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First create, registry holds only Default | `create_dataset` | New entry `"Local Profile 1"`, `is_default: false`, `kind: local`; dir + migrated empty DB at `datasets/<uuid>/`; Default untouched | Propagates `AppError` |
| Second create | Registry holds Default + `"Local Profile 1"` | New entry `"Local Profile 2"`; two distinct UUID dirs | Propagates `AppError` |
| Registry also holds a cloud-linked entry | Default + 1 local + 1 cloud-linked | Next label is `"Local Profile 2"` — cloud-linked is not counted | Propagates `AppError` |
| `init_db` fails after the directory is made | Simulated failure | No registry entry is written; the registry still parses and still lists every previously-working dataset | Error surfaces; orphan directory is inert because the registry is the source of truth |
| Create succeeds in the UI | Picker showing | New row appears without navigating; the user stays on the picker; active dataset unchanged | — |
| Create fails in the UI | `create_dataset` rejects | `datasets.createFailed` toast; user stays on the picker; list unchanged | Toast, no navigation |
| Create while a selection is in flight | Row click pending | The create control is disabled; the two mutations cannot interleave | — |
| A freshly created profile is opened | Select the new row | Lands on the onboarding wizard, not the dashboard | — |

**Acceptance Criteria:**
- Given the picker is showing, when the user chooses "+ New local profile", then a new dataset is created with a fresh UUID directory containing its own migrated empty database, and appended to the registry under the same single writer lock every other registry operation uses.
- Given any number of existing profiles, when a new one is created, then its label is exactly `"Local Profile <n>"` with `n` = the count of existing non-default, non-cloud-linked profiles + 1, and no free-text label input exists anywhere in the UI.
- Given a create has just succeeded, when the picker re-renders, then the new profile appears in the list immediately, the user has not navigated away, and the active dataset is unchanged.
- Given a freshly created local profile, when it is opened for the first time, then it goes through the same onboarding wizard as a first-ever install, via the existing unmodified `check_onboarding_status` gate.
- Given `create_dataset` fails partway, when the registry is read afterwards, then it still parses and still lists every previously-working dataset, with no entry for the failed creation.
- Given the full suite, when it runs, then `cargo build` is warning-free, `cargo test` passes including the new dataset tests, `tsc` is clean, and `pnpm test` plus `playwright picker.spec.ts` pass.

## Design Notes

Writing the registry entry **last** is the whole failure story. The registry is the single source of truth for which datasets exist, so a directory with no entry is invisible and harmless, while an entry with no working directory would be a permanently broken row in the picker that the user cannot remove (deletion is a non-goal). Ordering the work so the only possible leak is the harmless one is cheaper and safer than adding rollback.

Counting rather than max-plus-one is deliberate and comes straight from the AC. It is only sound while deletion does not exist; if a later epic adds removal, the label rule has to become max-plus-one or the ids-in-labels approach has to change, because counting would then produce duplicates. Worth stating in the code comment so the coupling is visible when deletion lands.

Minting the UUID by hand from `rand` rather than adding the `uuid` crate keeps the epic's no-new-dependency constraint and matches `commands/auth.rs`, which already draws cryptographic random bytes this way for PKCE. Sixteen random bytes with the version and variant bits fixed is the whole of RFC 4122 §4.4, and the canonical lowercase hyphenated rendering is what makes the id both a valid directory name under `is_valid_dataset_id` and a byte-identical keyring service-name suffix for Story 34.2.

The frontend uses `invalidateQueries` where `useSelectDataset` uses `clear()`, and the contrast matters: selecting swaps which database every cached entry came from, so all of it is stale; creating adds a row to one list and leaves the active dataset alone, so clearing would needlessly blank the app.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings
- `cd apps/desktop/src-tauri && cargo test` -- expected: all pass, including the new `create_dataset_at` tests
- `cd apps/desktop && npx tsc --noEmit` -- expected: exit 0
- `cd apps/desktop && pnpm test` -- expected: all pass, including the two new `picker-i18n` required keys
- `cd apps/desktop && npx playwright test picker.spec.ts` -- expected: all pass, including the create → appears → select → onboarding test
- `cd apps/desktop && npx playwright test` -- expected: full suite passes; note pre-existing parallelism flakes (a small, run-varying set in `accounts`/`expenses`/`maintenance`/`projects`, each passing in isolation) separately from real failures
- `grep -rn "uuid" apps/desktop/src-tauri/Cargo.toml` -- expected: empty, confirming no dependency was added

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 4, low 0)
- defer: 9: (high 0, medium 3, low 6)
- reject: remaining review suggestions were speculative hardening or style-only
- addressed_findings:
  - `medium` `patch` Preserved invalid-id registry entries during create instead of permanently deleting them through the read-time filter.
  - `medium` `patch` Asserted the real onboarding gate inputs on a freshly migrated profile.
  - `medium` `patch` Unit-pinned `invalidateQueries` so unrelated cached data survives create.
  - `medium` `patch` Verified the create control disables itself and issues one create while pending.

## Auto Run Result

Status: done

Implemented local profile creation end to end: UUID-v4 dataset directory, migrated empty database, atomic registry append under the existing writer lock, auto-generated labels, Tauri command, picker action, bilingual copy, and create/select/onboarding coverage.

Review also fixed a material registry-loss bug: mutation reads now preserve entries hidden by the read-time invalid-id filter. Focused verification passed: 41 Rust dataset tests, TypeScript, 27 targeted Vitest tests, and 26 picker Playwright tests. No `uuid` dependency was added.

Follow-up review recommendation: `true` (4 medium patches; score 12).
