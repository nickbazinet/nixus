# Story 21.1: Financial Health Evaluator, Aggregates & Unit Tests

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the financial health evaluation engine and database aggregate queries in place,
So that all financial health IPC commands can compute deterministic, traceable recommendations.

**Scope:** Rust-only backend foundation. No Tauri commands, no frontend, no i18n in this story. Story 21.2 adds IPC commands, TypeScript types, and hooks.

## Acceptance Criteria

1. **Given** the desktop app database with existing tables (`accounts`, `expenses`, `income_entries`, `budget_categories`, `budget_groups`, `config`)  
   **When** `db/financial_health.rs` is implemented  
   **Then** no new SQLite migration is created (architecture D1)  
   **And** liquid savings sums `balance_cents` from chequing and savings accounts only (D3)  
   **And** credit card debt sums `ABS(balance_cents)` for credit cards with negative balances (D4)  
   **And** trailing income and expense averages use completed calendar months excluding the current month (D2)  
   **And** top discretionary categories exclude budget groups matching `ESSENTIAL_GROUP_PATTERNS` in `constants.rs` (D5)

2. **Given** optional `db/aggregates.rs` extraction  
   **When** implemented  
   **Then** `get_trailing_income_average` and `get_trailing_expense_average` are shared by `projection.rs` and `financial_health.rs` to prevent calculation drift

3. **Given** `financial_health/evaluator.rs`  
   **When** unit tests run  
   **Then** at least 12 test cases cover each `WaterfallStep`, edge cases, and determinism (NFR19)  
   **And** `BuildEmergencyFund` wins when `coverage_months < target_months`  
   **And** `PayHighInterestDebt` wins when fund is met but `credit_card_debt_cents > 0`  
   **And** `ContributeRegisteredAccounts` wins when steps 1–2 complete and `avg_monthly_surplus_cents > 0`  
   **And** `InvestSurplus` is the terminal step when appropriate  
   **And** insufficient expense history returns `data_sufficient: false` with null coverage  
   **And** identical inputs always produce identical `WaterfallEvaluation` output

4. **Given** `financial_health/constants.rs`  
   **When** loaded  
   **Then** `ESSENTIAL_GROUP_PATTERNS` and default emergency fund target (6 months) are defined  
   **And** evaluator returns `WaterfallStep` enum and `reasoning_key` only — never product names or tickers (FR87 guardrail)

5. **Given** module registration  
   **When** `financial_health/mod.rs` is added  
   **Then** `db/mod.rs` and `lib.rs` export the module without SQL duplicated in commands

6. **Given** the full Rust backend  
   **When** `cargo check` and `cargo test financial_health` run in `apps/desktop/src-tauri/`  
   **Then** zero compiler warnings and all tests pass

## Tasks / Subtasks

- [x] Task 1: `db/aggregates.rs` — shared trailing averages (AC: #2)
  - [x] Extract `get_trailing_income_average` and `get_trailing_expense_average` from `projection.rs`
  - [x] Return `(avg_cents, month_count)` tuple matching existing projection semantics
  - [x] Refactor `projection.rs` to call shared helpers (no logic change)
  - [x] Register `pub mod aggregates;` in `db/mod.rs`

- [x] Task 2: `db/financial_health.rs` — aggregate queries (AC: #1)
  - [x] `get_liquid_savings_cents` — chequing + savings only (matches `net_worth.rs` cash query)
  - [x] `get_credit_card_debt_cents` — `ABS(SUM(balance_cents))` where `account_type = 'credit_card'` AND `balance_cents < 0`
  - [x] `get_top_discretionary_categories` — top 3 by trailing avg spend, exclude essential groups via `constants::is_essential_group_name`
  - [x] Use `aggregates::get_trailing_expense_average` for month count and averaging
  - [x] In-memory SQLite tests for each aggregate function

- [x] Task 3: `financial_health/constants.rs` (AC: #4)
  - [x] Define `ESSENTIAL_GROUP_PATTERNS` per architecture D5
  - [x] Define `DEFAULT_EMERGENCY_FUND_TARGET_MONTHS: i64 = 6` and `EMERGENCY_FUND_TARGET_CONFIG_KEY`
  - [x] Implement `is_essential_group_name(name: &str) -> bool` (case-insensitive substring)
  - [x] Unit tests for pattern matching edge cases

- [x] Task 4: `financial_health/evaluator.rs` — waterfall engine (AC: #3, #4)
  - [x] `WaterfallStep` enum with `#[serde(rename_all = "snake_case")]`
  - [x] `WaterfallEvalInput`, `WaterfallEvaluation`, `ReasoningParams` structs
  - [x] `evaluate_waterfall(input: &WaterfallEvalInput) -> WaterfallEvaluation` per D6 priority ladder
  - [x] `reasoning_key` values: `build_emergency_fund`, `pay_debt`, `contribute_registered`, `invest_surplus`
  - [x] ≥12 unit tests: each step, edge cases, determinism, FR87 guardrail

- [x] Task 5: Module registration (AC: #5, #6)
  - [x] Create `financial_health/mod.rs` with `pub mod constants; pub mod evaluator;`
  - [x] Add `mod financial_health;` in `lib.rs`
  - [x] Add `pub mod financial_health;` in `db/mod.rs`
  - [x] Run `cargo check`, `cargo test financial_health`, full `cargo test`

## Dev Notes

### Critical Architecture Rules

- **Single source of truth for waterfall:** `financial_health/evaluator.rs` only — never compute recommendations in frontend or commands (Story 21.2 orchestrates only)
- **Single source for essential patterns:** `financial_health/constants.rs` only — `db/financial_health.rs` imports `is_essential_group_name`
- **SQL placement:** All financial health SQL in `db/financial_health.rs` and `db/aggregates.rs` — no SQL in `commands/` (commands deferred to 21.2)
- **No schema migration:** D1 — read from existing tables + `config` key `emergency_fund_target_months` (default 6)
- **Trailing average window:** D2 — identical SQL to current `projection.rs`: `strftime('%Y-%m', date) < strftime('%Y-%m', 'now')`
- **Shared aggregates:** Prevent drift between projection and financial health (NFR19)

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Epic 21, Story 21.1]
- [Source: _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md — D1–D6, D9, aggregates extraction]
- [Source: docs/project-context.md — monetary cents, db/commands separation]
- [Source: apps/desktop/src-tauri/src/db/projection.rs — trailing average SQL to extract]
- [Source: apps/desktop/src-tauri/src/db/net_worth.rs — liquid savings query pattern]
- [Source: apps/desktop/src-tauri/src/maintenance/evaluator.rs — evaluator + test pattern]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Added `evaluate_financial_health_waterfall` orchestration in `db/financial_health.rs` to wire aggregates + evaluator for Story 21.2; `#![allow(dead_code)]` on modules until IPC commands consume them (per warnings.md)
- Fixed aggregate test math (120000 total / 2 months = 60000 avg)

### Completion Notes List

- `db/aggregates.rs` extracts trailing income/expense averages; `projection.rs` refactored to call shared helpers with no semantic change
- `db/financial_health.rs` implements liquid savings, CC debt, discretionary categories, config target read, and waterfall orchestration
- `financial_health/constants.rs` defines `ESSENTIAL_GROUP_PATTERNS`, default 6-month target, and `is_essential_group_name`
- `financial_health/evaluator.rs` implements D6 waterfall ladder with 13 unit tests (≥12 required)
- Module registration in `lib.rs` and `db/mod.rs`; no migration, no IPC commands
- Quality gates: `cargo check` (zero warnings), `cargo test financial_health` (22 passed), full `cargo test` (137 passed)

### File List

- apps/desktop/src-tauri/src/financial_health/mod.rs
- apps/desktop/src-tauri/src/financial_health/constants.rs
- apps/desktop/src-tauri/src/financial_health/evaluator.rs
- apps/desktop/src-tauri/src/db/aggregates.rs
- apps/desktop/src-tauri/src/db/financial_health.rs
- apps/desktop/src-tauri/src/db/mod.rs
- apps/desktop/src-tauri/src/db/projection.rs
- apps/desktop/src-tauri/src/lib.rs
- _bmad-output/implementation-artifacts/21-1-financial-health-evaluator-aggregates-and-unit-tests.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-06-06: Implemented financial health evaluator, shared aggregates, db query layer, and comprehensive Rust unit tests
