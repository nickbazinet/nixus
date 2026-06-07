# Story 21.3: FinancialHealthCard Dashboard Integration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see my financial health summary on the dashboard when I open the app,
So that I know my emergency fund status, savings rate, and next best action without navigating away.

**Scope:** `FinancialHealthCard` component, dashboard placement, card-level i18n keys (`financialHealth.*`), loading/empty states, values-privacy on monetary displays. No Net Worth section refactor (Story 22.1) or full i18n (Story 22.4).

## Acceptance Criteria

1. **Given** the dashboard in `routes/index.tsx`  
   **When** rendered  
   **Then** `FinancialHealthCard` appears full-width directly after `CashFlowSummaryCard` and before `YearToDateCard` (UX-DR1, FR89)  
   **And** the card title reads "Financial Health" with "View details →" footer link

2. **Given** sufficient financial data exists  
   **When** the card loads via `useFinancialHealthSummary()`  
   **Then** three columns display: emergency fund months (monospace, one decimal, capped at "12+ mo"), savings rate % with signed surplus/deficit, and next-best-action line from `action_line_key`  
   **And** emergency fund shows thin progress bar with target marker (e.g., "│6mo")  
   **And** status colors follow UX-DR7: teal (funded), amber (approaching ≥50%), rose (underfunded or deficit)  
   **And** dashboard renders within 1 second on subsequent visits including this card (NFR1)

3. **Given** the card  
   **When** rendered  
   **Then** persistent disclaimer footnote displays from `financialHealth.disclaimer` i18n key (NFR22)  
   **And** entire card is clickable with `role="link"` and `aria-label` summarizing all three stats and the action (UX-DR10)  
   **And** clicking navigates to `/net-worth/financial-health`

4. **Given** insufficient data (no accounts or no expense history)  
   **When** the card renders  
   **Then** muted prompt shows "Add accounts and a few expenses to see your financial health." with link to Import/Onboarding (UX-DR8)

5. **Given** accounts and expenses exist but no income recorded  
   **When** the card renders  
   **Then** emergency fund column still displays  
   **And** savings rate column shows "Add income to see savings rate" with link to Income page

6. **Given** the card is loading  
   **When** data is fetching  
   **Then** skeleton displays matching 3-column layout (`data-testid="financial-health-skeleton"`)

7. **Given** the values privacy toggle is enabled (FR76)  
   **When** monetary values appear on the card  
   **Then** surplus/deficit amounts are masked via `useFormatCurrency` (NFR17, UX-DR11)

8. **Given** account balance, expense, or income mutations occur elsewhere in the app  
   **When** the user is on or returns to the dashboard  
   **Then** financial health summary refreshes via TanStack Query invalidation (wired in Story 21.2)

9. **Given** recommendation changes between visits  
   **When** the user opens the dashboard  
   **Then** the action line updates calmly with no toast or badge (UX-DR9)

## Tasks / Subtasks

- [x] Task 1: `FinancialHealthCard` component (AC: #1–#7, #9)
  - [x] Create `components/dashboard/FinancialHealthCard.tsx`
  - [x] Use `useFinancialHealthSummary()` hook
  - [x] 3-column layout: emergency fund, savings rate, next best action
  - [x] Progress bar with target marker; months display capped at "12+ mo"
  - [x] Status colors: teal/amber/rose per `EmergencyFundStatus` and deficit
  - [x] Loading skeleton (`data-testid="financial-health-skeleton"`)
  - [x] Empty state (insufficient data) → link to `/import`
  - [x] No-income savings column → link to `/income` with `stopPropagation`
  - [x] `role="link"`, composed `aria-label`, navigate to `/net-worth/financial-health`
  - [x] Disclaimer footnote from `financialHealth.disclaimer`
  - [x] Monetary values via `useFormatCurrency` (privacy toggle)

- [x] Task 2: Dashboard integration (AC: #1)
  - [x] Import and render `FinancialHealthCard` in `routes/index.tsx` after `CashFlowSummaryCard`, before `YearToDateCard`

- [x] Task 3: i18n keys (AC: #1–#5)
  - [x] Add `financialHealth.card.*`, `financialHealth.disclaimer`, `financialHealth.empty.*` to `en.json` and `fr.json`
  - [x] Action line keys: `financialHealth.card.action.{build_emergency_fund,pay_debt,contribute_registered,invest_surplus}`

- [x] Task 4: Tests & quality gates (AC: all)
  - [x] Update `tests/dashboard.spec.ts` mocks with `get_financial_health_summary`
  - [x] Add Playwright tests for card visibility, skeleton, empty state, placement, and navigation
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
  - [x] Dashboard Playwright tests (22/22 pass); full suite 209/236 pass (27 pre-existing failures unrelated to this story)

## Dev Notes

### Critical Architecture Rules

- **No client-side waterfall logic** — render `action_line_key` via i18n only; hooks invoke IPC (Story 21.2)
- **Emergency fund status** — backend returns `status`: `funded` / `approaching` / `underfunded`; map to teal/amber/rose
- **`progress_ratio`** — `coverage_months / target_months`; bar fill capped at 100%; target marker at bar end ("│{target}mo")
- **Months display** — one decimal monospace; cap at "12+ mo" when `coverage_months >= 12`
- **Savings null semantics** — `savings_rate_percent` and `avg_monthly_surplus_cents` null when no income; emergency fund still shown
- **Route target** — `/net-worth/financial-health` (minimal placeholder route; Story 22.1 replaces with full section layout)
- **Reuse patterns** — `CashFlowSummaryCard` for full-width clickable card, `role="link"`, hover ring; `useFormatCurrency` for privacy

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 21.3]
- [Source: _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md — FinancialHealthCard placement]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Dashboard FinancialHealthCard anatomy]
- [Source: _bmad-output/implementation-artifacts/21-2-financial-health-ipc-commands-types-and-hooks.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright `addInitScript` second-arg serialization failed for health mock object; inlined mock in browser context instead

### Completion Notes List

- Created `FinancialHealthCard` with 3-column layout, status colors, progress bar with target marker, disclaimer, skeleton/empty/no-income states
- Integrated card on dashboard between CashFlowSummaryCard and YearToDateCard
- Added EN/FR i18n keys under `financialHealth.*` for card display
- Added minimal `/net-worth/financial-health` placeholder route for card navigation (Story 22.1 will replace)
- Extended dashboard Playwright tests with 5 new financial health card cases
- Quality gates: `tsc --noEmit` pass; dashboard tests 22/22 pass

### File List

- apps/desktop/src/components/dashboard/FinancialHealthCard.tsx
- apps/desktop/src/routes/index.tsx
- apps/desktop/src/routes/net-worth.financial-health.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/dashboard.spec.ts
- _bmad-output/implementation-artifacts/21-3-financial-health-card-dashboard-integration.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-06-06: Implemented FinancialHealthCard dashboard integration with i18n, tests, and placeholder financial health route
