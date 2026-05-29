# Story 15.4: FloatingChatBar Agent Awareness

Status: ready-for-dev

## Story

As a user,
I want the FloatingChatBar (Cmd+K) to remember which AI agent I last used and show me its name,
so that quick questions always go to my preferred agent without extra navigation.

## Acceptance Criteria

1. **Given** the user has never opened the FloatingChatBar before, **when** they open it with Cmd+K, **then** the bar shows the label "Budget Helper" (default agent) and messages sent via the bar are associated with agent `'budget-helper'`.

2. **Given** the user navigates to `/ai/$agentId` for any agent, **when** the route renders for the first time, **then** `localStorage["nixus:last_used_agent_id"]` is updated to that agent's ID (this is the Story 15.3 responsibility; this story reads it).

3. **Given** the FloatingChatBar is open, **when** the user looks at the input row, **then** a small non-interactive agent label chip is visible (e.g., "Chatting with Budget Helper") alongside the MessageSquare icon and the ESC badge.

4. **Given** the FloatingChatBar is open and the user sends a message, **when** `useChat` sends the message, **then** the `agent_id` from `localStorage["nixus:last_used_agent_id"]` (or `'budget-helper'` fallback) is passed to `send_chat_message` and the resulting conversation is stored with the correct `agent_id` in the database.

5. **Given** the FloatingChatBar "Open full chat" link is clicked, **when** the navigation executes, **then** the router navigates to `/ai/$lastUsedAgentId` (using the value from localStorage) and the bar closes.

6. **Given** `localStorage["nixus:last_used_agent_id"]` contains an unrecognized agent ID (e.g., stale data), **when** the FloatingChatBar reads it, **then** it falls back to `'budget-helper'`, the agent label shows "Budget Helper", and the unknown ID is overwritten in localStorage with `'budget-helper'`.

7. **Given** the `getLastUsedAgentId()` utility function, **when** called, **then** it returns `'budget-helper'` when the key is absent, returns the stored value when it matches a known agent ID, and returns `'budget-helper'` (writing it back to localStorage) when the stored value is not in the `AGENTS` array.

## Tasks / Subtasks

- [ ] **Task 1: Add `getLastUsedAgentId`/`setLastUsedAgentId` utilities to `agents.ts`** (AC: 6, 7)
  - [ ] 1.1 In `apps/desktop/src/lib/agents.ts` (created by Story 15.2), add export `getLastUsedAgentId(): string` — reads `localStorage["nixus:last_used_agent_id"]`, validates against `AGENTS`, falls back to `'budget-helper'` (and writes fallback back to localStorage)
  - [ ] 1.2 Add export `setLastUsedAgentId(id: string): void` — writes `id` to `localStorage["nixus:last_used_agent_id"]`
  - [ ] 1.3 Write Vitest unit tests (alongside or in `src/lib/__tests__/agents.test.ts`) covering: absent key → `'budget-helper'`; known ID → returns it; unknown ID → returns `'budget-helper'` and writes fallback

- [ ] **Task 2: Update `FloatingChatBar.tsx`** (AC: 1, 3, 4, 5, 6)
  - [ ] 2.1 Import `getLastUsedAgentId` from `@/lib/agents`; call it once at render time to derive `lastUsedAgentId`
  - [ ] 2.2 Derive `agentName` by finding the matching entry in `AGENTS` array (or default to `'Budget Helper'`)
  - [ ] 2.3 Pass `agentId: lastUsedAgentId` to the `useChat()` hook call
  - [ ] 2.4 Add the agent label chip in the input row — a `<p>` element with `aria-live="polite"` showing `"Chatting with {agentName}"` at 12px muted text, placed above/before the MessageSquare icon inside the input row div
  - [ ] 2.5 Update `handleOpenFullChat` to navigate to `/ai/${lastUsedAgentId}` instead of `/chat`
  - [ ] 2.6 Add `data-testid="agent-label-chip"` to the label element

- [ ] **Task 3: Update `useChat.ts` to accept and pass `agentId`** (AC: 4)
  - [ ] 3.1 Add `agentId?: string` to `UseChatOptions` interface
  - [ ] 3.2 In `sendMessage`, pass `agent_id: options?.agentId ?? 'budget-helper'` to the `send_chat_message` Tauri invoke call
  - [ ] 3.3 Confirm no other changes are needed (Story 15.3 note says no further changes, but `agentId` must be threaded through)

- [ ] **Task 4: Add i18n keys** (AC: 3)
  - [ ] 4.1 Add `"chat.currentAgent": "Chatting with {{agentName}}"` to `apps/desktop/src/locales/en.json`
  - [ ] 4.2 Add `"chat.currentAgent": "Discussion avec {{agentName}}"` to `apps/desktop/src/locales/fr.json`

- [ ] **Task 5: Confirm Story 15.3 deliverable — `setLastUsedAgentId` called on `/ai/$agentId` mount** (AC: 2)
  - [ ] 5.1 Verify that `apps/desktop/src/routes/ai.$agentId.tsx` calls `setLastUsedAgentId(agentId)` in a `useEffect` on mount (this is Story 15.3's responsibility; if missing, add it here)

## Dev Notes

### Context: What Stories 15.1–15.3 Established

This is the **final story in Epic 15**. The following must already exist when this story runs:

**From Story 15.1 (Backend):**
- `agent_id TEXT NOT NULL DEFAULT 'budget-helper'` column on `chat_conversations`
- `send_chat_message` Tauri command accepts `agent_id: String` parameter
- `list_conversations` Tauri command scoped by `agent_id`

**From Story 15.2 (Routing/Navigation):**
- `apps/desktop/src/lib/agents.ts` — exports `AGENTS` constant array; each entry: `{ id: string, name: string, icon: LucideIcon, description: string }`; first entry is `{ id: 'budget-helper', name: 'Budget Helper', ... }`
- Routes `/ai` and `/ai/$agentId` exist
- Legacy `/chat` redirects to `/ai/budget-helper`
- `getLastUsedAgentId()` and `setLastUsedAgentId()` **may or may not** have been added in Story 15.2 — check `agents.ts` and add only if missing

**From Story 15.3 (Conversation History Panel):**
- `useChat` hook was updated to accept `agentId?: string` in `UseChatOptions`
- `agentId` is passed through to `send_chat_message` invoke
- `apps/desktop/src/routes/ai.$agentId.tsx` calls `setLastUsedAgentId(agentId)` on mount
- `queryKeys.chatConversations` exists in `constants.ts`

**IMPORTANT:** Before implementing, read `apps/desktop/src/lib/agents.ts` and `apps/desktop/src/hooks/useChat.ts` to confirm what was already implemented by Stories 15.2 and 15.3. Do NOT reimplement what already exists — only add what is missing.

---

### File: `apps/desktop/src/components/chat/FloatingChatBar.tsx`

**Current state (read before modifying):** The component currently calls `useChat()` without options and navigates to `/chat` in `handleOpenFullChat`.

**Required changes:**
```typescript
// 1. Add import
import { getLastUsedAgentId, AGENTS } from "@/lib/agents";

// 2. Inside component, before JSX:
const lastUsedAgentId = getLastUsedAgentId(); // reads localStorage, validates, falls back
const agentEntry = AGENTS.find((a) => a.id === lastUsedAgentId);
const agentName = agentEntry?.name ?? "Budget Helper";

// 3. Pass agentId to useChat
const { messages, streaming, sendMessage, confirmAction, cancelAction } =
  useChat({ agentId: lastUsedAgentId });

// 4. Update handleOpenFullChat
const handleOpenFullChat = useCallback(() => {
  onClose();
  navigate({ to: "/ai/$agentId", params: { agentId: lastUsedAgentId } });
}, [onClose, navigate, lastUsedAgentId]);

// 5. Agent label chip (place ABOVE the input row div, or inside the top border-b div before the MessageSquare)
// UX-DR16 says: label appears ABOVE the text input, "Chatting with [Agent Name]"
// UX spec: "below the ESC badge in the input row, a small agent label chip shows the current agent name"
// Reconciliation: place it as a row ABOVE the input, still inside the card div:
<div className="px-4 pt-2 pb-0">
  <p
    aria-live="polite"
    className="text-xs text-muted-foreground"
    data-testid="agent-label-chip"
  >
    {t("chat.currentAgent", { agentName })}
  </p>
</div>
```

**UX spec note:** The spec says "a label appears above the text input: 'Chatting with [Agent Name]'" and also "alongside the MessageSquare icon and the ESC badge." Place the chip as a small line just above the input row border-b div (within the card), visible but unobtrusive.

---

### File: `apps/desktop/src/lib/agents.ts`

**If not already added by Story 15.2**, implement these utilities:

```typescript
const LAST_USED_AGENT_KEY = "nixus:last_used_agent_id";
const DEFAULT_AGENT_ID = "budget-helper";

export function getLastUsedAgentId(): string {
  const stored = localStorage.getItem(LAST_USED_AGENT_KEY);
  if (!stored) return DEFAULT_AGENT_ID;
  const isKnown = AGENTS.some((a) => a.id === stored);
  if (!isKnown) {
    localStorage.setItem(LAST_USED_AGENT_KEY, DEFAULT_AGENT_ID);
    return DEFAULT_AGENT_ID;
  }
  return stored;
}

export function setLastUsedAgentId(id: string): void {
  localStorage.setItem(LAST_USED_AGENT_KEY, id);
}
```

---

### File: `apps/desktop/src/hooks/useChat.ts`

**Check current state.** As of the last known state (before Stories 15.1–15.3), `useChat` does NOT accept `agentId`. Story 15.3 should have added it. If not present:

```typescript
// Add to UseChatOptions:
interface UseChatOptions {
  initialConversationId?: number;
  agentId?: string; // ADD THIS if missing
}

// In sendMessage, update invoke call:
const result = await invoke<{ conversation_id: number }>(
  "send_chat_message",
  {
    message: text,
    conversation_id: conversationId,
    agent_id: options?.agentId ?? "budget-helper", // ADD THIS if missing
  }
);
```

---

### Navigation: TanStack Router typed `navigate`

When navigating to `/ai/$agentId`, use the typed TanStack Router form:
```typescript
navigate({ to: "/ai/$agentId", params: { agentId: lastUsedAgentId } });
```
NOT `navigate({ to: "/chat" })` (old pattern) and NOT an untyped string.

---

### i18n Pattern

This codebase uses `react-i18next`. The `t()` function with interpolation:
```typescript
t("chat.currentAgent", { agentName }) // "Chatting with Budget Helper"
```
Add the key with the `{{agentName}}` interpolation placeholder to both locale files.

---

### UX Requirements (UX-DR16)

From the UX spec (AI Section section, "FloatingChatBar agent-aware enhancement"):
- Label: **"Chatting with [Agent Name]"** — muted, 12px, caption size
- Defaults to "Chatting with Budget Helper" if no agent was previously used
- Shows most recently used agent name from localStorage
- No agent switcher inside the floating bar (label is non-interactive, display only)
- "Open in full chat" link navigates to `/ai/$agentId` for the current agent
- Accessibility: `<p aria-live="polite">` so screen readers announce agent change when bar opens
- All other FloatingChatBar accessibility unchanged (`role="dialog"`, focus trap, ESC closes)

---

### Project Structure Notes

- `FloatingChatBar.tsx` lives in `apps/desktop/src/components/chat/` — no relocation needed
- `agents.ts` lives in `apps/desktop/src/lib/` — all utilities co-located with the `AGENTS` constant
- Test file: `apps/desktop/src/lib/__tests__/agents.test.ts` or co-located; follow existing test file patterns in the project
- The localStorage key is exactly `"nixus:last_used_agent_id"` — do not change this string

### Anti-Patterns to Avoid

- **Do not** navigate to `/chat` — it was deprecated in Story 15.2 (redirects to `/ai/budget-helper` but navigating directly is wrong)
- **Do not** hardcode agent names in the component — always derive from `AGENTS` array
- **Do not** skip the `AGENTS` validation in `getLastUsedAgentId` — stale/invalid localStorage values must be sanitized
- **Do not** add an agent switcher in the floating bar — this is explicitly deferred to a future sprint
- **Do not** make the agent chip interactive (no click handler, no cursor pointer)

### Testing Requirements

**Unit tests for `getLastUsedAgentId`** (Vitest, no Playwright required):
```typescript
describe('getLastUsedAgentId', () => {
  it('returns budget-helper when key is absent', () => {
    localStorage.clear();
    expect(getLastUsedAgentId()).toBe('budget-helper');
  });
  it('returns stored value when it is a known agent ID', () => {
    localStorage.setItem('nixus:last_used_agent_id', 'budget-helper');
    expect(getLastUsedAgentId()).toBe('budget-helper');
  });
  it('returns budget-helper and writes fallback when stored value is unknown', () => {
    localStorage.setItem('nixus:last_used_agent_id', 'unknown-agent');
    expect(getLastUsedAgentId()).toBe('budget-helper');
    expect(localStorage.getItem('nixus:last_used_agent_id')).toBe('budget-helper');
  });
});
```

**Optional Playwright smoke test:**
```
test('FloatingChatBar shows agent label chip')
  - Navigate to '/'
  - Press Cmd+K (or trigger open)
  - Assert text 'Chatting with Budget Helper' is visible
  - Assert 'Open in full chat' link points to '/ai/budget-helper'
```

### References

- Epic requirements: [Source: _bmad-output/planning-artifacts/epics-ai-section.md#Story 15.4]
- UX spec FloatingChatBar enhancement: [Source: _bmad-output/planning-artifacts/ux-design-specification.md#FloatingChatBar (agent-aware enhancement)]
- UX-DR16: [Source: _bmad-output/planning-artifacts/epics-ai-section.md#UX Design Requirements]
- Current `FloatingChatBar.tsx`: [Source: apps/desktop/src/components/chat/FloatingChatBar.tsx]
- Current `useChat.ts`: [Source: apps/desktop/src/hooks/useChat.ts]
- Architecture component structure: [Source: _bmad-output/planning-artifacts/architecture-desktop.md#Frontend Organization]
- i18n locale files: [Source: apps/desktop/src/locales/en.json, fr.json]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
