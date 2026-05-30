---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-05-18'
inputDocuments:
  - architecture-desktop.md
  - prd.md
workflowType: 'architecture'
feature: 'credential-management'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-05-18'
---

# Architecture Decision Document — Credential Management

_Scoped addendum to `architecture-desktop.md`. Covers AI provider credential storage, resolution chain, provider abstraction, and graceful degradation for the desktop app._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

This feature adds three user-facing capabilities and one system behavior:

- **FR-CRED-1:** User can enter AWS credentials (access key + secret key) in the app UI and have them persist across sessions
- **FR-CRED-2:** User can enter an OpenAI API key in the app UI and have it persist across sessions
- **FR-CRED-3:** If no user-entered AWS credentials exist, the app falls back to `~/.aws/credentials` (existing AWS SDK behavior — no new code required)
- **FR-CRED-4:** When a user attempts to use an AI feature with no valid credentials configured, the app displays a clear setup prompt rather than an error

**Non-Functional Requirements:**

| NFR | Implication |
|-----|-------------|
| Credentials must be stored securely | Cannot use SQLite plaintext or Tauri JSON store; requires OS keychain or equivalent |
| App must remain fully functional without AI credentials | All CRUD features, dashboard, budget — unaffected when AI is unconfigured |
| Graceful degradation on AI calls | `AiState` must represent "not configured"; commands return a user-friendly `AiServiceError::NotConfigured` |

**Scale & Complexity:**

- Scope: Focused addendum — touches `ai/`, `commands/chat.rs`, `commands/import.rs`, `db/` (config table), and one new settings UI surface
- Complexity: Medium — credential storage security is non-trivial; provider abstraction is a mild breaking change to the current `ai/` module
- New dependencies: 1 Rust crate for keychain access; possibly 1 for OpenAI HTTP calls

### Technical Constraints & Dependencies

- **Existing architecture is Bedrock-only** — `ai/mod.rs` wraps `aws_sdk_bedrockruntime::Client` directly; no provider abstraction exists
- **`aws_config::defaults()` already chains** env vars → `~/.aws/credentials` → instance metadata — the `~/.aws/` fallback is free if we don't override it
- **Tauri app data directory** is the right location for any credential config file; `tauri::Manager::app_data_dir()` is already used for SQLite
- **macOS primary target** — Keychain is the canonical secret store; Windows Credential Manager and Linux Secret Service are secondary

### Cross-Cutting Concerns Identified

1. **Provider Abstraction** — `ai/mod.rs` must be refactored from a single Bedrock client to an enum/trait that can dispatch to either Bedrock or OpenAI
2. **Secure Credential Storage** — API keys are secrets; OS keychain via the `keyring` crate is the standard Rust approach
3. **App Startup Change** — `init_ai_client()` currently panics-or-assumes on missing credentials; must become optional/lazy
4. **Settings UI** — No settings page exists today; this feature introduces one
5. **Credential Validation** — When are entered credentials tested? On save (eager) or on first use (lazy)?

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Credential storage mechanism: `keyring` v4 (OS-native — Keychain on macOS, Credential Manager on Windows)
- AI provider abstraction: enum dispatch (`AiProvider` enum with `Bedrock` and `OpenAI` variants)
- `AiState` restructure: `Option<AiProvider>` — `None` represents not-configured state
- `AppError` extension: new `AiServiceError::NotConfigured` variant

**Important Decisions (Shape Architecture):**
- OpenAI SDK: `async-openai` crate (community SDK, ~2M downloads, idiomatic async)
- Credential resolution chain: keyring → AWS SDK default chain (`~/.aws/credentials`) → `NotConfigured`
- Settings route: new `/settings` TanStack Router route (expandable for future settings)
- Validation strategy: eager — test call on save, immediate user feedback

**Deferred Decisions (Post-MVP):**
- Additional AI providers (Anthropic, Cohere, etc.) — enum is already extensible
- Per-account credential scoping (all credentials are global for now)
- Credential rotation / expiry notifications

### Credential Storage

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage mechanism | `keyring` v4 crate | OS-native: Keychain on macOS (hardware-backed on Apple Silicon), Windows Credential Manager on Windows, Secret Service on Linux. No crypto code to maintain. Standard practice for desktop apps (same as Chrome, VS Code Git Credential Manager) |
| Keyring service name | `"nkbaz-finance"` | Consistent app identifier across all credential entries |
| Keyring entry keys | `"aws_access_key_id"`, `"aws_secret_access_key"`, `"aws_region"`, `"openai_api_key"` | One keyring entry per secret value |
| Thread safety | Single-threaded keychain access only | `keyring` crate docs note: don't access same entry from multiple threads concurrently |

### AI Provider Abstraction

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Abstraction pattern | Enum dispatch | Two providers; enum is explicit, zero overhead, idiomatic Rust. No need for `Box<dyn Trait>` yet |
| OpenAI SDK | `async-openai` crate | Well-maintained community SDK; avoids hand-rolling HTTP + JSON parsing for OpenAI's API |
| Provider selection storage | SQLite `config` table (key: `"ai_provider"`, value: `"bedrock"` \| `"openai"`) | Not a secret; already-established config table pattern |
| AWS region storage | SQLite `config` table (key: `"aws_region"`, default: `"us-east-1"`) | Not a secret; user-visible preference |

### Credential Resolution Chain

**AWS Bedrock:**
```
1. keyring("aws_access_key_id") + keyring("aws_secret_access_key") present
   → Build explicit AWS config with stored credentials
2. Keyring entries absent
   → aws_config::defaults() — SDK automatically reads ~/.aws/credentials, env vars, instance metadata
3. aws_config::defaults() yields no credentials
   → AiState { provider: None }  (NotConfigured)
```

**OpenAI:**
```
1. keyring("openai_api_key") present
   → Build OpenAI client with stored key
2. Keyring absent → check OPENAI_API_KEY env var (convenience for power users)
3. Neither present
   → AiState { provider: None }  (NotConfigured)
```

### AiState Restructure

**Before:**
```rust
pub struct AiState {
    pub bedrock: Client,
}
pub async fn init_ai_client() -> AiState { ... }
```

**After:**
```rust
pub enum AiProvider {
    Bedrock(aws_sdk_bedrockruntime::Client),
    OpenAI(async_openai::Client<async_openai::config::OpenAIConfig>),
}

pub struct AiState {
    pub provider: Option<AiProvider>,  // None = not configured
}

pub async fn init_ai_client(db: &Connection) -> AiState { ... }
// Reads provider selection from config table, resolves credentials via keyring,
// returns AiState { provider: None } if nothing is configured — never panics
```

### Settings UI

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Route | `/settings` — new TanStack Router route | Dedicated page; expandable for future preferences (language, theme, backup schedule, etc.) |
| Sidebar placement | Settings icon at bottom of sidebar (below nav items) | Standard desktop app convention |
| Component | `src/routes/settings.tsx` + `src/components/settings/CredentialsForm.tsx` | Follows existing feature-based organization |
| Provider switcher | Radio group: "AWS Bedrock" / "OpenAI" — shows relevant credential fields | Single active provider per session |
| Validation feedback | Inline success/error banner within the form after save | Follows existing inline error pattern (no modals) |

### Credential Validation Strategy

**Eager validation on save:**

| Provider | Test call | Success signal |
|----------|-----------|----------------|
| AWS Bedrock | `bedrock_runtime.list_foundation_models()` (lightweight, read-only) | 200 OK |
| OpenAI | `GET /v1/models` (lightweight, read-only) | 200 OK |

If validation fails, credentials are NOT persisted to keyring and the user sees an inline error. If validation succeeds, credentials are written to keyring and `AiState` is updated in the Tauri app state.

### Graceful Degradation

**New `AppError` variant:**
```rust
AiServiceError::NotConfigured  // distinct from AiServiceError::Unavailable (network/timeout)
```

**Error flow:**
1. User triggers AI feature (`import_cc_statement`, `send_chat_message`) with `AiState { provider: None }`
2. Rust command returns `Err(AppError::AiService { type: "not_configured", message: "AI provider not set up", setup_url: "/settings" })`
3. Frontend catches `not_configured` type specifically
4. Renders inline prompt: *"AI not configured — [Open Settings →]"* (not a modal, not a red banner)
5. Other app features (CRUD, dashboard, budget) are completely unaffected

### Decision Impact Analysis

**Implementation Sequence:**
1. Add `keyring` and `async-openai` to `Cargo.toml`
2. New `src-tauri/src/commands/settings.rs` — `get_ai_config`, `save_aws_credentials`, `save_openai_credentials`, `test_credentials`, `clear_credentials`
3. Refactor `ai/mod.rs` — `AiProvider` enum, `AiState { provider: Option<AiProvider> }`, new `init_ai_client(db)`
4. Extend `AppError` with `AiServiceError::NotConfigured`
5. Update `commands/import.rs` and `commands/chat.rs` — check `provider.is_none()` and return `NotConfigured`
6. New `/settings` route + `CredentialsForm` component
7. Sidebar: add Settings nav item

**Cross-Component Dependencies:**
- `init_ai_client()` now needs DB access (to read provider selection from `config` table) — must run after DB init in `lib.rs`
- `AiState` is held in Tauri's managed state (`app.manage()`); credential save command must update it in-place via `Mutex<AiState>`
- Frontend Settings route uses TanStack Query mutation for `save_*_credentials` commands — on success, invalidates any `ai-status` query used by import/chat pages to show configuration state

## Project Structure & Boundaries

### New Files

**Rust backend:**

```
src-tauri/src/
├── credentials.rs               # NEW: all keyring read/write operations
├── commands/
│   └── settings.rs              # NEW: get_ai_config, save_aws_credentials,
│                                #      save_openai_credentials, clear_ai_credentials,
│                                #      test_ai_connection
```

**Frontend:**

```
src/
├── routes/
│   └── settings.tsx             # NEW: Settings page (provider selector + credential form)
├── components/
│   └── settings/
│       ├── CredentialsForm.tsx  # NEW: AWS or OpenAI form, validation feedback
│       └── ProviderSelector.tsx # NEW: Radio group — "AWS Bedrock" / "OpenAI"
├── hooks/
│   └── useAiConfig.ts           # NEW: TanStack Query hook for get_ai_config
```

### Modified Files

| File | Change |
|------|--------|
| `src-tauri/src/ai/mod.rs` | Refactor: `AiProvider` enum, `AiState { provider: Option<AiProvider> }`, new `init_ai_client(db)` |
| `src-tauri/src/error.rs` | Add `AiServiceError::NotConfigured` and `AiServiceError::InvalidCredentials` variants |
| `src-tauri/src/commands/mod.rs` | Export `settings` module |
| `src-tauri/src/commands/import.rs` | Add `NotConfigured` guard at top of handler |
| `src-tauri/src/commands/chat.rs` | Add `NotConfigured` guard at top of handler |
| `src-tauri/src/lib.rs` | Register `settings` commands; pass DB ref to `init_ai_client()`; wrap `AiState` in `Mutex` |
| `src-tauri/Cargo.toml` | Add `keyring = "4"` and `async-openai` dependencies |
| `src/components/shared/AppSidebar.tsx` | Add Settings nav item at bottom (alongside Backup/Restore) |
| `src/lib/types.ts` | Add `AiConfig`, `AiProvider` TypeScript types |

### Architectural Boundaries

**`credentials.rs` module — sole keyring interface:**
- Only module permitted to call `keyring::Entry`
- Exports: `store_aws_credentials()`, `load_aws_credentials()`, `store_openai_key()`, `load_openai_key()`, `clear_credentials()`
- Called by `commands/settings.rs` and `lib.rs` only — never by `ai/` directly

**`ai/mod.rs` (updated):**
- Reads provider selection from `config` table at startup
- Receives loaded credentials passed in from `lib.rs` — never touches keyring directly
- Owns `AiProvider` enum and `AiState` struct

**`commands/settings.rs` — sole credential writer:**
- Owns the validate → write → update `AiState` transaction
- The only writer to keyring (via `credentials.rs`) and `config` table AI keys
- Updates `Mutex<AiState>` in-place on successful save

### Data Flow

**Credential Save:**
```
User clicks Save in CredentialsForm
  → invoke("save_aws_credentials", { access_key, secret_key, region })
  → commands/settings.rs
    → Build Bedrock client with submitted credentials
    → Test call: bedrock.list_foundation_models()
    → On failure: return Err(AiService::InvalidCredentials)
    → On success:
      → credentials.rs: store_aws_credentials(...)
      → db/config: set("ai_provider", "bedrock"), set("ai_configured", "true")
      → Lock Mutex<AiState> → replace provider with new Bedrock client
      → return Ok(())
  → Frontend: invalidate ["ai-config"] → CredentialsForm shows success banner
```

**App Startup:**
```
lib.rs: setup()
  → init_db()
  → db/config: read ai_provider, ai_configured
  → if ai_configured == "true":
      → credentials.rs: load credentials from keyring
      → keyring hit  → AiState { provider: Some(AiProvider::Bedrock(...)) }
      → keyring miss → AiState { provider: None }  (show setup prompt on next AI use)
  → else: AiState { provider: None }
  → app.manage(Mutex::new(ai_state))
```

**AI Feature — Not Configured:**
```
User sends chat message
  → commands/chat.rs: ai.provider.is_none()
    → return Err(AiService::NotConfigured)
  → Frontend: render inline "AI not configured — [Open Settings →]"
```

### Requirements to Structure Mapping

| Requirement | Frontend | Rust Command | Rust Module |
|-------------|----------|--------------|-------------|
| Enter AWS credentials | `routes/settings.tsx`, `components/settings/CredentialsForm.tsx` | `commands/settings.rs` | `credentials.rs`, `ai/mod.rs` |
| Enter OpenAI API key | `routes/settings.tsx`, `components/settings/CredentialsForm.tsx` | `commands/settings.rs` | `credentials.rs`, `ai/mod.rs` |
| Fallback to `~/.aws` | — (transparent) | — | `ai/mod.rs` via `aws_config::defaults()` |
| "Not configured" prompt | `hooks/useAiConfig.ts`, error handler in `hooks/useChat.ts` + `hooks/useImport.ts` | `commands/chat.rs`, `commands/import.rs` | `error.rs` |

## Implementation Patterns & Consistency Rules

### Keyring Entry Naming

All keyring access is centralized in `src-tauri/src/credentials.rs`. No command or module accesses the keyring directly.

```rust
const KEYRING_SERVICE: &str = "nkbaz-finance";

// Exact entry key strings — never deviate:
// "aws_access_key_id"
// "aws_secret_access_key"
// "aws_region"
// "openai_api_key"
```

**Anti-pattern:** Accessing `keyring::Entry::new("nkbaz", "key")` inline in a command handler — always go through `credentials.rs`.

### AiState Mutation Pattern

After a successful `save_*_credentials` command, the live `AiState` in Tauri managed state must be updated in-place. Never restart the app to pick up new credentials.

```rust
// Correct — in save command handler:
let mut ai_state = ai_state.lock().unwrap();
ai_state.provider = Some(AiProvider::Bedrock(new_client));

// Wrong — do not call init_ai_client() again from a command
```

All AI commands receive `State<'_, Mutex<AiState>>` and lock it to read `provider`.

### Error Variant Rules

Three distinct `AiServiceError` variants — never conflate them:

| Variant | When to use | Frontend response |
|---------|-------------|-------------------|
| `NotConfigured` | `provider` is `None` — user has never set up credentials | Inline "Open Settings →" prompt |
| `Unavailable` | Credentials exist but service unreachable (timeout, 5xx) | Inline "Try again" (existing recoverable pattern) |
| `InvalidCredentials` | Credentials exist but rejected (401/403) | Inline "Credentials invalid — [Open Settings →]" |

**Anti-pattern:** Returning `Unavailable` when `provider` is `None`.

### Credential Write-After-Validation Rule

**Order of operations in every `save_*_credentials` command:**

1. Build the provider client from the submitted credentials
2. Make the test call (validate)
3. On success only: write to keyring → update config table → update `AiState`
4. On failure: return error — do NOT write anything to keyring

**Anti-pattern:** Writing to keyring before validating, then deleting on failure — this creates a window where the app is in a broken state.

### Config Table Keys for AI Settings

Use the existing `config` table. Never create a new table for AI preferences.

| Key | Values | Notes |
|-----|--------|-------|
| `ai_provider` | `"bedrock"` \| `"openai"` | Active provider selection |
| `aws_region` | e.g. `"us-east-1"` | Default if absent: `"us-east-1"` |
| `ai_configured` | `"true"` \| `"false"` | Fast frontend check — avoids keyring read on every page load |

### Tauri Command Names

Exact `snake_case` names — all registered in `lib.rs`:

| Command | Purpose |
|---------|---------|
| `get_ai_config` | Returns provider + configured status (no secrets) |
| `save_aws_credentials` | Validates + persists AWS key/secret/region → updates AiState |
| `save_openai_credentials` | Validates + persists OpenAI key → updates AiState |
| `clear_ai_credentials` | Removes keyring entries + resets config table + sets `AiState.provider = None` |
| `test_ai_connection` | Lightweight test call against current `AiState` (for settings page status display) |

### Enforcement Guidelines

**All AI Agents MUST:**
1. Route all keyring access through `src-tauri/src/credentials.rs` — never inline
2. Use `Mutex<AiState>` for all reads and writes to AI provider state
3. Return `AiServiceError::NotConfigured` (not `Unavailable`) when `provider` is `None`
4. Write to keyring only after the validation test call succeeds
5. Store provider selection and region in the `config` table — never a new table
6. Use exact command names from the table above — no abbreviations or variations
7. Invalidate the `["ai-config"]` TanStack Query key after any `save_*` or `clear_*` command

**Anti-Patterns to Avoid:**
- Calling `init_ai_client()` from a command handler to refresh credentials
- Storing secrets in the `config` table (even encrypted — use keyring)
- Creating an `ai_settings` or `credentials` SQLite table
- Conflating `NotConfigured` with `Unavailable` in error handling
- Writing partial credentials to keyring before full validation completes

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are compatible. `keyring` v4 is synchronous — OS keychain calls are fast and occur only at startup and on credential save, never in a hot path. `async-openai` and `aws-sdk-bedrockruntime` both share Tauri's Tokio runtime without conflict. `Mutex<AiState>` is the correct Tauri managed-state pattern for mutable shared state across concurrent command handlers.

**Pattern Consistency:** `credentials.rs` as sole keyring accessor mirrors the existing `db/` pattern. Provider selection in the `config` table follows the established non-secret preference convention. TanStack Query mutation + `["ai-config"]` key invalidation is consistent with how all other mutations invalidate their query keys throughout the app.

**Structure Alignment:** The `credentials.rs` → `commands/settings.rs` → `ai/mod.rs` dependency chain is clean and unidirectional. New files slot naturally into existing feature-based organization. The `/settings` route follows the same pattern as all other routes.

**Implementation note:** `init_ai_client()` in `lib.rs` performs sync reads (rusqlite config + keyring) before async work (`aws_config::load()`). Sync work must complete before entering the async context — not a gap, an implementation detail to respect.

### Requirements Coverage Validation

| Requirement | Architectural Support | Status |
|-------------|----------------------|--------|
| FR-CRED-1: Enter AWS credentials | `save_aws_credentials` + `CredentialsForm` + `credentials.rs` + keyring | ✅ |
| FR-CRED-2: Enter OpenAI API key | `save_openai_credentials` + `CredentialsForm` + keyring | ✅ |
| FR-CRED-3: Fallback to `~/.aws/credentials` | `aws_config::defaults()` at startup when keyring is empty | ✅ |
| FR-CRED-4: "Setup required" prompt | `AiServiceError::NotConfigured` guard in all AI commands + inline prompt | ✅ |

**NFR coverage:**
- Secure credential storage: OS keychain (hardware-backed on Apple Silicon, Credential Manager on Windows) ✅
- App remains fully functional without AI: `Option<AiProvider>` — all CRUD, dashboard, budget features unaffected ✅
- Graceful degradation: three distinct error variants (`NotConfigured`, `Unavailable`, `InvalidCredentials`) with distinct frontend responses ✅

### Gap Analysis Results

No critical gaps. Three minor items documented as known behaviors:

**1. `get_ai_config` must never return secret values (security rule)**
Returns only: `{ provider: "bedrock" | "openai" | null, configured: bool, region: string }`. Actual key values must never cross the IPC boundary. The `configured: bool` field is sufficient for the frontend to render the "already set" placeholder state.

**2. Settings form "already configured" display**
When `configured: true`, `CredentialsForm` renders masked placeholder text (`••••••••`) in credential fields rather than empty inputs. Explicitly specified here to prevent an agent from rendering empty fields, which would appear broken to the user.

**3. `~/.aws/credentials` fallback — lazy validation (known behavior)**
When startup falls back to `aws_config::defaults()`, credentials are not eagerly tested. Invalid `~/.aws/credentials` are discovered on first AI call, returning `InvalidCredentials`. This is intentional — eager testing would add a blocking network call to app startup.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Feature scope and requirements defined (FR-CRED-1 through FR-CRED-4)
- [x] NFRs identified (secure storage, graceful degradation, non-blocking CRUD)
- [x] Technical constraints mapped (existing Tauri stack, `config` table, error patterns)
- [x] Cross-cutting concerns identified (provider abstraction, AiState mutation, error discrimination)

**Architectural Decisions**
- [x] Credential storage: `keyring` v4 — rationale documented
- [x] Provider abstraction: enum dispatch — rationale documented
- [x] Resolution chain: keyring → `aws_config::defaults()` → `NotConfigured` — documented
- [x] `AiState` restructure: `Option<AiProvider>` — documented
- [x] Settings UI: new `/settings` route — documented
- [x] Validation strategy: eager on save — documented
- [x] Error variants: three distinct variants with distinct frontend responses — documented

**Implementation Patterns**
- [x] Keyring entry naming constants defined
- [x] `AiState` in-place mutation pattern defined
- [x] Error variant rules and frontend responses defined
- [x] Write-after-validation ordering rule defined
- [x] Config table keys defined
- [x] Tauri command names defined
- [x] Enforcement guidelines and anti-patterns documented

**Project Structure**
- [x] New files enumerated with purpose
- [x] Modified files enumerated with change description
- [x] Architectural boundaries defined (`credentials.rs`, `ai/mod.rs`, `commands/settings.rs`)
- [x] Data flows documented (credential save, app startup, not-configured path)
- [x] Requirements-to-structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Single-responsibility boundary: `credentials.rs` is the only keyring accessor
- Zero secrets surface: `get_ai_config` never returns key values over IPC
- Free fallback: `~/.aws/credentials` support costs zero implementation effort
- Extensible: adding a third AI provider requires one new `AiProvider` enum variant
- Consistent: all new patterns mirror existing architecture conventions exactly

**Known Limitations (acceptable):**
- `~/.aws/credentials` fallback credentials validated lazily (first use, not startup)
- Brief `Mutex<AiState>` contention possible during concurrent AI use + credential save — benign

### Implementation Handoff

**AI Agent Guidelines:**
- All keyring access through `credentials.rs` only — never inline
- `get_ai_config` returns status only, never secret values
- Write to keyring only after validation succeeds
- Three error variants are distinct — never substitute one for another
- Use `config` table for non-secrets — never create a new table for AI settings
- Update `AiState` in-place via `Mutex` — never re-run `init_ai_client()` from a command

**First Implementation Step:**
```toml
# Cargo.toml additions
keyring = "4"
async-openai = "0.27"
```
Then: `credentials.rs` → `ai/mod.rs` refactor → `error.rs` extension → `commands/settings.rs` → frontend `/settings` route.
