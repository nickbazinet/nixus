---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
inputDocuments:
  - prd.md
  - architecture.md
  - ux-design-specification.md
scope: ai-section-epic-13
---

# nkbaz-finance - AI Section Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the AI Section feature (Epic 15), decomposing the requirements into four independently-deliverable stories. The AI Section adds a dedicated "AI" module to the sidebar with multi-agent chat, per-agent conversation history, and a floating chat bar with agent awareness. The existing `/chat` route and `Budget Helper` functionality are preserved and migrated into the new structure.

---

## Requirements Inventory

### Functional Requirements

- FR40: User can navigate to a dedicated "AI" section in the app from the sidebar
- FR41: AI section displays all available AI agent personalities for selection
- FR42: User can select a specific AI agent and begin a conversation with it
- FR43: Each AI agent has a distinct persona, name, and system prompt
- FR44: User can view a list of past conversations scoped to each agent, sorted by most recent
- FR45: User can resume any past conversation with an AI agent
- FR46: User can start a new conversation from within an agent view
- FR47: Each conversation is permanently associated with a specific agent identity
- FR48: FloatingChatBar (Cmd+K) defaults to the last-used agent

### NonFunctional Requirements (applicable to Epic 15)

- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay) — applies to agent switching and conversation loading
- NFR5: AI chat responses return within 5 seconds for data queries — applies to all agents
- NFR9: System gracefully handles AWS Bedrock service unavailability with clear error messaging — applies to all agent chats
- NFR11: Financial records are never silently lost or corrupted — conversations must be durably saved and associated with the correct agent

### Additional Requirements

- `agent_id` column on `chat_conversations`: `TEXT NOT NULL DEFAULT 'budget-helper'` — existing rows automatically inherit 'budget-helper' via DEFAULT
- DB migration uses the established version-numbered `.sql` file pattern with `schema_version` table; applied at startup
- New index: `CREATE INDEX IF NOT EXISTS idx_chat_conversations_agent_id ON chat_conversations(agent_id)` — supports efficient per-agent conversation listing
- Agent configs are a hardcoded TypeScript constant in `apps/desktop/src/lib/agents.ts` — NOT stored in the database and NOT user-configurable
- `list_conversations` Tauri command is scoped by `agent_id: String` parameter
- `send_chat_message` and `create_conversation` Tauri commands accept an `agent_id: String` parameter
- `build_system_prompt` in `ai/chat.rs` dispatches on `agent_id` to select the correct persona prompt
- Conversation title is auto-generated as the first 40 characters of the first user message (trimmed), with no separate title-generation LLM call
- TanStack Router file-based routing: new route files follow the `apps/desktop/src/routes/ai.$agentId.tsx` naming convention
- `last_used_agent_id` is persisted in `localStorage` (key: `"nixus:last_used_agent_id"`) with a default fallback of `'budget-helper'`
- All Tauri IPC commands use `snake_case` naming and return `Result<T, AppError>`
- `ChatConversation` struct gains `agent_id: String` field serialized as `agent_id` in JSON

### UX Design Requirements

- UX-DR10: Sidebar "AI" section label — displayed below the "Finance" label using the same section-label style (same visual treatment as the existing Wallet + "Finance" label). Icon: `Bot` from lucide-react. Renders as a non-clickable label. When sidebar is collapsed, icon is visible; when expanded, text "AI" is visible.
- UX-DR11: `/ai` landing page — card grid showing all available agents. Each card shows agent name, icon, and one-line description. Clicking a card navigates to `/ai/$agentId`.
- UX-DR12: `/ai/$agentId` layout — two-column layout. Left panel (240px fixed, scrollable): conversation list with "+ New Chat" button at top. Right panel (flex-1): active chat area (identical to existing `/chat` UI — PageHeader, message log, input bar). On first visit with no conversations, right panel shows an empty-state prompt.
- UX-DR13: Conversation list item — displays auto-generated title (first 40 chars of first user message, truncated with ellipsis), relative timestamp ("2 hours ago", "Yesterday", date string for older). Currently active conversation is highlighted with `bg-accent` background. Clicking resumes that conversation.
- UX-DR14: "+ New Chat" button — top of left panel, full-width, outlined style. Clicking clears the right panel and starts a fresh conversation for the current agent.
- UX-DR15: InnerTabNav on `/ai/*` routes — shows AI agent tabs (one tab per agent defined in `agents.ts`) instead of the Finance nav tabs. Each tab uses the agent icon and name.
- UX-DR16: FloatingChatBar — below the ESC badge in the input row, a small agent label chip shows the current agent name (e.g., "Budget Helper"). The chip is non-interactive display only. Clicking "Open full chat" navigates to `/ai/$agentId` using the last-used agent. The `useChat` hook receives `agentId` from the bar.
- UX-DR17: `/chat` redirect — navigating to `/chat` (or `/chat?conversation=N`) immediately redirects to `/ai/budget-helper` (or `/ai/budget-helper?conversation=N`). No flash of the old chat page.
- UX-DR18: Empty state on `/ai/$agentId` with no prior conversations — centered prompt in the right panel: "[Agent name] is ready. Ask me anything about your finances." with agent icon. Input bar is active and ready.

### FR Coverage Map

| FR  | Epic     | Description                                          |
|-----|----------|------------------------------------------------------|
| FR40 | Epic 15 | Sidebar AI section label + navigation                |
| FR41 | Epic 15 | Agent landing page showing available personalities   |
| FR42 | Epic 15 | Selecting agent and starting a conversation          |
| FR43 | Epic 15 | Agent-specific system prompts in `ai/chat.rs`        |
| FR44 | Epic 15 | Per-agent conversation history list (left panel)     |
| FR45 | Epic 15 | Resuming a past conversation                         |
| FR46 | Epic 15 | "+ New Chat" button starts fresh conversation        |
| FR47 | Epic 15 | `agent_id` column permanently associates conversation|
| FR48 | Epic 15 | FloatingChatBar last-used agent via localStorage     |

---

## Epic List

### Epic 15: AI Section with Multi-Agent Chat and Conversation History

Users gain a dedicated AI section in the sidebar with a landing page showing all available AI agent personalities, a two-column agent chat page with persistent per-agent conversation history, and a smarter FloatingChatBar that remembers and displays the last-used agent. The existing Budget Helper behavior is fully preserved and migrated into the new structure.

**FRs covered:** FR40, FR41, FR42, FR43, FR44, FR45, FR46, FR47, FR48
**UX-DRs addressed:** UX-DR10, UX-DR11, UX-DR12, UX-DR13, UX-DR14, UX-DR15, UX-DR16, UX-DR17, UX-DR18

---

## Epic 15: AI Section with Multi-Agent Chat and Conversation History

---

### Story 15.1: Backend Foundation — Agent Identity and Conversation Scoping

As a developer,
I want the database, Rust data layer, and Tauri commands to support agent identity on chat conversations,
So that every conversation is permanently associated with a specific AI agent and can be queried by agent.

**Scope:** Rust-only changes. No frontend changes. Builds the backend contract that Stories 15.2, 15.3, and 15.4 depend on.

**Acceptance Criteria:**

**Given** the app starts with an existing database that has `chat_conversations` rows without `agent_id`
**When** the migration runs on startup
**Then** `chat_conversations` has a new column `agent_id TEXT NOT NULL DEFAULT 'budget-helper'`
**And** all existing rows have `agent_id = 'budget-helper'` (SQLite DEFAULT applies to ALTER TABLE)
**And** an index `idx_chat_conversations_agent_id` exists on `chat_conversations(agent_id)`
**And** the `schema_version` table reflects the new migration version

**Given** the updated `ChatConversation` struct in `db/chat.rs`
**When** a conversation is serialized to JSON
**Then** the JSON object contains `"agent_id": "budget-helper"` (or the specified agent ID)
**And** the existing fields (`id`, `title`, `created_at`, `updated_at`) are unchanged

**Given** a call to `create_conversation(conn, title, agent_id)`
**When** the function executes
**Then** a new row is inserted with the provided `agent_id`
**And** the returned `ChatConversation` has the correct `agent_id`

**Given** a call to `list_conversations_by_agent(conn, agent_id)`
**When** conversations for that agent exist
**Then** the function returns only conversations where `agent_id` matches, sorted by `updated_at DESC`
**And** conversations belonging to other agents are not included

**Given** a call to `list_conversations_by_agent(conn, "budget-helper")`
**When** no conversations exist for that agent
**Then** the function returns an empty `Vec<ChatConversation>`

**Given** the `send_chat_message` Tauri command is called with `agent_id: String`
**When** `conversation_id` is `None` (new conversation)
**Then** a new conversation is created with the provided `agent_id`
**And** the title is set to the first 40 characters of the `message` parameter (trimmed, no trailing ellipsis in the stored value)

**Given** the `send_chat_message` Tauri command is called with an existing `conversation_id`
**When** the conversation already has an `agent_id`
**Then** the existing `agent_id` is used (the passed `agent_id` parameter is ignored for existing conversations)

**Given** `build_system_prompt` in `ai/chat.rs` is called with `agent_id: "budget-helper"`
**When** the function executes
**Then** it returns the existing Budget Helper system prompt (no behavioral change for existing agent)

**Given** `build_system_prompt` is called with an unrecognized `agent_id`
**When** the function executes
**Then** it returns the default Budget Helper system prompt as a safe fallback

**Given** the `list_conversations` Tauri command is called with `agent_id: String`
**When** conversations exist for that agent
**Then** it returns `Vec<ChatConversation>` for that agent only, sorted by `updated_at DESC`

**Testing Requirements (Rust unit tests in `db/chat.rs`):**

- `test_create_conversation_with_agent_id` — verify `agent_id` is stored and returned correctly
- `test_list_conversations_by_agent_returns_scoped_results` — insert conversations for two agents; verify `list_conversations_by_agent` returns only the correct agent's conversations
- `test_list_conversations_by_agent_empty` — verify empty vec returned when no conversations exist for agent
- `test_conversation_title_auto_generated_from_first_message` — verify the title is set to the first 40 chars of the message when a new conversation is created via `send_chat_message` flow
- `test_existing_conversation_agent_id_unchanged` — verify that sending to an existing conversation does not alter its `agent_id`

**Files to create/modify:**
- New migration SQL file (next version number in the migrations sequence): `ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'budget-helper'; CREATE INDEX IF NOT EXISTS idx_chat_conversations_agent_id ON chat_conversations(agent_id);`
- `apps/desktop/src-tauri/src/db/chat.rs` — update `ChatConversation` struct; update `create_conversation` signature; add `list_conversations_by_agent` function
- `apps/desktop/src-tauri/src/commands/chat.rs` — update `send_chat_message` to accept `agent_id: String`; add `list_conversations` command; update title auto-generation logic
- `apps/desktop/src-tauri/src/ai/chat.rs` — update `build_system_prompt(agent_id: &str, today: &str, context: &str)` signature; add agent dispatch match
- `apps/desktop/src-tauri/src/lib.rs` — register `list_conversations` command in `invoke_handler`

---

### Story 15.2: Routing, Navigation, and Agent Landing Page

As a user,
I want a dedicated AI section in the sidebar and a landing page showing all AI agent personalities,
So that I can discover and navigate to any available AI agent.

**Dependencies:** Story 15.1 must be complete (backend `agent_id` support required).

**Acceptance Criteria:**

**Given** the app sidebar is rendered
**When** the user views the collapsed sidebar
**Then** a `Bot` icon appears below the Finance section items
**And** the icon is non-clickable (section label, not a nav link)

**Given** the app sidebar is expanded
**When** the user views the expanded sidebar
**Then** the text "AI" appears next to the `Bot` icon using the same section-label styling as "Finance"

**Given** the user is on any route
**When** they navigate to `/ai`
**Then** the agent landing page renders with a card for each agent defined in `apps/desktop/src/lib/agents.ts`
**And** each card shows the agent's icon, name, and one-line description
**And** the page has a title consistent with the app's PageHeader pattern

**Given** the agent landing page is rendered
**When** the user clicks an agent card
**Then** the router navigates to `/ai/$agentId` for the selected agent

**Given** the user navigates to `/chat` (legacy route)
**When** the router processes the route
**Then** the user is immediately redirected to `/ai/budget-helper`
**And** there is no visible flash of the old chat page

**Given** the user navigates to `/chat?conversation=42` (legacy route with conversation param)
**When** the router processes the route
**Then** the user is redirected to `/ai/budget-helper?conversation=42`

**Given** the user is on any `/ai/*` route
**When** the InnerTabNav renders
**Then** it shows AI agent tabs (one per agent in `agents.ts`) instead of the Finance nav tabs
**And** each tab uses the agent icon and name
**And** the currently active agent tab is highlighted with the active tab style

**Given** the user is on a Finance route (e.g., `/budget`)
**When** the InnerTabNav renders
**Then** it shows the existing Finance nav tabs (no change from current behavior)

**Given** the `agents.ts` constant
**When** the file is read
**Then** it exports an `AGENTS` array where each entry has: `id: string`, `name: string`, `icon: LucideIcon`, `description: string`
**And** the first entry has `id: 'budget-helper'` and name `'Budget Helper'`

**Playwright Test Specifications:**

```
describe('AI Section Navigation')

test('sidebar shows AI section label')
  - Navigate to '/'
  - Hover sidebar to expand
  - Assert element with text 'AI' is visible in sidebar
  - Assert Bot icon is present in sidebar

test('agent landing page shows agent cards')
  - Navigate to '/ai'
  - Assert page renders at least one agent card
  - Assert card contains agent name text (e.g. 'Budget Helper')

test('clicking agent card navigates to agent route')
  - Navigate to '/ai'
  - Click first agent card
  - Assert URL is '/ai/budget-helper' (or matches agent id pattern)

test('legacy /chat redirects to /ai/budget-helper')
  - Navigate to '/chat'
  - Assert URL changes to '/ai/budget-helper'
  - Assert no error page rendered

test('InnerTabNav shows AI tabs on /ai/* routes')
  - Navigate to '/ai/budget-helper'
  - Assert InnerTabNav contains tab with text 'Budget Helper'
  - Assert Finance tabs (e.g. 'Dashboard') are not visible in InnerTabNav

test('InnerTabNav shows Finance tabs on Finance routes')
  - Navigate to '/'
  - Assert InnerTabNav contains tab with text 'Dashboard'
  - Assert AI agent tab text is not present in InnerTabNav
```

**Files to create/modify:**
- `apps/desktop/src/lib/agents.ts` — new file: `AGENTS` constant array
- `apps/desktop/src/routes/ai.tsx` — new file: agent landing page
- `apps/desktop/src/routes/ai.$agentId.tsx` — new file: agent chat page scaffold (minimal — full UI in Story 15.3)
- `apps/desktop/src/routes/chat.tsx` — replace component with redirect to `/ai/budget-helper` (preserve `?conversation` passthrough)
- `apps/desktop/src/components/shared/InnerTabNav.tsx` — add `useRouterState` / `useMatch` to detect `/ai/*` and conditionally render agent tabs
- `apps/desktop/src/components/shared/AppSidebar.tsx` — add AI section label below Finance items
- `apps/desktop/src/routeTree.gen.ts` — will be regenerated by TanStack Router codegen; do not edit manually
- `apps/desktop/src/locales/en.json` and `fr.json` — add translation keys for AI section label, landing page title, agent descriptions
- i18n keys to add: `"nav.ai"`, `"nav.agents"`, `"agents.budgetHelper.name"`, `"agents.budgetHelper.description"`

---

### Story 15.3: Conversation History Panel

As a user,
I want to see a list of my past conversations with each AI agent and be able to resume or start new ones,
So that I can pick up where I left off and maintain continuity across sessions.

**Dependencies:** Story 15.1 (backend list_conversations command) and Story 15.2 (route structure) must be complete.

**Acceptance Criteria:**

**Given** the user navigates to `/ai/budget-helper` with existing conversations for that agent
**When** the page renders
**Then** the left panel shows a list of past conversations sorted by most recent activity (updated_at DESC)
**And** each list item shows the conversation title (first 40 chars of first user message)
**And** each list item shows a relative timestamp ("2 hours ago", "Yesterday", or date string for older)
**And** the right panel shows the active conversation (the most recent one is loaded by default)

**Given** the left panel is rendered
**When** the user looks at the top of the left panel
**Then** a full-width "+ New Chat" button is visible above the conversation list

**Given** the user clicks "+ New Chat"
**When** the action executes
**Then** the right panel clears all messages and input is focused
**And** no existing conversation is selected (all list items lose active highlight)
**And** the URL does not contain a `?conversation` param
**And** the first message the user sends creates a new conversation via `create_conversation` (via `send_chat_message` with `conversation_id: null`)

**Given** a conversation list item is visible
**When** the user clicks it
**Then** the right panel loads the messages for that conversation via the `get_chat_messages` command
**And** the clicked item receives the active highlight (`bg-accent`)
**And** the URL updates to `/ai/budget-helper?conversation=<id>`

**Given** the user navigates to `/ai/budget-helper?conversation=42`
**When** the page loads
**Then** conversation 42 is pre-selected in the left panel
**And** its messages are loaded in the right panel
**And** if conversation 42 belongs to a different agent, the URL is corrected to the right agent or a not-found error is shown

**Given** the user is on `/ai/$agentId` with no prior conversations for that agent
**When** the right panel renders
**Then** an empty-state is shown: "[Agent name] is ready. Ask me anything about your finances." with the agent's icon
**And** the input bar is active and ready to receive input

**Given** the user sends the first message in an empty-state view
**When** `send_chat_message` returns successfully
**Then** the left panel updates to show the new conversation with the auto-generated title
**And** the new conversation item is highlighted as active

**Given** conversations are listed in the left panel
**When** the user has more than 20 conversations
**Then** only the 20 most recent are shown initially
**And** a "Show more" control or infinite scroll loads additional conversations (implementation choice: either pattern is acceptable)

**Given** the `ConversationListPanel` component
**When** it is rendered for an agent
**Then** it calls `list_conversations` Tauri command with the current `agent_id`
**And** uses TanStack Query with key `["chat-conversations", agentId]`

**Given** a new conversation is saved after the first message
**When** the TanStack Query key `["chat-conversations", agentId]` is invalidated
**Then** the conversation list refreshes and shows the new entry at the top

**Playwright Test Specifications:**

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
  - Assert clicked item has active highlight class

test('active conversation is highlighted in left panel')
  - Navigate to '/ai/budget-helper?conversation=<id>'
  - Assert the corresponding left panel item has bg-accent or active class

test('empty state shown when no conversations exist for agent')
  - Navigate to '/ai/some-new-agent-with-no-conversations'
  - Assert right panel shows empty-state message
  - Assert input bar is active (not disabled)

test('sending first message creates conversation and updates left panel')
  - Navigate to '/ai/budget-helper' with no pre-selected conversation
  - Type a message in the input bar and press Enter
  - Wait for response
  - Assert left panel now contains a new conversation item
  - Assert new item title matches first 40 chars of sent message
```

**Files to create/modify:**
- `apps/desktop/src/components/chat/ConversationListPanel.tsx` — new file: left panel component; fetches `list_conversations` via TanStack Query; renders conversation items; "+ New Chat" button
- `apps/desktop/src/routes/ai.$agentId.tsx` — update scaffold from Story 15.2: add two-column layout; integrate `ConversationListPanel` on the left; integrate existing chat UI on the right; read `?conversation` search param; pass `conversationId` and `agentId` to `useChat`
- `apps/desktop/src/hooks/useChat.ts` — update `UseChatOptions` to accept `agentId?: string`; pass `agent_id` to `send_chat_message` invocation; invalidate `["chat-conversations", agentId]` query after first message saved
- `apps/desktop/src/lib/constants.ts` — add `chatConversations: (agentId: string) => ["chat-conversations", agentId] as const` to `queryKeys`
- `apps/desktop/src/lib/types.ts` — add `ChatConversation` interface with fields: `id: number`, `title: string | null`, `agent_id: string`, `created_at: string`, `updated_at: string`
- `apps/desktop/src/locales/en.json` and `fr.json` — add keys: `"chat.newChat"`, `"chat.noConversations"`, `"chat.agentReady"`, `"chat.showMore"`

---

### Story 15.4: FloatingChatBar Agent Awareness

As a user,
I want the FloatingChatBar (Cmd+K) to remember which AI agent I last used and show me its name,
So that quick questions always go to my preferred agent without extra navigation.

**Dependencies:** Stories 15.1 and 15.2 must be complete (agent IDs and routes must exist).

**Acceptance Criteria:**

**Given** the user has never opened the FloatingChatBar before
**When** they open it with Cmd+K
**Then** the bar shows the label "Budget Helper" (default agent)
**And** messages sent via the bar are associated with agent `'budget-helper'`

**Given** the user has previously navigated to `/ai/budget-helper` and sent a message
**When** they open the FloatingChatBar on any page
**Then** `localStorage` key `"nixus:last_used_agent_id"` is `"budget-helper"`
**And** the bar displays "Budget Helper" as the active agent label

**Given** the user navigates to `/ai/$agentId` for any agent
**When** the route renders for the first time
**Then** `localStorage["nixus:last_used_agent_id"]` is updated to that agent's ID

**Given** the FloatingChatBar is open
**When** the user looks at the input row
**Then** a small non-interactive agent label chip is visible (e.g., "Budget Helper") alongside the MessageSquare icon and the ESC badge

**Given** the FloatingChatBar is open and the user sends a message
**When** `useChat` sends the message
**Then** the `agent_id` from `localStorage["nixus:last_used_agent_id"]` (or `'budget-helper'` fallback) is passed to `send_chat_message`
**And** the resulting conversation is stored with the correct `agent_id` in the database

**Given** the FloatingChatBar "Open full chat" link is clicked
**When** the navigation executes
**Then** the router navigates to `/ai/$lastUsedAgentId` (using the value from localStorage)
**And** the bar closes

**Given** `localStorage["nixus:last_used_agent_id"]` contains an unrecognized agent ID (e.g., stale data)
**When** the FloatingChatBar reads it
**Then** it falls back to `'budget-helper'` and the agent label shows "Budget Helper"
**And** the unknown ID is overwritten in localStorage with `'budget-helper'`

**localStorage Behavior Verification:**

The following behaviors must be verifiable via direct `localStorage` inspection in tests:

- Initial state (no key set): `localStorage.getItem("nixus:last_used_agent_id")` returns `null`; bar defaults to `'budget-helper'`
- After visiting `/ai/budget-helper`: key is set to `"budget-helper"`
- After floating bar sends a message: key is set to whatever agent was active
- Unrecognized agent ID is sanitized to `'budget-helper'` on read

**Testing Requirements (unit-level, no Playwright required for this story):**

A utility function `getLastUsedAgentId(): string` (exported from `agents.ts` or a new `agentPreference.ts` utility) should have Jest/Vitest unit tests covering:

- Returns `'budget-helper'` when localStorage key is absent
- Returns the stored value when it matches a known agent ID
- Returns `'budget-helper'` and writes the fallback when stored value is not a known agent ID

**Playwright Test (optional, light smoke test):**

```
test('FloatingChatBar shows agent label chip')
  - Navigate to '/'
  - Press Cmd+K (or trigger FloatingChatBar open)
  - Assert floating bar contains text 'Budget Helper'
  - Assert floating bar contains 'Open full chat' link pointing to '/ai/budget-helper'
```

**Files to create/modify:**
- `apps/desktop/src/components/chat/FloatingChatBar.tsx` — add agent label chip to input row; read `lastUsedAgentId` from localStorage; pass `agentId` to `useChat`; update `handleOpenFullChat` to navigate to `/ai/$lastUsedAgentId`
- `apps/desktop/src/lib/agents.ts` — (already created in Story 15.2) add and export `getLastUsedAgentId(): string` and `setLastUsedAgentId(id: string): void` utilities; validate against `AGENTS` array
- `apps/desktop/src/routes/ai.$agentId.tsx` — (already updated in Story 15.3) call `setLastUsedAgentId(agentId)` when the route mounts, so navigating to an agent page updates localStorage
- `apps/desktop/src/hooks/useChat.ts` — no additional changes needed beyond Story 15.3 (already accepts `agentId`)
- `apps/desktop/src/locales/en.json` and `fr.json` — add key `"chat.currentAgent"` (aria-label for the agent chip, e.g., "Current agent: Budget Helper")
