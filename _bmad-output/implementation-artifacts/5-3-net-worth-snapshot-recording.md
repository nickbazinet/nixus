# Story 5.3: Net Worth Snapshot Recording

Status: review

## Story

As a user,
I want the system to automatically record my net worth whenever account balances or asset values change,
So that I have a historical record of my financial progress.

## Acceptance Criteria

**Given** the user updates an account balance or asset value
**When** the balance/value is saved
**Then** the system records a net worth snapshot in the `net_worth_snapshots` table (created via migration) with columns: `id`, `total_cents`, `snapshot_date`, `breakdown_json` (JSON string with per-category totals), `created_at`
**And** the snapshot includes a breakdown by category: cash, crypto, housing, TFSA, RRSP, non-registered, business, vehicles, other
**And** each account's contribution is mapped to a category based on its `account_type`
**And** calculations are accurate to the cent using integer arithmetic (NFR13)
**And** the snapshot is also recorded after CC import confirmation (expenses affect budget but not net worth directly — net worth updates when balances change)

## Tasks / Subtasks

### Task 1: Database Migration — Net Worth Snapshots Table
Create the migration file for the `net_worth_snapshots` table.

**AC reference:** "records a net worth snapshot in the `net_worth_snapshots` table with columns: id, total_cents, snapshot_date, breakdown_json, created_at"

- Create `src-tauri/migrations/NNN_net_worth_snapshots.sql` (number based on existing migrations):
  - `net_worth_snapshots` table:
    - `id` INTEGER PRIMARY KEY
    - `total_cents` INTEGER NOT NULL
    - `snapshot_date` TEXT NOT NULL (ISO 8601 date, e.g., "2026-03-14")
    - `breakdown_json` TEXT NOT NULL (JSON string with per-category totals)
    - `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
  - Index: `idx_net_worth_snapshots_date` on `snapshot_date` for efficient range queries
- Verify: Migration applies on app startup without errors

### Task 2: Rust Models for Snapshots
Define structs for net worth snapshots and breakdown data.

**AC reference:** "breakdown by category: cash, crypto, housing, TFSA, RRSP, non-registered, business, vehicles, other"

- Add to `src-tauri/src/models/mod.rs`:
  - `NetWorthSnapshot { id: i64, total_cents: i64, snapshot_date: String, breakdown_json: String, created_at: String }`
  - `NetWorthBreakdown { cash_cents: i64, crypto_cents: i64, housing_cents: i64, tfsa_cents: i64, rrsp_cents: i64, non_registered_cents: i64, business_cents: i64, vehicles_cents: i64, other_cents: i64 }` — serialized to/from `breakdown_json`
- All structs derive `Serialize`, `Deserialize`, `Debug`, `Clone`

### Task 3: Account Type to Category Mapping
Define the mapping from account types to net worth breakdown categories.

**AC reference:** "each account's contribution is mapped to a category based on its account_type"

- Add to `src-tauri/src/db/net_worth.rs` (or a utility within the module):
  - Mapping function: `fn map_account_type_to_category(account_type: &str) -> &str`
  - Chequing, Savings → "cash"
  - Crypto → "crypto"
  - TFSA → "tfsa"
  - RRSP → "rrsp"
  - Non-registered → "non_registered"
  - Other account types → "other"
  - Passive asset type mapping:
    - Real estate, property → "housing"
    - Vehicle → "vehicles"
    - Business → "business"
    - Other → "other"
- The exact account type values must match what Epic 4 defined in the `accounts` and `passive_assets` tables

### Task 4: Snapshot Recording Logic — DB Layer
Implement the function that computes and records a net worth snapshot.

**AC reference:** "records a net worth snapshot" + "calculations accurate to the cent using integer arithmetic (NFR13)"

- Add to `src-tauri/src/db/net_worth.rs`:
  - `record_net_worth_snapshot(conn: &Connection) -> Result<NetWorthSnapshot, AppError>`
    - Query all accounts: `SELECT account_type, balance_cents FROM accounts`
    - Query all passive assets: `SELECT asset_type, estimated_value_cents FROM passive_assets`
    - Sum each into breakdown categories using the mapping from Task 3
    - Calculate `total_cents` = sum of all categories
    - Serialize breakdown as JSON string
    - Insert into `net_worth_snapshots` with today's date
    - All arithmetic in integer cents — no floating point (NFR13)
  - `get_net_worth_snapshots(conn: &Connection, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<NetWorthSnapshot>, AppError>` — for history queries (used by Story 5.4)
  - `get_latest_snapshot(conn: &Connection) -> Result<Option<NetWorthSnapshot>, AppError>` — most recent snapshot
- Deduplication: If a snapshot already exists for today's date, update it instead of creating a duplicate (UPSERT or check-then-update)

### Task 5: Trigger Snapshot on Balance/Value Changes
Wire snapshot recording into the account and asset update flows.

**AC reference:** "Given the user updates an account balance or asset value, When the balance/value is saved, Then the system records a net worth snapshot"

- Modify `src-tauri/src/commands/account.rs`:
  - After `update_account_balance` succeeds, call `record_net_worth_snapshot(conn)`
  - The snapshot is a side effect of the balance update — same transaction or immediately after
- Modify `src-tauri/src/commands/asset.rs`:
  - After `update_asset_value` succeeds, call `record_net_worth_snapshot(conn)`
- Modify `src-tauri/src/commands/account.rs` (for create/delete):
  - After `create_account` or `delete_account` succeeds, call `record_net_worth_snapshot(conn)`
- Modify `src-tauri/src/commands/asset.rs` (for create/delete):
  - After `create_asset` or `delete_asset` succeeds, call `record_net_worth_snapshot(conn)`
- The snapshot recording should not fail the parent operation — wrap in a separate error handler that logs failures but does not propagate them (the balance/value update should still succeed even if snapshot recording fails)

### Task 6: Tauri Command for Manual Snapshot
Expose a command for explicit snapshot recording (useful for testing and future use).

**AC reference:** General — provides a way to trigger snapshots outside of balance/value updates.

- Add to `src-tauri/src/commands/net_worth.rs`:
  - `#[tauri::command] fn record_net_worth_snapshot(state) -> Result<NetWorthSnapshot, AppError>`
- Register in `src-tauri/src/main.rs`
- This command is also useful for the CC import confirmation flow (Task 7)

### Task 7: Trigger Snapshot After CC Import Confirmation
Wire snapshot recording into the import confirmation flow.

**AC reference:** "snapshot is also recorded after CC import confirmation"

- Note: This task may be deferred until Epic 6 (AI-Powered CC Import) is implemented
- When implemented, modify the import confirmation command to call `record_net_worth_snapshot(conn)` after successfully saving imported transactions
- Alternatively, the frontend can call the `record_net_worth_snapshot` command after import confirmation via TanStack Query mutation's `onSuccess` callback
- Document this integration point for the Epic 6 developer

### Task 8: TanStack Query Integration
Ensure snapshot recording triggers appropriate cache invalidation.

**AC reference:** Dashboard and net worth data should refresh after snapshots are recorded.

- In account/asset mutation hooks (from Epic 4):
  - After balance/value update mutation succeeds, invalidate `["net-worth-current"]` and `["net-worth-snapshots-recent"]` query keys
  - This ensures the dashboard net worth card and sparkline update
- Add to `src/hooks/useNetWorth.ts` (if not already existing):
  - Ensure query keys are exported for invalidation by other hooks

### Task 9: Rust Unit Tests
Write unit tests for the snapshot recording logic.

**AC reference:** "calculations accurate to the cent using integer arithmetic (NFR13)"

- Add `#[cfg(test)] mod tests` in `src-tauri/src/db/net_worth.rs`:
  - Test: `map_account_type_to_category` returns correct categories for all known account types
  - Test: Snapshot total equals sum of all account balances + asset values
  - Test: Breakdown JSON contains all expected category fields with correct cents values
  - Test: Same-day deduplication — calling `record_net_worth_snapshot` twice on the same day produces one snapshot (updated), not two
  - Test: Empty accounts/assets produces a snapshot with all zeros
- Run: `cd src-tauri && cargo test`

## Dev Notes

### Architecture Guidance

This story implements the backend mechanism for tracking net worth over time. It is primarily a Rust backend story with minimal frontend work (just cache invalidation). The snapshot data feeds into Story 5.2 (dashboard sparkline) and Story 5.4 (net worth history page).

**Database:**
- `net_worth_snapshots` table stores one row per snapshot event.
- `breakdown_json` is a JSON string, not a separate table. This keeps the schema simple and the snapshot self-contained. Example: `{"cash_cents": 15000000, "crypto_cents": 5000000, "housing_cents": 45000000, ...}`
- Deduplication: At most one snapshot per calendar day. If a user updates balances multiple times in a day, the latest values win.
- Index on `snapshot_date` supports efficient range queries for 6M/1Y/ALL period filtering (Story 5.4).

**Rust Backend:**
- `db/net_worth.rs` contains all snapshot-related queries.
- Snapshot recording is a side effect of balance/value mutations — called from command handlers after the primary operation succeeds.
- Snapshot recording failures are logged but do not fail the parent operation. Use `if let Err(e) = record_net_worth_snapshot(conn) { tracing::error!("Failed to record snapshot: {}", e); }`.
- All monetary calculations use integer cents (i64). No floating point.

**Account Type Mapping:**
- The mapping depends on the `account_type` values defined in Epic 4. Check the `accounts` table schema and the values used when creating accounts.
- Passive assets use `asset_type` — check the `passive_assets` table from Epic 4.
- If Epic 4 uses different type values than expected, adjust the mapping accordingly.

**Integration Points:**
- Account commands (`update_balance`, `create_account`, `delete_account`) — trigger snapshot
- Asset commands (`update_value`, `create_asset`, `delete_asset`) — trigger snapshot
- Import confirmation (Epic 6) — trigger snapshot (deferred, document for Epic 6 dev)

### Scope Boundaries

**In scope:**
- `net_worth_snapshots` database table (migration)
- Rust models for snapshots and breakdown
- Account type to category mapping
- Snapshot recording logic (compute + insert)
- Same-day deduplication
- Triggering snapshots on account/asset changes
- Manual snapshot Tauri command
- TanStack Query cache invalidation
- Rust unit tests

**Dependencies:**
- Epic 4 (accounts and assets must exist — `accounts` and `passive_assets` tables with `account_type`/`asset_type` columns)

**Out of scope (handled by other stories):**
- Dashboard sparkline display (Story 5.2)
- Net worth history page (Story 5.4)
- CC import trigger (Epic 6 — documented as integration point)
- Audit log entry for snapshots (could be added but not required by AC)

### Project Structure Notes

**Files to create:**
- `src-tauri/migrations/NNN_net_worth_snapshots.sql`

**Files to create/modify:**
- `src-tauri/src/db/net_worth.rs` — create if not existing, add snapshot recording + retrieval functions
- `src-tauri/src/commands/net_worth.rs` — create if not existing, add manual snapshot command
- `src-tauri/src/models/mod.rs` — add NetWorthSnapshot, NetWorthBreakdown structs

**Files to modify:**
- `src-tauri/src/db/mod.rs` — register net_worth module
- `src-tauri/src/commands/mod.rs` — register net_worth module
- `src-tauri/src/main.rs` — register net_worth Tauri commands
- `src-tauri/src/commands/account.rs` — add snapshot trigger after balance/create/delete
- `src-tauri/src/commands/asset.rs` — add snapshot trigger after value/create/delete
- `src/hooks/useAccounts.ts` — invalidate net-worth query keys on mutation success
- `src/hooks/useAssets.ts` — invalidate net-worth query keys on mutation success

### References

- Epic 5 stories: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/epics.md`
- Architecture — net_worth_snapshots table, db/net_worth.rs, commands/net_worth.rs: `/Users/nbazinet/projects/nkbaz-finance/_bmad-output/planning-artifacts/architecture.md`
- Architecture — monetary values as integer cents (NFR13): architecture doc Enforcement Guidelines
- Architecture — audit logging pattern: architecture doc Process Patterns
- FR26: System can record a net worth snapshot each time account balances or asset values change

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No issues. Rust compiled clean (2 warnings for unused functions that Story 5.4 will use). 6 Rust unit tests pass. 84 Playwright E2E tests pass.

### Completion Notes List
- Task 1: Migration 008 creates `net_worth_snapshots` table with `snapshot_date` index.
- Task 2: Added `NetWorthSnapshot` and `NetWorthBreakdown` models. Breakdown includes `fhsa_cents` (matching existing FHSA account type).
- Task 3: `map_account_type_to_category` and `map_asset_type_to_category` in `db/net_worth.rs`.
- Task 4: `record_net_worth_snapshot` computes breakdown from accounts+assets, upserts per day. Also `get_net_worth_snapshots` (range query) and `get_latest_snapshot` for Story 5.4.
- Task 5: Snapshot triggered on `create_account`, `update_account_balance`, `delete_account`, `create_asset`, `update_asset_value`, `delete_asset`. Failures logged but don't fail parent operation.
- Task 6: `record_net_worth_snapshot` Tauri command registered.
- Task 7: CC import trigger deferred to Epic 6 — documented in Dev Notes.
- Task 8: Account/asset mutation hooks invalidate `netWorthCurrent` and `netWorthSnapshotsRecent` query keys.
- Task 9: 6 Rust unit tests: mapping, total accuracy, breakdown JSON, deduplication, empty state.

### File List
- `src-tauri/migrations/008_net_worth_snapshots.sql` (new)
- `src-tauri/src/db/net_worth.rs` (modified — added snapshot recording, retrieval, mapping, unit tests)
- `src-tauri/src/commands/net_worth.rs` (modified — added record_net_worth_snapshot command)
- `src-tauri/src/models/mod.rs` (modified — added NetWorthSnapshot, NetWorthBreakdown)
- `src-tauri/src/db/mod.rs` (modified — registered migration 008)
- `src-tauri/src/lib.rs` (modified — registered record_net_worth_snapshot command)
- `src-tauri/src/commands/account.rs` (modified — trigger snapshot on create/update_balance/delete)
- `src-tauri/src/commands/asset.rs` (modified — trigger snapshot on create/update_value/delete)
- `src/hooks/useAccounts.ts` (modified — invalidate net-worth query keys)
- `src/hooks/useAssets.ts` (modified — invalidate net-worth query keys)

### Change Log
- 2026-03-15: Story 5.3 implemented — net_worth_snapshots table, breakdown by category, snapshot triggered on balance/value changes, same-day deduplication, Rust unit tests, TanStack Query cache invalidation.
