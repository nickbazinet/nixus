# Story 1.3: Set Up Rust Backend with SQLite & Error Handling

Status: review

## Story

As a developer,
I want rusqlite integrated with a migration system and typed error handling,
So that the data layer is ready for feature development.

## Acceptance Criteria

1. **Given** the Tauri project with frontend configured (Story 1.2), **When** the Rust backend starts, **Then** a SQLite database file is created in `Tauri appDataDir()` on first launch.
2. **Given** a database connection is opened, **When** the connection is initialized, **Then** WAL mode is enabled (`PRAGMA journal_mode=WAL`).
3. **Given** the database exists, **When** the app starts, **Then** a `schema_version` table tracks applied migrations with at least a `version` column and an `applied_at` timestamp.
4. **Given** `.sql` migration files exist in `src-tauri/migrations/`, **When** the app starts, **Then** version-numbered migrations are applied in order, and already-applied migrations are skipped.
5. **Given** a Tauri command encounters an error, **When** the error is returned, **Then** an `AppError` enum with `Validation`, `Database`, `AiService`, and `File` variants is used.
6. **Given** an `AppError` is returned from a Tauri command, **When** it is serialized for the frontend, **Then** it produces structured JSON with `type`, `message`, and optional `field` / `recoverable` keys.
7. **Given** the `tracing` crate is configured, **When** the app runs, **Then** log output is written to a file in the Tauri `appDataDir()` directory.

## Tasks / Subtasks

- [x] Task 1: Add Rust dependencies to Cargo.toml (AC: #1, #2, #5, #7)
  - [x] Add `rusqlite = { version = "0.38", features = ["bundled"] }` to `[dependencies]`
  - [x] Add `serde = { version = "1", features = ["derive"] }` and `serde_json = "1"`
  - [x] Add `tracing = "0.1"` and `tracing-subscriber = { version = "0.3", features = ["fmt", "env-filter"] }` and `tracing-appender = "0.2"`
  - [x] Add `chrono = { version = "0.4", features = ["serde"] }` for timestamps
  - [x] Verify `cargo build` succeeds in `src-tauri/`
- [x] Task 2: Create the database module with connection management (AC: #1, #2)
  - [x] Create `src-tauri/src/db/mod.rs`
  - [x] Implement `init_db(app_data_dir: &Path) -> Result<Connection, AppError>` that:
    - Creates the database file at `{appDataDir}/nkbaz-finance.db`
    - Enables WAL mode: `PRAGMA journal_mode=WAL;`
    - Enables foreign keys: `PRAGMA foreign_keys=ON;`
  - [x] Store the database connection as Tauri managed state (wrapped in `Mutex<Connection>`)
  - [x] Wire up `init_db` in `main.rs` during Tauri `setup()` hook
- [x] Task 3: Implement the migration system (AC: #3, #4)
  - [x] Create the `schema_version` table on first run
  - [x] Create `src-tauri/migrations/` directory
  - [x] Create `src-tauri/migrations/001_initial_schema.sql`
  - [x] Implement `run_migrations(conn: &Connection) -> Result<(), AppError>` with compile-time embedded migrations
  - [x] Call `run_migrations` during `init_db` after connection setup
- [x] Task 4: Create the AppError enum and serialization (AC: #5, #6)
  - [x] Create `src-tauri/src/error.rs`
  - [x] Define `AppError` enum with all 4 variants
  - [x] Implement `Display` and `std::error::Error` for `AppError`
  - [x] Implement `Serialize` for `AppError` producing structured JSON
  - [x] Implement `From<rusqlite::Error>` for `AppError`
- [x] Task 5: Configure tracing with file output (AC: #7)
  - [x] Configure `tracing_subscriber` with file appender and EnvFilter
  - [x] Add info logs on startup and migration events
- [x] Task 6: Create a health-check Tauri command for verification (AC: #1, #2, #3)
  - [x] Create `src-tauri/src/commands/mod.rs` with `get_db_status` command
  - [x] Register the command in `lib.rs` via `invoke_handler`
- [x] Task 7: Verify the full backend setup
  - [x] Rust backend compiles without errors
  - [x] `cargo test` passes
  - [x] All Playwright tests still pass (no regressions)

## Dev Notes

### rusqlite Setup

Use rusqlite 0.38 with the `bundled` feature. This bundles SQLite into the binary — no system SQLite dependency required.

```toml
[dependencies]
rusqlite = { version = "0.38", features = ["bundled"] }
```

**Connection is synchronous.** rusqlite is not async — it runs on the Tauri command thread pool, which is fine for a single-user desktop app. Do NOT use `tokio::task::spawn_blocking` or async wrappers — keep it simple.

### WAL Mode

Set WAL mode immediately after opening the connection:
```rust
conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
```

WAL mode enables concurrent reads while writing and prevents database corruption on crashes (NFR11).

### Integer Cents for Money

All monetary values throughout the application use integer cents (`i64`). This is defined here as the data layer convention:
- Column type: `INTEGER` in SQLite
- Rust type: `i64`
- Example: $700.00 is stored as `70000`
- Frontend handles formatting to `$700.00`

Do NOT store floats or decimals for monetary values anywhere in the database.

### Migration Embedding Strategy

Migrations should be embedded at compile time using `include_str!` so they ship with the binary:

```rust
const MIGRATIONS: &[(&str, &str)] = &[
    ("001", include_str!("../../migrations/001_initial_schema.sql")),
];
```

This avoids runtime file system access for migrations. The migration runner compares the version numbers against `schema_version` and applies any that are new.

### AppError and Tauri 2.x

In Tauri 2.x, command return types must implement `Serialize`. For error handling, `AppError` must implement `serde::Serialize` and the Tauri command should return `Result<T, AppError>`. Tauri serializes the `Err` variant as the error payload to the frontend.

The serialized JSON format must match the architecture spec:
```json
{ "type": "database", "message": "Failed to open database" }
{ "type": "validation", "message": "Category name required", "field": "name" }
{ "type": "ai_service", "message": "Bedrock unavailable", "recoverable": true }
```

### Tracing Configuration

Use `tracing-appender` for file-based logging:
```rust
let file_appender = tracing_appender::rolling::daily(app_data_dir, "nkbaz-finance.log");
tracing_subscriber::fmt()
    .with_writer(file_appender)
    .with_env_filter("info")
    .with_ansi(false)
    .init();
```

### Database State Management in Tauri 2.x

Wrap the rusqlite `Connection` in a `Mutex` and store it as Tauri managed state:

```rust
use std::sync::Mutex;

struct DbState(Mutex<rusqlite::Connection>);

// In setup:
app.manage(DbState(Mutex::new(conn)));

// In commands:
#[tauri::command]
fn get_db_status(state: tauri::State<DbState>) -> Result<DbStatus, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?;
    // use conn...
}
```

### Scope Boundaries

**In scope:**
- rusqlite with bundled SQLite, WAL mode, foreign keys
- Migration system with `schema_version` table and `.sql` files
- `AppError` enum with all 4 variants and JSON serialization
- `tracing` crate with file output
- Database connection as Tauri managed state
- A health-check command to verify the setup
- `db/mod.rs` and `error.rs` module files

**Out of scope (handled by later stories):**
- Any domain tables (budget_categories, expenses, accounts, etc.) — Epic 2+
- Frontend changes — this story is Rust-only
- Tauri IPC event patterns (streaming) — later stories
- AI service integration — Epic 6/7
- Audit log table — Epic 8
- Backup/restore commands — Epic 8
- `commands/budget.rs`, `commands/expense.rs`, etc. — only `commands/mod.rs` with the health-check command

### Project Structure Notes

Files to create:
- `src-tauri/src/db/mod.rs` — database connection, WAL mode, migration runner
- `src-tauri/src/error.rs` — `AppError` enum with serialization
- `src-tauri/src/commands/mod.rs` — command exports + health-check command
- `src-tauri/migrations/001_initial_schema.sql` — initial migration (may be minimal/empty if `schema_version` is created by the runner)

Files to modify:
- `src-tauri/Cargo.toml` — add rusqlite, serde, tracing, chrono dependencies
- `src-tauri/src/main.rs` — add Tauri setup hook (init_db, tracing), register commands, manage state

Files unchanged:
- All frontend files (`src/`) — no frontend changes in this story

### Rust Module Structure After This Story

```
src-tauri/
├── Cargo.toml              # Updated with new dependencies
├── migrations/
│   └── 001_initial_schema.sql
└── src/
    ├── main.rs             # Updated: setup hook, state management, command registration
    ├── error.rs            # NEW: AppError enum
    ├── db/
    │   └── mod.rs          # NEW: init_db, run_migrations
    └── commands/
        └── mod.rs          # NEW: get_db_status command
```

### Naming Conventions (from Architecture)

- Rust functions: `snake_case` — `init_db`, `run_migrations`, `get_db_status`
- Rust structs: `PascalCase` — `AppError`, `DbState`, `DbStatus`
- Rust modules: `snake_case` — `db`, `error`, `commands`
- Database tables: `snake_case`, plural — `schema_version`
- Database columns: `snake_case` — `applied_at`
- Tauri command names: `snake_case` — `get_db_status`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture, Error Handling, Logging, Rust Backend Organization]
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-tauri-desktop-application.md — Previous story context]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- rusqlite 0.38 with bundled SQLite integrated
- WAL mode and foreign keys enabled on connection init
- Migration system with compile-time embedded SQL files via include_str!
- AppError enum with Validation, Database, AiService, File variants and JSON serialization
- tracing with daily rolling file appender to appDataDir
- get_db_status health-check command registered
- cargo check and cargo test pass

### File List
- src-tauri/Cargo.toml (modified)
- src-tauri/src/lib.rs (modified)
- src-tauri/src/main.rs (modified)
- src-tauri/src/error.rs (new)
- src-tauri/src/db/mod.rs (new)
- src-tauri/src/commands/mod.rs (new)
- src-tauri/migrations/001_initial_schema.sql (new)
