# Story 6.2: AI Extraction and Categorization Pipeline

Status: review

## Story
As a user, I want the system to extract transactions from my CC statement and auto-categorize them, So that I don't have to manually enter each transaction.

## Acceptance Criteria

**AC1: ImportProgressStepper renders 4 stages**
Given a valid file has been uploaded (Story 6.1 complete)
When AI processing begins
Then the ImportProgressStepper component displays 4 stages: Uploading, Extracting, Categorizing, Done
And each stage shows a status icon: checkmark (done), spinner (current), empty (pending)
And connector arrows link the stages horizontally

**AC2: Progress streams via Tauri events in real-time**
Given processing is underway
When the backend transitions between stages
Then `import:progress` events are emitted with payload `{ stage: "uploading" | "extracting" | "categorizing" | "done", progress?: number, message?: string }`
And the ImportProgressStepper updates reactively as events arrive
And the current stage shows a teal animated state

**AC3: Bedrock integration extracts transactions**
Given the Rust backend receives a valid CC statement file
When the file is sent to AWS Bedrock via `aws-sdk-bedrockruntime`
Then the AI receives the file (image/PDF) along with the user's budget categories as context
And Bedrock returns parsed transactions with: merchant name, amount (in cents), date, and suggested budget category
And communication with Bedrock uses HTTPS (NFR7)

**AC4: Auto-categorization with confidence flagging**
Given Bedrock returns parsed transactions
When the system evaluates each transaction
Then transactions with high AI confidence are marked as auto-categorized
And transactions with low confidence are flagged for user review (FR8)
And the `import:complete` event is emitted with payload `{ transactions: [...], flagged_count: number, auto_count: number }`

**AC5: Performance within NFR4 target**
Given a typical CC statement with 15-25 transactions
When the full pipeline runs (upload, extract, categorize)
Then processing completes within 30 seconds (NFR4)

**AC6: Graceful degradation when Bedrock is unavailable**
Given the AI service is unavailable (network error, credentials missing, timeout)
When the import fails
Then an `import:error` event is emitted
And an inline alert shows "Import is temporarily unavailable. You can add transactions manually." with a link to manual expense entry
And the rest of the app remains functional (NFR9, NFR10)

**AC7: Partial extraction handling**
Given the AI can only partially extract transactions (e.g., blurry image)
When some transactions cannot be read
Then successfully extracted transactions proceed normally
And unreadable transactions are listed as "couldn't be read" with inline manual entry fields (FR14)

## Tasks / Subtasks

### Task 1: Set up AWS Bedrock client in Rust [AC3]
- [x] Create `src-tauri/src/ai/mod.rs` with Bedrock client initialization
- [x] Configure `aws-sdk-bedrockruntime` using env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- [x] Initialize the client once (managed state in Tauri) and share across AI modules
- [x] Add `aws-sdk-bedrockruntime`, `aws-config`, and `aws-sdk-config` to `Cargo.toml`

### Task 2: Implement CC parser AI module [AC3, AC4, AC5]
- [x] Create `src-tauri/src/ai/cc_parser.rs`
- [x] Build the prompt: include the uploaded file (base64 for images, text extraction for PDF) and the user's budget categories as structured context
- [x] Parse Bedrock response into a structured list of transactions: `{ merchant: String, amount_cents: i64, date: String, suggested_category_id: Option<i64>, confidence: f64 }`
- [x] Determine confidence threshold for flagging (e.g., confidence < 0.8 = flagged)
- [x] Handle partial extraction: return successfully parsed transactions + list of indices that failed

### Task 3: Implement async import command with event streaming [AC1, AC2, AC4, AC6]
- [x] Update `src-tauri/src/commands/import.rs`:
  - [x] After file validation (Story 6.1), spawn an async task for the AI pipeline
  - [x] Emit `import:progress` events at each stage transition: `uploading` -> `extracting` -> `categorizing` -> `done`
  - [x] Call `ai/cc_parser.rs` to send file to Bedrock and receive parsed transactions
  - [x] Fetch user's budget categories from `db/budget.rs` to pass as AI context
  - [x] On success, emit `import:complete` with `{ transactions, flagged_count, auto_count }`
  - [x] On failure, emit `import:error` with error details
- [x] Use Tauri's `AppHandle.emit()` for event emission (pub/sub, not command response)

### Task 4: Build ImportProgressStepper component [AC1, AC2]
- [x] Create `src/components/import/ImportProgressStepper.tsx`
- [x] Render 4 horizontal steps: Uploading, Extracting, Categorizing, Done
- [x] Each step: label + status icon (checkmark for done, spinner for current, empty circle for pending)
- [x] Connector arrows between steps
- [x] Current step: teal background, animated spinner
- [x] Done step: green/emerald background + checkmark
- [x] Pending step: muted text
- [x] Accessibility: `role="progressbar"` on container, `aria-valuenow` reflects current step, each step has `aria-label`

### Task 5: Wire frontend to Tauri events [AC2, AC6, AC7]
- [x] Create or update `src/hooks/useImport.ts`:
  - [x] Listen to `import:progress` events via Tauri event API
  - [x] Listen to `import:complete` event to receive transaction results
  - [x] Listen to `import:error` event to handle failures
  - [x] Manage import state: idle, uploading, extracting, categorizing, done, error
- [x] Update `src/routes/import.tsx`:
  - [x] After successful file validation (Story 6.1), trigger the import command
  - [x] Show ImportProgressStepper during processing
  - [x] On `import:complete`, transition to review screen (Story 6.3 will implement the review UI)
  - [x] On `import:error`, show inline alert with manual entry fallback link

### Task 6: Handle error and partial extraction UI [AC6, AC7]
- [x] Render inline alert for Bedrock unavailability: "Import is temporarily unavailable. You can add transactions manually."
- [x] Include a link/button to navigate to manual expense entry
- [x] For partial extraction: show successfully extracted transactions + "X transactions couldn't be read" with manual entry fields inline

### Task 7: Write Playwright tests [AC1, AC2, AC6]
- [x] Append to `tests/import.spec.ts`:
  - [x] ImportProgressStepper renders 4 stages with correct labels (Uploading, Extracting, Categorizing, Done)
  - [x] Progress transitions between stages via mocked backend events
  - [x] When AI service is unavailable, inline alert shows "Import is temporarily unavailable" with manual entry link
- Note: Full E2E AI tests deferred until AWS credentials are configured

## Dev Notes

### Architecture
- This is the core AI story. It connects the Rust backend to AWS Bedrock, implements the async job pattern with event streaming, and builds the progress UI.
- The import command is a Tauri **command** (invoked via `invoke()`) that kicks off the pipeline. Progress is streamed back via Tauri **events** (pub/sub). This is NOT a command that returns progress -- the command returns immediately (or returns the final result), and progress updates arrive as separate events.
- The AI module (`ai/cc_parser.rs`) receives raw file bytes + budget categories and returns parsed transactions. It does NOT query the database -- the command layer fetches budget categories and passes them in.

### IPC Events (kebab-case with namespace)
- `import:progress` -- payload: `{ stage: "uploading" | "extracting" | "categorizing" | "done", progress?: number, message?: string }`
- `import:complete` -- payload: `{ transactions: [...], flagged_count: number, auto_count: number }`
- `import:error` -- payload: `{ message: string, recoverable: true }`
- Events emitted via `app_handle.emit("import:progress", payload)` in Rust

### AWS Bedrock Integration
- SDK: `aws-sdk-bedrockruntime` Rust crate (native async via Tokio)
- Credentials: loaded automatically from env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) by the AWS SDK's default credential chain
- Model: Use a Claude model on Bedrock for multimodal CC statement parsing (accepts images and PDFs)
- Prompt structure: include the file content (base64-encoded image or PDF) + a structured list of budget categories with IDs and names + instructions to extract transactions with merchant, amount, date, and category assignment
- Response parsing: expect structured JSON output from the model, parse into Rust structs

### Confidence Flagging
- Each transaction returned by the AI includes a confidence score (or the system infers confidence based on category match quality)
- Threshold (e.g., 0.8): above = auto-categorized, below = flagged for review
- The `import:complete` event separates counts: `auto_count` (confident) and `flagged_count` (needs review)

### Async Job Pattern
- The import command spawns an async Tokio task so it does not block the Tauri command thread
- The async task emits events at each stage, allowing the frontend to update the stepper in real-time
- Timeout handling: if Bedrock does not respond within ~30s, emit `import:error` with a timeout message

### Scope Boundaries
- IN SCOPE: Bedrock client setup, CC parser module, async import pipeline, event streaming, ImportProgressStepper component, error/partial extraction handling, `useImport` hook
- OUT OF SCOPE: Transaction review UI (Story 6.3), confirm/save to database (Story 6.3), TransactionReviewCard (Story 6.3), AutoCategorizedSummary (Story 6.3), completion screen (Story 6.3)

### Project Structure Notes

**Frontend files to create/modify:**
- `src/components/import/ImportProgressStepper.tsx` -- Progress stepper component
- `src/hooks/useImport.ts` -- Import state management and event listeners
- `src/hooks/useTauriEvent.ts` -- Shared Tauri event listener hook (if not already created)
- `src/routes/import.tsx` -- Update to wire stepper and event handling

**Backend files to create/modify:**
- `src-tauri/src/ai/mod.rs` -- Bedrock client initialization
- `src-tauri/src/ai/cc_parser.rs` -- CC statement parsing logic and prompts
- `src-tauri/src/commands/import.rs` -- Update with async pipeline and event emission
- `src-tauri/Cargo.toml` -- Add `aws-sdk-bedrockruntime`, `aws-config` dependencies

**Test files:**
- `tests/import.spec.ts` -- Append Playwright tests for stepper and error states

### References
- Architecture: `_bmad-output/planning-artifacts/architecture.md` -- IPC events pattern, AI service boundary, Bedrock integration, async job pattern, CC Import data flow
- UX Spec: `_bmad-output/planning-artifacts/ux-design-specification.md` -- ImportProgressStepper anatomy and states, progress stage design (Journey 2), error handling patterns
- Epics: `_bmad-output/planning-artifacts/epics.md` -- Story 6.2 acceptance criteria, FR6, FR7, FR8, FR10

## Dev Agent Record
### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust compilation: clean with aws-sdk-bedrockruntime, aws-config, tokio
- TypeScript: clean
- Playwright: 8/8 import tests pass, 101/101 full suite
### Completion Notes List
- Task 1: Created ai/mod.rs with Bedrock client init using aws-config defaults. AiState managed via Tauri app state, initialized async at startup.
- Task 2: Created ai/cc_parser.rs with Claude Sonnet model on Bedrock. Prompt includes budget categories for context. Handles images (PNG/JPG) and PDFs via Converse API. JSON response parsing with markdown code block extraction. Confidence threshold 0.8.
- Task 3: Updated commands/import.rs with import_cc_statement async command. Emits import:progress at each stage, import:complete on success, import:error on failure. Fetches budget categories from DB to pass to AI.
- Task 4: Created ImportProgressStepper with 4 stages, teal animated spinner for current, emerald checkmark for done, muted for pending. role="progressbar" with aria attributes.
- Task 5: Created useImport.ts hook with Tauri event listeners for progress/complete/error. Updated import.tsx to wire upload → validate → import → stepper → results flow.
- Task 6: Error state shows "Import is temporarily unavailable" with link to manual expense entry. Partial extraction shows unreadable transaction list.
- Task 7: 3 new Playwright tests for stepper rendering, results display, and error state with manual entry link.
### File List
- src-tauri/src/ai/mod.rs (created)
- src-tauri/src/ai/cc_parser.rs (created)
- src-tauri/src/commands/import.rs (modified)
- src-tauri/src/lib.rs (modified)
- src-tauri/Cargo.toml (modified - added aws-sdk-bedrockruntime, aws-config, tokio)
- src/components/import/ImportProgressStepper.tsx (created)
- src/components/import/UploadZone.tsx (modified - fixed snake_case args)
- src/hooks/useImport.ts (created)
- src/routes/import.tsx (modified)
- tests/import.spec.ts (modified - added 3 Story 6.2 tests)

### Change Log
- 2026-03-15: Story 6.2 implemented - AWS Bedrock integration, CC parser, progress stepper, event streaming, error handling
