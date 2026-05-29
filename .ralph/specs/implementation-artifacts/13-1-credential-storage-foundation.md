# Story 13.1: Credential Storage Foundation

Status: ready-for-dev

## Story

As a developer,
I want the Rust backend to support secure credential storage and a flexible AI provider abstraction,
so that user-entered API keys are stored safely in the OS keychain and the app can support both AWS Bedrock and OpenAI without hardcoded assumptions.

## Acceptance Criteria

**AC1: `keyring` and `async-openai` dependencies added**
Given the Cargo.toml is updated
When the project is compiled
Then `keyring = "4"` and `async-openai` are present as dependencies
And the project compiles without errors or warnings

**AC2: `credentials.rs` module created as sole keyring interface**
Given the new `src-tauri/src/credentials.rs` module
When a command needs to read or write API keys
Then it calls `credentials.rs` functions only — never accesses `keyring::Entry` directly
And the module exposes: `store_aws_credentials`, `load_aws_credentials`, `store_openai_key`, `load_openai_key`, `clear_credentials`
And the keyring service name is always `"nkbaz-finance"`

**AC3: `AiProvider` enum and `AiState` refactored**
Given the refactored `src-tauri/src/ai/mod.rs`
When the app initializes
Then `AiProvider` is an enum with variants `Bedrock(aws_sdk_bedrockruntime::Client)` and `OpenAI(async_openai::Client<OpenAIConfig>)`
And `AiState` holds `provider: Option<AiProvider>` (not a bare `Client`)
And `init_ai_client(conn: &Connection) -> AiState` reads provider selection from the `config` table then resolves credentials via `credentials.rs`

**AC4: Credential resolution chain implemented**
Given `init_ai_client` is called at startup
When it reads the `config` table:
- If `ai_provider = "bedrock"` and keyring has `aws_access_key_id` + `aws_secret_access_key` → build Bedrock client with explicit credentials
- If `ai_provider = "bedrock"` and keyring is empty → call `aws_config::defaults()` (picks up `~/.aws/credentials` automatically)
- If `ai_provider = "openai"` and keyring has `openai_api_key` → build OpenAI client
- If `ai_provider = "openai"` and keyring is empty → check `OPENAI_API_KEY` env var; if absent → `AiState { provider: None }`
- If `ai_configured = "false"` or config key absent → `AiState { provider: None }` immediately

**AC5: `AppError` extended with two new AI variants**
Given `src-tauri/src/error.rs`
When the new variants are added
Then `AiServiceError::NotConfigured` exists — used when `provider` is `None`
And `AiServiceError::InvalidCredentials` exists — used when stored credentials are rejected (401/403)
And `AiServiceError::Unavailable` still exists unchanged — used for network errors / timeouts

**AC6: `lib.rs` wires new `AiState` initialization**
Given the updated `lib.rs` setup function
When the app starts
Then `init_db()` is called first (sync)
Then `init_ai_client(&conn)` is called with DB access (reads config table)
Then `app.manage(Mutex::new(ai_state))` registers the state
And all AI commands receive `State<'_, Mutex<AiState>>` (not the old bare `AiState`)

**AC7: Existing AI commands (`import.rs`, `chat.rs`) compile after refactor**
Given the `AiState` shape has changed
When `commands/import.rs` and `commands/chat.rs` are updated to use `Mutex<AiState>`
Then they lock the mutex and access `ai_state.provider` to get the client
And they return `Err(AppError::AiService(AiServiceError::NotConfigured))` if `provider` is `None`
And the rest of the command body is unchanged

## Tasks / Subtasks

### Task 1: Add Cargo dependencies [AC1]
- [ ] Add `keyring = "4"` to `[dependencies]` in `src-tauri/Cargo.toml`
- [ ] Add `async-openai = "0.27"` to `[dependencies]` in `src-tauri/Cargo.toml`
- [ ] Run `cargo check` to confirm they resolve correctly

### Task 2: Create `credentials.rs` [AC2]
- [ ] Create `src-tauri/src/credentials.rs`
- [ ] Define `const KEYRING_SERVICE: &str = "nkbaz-finance";`
- [ ] Implement `store_aws_credentials(access_key: &str, secret_key: &str, region: &str) -> Result<(), keyring::Error>`
- [ ] Implement `load_aws_credentials() -> Option<(String, String, String)>` (returns access_key, secret_key, region or None)
- [ ] Implement `store_openai_key(api_key: &str) -> Result<(), keyring::Error>`
- [ ] Implement `load_openai_key() -> Option<String>`
- [ ] Implement `clear_credentials()` — deletes all four keyring entries, ignores "not found" errors
- [ ] Use exact entry keys: `"aws_access_key_id"`, `"aws_secret_access_key"`, `"aws_region"`, `"openai_api_key"`
- [ ] Declare `pub mod credentials;` in `lib.rs`

### Task 3: Refactor `ai/mod.rs` [AC3, AC4]
- [ ] Define `pub enum AiProvider` with `Bedrock(aws_sdk_bedrockruntime::Client)` and `OpenAI(async_openai::Client<async_openai::config::OpenAIConfig>)` variants
- [ ] Redefine `pub struct AiState { pub provider: Option<AiProvider> }`
- [ ] Rewrite `pub async fn init_ai_client(conn: &rusqlite::Connection) -> AiState`:
  - [ ] Read `ai_provider` from config table (`db::config::get(conn, "ai_provider")`)
  - [ ] Read `ai_configured` from config table; return `AiState { provider: None }` immediately if `"false"` or absent
  - [ ] For `"bedrock"`: call `credentials::load_aws_credentials()` — if Some, build explicit AWS config; if None, use `aws_config::defaults()`
  - [ ] For `"openai"`: call `credentials::load_openai_key()` — if None, check `OPENAI_API_KEY` env var; if still None, return `AiState { provider: None }`
  - [ ] Never panic — return `AiState { provider: None }` on any error
- [ ] Update `cc_parser.rs` and `chat.rs` in `ai/` to accept `&aws_sdk_bedrockruntime::Client` directly (extracted from the enum by the command layer)

### Task 4: Extend `error.rs` [AC5]
- [ ] Add `NotConfigured` variant to `AiServiceError` enum (or equivalent error path)
- [ ] Add `InvalidCredentials` variant to `AiServiceError` enum
- [ ] Ensure serialized JSON for `NotConfigured`: `{ "type": "not_configured", "message": "AI provider not configured", "setup_url": "/settings" }`
- [ ] Ensure serialized JSON for `InvalidCredentials`: `{ "type": "invalid_credentials", "message": "AI credentials are invalid", "setup_url": "/settings" }`

### Task 5: Update `lib.rs` [AC6]
- [ ] Change `AiState` managed state from `app.manage(ai_state)` to `app.manage(Mutex::new(ai_state))`
- [ ] Add `use std::sync::Mutex;` import
- [ ] Pass DB connection reference to `init_ai_client(&conn).await` after `init_db()` completes
- [ ] Ensure `init_ai_client` is awaited in the async setup context (Tauri 2 `setup` callback is sync; use `tauri::async_runtime::block_on` if needed)

### Task 6: Update `commands/import.rs` and `commands/chat.rs` [AC7]
- [ ] Change parameter type from `State<'_, AiState>` to `State<'_, Mutex<AiState>>`
- [ ] At the top of each command handler, lock the mutex: `let ai = state.lock().unwrap();`
- [ ] Match on `ai.provider`:
  - [ ] `None` → `return Err(AppError::AiService(AiServiceError::NotConfigured))`
  - [ ] `Some(AiProvider::Bedrock(client))` → pass `client` to the AI module function
  - [ ] `Some(AiProvider::OpenAI(_))` → for now: `return Err(AppError::AiService(AiServiceError::NotConfigured))` (OpenAI integration is wired in Story 13.2)
- [ ] Drop the lock before any async operations to avoid holding it across await points

### Task 7: Add `db/config.rs` helper if not already present
- [ ] Check if a `db::config` module exists with `get(conn, key) -> Option<String>` and `set(conn, key, value)`
- [ ] If not, create `src-tauri/src/db/config.rs` with those two functions operating on the existing `config` table
- [ ] Declare module in `db/mod.rs`

## Dev Notes

### Architecture Reference
This story implements the foundation decisions from `architecture-credentials.md`:
- Credential storage: `keyring` v4 — OS Keychain (macOS), Credential Manager (Windows)
- AI provider abstraction: enum dispatch, not trait objects
- Resolution chain: keyring → `aws_config::defaults()` → `None`
- `AiState` as `Option<AiProvider>` wrapped in `Mutex`

[Source: `_bmad-output/planning-artifacts/architecture-credentials.md#Core Architectural Decisions`]

### Keyring Entry Keys (exact strings, no deviations)
```rust
const KEYRING_SERVICE: &str = "nkbaz-finance";
// Entry keys:
// "aws_access_key_id"
// "aws_secret_access_key"
// "aws_region"
// "openai_api_key"
```

### `AiState` Mutex Pattern
`AiState` is now behind a `Mutex` so commands can update it in-place when credentials are saved (Story 13.2). Lock the mutex, read the provider, **drop the lock before any `.await`** to avoid holding it across async boundaries.

```rust
// Correct:
let provider = {
    let ai = state.lock().unwrap();
    ai.provider.clone()  // or match and extract client ref
};
// Then use provider below...
```

If `Client` types don't implement `Clone`, match inside the lock, extract what you need (e.g., clone the `Arc`-based client handle), then drop. Alternatively restructure `AiProvider` variants to hold `Arc<Client>` for cheap cloning.

### `init_ai_client` Startup Ordering
In Tauri 2, the `setup` closure is synchronous. Use `tauri::async_runtime::block_on(init_ai_client(&conn))` to await the async function inside the sync setup. The DB connection must be initialized first.

### Config Table Keys Used in This Story
| Key | Value |
|-----|-------|
| `ai_provider` | `"bedrock"` \| `"openai"` |
| `ai_configured` | `"true"` \| `"false"` |
| `aws_region` | e.g. `"us-east-1"` |

These are read-only in this story. Story 13.2 writes them.

### Scope Boundaries
**IN SCOPE:** `credentials.rs`, `ai/mod.rs` refactor, `error.rs` extension, `lib.rs` wiring, updating `import.rs` and `chat.rs` to compile with new `Mutex<AiState>` shape, optional `db/config.rs` helper.

**OUT OF SCOPE:** `commands/settings.rs` (Story 13.2), all frontend work (Story 13.3), OpenAI chat/import integration (Story 13.2 wires the commands, deeper OpenAI prompt work is future).

### Project Structure Notes

**Files to create:**
- `src-tauri/src/credentials.rs`
- `src-tauri/src/db/config.rs` (if not already present)

**Files to modify:**
- `src-tauri/Cargo.toml` — add `keyring`, `async-openai`
- `src-tauri/src/ai/mod.rs` — full refactor
- `src-tauri/src/error.rs` — add two error variants
- `src-tauri/src/lib.rs` — `Mutex<AiState>`, updated init
- `src-tauri/src/commands/import.rs` — `Mutex<AiState>`, `NotConfigured` guard
- `src-tauri/src/commands/chat.rs` — `Mutex<AiState>`, `NotConfigured` guard
- `src-tauri/src/db/mod.rs` — declare `config` module if new

### References
- Architecture: `_bmad-output/planning-artifacts/architecture-credentials.md` — all sections
- Architecture (base): `_bmad-output/planning-artifacts/architecture-desktop.md` — AI service boundary, IPC patterns, error handling
- Prior AI story: `_bmad-output/implementation-artifacts/6-2-ai-extraction-and-categorization-pipeline.md` — existing `ai/mod.rs` and `commands/import.rs` patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
