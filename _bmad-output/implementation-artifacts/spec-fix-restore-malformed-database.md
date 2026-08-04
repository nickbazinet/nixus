---
title: 'Fix "database disk image is malformed" on backup restore'
type: 'bugfix'
created: '2026-08-04'
status: 'in-review'
baseline_commit: '1bc5427'
context: ['{project-root}/docs/guidelines/warnings.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Restore always fails with `Failed to configure restored database: database disk image is malformed`. `import_backup` overwrites `nkbaz-finance.db` while the live `Connection` in `DbState` is still open, so the stale `-shm` wal-index — built for the *old* database's pages — remains on disk and is attached by the new connection, which then reads garbage. The backup file is provably healthy: `validate_backup_file` passes `PRAGMA integrity_check` on those exact bytes moments earlier.

**Approach:** Close the old connection *before* touching the file so SQLite removes its `-wal`/`-shm` sidecars, then swap, then open a fresh configured connection. Move the swap into the `db/` layer so it is unit-testable without a Tauri `AppHandle`, and run migrations on the restored database so older backups are forward-migrated.

## Boundaries & Constraints

**Always:**
- Atomic from the user's view: on any failure the pre-restore database is put back **and** `DbState` holds a working connection to it — never a throwaway/in-memory database.
- Remove `nkbaz-finance.db-wal` / `-shm` before opening any connection against a newly-swapped file, on both the restore and rollback paths.
- Configure the restored connection exactly like startup (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` then `run_migrations`) through one shared code path with `init_db`, not a duplicated pragma string.
- Delete the `.pre-restore` safety copy on success *and* failure.
- Project rules: DB work in `db/`, `commands/` orchestrates only; `AppError` everywhere; zero Rust warnings.

**Ask First:**
- Changing `export_backup`'s copy strategy (e.g. `VACUUM INTO`).
- Changing the `DbState(Mutex<Connection>)` shape or `validate_backup_file`'s rules.
- Adding a schema-downgrade guard for backups newer than the app.

**Never:**
- Delete `-wal`/`-shm` while the old connection still holds them open — close it first and let SQLite clean up.
- Touch the frontend: `YourDataSettings.tsx` already surfaces the error and clears the query cache on success.
- Add or edit migrations, or change `export_backup` behaviour.
- `.unwrap()` outside tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|---|---|---|---|
| Healthy backup | Valid WAL backup, current schema | `Ok(true)`; connection serves backup data; no sidecar or `.pre-restore` leftovers | N/A |
| Stale sidecars | Bogus `-wal` + `-shm` on disk pre-restore | `Ok(true)`; removed before reopen; no malformed error | N/A |
| Older backup | Valid backup at schema v18 | `Ok(true)`; migrated to latest | N/A |
| Copy fails | `fs::copy` into place errors | `Err(AppError::File)`; original DB back; working connection | Rollback + reopen |
| Configure fails | Copy ok, open/pragma/migration errors | `Err(AppError::Database)`; original DB back; working connection | Rollback + reopen |
| Cancelled | No file picked | `Ok(false)`; DB and connection untouched | N/A |
| Invalid backup | Fails `integrity_check` or lacks `budget_groups` | `Err(AppError::File)` "Invalid backup file"; nothing swapped | Reject before any write |

</frozen-after-approval>

## Code Map

- `src-tauri/src/commands/backup.rs` -- `import_backup` (71-167) holds the bug; error string at 140; sidecar cleanup misplaced at 149-153 (after the `?`, so never runs on failure). `export_backup` and `validate_backup_file` stay as-is. Existing `#[cfg(test)] mod tests` uses `tempfile`.
- `src-tauri/src/db/mod.rs` -- `DbState(pub Mutex<Connection>)`, `init_db` (pragmas + `run_migrations`), `MIGRATIONS` (22). Register the new module here.
- `src-tauri/src/db/danger_zone.rs` -- reference pattern: `db/` fn taking `&mut Connection`, tested against a real WAL temp-file DB via `tempfile` + `run_migrations`.
- `src-tauri/src/lib.rs` -- `init_db` + `app.manage(DbState(...))` at 48-57. No change expected.

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/db/mod.rs` -- extract `init_db`'s open+pragma+migrate sequence into `pub(crate) fn open_configured(db_path: &Path) -> Result<Connection, AppError>` and call it from `init_db`; add `pub mod backup;` -- one identical config path for startup and restore.
- [x] `src-tauri/src/db/backup.rs` -- new module: `pub fn restore_from_file(slot: &mut Connection, db_path: &Path, backup_path: &Path) -> Result<(), AppError>` doing checkpoint → close old conn via `mem::replace` + `drop` → remove sidecars → safety copy → swap → `open_configured` → assign into `slot`; rollback restores the safety copy, clears sidecars, reopens a working connection, returns the original error. Plus `fn remove_sidecars(db_path: &Path)` -- puts the fix where it is testable without Tauri.
- [x] `src-tauri/src/commands/backup.rs` -- reduce `import_backup` to dialog → `validate_backup_file` → resolve paths → lock `DbState` → `db::backup::restore_from_file` → log → `Ok(true)`; delete the inline block at 104-166 -- commands orchestrate, `db/` owns DB work.
- [x] `src-tauri/src/db/backup.rs` (tests) -- cover every I/O matrix row: healthy restore, pre-existing bogus sidecars, older-schema forward migration, unreadable backup rolls back with a usable connection, and cleanup of sidecars + `.pre-restore`.

**Acceptance Criteria:**
- Given the real backup at `/Users/nbazinet/Desktop/finance-backup.db`, when restoring via Settings → Your Data → Restore, then it succeeds and the restored data is visible in the app.
- Given a successful restore, when the app data directory is inspected, then no `.pre-restore` file and no sidecars from the previous database remain.
- Given a restore that failed for any reason, when the user continues without restarting, then reads and writes still work against the pre-restore data.
- Given `cargo test` and `cargo build` in `src-tauri`, then both succeed with zero warnings.

## Spec Change Log

## Design Notes

The connection must be *dropped*, not merely checkpointed — `wal_checkpoint(TRUNCATE)` empties the `-wal` but leaves both sidecars on disk and mmap'd. SQLite removes them only when the last connection closes cleanly. Since `DbState` owns the `Connection` behind a `Mutex`, closing it means moving it out:

```rust
let placeholder = Connection::open_in_memory()?;
let old = std::mem::replace(slot, placeholder);
drop(old); // SQLite now removes -wal / -shm
```

That is exactly why rollback must reopen a real connection: between the `mem::replace` and the final assignment, `slot` holds a useless in-memory database. If the rollback reopen also fails, return the original error and log the reopen failure.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo test backup` -- expected: all new `db::backup` tests pass
- `cd apps/desktop/src-tauri && cargo build 2>&1 | grep -c warning` -- expected: `0`
- `pnpm --filter @nkbaz/desktop tauri dev` -- expected: app launches; restoring `/Users/nbazinet/Desktop/finance-backup.db` shows a success toast, not an error

**Manual checks:**
- After a successful restore, list `~/Library/Application Support/<bundle-id>/` and confirm only `nkbaz-finance.db` plus a fresh sidecar pair from the *new* connection exist — no `.pre-restore` leftover.
