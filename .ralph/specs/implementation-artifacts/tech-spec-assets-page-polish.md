---
title: 'Assets Page Polish — Summary, Grouping, and Net Worth Context'
slug: 'assets-page-polish'
created: '2026-05-26'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'React 19 / TanStack Router / TanStack Query'
  - 'i18next (en + fr translations)'
  - 'shadcn Card, Button, PageHeader patterns'
files_to_modify:
  - 'apps/desktop/src/lib/assetUtils.ts'
  - 'apps/desktop/src/components/net-worth/NetWorthBreakdownBar.tsx'
  - 'apps/desktop/src/components/assets/AssetRow.tsx'
  - 'apps/desktop/src/routes/assets.tsx'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/assets.spec.ts'
code_patterns:
  - 'Accounts page grouping pattern (accounts.tsx — TYPE_ORDER, groupAccountsByType, grand total, section subtotals)'
  - 'Net Worth hero number (32px monospace font-mono font-semibold — net-worth.tsx)'
  - 'Card-wrapped empty states (year-summary.tsx, net-worth.tsx)'
  - 'NetWorthBreakdownBar for stacked category visualization'
  - 'useCurrentNetWorth for cross-page wealth context'
  - 'All money in cents, display via useFormatCurrency'
test_patterns:
  - 'Playwright E2E with __TAURI_INTERNALS__ invoke mocks (assets.spec.ts pattern)'
  - 'Mock get_current_net_worth when testing net worth context line'
baseline_commit: 'c402cd6cccaa0c4daaadb3089e43b6241d921fb7'
context:
  - '.ralph/specs/project-context.md'
  - '.ralph/specs/planning-artifacts/ux-design-specification.md'
  - '.ralph/specs/implementation-artifacts/4-3-add-edit-view-passive-assets.md'
---

# Tech-Spec: Assets Page Polish — Summary, Grouping, and Net Worth Context

**Created:** 2026-05-26

## Overview

### Problem Statement

The Assets page is functionally complete but feels empty compared to sibling pages (Accounts, Net Worth, Year Summary). It shows a flat list with no hero total, no type grouping, no card container, minimal empty state, and no connection to the user's broader net worth picture.

### Solution

Elevate the Assets page to parity with Accounts and align with the UX spec's "spacious cards + hero numbers + maximum context" principle:

1. Hero total + type-grouped list inside a Card (mirror Accounts)
2. Page subtitle + net worth contribution context with link to `/net-worth`
3. Card-wrapped empty state with explanatory copy and secondary CTA
4. Mini allocation breakdown bar (reuse `NetWorthBreakdownBar` with asset-derived data)
5. Richer rows: type icons + last-updated date
6. Header secondary action: View Net Worth

### Scope

**In Scope:**

- Frontend-only changes (no Rust/backend changes)
- `assetUtils.ts` helper module for grouping and breakdown
- Assets page layout restructure
- `AssetRow` visual enhancements
- Optional `titleKey` prop on `NetWorthBreakdownBar`
- i18n keys (en + fr)
- Playwright test updates

**Out of Scope:**

- New asset data fields (purchase date, depreciation, notes)
- Full trend chart on Assets page
- Asset value history / audit log UI
- Dashboard changes
- Backend API changes

## Context for Development

### Codebase Patterns

| Pattern | Reference | Apply to |
|---------|-----------|----------|
| Type grouping + subtotals | `routes/accounts.tsx` | Group assets by `asset_type` |
| Hero total | `routes/net-worth.tsx` lines 78–85 | Assets grand total |
| Card empty state | `routes/year-summary.tsx` lines 53–58 | Assets empty state |
| Breakdown bar | `NetWorthBreakdownBar.tsx` | Asset allocation by type |
| Net worth hook | `useCurrentNetWorth()` | Contribution context line |
| Type colors | `parseNetWorthBreakdown.ts` | housing/vehicles/business/other colors |

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src/routes/accounts.tsx` | Grouping, grand total, section headers |
| `apps/desktop/src/routes/net-worth.tsx` | Hero number, Card empty state, breakdown bar usage |
| `apps/desktop/src/components/assets/AssetRow.tsx` | Row anatomy to extend |
| `apps/desktop/src/lib/parseNetWorthBreakdown.ts` | Category color mapping |
| `apps/desktop/tests/assets.spec.ts` | Existing E2E coverage |

### Technical Decisions

1. **Client-side aggregation only:** Asset grouping and breakdown computed from `get_assets` response — no new Tauri command.

2. **Breakdown labels:** Use translated asset type labels (Real Estate, Vehicle, etc.) with colors from net worth breakdown (emerald, orange, pink, slate).

3. **Breakdown visibility:** Show when `assets.length >= 2` (single asset = 100% bar adds little value).

4. **Net worth context:** Show contribution line when `useCurrentNetWorth()` returns data AND `grandTotal > 0`. Link to `/net-worth`.

5. **Last updated:** Format `updated_at` ISO string as `"Jan 2026"` using `toLocaleDateString` (consistent with existing date display patterns).

6. **Shared utils:** Extract `ASSET_TYPE_ORDER`, `ASSET_TYPE_KEYS`, icons, `groupAssetsByType`, `buildAssetBreakdown` to `assetUtils.ts` — used by `AssetRow` and `assets.tsx`.

## Implementation Plan

### Tasks

- [x] **Task 1: Asset utilities module**
  - File: `apps/desktop/src/lib/assetUtils.ts` (new)
  - Action: Export `ASSET_TYPE_ORDER`, `ASSET_TYPE_KEYS`, `ASSET_TYPE_ICONS`, `groupAssetsByType()`, `buildAssetBreakdown(assets, getTypeLabel)`, `formatAssetUpdatedAt(isoString)`

- [x] **Task 2: NetWorthBreakdownBar title prop**
  - File: `apps/desktop/src/components/net-worth/NetWorthBreakdownBar.tsx`
  - Action: Add optional `titleKey?: string` prop defaulting to `"netWorth.breakdown"`

- [x] **Task 3: AssetRow enhancements**
  - File: `apps/desktop/src/components/assets/AssetRow.tsx`
  - Action: Import icons/keys from `assetUtils`; show type icon before name; show muted "Updated …" from `updated_at`; improve value edit `aria-label` with i18n hint

- [x] **Task 4: Assets page layout**
  - File: `apps/desktop/src/routes/assets.tsx`
  - Action:
    - Add `PageHeader` subtitle
    - Header actions: View Net Worth (outline Link) + Add Asset
    - Hero total (`data-testid="assets-total"`)
    - Net worth contribution line with link
    - Breakdown bar when 2+ assets
    - Card-wrapped grouped list (type headers + subtotals)
    - Card-wrapped empty state with Gem icon, title, description, Add Asset + View Net Worth CTAs
    - Loading skeleton inside Card

- [x] **Task 5: i18n**
  - Files: `apps/desktop/src/locales/en.json`, `fr.json`
  - Action: Add keys: `assets.subtitle`, `assets.breakdown`, `assets.contributesToNetWorth`, `assets.viewNetWorth`, `assets.viewDetails`, `assets.emptyTitle`, `assets.emptyDescription`, `assets.updated`, `assets.editValueHint`

- [x] **Task 6: E2E tests**
  - File: `apps/desktop/tests/assets.spec.ts`
  - Action: Mock `get_current_net_worth`; verify hero total, grouping headers, breakdown bar (2+ assets), enhanced empty state, View Net Worth button; update empty state text assertions

### Acceptance Criteria

- [x] **AC 1:** Given assets exist, when the user opens `/assets`, then a hero total displays the sum of all asset values in large monospace format.

- [x] **AC 2:** Given assets of multiple types exist, when viewing the list, then assets are grouped by type with section headers and subtotals (matching Accounts page pattern).

- [x] **AC 3:** Given 2 or more assets exist, when viewing the page, then an allocation breakdown bar shows the proportional split by asset type.

- [x] **AC 4:** Given net worth data is available, when assets exist, then a context line shows how assets contribute to total net worth with a link to `/net-worth`.

- [x] **AC 5:** Given no assets exist, when viewing the page, then a Card-wrapped empty state shows explanatory copy with Add Asset and View Net Worth actions.

- [x] **AC 6:** Given an asset row is displayed, when viewing it, then a type icon and last-updated date are visible alongside name and value.

- [x] **AC 7:** Given the page header, when viewing it, then a subtitle explains passive assets and a View Net Worth button is present.

- [x] **AC 8:** Given the app locale is French, when viewing the assets page, then all new labels render in French.

- [x] **AC 9:** Given existing asset CRUD behavior, when running `assets.spec.ts`, then all tests pass without regression.

## Additional Context

### Dependencies

- No new npm or Cargo dependencies
- Depends on existing: `get_assets`, `get_current_net_worth`, `NetWorthBreakdownBar`, `Card`, `PageHeader`

### Testing Strategy

**Playwright E2E:**
- Extend mock with `get_current_net_worth`
- Verify `assets-total`, type group headers, breakdown bar, empty state card, header View Net Worth link

**Manual verification:**
1. Open Assets with 0 items — Card empty state with two CTAs
2. Add 1 asset — hero total, no breakdown bar
3. Add 2+ assets of different types — breakdown bar + grouped sections
4. Switch to French — labels translate

### Notes

**Risk:** Breakdown bar with single asset type shows one segment at 100% — hidden when only 1 asset to avoid visual noise.

**Verification commands:**
```bash
pnpm --filter @nkbaz/desktop exec tsc --noEmit
pnpm --filter @nkbaz/desktop exec playwright test assets
```
