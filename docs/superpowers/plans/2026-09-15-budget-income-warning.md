# Budget-to-Income Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn users when an eligible monthly budget target exceeds historical average monthly income.

**Architecture:** Extend the existing `BudgetSummary` IPC response so its current query also returns the established completed-month income average and month count. Keep eligibility and presentation in the budget summary component, using the shared caution alert and existing privacy mask.

**Tech Stack:** Rust, rusqlite, Tauri IPC, React 19, TypeScript, i18next, shared Nixus UI, Vitest, Playwright.

## Global Constraints

- Eligibility begins at six distinct completed months containing income.
- Average all completed recorded-income months; exclude the current month.
- Currency remains integer cents until display formatting.
- Equality does not warn; only `target > average` does.
- Reuse shared components/tokens and preserve English/French and values masking.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Budget summary data contract

**Files:**
- Modify: `apps/desktop/src-tauri/src/models/mod.rs`
- Modify: `apps/desktop/src-tauri/src/db/dashboard.rs`
- Modify: `apps/desktop/src/lib/types.ts`

**Interfaces:**
- Consumes: `aggregates::get_trailing_income_average(&Connection) -> Result<(i64, i64), AppError>`
- Produces: `BudgetSummary.average_monthly_income_cents` and `BudgetSummary.income_month_count`

- [x] Add a failing Rust test that seeds budget, expense, and six completed income months, invokes `get_budget_summary`, and asserts the returned average and count.
- [x] Run `cargo test db::dashboard --manifest-path apps/desktop/src-tauri/Cargo.toml` and confirm failure because the fields are absent.
- [x] Add the two `i64` Rust fields and matching TypeScript `number` fields; call `get_trailing_income_average(conn)?` once while constructing the summary.
- [x] Re-run the focused Rust test and confirm it passes.

### Task 2: Localized warning presentation

**Files:**
- Create: `apps/desktop/src/locales/__tests__/budget-income-warning-i18n.test.ts`
- Modify: `apps/desktop/src/locales/en.json`
- Modify: `apps/desktop/src/locales/fr.json`
- Modify: `apps/desktop/src/components/budget/BudgetSummaryStrip.tsx`
- Modify: `apps/desktop/src/routes/spending.budget.tsx`

**Interfaces:**
- Consumes: summary average/count plus existing `useValuesHidden`, `useFormatCurrency`, `Alert`, and `TriangleAlert`.
- Produces: `data-testid="budget-income-warning"` only when `incomeMonthCount >= 6 && totalTargetCents > averageMonthlyIncomeCents`.

- [x] Add a failing locale test requiring `budget.incomeWarningTitle` and `budget.incomeWarningDescription`, with `{{target}}` and `{{average}}` present in both locales.
- [x] Run `pnpm --filter @nixus/desktop test -- budget-income-warning-i18n` and confirm missing-key failure.
- [x] Add concise English/French copy; render shared `Alert variant="caution"` below the meter and pass the new summary fields from the route.
- [x] Route both interpolated figures through the existing masking-aware currency formatter.
- [x] Re-run the focused locale test and confirm it passes.

### Task 3: Browser behavior and release gates

**Files:**
- Modify: `apps/desktop/tests/budget.spec.ts`

**Interfaces:**
- Consumes: mocked `get_budget_summary` response.
- Produces: browser coverage for five-month hidden, six-month visible, equality hidden, and values-masked states.

- [x] Extend the default summary mock with zero average/count so existing scenarios remain unchanged.
- [x] Add failing Playwright scenarios that override the summary response and assert the approved visibility boundaries and formatted/masked copy.
- [x] Run `pnpm --filter @nixus/desktop exec playwright test tests/budget.spec.ts` and confirm the new scenarios fail before UI implementation, then pass afterward.
- [x] Run `pnpm --filter @nixus/desktop exec tsc --noEmit`, `pnpm --filter @nixus/desktop test`, `pnpm --filter @nixus/desktop build`, and the full Playwright suite once.
- [x] Drive the warning in a real browser at the desktop minimum viewport, verify light/dark appearance and masked values, and capture the final visual QA verdict.
