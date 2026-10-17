# Story 20 — Apply path (builder spec, self-approved per rules section 5)

Intent: apply remote messages on a second connection in BEGIN IMMEDIATE transactions of at most 500
messages, per-field LWW by hlc, dedup, pending + quarantine, the FK policy, and the applied vector
advanced in the same transaction. AD-1, AD-11, AD-12 (+ AD-2/4/5 for the merge rules).

Plan taken:
1. `db/sync_apply.rs` — all SQL (vector, pending, quarantine, tombstone, row writes by `_rowid_`).
2. `sync/apply.rs` — the decision logic + `DatasetApplier` (second connection, no hook).
3. `sync/host.rs` — swap `CountingApplier` for the real applier; `sync:applied` event.
4. `sync/balance.rs` — BalanceLedger moved out of `#[cfg(test)]`, one rule for three callers.
5. `sync/sim/real.rs` — the real pipeline as a `ReplicaEngine`; Observable widened to the schema.
6. `sync/tests_apply.rs` — 20 tests for what a randomized scenario cannot aim at.

Checked against: AD-1 (one apply path, no `commands/`), AD-2 (uuid translation both ways), AD-4
(observe, tiebreak inside the encoding), AD-5 (per-column LWW, counter sum, balance fold, no audit),
AD-11 (500/txn, defer re-issued, savepoint replay, parking bound, vector in the same txn), AD-12
(cascade, SET NULL, RESTRICT, delete-wins), AD-19 (the simulator is the gate).

Decisions + open items: see the `- [story 20]` lines in `sync-m2-progress.md`.
