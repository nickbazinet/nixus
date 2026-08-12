---
title: 'Nest project earmarks into account rows on the Accounts page'
type: 'refactor'
created: '2026-08-12'
status: 'in-review'
context: []
baseline_commit: '70ac9a744bd025c2d93552e4f0386ae7ef4b69e9'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Accounts page shows every account name twice — once in the standalone "Money set aside per account" (`AccountEarmarkBar`) section above the table, and again in the account table itself below. The user wants a single list.

**Approach:** Remove the standalone earmarks section. Move the per-account project breakdown directly into each `AccountRow`: a collapsed-by-default expand toggle reveals an indented sub-row per project (name + amount), with the "share of account %" moved into a per-row info tooltip instead of a bar+legend visualization.

## Boundaries & Constraints

**Always:**
- Reuse `useAccountEarmarkBreakdown` and the `get_account_earmark_breakdown` backend command unchanged — no backend/db changes.
- Collapsed by default; an account with zero earmarked contributions shows no expand affordance at all (same behavior as today, just relocated).
- Keep EN + FR i18n parity; update `projects-i18n.test.ts`'s `REQUIRED_KEYS` list to match renamed/removed keys.
- Nested project rows render as additional `<TableRow>`s (colSpan cell, indented) directly under the owning account's row — same pattern as `AccountTypeGroup`'s group-header row, not a nested `<table>`.
- Reuse the existing `MetricInfoTooltip` component (`@/components/financial-health/MetricInfoTooltip`) for the share-of-account info icon rather than inventing a new tooltip primitive.

**Ask First:** None — scope and visual approach already confirmed by the user.

**Never:**
- Touch `/wealth/projects` (`wealth.projects.tsx`, `SavingsProjectsCard`, priority/allocation logic) — accounts page only.
- Commit — stay on `master`, uncommitted, per user instruction.
- Reintroduce a bar-chart/share-track visualization; the mockup calls for a plain indented list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Funded account, collapsed | Account has `earmarked_cents > 0`, row not expanded | Row shows a chevron toggle + total earmarked amount inline; no project rows rendered | N/A |
| Funded account, expanded | Same account, toggle clicked | One extra `<TableRow>` per project appears indented under the account row: `↳ Project Name — $amount`, each with a share-% info tooltip | N/A |
| Unfunded account | `earmarked_cents === 0` / no segments | No toggle, no chevron, no extra row — row is visually identical to an account with no projects today | N/A |
| Multiple accounts expanded independently | Two accounts both funded | Each account's expand state is independent (existing per-row `useState`, no shared state) | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/routes/wealth.accounts.tsx` -- remove the `accounts-earmarks` section and `AccountEarmarkBar` import/usage
- `apps/desktop/src/components/accounts/AccountRow.tsx` -- add expand toggle + nested project sub-rows, sourced from `useAccountEarmarkBreakdown(account.id)`
- `apps/desktop/src/components/projects/AccountEarmarkBar.tsx` -- delete (fully superseded)
- `apps/desktop/src/components/financial-health/MetricInfoTooltip.tsx` -- reuse as-is for the share-% tooltip
- `apps/desktop/src/locales/en.json`, `fr.json` -- rewrite `projects.earmarkSectionTitle`/`earmarkNote`/`accountEarmark*` keys for row-level copy
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` -- update `REQUIRED_KEYS` to match
- `apps/desktop/tests/accounts.spec.ts` -- rewrite `"Account earmark breakdown"` describe block to assert against `AccountRow`'s expand toggle + nested rows instead of the deleted section
- `apps/desktop/tests/accessibility.spec.ts` -- verify the `get_account_earmark_breakdown` mock still resolves cleanly against the new row UI (no structural change expected)

## Tasks & Acceptance

**Execution:**
- [x] `AccountRow.tsx` -- fetch `useAccountEarmarkBreakdown(account.id)`; when segments exist, render a chevron toggle (mirrors `BudgetCategoryRow`'s pattern) beside the account name and the total earmarked amount; when expanded, render one indented `<TableRow>`/`<TableCell colSpan={4}>` per project with `↳ {name} — {amount}` plus a `MetricInfoTooltip` showing the % share -- consolidates the breakdown into the single account list
- [x] `wealth.accounts.tsx` -- delete the `accounts-earmarks` `<section>`, its `AccountEarmarkBar` import, and the now-unused `t("projects.earmarkSectionTitle")`/`earmarkNote` usages -- removes the duplicate section
- [x] `AccountEarmarkBar.tsx` -- delete the file -- dead code after the move
- [x] `en.json` / `fr.json` -- replace `projects.earmarkSectionTitle`, `projects.earmarkNote`, `projects.accountEarmark*` keys with row-scoped equivalents (e.g. toggle aria-label, tooltip label) -- keeps copy accurate to the new UI
- [x] `projects-i18n.test.ts` -- update `REQUIRED_KEYS` to the new/renamed key set -- keeps locale-parity test meaningful
- [x] `accounts.spec.ts` -- rewrite the `"Account earmark breakdown"` tests to expand an `account-row` via its new toggle and assert nested project rows/tooltip content, replacing assertions on `account-earmark-bar`/`accounts-earmarks` -- test tracks the new UI, not the deleted one
- [x] `AccountRow.tsx` -- add a leading "Unallocated" sub-row (`earmarkData.unallocated_cents`) above the project rows, using the same 2-col/numeric-col/empty-col layout -- lets the user read "what's mine" vs "what's set aside" at a glance (post-checkpoint user feedback)

**Acceptance Criteria:**
- Given an account with two funded projects, when the page loads, then the account row shows a collapsed toggle with the total set-aside amount and no standalone earmarks section exists anywhere on the page.
- Given that same row, when the toggle is clicked, then an "Unallocated" row appears first, followed by one indented sub-row per project with its amount, each project row carrying a share-% tooltip; the amount column aligns with the Balance column above it; clicking again collapses all of it.
- Given an account with no project contributions, when the page loads, then that row shows no toggle and no extra rows.

## Design Notes

Sub-rows use `<TableRow><TableCell colSpan={4}>` the same way `AccountTypeGroup` already injects a group-header row into the table — no nested `<table>`, no layout hack.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop test` -- expected: all unit tests pass, including the updated `projects-i18n.test.ts`
- `pnpm --filter @nixus/desktop exec playwright test accounts.spec.ts` -- expected: rewritten "Account earmark breakdown" tests pass
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: no TypeScript errors after removing `AccountEarmarkBar` and its imports
