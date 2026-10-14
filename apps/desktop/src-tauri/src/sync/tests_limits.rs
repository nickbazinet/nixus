//! Story 26: AD-18's client-side cost and abuse controls — what this computer refuses to upload
//! and how often it will ask the store for anything.
//!
//! There is no server to enforce either bound (AD-17: the stack is compute-free), so each test
//! here asks the question the architecture asks: can a buggy or modified client get past this?
//! The size caps are therefore asserted with the transport's own call counter at zero — a refusal
//! that still sent the body would have cost exactly what the cap exists to prevent — and the rate
//! cap is asserted on the Tokio clock, so "it delays" is a measured duration rather than a sleep.

use std::sync::Arc;
use std::time::Duration;

use crate::db::sync_state::FrozenReason;
use crate::models::DatasetKind;
use crate::sync::blob::{self, BlobError};
use crate::sync::gate::GatedError;
use crate::sync::limits::{
    DatasetLimits, Oversize, RequestRateCap, MAX_BLOB_BYTES, MAX_POINTER_BYTES,
    MAX_SEGMENT_OBJECT_BYTES, MAX_SNAPSHOT_OBJECT_BYTES,
};
use crate::sync::manager::{SyncActor, SyncFault, SyncTuning};
use crate::sync::segment::{self, LOG_KEY_PREFIX, ROSTER_KEY, SEGMENT_MAX_PAYLOAD_BYTES};
use crate::sync::snapshot::{self, SnapshotError, SNAP_KEY_PREFIX, SNAP_LATEST_KEY};
use crate::sync::store::ETag;
use crate::sync::test_support::{
    gated_fake_limited, syncing_fake, test_computer, ComputerProbe, FakeObjectStore, TestComputer,
};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;
const SEGMENT_KEY: &str = "log/0a1b2c3d4e5f6071/0000000000000000";

/// One `tick()` is one whole log cycle, and the settle window keeps the SNAPSHOT path out of it:
/// a snapshot publish also runs AD-13's sweep, which would reclaim the very segments these tests
/// are counting (its watermark covers them and the fake store dates them at the epoch).
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::from_secs(5),
        min_upload_interval: Duration::from_secs(60),
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        tombstone_purge_interval: Duration::from_secs(86_400),
        reconcile_interval: Duration::from_secs(86_400),
        ..SyncTuning::default()
    }
}

fn computer(id: &str, store: Arc<FakeObjectStore>) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, NOW_MS);
    let (actor, _status, _events) = SyncActor::new(host, tuning());

    (actor, probe)
}

// ------------------------------------------------------------------------------------------
// The caps at the boundary: every namespace, every write method, nothing on the wire
// ------------------------------------------------------------------------------------------

#[tokio::test]
async fn every_namespace_refuses_a_write_past_its_cap_without_sending_a_byte() {
    let cloud = Arc::new(FakeObjectStore::default());
    let store = syncing_fake(Arc::clone(&cloud));

    let cases: Vec<(&str, usize)> = vec![
        (SEGMENT_KEY, MAX_SEGMENT_OBJECT_BYTES),
        ("snap/aa", MAX_SNAPSHOT_OBJECT_BYTES),
        ("blob/bb", MAX_BLOB_BYTES),
        (SNAP_LATEST_KEY, MAX_POINTER_BYTES),
        ("head/0a1b2c3d4e5f6071", MAX_POINTER_BYTES),
        (ROSTER_KEY, MAX_POINTER_BYTES),
    ];

    for (key, limit) in cases {
        let oversize = Oversize {
            limit,
            found: limit + 1,
        };
        let body = vec![0u8; limit + 1];

        assert_eq!(
            store.put_immutable(key, body.clone()).await.err(),
            Some(GatedError::TooLarge(oversize)),
            "a create-only put to {key} past the cap must be refused"
        );
        assert_eq!(
            store.put_if_absent(key, body.clone()).await.err(),
            Some(GatedError::TooLarge(oversize)),
            "and so must a first write of {key}"
        );
        assert_eq!(
            store
                .put_if_match(key, &ETag::new("whatever"), body)
                .await
                .err(),
            Some(GatedError::TooLarge(oversize)),
            "and so must a compare-and-swap of {key}"
        );
    }

    assert_eq!(
        cloud.calls(),
        0,
        "a refused write must never reach the transport: sending it is the cost the cap prevents"
    );
    assert_eq!(cloud.transferred_bytes(), 0);
    assert_eq!(
        store.limits().oversize_refusals(),
        18,
        "every refusal is counted (6 namespaces x 3 write methods)"
    );
}

#[tokio::test]
async fn a_write_exactly_at_the_cap_is_allowed() {
    let cloud = Arc::new(FakeObjectStore::default());
    let store = syncing_fake(Arc::clone(&cloud));

    store
        .put_immutable(SEGMENT_KEY, vec![0u8; MAX_SEGMENT_OBJECT_BYTES])
        .await
        .expect("the cap is a ceiling, not a strict bound");
    assert_eq!(store.limits().oversize_refusals(), 0);
    assert_eq!(cloud.keys().len(), 1);
}

#[test]
fn an_oversize_refusal_is_reported_as_payload_too_large_and_never_retried() {
    let fault = SyncFault::from(GatedError::TooLarge(Oversize {
        limit: MAX_BLOB_BYTES,
        found: MAX_BLOB_BYTES + 1,
    }));

    assert_eq!(fault.code(), "payload_too_large");
    assert!(
        !fault.retryable(),
        "the same bytes are the same size next time, so an unattended retry is a billed request \
         with a known answer"
    );
    assert!(
        fault.recoverable(),
        "the user can act on it (remove or shrink what is too large), so the UI offers a next step"
    );
    assert_eq!(
        SyncFault::from(SnapshotError::TooLarge(Oversize {
            limit: MAX_SNAPSHOT_OBJECT_BYTES,
            found: MAX_SNAPSHOT_OBJECT_BYTES + 1,
        }))
        .code(),
        "payload_too_large",
        "a producer's refusal carries the same code as the boundary's"
    );
}

// ------------------------------------------------------------------------------------------
// The caps inside the producers: a segment splits, a snapshot and a picture are refused
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn an_oversize_segment_candidate_is_split_at_the_byte_cap_rather_than_refused() {
    // Wide enough that the BYTE cap is reached long before the 1,000-message cap, which is what
    // makes this a test of AD-18's size bound and not of the message bound.
    const MESSAGES: usize = 200;
    const PAYLOAD_BYTES: usize = 48 * 1024;

    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, probe) = computer("A", Arc::clone(&cloud));
    first.enable(None).await.expect("A enables");

    let install = probe.install_id();
    probe.read(|conn| {
        crate::db::sync_segment::seed_log_messages_sized(conn, &install, MESSAGES, PAYLOAD_BYTES);
    });
    const { assert!(MESSAGES * PAYLOAD_BYTES > SEGMENT_MAX_PAYLOAD_BYTES) };

    first.tick().await;

    let keys: Vec<String> = cloud
        .keys()
        .into_iter()
        .filter(|key| key.starts_with(LOG_KEY_PREFIX))
        .collect();
    assert!(
        keys.len() > 1,
        "the backlog must be split into several bounded objects, not refused: {keys:?}"
    );
    assert_eq!(probe.unshipped(), 0, "and every message is shipped");
    for key in &keys {
        let stored = cloud.stored(key).expect("the segment is there");
        assert!(
            stored.len() <= MAX_SEGMENT_OBJECT_BYTES,
            "{key} is {} bytes, past the encoded cap",
            stored.len()
        );
    }
    assert_eq!(
        first.diagnostics().oversize_refusals,
        0,
        "splitting is not refusing"
    );
}

#[test]
fn a_snapshot_past_the_cap_is_refused_at_build_time_so_the_refusal_costs_no_request() {
    assert!(snapshot::within_size_cap(vec![0u8; 1024]).is_ok());

    let over = vec![0u8; MAX_SNAPSHOT_OBJECT_BYTES + 1];
    assert_eq!(
        snapshot::within_size_cap(over).err(),
        Some(SnapshotError::TooLarge(Oversize {
            limit: MAX_SNAPSHOT_OBJECT_BYTES,
            found: MAX_SNAPSHOT_OBJECT_BYTES + 1,
        }))
    );
}

#[tokio::test]
async fn a_picture_past_the_blob_cap_is_refused_before_it_is_hashed_or_sent() {
    let cloud = Arc::new(FakeObjectStore::default());
    let store = syncing_fake(Arc::clone(&cloud));

    let error = blob::put_image_blob(&store, 34, &vec![7u8; MAX_BLOB_BYTES + 1])
        .await
        .err();

    assert_eq!(
        error,
        Some(BlobError::TooLarge(Oversize {
            limit: MAX_BLOB_BYTES,
            found: MAX_BLOB_BYTES + 1,
        }))
    );
    assert_eq!(cloud.calls(), 0, "nothing was uploaded and nothing probed");
    assert_eq!(store.limits().oversize_refusals(), 1);
    assert_eq!(
        SyncFault::from(error.expect("the refusal")).code(),
        "payload_too_large"
    );

    // And the ordinary picture still goes: the cap is a ceiling, not a ban on blobs.
    blob::put_image_blob(&store, 34, &[1u8, 2, 3])
        .await
        .expect("a small picture uploads");
}

// ------------------------------------------------------------------------------------------
// The rate cap
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn the_rate_cap_delays_a_runaway_caller_and_then_recovers() {
    let cloud = Arc::new(FakeObjectStore::default());
    let limits = Arc::new(DatasetLimits::new(RequestRateCap {
        burst: 2,
        per_minute: 60,
    }));
    let store = gated_fake_limited(
        Arc::clone(&cloud),
        DatasetKind::CloudLinked,
        true,
        None,
        Arc::clone(&limits),
    );
    cloud.seed(ROSTER_KEY, b"{}".to_vec());

    let start = tokio::time::Instant::now();
    for _ in 0..2 {
        store.get(ROSTER_KEY).await.expect("the burst passes");
    }
    assert_eq!(limits.delays(), 0);

    store.get(ROSTER_KEY).await.expect("and so does the next");
    assert_eq!(limits.delays(), 1, "it waited rather than being dropped");
    assert_eq!(
        tokio::time::Instant::now().saturating_duration_since(start),
        Duration::from_secs(1)
    );
    assert_eq!(
        cloud.calls(),
        3,
        "the delayed request is still made: a rate cap must never lose data"
    );

    tokio::time::sleep(Duration::from_secs(5)).await;
    store.get(ROSTER_KEY).await.expect("the bucket refilled");
    assert_eq!(limits.delays(), 1, "a recovered bucket delays nothing");
}

#[tokio::test(start_paused = true)]
async fn every_request_type_counts_against_the_cap_not_only_the_writes() {
    let cloud = Arc::new(FakeObjectStore::default());
    let limits = Arc::new(DatasetLimits::new(RequestRateCap {
        burst: 1,
        per_minute: 60,
    }));
    let store = gated_fake_limited(
        Arc::clone(&cloud),
        DatasetKind::CloudLinked,
        true,
        None,
        Arc::clone(&limits),
    );
    let etag = cloud.seed(ROSTER_KEY, b"{}".to_vec());

    // One token, then one of each remaining port operation: a LIST, a DELETE, a HEAD, an existence
    // probe and a conditional GET all have to pay, or the cap bounds only half the bill.
    store.get(ROSTER_KEY).await.expect("the one free token");
    store.list("log/").await.expect("a listing");
    store.delete("log/nothing").await.expect("a delete");
    store.head(ROSTER_KEY).await.expect("a head");
    store.exists(ROSTER_KEY).await.expect("a probe");
    store
        .get_if_none_match(ROSTER_KEY, &etag)
        .await
        .expect("a conditional get");

    assert_eq!(
        limits.delays(),
        5,
        "five of the six requests had to wait, whatever their method"
    );
}

#[tokio::test(start_paused = true)]
async fn a_blocked_dataset_neither_spends_a_token_nor_waits_for_one() {
    for (kind, entitled, frozen) in [
        (DatasetKind::Local, true, None),
        (DatasetKind::CloudLinked, false, None),
        (
            DatasetKind::CloudLinked,
            true,
            Some(FrozenReason::EntitlementLapsed),
        ),
    ] {
        let cloud = Arc::new(FakeObjectStore::default());
        let limits = Arc::new(DatasetLimits::new(RequestRateCap {
            burst: 1,
            per_minute: 60,
        }));
        let store = gated_fake_limited(
            Arc::clone(&cloud),
            kind.clone(),
            entitled,
            frozen,
            Arc::clone(&limits),
        );

        for _ in 0..5 {
            assert!(store.get(ROSTER_KEY).await.is_err());
            assert!(store
                .put_immutable(SEGMENT_KEY, vec![0u8; MAX_SEGMENT_OBJECT_BYTES + 1])
                .await
                .is_err());
        }

        assert_eq!(cloud.calls(), 0);
        assert_eq!(
            limits.delays(),
            0,
            "the gate is checked first, so a refusal costs neither a token nor a wait"
        );
        assert_eq!(
            limits.oversize_refusals(),
            0,
            "and an ineligible dataset's oversized write is a gate refusal, not a size refusal"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn the_actors_tuning_is_what_states_the_rate_so_a_whole_cycle_is_paced_by_it() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (host, _probe) = test_computer("A", Arc::clone(&cloud), NOW_MS);
    let (mut actor, _status, _events) = SyncActor::new(
        host,
        SyncTuning {
            request_rate: RequestRateCap {
                burst: 1,
                per_minute: 60,
            },
            ..tuning()
        },
    );

    actor.enable(None).await.expect("enabling still succeeds");

    assert!(
        actor.diagnostics().rate_delays > 0,
        "a cap stated in the tuning must reach the store the host hands out"
    );
    assert_eq!(
        actor.diagnostics().oversize_refusals, 0,
        "a delay is not a refusal: every request was still made"
    );
}

// ------------------------------------------------------------------------------------------
// The constants against the real workload
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn two_computers_exchanging_changes_hit_no_cap_at_all() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, probe) = computer("A", Arc::clone(&cloud));
    let (mut second, _other) = computer("B", Arc::clone(&cloud));

    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B enables");

    for index in 0..10 {
        probe.write_captured(&format!("Group {index}"));
        first.tick().await;
        second.tick().await;
    }

    for actor in [&first, &second] {
        let diagnostics = actor.diagnostics();
        assert_eq!(
            diagnostics.oversize_refusals, 0,
            "ordinary editing must never meet a size cap"
        );
        assert_eq!(
            diagnostics.rate_delays, 0,
            "nor the rate cap: the default is ~100x the measured steady state"
        );
    }
}

/// The margin AD-18's snapshot cap leaves against the CAP-2 reference dataset, measured rather
/// than asserted in prose: a cap tuned so tightly that the heavy year nearly trips it would turn
/// an ordinary heavy user into a computer that cannot publish at all.
#[test]
fn the_snapshot_cap_leaves_a_wide_margin_over_the_heavy_year_dataset() {
    let heavy = crate::db::test_dataset::heavy_year_dataset();
    let built = snapshot::build_snapshot_blocking(
        &heavy.db_path,
        u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits"),
    )
    .expect("the heavy year is nowhere near the cap");

    assert!(
        built.object.len() * 10 < MAX_SNAPSHOT_OBJECT_BYTES,
        "the heavy year frames to {} bytes against a {} byte cap; that is less than 10x of \
         headroom, which is too close for a dataset that is only a reference point",
        built.object.len(),
        MAX_SNAPSHOT_OBJECT_BYTES
    );
}

/// Same question for a segment: the largest message the schema can produce must be far below the
/// cut's byte cap, or a single write could be unsplittable.
#[test]
fn the_largest_message_the_schema_admits_is_far_below_the_segment_caps() {
    let largest_payload =
        usize::try_from(crate::projects::image::MAX_PROJECT_THUMBNAIL_BYTES).expect("it fits");

    assert!(
        largest_payload * 50 < SEGMENT_MAX_PAYLOAD_BYTES,
        "a single message can be {largest_payload} bytes against a {SEGMENT_MAX_PAYLOAD_BYTES} \
         byte cut cap; one message must never be able to fill a segment on its own"
    );
    // The encoded cap must leave room above the split cap: the one message the cutter always keeps
    // could otherwise produce an object the boundary then refuses forever.
    const { assert!(SEGMENT_MAX_PAYLOAD_BYTES < MAX_SEGMENT_OBJECT_BYTES) };
}

#[test]
fn the_cut_cap_and_the_message_cap_are_the_ones_the_boundary_can_accept() {
    assert_eq!(segment::SEGMENT_MAX_MESSAGES, 1_000);
    assert_eq!(SEGMENT_MAX_PAYLOAD_BYTES, 4 * 1024 * 1024);
    assert_eq!(MAX_SEGMENT_OBJECT_BYTES, 16 * 1024 * 1024);
    assert_eq!(MAX_SNAPSHOT_OBJECT_BYTES, 64 * 1024 * 1024);
    assert_eq!(MAX_BLOB_BYTES, 16 * 1024 * 1024);
    assert_eq!(MAX_POINTER_BYTES, 1024 * 1024);
    assert_eq!(
        RequestRateCap::default(),
        RequestRateCap {
            burst: 120,
            per_minute: 600,
        }
    );
    assert!(SNAP_KEY_PREFIX.starts_with("snap"));
}
