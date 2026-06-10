---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-06-10'
scope: 'expense-income-account-linking'
parentDocument: architecture-desktop.md
inputDocuments:
  - prd.md
  - architecture-desktop.md
  - project-context.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-06-10'
featureRequest: 'Optional account selection on expense and income entry with automatic balance adjustment'
---

# Expense & Income Account Linking — Architecture Decision Document

_Scoped architecture addendum for optional account selection when recording expenses or income, with automatic account balance updates. Extends [architecture-desktop.md](architecture-desktop.md)._

---

## Executive Summary

**User intent:** When adding an expense or income entry, optionally choose which account the money came from or went to. If selected, the linked account balance updates automatically (subtract for expenses, add for income). Account selection is **optional** — existing flows without an account continue unchanged.

**Architecture verdict:** The current desktop stack **supports this feature** with a focused brownfield extension. No new dependencies, services, or IPC patterns are required. The gap is entirely in the **data model** (missing optional FK), **transactional balance logic** (not implemented), and **UI** (no account picker on expense/income forms).

**Readiness:** READY FOR IMPLEMENTATION (High confidence)

---

## Project Context Analysis

### Requirements Overview

This capability is an **enhancement** to existing MVP modules (Expense Tracking FR11–FR13, Income Tracking FR33–FR37, Multi-Account FR15–FR18). Formal requirements are captured in `prd.md` as **FR90–FR94** (Transaction-Account Linking) and **NFR23** (atomic balance adjustment).

**Functional behavior:**

| Action | `account_id` provided | `account_id` null |
|--------|----------------------|-------------------|
| Create expense | Subtract `amount_cents` from linked account (liability-aware) | Expense only; no balance change |
| Create income | Add `amount_cents` to linked account (liability-aware) | Income only; no balance change |
| Update entry | Reverse prior balance effect, apply new effect | Same as create semantics |
| Delete entry | Reverse prior balance effect | Delete only |

**Non-Functional Requirements (inherited):**

| NFR | Impact |
|-----|--------|
| NFR11 | Expense/income + balance change MUST be atomic (single SQLite transaction) |
| NFR13 | All amounts remain integer cents |
| NFR11 audit | Balance side-effects logged via existing `audit_log` on `account` entity |
| Net worth | `record_net_worth_snapshot` after any balance mutation (matches `update_account_balance`) |

### Current State Validation (Codebase Audit)

**What exists and aligns with architecture-desktop.md:**

| Layer | Current state | Supports feature? |
|-------|---------------|-------------------|
| `accounts` table | `balance_cents`, `account_type`, `currency` | Yes — target for deltas |
| `expenses` table | `merchant`, `amount_cents`, `budget_category_id`, `date`, `source` | Partial — **no `account_id`** |
| `income_entries` table | `source_id`, `amount_cents`, `date`, `month` | Partial — **no `account_id`** |
| `db/account.rs` | `update_account_balance`, `is_liability_account_type`, `LIABILITY_ACCOUNT_TYPES` | Yes — reuse liability rules |
| `accountUtils.ts` | `owedBalanceCents`, `isLiabilityAccountType`, `LIABILITY_ACCOUNT_TYPES` | Yes — mirror in Rust delta engine |
| Commands | `create_expense`, `update_expense`, `delete_expense`, `create_income_entry`, etc. | Partial — no account param, no balance side-effect |
| Frontend forms | `AddExpenseForm`, `AddIncomeEntryForm` | No account picker |
| AI chat | `create_expense` action | No `account_id` param |
| Recurring expenses | Auto-apply creates expenses via `CreateExpenseInput` | Works with `account_id: None` (deferred enhancement) |
| CC import | `bulk_insert_imported_expenses` | No account link (deferred) |

**Explicit architectural gap:** Expenses, income, and account balances are **decoupled**. PRD Journey 2 describes manual balance entry; this feature adds an **optional automated path** without removing manual `update_account_balance`.

**No conflicts with existing decisions:**

- Integer cents storage — preserved
- Rust validation as source of truth — preserved
- `db/` vs `commands/` separation — preserved
- Liability net-worth semantics (`ABS` owed) — must be respected in delta engine

### Cross-Cutting Concerns

1. **Atomicity** — Never insert expense and update balance in separate commits
2. **Reversibility** — Edit/delete must undo previous balance delta before applying new one
3. **Liability sign convention** — Credit cards accept positive or negative stored balances; delta engine must preserve sign convention (see D2)
4. **Investment account types** — TFSA/RRSP/FHSA/non_registered/crypto use same asset delta rules as chequing/savings
5. **Mixed currency** — No FX conversion (same limitation as net worth); linking USD account to CAD-denominated mental model is user responsibility; no currency validation in MVP
6. **Query invalidation** — Mutations must invalidate `["accounts"]`, `["net-worth"]`, `["dashboard"]` in addition to expense/income keys
7. **Double-counting risk** — Users who both manually update balances AND link entries will see drift; UX should clarify optional nature (D6)

---

## Core Architectural Decisions

### D1: Optional FK on both transaction tables

**Decision:** Add nullable `account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL` to `expenses` and `income_entries`.

**Rationale:** Nullable FK is the minimal schema change. `ON DELETE SET NULL` avoids blocking account deletion; historical entries remain, balance is not auto-reversed on account delete (documented edge case in D7).

**Migration:** `021_expense_income_account_id.sql` (next after `020_maintenance_custom_tasks.sql`)

```sql
ALTER TABLE expenses ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE income_entries ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_expenses_account_id ON expenses(account_id);
CREATE INDEX idx_income_entries_account_id ON income_entries(account_id);
```

**Alternatives rejected:**

- Separate `account_transactions` ledger table — over-engineered for MVP; doubles query complexity
- Required `account_id` — contradicts user requirement

### D2: Centralized balance delta engine in `db/account.rs`

**Decision:** Add pure functions in `db/account.rs` (or new `db/account_balance.rs` if file grows):

```rust
pub enum CashFlowKind {
    Expense,
    Income,
}

/// Returns signed delta to apply to balance_cents (not the new balance).
pub fn balance_delta_cents(account_type: &str, current_balance_cents: i64, kind: CashFlowKind, amount_cents: i64) -> i64;

/// Applies delta inside an existing connection/transaction; returns updated Account.
pub fn adjust_account_balance(conn: &Connection, account_id: i64, kind: CashFlowKind, amount_cents: i64) -> Result<Account, AppError>;
```

**Asset accounts** (chequing, savings, tfsa, rrsp, fhsa, non_registered, crypto):

| Kind | Delta |
|------|-------|
| Expense | `-amount_cents` |
| Income | `+amount_cents` |

**Liability accounts** (`credit_card` per `LIABILITY_ACCOUNT_TYPES`):

Uses `owed = abs(current_balance_cents)` and preserves sign:

| Kind | New owed | New balance |
|------|----------|-------------|
| Expense (charge) | `owed + amount` | `sign * new_owed` where `sign = if current < 0 { -1 } else { 1 }` |
| Income (payment) | `owed - amount` (allow 0 or credit/overpayment via negative stored balance) | `sign * new_owed` after payment; if `new_owed == 0`, store `0` |

**Rationale:** Single implementation prevents inconsistent liability handling across expense/income/edit/delete. Unit tests required for positive/negative/zero CC balances.

### D3: Transactional orchestration in `db/expense.rs` and `db/income.rs`

**Decision:** Balance side-effects live in `db/` layer, not `commands/`.

**Create flow:**

1. `BEGIN` transaction
2. Validate `account_id` exists if `Some`
3. `INSERT` expense/income row
4. If `account_id` is `Some`, call `adjust_account_balance`
5. `COMMIT`

**Update flow:**

1. `BEGIN`
2. Load old row (including old `account_id`, `amount_cents`)
3. If old `account_id` was `Some`, **reverse** old effect (`Expense` reversal = apply `Income` delta of old amount, and vice versa)
4. `UPDATE` row with new fields
5. If new `account_id` is `Some`, apply new effect
6. `COMMIT`

**Delete flow:**

1. `BEGIN`
2. Load row
3. If `account_id` was `Some`, reverse effect
4. `DELETE`
5. `COMMIT`

**Rationale:** Matches architecture-desktop rule: SQL in `db/`, commands orchestrate audit + net worth snapshot.

### D4: IPC command signature extension

**Decision:** Add optional `account_id: Option<i64>` to Tauri commands (serde default `None` for backward compatibility):

| Command | New parameter |
|---------|---------------|
| `create_expense` | `account_id: Option<i64>` |
| `update_expense` | `account_id: Option<i64>` |
| `create_income_entry` | `account_id: Option<i64>` |
| `update_income_entry` | `account_id: Option<i64>` |

`get_expenses`, `get_income_entries*` return `account_id: Option<i64>` on models.

**Commands layer additions after db success:**

- `audit_log` for expense/income (unchanged)
- `audit_log` for account `balance_update` when balance adjusted (mirror `commands/account.rs`)
- `net_worth_db::record_net_worth_snapshot` when balance adjusted

### D5: Model updates (Rust + TypeScript)

**Rust** (`models/mod.rs`):

- `Expense`, `IncomeEntry`: add `account_id: Option<i64>`
- `CreateExpenseInput`, `UpdateExpenseInput`: add `account_id: Option<i64>`
- `CreateIncomeEntryInput`, `UpdateIncomeEntryInput`: add `account_id: Option<i64>`

**TypeScript** (`src/lib/types.ts`): mirror fields on same structs.

### D6: Frontend optional account picker

**Decision:** Add optional `Select` to `AddExpenseForm`, `AddIncomeEntryForm`, and inline edit UI in `ExpenseList` / `IncomeEntryList`.

**UX rules:**

- Label: "Account (optional)" with i18n keys `expenses.accountOptional`, `income.accountOptional`
- Placeholder: "None" / `common.none`
- Data source: `useAccounts()` — show all accounts grouped by asset/liability (reuse `groupAccountsBySection`)
- Display: `{name} — {institution}` with type icon
- No validation required when empty
- Help text (tooltip or description): linking auto-updates balance; manual balance edits still available

**Query invalidation** (`useCreateExpense`, `useUpdateExpense`, `useDeleteExpense`, income hooks):

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
queryClient.invalidateQueries({ queryKey: queryKeys.netWorth });
queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
```

### D7: Deferred / out-of-scope for first story

| Area | Decision |
|------|----------|
| Recurring expense templates | No `account_id` on template in MVP; auto-applied expenses remain unlinked |
| CC import bulk insert | Imported expenses remain unlinked |
| AI chat `create_expense` | Optional `account_id` in params — second story or same story if small |
| Account delete with linked entries | `ON DELETE SET NULL`; entries keep history, no automatic balance reversal |
| Currency mismatch guard | Not enforced (consistent with mixed-currency net worth) |
| Transfer between two accounts | Out of scope — would need two-legged transaction |

### D8: Testing strategy

| Test type | Location | Coverage |
|-----------|----------|----------|
| Rust unit | `db/account.rs` or `account_balance.rs` | Delta math: asset expense/income; CC positive/negative/zero balance |
| Rust integration | `db/expense.rs`, `db/income.rs` tests | Create/update/delete with account; verify balance + rollback on validation failure |
| Frontend | Component tests optional | Account select renders, submits `null` when unset |
| Playwright | `tests/expenses.spec.ts`, income spec | E2E: create expense with account → accounts page shows reduced balance |

---

## Project Structure & Implementation Map

### Files to CREATE

| File | Purpose |
|------|---------|
| `migrations/021_expense_income_account_id.sql` | Schema |

### Files to MODIFY

**Rust backend:**

| File | Changes |
|------|---------|
| `db/mod.rs` | Register migration 021 |
| `db/account.rs` | `balance_delta_cents`, `adjust_account_balance`, `reverse_adjustment` helper |
| `db/expense.rs` | Transactional create/update/delete with optional account; extend SELECTs |
| `db/income.rs` | Same |
| `models/mod.rs` | Optional `account_id` on structs |
| `commands/expense.rs` | Pass `account_id`; net worth + account audit on balance change |
| `commands/income.rs` | Same |
| `commands/chat.rs` | Optional `account_id` in `create_expense` params (if in scope) |

**Frontend:**

| File | Changes |
|------|---------|
| `lib/types.ts` | Optional `account_id` fields |
| `hooks/useExpenses.ts` | Pass `account_id`; invalidate accounts/net-worth/dashboard |
| `hooks/useIncome.ts` | Same |
| `components/expenses/AddExpenseForm.tsx` | Optional account `Select` |
| `components/income/AddIncomeEntryForm.tsx` | Optional account `Select` |
| `components/expenses/ExpenseList.tsx` | Show/edit linked account in inline edit |
| `components/income/IncomeEntryList.tsx` | Same |
| `locales/en.json`, `locales/fr.json` | i18n keys |

**Tests:**

| File | Changes |
|------|---------|
| `src-tauri/src/db/account.rs` (tests) | Delta engine cases |
| `tests/expenses.spec.ts` | E2E with account link |

### Files explicitly NOT modified (first story)

- `db/recurring.rs` — templates unchanged
- `db/net_worth.rs` — calculation logic unchanged (reads balances)
- `bulk_insert_imported_expenses` — import path unchanged
- Web app (`apps/web`) — desktop-only feature

### Requirements → Structure Mapping

| User requirement | Primary implementation |
|------------------|------------------------|
| Optional account on expense | D1, D5, D6, `insert_expense` |
| Optional account on income | D1, D5, D6, `insert_income_entry` |
| Auto subtract on expense | D2, D3, `CashFlowKind::Expense` |
| Auto add on income | D2, D3, `CashFlowKind::Income` |
| Edit reverses old / applies new | D3 update flow |
| Delete reverses | D3 delete flow |
| Not mandatory | Nullable FK + optional UI |

---

## Architecture Validation Results

### Coherence Validation ✅

- **Stack compatibility:** SQLite transactions + existing account module — no new tech
- **Pattern consistency:** Follows car-maintenance / financial-health addendum pattern (migration → db → commands → hooks → forms)
- **Liability alignment:** Reuses `LIABILITY_ACCOUNT_TYPES` and `owedBalanceCents` semantics from `architecture-financial-decision-intelligence.md`

### Gap Analysis

| Gap | Severity | Resolution |
|-----|----------|------------|
| No PRD FR | Low | PM can add FR; architecture sufficient for dev story |
| No UX spec section | Low | D6 defines minimal UX; optional UX workflow for polish |
| Recurring/import unlinked | Low | Deferred per D7 |
| Account delete leaves stale balance | Medium | Documented; acceptable for MVP (`ON DELETE SET NULL`) |
| User double-counting (manual + linked) | Medium | D6 help text; not a code bug |

**Critical gaps:** None blocking implementation.

### Agent Conflict Points (enforce in dev story)

1. **DO NOT** update balance in `commands/` — only in `db/` inside transactions
2. **DO NOT** use floating point for deltas
3. **DO NOT** make `account_id` required in validation
4. **DO** reverse old balance effect before applying new on update
5. **DO** call `record_net_worth_snapshot` after balance mutations (same as `update_account_balance`)
6. **DO** write account `balance_update` audit log when auto-adjusting
7. **DO** unit test credit card with positive, negative, and zero starting balances
8. **DO** invalidate `accounts`, `net-worth`, and `dashboard` query keys on mutation success

### Overall Status

**READY FOR IMPLEMENTATION** — High confidence

---

## Implementation Handoff (Dev Agent Checklist)

Execute in this order:

### Story 1 — Backend foundation

1. Add migration `021_expense_income_account_id.sql` and register in `db/mod.rs`
2. Implement `balance_delta_cents` + `adjust_account_balance` with unit tests
3. Extend `CreateExpenseInput` / `UpdateExpenseInput` / income equivalents + `Expense` / `IncomeEntry` models
4. Refactor `insert_expense`, `update_expense`, `delete_expense` for transactional account linking
5. Same for `insert_income_entry`, `update_income_entry`, `delete_income_entry`
6. Extend Tauri commands + audit + net worth snapshot hooks
7. Run `cargo test` in `apps/desktop/src-tauri`

### Story 2 — Frontend

1. Update `src/lib/types.ts`
2. Extend hooks to pass `account_id` and invalidate account/net-worth queries
3. Add optional account `Select` to add/edit forms (grouped asset/liability)
4. Display linked account name in expense/income lists (optional column or subtitle)
5. Add EN/FR i18n strings
6. Run desktop unit tests + Playwright expense flow

### Story 3 — Optional follow-ups

1. AI chat `create_expense` + `create_income_entry` with optional `account_id`
2. Recurring template `account_id` + propagate on auto-apply
3. PRD FR update + implementation story in `_bmad-output/implementation-artifacts/`

### Acceptance criteria (for QA / dev agent)

- [ ] Expense without account: balance unchanged (regression)
- [ ] Expense with chequing account: balance decreases by amount
- [ ] Income with chequing account: balance increases by amount
- [ ] Expense charged to credit card (positive owed balance): owed increases
- [ ] Payment income to credit card: owed decreases
- [ ] Edit expense amount with same account: net balance reflects delta only
- [ ] Change linked account on edit: old account reversed, new account adjusted
- [ ] Remove account link on edit: reversal only, no new adjustment
- [ ] Delete linked entry: balance restored
- [ ] Net worth snapshot recorded after linked mutations
- [ ] Account audit log entry on auto balance change

---

## Reference: Current vs Target Data Model

```
CURRENT                          TARGET
───────                          ──────
expenses                         expenses
  id                               id
  merchant                         merchant
  amount_cents                     amount_cents
  budget_category_id               budget_category_id
  date                             date
  source                           source
  created_at                       account_id  ← NEW nullable FK
                                   created_at

income_entries                   income_entries
  id                               id
  source_id                        source_id
  amount_cents                     amount_cents
  date                             date
  month                            month
  created_at                       account_id  ← NEW nullable FK
  updated_at                       created_at
                                   updated_at

accounts (unchanged)             accounts
  balance_cents ← adjusted         balance_cents
```

---

_Linked from [architecture-desktop.md](architecture-desktop.md) module addenda._
