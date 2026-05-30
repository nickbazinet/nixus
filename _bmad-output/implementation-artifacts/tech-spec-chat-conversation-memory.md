---
title: 'Chat Conversation Memory'
slug: 'chat-conversation-memory'
created: '2026-04-13'
status: 'done'
baseline_commit: 'c669d369'
stepsCompleted: [1, 2, 3, 4]
tech_stack: [rust, tauri-2, react-19, typescript, sqlite-rusqlite, aws-bedrock-converse-stream]
files_to_modify: [src-tauri/migrations/013_chat_message_type.sql, src-tauri/src/db/chat.rs, src-tauri/src/commands/chat.rs, src/hooks/useChat.ts, src/routes/chat.tsx]
code_patterns: [bedrock-converse-stream-alternating-messages, sqlite-chat-messages-ordered-by-id, tauri-invoke-commands, tauri-emit-events, react-usestate-useeffect-usecallback]
test_patterns: [playwright-e2e-only, no-rust-unit-tests-for-chat]
---

# Tech-Spec: Chat Conversation Memory

**Created:** 2026-04-13

## Overview

### Problem Statement

Each message to Bedrock is sent in isolation — only the current user message is passed in `send_chat_message()` inside `src-tauri/src/commands/chat.rs` (in the `stream_chat_response()` call). Claude has no memory of prior exchanges in the same conversation, making multi-turn dialogue useless. The user asks a follow-up question and Claude has zero context of what was just discussed.

### Solution

Load prior messages from the `chat_messages` SQLite table and pass the full conversation history to Bedrock's `converse_stream()` API. Persist tool-call intermediate messages with a `message_type` discriminator so they are included in Bedrock history but filtered from frontend display. On the frontend, load existing messages when resuming a conversation via URL search param.

### Scope

**In Scope:**
- Schema: Add `message_type` column to `chat_messages` table
- Backend: Fix message ordering to use `id` instead of `created_at`
- Backend: Save tool-call intermediate messages with `message_type` discriminator
- Backend: Load conversation history from DB and build full Bedrock message array
- Backend: Update `get_chat_messages` command to filter by `message_type = 'chat'` for frontend
- Frontend: Load and display history on mount via conversation ID search param

**Out of Scope:**
- Conversation list/picker UI
- Token limit management / sliding window / summarization (see Known Limitations)
- Strands SDK integration
- Auto-titling conversations
- Migrating from prompt-engineered tools to Bedrock native ToolUse/ToolResult content blocks (see Known Limitations)
- Fixing the shared global event bus between `ChatPage` and `FloatingChatBar` (pre-existing issue, see Known Limitations)

## Context for Development

### Codebase Patterns

- Bedrock `converse_stream()` accepts `Vec<Message>` with strictly alternating user/assistant roles
- Messages persisted in SQLite via `chat_db::insert_message(conn, conv_id, role, content)`
- DB schema constrains role to `'user' | 'assistant'` — tool results stored as `"user"` role (matches Bedrock modeling)
- **Ordering hazard:** `created_at` uses `datetime('now')` with second-level precision. Messages inserted in rapid succession (e.g., tool-call flow) can share the same timestamp. Must use `ORDER BY id ASC` for deterministic insertion-order retrieval.
- Frontend uses `invoke()` for Tauri commands and `listen()` for streaming events
- `useChat` hook manages in-memory `messages[]` state — starts empty every mount
- Both `ChatPage` and `FloatingChatBar` instantiate `useChat()` independently (separate conversations)
- TanStack Router supports search params via `validateSearch` on route definitions

### Files to Reference

| File | Purpose | Key Functions/Patterns |
| ---- | ------- | --------------------- |
| `src-tauri/src/commands/chat.rs` | Tauri commands for chat | `send_chat_message()`: single-message Bedrock call (the gap). Tool-call branch: intermediate messages not saved. `get_chat_messages()`: returns all messages unfiltered. |
| `src-tauri/src/ai/chat.rs` | Bedrock streaming, message building | `stream_chat_response()`: already accepts `Vec<Message>`. `build_message()`: creates Bedrock `Message` from role + text. |
| `src-tauri/src/db/chat.rs` | SQLite CRUD for chat | `get_conversation_messages()`: loads full history ordered by `created_at` (must change to `id`). `insert_message()`: takes `(conn, conv_id, role, content)` — needs `message_type` param. |
| `src/hooks/useChat.ts` | React hook: chat state, streaming, actions | `messages` state starts empty. `conversationId` starts null. `sendMessage()` sends `conversation_id` to backend. |
| `src/routes/chat.tsx` | Full chat page UI | Currently no search param handling. Needs optional `?conversation=N` support. |
| `src/components/chat/FloatingChatBar.tsx` | Floating quick-chat overlay | No changes. |
| `src-tauri/migrations/009_chat_tables.sql` | Current DB schema | Role constraint: `CHECK(role IN ('user', 'assistant'))`. No `message_type` column. |

### Technical Decisions

- **`message_type` discriminator**: New column on `chat_messages` with values `'chat'` (default), `'tool_call'`, `'tool_result'`. Allows Bedrock to receive the full conversation (all types) while the frontend displays only `'chat'` messages. Solves the tool-call JSON/table display contamination problem.
- **Order by `id`**: Use `ORDER BY id ASC` instead of `ORDER BY created_at ASC` to guarantee insertion-order retrieval regardless of timestamp precision.
- **No token management**: Send all messages in the conversation. Conversations in a personal finance app are short-lived. If Bedrock returns a request-size error, surface it to the user as a friendly message (see Known Limitations).
- **No Strands SDK**: Bedrock Converse API handles multi-turn natively via the messages array. The existing direct SDK usage is sufficient.
- **Text-based tool history**: Tool-call and tool-result messages are stored and replayed as `ContentBlock::Text`. The current tool system is prompt-engineered (not Bedrock native ToolUse/ToolResult). Migrating to native tool blocks is a separate effort. The text-based approach works because the model interprets its own prior tool-call syntax as context.
- **Consistent content storage**: Tool-call assistant messages are stored with the raw `first_response` content (including ` ```tool_call``` ` blocks). Final assistant responses have tool-call blocks stripped (existing behavior). This is acceptable because the `message_type` column distinguishes them — the frontend never displays `tool_call` type messages, and Bedrock benefits from seeing the full tool interaction context.
- **Transaction for tool-call inserts**: The tool-call DB operations (save tool-call msg, execute tool, save tool-result) are not wrapped in a DB transaction since tool execution is not a DB operation. If a partial failure occurs (e.g., tool-call saved but tool execution fails), the next history load may have a trailing assistant message without a following user message. The `build_history_messages()` helper must handle this gracefully by dropping any trailing assistant message that would violate alternation.

## Implementation Plan

### Task Dependency Order

```
Task 1 (schema) → Task 2 (db layer) → Task 3 (backend: save tool msgs) → Task 4 (backend: load history) → Task 5 (frontend)
```

All tasks must be implemented in order. Each task depends on the previous.

### Tasks

- [ ] Task 1: Add `message_type` column via migration
  - File: `src-tauri/migrations/013_chat_message_type.sql` (new file)
  - Action: Create migration that adds a `message_type TEXT NOT NULL DEFAULT 'chat' CHECK(message_type IN ('chat', 'tool_call', 'tool_result'))` column to `chat_messages`. The default `'chat'` ensures all existing messages are treated as normal chat messages without backfill.

- [ ] Task 2: Update DB layer — ordering fix and `message_type` support
  - File: `src-tauri/src/db/chat.rs`
  - Action:
    - In `get_conversation_messages()`: change `ORDER BY created_at ASC` to `ORDER BY id ASC`.
    - Update `insert_message()` signature to accept a `message_type: &str` parameter. Add it to the INSERT statement.
    - Add `message_type` field to the `ChatMessage` struct (as `pub message_type: String`). Update all SELECT queries to include the new column.
    - Add a new function `get_conversation_messages_for_display(conn, conversation_id) -> Result<Vec<ChatMessage>>` that filters to `WHERE message_type = 'chat'` and orders by `id ASC`. This is what the frontend-facing `get_chat_messages` Tauri command will call.
  - Notes: All existing callers of `insert_message()` must be updated to pass `"chat"` as the `message_type` argument (there are 3 call sites in `commands/chat.rs`: user message insert, final AI response insert, and action result insert in `execute_chat_action`).

- [ ] Task 3: Save tool-call intermediate messages to DB
  - File: `src-tauri/src/commands/chat.rs`
  - Action: In the tool-call branch of `send_chat_message()` (inside the `if let Some(tool_call) = ...` block):
    1. After `first_response` is received and a tool call is detected, insert: `chat_db::insert_message(conn, conv_id, "assistant", &first_response, "tool_call")`.
    2. After executing the tool and getting `tool_result`, insert: `chat_db::insert_message(conn, conv_id, "user", &tool_result, "tool_result")`.
    This ensures the full exchange sequence is persisted: user(chat) → assistant(tool_call) → user(tool_result) → assistant(chat).
  - Notes: Follow the existing pattern of scoping `conn` in blocks with `db_state.0.lock()`. Also update the two existing `insert_message` calls in this file (user message at the top and final AI response at the bottom) to pass `"chat"` as message_type. Update the `insert_message` call in `execute_chat_action` similarly.

- [ ] Task 4: Load conversation history and pass to Bedrock
  - File: `src-tauri/src/commands/chat.rs`
  - Action:
    1. Add a helper function:
       ```rust
       fn build_history_messages(
           db_state: &State<DbState>,
           conv_id: i64,
       ) -> Result<Vec<Message>, AppError>
       ```
       This function: loads all messages via `chat_db::get_conversation_messages(conn, conv_id)`, maps each to a Bedrock `Message` using `chat_ai::build_message()` (map `role="user"` → `ConversationRole::User`, `role="assistant"` → `ConversationRole::Assistant`), and returns the vec. **Edge case handling:** if the last message in history is an assistant message (e.g., from a partial tool-call failure), drop it to maintain valid alternation.
    2. In `send_chat_message()`, before the first Bedrock call: call `build_history_messages()` to get prior messages, then append the current user message. Pass the full vec to `stream_chat_response()`.
    3. For the second Bedrock call (tool-call follow-up): call `build_history_messages()` again (which now includes the intermediate messages saved in Task 3), then append the tool-result message. Replace the existing manually-built `vec![user_msg_2, assistant_msg, tool_result_msg]`.
  - Notes: `ai/chat.rs` needs no changes — `stream_chat_response()` already accepts `Vec<Message>`.

- [ ] Task 5: Frontend — load history on mount via URL search param
  - Files: `src/hooks/useChat.ts`, `src/routes/chat.tsx`
  - Action:
    1. In `useChat.ts`: add an optional `initialConversationId?: number` parameter. When provided:
       - Set `conversationId` state to this value on initialization.
       - Add a `useEffect` that runs on mount: invoke `get_chat_messages` with the conversation ID, map results to `ChatMessage[]` format, and set as `messages` state.
       - Add a `loading: boolean` state, set to `true` during history fetch, exposed in the return value. When `loading` is true, the send button and input should be disabled.
    2. In `chat.tsx`: add TanStack Router search param validation for an optional `conversation` number param. If present, pass it to `useChat({ initialConversationId: search.conversation })`.
  - Notes: The `get_chat_messages` Tauri command already exists but must be updated (in Task 2) to call `get_conversation_messages_for_display()` so it only returns `chat` type messages. The frontend never sees tool-call/tool-result messages. The FloatingChatBar does not pass `initialConversationId` — it always starts a fresh conversation.

### Acceptance Criteria

- [ ] AC 1: Given a conversation with 2+ prior exchanges, when the user sends a new message, then Bedrock receives all prior messages as context and Claude's response demonstrates awareness of the conversation history (e.g., references earlier questions/answers).
- [ ] AC 2: Given a message that triggers a tool call (e.g., "how much did I spend at Costco?"), when the tool executes and Claude responds, then the DB contains 4 messages in order: user(chat), assistant(tool_call), user(tool_result), assistant(chat) — verified by querying `SELECT role, message_type FROM chat_messages WHERE conversation_id = ? ORDER BY id`.
- [ ] AC 3: Given a conversation where a tool call occurred previously, when the user sends a follow-up message, then Bedrock receives the full history including the prior tool-call and tool-result messages, and Claude can reference the earlier query results.
- [ ] AC 4: Given the URL `/chat?conversation=N` where N is a valid conversation ID, when the page loads, then existing `chat`-type messages are loaded from the backend and displayed before the user types anything. Tool-call and tool-result messages are NOT displayed.
- [ ] AC 5: Given a conversation with no prior messages (new conversation), when the user sends the first message, then behavior is unchanged from current — a new conversation is created and the single message is sent to Bedrock.
- [ ] AC 6: Given tool-call intermediate messages inserted in rapid succession (same second), when history is loaded for the next Bedrock call, then messages are in correct insertion order (ordered by `id`, not `created_at`).
- [ ] AC 7: Given a partial failure during tool-call flow (e.g., assistant tool-call saved but tool execution fails), when history is loaded for the next turn, then the trailing orphaned assistant message is dropped and Bedrock receives a valid alternating sequence.

## Additional Context

### Dependencies

- No new external dependencies required. All functionality exists in current stack (aws-sdk-bedrockruntime, rusqlite, tauri, TanStack Router).

### Testing Strategy

- Manual: Send 3+ messages in a conversation and verify Claude references prior context in responses
- Manual: Ask a question that triggers `query_expenses` tool, then ask a follow-up about the results — verify Claude remembers
- Manual: Check DB directly: `SELECT id, role, message_type, substr(content, 1, 50) FROM chat_messages WHERE conversation_id = ? ORDER BY id` — confirm tool-call exchange produces 4 rows with correct types
- Manual: Navigate to `/chat?conversation=N` and verify history loads, tool-call/tool-result messages are NOT visible
- Manual: Verify a new conversation (no search param) behaves identically to current behavior
- Manual: Navigate to `/chat` (no param), send messages, then navigate away and back to `/chat` — verify a fresh conversation starts (no stale state)

### Known Limitations

1. **Token/request size limits (F14):** No upper bound on conversation length. If a conversation grows very long (many tool-call exchanges with large result tables), the Bedrock request may exceed the model's context window or API size limit. The error will surface as a generic AI service error. Future work: add a sliding window or token-counting strategy.
2. **Prompt-engineered tools vs native Bedrock ToolUse (F5):** The current tool system uses prompt-engineered ` ```tool_call``` ` blocks, not Bedrock's native `ToolUse`/`ToolResult` content blocks. Tool history is replayed as `ContentBlock::Text`, which works but is less robust than native tool blocks. Migrating to native tool use is a separate effort that would also improve the multi-turn tool experience.
3. **Shared global event bus (F8):** Both `ChatPage` and `FloatingChatBar` instantiate `useChat()` independently and listen on the same global Tauri events (`chat:response-chunk`, `chat:tool-executing`). If both are mounted, streaming events from one conversation will leak into the other. This is a pre-existing issue not caused by this feature. Future fix: scope events by conversation ID.
4. **Temporal inconsistency in system prompt vs stored tool results (F13):** The system prompt always contains current financial data (balances, budgets). Stored tool-result messages contain data from when the tool was originally called. If financial data changes between turns, Claude receives both current and historical values. This is acceptable — Claude can reason about temporal differences — but could confuse the model in edge cases.

### Notes

- The DB layer (`db/chat.rs`) requires changes: ordering fix, `message_type` parameter, new display-filtered query function.
- One new migration file needed (`010_chat_message_type.sql`).
- No changes needed to `ai/chat.rs`.
