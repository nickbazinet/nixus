---
title: 'AI-proposed budget categories during expense import'
type: 'feature'
created: '2026-08-12'
status: 'done'
context: []
baseline_commit: '900672e26f4e6f2396402cf41d01b6051291e733'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** During AI credit-card-statement import, when no existing budget category fits a transaction, `cc_parser.rs` can only return `suggested_category_id: null`, forcing the user to manually create the category elsewhere before they can finish reviewing the import. New users with no budget set up yet get zero help.

**Approach:** Extend the import AI's response schema so it can propose a new category (and optionally a new group) instead of just returning null. Surface the proposal in the review UI as a "Create category" affordance that, on confirmation, calls the existing `create_budget_group`/`create_budget_category` commands, then assigns the transaction to the newly created category.

## Boundaries & Constraints

**Always:**
- Reuse existing `create_budget_group` / `create_budget_category` Tauri commands and `db/budget.rs` functions — no new DB write path.
- New categories created this way use a placeholder `target_cents` of 100 ($1) to satisfy the existing `target_cents > 0` validation; user adjusts the real target later on the Budget page.
- Category/group creation from a proposal requires explicit user confirmation (button click) — never auto-created without review.
- After creation, invalidate the same query keys `useCreateBudgetCategory`/`useCreateBudgetGroup` already invalidate (`allBudgetCategories`, `budgetGroups`, budget-status) so the transaction list picks up the new category immediately.

**Ask First:** None beyond the above — architecture already confirmed with the user (single-shot schema extension, not a live tool-call loop).

**Never:**
- Do not give `cc_parser.rs` a multi-turn/tool-calling loop — it remains a single Bedrock `converse()` call.
- Do not change `target_cents > 0` validation in `db/budget.rs`.
- Do not touch AI chat's separate tool-call/action framework (`ai/chat.rs`, `commands/chat.rs`) — out of scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No matching category, group exists | Transaction merchant doesn't match any category name | AI returns `propose_category: { name, group_id }` (existing group) instead of `suggested_category_id: null` | If proposal creation fails, row stays "needs category", show inline error toast |
| No matching category or group | No existing group fits either | AI returns `propose_category: { name, group_name }` (new group hint, no group_id) | Same as above |
| User rejects proposal | User dismisses the "Create category" card | Row falls back to today's behavior: manual `Select` dropdown, flagged "needs category" | N/A |
| User confirms proposal | User clicks "Create category" | Group (if new) then category created via existing commands; transaction's category auto-set to new id; row becomes resolved | Toast error if either create call fails, proposal card stays visible for retry |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/ai/cc_parser.rs` -- extend `ParsedTransaction`/`AiTransaction`/`AiResponse` with optional `propose_category`; update `build_system_prompt` to document the new field
- `apps/desktop/src-tauri/src/commands/import.rs` -- no functional change expected; confirm `ParseResult`/events pass the new field through unchanged (serde on `ParsedTransaction`)
- `apps/desktop/src/hooks/useImport.ts` -- extend `ParsedTransaction` TS type with `proposeCategory` field
- `apps/desktop/src/components/import/TransactionReviewCard.tsx` -- render "Create category" affordance when row has a proposal and no resolved category
- `apps/desktop/src/routes/import.tsx` -- wire proposal state, call `useCreateBudgetGroup`/`useCreateBudgetCategory` (from `useBudget.ts`) on confirm, set `suggested_category_id` override to the new id
- `apps/desktop/src/hooks/useBudget.ts` -- reuse `useCreateBudgetGroup`, `useCreateBudgetCategory` as-is (reference only, no change)
- `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json` -- add strings for the proposal card (e.g. `import.proposedCategory`, `import.createCategoryButton`)

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/ai/cc_parser.rs` -- add `ProposedCategory { name: String, group_id: Option<i64>, group_name: Option<String> }`; add `propose_category: Option<ProposedCategory>` to `ParsedTransaction`/`AiTransaction`/`AiResponse` parsing; update system prompt to instruct the AI to set `propose_category` (with either an existing `group_id` or a new `group_name`) when no category fits, instead of leaving `suggested_category_id` null -- lets the AI surface an actionable suggestion instead of a dead end
- [x] `apps/desktop/src/hooks/useImport.ts` -- add `proposeCategory?: { name: string; groupId: number | null; groupName: string | null }` to the `ParsedTransaction` interface (snake_case→camelCase mapped consistently with existing fields) -- keeps FE types in sync with the new BE field
- [x] `apps/desktop/src/components/import/TransactionReviewCard.tsx` -- add optional `proposedCategory` prop and `onCreateCategory` callback; when present and row is unresolved, render a small inline card/button (e.g. `Alert` + `Button` "Create '{name}' category") instead of only the plain dropdown -- gives the user a one-click path to fix the root cause (missing category) rather than just picking a wrong existing one
- [x] `apps/desktop/src/routes/import.tsx` -- add `handleCreateProposedCategory(globalIndex, proposal)` that calls `createGroup.mutateAsync` (if `groupId` is null) then `createCategory.mutateAsync({ group_id, name, target_cents: 100 })`, then applies the returned category id via existing `handleFlaggedCategoryChange`/`handleAutoCategoryChange` path; pass proposal + handler down to both flagged and auto review card renderers -- single confirm action does group+category creation and resolves the row
- [x] `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json` -- add `import.proposedCategory`, `import.createCategoryButton`, `import.createCategorySuccess`, `import.createCategoryError` keys in both locales -- i18n coverage matches existing pattern for all other import strings

**Acceptance Criteria:**
- Given a transaction whose merchant matches no existing category, when the AI parses the statement, then the transaction's row shows a "Create category" proposal instead of just an empty/flagged dropdown.
- Given a proposal referencing a new group (no `group_id`), when the user confirms, then a new group is created first, then the category under it, then the transaction is assigned to it.
- Given a proposal referencing an existing group (`group_id` set), when the user confirms, then only the category is created (no duplicate group).
- Given the user ignores the proposal and picks a category manually instead, then import proceeds exactly as it does today with no forced creation.

## Design Notes

`propose_category` is additive and independent of `suggested_category_id` — the AI still returns `suggested_category_id: null` alongside the proposal (nothing to suggest from the existing list), so all existing null-handling logic (`categoriesComplete`, flagged/auto split by `confidence`) keeps working unchanged; the proposal is purely an extra affordance layered on top of the "needs category" state.

## Verification

**Commands:**
- `cd apps/desktop/src-tauri && cargo build` -- expected: compiles clean, no warnings per docs/guidelines/warnings.md
- `cd apps/desktop && pnpm exec tsc --noEmit` -- expected: zero type errors
- `cd apps/desktop && pnpm exec playwright test tests/import.spec.ts` -- expected: all pass, including new "AI Category Proposals" cases
- `cd apps/desktop && pnpm test` -- expected: existing unit test suite still passes (no import-specific unit tests exist; coverage is via Playwright)

**Manual checks (if no CLI):**
- Run the app, import a statement with a merchant that clearly doesn't match any existing category, confirm the "Create category" proposal appears, confirm it creates the category/group and resolves the row.

## Suggested Review Order

**Schema & prompt change (backend)**

- Entry point: the new field the AI can emit and its contract with `suggested_category_id`/`confidence`.
  [`cc_parser.rs:16`](../../apps/desktop/src-tauri/src/ai/cc_parser.rs#L16)

- Confidence is forced to 0 whenever a proposal is present, so the row always lands in the flagged bucket regardless of what the model returns.
  [`cc_parser.rs:292`](../../apps/desktop/src-tauri/src/ai/cc_parser.rs#L292)

- Lenient parsing: a malformed `propose_category` degrades to "no proposal" instead of failing the whole batch, and hallucinated `group_id`/empty names are sanitized here.
  [`cc_parser.rs:143`](../../apps/desktop/src-tauri/src/ai/cc_parser.rs#L143)

- Prompt instructions updated to document the new field and the confidence=0 contract.
  [`cc_parser.rs:119`](../../apps/desktop/src-tauri/src/ai/cc_parser.rs#L119)

**Create-on-confirm flow (frontend)**

- Core handler: reuses existing `create_budget_group`/`create_budget_category`, sanitizes hallucinated `group_id`/empty `group_name`, and caches a created group id so a failed retry doesn't duplicate the group.
  [`import.tsx:334`](../../apps/desktop/src/routes/import.tsx#L334)

- Per-row creation state is a `Set`, not a single scalar, so concurrent proposals on different rows don't clobber each other's pending/disabled state.
  [`import.tsx:215`](../../apps/desktop/src/routes/import.tsx#L215)

- Proposal is only surfaced for selected, unresolved rows — resolved and deselected rows never show a stale "create category" button.
  [`import.tsx:664`](../../apps/desktop/src/routes/import.tsx#L664)

**UI affordance**

- New optional props and the inline "Create category" alert/button, gated on `!isResolved`.
  [`TransactionReviewCard.tsx:173`](../../apps/desktop/src/components/import/TransactionReviewCard.tsx#L173)

**Types & i18n (supporting)**

- `ProposedCategory` TS type and the new optional field on `ParsedTransaction`.
  [`useImport.ts:6`](../../apps/desktop/src/hooks/useImport.ts#L6)

- New `import.proposedCategory` / `createCategoryButton` / `createCategorySuccess` / `createCategoryError` keys (en + fr, key-parity checked).
  [`en.json:547`](../../apps/desktop/src/locales/en.json#L547)

- New Playwright coverage for the existing-group, new-group, and manual-override paths.
  [`import.spec.ts:437`](../../apps/desktop/tests/import.spec.ts#L437)
