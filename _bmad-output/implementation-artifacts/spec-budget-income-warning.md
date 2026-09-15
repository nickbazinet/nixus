---
title: 'Warn when monthly budget exceeds historical income'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b011e816bfa9a215039d1a2169e16fddd2dd750c'
context:
  - docs/project-context.md
  - _bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users can set a total monthly budget above what their recorded income history supports without receiving a clear warning.

**Approach:** Extend the existing budget summary with the established completed-month income average and render a localized, non-blocking caution alert when at least six completed income months exist and the target is higher than the average.

## Boundaries & Constraints

**Always:** Use all distinct completed months containing income; exclude the current month; compare integer cents; treat six months as eligible; preserve values masking; use the shared caution Alert and Nixus design tokens; localize English and French.

**Ask First:** Any change to the six-month threshold, lifetime averaging window, or advisory-only behavior.

**Never:** Include the current month, use floating-point currency, block editing, add dismissal state, add a separate query, or invent new visual tokens/components.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Insufficient history | 5 completed income months; target above average | No warning | N/A |
| Eligible and above | 6+ completed income months; target greater than average | Caution alert with target and average | N/A |
| Equal or below | 6+ months; target less than or equal to average | No warning | N/A |
| Values hidden | Eligible warning state; privacy mask enabled | Alert remains visible without exposing either amount | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/db/aggregates.rs::get_trailing_income_average` -- existing source of lifetime average and distinct completed-month count; reuse unchanged.
- `apps/desktop/src-tauri/src/db/dashboard.rs::get_budget_summary` -- add average/count to the existing response and backend tests.
- `apps/desktop/src-tauri/src/models/mod.rs::BudgetSummary` -- Rust IPC response fields.
- `apps/desktop/src/lib/types.ts::BudgetSummary` -- matching TypeScript wire shape.
- `apps/desktop/src/components/budget/BudgetSummaryStrip.tsx` -- visibility condition and shared caution Alert below the meter.
- `apps/desktop/src/routes/spending.budget.tsx` -- pass summary average/count into the strip.
- `apps/desktop/src/locales/{en,fr}.json` -- localized title and description with amount placeholders.
- `apps/desktop/src/locales/__tests__/budget-income-warning-i18n.test.ts` -- key and placeholder parity.
- `apps/desktop/tests/budget.spec.ts` -- Tauri summary mock plus five/six/equal/masked browser scenarios.

## Tasks & Acceptance

**Execution:**
- [x] Extend Rust and TypeScript `BudgetSummary` contracts with `average_monthly_income_cents` and `income_month_count`.
- [x] Reuse `get_trailing_income_average` in `get_budget_summary` and lock returned figures with Rust tests.
- [x] Add localized alert copy and parity coverage.
- [x] Render the shared caution Alert only for the approved eligibility/comparison state and preserve masking.
- [x] Extend Playwright's budget summary mock and test boundary, visible, equal, and masked states.

**Acceptance Criteria:**
- Given five income months, when target exceeds average, then no warning appears.
- Given six income months, when target exceeds average, then the caution alert shows both formatted values.
- Given six or more income months, when target is equal to or below average, then no warning appears.
- Given masking is enabled, when the warning appears, then neither raw formatted amount is present.

## Spec Change Log

## Design Notes

Place the existing `Alert variant="caution"` below the overall meter in the summary card. Use `TriangleAlert`, a concise title, and one localized sentence. No modal, toast, motion, shadow, or dismissal.

## Verification

**Commands:**
- `cargo test db::dashboard --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: dashboard tests pass.
- `pnpm --filter @nixus/desktop test` -- expected: locale/unit tests pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero errors.
- `pnpm --filter @nixus/desktop build` -- expected: exit code 0.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full browser suite passes.

## Suggested Review Order

**Warning behavior**

- Start with the eligibility gate and token-driven caution presentation.
  [`BudgetSummaryStrip.tsx:19`](../../apps/desktop/src/components/budget/BudgetSummaryStrip.tsx#L19)

- Follow the summary fields from the route into the warning component.
  [`spending.budget.tsx:129`](../../apps/desktop/src/routes/spending.budget.tsx#L129)

**Historical income contract**

- Reuse the established completed-month average in the existing summary query.
  [`dashboard.rs:6`](../../apps/desktop/src-tauri/src/db/dashboard.rs#L6)

- Keep Rust and TypeScript wire fields aligned in integer cents.
  [`mod.rs:196`](../../apps/desktop/src-tauri/src/models/mod.rs#L196)

- Mirror the backend response shape consumed by TanStack Query.
  [`types.ts:149`](../../apps/desktop/src/lib/types.ts#L149)

**Live-data consistency**

- Refresh the warning whenever category targets change.
  [`useBudget.ts:7`](../../apps/desktop/src/hooks/useBudget.ts#L7)

- Refresh historical income after source deletion cascades its entries.
  [`useIncome.ts:67`](../../apps/desktop/src/hooks/useIncome.ts#L67)

**Supporting coverage**

- Verify five/six-month boundaries, masking, and live target edits in-browser.
  [`budget.spec.ts:981`](../../apps/desktop/tests/budget.spec.ts#L981)

- Pin income-source deletion invalidation at the hook boundary.
  [`useIncome.test.tsx:1`](../../apps/desktop/src/hooks/__tests__/useIncome.test.tsx#L1)

- Preserve localized warning keys and interpolation placeholders.
  [`budget-income-warning-i18n.test.ts:1`](../../apps/desktop/src/locales/__tests__/budget-income-warning-i18n.test.ts#L1)
