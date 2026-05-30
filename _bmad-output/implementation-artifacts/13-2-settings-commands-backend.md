# Story 13.2: Settings Commands Backend

Status: ready-for-dev

## Story

As a user,
I want to save, update, and clear AI provider credentials from within the app,
so that my API keys are validated and securely persisted without needing to set environment variables.

## Acceptance Criteria

**AC1: `get_ai_config` returns provider status without secrets**
Given a frontend component invokes `get_ai_config`
When the command runs
Then it returns `{ provider: "bedrock" | "openai" | null, configured: bool, region: String }`
And it NEVER returns actual key values — not even masked
And it reads `ai_provider` and `ai_configured` from the SQLite `config` table

**AC2: `save_aws_credentials` validates before persisting**
Given the user submits AWS access key, secret key, and region
When `save_aws_credentials` is invoked
Then it builds a temporary Bedrock client with the submitted credentials
Then it calls `bedrock_runtime.list_foundation_models()` as a lightweight validation test
If validation fails → return `Err(AppError::AiService(AiServiceError::InvalidCredentials))` and write NOTHING to keyring
If validation succeeds →
  - Write credentials to keyring via `credentials::store_aws_credentials`
  - Write `config` table: `ai_provider = "bedrock"`, `aws_region = region`, `ai_configured = "true"`
  - Lock `Mutex<AiState>` and replace `provider` with `Some(AiProvider::Bedrock(new_client))`
  - Return `Ok(())`

**AC3: `save_openai_credentials` validates before persisting**
Given the user submits an OpenAI API key
When `save_openai_credentials` is invoked
Then it builds a temporary OpenAI client and calls `GET /v1/models` as validation
If validation fails → return `Err(AppError::AiService(AiServiceError::InvalidCredentials))` and write NOTHING to keyring
If validation succeeds →
  - Write API key to keyring via `credentials::store_openai_key`
  - Write `config` table: `ai_provider = "openai"`, `ai_configured = "true"`
  - Lock `Mutex<AiState>` and replace `provider` with `Some(AiProvider::OpenAI(new_client))`
  - Return `Ok(())`

**AC4: `clear_ai_credentials` fully resets AI state**
Given the user invokes `clear_ai_credentials`
When the command runs
Then `credentials::clear_credentials()` is called (removes all keyring entries)
Then config table: `ai_configured = "false"`
Then `Mutex<AiState>` is locked and `provider` set to `None`
Then `Ok(())` is returned

**AC5: `test_ai_connection` reports current connection health**
Given a frontend component invokes `test_ai_connection`
When the command runs and `AiState.provider` is `None`
Then it returns `Err(AppError::AiService(AiServiceError::NotConfigured))`
When `provider` is `Some(Bedrock)` → make the same lightweight `list_foundation_models` call
When `provider` is `Some(OpenAI)` → make the same `GET /v1/models` call
Then return `Ok({ "status": "connected", "provider": "bedrock" | "openai" })` on success
Or `Err(AppError::AiService(AiServiceError::Unavailable))` on network failure

**AC6: All 5 commands are registered in `lib.rs`**
Given the updated `lib.rs`
When the app starts
Then `get_ai_config`, `save_aws_credentials`, `save_openai_credentials`, `clear_ai_credentials`, `test_ai_connection` are all in the `invoke_handler` macro
And `commands::settings` is exported from `commands/mod.rs`

**AC7: `NotConfigured` guard active in import and chat commands**
Given Story 13.1 wired `Mutex<AiState>` into `import.rs` and `chat.rs`
When those commands run with `provider = None`
Then they return `AiServiceError::NotConfigured` immediately
And this is verified end-to-end: the frontend receives `{ "type": "not_configured", "setup_url": "/settings" }` in the error payload

## Tasks / Subtasks

### Task 1: Create `commands/settings.rs` [AC1–AC5]
- [ ] Create `src-tauri/src/commands/settings.rs`
- [ ] Implement `get_ai_config(db: State<'_, DbState>) -> Result<AiConfigResponse, AppError>`
  - [ ] Define struct: `AiConfigResponse { provider: Option<String>, configured: bool, region: String }`
  - [ ] Read `ai_provider`, `ai_configured`, `aws_region` from config table
  - [ ] Return struct — never return any key values
- [ ] Implement `save_aws_credentials(access_key: String, secret_key: String, region: String, db: State<'_, DbState>, ai_state: State<'_, Mutex<AiState>>) -> Result<(), AppError>`
  - [ ] Build temporary Bedrock client with submitted credentials using explicit `aws_config` credentials provider
  - [ ] Call `list_foundation_models().send().await` — on error, return `Err(AiServiceError::InvalidCredentials)`
  - [ ] On success: call `credentials::store_aws_credentials(&access_key, &secret_key, &region)`
  - [ ] Write config table: `set(conn, "ai_provider", "bedrock")`, `set(conn, "aws_region", &region)`, `set(conn, "ai_configured", "true")`
  - [ ] Lock `ai_state`, replace provider: `ai_state.lock().unwrap().provider = Some(AiProvider::Bedrock(new_client))`
  - [ ] Return `Ok(())`
- [ ] Implement `save_openai_credentials(api_key: String, db: State<'_, DbState>, ai_state: State<'_, Mutex<AiState>>) -> Result<(), AppError>`
  - [ ] Build `async_openai::Client` with submitted key
  - [ ] Call `client.models().list().await` — on error, return `Err(AiServiceError::InvalidCredentials)`
  - [ ] On success: call `credentials::store_openai_key(&api_key)`
  - [ ] Write config table: `set(conn, "ai_provider", "openai")`, `set(conn, "ai_configured", "true")`
  - [ ] Lock `ai_state`, replace provider: `ai_state.lock().unwrap().provider = Some(AiProvider::OpenAI(new_client))`
  - [ ] Return `Ok(())`
- [ ] Implement `clear_ai_credentials(db: State<'_, DbState>, ai_state: State<'_, Mutex<AiState>>) -> Result<(), AppError>`
  - [ ] Call `credentials::clear_credentials()`
  - [ ] Write config: `set(conn, "ai_configured", "false")`
  - [ ] Lock `ai_state`, set `provider = None`
  - [ ] Return `Ok(())`
- [ ] Implement `test_ai_connection(ai_state: State<'_, Mutex<AiState>>) -> Result<TestConnectionResponse, AppError>`
  - [ ] Define struct: `TestConnectionResponse { status: String, provider: String }`
  - [ ] Lock `ai_state`; if `provider` is `None` → return `Err(AiServiceError::NotConfigured)`
  - [ ] For Bedrock: call `list_foundation_models`, return `Ok(TestConnectionResponse { status: "connected", provider: "bedrock" })` or `Err(AiServiceError::Unavailable)`
  - [ ] For OpenAI: call `models().list()`, return `Ok(...)` or `Err(AiServiceError::Unavailable)`

### Task 2: Export settings commands [AC6]
- [ ] Add `pub mod settings;` to `src-tauri/src/commands/mod.rs`
- [ ] Add all 5 functions to the `invoke_handler![]` macro in `src-tauri/src/lib.rs`:
  ```rust
  commands::settings::get_ai_config,
  commands::settings::save_aws_credentials,
  commands::settings::save_openai_credentials,
  commands::settings::clear_ai_credentials,
  commands::settings::test_ai_connection,
  ```

### Task 3: Verify `NotConfigured` guard end-to-end [AC7]
- [ ] Confirm `commands/import.rs` returns `AiServiceError::NotConfigured` JSON when `provider` is `None` (from Story 13.1)
- [ ] Confirm `commands/chat.rs` returns `AiServiceError::NotConfigured` JSON when `provider` is `None` (from Story 13.1)
- [ ] Confirm the serialized error payload matches: `{ "type": "not_configured", "message": "AI provider not configured", "setup_url": "/settings" }`

### Task 4: Confirm config table has `set` / `get` helpers
- [ ] Verify `db::config::get(conn, key)` and `db::config::set(conn, key, value)` exist (created in Story 13.1 if needed)
- [ ] Verify config table migration includes the `config` table DDL (should already exist from base architecture)

## Dev Notes

### Architecture Reference
[Source: `_bmad-output/planning-artifacts/architecture-credentials.md#Settings Commands Backend`]

### Write-After-Validation Rule (Critical)
Never write to keyring before the test call succeeds. The exact sequence is:
1. Build temporary client
2. Make test call → on failure, return error immediately
3. On success only: write keyring → write config table → update `Mutex<AiState>`

Reversing this order leaves the app in a broken state if the write succeeds but validation later fails.

### `Mutex<AiState>` In-Place Update
```rust
// Correct — update in-place, don't restart the app
let mut ai = ai_state.lock().unwrap();
ai.provider = Some(AiProvider::Bedrock(new_client));
// Drop lock implicitly here
```

Do NOT call `init_ai_client()` from within a command handler. The `Mutex<AiState>` is updated directly.

### Building Temporary Bedrock Client for Validation
```rust
use aws_config::BehaviorVersion;
use aws_sdk_bedrockruntime::config::Credentials;

let creds = Credentials::new(&access_key, &secret_key, None, None, "nkbaz-user");
let config = aws_config::defaults(BehaviorVersion::latest())
    .region(aws_config::Region::new(region.clone()))
    .credentials_provider(creds)
    .load()
    .await;
let client = aws_sdk_bedrockruntime::Client::new(&config);
client.list_foundation_models().send().await
    .map_err(|_| AppError::AiService(AiServiceError::InvalidCredentials))?;
```

### Building Temporary OpenAI Client for Validation
```rust
use async_openai::{Client, config::OpenAIConfig};

let config = OpenAIConfig::new().with_api_key(&api_key);
let client = Client::with_config(config);
client.models().list().await
    .map_err(|_| AppError::AiService(AiServiceError::InvalidCredentials))?;
```

### `get_ai_config` Security Rule
This command must NEVER return key values. It exists solely to tell the frontend:
- Which provider is selected (`"bedrock"` | `"openai"` | `null`)
- Whether the app is configured (`bool`)
- The AWS region (`String`, non-secret)

If in doubt, return less information, not more.

### Config Table Keys Written in This Story
| Key | Value | Written by |
|-----|-------|-----------|
| `ai_provider` | `"bedrock"` \| `"openai"` | `save_aws_credentials`, `save_openai_credentials` |
| `aws_region` | e.g. `"us-east-1"` | `save_aws_credentials` |
| `ai_configured` | `"true"` \| `"false"` | all save + clear commands |

### Scope Boundaries
**IN SCOPE:** `commands/settings.rs`, registration in `lib.rs` and `commands/mod.rs`, config table writes, `Mutex<AiState>` in-place updates, end-to-end verification of `NotConfigured` guard.

**OUT OF SCOPE:** All frontend code (Story 13.3). OpenAI chat/import prompt logic (future story — this story only wires the client into `AiState`).

**DEPENDS ON:** Story 13.1 — `credentials.rs`, `AiProvider` enum, `Mutex<AiState>`, `error.rs` variants, and `db/config.rs` must all exist.

### Project Structure Notes

**Files to create:**
- `src-tauri/src/commands/settings.rs`

**Files to modify:**
- `src-tauri/src/commands/mod.rs` — add `pub mod settings;`
- `src-tauri/src/lib.rs` — register 5 new commands in `invoke_handler!`

### References
- Architecture: `_bmad-output/planning-artifacts/architecture-credentials.md#Settings Commands Backend` and `#Credential Validation Strategy`
- Story 13.1: `_bmad-output/implementation-artifacts/13-1-credential-storage-foundation.md` — provides `credentials.rs`, `AiProvider`, `Mutex<AiState>`, `error.rs` variants
- Existing command pattern: `_bmad-output/implementation-artifacts/8-2-database-backup-and-restore.md` — example of commands that combine db + file system operations

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
