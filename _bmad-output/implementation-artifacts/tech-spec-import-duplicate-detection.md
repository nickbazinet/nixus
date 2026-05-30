---
title: 'Import Duplicate Detection'
type: 'feature'
created: '2026-03-25'
status: 'done'
baseline_commit: '3b7317e7'
context: []
---

# Import Duplicate Detection

<frozen-after-approval reason="human-owned intent -- do not modify unless human renegotiates">

## Intent

**Problem:** When importing credit card statements, there is no way to know if transactions have already been entered (manually or from a previous import). Users can accidentally create duplicate expenses, corrupting their budget data.

**Approach:** After AI extraction and before the review screen, check each extracted transaction against existing expenses by matching (merchant, date, amount_cents). Flag potential duplicates in the review UI so the user can see and deselect them before confirming. Pure DB query -- no additional AI cost.

## Boundaries & Constraints

**Always:**
- Match on exact (merchant case-insensitive, date, amount_cents) triple
- Flag duplicates visually but do NOT auto-deselect -- user decides
- Check all existing expenses regardless of source (manual or import)

**Ask First:**
- Fuzzy merchant matching (e.g., "COSTCO WHOLESALE" vs "Costco")
- Auto-deselecting duplicates by default

**Never:**
- Block the import if duplicates exist -- user override is final
- Add AI compute for duplicate detection
- Change the existing import pipeline stages or AI extraction

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Exact duplicate exists | Imported tx matches existing (merchant, date, amount) | Tx flagged as "Possible duplicate" in review UI | N/A |
| No duplicates | Fresh transactions | No flags, normal review flow | N/A |
| Multiple matches | Imported tx matches 2+ existing expenses | Still flagged once (boolean flag is sufficient) | N/A |
| Partial match only | Same merchant+date but different amount | Not flagged | N/A |

</frozen-after-approval>

## Code Map

- `src-tauri/src/db/expense.rs` -- Add `find_duplicates()` batch lookup
- `src-tauri/src/commands/import.rs` -- Call find_duplicates after AI extraction, add duplicate indices to ImportComplete event
- `src-tauri/src/ai/cc_parser.rs` -- No changes (ParsedTransaction struct used as-is)
- `src/hooks/useImport.ts` -- Receive and store duplicate indices from import:complete event
- `src/routes/import.tsx` -- Pass duplicate info to review components
- `src/components/import/AutoCategorizedSummary.tsx` -- Show duplicate badge on flagged rows
- `src/components/import/TransactionReviewCard.tsx` -- Show duplicate warning on flagged cards

## Tasks & Acceptance

**Execution:**
- [ ] `src-tauri/src/db/expense.rs` -- Add `find_duplicate_indices(conn, transactions)` that takes a slice of (merchant, date, amount_cents) tuples and returns a `Vec<usize>` of indices where a matching expense exists (case-insensitive merchant, exact date, exact amount)
- [ ] `src-tauri/src/commands/import.rs` -- After AI extraction succeeds, call `find_duplicate_indices` with parsed transactions; add `duplicate_indices: Vec<usize>` to `ImportComplete` struct and emit it
- [ ] `src/hooks/useImport.ts` -- Receive `duplicate_indices` from `import:complete` event payload and expose in hook return value
- [ ] `src/routes/import.tsx` -- Pass `duplicateIndices` set to `AutoCategorizedSummary` and `TransactionReviewCard` components
- [ ] `src/components/import/AutoCategorizedSummary.tsx` -- Show amber "Possible duplicate" badge on rows whose index is in duplicateIndices
- [ ] `src/components/import/TransactionReviewCard.tsx` -- Show amber "Possible duplicate" warning banner at top of card for flagged transactions
- [ ] `tests/import-duplicates.spec.ts` -- Test: duplicate-flagged transactions show warning badge; non-duplicate transactions do not; duplicates are still selectable

**Acceptance Criteria:**
- Given an imported transaction matches an existing expense on (merchant, date, amount_cents), when the review screen renders, then that transaction shows a "Possible duplicate" indicator
- Given an imported transaction has no matching existing expense, when the review screen renders, then no duplicate indicator is shown
- Given a transaction is flagged as duplicate, when the user keeps it selected and confirms, then it is imported normally (no blocking)

## Verification

**Commands:**
- `cd src-tauri && cargo check` -- expected: no compilation errors
- `npx tsc --noEmit` -- expected: no type errors
- `npx playwright test tests/import-duplicates.spec.ts` -- expected: all tests pass
- `npx playwright test tests/import.spec.ts` -- expected: existing import tests still pass
