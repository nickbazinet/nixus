---
title: 'Fix net-worth period cutoff'
type: 'bugfix'
created: '2026-09-10'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'c219b0365266cb378c49f78732abf39d765a6d00'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 6M net-worth view uses a rolling six-month cutoff, so on September 10 it includes a March 15 snapshot and displays the same history as 1Y. Users expect 6M to represent the current calendar month plus the preceding five calendar months, making March the seventh month and out of range.

**Approach:** Define 6M and 1Y as calendar-month windows anchored to the start of the current month. Apply the cutoff once in the database query so both chart history and change calculations share identical semantics, then lock the behavior at Rust and browser levels.

## Boundaries & Constraints

**Always:** Keep period filtering in the existing database seam; preserve ascending snapshot order; ensure 6M excludes the seventh calendar month while 1Y includes it; keep chart and change calculations aligned; use deterministic Given/When/Then regression coverage.

**Ask First:** Any change to the available period options, labels, default selection, or meaning of ALL.

**Never:** Add client-side duplicate filtering; change chart styling or layout; alter snapshot recording; broaden this into unrelated date handling or an end-of-month refactor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Seventh calendar month | Today is in September; snapshot is March 15 | 6M excludes the snapshot; 1Y includes it | N/A |
| First included month | Today is in September; snapshot is April 1 | 6M includes the snapshot | N/A |
| Current month | Snapshot is dated within September | 6M and 1Y include it | N/A |
| All history | Period is `all` | No date cutoff is applied | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/db/net_worth.rs:200-282` -- Single filtering seam; `get_net_worth_change` reuses the history query, so one corrected cutoff updates both outputs.
- `apps/desktop/src-tauri/src/db/net_worth.rs:284-465` -- Existing in-memory SQLite tests; add fixed-reference calendar-window coverage here.
- `apps/desktop/tests/net-worth.spec.ts:59-205` -- Seeded Tauri mock currently returns all snapshots regardless of `period`, masking the regression.
- `apps/desktop/tests/net-worth.spec.ts:250-260` -- Existing period test checks only chart visibility and must assert the visible data range changes.
- `apps/desktop/src/hooks/useNetWorth.ts:28-41` -- Read-only evidence: both commands receive the selected `period`.
- `apps/desktop/src/lib/constants.ts:25-28` -- Read-only evidence: history and change cache keys already include `period`.
- `apps/desktop/src/routes/wealth.net-worth.tsx:29-44,111-142` -- Read-only evidence: tabs update period state and render returned history directly.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/net_worth.rs` -- anchor 6M/1Y cutoffs to calendar-month starts and add regression tests for excluded, included-boundary, current-month, 1Y, and ALL behavior.
- [x] `apps/desktop/tests/net-worth.spec.ts` -- make the seeded IPC mock respect `period` and assert switching 1Y to 6M removes the March snapshot from chart-accessible data.

**Acceptance Criteria:**
- Given a March 15 snapshot and a September reference date, when 6M is selected, then the chart and period change omit March and begin no earlier than April 1.
- Given the same data, when 1Y is selected, then March 15 remains included.
- Given ALL is selected, when history loads, then every snapshot remains included.
- Given the period changes, when data is refetched, then the E2E assertion proves the rendered dataset changes rather than merely remaining visible.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `cargo test net_worth --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: calendar-window regression tests pass.
- `pnpm --filter @nixus/desktop exec playwright test tests/net-worth.spec.ts` -- expected: net-worth E2E tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop E2E suite passes.

**Manual checks (if no CLI):**
- User validated the corrected 6M/1Y behavior in the running application on 2026-09-10. Further automated testing was stopped at the user's request.
