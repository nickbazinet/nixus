---
title: 'Show yearly entered income by source'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a3bdf4adee960fc0a94f904d8c3a6ce4efdfa5da'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/guidelines/warnings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Income Sources table labels its final monetary column “Amount,” but each value is actually the most recently recorded month’s income for that source. The meaning is unclear and does not answer how much income was entered for the year.

**Approach:** Keep “Last recorded” as the recency indicator, and replace the ambiguous amount with the sum of entered income for each source in the year selected by the global period control. Label the column with that year so the scope is explicit.

## Boundaries & Constraints

**Always:** Aggregate integer cents from `income_entries` by `source_id` using the selected calendar year’s half-open date range. Include all entries in that year, including multiple entries for the same source and month. Show zero for a source with no entries in the selected year. Preserve the existing value-masking behavior, source sorting, source editing/deletion, and all monthly totals/history behavior. Add English and French copy.

**Ask First:** Any change that alters the global period semantics, the Income Entries monthly list, or the top “Money in” monthly statistic.

**Never:** Reinterpret an income source’s configured data as received income; use the old `last_amount_cents` as a yearly value; force a year argument onto the shared `useIncomeSources()` picker hook; use floating-point currency math; add a migration or dependency; edit generated `routeTree.gen.ts`; redesign or restyle the table.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Multiple entries | Two selected-year entries for one source | Display their exact cents sum in that source row | N/A |
| Other years | Same source has prior/future-year entries | Exclude those entries | N/A |
| No selected-year entries | Source exists, aggregate absent | Display formatted zero, not the last amount or a dash | N/A |
| Period year changes | User navigates across a year boundary | Refetch and display totals for the newly selected year | Existing query error behavior |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/db/income.rs:get_income_total` -- reuse its ISO half-open date-range aggregation pattern; add a per-source yearly aggregate and focused Rust tests in the existing test module.
- `apps/desktop/src-tauri/src/models/mod.rs:IncomeSourceWithLastEntry` -- add a distinct yearly-total response model rather than changing last-entry semantics.
- `apps/desktop/src-tauri/src/commands/income.rs:get_income_total` -- expose the read-only yearly aggregate command.
- `apps/desktop/src-tauri/src/lib.rs:tauri::generate_handler!` -- register the new command; generated command registration is otherwise unavailable at runtime.
- `apps/desktop/src/lib/types.ts:IncomeSourceWithLastEntry` -- mirror the new yearly-total IPC response type without changing the existing source contract.
- `apps/desktop/src/lib/constants.ts:queryKeys` -- define a year-scoped aggregate key.
- `apps/desktop/src/hooks/useIncome.ts` -- add the year-total query and invalidate its root key after income entry mutations.
- `apps/desktop/src/routes/spending.income.tsx:IncomePage` -- query with `selectedYear`, join totals to source rows, and render a year-specific heading.
- `apps/desktop/src/components/income/IncomeSourceRow.tsx:IncomeSourceRow` -- accept and format the explicit yearly total; leave “Last recorded” unchanged.
- `apps/desktop/src/locales/{en,fr}.json` -- add locale-parity copy for the year-scoped column label; do not modify shared `common.amount`.
- `apps/desktop/tests/income.spec.ts` -- new user-visible regression scenario because existing `nav-qa.spec.ts` only smoke-tests an empty Income page.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/income.rs`, `models/mod.rs`, `commands/income.rs`, `lib.rs` -- test and expose exact yearly cents totals by source.
- [x] `apps/desktop/src/lib/constants.ts`, `lib/types.ts`, `hooks/useIncome.ts` -- add the typed year-scoped query and mutation invalidation.
- [x] `apps/desktop/src/routes/spending.income.tsx`, `components/income/IncomeSourceRow.tsx`, `locales/{en,fr}.json` -- replace the ambiguous last amount with the selected-year total and explicit heading.
- [x] `apps/desktop/tests/income.spec.ts` -- prove aggregation, exclusion of another year, zero fallback, requested year argument, and rendered label/value.

**Acceptance Criteria:**
- Given the displayed period is in 2026 and one source has entered income of $5,200 and $2,000 dated in 2026 plus $900 dated in 2025, when the Income page renders, then its year-total column identifies 2026 and shows $7,200 for that source.
- Given a source has no entries in the displayed year, when the table renders, then that source shows $0.00 while its all-time “Last recorded” date remains unchanged.
- Given the user navigates to a period in another year, when the year changes, then the backend query receives that year and the table updates to that year’s totals.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors or warnings.
- `pnpm --filter @nixus/desktop test` -- expected: hook invalidation and locale placeholder coverage pass with the full unit suite.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml db::income::tests` -- expected: yearly aggregation and existing income DB tests pass.
- `pnpm --filter @nixus/desktop exec playwright test tests/income.spec.ts` -- expected: selected-year totals render correctly through mocked IPC.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: complete desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build exits successfully.

**Manual checks (if no CLI):**
- Drive `/spending/income` in Playwright at desktop width and confirm the year-specific heading and aligned masked/unmasked totals remain visually coherent.

## Suggested Review Order

**UI behavior**

- Start with the year-scoped query, loading gate, and source-total join.
  [`spending.income.tsx:52`](../../apps/desktop/src/routes/spending.income.tsx#L52)

- Review the explicit failure state that prevents false zero totals.
  [`spending.income.tsx:134`](../../apps/desktop/src/routes/spending.income.tsx#L134)

- Confirm the selected year labels and populates each numeric row.
  [`spending.income.tsx:165`](../../apps/desktop/src/routes/spending.income.tsx#L165)

- Verify the row formats the supplied total through the existing Money primitive.
  [`IncomeSourceRow.tsx:40`](../../apps/desktop/src/components/income/IncomeSourceRow.tsx#L40)

**Data boundary**

- Inspect exact-cent aggregation over the calendar year's half-open date range.
  [`income.rs:375`](../../apps/desktop/src-tauri/src/db/income.rs#L375)

- Follow the dedicated hook that keeps shared source pickers year-free.
  [`useIncome.ts:156`](../../apps/desktop/src/hooks/useIncome.ts#L156)

- Confirm the read command and Tauri registration expose the aggregate.
  [`income.rs:254`](../../apps/desktop/src-tauri/src/commands/income.rs#L254)

**Regression coverage**

- Read the yearly sum, zero fallback, loading, failure, and navigation scenarios.
  [`income.spec.ts:106`](../../apps/desktop/tests/income.spec.ts#L106)

- Confirm entry mutations invalidate every cached yearly source total.
  [`useIncome.test.tsx:70`](../../apps/desktop/src/hooks/__tests__/useIncome.test.tsx#L70)

- Verify English and French preserve every required year placeholder.
  [`income-year-total-i18n.test.ts:20`](../../apps/desktop/src/locales/__tests__/income-year-total-i18n.test.ts#L20)
