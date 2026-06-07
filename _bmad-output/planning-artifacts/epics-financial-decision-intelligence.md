---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
implementationStatus: implemented
lastSyncedWithCode: '2026-06-06'
scope: financial-decision-intelligence
inputDocuments:
  - prd.md
  - ux-design-specification.md
  - architecture-financial-decision-intelligence.md
---

# nkbaz-finance - Financial Decision Intelligence Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nkbaz-finance Financial Decision Intelligence module, decomposing FR83–FR89 (and NFR19–NFR22) from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR83: System calculates the user's emergency fund coverage as liquid savings (chequing + savings account balances) divided by trailing average monthly expenses, expressed as months of runway
- FR84: User can set an emergency fund target in months (with 3–6 months suggested as guidance) and view progress toward that target
- FR85: System calculates the user's monthly savings rate ((income − expenses) ÷ income) and trailing-period average surplus/deficit, and surfaces the largest discretionary spending categories reducing savings capacity
- FR86: System evaluates the user's finances against a fixed priority waterfall — (1) build emergency fund, (2) pay down high-interest debt, (3) contribute to registered accounts (TFSA/RRSP/FHSA) before non-registered, (4) invest surplus — and recommends the single next-best-action category for the user's surplus cash
- FR87: System presents all guidance as category-level recommendations with plain-language reasoning tied to the user's data, and never recommends specific securities or financial products, nor guarantees returns
- FR88: User can open a dedicated Financial Health view showing emergency fund status, savings-capacity trend, and the prioritized action waterfall with explanations
- FR89: User can view a Financial Health summary card on the dashboard showing emergency fund coverage, savings rate, and the current next-best action

### NonFunctional Requirements

- NFR1: Dashboard loads and renders all data (budget status, account balances, net worth) within 1 second on subsequent visits — applies to `FinancialHealthCard` on dashboard load
- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay) — applies to Net Worth section sub-nav and `/net-worth/financial-health`
- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted — applies to emergency fund target config persistence
- NFR16: All user-facing strings are available in English and French with no missing translation keys in shipped views — all `financialHealth.*` and `netWorth.section.*` keys
- NFR17: Values privacy toggle (FR76) applies to all monetary displays app-wide within 100ms of toggle — all monetary displays in card and section panels
- NFR19: Financial Decision Intelligence recommendations are computed deterministically from stored user data (rule-based) — identical inputs always produce identical output; no generative or probabilistic model decides recommendations
- NFR20: Every recommendation is traceable to the underlying figures that produced it, and those figures are inspectable by the user
- NFR21: Financial Health calculations complete and render within 1 second on dashboard load and recalculate when account balances or expenses change
- NFR22: The Financial Health view and dashboard card display a disclaimer that guidance is educational and not professional financial advice

### Additional Requirements

**Architecture — Implementation approach:**
- **Not a greenfield starter:** Extend existing Tauri 2 desktop app at `apps/desktop/` — first story is Rust evaluator + unit tests, not project scaffolding
- **No schema migration (D1):** No new SQLite tables; read from existing `accounts`, `expenses`, `income_entries`, `budget_*`, `config` tables
- **Trailing average window (D2):** Reuse `projection.rs` pattern — all completed calendar months excluding current month; `avg = total / month_count`
- **Liquid savings (D3):** `SUM(balance_cents)` from `accounts` WHERE `account_type IN ('chequing', 'savings')` — matches `cash_cents` in net worth; USD at stored cents (known limitation)
- **High-interest debt trigger (D4):** Liability account types (`credit_card` in MVP); owed = `ABS(balance_cents)`; step 2 complete when owed ≤ **15% of trailing avg monthly expenses** (revolving buffer); uses shared `LIABILITY_ACCOUNT_TYPES` / `get_total_liabilities_cents`
- **Discretionary categories (D5):** Top 3 categories by trailing avg monthly spend, excluding budget groups matching essential name denylist (`housing`, `rent`, `groceries`, `transport`, etc.)
- **Waterfall evaluator (D6):** Pure Rust `financial_health/evaluator.rs`; `WaterfallStep` enum; priority ladder evaluated at read time; ≥12 unit test cases required
- **IPC commands (D7):** `get_financial_health_summary`, `get_financial_health_detail`, `set_emergency_fund_target` — waterfall logic never runs in TypeScript
- **Net Worth route refactor (D8):** Split `net-worth.tsx` into layout + `net-worth.index.tsx` + `net-worth.financial-health.tsx`; `NetWorthSectionNav` segmented control; no new `InnerTabNav` item
- **Emergency fund target (D9):** `config` key `emergency_fund_target_months`, default `"6"`, validation 1–24 inclusive
- **Reasoning payload (D10):** Backend returns `reasoning_key` + `reasoning_params`; frontend interpolates `financialHealth.waterfall.reasoning.*` i18n templates
- **Shared helpers:** Optional extraction of trailing average queries to `db/aggregates.rs` shared by `projection.rs` and `financial_health.rs`
- **TanStack Query invalidation:** `queryKeys.financialHealth` on account CRUD/balance update, expense mutations, income mutations, `set_emergency_fund_target`
- **Files NOT modified:** AI chat (`commands/chat.rs`), backup/restore, `InnerTabNav.tsx`
- **Phase 3 deferred:** Conversational AI advisor over metrics, contribution-room tracking, `is_discretionary` flag, APR on credit cards, additional liability types (LOC, loan)

**Account / Net Worth (liability parity — FR18, FR23, FR26):**
- **Liability account types:** `credit_card` in MVP via `LIABILITY_ACCOUNT_TYPES` (Rust + TypeScript); owed balances subtract from net worth
- **Net worth total:** asset accounts + passive assets − liabilities (`liabilities_cents` on `NetWorthCurrent`)
- **Snapshots:** liability accounts excluded from breakdown; subtracted from snapshot total
- **Accounts page:** hero total = net position; breakdown bar asset-only; subtitle "Liabilities: {{amount}}"

**UX Design Requirements:**
- UX-DR1: `FinancialHealthCard` on dashboard — full-width **above Top Categories by Spending** (below hero metrics / secondary account cards); entire card clickable → `/net-worth/financial-health`; 3-column layout (emergency fund, savings rate, next best action); persistent disclaimer footnote
- UX-DR2: No new sidebar/InnerTabNav item — Financial Health is section under Net Worth page with section sub-nav: **Net Worth** · **Financial Health**
- UX-DR3: Section sub-nav visually distinct from period PillTabs (6M/1Y/ALL) — sub-nav navigates, period tabs filter
- UX-DR4: `EmergencyFundPanel` — hero monospace months, progress bar with target marker, inline-editable target (FR84), math sub-line for NFR20 traceability
- UX-DR5: `ActionWaterfall` — 4-rung vertical ladder; completed/current/future rung states; expandable "Why?" disclosure with user-specific figures; guardrailed copy (no securities/products)
- UX-DR6: `SavingsCapacityPanel` — savings rate %, surplus/deficit, sparkline trend, top 2–3 discretionary categories framed neutrally
- UX-DR7: Status colors — teal (funded/positive), amber (approaching), rose (underfunded/deficit); months capped at "12+ mo" display
- UX-DR8: Empty/loading states — skeleton (`data-testid="financial-health-skeleton"`), insufficient-data prompts with CTAs to Import/Onboarding/Income
- UX-DR9: Passive-by-default — no nag, notification, or sidebar badge; recommendation changes calmly on next dashboard glance
- UX-DR10: Accessibility — `role="link"`, `aria-label` summarizing all three stats and action on card
- UX-DR11: Values privacy toggle respected on every monetary display (FR76)
- UX-DR12: No onboarding wizard step for this module in MVP
- UX-DR13: i18n namespace `financialHealth.*`, `netWorth.section.financialHealth`; single shared `financialHealth.disclaimer` key (NFR22)
- UX-DR14: Playwright E2E — seed data → verify card stats → navigate to section → edit target → verify waterfall shift
- UX-DR15: Toast on emergency-fund target update (`financialHealth.toast.targetUpdated`); inline validation errors for target

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR83 | Epic 21, 22 | Emergency fund coverage (months of runway) — summary on card (21), full panel with math sub-line (22) |
| FR84 | Epic 22 | Set and edit emergency fund target months with progress visualization |
| FR85 | Epic 21, 22 | Savings rate, surplus/deficit, top discretionary categories — summary on card (21), full panel with trend (22) |
| FR86 | Epic 21, 22 | Priority-waterfall next-best-action — action line on card (21), 4-rung ladder with "Why?" (22) |
| FR87 | Epic 22 | Category-level guardrailed guidance — reasoning templates and waterfall copy |
| FR88 | Epic 22 | Dedicated Financial Health section under Net Worth |
| FR89 | Epic 21 | Dashboard `FinancialHealthCard` summary |

## Epic List

### Epic 21: Dashboard Financial Health at a Glance
Users open the app and immediately see emergency fund coverage, savings rate, and a single next-best action for surplus cash — oriented in seconds without leaving the dashboard.
**FRs covered:** FR89, FR83 (summary), FR85 (summary), FR86 (summary action line)
**NFRs addressed:** NFR1, NFR19, NFR21, NFR22 (card disclaimer)
**UX-DRs addressed:** UX-DR1, UX-DR7, UX-DR8 (card states), UX-DR9, UX-DR10, UX-DR11

### Epic 22: Financial Health Planning View
Users explore the full financial health picture under Net Worth — adjust their emergency fund target, read the priority waterfall with traceable "Why?" reasoning, and see savings capacity trends with top discretionary categories.
**FRs covered:** FR88, FR84, FR83 (detail), FR85 (detail), FR86 (detail), FR87
**NFRs addressed:** NFR2, NFR16, NFR17, NFR20, NFR22 (section disclaimer)
**UX-DRs addressed:** UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR8 (section states), UX-DR12, UX-DR13, UX-DR14, UX-DR15

---

## Epic 21: Dashboard Financial Health at a Glance

Users open the app and immediately see emergency fund coverage, savings rate, and a single next-best action for surplus cash — oriented in seconds without leaving the dashboard.

### Story 21.1: Financial Health Evaluator, Aggregates & Unit Tests

As a developer,
I want the financial health evaluation engine and database aggregate queries in place,
So that all financial health IPC commands can compute deterministic, traceable recommendations.

**Acceptance Criteria:**

**Given** the desktop app database with existing tables (`accounts`, `expenses`, `income_entries`, `budget_categories`, `budget_groups`, `config`)
**When** `db/financial_health.rs` is implemented
**Then** no new SQLite migration is created (architecture D1)
**And** liquid savings sums `balance_cents` from chequing and savings accounts only (D3)
**And** credit card debt sums `ABS(balance_cents)` for credit cards with negative balances (D4)
**And** trailing income and expense averages use completed calendar months excluding the current month (D2)
**And** top discretionary categories exclude budget groups matching `ESSENTIAL_GROUP_PATTERNS` in `constants.rs` (D5)

**Given** optional `db/aggregates.rs` extraction
**When** implemented
**Then** `get_trailing_income_average` and `get_trailing_expense_average` are shared by `projection.rs` and `financial_health.rs` to prevent calculation drift

**Given** `financial_health/evaluator.rs`
**When** unit tests run
**Then** at least 12 test cases cover each `WaterfallStep`, edge cases, and determinism (NFR19)
**And** `BuildEmergencyFund` wins when `coverage_months < target_months`
**And** `PayHighInterestDebt` wins when fund is met but `credit_card_debt_cents > 0`
**And** `ContributeRegisteredAccounts` wins when steps 1–2 complete and `avg_monthly_surplus_cents > 0`
**And** `InvestSurplus` is the terminal step when appropriate
**And** insufficient expense history returns `data_sufficient: false` with null coverage
**And** identical inputs always produce identical `WaterfallEvaluation` output

**Given** `financial_health/constants.rs`
**When** loaded
**Then** `ESSENTIAL_GROUP_PATTERNS` and default emergency fund target (6 months) are defined
**And** evaluator returns `WaterfallStep` enum and `reasoning_key` only — never product names or tickers (FR87 guardrail)

**Given** module registration
**When** `financial_health/mod.rs` is added
**Then** `db/mod.rs` and `lib.rs` export the module without SQL duplicated in commands

### Story 21.2: Financial Health IPC Commands, Types & Hooks

As a user,
I want the app to fetch my financial health summary from the backend,
So that recommendations are computed server-side and ready for display.

**Acceptance Criteria:**

**Given** `commands/financial_health.rs`
**When** `get_financial_health_summary` is invoked
**Then** it returns `FinancialHealthSummary` per architecture D7 with `data_sufficient`, `emergency_fund`, `savings`, and `waterfall` sections (FR83, FR85, FR86 summary)
**And** `emergency_fund` includes `coverage_months`, `target_months` (from config key `emergency_fund_target_months`, default 6), `progress_ratio`, and `status` (`underfunded` | `approaching` | `funded`)
**And** `savings` includes `savings_rate_percent` and `avg_monthly_surplus_cents` (null when no income history)
**And** `waterfall` includes `current_step` and `action_line_key` for i18n
**And** evaluation completes within 1 second (NFR21)

**Given** `get_financial_health_detail` command
**When** invoked
**Then** it extends the summary with `figures` (NFR20), full `waterfall` detail (`completed_steps`, `reasoning_key`, `reasoning_params`), `top_discretionary_categories`, and `monthly_surplus_trend` (last 6 trailing months)
**And** waterfall logic runs only in Rust — never in TypeScript

**Given** `set_emergency_fund_target` command
**When** invoked with months 1–24
**Then** `config` key `emergency_fund_target_months` is persisted (FR84, D9)
**And** invalid values (0, 25, non-integer) return `AppError::Validation`

**Given** TypeScript types in `lib/types.ts`
**When** commands are registered in `lib.rs`
**Then** `FinancialHealthSummary`, `FinancialHealthDetail`, `WaterfallStep`, and `FinancialHealthFigures` types match backend serde shapes

**Given** `hooks/useFinancialHealth.ts`
**When** hooks are used
**Then** `useFinancialHealthSummary` and `useFinancialHealthDetail` use `queryKeys.financialHealth`
**And** invalidation is wired for account CRUD/balance updates, expense mutations, income mutations, and `set_emergency_fund_target`

### Story 21.3: FinancialHealthCard Dashboard Integration

As a user,
I want to see my financial health summary on the dashboard when I open the app,
So that I know my emergency fund status, savings rate, and next best action without navigating away.

**Acceptance Criteria:**

**Given** the dashboard in `routes/index.tsx`
**When** rendered
**Then** `FinancialHealthCard` appears full-width above Top Categories by Spending (UX-DR1, FR89)
**And** the card title reads "Financial Health" with "View details →" footer link

**Given** sufficient financial data exists
**When** the card loads via `useFinancialHealthSummary()`
**Then** three columns display: emergency fund months (monospace, one decimal, capped at "12+ mo"), savings rate % with signed surplus/deficit, and next-best-action line from `action_line_key`
**And** emergency fund shows thin progress bar with target marker (e.g., "│6mo")
**And** status colors follow UX-DR7: teal (funded), amber (approaching ≥50%), rose (underfunded or deficit)
**And** dashboard renders within 1 second on subsequent visits including this card (NFR1)

**Given** the card
**When** rendered
**Then** persistent disclaimer footnote displays from `financialHealth.disclaimer` i18n key (NFR22)
**And** entire card is clickable with `role="link"` and `aria-label` summarizing all three stats and the action (UX-DR10)
**And** clicking navigates to `/net-worth/financial-health`

**Given** insufficient data (no accounts or no expense history)
**When** the card renders
**Then** muted prompt shows "Add accounts and a few expenses to see your financial health." with link to Import/Onboarding (UX-DR8)

**Given** accounts and expenses exist but no income recorded
**When** the card renders
**Then** emergency fund column still displays
**And** savings rate column shows "Add income to see savings rate" with link to Income page

**Given** the card is loading
**When** data is fetching
**Then** skeleton displays matching 3-column layout (`data-testid="financial-health-skeleton"`)

**Given** the values privacy toggle is enabled (FR76)
**When** monetary values appear on the card
**Then** surplus/deficit amounts are masked within 100ms of toggle (NFR17, UX-DR11)

**Given** account balance, expense, or income mutations occur elsewhere in the app
**When** the user is on or returns to the dashboard
**Then** financial health summary refreshes via TanStack Query invalidation

**Given** recommendation changes between visits
**When** the user opens the dashboard
**Then** the action line updates calmly with no toast or badge (UX-DR9)

---

## Epic 22: Financial Health Planning View

Users explore the full financial health picture under Net Worth — adjust their emergency fund target, read the priority waterfall with traceable "Why?" reasoning, and see savings capacity trends with top discretionary categories.

### Story 22.1: Net Worth Layout Refactor & Section Navigation

As a user,
I want to access Financial Health as a section within the Net Worth page,
So that wealth planning stays grouped without adding another top-level navigation item.

**Acceptance Criteria:**

**Given** the current `routes/net-worth.tsx`
**When** refactored per architecture D8
**Then** it becomes a layout route with `<Outlet />` and `NetWorthSectionNav` at the top
**And** existing net worth trend content moves to `routes/net-worth.index.tsx` unchanged in behavior
**And** `routes/net-worth.financial-health.tsx` is registered at `/net-worth/financial-health` (FR88)

**Given** `NetWorthSectionNav`
**When** rendered on the Net Worth page
**Then** segmented control shows **Net Worth** · **Financial Health** (UX-DR2, UX-DR3)
**And** section sub-nav is visually distinct from period PillTabs (6M / 1Y / ALL) which remain scoped inside the Net Worth index view only
**And** no new `InnerTabNav` item or sidebar entry is added

**Given** the Financial Health section route
**When** active
**Then** subtitle "Where your money should go next" displays (muted)
**And** no primary action button appears (insight view, not data entry)
**And** navigation between sections completes instantly (NFR2)

**Given** the dashboard `FinancialHealthCard` "View details" link
**When** clicked
**Then** user lands on `/net-worth/financial-health` with Financial Health section active

**Given** insufficient data on the section page
**When** rendered
**Then** centered `Compass` icon empty state shows with title, description, and CTA to Import (UX-DR8)

### Story 22.2: Emergency Fund Panel & Target Configuration

As a user,
I want to see my full emergency fund status and adjust my target months,
So that I can track progress toward the buffer size I want.

**Acceptance Criteria:**

**Given** the Financial Health section with sufficient data
**When** `EmergencyFundPanel` renders
**Then** hero monospace months display (one decimal, "12+ mo" cap) with horizontal progress bar and target marker (UX-DR4, FR83 detail)
**And** math sub-line shows "$X liquid savings ÷ $Y average monthly expenses" using `figures` from detail response (NFR20)
**And** status colors match UX-DR7 (teal/amber/rose)

**Given** the target months display
**When** the user clicks the value
**Then** inline edit activates (AccountRow pattern) with stepper/input (FR84)
**And** helper text shows "3–6 months is a common guideline"
**And** default is 6 months when config key is unset

**Given** a valid target (1–24 months)
**When** the user saves via Enter
**Then** `set_emergency_fund_target` persists the value
**And** success toast shows `financialHealth.toast.targetUpdated` (UX-DR15)
**And** emergency fund progress and waterfall recalculate immediately
**And** both summary and detail query keys invalidate

**Given** an invalid target (0, 25, empty)
**When** the user attempts save
**Then** inline field error displays per standard form pattern (UX-DR15)
**And** no config write occurs

**Given** the values privacy toggle
**When** monetary values appear in the math sub-line
**Then** amounts respect hide/show masking (NFR17)

### Story 22.3: Action Waterfall & Savings Capacity Panels

As a user,
I want to see the full priority waterfall with reasoning and my savings capacity trends,
So that I understand why a recommendation was made and where I could improve.

**Acceptance Criteria:**

**Given** the Financial Health section with sufficient data
**When** `ActionWaterfall` renders
**Then** a 4-rung vertical ladder displays (FR86, UX-DR5):
1. Build emergency fund
2. Pay down high-interest debt
3. Contribute to registered accounts (TFSA/RRSP/FHSA)
4. Invest your surplus

**Given** waterfall rung states
**When** rendered
**Then** completed rungs show check icon and muted/positive tone
**And** current rung is highlighted with teal accent ring, bold label, and expandable "Why?" disclosure
**And** future rungs show muted `○` marker
**And** `current_step` and `completed_steps` come from backend only — frontend never re-implements ladder logic

**Given** the user expands "Why?" on the current rung
**When** disclosure opens
**Then** plain-language reasoning interpolates `reasoning_key` and `reasoning_params` from i18n templates citing user-specific figures (NFR20, FR87)
**And** copy never names securities, products, allocation percentages, or projected returns

**Given** `SavingsCapacityPanel` renders
**When** sufficient income and expense history exists
**Then** savings rate (integer %) and trailing-average surplus/deficit display (FR85)
**And** sparkline or mini-bar shows monthly surplus trend for last 6 trailing months (UX-DR6)
**And** top 2–3 discretionary categories list with amounts, framed as "where you could free up capacity" — neutral tone

**Given** fewer than 1 month of expense data for savings trend
**When** the panel renders
**Then** message shows "Track a full month to see your savings trend." (UX-DR8)

**Given** all top categories are essential (denylist filters all)
**When** discretionary list renders
**Then** fewer than 3 items or empty list displays with explanatory copy

**Given** `FinancialHealthDisclaimer` component
**When** the section renders
**Then** persistent muted footnote displays shared `financialHealth.disclaimer` key (NFR22)

### Story 22.4: i18n, Values Privacy & Playwright E2E

As a developer,
I want complete localization and automated E2E coverage of the financial health workflow,
So that the module ships reliably in EN and FR with regression protection.

**Acceptance Criteria:**

**Given** `en.json` and `fr.json`
**When** the financial health module renders
**Then** all keys exist under `financialHealth.*` and `netWorth.section.financialHealth` with no missing keys in shipped views (NFR16, UX-DR13)
**And** `financialHealth.waterfall.reasoning.*` templates exist for each `reasoning_key` with EN and FR interpolation placeholders
**And** `financialHealth.disclaimer` is identical copy in both locales

**Given** the values privacy toggle (FR76)
**When** toggled on any view in the financial health module
**Then** all monetary displays mask within 100ms including card, math sub-line, surplus trend, and discretionary category amounts (NFR17)

**Given** Playwright test `apps/desktop/tests/financial-health.spec.ts`
**When** the test runs
**Then** it seeds accounts, expenses, and income entries with known values
**And** verifies dashboard `FinancialHealthCard` stats match expected emergency fund months, savings rate, and action line
**And** navigates to Net Worth → Financial Health section
**And** verifies `EmergencyFundPanel`, `ActionWaterfall`, and `SavingsCapacityPanel` render
**And** edits emergency fund target and verifies waterfall current-rung shift
**And** verifies disclaimer appears on both card and section (UX-DR14)

**Given** the onboarding wizard
**When** reviewed
**Then** no financial health step is added (UX-DR12)

**Given** AI chat commands
**When** reviewed
**Then** `commands/chat.rs` is not modified — conversational advisor deferred to Phase 3
