//! The wipe epoch: "delete everything" as an EVENT the whole account learns about
//! (story wipe-epoch, revising AD-15).
//!
//! AD-15 made a wipe a purely local act: the rows go, `sync_state` goes, and the cloud copy plus
//! every other computer are untouched. That is what made the wipe ineffective — the next join
//! restored `snap/LATEST` and replayed the other installs' log, so the data the user had just
//! erased came straight back. This module is the missing half: one small mutable object that says
//! HOW MANY TIMES this account has been wiped, and a monotonically increasing number every other
//! rule in `sync/` is then expressed against.
//!
//! Four rules shape every line below.
//!
//! 1. **The epoch only ever goes up, and nobody's wipe is lost.** `register` is the same
//!    compare-and-swap `segment::join_roster` uses, with one extra rule: a cloud epoch that is
//!    ALREADY ahead of this computer is ADOPTED rather than incremented. Two computers wiping at
//!    the same time therefore converge on one epoch instead of racing to N+2, and the second one
//!    loses nothing — it is empty either way.
//! 2. **No cloud object is ever deleted here, and most of them are never deleted at all.** The
//!    pre-wipe snapshot, segments, heads and picture blobs stay exactly where they are. Stated
//!    without euphemism, because the user-facing copy depends on it: the bucket's lifecycle rules
//!    expire NONCURRENT versions only (`infra/sync/template.yaml`), so a current object has no
//!    expiry at all; AD-13's sweep reclaims superseded SNAPSHOTS (`sweep_snapshots` keeps the two
//!    newest plus the pointer's target), so the pre-wipe snapshot does eventually go once three
//!    more have been published; pre-wipe SEGMENTS are never reclaimed, because `sweep_segments`
//!    deletes only what the current snapshot's watermark claims and a post-wipe watermark names
//!    only post-wipe installs; and `blob/*` cleanup is deferred by AD-13. Deleting the stored
//!    bytes outright is a manual request, exactly as it was before this story.
//!
//!    What the epoch changes is REACHABILITY, not storage: readers apply it as a CUTOFF (see
//!    `snapshot::fetch_latest_at`) and the roster is epoch-scoped (`segment::roster_key`), so a
//!    pre-wipe install is structurally undiscoverable instead of being listed on a blacklist
//!    somebody has to remember to consult. The app also still holds no permission to delete the
//!    user's data objects (AD-13's IAM grant covers `log/*` and `snap/*` only), which is
//!    deliberate: "delete everything" must not become a way for one computer to erase the bytes
//!    another one is mid-download of.
//! 3. **Absent is epoch 0, malformed is a fault.** An account that has never been wiped has no
//!    `wipe` object at all, and that reads as 0. A body this build cannot parse is NEVER read as
//!    absent: treating a damaged document as "never wiped" is exactly how pre-wipe data would come
//!    back, so it is a typed error and the cycle backs off instead.
//! 4. **One reader, and it is cheap in BOTH states.** `WipeWatch` is the only way the actor learns
//!    the cloud epoch. Once an account has been wiped the read is conditional and answers `304`
//!    with no body. While it has NEVER been wiped there is no object and therefore no ETag to be
//!    conditional against, and on real S3 that is the expensive shape, not the cheap one: the
//!    prefix-conditioned `s3:ListBucket` grant means a GET on a missing key answers 403, which
//!    `s3.rs` has to disambiguate with a `ListObjectsV2` probe — two billed requests, every cycle.
//!    So a KNOWN-ABSENT marker is re-read only once per `absence_recheck`, which the actor passes
//!    as `remote_poll_interval`: AD-6's steady state is unchanged and a first wipe is still noticed
//!    within one poll interval.
//!
//! ACCEPTED RISKS, recorded here rather than worked around:
//! - Pre-wipe segments are never reclaimed, by this story or by anything else. Reclamation needs
//!   the install to appear in the current snapshot's watermark, and a post-wipe snapshot claims
//!   nothing about installs that only ever existed before the wipe; the bucket expires noncurrent
//!   versions only, so nothing else collects them either. They sit there until a manual deletion
//!   request. The user-facing copy says exactly this and does not promise an expiry.
//! - A build that predates this module does not know the `wipe` object and would keep syncing at
//!   epoch 0 — it forks from the post-wipe computers rather than resurrecting their data, because
//!   it writes `roster` while they write `roster/e<N>` and its `snap/LATEST` publishes lose the
//!   cutoff check only for other old builds.
//! - There is a one-cycle window in which a computer that has not yet read the new epoch still
//!   ships a segment. Harmless: nobody at epoch N polls the epoch-0 roster, so the object is
//!   written and never read.

use std::time::Duration;

use tokio::time::Instant;

use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncGate,
};
use super::store::{ConditionalGet, ETag, ObjectStore, StoreError};

/// The account-relative key of the wipe marker. One mutable object, written by every computer that
/// performs a wipe, read by all of them (AD-6's compare-and-swap, like `snap/LATEST` and `roster`).
pub const WIPE_OBJECT_KEY: &str = "wipe";

/// The version of the `wipe` document. Separate from the object format version for the same reason
/// as `snap/LATEST`'s: this is a plain JSON pointer, not a framed AD-8 object.
pub const WIPE_VERSION: u32 = 1;

/// How many times a wipe compare-and-swap re-reads and retries before giving up for this attempt.
/// Bounded for `join_roster`'s reason: every computer on the account may write this key, and an
/// unbounded loop would be a billed spin.
const WIPE_CAS_ATTEMPTS: usize = 5;

/// The epoch an account that has never been wiped reads as.
pub const EPOCH_NEVER_WIPED: u64 = 0;

/// Why the wipe marker could not be read or moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WipeError {
    /// The object exists but is not a document this build can read. Deliberately NOT treated as
    /// absence: "I cannot read the wipe marker" must never become "nothing was ever wiped".
    Malformed,
    /// Every compare-and-swap attempt lost the race. The next cycle re-reads and retries.
    Contended,
    Store(GatedError),
}

impl std::fmt::Display for WipeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WipeError::Malformed => f.write_str("the account's wipe marker could not be read"),
            WipeError::Contended => {
                f.write_str("the account's wipe marker is being written by another computer")
            }
            WipeError::Store(error) => write!(f, "wipe marker transfer: {error:?}"),
        }
    }
}

impl std::error::Error for WipeError {}

impl From<GatedError> for WipeError {
    fn from(error: GatedError) -> Self {
        WipeError::Store(error)
    }
}

/// What `wipe` holds: which wipe this is, and when it happened.
///
/// Serialized by hand as compact JSON with SORTED keys, for the same reason as the owner object
/// and `snap/LATEST`: the document is a wire contract between app versions, so the exact spelling
/// is part of it and a `#[derive(Serialize)]` would let a field rename silently change the bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WipeEvent {
    /// How many wipes this account has had. Strictly increasing, never reused.
    pub epoch: u64,
    /// The wiping computer's wall clock, for diagnostics only. Never compared against anything:
    /// AD-4 assumes clocks disagree, and the epoch — not the time — is what orders a wipe.
    pub wiped_ms: i64,
}

impl WipeEvent {
    pub fn body(&self) -> Vec<u8> {
        format!(
            "{{\"epoch\":{},\"v\":{},\"wiped_ms\":{}}}",
            self.epoch, WIPE_VERSION, self.wiped_ms
        )
        .into_bytes()
    }

    /// Unknown fields are ignored and the known ones are required, so a later version may add to
    /// the document without this build losing the ability to see that a wipe happened.
    pub fn parse(bytes: &[u8]) -> Result<Self, WipeError> {
        let document: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| WipeError::Malformed)?;

        if document.get("v").and_then(serde_json::Value::as_u64) != Some(u64::from(WIPE_VERSION)) {
            return Err(WipeError::Malformed);
        }

        let epoch = document
            .get("epoch")
            .and_then(serde_json::Value::as_u64)
            .ok_or(WipeError::Malformed)?;
        // A zero epoch is not a wipe; writing one would make "wiped" and "never wiped" two
        // spellings of the same state, and the absent object is already the second one.
        if epoch == EPOCH_NEVER_WIPED {
            return Err(WipeError::Malformed);
        }

        let wiped_ms = document
            .get("wiped_ms")
            .and_then(serde_json::Value::as_i64)
            .ok_or(WipeError::Malformed)?;

        Ok(Self { epoch, wiped_ms })
    }
}

/// The ONE reader of the cloud epoch, with the ETag it last saw.
///
/// Conditional on purpose: a `304` carries no body and is the steady-state answer, so putting the
/// epoch check at the top of every cycle costs one billed GET and no bytes. A `404` is kept as
/// epoch 0 with no ETag, which is the ordinary state of an account nobody has ever wiped.
#[derive(Debug, Default)]
pub struct WipeWatch {
    etag: Option<ETag>,
    epoch: u64,
    /// When this watch last PROVED the marker absent, so an account that has never been wiped is
    /// not re-probed on every cycle. `None` means "ask now": never looked, or the marker exists.
    absent_since: Option<Instant>,
}

impl WipeWatch {
    /// Forgets the concurrency token, so the next `read` is a full GET.
    ///
    /// Called after THIS computer has moved the marker: the ETag it holds is the one before its own
    /// write, and a conditional read against it would report a change that is its own. The EPOCH is
    /// kept — it is a fact about this dataset, not about the object — which is the same rule `read`
    /// applies when the object turns out to be gone.
    pub fn forget(&mut self) {
        self.etag = None;
        self.absent_since = None;
    }

    /// One read of `wipe`, answering the epoch.
    ///
    /// `absence_recheck` bounds how often a marker already proven ABSENT is asked for again; it has
    /// no effect once the marker exists, because that read is conditional and free of a body.
    pub async fn read<S, L, C, T>(
        &mut self,
        store: &GatedStore<S, SyncGate<L, C, T>>,
        absence_recheck: Duration,
    ) -> Result<u64, WipeError>
    where
        S: ObjectStore,
        L: DatasetLink,
        C: CapabilitySource,
        T: GateStateSource,
    {
        if let Some(proven_absent_at) = self.absent_since {
            if proven_absent_at.elapsed() < absence_recheck {
                return Ok(self.epoch);
            }
        }

        let fetched = match &self.etag {
            Some(etag) => match store.get_if_none_match(WIPE_OBJECT_KEY, etag).await {
                Ok(ConditionalGet::NotModified) => return Ok(self.epoch),
                Ok(ConditionalGet::Modified(stored)) => Some(stored),
                // The marker this computer knew is gone. Forget the ETag so the next read is a
                // full GET; the epoch is deliberately KEPT, because a local epoch that has
                // already been adopted is a fact about this dataset and not about the object.
                Err(GatedError::Store(StoreError::NotFound)) => {
                    self.etag = None;
                    self.absent_since = Some(Instant::now());
                    None
                }
                Err(error) => return Err(WipeError::Store(error)),
            },
            None => match store.get(WIPE_OBJECT_KEY).await {
                Ok(stored) => Some(stored),
                Err(GatedError::Store(StoreError::NotFound)) => {
                    self.absent_since = Some(Instant::now());
                    None
                }
                Err(error) => return Err(WipeError::Store(error)),
            },
        };

        if let Some(stored) = fetched {
            self.epoch = WipeEvent::parse(&stored.bytes)?.epoch;
            self.etag = Some(stored.meta.etag);
            self.absent_since = None;
        }

        Ok(self.epoch)
    }
}

/// Reads `wipe` unconditionally, with no cached ETag in the way.
///
/// The publish gate's reader (`manager::upload`): a cached `304` proves only that the object has
/// not changed since this computer last looked, and the one thing that path must not do is write a
/// pre-wipe snapshot over a post-wipe pointer on the strength of a stale belief.
pub async fn read_now<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
) -> Result<u64, WipeError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    match store.get(WIPE_OBJECT_KEY).await {
        Ok(stored) => Ok(WipeEvent::parse(&stored.bytes)?.epoch),
        Err(GatedError::Store(StoreError::NotFound)) => Ok(EPOCH_NEVER_WIPED),
        Err(error) => Err(WipeError::Store(error)),
    }
}

/// Records that this computer has wiped everything, and answers the epoch it must now run at.
///
/// `local_epoch` is the epoch this dataset was at BEFORE the wipe. The rule, applied on the first
/// read and again after every lost compare-and-swap:
///
/// - the cloud is AHEAD of this computer -> ADOPT its epoch and write nothing. Another computer
///   has already registered a wipe this one had not heard about, and this computer is empty either
///   way, so incrementing would only make every OTHER computer wipe itself a second time (and lose
///   whatever was entered after the first wipe, which the user asked to keep).
/// - otherwise -> write `cloud + 1` by compare-and-swap.
///
/// A lost race is re-read and re-decided rather than retried blind, which is what makes two
/// simultaneous wipes converge on ONE epoch (AD-6).
pub async fn register<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    local_epoch: u64,
    now_ms: i64,
) -> Result<u64, WipeError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    for _ in 0..WIPE_CAS_ATTEMPTS {
        let current = match store.get(WIPE_OBJECT_KEY).await {
            Ok(stored) => Some((WipeEvent::parse(&stored.bytes)?, stored.meta.etag)),
            Err(GatedError::Store(StoreError::NotFound)) => None,
            Err(error) => return Err(WipeError::Store(error)),
        };

        let cloud_epoch = current.as_ref().map_or(EPOCH_NEVER_WIPED, |(event, _)| event.epoch);
        if cloud_epoch > local_epoch {
            return Ok(cloud_epoch);
        }

        let ours = WipeEvent {
            epoch: cloud_epoch.saturating_add(1),
            wiped_ms: now_ms,
        };

        let written = match &current {
            Some((_, etag)) => {
                store
                    .put_if_match(WIPE_OBJECT_KEY, etag, ours.body())
                    .await
            }
            None => store.put_if_absent(WIPE_OBJECT_KEY, ours.body()).await,
        };

        match written {
            Ok(_) => return Ok(ours.epoch),
            // Someone else moved it between the read and the write. Re-read and re-apply the same
            // rule: the winner's epoch may already be the one to adopt.
            Err(GatedError::Store(
                StoreError::PreconditionFailed
                | StoreError::ConditionalConflict
                | StoreError::NotFound,
            )) => continue,
            Err(error) => return Err(WipeError::Store(error)),
        }
    }

    Err(WipeError::Contended)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::test_support::{syncing_fake, FakeObjectStore};
    use std::sync::Arc;

    fn event(epoch: u64) -> WipeEvent {
        WipeEvent {
            epoch,
            wiped_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn the_document_is_sorted_compact_json_and_round_trips() {
        assert_eq!(
            event(3).body(),
            br#"{"epoch":3,"v":1,"wiped_ms":1700000000000}"#.to_vec(),
            "the bytes are a wire contract: keys sorted, no spaces"
        );
        assert_eq!(WipeEvent::parse(&event(3).body()), Ok(event(3)));
    }

    #[test]
    fn a_field_a_later_build_adds_is_ignored_rather_than_refused() {
        let forward = br#"{"epoch":2,"reason":"user","v":1,"wiped_ms":7}"#;

        assert_eq!(
            WipeEvent::parse(forward),
            Ok(WipeEvent {
                epoch: 2,
                wiped_ms: 7
            })
        );
    }

    #[test]
    fn a_malformed_marker_is_refused_and_never_read_as_never_wiped() {
        for body in [
            &b"not json"[..],
            br#"{"v":1,"wiped_ms":7}"#,
            br#"{"epoch":2,"v":1}"#,
            br#"{"epoch":2,"v":2,"wiped_ms":7}"#,
            br#"{"epoch":0,"v":1,"wiped_ms":7}"#,
            br#"{"epoch":-1,"v":1,"wiped_ms":7}"#,
            br#"{"epoch":"2","v":1,"wiped_ms":7}"#,
        ] {
            assert_eq!(
                WipeEvent::parse(body),
                Err(WipeError::Malformed),
                "this body must refuse rather than read as epoch 0: {}",
                String::from_utf8_lossy(body)
            );
        }
    }

    #[tokio::test]
    async fn an_absent_marker_reads_as_epoch_zero_and_a_published_one_reads_as_itself() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));
        let mut watch = WipeWatch::default();

        assert_eq!(watch.read(&store, Duration::ZERO).await, Ok(0));
        assert_eq!(read_now(&store).await, Ok(0));

        fake.seed(WIPE_OBJECT_KEY, event(4).body());
        assert_eq!(watch.read(&store, Duration::ZERO).await, Ok(4));
        // The second read is conditional and answers 304, which is what makes the check at the top
        // of every cycle cost one billed request and no bytes.
        assert_eq!(watch.read(&store, Duration::ZERO).await, Ok(4));
    }

    /// The request-budget half. On real S3 a GET of a missing key answers 403 and `s3.rs` has to
    /// disambiguate it with a `ListObjectsV2` probe, so re-reading an absent marker on every cycle
    /// would be TWO billed requests per cycle on every account that has never been wiped — against
    /// a documented steady state of `1 + <known computers>` per poll interval.
    #[tokio::test(start_paused = true)]
    async fn an_absent_marker_is_re_probed_once_per_recheck_interval_and_no_more() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));
        let recheck = Duration::from_secs(30);
        let mut watch = WipeWatch::default();

        assert_eq!(watch.read(&store, recheck).await, Ok(0));
        let after_first = fake.calls();

        for _ in 0..5 {
            tokio::time::advance(Duration::from_secs(5)).await;
            assert_eq!(watch.read(&store, recheck).await, Ok(0));
        }
        assert_eq!(
            fake.calls(),
            after_first,
            "a marker already proven absent must cost nothing until the interval elapses"
        );

        // And a first wipe is still noticed within one interval of it happening.
        fake.seed(WIPE_OBJECT_KEY, event(1).body());
        tokio::time::advance(recheck).await;
        assert_eq!(watch.read(&store, recheck).await, Ok(1));

        // Once it exists the recheck is irrelevant: the read is conditional and answers 304.
        let after_found = fake.calls();
        assert_eq!(watch.read(&store, recheck).await, Ok(1));
        assert_eq!(fake.calls(), after_found + 1, "one conditional GET, no body");
    }

    /// A marker that DISAPPEARS must not reset the epoch this dataset already adopted: the epoch is
    /// a fact about the dataset, the object is not.
    #[tokio::test(start_paused = true)]
    async fn a_marker_that_vanishes_leaves_the_adopted_epoch_alone() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));
        fake.seed(WIPE_OBJECT_KEY, event(2).body());
        let mut watch = WipeWatch::default();
        assert_eq!(watch.read(&store, Duration::ZERO).await, Ok(2));

        fake.remove(WIPE_OBJECT_KEY);
        assert_eq!(
            watch.read(&store, Duration::ZERO).await,
            Ok(2),
            "an absent object must never pull this computer's epoch back to never-wiped"
        );

        watch.forget();
        assert_eq!(
            watch.read(&store, Duration::ZERO).await,
            Ok(2),
            "and `forget` drops only the concurrency token"
        );
    }

    #[tokio::test]
    async fn a_malformed_marker_faults_the_read_instead_of_reporting_no_wipe() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));
        fake.seed(WIPE_OBJECT_KEY, b"{}".to_vec());

        assert_eq!(
            WipeWatch::default().read(&store, Duration::ZERO).await,
            Err(WipeError::Malformed)
        );
        assert_eq!(read_now(&store).await, Err(WipeError::Malformed));
    }

    #[tokio::test]
    async fn the_first_wipe_mints_epoch_one_and_the_next_one_increments() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));

        assert_eq!(register(&store, 0, 10).await, Ok(1));
        assert_eq!(
            WipeEvent::parse(&fake.stored(WIPE_OBJECT_KEY).expect("the marker is published")),
            Ok(WipeEvent {
                epoch: 1,
                wiped_ms: 10
            })
        );

        assert_eq!(register(&store, 1, 20).await, Ok(2), "a second wipe increments again");
        assert_eq!(read_now(&store).await, Ok(2));
    }

    #[tokio::test]
    async fn a_cloud_epoch_that_is_already_ahead_is_adopted_rather_than_incremented() {
        let fake = Arc::new(FakeObjectStore::default());
        let store = syncing_fake(Arc::clone(&fake));
        let before = fake.seed(WIPE_OBJECT_KEY, event(5).body());

        assert_eq!(
            register(&store, 2, 30).await,
            Ok(5),
            "the other computer's wipe is this computer's wipe: nothing to increment"
        );
        assert_eq!(
            fake.etag_of(WIPE_OBJECT_KEY),
            Some(before),
            "adopting must write nothing at all"
        );
    }
}
