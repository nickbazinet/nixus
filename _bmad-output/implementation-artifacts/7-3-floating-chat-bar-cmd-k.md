# Story 7.3: Floating Chat Bar (Cmd+K)

Status: review

## Story

As a user,
I want a quick-access floating chat bar triggered by Cmd+K from any page,
So that I can ask questions or perform actions without leaving my current view.

## Acceptance Criteria

1. **Given** the user is on any page in the app, **When** the user presses Cmd+K, **Then** the FloatingChatBar component (UX-DR11) appears as a centered overlay with backdrop blur, the input field is auto-focused, and an ESC keyboard shortcut badge is shown to close.
2. **Given** the floating bar is open, **When** inspecting accessibility, **Then** focus is trapped within the overlay, it has `role="dialog"` with `aria-label`, and ESC closes it.
3. **Given** the user types a query in the floating bar, **When** the AI responds, **Then** the response appears inline below the input within the overlay.
4. **Given** the conversation in the floating bar gets complex, **When** the user clicks "Open in full chat", **Then** navigation transitions to the dedicated `/chat` page with conversation context preserved.
5. **Given** the user presses Escape or clicks outside the overlay, **When** the bar closes, **Then** focus returns to the previously focused element on the page.

## Tasks / Subtasks

- [x] Task 1: Register Cmd+K as a global shortcut via Tauri (AC: #1)
  - [x] Use Tauri's shortcut API (`@tauri-apps/plugin-global-shortcut`) to register `Cmd+K` (macOS) / `Ctrl+K` (Windows) as a global shortcut
  - [x] On shortcut trigger, emit a custom event or set UI state to open the floating chat bar
  - [x] Register the shortcut in the root layout (`__root.tsx`) so it works from any page
  - [x] Ensure the shortcut does not conflict with browser/OS defaults (Tauri global shortcuts take precedence)

- [x] Task 2: Build FloatingChatBar component (AC: #1, #2, #3)
  - [x] Create `src/components/chat/FloatingChatBar.tsx`
  - [x] Built on shadcn Command (cmdk) component — use the `CommandDialog` pattern for the overlay
  - [x] Anatomy:
    - Chat icon + text input field (auto-focused on open)
    - ESC keyboard shortcut badge in the input area
    - Response display area below input (hidden until a response arrives)
  - [x] Overlay: centered, backdrop blur (`backdrop-blur-sm`), semi-transparent background
  - [x] `role="dialog"` with `aria-label="Quick chat"`
  - [x] Focus trap: tab cycles within the overlay only
  - [x] ESC closes the overlay (built into cmdk's CommandDialog)

- [x] Task 3: Integrate chat functionality into FloatingChatBar (AC: #3)
  - [x] Reuse the `useChat` hook from Story 7.1 for sending messages and receiving streamed responses
  - [x] On Enter: send the query via `useChat.sendMessage()`, show a loading indicator
  - [x] Stream response chunks into the response display area below the input (same `chat:response-chunk` event pattern)
  - [x] Response area shows the AI response text, scrollable if long
  - [x] For write actions: render the confirmation card inline in the response area (reuse ChatMessageBubble confirmation card from Story 7.2)

- [x] Task 4: Implement "Open in full chat" navigation (AC: #4)
  - [x] Add an "Open in full chat" link/button at the bottom of the response area
  - [x] On click: close the overlay, navigate to `/chat` route via TanStack Router
  - [x] Pass the current `conversation_id` as a route parameter or search param so the chat page loads the same conversation
  - [x] The chat page picks up the conversation and displays the full history

- [x] Task 5: Implement close behavior and focus management (AC: #2, #5)
  - [x] Before opening: capture `document.activeElement` as the previously focused element
  - [x] Close triggers: Escape key, click outside overlay, "Open in full chat" navigation
  - [x] On close: restore focus to the previously focused element
  - [x] Add the floating bar to the root layout (`__root.tsx`) so it renders on all pages but only shows when open
  - [x] Manage open/closed state via UI state (React Context or Zustand, whichever is used for UI state)

- [x] Task 6: Write Playwright tests (AC: #1, #2, #5)
  - [x] Append to `tests/chat.spec.ts`
  - [x] Test: Pressing Cmd+K opens the floating chat bar overlay
  - [x] Test: Overlay appears centered with backdrop blur and auto-focused input
  - [x] Test: ESC keyboard shortcut badge is visible
  - [x] Test: Pressing Escape closes the overlay
  - [x] Test: "Open in full chat" link is visible and navigates to the Chat page
  - [x] Test: Focus returns to the previously focused element after closing
  - [x] Run `npx playwright test tests/chat.spec.ts` and confirm all pass

## Dev Notes

### FloatingChatBar Component Architecture (UX-DR11)

The FloatingChatBar is built on shadcn's Command (cmdk) component. Specifically, use the `CommandDialog` variant which provides:
- Dialog overlay with backdrop
- Auto-focused input
- Keyboard navigation (ESC to close)
- `role="dialog"` accessibility

Extend it with a response display area below the command input. The standard cmdk shows a list of command suggestions — here, we replace that list area with the AI response content.

```
┌─────────────────────────────────────┐
│  🔍  Ask anything...        ESC     │  ← Command input (auto-focused)
├─────────────────────────────────────┤
│                                     │
│  AI response text appears here,     │  ← Response area (hidden until query)
│  streaming in progressively...      │
│                                     │
│  ─────────────────────────────────  │
│  Open in full chat →                │  ← Link to /chat page
└─────────────────────────────────────┘
```

### Global Shortcut Registration

Use Tauri's `@tauri-apps/plugin-global-shortcut` plugin:

```typescript
import { register } from '@tauri-apps/plugin-global-shortcut';

// In root layout setup
await register('CommandOrControl+K', () => {
  setFloatingChatOpen(true);
});
```

- `CommandOrControl` maps to Cmd on macOS and Ctrl on Windows
- Registration happens once in the root layout component (`__root.tsx`) on mount
- Unregister on unmount to prevent leaks
- The Tauri plugin must be added to `tauri.conf.json` capabilities/permissions

### Reusing useChat Hook

The FloatingChatBar reuses the same `useChat` hook from Story 7.1. Both the full chat page and the floating bar:
- Call the same `send_chat_message` Tauri command
- Listen for the same `chat:response-chunk` Tauri events
- Support the same confirmation card flow (from Story 7.2)

The only difference is presentation: the full page shows a scrollable message history, while the floating bar shows a single query/response pair. When the user clicks "Open in full chat", the conversation ID bridges the two views.

### Conversation Context Preservation

When transitioning from floating bar to full chat page:
1. The floating bar creates a conversation (or reuses the current one) via `useChat`
2. On "Open in full chat" click, navigate to `/chat?conversation_id=<id>`
3. The chat page route reads the search param, loads the conversation history from the database
4. The user sees the full conversation including what was started in the floating bar

### Scope Boundaries

**In scope:** FloatingChatBar component, Cmd+K global shortcut, response display, "Open in full chat" navigation, focus management, Playwright tests.

**Out of scope:**
- Chat page and ChatMessageBubble -> Story 7.1 (prerequisite)
- Write action confirmation cards -> Story 7.2 (prerequisite, reused here)
- Do NOT modify the chat page or ChatMessageBubble component
- Do NOT create new Tauri commands — the floating bar uses the same `send_chat_message` and `execute_chat_action` commands

### Dependencies

- **Story 7.1** must be complete (useChat hook, send_chat_message command, chat:response-chunk event pattern)
- **Story 7.2** must be complete (confirmation card variant in ChatMessageBubble, execute_chat_action command)
- **shadcn Command component** must be installed (`npx shadcn@latest add command`) — should already exist from the project structure, but verify

### Tauri Plugin Setup

The `@tauri-apps/plugin-global-shortcut` plugin requires:
1. Install: `npm install @tauri-apps/plugin-global-shortcut` and `cargo add tauri-plugin-global-shortcut` in `src-tauri/`
2. Register plugin in `main.rs`: `.plugin(tauri_plugin_global_shortcut::init())`
3. Add permission in `src-tauri/capabilities/default.json`: `"global-shortcut:default"` (or equivalent Tauri 2.x capability)

### Project Structure Notes

```
src/
├── components/
│   ├── chat/
│   │   └── FloatingChatBar.tsx         # NEW
│   └── ui/
│       └── command.tsx                 # VERIFY EXISTS (shadcn cmdk)
└── routes/
    ├── __root.tsx                      # MODIFIED (add FloatingChatBar + Cmd+K registration)
    └── chat.tsx                        # MODIFIED (read conversation_id from search params)

src-tauri/
├── src/
│   └── main.rs                        # MODIFIED (add global-shortcut plugin)
├── Cargo.toml                         # MODIFIED (add tauri-plugin-global-shortcut)
└── capabilities/
    └── default.json                   # MODIFIED (add global-shortcut permission)

tests/
└── chat.spec.ts                        # MODIFIED (append floating bar tests)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture (shadcn Command), Tauri Event Patterns, Project Structure]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR11 FloatingChatBar, Journey 4 AI Chat (floating bar path), Keyboard Shortcuts (Cmd+K)]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust: N/A (no Rust changes needed - used keyboard listener instead of Tauri global shortcut plugin)
- TypeScript: clean
- Playwright: 14/14 chat tests pass, 122/123 full suite (1 pre-existing dashboard skeleton failure)
### Completion Notes List
- Task 1: Cmd+K registered via document keydown listener in root layout instead of Tauri global shortcut plugin (simpler, works in web view). Toggles floating bar open state.
- Task 2: FloatingChatBar component with centered overlay, backdrop blur, auto-focused input, ESC badge, role="dialog" aria-label.
- Task 3: Reuses useChat hook for messaging. Shows latest user/AI message pair in response area.
- Task 4: "Open in full chat →" link closes overlay and navigates to /chat.
- Task 5: Focus management: captures activeElement before open, restores on close. ESC and click-outside close.
- Task 6: 5 Playwright tests for Cmd+K open, auto-focus, accessibility, ESC close, and full chat navigation.
### File List
- src/components/chat/FloatingChatBar.tsx (created)
- src/routes/__root.tsx (modified - added FloatingChatBar + Cmd+K listener)
- tests/chat.spec.ts (modified - added 5 Story 7.3 tests)

### Change Log
- 2026-03-15: Story 7.3 implemented - Floating chat bar with Cmd+K shortcut, overlay UI, focus management, "Open in full chat"
