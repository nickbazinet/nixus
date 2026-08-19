---
title: 'Dataset registry with bootstrap migration to Default'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'bd2714896ea4b588cd4e51b420a4d5c9767a67a2'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `datasets.json` — the sole source of truth for which local/cloud-linked profiles exist (AD-3) — doesn't exist yet. Story 33.3's `select_dataset` and Story 33.4's picker both depend on reading it; today's single-dataset users must be recognized as a "Default" entry with zero files moved, the first time they launch after this ships.

**Approach:** Add a `Dataset`/`DatasetKind` model (`models/mod.rs`) and a registry layer in `datasets.rs`: a bootstrap function that creates `datasets.json` with exactly one Default entry when the file is missing, and a loader that re-validates every entry's id on read, called once from `lib.rs`'s `.setup()` before any UI renders (AD-4). No `select_dataset`, no picker, no new registry entries beyond Default, no Tauri command — those are Stories 33.3/33.4/34.1/35.2.

## Boundaries & Constraints

**Always:**
- `datasets.json` lives at `global_root()` (per Story 33.1's `datasets::global_root`), written only through the existing `json_store::write_json_atomic` helper.
- Bootstrap is idempotent and safe on both the upgrade path (an existing `nkbaz-finance.db` already at the root) and a fresh install (no `nkbaz-finance.db` yet) — both produce the identical single Default entry, since bootstrap never inspects `nkbaz-finance.db` at all. Zero files are ever moved, copied, or renamed by this story.
- The Default entry is exactly `{ id: "default", label: "Default", kind: "local", cognito_sub: null, linked_from: null, is_default: true, created_at: <RFC3339 now> }`.
- A registry file that exists but fails to parse is a hard error, surfaced by letting it propagate to lib.rs's `.expect(...)` (the same crash-on-startup pattern already used for `init_db`/`app_data_dir` failures in that closure) — it must never be silently overwritten with a fresh bootstrap, which would orphan every non-default dataset already recorded in it.
- Every registry read re-validates each entry's `id` against the filesystem-safe charset already established by `profile_store::validate_sub` (ASCII alphanumeric or `-`, 1–128 chars); an entry that fails validation is skipped and logged via `tracing::warn!`, never fatal to the rest of the load.
- All registry I/O (the existence check, the read, and the bootstrap write) is serialized through one dedicated in-process `Mutex` held for the full operation — a distinct lock from Story 33.1's `ACTIVE_DATASET_ID` lock (AD-3's registry lock and AD-6's active-dataset lock are never the same lock).
- Split pure/impure exactly as Story 33.1 did for `dataset_dir`/`dataset_dir_from_root`: a `Path`-based `bootstrap_registry_at(root)` holds 100% of the logic and is unit-testable with a tempdir; the `AppHandle`-taking `bootstrap_registry(app)` is a one-line wrapper.

**Block If:** none — scope, schema, and behavior are fully specified by the epic/story text; no decision here requires human input.

**Never:**
- Do not implement `select_dataset`, the picker route, or any command that mutates the registry beyond the one bootstrap write — out of scope (Stories 33.3/33.4/34.1/35.2).
- Do not create, or make it possible to create, a second entry with `id == "default"` or `is_default: true` — this story only ever writes the single bootstrap entry.
- Do not add a new `AppError` variant — reuse `AppError::File` for every I/O/parse failure, matching `json_store.rs`'s and `profile_store.rs`'s existing convention.
- Do not expose any Tauri command (`list_datasets`, etc.) — Story 33.4's job.
- Do not touch `nkbaz-finance.db` or any other file — this story only ever reads/writes `datasets.json`.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/models/mod.rs` -- NEW structs `Dataset` and `DatasetKind` (append near the file's end, before the `#[cfg(test)]` module, matching this file's existing append-only convention). `Dataset { id, label, kind: DatasetKind, cognito_sub: Option<String>, linked_from: Option<String>, is_default: bool, created_at: String }`, all `pub`, `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`. `DatasetKind` is `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)] #[serde(rename_all = "kebab-case")] pub enum DatasetKind { Local, CloudLinked }` — serializes to exactly `"local"`/`"cloud-linked"` per AD-3's schema.
- `apps/desktop/src-tauri/src/datasets.rs` -- add: `REGISTRY_FILE_NAME` const, `REGISTRY_LOCK: Mutex<()>` static (distinct from `ACTIVE_DATASET_ID`), `registry_path(root) -> PathBuf`, `is_valid_dataset_id(id: &str) -> bool` (mirrors `profile_store::validate_sub`'s charset, no length-based PII concern since ids aren't sensitive), `default_dataset_entry() -> Dataset`, `load_registry_entries(path: &Path) -> Result<Vec<Dataset>, AppError>` (parses + filters invalid ids, private, directly unit-testable), `bootstrap_registry_at(root: &Path) -> Result<Vec<Dataset>, AppError>` (private, holds `REGISTRY_LOCK` for the full read-or-create, directly unit-testable with a tempdir), `pub(crate) fn bootstrap_registry(app: &AppHandle) -> Result<Vec<Dataset>, AppError>` (thin wrapper: `bootstrap_registry_at(&global_root(app)?)`). Import `crate::models::{Dataset, DatasetKind}`, `crate::json_store::write_json_atomic`, `chrono::Utc`.
- `apps/desktop/src-tauri/src/lib.rs` -- in `.setup()`, right after the existing `datasets::set_active_dataset_id(datasets::DEFAULT_DATASET_ID);` line and before `std::fs::create_dir_all(&app_data_dir)`, add `datasets::bootstrap_registry(&app_handle).expect("dataset registry is corrupt or unreadable");` — matches the closure's existing `.expect(...)`-on-hard-failure convention (AD-4: must run before any UI renders).
- `apps/desktop/src-tauri/src/json_store.rs` -- read-only reference: reused as-is (`write_json_atomic`), no changes.
- `apps/desktop/src-tauri/src/profile_store.rs:106-121` -- read-only reference: `validate_sub`'s charset allow-list pattern, mirrored (not called directly — dataset ids and Cognito subs are different domains) by `datasets::is_valid_dataset_id`.

## Tasks & Acceptance

**Execution:**
- `apps/desktop/src-tauri/src/models/mod.rs` -- add `Dataset`/`DatasetKind` -- the registry's one wire schema, reused by every future story that reads or writes it.
- `apps/desktop/src-tauri/src/datasets.rs` -- add the registry lock, path helper, id validator, default-entry constructor, `load_registry_entries`, `bootstrap_registry_at`, `bootstrap_registry` -- the create/read half of AD-3, split pure/impure exactly like Story 33.1's `dataset_dir`.
- `apps/desktop/src-tauri/src/lib.rs` -- call `datasets::bootstrap_registry` in `.setup()`, after marking `"default"` active and before the data-dir/log-appender setup -- guarantees `datasets.json` exists (or hard-fails visibly) before any UI renders, per AD-4.
- `apps/desktop/src-tauri/src/datasets.rs` -- unit tests for `bootstrap_registry_at` and `load_registry_entries` -- covers the I/O matrix below with a tempdir, no Tauri app context, no shared global state (registry tests use a fresh tempdir per test, unlike Story 33.1's `ACTIVE_DATASET_ID` static).

**I/O & Edge-Case Matrix**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing registry (upgrade or fresh install) | `bootstrap_registry_at(root)`, `root/datasets.json` absent | Creates `datasets.json` with exactly one Default entry; returns `vec![default]`; any pre-existing sibling file (e.g. `nkbaz-finance.db`) in `root` is untouched | No error expected |
| Existing valid registry | `bootstrap_registry_at(root)`, `root/datasets.json` present with real (non-Default) entries | File content is unchanged byte-for-byte; returns exactly those entries | No error expected |
| Corrupt registry | `bootstrap_registry_at(root)`, `root/datasets.json` present but not valid JSON/shape | File is left completely unmodified | Returns `Err(AppError::File)` |
| Entry with an invalid id | `load_registry_entries(path)`, one entry's `id` contains `/` or is empty | That entry is skipped (logged via `tracing::warn!`); every other valid entry is still returned | No error expected (partial success) |

**Acceptance Criteria:**
- Given `datasets.json` does not yet exist (with or without a pre-existing `nkbaz-finance.db` at the root), when the app starts, then `datasets.json` is created at `global_root()` with exactly one entry (`id: "default"`, `label: "Default"`, `kind: "local"`, `is_default: true`, `cognito_sub: null`, `linked_from: null`, `created_at`) and zero files are moved, copied, or renamed.
- Given `datasets.json` exists but fails to parse, when the app starts, then a hard, user-visible error is surfaced (via `lib.rs`'s existing `.expect()` startup-failure convention) and the file is never silently recreated.
- Given any create/read against `datasets.json`, when it happens, then it goes through the single `REGISTRY_LOCK` mutex (distinct from `ACTIVE_DATASET_ID`), and every entry's `id` is re-validated against the filesystem-safe charset on read, skipping (and logging) any entry that fails validation rather than failing the whole load.
- Given the full existing Rust test suite (including `wipe_list_covers_every_table_in_the_schema` and Story 33.1's `datasets::tests::*`), when it runs after this change, then it passes unmodified.
- Given `cargo build`, when it runs, then it produces zero warnings (project compilation-warnings policy).

## Design Notes

`bootstrap_registry_at`/`load_registry_entries` follow Story 33.1's established pure/wrapper split precisely: the `Path`-based functions hold 100% of the branching and are tested with `tempfile::TempDir` (matching `profile_store.rs`'s and `commands/backup.rs`'s existing test convention — not the string literal `/tmp/...` style Story 33.1's own tests used, since these tests perform *real* file I/O and need a real, cleaned-up directory), while `bootstrap_registry(app)` is the one-line `AppHandle` wrapper with no independently-testable logic.

`REGISTRY_LOCK: Mutex<()>` deliberately guards nothing but the *sequence* of operations (existence check → read-or-create) — there is no payload to poison-recover differently from Story 33.1's `ACTIVE_DATASET_ID`, so the same `.lock().unwrap_or_else(|p| p.into_inner())` pattern applies verbatim.

`is_valid_dataset_id` intentionally does not call `profile_store::validate_sub` directly — the two are different domains validating against an overlapping charset for different reasons (Cognito subs are opaque identity keys; dataset ids are filesystem directory names) — and the charset it enforces (ASCII alphanumeric + `-`, 1–128 chars) is deliberately a *strict subset* of `validate_sub`'s, which additionally allows `_`. The two are therefore not identical; the narrower set is the correct one here because a dataset id becomes a filesystem path component, and excluding `.`, `/` and `\` is what stops a hand-edited `..` or `a/b` from escaping the app data root. Windows/macOS/Linux all agree on this safe subset.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: exit 0, zero warnings
- `cd apps/desktop/src-tauri && cargo test` -- expected: all tests pass, including `wipe_list_covers_every_table_in_the_schema`, Story 33.1's existing `datasets::tests::*`, and the new registry tests
- `grep -rn "datasets.json" apps/desktop/src-tauri/src/` -- expected: only `datasets.rs` references the literal filename (single source of truth for the path)

## Review Triage Log

### 2026-08-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (medium 2, low 2)
- defer: 16 (medium 5, low 11)
- reject: 13 (including 3 findings traced to a transcription error in the reviewed-diff text, not the real code — verified false against the actual file)
- addressed_findings:
  - `[medium]` `[patch]` `bootstrap_registry` ran before `tracing_subscriber::fmt().init()` in `lib.rs`, so `warn!()` calls for skipped registry entries never reached the log file — violated the AC's "logging" clause in real production behavior. Moved the call to immediately after tracing init; still well before `init_db`/window creation (AD-4 intact).
  - `[medium]` `[patch]` No test exercised the literal "fresh install" scenario (root directory not yet created) — all 13 original tests used an already-existing `TempDir`. Added `bootstrapping_creates_the_root_directory_when_it_does_not_exist_yet`.
  - `[low]` `[patch]` `is_valid_dataset_id`'s comment claimed excluding `.` "keeps `json_store`'s `with_extension` temp-path scheme correct" — factually wrong for this code path (dataset ids never become part of `datasets.json`'s own filename). Reworded to the real rationale: preventing `..`/`/`/`\` path traversal when the id becomes a directory component.
  - `[low]` `[patch]` The comment and this spec's Design Notes both claimed the id charset is "identical" to `profile_store::validate_sub`'s — false, since `validate_sub` additionally allows `_`. Both reworded to state the accurate "strict subset" relationship.

## Auto Run Result

**Summary:** Implemented the dataset registry's create/read/bootstrap layer (`datasets.json`, AD-3/AD-4): a `Dataset`/`DatasetKind` model, a bootstrap function that creates the registry with exactly one Default entry when missing and otherwise leaves an existing registry byte-for-byte untouched, id re-validation on read that skips (and now correctly logs) invalid entries without failing the whole load, and a hard-error path for a corrupt registry. Wired into `lib.rs`'s `.setup()` before any UI renders. No `select_dataset`, no picker, no Tauri command, no new dependency (Stories 33.3/33.4/34.1/35.2's job). One review pass found no bad_spec/intent_gap issues and closed 4 low/medium patches (a real logging-visibility bug, a genuine test-coverage gap for the fresh-install path, and two comment/doc accuracy fixes).

**Files changed:**
- `apps/desktop/src-tauri/src/models/mod.rs` — new `Dataset` struct and `DatasetKind` enum (`#[serde(rename_all = "kebab-case")]` → `"local"`/`"cloud-linked"` on the wire).
- `apps/desktop/src-tauri/src/datasets.rs` — new `REGISTRY_LOCK` (distinct from Story 33.1's `ACTIVE_DATASET_ID`), `registry_path`, `is_valid_dataset_id`, `default_dataset_entry`, `load_registry_entries`, `bootstrap_registry_at` (pure, tempdir-testable), `bootstrap_registry` (thin `AppHandle` wrapper); 14 new unit tests.
- `apps/desktop/src-tauri/src/lib.rs` — calls `datasets::bootstrap_registry` in `.setup()`, positioned after tracing init and before `init_db`.

**Review findings breakdown:**
- bad_spec: 0, patch: 4 (all applied), defer: 16 (registry-wide invariant checks — duplicate/missing-default/multi-default entries, case-insensitive/Windows-reserved id collisions, schema-version field, per-field `#[serde(default)]` forward-compat, cross-field `kind`/`cognito_sub` coherence, file permissions, `path.exists()` vs `try_exists()` — all correctly deferred to whichever future story first writes a second entry or depends on the invariant: 33.3's `select_dataset`, 34.1's `create_dataset`, or 35.2/35.3's cloud-linked entries), reject: 13 (3 were false positives caused by a transcription error in the text I pasted into the review prompts, not the actual code — verified directly against the real file, which built and tested clean throughout; the rest matched pre-existing, already-accepted codebase precedent or don't apply to a local single-user desktop app's threat model).

**Follow-up review recommendation:** `true` — this pass's patch severities (2 medium, 2 low) score `3×2 + 1×2 = 8`, well past the "5 or more" threshold.

**Verification performed:**
- `cargo build` — exit 0, zero warnings (independently re-run after implementation and after the patch round)
- `cargo test` — 704 passed, 0 failed, including `wipe_list_covers_every_table_in_the_schema` unmodified, Story 33.1's 5 pre-existing `datasets::tests::*`, and all 14 new registry tests (including the post-patch fresh-install-directory test)
- `grep -rn "datasets.json" apps/desktop/src-tauri/src/` — confined to `datasets.rs`, independently re-run after every round
- Matrix Test Audit: all 4 I/O-matrix rows (missing registry, existing valid registry, corrupt registry, entry with invalid id) are covered by name-matching tests and ran green above

**Residual risks (deferred, not blocking):**
- The registry's on-disk shape is a bare JSON array with no schema-version field — a later story introducing a breaking format change has nowhere to hang a migration.
- No cross-entry invariants are enforced on read (duplicate ids, more/fewer than one `is_default: true` entry) — unreachable in this story since bootstrap only ever writes a single, internally-consistent entry; becomes load-bearing once a future story writes a second entry.
- `is_valid_dataset_id` is case-sensitive on a filesystem that (on default macOS/Windows configurations) is not — theoretical today since the only id this story ever produces is the lowercase literal `"default"`; Story 34.1's UUID generation will naturally stay lowercase, but registry-write validation should keep this in mind if a future story ever accepts a hand-typed id.
