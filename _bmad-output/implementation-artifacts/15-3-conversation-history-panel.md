# Story 15.3: Conversation History Panel

Status: done

## Story

As a user,
I want to see a list of my past conversations with each AI agent and be able to resume or start new ones,
so that I can pick up where I left off and maintain continuity across sessions.

## Acceptance Criteria

1. **Given** the user navigates to `/ai/budget-helper` with existing conversations for that agent
   **When** the page renders
   **Then** the left panel shows a list of past conversations sorted by most recent activity (`updated_at DESC`)
   **And** each list item shows the conversation title (first 40 chars of first user message)
   **And** each list item shows a relative timestamp ("2 hours ago", "Yesterday", or date string for older)
   **And** the right panel shows the active conversation (the most recent one is loaded by default)

2. **Given** the left panel is rendered
   **When** the user looks at the top of the left panel
   **Then** a full-width "+ New Chat" button is visible above the conversation list

3. **Given** the user clicks "+ New Chat"
   **When** the action executes
   **Then** the right panel clears all messages and input is focused
   **And** no existing conversation is selected (all list items lose active highlight)
   **And** the URL does not contain a `?conversation` param
   **And** the first message the user sends creates a new conversation via `send_chat_message` with `conversation_id: null`

4. **Given** a conversation list item is visible
   **When** the user clicks it
   **Then** the right panel loads the messages for that conversation via the `get_chat_messages` command
   **And** the clicked item receives the active highlight (`bg-accent` + 3px teal left border)
   **And** the URL updates to `/ai/budget-helper?conversation=<id>`

5. **Given** the user navigates to `/ai/budget-helper?conversation=42`
   **When** the page loads
   **Then** conversation 42 is pre-selected in the left panel
   **And** its messages are loaded in the right panel
   **And** if conversation 42 doesn't exist, the existing validation error path in `useChat` shows the "conversation not found" error

6. **Given** the user is on `/ai/$agentId` with no prior conversations for that agent
   **When** the right panel renders
   **Then** an empty-state is shown: "[Agent name] is ready. Ask me anything about your finances." with the agent's icon
   **And** the input bar is active and ready to receive input

7. **Given** the user sends the first message in an empty-state view
   **When** `send_chat_message` returns successfully
   **Then** the left panel updates to show the new conversation with the auto-generated title
   **And** the new conversation item is highlighted as active

8. **Given** conversations are listed in the left panel
   **When** the user has more than 20 conversations
   **Then** only the 20 most recent are shown initially
   **And** a "Show more" button loads additional conversations

9. **Given** the `ConversationListPanel` component is rendered for an agent
   **When** it mounts
   **Then** it calls the `list_conversations` Tauri command with the current `agent_id`
   **And** uses TanStack Query with key `["chat-conversations", agentId]`

10. **Given** a new conversation is saved after the first message
    **When** the TanStack Query key `["chat-conversations", agentId]` is invalidated
    **Then** the conversation list refreshes and shows the new entry at the top

## Tasks / Subtasks

- [x] Add `ChatConversation` type to `types.ts` (AC: #9)
  - [x] Add `interface ChatConversation` with fields: `id: number`, `title: string | null`, `agent_id: string`, `created_at: string`, `updated_at: string`

- [x] Add `chatConversations` query key to `constants.ts` (AC: #9, #10)
  - [x] Add `chatConversations: (agentId: string) => ["chat-conversations", agentId] as const` to `queryKeys` object

- [x] Update `useChat` hook to support `agentId` (AC: #7, #10)
  - [x] Add `agentId?: string` to `UseChatOptions` interface
  - [x] Add `agentId?: string` to `useChat` function signature via options
  - [x] Pass `agent_id: agentId ?? 'budget-helper'` to `invoke("send_chat_message", ...)` call
  - [x] After `setConversationId(result.conversation_id)`, call `queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations(agentId ?? 'budget-helper') })` — but only when `conversationId` was `null` (first message creates new conversation)

- [x] Create `ConversationListPanel` component (AC: #1, #2, #3, #4, #8, #9)
  - [x] New file: `apps/desktop/src/components/chat/ConversationListPanel.tsx`
  - [x] Fetch conversations via `useQuery` with key `queryKeys.chatConversations(agentId)` calling `invoke<ChatConversation[]>("list_conversations", { agent_id: agentId })`
  - [x] Render "+ New Chat" button at the top (full-width, outlined style), calls `onNewChat` prop
  - [x] Render scrollable list of conversation items sorted newest first
  - [x] Each item shows: truncated title (max 40 chars, ellipsis), relative timestamp using `date-fns`
  - [x] Active item (matching `activeConversationId` prop) gets `bg-accent border-l-[3px] border-l-primary` styling
  - [x] Clicking an item calls `onSelectConversation(id)` prop
  - [x] Empty state: muted centered text "No past conversations. Start one below." when list is empty
  - [x] Show only first 20 items; "Show more" button loads the rest (local state toggle: `showAll`)
  - [x] Panel `<aside>` has `role="complementary"` (implicit via HTML element) and `aria-label="Conversation history"` in parent
  - [x] Conversation list `ul` has `role="list"`; each item `li` has `role="listitem"` and `aria-current="true"` when active

- [x] Update `/ai/$agentId` route from Story 15.2 scaffold (AC: #1–#10)
  - [x] File: `apps/desktop/src/routes/ai.$agentId.tsx`
  - [x] Read `agentId` from route params: `const { agentId } = Route.useParams()`
  - [x] Read `conversation` search param: `const { conversation } = Route.useSearch()`
  - [x] Validate search: `validateSearch: (s) => { const conv = Number(s.conversation); return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {}; }`
  - [x] Look up agent from `AGENTS` constant; if not found, render a "Agent not found" message
  - [x] Manage `activeConversationId` in local state (initialize from search param)
  - [x] Use `useNavigate` to update URL when conversation changes
  - [x] Call `useChat({ initialConversationId: activeConversationId ?? undefined, agentId })`
  - [x] Two-column flex layout with `-m-6` to negate parent padding
  - [x] Left column: `<aside>` containing `<ConversationListPanel>`
  - [x] Right column: `<ChatPanel>` component containing chat UI
  - [x] Chat UI is identical to the existing `chat.tsx` layout (PageHeader, scrollable message area, input bar at bottom)
  - [x] PageHeader title: agent name from `AGENTS` constant
  - [x] Empty state in right column when `messages.length === 0 && !initialConversationId && !chatError && agent`: agent icon + "[Agent name] is ready. Ask me anything about your finances."
  - [x] On new chat (`handleNewChat`): `setActiveConversationId(null)`, increment `chatKey` to force remount
  - [x] i18n: use `t("chat.agentReady", { agentName: agent.name })` for empty state text

- [x] Add i18n keys (AC: #3, #6, #8)
  - [x] Add to `en.json`: `"chat.newChat": "+ New Chat"`, `"chat.noConversations": "No past conversations. Start one below."`, `"chat.agentReady": "{{agentName}} is ready. Ask me anything about your finances."`, `"chat.showMore": "Show more"`
  - [x] Add to `fr.json`: `"chat.newChat": "+ Nouvelle discussion"`, `"chat.noConversations": "Aucune conversation passée. Commencez-en une ci-dessous."`, `"chat.agentReady": "{{agentName}} est prêt. Posez vos questions sur vos finances."`, `"chat.showMore": "Afficher plus"`

## Dev Notes

### Critical Dependency: Stories 15.1 and 15.2 Must Be Complete

Before implementing this story, verify:
- **Story 15.1:** `list_conversations` Tauri command exists and accepts `agent_id: String`; `send_chat_message` accepts `agent_id: String`; `ChatConversation` struct has `agent_id` field
- **Story 15.2:** Route file `apps/desktop/src/routes/ai.$agentId.tsx` exists as a scaffold; `apps/desktop/src/lib/agents.ts` exists with `AGENTS` constant

### Route File Pattern

TanStack Router uses file-based routing. The route for `/ai/$agentId` is in:
```
apps/desktop/src/routes/ai.$agentId.tsx
```

Route definition pattern (from `chat.tsx`):
```typescript
export const Route = createFileRoute("/ai/$agentId")({
  component: AgentChatPage,
  validateSearch: (search: Record<string, unknown>): { conversation?: number } => {
    const conv = Number(search.conversation);
    return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
  },
});
```

Access route params and search:
```typescript
const { agentId } = Route.useParams();
const { conversation } = Route.useSearch();
```

Do NOT manually edit `routeTree.gen.ts` — TanStack Router codegen regenerates it automatically when you add/modify route files. Run `npm run dev` or the codegen command to trigger regeneration.

### AGENTS Constant (from Story 15.2)

`apps/desktop/src/lib/agents.ts` exports:
```typescript
export interface Agent {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
}

export const AGENTS: Agent[] = [
  {
    id: 'budget-helper',
    name: 'Budget Helper',
    icon: Bot,
    description: 'Ask questions about your spending and budget.',
  },
];
```

Use `AGENTS.find(a => a.id === agentId)` to look up the agent. If not found, render an error state — do not crash.

### useChat Hook — Reset Strategy for New Chat

The existing `useChat` hook initializes `conversationId` state from `options?.initialConversationId` only once on mount. To reset the chat when the user clicks "+ New Chat", you need to reset the hook state.

**Recommended approach: key prop reset**

Pass a `key` to the right-panel section that drives the chat UI. When `activeConversationId` changes to `null` (new chat), increment a counter that resets the key, forcing a remount:

```typescript
const [chatKey, setChatKey] = useState(0);

const handleNewChat = () => {
  setActiveConversationId(null);
  setChatKey(k => k + 1);  // Force useChat remount
  navigate({ to: "/ai/$agentId", params: { agentId }, search: {} });
};
```

Then in JSX:
```tsx
<ChatPanel key={chatKey} agentId={agentId} conversationId={undefined} />
```

Where `ChatPanel` is either an extracted component or the section that calls `useChat`. This forces a clean `useChat` state without modifying the hook itself.

**Alternative approach (if the above creates flicker):** Expose a `reset()` function from `useChat` that clears `messages`, `conversationId`, and `chatError` state in one call. Add to the hook:
```typescript
const reset = useCallback(() => {
  setMessages([]);
  setConversationId(null);
  setChatError(null);
  streamBufferRef.current = "";
}, []);
// Include reset in the return value
```

The key-prop approach is simpler and avoids modifying the hook for this story (since Story 15.4 may also need hook changes).

### useChat Hook — agentId Changes

`useChat` currently tracks `conversationId` as internal state. When `agentId` changes (user switches agent tabs), the `activeConversationId` from route params will also change, triggering a new `key` which remounts `useChat` cleanly. No special handling needed for agent switching if using the key-prop reset pattern.

### TanStack Query — Conversation List

Standard `useQuery` pattern (follows project convention from `useAccounts.ts`):

```typescript
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { ChatConversation } from "@/lib/types";

const { data: conversations = [], isLoading } = useQuery({
  queryKey: queryKeys.chatConversations(agentId),
  queryFn: () => invoke<ChatConversation[]>("list_conversations", { agent_id: agentId }),
});
```

The query key `["chat-conversations", agentId]` is agent-scoped so switching agents refetches correctly.

### Query Invalidation After First Message

In `useChat`, after `setConversationId(result.conversation_id)`, detect whether this is the first message (i.e., `conversationId` was `null` before the call):

```typescript
const isNewConversation = conversationId === null;
setConversationId(result.conversation_id);
if (isNewConversation && agentId) {
  queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations(agentId) });
}
```

Note: `conversationId` is the state value at the time of the `invoke` call — it is `null` for new conversations.

### Relative Timestamp Formatting

Use `date-fns` (already in `package.json` at `^4.1.0`) for relative timestamps:

```typescript
import { formatDistanceToNow, parseISO } from "date-fns";

function formatRelativeTime(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
}
// "2 hours ago", "yesterday", "3 days ago", etc.
```

For the date-only format on older items, `date-fns` v4 uses the same `format` import:
```typescript
import { format, parseISO, isToday, isYesterday } from "date-fns";
```

### Two-Column Layout Structure

The `/ai/$agentId` route renders inside the existing `__root.tsx` shell which provides:
- `AppSidebar` on the left
- `TopBar` at the top
- `InnerTabNav` below TopBar
- `<main className="flex-1 min-w-0 overflow-y-auto bg-muted/50">` wrapping the route `<Outlet />`
- The main container has `max-w-[1280px] mx-auto p-6` padding

**Important:** The chat page needs full height without the outer container padding clipping the layout. The existing `chat.tsx` uses `<div className="flex h-full flex-col">` which works within `overflow-y-auto`. For the two-column layout, match this pattern:

```tsx
// ai.$agentId.tsx — AgentChatPage outer
<div className="flex h-full overflow-hidden -m-6">  {/* negate parent p-6 */}
  <aside className="w-[220px] shrink-0 border-r flex flex-col bg-background" role="complementary" aria-label={t("chat.conversationHistory")}>
    <ConversationListPanel ... />
  </aside>
  <div className="flex-1 flex flex-col overflow-hidden" role="main">
    {/* chat UI here */}
  </div>
</div>
```

The `-m-6` negates the `p-6` from the root `<main>` wrapper, allowing the two-column layout to fill the available viewport correctly. This is necessary because the existing chat page uses `flex h-full flex-col` which works for a single column but the two-column layout needs to span the full content area without the outer padding creating vertical scroll.

### Conversation List Panel — No Collapse Required for this Story

The UX spec mentions a collapsible left panel. **This story does NOT implement panel collapse.** The collapse toggle is a UX enhancement that can be added in a future story. Implement the fixed-width 220px panel only. Leave a TODO comment if desired:
```typescript
// TODO Story 15.x: implement collapsible panel (collapse to 48px icon strip)
```

### Chat UI in the Right Column

The right column should contain the identical chat UI from `chat.tsx`. Do not extract a separate component — inline the JSX in `ai.$agentId.tsx` for now to keep the diff minimal and avoid creating unnecessary abstractions before the full pattern is established. The full chat.tsx UI is:

1. `<PageHeader title={agent.name} />` — uses agent name as title instead of `t("chat.title")`
2. Error banners (not_configured, validation) — same as chat.tsx
3. Empty state when no messages and no active conversation
4. Message log with `ChatMessageBubble` list (scrollable div)
5. Input bar with Send button

Reference `apps/desktop/src/routes/chat.tsx` lines 36–113 for the exact JSX to replicate. Key classes:
- Outer: `flex h-full flex-col`
- Message area: `flex-1 overflow-y-auto px-4 py-4`
- Input area: `border-t p-4`
- Input + button wrapper: `mx-auto flex max-w-2xl gap-2`

### Tauri Command Names (from Story 15.1)

| Command | Parameters | Return |
|---------|-----------|--------|
| `list_conversations` | `{ agent_id: string }` | `ChatConversation[]` |
| `send_chat_message` | `{ message: string, conversation_id: number \| null, agent_id: string }` | `{ conversation_id: number }` |
| `get_chat_messages` | `{ conversation_id: number }` | `{ role: "user" \| "assistant", content: string }[]` |

All commands use `snake_case` per architecture conventions. The `invoke` call must match exactly.

### Types to Add in `types.ts`

```typescript
export interface ChatConversation {
  id: number;
  title: string | null;
  agent_id: string;
  created_at: string;
  updated_at: string;
}
```

The `title` field is `string | null` because new conversations have a title auto-generated from the first message, but empty conversations (if they somehow exist) may have null.

### Query Key to Add in `constants.ts`

```typescript
chatConversations: (agentId: string) => ["chat-conversations", agentId] as const,
```

Add this at the end of the `queryKeys` object before the closing `}`.

### Empty State Styling

Follow the existing empty state pattern from `chat.tsx`:
```tsx
<div className="flex h-full items-center justify-center">
  <div className="text-center">
    <agent.icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
    <p className="text-muted-foreground">{t("chat.agentReady", { agentName: agent.name })}</p>
  </div>
</div>
```

The `agent.icon` is a `LucideIcon` component — render it as `<agent.icon ... />`.

### Error Handling

The `not_configured` and `validation` error banners from `chat.tsx` should be preserved unchanged in the right column. The `validation` error type (conversation not found) is already handled by Story 14.1's `get_chat_messages` backend fix.

For the "agent not found" case (unknown `agentId` in URL), render:
```tsx
<div className="flex h-full items-center justify-center">
  <p className="text-muted-foreground">Agent not found.</p>
</div>
```

### URL Sync Pattern

The URL must stay in sync with the active conversation. Use `useNavigate` from TanStack Router:

```typescript
const navigate = useNavigate();

// When user clicks a conversation:
const handleSelectConversation = (id: number) => {
  setActiveConversationId(id);
  navigate({ to: "/ai/$agentId", params: { agentId }, search: { conversation: id } });
};

// When New Chat clicked:
const handleNewChat = () => {
  setActiveConversationId(null);
  setChatKey(k => k + 1);
  navigate({ to: "/ai/$agentId", params: { agentId }, search: {} });
};
```

`navigate` from TanStack Router replaces the current history entry by default when staying on the same route (`replace: true` is the default for same-route navigation). Verify this behavior — if it pushes to history instead, add `{ replace: true }` to the options.

### Conversation Title Display

The `title` field comes from Story 15.1's auto-generation: first 40 chars of the first user message (trimmed). Display it truncated with CSS ellipsis:
```tsx
<span className="truncate text-sm">{conversation.title ?? "New conversation"}</span>
```

The fallback "New conversation" handles the `null` case defensively.

### Show More Pattern

Use local state to toggle between showing 20 and all conversations:
```typescript
const [showAll, setShowAll] = useState(false);
const displayedConversations = showAll ? conversations : conversations.slice(0, 20);
```

Below the list, show the button only when there are more than 20:
```tsx
{!showAll && conversations.length > 20 && (
  <button onClick={() => setShowAll(true)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground">
    {t("chat.showMore")}
  </button>
)}
```

### Project Structure Notes

New files to create:
- `apps/desktop/src/components/chat/ConversationListPanel.tsx` — new component

Files to modify:
- `apps/desktop/src/routes/ai.$agentId.tsx` — upgrade from Story 15.2 scaffold to full 2-column layout
- `apps/desktop/src/hooks/useChat.ts` — add `agentId` option and query invalidation
- `apps/desktop/src/lib/constants.ts` — add `chatConversations` query key
- `apps/desktop/src/lib/types.ts` — add `ChatConversation` interface
- `apps/desktop/src/locales/en.json` — add 4 new keys
- `apps/desktop/src/locales/fr.json` — add 4 new keys

Do NOT modify:
- `apps/desktop/src/routeTree.gen.ts` — auto-generated by TanStack Router, will regenerate on dev server start
- `apps/desktop/src/components/chat/ChatMessageBubble.tsx` — used as-is, no changes needed
- `apps/desktop/src/components/chat/FloatingChatBar.tsx` — FloatingChatBar agent awareness is Story 15.4
- `apps/desktop/src/routes/chat.tsx` — was already changed to a redirect in Story 15.2

### Architecture Compliance

Per `architecture-desktop.md`:
- TypeScript strict mode throughout — no `any` unless unavoidable
- `PascalCase` for component files and names
- `camelCase` for hooks and utilities
- Tauri IPC commands use `snake_case` in `invoke()` calls
- All monetary and date values: use the existing patterns (ISO strings from backend)
- TanStack Query wraps all IPC data fetches — do NOT use raw `invoke` in component render without `useQuery`
- State management: TanStack Query for server data, React `useState` for local UI state
- No global Zustand store needed for this story — `activeConversationId` is route-local state

### References

- Story 15.1 backend contract: `_bmad-output/planning-artifacts/epics-ai-section.md` (Story 15.1 section)
- Story 15.2 scaffold files: created by Story 15.2 (verify they exist before starting)
- Existing chat pattern: `apps/desktop/src/routes/chat.tsx`
- Existing hook pattern: `apps/desktop/src/hooks/useChat.ts`
- TanStack Query pattern: `apps/desktop/src/hooks/useAccounts.ts`
- Query keys: `apps/desktop/src/lib/constants.ts`
- Types: `apps/desktop/src/lib/types.ts`
- Locales: `apps/desktop/src/locales/en.json` and `fr.json`
- UX spec AI Section: `_bmad-output/planning-artifacts/ux-design-specification.md` (section "AI Section & Multi-Agent Chat")
- Architecture: `_bmad-output/planning-artifacts/architecture-desktop.md`
- Epics: `_bmad-output/planning-artifacts/epics-ai-section.md` (Story 15.3 section)

## Playwright Test Specifications

```
describe('Conversation History Panel')

test('left panel shows past conversations')
  - Seed at least one conversation for 'budget-helper' agent via Tauri invoke (or use existing data)
  - Navigate to '/ai/budget-helper'
  - Assert left panel contains at least one conversation item
  - Assert conversation item shows non-empty title text

test('New Chat button clears right panel')
  - Navigate to '/ai/budget-helper?conversation=<existing_id>'
  - Assert messages are loaded in right panel
  - Click '+ New Chat' button
  - Assert URL no longer contains '?conversation='
  - Assert right panel shows empty-state or no messages

test('clicking conversation item loads messages')
  - Seed two conversations for 'budget-helper' agent
  - Navigate to '/ai/budget-helper'
  - Click the second conversation item in the left panel
  - Assert URL updates to '/ai/budget-helper?conversation=<id>'
  - Assert right panel shows messages for that conversation
  - Assert clicked item has bg-accent or active styling

test('active conversation is highlighted in left panel')
  - Navigate to '/ai/budget-helper?conversation=<id>'
  - Assert the corresponding left panel item has bg-accent or active class

test('empty state shown when no conversations exist for agent')
  - Navigate to '/ai/some-new-agent-with-no-conversations'
  - Assert right panel shows empty-state message containing agent name
  - Assert input bar is active (not disabled)

test('sending first message creates conversation and updates left panel')
  - Navigate to '/ai/budget-helper' with no pre-selected conversation
  - Type a message in the input bar and press Enter
  - Wait for response
  - Assert left panel now contains a new conversation item
  - Assert new item title matches first 40 chars of sent message (or a prefix of it)
```

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None

### Completion Notes List

- Used key-prop reset pattern for `ChatPanel` (`chatKey` state) to remount `useChat` on new chat and conversation selection
- `handleSelectConversation` also increments `chatKey` to force a fresh hook state when loading a different conversation
- `useChat` hook now accepts `agentId` option and passes `agent_id` to `send_chat_message`; invalidates `chatConversations` query on first message
- Conversation list panel is fixed-width 220px with no collapse (collapse deferred per story notes)
- TypeScript compiles cleanly with no errors

### File List

- `apps/desktop/src/components/chat/ConversationListPanel.tsx` (new)
- `apps/desktop/src/routes/ai.$agentId.tsx` (modified)
- `apps/desktop/src/hooks/useChat.ts` (modified)
- `apps/desktop/src/lib/constants.ts` (modified)
- `apps/desktop/src/lib/types.ts` (modified)
- `apps/desktop/src/locales/en.json` (modified)
- `apps/desktop/src/locales/fr.json` (modified)
