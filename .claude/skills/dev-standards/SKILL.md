---
name: dev-standards
description: 'Development standards and quality gates for nkbaz-finance. Run this skill when planning implementation work to ensure all standards are met. Use before starting any feature, bugfix, or refactor.'
---

# Development Standards — nkbaz-finance

These standards apply to all implementation work on this project. Review them before starting and verify them before claiming completion.

## Quality Gates

### All tests must pass

Before considering any implementation work complete:

1. Run `pnpm --filter @nkbaz/desktop exec tsc --noEmit` — zero type errors
2. Run `pnpm --filter @nkbaz/desktop exec playwright test` — all tests pass (163 as of v0.1.6)
3. If your changes affect UI, add or update Playwright tests to cover the new behavior
4. If your changes break existing tests, fix the tests as part of the same work — do not leave broken tests behind

### No regressions

- New code must not break existing functionality
- If a test needs updating due to intentional behavior changes, update the test and explain why in the commit message

## Test Patterns

- Forms use `mode: "onSubmit"` — test validation by submitting, not by blurring
- Custom select components (shadcn Select via @base-ui/react) require click-trigger + click-option in Playwright tests, not `selectOption()`
- Scope locators to form containers (e.g., `form.getByLabel(...)`) to avoid ambiguity
- Mock event timings in tests should allow at least 500ms for intermediate states to be observable

## Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS v4, TanStack Router
- **UI Components**: shadcn (base-nova style) with @base-ui/react primitives
- **Forms**: react-hook-form with Controller for custom components
- **Desktop**: Tauri v2 with Rust backend and SQLite
- **Testing**: Playwright (e2e)
