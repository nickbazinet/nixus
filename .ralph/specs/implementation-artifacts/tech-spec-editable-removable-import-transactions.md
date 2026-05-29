---
title: 'Editable and Removable Import Transactions'
slug: 'editable-removable-import-transactions'
created: '2026-03-15'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React', 'TypeScript', 'TanStack Router', 'Tauri', 'Tailwind CSS', 'Playwright']
files_to_modify: ['src/routes/import.tsx', 'src/components/import/AutoCategorizedSummary.tsx', 'src/components/import/TransactionReviewCard.tsx', 'tests/import.spec.ts']
code_patterns: ['categoryOverrides Record<number, number> keyed by global tx index', 'native select elements with data-testid', 'shadcn/tailwind styling', 'useCallback for event handlers', 'useMemo for derived lists']
test_patterns: ['Playwright with mocked Tauri internals via setupTauriMock', 'data-testid selectors', 'triggerUpload helper to reach review screen']
---

# Tech-Spec: Editable and Removable Import Transactions

**Created:** 2026-03-15

## Overview

### Problem Statement

During CC statement import, users cannot edit transaction details (merchant, amount, date) or exclude unwanted entries before confirming. They can only change categories. This means inaccurate AI extractions must be imported as-is or the entire import abandoned.

### Solution

Add inline editing for all transaction fields (merchant, amount, date, category) and checkbox-based selection/deselection on both auto-categorized and flagged transaction lists in the review screen. Only selected transactions are sent to `confirm_import`.

### Scope

**In Scope:**
- Checkbox on each transaction row to include/exclude from import (auto-categorized + flagged)
- Inline editable merchant name (text input), amount (number input), date (date input) on both lists
- Category remains dropdown-only with existing categories
- Confirm button count reflects only selected (checked) transactions
- Only checked transactions are sent to `confirm_import`

**Out of Scope:**
- Changes to the AI extraction pipeline (Story 6.2)
- Changes to the upload/validation flow (Story 6.1)
- Changes to the completion screen logic
- New backend commands (existing `confirm_import` accepts a transaction list)
- Adding new categories from the import screen

## Context for Development

### Codebase Patterns

- Components use shadcn/tailwind styling conventions with `cn()` utility for conditional classes
- Category dropdowns use native `<select>` elements with `data-testid` attributes
- `formatCurrency` utility handles cents-to-display conversion (amounts stored as integer cents)
- State managed via React `useState`/`useCallback`; overrides tracked in `categoryOverrides: Record<number, number>` keyed by global transaction index
- Derived lists use `useMemo` to split transactions by confidence threshold (0.8)
- Existing `confirm_import` Tauri command accepts `{ transactions: [...] }` — no backend changes needed
- `AutoCategorizedSummary` rows are plain `<div>` with text displays + category `<select>` — merchant/amount/date are not editable
- `TransactionReviewCard` displays merchant/amount/date as `<p>` tags — only category is a `<select>`
- ReviewScreen builds `finalTransactions` via `transactions.map()` applying `categoryOverrides` before calling `confirm_import`

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/routes/import.tsx` | ReviewScreen: state management (`categoryOverrides`, `manualEntries`), confirm flow, completion screen |
| `src/components/import/AutoCategorizedSummary.tsx` | Collapsed/expanded list with `onCategoryChange(index, categoryId)` callback |
| `src/components/import/TransactionReviewCard.tsx` | Flagged card with warning/resolved border states, `onCategoryChange(categoryId)` callback |
| `src/hooks/useImport.ts` | `ParsedTransaction` type: `{ merchant, amount_cents, date, suggested_category_id, confidence }` |
| `src/lib/formatCurrency.ts` | `formatCurrency(cents)` -> "$1,234.56" |
| `tests/import.spec.ts` | 16 tests, mocked Tauri via `setupTauriMock`, mock data: Amazon (auto, 0.95) + Uber Eats (flagged, 0.6) |

### Technical Decisions

- All transactions start checked (selected) by default — users opt-out rather than opt-in
- Replace `categoryOverrides: Record<number, number>` with a broader `fieldOverrides: Record<number, Partial<ParsedTransaction>>` to track edits to any field (merchant, amount_cents, date, suggested_category_id)
- Add `deselected: Set<number>` state keyed by global index to track unchecked transactions
- Filter out deselected transactions when building `finalTransactions` in `handleConfirm`
- `totalCount` and confirm button text reflect only selected transactions
- Completion screen stats also reflect only the imported (selected) transactions

## Implementation Plan

### Tasks

- [x] Task 1: Update ReviewScreen state management in `src/routes/import.tsx`
  - File: `src/routes/import.tsx`
  - Action: Replace `categoryOverrides: Record<number, number>` with `fieldOverrides: Record<number, Partial<ParsedTransaction>>`. Add `deselected` state as `Set<number>` (initialized empty — all checked by default). Update `handleFlaggedCategoryChange` and `handleAutoCategoryChange` to write into `fieldOverrides[globalIndex].suggested_category_id` instead of `categoryOverrides[globalIndex]`. Add `handleFieldChange(globalIndex: number, field: keyof ParsedTransaction, value: string | number | null)` callback that updates `fieldOverrides`. Add `handleToggleSelect(globalIndex: number)` callback that toggles the index in/out of `deselected`.
  - Notes: `fieldOverrides` merges with original transaction data at confirm time. The `deselected` Set uses global index (same as current `categoryOverrides` key).

- [x] Task 2: Update confirm flow and counts in `src/routes/import.tsx`
  - File: `src/routes/import.tsx`
  - Action: Update `handleConfirm` to filter out deselected indices before building `finalTransactions`. Apply `fieldOverrides` when building each transaction: `{ merchant: fieldOverrides[i]?.merchant ?? tx.merchant, amount_cents: fieldOverrides[i]?.amount_cents ?? tx.amount_cents, ... }`. Update `totalCount` to exclude deselected transactions: `transactions.filter((_, i) => !deselected.has(i)).length + validManualCount`. Update `allFlaggedResolved` to skip deselected flagged transactions. Update completion screen stats to use only the selected transactions.
  - Notes: Confirm button text changes dynamically as user checks/unchecks. If all transactions are deselected, confirm button should show "Import 0 transactions" and remain disabled.

- [x] Task 3: Add checkbox and editable fields to `TransactionReviewCard`
  - File: `src/components/import/TransactionReviewCard.tsx`
  - Action: Add new props: `selected: boolean`, `onToggleSelect: () => void`, `onMerchantChange: (value: string) => void`, `onAmountChange: (value: number) => void`, `onDateChange: (value: string) => void`. Replace merchant `<p>` with `<input type="text">` (value from props, `data-testid="merchant-input"`). Replace amount `<p>` with `<input type="number">` (value in cents, `data-testid="amount-input"`, displayed as cents). Replace date `<p>` with `<input type="date">` (`data-testid="date-input"`). Add checkbox at the start of the card (`<input type="checkbox" data-testid="transaction-checkbox">`). When unchecked, apply `opacity-50` to the card content (but keep checkbox full opacity). Keep existing category `<select>` and warning/resolved border logic.
  - Notes: Amount input works in cents (integer). The card should visually dim when deselected but remain interactive (user can re-check). Preserve existing `aria-label` pattern.

- [x] Task 4: Add checkbox and editable fields to `AutoCategorizedSummary`
  - File: `src/components/import/AutoCategorizedSummary.tsx`
  - Action: Add new props: `selectedSet: Set<number>` (global indices of selected transactions), `onToggleSelect: (index: number) => void`, `onFieldChange: (index: number, field: string, value: string | number) => void`, `fieldOverrides: Record<number, Partial<ParsedTransaction>>`. In the collapsed header, update count to reflect only selected auto-categorized transactions: `"{selectedCount} of {total} transactions auto-categorized"`. In expanded rows: add checkbox (`data-testid="auto-transaction-checkbox"`), replace merchant text span with `<input type="text" data-testid="auto-merchant-input">`, replace amount text span with `<input type="number" data-testid="auto-amount-input">`, replace date text span with `<input type="date" data-testid="auto-date-input">`. Apply `opacity-50` to unchecked rows. Keep existing category `<select>`.
  - Notes: The `index` passed to callbacks is the local index within the auto-categorized list. The parent (ReviewScreen) maps this to global index before updating state. The `selectedSet` contains global indices, so the component needs the global index mapping — pass `globalIndices: number[]` as an additional prop so the component can check `selectedSet.has(globalIndices[localIndex])`.

- [x] Task 5: Wire new props from ReviewScreen to child components
  - File: `src/routes/import.tsx`
  - Action: Compute `autoGlobalIndices: number[]` — for each auto transaction, its index in the original `transactions` array. Pass to `AutoCategorizedSummary`: `selectedSet={new Set(autoGlobalIndices.filter(i => !deselected.has(i)))}` (or pass `deselected` and `globalIndices` and let component derive). Pass `onToggleSelect`, `onFieldChange`, `fieldOverrides`. For each `TransactionReviewCard`: pass `selected={!deselected.has(globalIndex)}`, `onToggleSelect`, `onMerchantChange`, `onAmountChange`, `onDateChange` that call `handleFieldChange` with the appropriate global index and field. Update summary header to show selected count: `"{selectedCount} of {total} transactions extracted"`.
  - Notes: Keep the existing `handleFlaggedCategoryChange` and `handleAutoCategoryChange` working — they now write to `fieldOverrides[globalIndex].suggested_category_id`.

- [x] Task 6: Write Playwright tests
  - File: `tests/import.spec.ts`
  - Action: Add new test block `"Import Page — Editable & Removable Transactions"` with `beforeEach` that navigates to review screen (same as Story 6.3 tests). Tests:
    1. "unchecking a transaction excludes it from import count" — uncheck Amazon checkbox, confirm button shows "Import 1 transactions"
    2. "re-checking a transaction includes it again" — uncheck then re-check, count returns to 2
    3. "editing merchant name on flagged card persists the value" — expand auto-categorized, change Amazon merchant input to "Amazon Prime", verify input value
    4. "editing amount on flagged card persists the value" — change Uber Eats amount input, verify input value
    5. "unchecked transactions are visually dimmed" — uncheck a transaction, verify `opacity-50` class on card content
    6. "confirm only sends selected transactions" — uncheck one transaction, click confirm, verify completion screen shows correct count
  - Notes: Use existing `setupTauriMock` and `triggerUpload` helpers. Use `data-testid` selectors for new inputs/checkboxes.

### Acceptance Criteria

- [x] AC1: Given the review screen is displayed, when the user views any transaction (auto-categorized or flagged), then a checkbox is visible and checked by default.
- [x] AC2: Given a transaction is checked, when the user unchecks it, then the transaction row is visually dimmed (opacity-50) and the confirm button count decreases by 1.
- [x] AC3: Given a transaction is unchecked, when the user re-checks it, then the row returns to full opacity and the confirm button count increases by 1.
- [x] AC4: Given the review screen is displayed, when the user clicks on the merchant name field of any transaction, then it becomes an editable text input with the current value.
- [x] AC5: Given the review screen is displayed, when the user clicks on the amount field of any transaction, then it becomes an editable number input with the current value in cents.
- [x] AC6: Given the review screen is displayed, when the user clicks on the date field of any transaction, then it becomes an editable date input with the current value.
- [x] AC7: Given the user has edited fields and unchecked some transactions, when they click confirm, then only checked transactions are sent to `confirm_import` with any edited field values applied.
- [x] AC8: Given all transactions are unchecked, when the user views the confirm button, then it is disabled and shows "Import 0 transactions".

## Additional Context

### Dependencies

None — purely frontend changes to existing review screen components. No new packages or backend modifications required.

### Testing Strategy

- **Playwright E2E**: 6 new tests covering checkbox toggle, field editing, visual dimming, and filtered confirm flow using existing mock infrastructure.
- **Manual testing**: Verify inline editing UX feels natural — tab order between fields, input focus behavior, visual consistency between auto-categorized rows and flagged cards.

### Notes

- The amount input works in cents (integer) to match the existing data model. A future improvement could add a dollar-formatted input, but that is out of scope.
- Deselected flagged transactions are skipped in the `allFlaggedResolved` check — you don't need to resolve a transaction you're excluding.
- Existing tests should continue to pass unchanged since checkboxes default to checked and display-only text is replaced with inputs that show the same values.

## Review Notes
- Adversarial review completed
- Findings: 11 total, 7 fixed, 2 skipped (out-of-scope per spec), 2 noise
- Resolution approach: auto-fix
- Fixed: NaN guard on amount inputs, memoized autoSelectedSet, plural grammar, type safety on field prop, added 2 tests for auto-categorized checkbox/editing
- Skipped: F2 (raw cents display — explicitly out of scope), F4 (disabled inputs when deselected — spec says "remain interactive")
