---
title: 'Dashboard Last Expense Line'
slug: 'dashboard-last-expense-line'
created: '2026-07-26'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'Tauri 2 + React 19 + TanStack Query/Router'
  - 'Rust SQLite (rusqlite) — expenses table'
  - 'i18next EN/FR'
  - 'useFormatCurrency (cents)'
files_to_modify:
  - 'apps/desktop/src-tauri/src/db/expense.rs'
  - 'apps/desktop/src-tauri/src/commands/expense.rs'
  - 'apps/desktop/src-tauri/src/lib.rs'
  - 'apps/desktop/src/lib/constants.ts'
  - 'apps/desktop/src/hooks/useExpenses.ts'
  - 'apps/desktop/src/components/dashboard/LastExpenseLine.tsx (create)'
  - 'apps/desktop/src/routes/index.tsx'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/dashboard.spec.ts'
code_patterns:
  - 'commands/ thin → db/ SQL; register in lib.rs'
  - 'TanStack Query + invoke() snake_case; money in cents'
  - 'query key under expenses prefix so existing invalidations refresh'
  - 'Muted text whisper under PageHeader — no Card'
  - 'i18n interpolation {{date}} {{merchant}} {{amount}}'
test_patterns:
  - 'Playwright E2E only (desktop) — extend dashboard.spec.ts mocks'
  - 'data-testid=last-expense-line'
  - 'Mock get_latest_expense in setupEmpty/SeededDashboardMock'
---

# Tech-Spec: Dashboard Last Expense Line

**Created:** 2026-07-26

## Overview

### Problem Statement

The finance dashboard shows aggregates (cash flow, budget, spending) but not the most recent individual spend, so the user cannot glance at “what did I just buy?” without leaving the page for the expenses list.

### Solution

Add a small display-only muted text line on the desktop finance dashboard (between PageHeader and Cash Flow) showing the globally latest expense by date: date + merchant name + cost. When there are no expenses, show “No expenses yet.”

### Scope

**In Scope:**
- Desktop app (`apps/desktop`) finance dashboard route (`/`) only
- Single latest expense across all months (order by date descending; id as tiebreaker)
- Display: date + merchant name only + amount (cents formatted via existing currency helper)
- Empty state copy: “No expenses yet”
- Display-only (no click, navigation, or interaction)
- Placement: muted `text-sm text-muted-foreground` line between `PageHeader` and Cash Flow card (no new card)

**Out of Scope:**
- Web app, chat surfaces, car/maintenance dashboard
- Category, notes, description, or multi-item recent list
- Click-through / deep links to expenses
- Filtering this line by the dashboard month navigator
- Nesting inside Cash Flow (would imply month-scoped “last expense”)
- Recurring-template “virtual” expenses (unless they already exist as real expense rows)

## Context for Development

### Codebase Patterns

- **Stack:** Tauri 2 IPC, React 19, TanStack Query/Router, i18next EN/FR, money as integer cents.
- **Dashboard:** `routes/index.tsx` — PageHeader → Cash Flow → YTD → heroes… Insert whisper after PageHeader, before Cash Flow `div.mb-4`.
- **Expenses today:** `get_expenses(year, month)` → `expense_db::get_expenses_by_month` (`ORDER BY date DESC, created_at DESC`). No global “latest” query yet. Model: `Expense { id, merchant, amount_cents, budget_category_id, account_id, date, source, created_at }`.
- **Commands:** Thin orchestration in `commands/expense.rs`; SQL only in `db/expense.rs`; register in `lib.rs`.
- **Hooks:** `useExpenses.ts` owns expense queries/mutations; `invalidateExpenseMutationQueries` invalidates `queryKeys.expenses` (`["expenses"]`). Import confirm + recurring apply also invalidate `["expenses"]`.
- **Date display precedent:** `ExpenseList.formatShortDate` — `toLocaleDateString` month short + day (no year). For global last expense, prefer **short date including year** (e.g. `Jul 24, 2026`) so cross-year spends stay unambiguous.
- **i18n:** Do **not** reuse `dashboard.noExpenses` (“No expenses yet. Import your first CC statement.”) — that string is for the spending empty CTA. Add dedicated keys.
- **project-context:** cents only; snake_case invoke; db/ only for SQL; query keys in `constants.ts`; Playwright-only desktop tests; all user strings via i18n (EN + FR).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src/routes/index.tsx` | Insert point after PageHeader |
| `apps/desktop/src/hooks/useDashboard.ts` | Dashboard query style (month-scoped) |
| `apps/desktop/src/hooks/useExpenses.ts` | Expense hooks + invalidation; add `useLatestExpense` |
| `apps/desktop/src/lib/constants.ts` | Add `latestExpense` under expenses prefix |
| `apps/desktop/src-tauri/src/db/expense.rs` | Add `get_latest_expense`; reuse `row_to_expense` |
| `apps/desktop/src-tauri/src/commands/expense.rs` | Add `get_latest_expense` command |
| `apps/desktop/src-tauri/src/lib.rs` | Register command |
| `apps/desktop/src/components/expenses/ExpenseList.tsx` | `formatShortDate` precedent |
| `apps/desktop/src/locales/en.json` / `fr.json` | New dashboard strings |
| `apps/desktop/tests/dashboard.spec.ts` | Extend invoke mocks + assertions |
| `docs/project-context.md` | Mandatory implementation rules |

### Technical Decisions

- **Recency SQL:** `ORDER BY date DESC, id DESC LIMIT 1` (global; ignore month navigator). Prefer `id` over `created_at` for tiebreak (stable, matches income list pattern).
- **API:** New Tauri command `get_latest_expense` → `Result<Option<Expense>, AppError>` (JSON `null` when empty).
- **Query key:** `queryKeys.latestExpense = ["expenses", "latest"]` so existing `invalidateQueries({ queryKey: queryKeys.expenses })` / import / recurring paths refresh without extra wiring.
- **Hook:** `useLatestExpense()` in `useExpenses.ts` → `invoke<Expense | null>("get_latest_expense")`.
- **UI component:** New `LastExpenseLine.tsx` under `components/dashboard/` — muted `text-sm text-muted-foreground`, `data-testid="last-expense-line"`, no Card/Link. Compose in `index.tsx` between PageHeader and Cash Flow.
- **Copy (i18n):**
  - `dashboard.lastExpense`: `Last expense: {{date}} · {{merchant}} · {{amount}}`
  - `dashboard.noExpensesYet`: `No expenses yet`
  - FR equivalents required.
- **Loading:** While `isPending`, render a short muted pulse placeholder (same test id); when settled `null` → empty copy; when data → interpolated line. Do not flash empty copy before fetch completes.
- **Amount:** `useFormatCurrency()(amount_cents)` — never format in Rust.
- **Date format:** Locale-aware short with year (`month: "short", day: "numeric", year: "numeric"`), using active i18n language (`i18n.language`) for `toLocaleDateString`.
- **UX placement (accepted, Party Mode):** Under header, above Cash Flow — not inside Cash Flow.

## Implementation Plan

### Tasks

- [ ] Task 1: Add DB query for latest expense
  - File: `apps/desktop/src-tauri/src/db/expense.rs`
  - Action: Add `pub fn get_latest_expense(conn: &Connection) -> Result<Option<Expense>, AppError>` selecting `id, merchant, amount_cents, budget_category_id, account_id, date, source, created_at` with `ORDER BY date DESC, id DESC LIMIT 1`, mapping via `row_to_expense`. Return `Ok(None)` when no rows (use `query_row` + `optional()` or equivalent).
  - Notes: No month filter. SQL lives only in `db/`.

- [ ] Task 2: Expose Tauri command and register it
  - Files: `apps/desktop/src-tauri/src/commands/expense.rs`, `apps/desktop/src-tauri/src/lib.rs`
  - Action: Add `#[tauri::command(rename_all = "snake_case")] pub fn get_latest_expense(state: State<DbState>) -> Result<Option<Expense>, AppError>` that locks `DbState` and calls `expense_db::get_latest_expense`. Register `commands::expense::get_latest_expense` in `lib.rs` invoke handler next to other expense commands.
  - Notes: No audit log (read-only).

- [ ] Task 3: Add query key + `useLatestExpense` hook
  - Files: `apps/desktop/src/lib/constants.ts`, `apps/desktop/src/hooks/useExpenses.ts`
  - Action: Add `latestExpense: ["expenses", "latest"] as const` to `queryKeys`. Export `useLatestExpense()` with `queryKey: queryKeys.latestExpense` and `queryFn: () => invoke<Expense | null>("get_latest_expense")`.
  - Notes: Prefix `["expenses", …]` ensures existing expense/import/recurring invalidations refresh this query — do not add a separate invalidate unless something invalidates without the expenses prefix.

- [ ] Task 4: Add i18n strings (EN + FR)
  - Files: `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`
  - Action: Add `dashboard.lastExpense` (`Last expense: {{date}} · {{merchant}} · {{amount}}` / FR equivalent) and `dashboard.noExpensesYet` (`No expenses yet` / `Aucune dépense pour le moment` or natural FR without the import CTA). Do **not** change existing `dashboard.noExpenses`.
  - Notes: All user-visible copy must go through i18n.

- [ ] Task 5: Create `LastExpenseLine` component
  - File: `apps/desktop/src/components/dashboard/LastExpenseLine.tsx` (create)
  - Action: Build display-only component using `useLatestExpense`, `useFormatCurrency`, `useTranslation` (+ `i18n.language` for date). Classes: `text-sm text-muted-foreground` (plus light bottom margin e.g. `mb-3`). `data-testid="last-expense-line"`. States: pending → muted pulse bar; `data == null` → `t("dashboard.noExpensesYet")`; else → `t("dashboard.lastExpense", { date, merchant, amount })` with date formatted via `toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })` from ISO `yyyy-MM-dd` (parse year/month/day parts — avoid UTC off-by-one). No Card, Link, button, or onClick.
  - Notes: Merchant rendered as stored (no truncation required for MVP).

- [ ] Task 6: Mount on finance dashboard
  - File: `apps/desktop/src/routes/index.tsx`
  - Action: Import `LastExpenseLine` and render it immediately after `<PageHeader … />` and before the Cash Flow card block. Do not pass month navigator props (global query).
  - Notes: Placement is a fixed UX decision — do not nest under Cash Flow.

- [ ] Task 7: Extend dashboard Playwright coverage
  - File: `apps/desktop/tests/dashboard.spec.ts`
  - Action: In `setupEmptyDashboardMock`, mock `get_latest_expense` → `null`. In `setupSeededDashboardMock` (and any other dashboard invoke switches), return a sample expense e.g. `{ id: 99, merchant: "Costco", amount_cents: 4500, budget_category_id: 1, account_id: null, date: "2026-03-20", source: "manual", created_at: "…" }`. Add tests: empty dashboard shows “No expenses yet” on `[data-testid=last-expense-line]`; seeded shows merchant + formatted amount (and date content). Confirm line is not a link/button.
  - Notes: Desktop has no unit-test runner — Playwright only. Also update any other test files that stub dashboard invokes and would break on missing command if they hit `/` (e.g. accessibility/onboarding mocks) — at minimum return `null` for `get_latest_expense` in those switches if they navigate to dashboard.

## Acceptance Criteria

- [ ] AC 1: Given the expenses table has at least one row, when the user opens the finance dashboard (`/`), then a muted text line between the page header and Cash Flow shows the globally latest expense by `date` DESC / `id` DESC as date + merchant + formatted currency amount.
- [ ] AC 2: Given two expenses share the same `date`, when the dashboard loads, then the line shows the expense with the greater `id`.
- [ ] AC 3: Given expenses exist in months other than the dashboard’s selected month, when the user changes the month navigator, then the last-expense line still shows the global latest (unchanged by month selection).
- [ ] AC 4: Given there are zero expenses, when the dashboard finishes loading, then the line shows “No expenses yet” (i18n `dashboard.noExpensesYet`) and does not show the import-CTA wording from `dashboard.noExpenses`.
- [ ] AC 5: Given the latest-expense query is still pending, when the dashboard first paints, then the UI does not flash the empty-state copy before data resolves (pulse/placeholder instead).
- [ ] AC 6: Given the last-expense line is visible, when the user inspects it, then it is display-only (not a link/button) and has `data-testid="last-expense-line"`.
- [ ] AC 7: Given a user creates, updates, deletes, imports, or applies recurring expenses that invalidate `["expenses"]`, when they return to / refresh the dashboard query cache, then the last-expense line reflects the new latest row without a dedicated extra invalidate call.
- [ ] AC 8: Given EN or FR locale, when the line renders, then all visible strings come from i18n (including interpolated last-expense template) with FR translations present.
- [ ] AC 9: Given Playwright dashboard suites, when empty and seeded mocks run, then assertions cover empty and populated last-expense line states without unhandled `get_latest_expense` invokes.

## Additional Context

### Dependencies

- Existing `expenses` SQLite table and `Expense` model — no migration.
- Existing expense mutation / import / recurring invalidation of `queryKeys.expenses` / `["expenses"]`.
- `useFormatCurrency`, i18next EN/FR, shared muted text utilities (Tailwind tokens already in app).
- No new npm/crates.

### Testing Strategy

- **Automated:** Playwright in `apps/desktop/tests/dashboard.spec.ts` — empty + seeded last-expense line; update other dashboard invoke mocks that hit `/` to include `get_latest_expense`.
- **Manual:** (1) Seed expenses across months → confirm line ignores month nav. (2) Same-date two expenses → higher `id` wins. (3) Delete all expenses → empty copy. (4) Create expense → line updates after invalidate. (5) Toggle FR → strings/date locale look correct.
- **Rust:** Optional small unit test in `db/expense.rs` for ordering/empty if easy alongside existing expense DB tests; not required if Playwright covers the UX contract.

### Notes

- **High risk:** Month-nav confusion — mitigated by placement outside Cash Flow and AC 3.
- **High risk:** Reusing `dashboard.noExpenses` would wrong-foot users with an import CTA — dedicated `noExpensesYet` key required.
- **High risk:** UTC date parsing off-by-one — parse ISO date parts locally, don’t `new Date("yyyy-MM-dd")` alone.
- **Known limitation:** Very long merchant names may wrap; truncation deferred.
- **Future (out of scope):** Click-through to expenses; recent-N list; category chip.
- Party Mode (Sally/Barry/Amelia): placement locked under header above Cash Flow.
- Spec tracked in dedicated file for parallel Quick Spec work (not `tech-spec-wip.md`).
