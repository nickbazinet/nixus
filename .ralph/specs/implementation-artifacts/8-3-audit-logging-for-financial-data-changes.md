# Story 8.3: Audit Logging for Financial Data Changes

Status: review

## Story

As a user,
I want all financial data changes logged for traceability,
So that I can trust that my records are reliable and no data is silently lost.

## Acceptance Criteria

**Given** any financial data is created, updated, or deleted (expenses, account balances, asset values, imports)
**When** the write operation completes
**Then** an entry is recorded in the `audit_log` table (created via migration) with columns: `id`, `action` (create/update/delete), `entity_type` (expense/account/asset/import), `entity_id`, `details_json` (before/after values), `created_at`
**And** audit log entries are never deleted or modified (append-only)
**And** the audit log is included in database backups (NFR11)

## Tasks / Subtasks

### Task 1: Database Migration — Audit Log Table

Create the `audit_log` table via SQL migration.

**AC reference:** "entry is recorded in the `audit_log` table with columns: `id`, `action`, `entity_type`, `entity_id`, `details_json`, `created_at`"

- Create migration file `src-tauri/migrations/NNN_audit_log.sql` (number based on existing migrations)
- Table schema:
  ```sql
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    entity_type TEXT NOT NULL CHECK(entity_type IN ('expense', 'account', 'asset', 'import', 'budget_group', 'budget_category')),
    entity_id INTEGER NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
- Add index: `idx_audit_log_entity` on `(entity_type, entity_id)` for querying by entity
- Add index: `idx_audit_log_created_at` on `(created_at)` for chronological queries
- Verify: Migration applies on app startup without errors

### Task 2: Rust Audit Log DB Functions

Implement database functions for writing and reading audit log entries.

**AC reference:** "entry is recorded" + "never deleted or modified (append-only)"

- Create `src-tauri/src/db/audit.rs`
- `insert_audit_log(conn: &Connection, action: &str, entity_type: &str, entity_id: i64, details_json: &str) -> Result<(), AppError>`
- `get_audit_log(conn: &Connection, entity_type: Option<&str>, entity_id: Option<i64>, limit: i64) -> Result<Vec<AuditLogEntry>, AppError>`
- Add `AuditLogEntry` struct to `src-tauri/src/models/mod.rs`: `{ id: i64, action: String, entity_type: String, entity_id: i64, details_json: String, created_at: String }`
- No update or delete functions — audit log is append-only by design
- Verify: Insert and query functions work correctly

### Task 3: Integrate Audit Logging into Expense Commands

Add audit log entries when expenses are created, updated, or deleted.

**AC reference:** "any financial data is created, updated, or deleted (expenses...)"

- In `src-tauri/src/commands/expense.rs`:
  - After `create_expense`: call `insert_audit_log(conn, "create", "expense", expense.id, &serde_json::to_string(&expense)?)`
  - After `update_expense`: call `insert_audit_log(conn, "update", "expense", id, &json({"before": old, "after": new}))`
  - After `delete_expense`: call `insert_audit_log(conn, "delete", "expense", id, &serde_json::to_string(&old_expense)?)`
- The `details_json` for updates should capture both before and after values
- Verify: Creating, updating, and deleting an expense each produce an audit log entry

### Task 4: Integrate Audit Logging into Account Commands

Add audit log entries when accounts are created, updated, or balances change.

**AC reference:** "any financial data is created, updated, or deleted (...account balances...)"

- In `src-tauri/src/commands/account.rs`:
  - After `create_account`: log create action with account details
  - After `update_balance`: log update action with `{"before": old_balance_cents, "after": new_balance_cents}`
  - After `delete_account`: log delete action with account details
- Balance updates are the most important to audit — they affect net worth calculations
- Verify: Balance update produces an audit log entry with before/after values

### Task 5: Integrate Audit Logging into Asset Commands

Add audit log entries when assets are created, updated, or values change.

**AC reference:** "any financial data is created, updated, or deleted (...asset values...)"

- In `src-tauri/src/commands/asset.rs`:
  - After `create_asset`: log create action
  - After `update_value`: log update action with before/after estimated values
  - After `delete_asset`: log delete action
- Verify: Asset value update produces an audit log entry

### Task 6: Integrate Audit Logging into Import Commands

Add audit log entries when CC statement imports are confirmed.

**AC reference:** "any financial data is created, updated, or deleted (...imports)"

- In `src-tauri/src/commands/import.rs`:
  - After `confirm_import`: log a single "create" action with entity_type "import" and details containing the count of imported transactions and a summary
  - Individual imported expenses are also logged via the expense audit (Task 3) if they go through `create_expense`
- Verify: Confirming an import produces an audit log entry

### Task 7: Rust Unit Tests

Write tests for audit log functionality.

**AC reference:** Append-only behavior, correct data capture

- Test: `insert_audit_log` creates a record with correct fields
- Test: `get_audit_log` returns entries filtered by entity_type
- Test: `get_audit_log` returns entries filtered by entity_id
- Test: `get_audit_log` returns entries in reverse chronological order (most recent first)
- Test: `details_json` is valid JSON and contains expected fields
- Verify: `cd src-tauri && cargo test` passes

## Dev Notes

### Architecture

- The `audit_log` table lives in the same SQLite database as all other data — it is automatically included in backups (NFR11)
- Audit logging is separate from the `tracing` crate file-based logging (set up in Story 1.3). Tracing is for operational debugging; audit log is for financial data integrity
- Audit log entries are append-only — no UPDATE or DELETE operations should ever be performed on this table
- The `details_json` column stores a JSON string with before/after values, allowing flexible schema without additional columns

### Integration Pattern

- Audit log calls are added directly in the `commands/` layer, after the `db/` mutation succeeds
- This keeps audit logging co-located with the business operation rather than hidden in the db layer
- If a db write succeeds but the audit log insert fails, the command should still return success (audit failure should not block the user) — log a `tracing::error!` for the audit failure
- Consider wrapping audit inserts in a helper function to reduce boilerplate: `audit(conn, "create", "expense", id, &data)`

### Details JSON Format

```json
// Create
{"name": "Groceries", "amount_cents": 5000, "category_id": 3}

// Update
{"before": {"balance_cents": 100000}, "after": {"balance_cents": 95000}}

// Delete
{"name": "Old Account", "balance_cents": 0}
```

### Scope

- This story covers the audit log infrastructure and integration with existing commands
- A queryable audit log viewer UI is optional / out of scope for this story — the data is stored and queryable via the `get_audit_log` function for future use
- Budget group/category changes could also be audited but are lower priority — the CHECK constraint on `entity_type` includes them for future use

### Project Structure Notes

**Backend files:**
- `src-tauri/migrations/NNN_audit_log.sql` — migration
- `src-tauri/src/db/audit.rs` — insert and query functions
- `src-tauri/src/models/mod.rs` — `AuditLogEntry` struct
- `src-tauri/src/commands/expense.rs` — audit integration
- `src-tauri/src/commands/account.rs` — audit integration
- `src-tauri/src/commands/asset.rs` — audit integration
- `src-tauri/src/commands/import.rs` — audit integration

### References

- NFR11: Financial records are never silently lost or corrupted
- Architecture: "Audit trail — `audit_log` table in SQLite — Records financial data changes (balance updates, transaction edits, imports) for NFR11 compliance"
- Architecture: "Log financial data changes to the `audit_log` table" (enforcement rule #8)
- Architecture: "Audit log table for financial data changes — separate from tracing, persisted in SQLite" (logging patterns)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Audit log table (migration 006) and basic `insert_audit_log` function already existed. Enhanced with indexes, query function, and full integration.

### Completion Notes List
- Task 1: Created migration 010 for audit log indexes (`idx_audit_log_entity`, `idx_audit_log_created_at`). Table already existed from migration 006.
- Task 2: Enhanced `db/audit.rs` with `get_audit_log` query function supporting entity_type/entity_id filters. Added `AuditLogEntry` model. Append-only design (no update/delete functions).
- Task 3: Added audit logging to all expense commands: create (logs new expense), update (logs before/after), delete (logs deleted expense). Non-blocking — failures logged via tracing.
- Task 4: Completed account audit logging: added create and delete audit. Update details and balance_update already existed. Non-blocking pattern.
- Task 5: Completed asset audit logging: added create and delete audit. Value_update already existed. Added update for name/type changes. Non-blocking pattern.
- Task 6: Import audit logging already existed (logs transaction count on confirm_import).
- Task 7: 5 Rust unit tests for audit log: insert creates correct fields, filters by entity_type, filters by entity_id, reverse chronological order, valid JSON details.
- Full suite: 16/16 Rust tests, 130/130 Playwright tests pass.

### File List
- `src-tauri/migrations/010_audit_log_indexes.sql` (new)
- `src-tauri/src/db/mod.rs` (modified — added migration 10)
- `src-tauri/src/db/audit.rs` (modified — added get_audit_log, tests)
- `src-tauri/src/models/mod.rs` (modified — added AuditLogEntry)
- `src-tauri/src/commands/expense.rs` (modified — added audit logging)
- `src-tauri/src/commands/account.rs` (modified — completed audit logging)
- `src-tauri/src/commands/asset.rs` (modified — completed audit logging)

### Change Log
- 2026-03-15: Implemented Story 8.3 — Audit Logging for Financial Data Changes. All 7 tasks complete. 5 audit unit tests added. 16/16 Rust + 130/130 Playwright tests passing.
