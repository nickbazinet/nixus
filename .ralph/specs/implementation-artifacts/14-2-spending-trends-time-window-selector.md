# Story 14.2: Spending Trends Time Window Selector

Status: review

## Story

As a user,
I want to choose between 3, 6, and 12 months on the Spending Trends page,
so that I can see shorter or longer trend windows without being locked into the hardcoded 6-month view.

## Acceptance Criteria

1. A `PillTabs` component appears above the chart with options: 3 months, 6 months, 12 months.
2. Default selection is 6 months (no change in default behavior).
3. Selecting a different window immediately re-fetches and re-renders the chart and category table.
4. The selected window is reflected in translated labels (matching the Projection page pattern).
5. No backend changes — the Rust command and DB queries already accept a `months` parameter.

## Tasks / Subtasks

- [x] Add time window state and constants (AC: #1, #2, #4)
  - [x] In `apps/desktop/src/routes/spending-trends.tsx`, remove `const MONTHS = 6`
  - [x] Add `WINDOW_OPTIONS`, `WINDOW_LABEL_KEYS`, `WINDOW_MONTHS` constants (see Dev Notes)
  - [x] Add `useState<string>("6m")` for selected window
  - [x] Add `useMemo` for translated labels (identical pattern to Projection page)

- [x] Wire PillTabs UI (AC: #1, #3)
  - [x] Import `PillTabs` from `@nkbaz/shared`
  - [x] Render `<PillTabs>` above the chart, passing `options`, `labels`, `value`, `onChange`
  - [x] Pass `WINDOW_MONTHS[selectedWindow]` to `useSpendingTrends()` instead of the removed constant

- [x] Add i18n keys (AC: #4)
  - [x] Add translation keys for `spending.period3M`, `spending.period6M`, `spending.period12M` to all locale files in `apps/desktop/src/locales/`

## Dev Notes

### Why backend needs no changes

The Rust command already accepts `months: i32`:
```rust
// apps/desktop/src-tauri/src/commands/spending_trends.rs
pub fn get_spending_trends(state: State<DbState>, months: i32) -> Result<SpendingTrendsData, AppError>
```

Both DB functions use `printf('-%d months', ?1)` to dynamically offset the date range — they work for any value. The hook already passes `months` as a query key param, so React Query cache separation is automatic.

### Exact implementation pattern

Copy the Projection page pattern exactly. In `apps/desktop/src/routes/spending-trends.tsx`:

```typescript
import { useState, useMemo } from "react";
import { PillTabs } from "@nkbaz/shared";

const WINDOW_OPTIONS = ["3m", "6m", "12m"] as const;
const WINDOW_LABEL_KEYS: Record<string, string> = {
  "3m": "spending.period3M",
  "6m": "spending.period6M",
  "12m": "spending.period12M",
};
const WINDOW_MONTHS: Record<string, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

function SpendingTrendsPage() {
  const { t } = useTranslation();
  const [selectedWindow, setSelectedWindow] = useState<string>("6m");

  const windowLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(WINDOW_LABEL_KEYS).map(([k, v]) => [k, t(v)])
      ) as Record<string, string>,
    [t]
  );

  const { data, isPending } = useSpendingTrends(WINDOW_MONTHS[selectedWindow]);
  // ... rest of component

  return (
    <div>
      <PageHeader title={t("nav.trends")} />
      <div className="mb-4">
        <PillTabs
          options={WINDOW_OPTIONS}
          labels={windowLabels}
          value={selectedWindow}
          onChange={setSelectedWindow}
        />
      </div>
      {/* existing chart and table */}
    </div>
  );
}
```

### Current hardcoded location

`apps/desktop/src/routes/spending-trends.tsx` line 13: `const MONTHS = 6;`
This is the only change needed outside of adding the PillTabs UI.

### PillTabs import

`import { PillTabs } from "@nkbaz/shared";` — already used on Projection page with identical API.

### Project Structure Notes

- Only `spending-trends.tsx` changes in the desktop app
- No Rust changes, no hook changes, no constants.ts changes (queryKey already uses the `months` param)
- The `useSpendingTrends` hook is at `apps/desktop/src/hooks/useSpendingTrends.ts` — already receives `months` and uses it in the query key

### References

- Route to modify: `apps/desktop/src/routes/spending-trends.tsx`
- Pattern to copy: `apps/desktop/src/routes/projection.tsx` (PillTabs + horizon state, lines 6–84)
- Hook (no changes): `apps/desktop/src/hooks/useSpendingTrends.ts`
- PillTabs component: `packages/shared/src/ui/pill-tabs.tsx`
- Rust command (no changes): `apps/desktop/src-tauri/src/commands/spending_trends.rs`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

- Implemented PillTabs time window selector on Spending Trends page following the Projection page pattern exactly.
- `tsc --noEmit` passes with zero errors (desktop app has no `typecheck` npm script; tsc was invoked directly).
- `CategorySpendTable` `monthCount` prop updated to use `WINDOW_MONTHS[selectedWindow]` as fallback instead of removed `MONTHS` constant.

### File List

- `apps/desktop/src/routes/spending-trends.tsx`
- `apps/desktop/src/locales/en.json`
- `apps/desktop/src/locales/fr.json`
