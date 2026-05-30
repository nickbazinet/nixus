# Story 4.1: Add and View Financial Accounts

Status: review

## Story

As a user,
I want to add financial accounts with name, institution, type, and currency, and view them in a list,
So that I can track all my bank, investment, and crypto accounts in one place.

## Acceptance Criteria

1. **Given** the user navigates to the Accounts page, **When** the user clicks "Add Account", **Then** a form appears with fields: account name, institution, type (chequing, savings, credit card, TFSA, RRSP, FHSA, non-registered, crypto), and currency (CAD/USD).
2. **Given** the user fills out the Add Account form and submits, **When** the account is saved, **Then** the `accounts` table stores the record with `balance_cents` defaulting to 0 and a success toast confirms the account was added.
3. **Given** accounts exist, **When** the user views the Accounts page, **Then** all accounts are displayed using the AccountRow component (UX-DR8), each row showing account name, type + currency (muted), and balance (monospace).
4. **Given** the user views the Accounts page, **When** it renders, **Then** the page header shows "Accounts" with an "Add Account" action button.
5. **Given** no accounts exist, **When** the user views the Accounts page, **Then** an empty state is shown: "No accounts yet. Add your first account." with an Add Account button.
6. **Given** the user submits the Add Account form with missing required fields, **When** validation runs, **Then** inline error messages appear below the invalid fields and the form does not submit.
7. **Given** the Accounts page loads, **When** data is being fetched, **Then** skeleton loading states are shown matching the AccountRow layout.
8. **Given** the user adds an account, **When** the account is saved successfully, **Then** the accounts list refreshes to show the new account without a full page reload (TanStack Query invalidation).
9. **Given** Playwright tests exist, **When** running `npx playwright test tests/accounts.spec.ts`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Create `accounts` database migration (AC: #2)
  - [x] Create migration SQL file in `src-tauri/migrations/` with the `accounts` table: `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `name` (TEXT NOT NULL), `institution` (TEXT NOT NULL), `account_type` (TEXT NOT NULL), `currency` (TEXT NOT NULL DEFAULT 'CAD'), `balance_cents` (INTEGER NOT NULL DEFAULT 0), `created_at` (TEXT NOT NULL DEFAULT current_timestamp), `updated_at` (TEXT NOT NULL DEFAULT current_timestamp)
  - [x] Verify migration runs on app startup via the existing migration runner in `db/mod.rs`
- [x] Task 2: Implement Rust db layer for accounts (AC: #2, #3)
  - [x] Create `src-tauri/src/db/account.rs` with functions: `insert_account`, `get_all_accounts`, `get_account_by_id`
  - [x] Add Account struct to `src-tauri/src/models/mod.rs` with fields matching the table columns, derive `Serialize`, `Deserialize`
  - [x] Register module in `db/mod.rs`
- [x] Task 3: Implement Rust Tauri commands for accounts (AC: #2, #3, #6)
  - [x] Create `src-tauri/src/commands/account.rs` with commands: `create_account`, `get_accounts`
  - [x] `create_account` validates required fields (name, institution, account_type) and returns `Result<Account, AppError>`
  - [x] `get_accounts` returns `Result<Vec<Account>, AppError>`
  - [x] Register commands in `main.rs`
- [x] Task 4: Add TypeScript types for accounts (AC: #3)
  - [x] Add `Account` type to `src/lib/types.ts` mirroring the Rust struct (snake_case fields)
  - [x] Add query key `["accounts"]` to `src/lib/constants.ts`
- [x] Task 5: Create `useAccounts` hook (AC: #3, #8)
  - [x] Create `src/hooks/useAccounts.ts` with TanStack Query `useQuery` for `get_accounts`
  - [x] Add `useCreateAccount` mutation that calls `create_account` and invalidates `["accounts"]` on success
- [x] Task 6: Build AccountRow component (AC: #3)
  - [x] Create `src/components/accounts/AccountRow.tsx`
  - [x] Display account name (14px, font-weight 500), type + currency (12px, muted), balance (monospace, 14px, font-weight 500)
  - [x] Balance formatted via `formatCurrency()` utility from cents
  - [x] Negative balances displayed in rose color
- [x] Task 7: Build Add Account form (AC: #1, #6)
  - [x] Create `src/components/accounts/AddAccountForm.tsx` using React Hook Form
  - [x] Fields: name (text input), institution (text input), account_type (Select dropdown with options: chequing, savings, credit card, TFSA, RRSP, FHSA, non-registered, crypto), currency (Select: CAD, USD)
  - [x] Validation: name and institution required; show inline error messages below fields on blur
  - [x] Submit calls `useCreateAccount` mutation; show success toast on completion
- [x] Task 8: Build Accounts page route (AC: #1, #3, #4, #5, #7)
  - [x] Create or update `src/routes/accounts.tsx`
  - [x] Page header: "Accounts" title with "Add Account" button (triggers form display)
  - [x] List of AccountRow components from `useAccounts` query
  - [x] Empty state: "No accounts yet. Add your first account." with Add Account button
  - [x] Skeleton loading state while data fetches
- [x] Task 9: Write Playwright E2E tests (AC: #9)
  - [x] Create `tests/accounts.spec.ts`
  - [x] Test: Accounts page displays with "Add Account" button in page header
  - [x] Test: Clicking "Add Account" opens a form with name, institution, type, and currency fields
  - [x] Test: Submitting creates the account and it appears in the list with $0.00 balance
  - [x] Test: Account row shows name, type + currency (muted text), and balance in monospace
  - [x] Test: Success toast appears after adding an account
  - [x] Test: Empty state shows message and button when no accounts exist
  - [x] Run `npx playwright test tests/accounts.spec.ts` and confirm all tests pass

## Dev Notes

### Database Schema

```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Valid `account_type` values: `chequing`, `savings`, `credit_card`, `tfsa`, `rrsp`, `fhsa`, `non_registered`, `crypto`. Store as lowercase snake_case strings; display with proper labels in the UI (e.g., `credit_card` -> "Credit Card", `tfsa` -> "TFSA").

Valid `currency` values: `CAD`, `USD`.

### Rust Models

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub institution: String,
    pub account_type: String,
    pub currency: String,
    pub balance_cents: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAccountInput {
    pub name: String,
    pub institution: String,
    pub account_type: String,
    pub currency: String,
}
```

### Tauri Commands

- `create_account(input: CreateAccountInput) -> Result<Account, AppError>` — validates input, inserts into DB, returns created account
- `get_accounts() -> Result<Vec<Account>, AppError>` — returns all accounts ordered by name

### Frontend Components

- **AccountRow**: Shared component used by both Accounts page (this story) and Assets page (Story 4.3). For this story, only the accounts variant is needed. The inline-edit behavior is out of scope (Story 4.2).
- **AddAccountForm**: React Hook Form with shadcn Select, Input, and Button components. Opens inline or as a dialog — match the existing pattern from budget/expense forms if available.
- **Accounts page**: Uses PageHeader shared component with "Add Account" action.

### TanStack Query Keys

- `["accounts"]` — list all accounts

### Negative Balance Display

Credit card balances are typically negative (representing debt). Display negative amounts in rose color using Tailwind's `text-rose-500` class. The `formatCurrency()` utility should handle negative cents correctly (e.g., `-150000` -> `-$1,500.00`).

### Scope Boundaries

**In scope:** Migration, Rust CRUD (create + list), AccountRow component (display only), Add Account form, Accounts page route, Playwright tests.

**Out of scope (Story 4.2):** Inline balance editing, account detail editing, account deletion, audit log entries. The AccountRow hover-to-reveal edit actions are deferred to Story 4.2.

**Out of scope (Story 4.3):** Passive assets table and UI.

### Project Structure Notes

Files created or modified in this story:
- `src-tauri/migrations/NNN_accounts.sql` (new)
- `src-tauri/src/models/mod.rs` (add Account, CreateAccountInput structs)
- `src-tauri/src/db/account.rs` (new)
- `src-tauri/src/db/mod.rs` (register account module)
- `src-tauri/src/commands/account.rs` (new)
- `src-tauri/src/commands/mod.rs` (register account commands)
- `src-tauri/src/main.rs` (register commands)
- `src/lib/types.ts` (add Account type)
- `src/lib/constants.ts` (add query key)
- `src/hooks/useAccounts.ts` (new)
- `src/components/accounts/AccountRow.tsx` (new)
- `src/components/accounts/AddAccountForm.tsx` (new)
- `src/routes/accounts.tsx` (new or update)
- `tests/accounts.spec.ts` (new)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture, Rust Backend Organization, Frontend Organization]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — AccountRow (UX-DR8), Financial Inputs, Empty States, Page Header]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Playwright Cancel button click issue: `dispatchEvent("click")` needed instead of `.click()` due to base-ui Button component interaction with Playwright's mouse-based click mechanism.

### Completion Notes List
- Created `005_accounts.sql` migration with accounts table schema
- Implemented `db/account.rs` with `insert_account`, `get_all_accounts`, `get_account_by_id` functions with validation for account_type and currency
- Implemented `commands/account.rs` with `create_account` and `get_accounts` Tauri commands
- Added `Account` and `CreateAccountInput` models to Rust and TypeScript
- Created `useAccounts` and `useCreateAccount` TanStack Query hooks
- Built `AccountRow` component with name, type+currency (muted), monospace balance, rose color for negative
- Built `AddAccountForm` with React Hook Form, onBlur validation, type/currency selects
- Updated Accounts page route with PageHeader, form toggle, empty state, skeleton loading
- 10 Playwright E2E tests covering all acceptance criteria — all passing
- Full test suite: 56 tests, 0 regressions

### File List
- `src-tauri/migrations/005_accounts.sql` (new)
- `src-tauri/src/db/account.rs` (new)
- `src-tauri/src/db/mod.rs` (modified — added account module + migration)
- `src-tauri/src/models/mod.rs` (modified — added Account, CreateAccountInput)
- `src-tauri/src/commands/account.rs` (new)
- `src-tauri/src/commands/mod.rs` (modified — added account module)
- `src-tauri/src/lib.rs` (modified — registered account commands)
- `src/lib/types.ts` (modified — added Account, CreateAccountInput)
- `src/lib/constants.ts` (modified — added accounts query key)
- `src/hooks/useAccounts.ts` (new)
- `src/components/accounts/AccountRow.tsx` (new)
- `src/components/accounts/AddAccountForm.tsx` (new)
- `src/routes/accounts.tsx` (modified — full implementation)
- `tests/accounts.spec.ts` (new)
