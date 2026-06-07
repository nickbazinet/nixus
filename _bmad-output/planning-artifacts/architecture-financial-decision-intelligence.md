---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-06-06'
lastUpdated: '2026-06-06'
implementationSynced: '2026-06-06'
scope: 'financial-decision-intelligence'
parentDocument: architecture-desktop.md
inputDocuments:
  - prd.md
  - ux-design-specification.md
  - architecture-desktop.md
  - project-context.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-06-06'
---

# Financial Decision Intelligence — Architecture Decision Document

_Scoped architecture addendum for FR83–FR89 (Financial Decision Intelligence). Extends [architecture-desktop.md](architecture-desktop.md). UX placement and interaction patterns are specified in [ux-design-specification.md](ux-design-specification.md) § Financial Decision Intelligence Module._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

7 FRs (FR83–FR89) forming a **read-only insight subsystem** — no new transactional entities, no AI-generated recommendations:

| Group | FRs | Architectural role |
|-------|-----|-------------------|
| Emergency fund | FR83–FR84 | Liquid savings ÷ trailing avg expenses → months of runway; target months in `config` |
| Savings capacity | FR85 | Savings rate + surplus/deficit + top discretionary categories |
| Waterfall engine | FR86–FR87 | Deterministic priority ladder → single next-best-action category + reasoning |
| Surfaces | FR88–FR89 | Dashboard summary card + Net Worth → Financial Health section |

**Explicit non-requirements (MVP):**
- No conversational AI advisor over these metrics (Phase 3)
- No TFSA/RRSP/FHSA contribution-room tracking (generic registered-vs-non-registered nudge only)
- No specific securities, products, or return projections (FR87 guardrail)
- No new top-level sidebar or `InnerTabNav` item (UX: section under Net Worth)

**Non-Functional Requirements:**

| NFR | Requirement | Architectural impact |
|-----|-------------|---------------------|
| NFR19 | Deterministic, rule-based recommendations | Pure Rust `evaluator.rs`; no LLM in decision path |
| NFR20 | Recommendations traceable to source figures | Response includes `figures` object + i18n reasoning keys |
| NFR21 | Renders within 1s on dashboard load | Single aggregated IPC command; synchronous SQLite reads |
| NFR22 | Educational-not-advice disclaimer | Frontend i18n key only; no backend logic |

**Scale & Complexity:**

- Primary domain: Desktop module extension (Tauri — React + Rust + SQLite)
- Complexity level: **Low–Medium** (aggregate queries + rule engine; no schema migration required)
- Estimated new architectural components: 5
  1. Rust `financial_health/` module (`evaluator.rs`, `constants.rs`)
  2. Rust `db/financial_health.rs` query/aggregate layer
  3. Rust `commands/financial_health.rs` Tauri commands
  4. React `components/financial-health/` + dashboard `FinancialHealthCard`
  5. Net Worth layout refactor with section sub-nav + `/net-worth/financial-health` child route

### Technical Constraints & Dependencies

- **Extends existing desktop stack** — SQLite, Tauri IPC, TanStack Query, shadcn/ui, i18n (per architecture-desktop.md)
- **Reuses proven aggregate patterns** — `db/projection.rs` trailing income/expense averages; `db/net_worth.rs` liquid vs investment split
- **Follows maintenance evaluator pattern** — pure Rust function module, computed at read time, unit-tested
- **Config persistence exists** — `db/config.rs` `get`/`set` for emergency fund target (FR84)
- **Credit card debt gap** — no APR/interest-rate field on accounts; FR86 step 2 needs an explicit MVP rule (see D4)
- **No discretionary flag on budget** — FR85 "discretionary categories" needs a heuristic (see D5)
- **UX specified** — `FinancialHealthCard` placement, Net Worth section sub-nav, component anatomy, emotional design (2026-06-06)

### Cross-Cutting Concerns Identified

1. **Single source of truth for aggregates** — Trailing averages, liquid balances, and CC debt must not be duplicated across projection and financial-health modules; extract shared helpers or call existing query functions.
2. **Insufficient-data semantics** — Card and section must degrade gracefully when accounts/expenses/income are missing (UX empty states).
3. **Values privacy** — All monetary displays respect `hide_values` toggle (FR76); backend always returns raw cents; frontend masks.
4. **Invalidation** — Recalculate when account balances, expenses, income entries, or emergency-fund target change; standard TanStack Query key invalidation on those mutations.
5. **i18n for reasoning** — Backend returns `reasoning_key` + structured `figures`; frontend interpolates into `financialHealth.waterfall.reasoning.*` templates (EN + FR).

---

## Starter Template Evaluation

### Selected Approach: Extend Existing Desktop App

**Rationale:** Financial Decision Intelligence is MVP capability #14. All infrastructure exists. Implementation adds a Rust evaluator module, one db/commands pair, React components, and a Net Worth route refactor — **no migration, no new dependencies**.

**Implementation entry point:**

```bash
# First story: Rust evaluator + unit tests + IPC command + dashboard card stub
# apps/desktop/src-tauri/src/financial_health/evaluator.rs
# apps/desktop/src-tauri/src/db/financial_health.rs
# apps/desktop/src-tauri/src/commands/financial_health.rs
# apps/desktop/src/components/dashboard/FinancialHealthCard.tsx
# apps/desktop/src/routes/net-worth.financial-health.tsx
```

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- D1: No new tables — computed from existing data + `config` key
- D2: Trailing average window (FR83, FR85)
- D3: Liquid savings definition (FR83)
- D4: High-interest debt trigger without APR data (FR86 step 2)
- D5: Discretionary category heuristic (FR85)
- D6: Waterfall evaluator — pure Rust priority ladder (FR86–FR87, NFR19)

**Important Decisions (Shape Architecture):**
- D7: IPC command surface (summary vs detail)
- D8: Net Worth route layout + section sub-nav (FR88)
- D9: Emergency fund target persistence (FR84)
- D10: Reasoning + traceability payload shape (NFR20)

**Deferred Decisions (Phase 3):**
- Contribution-room-aware waterfall (user-entered TFSA/RRSP/FHSA limits)
- Conversational AI advisor using financial-health metrics in chat
- `is_discretionary` flag on `budget_groups` for precise category filtering
- APR field on `credit_card` accounts for nuanced debt prioritization
- Goal-based planning ("6-month fund by December")

---

### Data Architecture

#### D1: No Schema Migration

**Decision:** No new SQLite tables. All inputs are read from existing tables:

| Input | Source |
|-------|--------|
| Liquid savings | `accounts` WHERE `account_type IN ('chequing', 'savings')` |
| Investment balances | `accounts` WHERE `account_type IN ('tfsa', 'rrsp', 'fhsa', 'non_registered', 'crypto')` |
| Credit card debt | `accounts` WHERE `account_type` IN liability types (`credit_card` in MVP); owed = `ABS(balance_cents)` when non-zero |
| Trailing income | `income_entries` |
| Trailing expenses | `expenses` |
| Top categories | `expenses` JOIN `budget_categories` JOIN `budget_groups` |
| Emergency fund target | `config` key `emergency_fund_target_months` |

**Rationale:** FR83–FR89 are pure analytics over data the app already captures. Avoids migration risk and keeps backup/restore unchanged.

#### D2: Trailing Average Window

**Decision:** Reuse the `projection.rs` pattern — **all completed calendar months excluding the current month**.

```sql
-- Income trailing total + month count
SELECT COALESCE(SUM(amount_cents), 0),
       COUNT(DISTINCT strftime('%Y-%m', date))
FROM income_entries
WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')

-- Expense trailing total + month count (same filter)
FROM expenses WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')
```

`avg_monthly_expenses_cents = total / month_count` (0 if `month_count == 0`).

`coverage_months = liquid_savings_cents / avg_monthly_expenses_cents` as `f64`, displayed to one decimal. If `avg_monthly_expenses_cents == 0`, return `coverage_months: null` and `data_sufficient: false` for emergency fund.

**Rationale:** Consistent with Net Worth Projection; excludes partial current month; deterministic (NFR19).

**Insufficient data threshold:** Emergency fund and savings rate require `expense_month_count >= 1`. Savings rate additionally requires `income_month_count >= 1` and `avg_monthly_income_cents > 0`.

#### D3: Liquid Savings (FR83)

**Decision:** `liquid_savings_cents` = `SUM(balance_cents)` from `accounts` WHERE `account_type IN ('chequing', 'savings')`.

Matches `get_current_net_worth()` → `cash_cents` in `db/net_worth.rs`. **Do not** include TFSA/RRSP/FHSA (not liquid for emergency purposes).

USD accounts: include at stored `balance_cents` (same as net worth — mixed-currency sum; document as known limitation consistent with FR80).

#### D4: High-Interest Debt Trigger (FR86 Step 2)

**Decision (MVP):** Waterfall step **Pay down high-interest debt** activates when total owed on **liability account types** exceeds the revolving debt buffer.

| Option | Verdict |
|--------|---------|
| Add `interest_rate_bps` column to `accounts` | **Rejected for MVP** — schema change, no data to populate |
| Treat all CC balances as high-interest | **Selected** — pragmatic; matches guardrailed educational tone |
| Require negative `balance_cents` only | **Rejected** — Accounts UI enters owed amounts as positive liabilities |

**Liability account types (MVP):** `credit_card` only, defined in shared `LIABILITY_ACCOUNT_TYPES` (`db/account.rs`, `accountUtils.ts`). Extensible without migration by adding types to the constant list.

**Owed balance:** `liability_debt_cents = SUM(ABS(balance_cents))` for non-zero liability account balances (positive or negative stored values).

**Revolving debt buffer:** Step 2 is **complete** when `liability_debt_cents <= round(0.15 × avg_monthly_expenses_cents)`. Example: $300 owed with $2,000/mo trailing expenses → within buffer → advance to step 3. Larger balances (e.g. $2,000 owed) remain on step 2.

**Reasoning key:** `financialHealth.waterfall.reasoning.pay_debt` — cites total liability debt; does not name APR.

**Phase 3:** Optional user-entered APR, additional liability types (LOC, loan), or per-type waterfall rules.

#### D5: Discretionary Categories (FR85)

**Decision:** Top **3** budget categories by **trailing average monthly spend** (same month window as D2), **excluding** categories in budget groups whose names match essential patterns.

Essential group name patterns (case-insensitive substring match on `budget_groups.name`):

```rust
const ESSENTIAL_GROUP_PATTERNS: &[&str] = &[
    "housing", "rent", "mortgage", "utilities", "grocery", "groceries",
    "insurance", "transport", "gas", "fuel", "health", "medical",
    "savings", "debt", "loan", "essential",
];
```

Query: aggregate expenses by category over trailing months → divide by `expense_month_count` → filter out essential groups → `ORDER BY avg_spent DESC LIMIT 3`.

| Option | Verdict |
|--------|---------|
| Top spend with no filter | **Rejected** — mislabels rent/groceries as "discretionary" |
| `is_discretionary` on `budget_groups` | **Deferred** — migration + onboarding UX |
| Essential name denylist | **Selected** — zero schema change; good-enough for MVP |

**Fallback:** If all top categories are essential, return fewer than 3 (or empty list with copy explaining no discretionary categories identified).

#### D6: Waterfall Evaluator (FR86–FR87, NFR19)

**Decision:** Pure Rust module `src-tauri/src/financial_health/evaluator.rs`. Evaluated at read time; no persisted recommendation state.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WaterfallStep {
    BuildEmergencyFund,
    PayHighInterestDebt,
    ContributeRegisteredAccounts,
    InvestSurplus,
}

pub struct WaterfallEvaluation {
    pub current_step: WaterfallStep,
    pub completed_steps: Vec<WaterfallStep>,
    pub reasoning_key: String,       // i18n key
    pub reasoning_params: ReasoningParams, // figures for interpolation + NFR20
}
```

**Priority ladder (first failing step wins):**

| Order | Step | Condition to **complete** (advance past) |
|-------|------|------------------------------------------|
| 1 | `build_emergency_fund` | `coverage_months >= target_months` |
| 2 | `pay_high_interest_debt` | `liability_debt_cents <= credit_card_debt_buffer_cents` (15% of trailing avg monthly expenses; zero if no expense history) |
| 3 | `contribute_registered_accounts` | **Current while steps 1–2 complete and `avg_monthly_surplus_cents > 0`** — generic nudge; no room tracking in MVP |
| 4 | `invest_surplus` | Terminal when steps 1–2 complete and `avg_monthly_surplus_cents <= 0` |

**`current_step` logic:**

1. If `coverage_months < target_months` → `BuildEmergencyFund`
2. Else if `liability_debt_cents > credit_card_debt_buffer_cents` → `PayHighInterestDebt`
3. Else if `avg_monthly_surplus_cents > 0` → `ContributeRegisteredAccounts` (generic registered-before-non-registered guidance)
4. Else → `InvestSurplus`

**Edge cases:**

| Case | Behavior |
|------|----------|
| No expense history | `data_sufficient: false`; card shows insufficient-data state |
| No income history | Show emergency fund; savings rate null; action may still evaluate from fund/debt |
| Negative surplus (deficit) | Savings rate negative; waterfall prioritizes fund/debt before any invest guidance |
| Funded + no debt + deficit | `current_step` stays at fund if below target; else step 4 (`invest_surplus`) when surplus ≤ 0 |
| Small revolving CC balance | Owed amount ≤ 15% of trailing avg expenses → step 2 marked complete; user advances to step 3 |

**Guardrail (FR87):** Evaluator returns `WaterfallStep` enum only — never product names, tickers, or allocation percentages. Step 3 reasoning explicitly mentions TFSA/RRSP/FHSA as **account types**, not products.

**Unit tests required:** ≥12 cases covering each step, edge cases, and determinism (same input → same output).

#### D9: Emergency Fund Target (FR84)

**Decision:** Store in existing `config` table:

| Key | Default | Validation |
|-----|---------|------------|
| `emergency_fund_target_months` | `"6"` | Integer 1–24 inclusive |

Read on every `get_financial_health_*` call. Write via `set_emergency_fund_target` command.

No migration — `config` table exists (migration `014_config_table.sql`).

---

### API & Communication Patterns

#### D7: Tauri IPC Commands

| Command | Purpose | Used by |
|---------|---------|---------|
| `get_financial_health_summary` | Lightweight payload for dashboard card (FR89) | `FinancialHealthCard`, `useFinancialHealthSummary` |
| `get_financial_health_detail` | Full payload for section page (FR88) | Financial Health section, `useFinancialHealthDetail` |
| `set_emergency_fund_target` | Update config key (FR84) | `EmergencyFundPanel` inline edit |

**`get_financial_health_summary` response:**

```typescript
interface FinancialHealthSummary {
  data_sufficient: boolean;
  emergency_fund: {
    coverage_months: number | null;
    target_months: number;
    progress_ratio: number; // 0.0–1.0+ capped for display
    status: "underfunded" | "approaching" | "funded";
  } | null;
  savings: {
    savings_rate_percent: number | null;
    avg_monthly_surplus_cents: number | null;
  } | null;
  waterfall: {
    current_step: WaterfallStep;
    action_line_key: string; // short i18n for card
  } | null;
}
```

**`get_financial_health_detail` response:** extends summary with:

```typescript
interface FinancialHealthDetail extends FinancialHealthSummary {
  figures: FinancialHealthFigures; // NFR20 — all source numbers
  waterfall: WaterfallDetail; // completed_steps, reasoning_key, reasoning_params
  top_discretionary_categories: DiscretionaryCategory[];
  monthly_surplus_trend: MonthlySurplusPoint[]; // last 6 trailing months for sparkline
}
```

**`FinancialHealthFigures` (NFR20):**

```typescript
interface FinancialHealthFigures {
  liquid_savings_cents: number;
  avg_monthly_expenses_cents: number;
  avg_monthly_income_cents: number;
  credit_card_debt_cents: number;
  expense_month_count: number;
  income_month_count: number;
}
```

**Invalidation:** Add `queryKeys.financialHealth` — invalidate on:
- `update_account_balance`, account CRUD
- expense create/update/delete, import confirm
- income entry create/update/delete
- `set_emergency_fund_target`

No Tauri events — standard request/response (NFR21: sub-millisecond Rust evaluation).

#### D10: Reasoning & i18n (NFR20)

**Decision:** Backend returns `reasoning_key` (e.g. `build_emergency_fund`) + `reasoning_params` object with numeric fields. Frontend resolves `financialHealth.waterfall.reasoning.{key}` with interpolation.

Example EN template:

```json
"financialHealth.waterfall.reasoning.build_emergency_fund": "You have {{months}} months of expenses saved; your target is {{target}}. Build your buffer before investing."
```

`reasoning_params` includes pre-formatted display strings **and** raw cents for the math sub-line (`$X liquid ÷ $Y avg expenses`).

#### D11: Liability-Aware Net Worth (FR18, FR23, FR26 — implemented alongside Financial Health)

**Decision:** Designate account types as **liabilities** via shared constant `LIABILITY_ACCOUNT_TYPES` (MVP: `credit_card` only). Owed balances **subtract** from net worth everywhere; they never inflate totals or breakdown categories.

| Surface | Behavior |
|---------|----------|
| `get_current_net_worth` | `total_cents = cash + investments + passive_assets − liabilities_cents`; exposes `liabilities_cents` |
| `record_net_worth_snapshot` | Skip liability accounts in breakdown aggregation; subtract `liabilities_cents` from snapshot total |
| Accounts page hero | Net position = asset account sum − liability owed sum |
| Financial Health step 2 | Uses same `get_total_liabilities_cents()` helper |

**Owed amount:** `ABS(balance_cents)` when non-zero — supports positive liability entry in Accounts UI or negative accounting convention.

**Phase 3:** Add `line_of_credit`, `loan`, etc. to `LIABILITY_ACCOUNT_TYPES` without schema migration.

---

### Frontend Architecture

#### D8: Routing & Section Sub-Nav (FR88)

**Decision:** Refactor Net Worth into a **layout route** with section sub-nav. No new `InnerTabNav` item.

| Route file | Path | Content |
|------------|------|---------|
| `routes/net-worth.tsx` | `/net-worth` | **Layout** — section sub-nav + `<Outlet />` |
| `routes/net-worth.index.tsx` | `/net-worth/` | Existing trend + breakdown (move from current `net-worth.tsx`) |
| `routes/net-worth.financial-health.tsx` | `/net-worth/financial-health` | Financial Health section panels |

**Section sub-nav component:** `NetWorthSectionNav` — segmented control at top of layout:

```
[ Net Worth ]  [ Financial Health ]
```

Visually distinct from period `PillTabs` (6M / 1Y / ALL) which remain scoped inside the Net Worth index view only.

**Dashboard card link:** `FinancialHealthCard` → `/net-worth/financial-health`

**Files to modify:**

- Split current `net-worth.tsx` into layout + index
- Register child route in TanStack Router file tree

#### Component Structure

```
components/
├── dashboard/
│   └── FinancialHealthCard.tsx          # NEW — FR89
└── financial-health/
    ├── EmergencyFundPanel.tsx           # NEW — FR83–FR84
    ├── SavingsCapacityPanel.tsx         # NEW — FR85
    ├── ActionWaterfall.tsx              # NEW — FR86–FR87
    ├── WaterfallRung.tsx                # NEW
    ├── NetWorthSectionNav.tsx           # NEW — section sub-nav
    └── FinancialHealthDisclaimer.tsx    # NEW — NFR22
```

**Reuse:**
- Progress bar from `CashFlowSummaryCard` pattern (+ target marker via CSS)
- `PillTabs` / segmented control styling for section nav
- `InlineEdit` for target months (FR84)
- Spending trends sparkline pattern for surplus trend
- Status colors: rose/amber/teal per UX spec

#### Dashboard Placement (FR89)

Per UX spec — insert in `routes/index.tsx`:

```
CashFlowSummaryCard
FinancialHealthCard      ← NEW
YearToDateCard
Hero grid...
```

`FinancialHealthCard` is clickable → `/net-worth/financial-health`.

---

## Project Structure & Boundaries

### Complete File List

```
apps/desktop/
├── src/
│   ├── routes/
│   │   ├── index.tsx                              # MODIFY — add FinancialHealthCard
│   │   ├── net-worth.tsx                          # MODIFY — convert to layout + section nav
│   │   ├── net-worth.index.tsx                    # NEW — move existing net worth content
│   │   └── net-worth.financial-health.tsx         # NEW
│   ├── components/
│   │   ├── dashboard/
│   │   │   └── FinancialHealthCard.tsx            # NEW
│   │   └── financial-health/                      # NEW (6 components)
│   ├── hooks/
│   │   └── useFinancialHealth.ts                  # NEW
│   ├── lib/
│   │   ├── constants.ts                           # MODIFY — queryKeys.financialHealth
│   │   └── types.ts                               # MODIFY — FinancialHealth* types
│   └── locales/
│       ├── en.json                                # MODIFY — financialHealth.*, netWorth.section.*
│       └── fr.json                                # MODIFY — same
├── tests/
│   └── financial-health.spec.ts                   # NEW — Playwright E2E
└── src-tauri/
    └── src/
        ├── lib.rs                                 # MODIFY — mod financial_health; register commands
        ├── financial_health/                      # NEW
        │   ├── mod.rs
        │   ├── constants.rs                       # ESSENTIAL_GROUP_PATTERNS, defaults
        │   └── evaluator.rs                       # waterfall + unit tests
        ├── db/
        │   ├── mod.rs                             # MODIFY — pub mod financial_health
        │   └── financial_health.rs                # NEW — aggregates
        ├── commands/
        │   ├── mod.rs                             # MODIFY
        │   └── financial_health.rs                # NEW
        └── models/
            └── mod.rs                             # MODIFY — response structs
```

**No migration file.** Config key only.

### Architectural Boundaries

**IPC Boundary:** React → `invoke("get_financial_health_*")` only. Waterfall logic **never** runs in TypeScript. Frontend does not re-derive recommendations from raw data.

**Component Boundaries:** `components/financial-health/` self-contained. Dashboard card is read-only summary. No imports from `components/projection/`.

**Data Boundaries:** Read-only queries across `accounts`, `expenses`, `income_entries`, `budget_*`, `config`. No writes except `set_emergency_fund_target`.

**AI Boundary:** No chat tool extensions in MVP (Phase 3).

### Requirements to Structure Mapping

| FR | Primary files |
|----|---------------|
| FR83 | `db/financial_health.rs`, `evaluator.rs`, `EmergencyFundPanel.tsx` |
| FR84 | `config.rs`, `set_emergency_fund_target`, `EmergencyFundPanel.tsx` inline edit |
| FR85 | `db/financial_health.rs`, `SavingsCapacityPanel.tsx` |
| FR86 | `evaluator.rs`, `ActionWaterfall.tsx` |
| FR87 | `evaluator.rs` guardrails, i18n reasoning templates |
| FR88 | `net-worth.financial-health.tsx`, section components |
| FR89 | `FinancialHealthCard.tsx`, `get_financial_health_summary` |

### Files Explicitly NOT Modified

- AI chat (`commands/chat.rs`, `ai/chat.rs`) — Phase 3
- `db/projection.rs` logic (read same data; optional shared helper extraction only)
- Backup/restore commands
- `InnerTabNav.tsx` — no new top-level tab

### Shared Helper Extraction (Optional, Recommended)

Extract trailing average queries from `projection.rs` into `db/aggregates.rs`:

```rust
pub fn get_trailing_income_average(conn: &Connection) -> Result<(i64, i64), AppError>;
pub fn get_trailing_expense_average(conn: &Connection) -> Result<(i64, i64), AppError>;
```

Both `projection.rs` and `financial_health.rs` call these — prevents drift (NFR19).

---

## Development Workflow (Implementation Order)

1. **`financial_health/evaluator.rs`** + unit tests (≥12 cases)
2. **`db/financial_health.rs`** aggregates + optional `db/aggregates.rs` extraction
3. **`commands/financial_health.rs`** + register in `lib.rs` + TypeScript types
4. **`useFinancialHealth.ts`** hook + query keys + invalidation wiring
5. **`FinancialHealthCard.tsx`** + dashboard integration
6. **Net Worth layout refactor** + `NetWorthSectionNav` + `net-worth.financial-health.tsx`
7. **Section panels** (`EmergencyFundPanel`, `ActionWaterfall`, `SavingsCapacityPanel`)
8. **i18n** (EN + FR) — including all `reasoning.*` templates and disclaimer (NFR22)
9. **Playwright E2E** — seed data → card stats → navigate to section → edit target → verify waterfall shift

---

## Architecture Validation Results

### Coherence Validation ✅

- Aligns with Tauri + SQLite + TanStack stack
- No schema migration reduces risk
- Deterministic evaluator satisfies NFR19
- UX placement (Net Worth sub-section, no new tab) matches 2026-06-06 UX decision
- CC-debt-without-APR rule is explicit and documented

### Requirements Coverage Validation ✅

All FR83–FR89 and NFR19–NFR22 architecturally supported.

### Implementation Readiness Validation ✅

D1–D10 documented. ~15 new files, ~8 modified files. Agent conflict points addressed:

| Conflict risk | Enforcement |
|---------------|-------------|
| Waterfall logic duplicated in frontend | Frontend renders `current_step` only; never re-implements ladder |
| Trailing average diverges from projection | Shared `aggregates.rs` helper |
| New sidebar tab added | Explicitly forbidden — section sub-nav only |
| AI generates recommendations | No LLM in command path; chat unchanged in MVP |
| Securities in reasoning strings | Evaluator returns enum keys only; i18n reviewed |

### Gap Analysis

| Gap | Severity | Resolution |
|-----|----------|--------------|
| No APR on credit cards | Low (MVP) | D4: all liability debt treated as high-interest; 15% expense buffer for revolving balances |
| No discretionary flag on budget | Low (MVP) | D5: essential group name denylist |
| Mixed CAD/USD in liquid sum | Low | Documented; consistent with FR80 existing behavior |
| Epics/stories not yet created | Process | Run `/create-epics-and-stories` or dev-story after this doc |

**Critical gaps:** None.

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:** Reuses projection/net-worth queries; maintenance-style evaluator; zero migration; UX placement resolved; guardrails enforced in Rust.

---

## Implementation Handoff

**First implementation priority:**

1. `financial_health/evaluator.rs` with unit tests
2. `db/financial_health.rs` + `commands/financial_health.rs`
3. `FinancialHealthCard` on dashboard (proves IPC + card UX quickly)
4. Net Worth layout split + Financial Health section
5. i18n + E2E

**Architect → Dev notes:**

- When implementing `ActionWaterfall`, the UX spec's 4-rung ladder is the source of truth for visual states (check / highlight / muted).
- `set_emergency_fund_target` should invalidate both `financialHealth` and dashboard queries.
- Phase 3 AI integration should call the same `get_financial_health_detail` command — do not duplicate evaluator logic in the chat layer.

---
