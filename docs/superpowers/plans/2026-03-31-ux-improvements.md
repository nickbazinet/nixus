# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure navigation, redesign the budget page, add a TopBar search trigger, create a reusable slide-over panel, fix scrollbars, and resolve minor UI inconsistencies.

**Architecture:** All changes are frontend-only (React + Tailwind). No backend/Tauri changes. New components: `SlideOver` (reusable panel), `BudgetSummaryStrip`, `PillTabs`. Existing components are modified surgically. The slide-over replaces all inline form toggles across the app.

**Tech Stack:** React 19, TanStack Router, TanStack React Query, Tailwind CSS v4, Base UI, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-31-ux-improvements-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/ui/slide-over.tsx` | Reusable right-side slide-over panel with backdrop, focus trap, Escape |
| Create | `src/components/ui/pill-tabs.tsx` | Reusable pill-style tab selector |
| Create | `src/components/budget/BudgetSummaryStrip.tsx` | Month nav + budget totals + progress bar + Add Expense trigger |
| Modify | `src/components/shared/InnerTabNav.tsx` | Group tabs with visual separators, remove Import + AI Chat |
| Modify | `src/components/shared/TopBar.tsx` | Add centered AI search bar trigger |
| Modify | `src/routes/__root.tsx` | Pass `onSearchClick` to TopBar |
| Modify | `src/routes/budget.tsx` | Summary strip, slide-over for forms |
| Modify | `src/routes/accounts.tsx` | Slide-over for Add Account, grand total |
| Modify | `src/routes/assets.tsx` | Slide-over for Add Asset |
| Modify | `src/routes/income.tsx` | Slide-over for Add Source + Add Entry |
| Modify | `src/routes/net-worth.tsx` | Use PillTabs, remove duplicate max-width |
| Modify | `src/routes/index.tsx` | Remove duplicate max-width, fix CashFlow wrapper, fix Spending toggle |
| Modify | `src/routes/spending-trends.tsx` | Remove duplicate max-width |
| Modify | `src/routes/import.tsx` | Replace raw inputs with design system components |
| Modify | `src/index.css` | Remove global scrollbar hiding |
| Modify | `src/components/shared/AppSidebar.tsx` | Add scrollbar hiding to sidebar only |
| Modify | `src/components/budget/BudgetCategoryRow.tsx` | Progress bar color teal → primary |
| Modify | `src/components/dashboard/BudgetCategoryRow.tsx` | Progress bar color teal → primary |
| Modify | `src/components/budget/BudgetGroupCard.tsx` | Inline mini progress bars, alternating rows, slide-over for Add Category |

---

## Task 1: Scrollbar Fix

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/shared/AppSidebar.tsx`

- [ ] **Step 1: Remove global scrollbar hiding from index.css**

In `src/index.css`, replace the `@layer base` block:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground font-sans;
  }
}
```

This removes `scrollbar-width: none` from the `*` selector and removes the `*::-webkit-scrollbar { display: none; }` rule entirely.

- [ ] **Step 2: Add scrollbar hiding to sidebar only**

In `src/components/shared/AppSidebar.tsx`, add inline style to the `<aside>` element to hide scrollbars only there:

```tsx
<aside
  ref={asideRef}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  style={{ scrollbarWidth: "none" }}
  className={cn(
    "shrink-0 h-screen sticky top-0 flex flex-col bg-sidebar transition-[width] duration-200 z-30 [&::-webkit-scrollbar]:hidden",
    expanded ? "w-48" : "w-14"
  )}
>
```

- [ ] **Step 3: Verify scrollbars appear in main content**

Run: `npm run dev`

Open the app, add enough content to make the main area scroll. Confirm native scrollbar appears. Confirm sidebar does NOT show a scrollbar.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/components/shared/AppSidebar.tsx
git commit -m "fix(ui): show scrollbars in main content, hide only in sidebar"
```

---

## Task 2: Progress Bar Color Fix

**Files:**
- Modify: `src/components/budget/BudgetCategoryRow.tsx`
- Modify: `src/components/dashboard/BudgetCategoryRow.tsx`
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Fix budget BudgetCategoryRow**

In `src/components/budget/BudgetCategoryRow.tsx`, change the `getStatusColor` function:

```tsx
function getStatusColor(ratio: number): string {
  if (ratio > 1.0) return "bg-rose-500";
  if (ratio >= 0.75) return "bg-amber-500";
  return "bg-primary";
}
```

- [ ] **Step 2: Fix dashboard BudgetCategoryRow**

In `src/components/dashboard/BudgetCategoryRow.tsx`, change the `getBarColor` function:

```tsx
function getBarColor(ratio: number): string {
  if (ratio > 1.0) return "bg-rose-500";
  if (ratio >= 0.75) return "bg-amber-500";
  return "bg-primary";
}
```

- [ ] **Step 3: Fix dashboard budget remaining progress bar**

In `src/routes/index.tsx`, find the budget utilization progress bar (around line 162) and change the color logic:

```tsx
<div
  className={`h-full rounded-full transition-all ${
    budgetUtilization > 100
      ? "bg-rose-500"
      : budgetUtilization >= 75
        ? "bg-amber-500"
        : "bg-primary"
  }`}
  style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
/>
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`

Check the budget page and dashboard. Progress bars should be indigo for "on track" state, amber for warning, rose for over budget.

- [ ] **Step 5: Commit**

```bash
git add src/components/budget/BudgetCategoryRow.tsx src/components/dashboard/BudgetCategoryRow.tsx src/routes/index.tsx
git commit -m "fix(ui): unify progress bar colors to use brand primary (indigo)"
```

---

## Task 3: Quick Fixes (Dashboard, Import, Net Worth)

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/net-worth.tsx`
- Modify: `src/routes/spending-trends.tsx`
- Modify: `src/routes/import.tsx`
- Modify: `src/routes/accounts.tsx`
- Create: `src/components/ui/pill-tabs.tsx`

- [ ] **Step 1: Remove duplicate max-width from Dashboard**

In `src/routes/index.tsx`, change the root wrapper from:

```tsx
<div className="max-w-[1280px] mx-auto">
```

to:

```tsx
<div>
```

- [ ] **Step 2: Remove duplicate max-width from Net Worth**

In `src/routes/net-worth.tsx`, change the root wrapper from:

```tsx
<div className="max-w-[1280px] mx-auto">
```

to:

```tsx
<div>
```

- [ ] **Step 3: Remove duplicate max-width from Spending Trends**

In `src/routes/spending-trends.tsx`, change the root wrapper from:

```tsx
<div className="max-w-[1280px] mx-auto">
```

to:

```tsx
<div>
```

- [ ] **Step 4: Fix CashFlowSummaryCard wrapper**

In `src/routes/index.tsx`, change:

```tsx
<div className="grid grid-cols-1 mb-4">
  <CashFlowSummaryCard
```

to:

```tsx
<div className="mb-4">
  <CashFlowSummaryCard
```

- [ ] **Step 5: Fix Spending Breakdown toggle button**

In `src/routes/index.tsx`, replace the raw `<button>` in the `SpendingBreakdown` component with the `Button` component. Change:

```tsx
<button
  type="button"
  className="flex items-center gap-1 text-sm font-medium text-muted-foreground mb-3 cursor-pointer hover:text-foreground transition-colors"
  onClick={() => setIsOpen(!isOpen)}
  data-testid="spending-breakdown-toggle"
>
```

to:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="gap-1 text-muted-foreground mb-3 -ml-2"
  onClick={() => setIsOpen(!isOpen)}
  data-testid="spending-breakdown-toggle"
>
```

And the closing `</button>` to `</Button>`. Add `Button` to the imports from `@/components/ui/button`.

- [ ] **Step 6: Create PillTabs component**

Create `src/components/ui/pill-tabs.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface PillTabsProps<T extends string> {
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
  "data-testid"?: string;
}

export function PillTabs<T extends string>({
  options,
  labels,
  value,
  onChange,
  "data-testid": testId,
}: PillTabsProps<T>) {
  return (
    <div className="flex gap-1" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={cn(
            "px-3 py-1 text-sm rounded-md font-medium transition-colors",
            value === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
          data-testid={testId ? `${testId}-${option}` : undefined}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Use PillTabs in Net Worth page**

In `src/routes/net-worth.tsx`, replace the inline period tabs. Add the import:

```tsx
import { PillTabs } from "@/components/ui/pill-tabs";
```

Replace the period tabs block (the `<div className="flex gap-1 mb-4">` and its children) with:

```tsx
<PillTabs
  options={PERIODS}
  labels={PERIOD_LABELS}
  value={period}
  onChange={setPeriod}
  data-testid="period-tabs"
/>
```

Remove the now-unused `cn` import if it was only used for the period tabs (check first — it may be used elsewhere in the file for `trendColor`). Keep `cn` if still used.

- [ ] **Step 8: Add grand total to Accounts page**

In `src/routes/accounts.tsx`, add a grand total line before the grouped accounts list. After the `groupedAccounts` memo, add:

```tsx
const grandTotal = useMemo(
  () => (accounts ? accounts.reduce((sum, a) => sum + a.balance_cents, 0) : 0),
  [accounts],
);
```

Then in the JSX, right before the `<div data-testid="accounts-list">`, add:

```tsx
{!isLoading && accounts && accounts.length > 0 && (
  <div data-testid="accounts-list" className="space-y-4">
    <div className="flex items-center justify-between px-3 py-2 mb-2">
      <span className="text-sm font-semibold text-foreground">Total</span>
      <span className="text-sm font-semibold font-mono">{formatCurrency(grandTotal)}</span>
    </div>
    {groupedAccounts.map(([type, groupAccounts]) => {
```

Remove the old `{!isLoading && accounts && accounts.length > 0 && (` and `<div data-testid="accounts-list" className="space-y-4">` lines that wrapped this block — they are now combined with the grand total wrapper. Make sure the closing `</div>` and `)}` still match.

- [ ] **Step 9: Fix Import page raw inputs**

In `src/routes/import.tsx`, add imports at the top:

```tsx
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/shared/MoneyInput";
import { Label } from "../components/ui/label";
```

Replace the manual entry grid in the "Couldn't Be Read" section (the `<div className="grid grid-cols-2 gap-2">` block for each unreadable item) with:

```tsx
<div className="grid grid-cols-2 gap-3">
  <div>
    <Label htmlFor={`manual-merchant-${i}`}>Merchant</Label>
    <Input
      id={`manual-merchant-${i}`}
      placeholder="Merchant"
      value={manualEntries[i]?.merchant ?? ""}
      onChange={(e) => {
        const updated = [...manualEntries];
        updated[i] = { ...updated[i], merchant: e.target.value };
        setManualEntries(updated);
      }}
    />
  </div>
  <div>
    <Label htmlFor={`manual-amount-${i}`}>Amount</Label>
    <MoneyInput
      id={`manual-amount-${i}`}
      value={manualEntries[i]?.amount_cents || 0}
      onChange={(cents) => {
        const updated = [...manualEntries];
        updated[i] = { ...updated[i], amount_cents: cents };
        setManualEntries(updated);
      }}
    />
  </div>
  <div>
    <Label>Category</Label>
    <Select
      value={String(manualEntries[i]?.budget_category_id || "")}
      onValueChange={(val) => {
        const updated = [...manualEntries];
        updated[i] = {
          ...updated[i],
          budget_category_id: Number(val),
        };
        setManualEntries(updated);
      }}
      items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Category..." />
      </SelectTrigger>
      <SelectContent>
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={String(cat.id)}>
            {cat.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  <div>
    <Label>Date</Label>
    <DatePicker
      value={manualEntries[i]?.date ?? ""}
      onChange={(value) => {
        const updated = [...manualEntries];
        updated[i] = { ...updated[i], date: value };
        setManualEntries(updated);
      }}
    />
  </div>
</div>
```

- [ ] **Step 10: Verify all quick fixes**

Run: `npm run dev`

Check:
- Dashboard: no double max-width, CashFlow card has no grid wrapper, Spending toggle uses Button
- Net Worth: PillTabs component, no double max-width
- Spending Trends: no double max-width
- Accounts: grand total visible at the top
- Import: manual entry fields use design system components

- [ ] **Step 11: Commit**

```bash
git add src/components/ui/pill-tabs.tsx src/routes/index.tsx src/routes/net-worth.tsx src/routes/spending-trends.tsx src/routes/import.tsx src/routes/accounts.tsx
git commit -m "fix(ui): quick fixes — duplicate max-width, PillTabs, import inputs, accounts total"
```

---

## Task 4: Navigation Restructure (InnerTabNav)

**Files:**
- Modify: `src/components/shared/InnerTabNav.tsx`

- [ ] **Step 1: Restructure nav items with groups**

Replace the entire contents of `src/components/shared/InnerTabNav.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Wallet,
  DollarSign,
  Landmark,
  Gem,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const navGroups: NavItem[][] = [
  [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  [
    { to: "/budget", label: "Budget", icon: Wallet },
    { to: "/income", label: "Income", icon: DollarSign },
  ],
  [
    { to: "/accounts", label: "Accounts", icon: Landmark },
    { to: "/assets", label: "Assets", icon: Gem },
    { to: "/net-worth", label: "Net Worth", icon: TrendingUp },
  ],
  [{ to: "/spending-trends", label: "Trends", icon: BarChart3 }],
];

export function InnerTabNav() {
  return (
    <nav aria-label="Finance navigation" className="border-b border-border bg-background dark:bg-card px-6">
      <ul className="flex gap-1 -mb-px overflow-x-auto items-center">
        {navGroups.map((group, groupIndex) => (
          <li key={groupIndex} className="contents">
            {groupIndex > 0 && (
              <span className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden="true" />
            )}
            {group.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent whitespace-nowrap"
                )}
                activeProps={{
                  className: cn(
                    "flex items-center gap-2 px-3 py-2.5 text-sm text-primary font-medium border-b-2 border-primary whitespace-nowrap"
                  ),
                }}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            ))}
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Verify navigation**

Run: `npm run dev`

Check:
- 7 tabs visible with vertical dividers between groups: Dashboard | Budget Income | Accounts Assets Net Worth | Trends
- Import and AI Chat no longer in the tab bar
- All tab links work and active states display correctly
- Tab bar scrolls on small viewports

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/InnerTabNav.tsx
git commit -m "feat(ui): group nav tabs with visual separators, remove Import and Chat tabs"
```

---

## Task 5: TopBar — AI Search Bar

**Files:**
- Modify: `src/components/shared/TopBar.tsx`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Update TopBar to accept onSearchClick and render search bar**

Replace the entire contents of `src/components/shared/TopBar.tsx`:

```tsx
import { CircleUser, Search } from "lucide-react";

interface TopBarProps {
  onSearchClick?: () => void;
}

export function TopBar({ onSearchClick }: TopBarProps) {
  return (
    <header className="flex items-center h-14 px-6 bg-sidebar">
      <div className="flex-1" />
      <button
        onClick={onSearchClick}
        className="flex items-center gap-2 flex-0 w-full max-w-[480px] bg-sidebar-accent rounded-lg px-3.5 py-2 cursor-pointer hover:bg-sidebar-accent/80 transition-colors"
        aria-label="Search or ask AI"
        data-testid="topbar-search-trigger"
      >
        <Search size={16} className="text-sidebar-foreground/50 shrink-0" />
        <span className="text-sm text-sidebar-foreground/50 flex-1 text-left">
          Search anything or ask AI...
        </span>
        <kbd className="text-[11px] text-sidebar-foreground/40 bg-sidebar rounded px-1.5 py-0.5 border border-sidebar-border">
          ⌘K
        </kbd>
      </button>
      <div className="flex-1 flex justify-end">
        <span className="text-sidebar-foreground/70" aria-hidden="true">
          <CircleUser size={24} />
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Pass onSearchClick from root layout**

In `src/routes/__root.tsx`, update the `<TopBar />` usage. Change:

```tsx
<TopBar />
```

to:

```tsx
<TopBar onSearchClick={() => setChatOpen(true)} />
```

- [ ] **Step 3: Verify search bar**

Run: `npm run dev`

Check:
- Search bar centered in the dark top bar with search icon, placeholder text, and ⌘K badge
- Clicking the search bar opens the FloatingChatBar
- User icon still on the far right
- Cmd+K keyboard shortcut still works

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/TopBar.tsx src/routes/__root.tsx
git commit -m "feat(ui): add centered AI search bar trigger to TopBar"
```

---

## Task 6: SlideOver Component

**Files:**
- Create: `src/components/ui/slide-over.tsx`

- [ ] **Step 1: Create the SlideOver component**

Create `src/components/ui/slide-over.tsx`:

```tsx
import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

export function SlideOver({
  open,
  onClose,
  title,
  children,
  "data-testid": testId,
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      // Small delay to let the panel render before focusing
      const timer = setTimeout(() => {
        const firstInput = panelRef.current?.querySelector<HTMLElement>(
          "input, select, textarea, button:not([data-close])"
        );
        firstInput?.focus();
      }, 100);
      return () => clearTimeout(timer);
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40" data-testid={testId}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/15 transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        className={cn(
          "fixed top-0 right-0 bottom-0 w-[400px] bg-card border-l border-border shadow-lg",
          "flex flex-col",
          "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={handleClose}
            data-close
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close panel"
            data-testid="slide-over-close"
          >
            <X size={18} />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Verify component renders**

Temporarily test in any page by importing and toggling open state. Confirm:
- Panel slides in from the right
- Backdrop dims content
- Clicking backdrop closes panel
- Escape closes panel
- Focus moves into panel on open

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/slide-over.tsx
git commit -m "feat(ui): add reusable SlideOver panel component"
```

---

## Task 7: Budget Page — Summary Strip + SlideOver

**Files:**
- Create: `src/components/budget/BudgetSummaryStrip.tsx`
- Modify: `src/routes/budget.tsx`
- Modify: `src/components/budget/BudgetGroupCard.tsx`

- [ ] **Step 1: Create BudgetSummaryStrip component**

Create `src/components/budget/BudgetSummaryStrip.tsx`:

```tsx
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthNavigator } from "./MonthNavigator";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface BudgetSummaryStripProps {
  selectedYear: number;
  selectedMonth: number;
  onMonthChange: (year: number, month: number) => void;
  totalTargetCents: number;
  totalSpentCents: number;
  remainingCents: number;
  onAddExpense: () => void;
}

export function BudgetSummaryStrip({
  selectedYear,
  selectedMonth,
  onMonthChange,
  totalTargetCents,
  totalSpentCents,
  remainingCents,
  onAddExpense,
}: BudgetSummaryStripProps) {
  const formatCurrency = useFormatCurrency();
  const utilization =
    totalTargetCents > 0 ? (totalSpentCents / totalTargetCents) * 100 : 0;

  return (
    <div
      className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 mb-4"
      data-testid="budget-summary-strip"
    >
      <div className="flex items-center justify-between mb-3">
        <MonthNavigator
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          onChange={onMonthChange}
        />
        <div className="flex items-center gap-5 text-sm">
          <div>
            <span className="text-muted-foreground">Budget </span>
            <span className="font-mono font-semibold">
              {formatCurrency(totalTargetCents)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Spent </span>
            <span className="font-mono font-semibold">
              {formatCurrency(totalSpentCents)}
            </span>
          </div>
          <div>
            <span className={remainingCents >= 0 ? "text-positive" : "text-destructive"}>
              Remaining{" "}
            </span>
            <span
              className={`font-mono font-semibold ${
                remainingCents >= 0 ? "text-positive" : "text-destructive"
              }`}
            >
              {formatCurrency(remainingCents)}
            </span>
          </div>
          <Button size="sm" onClick={onAddExpense} data-testid="add-expense-button">
            <Plus className="size-4 mr-1" />
            Add Expense
          </Button>
        </div>
      </div>
      {totalTargetCents > 0 && (
        <div
          className="h-2 w-full rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={totalSpentCents}
          aria-valuemin={0}
          aria-valuemax={totalTargetCents}
          data-testid="budget-overall-progress"
        >
          <div
            className={`h-full rounded-full transition-all ${
              utilization > 100
                ? "bg-rose-500"
                : utilization >= 75
                  ? "bg-amber-500"
                  : "bg-primary"
            }`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Restructure budget.tsx with SlideOver and SummaryStrip**

Replace the contents of `src/routes/budget.tsx`:

```tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { BudgetSummaryStrip } from "@/components/budget/BudgetSummaryStrip";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlideOver } from "@/components/ui/slide-over";
import { BudgetGroupCard } from "@/components/budget/BudgetGroupCard";
import { useBudgetGroups, useCreateBudgetGroup, useBudgetStatus } from "@/hooks/useBudget";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useExpensesByMonth, groupExpensesByCategory } from "@/hooks/useExpenses";
import type { BudgetCategoryStatus } from "@/lib/types";

export const Route = createFileRoute("/budget")({
  component: BudgetPage,
});

interface GroupFormData {
  name: string;
}

function BudgetPage() {
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const { data: groups = [] } = useBudgetGroups();
  const createGroup = useCreateBudgetGroup();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const { data: statusList = [] } = useBudgetStatus(selectedYear, selectedMonth);
  const { data: monthExpenses = [] } = useExpensesByMonth(selectedYear, selectedMonth);
  const expensesByCategory = groupExpensesByCategory(monthExpenses);
  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const summary = budgetSummary.data;

  const handleMonthChange = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  const statusByCategory = new Map<number, BudgetCategoryStatus>();
  for (const s of statusList) {
    statusByCategory.set(s.id, s);
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormData>({
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  const onSubmitGroup = (data: GroupFormData) => {
    createGroup.mutate(data.name, {
      onSuccess: () => {
        toast.success(`Group "${data.name}" created`);
        reset();
        setShowGroupForm(false);
      },
      onError: () => {
        toast.error("Failed to create group");
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="Budget"
        actions={
          <Button
            onClick={() => setShowGroupForm(true)}
            data-testid="add-group-button"
            variant="outline"
          >
            <Plus className="size-4 mr-1" />
            Add Group
          </Button>
        }
      />

      <BudgetSummaryStrip
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onMonthChange={handleMonthChange}
        totalTargetCents={summary?.total_target_cents ?? 0}
        totalSpentCents={summary?.total_spent_cents ?? 0}
        remainingCents={summary?.remaining_cents ?? 0}
        onAddExpense={() => setShowExpenseForm(true)}
      />

      {groups.length === 0 && !showGroupForm && (
        <p className="text-muted-foreground">
          No budget groups yet. Click "Add Group" to get started.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <BudgetGroupCard key={group.id} group={group} statusByCategory={statusByCategory} expensesByCategory={expensesByCategory} />
        ))}
      </div>

      {/* Add Expense Slide-Over */}
      <SlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        title="Add Expense"
        data-testid="expense-slide-over"
      >
        <AddExpenseForm onClose={() => setShowExpenseForm(false)} />
      </SlideOver>

      {/* Add Group Slide-Over */}
      <SlideOver
        open={showGroupForm}
        onClose={() => {
          reset();
          setShowGroupForm(false);
        }}
        title="Add Budget Group"
        data-testid="group-slide-over"
      >
        <form
          onSubmit={handleSubmit(onSubmitGroup)}
          className="space-y-3"
          data-testid="add-group-form"
        >
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              placeholder="e.g., Essentials"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: "Group name is required" })}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save Group
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                setShowGroupForm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
```

- [ ] **Step 3: Update BudgetGroupCard — alternating rows + inline mini progress bars**

In `src/components/budget/BudgetGroupCard.tsx`, update the category list rendering inside `<CardContent>`. Find the block that maps categories (the `<div className="space-y-2">` around line 227) and replace the category mapping with:

```tsx
{categories.length > 0 && (
  <div>
    {categories.map((cat, index) => {
      const status = statusByCategory?.get(cat.id);
      const ratio = status && status.target_cents > 0
        ? status.spent_cents / status.target_cents
        : 0;
      const progressPercent = Math.min(ratio * 100, 100);
      const barColor = ratio > 1.0
        ? "bg-rose-500"
        : ratio >= 0.75
          ? "bg-amber-500"
          : "bg-primary";

      return (
        <div key={cat.id}>
          <div
            className={`group flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 ${
              index % 2 === 0 ? "bg-muted/30" : ""
            }`}
            data-testid="budget-category-row"
          >
            <InlineEditText
              value={cat.name}
              onSave={(name) => handleUpdateCategoryName(cat, name)}
              className="text-sm text-foreground"
              data-testid="category-name"
            />
            <div className="flex items-center gap-2">
              {status && (
                <div className="w-20 h-1.5 rounded-full bg-muted shrink-0">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
              <InlineEditMoney
                value={cat.target_cents}
                onSave={(cents) => handleUpdateCategoryTarget(cat, cents)}
                data-testid="category-target"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteTarget(cat)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid="delete-category-button"
                aria-label="Delete category"
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
          {status && (
            <BudgetCategoryRow
              category={status}
              expenses={expensesByCategory?.[cat.id]}
            />
          )}
        </div>
      );
    })}
  </div>
)}
```

Also update the "Add Category" form at the bottom of `BudgetGroupCard` to not need a SlideOver — it's already inline within the card and that makes sense contextually since it's adding to a specific group.

- [ ] **Step 4: Verify budget page**

Run: `npm run dev`

Check:
- Summary strip at top with month nav, stats, progress bar, and "Add Expense" button
- "Add Expense" opens slide-over from the right
- "Add Group" opens slide-over from the right
- Group cards show category rows with alternating backgrounds and inline mini progress bars
- Month navigation updates the summary and category data
- All inline editing still works

- [ ] **Step 5: Commit**

```bash
git add src/components/budget/BudgetSummaryStrip.tsx src/routes/budget.tsx src/components/budget/BudgetGroupCard.tsx
git commit -m "feat(ui): redesign budget page with summary strip and slide-over forms"
```

---

## Task 8: Migrate Remaining Pages to SlideOver

**Files:**
- Modify: `src/routes/accounts.tsx`
- Modify: `src/routes/assets.tsx`
- Modify: `src/routes/income.tsx`

- [ ] **Step 1: Accounts page — replace inline form with SlideOver**

In `src/routes/accounts.tsx`, add the import:

```tsx
import { SlideOver } from "@/components/ui/slide-over";
```

Replace the inline form rendering block:

```tsx
{showForm && (
  <div className="mb-4">
    <AddAccountForm onClose={() => setShowForm(false)} />
  </div>
)}
```

with the SlideOver at the end of the JSX (before the closing `</div>`):

```tsx
<SlideOver
  open={showForm}
  onClose={() => setShowForm(false)}
  title="Add Account"
  data-testid="account-slide-over"
>
  <AddAccountForm onClose={() => setShowForm(false)} />
</SlideOver>
```

- [ ] **Step 2: Assets page — replace inline form with SlideOver**

In `src/routes/assets.tsx`, add the import:

```tsx
import { SlideOver } from "@/components/ui/slide-over";
```

Replace the inline form block:

```tsx
{showForm && (
  <div className="mb-4">
    <AddAssetForm onClose={() => setShowForm(false)} />
  </div>
)}
```

with the SlideOver at the end of the JSX:

```tsx
<SlideOver
  open={showForm}
  onClose={() => setShowForm(false)}
  title="Add Asset"
  data-testid="asset-slide-over"
>
  <AddAssetForm onClose={() => setShowForm(false)} />
</SlideOver>
```

- [ ] **Step 3: Income page — replace both inline forms with SlideOvers**

In `src/routes/income.tsx`, add the import:

```tsx
import { SlideOver } from "@/components/ui/slide-over";
```

Remove both inline form blocks:

```tsx
{/* Add Source Form */}
{showAddSource && (
  <div className="mb-4">
    <AddIncomeSourceForm onClose={() => setShowAddSource(false)} />
  </div>
)}

{/* Add Entry Form */}
{showAddEntry && (
  <div className="mb-4">
    <AddIncomeEntryForm onClose={() => setShowAddEntry(false)} />
  </div>
)}
```

Add two SlideOvers at the end of the JSX:

```tsx
<SlideOver
  open={showAddSource}
  onClose={() => setShowAddSource(false)}
  title="Add Income Source"
  data-testid="income-source-slide-over"
>
  <AddIncomeSourceForm onClose={() => setShowAddSource(false)} />
</SlideOver>

<SlideOver
  open={showAddEntry}
  onClose={() => setShowAddEntry(false)}
  title="Add Income Entry"
  data-testid="income-entry-slide-over"
>
  <AddIncomeEntryForm onClose={() => setShowAddEntry(false)} />
</SlideOver>
```

- [ ] **Step 4: Verify all pages**

Run: `npm run dev`

Check each page:
- Accounts: "Add Account" opens slide-over, form works, backdrop closes
- Assets: "Add Asset" opens slide-over, form works, backdrop closes
- Income: "Add Source" and "Add Entry" each open separate slide-overs

- [ ] **Step 5: Commit**

```bash
git add src/routes/accounts.tsx src/routes/assets.tsx src/routes/income.tsx
git commit -m "feat(ui): migrate accounts, assets, and income forms to slide-over panels"
```

---

## Task 9: Run Tests + Final Verification

- [ ] **Step 1: Run Playwright tests**

Run: `npx playwright test`

Check for failures. The main risk areas:
- Tests that click "Add Expense" button — the `data-testid` is preserved so selectors should still work
- Tests that check for inline forms appearing — they now appear inside a SlideOver (portal), so the selectors should still match since `data-testid` attributes are preserved
- Tests that check the tab navigation — Import and Chat tabs are removed

- [ ] **Step 2: Fix any test failures**

If tests fail because they look for Import/Chat tabs in the nav, update those test selectors. If tests fail because forms render in a portal now, the `data-testid` selectors should still work with Playwright's default behavior.

- [ ] **Step 3: Final visual review**

Walk through every page in the app:
1. Dashboard — no double max-width, CashFlow card clean, spending toggle uses Button, progress bars indigo
2. Budget — summary strip, slide-over forms, alternating rows, mini progress bars
3. Income — slide-over forms
4. Accounts — grand total, slide-over form
5. Assets — slide-over form
6. Net Worth — PillTabs, no double max-width
7. Trends — no double max-width
8. Import — design system inputs for manual entries
9. TopBar — centered search bar opens FloatingChatBar
10. Navigation — 7 grouped tabs with dividers
11. Scrollbars — visible in main content, hidden in sidebar
12. Dark mode — verify all changes look correct in both themes

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test: update tests for new navigation and slide-over patterns"
```
