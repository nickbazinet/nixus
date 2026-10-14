//! The pluggable engine seam.
//!
//! This trait is the whole contract between the simulator and "how sync works". It has four
//! verbs and no opinion about merge rules, message encoding, storage or transport, which is
//! what lets Stories 15, 16, 19, 20 and 21 replace the implementation without touching a
//! single assertion. See the module docs in `sim/mod.rs` for the swap procedure.

use std::collections::BTreeMap;
use std::path::Path;

use crate::sync::clock::ClockError;
use crate::sync::sim::model::{Change, Observable, RowUuid, Table};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SimError {
    Sql(String),
    Clock(ClockError),
    /// The simulator asked for something the engine cannot represent — always a bug in the
    /// scenario generator or the engine, never an expected outcome.
    Model(String),
}

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sql(detail) => write!(f, "sqlite: {detail}"),
            Self::Clock(error) => write!(f, "clock: {error}"),
            Self::Model(detail) => write!(f, "model: {detail}"),
        }
    }
}

impl From<rusqlite::Error> for SimError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error.to_string())
    }
}

impl From<ClockError> for SimError {
    fn from(error: ClockError) -> Self {
        Self::Clock(error)
    }
}

pub(crate) trait ReplicaEngine {
    /// Whatever this engine puts on the wire. The simulator only ever clones it, hands it
    /// back, hands it back twice, or does not hand it back at all — which is exactly the set
    /// of faults AD-19 asks about and the full extent of what it needs to know.
    type Segment: Clone + std::fmt::Debug;

    /// Apply a local user edit and buffer the message it produces, returning the clock value
    /// it was stamped with so the oracle can compute the expected winner independently.
    fn local_write(&mut self, change: &Change) -> Result<crate::sync::clock::Hlc, SimError>;

    /// Hand over everything buffered since the last flush, or `None` when there is nothing.
    fn flush(&mut self) -> Result<Option<Self::Segment>, SimError>;

    fn deliver(&mut self, segment: &Self::Segment) -> Result<(), SimError>;

    /// The state two replicas must agree on, read back out of the real tables.
    fn observable(&self) -> Result<Observable, SimError>;

    /// Messages the engine is holding because their subject or parent row has not arrived
    /// yet (AD-11 `sync_pending`). A converged system has none left.
    fn pending_count(&self) -> usize;

    /// What this replica currently holds for one cell.
    ///
    /// The generator needs it to avoid issuing an edit that changes NOTHING: the real capture hook
    /// emits a message only for a column whose value actually changed (AD-3), so a no-op edit is an
    /// intent no replica could ever hear about, while the oracle — which only sees intents — would
    /// count it as the winning write. Asking the engine is the only way to know, because "unchanged"
    /// is a fact about this replica's own row and not about the op log.
    fn current(
        &self,
        table: Table,
        row: RowUuid,
        column: &str,
    ) -> Result<Option<crate::db::sim_tables::SimCell>, SimError> {
        Ok(self
            .observable()?
            .get(table.sql())
            .and_then(|rows| rows.get(&row))
            .and_then(|cells| cells.get(column))
            .cloned())
    }

    /// The `(install, seq)` space this replica ships under (AD-4).
    fn install_id(&self) -> &str;

    // ---------------------------------------------------------------------------------------
    // Story 25's lifecycle verbs. Story 13 reserved one `adopt_database` hook; it is four
    // verbs here because restore and clone are NOT the same operation. A RESTORE replaces this
    // replica's file through the real bootstrap path and keeps THIS computer's identity and its
    // own unsent log (AD-9). A CLONE duplicates another replica's file into a NEW computer,
    // which must re-mint its install id or two computers would append to one `(install, seq)`
    // space (AD-4, AD-15).
    //
    // Every verb declines by default: an engine whose merge state lives in memory cannot
    // express a file swap at all, which is the blocker Stories 20/21/23 recorded. The runner
    // performs the op only when the engine says it happened, so no assertion moves for the
    // engine that declines.
    // ---------------------------------------------------------------------------------------

    /// A bootstrap image of this replica's database, built the way production builds one
    /// (AD-9: a stripped snapshot, never a raw file). `None` from an engine that cannot.
    fn bootstrap_image(&mut self) -> Result<Option<Vec<u8>>, SimError> {
        Ok(None)
    }

    /// The highest `seq` this replica has SHIPPED, if any.
    fn shipped_head(&self) -> Result<Option<i64>, SimError> {
        Ok(None)
    }

    /// The highest `seq` applied per remote install — what a bootstrap image taken here would
    /// claim as its watermark (AD-9).
    fn applied_heads(&self) -> Result<BTreeMap<String, i64>, SimError> {
        Ok(BTreeMap::new())
    }

    /// Replaces this replica's database with `image` through the guarded swap, keeping this
    /// computer's identity and re-applying its carried unsent log (AD-9). `false` = declined.
    fn restore_from_image(&mut self, _image: &[u8]) -> Result<bool, SimError> {
        Ok(false)
    }

    /// A duplicate of this replica's database as a brand-new replica at `db_path`, re-minted
    /// onto `install_id` (AD-4). `None` = declined.
    fn clone_to(&mut self, _db_path: &Path, _install_id: &str) -> Result<Option<Self>, SimError>
    where
        Self: Sized,
    {
        Ok(None)
    }
}
