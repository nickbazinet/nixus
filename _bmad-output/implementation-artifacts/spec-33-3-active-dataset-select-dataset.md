---
title: 'Active-dataset state and the locked hot-swap (select_dataset)'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'f07b3ebfb0359ff83dd680518eca849c76fc24d6'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `DbState` is `Mutex<Connection>` — one connection, opened once at startup, with no notion of "which dataset" or "none selected yet." Nothing can ever switch datasets safely, and ~130 call sites across `commands/*.rs` assume a connection always exists.

**Approach:** `DbState` becomes `Mutex<ActiveDataset>` (`db/mod.rs`) where `ActiveDataset { id: Option<String>, conn: Option<Connection> }` — id and connection swap together as one atomic step, never independently. Add `select_dataset` (`commands/datasets.rs`, new file): resolves the target's directory, opens and migrates its database *before* touching the lock, and only on success swaps `id`+`conn` and emits `dataset:switched`. Every existing `State<DbState>` lock site gains a `.conn.as_ref()/.as_mut().ok_or(AppError::NotConfigured)?` guard. `lib.rs`'s `.setup()` now calls `select_dataset` once for `"default"` (preserving today's zero-user-action startup) instead of opening the connection directly — this is the *only* observable-behavior change this story is allowed to make, and it produces none. Story 33.1's `ACTIVE_DATASET_ID` static/`set_active_dataset_id`/`active_dataset_id()` are deleted outright (per Story 33.1's own Design Notes) and `active_dataset_dir` re-points to read `DbState.id` via `app.state::<DbState>()` instead — no signature change for any of `active_dataset_dir`'s existing callers (`backup.rs`, `import.rs`, `mod.rs::get_db_status`). No picker, no UI, no `list_datasets` command, no `create_dataset` (Stories 33.4/34.1).

## Boundaries & Constraints

**Always:**
- `select_dataset`'s sequence is: (1) look up the target id in the registry (`datasets::load_registry`, new — thin wrapper over Story 33.2's already-tested `load_registry_entries`) to validate the id and obtain its `kind`; (2) resolve the directory via `datasets::dataset_dir(app, id)` and open+migrate it via the existing `db::init_db(&dir)` — *before* acquiring `DbState`'s lock at all; (3) only on success, acquire the lock once and set `id`+`conn` together; (4) emit `dataset:switched { dataset_id, kind }` (best-effort, `let _ = app.emit(...)`, matching `import.rs`'s existing precedent) — including the very first selection of a run. Any failure in step 1 or 2 means the lock is never touched, so the previous state (or "none") is left provably unchanged with no rollback logic needed.
- `DbState` starts as `Mutex::new(ActiveDataset { id: None, conn: None })` when `app.manage(...)` runs in `.setup()` — before `select_dataset` is called for `"default"` a few lines later. No command may silently default to Default when `conn` is `None`; it must surface `AppError::NotConfigured` (the existing variant — no new one).
- Every existing `state.0.lock()` / `db_state.0.lock()` call site in `commands/*.rs` (list below) and `lib.rs`'s background recurring-apply task is transformed identically: the lock now yields a `MutexGuard<ActiveDataset>`, and the caller extracts the connection with `.conn.as_ref().ok_or(AppError::NotConfigured)?` (or `.as_mut()` for the 2 sites needing `&mut Connection`: `commands/backup.rs::import_backup`, and `lib.rs`'s recurring-apply task doesn't need `?` — see its own bullet below). Nothing else in any of these functions changes: the extracted `conn` is a genuine `&Connection`/`&mut Connection`, identical in every subsequent use to the `MutexGuard<Connection>` it replaces.
- `active_dataset_dir(app: &AppHandle)` (Story 33.1) keeps its exact signature; internally it now does `app.state::<DbState>().0.lock()...` and reads `.id` instead of the deleted static. Its existing callers (`backup.rs`, `import.rs`, `mod.rs::get_db_status`) need zero changes.
- `lib.rs`'s recurring-apply background task (the one non-`?`-context lock site, using `match state.0.lock() { Ok(conn) => ..., Err(e) => ... }`) gets the same guard, but degrades gracefully (log and skip, never panic) if `conn` is somehow `None` — defensively correct even though it is always `Some` in practice immediately after `select_dataset("default")` succeeds during the same `.setup()` call.

**Block If:** none — scope, sequencing, and every call site's transformation are fully specified; no decision here requires human input.

**Never:**
- Do not implement the picker, `list_datasets`, `create_dataset`, or any UI — out of scope (Stories 33.4/34.1).
- Do not add a new `AppError` variant — reuse `AppError::NotConfigured` (guard misses) and `AppError::Validation` (unknown dataset id passed to `select_dataset`).
- Do not change `datasets::dataset_dir`, `dataset_dir_from_root`, or `resolve_active_dir`'s logic — only their caller inside `active_dataset_dir` changes (the id source).
- Do not leave `ACTIVE_DATASET_ID`/`set_active_dataset_id`/`active_dataset_id()` behind in any form (not even `#[allow(dead_code)]`) — they are fully superseded, and Story 33.1's own Design Notes call this out by name.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/db/mod.rs` -- `pub struct DbState(pub Mutex<Connection>)` becomes `pub struct ActiveDataset { pub id: Option<String>, pub conn: Option<Connection> }` + `pub struct DbState(pub Mutex<ActiveDataset>)`. `init_db`/`open_configured`/`run_migrations` unchanged (still take/return a bare `Connection` — `select_dataset` wraps the result itself).
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- NEW. `pub(crate) fn select_dataset_now(app: &AppHandle, dataset_id: &str) -> Result<(), AppError>` (the reusable logic per the intent-contract's sequence) and the thin `#[tauri::command(rename_all = "snake_case")] pub fn select_dataset(app: AppHandle, dataset_id: String) -> Result<(), AppError>` wrapper. A private `#[derive(Serialize, Clone)] struct DatasetSwitchedPayload { dataset_id: String, kind: DatasetKind }` for the event.
- `apps/desktop/src-tauri/src/commands/mod.rs` -- add `pub mod datasets;`; register `commands::datasets::select_dataset` in `lib.rs`'s `generate_handler!` list.
- `apps/desktop/src-tauri/src/datasets.rs` -- delete `ACTIVE_DATASET_ID`, `set_active_dataset_id`, `active_dataset_id()`, and their one test (`set_active_dataset_id_is_what_the_getter_reports`). Add `pub(crate) fn load_registry(app: &AppHandle) -> Result<Vec<Dataset>, AppError>` (thin wrapper: `load_registry_entries(&registry_path(&global_root(app)?))`). Rewrite `active_dataset_dir` to read the id from `app.state::<DbState>()` instead of the deleted static; remove `#[allow(dead_code)]` from `dataset_dir` (it now has a real caller: `select_dataset_now`).
- `apps/desktop/src-tauri/src/lib.rs` -- in `.setup()`: remove the direct `init_db(&app_data_dir)` + `app.manage(DbState(Mutex::new(conn)))` pair and the deleted `set_active_dataset_id` call; instead `app.manage(DbState(Mutex::new(ActiveDataset { id: None, conn: None })))` runs once (before `bootstrap_registry`'s result is needed — order: `global_root` → `create_dir_all` → tracing init → `bootstrap_registry` → keyring init → `app.manage(DbState(...))` → `commands::datasets::select_dataset_now(&app_handle, datasets::DEFAULT_DATASET_ID).expect(...)`), then AI client init reads `&Connection` out of the now-populated `DbState` via one lock/extract instead of the raw `conn` variable. Import `db::ActiveDataset`. The recurring-apply task's `match state.0.lock() { Ok(conn) => ... }` block gains the same guard, degrading to a logged skip on `None` instead of calling the recurring functions.
- `apps/desktop/src-tauri/src/commands/{account,asset,backup,budget,budget_template,chat,danger_zone,dashboard,expense,financial_health,import,income,maintenance,mod,net_worth,onboarding,profile,projection,projects,recurring,recurring_income,retirement,settings,spending_trends,yearly_summary}.rs` -- every `state.0.lock()`/`db_state.0.lock()` call site (131 total across these 24 files + `mod.rs`'s `get_db_status`) gets the guard transformation below. Per-file counts (for coverage tracking, not a ceiling): `projects.rs` 19, `chat.rs` 13, `retirement.rs` 12, `maintenance.rs` 12, `income.rs` 10, `budget.rs` 10, `recurring.rs` 5, `net_worth.rs` 5, `expense.rs` 5, `asset.rs` 5, `account.rs` 5, `settings.rs` 4, `recurring_income.rs` 4, `import.rs` 3, `financial_health.rs` 3, `dashboard.rs` 3, `budget_template.rs` 3, `onboarding.rs` 2, `backup.rs` 2, `yearly_summary.rs` 1, `spending_trends.rs` 1, `projection.rs` 1, `profile.rs` 1, `danger_zone.rs` 1, `mod.rs` 1.

  **The transformation, canonical example (immutable — the overwhelming majority of sites):**
  ```rust
  // Before:
  let conn = state.0.lock().map_err(|e| AppError::Database {
      message: e.to_string(),
  })?;
  // Body below uses `conn` as &Connection (MutexGuard<Connection> Deref).

  // After:
  let active = state.0.lock().map_err(|e| AppError::Database {
      message: e.to_string(),
  })?;
  let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
  // Body below is UNCHANGED: `conn` is now a genuine &Connection.
  ```
  **Mutable variant (`commands/backup.rs::import_backup` is the one site needing this):**
  ```rust
  let mut active = db_state.0.lock().map_err(|e| AppError::Database {
      message: e.to_string(),
  })?;
  let conn = active.conn.as_mut().ok_or(AppError::NotConfigured)?;
  // conn: &mut Connection — existing `&mut *conn` call sites re-borrow it fine, unchanged.
  ```
  The locked variable's name may be `state` or `db_state` per file; the extracted variable is always named `conn` (matching every site's existing convention) so nothing downstream in the function body needs touching.

## Tasks & Acceptance

**Execution:**
- `apps/desktop/src-tauri/src/db/mod.rs` -- add `ActiveDataset`, change `DbState` -- the one struct every other change in this story depends on.
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- create `select_dataset_now`/`select_dataset` -- the locked hot-swap itself (AD-6a/AD-6b).
- `apps/desktop/src-tauri/src/datasets.rs` -- delete the Story 33.1 shim, add `load_registry`, re-point `active_dataset_dir` -- retires the temporary static exactly as Story 33.1's Design Notes specified.
- `apps/desktop/src-tauri/src/commands/mod.rs` -- register the new module and command.
- `apps/desktop/src-tauri/src/lib.rs` -- rewire `.setup()` to manage empty `DbState` then call `select_dataset_now("default")`, fix the AI-init connection source, guard the recurring-apply task -- preserves today's exact zero-user-action startup while exercising the real hot-swap path.
- All 25 `commands/*.rs` files listed in the Code Map -- apply the canonical guard transformation to every `state.0.lock()`/`db_state.0.lock()` site -- makes the `AppError::NotConfigured` guarantee real everywhere a connection is touched, not just in the new code.
- `apps/desktop/src-tauri/src/commands/datasets.rs` and `apps/desktop/src-tauri/src/db/mod.rs` -- unit tests per the I/O matrix below.

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No dataset selected | Fresh `ActiveDataset { id: None, conn: None }`, any guarded call site | — | Returns `AppError::NotConfigured` |
| Valid id, first selection | `select_dataset_now(app, "default")` on a freshly-managed empty `DbState` | Directory resolved+opened+migrated, `id`/`conn` set together, `dataset:switched` emitted | No error expected |
| Valid id, later switch | `select_dataset_now(app, <other-registered-id>)` with a dataset already active | Old connection replaced atomically with the new one; event carries the new id/kind | No error expected |
| Unknown id | `select_dataset_now(app, "does-not-exist")` | Previous active state (if any) is completely untouched — the lock is never acquired, since the registry lookup fails first | Returns `AppError::Validation` |
| Directory open/migrate failure | `select_dataset_now` where `db::init_db(&dir)` fails (e.g. unreadable/corrupt db file) | Previous active state is completely untouched — the lock is never acquired | Propagates the underlying `AppError` |

**Acceptance Criteria:**
- Given the app has just started and no dataset has been selected, when any guarded command runs against a `DbState` whose `conn` is `None`, then it returns `AppError::NotConfigured` rather than silently proceeding.
- Given a valid `dataset_id` from the registry, when `select_dataset` is called, then the target directory is resolved and its database opened+migrated before the `DbState` lock is ever acquired, and only on success are `id` and `conn` swapped together as one atomic step.
- Given any failure during `select_dataset`'s resolve/open/migrate phase, when it occurs, then the previous active dataset (or "none") is left completely untouched and the error is returned.
- Given `select_dataset` succeeds, when it returns, then a `dataset:switched { dataset_id, kind }` event has been emitted, including on the very first selection of a run.
- Given the app starts today (single Default dataset, no other change), when `.setup()` runs, then `select_dataset_now(app, "default")` succeeds and the app's observable behavior (dashboard renders with existing data, AI client initializes, recurring items apply) is unchanged from before this story.
- Given the full Rust test suite, when it runs after this change, then every test passes except `datasets::tests::set_active_dataset_id_is_what_the_getter_reports`, which is deleted alongside the static it tested (an intentional removal, not a regression).
- Given `cargo build`, when it runs, then it produces zero warnings.

## Design Notes

This story's size is in its *breadth* (131 call sites), not its depth — the transformation at each site is the single canonical substitution shown in the Code Map, and the body of every affected function is otherwise untouched, since `Option<Connection>::as_ref()`/`as_mut()` yields the exact same `&Connection`/`&mut Connection` type the old `MutexGuard<Connection>` Deref'd to. Given the volume, a scripted pass (e.g. a small Python/regex transformation matching `let (mut )?conn = (\w+)\.0\.lock\(\)\.map_err\(...\)\?;` inside files that `use crate::db::DbState`, inserting the extraction line after) is likely faster and less error-prone than 131 manual edits — but the ground truth is `cargo build` (0 warnings) and `cargo test` (all pass), regardless of method. Do not touch any `.0.lock()` site in `auth.rs`, `auth_listener.rs`, or the `AiState` mutex — those guard `PendingLogin`/`LoopbackListener`/`AiState`, not `DbState`, and are out of scope.

`select_dataset_now` takes `&AppHandle` (not `State<DbState>`) so `lib.rs`'s `.setup()` closure — which only has `&mut App`/a cloned `AppHandle`, never a Tauri-injected `State<T>` — can call it identically to how the `#[tauri::command]` wrapper does; both fetch `DbState` via `app.state::<DbState>()` internally.

The registry lookup inside `select_dataset_now` is not scope creep: `dataset:switched`'s payload requires `kind`, which only the registry has, so validating the id against the registry is a direct consequence of building that payload correctly — not an independently-added feature.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings
- `cd apps/desktop/src-tauri && cargo test` -- expected: all tests pass except the one intentionally-deleted test named in the Acceptance Criteria
- `grep -rn "ACTIVE_DATASET_ID\|set_active_dataset_id\|active_dataset_id\b" apps/desktop/src-tauri/src/` -- expected: empty (fully removed)
- `grep -rn "\.0\.lock()" apps/desktop/src-tauri/src/commands/*.rs apps/desktop/src-tauri/src/lib.rs` -- manually inspect: every remaining hit either guards `DbState` via the new `.conn.as_ref()/.as_mut()` pattern, or belongs to a non-`DbState` mutex (`PendingLogin`, `LoopbackListener`, `AiState`) — spot-check a sample from each of the 25 files in the Code Map

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (medium 2, low 1)
- defer: 20 (all correctly assigned to Stories 33.4/33.5/34.1/34.2/35.2/35.3, or unreachable until `select_dataset` gains a real UI trigger)
- reject: 12 (several were confirmed false positives against the actual code: `init_db` already creates its target directory; `DbState`'s non-recovering poison handling predates this entire epic and is unchanged; the "double reference" pattern already existed via `MutexGuard`'s `Deref`; `backup.rs` already resolves via `active_dataset_dir`, not `global_root`; atomic-rename already makes unlocked registry reads safe)
- addressed_findings:
  - `[medium]` `[patch]` `active_dataset_dir` now internally locks `DbState`; nothing documented that calling it while already holding that same guard deadlocks (`std::sync::Mutex` is not reentrant). Verified all 4 current callers are safe today, but added an explicit doc-comment warning — this exact hazard is already called out by name in the epic's own AD-5 notes, which the Code Map should have carried forward.
  - `[medium]` `[patch]` The hot-swap's entire safety argument ("open+migrate before the lock, so a failure leaves the previous dataset untouched") was asserted only in a doc comment, unverified by any test. Extracted `swap_active(&Mutex<ActiveDataset>, id, conn)` (no `AppHandle` needed) and added 3 tests, including one demonstrating a failure before the swap leaves prior state untouched. Mutation-tested: reverting the fix to an id-only assignment makes 2 of the 3 new tests fail, confirming they bite.
  - `[low]` `[patch]` `lib.rs` lost its ordering-dependency comment when the old shim's was removed; added a replacement noting `select_dataset_now` depends on `bootstrap_registry` having already run.

## Auto Run Result

**Summary:** `DbState` becomes `Mutex<ActiveDataset { id, conn }>` — both fields swap together, never independently (AD-6). Added `select_dataset`/`select_dataset_now` (new `commands/datasets.rs`): resolves the target directory and opens+migrates its database *before* acquiring the lock, so any failure leaves the previous dataset provably unchanged; only on success does it atomically swap `id`+`conn` and emit `dataset:switched { dataset_id, kind }`. Every one of the 131 `DbState` lock sites across 24 command files + `mod.rs` gained the `AppError::NotConfigured` guard. Story 33.1's temporary `ACTIVE_DATASET_ID` shim is deleted outright, exactly as its own Design Notes specified; `active_dataset_dir` now reads the id from `DbState` via `app.state::<DbState>()`, with no signature change for its 4 existing callers. `lib.rs`'s startup auto-selects `"default"` through this same real hot-swap path, preserving today's zero-user-action launch with no observable behavior change. One review pass found no bad_spec/intent_gap and closed 3 patches: a documented (not yet enforceable) deadlock hazard, a genuinely tested core-safety-claim gap (mutation-verified), and a comment.

**Files changed:**
- `apps/desktop/src-tauri/src/db/mod.rs` — `ActiveDataset` struct, `DbState(Mutex<ActiveDataset>)`; 3 tests.
- `apps/desktop/src-tauri/src/commands/datasets.rs` (new) — `select_dataset_now`/`select_dataset`, `find_registered`, `swap_active`; 7 tests.
- `apps/desktop/src-tauri/src/datasets.rs` — deleted the Story 33.1 shim + its test; added `load_registry`; re-pointed `active_dataset_dir`; removed `dataset_dir`'s `#[allow(dead_code)]` (now has a real caller).
- `apps/desktop/src-tauri/src/commands/mod.rs` — registers `datasets` module; `get_db_status` guarded.
- `apps/desktop/src-tauri/src/lib.rs` — `.setup()` manages an empty `DbState`, then calls `select_dataset_now("default")`; AI-client init and the recurring-apply background task both read through the new guard.
- 24 further `commands/*.rs` files — every `state.0.lock()`/`db_state.0.lock()` site guarded (131 sites total, independently audited 1:1 across all 25 files by the orchestrator both before and after the patch round).

**Review findings breakdown:** bad_spec: 0, patch: 3 (all applied and one mutation-verified), defer: 20 (AiState re-derivation on switch → Story 34.2; concurrent-access tearing on `get_db_status`/`export_backup`/recurring-apply → unreachable until `select_dataset` has a real caller beyond startup, then Stories 33.4/33.5's job; cross-entry registry invariants, cloud-linked auth coherence, non-default directory pre-creation → Stories 34.1/35.2/35.3; `ActiveDataset` as an enum instead of two `Option`s, a shared `.conn()` accessor replacing the 131 inline guards → valid future hardening, deliberately not attempted this pass given the risk of re-touching 131 already-verified-correct sites for a stylistic gain), reject: 12 (false positives against the real code, listed above).

**Follow-up review recommendation:** `true` — this pass's patch severities (2 medium, 1 low) score `3×2 + 1×1 = 7`, past the "5 or more" threshold.

**Verification performed:**
- `cargo build` — exit 0, zero warnings (re-run independently after implementation and after the patch round)
- `cargo test` — 713 passed, 0 failed, including `wipe_list_covers_every_table_in_the_schema` and all `db::tests::*`/`commands::datasets::tests::*`; the one intentionally-deleted test (`set_active_dataset_id_is_what_the_getter_reports`) confirmed gone
- `grep -rn "ACTIVE_DATASET_ID\|set_active_dataset_id\|active_dataset_id\b" src/` — empty, re-run independently after every round
- Per-file lock/guard audit (independently re-run by the orchestrator, not just trusted from the implementer): all 25 `commands/*.rs` files show `.0.lock()` count == `.conn.as_ref()/.as_mut()` guard count, 131/131, zero mismatches
- Matrix Test Audit: rows 1 (no dataset selected) and 4/5 (unknown id / open failure leaves state untouched) are covered by real tests; rows 2/3 (valid selection, later switch) require a live `AppHandle` this repo has no test harness for — covered instead by the extracted `swap_active` helper's tests, which prove the atomicity claim without one

**Residual risks (deferred, not blocking):**
- `active_dataset_dir`'s deadlock hazard is now documented but not structurally enforced — a future command holding `DbState`'s guard and calling it will still hang silently. A signature change (e.g. accepting an already-resolved id) would enforce it but was explicitly out of scope this story.
- `AiState` is not re-derived when the active dataset switches — inert today since only one dataset (`"default"`) can ever exist until Story 34.1/34.2 land; will need addressing before per-profile AI credentials go live.
- `AppError::NotConfigured`'s user-facing message is still AI-specific — unreachable today (`.setup()` always selects a dataset before any command runs) but becomes reachable once a picker can leave `DbState` unselected (Story 33.4).
