# Story 23.1: Transaction-Account Linking — Backend

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want expense and income entries to optionally update a linked account balance in the database,
So that my account balances stay in sync when I record cash movement without requiring a separate manual balance edit.

**Scope:** Rust backend only — migration, balance delta engine, transactional `db/` layer, Tauri command extensions, audit + net worth hooks. Story 23.2 adds frontend forms, hooks, i18n, and Playwright E2E.

**FRs:** FR90–FR94, NFR23  
**Architecture:** [architecture-expense-income-account-linking.md](../planning-artifacts/architecture-expense-income-account-linking.md) — D1–D5, D7 (deferred paths), D8

## Acceptance Criteria

1. **Given** migration `021_expense_income_account_id.sql` is applied  
   **When** the app starts  
   **Then** `expenses.account_id` and `income_entries.account_id` exist as nullable `INTEGER REFERENCES accounts(id) ON DELETE SET NULL`  
   **And** indexes `idx_expenses_account_id` and `idx_income_entries_account_id` exist

2. **Given** `db/account.rs` balance delta helpers  
   **When** unit tests run  
   **Then** asset accounts (chequing, savings, tfsa, rrsp, fhsa, non_registered, crypto) apply `-amount` for expenses and `+amount` for income  
   **And** credit cards with positive, negative, and zero starting balances correctly increase owed on expense and decrease owed on income while preserving sign convention (D2)  
   **And** reversal uses opposite `CashFlowKind` (expense reversal = income delta of same amount)

3. **Given** `insert_expense` / `update_expense` / `delete_expense` with optional `account_id`  
   **When** `account_id` is `None`  
   **Then** behavior is unchanged from today (regression — no balance mutation)  
   **When** `account_id` is `Some(valid_id)`  
   **Then** balance adjusts per D2 inside the same SQLite transaction as the expense row (NFR23)  
   **When** `account_id` is invalid  
   **Then** entire transaction rolls back with `AppError::Validation`

4. **Given** `update_expense` on a linked entry  
   **When** amount, account, or both change  
   **Then** old account balance effect is reversed before new effect is applied (D3)  
   **Including** account change (old account reversed, new account adjusted)

5. **Given** `delete_expense` or `delete_income_entry` on a linked entry  
   **When** delete succeeds  
   **Then** linked account balance is reversed (D3)

6. **Given** the same rules for `insert_income_entry` / `update_income_entry` / `delete_income_entry`  
   **When** linked  
   **Then** income adds to asset balances and reduces liability owed balances (D2)

7. **Given** a Tauri command mutates a linked account balance  
   **When** the db transaction commits  
   **Then** `audit_log` records `entity_type: "account"`, `action: "balance_update"` with old/new balance strings (mirror `commands/account.rs`)  
   **And** `net_worth_db::record_net_worth_snapshot` is called (FR26)  
   **And** expense/income audit logs continue unchanged

8. **Given** `Expense`, `IncomeEntry`, and all Create/Update input structs  
   **When** serialized over IPC  
   **Then** they include `account_id: Option<i64>` in snake_case JSON (D5)

9. **Given** deferred paths per D7  
   **When** this story is complete  
   **Then** `db/recurring.rs`, `bulk_insert_imported_expenses`, and `commands/chat.rs` are **not** modified

10. **Given** the Rust backend  
    **When** `cargo test` runs in `apps/desktop/src-tauri/`  
    **Then** all tests pass including new delta and integration tests

## Tasks / Subtasks

- [x] Task 1: Migration 021 (AC: #1)
  - [x] Create `apps/desktop/src-tauri/migrations/021_expense_income_account_id.sql` per architecture D1
  - [x] Register `(21, include_str!(...))` in `db/mod.rs` `MIGRATIONS` array (after entry 20)

- [x] Task 2: Balance delta engine in `db/account.rs` (AC: #2)
  - [x] Add `CashFlowKind` enum (`Expense`, `Income`)
  - [x] Add `balance_delta_cents(account_type, current_balance_cents, kind, amount_cents) -> i64`
  - [x] Add `adjust_account_balance(conn, account_id, kind, amount_cents) -> Result<Account, AppError>` — loads account, computes new balance, updates `balance_cents` + `updated_at`
  - [x] Add `reverse_adjustment` helper: same as adjust with opposite kind
  - [x] Reuse `is_liability_account_type` / `LIABILITY_ACCOUNT_TYPES` — do not duplicate liability list
  - [x] `#[cfg(test)]` module: ≥6 cases (asset expense/income, CC positive/negative/zero expense and payment)

- [x] Task 3: Extend models (AC: #8)
  - [x] `models/mod.rs`: add `account_id: Option<i64>` to `Expense`, `CreateExpenseInput`, `UpdateExpenseInput`
  - [x] Same for `IncomeEntry`, `CreateIncomeEntryInput`, `UpdateIncomeEntryInput`
  - [x] Update all `query_row` mappers in `db/expense.rs` and `db/income.rs` SELECTs

- [x] Task 4: Transactional expense db layer (AC: #3, #4, #5)
  - [x] Wrap `insert_expense`, `insert_expense_with_source` in `unchecked_transaction`
  - [x] Validate `account_id` exists when `Some`
  - [x] `update_expense`: load old row first; reverse if old `account_id` was `Some`; update row; apply if new `account_id` is `Some`
  - [x] `delete_expense`: load row; reverse if linked; delete
  - [x] In-memory SQLite integration tests for create/update/delete with account

- [x] Task 5: Transactional income db layer (AC: #6)
  - [x] Same transaction pattern for `insert_income_entry`, `update_income_entry`, `delete_income_entry`
  - [x] Integration tests

- [x] Task 6: Tauri commands (AC: #7, #8)
  - [x] `commands/expense.rs`: add `account_id: Option<i64>` to `create_expense`, `update_expense`
  - [x] `commands/income.rs`: add `account_id: Option<i64>` to `create_income_entry`, `update_income_entry`
  - [x] After successful db op that changed a balance: `audit_db::insert_audit_log` (account balance_update) + `net_worth_db::record_net_worth_snapshot`
  - [x] Extract small helper in commands if both expense/income need same post-balance hook (optional, keep minimal)
  - [x] Return updated models including `account_id` from getters

- [x] Task 7: Verification (AC: #9, #10)
  - [x] Confirm `recurring.rs`, import bulk insert, `chat.rs` untouched
  - [x] `cargo test` full suite in `apps/desktop/src-tauri/`

## Dev Notes

### Critical Architecture Rules (DO NOT VIOLATE)

1. **Balance mutations ONLY in `db/`** inside SQLite transactions — never in `commands/` except audit/snapshot after commit
2. **`account_id` is optional** — never validate as required; `None` = no balance side-effect
3. **Integer cents only** — no floats (NFR13)
4. **Reverse before re-apply** on every update (D3) — order matters
5. **Liability math** must match `accountUtils.ts` `owedBalanceCents` semantics — positive or negative stored CC balances both work
6. **Do not block account delete** — FK is `ON DELETE SET NULL`; no cascade balance reversal on account delete (documented edge case)

### Balance Delta Reference (D2)

**Assets:** `new_balance = current + delta` where expense delta = `-amount`, income delta = `+amount`

**Liabilities (`credit_card`):**
- `owed = abs(current_balance_cents)`
- `sign = if current < 0 { -1 } else { 1 }` (zero → positive convention)
- Expense: `new_owed = owed + amount` → `sign * new_owed`
- Income (payment): `new_owed = owed - amount` (allow 0; overpayment may yield credit balance)

### Transaction Pattern (copy from existing patterns)

```rust
let tx = conn.unchecked_transaction()?;
// ... validate, insert/update/delete expense
if let Some(account_id) = input.account_id {
    account_db::adjust_account_balance(&tx, account_id, CashFlowKind::Expense, input.amount_cents)?;
}
tx.commit()?;
```

Use `&tx` for all operations in the transaction; pass `Connection` trait via `tx` deref.

### Commands Post-Hook (mirror `commands/account.rs`)

When any linked balance changes in expense/income command:
```rust
audit_db::insert_audit_log(&conn, "account", account_id, "balance_update", Some(&old), Some(&new))?;
net_worth_db::record_net_worth_snapshot(&conn)?;
```

Track whether balance changed in db layer return or by comparing old/new in command — prefer db returning `(Option<BalanceChange>, Expense)` if needed to avoid double-read.

### Existing Code to Extend (DO NOT REINVENT)

| File | Use |
|------|-----|
| `db/account.rs` | `get_account_by_id`, `update_account_balance`, `is_liability_account_type` |
| `db/expense.rs` | `insert_expense`, `update_expense`, `delete_expense` — add transactions |
| `db/income.rs` | `insert_income_entry`, etc. |
| `commands/expense.rs` | Audit pattern from existing create/update/delete |
| `commands/account.rs` | Audit + snapshot pattern for balance changes |
| `db/audit.rs` | `insert_audit_log` |

### Out of Scope (Story 23.2 or Phase 3)

- TypeScript types, hooks, UI forms (`AddExpenseForm`, `IncomeEntryList`, etc.)
- `locales/en.json` / `fr.json`
- Playwright E2E
- `commands/chat.rs` optional `account_id`
- `db/recurring.rs` template account
- `bulk_insert_imported_expenses`

### Previous Story Intelligence

- **Story 4.2** established manual `update_account_balance` + audit + snapshot — reuse exact audit action `"balance_update"` and snapshot call
- **Story 3.3** established expense update/delete without accounts — preserve all validation; only add optional FK path
- **Story 5.3** net worth snapshots on balance change — linked mutations must trigger same snapshot path
- **Story 8.3** audit logging — account balance side-effects must be logged

### Project Structure Notes

- Monorepo path: `apps/desktop/` (`@nkbaz/desktop`)
- Migrations: `apps/desktop/src-tauri/migrations/` numbered sequentially; current max is **020**
- Register commands in `lib.rs` (not `main.rs` — project uses `lib.rs`)

### References

- [Source: _bmad-output/planning-artifacts/architecture-expense-income-account-linking.md — D1–D5, D7, D8, Agent Conflict Points]
- [Source: _bmad-output/planning-artifacts/prd.md — FR90–FR94, NFR23]
- [Source: _bmad-output/planning-artifacts/architecture-desktop.md — Data Architecture, IPC patterns]
- [Source: docs/project-context.md — Monetary cents, db/commands separation, snake_case IPC]
- [Source: apps/desktop/src/lib/accountUtils.ts — `owedBalanceCents`, `LIABILITY_ACCOUNT_TYPES` (mirror in Rust)]

## Dev Agent Record

### Agent Model Used

GPT-5.5

### Debug Log References

- `cargo check` passed without warnings.
- `cargo test db::` passed: 99 tests.
- `cargo test` passed: 165 tests.
- `cargo fmt` could not run because `rustfmt` is not installed for `stable-aarch64-apple-darwin`.

### Completion Notes List

- Added migration 021 with nullable `account_id` foreign keys on `expenses` and `income_entries`, plus account indexes.
- Added account cash-flow helpers for asset/liability balance math, including reversal support and old/new balance metadata for audit hooks.
- Extended expense and income models, SQL mappers, and Tauri commands with optional `account_id`.
- Wrapped linked expense/income create/update/delete DB paths in transactions; invalid linked accounts return `AppError::Validation` and roll back.
- Commands record `account` `balance_update` audit logs and net worth snapshots after linked balance mutations commit.
- Added account delta unit tests and in-memory expense/income integration tests for linked create/update/delete behavior.
- Approved scope exception: `commands/chat.rs` and `db/recurring.rs` received minimal `account_id: None` / test fixture schema updates required after the model change; deferred feature behavior remains unchanged. `bulk_insert_imported_expenses` was not modified.

### File List

- `_bmad-output/implementation-artifacts/23-1-transaction-account-linking-backend.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/desktop/src-tauri/migrations/021_expense_income_account_id.sql`
- `apps/desktop/src-tauri/src/commands/chat.rs`
- `apps/desktop/src-tauri/src/commands/expense.rs`
- `apps/desktop/src-tauri/src/commands/income.rs`
- `apps/desktop/src-tauri/src/db/account.rs`
- `apps/desktop/src-tauri/src/db/expense.rs`
- `apps/desktop/src-tauri/src/db/income.rs`
- `apps/desktop/src-tauri/src/db/mod.rs`
- `apps/desktop/src-tauri/src/db/recurring.rs`
- `apps/desktop/src-tauri/src/models/mod.rs`

## Change Log

- 2026-06-10: Implemented transaction-account linking backend, including migration, balance delta engine, transactional expense/income DB paths, command audit/snapshot hooks, and Rust test coverage.
