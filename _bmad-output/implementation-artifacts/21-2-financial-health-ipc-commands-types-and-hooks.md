# Story 21.2: Financial Health IPC Commands, Types & Hooks

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the app to fetch my financial health summary from the backend,
So that recommendations are computed server-side and ready for display.

**Scope:** Tauri IPC commands, TypeScript types, TanStack Query hooks, and invalidation wiring. No UI components (Story 21.3 adds `FinancialHealthCard`).

## Acceptance Criteria

1. **Given** `commands/financial_health.rs`  
   **When** `get_financial_health_summary` is invoked  
   **Then** it returns `FinancialHealthSummary` per architecture D7 with `data_sufficient`, `emergency_fund`, `savings`, and `waterfall` sections (FR83, FR85, FR86 summary)  
   **And** `emergency_fund` includes `coverage_months`, `target_months` (from config key `emergency_fund_target_months`, default 6), `progress_ratio`, and `status` (`underfunded` | `approaching` | `funded`)  
   **And** `savings` includes `savings_rate_percent` and `avg_monthly_surplus_cents` (null when no income history)  
   **And** `waterfall` includes `current_step` and `action_line_key` for i18n  
   **And** evaluation completes within 1 second (NFR21)

2. **Given** `get_financial_health_detail` command  
   **When** invoked  
   **Then** it extends the summary with `figures` (NFR20), full `waterfall` detail (`completed_steps`, `reasoning_key`, `reasoning_params`), `top_discretionary_categories`, and `monthly_surplus_trend` (last 6 trailing months)  
   **And** waterfall logic runs only in Rust — never in TypeScript

3. **Given** `set_emergency_fund_target` command  
   **When** invoked with months 1–24  
   **Then** `config` key `emergency_fund_target_months` is persisted (FR84, D9)  
   **And** invalid values (0, 25, non-integer) return `AppError::Validation`

4. **Given** TypeScript types in `lib/types.ts`  
   **When** commands are registered in `lib.rs`  
   **Then** `FinancialHealthSummary`, `FinancialHealthDetail`, `WaterfallStep`, and `FinancialHealthFigures` types match backend serde shapes

5. **Given** `hooks/useFinancialHealth.ts`  
   **When** hooks are used  
   **Then** `useFinancialHealthSummary` and `useFinancialHealthDetail` use `queryKeys.financialHealth`  
   **And** invalidation is wired for account CRUD/balance updates, expense mutations, income mutations, and `set_emergency_fund_target`

## Tasks / Subtasks

- [x] Task 1: Response types in `models/mod.rs` (AC: #1, #2, #4)
  - [x] `FinancialHealthSummary`, `FinancialHealthDetail`, `FinancialHealthFigures`
  - [x] `EmergencyFundSummary`, `SavingsSummary`, `WaterfallSummary`, `WaterfallDetail`
  - [x] `MonthlySurplusPoint`, reuse `DiscretionaryCategory` from `db/financial_health.rs`
  - [x] `EmergencyFundStatus` enum with snake_case serde

- [x] Task 2: Response builders in `db/financial_health.rs` (AC: #1, #2)
  - [x] `build_financial_health_summary` — emergency fund status (funded / approaching ≥50% / underfunded)
  - [x] `build_financial_health_detail` — figures, full waterfall, top 3 discretionary, 6-month surplus trend
  - [x] `get_monthly_surplus_trend` — completed months excluding current (D2)
  - [x] `set_emergency_fund_target_months` — config persist with 1–24 validation
  - [x] Remove `#![allow(dead_code)]` from `db/financial_health.rs` and `financial_health/mod.rs`
  - [x] Add `Serialize` to `WaterfallEvaluation` in evaluator.rs

- [x] Task 3: `commands/financial_health.rs` + registration (AC: #1, #2, #3)
  - [x] `get_financial_health_summary`, `get_financial_health_detail`, `set_emergency_fund_target`
  - [x] Register in `commands/mod.rs` and `lib.rs` invoke_handler

- [x] Task 4: TypeScript types + hooks (AC: #4, #5)
  - [x] Add types to `lib/types.ts`
  - [x] Add `queryKeys.financialHealth` (+ summary/detail sub-keys) to `lib/constants.ts`
  - [x] Create `hooks/useFinancialHealth.ts` with summary/detail queries + `useSetEmergencyFundTarget` mutation
  - [x] Wire invalidation in `useAccounts.ts`, `useExpenses.ts`, `useIncome.ts`, `import.tsx` confirm_import

- [x] Task 5: Quality gates (AC: all)
  - [x] `cargo check` and `cargo test` in `apps/desktop/src-tauri/` — zero warnings
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero type errors

## Dev Notes

### Critical Architecture Rules

- **Commands orchestrate only** — call `db/financial_health::evaluate_financial_health_waterfall` and builders; no SQL in commands (D7)
- **Waterfall never in TypeScript** — hooks invoke IPC only; no client-side recommendation logic
- **Emergency fund status thresholds** — `funded`: coverage ≥ target; `approaching`: coverage ≥ 50% of target (UX-DR7); else `underfunded`
- **Savings null semantics** — `savings_rate_percent` and `avg_monthly_surplus_cents` are `null` when `income_month_count == 0`; emergency fund still shown when expense history exists
- **`action_line_key`** — use evaluator `reasoning_key` value (`build_emergency_fund`, `pay_debt`, etc.) for card i18n lookup in Story 22.4
- **Monthly surplus trend** — last 6 completed calendar months excluding current month (D2), ordered chronologically for sparkline
- **Invalidation** — `queryKeys.financialHealth` prefix invalidates both summary and detail queries

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 21.2]
- [Source: _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md — D7, D9, D10, invalidation]
- [Source: docs/project-context.md — IPC patterns, cents, db/commands separation]
- [Source: _bmad-output/implementation-artifacts/21-1-financial-health-evaluator-aggregates-and-unit-tests.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Fixed `AppError::Validation` to include required `field` parameter
- Renamed SQL CTE `expenses` → `expense_totals` to avoid circular reference with table name

### Completion Notes List

- Added IPC response types to `models/mod.rs` matching architecture D7 shapes
- `db/financial_health.rs` builds summary/detail payloads, monthly surplus trend, and target persistence
- `commands/financial_health.rs` exposes three Tauri commands; registered in `lib.rs`
- TypeScript types and `useFinancialHealth.ts` hooks with `queryKeys.financialHealth` invalidation wired across account/expense/income/import mutations
- Removed `#![allow(dead_code)]` from financial_health modules
- Quality gates: `cargo check` (zero warnings), `cargo test financial_health` (26 passed), full `cargo test` (141 passed), `tsc --noEmit` (zero errors)

### File List

- apps/desktop/src-tauri/src/commands/financial_health.rs
- apps/desktop/src-tauri/src/commands/mod.rs
- apps/desktop/src-tauri/src/db/financial_health.rs
- apps/desktop/src-tauri/src/financial_health/evaluator.rs
- apps/desktop/src-tauri/src/financial_health/mod.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src-tauri/src/models/mod.rs
- apps/desktop/src/hooks/useFinancialHealth.ts
- apps/desktop/src/hooks/useAccounts.ts
- apps/desktop/src/hooks/useExpenses.ts
- apps/desktop/src/hooks/useIncome.ts
- apps/desktop/src/hooks/useRecurringExpenses.ts
- apps/desktop/src/lib/constants.ts
- apps/desktop/src/lib/types.ts
- apps/desktop/src/routes/import.tsx
- _bmad-output/implementation-artifacts/21-2-financial-health-ipc-commands-types-and-hooks.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-06-06: Implemented financial health IPC commands, TypeScript types, hooks, and query invalidation wiring
