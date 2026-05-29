---
title: 'Accounts Page Polish — Summary, Context, and Row Richness'
slug: 'accounts-page-polish'
created: '2026-05-26'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'React 19 / TanStack Router / TanStack Query'
  - 'i18next (en + fr translations)'
  - 'shadcn Card, Button, PageHeader patterns'
files_to_modify:
  - 'apps/desktop/src/lib/accountUtils.ts'
  - 'apps/desktop/src/components/accounts/AccountRow.tsx'
  - 'apps/desktop/src/routes/accounts.tsx'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/accounts.spec.ts'
code_patterns:
  - 'Assets page polish (assets.tsx — hero, Card, breakdown, net worth context, empty state)'
  - 'assetUtils.ts helper module (grouping, breakdown, icons, formatUpdatedAt)'
  - 'Net Worth hero number (32px monospace font-mono font-semibold)'
  - 'NetWorthBreakdownBar with titleKey prop'
  - 'useCurrentNetWorth for cross-page wealth context'
  - 'All money in cents, display via useFormatCurrency'
test_patterns:
  - 'Playwright E2E with __TAURI_INTERNALS__ invoke mocks (accounts.spec.ts pattern)'
  - 'Mock get_current_net_worth when testing net worth context line'
baseline_commit: 'c402cd6cccaa0c4daaadb3089e43b6241d921fb7'
context:
  - '.ralph/specs/planning-artifacts/ux-design-specification.md'
  - '.ralph/specs/implementation-artifacts/tech-spec-assets-page-polish.md'
---

# Tech-Spec: Accounts Page Polish — Summary, Context, and Row Richness

**Created:** 2026-05-26

## Overview

### Problem Statement

The Accounts page is functionally complete but feels empty compared to sibling pages (Assets, Net Worth, Year Summary). It shows a flat list with a small inline total, no card container, minimal empty state, no net worth context, no allocation breakdown, and rows hide institution and last-updated metadata.

### Solution

Elevate the Accounts page to parity with the polished Assets page and align with the UX spec's "spacious cards + hero numbers + maximum context" principle:

1. Hero total + type-grouped list inside a Card
2. Page subtitle + net worth contribution context with link to `/net-worth`
3. Card-wrapped empty state with explanatory copy and secondary CTAs (View Net Worth, Import Statement)
4. Mini allocation breakdown bar by account type
5. Richer rows: type icons, institution, last-updated date
6. Liabilities section separating credit cards from other accounts
7. Mixed-currency hint when CAD and USD accounts coexist
8. Header secondary action: View Net Worth

### Scope

**In Scope:**

- Frontend-only changes (no Rust/backend changes)
- `accountUtils.ts` helper module
- Accounts page layout restructure
- `AccountRow` visual enhancements
- i18n keys (en + fr)
- Playwright test updates

**Out of Scope:**

- Balance change history / audit log UI
- Institution logos
- Dashboard accounts summary card
- Backend API changes

## Implementation Plan

### Tasks

- [x] **Task 1: Account utilities module** — `apps/desktop/src/lib/accountUtils.ts`
- [x] **Task 2: AccountRow enhancements** — icons, institution, updated date
- [x] **Task 3: Accounts page layout** — hero, card, breakdown, sections, empty state
- [x] **Task 4: i18n** — en.json + fr.json
- [x] **Task 5: E2E tests** — accounts.spec.ts updates

### Acceptance Criteria

- **AC 1:** Hero total displays sum of all account balances in large monospace format
- **AC 2:** Accounts grouped by type with section headers and subtotals inside a Card
- **AC 3:** Credit cards appear under a Liabilities section when present
- **AC 4:** Breakdown bar shows when 2+ accounts exist
- **AC 5:** Net worth context line with link when net worth data available
- **AC 6:** Card-wrapped empty state with title, description, Add Account + View Net Worth + Import Statement
- **AC 7:** AccountRow shows type icon, institution, and last-updated date
- **AC 8:** Mixed-currency note when CAD and USD accounts coexist
- **AC 9:** All accounts.spec.ts tests pass

## Verification

```bash
pnpm --filter @nkbaz/desktop exec tsc --noEmit
pnpm --filter @nkbaz/desktop exec playwright test accounts
```
