# Story 6.3: Transaction Review and Confirmation

Status: review

## Story
As a user, I want to review AI-categorized transactions and correct any mistakes before importing, So that my budget data is accurate.

## Acceptance Criteria

**AC1: Summary header with transaction counts**
Given AI processing is complete (Story 6.2 emits `import:complete`)
When the review screen appears
Then a summary header shows "X transactions extracted -- Y auto-categorized, Z need review"

**AC2: AutoCategorizedSummary for confident transactions**
Given there are auto-categorized transactions
When the review screen renders
Then an AutoCategorizedSummary component displays collapsed with a checkmark icon + count text ("Y transactions auto-categorized")
And a "View all" expand toggle reveals the full transaction list
And each row in the expanded list has an editable category dropdown

**AC3: TransactionReviewCards for flagged transactions**
Given there are flagged (low-confidence) transactions
When the review screen renders
Then each flagged transaction displays as a TransactionReviewCard with:
  - Merchant name (14px, font-weight 500)
  - Amount (monospace, right-aligned)
  - "AI suggests:" label + category Select dropdown pre-selected with the AI's best guess
And the card has a warning-styled border and background

**AC4: Resolving flagged transactions**
Given the user selects a category on a flagged TransactionReviewCard
When the selection is confirmed
Then the card border changes from warning styling to positive styling (emerald)
And the dropdown shows the selected category

**AC5: Confirm button gated on resolution**
Given the review screen is displayed
When not all flagged transactions have a category selected
Then the "Import X transactions" confirm button is disabled
When all flagged items have a category selected
Then the confirm button becomes enabled with the total count (e.g., "Import 18 transactions")

**AC6: Save transactions on confirmation**
Given all flagged transactions are resolved and the user clicks confirm
When the import is finalized
Then all transactions (auto-categorized + reviewed) are saved to the `expenses` table with `source: 'import'`
And an audit log entry records the import event
And TanStack Query invalidates `["expenses"]`, `["dashboard"]`, and `["budgets"]` query keys

**AC7: Completion screen**
Given the import is confirmed and transactions are saved
When the completion screen appears
Then a centered summary shows:
  - A checkmark animation
  - Total amount imported
  - Number of categories affected
  - Budget remaining
And a "View Dashboard" primary CTA navigates to the dashboard
And an "Import Another" secondary link returns to the upload zone

**AC8: Manual entry fallback for unreadable transactions**
Given partial extraction occurred (some transactions couldn't be read)
When the review screen renders
Then unreadable transactions are listed as "couldn't be read" with inline manual entry fields (merchant, amount, category, date)
And manually entered transactions are included in the confirmation flow

## Tasks / Subtasks

### Task 1: Build TransactionReviewCard component [AC3, AC4]
- [x] Create `src/components/import/TransactionReviewCard.tsx`
- [x] Display merchant name (14px, font-weight 500), amount (monospace, right-aligned)
- [x] Display "AI suggests:" label + shadcn Select dropdown pre-selected with AI's suggested category
- [x] Populate dropdown with user's budget categories
- [x] Default state: warning-styled border + background (amber/warning color)
- [x] Resolved state: positive-styled border (emerald) when category is selected/confirmed
- [x] Accessibility: Select is keyboard-navigable, card has `aria-label` describing transaction and review status

### Task 2: Build AutoCategorizedSummary component [AC2]
- [x] Create `src/components/import/AutoCategorizedSummary.tsx`
- [x] Collapsed state (default): checkmark icon + count text ("Y transactions auto-categorized") + "View all" toggle
- [x] Expanded state: full transaction list, each row showing merchant, amount, category (editable dropdown)
- [x] Toggle button has `aria-expanded` attribute
- [x] Accessibility: expand toggle is a button element

### Task 3: Build review screen layout [AC1, AC2, AC3, AC5]
- [x] Update `src/routes/import.tsx` to add the review screen phase
- [x] Summary header: "X transactions extracted -- Y auto-categorized, Z need review"
- [x] Layout: AutoCategorizedSummary at top, then TransactionReviewCards for flagged items below
- [x] Confirm button at bottom: "Import X transactions" -- disabled until all flagged items resolved
- [x] Track resolution state for all flagged transactions

### Task 4: Implement confirm import Tauri command [AC6]
- [x] Add `confirm_import` command to `src-tauri/src/commands/import.rs`
- [x] Accept the finalized transaction list (with user-corrected categories)
- [x] Insert all transactions into the `expenses` table via `db/expense.rs` with `source: 'import'`
- [x] Write an audit log entry via `db/audit.rs` recording the import (transaction count, date, source file)
- [x] Return success result

### Task 5: Wire confirm flow in frontend [AC5, AC6]
- [x] Call `confirm_import` Tauri command when user clicks the confirm button
- [x] On success, invalidate TanStack Query keys: `["expenses"]`, `["dashboard"]`, `["budgets"]`
- [x] Transition to completion screen

### Task 6: Build completion screen [AC7]
- [x] Add completion phase to `src/routes/import.tsx`
- [x] Centered layout with:
  - [x] Checkmark animation (CSS or simple SVG animation)
  - [x] Total amount imported (formatted from cents via `formatCurrency`)
  - [x] Number of categories affected
  - [x] Budget remaining summary
- [x] "View Dashboard" primary CTA -- navigates to `/` (dashboard route)
- [x] "Import Another" secondary link -- resets import state back to upload zone

### Task 7: Handle manual entry for unreadable transactions [AC8]
- [x] When partial extraction data includes unreadable items, render them as "couldn't be read" entries
- [x] Each unreadable entry has inline fields: merchant (text input), amount (MoneyInput), category (Select dropdown), date (date input)
- [x] Manually entered transactions are included in the transaction list for confirmation
- [x] Validate that required fields are filled before enabling confirm button

### Task 8: Write Playwright tests [AC1, AC2, AC3, AC4, AC5, AC7]
- [x] Append to `tests/import.spec.ts` with mocked import data:
  - [x] Summary header shows transaction counts ("X auto-categorized, Y need review")
  - [x] AutoCategorizedSummary renders collapsed with count; clicking expand shows transaction list
  - [x] TransactionReviewCards display with merchant name, amount, and category dropdown
  - [x] Selecting a category on a flagged card changes border from warning to positive styling
  - [x] Confirm button is disabled until all flagged items resolved; enabled after
  - [x] Completion screen shows checkmark, stats, "View Dashboard" CTA, and "Import Another" link
  - [x] Clicking "View Dashboard" navigates to the dashboard
- Note: Full E2E import-to-dashboard tests deferred until AWS credentials are configured

## Dev Notes

### Architecture
- This story builds the review and confirmation UI that consumes the AI results from Story 6.2. It does NOT call Bedrock -- it receives the parsed transaction data from the `import:complete` event and presents it for user review.
- The confirm flow uses a Tauri **command** (`confirm_import`) -- request/response pattern, not events. The command saves transactions and returns success/failure.
- After confirmation, TanStack Query invalidation causes the dashboard, expenses, and budget views to refetch with the new data.

### Component Design

**TransactionReviewCard:**
- Anatomy: merchant name, amount (monospace right-aligned), "AI suggests:" + category Select
- States: warning (default, amber border) -> positive (resolved, emerald border)
- Props: `transaction: { merchant, amount_cents, date, suggested_category_id, confidence }`, `categories: BudgetCategory[]`, `onCategoryChange: (categoryId) => void`, `isResolved: boolean`

**AutoCategorizedSummary:**
- Anatomy: checkmark icon + count + "View all" toggle
- States: collapsed (default), expanded (shows all auto-categorized transactions with editable categories)
- Props: `transactions: Transaction[]`, `categories: BudgetCategory[]`, `onCategoryChange: (txIndex, categoryId) => void`

### Data Flow
```
import:complete event (from Story 6.2)
  -> useImport hook receives { transactions, flagged_count, auto_count }
  -> Review screen renders:
     - AutoCategorizedSummary (auto_count transactions)
     - TransactionReviewCards (flagged_count transactions)
  -> User resolves flagged items
  -> User clicks "Import X transactions"
  -> invoke("confirm_import", { transactions: [...] })
  -> Rust: db/expense.rs inserts expenses with source='import'
  -> Rust: db/audit.rs logs the import
  -> Frontend: invalidate ["expenses"], ["dashboard"], ["budgets"]
  -> Completion screen renders
```

### Database Writes
- Transactions saved to `expenses` table with fields: `merchant`, `amount_cents`, `date`, `budget_category_id`, `source` (value: `'import'`)
- Audit log entry: action=`create`, entity_type=`import`, details_json includes transaction count and file reference
- All writes happen in a single database transaction for atomicity (NFR11)

### Manual Entry Fallback
- When Story 6.2 signals partial extraction, the review screen includes "couldn't be read" entries with inline form fields
- This satisfies FR14 (user can manually enter transactions that AI failed to extract)
- Manual entries join the same confirmation flow -- they are saved alongside AI-extracted transactions

### Scope Boundaries
- IN SCOPE: TransactionReviewCard, AutoCategorizedSummary, review screen layout, confirm button logic, `confirm_import` command, expense insertion, audit logging, query invalidation, completion screen, manual entry fallback for unreadable items
- OUT OF SCOPE: File upload (Story 6.1), AI extraction pipeline (Story 6.2), ImportProgressStepper (Story 6.2), Bedrock API calls (Story 6.2)

### Project Structure Notes

**Frontend files to create/modify:**
- `src/components/import/TransactionReviewCard.tsx` -- Flagged transaction review card
- `src/components/import/AutoCategorizedSummary.tsx` -- Collapsed auto-categorized summary
- `src/routes/import.tsx` -- Add review screen, completion screen, confirm flow
- `src/hooks/useImport.ts` -- Update with review state management and confirm mutation

**Backend files to create/modify:**
- `src-tauri/src/commands/import.rs` -- Add `confirm_import` command
- `src-tauri/src/db/expense.rs` -- Bulk insert for imported transactions (if not already supporting batch insert)
- `src-tauri/src/db/audit.rs` -- Audit log entry for imports

**Test files:**
- `tests/import.spec.ts` -- Append Playwright tests for review and completion UI

### References
- Architecture: `_bmad-output/planning-artifacts/architecture.md` -- CC Import data flow (confirm_import step), expense table schema, audit logging, TanStack Query invalidation pattern
- UX Spec: `_bmad-output/planning-artifacts/ux-design-specification.md` -- TransactionReviewCard anatomy/states, AutoCategorizedSummary anatomy/states, completion screen design (Journey 2), exception-only review pattern
- Epics: `_bmad-output/planning-artifacts/epics.md` -- Story 6.3 acceptance criteria, FR8, FR9, FR14

## Dev Agent Record
### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust compilation: clean
- TypeScript: clean
- Playwright: 16/16 import tests pass, 109/109 full suite
### Completion Notes List
- Task 1: TransactionReviewCard with merchant, amount (monospace), date, AI suggests dropdown. Warning (amber) vs resolved (emerald) border states.
- Task 2: AutoCategorizedSummary with collapsed/expanded toggle, aria-expanded, each row has editable category dropdown.
- Task 3: ReviewScreen component in import.tsx with summary header, auto-categorized section, flagged cards, and confirm button.
- Task 4: confirm_import Tauri command with bulk_insert_imported_expenses (source='import') and audit_db logging.
- Task 5: Confirm flow calls invoke("confirm_import"), invalidates expense/dashboard/budget queries, transitions to completion.
- Task 6: Completion screen with checkmark, total imported, categories affected, View Dashboard CTA, Import Another link.
- Task 7: Manual entry for unreadable transactions with inline merchant/amount/category/date fields.
- Task 8: 8 new Playwright tests for review screen, auto-categorized summary, review cards, confirm flow, and completion.
### File List
- src/components/import/TransactionReviewCard.tsx (created)
- src/components/import/AutoCategorizedSummary.tsx (created)
- src/routes/import.tsx (modified - added ReviewScreen, ErrorScreen, completion)
- src/hooks/useImport.ts (modified)
- src-tauri/src/commands/import.rs (modified - added confirm_import command)
- src-tauri/src/db/expense.rs (modified - added bulk_insert_imported_expenses)
- src-tauri/src/lib.rs (modified - registered confirm_import)
- tests/import.spec.ts (modified - added 8 Story 6.3 tests)

### Change Log
- 2026-03-15: Story 6.3 implemented - transaction review, confirm import, completion screen, manual entry fallback
