# Story 4.2: Edit, Remove, and Update Account Balances

Status: review

## Story

As a user,
I want to edit account details, update balances inline, and remove accounts,
So that I can keep my account information current.

## Acceptance Criteria

1. **Given** the user views an account in the list, **When** the user clicks the balance amount, **Then** the balance becomes an inline editable input field (MoneyInput with monospace font, dollar sign prefix).
2. **Given** the balance is in edit mode, **When** the user types a new value and presses Enter, **Then** the new balance is saved (integer cents in database), the display updates, and a toast shows "Balance updated to $X,XXX.XX".
3. **Given** the balance is in edit mode, **When** the user presses Escape, **Then** the edit is cancelled and the original balance is restored without saving.
4. **Given** a credit card account has a negative balance, **When** the balance is displayed, **Then** it appears in rose color (Tailwind `text-rose-500`).
5. **Given** a balance is updated, **When** the save completes, **Then** an entry is written to the `audit_log` table recording the old balance, new balance, account ID, and timestamp.
6. **Given** the user wants to edit account details (name, institution, type), **When** the user hovers over the account row and clicks the edit action, **Then** the account details become editable and can be saved.
7. **Given** the user wants to remove an account, **When** the user hovers over the account row and clicks the delete action, **Then** a destructive confirmation dialog appears with the account name, and confirming removes the account from the database.
8. **Given** the user deletes an account, **When** the deletion completes, **Then** the accounts list refreshes and a toast confirms removal.
9. **Given** Playwright tests exist, **When** running `npx playwright test tests/accounts.spec.ts`, **Then** all tests pass (including new tests from this story appended to the existing file).

## Tasks / Subtasks

- [x] Task 1: Create `audit_log` migration if not already present (AC: #5)
  - [x] Create migration SQL file for `audit_log` table: `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `entity_type` (TEXT NOT NULL), `entity_id` (INTEGER NOT NULL), `action` (TEXT NOT NULL), `old_value` (TEXT), `new_value` (TEXT), `created_at` (TEXT NOT NULL DEFAULT current_timestamp)
  - [x] If the `audit_log` table already exists from a prior story, skip this task
- [x] Task 2: Implement Rust db layer for account updates and deletion (AC: #2, #5, #6, #7)
  - [x] Add to `src-tauri/src/db/account.rs`: `update_account_balance`, `update_account`, `delete_account`
  - [x] `update_account_balance` takes account ID + new balance_cents, updates `balance_cents` and `updated_at`, returns old and new balance
  - [x] `update_account` takes account ID + updatable fields (name, institution, account_type, currency), updates record
  - [x] `delete_account` takes account ID, deletes the row
  - [x] Add to `src-tauri/src/db/audit.rs` (create if not exists): `insert_audit_log` function
- [x] Task 3: Implement Rust Tauri commands for account mutations (AC: #2, #5, #6, #7)
  - [x] Add to `src-tauri/src/commands/account.rs`: `update_account_balance`, `update_account`, `delete_account`
  - [x] `update_account_balance` validates input, calls db function, writes audit log entry (entity_type: "account", action: "balance_update", old_value/new_value as cents strings), returns updated account
  - [x] `update_account` validates input, calls db function, returns updated account
  - [x] `delete_account` calls db function, returns success
  - [x] Register new commands in `main.rs`
- [x] Task 4: Add TypeScript types for mutations (AC: #2, #6)
  - [x] Add `UpdateAccountBalanceInput`, `UpdateAccountInput` types to `src/lib/types.ts`
- [x] Task 5: Extend `useAccounts` hook with mutations (AC: #2, #6, #7, #8)
  - [x] Add `useUpdateAccountBalance` mutation — calls `update_account_balance`, invalidates `["accounts"]`, shows success toast
  - [x] Add `useUpdateAccount` mutation — calls `update_account`, invalidates `["accounts"]`
  - [x] Add `useDeleteAccount` mutation — calls `delete_account`, invalidates `["accounts"]`, shows success toast
- [x] Task 6: Add inline balance editing to AccountRow (AC: #1, #2, #3, #4)
  - [x] Extend `src/components/accounts/AccountRow.tsx` with editing state
  - [x] Default state: balance displayed as monospace text; hover reveals pencil/edit icon on the balance
  - [x] Click balance (or press Enter when focused via keyboard): switch to edit mode with MoneyInput field, pre-filled with current balance
  - [x] Enter: save via `useUpdateAccountBalance`, exit edit mode
  - [x] Escape: cancel, restore original value, exit edit mode
  - [x] Negative balances: display in `text-rose-500`
  - [x] `aria-label` on the editable field for accessibility
- [x] Task 7: Add hover-to-reveal edit/delete actions on AccountRow (AC: #6, #7, #8)
  - [x] On row hover, reveal edit (pencil) and delete (trash) icon buttons
  - [x] Edit action: open inline edit or a small form for name/institution/type/currency fields
  - [x] Delete action: open destructive confirmation dialog (shadcn AlertDialog) showing account name
  - [x] Confirm delete: call `useDeleteAccount`, close dialog
  - [x] Cancel delete: close dialog, no action
- [x] Task 8: Write Playwright E2E tests (AC: #9)
  - [x] Append to `tests/accounts.spec.ts`
  - [x] Test: Clicking an account's balance makes it an editable input field
  - [x] Test: Typing a new value and pressing Enter updates the displayed balance and shows a toast
  - [x] Test: Pressing Escape reverts the balance without saving
  - [x] Test: Negative balances display in rose color
  - [x] Test: Hovering reveals edit/delete actions
  - [x] Test: Deleting shows confirmation dialog and removes the account from the list
  - [x] Run `npx playwright test tests/accounts.spec.ts` and confirm all tests pass

## Dev Notes

### Audit Log Schema

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

If this table was already created by a prior story's migration, do not duplicate it. Check existing migrations first.

Example audit log entry for a balance update:
```
entity_type: "account"
entity_id: 3
action: "balance_update"
old_value: "150000"
new_value: "175000"
```

Values stored as string representations of integer cents.

### Inline Balance Editing Flow

```
AccountRow (display mode)
  └── Balance text (monospace) — hover shows edit icon
       └── Click balance → Edit mode
            └── MoneyInput pre-filled with current value
                 ├── Enter → save (invoke update_account_balance) → display mode + toast
                 └── Escape → cancel → display mode (original value)
```

The MoneyInput component (from `src/components/shared/MoneyInput.tsx`) should:
- Accept and display dollar amounts (user types "1500.00")
- Convert to/from integer cents for the backend (150000)
- Show `$` prefix inside the input
- Use monospace font
- Auto-focus when entering edit mode

If MoneyInput does not yet exist, create a minimal version for this story. Keep it simple — a controlled input that handles dollar-to-cents conversion.

### Rust Commands

- `update_account_balance(id: i64, balance_cents: i64) -> Result<Account, AppError>` — updates balance, writes audit log, returns updated account
- `update_account(id: i64, input: UpdateAccountInput) -> Result<Account, AppError>` — updates name/institution/type/currency
- `delete_account(id: i64) -> Result<(), AppError>` — deletes account, returns empty success

### Negative Balance Display

Credit cards carry negative balances (debt). The `formatCurrency()` utility should already handle negative values from Story 4.1. The AccountRow component conditionally applies `text-rose-500` when `balance_cents < 0`.

### Destructive Delete Confirmation

Use shadcn `AlertDialog` component:
- Title: "Delete Account"
- Description: "Are you sure you want to delete {account name}? This action cannot be undone."
- Cancel button (default style)
- Delete button (destructive/rose style)

### Scope Boundaries

**In scope:** Inline balance editing, account detail editing, account deletion with confirmation, audit log for balance changes, hover-to-reveal actions, Playwright tests.

**Out of scope:** Net worth snapshot trigger on balance change (Epic 5). Dashboard refresh on balance change (Epic 5). Audit log viewing UI (not in MVP scope).

### Project Structure Notes

Files created or modified in this story:
- `src-tauri/migrations/NNN_audit_log.sql` (new, if not already exists)
- `src-tauri/src/db/account.rs` (add update/delete functions)
- `src-tauri/src/db/audit.rs` (new or update)
- `src-tauri/src/db/mod.rs` (register audit module if new)
- `src-tauri/src/commands/account.rs` (add update/delete commands)
- `src-tauri/src/main.rs` (register new commands)
- `src/lib/types.ts` (add mutation input types)
- `src/hooks/useAccounts.ts` (add mutation hooks)
- `src/components/accounts/AccountRow.tsx` (add inline edit + hover actions)
- `src/components/shared/MoneyInput.tsx` (new, if not already exists)
- `tests/accounts.spec.ts` (append tests)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Audit Log, Error Handling, Data Architecture]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — AccountRow (UX-DR8), Inline Editing, Financial Inputs, Negative Balance Rose Color, Hover-to-Reveal Actions]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- None

### Completion Notes List
- Created `006_audit_log.sql` migration for audit logging
- Created `db/audit.rs` with `insert_audit_log` function
- Extended `db/account.rs` with `update_account_balance` (returns old+new), `update_account`, `delete_account`
- Extended `commands/account.rs` with 3 new Tauri commands; `update_account_balance` writes audit log entry
- Added `UpdateAccountBalanceInput`, `UpdateAccountInput` TypeScript types
- Extended `useAccounts.ts` with `useUpdateAccountBalance`, `useUpdateAccount`, `useDeleteAccount` mutation hooks
- Rewrote `AccountRow.tsx` with inline balance editing (MoneyInput, Enter/Escape), hover-to-reveal edit/delete icons, delete confirmation dialog
- Created `EditAccountForm.tsx` for editing account details (name, institution, type, currency)
- 6 new Playwright E2E tests (16 total), all passing
- Full suite: 62 tests, 0 regressions

### File List
- `src-tauri/migrations/006_audit_log.sql` (new)
- `src-tauri/src/db/audit.rs` (new)
- `src-tauri/src/db/account.rs` (modified — added update/delete functions)
- `src-tauri/src/db/mod.rs` (modified — added audit module + migration)
- `src-tauri/src/models/mod.rs` (modified — added UpdateAccountInput)
- `src-tauri/src/commands/account.rs` (modified — added 3 commands)
- `src-tauri/src/lib.rs` (modified — registered 3 new commands)
- `src/lib/types.ts` (modified — added UpdateAccountBalanceInput, UpdateAccountInput)
- `src/hooks/useAccounts.ts` (modified — added 3 mutation hooks)
- `src/components/accounts/AccountRow.tsx` (modified — inline edit + hover actions + delete dialog)
- `src/components/accounts/EditAccountForm.tsx` (new)
- `tests/accounts.spec.ts` (modified — added 6 tests + mock commands)
