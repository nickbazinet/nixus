# Story 7.1: AI Chat Page with Data Queries

Status: review

## Story

As a user,
I want to ask natural language questions about my financial data and receive accurate answers,
So that I can quickly get insights without navigating through multiple views.

## Acceptance Criteria

1. **Given** the user navigates to the AI Chat page, **When** the chat interface loads, **Then** a ChatGPT-style interface displays with a message input area at the bottom, and the `chat_conversations` and `chat_messages` tables are created via migration for conversation persistence.
2. **Given** the chat interface is loaded, **When** inspecting the message area, **Then** conversation history is displayed with ChatMessageBubble components (UX-DR10): user messages (teal bg, white text, right-aligned), AI messages (muted bg, left-aligned), and the message container has `role="log"` with `aria-live="polite"`.
3. **Given** the user types a data query (e.g., "How much did I spend on dining out this month?"), **When** the message is sent, **Then** the Rust backend receives the message via Tauri command, pre-fetches relevant data from the database, and sends data + query to AWS Bedrock.
4. **Given** the Rust backend has sent the query to Bedrock, **When** the response streams back, **Then** the AI response streams via Tauri events (`chat:response-chunk` with payload `{ chunk: string, done: boolean }`) and renders progressively in the ChatMessageBubble.
5. **Given** the AI response contains financial data, **When** it renders, **Then** responses include formatted data (monospace for financial figures, tables for comparisons).
6. **Given** a data query is sent, **When** measuring response time, **Then** responses return within 5 seconds (NFR5).

## Tasks / Subtasks

- [x] Task 1: Create database migration for chat tables (AC: #1)
  - [x] Create migration SQL file (next sequence number) with `chat_conversations` table: `id` (INTEGER PRIMARY KEY), `title` (TEXT, nullable), `created_at` (TEXT, ISO 8601), `updated_at` (TEXT, ISO 8601)
  - [x] Create `chat_messages` table: `id` (INTEGER PRIMARY KEY), `conversation_id` (INTEGER, FK to chat_conversations), `role` (TEXT — "user" or "assistant"), `content` (TEXT), `created_at` (TEXT, ISO 8601)
  - [x] Add index on `chat_messages.conversation_id`
  - [x] Add `db/chat.rs` with query functions: `create_conversation`, `get_conversation_messages`, `insert_message`, `list_conversations`

- [x] Task 2: Implement Bedrock chat service in Rust (AC: #3, #4, #6)
  - [x] Create `ai/chat.rs` module with a function that accepts user message + database context string and calls AWS Bedrock (`aws-sdk-bedrockruntime` `InvokeModelWithResponseStream`)
  - [x] Read AI model selection from `config` table (key for model ID)
  - [x] Build system prompt that instructs the AI to answer financial data queries using the provided context. Include formatting instructions (monospace for dollar amounts, tables for comparisons)
  - [x] Return a stream of response chunks (not the full response at once)
  - [x] Handle Bedrock errors gracefully — return `AppError::AiService` with `recoverable: true`

- [x] Task 3: Implement Tauri chat commands (AC: #3, #4)
  - [x] Create `commands/chat.rs` with `send_chat_message` command: accepts `{ message: String, conversation_id: Option<i64> }`
  - [x] In the command handler: create conversation if `conversation_id` is None, insert user message into `chat_messages`
  - [x] Pre-fetch database context BEFORE calling Bedrock: query relevant data from `db/` modules (budget summary, recent expenses, account balances, asset values) and serialize as a context string
  - [x] Call `ai/chat.rs` with message + context, stream response chunks via Tauri event `chat:response-chunk` with payload `{ chunk: String, done: bool }`
  - [x] After streaming completes, insert full AI response into `chat_messages`
  - [x] Register command in `main.rs`

- [x] Task 4: Build ChatMessageBubble component (AC: #2, #5)
  - [x] Create `src/components/chat/ChatMessageBubble.tsx`
  - [x] Props: `role` ("user" | "assistant"), `content` (string), `timestamp` (optional string)
  - [x] User variant: teal background, white text, right-aligned, bottom-right rounded corner
  - [x] AI variant: muted background, default text, left-aligned, bottom-left rounded corner
  - [x] AI messages render markdown-like formatting: monospace for dollar amounts, simple table rendering for comparisons
  - [x] Streaming support: component accepts partial content and re-renders as chunks arrive

- [x] Task 5: Build Chat page route and layout (AC: #1, #2)
  - [x] Create `src/routes/chat.tsx` with the `/chat` route
  - [x] Layout: full-height flex column — scrollable message area (top) + fixed input area (bottom)
  - [x] Message area wraps ChatMessageBubble components in a container with `role="log"` and `aria-live="polite"`
  - [x] Input area: text input + send button (or Enter to send). Disable input while AI is responding.
  - [x] Auto-scroll to bottom when new messages arrive

- [x] Task 6: Implement `useChat` hook for frontend state and streaming (AC: #3, #4)
  - [x] Create `src/hooks/useChat.ts`
  - [x] Hook manages: messages array (local state), current conversation ID, loading/streaming state
  - [x] `sendMessage(text)`: invokes `send_chat_message` Tauri command, adds user message to local state
  - [x] Listen for `chat:response-chunk` Tauri events via `useTauriEvent` hook — accumulate chunks into the current AI message, update state on each chunk
  - [x] When `done: true` received, mark streaming as complete
  - [x] Use TanStack Query for loading conversation history on mount (`get_conversation_messages`)

- [x] Task 7: Write Playwright tests (AC: #1, #2)
  - [x] Create `tests/chat.spec.ts`
  - [x] Test: Chat page renders with a message input area at the bottom
  - [x] Test: User messages appear right-aligned with teal background (mock Tauri command to avoid real AI call)
  - [x] Test: AI messages appear left-aligned with muted background (mock `chat:response-chunk` events)
  - [x] Test: Message container has `role="log"` and `aria-live="polite"`
  - [x] Test: Typing a message and pressing Enter sends it (message appears in chat)
  - [x] Run `npx playwright test tests/chat.spec.ts` and confirm all pass

## Dev Notes

### Architecture: Streaming via Tauri Events (NOT Polling)

The chat response uses Tauri's event system for streaming. The flow:

1. Frontend invokes `send_chat_message` Tauri command (fire-and-forget for the response content)
2. Rust command pre-fetches all relevant DB data (budget, expenses, accounts, assets) and builds a context string
3. Rust calls `ai/chat.rs` which calls Bedrock's `InvokeModelWithResponseStream`
4. As each chunk arrives from Bedrock, Rust emits a `chat:response-chunk` Tauri event: `{ chunk: "partial text", done: false }`
5. Frontend listens for these events and appends chunks to the current AI message bubble
6. Final event: `{ chunk: "", done: true }` signals completion

This is the same pattern as `import:progress` events — pub/sub, not request/response.

### Database Context Pre-Fetching

The AI module (`ai/chat.rs`) does NOT query the database. The command handler (`commands/chat.rs`) fetches context before calling the AI:

```
commands/chat.rs:
  1. Receive user message
  2. Query db/budget.rs → budget summary
  3. Query db/expense.rs → recent expenses
  4. Query db/account.rs → account balances
  5. Query db/asset.rs → asset values
  6. Serialize all as context string
  7. Pass (message, context) to ai/chat.rs
  8. ai/chat.rs calls Bedrock with system prompt + context + user message
```

This respects the architectural boundary: `ai/` modules never access the database directly.

### Bedrock Integration

- Use `aws-sdk-bedrockruntime` Rust crate (already a project dependency from Epic 4 CC import)
- Share the Bedrock client initialization from `ai/mod.rs` (initialized once, reused)
- Use `InvokeModelWithResponseStream` for streaming responses
- Model ID read from `config` table (allows changing model without code changes)
- AWS credentials from environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)

### ChatMessageBubble Component Details (UX-DR10)

- User message: `bg-primary text-primary-foreground` (teal bg, white text), right-aligned, `rounded-2xl rounded-br-sm`
- AI message: `bg-muted text-foreground`, left-aligned, `rounded-2xl rounded-bl-sm`
- Message text: 14px, line-height 1.5 (Body typography from UX spec)
- Financial figures in AI responses: JetBrains Mono (monospace) per UX spec typography system
- Container: `role="log"` with `aria-live="polite"` for screen reader announcements

### Scope Boundaries

**In scope:** Dedicated `/chat` route, ChatMessageBubble component, read-only data queries, streaming responses, conversation persistence, Bedrock integration.

**Out of scope (handled by later stories):**
- Write actions and confirmation cards -> Story 7.2
- Floating chat bar (Cmd+K) -> Story 7.3
- Do NOT implement action parsing or confirmation flows
- Do NOT build the FloatingChatBar component

### Testing Notes

AI integration tests are deferred — they require AWS credentials. Playwright tests mock the Tauri command and event layer:
- Mock `invoke("send_chat_message")` to return immediately
- Mock `chat:response-chunk` events to simulate streaming
- This tests the UI structure and interaction patterns without a real AI backend

### Project Structure Notes

```
src/
├── components/
│   └── chat/
│       └── ChatMessageBubble.tsx       # NEW
├── hooks/
│   └── useChat.ts                      # NEW
└── routes/
    └── chat.tsx                        # NEW

src-tauri/
├── migrations/
│   └── 00X_chat_tables.sql            # NEW (next sequence number)
└── src/
    ├── ai/
    │   └── chat.rs                     # NEW
    ├── commands/
    │   └── chat.rs                     # NEW
    └── db/
        └── chat.rs                     # NEW

tests/
└── chat.spec.ts                        # NEW
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — AI Chat Flow, IPC Events, AI Service Boundary, Tauri Event Payload Format]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR10 ChatMessageBubble, Journey 4 AI Chat, Typography System]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust: compiles with 1 warning (unused list_conversations, needed for future use)
- TypeScript: clean
- Playwright: 5/5 chat tests pass, 114/114 full suite
### Completion Notes List
- Task 1: Migration 009_chat_tables.sql with chat_conversations + chat_messages tables. db/chat.rs with CRUD functions.
- Task 2: ai/chat.rs with Bedrock ConverseStream API. System prompt includes financial context, monospace formatting instructions.
- Task 3: commands/chat.rs with send_chat_message (creates conversation, pre-fetches DB context, streams via events) and get_chat_messages.
- Task 4: ChatMessageBubble with user (teal/right) and assistant (muted/left) variants. Backtick content rendered as monospace code.
- Task 5: Chat page with full-height flex layout, scrollable message area (role=log, aria-live=polite), fixed input at bottom, auto-scroll.
- Task 6: useChat hook with Tauri event listener for chat:response-chunk, streaming state, message accumulation.
- Task 7: 5 Playwright tests for page layout, accessibility, message sending, user/AI message styling.
### File List
- src-tauri/migrations/009_chat_tables.sql (created)
- src-tauri/src/db/chat.rs (created)
- src-tauri/src/db/mod.rs (modified)
- src-tauri/src/ai/chat.rs (created)
- src-tauri/src/ai/mod.rs (modified)
- src-tauri/src/commands/chat.rs (created)
- src-tauri/src/commands/mod.rs (modified)
- src-tauri/src/lib.rs (modified)
- src/components/chat/ChatMessageBubble.tsx (created)
- src/hooks/useChat.ts (created)
- src/routes/chat.tsx (modified)
- tests/chat.spec.ts (created)

### Change Log
- 2026-03-15: Story 7.1 implemented - AI chat page with Bedrock streaming, conversation persistence, ChatGPT-style UI
