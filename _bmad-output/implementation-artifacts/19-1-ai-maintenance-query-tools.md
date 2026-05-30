# Story 19.1: AI Maintenance Query Tools

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to ask the AI chat about my maintenance schedules and due dates,
So that I can get quick answers without navigating to the maintenance page.

## Acceptance Criteria

1. **Given** the user has registered vehicles with maintenance schedules, **When** they ask "When is my Civic due for an oil change?" in AI chat, **Then** the system invokes `query_maintenance_status` tool with appropriate filters (FR60) **And** returns accurate vehicle nickname, task name, status, and next due km/date from the database (FR61, NFR5).

2. **Given** the user asks about service history, **When** they ask "When did I last change the oil on my Civic?", **Then** `query_maintenance_history` is invoked with `vehicle_id` and optional `task_type_key` **And** returns service log entries with date, odometer, and task name.

3. **Given** `query_maintenance_status` tool definition, **When** registered in `execute_tool_call`, **Then** it accepts optional `vehicle_id` and `status_filter` (`upcoming`/`due`/`overdue`/`all`) **And** returns vehicles with tasks and computed status — read-only, no write actions.

4. **Given** the budget-helper system prompt, **When** updated in `ai/chat.rs`, **Then** maintenance data model and tool usage guidance are documented **And** maintenance context (vehicle count, alert count) is injected into chat context string.

5. **Given** no vehicles are registered, **When** the user asks a maintenance question, **Then** the AI responds accurately that no vehicles are tracked — no fabricated data (FR61).

6. **Given** the existing 1-round tool-call pattern, **When** maintenance tools are invoked, **Then** they follow the same pattern as `query_expenses` — no multi-hop tool chains.

## Tasks / Subtasks

- [x] Task 1: Add maintenance query functions to db layer (AC: #1, #2, #3, #5)
  - [x] In `apps/desktop/src-tauri/src/db/maintenance.rs`, add `MaintenanceStatusFilters` struct: `vehicle_id: Option<i64>`, `status_filter: Option<String>` (`upcoming`/`due`/`overdue`/`all`, default `all`)
  - [x] Add `query_maintenance_status(conn, filters) -> Result<Vec<MaintenanceStatusRow>, AppError>` — loads vehicles (optionally filtered by id), joins tasks, calls `maintenance/evaluator.rs::evaluate_task()` for each task, filters by status when requested
  - [x] Add `MaintenanceHistoryFilters` struct: `vehicle_id: i64` (required), `task_type_key: Option<String>`, `limit: Option<i64>` (default 20, max 50)
  - [x] Add `query_maintenance_history(conn, filters) -> Result<Vec<MaintenanceHistoryRow>, AppError>` — service logs newest first, joined with task_type_key
  - [x] Serialize `task_type_key` in results (not i18n display names — AI uses keys; prompt documents the mapping)
  - [x] Return empty vec (not error) when no vehicles or no matching history

- [x] Task 2: Add tool result formatters in ai/chat.rs (AC: #1, #2, #5)
  - [x] Add `format_maintenance_status_result(rows: &[MaintenanceStatusRow]) -> String` — markdown table: Vehicle, Task, Status, Next Due Date, Next Due Km, Km Remaining, Days Remaining
  - [x] Add `format_maintenance_history_result(rows: &[MaintenanceHistoryRow]) -> String` — markdown table: Date, Task, Odometer (km), Notes
  - [x] Empty results: `"Tool result: No maintenance data found matching the query."` (status) / `"Tool result: No service history found."` (history)

- [x] Task 3: Extend system prompt with maintenance tools (AC: #3, #4, #6)
  - [x] In `build_budget_helper_prompt()`, add `query_maintenance_status` and `query_maintenance_history` to Available tools section (after `query_expenses`)
  - [x] Document params: `vehicle_id` (integer, optional for status), `status_filter` (string enum), `task_type_key` (string, optional for history), `limit` (integer, default 20, max 50)
  - [x] Add brief maintenance data model description: vehicles have nickname + odometer; 15 task types per vehicle; status computed from km OR time thresholds; task_type_key values listed
  - [x] Instruct AI to match vehicle by nickname (case-insensitive partial match) when user says "Civic" etc., then pass resolved `vehicle_id`
  - [x] Instruct AI: never fabricate maintenance data; if no vehicles, say so

- [x] Task 4: Inject maintenance context into build_context (AC: #4, #5)
  - [x] In `commands/chat.rs::build_context()`, append maintenance summary after income section:
    - Vehicle count (0 → `"No vehicles registered for maintenance tracking.\n"`)
    - Per vehicle: `id`, `nickname`, `odometer_km`
    - Alert count: tasks with status `upcoming`, `due`, or `overdue` across all vehicles (reuse status query or lightweight count helper)
  - [x] Gracefully skip section if maintenance tables don't exist yet (unlikely post-migration 018, but use `if let Ok(...)` pattern like other context blocks)

- [x] Task 5: Wire tools in execute_tool_call (AC: #1, #2, #3, #6)
  - [x] Import `maintenance_db` in `commands/chat.rs`
  - [x] Add `"query_maintenance_status"` arm: parse `vehicle_id`, `status_filter` from JSON params; call `maintenance_db::query_maintenance_status`; return `format_maintenance_status_result`
  - [x] Add `"query_maintenance_history"` arm: require `vehicle_id`; parse optional `task_type_key`, `limit`; call `maintenance_db::query_maintenance_history`; return `format_maintenance_history_result`
  - [x] Log result counts via `tracing::info!` (same pattern as `query_expenses`)
  - [x] Read-only only — no write-action tools for maintenance in MVP

- [x] Task 6: Rust unit tests (AC: #1, #2, #3, #5)
  - [x] Add `#[cfg(test)]` module in `db/maintenance.rs` with in-memory SQLite: seed vehicle + tasks, verify status query returns evaluated status
  - [x] Test status_filter filters correctly (e.g., only `overdue` tasks returned)
  - [x] Test history query returns logs ordered newest first
  - [x] Test empty vehicle list returns empty vec for status query

- [x] Task 7: Playwright tests for maintenance tool-call UX (AC: #6)
  - [x] Create `apps/desktop/tests/chat-maintenance-query.spec.ts` (mirror `chat-expense-query.spec.ts` mock pattern)
  - [x] Test: `query_maintenance_status` tool_call shows searching indicator then final answer with maintenance table
  - [x] Test: `query_maintenance_history` tool_call flow works
  - [x] Test: non-maintenance question does not trigger maintenance tool (mock returns plain text)
  - [x] Extend Tauri mock `__MOCK_SET_RESPONSE__` with `"maintenance_status"` and `"maintenance_history"` response types
  - [x] Run `pnpm --filter @nkbaz/desktop exec playwright test tests/chat-maintenance-query.spec.ts`

## Dev Notes

### Prerequisites — Epics 16–17 Must Be Complete

Story 19.1 is the AI layer on top of the maintenance data model. **Do not implement this story until Epics 16–17 are done:**

| Prerequisite | Required by |
|---|---|
| Migration `018_maintenance_tables.sql` | All queries |
| `maintenance/evaluator.rs` + `defaults.rs` | Status computation (already exist) |
| `db/maintenance.rs` CRUD from Stories 16.2–17.4 | Vehicle/task/log data to query |
| `commands/maintenance.rs` IPC | Confirms db layer is functional |

Current state (as of story creation): migration 018, `defaults.rs`, and `evaluator.rs` exist; `db/maintenance.rs` is a skeleton stub. Implement query functions in this story **only after** Stories 16.2+ populate the db layer, or extend the skeleton with both CRUD (if missing) and query functions together.

**Reuse rule:** Status MUST come from `maintenance/evaluator.rs::evaluate_task()` — never duplicate due-date math in `chat.rs` or query functions.

### Tool-Call Flow (Identical to query_expenses)

```
User message → send_chat_message
  → build_context (includes maintenance summary)
  → build_budget_helper_prompt (includes tool defs)
  → First LLM stream → parse_tool_call()
  → If maintenance tool:
      → save tool_call message
      → emit chat:tool-executing
      → execute_tool_call → db/maintenance.rs
      → save tool_result message
      → Second LLM stream with results
  → Strip residual tool_call blocks
  → Save final assistant message
```

**No frontend changes required.** Existing `useChat.ts` listens for `chat:tool-executing` and sets `content: "tool-searching"`. `ChatMessageBubble` renders the spinner + `t("chat.searching")`. The generic indicator works for all tools.

### Tool Definitions (add to system prompt)

```
- **query_maintenance_status**: Get maintenance task status for vehicles. All params optional.
  - `vehicle_id` (integer): Filter to one vehicle. Omit for all vehicles.
  - `status_filter` (string): "upcoming", "due", "overdue", or "all" (default)

- **query_maintenance_history**: Get service log history for a vehicle.
  - `vehicle_id` (integer, required): Vehicle to query
  - `task_type_key` (string, optional): Filter to one task type (e.g. "engine_oil_filter")
  - `limit` (integer): Max results, default 20, max 50
```

Example tool_call block:
```json
{
  "tool": "query_maintenance_status",
  "params": {
    "vehicle_id": 1,
    "status_filter": "due"
  }
}
```

### MaintenanceStatusRow Shape (suggested)

```rust
#[derive(Debug, Clone, Serialize)]
pub struct MaintenanceStatusRow {
    pub vehicle_id: i64,
    pub vehicle_nickname: String,
    pub task_type_key: String,
    pub status: String,           // "ok" | "upcoming" | "due" | "overdue"
    pub next_due_date: Option<String>,
    pub next_due_odometer_km: Option<i64>,
    pub km_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
    pub current_odometer_km: i64,
}
```

Task type keys for prompt reference: `engine_oil_filter`, `transmission_fluid`, `brake_fluid`, `coolant`, `differential_fluid`, `power_steering_fluid`, `tire_rotation`, `tire_inspection`, `brake_inspection`, `engine_air_filter`, `cabin_air_filter`, `spark_plugs`, `suspension_inspection`, `battery_check`, `wiper_blades`.

Map user phrases: "oil change" → `engine_oil_filter`; "tires" → `tire_rotation` or `tire_inspection`.

### Context Injection Example

Append to `build_context()` output:
```
Maintenance Tracking:
  Vehicles: 2
  Alerts: 3 tasks need attention

  - Civic (id=1, odometer=45000 km)
  - Truck (id=2, odometer=120000 km)
```

When zero vehicles: `Maintenance Tracking: No vehicles registered.\n\n`

### Scope Boundaries

**In scope:** Two read-only AI tools, prompt update, context enrichment, db query functions, formatters, Rust unit tests, Playwright mock tests.

**Out of scope:**
- Frontend UI changes (maintenance page, dashboard card — Epics 16–18)
- Write actions for maintenance via AI (log service, update odometer)
- New AI agent — extend existing `budget-helper` only
- Multi-hop tool chains (1-round limit preserved)
- i18n for task names in AI responses (use `task_type_key` in tables; AI can paraphrase in prose)

### Anti-Patterns (from architecture-car-maintenance.md)

- **Never** duplicate schedule evaluation SQL in `chat.rs` — call `evaluator.rs`
- **Never** store display names in DB or tool results — use `task_type_key`
- **Never** add write-action maintenance tools in MVP
- **Never** link maintenance vehicles to `passive_assets`

### Testing Notes

AI integration tests require AWS credentials — defer to Playwright mocks (same as Story 7.1 / expense query tool):

- Mock `send_chat_message` invoke + `chat:response-chunk` + `chat:tool-executing` events
- Rust `#[cfg(test)]` in `db/maintenance.rs` for query logic with seeded in-memory DB
- Run `cargo test` in `apps/desktop/src-tauri/` for maintenance query tests
- Run full suite before completion per dev-standards skill

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── ai/chat.rs                    # MODIFY — prompt + format_maintenance_* helpers
├── commands/chat.rs              # MODIFY — build_context + execute_tool_call arms
└── db/maintenance.rs             # MODIFY — query_maintenance_status/history

apps/desktop/tests/
└── chat-maintenance-query.spec.ts  # NEW
```

No TypeScript/React file changes expected.

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md — Epic 19, Story 19.1]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md — D6 AI Chat Tool Extensions, D3 Schedule Evaluator]
- [Source: _bmad-output/implementation-artifacts/tech-spec-ai-chat-expense-query-tool.md — tool-call loop pattern]
- [Source: _bmad-output/implementation-artifacts/7-1-ai-chat-page-with-data-queries.md — streaming + tool-call architecture]
- [Source: apps/desktop/src-tauri/src/ai/chat.rs — parse_tool_call, format_tool_result patterns]
- [Source: apps/desktop/src-tauri/src/commands/chat.rs — execute_tool_call, build_context]
- [Source: apps/desktop/tests/chat-expense-query.spec.ts — Playwright mock pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright tests initially failed: `/chat` redirect + `list_conversations` returning null crashed ConversationListPanel. Fixed by navigating to `/ai/budget-helper` and mocking `list_conversations`/`get_chat_messages` to return `[]`.

### Completion Notes List

- Added `query_maintenance_status` and `query_maintenance_history` to db layer with filter structs and row types; status evaluation reuses `attach_task_status` / `evaluate_task`.
- Added markdown formatters and extended budget-helper system prompt with maintenance tool docs and task_type_key mapping.
- Injected maintenance tracking context (vehicle list + alert count) into `build_context`.
- Wired both tools in `execute_tool_call` (read-only, 1-round pattern).
- Added 5 Rust unit tests for query functions; all 99 Rust tests pass.
- Added `chat-maintenance-query.spec.ts` with 3 passing Playwright tests.
- Full Playwright suite: 197 passed, 23 failed (pre-existing failures in chat.spec, chat-expense-query, ai-navigation, design-system, net-worth, import, budget — unrelated to this story).

### File List

- apps/desktop/src-tauri/src/db/maintenance.rs
- apps/desktop/src-tauri/src/ai/chat.rs
- apps/desktop/src-tauri/src/commands/chat.rs
- apps/desktop/tests/chat-maintenance-query.spec.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-05-29: Implemented AI maintenance query tools (read-only status/history), prompt/context enrichment, Rust unit tests, and Playwright mock tests.
