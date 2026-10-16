//! Lazy project images through the PRODUCTION sync cycle (AD-10, CAP-6).
//!
//! Every assertion here is about requests rather than return values: "uploaded exactly once",
//! "the second cycle sends nothing", "a Frozen account transfers no picture" and "a tampered
//! blob never reaches the dataset" are all claims a passing `Result` would make vacuously true.
//! The cloud is Story 8's `FakeObjectStore` with the real create-only semantics, and the two
//! computers are two app-data directories over one shared store.

use std::sync::Arc;
use std::time::Duration;

use crate::db::sync_state::FrozenReason;
use crate::sync::blob::{blob_key, BLOB_KEY_PREFIX};
use crate::sync::limits::RequestRateCap;
use crate::sync::manager::{SyncActor, SyncFault, SyncState, SyncTuning};
use crate::sync::object::ObjectHeader;
use crate::sync::store::{StoreError, StoreOp};
use crate::sync::snapshot::SNAP_LATEST_KEY;
use crate::sync::test_support::{test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer};

const SETTLE: Duration = Duration::from_secs(5);
const MIN_UPLOAD: Duration = Duration::from_secs(60);

type Actor = SyncActor<TestComputer>;

fn tuning() -> SyncTuning {
    SyncTuning {
        // Story 23 made the snapshot trigger the UNSNAPSHOTTED TAIL rather than "something
        // changed". These fixtures are about the settle window, the minimum interval and the
        // compare-and-swap, so they set both thresholds to 0: every tail qualifies and the
        // behaviour each test names is still the thing under test. The thresholds themselves
        // are proven in `tests_retention.rs`.
        snapshot_tail_max_bytes: 0,
        snapshot_tail_max_messages: 0,
        poll_interval: Duration::from_secs(1),
        settle_window: SETTLE,
        min_upload_interval: MIN_UPLOAD,
        initial_backoff: Duration::from_secs(10),
        // The Story-19 log protocol is OFF in this fixture, deliberately: these tests count
        // requests to pin the SNAPSHOT debounce, and a conditional roster poll in the middle of
        // one would be counted as an upload. `tests_segment.rs` is where the log cycle is driven.
        remote_poll_interval: Duration::from_secs(86_400),
        segment_interval: Duration::from_secs(86_400),
        tombstone_purge_interval: Duration::from_secs(86_400),
        // Reconcile is driven directly in `tests_reconcile.rs`: here it would be a full scan of
        // every travelling table inside a fixture that counts requests (AD-3, story 22).
        reconcile_interval: Duration::from_secs(86_400),
        max_backoff: Duration::from_secs(120),
        // The automatic join is driven explicitly in `tests_auto.rs`: these fixtures measure
        // request counts and drive `tick` while sync is off, and one unattended join would both
        // publish a snapshot and add requests none of them is about.
        auto_join_interval: Duration::from_secs(86_400),
        capability_recheck_interval: Duration::from_secs(86_400),
        request_rate: RequestRateCap::default(),
    }
}

fn actor_for(host: TestComputer) -> Actor {
    let (actor, _status, _events) = SyncActor::new(host, tuning());

    actor
}

fn computer(id: &str, cloud: &Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, Arc::clone(cloud), clock);

    (actor_for(host), probe)
}

/// Deterministic, incompressible bytes, so nothing is equal to anything else by accident.
fn picture(seed: u8, len: usize) -> Vec<u8> {
    let mut state = u64::from(seed).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 3;
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

fn blob_puts(cloud: &FakeObjectStore) -> u64 {
    cloud.calls_of_prefix(FakeOp::PutImmutable, BLOB_KEY_PREFIX)
}

fn blob_gets(cloud: &FakeObjectStore) -> u64 {
    cloud.calls_of_prefix(FakeOp::Get, BLOB_KEY_PREFIX)
}

fn schema_version() -> u32 {
    u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits")
}

fn offline_fault() -> StoreError {
    StoreError::Transport {
        operation: StoreOp::PutImmutable,
        status: None,
        code: None,
        retryable: true,
    }
}

/// An edit and the two polls that publish it: the first opens the settle window, the second
/// finds it elapsed.
async fn edit_then_settle(actor: &mut Actor, probe: &ComputerProbe, name: &str) {
    probe.write_row(name);
    actor.tick().await;
    tokio::time::advance(SETTLE + MIN_UPLOAD).await;
    actor.tick().await;
}

/// The core of the fix: the production cycle uploads the full picture, and a cycle that follows
/// it with no new picture costs ZERO blob requests — not one re-sent megabyte, and not even a
/// conditional probe.
#[tokio::test(start_paused = true)]
async fn the_first_cycle_uploads_every_local_picture_and_the_second_sends_nothing() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let bytes = picture(1, 300_000);
    let hash = a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");

    assert_eq!(blob_puts(&cloud), 1, "the full picture is uploaded once");
    assert!(
        cloud.keys().contains(&blob_key(&hash).expect("a digest is a key")),
        "the object must be at blob/<sha256 of the image bytes>, got {:?}",
        cloud.keys()
    );

    let after_first = cloud.calls();
    edit_then_settle(&mut computer_a, &a, "later").await;

    assert_eq!(computer_a.status().state, SyncState::Idle);
    assert_eq!(blob_puts(&cloud), 1, "the second cycle re-sends no picture");
    assert_eq!(
        cloud.calls_of_prefix(FakeOp::Exists, BLOB_KEY_PREFIX),
        1,
        "the persisted marker answers the second cycle, so it makes no blob request at all"
    );
    assert!(
        cloud.calls() > after_first,
        "the second cycle still published a snapshot, so the zero above is not an empty cycle"
    );
}

/// The uploaded object is the AD-8-framed RAW image: that is what keeps the key's hash equal to
/// `project_images.image_sha256` and lets any computer verify what it downloads.
#[tokio::test(start_paused = true)]
async fn the_uploaded_object_is_the_framed_image_under_its_own_hash() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let bytes = picture(2, 120_000);
    let hash = a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");

    let stored = cloud
        .stored(&blob_key(&hash).expect("a digest is a key"))
        .expect("the blob is there");
    let (header, payload) = ObjectHeader::parse(&stored).expect("the header parses");

    assert_eq!(payload, bytes.as_slice());
    assert_eq!(header.schema_version, schema_version());
}

/// Two projects showing the same picture are one object and one upload (AD-6).
#[tokio::test(start_paused = true)]
async fn one_content_hash_is_one_upload_however_many_projects_show_it() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let bytes = picture(3, 90_000);
    a.store_project_image(1, &bytes);
    a.store_project_image(2, &bytes);

    computer_a.enable(None).await.expect("A enables");

    assert_eq!(blob_puts(&cloud), 1);
}

/// A row that arrived in a snapshot has a hash and no payload. Uploading on its behalf would
/// mean inventing bytes, so it is skipped — and B's cycle also proves it does not re-send the
/// picture it later fetches, because A's object is already there.
#[tokio::test(start_paused = true)]
async fn a_row_without_local_bytes_is_never_uploaded_and_a_shared_blob_is_never_re_sent() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let bytes = picture(4, 200_000);
    a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");

    assert_eq!(
        b.project_image(1).expect("the row arrived").image_bytes,
        None,
        "AD-10: the snapshot carried the thumbnail and the hash only"
    );

    edit_then_settle(&mut computer_b, &b, "from-b").await;
    assert_eq!(
        blob_puts(&cloud),
        1,
        "a row with no local payload must not be uploaded"
    );

    computer_b.fetch_image(1).await.expect("B fetches");
    edit_then_settle(&mut computer_b, &b, "from-b-again").await;

    assert_eq!(
        blob_puts(&cloud),
        1,
        "B now holds the bytes, but the object is already there: a 0-byte probe, never a re-send"
    );
}

/// AD-14 and inherited AD-12. An empty cloud is what makes this non-vacuous: had the request
/// gone out, the object would exist.
#[tokio::test(start_paused = true)]
async fn a_blocked_dataset_uploads_and_fetches_no_picture_at_all() {
    for (local_only, entitled, frozen, expected) in [
        (true, true, None, "local_only"),
        (false, false, None, "not_entitled"),
        (
            false,
            true,
            Some(FrozenReason::EntitlementLapsed),
            "frozen",
        ),
    ] {
        let cloud = Arc::new(FakeObjectStore::default());
        let (host, probe) = test_computer("A", Arc::clone(&cloud), 1_700_000_000_000);
        let host = if local_only { host.local_only() } else { host };
        let mut actor = actor_for(host);
        let bytes = picture(5, 50_000);
        let hash = probe.store_project_image(1, &bytes);
        probe.set_entitled(entitled);
        probe.set_frozen(frozen);

        let fault = actor
            .enable(None)
            .await
            .expect_err("a blocked dataset cannot enable");

        assert_eq!(fault.code(), expected);
        assert_eq!(blob_puts(&cloud), 0, "{expected}: no picture was uploaded");

        // A row that knows its picture only by hash is the state a bootstrapped computer is in,
        // and the only one in which a fetch has anything to reach the cloud for.
        probe.read(|conn| {
            crate::db::projects::blank_project_image_bytes(conn).expect("the payload is dropped")
        });

        let fetch = actor
            .fetch_image(1)
            .await
            .map(|_| ())
            .expect_err("a blocked dataset cannot fetch");

        assert_eq!(fetch.code(), expected);
        assert_eq!(blob_gets(&cloud), 0, "{expected}: no picture was downloaded");
        assert!(
            !cloud
                .keys()
                .contains(&blob_key(&hash).expect("a digest is a key")),
            "{expected}: the object must not exist"
        );
    }
}

/// A blob fault must not leave `snap/LATEST` pointing at a snapshot whose pictures are missing,
/// which is why blobs go first and the fault returns before the pointer is touched.
#[tokio::test(start_paused = true)]
async fn a_failed_blob_upload_leaves_the_snapshot_pointer_untouched() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    a.store_project_image(1, &picture(6, 80_000));
    cloud.fail_next(FakeOp::PutImmutable, offline_fault());

    let fault = computer_a
        .enable(None)
        .await
        .expect_err("the blob upload fails");

    assert_eq!(fault.code(), "offline");
    assert_eq!(computer_a.status().state, SyncState::Offline);
    assert!(
        !cloud.keys().contains(&SNAP_LATEST_KEY.to_string()),
        "no computer may ever read a snapshot whose images are not uploaded yet, got {:?}",
        cloud.keys()
    );

    computer_a
        .enable(None)
        .await
        .expect("the retry succeeds");

    assert_eq!(
        blob_puts(&cloud),
        2,
        "the attempt that failed and the one retry, and no more"
    );
    assert!(cloud.keys().contains(&SNAP_LATEST_KEY.to_string()));
}

/// The round trip CAP-6 promises: B holds a placeholder, asks for the picture once, and ends up
/// with exactly A's bytes.
#[tokio::test(start_paused = true)]
async fn the_fetch_writes_the_verified_bytes_and_answers_with_the_full_payload() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let bytes = picture(7, 250_000);
    let hash = a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");

    let placeholder = b.project_image(1).expect("the row arrived");
    assert_eq!(placeholder.image_bytes, None);
    assert_eq!(placeholder.image_sha256, hash);
    assert!(placeholder.thumbnail_bytes.is_some());

    let payload = computer_b.fetch_image(1).await.expect("B fetches");

    assert!(payload.full_image_available);
    assert_eq!(payload.image_sha256, hash);
    assert_eq!(payload.byte_size as usize, bytes.len());
    assert!(payload.image_base64.is_some());
    assert_eq!(
        b.project_image(1).expect("the row reads").image_bytes,
        Some(bytes),
        "the bytes written are A's bytes"
    );
    assert_eq!(blob_gets(&cloud), 1);
}

/// No network for a picture this computer already has: `connect` is never called, so not even a
/// credential is vended.
#[tokio::test(start_paused = true)]
async fn fetching_a_picture_that_is_already_here_makes_no_request() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let bytes = picture(8, 60_000);
    a.store_project_image(1, &bytes);
    computer_a.enable(None).await.expect("A enables");
    let after_enable = cloud.calls();

    let payload = computer_a.fetch_image(1).await.expect("it is already here");

    assert!(payload.full_image_available);
    assert_eq!(cloud.calls(), after_enable, "nothing was requested");
}

#[tokio::test(start_paused = true)]
async fn fetching_a_project_without_a_picture_is_a_typed_refusal_and_no_request() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    a.write_row("something");
    computer_a.enable(None).await.expect("A enables");
    let after_enable = cloud.calls();

    let fault = computer_a
        .fetch_image(404)
        .await
        .expect_err("there is no picture");

    assert_eq!(fault.code(), "image_missing");
    assert_eq!(cloud.calls(), after_enable);
}

/// A blob whose body is not the picture its key names is REFUSED, and the row keeps its
/// placeholder: writing it would store one picture under another's identity.
#[tokio::test(start_paused = true)]
async fn a_tampered_blob_is_refused_and_the_row_keeps_its_placeholder() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let honest = picture(9, 100_000);
    let hash = a.store_project_image(1, &honest);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");

    // The header still claims the honest digest: exactly the shape a mirror serving the wrong
    // body would produce, which a size or an etag comparison would not catch.
    let digest: [u8; 32] = <sha2::Sha256 as sha2::Digest>::digest(&honest).into();
    cloud.seed(
        &blob_key(&hash).expect("a digest is a key"),
        ObjectHeader::new(schema_version(), digest).frame(&picture(10, 100_000)),
    );

    let fault = computer_b
        .fetch_image(1)
        .await
        .expect_err("the download must be refused");

    assert_eq!(fault.code(), "image_corrupt");
    assert!(!fault.retryable(), "re-downloading the same object cannot help");
    assert_eq!(
        b.project_image(1).expect("the row reads").image_bytes,
        None,
        "nothing was written"
    );
}

/// A blob the cloud does not hold reports the existing "the cloud copy could not be found" code
/// rather than a corruption: nothing is wrong with this computer's data.
#[tokio::test(start_paused = true)]
async fn an_absent_blob_is_reported_as_missing_from_the_cloud() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let bytes = picture(11, 70_000);
    let hash = a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");
    cloud.remove(&blob_key(&hash).expect("a digest is a key"));

    let fault = computer_b.fetch_image(1).await.expect_err("it is gone");

    assert_eq!(fault.code(), "remote_missing");
    assert_eq!(b.project_image(1).expect("the row reads").image_bytes, None);
}

/// The write-back is addressed by hash, so a download that finishes after the user replaced the
/// picture matches no row: the newer picture survives, and the answer describes what is there.
#[tokio::test(start_paused = true)]
async fn a_download_that_lands_after_the_picture_changed_overwrites_nothing() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let original = picture(12, 110_000);
    a.store_project_image(1, &original);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");

    let replacement = picture(13, 95_000);
    let replaced_hash = b.store_project_image(1, &replacement);

    let payload = computer_b.fetch_image(1).await.expect("B answers");

    assert_eq!(payload.image_sha256, replaced_hash);
    assert_eq!(
        b.project_image(1).expect("the row reads").image_bytes,
        Some(replacement),
        "the picture the user just chose must survive"
    );
}

/// A fetch while the dataset is linked but not uploading is still legitimate: AD-14's gate is the
/// authority on reaching the cloud, and showing one's own picture is not an upload.
#[tokio::test(start_paused = true)]
async fn a_fetch_does_not_require_an_enabled_upload_cycle() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a) = computer("A", &cloud, 1_700_000_000_000);
    let (mut computer_b, b) = computer("B", &cloud, 1_800_000_000_000);
    let bytes = picture(14, 130_000);
    a.store_project_image(1, &bytes);

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");
    computer_b.disable(false).await;

    assert_eq!(computer_b.status().state, SyncState::Unlinked);

    let payload = computer_b.fetch_image(1).await.expect("B still fetches");

    assert!(payload.full_image_available);
    assert_eq!(
        b.project_image(1).expect("the row reads").image_bytes,
        Some(bytes)
    );
}

/// `SyncFault::ImageMissing` and `ImageCorrupt` are what the UI narrows on, so their codes are
/// part of the contract and are pinned here rather than only read off the frontend.
#[test]
fn the_two_image_codes_are_stable_and_not_retryable() {
    for (fault, code) in [
        (SyncFault::ImageMissing, "image_missing"),
        (SyncFault::ImageCorrupt, "image_corrupt"),
    ] {
        assert_eq!(fault.code(), code);
        assert!(!fault.retryable());
        assert!(fault.recoverable(), "the user can pick a new picture");
        assert_ne!(fault.message(), "Sync is unavailable.", "{code} needs copy");
    }
}
