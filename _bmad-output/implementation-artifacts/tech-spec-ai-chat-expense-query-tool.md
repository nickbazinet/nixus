---
title: 'AI Chat Expense Query Tool'
type: 'feature'
created: '2026-03-25'
status: 'done'
baseline_commit: 'b82df5d4'
context: []
---

# AI Chat Expense Query Tool

<frozen-after-approval reason="human-owned intent -- do not modify unless human renegotiates">

## Intent

**Problem:** The AI chat assistant cannot query expense data. It has budget summaries, accounts, and assets in its context, but no way to answer questions like "when was my last expense?" or "show me all Costco purchases." Expense data is only accessible through the Expenses page.

**Approach:** Add a tool-call loop to the AI chat backend. The AI can request an expense query via a `tool_call` block (same pattern as the existing `action` block). The backend detects it, executes the query against SQLite, feeds results back to the AI in a second LLM call, and streams the final answer. The frontend shows a "searching" indicator during the tool execution phase.

## Boundaries & Constraints

**Always:**
- Amounts in cents internally; dollars in AI responses
- Tool-call loop limited to 1 round (no recursive tool calls)
- Query results capped at 100 rows to prevent prompt bloat
- Include category name (joined from budget_categories) in query results so the AI can reference it
- Preserve existing streaming UX for non-tool-call responses

**Ask First:**
- Adding additional query tools beyond expenses (accounts, income, etc.)
- Changing the action block format or existing action types

**Never:**
- Allow the AI to modify or delete expenses via the query tool (read-only)
- Send raw SQL from the AI to the backend
- Break existing chat features (actions, streaming, conversation persistence)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Last expense | "when was my last expense?" | AI emits tool_call with limit=1, sort=date_desc; responds with date, merchant, amount | N/A |
| Filtered by merchant | "show me all Costco expenses" | AI emits tool_call with merchant="Costco"; responds with table | N/A |
| Date range query | "how much did I spend in January?" | AI emits tool_call with date range; responds with total + breakdown | N/A |
| No results | "show me expenses at Target" (none exist) | AI responds "No expenses found matching that query" | N/A |
| No tool needed | "what's my budget status?" | AI answers from existing context, no tool call emitted | N/A |
| DB error during query | Tool call issued but DB fails | AI receives error message, responds gracefully to user | Backend catches error, passes as tool result |

</frozen-after-approval>

## Code Map

- `src-tauri/src/db/expense.rs` -- Add `search_expenses()` with flexible filters
- `src-tauri/src/ai/chat.rs` -- Add tool definitions to system prompt, implement tool-call detection + loop
- `src-tauri/src/commands/chat.rs` -- Wire tool execution into `send_chat_message`, add query executor
- `src/hooks/useChat.ts` -- Handle `chat:tool-executing` event for loading state
- `src/components/chat/ChatMessageBubble.tsx` -- Parse `tool_call` blocks (show searching indicator), render markdown tables in AI responses

## Tasks & Acceptance

**Execution:**
- [ ] `src-tauri/src/db/expense.rs` -- Add `search_expenses(conn, filters)` function with optional date_from, date_to, merchant (LIKE), category_id, limit (default 50, max 100), sort order; JOIN budget_categories to include category name
- [ ] `src-tauri/src/ai/chat.rs` -- Update system prompt with `query_expenses` tool definition; add `parse_tool_call()` to detect tool_call blocks in AI response; add `format_tool_result()` to serialize query results for the AI
- [ ] `src-tauri/src/ai/chat.rs` -- Implement tool-call loop: after first streaming pass, if tool_call detected, emit `chat:tool-executing` event, execute query, make second LLM call (streaming) with tool results injected as conversation context
- [ ] `src-tauri/src/commands/chat.rs` -- Add `execute_tool_call()` helper that parses tool params and calls `search_expenses`; integrate into `send_chat_message` flow
- [ ] `src/hooks/useChat.ts` -- Listen for `chat:tool-executing` event; show intermediate loading state in message list while tool executes
- [ ] `src/components/chat/ChatMessageBubble.tsx` -- Detect `tool_call` blocks and render as "Searching your expenses..." indicator; add markdown table rendering to `formatAiContent`
- [ ] `tests/chat-expense-query.spec.ts` -- Test: tool_call block triggers search indicator; final response renders with expense data; non-tool-call messages unaffected

**Acceptance Criteria:**
- Given the user asks "when was my last expense?", when the AI processes the message, then it queries expenses and responds with the date, merchant, and amount of the most recent expense
- Given the user asks "show me all Costco expenses", when the AI processes the message, then it returns a formatted table of matching expenses with dates, amounts, and categories
- Given no expenses match the query, when the AI receives empty results, then it responds naturally (e.g., "No expenses found")
- Given the user asks a non-expense question (e.g., "what's my budget?"), when the AI processes the message, then it answers from existing context without triggering a tool call
- Given a tool call is executing, when the frontend receives `chat:tool-executing`, then it shows a loading indicator before the final answer streams in

## Design Notes

**Tool-call flow (backend):**
1. First LLM call streams as usual; full response collected in `full_response`
2. After stream completes, `parse_tool_call(&full_response)` checks for ` ```tool_call ... ``` `
3. If found: emit `chat:tool-executing` event, execute query, build message history with user msg + tool result, make second streaming LLM call
4. Save only the final AI response to DB (not the intermediate tool_call)
5. If not found: normal flow, response already streamed and saved

**Tool definition in system prompt (example):**
```
Available tools -- respond with a ```tool_call block to use:
- query_expenses: Search expense records. Params: date_from (YYYY-MM-DD), date_to, merchant (partial match), category_id, limit (default 50, max 100), sort ("date_asc"|"date_desc")
```

**Frontend tool_call handling:**
The `tool_call` block appears in streamed content. `ChatMessageBubble` detects it (like `action` blocks) and renders a searching indicator instead of raw JSON. When the second streaming response arrives, it replaces the indicator content.

## Verification

**Commands:**
- `cd src-tauri && cargo check` -- expected: no compilation errors
- `cd src-tauri && cargo clippy` -- expected: no warnings
- `npx tsc --noEmit` -- expected: no type errors
- `npx playwright test tests/chat-expense-query.spec.ts` -- expected: all tests pass
