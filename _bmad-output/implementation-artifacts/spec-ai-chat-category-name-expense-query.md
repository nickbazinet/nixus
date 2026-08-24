---
title: 'AI Chat Category-Name Expense Queries'
type: 'feature'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: '866a19afb45a528fe938a13f4b9a06b368192618'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Finance AI can search expenses by category ID, but users know category names. Requests such as “Give me all expenses for category X for the past 3 months” currently fail because the tool cannot accept a category name.

**Approach:** Extend the existing read-only `query_expenses` tool with an optional category-name filter. The AI will translate relative periods into the existing absolute `date_from`/`date_to` fields, while the database applies a safe partial category-name match and returns the existing capped result set.

## Boundaries & Constraints

**Always:** Keep queries read-only and parameterized; preserve the 100-row cap, existing category-ID filter, result category names, and one-round tool loop. Match category names case-insensitively for ASCII and treat `%`, `_`, and `\` in user-supplied names literally. Compose category and date filters with AND semantics.

**Ask First:** Changing relative-date semantics, removing or changing `category_id`, exposing additional financial query tools, or altering the AI context beyond what this feature requires.

**Never:** Resolve a name to one arbitrarily selected category ID, send raw SQL from the AI, move SQL into command/AI modules, or refactor unrelated chat behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Named category and period | `category_name="Groceries"` plus absolute dates computed for the past three months | Only matching category expenses within the range, newest first unless requested otherwise | Existing tool error flow |
| Partial/case variation | `category_name="grocer"` | Matches category names such as `Groceries` | Empty list when none match |
| Duplicate names | Multiple category rows share the requested name | Expenses from every matching category row are returned | No arbitrary ID selection |
| Literal wildcard | Category contains `%`, `_`, or `\` | Characters are matched literally | Existing database error mapping |
| Existing ID caller | Tool supplies only `category_id` | Existing exact-ID behavior is unchanged | Existing tool error flow |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/db/expense.rs:276-356` -- `ExpenseSearchFilters` and `search_expenses`; results already join `budget_categories` and expose `category_name`. Reuse the merchant filter’s escaped parameterized `LIKE` pattern. The colocated test module at lines 537-686 currently has no search-filter coverage.
- `apps/desktop/src-tauri/src/ai/chat.rs:44-71,118-152` -- Budget Helper tool schema currently advertises ID-only category filtering; parser is generic and result formatting already includes category names.
- `apps/desktop/src-tauri/src/commands/chat.rs:304-325` -- `execute_tool_call` maps JSON params into `ExpenseSearchFilters`; add name passthrough here while retaining DB logic in `db/`.
- `apps/desktop/tests/chat-expense-query.spec.ts` -- Existing mocked tool-flow coverage verifies the searching indicator and result table; extend its params fixture without adding frontend production changes.
- `apps/desktop/src-tauri/src/commands/chat.rs:76-85` -- Read-only evidence: AI context lists category names but not IDs. Do not broaden scope by changing context; name filtering removes that dependency for this use case.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/expense.rs` -- Add `category_name` to `ExpenseSearchFilters`, apply an escaped partial match against joined category names, and add unit tests for exact/partial case-insensitive matching, duplicate-name results, literal wildcards, no results, date composition, and unchanged ID filtering.
- [x] `apps/desktop/src-tauri/src/ai/chat.rs` -- Advertise `category_name` as a string partial-match parameter and instruct the model to use it for user-supplied names while continuing to compute ISO date bounds from the injected current date.
- [x] `apps/desktop/src-tauri/src/commands/chat.rs` -- Parse and forward the optional `category_name` tool parameter without performing database resolution in the command layer.
- [x] `apps/desktop/tests/chat-expense-query.spec.ts` -- Cover a mocked category-name plus date-range tool call and confirm the existing intermediate and final rendering behavior.

**Acceptance Criteria:**
- Given expenses categorized under a named category, when the user asks for that category’s expenses over the past three months, then Finance AI queries by category name and returns only rows in the computed date range.
- Given an existing caller uses `category_id`, when it queries expenses, then its result behavior remains unchanged.
- Given no matching category expenses exist, when the tool completes, then Finance AI receives an empty result and responds naturally rather than reporting that an ID is required.

## Spec Change Log

## Design Notes

Direct filtering is safer than name-to-ID resolution because production category names are not unique. Applying `LIKE` to the joined category table naturally supports zero, one, or multiple matching category records and mirrors the established merchant filter.

## Verification

**Commands:**
- `cargo test expense::` from `apps/desktop/src-tauri` -- expected: expense database tests, including new category-name cases, pass.
- `cargo check && cargo clippy -- -D warnings` from `apps/desktop/src-tauri` -- expected: clean Rust build with no warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop exec playwright test tests/chat-expense-query.spec.ts` -- expected: focused chat expense-query tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop regression suite passes.

## Suggested Review Order

**AI tool contract**

- Start with the model-facing category and relative-date behavior.
  [`chat.rs:67`](../../apps/desktop/src-tauri/src/ai/chat.rs#L67)

**Tool boundary**

- Verify JSON parameters map into typed expense filters without key drift.
  [`commands/chat.rs:304`](../../apps/desktop/src-tauri/src/commands/chat.rs#L304)

**Database filtering**

- Review literal wildcard escaping shared by merchant and category filters.
  [`expense.rs:296`](../../apps/desktop/src-tauri/src/db/expense.rs#L296)

- Confirm category names compose safely with existing date and ID predicates.
  [`expense.rs:339`](../../apps/desktop/src-tauri/src/db/expense.rs#L339)

**Regression coverage**

- Check the JSON-to-filter contract tests added after adversarial review.
  [`commands/chat.rs:529`](../../apps/desktop/src-tauri/src/commands/chat.rs#L529)

- Inspect database edge cases for duplicates, dates, case, and wildcards.
  [`expense.rs:628`](../../apps/desktop/src-tauri/src/db/expense.rs#L628)

- Finish with the user-visible category-and-period chat flow.
  [`chat-expense-query.spec.ts:240`](../../apps/desktop/tests/chat-expense-query.spec.ts#L240)
