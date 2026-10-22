//! AD-13: retention without a computer registry.
//!
//! Three rules shape every line below, and each exists to stop one specific way of deleting
//! something another computer still needs.
//!
//! 1. **The watermark is RE-READ at deletion time.** Not the watermark of the snapshot this
//!    computer just published, and never a cached one: between the publish and the sweep another
//!    computer may have moved `snap/LATEST` to a snapshot that claims LESS, and a segment this
//!    computer considers redundant is then the only copy of a change that snapshot does not hold.
//! 2. **Age and coverage are both required.** A segment is deletable only when it is older than 90
//!    days AND at or below the re-read watermark. Age alone would drop a segment a lagging computer
//!    still owes; coverage alone would drop one that is still the fastest way for everyone else to
//!    catch up.
//! 3. **Only `log/` and `snap/` are ever addressed.** `owner`, `head/*`, `roster` and `blob/*` are
//!    never deleted — the first three are the protocol's own pointers and orphaned blob cleanup is
//!    deferred (AD-13) — and the IAM grant is scoped to the same two prefixes, so a bug here is
//!    refused by the role as well as by this module.

use std::collections::{BTreeMap, BTreeSet};

use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncGate,
};
use super::segment::{head_key, roster_key, Roster, HEAD_KEY_PREFIX, LOG_KEY_PREFIX};
use super::snapshot::{
    fetch_latest, LatestSnapshot, SnapshotError, SNAP_KEY_PREFIX, SNAP_LATEST_KEY,
};
use super::store::{ListedObject, ObjectStore, StoreError};

/// AD-13's single retention window, for segments and for roster membership alike.
pub const RETENTION_DAYS: i64 = 90;

const RETENTION_MS: i64 = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/// How many snapshots survive a sweep (AD-13). Two, not one: the newest is what a bootstrap uses,
/// and the one before it is what a computer that already started downloading the previous pointer
/// is still reading.
pub const SNAPSHOTS_KEPT: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RetentionReport {
    pub segments_deleted: usize,
    pub snapshots_deleted: usize,
    pub roster_pruned: usize,
}

/// Runs one sweep. The caller must have just published a snapshot (AD-13).
///
/// Every request goes through the gated store, so a Frozen, un-entitled or local-only dataset
/// deletes nothing by construction rather than by a check this function remembers to make (AD-14).
pub async fn compact<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    our_install: &str,
    now_ms: i64,
    epoch: u64,
) -> Result<RetentionReport, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let Some((latest, _)) = fetch_latest(store).await? else {
        return Ok(RetentionReport::default());
    };

    let cutoff = now_ms - RETENTION_MS;

    Ok(RetentionReport {
        segments_deleted: sweep_segments(store, &latest.watermark, cutoff).await?,
        snapshots_deleted: sweep_snapshots(store, &latest).await?,
        roster_pruned: prune_roster(store, our_install, cutoff, epoch).await?,
    })
}

/// `log/<install>/<seq:016>` split back into the pair that names it.
///
/// Parsed rather than trusted: the key came from a listing of this account's own prefix, but the
/// `seq` is compared against a watermark and a malformed one must read as "not deletable" instead
/// of as zero.
fn segment_position(key: &str) -> Option<(String, i64)> {
    let rest = key.strip_prefix(LOG_KEY_PREFIX)?;
    let (install, seq) = rest.split_once('/')?;
    let seq = seq.parse::<i64>().ok()?;
    if seq < 0 {
        return None;
    }

    Some((install.to_string(), seq))
}

async fn sweep_segments<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    watermark: &BTreeMap<String, i64>,
    cutoff: i64,
) -> Result<usize, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    if watermark.is_empty() {
        return Ok(0);
    }

    let mut deleted = 0;
    for object in store.list(LOG_KEY_PREFIX).await? {
        if object.last_modified_ms > cutoff {
            continue;
        }
        let Some((install, seq)) = segment_position(&object.key) else {
            continue;
        };
        if watermark.get(&install).is_none_or(|claimed| seq > *claimed) {
            continue;
        }

        store.delete(&object.key).await?;
        deleted += 1;
    }

    Ok(deleted)
}

/// Keeps the two newest snapshots and the one `snap/LATEST` names, and deletes the rest.
///
/// The pointer's own target is kept EXPLICITLY and not merely because it is newest: `snap/LATEST`
/// is written by compare-and-swap after the object, so a computer whose clock or whose upload order
/// differs can leave the current snapshot older than one that was abandoned.
async fn sweep_snapshots<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    latest: &LatestSnapshot,
) -> Result<usize, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let current = latest.snapshot_key()?;
    let mut snapshots: Vec<ListedObject> = store
        .list(SNAP_KEY_PREFIX)
        .await?
        .into_iter()
        .filter(|object| object.key != SNAP_LATEST_KEY)
        .collect();
    snapshots.sort_by(|left, right| {
        right
            .last_modified_ms
            .cmp(&left.last_modified_ms)
            .then_with(|| left.key.cmp(&right.key))
    });

    let keep: BTreeSet<String> = snapshots
        .iter()
        .take(SNAPSHOTS_KEPT)
        .map(|object| object.key.clone())
        .chain(std::iter::once(current))
        .collect();

    let mut deleted = 0;
    for object in snapshots {
        if keep.contains(&object.key) {
            continue;
        }

        store.delete(&object.key).await?;
        deleted += 1;
    }

    Ok(deleted)
}

/// Drops roster members whose `head/<install>` has not moved for 90 days (AD-13).
///
/// Scoped to `epoch`'s own roster (story wipe-epoch): a sweep run by a post-wipe computer must
/// never touch the pre-wipe list, whose members are exactly the ones a wipe made unreachable and
/// whose heads are by definition no longer moving.
///
/// The head OBJECT is left in place on purpose: deleting it would make an install that comes back
/// read as "never synced" and re-mint its identity, and the roster entry is the only thing a poll
/// actually costs.
async fn prune_roster<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    our_install: &str,
    cutoff: i64,
    epoch: u64,
) -> Result<usize, SnapshotError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let key = roster_key(epoch);
    let stored = match store.get(&key).await {
        Ok(stored) => stored,
        Err(GatedError::Store(StoreError::NotFound)) => return Ok(0),
        Err(error) => return Err(SnapshotError::Store(error)),
    };
    let roster = Roster::parse(&stored.bytes).map_err(|_| SnapshotError::MalformedLatest)?;

    let fresh: BTreeMap<String, i64> = store
        .list(HEAD_KEY_PREFIX)
        .await?
        .into_iter()
        .map(|object| (object.key, object.last_modified_ms))
        .collect();

    let keep: Vec<String> = roster
        .installs
        .iter()
        .filter(|install| {
            // THIS computer is never pruned, whatever its head's age says. It is sweeping right
            // now, so it is by definition seen; and its head may be older than the window simply
            // because it has had nothing to ship. Dropping itself is how a one-computer account
            // would make itself undiscoverable with its own maintenance.
            if install.as_str() == our_install {
                return true;
            }

            // An install with no head object at all is KEPT: it has published a roster entry and
            // its first head may simply not be visible yet, and dropping it would un-discover a
            // computer that is mid-first-sync.
            fresh
                .get(&head_key(install))
                .is_none_or(|seen| *seen > cutoff)
        })
        .cloned()
        .collect();

    let pruned = roster.installs.len() - keep.len();
    if pruned == 0 || keep.is_empty() {
        return Ok(0);
    }

    let body = Roster::of(keep).body();
    match store
        .put_if_match(&key, &stored.meta.etag, body)
        .await
    {
        Ok(_) => Ok(pruned),
        // Someone else moved the roster while this sweep was deciding. Pruning is pure maintenance,
        // so the loser does nothing and the next sweep re-reads: retrying here would race a
        // `join_roster` and could drop the computer that just added itself.
        Err(GatedError::Store(
            StoreError::PreconditionFailed | StoreError::ConditionalConflict | StoreError::NotFound,
        )) => Ok(0),
        Err(error) => Err(SnapshotError::Store(error)),
    }
}
