# Story 7.2: AI Chat Write Actions with Confirmation

Status: review

## Story

As a user,
I want to perform actions through chat (add expenses, update balances) with confirmation before execution,
So that I can manage my finances conversationally.

## Acceptance Criteria

1. **Given** the user types an action request (e.g., "Add a $45 expense at Costco under Groceries for today"), **When** the AI parses the intent as a write action, **Then** the AI responds with a confirmation card embedded in the chat message showing exactly what will happen: action type, merchant, amount, category, date.
2. **Given** the AI has returned a confirmation card, **When** inspecting the card, **Then** it has "Confirm" and "Cancel" buttons.
3. **Given** the user clicks "Confirm" on an action card, **When** the action is executed, **Then** the Rust backend performs the write operation (e.g., creates the expense via existing Tauri commands from previous epics), an audit log entry records the action, and a success message appears in the chat: "Done. $45.00 expense added to Groceries."
4. **Given** the user clicks "Confirm" and the write succeeds, **When** the UI updates, **Then** relevant TanStack Query keys are invalidated (e.g., `["expenses"]`, `["dashboard"]`, `["budgets"]`).
5. **Given** the user clicks "Cancel", **When** the action is cancelled, **Then** a message confirms "Action cancelled" and the chat continues normally.

## Tasks / Subtasks

- [x] Task 1: Extend Bedrock system prompt for action parsing (AC: #1)
  - [x] Update `ai/chat.rs` system prompt to instruct the AI to distinguish between data queries and write actions
  - [x] Define a structured response format for write actions — JSON block with fields: `action_type` ("create_expense" | "update_balance" | "create_account" | etc.), plus action-specific fields (merchant, amount_cents, category, date, account_id, etc.)
  - [x] AI must return the structured action JSON when it detects a write intent, NOT execute anything
  - [x] Parse the AI response in `commands/chat.rs` to detect whether it contains a structured action or a plain text response

- [x] Task 2: Implement `execute_chat_action` Tauri command (AC: #3, #4)
  - [x] Create `execute_chat_action` command in `commands/chat.rs`: accepts `{ action_type: String, params: serde_json::Value, conversation_id: i64 }`
  - [x] Route to existing db functions based on `action_type`:
    - `"create_expense"` -> `db/expense.rs::create_expense`
    - `"update_balance"` -> `db/account.rs::update_balance`
    - `"create_account"` -> `db/account.rs::create_account`
    - `"update_asset_value"` -> `db/asset.rs::update_value`
  - [x] Log the action to `audit_log` via `db/audit.rs`
  - [x] Insert success message into `chat_messages`
  - [x] Return success result with formatted confirmation message (e.g., "Done. $45.00 expense added to Groceries.")
  - [x] Register command in `main.rs`

- [x] Task 3: Build confirmation card variant for ChatMessageBubble (AC: #1, #2)
  - [x] Extend `ChatMessageBubble.tsx` to detect action confirmation payloads in AI messages
  - [x] Render an embedded Card (shadcn) within the AI message bubble showing action details:
    - Action type label (e.g., "Add Expense")
    - Detail rows: merchant, amount (formatted from cents), category, date
    - "Confirm" button (primary/teal) and "Cancel" button (ghost)
  - [x] Card uses the standard shadcn Card, CardHeader, CardContent, CardFooter pattern
  - [x] Amount displayed in monospace (JetBrains Mono) per UX typography spec

- [x] Task 4: Handle confirm/cancel actions in `useChat` hook (AC: #3, #4, #5)
  - [x] Add `confirmAction(actionPayload)` function to `useChat` hook
    - Invokes `execute_chat_action` Tauri command with the action details
    - On success: appends success message to chat, invalidates relevant TanStack Query keys
    - On error: appends error message to chat (inline, not modal)
  - [x] Add `cancelAction()` function to `useChat` hook
    - Appends "Action cancelled" message to chat
    - No backend call needed
  - [x] Pass `onConfirm` and `onCancel` callbacks through to the confirmation card in ChatMessageBubble
  - [x] After confirm or cancel, disable the buttons on the card (prevent double-execution)

- [x] Task 5: Determine TanStack Query invalidation per action type (AC: #4)
  - [x] Map action types to query keys that must be invalidated:
    - `"create_expense"` -> invalidate `["expenses"]`, `["dashboard"]`, `["budgets"]`
    - `"update_balance"` -> invalidate `["accounts"]`, `["dashboard"]`, `["net-worth"]`
    - `"create_account"` -> invalidate `["accounts"]`, `["dashboard"]`
    - `"update_asset_value"` -> invalidate `["assets"]`, `["net-worth"]`
  - [x] Use `queryClient.invalidateQueries()` with the relevant keys after successful execution

- [x] Task 6: Write Playwright tests (AC: #1, #2, #5)
  - [x] Append to `tests/chat.spec.ts`
  - [x] Test: An action confirmation card renders within a chat message with action details (mock AI response with structured action payload)
  - [x] Test: Confirmation card has "Confirm" and "Cancel" buttons
  - [x] Test: Clicking "Cancel" shows "Action cancelled" message in chat
  - [x] Test: After confirm or cancel, buttons on the card are disabled
  - [x] Run `npx playwright test tests/chat.spec.ts` and confirm all pass

## Dev Notes

### Write Action Flow

The AI never executes writes directly. The full flow:

```
1. User: "Add a $45 expense at Costco under Groceries for today"
2. Frontend -> invoke("send_chat_message", { message, conversation_id })
3. Rust: pre-fetch DB context, call Bedrock
4. Bedrock returns structured action JSON (not a plain text response)
5. Rust: detects action JSON in response, emits chat:response-chunk events with the action payload
6. Frontend: useChat detects action payload, renders confirmation card in ChatMessageBubble
7. User clicks "Confirm"
8. Frontend -> invoke("execute_chat_action", { action_type: "create_expense", params: {...} })
9. Rust: routes to db/expense.rs::create_expense, logs to audit_log
10. Rust: returns success message
11. Frontend: shows "Done. $45.00 expense added to Groceries." in chat
12. Frontend: invalidates ["expenses"], ["dashboard"], ["budgets"] query keys
```

### Action Payload Format

The AI response for write actions includes a structured JSON block that the frontend parses:

```json
{
  "action": true,
  "action_type": "create_expense",
  "display": {
    "label": "Add Expense",
    "details": [
      { "field": "Merchant", "value": "Costco" },
      { "field": "Amount", "value": "$45.00" },
      { "field": "Category", "value": "Groceries" },
      { "field": "Date", "value": "2026-03-14" }
    ]
  },
  "params": {
    "merchant": "Costco",
    "amount_cents": 4500,
    "budget_category_id": 3,
    "date": "2026-03-14"
  }
}
```

The `display` object drives the confirmation card UI. The `params` object is sent back to the backend on confirm.

### Reusing Existing Tauri Commands

Write actions call the same `db/` functions that existing Tauri commands from previous epics use. `execute_chat_action` is a dispatcher that routes to:
- `db/expense.rs` functions (from Epic 3)
- `db/account.rs` functions (from Epic 3)
- `db/asset.rs` functions (from Epic 3)

This avoids duplicating write logic. The chat command layer is thin — it parses the action type and delegates.

### Confirmation Card UX (UX-DR10)

The confirmation card is embedded inside an AI ChatMessageBubble:
- Card sits within the muted-background AI bubble
- Card shows action type as header, detail rows as content, buttons as footer
- "Confirm" = primary button (teal). "Cancel" = ghost button.
- After either action, both buttons become disabled (prevents double-click)
- Follows the Confirmation Pattern from UX spec: "shows exactly what will happen (no vague 'Are you sure?')"

### Scope Boundaries

**In scope:** Action intent parsing, confirmation card UI, execute_chat_action command, audit logging, query invalidation.

**Out of scope (handled by other stories):**
- Chat page and basic data queries -> Story 7.1 (prerequisite)
- Floating chat bar (Cmd+K) -> Story 7.3
- Do NOT build the FloatingChatBar component
- Do NOT add new write operations to the database — reuse existing `db/` functions

### Dependencies

- **Story 7.1** must be complete (chat page, ChatMessageBubble, useChat hook, ai/chat.rs, commands/chat.rs all exist)
- **Epic 3** must be complete (expense, account, asset db functions exist to be called)

### Testing Notes

AI integration tests are deferred — they require AWS credentials. Playwright tests mock the action response:
- Mock `send_chat_message` to return a response containing a structured action payload
- Mock `execute_chat_action` to return a success message
- Test the confirmation card rendering, button interactions, and cancel flow without a real AI backend

### Project Structure Notes

```
src/
├── components/
│   └── chat/
│       └── ChatMessageBubble.tsx       # MODIFIED (add confirmation card variant)
└── hooks/
    └── useChat.ts                      # MODIFIED (add confirmAction, cancelAction)

src-tauri/
└── src/
    ├── ai/
    │   └── chat.rs                     # MODIFIED (extend system prompt for action parsing)
    └── commands/
        └── chat.rs                     # MODIFIED (add execute_chat_action command, action routing)

tests/
└── chat.spec.ts                        # MODIFIED (append write action tests)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — AI Chat Flow (write action path), Audit Log, Data Access Boundary]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR10 ChatMessageBubble (action confirmation variant), Confirmation Pattern, Button Hierarchy]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust: compiles clean
- TypeScript: clean
- Playwright: 9/9 chat tests pass, 118/118 full suite
### Completion Notes List
- Task 1: Extended ai/chat.rs system prompt with structured action format (```action JSON blocks) and instructions for action_types.
- Task 2: Added execute_chat_action command routing to existing db functions (create_expense, update_balance, create_account, update_asset_value) with audit logging.
- Task 3: ChatMessageBubble now detects action payloads from content via parseActionFromContent(). Renders confirmation card with action details, Confirm/Cancel buttons.
- Task 4: useChat hook adds confirmAction (calls execute_chat_action, invalidates queries) and cancelAction (marks handled, adds cancelled message).
- Task 5: ACTION_INVALIDATION_MAP maps action types to TanStack Query keys.
- Task 6: 4 Playwright tests for action card rendering, confirm/cancel buttons, cancel message, and disabled state.
### File List
- src-tauri/src/ai/chat.rs (modified - extended system prompt)
- src-tauri/src/commands/chat.rs (modified - added execute_chat_action)
- src-tauri/src/lib.rs (modified - registered execute_chat_action)
- src/components/chat/ChatMessageBubble.tsx (modified - action card, parseActionFromContent)
- src/hooks/useChat.ts (modified - confirmAction, cancelAction)
- src/routes/chat.tsx (modified)
- tests/chat.spec.ts (modified - added 4 Story 7.2 tests)

### Change Log
- 2026-03-15: Story 7.2 implemented - write actions with confirmation cards, execute_chat_action command, audit logging
