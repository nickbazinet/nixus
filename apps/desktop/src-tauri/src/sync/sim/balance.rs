//! AD-5's balance arithmetic, in one place.
//!
//! WHY it is its own module rather than methods on the reference engine: Story 16's real emitters
//! are asserted against the SAME rule the simulator's reference engine folds, and "identical
//! results on every computer" is only evidence if there is exactly one rule to be identical to.
//! Story 20's apply path replaces the CALLERS of this, not the arithmetic.

use std::collections::BTreeMap;

use crate::sync::clock::Hlc;

/// One account's balance state: the latest absolute set, plus every delta keyed by its cause.
pub(crate) struct BalanceLedger<Cause: Ord> {
    set: Option<(Hlc, i64)>,
    deltas: BTreeMap<Cause, (Hlc, i64)>,
}

impl<Cause: Ord> Default for BalanceLedger<Cause> {
    fn default() -> Self {
        Self {
            set: None,
            deltas: BTreeMap::new(),
        }
    }
}

impl<Cause: Ord> BalanceLedger<Cause> {
    /// Last-write-wins by `hlc`, so the same absolute value applied twice is a no-op and two
    /// computers setting different values agree on the winner whatever the arrival order.
    ///
    /// `force` is the simulator's `ArrivalOrderWins` mutation: it exists so the non-vacuity tests
    /// can prove the gate notices an engine that lost the comparison.
    pub(crate) fn observe_set(&mut self, hlc: Hlc, cents: i64, force: bool) {
        let newer = match &self.set {
            None => true,
            Some((stored, _)) => force || hlc > *stored,
        };
        if newer {
            self.set = Some((hlc, cents));
        }
    }

    /// AD-5: one real-world cause, one delta.
    ///
    /// Two computers that emitted it carry different clocks, so the EARLIEST is kept — picking by
    /// a rule rather than by arrival is what makes every replica agree on whether a later
    /// `balance_set` absorbed this delta or not.
    pub(crate) fn observe_delta(&mut self, hlc: Hlc, cause: Cause, cents: i64) {
        match self.deltas.get(&cause) {
            Some((stored, _)) if *stored <= hlc => {}
            _ => {
                self.deltas.insert(cause, (hlc, cents));
            }
        }
    }

    /// The latest `balance_set` by clock, plus every delta stamped after it.
    pub(crate) fn value(&self) -> i64 {
        let base = self.set.map(|(_, cents)| cents).unwrap_or(0);
        let later: i64 = self
            .deltas
            .values()
            .filter(|(hlc, _)| self.set.is_none_or(|(set_hlc, _)| *hlc > set_hlc))
            .map(|(_, cents)| *cents)
            .sum();

        base + later
    }
}
