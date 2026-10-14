//! The pluggable engine seam.
//!
//! This trait is the whole contract between the simulator and "how sync works". It has four
//! verbs and no opinion about merge rules, message encoding, storage or transport, which is
//! what lets Stories 15, 16, 19, 20 and 21 replace the implementation without touching a
//! single assertion. See the module docs in `sim/mod.rs` for the swap procedure.

use crate::sync::clock::ClockError;
use crate::sync::sim::model::{Change, Observable};

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
}
