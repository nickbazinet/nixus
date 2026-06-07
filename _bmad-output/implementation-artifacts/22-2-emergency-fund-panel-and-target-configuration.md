# Story 22.2: Emergency Fund Panel & Target Configuration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see my full emergency fund status and adjust my target months,
So that I can track progress toward the buffer size I want.

**Scope:** `EmergencyFundPanel` on Financial Health section, inline-editable target months (FR84), math sub-line from detail `figures` (NFR20), toast on save, i18n panel keys. No waterfall or savings panels (Story 22.3), no full i18n pass (Story 22.4).

## Acceptance Criteria

1. **Given** the Financial Health section with sufficient data  
   **When** `EmergencyFundPanel` renders  
   **Then** hero monospace months display (one decimal, "12+ mo" cap) with horizontal progress bar and target marker (UX-DR4, FR83 detail)  
   **And** math sub-line shows "$X liquid savings ÷ $Y average monthly expenses" using `figures` from detail response (NFR20)  
   **And** status colors match UX-DR7 (teal/amber/rose)

2. **Given** the target months display  
   **When** the user clicks the value  
   **Then** inline edit activates (AccountRow pattern) with stepper/input (FR84)  
   **And** helper text shows "3–6 months is a common guideline"  
   **And** default is 6 months when config key is unset

3. **Given** a valid target (1–24 months)  
   **When** the user saves via Enter  
   **Then** `set_emergency_fund_target` persists the value  
   **And** success toast shows `financialHealth.toast.targetUpdated` (UX-DR15)  
   **And** emergency fund progress recalculates immediately  
   **And** both summary and detail query keys invalidate

4. **Given** an invalid target (0, 25, empty)  
   **When** the user attempts save  
   **Then** inline field error displays per standard form pattern (UX-DR15)  
   **And** no config write occurs

5. **Given** the values privacy toggle  
   **When** monetary values appear in the math sub-line  
   **Then** amounts respect hide/show masking (NFR17)

## Tasks / Subtasks

- [x] Task 1: `EmergencyFundPanel` component (AC: #1, #2, #5)
  - [x] Create `components/financial-health/EmergencyFundPanel.tsx`
  - [x] Use `useFinancialHealthDetail()` for panel data + `figures`
  - [x] Hero months (monospace, one decimal, "12+ mo" cap), progress bar, target marker
  - [x] Math sub-line with `useFormatCurrency` for privacy (NFR17)
  - [x] Status colors teal/amber/rose per `EmergencyFundStatus`
  - [x] Inline-editable target months (AccountRow click-to-edit pattern)
  - [x] Helper text "3–6 months is a common guideline"
  - [x] `data-testid` attributes for panel, months, progress, target, math line

- [x] Task 2: Target save mutation (AC: #3, #4)
  - [x] Wire `useSetEmergencyFundTarget()` on valid save
  - [x] Client validation 1–24 inclusive; inline error on invalid
  - [x] Toast `financialHealth.toast.targetUpdated` on success
  - [x] Enter saves, Escape cancels (AccountRow pattern)

- [x] Task 3: Financial Health section integration (AC: #1)
  - [x] Update `net-worth.financial-health.tsx` to render `EmergencyFundPanel` when data sufficient
  - [x] Keep disclaimer footnote below panel

- [x] Task 4: i18n keys (AC: #1–#4)
  - [x] Add `financialHealth.panel.emergencyFund.*`, `financialHealth.toast.targetUpdated`, validation keys to `en.json` and `fr.json`

- [x] Task 5: Tests & quality gates (AC: all)
  - [x] Update `tests/net-worth.spec.ts` — mock `get_financial_health_detail`, panel render, target edit, toast, validation
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
  - [x] Playwright net-worth tests (19/19 pass)

## Dev Notes

### Critical Architecture Rules

- **Detail hook for panel** — use `useFinancialHealthDetail()` for `figures` math sub-line; summary hook stays on route for sufficiency gate
- **No client-side waterfall logic** — panel only displays emergency fund; waterfall deferred to Story 22.3
- **Reuse card patterns** — progress bar, target marker, months cap, status colors match `FinancialHealthCard` (Story 21.3)
- **Inline edit pattern** — follow `AccountRow`: click span → input, Enter save, Escape cancel, dashed underline on hover
- **Invalidation** — `useSetEmergencyFundTarget` already invalidates `queryKeys.financialHealth` (summary + detail)
- **Target validation** — 1–24 inclusive client-side; backend also validates via `AppError::Validation`

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 22.2]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — EmergencyFundPanel]
- [Source: _bmad-output/implementation-artifacts/22-1-net-worth-layout-refactor-and-section-navigation.md]
- [Source: _bmad-output/implementation-artifacts/21-2-financial-health-ipc-commands-types-and-hooks.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Playwright tests initially used `.locator("input")` on base-ui Input; fixed by targeting `data-testid` directly on Input element

### Completion Notes List

- Created `EmergencyFundPanel` with hero months, progress bar, inline-editable target at marker, math sub-line, guideline helper
- Integrated panel on Financial Health section route with disclaimer below
- Wired `useSetEmergencyFundTarget` with client validation 1–24, toast, query invalidation
- Added panel i18n keys (en/fr) and 5 Playwright tests for panel + target edit flows

### File List

- `apps/desktop/src/components/financial-health/EmergencyFundPanel.tsx` — panel component (new)
- `apps/desktop/src/routes/net-worth.financial-health.tsx` — renders panel when data sufficient
- `apps/desktop/src/locales/en.json` — panel + toast + validation keys
- `apps/desktop/src/locales/fr.json` — panel + toast + validation keys
- `apps/desktop/tests/net-worth.spec.ts` — detail mock + panel/target edit tests
- `_bmad-output/implementation-artifacts/22-2-emergency-fund-panel-and-target-configuration.md` — story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story → review

### Change Log

- 2026-06-06: Story 22.2 implemented — Emergency Fund panel, target configuration, i18n, tests
