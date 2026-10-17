# Story 13 — Convergence simulator and hybrid clock (plan, self-approved)

Unattended: spec self-approved, all goals kept, no HALT taken, no review sub-agents (one self-review pass).

## Cited ADs

- AD-4 clock: one HLC per install, uhlc with a 5-minute max delta, install id = 8 random bytes, ties break by install id, remote > 5 min ahead rejected (`clock_skew`).
- AD-5 merge: per-field LWW by HLC, delete-wins tombstone, `balance_set` + cause-keyed deltas, counter = sum of deltas deduped by message id.
- AD-11 apply: contiguous per-install order, missing parent/subject -> pending, no message wedges a later one.
- AD-12 FK: parent tombstone cascades children as their own tombstones; a child message for a tombstoned parent is dropped.
- AD-19 gate: the N-replica randomized convergence simulator including duplicated, dropped and reordered segments, concurrent delete/edit and double-delete.
- Stack: `uhlc 0.9.0`, `proptest 1` (dev). Both added; `uuid 1.28` deliberately NOT added (Story 14 owns UUIDv5).

## Production code (the only non-test half)

`sync/clock.rs` gains, beside the existing Story-6 `new_install_id`/`machine_fingerprint` (reused, not duplicated):

- `Hlc { time: u64 /* NTP64 */, install: [u8; 8] }`, `Ord` written out as (physical+logical, install) so the tiebreak is a decision, not a derive. uhlc's own `ID` ordering is little-endian and is deliberately not relied on.
- `Hlc::encode()` -> 33 chars `{time:016x}-{install:016x}`, fixed width so ASCII sort == HLC order; `decode` + a frozen format test.
- `Clock::new(install_id)` / `Clock::with_wall_clock(install_id, Arc<dyn Fn() -> u64>)`, `now()`, `observe(&Hlc)`.
- `MAX_FORWARD_DRIFT`: 5 minutes. `observe` rejects with `ClockError::Skew { ahead_ms }` and NEVER adopts.
- uhlc's `HLCBuilder::with_clock` takes a bare `fn() -> NTP64`, so a per-instance closure cannot be passed: the wall clock is installed in a thread-local for the duration of each call through a `Drop` guard. Production installs the system clock the same way, so there is one code path.
- No production caller until Story 15 -> narrow commented `#[allow(dead_code)]` naming it.

## Simulator (all `#[cfg(test)]`)

`db/sim_tables.rs` (`#[cfg(test)]`) holds every SQL statement (project-context rule 1). Real schema via `db::test_dataset::migrated_dataset` (= `open_configured` -> `run_migrations`).

Tables: `accounts` (LWW + Balance), `income_sources`/`income_entries` (parent/child, real `ON DELETE CASCADE`), `merchant_category_hints` (natural key `UNIQUE(merchant, budget_category_id)` + `usage_count` Counter) over a fixed, never-edited `budget_groups`/`budget_categories` base. Picked because their FK edges are CASCADE only: the RESTRICT and SET NULL edges are Story 14's registry and Story 21's tombstones.

`sync/sim/`: `model.rs` (tables, `Change`, `Message`, `Segment`, `Observable`), `engine.rs` (`ReplicaEngine` seam), `reference.rs` (one `fold()` apply path implementing AD-5), `oracle.rs` (expected state from the op log alone), `runner.rs` (seeded PRNG, in-memory transport, fault model, assertions, trace archive + replay), `tests.rs` (proptest + deterministic faults + non-vacuity).

- Seam: `ReplicaEngine { type Segment; local_write -> Hlc; flush -> Option<Segment>; deliver(&Segment); observe() -> Observable; }`. Stories 15/16/19/20/21 swap the impl; the assertions do not move.
- Faults: offline-and-keep-editing, reordering, duplicate delivery, dropped delivery (the durable transport redelivers at the final sync, AD-6), concurrent edit vs delete, double delete, double absolute balance set, cross-replica cause-keyed delta collisions, natural-key rows created independently on several replicas.
- Restore/clone of a replica: explicit `// STORY 25` seam + ledger note (the merge metadata lives in memory until Story 14's `sync_*` tables exist, so a file swap would not carry it).
- Assertions after full sync: identical `Observable` on every replica; balances == set + later deltas; every LWW field == the max-HLC write; idempotent re-apply; delete-wins; double delete == single delete.
- Env: `NIXUS_SIM_SEEDS` (default 64), `NIXUS_SIM_SEED` (one seed), `NIXUS_SIM_TRACE_DIR`. Traces: `<temp>/nixus-sim-traces/sim-<seed>.json`, path + seed printed on failure, `replay_trace_file` + a test that replays one.
- Non-vacuity: three deliberate engine mutations (`NoDedup`, `IgnoreTombstones`, `ArrivalOrderWins`) must make the simulator FAIL; asserted in-test.

## Prohibitions honoured

No `sync_*` table, no migration (Story 14), no capture hook, no segment format, no apply path, no version bump, no branch/PR/worktree, master only.
