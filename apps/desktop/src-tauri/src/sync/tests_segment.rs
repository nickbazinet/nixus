//! The log protocol end to end (AD-6): two computers exchanging segments through one shared fake
//! cloud, with no network, no AWS and no Tauri app.
//!
//! Every test here drives the production `SyncActor`, so what is proven is the behaviour the app
//! has rather than the behaviour a test harness could arrange. The fixture's `segment_interval` and
//! `remote_poll_interval` are zero so one `tick()` is one full cycle; the M1 snapshot fixtures do
//! the opposite and turn the cycle off, because they count requests to pin the snapshot debounce.

use std::sync::Arc;
use std::time::Duration;

use crate::sync::manager::{SyncActor, SyncTuning};
use crate::sync::object::{ObjectHeader, OBJECT_FORMAT_VERSION};
use crate::sync::segment::{
    self, Head, MessageKind, Roster, SEGMENT_MAX_MESSAGES, SEGMENT_PAYLOAD_VERSION,
};
use crate::sync::store::StoreError;
use crate::sync::test_support::{
    syncing_fake, test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer,
};

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
        settle_window: Duration::from_secs(5),
        min_upload_interval: Duration::from_secs(60),
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        // Zero so a single `tick()` is one whole log cycle: these tests are about the protocol, not
        // about the clock that paces it.
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        tombstone_purge_interval: Duration::from_secs(86_400),
        // Reconcile is driven directly in `tests_reconcile.rs`: here it would be a full scan of
        // every travelling table inside a fixture that counts requests (AD-3, story 22).
        reconcile_interval: Duration::from_secs(86_400),
    }
}

fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host, tuning());

    (actor, probe)
}

/// Two computers on one account, A enabled first so it owns the snapshot the second bootstraps
/// from.
async fn two_computers() -> (Actor, ComputerProbe, Actor, ComputerProbe, Arc<FakeObjectStore>) {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, first_probe) = computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    let (mut second, second_probe) = computer("B", Arc::clone(&cloud), 1_800_000_000_000);

    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps from A");

    (first, first_probe, second, second_probe, cloud)
}

fn schema_version() -> u32 {
    u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits")
}

// ------------------------------------------------------------------------------------------
// Two computers exchange segments
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn one_computers_captured_changes_reach_the_other_as_an_ordered_batch() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    let install = first_probe.install_id();

    first_probe.write_captured("groceries");
    first_probe.write_captured("transport");
    assert_eq!(first_probe.unshipped(), 2, "two captured rows, two messages");

    first.tick().await;

    assert_eq!(first_probe.unshipped(), 0, "the tail is shipped");
    assert!(
        cloud.stored(&segment::segment_key(&install, 0)).is_some(),
        "the segment is at log/<install>/<seq>"
    );
    assert_eq!(
        Head::parse(&cloud.stored(&segment::head_key(&install)).expect("a head")).expect("parses"),
        Head {
            install: install.clone(),
            seq: 0
        }
    );
    assert!(
        Roster::parse(&cloud.stored(segment::ROSTER_KEY).expect("a roster"))
            .expect("parses")
            .contains(&install),
        "a computer adds itself to the roster on first publish"
    );

    second.tick().await;

    assert_eq!(
        second_probe.applied_batches(),
        vec![(install, 0, 2)],
        "one contiguous batch, handed on once"
    );
    let messages = second_probe.applied_messages();
    assert!(
        messages
            .iter()
            .all(|message| message.kind == MessageKind::Field
                && message.table_name == "budget_groups"),
        "the decoded messages are the rows A really wrote"
    );
    let mut stamps: Vec<&str> = messages.iter().map(|message| message.hlc.as_str()).collect();
    let sorted = {
        let mut copy = stamps.clone();
        copy.sort_unstable();
        copy
    };
    assert_eq!(stamps, sorted, "messages arrive in their causal order");
    stamps.dedup();
    assert_eq!(stamps.len(), 2, "and each one exactly once");
}

#[tokio::test(start_paused = true)]
async fn a_second_cycle_with_no_change_costs_one_conditional_get_per_known_key_and_nothing_else() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    first_probe.write_captured("groceries");
    first.tick().await;
    second.tick().await;
    assert_eq!(second_probe.applied_batches().len(), 1);

    let conditional = cloud.calls_of(FakeOp::GetIfNoneMatch);
    let plain = cloud.calls_of(FakeOp::Get);
    let listings = cloud.calls_of(FakeOp::Exists);
    let bytes = cloud.transferred_bytes();

    second.tick().await;

    assert_eq!(
        cloud.calls_of(FakeOp::GetIfNoneMatch) - conditional,
        2,
        "AD-6 steady state: one conditional GET for the roster and one per known head"
    );
    assert_eq!(
        cloud.calls_of(FakeOp::Get) - plain,
        0,
        "nothing is re-read unconditionally"
    );
    assert_eq!(
        cloud.calls_of(FakeOp::Exists) - listings,
        0,
        "LIST is a repair path and the normal path never takes it"
    );
    assert_eq!(
        cloud.transferred_bytes() - bytes,
        0,
        "a 304 is billed as a GET and carries no body"
    );
    assert_eq!(
        second_probe.applied_batches().len(),
        1,
        "and nothing is handed on twice"
    );
}

// ------------------------------------------------------------------------------------------
// Crash recovery and duplicates
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_crash_between_the_upload_and_the_mark_re_cuts_the_same_bytes_and_dedups() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, probe) = computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    first.enable(None).await.expect("A enables");

    probe.write_captured("groceries");
    let install = probe.install_id();

    // The crash: cut and upload, then stop before the shipping mark.
    let cut = probe
        .read(|conn| segment::cut(conn, &install, schema_version()).expect("the cut reads"))
        .expect("there is something to ship");
    let gated = syncing_fake(Arc::clone(&cloud));
    assert!(
        segment::ship(&gated, &cut).await.expect("the put succeeds"),
        "the first upload creates the object"
    );
    let uploaded = cloud.stored(&cut.key()).expect("the segment is stored");
    assert_eq!(probe.unshipped(), 1, "the mark never happened");

    let before = cloud.calls_of_prefix(FakeOp::PutImmutable, segment::LOG_KEY_PREFIX);
    first.tick().await;

    assert_eq!(
        cloud.calls_of_prefix(FakeOp::PutImmutable, segment::LOG_KEY_PREFIX) - before,
        1,
        "the re-cut is one create-only put, which AD-6 answers as already stored"
    );
    assert_eq!(
        cloud.stored(&cut.key()).as_deref(),
        Some(uploaded.as_slice()),
        "a re-cut after a crash is byte-identical, so the dedup is sound"
    );
    assert_eq!(
        cloud
            .keys()
            .iter()
            .filter(|key| key.starts_with(segment::LOG_KEY_PREFIX))
            .count(),
        1,
        "and no second segment was minted under a new seq"
    );
    assert_eq!(probe.unshipped(), 0, "the mark completed what the crash cut short");
}

#[tokio::test(start_paused = true)]
async fn a_head_re_read_after_its_segment_was_applied_delivers_nothing_a_second_time() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    first_probe.write_captured("groceries");
    first.tick().await;
    second.tick().await;

    let install = first_probe.install_id();
    let segments = cloud.calls_of_prefix(FakeOp::Get, segment::LOG_KEY_PREFIX);

    // The one state the protocol cannot reach by itself: the same head delivered again.
    second.pull().forget_head_etags();
    second.tick().await;

    assert_eq!(
        cloud.calls_of_prefix(FakeOp::Get, segment::LOG_KEY_PREFIX) - segments,
        0,
        "a segment at or below the cursor is never requested again"
    );
    assert_eq!(
        second_probe.applied_batches(),
        vec![(install, 0, 1)],
        "a duplicate delivery is dropped idempotently"
    );
}

// ------------------------------------------------------------------------------------------
// Gaps
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_missing_segment_holds_back_the_later_ones_until_it_arrives() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    let install = first_probe.install_id();

    first_probe.write_captured("one");
    first.tick().await;
    first_probe.write_captured("two");
    first.tick().await;

    let first_key = segment::segment_key(&install, 0);
    let second_key = segment::segment_key(&install, 1);
    let withheld = cloud.stored(&first_key).expect("segment 0 was shipped");
    assert!(cloud.stored(&second_key).is_some(), "segment 1 too");
    cloud.remove(&first_key);

    second.tick().await;

    assert!(
        second_probe.applied_batches().is_empty(),
        "nothing above a gap is handed on"
    );
    assert_eq!(
        second.pull().next_seq(&install),
        Some(0),
        "the cursor still owes segment 0"
    );
    assert_eq!(
        second.pull().buffered(&install),
        1,
        "segment 1 is fetched and held, ready for the moment the gap closes"
    );

    cloud.seed(&first_key, withheld);
    second.tick().await;

    assert_eq!(
        second_probe.applied_batches(),
        vec![(install.clone(), 0, 1), (install.clone(), 1, 1)],
        "the whole prefix is released in seq order once the gap closes"
    );
    assert_eq!(second.pull().next_seq(&install), Some(2));
    assert_eq!(second.pull().buffered(&install), 0);
}

#[tokio::test(start_paused = true)]
async fn a_refused_batch_stays_owed_instead_of_being_skipped() {
    let (mut first, first_probe, mut second, second_probe, _cloud) = two_computers().await;
    let install = first_probe.install_id();
    first_probe.write_captured("one");
    first.tick().await;

    second_probe.refuse_apply(true);
    second.tick().await;

    assert!(second_probe.applied_batches().is_empty());
    assert_eq!(second.pull().next_seq(&install), Some(0));
    assert_eq!(second.status().error_code.as_deref(), Some("apply_failed"));

    second_probe.refuse_apply(false);
    second.tick().await;

    assert_eq!(second_probe.applied_batches(), vec![(install, 0, 1)]);
}

// ------------------------------------------------------------------------------------------
// Roster
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn two_computers_racing_on_the_roster_both_end_up_in_it() {
    let cloud = Arc::new(FakeObjectStore::default());
    let gated = syncing_fake(Arc::clone(&cloud));
    let (first, second) = ("0123456789abcdef", "fedcba9876543210");

    let mine = segment::join_roster(&gated, first).await.expect("A joins");
    assert_eq!(mine.installs, vec![first.to_string()]);

    // B loses the compare-and-swap once, which is exactly what a concurrent writer looks like.
    cloud.fail_next(FakeOp::PutIfMatch, StoreError::PreconditionFailed);
    let merged = segment::join_roster(&gated, second)
        .await
        .expect("B re-reads, merges and writes");

    assert!(merged.contains(first), "the loser never drops the winner");
    assert!(merged.contains(second));
    assert_eq!(
        Roster::parse(&cloud.stored(segment::ROSTER_KEY).expect("a roster")).expect("parses"),
        merged,
        "what is stored is the union, not one computer's view of it"
    );

    let again = segment::join_roster(&gated, first).await.expect("A re-joins");
    assert_eq!(again, merged, "an install already listed writes nothing");
}

// ------------------------------------------------------------------------------------------
// Format version
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn an_object_this_build_cannot_read_is_refused_without_being_applied() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    let install = first_probe.install_id();
    first_probe.write_captured("one");
    first.tick().await;

    let key = segment::segment_key(&install, 0);
    let honest = cloud.stored(&key).expect("the segment is stored");
    assert!(
        segment::read_segment(&honest, &install, 0).is_ok(),
        "the control: the untouched object does read"
    );

    let mut newer_format = honest.clone();
    newer_format[8] = OBJECT_FORMAT_VERSION + 1;
    cloud.remove(&key);
    cloud.seed(&key, newer_format);

    second.tick().await;

    assert_eq!(
        second.status().error_code.as_deref(),
        Some("segment_invalid"),
        "an unknown format is a typed refusal, never a panic and never a guess"
    );
    assert!(second_probe.applied_batches().is_empty());
}

#[test]
fn a_segment_from_a_newer_schema_is_refused_before_it_is_decompressed() {
    let payload = [0u8; 8];
    let digest: [u8; 32] = <sha2::Sha256 as sha2::Digest>::digest(payload).into();
    let object = ObjectHeader::new(schema_version() + 1, digest).frame(b"not even valid zstd");

    assert_eq!(
        segment::read_segment(&object, "0123456789abcdef", 0),
        Err(segment::SegmentError::SchemaTooNew {
            found: schema_version() + 1,
            supported: schema_version(),
        })
    );
}

// ------------------------------------------------------------------------------------------
// Bounded segments
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_large_backlog_is_cut_into_bounded_segments() {
    const BACKLOG: usize = 5_000;

    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, probe) = computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    first.enable(None).await.expect("A enables");

    let install = probe.install_id();
    probe.read(|conn| {
        crate::db::sync_segment::seed_log_messages(conn, &install, BACKLOG);
    });

    first.tick().await;

    let keys: Vec<String> = cloud
        .keys()
        .into_iter()
        .filter(|key| key.starts_with(segment::LOG_KEY_PREFIX))
        .collect();
    assert_eq!(
        keys.len(),
        BACKLOG / SEGMENT_MAX_MESSAGES,
        "one bounded object per {SEGMENT_MAX_MESSAGES} messages"
    );
    assert_eq!(probe.unshipped(), 0, "the whole backlog is shipped");

    for (index, key) in keys.iter().enumerate() {
        let seq = index as i64;
        assert_eq!(key, &segment::segment_key(&install, seq));
        let verified = segment::read_segment(
            &cloud.stored(key).expect("the segment is stored"),
            &install,
            seq,
        )
        .expect("every shipped segment reads back");
        assert_eq!(verified.messages.len(), SEGMENT_MAX_MESSAGES);
    }

    assert_eq!(
        Head::parse(&cloud.stored(&segment::head_key(&install)).expect("a head"))
            .expect("parses")
            .seq,
        (BACKLOG / SEGMENT_MAX_MESSAGES - 1) as i64,
        "the head names the highest contiguous seq"
    );
}

// ------------------------------------------------------------------------------------------
// The gate
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_dataset_the_gate_refuses_runs_none_of_the_log_protocol() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    let (mut local, _status, _events) = SyncActor::new(host.local_only(), tuning());

    let fault = local.enable(None).await.expect_err("a local profile cannot sync");
    assert_eq!(fault.code(), "local_only");

    local.tick().await;
    local.tick().await;

    assert_eq!(cloud.calls(), 0, "AD-14: not one request, ever");
    assert!(probe.applied_batches().is_empty());

    let (mut frozen, frozen_probe) = computer("B", Arc::clone(&cloud), 1_800_000_000_000);
    frozen.enable(None).await.expect("B enables while entitled");
    frozen_probe.write_captured("while frozen");
    frozen_probe.set_entitled(false);
    let while_entitled = cloud.calls();

    frozen.tick().await;

    assert_eq!(frozen.status().state, crate::sync::manager::SyncState::Frozen);
    assert_eq!(
        cloud.calls(),
        while_entitled,
        "AD-14: a Frozen account ships no segment and polls no head"
    );
    assert_eq!(
        frozen_probe.unshipped(),
        1,
        "the message waits in the log, which is what makes resuming converge"
    );
}

// ------------------------------------------------------------------------------------------
// Repair
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_head_the_roster_names_and_the_store_does_not_have_takes_the_repair_path() {
    let (mut first, first_probe, mut second, second_probe, cloud) = two_computers().await;
    let install = first_probe.install_id();
    first_probe.write_captured("one");
    first.tick().await;
    cloud.remove(&segment::head_key(&install));

    let listings = cloud.calls_of(FakeOp::Exists);
    second.tick().await;

    assert_eq!(
        cloud.calls_of(FakeOp::Exists) - listings,
        1,
        "exactly one repair probe: absence has to be told from denial before anything is concluded"
    );
    assert!(
        second_probe.applied_batches().is_empty(),
        "and nothing is invented for a head that is not there"
    );
}

#[test]
fn the_frozen_format_numbers_are_the_ones_that_shipped() {
    assert_eq!(SEGMENT_PAYLOAD_VERSION, 1);
    assert_eq!(segment::SEGMENT_COMPRESSION_LEVEL, 3);
    assert_eq!(segment::SEGMENT_MAX_MESSAGES, 1_000);
    assert_eq!(segment::SEGMENT_MAX_PAYLOAD_BYTES, 4 * 1024 * 1024);
    assert_eq!(segment::HEAD_VERSION, 1);
    assert_eq!(segment::ROSTER_VERSION, 1);
    assert_eq!(segment::LOG_KEY_PREFIX, "log/");
    assert_eq!(segment::HEAD_KEY_PREFIX, "head/");
    assert_eq!(segment::ROSTER_KEY, "roster");
}
