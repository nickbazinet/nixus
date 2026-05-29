# Story 15.2: Routing, Navigation, and Agent Landing Page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a dedicated AI section in the sidebar and a landing page showing all AI agent personalities,
So that I can discover and navigate to any available AI agent.

## Acceptance Criteria

1. **Given** the app sidebar is rendered  
   **When** the user views the collapsed sidebar  
   **Then** a `Bot` icon appears below the Finance section items  
   **And** the icon is non-clickable (section label, not a nav link)

2. **Given** the app sidebar is expanded  
   **When** the user views the expanded sidebar  
   **Then** the text "AI" appears next to the `Bot` icon using the same section-label styling as "Finance"

3. **Given** the user is on any route  
   **When** they navigate to `/ai`  
   **Then** the agent landing page renders with a card for each agent defined in `apps/desktop/src/lib/agents.ts`  
   **And** each card shows the agent's icon, name, and one-line description  
   **And** the page has a title consistent with the app's PageHeader pattern

4. **Given** the agent landing page is rendered  
   **When** the user clicks an agent card  
   **Then** the router navigates to `/ai/$agentId` for the selected agent

5. **Given** the user navigates to `/chat` (legacy route)  
   **When** the router processes the route  
   **Then** the user is immediately redirected to `/ai/budget-helper`  
   **And** there is no visible flash of the old chat page

6. **Given** the user navigates to `/chat?conversation=42` (legacy route with conversation param)  
   **When** the router processes the route  
   **Then** the user is redirected to `/ai/budget-helper?conversation=42`

7. **Given** the user is on any `/ai/*` route  
   **When** the InnerTabNav renders  
   **Then** it shows AI agent tabs (one per agent in `agents.ts`) instead of the Finance nav tabs  
   **And** each tab uses the agent icon and name  
   **And** the currently active agent tab is highlighted with the active tab style

8. **Given** the user is on a Finance route (e.g., `/budget`)  
   **When** the InnerTabNav renders  
   **Then** it shows the existing Finance nav tabs (no change from current behavior)

9. **Given** the `agents.ts` constant  
   **When** the file is read  
   **Then** it exports an `AGENTS` array where each entry has: `id: string`, `name: string`, `icon: LucideIcon`, `description: string`  
   **And** the first entry has `id: 'budget-helper'` and name `'Budget Helper'`

## Tasks / Subtasks

- [ ] Task 1: Create `agents.ts` constant (AC: #9)
  - [ ] Create `apps/desktop/src/lib/agents.ts` with `AGENTS` array typed as `Agent[]`
  - [ ] Define `Agent` interface: `{ id: string; name: string; icon: LucideIcon; description: string }`
  - [ ] Add first (and only) entry: `{ id: 'budget-helper', name: 'Budget Helper', icon: Bot, description: '...' }`
  - [ ] Export `AGENTS` as a `const` array

- [ ] Task 2: Create `/ai` landing page route (AC: #3, #4)
  - [ ] Create `apps/desktop/src/routes/ai.tsx` using `createFileRoute('/ai')`
  - [ ] Import `AGENTS` from `lib/agents.ts`
  - [ ] Render `PageHeader` with translated title (`t('nav.agents')`)
  - [ ] Render a responsive card grid (e.g., `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)
  - [ ] Each card: agent icon (size 32), agent name as card title, description as subtitle
  - [ ] Each card is clickable and navigates to `/ai/$agentId` via `useNavigate` or `Link`

- [ ] Task 3: Create `/ai/$agentId` route scaffold (AC: #7)
  - [ ] Create `apps/desktop/src/routes/ai.$agentId.tsx` using `createFileRoute('/ai/$agentId')`
  - [ ] Accept `agentId` path param via `Route.useParams()`
  - [ ] For now: render a minimal placeholder — PageHeader with agent name, "Coming in Story 15.3" note
  - [ ] This scaffold is the foundation for Story 15.3's two-column layout

- [ ] Task 4: Convert `/chat` route to redirect (AC: #5, #6)
  - [ ] Replace the existing `ChatPage` component body in `apps/desktop/src/routes/chat.tsx` with a redirect component
  - [ ] Use TanStack Router's `useNavigate` + `useEffect` for an immediate client-side redirect
  - [ ] Preserve the existing `validateSearch` for `?conversation` param passthrough
  - [ ] Redirect target: `/ai/budget-helper` (with `?conversation=N` forwarded if present)
  - [ ] Ensure no flash: redirect fires on first render before any content is painted

- [ ] Task 5: Update `InnerTabNav` to conditionally show AI tabs (AC: #7, #8)
  - [ ] Import `useRouterState` from `@tanstack/react-router`
  - [ ] Detect if current pathname starts with `/ai` using `router.state.location.pathname`
  - [ ] If on `/ai/*`: render AI agent tabs from `AGENTS` array — each tab links to `/ai/$agentId`
  - [ ] If on Finance routes: render existing `navGroups` tabs (no change)
  - [ ] Active tab detection for AI tabs: use `pathname === /ai/${agent.id}` comparison
  - [ ] Preserve all existing Finance tab active-state logic

- [ ] Task 6: Update `AppSidebar` to add AI section label (AC: #1, #2)
  - [ ] Add `Bot` icon import from `lucide-react`
  - [ ] Below the Finance `<li>` section label, add a new `<li>` with the same non-clickable label pattern
  - [ ] Use `t('sidebar.ai')` for the text label
  - [ ] Apply identical CSS classes as the Finance section label for visual consistency

- [ ] Task 7: Add i18n keys (AC: #3)
  - [ ] `apps/desktop/src/locales/en.json`: add `"sidebar.ai"`, `"nav.agents"`, `"agents.budgetHelper.name"`, `"agents.budgetHelper.description"`
  - [ ] `apps/desktop/src/locales/fr.json`: add same keys in French
  - [ ] English values: `"sidebar.ai": "AI"`, `"nav.agents": "AI Agents"`, `"agents.budgetHelper.name": "Budget Helper"`, `"agents.budgetHelper.description": "Ask me anything about your finances."`
  - [ ] French values: appropriate translations

- [ ] Task 8: Update `routeTree.gen.ts` (informational — handled by codegen)
  - [ ] Run `npm run dev` or the TanStack Router codegen to regenerate `routeTree.gen.ts`
  - [ ] New routes `/ai` and `/ai/$agentId` will be added automatically
  - [ ] Do NOT manually edit `routeTree.gen.ts`

- [ ] Task 9: Write Playwright tests (AC: all)
  - [ ] Create `apps/desktop/tests/ai-navigation.spec.ts`
  - [ ] Test: sidebar shows AI section label
  - [ ] Test: agent landing page shows agent cards
  - [ ] Test: clicking agent card navigates to agent route
  - [ ] Test: legacy `/chat` redirects to `/ai/budget-helper`
  - [ ] Test: InnerTabNav shows AI tabs on `/ai/*` routes
  - [ ] Test: InnerTabNav shows Finance tabs on Finance routes

## Dev Notes

### Architecture Overview

This story is a **pure frontend story**. It adds TanStack Router file-based routes, modifies two existing shared components, and creates one new TypeScript constants file. No Rust/Tauri changes are needed.

The backend from Story 15.1 (`list_conversations_by_agent`, `send_chat_message` with `agent_id`) is available but this story does not call those commands yet. That happens in Story 15.3.

### Critical: TanStack Router File-Based Routing

This project uses `@tanstack/react-router` v1.167+ with **file-based routing** (Vite plugin). The Vite plugin is configured in `apps/desktop/vite.config.ts`:

```typescript
plugins: [tanstackRouter(), tailwindcss(), react()]
```

**File naming rules for new routes:**
- `/ai` → `apps/desktop/src/routes/ai.tsx` (index for the `/ai` path)
- `/ai/$agentId` → `apps/desktop/src/routes/ai.$agentId.tsx` (dynamic segment uses `$` prefix)

**IMPORTANT:** After creating these files, `routeTree.gen.ts` is auto-regenerated when the dev server runs. **Never edit `routeTree.gen.ts` manually.**

Route file creation pattern (from existing routes):
```typescript
// apps/desktop/src/routes/ai.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/ai")({
  component: AiLandingPage,
});
```

Dynamic route with path param:
```typescript
// apps/desktop/src/routes/ai.$agentId.tsx
export const Route = createFileRoute("/ai/$agentId")({
  component: AgentPage,
});

function AgentPage() {
  const { agentId } = Route.useParams(); // typed param
}
```

### Critical: `/chat` Redirect Implementation

The existing `chat.tsx` route must redirect to `/ai/budget-helper` without flashing the old UI. The cleanest approach using TanStack Router v1 is to use `redirect` in `beforeLoad`:

```typescript
// apps/desktop/src/routes/chat.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): { conversation?: number } => {
    const conv = Number(search.conversation);
    return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/ai/$agentId",
      params: { agentId: "budget-helper" },
      search: search.conversation ? { conversation: search.conversation } : {},
      replace: true, // replaces history entry — no back-button loop
    });
  },
});
```

**WHY `beforeLoad` + `throw redirect()`:** This fires before the component renders, guaranteeing zero flash. The `replace: true` flag replaces the history entry so the back button doesn't loop to `/chat`.

**KEEP** the existing `validateSearch` so `?conversation` is validated before being passed to the redirect.

### Critical: `InnerTabNav` Conditional Logic

The current `InnerTabNav` always renders Finance tabs. It must detect `/ai/*` routes and render agent tabs instead.

Use `useRouterState` (the correct hook in TanStack Router v1):

```typescript
import { useRouterState, Link } from "@tanstack/react-router";

export function InnerTabNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAiRoute = pathname.startsWith("/ai");

  if (isAiRoute) {
    return <AiTabNav currentPath={pathname} />;
  }

  return <FinanceTabNav />; // existing logic, unchanged
}
```

AI tab active detection — compare full pathname since `/ai` vs `/ai/budget-helper` are different:
```typescript
const isActive = pathname === `/ai/${agent.id}`;
```

**DO NOT change** the existing Finance tab logic. Extract it into a sub-component or leave inline — either is acceptable. The key constraint is zero regression on Finance navigation.

### Critical: `AppSidebar` AI Section Label

The Finance section label pattern in `AppSidebar.tsx` (lines 106-123) is:

```tsx
<li>
  <div
    className={cn(
      "flex items-center text-sm text-sidebar-primary font-medium border-r-[3px] border-sidebar-primary cursor-default",
      expanded ? "gap-3 px-3 py-2.5" : "justify-center px-3 py-2.5"
    )}
    title={expanded ? undefined : t("sidebar.finance")}
  >
    <Wallet size={20} />
    <span className={cn("transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden")}>
      {t("sidebar.finance")}
    </span>
  </div>
</li>
```

**Replicate this pattern exactly** for the AI section label. Use `Bot` icon (from lucide-react) and `t("sidebar.ai")`. The `cursor-default` class makes it non-clickable/non-interactive. When sidebar is collapsed, icon is visible; text fades out.

### `agents.ts` Structure

This file is referenced by Stories 15.3 and 15.4. **Nail the interface** here since it's the contract for downstream stories.

```typescript
// apps/desktop/src/lib/agents.ts
import type { LucideIcon } from "lucide-react";
import { Bot } from "lucide-react";

export interface Agent {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
}

export const AGENTS: Agent[] = [
  {
    id: "budget-helper",
    name: "Budget Helper",
    icon: Bot,
    description: "Ask me anything about your finances.",
  },
];
```

**Note:** Story 15.4 will add `getLastUsedAgentId()` and `setLastUsedAgentId()` utilities to this file. Do not add them in this story — keep the scope minimal.

### Agent Landing Page Card Grid

Use shadcn/ui `Card` component (from `@nkbaz/shared`, same import pattern as other routes). Look at how `index.tsx` imports `Card, CardContent`:

```typescript
import { Card, CardContent } from "@nkbaz/shared";
```

Card layout per agent:
```tsx
<Card key={agent.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate({ to: "/ai/$agentId", params: { agentId: agent.id } })}>
  <CardContent className="flex flex-col items-center gap-3 p-6">
    <agent.icon size={32} className="text-primary" />
    <div className="text-center">
      <h2 className="font-semibold">{agent.name}</h2>
      <p className="text-sm text-muted-foreground">{agent.description}</p>
    </div>
  </CardContent>
</Card>
```

### `ai.$agentId.tsx` Scaffold (Minimal for Story 15.2)

Story 15.3 will replace this component entirely with the two-column layout. For now, a simple placeholder is acceptable:

```typescript
export const Route = createFileRoute("/ai/$agentId")({
  component: AgentPage,
});

function AgentPage() {
  const { agentId } = Route.useParams();
  const agent = AGENTS.find((a) => a.id === agentId);
  const { t } = useTranslation();

  if (!agent) {
    return <div className="p-6 text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div>
      <PageHeader title={agent.name} />
      {/* Story 15.3 will add the two-column conversation layout here */}
    </div>
  );
}
```

### Existing Route Files: Do NOT Regress

These existing route files must not be broken:
- `/` (index.tsx) — Dashboard
- `/budget`, `/income`, `/accounts`, `/assets`, `/net-worth`, `/import`, `/projection`, `/spending-trends`, `/settings`, `/recurring-expenses`, `/onboarding`

The `routeTree.gen.ts` file will be regenerated — do not manually edit it. TanStack Router's codegen handles the registration.

### Existing Navigation Test: Update Required

`apps/desktop/tests/navigation.spec.ts` currently has a test expecting `/chat` to have heading "AI Chat". This will break after the redirect. Update the test:
- Remove `/chat` from the `navItems` array in `navigation.spec.ts`
- The spec currently navigates to `/chat` and expects `h1` text "AI Chat" — this will fail after redirect
- Either update the test to verify the redirect destination or remove the `/chat` entry from the test fixture

### i18n Pattern

All translation keys follow the flat JSON pattern in `apps/desktop/src/locales/en.json` and `fr.json`. New keys for this story:

```json
// en.json additions
"sidebar.ai": "AI",
"nav.agents": "AI Agents",
"nav.aiNav": "AI navigation",
"agents.budgetHelper.name": "Budget Helper",
"agents.budgetHelper.description": "Ask me anything about your finances."
```

```json
// fr.json additions
"sidebar.ai": "IA",
"nav.agents": "Agents IA",
"nav.aiNav": "Navigation IA",
"agents.budgetHelper.name": "Aide budget",
"agents.budgetHelper.description": "Posez-moi n'importe quelle question sur vos finances."
```

Note: The `agents.budgetHelper.description` can be hard-coded in `agents.ts` or use `t()`. Using `t()` is preferred for i18n consistency but requires `useTranslation` in the landing page or a separate `getAgents(t)` factory. **Simplest correct approach:** hard-code the English description in `agents.ts` for now (single-language internal constant). Story 15.4 will not require i18n on descriptions. This is acceptable as the UX spec does not mention translated descriptions.

### Project Structure Notes

**New files:**
- `apps/desktop/src/lib/agents.ts` — Agent constant and interface
- `apps/desktop/src/routes/ai.tsx` — AI landing page
- `apps/desktop/src/routes/ai.$agentId.tsx` — Agent chat scaffold
- `apps/desktop/tests/ai-navigation.spec.ts` — Playwright tests

**Modified files:**
- `apps/desktop/src/routes/chat.tsx` — Replace component with `beforeLoad` redirect
- `apps/desktop/src/components/shared/InnerTabNav.tsx` — Add conditional AI tabs
- `apps/desktop/src/components/shared/AppSidebar.tsx` — Add AI section label
- `apps/desktop/src/locales/en.json` — Add AI i18n keys
- `apps/desktop/src/locales/fr.json` — Add AI i18n keys (French)
- `apps/desktop/src/routeTree.gen.ts` — Auto-regenerated (do NOT edit manually)
- `apps/desktop/tests/navigation.spec.ts` — Update to remove `/chat` entry (redirect breaks old test)

**DO NOT modify in this story:**
- Any Rust files — Story 15.1 handles all backend
- `apps/desktop/src/lib/types.ts` — No new types needed (Story 15.3 adds `ChatConversation`)
- `apps/desktop/src/lib/constants.ts` — No new query keys needed (Story 15.3 adds `chatConversations`)
- `apps/desktop/src/hooks/useChat.ts` — No changes needed (Story 15.3 adds `agentId`)
- `apps/desktop/src/components/chat/FloatingChatBar.tsx` — Story 15.4 handles this

### References

- UX-DR10: AI sidebar section label spec — [Source: `_bmad-output/planning-artifacts/epics-ai-section.md` § UX Design Requirements]
- UX-DR11: Agent landing page card grid — [Source: `_bmad-output/planning-artifacts/epics-ai-section.md` § UX Design Requirements]
- UX-DR15: InnerTabNav conditional AI tabs — [Source: `_bmad-output/planning-artifacts/epics-ai-section.md` § UX Design Requirements]
- UX-DR17: `/chat` redirect spec — [Source: `_bmad-output/planning-artifacts/epics-ai-section.md` § UX Design Requirements]
- TanStack Router file-based routing: `apps/desktop/vite.config.ts` and `apps/desktop/src/routeTree.gen.ts`
- AppSidebar Finance label pattern: `apps/desktop/src/components/shared/AppSidebar.tsx` lines 105-123
- InnerTabNav current structure: `apps/desktop/src/components/shared/InnerTabNav.tsx`
- Existing navigation tests: `apps/desktop/tests/navigation.spec.ts`
- Architecture routing decision: [Source: `_bmad-output/planning-artifacts/architecture-desktop.md` § Frontend Architecture]

## Playwright Test Specifications

File: `apps/desktop/tests/ai-navigation.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('AI Section Navigation', () => {

  test('sidebar shows AI section label', async ({ page }) => {
    await page.goto('/');
    // Hover to expand sidebar
    await page.locator('aside').hover();
    await expect(page.locator('aside').getByText('AI')).toBeVisible();
  });

  test('agent landing page shows agent cards', async ({ page }) => {
    await page.goto('/ai');
    await expect(page.locator('h1')).toBeVisible();
    // At least one agent card with "Budget Helper" text
    await expect(page.getByText('Budget Helper')).toBeVisible();
  });

  test('clicking agent card navigates to agent route', async ({ page }) => {
    await page.goto('/ai');
    await page.getByText('Budget Helper').click();
    await expect(page).toHaveURL(/\/ai\/budget-helper/);
  });

  test('legacy /chat redirects to /ai/budget-helper', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL('/ai/budget-helper');
    // No error page
    await expect(page.locator('body')).not.toContainText('404');
  });

  test('legacy /chat?conversation=42 redirects preserving param', async ({ page }) => {
    await page.goto('/chat?conversation=42');
    await expect(page).toHaveURL(/\/ai\/budget-helper\?conversation=42/);
  });

  test('InnerTabNav shows AI tabs on /ai/* routes', async ({ page }) => {
    await page.goto('/ai/budget-helper');
    const nav = page.locator('nav[aria-label="AI navigation"]');
    await expect(nav.getByText('Budget Helper')).toBeVisible();
    // Finance-specific tab should not appear in AI nav
    await expect(nav.getByText('Dashboard')).not.toBeVisible();
  });

  test('InnerTabNav shows Finance tabs on Finance routes', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    await expect(nav.getByText('Dashboard')).toBeVisible();
  });

});
```

Note on `aria-label` for AI nav: the `InnerTabNav` for AI routes should use `aria-label={t("nav.aiNav")}` (value: "AI navigation") to distinguish it from the Finance nav. Update `InnerTabNav` to pass the correct `aria-label` based on which nav is active.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
