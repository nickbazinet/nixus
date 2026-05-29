---
title: 'Normalize Imported Transaction Dates to YYYY-MM-DD'
slug: 'normalize-import-dates'
created: '2026-03-15'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Rust', 'TypeScript', 'React', 'Tauri v2', 'SQLite/rusqlite', 'chrono 0.4 (already in Cargo.toml)']
files_to_modify: ['src-tauri/src/commands/import.rs', 'src/routes/import.tsx', 'tests/import.spec.ts']
code_patterns: ['confirm_import command with rename_all snake_case and Vec<ConfirmTransaction>', 'bulk_insert_imported_expenses takes &[(String, i64, i64, String)] tuples', 'chrono::Local::now() used in chat.rs and backup.rs', 'AppError::Validation for input errors with field and message']
test_patterns: ['Playwright with setupTauriMock helper that stubs __TAURI_INTERNALS__', 'triggerUpload helper to reach review screen', 'data-testid selectors', 'Mock dates are YYYY-MM-DD format (2026-03-10)', 'confirm_import mock returns { imported_count }']
---

# Tech-Spec: Normalize Imported Transaction Dates to YYYY-MM-DD

**Created:** 2026-03-15

## Overview

### Problem Statement

When importing credit card statements, the AI extraction returns dates in non-standard formats (e.g. "14 MAR", "Mar 14, 2026", "03/14/2026") from the raw statement text. These date strings are stored as-is in the SQLite `expenses` table via `bulk_insert_imported_expenses`, which performs no date validation. All dashboard and budget queries use `strftime('%Y', date)` or date range comparisons (`date >= '2026-03-01'`) that require YYYY-MM-DD format. Non-conforming dates silently return no matches, making imported expenses invisible across the entire app.

### Solution

Normalize dates to YYYY-MM-DD format in the Rust `confirm_import` command before inserting into the database. Add frontend validation on the review screen to catch and surface invalid dates before the user confirms.

### Scope

**In Scope:**
- Date parsing and normalization in `confirm_import` Rust command (handle common formats: "14 MAR", "Mar 14, 2026", "03/14/2026", "2026-03-14", etc.)
- Frontend validation on review screen date `<input type="date">` fields to ensure YYYY-MM-DD before enabling confirm
- Error feedback to user if dates can't be parsed

**Out of Scope:**
- Fixing existing bad data in the database
- Changes to the AI extraction prompt or pipeline
- Changes to existing DB queries (they already expect YYYY-MM-DD correctly)
- Changes to the upload/validation flow

## Context for Development

### Codebase Patterns

- `confirm_import` in `src-tauri/src/commands/import.rs` receives `Vec<ConfirmTransaction>` with `date: String` and passes tuples to `bulk_insert_imported_expenses`
- `ConfirmTransaction` struct uses `#[derive(Debug, Deserialize)]` — fields: `merchant: String`, `amount_cents: i64`, `budget_category_id: i64`, `date: String`
- `bulk_insert_imported_expenses` in `src-tauri/src/db/expense.rs` inserts raw date strings with zero validation into `expenses.date TEXT NOT NULL`
- `chrono` crate (v0.4, serde feature) is already in `Cargo.toml` — used via `chrono::Local::now()` in `commands/chat.rs` and `commands/backup.rs`
- Error pattern: `AppError::Validation { message, field: Some("date") }` for returning validation errors to the frontend
- Review screen date inputs use `<input type="date">` which requires YYYY-MM-DD to render; non-conforming AI values display as empty/blank
- `ParsedTransaction` in `src/hooks/useImport.ts` has `date: string` with no format constraint
- All 6 expense queries across `db/dashboard.rs`, `db/budget.rs`, and `db/expense.rs` use `strftime('%Y', date)` / `strftime('%m', date)` or date range string comparisons — all require YYYY-MM-DD
- Frontend `handleConfirm` builds `finalTransactions` with `date: tx.date` passed through from AI response

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/commands/import.rs` | `confirm_import` command — add `normalize_date()` call before building tuples |
| `src-tauri/src/db/expense.rs` | `bulk_insert_imported_expenses` — no changes needed (normalization upstream) |
| `src-tauri/src/ai/cc_parser.rs` | AI prompt requests YYYY-MM-DD at line 57 but AI may return raw statement format |
| `src/routes/import.tsx` | ReviewScreen `handleConfirm` — add frontend date validation before invoke |
| `tests/import.spec.ts` | 22 existing tests with `setupTauriMock` and `triggerUpload` helpers |
| `src-tauri/src/error.rs` | `AppError::Validation` variant for error handling pattern |

### Technical Decisions

- **Normalize in `confirm_import` (Rust side)** as the last line of defense before DB insertion — catches all cases regardless of frontend state
- **Use `chrono::NaiveDate::parse_from_str`** with multiple format patterns tried in sequence: `%Y-%m-%d`, `%d %b %Y`, `%d %b`, `%b %d, %Y`, `%m/%d/%Y`, `%d/%m/%Y`
- **For yearless formats** like "14 MAR": default to current year via `chrono::Local::now().year()`
- **Case-insensitive matching**: uppercase the input before parsing to handle "mar", "Mar", "MAR"
- **Return `AppError::Validation`** with the offending date string if no format matches — surfaces to user as a toast error
- **Frontend validation**: check that each transaction's `date` field matches `/^\d{4}-\d{2}-\d{2}$/` before enabling the confirm button; show inline warning on rows with invalid dates
- **No changes to `bulk_insert_imported_expenses`** — it correctly inserts whatever it receives; the fix belongs upstream in the command layer

## Implementation Plan

### Tasks

- [x] Task 1: Add `normalize_date` function to `src-tauri/src/commands/import.rs`
  - File: `src-tauri/src/commands/import.rs`
  - Action: Add a `fn normalize_date(raw: &str) -> Result<String, AppError>` function that:
    1. Trims whitespace from the input
    2. First tries `NaiveDate::parse_from_str(raw, "%Y-%m-%d")` — if it succeeds, return formatted string (already valid)
    3. Tries formats with year: `"%d %b %Y"`, `"%b %d, %Y"`, `"%m/%d/%Y"`, `"%d/%m/%Y"`, `"%Y/%m/%d"`
    4. Tries yearless formats: `"%d %b"`, `"%b %d"`, `"%d-%b"`, `"%b-%d"` — if matched, combine with `chrono::Local::now().year()` to build a full `NaiveDate`
    5. Before parsing, convert input to title case for month abbreviation matching (e.g., "14 MAR" → "14 Mar") since chrono's `%b` expects title case
    6. If no format matches, return `AppError::Validation { message: format!("Cannot parse date: '{}'", raw), field: Some("date".to_string()) }`
    7. Return the successfully parsed date formatted as `date.format("%Y-%m-%d").to_string()`
  - Notes: Add `use chrono::{Local, NaiveDate, Datelike};` to imports. The function is pure and testable. Title-case conversion: lowercase the input, then uppercase the first letter of each word-boundary after a space or hyphen.

- [x] Task 2: Call `normalize_date` in `confirm_import` before building tuples
  - File: `src-tauri/src/commands/import.rs`
  - Action: In the `confirm_import` function, replace the tuple-building loop (lines 200-210) to call `normalize_date(&t.date)?` for each transaction's date. The `?` operator will propagate the validation error back to the frontend as a toast if any date is unparseable. The updated code:
    ```rust
    let tuples: Vec<(String, i64, i64, String)> = transactions
        .iter()
        .map(|t| {
            let normalized_date = normalize_date(&t.date)?;
            Ok((
                t.merchant.clone(),
                t.amount_cents,
                t.budget_category_id,
                normalized_date,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    ```
  - Notes: This is a fail-fast approach — if any single date can't be parsed, the entire import is rejected with a clear error. This is intentional: better to surface the problem than silently import some rows with bad dates.

- [x] Task 3: Add frontend date validation in `handleConfirm` in `src/routes/import.tsx`
  - File: `src/routes/import.tsx`
  - Action: Before the `invoke("confirm_import", ...)` call in `handleConfirm`, add a validation check:
    1. Define regex: `const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;`
    2. Check all `finalTransactions`: `const invalidDate = finalTransactions.find(t => !DATE_REGEX.test(t.date));`
    3. If found: `toast.error(\`Invalid date format: "\${invalidDate.date}". Use the date picker to fix it.\`); setConfirming(false); return;`
  - Notes: This is a soft guard — the real enforcement is in Rust. But this gives a friendlier error before the round-trip. The `<input type="date">` already ensures user-edited dates are YYYY-MM-DD; this catches dates that came from the AI and were never edited.

- [x] Task 4: Add Playwright tests for date normalization behavior
  - File: `tests/import.spec.ts`
  - Action: Add a new test block `"Import Page — Date Normalization"` with:
    1. Create a new mock setup variant `setupTauriMockWithBadDates(page)` that emits transactions with non-YYYY-MM-DD dates: `{ merchant: "Coffee Shop", amount_cents: 550, date: "14 MAR", suggested_category_id: 1, confidence: 0.95 }` and `{ merchant: "Gas Station", amount_cents: 4200, date: "2026-03-15", suggested_category_id: 2, confidence: 0.95 }`
    2. Test: "date input shows empty for non-YYYY-MM-DD AI date" — verify the date input for "Coffee Shop" has empty value (browser can't render "14 MAR" in a date input), while "Gas Station" date input shows correctly
    3. Test: "confirm with invalid date shows error toast" — click confirm, verify toast error appears with "Invalid date format"
    4. Test: "fixing date via picker then confirming succeeds" — fill the empty date input with "2026-03-14", click confirm, verify completion screen appears
  - Notes: Reuse existing `triggerUpload` helper. The mock `confirm_import` handler doesn't need changes since it already returns success regardless.

### Acceptance Criteria

- [x] AC1: Given a credit card statement with dates in "DD MMM" format (e.g., "14 MAR"), when the user confirms the import, then the dates are normalized to YYYY-MM-DD (e.g., "2026-03-14") and stored correctly in the database.
- [x] AC2: Given a credit card statement with dates already in YYYY-MM-DD format, when the user confirms the import, then the dates pass through unchanged.
- [x] AC3: Given a transaction with a completely unparseable date (e.g., "tomorrow"), when the user clicks confirm, then an error toast is shown with the offending date string and no transactions are imported.
- [x] AC4: Given the AI returns a date that `<input type="date">` can't render (non-YYYY-MM-DD), when the review screen loads, then the date input appears empty and the user can manually enter a valid date using the date picker.
- [x] AC5: Given all transaction dates are valid YYYY-MM-DD after normalization, when the import completes, then the expenses appear correctly in the dashboard budget summary and spending breakdown for the matching month.
- [x] AC6: Given a yearless date like "14 MAR", when the backend normalizes it, then it uses the current year (2026) to produce "2026-03-14".

## Additional Context

### Dependencies

None — `chrono` crate is already in `Cargo.toml` with the `serde` feature. No new crates or npm packages required.

### Testing Strategy

- **Playwright E2E (3 new tests)**: Test that non-YYYY-MM-DD dates from AI surface validation errors on the frontend, and that fixing dates via the picker allows successful import.
- **Manual testing**: Import an actual credit card statement and verify expenses appear on the dashboard and budget page for the correct month. Check the date inputs on the review screen render correctly for AI-returned dates.
- **Rust unit tests (optional but recommended)**: The `normalize_date` function is pure — it could be unit-tested with `#[cfg(test)]` to cover all format patterns. However, this is optional given the Playwright E2E coverage.

### Notes

- The `normalize_date` function uses a fail-fast approach: if ANY date in the batch can't be parsed, the entire import is rejected. This prevents partial imports with bad data.
- The `%d/%m/%Y` vs `%m/%d/%Y` ambiguity (e.g., "03/04/2026") is inherent to date parsing. The function tries US format (`%m/%d/%Y`) first since credit card statements are primarily US-formatted. If this becomes an issue, a user preference could be added later (out of scope).
- The `<input type="date">` browser widget already guarantees that any user-edited date will be YYYY-MM-DD. The frontend validation only catches dates that came from the AI and were never manually edited by the user.
- The `top-budget-categories` query key is not invalidated after import (existing bug, separate issue). This spec does not address that.

## Review Notes
- Adversarial review completed
- Findings: 8 total, 7 fixed, 1 skipped (noise)
- Resolution approach: auto-fix
- Fixes applied: added `%d-%b-%Y` format + hyphen-aware title-casing (F2), confirm button now disabled when dates invalid (F3), 13 Rust unit tests added (F6), test mock captures confirm_import args for validation (F8), code comment on US-first slash ordering (F1)
