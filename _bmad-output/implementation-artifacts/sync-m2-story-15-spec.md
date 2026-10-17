# Story 15 plan — ActiveDataset::write + capture hook (AD-3, AD-5, AD-2, AD-4, AD-19)

Self-approved per rules section 5 (unattended). All goals kept. No HALT. One self-review pass.

## Shape

- `sync/capture.rs` (production): `Capture { install_hex, clock: Clock, shapes, buffer }` behind an
  `Arc` so the `preupdate_hook` closure (`FnMut + Send + 'static`) can own a handle.
  - `Capture::for_dataset(kind, conn) -> Option<Self>`: `None` for `DatasetKind::Local` (AD-12
    inherited) so a local profile runs NO sync code; for CloudLinked it ensures the install id
    through the SAME path the manager uses (`sync::state::ensure_install_on`, extracted) so a
    copied database cannot capture under the old install id.
  - `attach(conn)` / `detach(conn)` + `Detached` drop guard = the explicit "run with capture off"
    seam story 20 (apply connection) and story 25 (wipe/restore) need.
  - `shapes`: per travelling table (registry ∩ live schema) column names + merge kinds + FK parent
    + `has_rowid` probe. The hook gets only column INDEXES, so the names must be pre-resolved; it
    also means the hook never touches the connection (no reentrancy).
- `db/mod.rs`: `ActiveDataset { id, conn, capture }`, `write(|tx: &WriteTx| ...)` (Deref to
  `Connection` so every `db::*` function keeps its `&Connection` signature), `WriteTx::savepoint`,
  `write_uncaptured`. Flush happens inside the same transaction; rollback discards the buffer.
- `db/sync_capture.rs`: the SQL for `sync_log` + `sync_field_state` (project-context rule 1).

## Messages written (AD-5 / story 14 schema)

- INSERT -> one `field` per captured column (Lww + Immutable + FK-as-parent-uuid); Counter/Balance/
  Excluded/PK skipped. UPDATE -> `field` per CHANGED captured column, `counter_delta` for Counter,
  Immutable change skipped + warned. DELETE -> one `tombstone` carrying the row as JSON, then the
  `sync_uuid` mapping is forgotten (AD-2).
- `INSERT OR REPLACE` that re-uses the rowid is COLLAPSED into one logical update, so the identity
  survives; a REPLACE that lands on a new rowid is a real tombstone + a real new identity.
- `sync_field_state(hlc, install, content_hash)` per emitted `field`; `content_hash` =
  sha256 of the encoded value, so story 22 reconcile can recompute it from the live row.
- Payload: provisional 1-byte-tag encoding (null/int/real/text/blob) with a golden test; story 19
  freezes the WIRE format when it cuts segments. Nothing has shipped yet.

## Gates

- `sync/tests_capture.rs`: INSERT OR REPLACE, DELETE without WHERE (truncate optimization), FK
  cascade depth >= 1, WITHOUT ROWID, rollback discards, savepoint rollback discards only the inner
  changes, failing flush rolls the user's transaction back, local dataset installs nothing.
- `sync/tests_capture_latency.rs`: medians, capture ON vs OFF, ratio + absolute ceilings, prints.
- `sync/tests_write_site_budget.rs` + `sync-write-site-budget.json`: scans `src/` for write SQL
  attributed to its enclosing fn; a fn carrying the `CAPTURE-SANCTIONED` marker is excluded; the
  test fails if any count grows or a new site appears. `NIXUS_WRITE_SITE_BUDGET=update` rewrites it.
- ONE write site migrated end to end: the three `budget_groups` commands.

## Deliberately NOT here

- Balance/counter emitters (16), mass migration (17/18), segments (19), apply (20), tombstone table
  (21), reconcile (22). Simulator capture engine: NOT cheap (it needs an apply path, story 20) —
  seam recorded in the ledger instead. `PRAGMA data_version` stays: with one migrated write site the
  capture signal would miss every other write, which would be a silent regression of M1 story 10.
