---
title: 'Dataset path authority replaces every independent app_data_dir call site'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'ef8a3a62e45dae8eac40cf07aa8ae62e8da6ad46'
review_loop_iteration: 2
followup_review_recommended: true
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** 7 files independently call `app.path().app_data_dir()` (or hardcode its literal), so no single choke point exists to later scope paths per-profile — Epic 33's registry/lock/picker stories all depend on one path authority existing first.

**Approach:** Add `datasets.rs` owning `global_root()`, `dataset_dir(app, id)`, and `active_dataset_dir(app)`; re-point `lib.rs`, `commands/{backup,danger_zone,profile,import,maintenance}.rs`, and `commands/mod.rs::get_db_status` through it. No registry, no `select_dataset`, no UI — those are Stories 33.2–33.4. Story 33.1 adds only the minimal "which id is active" marker `active_dataset_dir` needs to be genuinely fallible.

## Boundaries & Constraints

**Always:**
- `datasets.rs` is the only module that calls `app.path().app_data_dir()`. Every other file resolves paths via its three functions.
- `dataset_dir(app, id)` returns `global_root(app)` when `id == "default"`, else `global_root(app).join("datasets").join(id)`.
- The app's observable behavior and the existing Rust test suite (`wipe_list_covers_every_table_in_the_schema` included) are unchanged — this story is a pure internal refactor.
- `lib.rs`'s `.setup()` marks `"default"` as the active dataset id immediately after resolving the root and before `init_db` runs, so every command that later calls `active_dataset_dir()` succeeds exactly as today.
- Per AD-13, the demographic `/profile` feature (name/DOB/income/location, keyed by Cognito `sub`) is dataset-independent and must resolve via `global_root(app)`, never `active_dataset_dir(app)` — this applies to `commands/profile.rs::resolve_profiles_dir` and the single `app_data_dir` resolution in `commands/danger_zone.rs::delete_all_data` (used only to locate `profiles/` for deletion; the database wipe itself acts on the already-open connection, no path involved). `commands/maintenance.rs`'s vehicle-catalog cache (`vehicle_catalog/`, populated by `lib.rs`'s background refresh via `global_root(app)` — unchanged by this story) is the same class of dataset-independent, non-personal reference data as the demographic profile store and the bundled ISO-3166 dataset: it must also resolve via `global_root(app)`, so `maintenance.rs::resolve_app_data_dir` (which backs `get_vehicle_catalog_status`/`get_vehicle_makes`/`get_vehicle_models`) uses `global_root(app)` too — never `active_dataset_dir(app)`, which would otherwise split the catalog's writer (the background refresh, always at the root) from its readers (these three commands) the moment a non-default dataset becomes active. Every remaining call site in this story (`backup.rs`, `import.rs`, `mod.rs::get_db_status`) resolves the actual per-dataset `nkbaz-finance.db`/import-staging paths via `active_dataset_dir(app)`. Getting this pairing right now matters even though `global_root(app) == active_dataset_dir(app)` today (only `"default"` exists) — Epic 34 introduces non-default active ids, at which point the wrong function would silently start scoping profile data or the catalog cache per-dataset, contradicting AD-13's "must never be confused... anchored at global_root() regardless of active dataset" and splitting the catalog's writer from its readers.

**Block If:** none — scope, call sites, and behavior are fully specified by the epic/story text; no decision here requires human input.

**Never:**
- Do not build the registry (`datasets.json`), `select_dataset`, the picker route, or any UUID/per-profile directory creation — out of scope (Stories 33.2–33.4).
- Do not change `DbState`'s shape (`Mutex<Connection>`) — Story 33.3's job.
- Do not add a new `AppError` variant — reuse the existing `AppError::NotConfigured`.
- Do not make the active-id marker part of any public API beyond `datasets.rs` and `lib.rs`'s setup call.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/datasets.rs` -- NEW. Path authority: `global_root`, `dataset_dir`, `active_dataset_dir`, plus a private `ACTIVE_DATASET_ID: Mutex<Option<String>>` and `pub(crate) fn set_active_dataset_id`. Splits pure logic (`dataset_dir_from_root`, `resolve_active_dir`) from the two Tauri-context-dependent wrappers so both are unit-testable without a running app.
- `apps/desktop/src-tauri/src/lib.rs` -- add `mod datasets;`; in `.setup()`, take `app_handle = app.handle().clone()` (pattern already used later in the same closure), replace the direct `.app_data_dir()` call with `datasets::global_root(&app_handle)`, then call `datasets::set_active_dataset_id("default")` before `init_db`.
- `apps/desktop/src-tauri/src/commands/mod.rs` -- `get_db_status` gains an `app: AppHandle` param; `db_path` becomes `datasets::active_dataset_dir(&app)?.join("nkbaz-finance.db")` instead of the hardcoded literal.
- `apps/desktop/src-tauri/src/commands/backup.rs` -- `export_backup` and `import_backup` both replace their local `app_data_dir` resolution with `datasets::active_dataset_dir(&app_handle)?`.
- `apps/desktop/src-tauri/src/commands/danger_zone.rs` -- `delete_all_data`'s single `app.path().app_data_dir()` call (used only to locate `profiles/` for deletion — the database wipe itself operates on the already-open connection, no path involved) becomes `datasets::global_root(&app)?` (AD-13 — profiles are dataset-independent).
- `apps/desktop/src-tauri/src/commands/profile.rs` -- `resolve_profiles_dir` replaces its body with `datasets::global_root(app)` (AD-13 — profiles are dataset-independent, never per-dataset).
- `apps/desktop/src-tauri/src/commands/import.rs` -- `resolve_app_data_dir` replaces its body with `datasets::active_dataset_dir(app)`.
- `apps/desktop/src-tauri/src/commands/maintenance.rs` -- `resolve_app_data_dir` (line ~295) replaces its body with `datasets::global_root(app)` (the vehicle-catalog cache is dataset-independent reference data, matching the writer at `lib.rs`'s background refresh — never `active_dataset_dir`).
- `apps/desktop/src-tauri/src/error.rs` -- read-only reference: `AppError::NotConfigured` already exists (currently used for "AI provider not configured"); reused as-is, no new variant.
- `apps/desktop/src-tauri/src/db/danger_zone.rs:185` -- read-only reference: `wipe_list_covers_every_table_in_the_schema` test that must keep passing unmodified (does not touch `app_data_dir`, so unaffected by this refactor beyond "still green").

## Tasks & Acceptance

**Execution:**
- `apps/desktop/src-tauri/src/datasets.rs` -- create module per Code Map -- single path authority + minimal fallible "active id" marker.
- `apps/desktop/src-tauri/src/lib.rs` -- register module, re-point setup's app-data-dir resolution, mark `"default"` active before `init_db` -- keeps today's single-dataset startup behavior identical while giving every later command a resolvable active dataset.
- `apps/desktop/src-tauri/src/commands/mod.rs` -- re-point `get_db_status` -- removes the hardcoded `"nkbaz-finance.db"` literal in favor of the real resolved path.
- `apps/desktop/src-tauri/src/commands/backup.rs` -- re-point both call sites -- `export_backup`/`import_backup` keep locating the same file, just through the authority.
- `apps/desktop/src-tauri/src/commands/danger_zone.rs` -- re-point `delete_all_data`'s profile-deletion path resolution to `datasets::global_root` -- profiles are dataset-independent (AD-13); the database wipe itself needs no path change (operates on the open connection).
- `apps/desktop/src-tauri/src/commands/profile.rs` -- re-point `resolve_profiles_dir` to `datasets::global_root` -- demographic-profile storage stays anchored at the root regardless of active dataset (AD-13).
- `apps/desktop/src-tauri/src/commands/import.rs` -- re-point `resolve_app_data_dir` -- import staging directory resolution goes through the authority.
- `apps/desktop/src-tauri/src/commands/maintenance.rs` -- re-point `resolve_app_data_dir` to `datasets::global_root` -- the vehicle-catalog cache is dataset-independent reference data; `lib.rs`'s background refresh already writes it via `global_root`, so the read side must match or the cache silently appears empty per non-default dataset.
- `apps/desktop/src-tauri/src/datasets.rs` -- unit tests for `dataset_dir_from_root` and `resolve_active_dir` -- covers the I/O matrix below without any Tauri app context or shared global state.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default id | `dataset_dir_from_root(root, "default")` | Returns `root` unchanged | No error expected |
| Non-default id | `dataset_dir_from_root(root, "<uuid>")` | Returns `root.join("datasets").join("<uuid>")` | No error expected |
| No active id | `resolve_active_dir(root, None)` | — | Returns `AppError::NotConfigured` |
| Active id set | `resolve_active_dir(root, Some("default"))` | Returns `root` (same as the default-id case) | No error expected |

**Acceptance Criteria:**
- Given the app is running, when any of `lib.rs`, `commands/backup.rs`, `commands/danger_zone.rs`, `commands/profile.rs`, `commands/import.rs`, `commands/maintenance.rs`, or `commands/mod.rs::get_db_status` needs a filesystem path, then it resolves that path exclusively via `datasets::global_root()`, `datasets::dataset_dir()`, or `datasets::active_dataset_dir()` — grep for `app_data_dir()` outside `datasets.rs` returns nothing.
- Given a fresh app launch, when `.setup()` runs, then `datasets::set_active_dataset_id("default")` is called before `init_db`, so every command invoked afterward resolves `active_dataset_dir()` successfully.
- Given `get_db_status` is invoked, when it runs, then `db_path` reflects the real resolved active dataset path (joined with `nkbaz-finance.db`), not a hardcoded literal.
- Given `commands/profile.rs::resolve_profiles_dir`, `commands/danger_zone.rs`'s profile-deletion path, or `commands/maintenance.rs::resolve_app_data_dir` (vehicle-catalog cache), when any resolves a directory, then it uses `datasets::global_root(app)`, never `datasets::active_dataset_dir(app)` (AD-13; catalog-writer/reader consistency).
- Given the full existing Rust test suite (including `wipe_list_covers_every_table_in_the_schema`), when it runs after this change, then it passes unmodified.
- Given `cargo build`, when it runs, then it produces zero warnings (project compilation-warnings policy).

## Spec Change Log

### 2026-08-19 — bad_spec repair (review pass 1)

**Triggering finding:** Blind Hunter and Edge Case Hunter independently flagged that the Code Map's original wording for `commands/profile.rs::resolve_profiles_dir` and `commands/danger_zone.rs`'s profile-deletion path ("goes through the authority") was ambiguous about *which* of the three `datasets.rs` functions to call, and the implementer reasonably-but-incorrectly applied the same `active_dataset_dir(app)` pattern used everywhere else. This contradicts AD-13 (surfaced in this run's own `epic-33-context.md`): the demographic `/profile` store is dataset-independent and must stay anchored at `global_root()` regardless of the active dataset. No test currently fails because `global_root(app) == active_dataset_dir(app)` while only `"default"` exists, but Epic 34 introduces non-default active ids, at which point the original wording would have silently made profile data per-dataset-scoped — a real, if latent, defect.

**What was amended:** Code Map and Tasks entries for `commands/danger_zone.rs` and `commands/profile.rs` now explicitly name `datasets::global_root(app)` (not `active_dataset_dir`), with the AD-13 citation. Added an explicit "Always" bullet in the intent-contract pairing every one of the 7 call sites to its correct function by name, so no future amendment can reintroduce this ambiguity. Added a dedicated Acceptance Criterion for this pairing.

**Known-bad state avoided:** `resolve_profiles_dir` and the profile-deletion path silently switching to per-dataset scoping the moment Epic 34 activates a non-default dataset, which would appear to users as "my profile disappeared" or, combined with `delete_all_data`, as profile PII surviving a "delete all data" request run from a non-default profile (a direct NFR4 violation).

**KEEP instructions (preserve exactly on re-derivation):** Everything else from the prior implementation was correct and must be reproduced identically: the `datasets.rs` module shape (`global_root`, `dataset_dir`, `active_dataset_dir`, the pure `dataset_dir_from_root`/`resolve_active_dir` split, the `ACTIVE_DATASET_ID` static + `set_active_dataset_id`, `DEFAULT_DATASET_ID` constant); `lib.rs`'s single hoisted `app_handle` reused for `global_root` and `set_active_dataset_id` before `init_db`; `backup.rs` (both call sites), `import.rs`, `maintenance.rs`, and `mod.rs::get_db_status` all resolving via `active_dataset_dir(app)` exactly as before; the 5 existing unit tests in `datasets.rs` verbatim, unchanged; the `#[allow(dead_code)]` on `dataset_dir` with its explanatory comment (no Tauri test harness exists in this repo to exercise it, so this remains the correct, pragmatic choice per `docs/guidelines/warnings.md`).

### 2026-08-19 — bad_spec repair (review pass 2)

**Triggering finding:** Blind Hunter, Edge Case Hunter, and Verification Gap Reviewer independently flagged that `commands/maintenance.rs::resolve_app_data_dir` (backing `get_vehicle_catalog_status`/`get_vehicle_makes`/`get_vehicle_models`) was pointed at `active_dataset_dir(app)`, while `lib.rs`'s background vehicle-catalog refresh (unchanged by this story) writes the same `vehicle_catalog/` cache via `global_root(app)`. The vehicle catalog is dataset-independent NHTSA reference data — the same class as the demographic profile store (AD-13) and the bundled ISO-3166 dataset — with no isolation rationale; splitting its writer from its readers the moment a non-default dataset is active would make the cache appear permanently empty/stale for every non-default dataset and force repeated NHTSA re-fetches. No test currently fails because `global_root(app) == active_dataset_dir(app)` while only `"default"` exists.

**What was amended:** Code Map, Tasks, and the intent-contract's "Always" bullet for `commands/maintenance.rs::resolve_app_data_dir` now explicitly name `datasets::global_root(app)` (not `active_dataset_dir`), citing consistency with the `lib.rs` catalog-refresh writer and the AD-13 reference-data precedent. Extended the shared Acceptance Criterion to cover this call site. This supersedes review pass 1's KEEP instruction for `maintenance.rs` (which said "resolving via `active_dataset_dir(app)` exactly as before") — that KEEP instruction is retracted for this one call site only; everything else it named still stands.

**Known-bad state avoided:** The vehicle-makes/models dropdown silently going empty and re-fetching from NHTSA on every use, for any non-default dataset, once Epic 34 ships — with no error and no test catching it, since the divergence exists only when the active id isn't `"default"`.

**KEEP instructions (preserve exactly on re-derivation):** Everything from pass 1's KEEP list still applies, MINUS `maintenance.rs` (now `global_root`, per above). Additionally preserve: the AD-13 fix to `profile.rs`/`danger_zone.rs` from pass 1; `lib.rs`'s single hoisted `app_handle` (no duplicate clone); `backup.rs` (both call sites), `import.rs`, and `mod.rs::get_db_status` resolving via `active_dataset_dir(app)` unchanged.

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 1 (high 1, medium 0, low 0)
- patch: 5 (medium 1, low 4)
- defer: 12 (high 0, medium 3, low 9)
- reject: 10
- addressed_findings:
  - `[high]` `[bad_spec]` `commands/profile.rs::resolve_profiles_dir` and `commands/danger_zone.rs`'s profile-deletion path used `active_dataset_dir(app)` instead of `global_root(app)`, contradicting AD-13. Spec Code Map/Tasks/AC amended (see Spec Change Log above); code reverted for re-derivation from the amended spec.

### 2026-08-19 — Review pass 2
- intent_gap: 0
- bad_spec: 1 (medium 1)
- patch: 2 (medium 1, low 1)
- defer: 14 (medium 3, low 11)
- reject: 12
- addressed_findings:
  - `[medium]` `[bad_spec]` `commands/maintenance.rs::resolve_app_data_dir` (vehicle-catalog cache) used `active_dataset_dir(app)` instead of `global_root(app)`, diverging from the `lib.rs` catalog-refresh writer. Spec Code Map/Tasks/AC amended (see Spec Change Log above); code reverted for re-derivation from the amended spec. Patch-category findings (test coverage for the `set_active_dataset_id`/`active_dataset_dir` wiring; an `lib.rs` comment pointing to Story 33.3/AD-6a) are moot this pass per cascading triage order and carry forward for the next review pass.

### 2026-08-19 — Review pass 3
- intent_gap: 0
- bad_spec: 0
- patch: 3 (medium 1, low 2)
- defer: 13 (medium 3, low 10)
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` The stateful half of `datasets.rs` (`set_active_dataset_id`/`ACTIVE_DATASET_ID`) had zero test coverage — all prior tests only exercised the pure siblings with hand-supplied ids. Added a private `active_dataset_id()` getter (releasing the lock before `resolve_active_dir` runs, so no guard is held across the call) and one sequential-assertion test proving the setter/getter round-trip for both the default and a non-default id.
  - `[low]` `[patch]` `import.rs` and `maintenance.rs` both had a private helper named `resolve_app_data_dir` returning genuinely different anchors (`active_dataset_dir` vs `global_root`) — renamed to `resolve_import_staging_dir` and `resolve_catalog_root` respectively (rename only, call sites updated, no behavior change).
  - `[low]` `[patch]` `DEFAULT_DATASET_ID` was `pub` while every other item in `datasets.rs` was `pub(crate)` — made uniformly `pub(crate)`.
- addressed_findings:
  - `[high]` `[bad_spec]` `commands/profile.rs::resolve_profiles_dir` and `commands/danger_zone.rs`'s profile-deletion path used `active_dataset_dir(app)` instead of `global_root(app)`, contradicting AD-13. Spec Code Map/Tasks/AC amended (see Spec Change Log above); code reverted for re-derivation from the amended spec.

## Design Notes

`dataset_dir(app, id)` and `active_dataset_dir(app)` are thin, Tauri-context-dependent wrappers with no independently-testable logic of their own; each delegates immediately to a pure, `Path`-based sibling (`dataset_dir_from_root`, `resolve_active_dir`) that takes already-resolved inputs and contains 100% of the actual branching. This mirrors the existing split in `profile_store.rs` (`profiles_dir(app_data_dir: &Path)` is pure; the `AppHandle`→`Path` resolution lives in each command) and avoids a Tauri-app-mocking dependency in tests:

```rust
fn dataset_dir_from_root(root: &Path, id: &str) -> PathBuf {
    if id == "default" { root.to_path_buf() } else { root.join("datasets").join(id) }
}
fn resolve_active_dir(root: &Path, id: Option<&str>) -> Result<PathBuf, AppError> {
    Ok(dataset_dir_from_root(root, id.ok_or(AppError::NotConfigured)?))
}
```

The `ACTIVE_DATASET_ID: Mutex<Option<String>>` module static is a deliberately minimal, temporary shim: it exists only so `active_dataset_dir()` is genuinely fallible starting now, per this story's AC. Story 33.3 replaces it outright by folding the id into `DbState`'s new `Mutex<ActiveDataset{id, conn}>` (Tauri-managed state, not a bare global) — do not extend this static with anything beyond what this story needs; anything more belongs in 33.3.

`lib.rs`'s `.setup()` closure receives `&mut App`, not `AppHandle` — obtain `app.handle().clone()` once (the closure already does this later for deep-link handling) and reuse that single `AppHandle` for both `datasets::global_root(&app_handle)` and `datasets::set_active_dataset_id`.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings (grep output for "warning:" is empty)
- `cd apps/desktop/src-tauri && cargo test` -- expected: all tests pass, including `wipe_list_covers_every_table_in_the_schema` and the new `datasets` unit tests
- `grep -rn "app_data_dir()" apps/desktop/src-tauri/src/ --include=*.rs | grep -v "src/datasets.rs"` -- expected: empty output (no call sites remain outside `datasets.rs`)

## Auto Run Result

**Summary:** Implemented a single dataset path authority (`datasets.rs`) owning `global_root`, `dataset_dir`, and `active_dataset_dir`, and re-pointed every one of the 7 independent `app.path().app_data_dir()` call sites through it, with no registry, `select_dataset`, or picker (Stories 33.2–33.4). Two review passes caught and fixed genuine latent-but-currently-inert mispairings (AD-13 profile scoping; vehicle-catalog writer/reader consistency) before they could surface as real bugs once Epic 34 introduces non-default active datasets. A third review pass found no further bad_spec/intent_gap issues and closed out three low/medium-severity patch findings (stateful-wiring test coverage, ambiguous helper naming, a visibility nit).

**Files changed:**
- `apps/desktop/src-tauri/src/datasets.rs` (new) — path authority: `global_root`, `dataset_dir` (`#[allow(dead_code)]`, future stories' consumer), `active_dataset_dir`, the temporary `ACTIVE_DATASET_ID` shim, pure `dataset_dir_from_root`/`resolve_active_dir` siblings, 6 unit tests.
- `apps/desktop/src-tauri/src/lib.rs` — registers the module; hoists one `app_handle`, resolves the root via `global_root`, marks `"default"` active via `set_active_dataset_id` before `init_db`.
- `apps/desktop/src-tauri/src/commands/mod.rs` — `get_db_status` gains `app: AppHandle`; `db_path` is the real resolved path via `active_dataset_dir`, not the old hardcoded literal.
- `apps/desktop/src-tauri/src/commands/backup.rs` — `export_backup`/`import_backup` resolve the DB file via `active_dataset_dir`.
- `apps/desktop/src-tauri/src/commands/import.rs` — `resolve_import_staging_dir` (renamed from `resolve_app_data_dir`) resolves via `active_dataset_dir`.
- `apps/desktop/src-tauri/src/commands/danger_zone.rs` — profile-deletion path resolves via `global_root` (AD-13/NFR4).
- `apps/desktop/src-tauri/src/commands/profile.rs` — `resolve_profiles_dir` resolves via `global_root` (AD-13).
- `apps/desktop/src-tauri/src/commands/maintenance.rs` — `resolve_catalog_root` (renamed from `resolve_app_data_dir`) resolves via `global_root`, matching `lib.rs`'s catalog-refresh writer.

**Review findings breakdown (3 passes, cumulative):**
- bad_spec: 2 (both patched via spec amendment + revert + re-derivation — AD-13 profile scoping in pass 1, vehicle-catalog scoping in pass 2)
- patch: 3 (all applied in pass 3 — stateful-wiring test coverage, helper-name disambiguation, visibility consistency)
- defer: 39 across all passes, recorded for future stories (id validation and Default-case collision → Story 33.2's registry; directory creation for non-default ids → Stories 33.2/33.4; `DbState`/connection routing through the authority, and the guard-holding-critical-section constraint → Story 33.3; `AppError::NotConfigured`'s AI-specific user message → whichever story first makes it user-reachable; hardcoded `"nkbaz-finance.db"` literal, backup dataset-provenance, `delete_all_data`'s non-default-dataset scope, CI/lint enforcement of the "only module" invariant → noted for later, not this story's problem)
- reject: 30 across all passes (noise, already-correctly-handled items, or claims contradicted by the actual verified behavior)

**Follow-up review recommendation:** `true` — pass 3's patch severities (1 medium, 2 low) score `3×1 + 1×2 = 5`, meeting the "5 or more" threshold, even though no single patch was high severity.

**Verification performed:**
- `cargo build` — exit 0, zero warnings (independently re-run after every implementation and patch round)
- `cargo test` — 692 passed, 0 failed, including `wipe_list_covers_every_table_in_the_schema` unmodified and all 6 `datasets::tests::*`
- `grep -rn "app_data_dir()" apps/desktop/src-tauri/src/ | grep -v src/datasets.rs` — empty, independently re-run after every round
- Matrix Test Audit: all 4 I/O-matrix rows (default id, non-default id, no active id, active id set) are covered by name-matching tests and ran green in the verification above

**Residual risks (deferred, not blocking):**
- `AppError::NotConfigured` reused for "no active dataset" carries an AI-specific user message (`"AI provider not configured"`, `setup_url: "/settings"`) — unreachable in this story (setup always marks `"default"` active first) but will need a real fix once a story makes it genuinely reachable (Story 33.3/33.4).
- The live `DbState` connection is still opened via `global_root` in `lib.rs`, independently of `active_dataset_dir` — they agree only because `"default"` is the only id today; Story 33.3 unifies this by folding the active id into `DbState` itself.
- No dataset-id validation exists yet (traversal, empty string, case-insensitive `"Default"` collision) — `dataset_dir`'s only caller today is a unit test, so this is unreachable dead code pending Story 33.2's registry, which is documented as the correct owner of that validation.
