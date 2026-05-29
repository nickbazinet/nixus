# Story 14.3: Dashboard Month Navigation

Status: ready-for-dev

## Story

As a user,
I want to navigate to previous months on the Dashboard,
so that I can review last month's budget status and spending without switching to the Budget page.

## Acceptance Criteria

1. A month navigator (prev/next chevrons + current month/year label) appears on the Dashboard, consistent with the Budget page navigator.
2. All dashboard data (budget summary, top categories, spending breakdown, income total) re-fetches for the selected month when the user navigates.
3. Default is the current month — no change in behavior on first load.
4. Navigating to a future month is allowed (consistent with Budget page behavior).
5. No backend changes — all four dashboard Rust commands already accept `year` and `month` parameters.

## Tasks / Subtasks

- [ ] Add month state to dashboard route (AC: #2, #3)
  - [ ] In `apps/desktop/src/routes/index.tsx`, convert hardcoded `year`/`month` constants into `selectedYear`/`selectedMonth` state initialized to `now.getFullYear()` / `now.getMonth() + 1`
  - [ ] Add `handleMonthChange(year, month)` callback (exact pattern from `budget.tsx`)
  - [ ] Update all four query calls to use `selectedYear`/`selectedMonth` instead of `year`/`month`
  - [ ] Update any `monthLabel` derivation to use `selectedYear`/`selectedMonth`

- [ ] Add MonthNavigator to dashboard UI (AC: #1, #4)
  - [ ] Import and render `<MonthNavigator>` from `apps/desktop/src/components/budget/MonthNavigator.tsx` — reuse directly, no new component
  - [ ] Place it in the dashboard header area (e.g., in `PageHeader` actions slot, or in a strip below the header consistent with Budget page)

## Dev Notes

### Why backend needs no changes

All four dashboard Rust commands already accept year/month:
```rust
pub fn get_budget_summary(state: State<DbState>, year: i32, month: i32)
pub fn get_top_budget_categories(state: State<DbState>, year: i32, month: i32, limit: usize)
pub fn get_spending_breakdown(state: State<DbState>, year: i32, month: i32)
// Income (in income commands):
pub fn get_income_total(state: State<DbState>, year: i32, month: i32)
```

All four corresponding React Query keys are already parameterized by year/month:
```typescript
budgetSummary: (year, month) => ["budget-summary", year, month]
topBudgetCategories: (year, month) => ["top-budget-categories", year, month]
spendingBreakdown: (year, month) => ["spending-breakdown", year, month]
incomeTotal: (year, month) => ["income-total", year, month]
```

React Query handles re-fetching automatically when the key changes.

### Exact implementation pattern (from budget.tsx)

**State in `apps/desktop/src/routes/index.tsx`:**
```typescript
const now = new Date();
const [selectedYear, setSelectedYear] = useState(now.getFullYear());
const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

const handleMonthChange = (year: number, month: number) => {
  setSelectedYear(year);
  setSelectedMonth(month);
};
```

**Queries (replace current hardcoded `year`/`month`):**
```typescript
const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
const topCategories = useTopBudgetCategories(selectedYear, selectedMonth);
const spending = useSpendingBreakdown(selectedYear, selectedMonth);
const incomeTotal = useIncomeTotal(selectedYear, selectedMonth);
```

**MonthNavigator render:**
```tsx
import { MonthNavigator } from "@/components/budget/MonthNavigator";

<MonthNavigator
  selectedYear={selectedYear}
  selectedMonth={selectedMonth}
  onChange={handleMonthChange}
/>
```

### MonthNavigator component

Already fully generic — no changes needed. Located at:
`apps/desktop/src/components/budget/MonthNavigator.tsx`

Features already included:
- Chevron prev/next buttons
- `prevMonth()` / `nextMonth()` helpers with year wraparound
- Keyboard navigation (ArrowLeft/ArrowRight)
- ARIA labels for accessibility

### Placement of MonthNavigator

Check how `PageHeader` handles the `actions` prop in `apps/desktop/src/components/shared/PageHeader.tsx`. If it has an actions slot, pass `MonthNavigator` there. Otherwise place it immediately below `<PageHeader>` in a `div`, consistent with how `BudgetSummaryStrip` wraps `MonthNavigator` on the Budget page.

### Current state of index.tsx

In `apps/desktop/src/routes/index.tsx` (around lines 34–42), the four queries are called with hardcoded values derived from `new Date()`:
```typescript
const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

const budgetSummary = useBudgetSummary(year, month);
const topCategories = useTopBudgetCategories(year, month);
const spending = useSpendingBreakdown(year, month);
const incomeTotal = useIncomeTotal(year, month);
```

Replace all four with the state-driven pattern above.

### Project Structure Notes

- Only `apps/desktop/src/routes/index.tsx` changes (plus the import of MonthNavigator)
- `MonthNavigator` is reused as-is — do NOT copy or create a variant
- No new query keys, no new hooks, no backend changes
- The `netWorthCurrent` query is a live snapshot (always current) — do NOT make it month-aware; leave it as-is

### References

- Dashboard route to modify: `apps/desktop/src/routes/index.tsx`
- Pattern to copy from: `apps/desktop/src/routes/budget.tsx` (selectedYear/selectedMonth state + handleMonthChange)
- MonthNavigator (reuse as-is): `apps/desktop/src/components/budget/MonthNavigator.tsx`
- Dashboard hooks (no changes): `apps/desktop/src/hooks/useDashboard.ts`
- PageHeader (check actions prop): `apps/desktop/src/components/shared/PageHeader.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
