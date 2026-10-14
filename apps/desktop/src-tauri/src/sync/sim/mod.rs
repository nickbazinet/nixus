//! The N-replica randomized convergence simulator (AD-19) — the executable spec every later
//! sync story has to keep green.
//!
//! # What it is
//!
//! `run_scenario` builds 2–5 replicas, each with its own install id, its own hybrid logical
//! clock and its own **real** SQLite file carrying the **real** migrated schema, drives a
//! randomized stream of edits and network faults over a trivial in-memory transport, then
//! synchronizes everything and asserts six properties: identical tables, balances equal to
//! the sum of the changes, no lost edits, idempotent re-apply, delete-wins over a concurrent
//! edit, and double-delete equal to a single delete.
//!
//! # The engine seam — read this before Story 15, 16, 19, 20 or 21
//!
//! The simulator never names a merge rule. Everything it knows about how sync works sits
//! behind [`engine::ReplicaEngine`], which has exactly four verbs: write locally, flush a
//! segment, deliver a segment, and report observable state. [`reference::ReferenceEngine`]
//! is the first implementation: it folds AD-5's semantics in memory and materializes the
//! result into the real tables, which is what makes the assertions green *today*, before
//! `sync_log`, the capture hook, the segment format and the apply path exist.
//!
//! When those arrive, the move is:
//!
//! 1. add a second `ReplicaEngine` implementation whose `local_write` goes through
//!    `ActiveDataset::write` + the capture hook (Story 15/16), whose `flush` produces a real
//!    `sync/segment` object (Story 19), and whose `deliver` calls `sync::apply` (Story 20/21);
//! 2. parameterize the existing scenario tests over both engines;
//! 3. delete nothing. **The assertions must not move.** If a property has to be weakened to
//!    make the real pipeline pass, the pipeline is wrong, or the property was wrong and the
//!    change belongs in `oracle.rs` with a recorded reason.
//!
//! `Observable` is deliberately expressed in row uuids, not integer ids, because integer ids
//! are local (AD-2): an engine built on `sync_uuid` translates with the side table, the
//! reference engine translates with its in-memory map, and the comparison is unchanged.
//!
//! # Running it
//!
//! ```text
//! cargo test sync::sim                                  # 64 seeds, part of cargo test
//! NIXUS_SIM_SEEDS=1000 cargo test --release sync::sim    # the AD-19 release gate
//! NIXUS_SIM_SEED=12345 cargo test sync::sim              # replay exactly one seed
//! ```
//!
//! A failing scenario archives its seed and resolved op trace as JSON under
//! `<temp>/nixus-sim-traces/` (override with `NIXUS_SIM_TRACE_DIR`) and prints both the path
//! and the one-seed command that reproduces it.

pub(crate) mod engine;
pub(crate) mod model;
pub(crate) mod oracle;
pub(crate) mod reference;
pub(crate) mod runner;
mod tests;
