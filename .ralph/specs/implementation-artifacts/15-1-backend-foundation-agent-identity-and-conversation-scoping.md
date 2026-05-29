# Story 15.1: Backend Foundation — Agent Identity and Conversation Scoping

Status: ready-for-dev

## Story

As a developer,
I want the database, Rust data layer, and Tauri commands to support agent identity on chat conversations,
So that every conversation is permanently associated with a specific AI agent and can be queried by agent.

**Scope:** Rust-only changes. No frontend changes. Builds the backend contract that Stories 15.2, 15.3, and 15.4 depend on.

## Acceptance Criteria

1. **Given** the app starts with an existing database that has `chat_conversations` rows without `agent_id`  
   **When** the migration runs on startup  
   **Then** `chat_conversations` has a new column `agent_id TEXT NOT NULL DEFAULT 'budget-helper'`  
   **And** all existing rows have `agent_id = 'budget-helper'` (SQLite DEFAULT applies to ALTER TABLE)  
   **And** an index `idx_chat_conversations_agent_id` exists on `chat_conversations(agent_id)`  
   **And** the `schema_version` table reflects the new migration version (17)

2. **Given** the updated `ChatConversation` struct in `db/chat.rs`  
   **When** a conversation is serialized to JSON  
   **Then** the JSON object contains `"agent_id": "budget-helper"` (or the specified agent ID)  
   **And** the existing fields (`id`, `title`, `created_at`, `updated_at`) are unchanged

3. **Given** a call to `create_conversation(conn, title, agent_id)`  
   **When** the function executes  
   **Then** a new row is inserted with the provided `agent_id`  
   **And** the returned `ChatConversation` has the correct `agent_id`

4. **Given** a call to `list_conversations_by_agent(conn, agent_id)`  
   **When** conversations for that agent exist  
   **Then** the function returns only conversations where `agent_id` matches, sorted by `updated_at DESC`  
   **And** conversations belonging to other agents are not included

5. **Given** a call to `list_conversations_by_agent(conn, "budget-helper")`  
   **When** no conversations exist for that agent  
   **Then** the function returns an empty `Vec<ChatConversation>`

6. **Given** the `send_chat_message` Tauri command is called with `agent_id: String`  
   **When** `conversation_id` is `None` (new conversation)  
   **Then** a new conversation is created with the provided `agent_id`  
   **And** the title is set to the first 40 characters of the `message` parameter (trimmed, no trailing ellipsis in the stored value)

7. **Given** the `send_chat_message` Tauri command is called with an existing `conversation_id`  
   **When** the conversation already has an `agent_id`  
   **Then** the existing `agent_id` is used (the passed `agent_id` parameter is ignored for existing conversations)

8. **Given** `build_system_prompt` in `ai/chat.rs` is called with `agent_id: "budget-helper"`  
   **When** the function executes  
   **Then** it returns the existing Budget Helper system prompt (no behavioral change for existing agent)

9. **Given** `build_system_prompt` is called with an unrecognized `agent_id`  
   **When** the function executes  
   **Then** it returns the default Budget Helper system prompt as a safe fallback

10. **Given** the `list_conversations` Tauri command is called with `agent_id: String`  
    **When** conversations exist for that agent  
    **Then** it returns `Vec<ChatConversation>` for that agent only, sorted by `updated_at DESC`

## Tasks / Subtasks

- [ ] Task 1: Create migration 017 for `agent_id` column and index (AC: #1)
  - [ ] Create `apps/desktop/src-tauri/migrations/017_chat_agent_id.sql` with the `ALTER TABLE` and `CREATE INDEX` statements
  - [ ] Register migration (17, ...) in the `MIGRATIONS` const in `db/mod.rs`

- [ ] Task 2: Update `ChatConversation` struct and db functions in `db/chat.rs` (AC: #2, #3, #4, #5)
  - [ ] Add `pub agent_id: String` field to `ChatConversation` struct (derive already includes `Serialize`)
  - [ ] Update `create_conversation` signature to `create_conversation(conn: &Connection, title: Option<&str>, agent_id: &str) -> Result<ChatConversation, AppError>`
  - [ ] Update `create_conversation` INSERT SQL to include `agent_id` column
  - [ ] Update `create_conversation` SELECT query to include `agent_id` in result mapping
  - [ ] Add new function `list_conversations_by_agent(conn: &Connection, agent_id: &str) -> Result<Vec<ChatConversation>, AppError>` — SQL: `SELECT id, title, agent_id, created_at, updated_at FROM chat_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC`
  - [ ] Update in-module test `setup_test_db` to include `agent_id` column in the CREATE TABLE DDL
  - [ ] Write Rust unit test `test_create_conversation_with_agent_id`
  - [ ] Write Rust unit test `test_list_conversations_by_agent_returns_scoped_results`
  - [ ] Write Rust unit test `test_list_conversations_by_agent_empty`

- [ ] Task 3: Update `send_chat_message` command in `commands/chat.rs` to accept and use `agent_id` (AC: #6, #7)
  - [ ] Add `agent_id: String` parameter to `send_chat_message` function signature
  - [ ] In the `conversation_id` is `None` branch: pass `agent_id.as_str()` to `chat_db::create_conversation`; set title from first 40 chars of `message` (trimmed): `let title = message.chars().take(40).collect::<String>(); let title = title.trim();`
  - [ ] In the existing `conversation_id` branch: do NOT use passed `agent_id` — the conversation's stored `agent_id` takes precedence
  - [ ] Pass the `agent_id` to `chat_ai::build_system_prompt` (after Task 4 updates its signature)
  - [ ] Write Rust unit test `test_conversation_title_auto_generated_from_first_message` (test via `db/chat.rs` create then inspect title)
  - [ ] Write Rust unit test `test_existing_conversation_agent_id_unchanged`

- [ ] Task 4: Update `build_system_prompt` in `ai/chat.rs` to accept and dispatch on `agent_id` (AC: #8, #9)
  - [ ] Update signature to `pub fn build_system_prompt(agent_id: &str, today: &str, context: &str) -> String`
  - [ ] Wrap the function body in a `match agent_id { "budget-helper" => { ...existing prompt... }, _ => { ...same existing prompt as default fallback... } }`
  - [ ] Update the single call site in `commands/chat.rs` to pass `agent_id` as the first argument

- [ ] Task 5: Add `list_conversations` Tauri command in `commands/chat.rs` (AC: #10)
  - [ ] Add new `#[tauri::command(rename_all = "snake_case")] pub fn list_conversations(state: State<DbState>, agent_id: String) -> Result<Vec<chat_db::ChatConversation>, AppError>` function
  - [ ] Implementation: lock DB state, call `chat_db::list_conversations_by_agent(&conn, &agent_id)`

- [ ] Task 6: Register `list_conversations` in `lib.rs` (AC: #10)
  - [ ] Add `commands::chat::list_conversations` to the `invoke_handler!` macro in `lib.rs`

- [ ] Task 7: Verify compilation — zero warnings, zero errors
  - [ ] Run `cargo check` in `apps/desktop/src-tauri/`
  - [ ] Resolve any unused variable warnings from new `agent_id` parameter or changed function signatures
  - [ ] Run `cargo test` — all existing tests plus new tests must pass

## Dev Notes

### Critical Architecture Rules to Follow

- All database queries MUST live in `db/chat.rs` — never in `commands/chat.rs`
- `commands/chat.rs` only orchestrates: lock state → call db function → return
- Every Tauri command MUST have `#[tauri::command(rename_all = "snake_case")]` and return `Result<T, AppError>`
- DB state locking pattern: `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?`
- All Rust structs must derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` — but `ChatConversation` currently only derives `Debug, Clone, Serialize` (no `Deserialize` needed for response structs — keep as-is)

### Migration System

The project uses a version-numbered SQL file migration system in `apps/desktop/src-tauri/migrations/`. The current highest migration is **016** (`016_recurring_expenses.sql`). The next migration must be **017**.

The migration is registered in `db/mod.rs` in the `MIGRATIONS` const array as `(17, include_str!("../../migrations/017_chat_agent_id.sql"))`.

The migration runner in `run_migrations()` applies each migration in a transaction and records the version in `schema_version`. SQLite's `ALTER TABLE ... ADD COLUMN ... DEFAULT 'budget-helper'` automatically backfills all existing rows with the default value — no separate UPDATE statement needed.

**Migration SQL content for `017_chat_agent_id.sql`:**
```sql
ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'budget-helper';
CREATE INDEX IF NOT EXISTS idx_chat_conversations_agent_id ON chat_conversations(agent_id);
```

### `ChatConversation` Struct Changes

Current struct (in `db/chat.rs`):
```rust
#[derive(Debug, Clone, Serialize)]
pub struct ChatConversation {
    pub id: i64,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

Updated struct — add `agent_id` field:
```rust
#[derive(Debug, Clone, Serialize)]
pub struct ChatConversation {
    pub id: i64,
    pub title: Option<String>,
    pub agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}
```

All SELECT queries that return `ChatConversation` must now include `agent_id` in the column list and row mapping. The column index order matters in rusqlite `row.get(N)` — ensure the order in SELECT matches the struct field mapping order in the closure.

### `create_conversation` Signature Change

Current: `pub fn create_conversation(conn: &Connection, title: Option<&str>) -> Result<ChatConversation, AppError>`

New: `pub fn create_conversation(conn: &Connection, title: Option<&str>, agent_id: &str) -> Result<ChatConversation, AppError>`

The INSERT SQL becomes:
```sql
INSERT INTO chat_conversations (title, agent_id) VALUES (?1, ?2)
```
params: `params![title, agent_id]`

The SELECT after INSERT must include `agent_id`:
```sql
SELECT id, title, agent_id, created_at, updated_at FROM chat_conversations WHERE id = ?1
```

### `list_conversations_by_agent` New Function

```rust
pub fn list_conversations_by_agent(
    conn: &Connection,
    agent_id: &str,
) -> Result<Vec<ChatConversation>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, agent_id, created_at, updated_at FROM chat_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC",
    )?;
    let conversations = stmt
        .query_map(params![agent_id], |row| {
            Ok(ChatConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(conversations)
}
```

### `send_chat_message` Changes

New signature addition — `agent_id: String` parameter:
```rust
pub async fn send_chat_message(
    app: AppHandle,
    db_state: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
    message: String,
    conversation_id: Option<i64>,
    agent_id: String,          // NEW parameter
) -> Result<SendMessageResult, AppError>
```

Title auto-generation when creating a new conversation:
```rust
let title: String = message.chars().take(40).collect();
let title = title.trim().to_string();
let conv = chat_db::create_conversation(&conn, Some(&title), &agent_id)?;
```

Note: use `.chars().take(40)` not byte slicing — avoids panics on multi-byte UTF-8 characters.

For **existing** conversation IDs, the `agent_id` parameter passed to `send_chat_message` is ignored. The conversation's stored `agent_id` is used by `build_system_prompt` — to get it, query the conversation record, or simply pass the `agent_id` parameter (which is already set correctly by the frontend from the route context). Since the goal is to prevent `agent_id` mutation on existing conversations, the simplest correct implementation is to use the passed `agent_id` for system prompt building but NOT to UPDATE the conversation's `agent_id`. The conversation INSERT path already stores the correct `agent_id` at creation time.

### `build_system_prompt` Signature Change

Current: `pub fn build_system_prompt(today: &str, context: &str) -> String`

New: `pub fn build_system_prompt(agent_id: &str, today: &str, context: &str) -> String`

Implementation pattern — wrap existing prompt in a match:
```rust
pub fn build_system_prompt(agent_id: &str, today: &str, context: &str) -> String {
    match agent_id {
        "budget-helper" | _ => {
            format!(r#"...existing budget helper prompt..."#, context)
        }
    }
}
```

Use `"budget-helper" | _` or simply `_` for the match arm — the point is that unrecognized agent IDs fall through to the same Budget Helper prompt as a safe default. This keeps the existing behavior 100% intact for the current sole agent while building the dispatch infrastructure for Story 15.2+.

Call site update in `commands/chat.rs`:
```rust
// Before:
let system_prompt = chat_ai::build_system_prompt(&today, &context);

// After:
let system_prompt = chat_ai::build_system_prompt(&agent_id, &today, &context);
```

### `list_conversations` New Tauri Command

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn list_conversations(
    state: State<DbState>,
    agent_id: String,
) -> Result<Vec<chat_db::ChatConversation>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    chat_db::list_conversations_by_agent(&conn, &agent_id)
}
```

Register in `lib.rs` in the `invoke_handler!` block alongside the other chat commands:
```rust
commands::chat::list_conversations,
```

### Rust Unit Test Requirements

All tests go in the `#[cfg(test)]` module in `db/chat.rs`. The existing `setup_test_db()` function creates the in-memory database schema — it must be updated to include the `agent_id` column.

**Updated `setup_test_db()`:**
```rust
fn setup_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE chat_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            agent_id TEXT NOT NULL DEFAULT 'budget-helper',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'chat',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .unwrap();
    conn
}
```

**Required new tests:**

```rust
#[test]
fn test_create_conversation_with_agent_id() {
    let conn = setup_test_db();
    let conv = create_conversation(&conn, Some("test"), "budget-helper").unwrap();
    assert_eq!(conv.agent_id, "budget-helper");
    assert_eq!(conv.title, Some("test".to_string()));
}

#[test]
fn test_list_conversations_by_agent_returns_scoped_results() {
    let conn = setup_test_db();
    create_conversation(&conn, Some("conv1"), "budget-helper").unwrap();
    create_conversation(&conn, Some("conv2"), "budget-helper").unwrap();
    create_conversation(&conn, Some("conv3"), "other-agent").unwrap();
    let results = list_conversations_by_agent(&conn, "budget-helper").unwrap();
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|c| c.agent_id == "budget-helper"));
}

#[test]
fn test_list_conversations_by_agent_empty() {
    let conn = setup_test_db();
    let results = list_conversations_by_agent(&conn, "budget-helper").unwrap();
    assert!(results.is_empty());
}
```

The `test_conversation_title_auto_generated_from_first_message` and `test_existing_conversation_agent_id_unchanged` tests involve the `send_chat_message` command which is async and requires an AI client — they are best tested via the db layer directly:

```rust
#[test]
fn test_create_conversation_stores_title() {
    let conn = setup_test_db();
    let long_msg = "This is a very long message that should be truncated at forty chars";
    let title: String = long_msg.chars().take(40).collect();
    let title = title.trim().to_string();
    let conv = create_conversation(&conn, Some(&title), "budget-helper").unwrap();
    assert_eq!(conv.title, Some("This is a very long message that should b".to_string()));
}
```

### Compilation Warning Prevention

- The new `agent_id` parameter in `send_chat_message` must be used — used in new conversation creation path AND passed to `build_system_prompt`
- The `conversation_exists` function in `db/chat.rs` is called from `get_chat_messages` command — ensure the existing test helpers still compile after `setup_test_db` DDL change
- `ChatConversation` does not derive `Deserialize` — this is intentional (it's only ever returned, never received as input). Do not add `Deserialize` to it.
- All SELECT queries reading `ChatConversation` must be updated to include `agent_id` in the column list, including `get_chat_messages` indirect path — but note `get_conversation_messages_for_display` returns `ChatMessage`, not `ChatConversation`, so that function is unaffected
- The `conversation_exists` function is also unaffected (uses `SELECT 1`, not the struct)

### No Frontend Changes

This story is **strictly Rust-only**. No TypeScript, no route files, no component files. The frontend for this story's changes comes in Stories 15.2, 15.3, and 15.4.

The frontend TypeScript type `ChatConversation` (currently in `apps/desktop/src/lib/types.ts`) will be updated in Story 15.3 — do not touch it in this story.

### Project Structure Notes

Files to create:
- `apps/desktop/src-tauri/migrations/017_chat_agent_id.sql` — new migration

Files to modify:
- `apps/desktop/src-tauri/src/db/mod.rs` — add migration (17, ...) to MIGRATIONS const
- `apps/desktop/src-tauri/src/db/chat.rs` — struct update, function signature changes, new function, updated tests
- `apps/desktop/src-tauri/src/commands/chat.rs` — `send_chat_message` new param, `list_conversations` new command
- `apps/desktop/src-tauri/src/ai/chat.rs` — `build_system_prompt` new signature
- `apps/desktop/src-tauri/src/lib.rs` — register `list_conversations`

No other files are touched in this story.

### References

- [Source: _bmad-output/planning-artifacts/epics-ai-section.md — Epic 15, Story 15.1]
- [Source: apps/desktop/src-tauri/src/db/chat.rs — existing ChatConversation struct, create_conversation, test setup patterns]
- [Source: apps/desktop/src-tauri/src/commands/chat.rs — send_chat_message command, existing orchestration pattern]
- [Source: apps/desktop/src-tauri/src/ai/chat.rs — build_system_prompt current signature and body]
- [Source: apps/desktop/src-tauri/src/db/mod.rs — MIGRATIONS const pattern, run_migrations logic]
- [Source: apps/desktop/src-tauri/migrations/013_chat_message_type.sql — ALTER TABLE pattern for chat_conversations]
- [Source: apps/desktop/src-tauri/src/lib.rs — invoke_handler registration pattern]
- [Source: _bmad-output/project-context.md — Tauri IPC rules, DB layer rules, AppError usage, Rust struct derivations]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
