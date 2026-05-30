# Story 2.4: Navigate Budget by Month

Status: review

## Story

As a user,
I want to navigate between months on the Budget page,
So that I can review budget status for any month.

## Acceptance Criteria

**Given** the user is on the Budget page
**When** the user uses the month navigation tabs (UX-DR24)
**Then** left/right arrows (← Feb | **March 2026** | Apr →) allow moving between months
**And** the current month is highlighted and displayed as the active tab
**And** budget categories and their spent amounts update to reflect the selected month
**And** tabs filter the view without changing the URL
**And** the budget structure (groups, categories, targets) carries forward to all months

## Tasks / Subtasks

### Task 1: Month Navigation Component [x]
Build the month navigation UI element.

**AC reference:** "left/right arrows (← Feb | March 2026 | Apr →)" + "current month is highlighted"

- Create `src/components/budget/MonthNavigator.tsx`:
  - Props: `selectedYear: number`, `selectedMonth: number`, `onChange: (year: number, month: number) => void`
  - Layout: horizontal row with left arrow, current month label, right arrow
  - Left arrow: Ghost button with "←" or ChevronLeft icon, shows abbreviated previous month name (e.g., "Feb")
  - Center: current month and year in bold (e.g., "**March 2026**")
  - Right arrow: Ghost button with "→" or ChevronRight icon, shows abbreviated next month name (e.g., "Apr")
  - Clicking left arrow: calls `onChange` with previous month (handles year rollover: Jan 2026 → Dec 2025)
  - Clicking right arrow: calls `onChange` with next month (handles year rollover: Dec 2026 → Jan 2027)
  - Keyboard: Arrow keys navigate months when component is focused (UX accessibility spec)
  - Use `formatDate` utility or `Intl.DateTimeFormat` for month names

### Task 2: Month State Management [x]
Manage the selected month as local React state (not URL).

**AC reference:** "tabs filter the view without changing the URL"

- In `src/routes/budget.tsx`:
  - Initialize state: `const [selectedYear, selectedMonth] = useState` with current year/month
  - Pass state to `MonthNavigator` component
  - Pass state to `useBudgetStatus(selectedYear, selectedMonth)` hook
  - When month changes, TanStack Query automatically refetches budget status for the new month
  - No URL or route changes — purely local state

### Task 3: Update Budget Page Header [x]
Show the selected month in the page header.

**AC reference:** "page header shows Budget with the current month (UX-DR23)" (from Story 2.3, refined here)

- Update `src/routes/budget.tsx`:
  - Page header title: "Budget" (static H1)
  - MonthNavigator rendered below the header or as a subtitle element
  - The month label in MonthNavigator serves as the month indicator

### Task 4: Wire Budget Status to Selected Month [x]
Ensure budget data reflects the selected month.

**AC reference:** "budget categories and their spent amounts update to reflect the selected month" + "budget structure carries forward to all months"

- `useBudgetStatus(selectedYear, selectedMonth)` already accepts year/month params (from Story 2.3)
- When month changes, TanStack Query fires a new query with the updated params
- Budget groups and categories (structure) are the same across all months — only spent amounts change
- The query key `["budget-status", year, month]` ensures proper caching per month
- Loading state: show skeleton or keep previous data while fetching (TanStack Query `keepPreviousData: true` or `placeholderData` option for smooth transitions)

### Task 5: Handle Edge Cases [x]
Address month boundary behavior.

**AC reference:** Robust navigation across year boundaries.

- Year rollover: December → January increments year, January → December decrements year
- No upper or lower bound on navigation (users can browse any month)
- Default on page load: current system month and year
- If budget status returns no data for a month (no expenses), display all categories with $0.00 spent (handled by Story 2.3 empty state)

### Task 6: Playwright E2E Tests [x]
Write tests verifying all acceptance criteria.

**AC reference:** All criteria.

- Append to `tests/budget.spec.ts`:
  - Test: Month navigation arrows (← / →) are visible and clickable
  - Test: Clicking the right arrow advances to the next month and updates the displayed month label
  - Test: Clicking the left arrow goes back to the previous month
  - Test: Budget categories remain visible after navigating months
  - Test: Year rollover works (e.g., navigate from January backward to December of previous year)
- Verify: `npx playwright test tests/budget.spec.ts` passes

## Dev Notes

### Architecture Guidance

This is primarily a frontend story. No new Tauri commands or database queries are needed — it reuses `get_budget_status(year, month)` from Story 2.3.

**State Management:**
- Selected month is local React state (`useState`), not URL state. This matches the UX spec: "Tabs don't change the URL — they filter the current view" (UX-DR24).
- TanStack Query caches responses per query key. Navigating back to a previously viewed month hits the cache instantly.
- Consider `keepPreviousData: true` in the query options so the UI doesn't flash blank when switching months.

**Month Navigation Pattern (UX-DR24):**
- Budget uses: `← Feb | March 2026 | Apr →`
- Net Worth uses: `6M | 1Y | ALL` (different pattern, same concept)
- The MonthNavigator is budget-specific. Do not over-generalize — Net Worth has a different control.

**Ghost Buttons for Arrows:**
- Per UX-DR15: Ghost buttons are for tertiary actions/navigation. Month arrows are Ghost buttons.
- "Ghost buttons never perform write operations — they navigate or dismiss."

**No Backend Changes:**
- `get_budget_status(year, month)` already parameterized by Story 2.3.
- Budget structure (groups, categories, targets) is not month-specific — same structure shows for every month. Only `spent_cents` varies by month.

### Scope Boundaries

**In scope:**
- MonthNavigator component (← / current month / →)
- Local state for selected year/month in budget page
- Wiring selected month to `useBudgetStatus` hook
- Smooth month transitions (keep previous data while loading)
- Year rollover handling
- Playwright tests

**Out of scope:**
- URL-based month navigation (explicitly excluded by UX spec)
- Month-specific budget targets (targets are the same every month in MVP)
- Copying budgets between months (not in scope)
- Net Worth period tabs (different component, Epic 5)
- Keyboard shortcut for month navigation beyond arrow keys on focused component

### Project Structure Notes

**Files to create:**
- `src/components/budget/MonthNavigator.tsx`

**Files to modify:**
- `src/routes/budget.tsx` — add month state, integrate MonthNavigator, pass month to useBudgetStatus

### References

- Epic 2 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md` (lines 391-414)
- UX — sub-navigation tabs (UX-DR24): `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/ux-design-specification.md` (lines 949-953)
- UX — Ghost button pattern (UX-DR15): UX spec (lines 877-886)
- Architecture — TanStack Query keys `["budgets", month]`: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md` (line 390)
- Story 2.3 for prerequisite `useBudgetStatus` hook: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/implementation-artifacts/2-3-view-budget-status-with-progress-bars.md`

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A

### Completion Notes List
- Created MonthNavigator component with ChevronLeft/ChevronRight ghost buttons, keyboard arrow key support, and year rollover logic
- Converted budget page from hardcoded current month to useState-driven selectedYear/selectedMonth
- Removed static formatMonthYear subtitle; MonthNavigator now serves as month indicator below PageHeader
- Added placeholderData: keepPreviousData to useBudgetStatus for smooth month transitions
- All 21 Playwright tests pass (16 existing + 5 new month navigation tests)
- TypeScript compiles with no errors

### File List
- `src/components/budget/MonthNavigator.tsx` (created)
- `src/routes/budget.tsx` (modified)
- `src/hooks/useBudget.ts` (modified)
- `tests/budget.spec.ts` (modified)
