---
title: 'Fix AI Expense Category Resolution'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '80fca5d6ac509c65aa35873fa93bad7c56a6df23'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Named expense requests can be contaminated by guessed or stale numeric category IDs, causing the AI to query the wrong category or explain a mismatch it cannot correct. The same prompt also requires IDs for expense actions while omitting category IDs from its current financial context.

**Approach:** Make category names the only AI-facing category reference. Keep database IDs internal: read queries filter by name, while confirmed write actions resolve one active category by exact case-insensitive name before creating an expense. Prevent historical internal tool payloads from influencing later turns and return explicit applied-filter metadata to the model.

## Boundaries & Constraints

**Always:** Preserve parameterized read-only SQL, the 100-row query cap, partial category-name matching across duplicate category rows for reads, existing manual expense creation by selected numeric ID, the confirmation step for write actions, and valid Bedrock role alternation. Treat AI JSON as untrusted boundary input and return validation errors for missing, unknown, or ambiguous write-action category names.

**Ask First:** Changing relative-date semantics, altering category uniqueness rules globally, migrating or deleting saved conversations, or changing the visible action-confirmation UX.

**Never:** Let the model choose a database category ID, silently prefer an ID over a supplied name, arbitrarily choose one category when an action name is ambiguous, expose raw SQL, or change unrelated account/asset actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Named read query | `category_name="Vacation"` with absolute date bounds | Results include every matching category row in range; tool metadata reports `Vacation` as the applied category | Empty result is reported normally |
| Stale ID in model output | Query payload includes `category_id` from old history | ID is not accepted by the AI-facing query contract and cannot affect results | Name remains authoritative |
| Named expense action | `category_name="Vacation"` uniquely matches one active category | Rust resolves its ID and creates the expense through the existing DB API | Existing confirmation and audit flow remain |
| Unknown action category | No active exact name match | No expense is created | Validation identifies `category_name` |
| Ambiguous action category | Multiple active exact name matches | No category is chosen and no expense is created | Validation asks for a more specific category |
| Prior tool/action history | Older messages contain category IDs | New turns receive conversational chat plus only the current tool exchange | Stored/displayed history is unchanged |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/ai/chat.rs:32-153` -- AI tool/action schemas and tool-result formatting; remove model-facing category IDs and include applied query metadata without testing prose wording.
- `apps/desktop/src-tauri/src/commands/chat.rs:27-336,433-527` -- builds AI history, parses query params, executes tools, and confirms actions; enforce typed name-only query/action boundaries and append only the current tool exchange for the follow-up call.
- `apps/desktop/src-tauri/src/db/chat.rs:104-149` -- full versus display history readers; add/read a chat-only AI history path without changing persisted or displayed messages.
- `apps/desktop/src-tauri/src/db/budget.rs:358-377` -- active category listing; add exact case-insensitive unique-name resolution with explicit missing/ambiguous outcomes.
- `apps/desktop/src-tauri/src/db/expense.rs:275-371` -- retain internal `category_id` support for trusted callers and existing name-filter SQL; no schema migration.
- `apps/desktop/tests/chat-expense-query.spec.ts:78-258` -- existing mocked named-query flow; extend the observable scenario without asserting prompt prose.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/budget.rs` -- add regression-first tests and deterministic active-category name resolution for confirmed write actions.
- [x] `apps/desktop/src-tauri/src/commands/chat.rs` and `db/chat.rs` -- add failing boundary/history tests, remove AI query-ID parsing, resolve action names, and isolate prior internal tool messages.
- [x] `apps/desktop/src-tauri/src/ai/chat.rs` -- change machine-consumed tool/action examples to names and format query results with the applied category filter.
- [x] `apps/desktop/tests/chat-expense-query.spec.ts` -- cover a Vacation/date-range query whose rendered results cannot be sourced from a stale Cloud ID.

**Acceptance Criteria:**
- Given a prior conversation contains Cloud's numeric category ID, when the user requests Vacation expenses for the past four months, then the executed query is constrained by `Vacation` and the response cannot contain Cloud expenses unless their stored category name also matches Vacation.
- Given the AI proposes a confirmed expense for a uniquely named category, when the user confirms it, then the existing expense insert receives the resolved internal ID.
- Given an unknown or ambiguous action category, when the user confirms it, then no expense is inserted and a category-name validation error is returned.

## Spec Change Log

## Design Notes

Read queries intentionally keep partial matching and may span duplicate category rows. Write actions require exactly one active exact match because they must store one foreign key; ambiguity is therefore an expected validation outcome, not a reason to select the first row.

## Verification

**Commands:**
- `cargo test` from `apps/desktop/src-tauri` -- expected: all Rust tests pass, including category resolution and history regressions.
- `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings` from `apps/desktop/src-tauri` -- expected: clean formatting and no warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop test` -- expected: desktop unit tests pass.
- `pnpm --filter @nixus/desktop exec playwright test tests/chat-expense-query.spec.ts` -- expected: focused user flow passes.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build succeeds.

**Observed:** Rust 908/908, Vitest 419/419, focused Playwright 29/29, TypeScript and production build passed. Repository-wide rustfmt/clippy remain blocked by pre-existing unrelated debt; the full Playwright run timed out after unrelated account/profile failures.

## Suggested Review Order

**AI query boundary**

- Start with typed parsing that prevents stale IDs from becoming unfiltered searches.
  [`chat.rs:369`](../../apps/desktop/src-tauri/src/commands/chat.rs#L369)

- Confirm the model-facing contract accepts category names, never database IDs.
  [`chat.rs:62`](../../apps/desktop/src-tauri/src/ai/chat.rs#L62)

**Deterministic write resolution**

- Review exact active-category matching and explicit ambiguity handling.
  [`budget.rs:379`](../../apps/desktop/src-tauri/src/db/budget.rs#L379)

- Follow confirmed actions through name resolution into the existing expense insert.
  [`chat.rs:414`](../../apps/desktop/src-tauri/src/commands/chat.rs#L414)

**Conversation safety**

- See how filtered histories preserve content while enforcing Bedrock role alternation.
  [`chat.rs:31`](../../apps/desktop/src-tauri/src/commands/chat.rs#L31)

- Verify only the current internal tool exchange reaches the model.
  [`chat.rs:117`](../../apps/desktop/src-tauri/src/db/chat.rs#L117)

**Result integrity**

- Inspect quoted applied filters, effective limits, sort order, and truncation signaling.
  [`chat.rs:138`](../../apps/desktop/src-tauri/src/ai/chat.rs#L138)

- Confirm SQL and metadata share the same effective limit and sort helpers.
  [`expense.rs:286`](../../apps/desktop/src-tauri/src/db/expense.rs#L286)

**Regression coverage**

- Review backend tests for malformed queries, resolved inserts, and no-write failures.
  [`chat.rs:733`](../../apps/desktop/src-tauri/src/commands/chat.rs#L733)

- Finish with the stale-Cloud-ID user scenario and action payload forwarding.
  [`chat-expense-query.spec.ts:317`](../../apps/desktop/tests/chat-expense-query.spec.ts#L317)
  [`chat.spec.ts:373`](../../apps/desktop/tests/chat.spec.ts#L373)
