# Story 22.1: Net Worth Layout Refactor & Section Navigation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to access Financial Health as a section within the Net Worth page,
So that wealth planning stays grouped without adding another top-level navigation item.

**Scope:** Net Worth route layout refactor (D8), `NetWorthSectionNav` segmented control, move existing trend content to index route, Financial Health section route with subtitle and empty state. No panels (Story 22.2–22.3), no full i18n pass (Story 22.4).

## Acceptance Criteria

1. **Given** the current `routes/net-worth.tsx`  
   **When** refactored per architecture D8  
   **Then** it becomes a layout route with `<Outlet />` and `NetWorthSectionNav` at the top  
   **And** existing net worth trend content moves to `routes/net-worth.index.tsx` unchanged in behavior  
   **And** `routes/net-worth.financial-health.tsx` is registered at `/net-worth/financial-health` (FR88)

2. **Given** `NetWorthSectionNav`  
   **When** rendered on the Net Worth page  
   **Then** segmented control shows **Net Worth** · **Financial Health** (UX-DR2, UX-DR3)  
   **And** section sub-nav is visually distinct from period PillTabs (6M / 1Y / ALL) which remain scoped inside the Net Worth index view only  
   **And** no new `InnerTabNav` item or sidebar entry is added

3. **Given** the Financial Health section route  
   **When** active  
   **Then** subtitle "Where your money should go next" displays (muted)  
   **And** no primary action button appears (insight view, not data entry)  
   **And** navigation between sections completes instantly (NFR2)

4. **Given** the dashboard `FinancialHealthCard` "View details" link  
   **When** clicked  
   **Then** user lands on `/net-worth/financial-health` with Financial Health section active

5. **Given** insufficient data on the section page  
   **When** rendered  
   **Then** centered `Compass` icon empty state shows with title, description, and CTA to Import (UX-DR8)

## Tasks / Subtasks

- [x] Task 1: Layout refactor (AC: #1)
  - [x] Convert `net-worth.tsx` to layout with `PageHeader`, `NetWorthSectionNav`, `<Outlet />`
  - [x] Create `net-worth.index.tsx` — move existing trend/breakdown content unchanged
  - [x] Ensure TanStack Router file tree registers index + financial-health child routes

- [x] Task 2: `NetWorthSectionNav` component (AC: #2)
  - [x] Create `components/financial-health/NetWorthSectionNav.tsx`
  - [x] Segmented control styling (bordered container) distinct from `PillTabs`
  - [x] Link-based navigation to `/net-worth` and `/net-worth/financial-health`
  - [x] `data-testid="net-worth-section-nav"` and per-section test IDs

- [x] Task 3: Financial Health section route (AC: #3, #5)
  - [x] Replace placeholder in `net-worth.financial-health.tsx`
  - [x] Conditional subtitle via layout `PageHeader` when section active
  - [x] `useFinancialHealthSummary()` for data sufficiency check
  - [x] Compass empty state with Import CTA (`data-testid="financial-health-section-empty"`)
  - [x] Disclaimer footnote when data sufficient (panels deferred to 22.2)

- [x] Task 4: i18n keys (AC: #2, #3, #5)
  - [x] Add `netWorth.section.financialHealth`, `financialHealth.section.subtitle`, `financialHealth.empty.section*` to `en.json` and `fr.json`

- [x] Task 5: Tests & quality gates (AC: all)
  - [x] Update `tests/net-worth.spec.ts` — section nav visibility, navigation, subtitle, empty state
  - [x] Verify dashboard card navigation still lands on financial-health (existing test)
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` — zero errors
  - [x] Playwright net-worth tests (14/14 pass)

## Dev Notes

### Critical Architecture Rules

- **D8 layout pattern** — follow `car.tsx` / `car.index.tsx` layout + index split; `net-worth.tsx` is layout only
- **No new `InnerTabNav` item** — section sub-nav lives inside Net Worth layout only
- **Period PillTabs stay in index** — 6M/1Y/ALL never appear on Financial Health section
- **Section sub-nav vs period tabs** — segmented control (bordered) vs loose pill buttons; different visual hierarchy
- **Dashboard entry** — `FinancialHealthCard` already links to `/net-worth/financial-health` (Story 21.3)
- **Empty state** — Compass icon pattern matches `assets.tsx` / `accounts.tsx` empty states
- **Panels deferred** — Story 22.2 adds `EmergencyFundPanel`; 22.3 adds waterfall and savings panels

### References

- [Source: _bmad-output/planning-artifacts/epics-financial-decision-intelligence.md — Story 22.1]
- [Source: _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md — D8]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Navigation: Sub-view Under Net Worth]
- [Source: _bmad-output/implementation-artifacts/21-3-financial-health-card-dashboard-integration.md]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Fixed pre-existing Playwright test IDs: `period-tab-*` → `period-tabs-*` to match `PillTabs` component

### Completion Notes List

- Refactored `net-worth.tsx` into layout route with `PageHeader`, `NetWorthSectionNav`, and `<Outlet />`
- Moved trend/breakdown content to `net-worth.index.tsx` unchanged in behavior
- Created `NetWorthSectionNav` segmented control (bordered container, distinct from `PillTabs`)
- Financial Health section shows subtitle, Compass empty state, and disclaimer when data sufficient
- Dashboard card navigation to `/net-worth/financial-health` unchanged (Story 21.3)
- No new `InnerTabNav` or sidebar entry

### File List

- `apps/desktop/src/routes/net-worth.tsx` — layout route
- `apps/desktop/src/routes/net-worth.index.tsx` — net worth trend view (new)
- `apps/desktop/src/routes/net-worth.financial-health.tsx` — financial health section
- `apps/desktop/src/components/financial-health/NetWorthSectionNav.tsx` — section sub-nav (new)
- `apps/desktop/src/routeTree.gen.ts` — auto-regenerated
- `apps/desktop/src/locales/en.json` — section nav + empty state keys
- `apps/desktop/src/locales/fr.json` — section nav + empty state keys
- `apps/desktop/tests/net-worth.spec.ts` — section nav + financial health tests
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — epic-22 in-progress, story review

### Change Log

- 2026-06-06: Story 22.1 implemented — Net Worth layout refactor, section navigation, Financial Health route
