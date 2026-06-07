# Story 22.3: Action Waterfall & Savings Capacity Panels

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see the full priority waterfall with reasoning and my savings capacity trends,
So that I understand why a recommendation was made and where I could improve.

**Scope:** `ActionWaterfall`, `SavingsCapacityPanel`, `FinancialHealthDisclaimer` on Financial Health section; waterfall/savings i18n keys (EN + FR). No full i18n/privacy pass (Story 22.4), no dedicated `financial-health.spec.ts` (Story 22.4).

## Acceptance Criteria

1. **Given** the Financial Health section with sufficient data  
   **When** `ActionWaterfall` renders  
   **Then** a 4-rung vertical ladder displays (FR86, UX-DR5):
   1. Build emergency fund
   2. Pay down high-interest debt
   3. Contribute to registered accounts (TFSA/RRSP/FHSA)
   4. Invest your surplus  
   **And** `current_step` and `completed_steps` come from backend only — frontend never re-implements ladder logic

2. **Given** waterfall rung states  
   **When** rendered  
   **Then** completed rungs show check icon and muted/positive tone  
   **And** current rung is highlighted with teal accent ring, bold label, and expandable "Why?" disclosure  
   **And** future rungs show muted `○` marker

3. **Given** the user expands "Why?" on the current rung  
   **When** disclosure opens  
   **Then** plain-language reasoning interpolates `reasoning_key` and `reasoning_params` from i18n templates citing user-specific figures (NFR20, FR87)  
   **And** copy never names securities, products, allocation percentages, or projected returns

4. **Given** `SavingsCapacityPanel` renders  
   **When** sufficient income and expense history exists  
   **Then** savings rate (integer %) and trailing-average surplus/deficit display (FR85)  
   **And** sparkline or mini-bar shows monthly surplus trend for last 6 trailing months (UX-DR6)  
   **And** top 2–3 discretionary categories list with amounts, framed as "where you could free up capacity" — neutral tone

5. **Given** fewer than 1 month of expense data for savings trend  
   **When** the panel renders  
   **Then** message shows "Track a full month to see your savings trend." (UX-DR8)

6. **Given** all top categories are essential (denylist filters all)  
   **When** discretionary list renders  
   **Then** fewer than 3 items or empty list displays with explanatory copy

7. **Given** `FinancialHealthDisclaimer` component  
   **When** the section renders  
   **Then** persistent muted footnote displays shared `financialHealth.disclaimer` key (NFR22)

## Tasks / Subtasks

- [x] Task 1: `ActionWaterfall` component (AC: #1, #2, #3)
  - [x] Create `components/financial-health/ActionWaterfall.tsx`
  - [x] Use `useFinancialHealthDetail()` for `waterfall` detail payload
  - [x] Render 4-rung vertical ladder with completed/current/future states from backend only
  - [x] Expandable "Why?" on current rung with `reasoning_key` + `reasoning_params` i18n
  - [x] Format currency/months in reasoning via `useFormatCurrency` (NFR17)
  - [x] `data-testid` attributes for panel, rungs, why toggle, reasoning

- [x] Task 2: `SavingsCapacityPanel` component (AC: #4, #5, #6)
  - [x] Create `components/financial-health/SavingsCapacityPanel.tsx`
  - [x] Savings rate %, surplus/deficit with privacy-aware currency
  - [x] Mini-bar trend for `monthly_surplus_trend` (6 trailing months)
  - [x] Top discretionary categories with neutral framing
  - [x] Empty states for insufficient trend data and no discretionary categories
  - [x] `data-testid` attributes for panel, rate, surplus, trend, categories

- [x] Task 3: `FinancialHealthDisclaimer` + section integration (AC: #7)
  - [x] Create `components/financial-health/FinancialHealthDisclaimer.tsx`
  - [x] Update `net-worth.financial-health.tsx` — EmergencyFund → ActionWaterfall → SavingsCapacity → Disclaimer
  - [x] Replace inline disclaimer paragraph with shared component

- [x] Task 4: i18n keys (AC: #1–#6)
  - [x] Add `financialHealth.waterfall.*` step labels, "Why?", reasoning templates to `en.json` and `fr.json`
  - [x] Add `financialHealth.panel.savingsCapacity.*` keys to both locales

- [x] Task 5: Tests & quality gates (AC: all)
  - [x] Update `tests/net-worth.spec.ts` — mock detail with waterfall/savings data; panel render, why disclosure, savings trend
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
  - [x] Playwright net-worth tests (22/22 pass)

## Dev Notes

### Critical Architecture Rules

- **No client-side waterfall logic** — display `current_step`, `completed_steps`, `reasoning_key`, `reasoning_params` from detail response only
- **Detail hook for panels** — `useFinancialHealthDetail()` for waterfall, savings trend, discretionary categories
- **Reasoning i18n** — resolve `financialHealth.waterfall.reasoning.{reasoning_key}` with interpolated formatted figures (NFR20)
- **FR87 guardrail** — reasoning templates cite account types and categories only; no securities, products, allocations, or returns
- **Savings trend gate** — use `figures.expense_month_count < 1` for "Track a full month" empty state (UX-DR8)
- **Discretionary fallback** — empty or short list when essential denylist filters all categories (D5)
- **Disclaimer reuse** — `FinancialHealthDisclaimer` uses single `financialHealth.disclaimer` key (NFR22); card keeps its own inline copy until Story 22.4

### Waterfall Step Order (display only)

```typescript
const WATERFALL_STEPS: WaterfallStep[] = [
  "build_emergency_fund",
  "pay_high_interest_debt",
  "contribute_registered_accounts",
  "invest_surplus",
];
```

### Reasoning Keys (from evaluator)

| Key | When |
|-----|------|
| `build_emergency_fund` | Coverage below target |
| `pay_debt` | Fund met, CC debt > 0 |
| `contribute_registered` | Fund + debt clear, surplus > 0 |
| `invest_surplus` | Terminal / no surplus |

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 22.3]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ActionWaterfall, SavingsCapacityPanel]
- [Source: _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md — D5, D6, D10]
- [Source: _bmad-output/implementation-artifacts/22-2-emergency-fund-panel-and-target-configuration.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

### Completion Notes List

- Created `ActionWaterfall` with 4-rung ladder, backend-driven states, expandable Why? with reasoning i18n interpolation
- Created `SavingsCapacityPanel` with savings rate, surplus, mini-bar trend, discretionary categories, empty states
- Created `FinancialHealthDisclaimer` shared component; wired all panels into Financial Health section route
- Added waterfall + savings panel i18n keys (en/fr); 3 new Playwright tests (22/22 pass)

### File List

- `apps/desktop/src/components/financial-health/ActionWaterfall.tsx` — waterfall panel (new)
- `apps/desktop/src/components/financial-health/SavingsCapacityPanel.tsx` — savings panel (new)
- `apps/desktop/src/components/financial-health/FinancialHealthDisclaimer.tsx` — disclaimer component (new)
- `apps/desktop/src/routes/net-worth.financial-health.tsx` — wires all panels + disclaimer
- `apps/desktop/src/locales/en.json` — waterfall + savings panel keys
- `apps/desktop/src/locales/fr.json` — waterfall + savings panel keys
- `apps/desktop/tests/net-worth.spec.ts` — detail mock enrichment + 3 panel tests
- `_bmad-output/implementation-artifacts/22-3-action-waterfall-and-savings-capacity-panels.md` — story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story → review

### Change Log

- 2026-06-06: Story 22.3 implemented — Action Waterfall, Savings Capacity panels, disclaimer, i18n, tests
