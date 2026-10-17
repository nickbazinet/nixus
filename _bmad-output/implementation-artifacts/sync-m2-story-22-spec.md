# Story 22 — Reconcile and write-site ratchet (plan, self-approved per rules §5)

AD-3 (tables are truth, reconcile heals what `ActiveDataset::write` did not see), AD-5 (merge kinds,
balance set/delta, counter deltas), AD-2 (identity), AD-16 (never block the UI), AD-14 (local-only
runs nothing), AD-19 (the ratchet is a CI gate).

## What is built

1. `sync/reconcile.rs` + `db/sync_reconcile.rs` (the SQL).
   - `step(conn, clock, install, &mut Cursor) -> ReconcileReport`: ONE `BEGIN IMMEDIATE`, at most
     `ROWS_PER_CHUNK = 500` rows of ONE table/phase, cursor advanced, resumable.
   - Two phases per travelling table: `Live` (ordered by `_rowid_`) and `Deleted` (ordered by
     `sync_uuid.uuid`).
   - Live row: identity resolved (mint for surrogate, DERIVE for the four `Natural` tables and for
     a template-linked `income_entries` row); every column that travels in a `field` message is
     encoded exactly as capture encodes it, hashed with the same domain, and compared with
     `sync_field_state`; the differing ones become ONE row-level `field` message. `Counter` column:
     live value − sum of recorded deltas, emitted as `counter_delta`. `Balance` column: live value
     vs the AD-5 fold, emitted as `balance_set` (never a generic field). `Excluded` skipped.
   - A deny-listed `config` key emits nothing and gets no identity. A `LocalOnly` table is not
     scanned at all. An `AppendOnly` row is emitted only when it has no field state (a missed
     INSERT) and never re-emitted.
   - Deleted phase: a mapping whose row is gone gets a `tombstone` message + a `sync_tombstone` row
     whose document is `{"_reconciled": true}` — the full row is unavailable, so it is MARKED and
     `sync/restore.rs` refuses it (`restore_not_found`) and the view does not list it.
   - Capture is OFF structurally: reconcile runs on the actor's own connection, which never had the
     hook (story 20 pinned that), and writes through `db::sync_capture::append`.

2. Schedule (`sync/manager.rs`): a pass is started at actor construction (so it runs at every
   startup, inside the first `log_cycle` AFTER `connect()` → AD-14 for free), one chunk per tick.
   `SyncTuning::reconcile_idle_interval` restarts a pass while
   `reconcile::unmigrated_write_sites_remain()` is true; it is false today (the budget is
   justified-exclusions-only), so only the startup pass runs.

3. Ratchet: `UNMIGRATED_WRITE_SITES` const in `sync/reconcile.rs` + a test pinning it against the
   checked-in budget file minus `JUSTIFICATIONS`; new named CI step
   `cargo test sync::tests_write_site_budget` in `desktop-ci.yml`.

4. SurrogateOrTemplate fix (story 21's OPEN): `apply::has_derived_identity` now also covers
   `SurrogateOrTemplate`. CONFLICT WITH THE PRESCRIBED FIX, recorded: re-deriving the template uuid
   inside apply needs the TEMPLATE row locally, which makes the revive decision depend on local
   state and therefore differ between replicas. The pure-message rule is sound instead because
   `is_whole_row` is only ever an INSERT (an UPDATE never carries the `Immutable` columns) and a
   surrogate re-insert mints a FRESH UUIDv4 — so a whole-row message under a uuid a tombstone
   already claims, stamped after it, can only be a template regeneration.

5. Tests `sync/tests_reconcile.rs`: unwrapped UPDATE / INSERT / DELETE / balance / counter,
   deny-listed config key (nothing), local-only profile (nothing), idempotence, convergence through
   the real segment + apply path, and the regenerated-occurrence convergence.

## Not in this story
No snapshots/compaction (23), no status states (24), no wipe/restore (25), no migration, no version
bump, no branch/PR/worktree.
