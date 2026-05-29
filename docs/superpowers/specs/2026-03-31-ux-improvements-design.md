# UX Improvements Design Spec

**Date:** 2026-03-31
**Scope:** Navigation restructure, budget page layout, TopBar search, slide-over panels, scrollbar fix, and minor UI fixes.

---

## 1. Navigation Restructure (InnerTabNav)

### Current State
- 9 flat tabs: Dashboard, Budget, Income, Accounts, Assets, Net Worth, Trends, Import, AI Chat
- No visual grouping; all tabs appear as equal-weight peers
- Import and AI Chat are utility actions mixed in with core navigation

### Design

**Add vertical dividers** between logical groups in the tab bar:

```
Dashboard | Budget  Income | Accounts  Assets  Net Worth | Trends
```

Groups:
- **Overview:** Dashboard
- **Planning:** Budget, Income
- **Portfolio:** Accounts, Assets, Net Worth
- **Analysis:** Trends

**Remove from tab bar:**
- **Import** — remains a route (`/import`), accessed via the "Import Statement" button on the Dashboard header and direct URL. No tab.
- **AI Chat** — accessed exclusively via Cmd+K / clicking the TopBar search bar. The `/chat` route remains functional but is not in the navigation.

### Implementation

File: `src/components/shared/InnerTabNav.tsx`

- Define nav items as grouped arrays with optional separator markers
- Render a `<li>` with a vertical divider (`w-px h-5 bg-border`) between groups
- Remove Import and AI Chat from the `financeNavItems` array

---

## 2. Budget Page — Summary Strip Layout

### Current State
- PageHeader with "Add Expense" + "Add Group" buttons
- MonthNavigator floats below header with no visual container
- Budget groups are a flat vertical stack of cards
- No summary of total budget / spent / remaining
- Progress bars use `bg-teal-600` (inconsistent with indigo brand)

### Design

**Summary Strip** — a card-style toolbar at the top of the budget page:

```
┌──────────────────────────────────────────────────────────┐
│  ← Feb    March 2026    Apr →     Budget $4,200          │
│                                   Spent  $2,870          │
│                                   Remaining $1,330       │
│  ████████████████████░░░░░░░░░░░  (68% — indigo bar)     │
└──────────────────────────────────────────────────────────┘
```

- MonthNavigator integrated on the left side
- Budget / Spent / Remaining stats on the right
- Full-width progress bar below (uses `bg-primary` / indigo)
- "Add Group" button stays in PageHeader (rare action)
- "Add Expense" button moves into the summary strip (right side, next to the stats) — it triggers the slide-over panel (see section 4). This keeps it always visible and contextually tied to the current month.

**Group Cards:**
- Group header shows group name + group-level total (e.g., `Essentials $1,770 / $2,200`)
- Category rows show: name, inline mini progress bar (80px wide), spent/target in monospace
- Alternating row backgrounds (`bg-muted/30` on even rows) for scanability
- Collapse/expand, inline edit, delete all remain unchanged

### Implementation

Files:
- `src/routes/budget.tsx` — restructure layout, add summary strip, remove "Add Expense" from header
- `src/components/budget/BudgetSummaryStrip.tsx` — new component containing MonthNavigator + stats + progress bar
- `src/components/budget/BudgetGroupCard.tsx` — update category rows to include inline mini progress bars, add alternating row backgrounds
- `src/components/budget/BudgetCategoryRow.tsx` — update progress bar color from `bg-teal-600` to `bg-primary`

---

## 3. TopBar — AI Search Bar

### Current State
- `TopBar.tsx` contains only a user icon (CircleUser) right-aligned on a dark background
- 56px of prime vertical real estate doing almost nothing

### Design

**Centered search input** on the dark sidebar background:

```
┌──────────────────────────────────────────────────────────┐
│              [🔍 Search anything or ask AI...  ⌘K]   👤  │
└──────────────────────────────────────────────────────────┘
```

- Search bar: `max-w-[480px]`, centered via flex, styled with `bg-sidebar-accent` and `text-sidebar-foreground/50`
- Search icon (lucide `Search`) on the left
- Placeholder text: "Search anything or ask AI..."
- `⌘K` badge on the right side of the input (styled as a small kbd tag)
- User icon stays on the far right
- **Behavior:** Clicking the search bar or pressing Cmd+K opens the existing `FloatingChatBar`. The search bar is a visual trigger, not a separate input. No new state management needed — just call the `setChatOpen(true)` callback from root layout.

### Implementation

Files:
- `src/components/shared/TopBar.tsx` — add search bar markup, accept `onSearchClick` prop
- `src/routes/__root.tsx` — pass `setChatOpen` handler to TopBar

---

## 4. Slide-Over Panel (Reusable Component)

### Current State
- All "Add X" forms toggle inline and push content down (Budget, Accounts, Assets, Income pages)
- Users lose scroll position and context when forms appear

### Design

**Right-side slide-over panel**, 400px wide:

```
┌─────────────────────┬──────────────┐
│                     │  Panel Title  │
│  (dimmed content)   │  ──────────── │
│                     │  Form fields  │
│                     │  ...          │
│                     │  [Save]       │
└─────────────────────┴──────────────┘
```

- Width: `w-[400px]` (fixed)
- Enters from right: `translate-x-full` → `translate-x-0` with `transition-transform duration-300`
- Backdrop: `bg-black/15`, click to dismiss
- Close: X button (top-right), Escape key, backdrop click
- Focus trap: focus moves into panel on open, restores on close
- Z-index: `z-40` (above sidebar z-30, below modals z-50)
- Panel content is passed as children (slot pattern)

### Usage

Replace inline forms across the app:
- **Budget page:** Add Expense form, Add Group form, Add Category form
- **Accounts page:** Add Account form
- **Assets page:** Add Asset form
- **Income page:** Add Income Source form, Add Income Entry form

Each page replaces its `showForm` toggle + inline form with a `<SlideOver>` component wrapping the same form.

### Implementation

Files:
- `src/components/ui/slide-over.tsx` — new reusable component with portal, backdrop, transition, focus trap, Escape handler
- `src/routes/budget.tsx` — replace inline forms with SlideOver
- `src/routes/accounts.tsx` — replace inline form with SlideOver
- `src/routes/assets.tsx` — replace inline form with SlideOver
- `src/routes/income.tsx` — replace inline forms with SlideOver

---

## 5. Scrollbar Fix

### Current State
- `index.css` lines 18-24 hide ALL scrollbars globally via `scrollbar-width: none` and `::-webkit-scrollbar { display: none }`
- Users cannot tell when content is scrollable

### Design

- Remove global scrollbar hiding from `index.css`
- Apply scrollbar hiding ONLY to the sidebar (`AppSidebar`) where it's cosmetic
- Main content area and all inner containers show native scrollbars

### Implementation

Files:
- `src/index.css` — remove `scrollbar-width: none` from `*` selector and remove `::-webkit-scrollbar` rule
- `src/components/shared/AppSidebar.tsx` — add `scrollbar-none` class (or inline style) to the aside element only

---

## 6. Quick Fixes

### 6a. Progress Bar Colors
- Replace `bg-teal-600` with `bg-primary` in `BudgetCategoryRow.tsx` (the "on track" state)
- Same change in `DashboardBudgetCategoryRow` and the dashboard budget remaining progress bar
- Files: `src/components/budget/BudgetCategoryRow.tsx`, `src/components/dashboard/BudgetCategoryRow.tsx`, `src/routes/index.tsx`

### 6b. Double Max-Width
- Remove `max-w-[1280px] mx-auto` from individual page components that duplicate the root layout constraint
- Files: `src/routes/index.tsx` (line 73), `src/routes/net-worth.tsx` (line 62), `src/routes/spending-trends.tsx` (line 22)

### 6c. Import Page Raw Inputs
- Replace raw `<input>` elements in the "Couldn't Be Read" section with design system components (`Input`, `MoneyInput`, `Label`)
- File: `src/routes/import.tsx` (lines 385-439)

### 6d. CashFlowSummaryCard Wrapper
- Remove unnecessary `grid grid-cols-1` wrapper around CashFlowSummaryCard
- File: `src/routes/index.tsx` (line 84)

### 6e. Spending Breakdown Toggle
- Replace raw `<button>` with `Button` component (variant="ghost")
- File: `src/routes/index.tsx` (lines 271-276)

### 6f. Net Worth Period Tabs
- Extract period tab pattern into a reusable `PillTabs` component
- Files: `src/components/ui/pill-tabs.tsx` (new), `src/routes/net-worth.tsx`

### 6g. Accounts Page Grand Total
- Add a grand total line at the top of the accounts list showing total across all account types
- File: `src/routes/accounts.tsx`

---

## Out of Scope

- Contextual help / progressive disclosure / onboarding improvements
- Keyboard shortcuts system beyond Cmd+K
- Mobile-specific responsive changes
- New features or data model changes
