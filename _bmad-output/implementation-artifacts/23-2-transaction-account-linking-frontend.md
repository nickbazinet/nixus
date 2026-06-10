# Story 23.2: Transaction-Account Linking — Frontend

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to optionally select an account when adding or editing an expense or income entry,
So that the linked account balance updates automatically without a separate trip to the Accounts page.

**Scope:** TypeScript types, TanStack Query hooks, optional account picker on add/edit forms, list display of linked account, i18n (EN/FR), query invalidation, Playwright E2E. **Requires Story 23.1 complete** (backend `account_id` IPC support).

**FRs:** FR90, FR12, FR35, FR91–FR94  
**Architecture:** [architecture-expense-income-account-linking.md](../planning-artifacts/architecture-expense-income-account-linking.md) — D5, D6, D8

## Acceptance Criteria

1. **Given** `src/lib/types.ts`  
   **When** expense/income types load  
   **Then** `Expense`, `IncomeEntry`, `CreateExpenseInput`, `UpdateExpenseInput`, `CreateIncomeEntryInput`, `UpdateIncomeEntryInput` include `account_id?: number | null`

2. **Given** `AddExpenseForm` and inline `EditExpenseForm` in `ExpenseList.tsx`  
   **When** the form renders  
   **Then** an optional Account `Select` appears labeled via `expenses.accountOptional`  
   **And** placeholder uses `common.none` when unset  
   **And** accounts load from `useAccounts()` grouped by asset/liability via `groupAccountsBySection` from `@/lib/accountUtils`  
   **And** each option shows `{name} — {institution}`  
   **And** no validation error when account is empty  
   **And** submit passes `account_id: null` or numeric id to `create_expense` / `update_expense`

3. **Given** `AddIncomeEntryForm` and inline `EditIncomeEntryForm` in `IncomeEntryList.tsx`  
   **When** the form renders  
   **Then** same optional account picker pattern with `income.accountOptional` i18n key

4. **Given** expense or income list rows  
   **When** an entry has `account_id` set  
   **Then** linked account name is visible (subtitle or column) resolved from accounts query or optional `account_name` if backend adds it — prefer client-side lookup via `useAccounts()` map by id

5. **Given** a successful expense or income mutation that linked an account  
   **When** mutation completes  
   **Then** hooks invalidate: `queryKeys.expenses` / income keys (existing), plus `queryKeys.accounts`, `queryKeys.netWorthCurrent`, `queryKeys.netWorthSnapshotsRecent`, `queryKeys.financialHealth`, and dashboard-related keys (`budgetSummary`, `topBudgetCategories` as applicable)

6. **Given** help text per D6  
   **When** account field is shown  
   **Then** brief description under select: `expenses.accountLinkHelp` / `income.accountLinkHelp` explaining auto balance update and that manual balance edit remains available

7. **Given** i18n  
   **When** user switches EN/FR  
   **Then** new keys exist in `apps/desktop/src/locales/en.json` and `fr.json` with no missing keys (NFR16)

8. **Given** Playwright  
   **When** `npx playwright test tests/expenses.spec.ts` runs  
   **Then** new test passes: create expense with linked chequing account → accounts page shows balance decreased by expense amount  
   **And** regression test: expense without account leaves balance unchanged

9. **Given** Story 23.1 not merged  
   **When** frontend invokes IPC with `account_id`  
   **Then** implementation assumes backend accepts optional param — do not ship 23.2 before 23.1

## Tasks / Subtasks

- [x] Task 1: TypeScript types (AC: #1)
  - [x] Update `apps/desktop/src/lib/types.ts` — optional `account_id` on expense/income structs

- [x] Task 2: Expense hooks (AC: #5)
  - [x] `useExpenses.ts`: pass `account_id` in `useCreateExpense`, `useUpdateExpense` invoke payloads
  - [x] On success: invalidate `queryKeys.accounts`, `queryKeys.netWorthCurrent`, `queryKeys.netWorthSnapshotsRecent`, `queryKeys.financialHealth`, existing expense/budget keys
  - [x] Same invalidation on `useDeleteExpense` when linked entry deleted

- [x] Task 3: Income hooks (AC: #5)
  - [x] `useIncome.ts`: pass `account_id` in create/update mutations
  - [x] Extend invalidation set to match expense hooks

- [x] Task 4: Shared account select pattern (AC: #2, #3)
  - [x] Create `apps/desktop/src/components/shared/OptionalAccountSelect.tsx` OR inline in forms — prefer small shared component if duplication > 2 forms
  - [x] Props: `value: string` ("" = none), `onChange`, `id`, `labelKey`, `helpKey`
  - [x] Uses `useAccounts()` + `groupAccountsBySection` + `Select` with `SelectGroup` for asset/liability sections

- [x] Task 5: Expense forms (AC: #2, #4, #6)
  - [x] `AddExpenseForm.tsx`: add optional account field; default `account_id` empty
  - [x] `ExpenseList.tsx` `EditExpenseForm`: pre-fill `account_id` from `expense.account_id`
  - [x] List row: show linked account name when set

- [x] Task 6: Income forms (AC: #3, #4, #6)
  - [x] `AddIncomeEntryForm.tsx`: optional account field
  - [x] `IncomeEntryList.tsx` `EditIncomeEntryForm`: pre-fill account
  - [x] List row: show linked account name when set

- [x] Task 7: i18n (AC: #7)
  - [x] `en.json`: `expenses.accountOptional`, `expenses.accountLinkHelp`, `income.accountOptional`, `income.accountLinkHelp`, `common.none` (if missing)
  - [x] `fr.json`: French equivalents

- [x] Task 8: Playwright E2E (AC: #8)
  - [x] Extend `tests/expenses.spec.ts` with account linking scenario
  - [x] Mock or seed accounts + create expense with account selected → verify balance on accounts route
  - [x] Follow existing test patterns in `tests/expenses.spec.ts` and `tests/accounts.spec.ts`

## Dev Notes

### Critical Rules

1. **Optional field** — empty string / null → omit or pass `null` for `account_id`; never block submit
2. **Invalidate accounts + net worth** after mutations — dashboard and accounts page go stale otherwise (D6)
3. **Reuse `groupAccountsBySection`** from `accountUtils.ts` — do not rebuild account grouping
4. **Do not modify** `db/recurring.rs`, import flow, or `chat.rs` (D7)
5. **Edit forms live inline** in `ExpenseList.tsx` / `IncomeEntryList.tsx` — no separate `EditExpenseForm.tsx` file exists

### Hook Invalidation Checklist

After create/update/delete expense or income:
```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
// keep existing expense/income/budget invalidations
```

### IPC Payload Example

```typescript
invoke("create_expense", {
  merchant: data.merchant,
  amount_cents: data.amount_cents,
  budget_category_id: data.budget_category_id,
  date: data.date,
  account_id: data.account_id ?? null,
});
```

### UX (D6 — no separate UX spec)

- Label: "Account (optional)"
- Help: "Linking an account automatically updates its balance. You can still edit balances manually on the Accounts page."
- Account select is **below** category (expense) or source (income), above date — consistent field order

### Forms to Touch

| Component | Change |
|-----------|--------|
| `components/expenses/AddExpenseForm.tsx` | Optional account select |
| `components/expenses/ExpenseList.tsx` | Edit form + row display |
| `components/income/AddIncomeEntryForm.tsx` | Optional account select |
| `components/income/IncomeEntryList.tsx` | Edit form + row display |
| `hooks/useExpenses.ts` | IPC + invalidation |
| `hooks/useIncome.ts` | IPC + invalidation |
| `lib/types.ts` | `account_id` fields |

### Out of Scope

- AI chat `account_id` param (Phase 3)
- Recurring expense template account
- CC import account assignment
- New Rust/backend work (Story 23.1)

### Dependency

**Blocked by:** Story 23.1 (`23-1-transaction-account-linking-backend.md`) — must be `review` or `done` before IPC calls succeed.

### References

- [Source: _bmad-output/implementation-artifacts/23-1-transaction-account-linking-backend.md]
- [Source: _bmad-output/planning-artifacts/architecture-expense-income-account-linking.md — D5, D6]
- [Source: _bmad-output/implementation-artifacts/3-1-manually-add-an-expense.md — form patterns]
- [Source: _bmad-output/implementation-artifacts/3-3-edit-and-delete-expenses.md — inline edit in ExpenseList]
- [Source: _bmad-output/implementation-artifacts/4-2-edit-remove-update-account-balances.md — accounts hooks]
- [Source: apps/desktop/src/lib/constants.ts — `queryKeys`]
- [Source: apps/desktop/src/lib/accountUtils.ts — `groupAccountsBySection`]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright account-linking test initially used `page.goto("/accounts")` which full-reloads the app and resets in-memory mock state; fixed by navigating via Finance sidebar link (SPA navigation).

### Completion Notes List

- Added optional `account_id` to expense/income TypeScript types and IPC payloads.
- Created shared `OptionalAccountSelect` with asset/liability grouping via `groupAccountsBySection`.
- Wired optional account field into add/edit expense and income forms; list rows show linked account name.
- Extended mutation invalidation to accounts, net worth, financial health, and dashboard budget keys.
- Added EN/FR i18n keys for account optional label, help text, and `common.none`.
- Extended `expenses.spec.ts` mock with persistent account state and two E2E tests for linked vs unlinked expenses.
- Verified: `tsc --noEmit` clean; `playwright test tests/expenses.spec.ts` — 18 passed.

### File List

- apps/desktop/src/lib/types.ts
- apps/desktop/src/hooks/useExpenses.ts
- apps/desktop/src/hooks/useIncome.ts
- apps/desktop/src/components/shared/OptionalAccountSelect.tsx
- apps/desktop/src/components/expenses/AddExpenseForm.tsx
- apps/desktop/src/components/expenses/ExpenseList.tsx
- apps/desktop/src/components/income/AddIncomeEntryForm.tsx
- apps/desktop/src/components/income/IncomeEntryList.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/expenses.spec.ts
