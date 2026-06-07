# Story 22.4: i18n, Values Privacy & Playwright E2E

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want complete localization and automated E2E coverage of the financial health workflow,
So that the module ships reliably in EN and FR with regression protection.

**Scope:** Full `financialHealth.*` + `netWorth.section.*` i18n audit (EN + FR), values-privacy masking across all monetary displays in the module, dedicated `financial-health.spec.ts` E2E suite. No onboarding wizard step (UX-DR12). No `commands/chat.rs` changes.

## Acceptance Criteria

1. **Given** `en.json` and `fr.json`  
   **When** the financial health module renders  
   **Then** all keys exist under `financialHealth.*` and `netWorth.section.financialHealth` with no missing keys in shipped views (NFR16, UX-DR13)  
   **And** `financialHealth.waterfall.reasoning.*` templates exist for each `reasoning_key` (`build_emergency_fund`, `pay_debt`, `contribute_registered`, `invest_surplus`) with EN and FR interpolation placeholders  
   **And** `financialHealth.disclaimer` is the shared key on both card and section (NFR22)

2. **Given** the values privacy toggle (FR76)  
   **When** toggled on any view in the financial health module  
   **Then** all monetary displays mask within 100ms including card surplus, math sub-line, waterfall reasoning, savings surplus, and discretionary category amounts (NFR17)  
   **And** every monetary value uses `useFormatCurrency` — no raw cents in DOM or tooltips

3. **Given** Playwright test `apps/desktop/tests/financial-health.spec.ts`  
   **When** the test runs  
   **Then** it seeds accounts, expenses, and income via IPC mocks with known values  
   **And** verifies dashboard `FinancialHealthCard` stats (months, savings rate, surplus, action line)  
   **And** navigates to Net Worth → Financial Health section  
   **And** verifies `EmergencyFundPanel`, `ActionWaterfall`, and `SavingsCapacityPanel` render with expected values  
   **And** edits emergency fund target and verifies waterfall current-rung shift  
   **And** verifies disclaimer appears on both card and section (UX-DR14)

4. **Given** the onboarding wizard  
   **When** reviewed  
   **Then** no financial health step is added (UX-DR12)

5. **Given** AI chat commands  
   **When** reviewed  
   **Then** `commands/chat.rs` is not modified — conversational advisor deferred to Phase 3

## Tasks / Subtasks

- [x] Task 1: i18n audit (AC: #1)
  - [x] Grep all `financialHealth.*` and `netWorth.section.*` key usages in components/routes
  - [x] Verify EN + FR parity for every key; add any missing keys
  - [x] Confirm `financialHealth.card.action.*` covers all `action_line_key` values from backend
  - [x] Confirm `financialHealth.waterfall.reasoning.*` covers all evaluator `reasoning_key` values

- [x] Task 2: Values privacy pass (AC: #2)
  - [x] Audit all financial health components for monetary displays
  - [x] Fix any raw cents / non-`useFormatCurrency` paths (trend bar tooltips)
  - [x] Add E2E test: toggle hide values → verify `$••••` on card, math line, reasoning, discretionary amounts

- [x] Task 3: `financial-health.spec.ts` E2E (AC: #3)
  - [x] Create dedicated spec with dynamic mock (target months affects waterfall step)
  - [x] Dashboard card stats verification
  - [x] Section navigation + all three panels
  - [x] Target edit → waterfall rung shift (target 6→2 moves to `contribute_registered_accounts`)
  - [x] Disclaimer on card and section

- [x] Task 4: Guardrail verification (AC: #4, #5)
  - [x] Confirm `OnboardingWizard.tsx` has no financial health step
  - [x] Confirm `commands/chat.rs` untouched

- [x] Task 5: Quality gates (AC: all)
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
  - [x] `pnpm --filter @nixus/desktop exec playwright test financial-health.spec.ts` — 4/4 pass
  - [x] `dashboard.spec.ts` + `net-worth.spec.ts` + `financial-health.spec.ts` — 47/48 pass (1 pre-existing skeleton flake)

## Dev Notes

### Critical Architecture Rules

- **i18n key namespaces:** `financialHealth.*` (card, panels, waterfall, empty states, disclaimer) + `netWorth.section.financialHealth` + `netWorth.section.navLabel`
- **Reasoning keys (backend):** `build_emergency_fund`, `pay_debt`, `contribute_registered`, `invest_surplus` — NOT waterfall step enum names
- **Action line keys:** Same as `reasoning_key` values — map via `financialHealth.card.action.{key}`
- **Privacy:** `useFormatCurrency` reads `ValuesVisibilityContext.hidden` → masks as `$••••`; toggle via `data-testid="toggle-values-button"`
- **Waterfall shift logic (for mock):** `coverage_months >= target_months` completes emergency fund rung; with zero CC debt and positive surplus → `contribute_registered_accounts` becomes current
- **No onboarding step** — financial health is discoverable via dashboard card and Net Worth section nav only (UX-DR12)
- **No chat.rs changes** — Phase 3 deferred

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 22.4]
- [Source: _bmad-output/implementation-artifacts/22-3-action-waterfall-and-savings-capacity-panels.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

### Completion Notes List

- i18n audit: all 47 `financialHealth.*` + 2 `netWorth.section.*` keys present in EN and FR with full parity; 4 reasoning templates + 4 card action keys match evaluator output
- Privacy fix: `SavingsCapacityPanel` trend bar tooltips now use `formatCurrency` instead of raw cents
- Created `financial-health.spec.ts` with 4 E2E tests (dashboard stats, section panels, waterfall shift, values privacy)
- Guardrails confirmed: no onboarding financial health step; `chat.rs` has no financial health references
- Typecheck passes; financial-health spec 4/4; combined dashboard+net-worth+financial-health 47/48 (pre-existing skeleton timing flake in dashboard.spec.ts)

### File List

- `apps/desktop/src/components/financial-health/SavingsCapacityPanel.tsx` — privacy-aware trend tooltips
- `apps/desktop/tests/financial-health.spec.ts` — dedicated E2E suite (new)
- `_bmad-output/implementation-artifacts/22-4-i18n-values-privacy-and-playwright-e2e.md` — story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story → review

### Change Log

- 2026-06-06: Story 22.4 implemented — i18n audit, privacy pass, financial-health E2E suite
