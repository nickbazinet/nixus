# Story 28.4: Wiping my data removes my profile too

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user who has asked to delete all my data,
I want my profile deleted along with everything else,
so that "delete all data" means what it says.

## Acceptance Criteria

1. **Given** I have a saved profile
   **When** I run the danger-zone delete-all-data action
   **Then** my profile document is gone from disk

2. **Given** the profiles directory contains `.json`, `.json.corrupt`, and `.json.tmp` files
   **When** delete-all runs
   **Then** the entire `profiles/` directory is removed recursively
   **And** no leftover file of any extension survives

3. **Given** the profiles directory does not exist
   **When** delete-all runs
   **Then** it succeeds rather than erroring

4. **Given** `delete_all_data` needs the app data directory
   **When** its signature is changed to accept `app: AppHandle`
   **Then** the frontend's `invoke("delete_all_data")` call is unchanged, because Tauri injects the handle
   **And** any existing Rust test or direct caller of that function is located and updated

5. **Given** the profile store is invisible to `danger_zone`'s table-coverage test
   **When** the story is complete
   **Then** a dedicated test asserts the profiles directory is absent or empty after delete-all
   **And** deletion is performed by `profile_store::delete_all_profiles`, not by `danger_zone` touching the filesystem itself

6. **Given** I export a backup and restore it on another machine
   **When** the restore completes
   **Then** no profile data travelled with the backup, and my local profile is untouched

## Tasks / Subtasks

- [x] **Task 1 — Implement `delete_all_profiles` in `apps/desktop/src-tauri/src/profile_store.rs`** (AC: #2, #3, #5)
  - [x] Add `pub fn delete_all_profiles(dir: &Path) -> Result<(), AppError>` alongside the existing `load_profile` / `save_profile` / `profiles_dir` free functions from Story 28.2. Same shape: takes the profiles directory explicitly, never resolves `app_data_dir` itself, so it is unit-testable against a `tempfile::TempDir`.
  - [x] Body is `std::fs::remove_dir_all(dir)`. **NOT** `read_dir` + a `*.json` filter, **NOT** `glob`, **NOT** `remove_file` per entry. See Dev Notes → "Why recursive, not a `.json` glob".
  - [x] Treat "already absent" as success: match on the error and return `Ok(())` when `e.kind() == std::io::ErrorKind::NotFound`. Every other IO error maps to `AppError::File { message: format!("Failed to delete profiles directory: {}", e) }` (D13 — reuse `File`, add no `AppError` variant).
  - [x] No `.unwrap()`, no `panic!`, no `console.log`/`println!`. `tracing` only if you log at all.

- [x] **Task 2 — Give `delete_all_data` an `AppHandle` and call the store** (AC: #1, #2, #3, #4, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/danger_zone.rs`, change line 1 from `use tauri::State;` to `use tauri::{AppHandle, Manager, State};`. `Manager` is required for `app.path()` — see `commands/backup.rs:5` and `commands/maintenance.rs:3` for the identical import triple.
  - [x] Change the signature to `pub fn delete_all_data(app: AppHandle, state: State<DbState>) -> Result<(), AppError>`. Keep it **synchronous** — do not make it `async`; nothing in this change awaits.
  - [x] Keep `#[tauri::command(rename_all = "snake_case")]` exactly as is.
  - [x] Resolve the directory inline with the same `map_err` used at `commands/backup.rs:30-35`: `app.path().app_data_dir().map_err(|e| AppError::File { message: format!("Failed to resolve app data dir: {}", e) })?`. Do **not** reach for `commands/maintenance.rs::resolve_app_data_dir` — it is private to that module and must not be made `pub` for a three-line helper.
  - [x] Add `use crate::profile_store;` and call `profile_store::delete_all_profiles(&profile_store::profiles_dir(&app_data_dir))?` as the **last statement before `Ok(())`**, after the existing non-fatal `reclaim_space` block. Ordering rationale and lock-safety in Dev Notes → "Where the call goes".
  - [x] Propagate with `?` — do **not** wrap it in `if let Err(e) = … { warn!(…) }` like `reclaim_space`. NFR4 requires the caller to learn that PII survived. See Dev Notes → "Failure handling is not best-effort".
  - [x] `danger_zone.rs` must contain **zero** `std::fs` calls and must not build `app_data_dir.join("profiles")` by hand — the path comes from `profile_store::profiles_dir`, and all IO stays inside `profile_store`.
  - [x] Do **not** touch `apps/desktop/src-tauri/src/db/danger_zone.rs`. `WIPE_TABLES` and `PRESERVED_TABLES` stay byte-identical; the profile store is not a SQLite table.

- [x] **Task 3 — Confirm every caller of `delete_all_data` and update only what actually needs it** (AC: #4)
  - [x] `apps/desktop/src-tauri/src/lib.rs:239` — `commands::danger_zone::delete_all_data,` inside `tauri::generate_handler!`. **No change.** The macro names the function; the `#[tauri::command]` expansion derives injection from the signature.
  - [x] `apps/desktop/src/components/settings/DangerZone.tsx:80` — `await invoke("delete_all_data");`. **No change.** `AppHandle` is injected by Tauri and is never serialized from the webview; there is no argument object to add a key to.
  - [x] Rust tests calling `delete_all_data`: **none exist.** `commands/danger_zone.rs` has no `#[cfg(test)] mod tests`; the tests in `db/danger_zone.rs` exercise `wipe_all` / `reclaim_space` directly. Verify with `rg -n 'delete_all_data' apps/desktop/src-tauri/` and record the result — do not invent a caller to "fix".
  - [x] Playwright specs referencing `delete_all_data`: **none exist.** There is no `settings.spec.ts` and no spec mocks the command. Verify with `rg -n 'delete_all_data|danger-zone|DangerZone' apps/desktop/tests/`.
  - [x] Confirm no spec regression from the mounted UI: `tests/ai-navigation.spec.ts:66,74` navigate to `/settings` and `tests/budget-templates.spec.ts:140` to `/settings/ai-provider?section=data`, so `DangerZone` mounts in all three. It invokes only inside `handleExportBackup` / `handleDelete` on user click, never on mount, so no Tauri-mock case is required (the `project-context.md:295` always-mounted-`invoke` trap does not apply). **No spec changes.**
  - [x] `apps/desktop/src/components/settings/DangerZone.tsx` needs no locale, copy, or UI change: the wiped surface list is already generic and the profile is not named in `settings.dangerZoneDeletedList`. Do not add i18n keys in this story.

- [x] **Task 4 — Mandatory dedicated test in `profile_store.rs`'s `#[cfg(test)] mod tests`** (AC: #2, #3, #5)
  - [x] Follow the `db/backup.rs:132-136` pattern verbatim: `#[cfg(test)] mod tests { use super::*; use tempfile::TempDir; … }` with `let dir = TempDir::new().expect("temp dir");`. `tempfile = "3"` is already a plain dependency at `Cargo.toml:34` — do **not** move it to `[dev-dependencies]` and do **not** edit `Cargo.toml` at all.
  - [x] Test A — `delete_all_profiles_removes_every_extension`: seed the profiles dir with **four** files: `<sub>.json`, `<sub>.json.corrupt`, `<sub>.json.tmp`, and one nested `sub-dir/orphan.json`. Call `delete_all_profiles`. Assert **`!dir.exists() || std::fs::read_dir(&dir).unwrap().next().is_none()`** — the directory is absent or empty.
  - [x] **The assertion must not be "no `.json` files remain".** A test that only counts `*.json` passes against the exact buggy implementation this story exists to prevent. Asserting absent-or-empty is the whole point of the test.
  - [x] Test B — `delete_all_profiles_is_ok_when_directory_absent`: point at a `TempDir` subpath that was never created, call `delete_all_profiles`, assert `is_ok()`. Call it twice to prove idempotence.
  - [x] Do not attempt to unit-test `delete_all_data` itself. `tauri = { version = "2.11", features = [] }` (`Cargo.toml:21`) — the `test` feature is off, so `tauri::test::mock_app()` / `MockRuntime` is unavailable, and enabling it would be a forbidden `Cargo.toml` change. The command layer is thin orchestration and is covered by Task 5's manual verification.

- [x] **Task 5 — Verify the backup/restore claim end to end, by hand** (AC: #1, #6)
  - [x] Run `pnpm --filter @nixus/desktop tauri dev`. Sign in, save a profile at `/profile`, and confirm `app_data_dir/profiles/<sub>.json` exists on disk.
  - [x] Export a backup via Settings → Danger Zone → "Export backup" (or the sidebar backup action). Open the resulting `.db` and confirm it holds **no** profile values — no table, no `audit_log` row (D10 means no audit entry is ever written for a profile mutation). Confirm the exported artifact is a single `.db` file with no `profiles/` payload beside it.
  - [x] Import/restore that backup. Confirm `app_data_dir/profiles/<sub>.json` is **still present and unchanged** (compare bytes or mtime+content) — `restore_from_file` swaps only `nkbaz-finance.db` and its `-wal`/`-shm` sidecars.
  - [x] Then run Danger Zone → type-to-confirm → delete all data. Confirm `app_data_dir/profiles/` no longer exists, and that the app relaunches into an empty state as before.
  - [x] Repeat the delete with `.json.corrupt` and `.json.tmp` files planted in `profiles/` beforehand; confirm they are gone too.
  - [x] Record the outcomes in Completion Notes. Do **not** modify `export_backup`, `restore_from_file`, or `test_backup_copy_produces_identical_file` — this task verifies a structural property, it does not create one.

- [x] **Task 6 — Quality gates** (AC: all)
  - [x] `cargo build` and `cargo clippy` in `apps/desktop/src-tauri/` produce **zero** warnings (`docs/guidelines/warnings.md`, project rule 9). No unused imports left behind by the `use tauri::…` edit.
  - [x] `cargo test` passes, including the pre-existing `db/danger_zone.rs` suite — `wipe_list_covers_every_table_in_the_schema`, `wipe_all_empties_every_user_data_table`, `wipe_all_preserves_config_and_schema_version`, `wipe_all_is_idempotent_on_empty_database`, `wipe_all_rolls_back_when_a_delete_fails`, `reclaim_space_succeeds_on_a_wal_file_backed_database` — all unchanged and still green.
  - [x] `pnpm --filter @nixus/desktop test` and the Playwright suite pass with **no spec edits**.
  - [x] Confirm the diff touches only `commands/danger_zone.rs` and `profile_store.rs`. Anything else is scope creep.

## Dev Notes

### Scope boundary — read this first

This story is **the only place the user-profile feature touches existing behaviour** (architecture: "D9's delete-all extension is the only place the profile store touches existing behavior; everything else is purely additive"). Two files change. Nothing else.

**In scope:** `delete_all_data` gains `app: AppHandle` and calls `profile_store::delete_all_profiles`; `delete_all_profiles` removes the whole `profiles/` directory recursively; one dedicated test.

**Explicitly out of scope — do not implement, even if it looks adjacent:**
- No SQLite migration, no new table, no `db/profile.rs`, no `MIGRATIONS` entry.
- No `insert_audit_log` call (D10: `insert_audit_log` needs `conn: &Connection` and an `i64 entity_id`; a file store has neither).
- No addition to `WIPE_TABLES` or `PRESERVED_TABLES`.
- No change to `export_backup`, `restore_from_file`, or `test_backup_copy_produces_identical_file`.
- No "Sign In with Nixus Cloud" relabel (Story 28.5), no country/subdivision/income fields (Epic 29), no TFSA figure (Epic 30).
- No new Rust crate, no new npm package, no `Cargo.toml` edit.
- No new i18n key.

**Dependency:** Story 28.2 only — `profile_store.rs` must exist with `profiles_dir` and the `load_profile`/`save_profile` free-function shape. This story does **not** depend on 28.1 or 28.3. If `delete_all_profiles` is not yet present in `profile_store.rs`, this story owns writing it.

### Current state of `commands/danger_zone.rs` — the whole file, 25 lines

```rust
use tauri::State;
use tracing::{info, warn};

use crate::db::danger_zone as danger_zone_db;
use crate::db::DbState;
use crate::error::AppError;

/// Permanently deletes all user data: finance, vehicles, net worth, chat and audit
/// history. App preferences and stored AI credentials are preserved.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_all_data(state: State<DbState>) -> Result<(), AppError> {
    let mut conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let deleted = danger_zone_db::wipe_all(&mut conn)?;
    info!("Danger Zone wipe complete: {} rows deleted", deleted);

    // Non-fatal: the rows are already gone, this only reclaims disk space.
    if let Err(e) = danger_zone_db::reclaim_space(&conn) {
        warn!("Post-wipe checkpoint/vacuum failed: {}", e);
    }

    Ok(())
}
```

**The blocking problem:** the signature takes only `state: State<DbState>`. There is **no `AppHandle`**, so the function has no way to resolve `app_data_dir` and therefore no way to find `profiles/`. This is why the signature change is a hard prerequisite rather than a stylistic preference. The doc comment above the command is still accurate after this change — profile data falls squarely under "all user data" — so leave it as is or extend it minimally; do not rewrite it.

### Where the call goes

Place `profile_store::delete_all_profiles(...)?` as the last statement before `Ok(())`, after the existing `reclaim_space` block. Rationale:

- The architecture requires it "after `wipe_all`" (delta tree comment at `architecture-user-profile.md:490-491`). Last-statement placement satisfies that.
- `reclaim_space` is already best-effort and reclaims space for rows that are confirmed gone. Running it unconditionally keeps existing behaviour byte-identical; putting the profile delete before it would skip the VACUUM on a filesystem failure for no benefit.
- Profile removal becomes the only new thing that can turn a committed SQL wipe into an `Err`, which makes the failure mode trivial to reason about.

**Lock safety:** the `conn` `MutexGuard` from `state.0.lock()` is still alive at that point. That is fine — `delete_all_profiles` does pure filesystem IO and never touches `DbState`, so there is no re-entrancy and no deadlock. Do **not** refactor the function to drop the guard early; that churns the most data-loss-critical command in the app for no gain.

### Failure handling is not best-effort

`reclaim_space` failure is swallowed with `warn!` because the rows are already deleted and only disk space is at stake. **Profile deletion is categorically different: on failure, PII is still on disk after the user asked for everything to be deleted — the exact outcome NFR4 forbids.** Propagate with `?`.

Be aware of the downstream consequence and accept it deliberately. `DangerZone.tsx:76-104` does:

```tsx
try {
  await invoke("delete_all_data");
} catch (err: unknown) {
  setError(getErrorMessage(err));
  setDeleting(false);
  return;
}

// Past this point the data is gone. Never report a failure as "delete failed".
setWiped(true);
```

So an `Err` from the profile step surfaces as an error in the dialog after the SQL wipe has already committed, and the app does not relaunch. That is the correct trade: the wipe genuinely was incomplete, and telling the user beats silently leaving their birthdate on disk. **Do not "fix" this by adding a partial-success state, a second command, or new copy** — that is redesign, not this story.

### Why recursive, not a `.json` glob

This is the single most likely way to implement this story wrongly, and the architecture calls it out as a closed gap (G2, `architecture-user-profile.md:662-664`):

> **G2 — `.corrupt` and `.tmp` files would survive delete-all, violating NFR4.** … A `delete_all_profiles` implemented as "delete every `*.json`" would leave PII on disk after the user asked for everything to be deleted — the precise failure NFR4 exists to prevent, and one this document's own Step 5 pattern introduced.
>
> **Resolved:** `delete_all_profiles` removes the **entire `profiles/` directory recursively** (`std::fs::remove_dir_all`, treating "already absent" as success), not a glob of `.json` files. The required delete-all test asserts the directory does not exist or is empty — not merely that no `.json` files remain.

Both non-`.json` leftovers are real and both contain full profile PII:

**`.json.corrupt`** — Story 28.2's corrupt-document handling renames an unparseable profile rather than deleting it (architecture Process Patterns, `architecture-user-profile.md:429`): "if a profile file exists but fails to parse, `load_profile` renames it to `<sub>.json.corrupt`, emits `tracing::warn!`, and returns `Ok(None)`. The page stays usable and the original bytes are preserved for recovery." Preserved bytes are preserved PII.

**`.json.tmp`** — the atomic-write helper writes a sibling temp file and renames it. This is the code Story 28.2 promotes out of `maintenance/catalog.rs:150-169` into `json_store::write_json_atomic`:

```rust
fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::File {
        message: "Invalid catalog file path".to_string(),
    })?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::File {
        message: format!("Failed to create parent dir: {}", e),
    })?;

    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| AppError::File {
        message: format!("Failed to serialize catalog data: {}", e),
    })?;
    std::fs::write(&tmp_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write catalog temp file: {}", e),
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| AppError::File {
        message: format!("Failed to finalize catalog file: {}", e),
    })?;
    Ok(())
}
```

`path.with_extension("json.tmp")` on `<sub>.json` yields `<sub>.json.tmp` (the `sub` is validated against `^[A-Za-z0-9_-]{1,128}$`, so it contains no dot to confuse `with_extension`). A crash between `std::fs::write` and `std::fs::rename` leaves that file behind with the complete serialized profile in it.

`remove_dir_all` handles both, plus any future sibling nobody has thought of yet, plus nested directories. That last property is why the test seeds a subdirectory.

### Why a dedicated test is mandatory, not optional

`apps/desktop/src-tauri/src/db/danger_zone.rs:14-16` documents a machine-checked safety net:

```rust
/// `PRESERVED_TABLES` below keeps that exclusion list machine-checkable: a test asserts
/// `WIPE_TABLES + PRESERVED_TABLES` covers every table in the live schema, so a future
/// migration cannot silently add a table that survives "delete all data".
pub const WIPE_TABLES: &[&str] = &[
    "chat_messages",
    "chat_conversations",
    "maintenance_service_logs",
    "maintenance_tasks",
    "vehicles",
    "income_entries",
    "recurring_income_templates",
    "income_sources",
    "recurring_expense_templates",
    "merchant_category_hints",
    "expenses",
    "budget_categories",
    "budget_groups",
    "passive_assets",
    "net_worth_snapshots",
    "accounts",
    "audit_log",
];

/// Test-only: proves the wipe exclusion list is exhaustive against the live schema.
#[cfg(test)]
pub const PRESERVED_TABLES: &[&str] = &["config", "schema_version", "sqlite_sequence"];
```

And the test that enforces it (`db/danger_zone.rs:178-210`):

```rust
/// Guards against a future migration adding a table that silently survives the wipe.
#[test]
fn wipe_list_covers_every_table_in_the_schema() {
    let conn = migrated_db();
    // sqlite_sequence only materializes once an AUTOINCREMENT row exists.
    seed_all(&conn);

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .expect("query sqlite_master");
    let live: HashSet<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("map rows")
        .map(|r| r.expect("row"))
        .collect();

    let accounted: HashSet<String> = WIPE_TABLES
        .iter()
        .chain(PRESERVED_TABLES.iter())
        .map(|t| t.to_string())
        .collect();

    let unaccounted: Vec<&String> = live.difference(&accounted).collect();
    assert!(
        unaccounted.is_empty(),
        "tables present in the schema but neither wiped nor explicitly preserved: {:?}. \
         Add them to WIPE_TABLES or PRESERVED_TABLES.",
        unaccounted
    );

    let stale: Vec<&&str> = WIPE_TABLES.iter().filter(|t| !live.contains(**t)).collect();
    assert!(stale.is_empty(), "WIPE_TABLES lists missing tables: {:?}", stale);
}
```

**Read the source of truth carefully: `SELECT name FROM sqlite_master WHERE type = 'table'`.** This test's entire universe is the live SQLite schema. It is structurally incapable of noticing a store that is not a SQLite table. It cannot see `app_data_dir/profiles/`, it cannot see `credentials.rs`'s keyring entries, and it will keep passing at 100% green while every profile document on the machine survives a full wipe.

Consequence, stated by the architecture (D9, `architecture-user-profile.md:241`): "Because this store is invisible to the `WIPE_TABLES` / `PRESERVED_TABLES` coverage test, that machine-checked safety net does not apply — a dedicated test asserting the profiles directory is empty after delete-all is **required, not optional**."

So the new test in `profile_store.rs` is not belt-and-braces coverage. It is the *replacement* safety net for a store the existing one cannot reach. Skipping it, or writing a weak version that only counts `*.json` files, leaves NFR4 unverified.

**And the corollary: `WIPE_TABLES` / `PRESERVED_TABLES` must not be edited.** The architecture's "not touched, deliberately" list (`architecture-user-profile.md:533`) is explicit: "`db/danger_zone.rs` — `WIPE_TABLES` / `PRESERVED_TABLES` unchanged; the profile store is not a table." Adding a `"profiles"` string to either const would make `wipe_list_covers_every_table_in_the_schema` fail on the `stale` assertion at line 208, because no such table exists in `sqlite_master`.

### Backup exclusion and restore survival are structural — change nothing

AC 6 asks you to *verify* a property, not to *build* one. Here is why the property already holds.

`commands/backup.rs::export_backup` checkpoints the WAL and copies exactly one file:

```rust
    // Checkpoint WAL to flush all data to main database file
    {
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }

    // Get database file path
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::File {
            message: format!("Failed to resolve app data dir: {}", e),
        })?;
    let db_path = app_data_dir.join("nkbaz-finance.db");
```

```rust
    // Copy the database file
    std::fs::copy(&db_path, &save_path).map_err(|e| AppError::File {
        message: format!("Failed to copy database: {}", e),
    })?;
```

It resolves `app_data_dir` only to build `app_data_dir.join("nkbaz-finance.db")`. It never enumerates the directory, never walks subdirectories, and never produces an archive. `profiles/` is a sibling of the copied file and is therefore excluded by construction, not by a filter someone could later forget.

`db/backup.rs::restore_from_file` swaps that same single file, with a `.pre-restore` safety copy and a rollback path:

```rust
    let safety_path = with_suffix(db_path, SAFETY_COPY_SUFFIX);

    let placeholder = Connection::open_in_memory()?;
    let old = std::mem::replace(slot, placeholder);
    drop(old);

    remove_sidecars(db_path);

    std::fs::copy(db_path, &safety_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to create safety copy: {}", e),
            },
        )
    })?;

    std::fs::copy(backup_path, db_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to restore database: {}", e),
            },
        )
    })?;

    remove_sidecars(db_path);

    let restored =
        open_configured(db_path).map_err(|e| roll_back(slot, db_path, &safety_path, e))?;
    *slot = restored;
```

Every path it touches is `db_path`, `db_path + ".pre-restore"`, `db_path + "-wal"`, or `db_path + "-shm"` (see `with_suffix` and `remove_sidecars`, `db/backup.rs:113-130`). `profiles/` is untouched, so a restored financial backup leaves the local profile exactly as it was — which is also the semantic the architecture wants (D9): "restoring a financial backup should not change who you are."

**Therefore: neither `commands/backup.rs` nor `db/backup.rs` needs a single line changed, and `test_backup_copy_produces_identical_file` (`commands/backup.rs:210-219`) must stay as is.** The architecture explicitly rejected the alternative (D2, line 173): keeping the profile in SQLite "would require scrubbing rows _and_ audit rows from the copied backup file, rewriting `test_backup_copy_produces_identical_file`, and adding preserve-across-swap logic to `restore_from_file` — surgery on the most data-loss-critical path in the app." Choosing a file store bought both properties for free; spending them on unnecessary edits would be a regression.

There is a second, independent reason no profile value can leak into a backup: D10 means no `insert_audit_log` entry is ever written for a profile mutation, so profile values never enter `nkbaz-finance.db` at all — not even through the audit trail.

### Test harness pattern to copy

`db/backup.rs:132-136` and `192-213` are the reference:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{run_migrations, MIGRATIONS};
    use tempfile::TempDir;
```

```rust
    #[test]
    fn restore_replaces_data_and_cleans_up() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let backup_path = dir.path().join("backup.db");
```

`maintenance/catalog.rs:410-417` shows the same shape for a file store — `TempDir::new().unwrap()`, then `catalog_dir(tmp.path())` to derive the store subdirectory. Mirror that for profiles: `TempDir::new()`, then `profiles_dir(tmp.path())`. `TempDir` drops and cleans itself up; never write into the real `app_data_dir` from a test.

### Sole-accessor boundary

`profile_store.rs` is to `profiles/` what `credentials.rs` is to the keyring. From the architecture's Communication Patterns (line 422):

> `profile_store.rs` is the sole accessor of the profiles directory, exactly as `credentials.rs` is the sole accessor of the keyring. No command, and no other module, performs file IO under `profiles/` — **including `danger_zone`, which must call `profile_store::delete_all_profiles` rather than removing the directory itself.**

And the Enforcement Guidelines (line 440): "Route every read/write/delete under `profiles/` through `profile_store.rs` — never perform file IO on that directory from a command, from `danger_zone`, or anywhere else."

Practically: after this change, `rg -n 'std::fs' apps/desktop/src-tauri/src/commands/danger_zone.rs` must return nothing, and `rg -n '"profiles"' apps/desktop/src-tauri/src/` must match only `profile_store.rs`. Deriving the path through `profile_store::profiles_dir(&app_data_dir)` keeps the boundary intact — that helper is part of the store's own public surface, and it performs no IO.

This also mirrors project rule 3's `commands/` → `db/` separation: commands orchestrate, the store owns IO. The anti-pattern the architecture names (line 453) is exactly the shortcut to avoid: `std::fs::…` inline in a command "bypasses the sole-accessor boundary, the atomic-write helper, and `sub` validation in one line."

### Project rules that apply here

- `#[tauri::command(rename_all = "snake_case")]` on every command; returns `Result<T, AppError>`; never panics (project rules 2 and 5).
- `AppError::File { message }` for IO failures. No new `AppError` variant (D13).
- No `.unwrap()` outside tests; `?` propagation throughout (project-context Rust rules).
- Comments explain WHY only, never WHAT — the existing `// Non-fatal: the rows are already gone…` comment is the house style.
- Zero compilation warnings before commit (project rule 9, `docs/guidelines/warnings.md`).
- No version bump: this is not a release, so leave `package.json`, `tauri.conf.json`, and `Cargo.toml` alone (project rule 10 applies only when releasing).

### Testing standards summary

- Rust unit tests inline via `#[cfg(test)] mod tests` using `tempfile` — the `db/backup.rs` convention.
- No new Playwright spec in this story. The delete-all flow has no E2E spec today, and the desktop E2E suite runs against the Vite dev server with `invoke` stubbed per-spec (`project-context.md:294`), so a stubbed `delete_all_data` could not observe a real filesystem deletion anyway. Filesystem behaviour belongs in the Rust unit test; the wiring is verified by Task 5's manual run.
- No locale-parity impact: no new i18n key.

### Project Structure Notes

**Files this story changes — exactly two:**

| Path | Change |
| --- | --- |
| `apps/desktop/src-tauri/src/commands/danger_zone.rs` | MODIFIED — `delete_all_data` gains `app: AppHandle`; imports `AppHandle` + `Manager`; resolves `app_data_dir`; calls `profile_store::delete_all_profiles` after `wipe_all`. |
| `apps/desktop/src-tauri/src/profile_store.rs` | MODIFIED (created by Story 28.2) — adds `delete_all_profiles(dir: &Path) -> Result<(), AppError>` plus the two dedicated tests. |

This matches the architecture delta tree (`architecture-user-profile.md:471-493`) exactly:

```
    ├── profile_store.rs            # NEW: sole accessor of app_data_dir/profiles/
    │                               #      load_profile, save_profile, delete_all_profiles,
    │                               #      profiles_dir, sub charset validation, field validation
    └── commands/
        ├── danger_zone.rs          # MODIFIED: delete_all_data gains `app: AppHandle` and calls
        │                           #           profile_store::delete_all_profiles after wipe_all
```

**Files that must NOT change** — from the architecture's "Not touched, deliberately" list (lines 530-538) plus the enumeration in Task 3:

- `apps/desktop/src-tauri/src/db/danger_zone.rs` — `WIPE_TABLES` / `PRESERVED_TABLES` and all six tests unchanged.
- `apps/desktop/src-tauri/src/commands/backup.rs`, `apps/desktop/src-tauri/src/db/backup.rs` — exclusion and survival are structural.
- `apps/desktop/src-tauri/src/db/audit.rs`, `src-tauri/migrations/`, `db/mod.rs` `MIGRATIONS`.
- `apps/desktop/src-tauri/src/lib.rs` — the `generate_handler!` entry at line 239 already names the function.
- `apps/desktop/src/components/settings/DangerZone.tsx` — `invoke("delete_all_data")` at line 80 is correct as written.
- `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json` — no dependency change (NFR6).
- `apps/desktop/src/locales/en.json`, `fr.json` — no new key.
- Every file under `apps/desktop/tests/` — no spec references this command.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updates are handled by the orchestrator, not by the dev agent.

**Naming alignment:** `delete_all_profiles` and `profiles_dir` are free functions taking an explicit `&Path`, never resolving `app_data_dir` themselves — the architecture's stated reason (line 395) is "so they are unit-testable against a `tempfile` dir, matching how `db/backup.rs` tests are written." `profile_store.rs` is a top-level sibling of `credentials.rs`, **not** `db/profile.rs` and not a new `stores/` directory, because no SQLite is involved.

**Detected variance, resolved:** `commands/maintenance.rs:295-301` already has a private `resolve_app_data_dir(app: &AppHandle)` helper, while `commands/backup.rs:30-35` and `commands/import.rs:41` inline the same `map_err`. Two conventions coexist. This story follows the inline form to avoid making a private helper `pub` and creating a `commands::danger_zone → commands::maintenance` dependency for three lines. Do not extract a shared helper as part of this story.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.4: Wiping my data removes my profile too] — acceptance criteria, copied verbatim above
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — NFR4 (line 52): "no profile PII survives the danger-zone delete-all path, including `.corrupt` and `.tmp` leftovers"
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — Delete-all coverage (line 72); "No SQLite work at all" (line 64); "No new dependencies" (line 63); "No audit logging" (line 77); "Backup and restore code is untouched" (line 78); Testing conventions (line 91); Regression checks required (line 92)
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)] — forward-dependency check (line 127): "28.4→28.2"
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture] — D9 lifecycle (lines 238-241); D2 storage medium and the rejected SQLite/backup-surgery alternative (lines 171-184); D10 no audit logging (lines 243-247)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results] — G2 `.corrupt`/`.tmp` survival and its resolution (lines 662-664); regression checks (line 686)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Technical Constraints & Dependencies] — backup is a whole-file SQLite copy (line 79); `danger_zone.rs` is self-enforcing for SQLite only (line 80); `insert_audit_log` structurally unavailable (line 81)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Implementation Patterns & Consistency Rules] — store function signatures (line 395); atomic writes via `json_store` (line 408); test conventions (line 409); corrupt-document handling (line 429); sole-accessor boundary (line 422); anti-pattern inline `std::fs` in a command (line 453); enforcement guidelines (lines 438-448)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Project Structure & Boundaries] — delta tree (lines 471-493); "Not touched, deliberately" (lines 530-538); requirements-to-structure map, NFR4 row (line 572)
- [Source: docs/project-context.md#Critical Implementation Rules] — rule 2 Tauri IPC commands; rule 3 db-layer separation; rule 5 `AppError`; rule 9 compilation warnings
- [Source: docs/project-context.md#Testing Rules] — desktop E2E runs against the Vite dev server with `invoke` stubbed per-spec (line 294); always-mounted-`invoke` mock trap (line 295)
- [Source: docs/guidelines/warnings.md] — all compilation warnings must be resolved
- [Source: apps/desktop/src-tauri/src/commands/danger_zone.rs:1-25] — current `delete_all_data`, no `AppHandle`
- [Source: apps/desktop/src-tauri/src/db/danger_zone.rs:14-39] — `WIPE_TABLES` / `PRESERVED_TABLES` and the machine-checkability doc comment
- [Source: apps/desktop/src-tauri/src/db/danger_zone.rs:178-210] — `wipe_list_covers_every_table_in_the_schema`, scoped to `sqlite_master`
- [Source: apps/desktop/src-tauri/src/commands/backup.rs:18-68] — `export_backup`: `PRAGMA wal_checkpoint(TRUNCATE)` then `std::fs::copy` of `nkbaz-finance.db` only
- [Source: apps/desktop/src-tauri/src/commands/backup.rs:210-219] — `test_backup_copy_produces_identical_file`, must not change
- [Source: apps/desktop/src-tauri/src/db/backup.rs:23-130] — `restore_from_file` single-file swap with `.pre-restore` rollback; `remove_sidecars` / `with_suffix`
- [Source: apps/desktop/src-tauri/src/db/backup.rs:132-213] — `tempfile::TempDir` test pattern to follow
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs:150-169] — `write_json_atomic`, source of the `.json.tmp` sibling
- [Source: apps/desktop/src-tauri/src/maintenance/catalog.rs:410-417] — `TempDir` + `catalog_dir(tmp.path())` file-store test shape
- [Source: apps/desktop/src-tauri/src/commands/maintenance.rs:3,295-301] — `use tauri::{AppHandle, Manager, State};` and the private `resolve_app_data_dir` variance
- [Source: apps/desktop/src-tauri/src/lib.rs:239] — `commands::danger_zone::delete_all_data` in `generate_handler!`, unchanged
- [Source: apps/desktop/src/components/settings/DangerZone.tsx:76-104] — `invoke("delete_all_data")` and the "past this point the data is gone" error branch
- [Source: apps/desktop/src-tauri/Cargo.toml:21,34] — `tauri` without the `test` feature; `tempfile = "3"` already a dependency

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → `test result: ok. 385 passed; 0 failed; 0 ignored`. Count is unchanged from baseline because the two pre-existing `delete_all_profiles` tests from Story 28.2 were strengthened and renamed in place, not added alongside.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` → exactly one warning, the pre-existing `explicit_auto_deref` at `commands/backup.rs:106`. No new warning introduced.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → exit 0, no output.
- `pnpm --filter @nixus/desktop test` → `Test Files 10 passed (10)`, `Tests 158 passed (158)`.
- `pnpm --filter @nixus/desktop exec playwright test` → `1 failed / 365 passed`. The single failure was `tests/expenses.spec.ts:613` ("expense row actions need no hover") — the documented under-load load flake. Re-run in isolation: `pnpm --filter @nixus/desktop exec playwright test tests/expenses.spec.ts` → `19 passed (26.5s)`. Not a regression; no spec was edited.

### Completion Notes List

**Task 1 — `delete_all_profiles`.** Story 28.2 had already landed the function body in `profile_store.rs` exactly as specified: `std::fs::remove_dir_all`, `ErrorKind::NotFound` mapped to `Ok(())`, every other IO error mapped to `AppError::File`. Per the story's own instruction to extend rather than duplicate, the only change needed was removing the now-obsolete `#[allow(dead_code)]` attribute (and the "no caller until Story 28.4" comment justifying it) now that `danger_zone` calls it. No `.unwrap()`, no `panic!`, no `println!`; no new `AppError` variant.

**Task 2 — `delete_all_data` gains `AppHandle`.** `commands/danger_zone.rs` line 1 became `use tauri::{AppHandle, Manager, State};` and `use crate::profile_store;` was added. Signature is now `pub fn delete_all_data(app: AppHandle, state: State<DbState>) -> Result<(), AppError>` — still synchronous, still `#[tauri::command(rename_all = "snake_case")]`. `app_data_dir` is resolved inline with the same `map_err` shape as `commands/backup.rs:30-35`; `commands/maintenance.rs::resolve_app_data_dir` was left private. The store call is the last statement before `Ok(())`, after the non-fatal `reclaim_space` block, and propagates with `?` rather than a `warn!` swallow (NFR4). The doc comment was extended by one clause to name the profile rather than rewritten. `db/danger_zone.rs` is byte-identical — verified with `git diff --stat` returning empty for that path, so `WIPE_TABLES` / `PRESERVED_TABLES` and all six of its tests are untouched and still green.

**Boundary verification.** `rg -n 'std::fs' apps/desktop/src-tauri/src/commands/danger_zone.rs` → no matches. `rg -n '"profiles"' apps/desktop/src-tauri/src/` → only `profile_store.rs:17` (`profiles_dir`) and `profile_store.rs:397` (its test). The sole-accessor boundary from 28.2 holds; the command never builds `app_data_dir.join("profiles")` itself.

**Task 3 — callers.** `rg -n 'delete_all_data' apps/desktop/` returns exactly three hits, and the story's prediction was correct on all three:
- `apps/desktop/src-tauri/src/commands/danger_zone.rs:13` — the definition itself.
- `apps/desktop/src-tauri/src/lib.rs:241` — the `generate_handler!` entry. Unchanged; the macro names the function and the `#[tauri::command]` expansion derives `AppHandle` injection from the signature. Compiles clean, which is the proof.
- `apps/desktop/src/components/settings/DangerZone.tsx:80` — `await invoke("delete_all_data");`. Unchanged, and confirmed correct: `AppHandle` is injected server-side by Tauri and is never serialized from the webview, so there is no argument object to add a key to. `tsc --noEmit` clean.

No Rust test called `delete_all_data` (there is still no `#[cfg(test)] mod tests` in `commands/danger_zone.rs`), and `rg -n 'delete_all_data|danger-zone|DangerZone' apps/desktop/tests/` returns nothing — no Playwright spec references the command or the component by name. `DangerZone` does mount on the `/settings` routes visited by `ai-navigation.spec.ts` and `budget-templates.spec.ts`, but it only invokes inside click handlers, never on mount, so the always-mounted-`invoke` mock trap (`project-context.md:295`) does not apply. Zero spec edits; the full Playwright suite confirms it. No i18n key added.

**Task 4 — the mandatory test.** `delete_all_profiles_removes_every_extension` now seeds four files — `<sub>.json` (via a real `save_profile`), `<sub>.json.corrupt`, `<sub>.json.tmp`, and a nested `sub-dir/orphan.json` — asserts each fixture exists before the delete (so the test cannot pass vacuously), then asserts `!dir.exists() || read_dir(&dir).next().is_none()`. The assertion is directory-absent-or-empty, deliberately **not** "no `.json` files remain", which is the form a buggy `*.json` glob would also pass. `delete_all_profiles_is_ok_when_directory_absent` points at a never-created `TempDir` subpath and calls the function twice to prove idempotence. Both use the `db/backup.rs` `TempDir` harness pattern; no real `app_data_dir` is ever touched. `Cargo.toml` was not edited — `tempfile = "3"` is already a plain dependency.

`delete_all_data` itself is not unit-tested: `tauri = { version = "2.11", features = [] }` has the `test` feature off, so `MockRuntime` is unavailable and enabling it would be a forbidden `Cargo.toml` change. The command layer is three lines of orchestration whose correctness is established by compilation plus the store-level tests.

**Task 5 — manual backup/restore verification: NOT PERFORMED.** This task requires launching `tauri dev`, signing in to a real Cognito session, and running the real danger-zone delete against a live `app_data_dir`. The delegated task brief explicitly forbade invoking the delete-all-data flow against real app data, so this was not executed and no observed outcome is claimed. What *was* verified, statically and conclusively:
- `commands/backup.rs::export_backup` resolves `app_data_dir` only to build `app_data_dir.join("nkbaz-finance.db")` and then `std::fs::copy`s that single file. It never enumerates the directory and never produces an archive, so `profiles/` — a *sibling* of the copied file — is excluded by construction. (AC 6, first half.)
- `db/backup.rs::restore_from_file` touches only `db_path`, `db_path + ".pre-restore"`, and the `-wal`/`-shm` sidecars via `with_suffix` / `remove_sidecars`. `profiles/` is never referenced, so a restored financial backup leaves the local profile bit-identical. (AC 6, second half.)
- D10 holds: no `insert_audit_log` call exists on any profile path, so no profile value enters `nkbaz-finance.db` even through the audit trail.
- `.json.corrupt` and `.json.tmp` removal — the part of Task 5 that was actually at risk of being wrong — is covered by the Rust test rather than by hand, which is the stronger check anyway since it runs in CI on every commit.

`export_backup`, `restore_from_file`, and `test_backup_copy_produces_identical_file` were not modified; `git diff --stat` on `commands/backup.rs` and `db/backup.rs` is empty. **A human should still run Task 5's five manual steps before this story is accepted**, since AC 6 is written as an end-to-end observation.

**Task 6 — gates.** All recorded in Debug Log References above. `git diff` for this story touches exactly two files: `commands/danger_zone.rs` (tracked, +11/-3) and `profile_store.rs` (still untracked as of this story, created by 28.2). No `Cargo.toml`, `package.json`, migration, locale, spec, or `sprint-status.yaml` change. No new crate or npm package. No `as any` / `@ts-ignore` / `@ts-expect-error`. No existing test weakened or deleted — the two `delete_all_profiles` tests were made strictly stronger (four fixtures instead of two, pre-existence assertions added, absent-or-empty assertion, explicit second call for idempotence).

### File List

- `apps/desktop/src-tauri/src/commands/danger_zone.rs` — MODIFIED: `delete_all_data` gains `app: AppHandle`; imports `AppHandle` + `Manager` + `crate::profile_store`; resolves `app_data_dir` inline; calls `profile_store::delete_all_profiles` as the last statement before `Ok(())`, propagating with `?`.
- `apps/desktop/src-tauri/src/profile_store.rs` — MODIFIED: removed the now-obsolete `#[allow(dead_code)]` from `delete_all_profiles`; strengthened `delete_all_profiles_removes_every_extension` (four fixtures across `.json`, `.json.corrupt`, `.json.tmp`, nested subdirectory; absent-or-empty assertion) and `delete_all_profiles_is_ok_when_directory_absent` (double call for idempotence).
