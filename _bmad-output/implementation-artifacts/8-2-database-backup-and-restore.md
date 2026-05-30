# Story 8.2: Database Backup and Restore

Status: review

## Story

As a user,
I want to backup and restore my financial database,
So that I never lose my financial data.

## Acceptance Criteria

**Given** the user triggers a backup action (from app settings or menu)
**When** the backup is initiated
**Then** a Tauri command copies the SQLite database file to a user-chosen location via the native save dialog
**And** a success toast confirms "Backup saved to [path]"

**Given** the user triggers a restore action
**When** the user selects a backup file via native file dialog
**Then** the current database is replaced with the backup file
**And** the app reloads with the restored data
**And** a success toast confirms "Database restored"

**Given** an invalid or corrupted file is selected for restore
**When** the restore is attempted
**Then** an inline error shows "Invalid backup file" and the current database is not modified

## Tasks / Subtasks

### Task 1: Backup Tauri Command

Implement the `export_backup` command that copies the SQLite database to a user-chosen location.

**AC reference:** "Tauri command copies the SQLite database file to a user-chosen location via the native save dialog"

- Create `src-tauri/src/commands/backup.rs`
- `#[tauri::command] async fn export_backup(app_handle: AppHandle) -> Result<String, AppError>`
- Open Tauri native save dialog (`dialog::FileDialogBuilder`) with default filename `nkbaz-finance-backup-{YYYY-MM-DD}.db` and filter for `.db` files
- If user selects a path, close the active database connection (or use SQLite backup API), then copy the database file using `std::fs::copy`
- Return the chosen file path on success for the toast message
- If user cancels the dialog, return a sentinel (e.g., empty string or specific result) — not an error
- Register command in `main.rs`
- Verify: Backup file is a valid SQLite database at the chosen path

### Task 2: Restore Tauri Command

Implement the `import_backup` command that replaces the current database with a backup file.

**AC reference:** "current database is replaced with the backup file" + "app reloads with the restored data"

- `#[tauri::command] async fn import_backup(app_handle: AppHandle) -> Result<(), AppError>`
- Open Tauri native open dialog with filter for `.db` files
- Validate the selected file before replacing:
  - Check file exists and is readable
  - Open it with SQLite and run `PRAGMA integrity_check` to verify it is a valid SQLite database
  - Optionally check for expected tables (`budget_groups`, `expenses`, etc.) to confirm it is an nkbaz-finance backup
- If validation fails, return `AppError::File` with message "Invalid backup file" — do NOT modify the current database
- If valid: close active database connection, copy backup file over the current database path, reopen connection
- Emit a Tauri event or return success to trigger a frontend app reload (window reload or TanStack Query invalidation)
- Register command in `main.rs`
- Verify: After restore, app shows data from the backup file; original data is replaced

### Task 3: Backup Safety — Protect Active Database

Ensure backup and restore operations do not corrupt the active database.

**AC reference:** "current database is not modified" (on invalid file) + NFR11 (no silent data loss)

- Before restore: create a temporary copy of the current database as a safety net (e.g., `nkbaz-finance.db.pre-restore`)
- Use SQLite's `PRAGMA wal_checkpoint(TRUNCATE)` before copying to ensure WAL is flushed to main database file
- If the restore copy operation fails mid-way, restore from the safety copy
- Clean up the safety copy only after successful restore and verification
- Verify: Interrupting a restore does not leave a corrupted database

### Task 4: Frontend Backup/Restore UI

Add backup and restore buttons to the app UI.

**AC reference:** "user triggers a backup action" + "success toast confirms"

- Add backup/restore actions to a Settings area or as menu items in the sidebar
- "Backup Database" button calls `invoke("export_backup")` — show success toast with path on completion
- "Restore Database" button calls `invoke("import_backup")` — show success toast on completion, then reload the app (e.g., `window.location.reload()` or invalidate all TanStack Query caches)
- On restore error, show inline error "Invalid backup file"
- Verify: Both buttons trigger native dialogs, success/error toasts display correctly

### Task 5: Rust Unit Tests

Write unit tests for backup validation logic.

**AC reference:** "invalid or corrupted file" detection

- Test: `integrity_check` passes on a valid SQLite database file
- Test: `integrity_check` fails on a non-SQLite file (e.g., a text file)
- Test: `integrity_check` fails on a truncated/corrupted file
- Test: Backup file copy produces a byte-identical copy
- Verify: `cd src-tauri && cargo test` passes

## Dev Notes

### Architecture

- Backup is a simple file copy operation — SQLite is a single file, which makes this straightforward
- The key complexity is ensuring WAL mode data is flushed before copying (`PRAGMA wal_checkpoint(TRUNCATE)`)
- Restore requires closing and reopening the database connection — this means the Tauri `State<DbConnection>` (or equivalent managed state) must support reconnection
- The audit log table is included in backups automatically since it lives in the same SQLite file (NFR11)

### Database Connection Management

- The database connection is managed as Tauri state (likely `Mutex<Connection>` or similar)
- For backup: checkpoint WAL, then copy file — no need to close connection for read-only copy
- For restore: must close connection, replace file, reopen connection — this is the tricky part
- Consider using SQLite's online backup API (`sqlite3_backup_init`) as an alternative to file copy for backup

### Testing

- Manual testing: verify backup file opens in any SQLite browser
- Manual testing: verify restore with backup from a different date shows old data
- Edge case: backup when WAL file exists and has uncommitted data

### Scope

- No incremental or differential backups — full file copy only
- No scheduled/automatic backups — manual trigger only
- No backup encryption — file is a plain SQLite database (OS-level encryption handles data-at-rest per architecture)
- The UI location (settings page vs sidebar menu) is flexible — keep it simple

### Project Structure Notes

**Backend files:**
- `src-tauri/src/commands/backup.rs` — `export_backup` and `import_backup` commands

**Frontend files:**
- Settings or sidebar component with backup/restore buttons
- Toast notifications for success/error feedback

### References

- NFR11: Financial records are never silently lost or corrupted
- NFR12: Database supports backup and restore capability
- Architecture: "Backup (NFR12) — SQLite file copy via native save dialog; Tauri command copies database file to user-chosen location; restore = replace file"
- Tauri dialog plugin: `@tauri-apps/plugin-dialog` for native save/open dialogs

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed `FilePath` API: Tauri dialog returns `FilePath` which uses `as_path()` not `path()`.

### Completion Notes List
- Task 1: `export_backup` command — WAL checkpoint, native save dialog with default filename `nkbaz-finance-backup-{date}.db`, file copy. Returns path for toast.
- Task 2: `import_backup` command — native open dialog, validates backup file (integrity check + table check), replaces database, reopens connection.
- Task 3: Safety measures — pre-restore safety copy, WAL checkpoint before operations, rollback on failure, cleanup WAL/SHM files.
- Task 4: Sidebar UI — Backup/Restore buttons at bottom of sidebar. Backup shows success toast with path. Restore shows success toast then reloads app. Invalid file shows error toast.
- Task 5: 5 Rust unit tests for backup validation: valid DB passes, non-SQLite fails, truncated fails, missing tables fails, byte-identical copy. All 11 Rust tests pass (5 new + 6 existing).
- No new Playwright tests needed — backup/restore requires native file dialogs which can't be mocked in browser tests.
- Full test suite: 130/130 Playwright + 11/11 Rust tests pass.

### File List
- `src-tauri/src/commands/backup.rs` (new)
- `src-tauri/src/commands/mod.rs` (modified — added backup module)
- `src-tauri/src/lib.rs` (modified — registered export_backup and import_backup commands)
- `src-tauri/Cargo.toml` (modified — added tempfile dev dependency)
- `src/components/shared/AppSidebar.tsx` (modified — added Backup/Restore buttons)

### Change Log
- 2026-03-15: Implemented Story 8.2 — Database Backup and Restore. All 5 tasks complete. 5 Rust unit tests added. 130/130 Playwright + 11/11 Rust tests passing.
