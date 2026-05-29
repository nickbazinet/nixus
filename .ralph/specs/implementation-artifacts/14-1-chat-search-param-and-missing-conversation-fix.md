# Story 14.1: Chat Search Param and Missing Conversation Fix

Status: ready-for-dev

## Story

As a user,
I want the chat page to validate conversation IDs properly and show a clear error when a conversation doesn't exist,
so that invalid URLs don't silently show a blank page or accept garbage values.

## Acceptance Criteria

1. Navigating to `/chat?conversation=999` (non-existent ID) shows a clear "conversation not found" message with a link to start a new chat — never a blank page.
2. `validateSearch` rejects negative numbers, floats, and zero — only positive integers are accepted as a `conversation` search param.
3. The "conversation not found" error uses the existing `destructive` border/bg styling consistent with other error states in the app.
4. No regression: valid existing conversation IDs still load normally; the empty-state "start chatting" message still shows when no conversation param is provided.

## Tasks / Subtasks

- [ ] Fix validateSearch (AC: #2)
  - [ ] In `apps/desktop/src/routes/chat.tsx` line 13, replace `Number.isFinite(conv)` with `Number.isInteger(conv) && conv > 0`

- [ ] Add conversation existence check in Rust (AC: #1)
  - [ ] In `apps/desktop/src-tauri/src/db/chat.rs`, add `pub fn conversation_exists(conn: &Connection, conversation_id: i64) -> Result<bool, AppError>` using `SELECT 1 FROM chat_conversations WHERE id = ?1`; return `Ok(false)` on `QueryReturnedNoRows`
  - [ ] In `apps/desktop/src-tauri/src/commands/chat.rs`, inside `get_chat_messages`, call `chat_db::conversation_exists(&conn, conversation_id)?` before calling `get_conversation_messages_for_display()`; return `AppError::Validation { message: "Conversation not found".to_string(), field: Some("conversation_id".to_string()) }` when false

- [ ] Show error in UI (AC: #1, #3)
  - [ ] In `apps/desktop/src/routes/chat.tsx`, add a block after the `not_configured` error block that handles `chatError?.type === "validation"` — render a destructive-styled card with the not-found message and a `<Link to="/chat">` to start a new chat

- [ ] Add i18n keys (AC: #1, #3)
  - [ ] Add `chat.conversationNotFound` and `chat.startNew` to all locale files in `apps/desktop/src/locales/`

## Dev Notes

### Bug 1 — validateSearch

**File:** `apps/desktop/src/routes/chat.tsx`, lines 11–14

Current code:
```typescript
validateSearch: (search: Record<string, unknown>): { conversation?: number } => {
  const conv = Number(search.conversation);
  return Number.isFinite(conv) ? { conversation: conv } : {};
},
```

`Number.isFinite(-5)` and `Number.isFinite(3.7)` both return `true`. Fix:
```typescript
return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
```

### Bug 2 — Blank page on non-existent conversation

**Root cause:** `get_chat_messages` in `commands/chat.rs` calls `get_conversation_messages_for_display()` which runs a `SELECT ... WHERE conversation_id = ?1` — when the ID doesn't exist, it returns an empty `Vec` (no error). The hook receives `[]`, sets `messages = []`, and the route renders the normal "start chatting" empty state.

**Fix — db layer** (`apps/desktop/src-tauri/src/db/chat.rs`, add after existing functions):
```rust
pub fn conversation_exists(conn: &Connection, conversation_id: i64) -> Result<bool, AppError> {
    let result = conn.query_row(
        "SELECT 1 FROM chat_conversations WHERE id = ?1",
        params![conversation_id],
        |_| Ok(()),
    );
    match result {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(AppError::from(e)),
    }
}
```

**Fix — command layer** (`apps/desktop/src-tauri/src/commands/chat.rs`, inside `get_chat_messages` before the existing `get_conversation_messages_for_display` call):
```rust
if !chat_db::conversation_exists(&conn, conversation_id)? {
    return Err(AppError::Validation {
        message: "Conversation not found".to_string(),
        field: Some("conversation_id".to_string()),
    });
}
```

**Fix — UI layer** (`apps/desktop/src/routes/chat.tsx`, add after the existing `not_configured` block around line 52):
```tsx
{chatError?.type === "validation" && (
  <div className="mx-auto max-w-md rounded-lg border border-destructive bg-destructive/10 p-4 text-sm">
    {t("chat.conversationNotFound")}
    {" — "}
    <Link to="/chat" className="text-primary underline">
      {t("chat.startNew")}
    </Link>
  </div>
)}
```

### Error type contract

`AppError::Validation` serializes as `{ "type": "validation", "message": "...", "field": "..." }`. The frontend `chatError` already holds the deserialized error shape — `chatError?.type === "validation"` is the correct check, consistent with the existing `not_configured` pattern in the same file.

### Locale files

Locale files are in `apps/desktop/src/locales/`. Add to all language files:
```json
"chat": {
  "conversationNotFound": "This conversation doesn't exist",
  "startNew": "Start a new chat"
}
```

### Project Structure Notes

- Only touches the chat surface — no other features affected
- `conversation_exists` is a pure read query — no state changes, no audit log needed
- The `useChat` hook already propagates errors via `chatError` — no hook changes needed
- Do NOT add the existence check to `get_chat_messages` as a general pattern for all queries; this is specific to the direct-URL navigation scenario

### References

- Chat route: `apps/desktop/src/routes/chat.tsx`
- Chat hook: `apps/desktop/src/hooks/useChat.ts`
- Chat commands: `apps/desktop/src-tauri/src/commands/chat.rs`
- Chat db: `apps/desktop/src-tauri/src/db/chat.rs`
- AppError serialization: `apps/desktop/src-tauri/src/error.rs`
- Deferred work source: `_bmad-output/implementation-artifacts/deferred-work.md` (Chat sections)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
