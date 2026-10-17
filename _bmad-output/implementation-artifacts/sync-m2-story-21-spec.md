# Story 21 — Tombstones, delete-wins, recently-deleted view (plan, self-approved)

## Decisions (auto, rules section 5)

- D1 DERIVED-IDENTITY TOMBSTONE (story 20 OPEN): a tombstone stays ABSORBING against partial edits
  (delete-wins, AD-5) and is LWW ONLY against a RE-CREATION — a full-row `field` message naming
  EVERY capturable column — with `hlc >` the tombstone. Symmetric on the tombstone side: a delete
  loses when the live row's MIN field-state hlc (its creation hlc) is greater than the tombstone's.
  Both halves are pure functions of the message set, so convergence is order-independent, and the
  simulator's frozen "concurrent edit loses to a delete" stays true (an edit is partial).
  Applies only to `RowIdentity::Natural` tables (config, maintenance_tasks,
  merchant_category_hints, project_images). `SurrogateOrTemplate` (expenses, income_entries) is
  recorded OPEN: apply cannot tell a template-derived uuid from a surrogate one by the message
  alone; the fix is re-deriving the expected uuid from the row's own columns (story 22/25).
- D2 LOCAL-ONLY: no capture hook => no `sync_tombstone` row, so the view returns
  `{ sync_available: false, items: [] }` and the UI shows an explanatory empty state. SPEC says
  deletes are "restorable for 30 days" only inside the sync capability; nothing is lost.
- D3 RESTORE IDENTITY (AD-2 + story 13): surrogate rows re-insert and MINT a new identity; Natural
  rows re-bind their deterministic uuid with `identity::ensure_derived` before the flush.
- D4 One transaction, all-or-nothing: the whole group (root + cascaded children + any restored
  parent chain) is one `ActiveDataset::write`, so a collision restores nothing.
- D5 Typed errors as `AppError::Sync { code }`: `restore_not_found`, `restore_parent_missing`,
  `restore_conflict`. Frontend narrows them in `lib/appError.ts`.
- D6 Purge: `sync_tombstone WHERE purge_after <= now`, every 6 h from the actor's `tick()` (first
  tick = startup). The delete MESSAGE in `sync_log` is untouched.
- D7 Simulator: NO restore op (story 25 owns `adopt_database`/restore per story 13's seam); D1 is
  proven by a dedicated two-replica test on the real pipeline instead. No assertion moves.

## Backend

- `db/sync_apply.rs`: `purge_tombstones`, `live_tombstones`, `delete_tombstone`, `row_exists`;
  `recent_tombstones`/`TombstoneRow` lose their `#[allow(dead_code)]`.
- `sync/apply.rs`: D1 in `apply_field` (revive) and `apply_tombstone` (delete loses); helpers
  `is_recreation`, `creation_hlc`.
- `sync/restore.rs` (NEW): `list(active)`, `restore(active, key)`, the group/label derivation,
  `DeletedItem`/`RecentlyDeletedView`, FK translation, balance via `capture::emit_balance_set`.
- `commands/sync.rs`: `list_recently_deleted`, `restore_deleted(id)` (`rename_all`, `AppError`,
  audit row through `db::audit::record`); registered in `lib.rs`.
- `sync/manager.rs`: `tombstone_purge_interval` in `SyncTuning`, purge at the top of `tick()`.
- Tests: `sync/tests_restore.rs` — single row, parent + cascaded children, natural-key collision,
  missing parent, money/balance, purge retention, delete-wins both orders, RESTRICT override,
  derived-identity resurrection convergence across two replicas.

## Frontend

- `components/settings/RecentlyDeleted*.tsx` inside the existing "Your data" area, `hooks/
  useRecentlyDeleted.ts` in `useSync.ts` style, `queryKeys.recentlyDeleted`, EN+FR strings,
  `tests/recently-deleted.spec.ts`, mock audit of the always-mounted callers.

## Not in this story

No reconcile (22), no snapshots/compaction (23), no status copy (24), no wipe/clone (25), no
version bump, no migration (schema stays 34).
