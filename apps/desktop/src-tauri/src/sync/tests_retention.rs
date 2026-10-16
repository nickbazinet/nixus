//! Story 23: what a snapshot carries, when a new one is written, and what a sweep may delete
//! (AD-9, AD-13).
//!
//! Every test drives the production `SyncActor` over one shared fake cloud, so the subject is the
//! behaviour the app has rather than one a harness arranged.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use crate::sync::manager::{SyncActor, SyncTuning};
use crate::sync::retention::{RETENTION_DAYS, SNAPSHOTS_KEPT};
use crate::sync::segment::{Roster, LOG_KEY_PREFIX, ROSTER_KEY};
use crate::sync::snapshot::{LatestSnapshot, SNAP_KEY_PREFIX, SNAP_LATEST_KEY};
use crate::sync::store::{StoreError, StoreOp};
use crate::sync::test_support::{
    syncing_fake, test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer,
};

type Actor = SyncActor<TestComputer>;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const NOW_MS: i64 = 1_700_000_000_000;

/// A fixture in which one `tick()` is one whole log cycle and no snapshot is written by accident:
/// the thresholds are the real ones unless a test lowers them.
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        tombstone_purge_interval: Duration::from_secs(86_400),
        reconcile_interval: Duration::from_secs(86_400),
        ..SyncTuning::default()
    }
}

fn computer_with(
    id: &str,
    store: Arc<FakeObjectStore>,
    clock: i64,
    tuning: SyncTuning,
) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host, tuning);

    (actor, probe)
}

/// A computer whose received batches really land in its tables, which is what a row-level
/// convergence claim needs.
fn applying(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    computer_with(id, store, clock, tuning())
}

/// A fixture that writes a snapshot as soon as anything is in the tail, for the tests whose
/// subject is the sweep rather than the threshold.
fn eager(store: Arc<FakeObjectStore>, id: &str) -> (Actor, ComputerProbe) {
    computer_with(
        id,
        store,
        NOW_MS,
        SyncTuning {
            snapshot_tail_max_messages: 1,
            ..tuning()
        },
    )
}

fn latest_of(cloud: &FakeObjectStore) -> LatestSnapshot {
    LatestSnapshot::parse(&cloud.stored(SNAP_LATEST_KEY).expect("LATEST exists"))
        .expect("LATEST parses")
}

fn keys_under(cloud: &FakeObjectStore, prefix: &str) -> Vec<String> {
    cloud
        .keys()
        .into_iter()
        .filter(|key| key.starts_with(prefix) && key != SNAP_LATEST_KEY)
        .collect()
}

fn identities(probe: &ComputerProbe) -> Vec<(String, Vec<u8>)> {
    probe.read(|conn| {
        let mut statement = conn
            .prepare("SELECT table_name, uuid FROM sync_uuid ORDER BY table_name, uuid")
            .expect("the identity read prepares");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("it reads")
            .collect::<Result<Vec<_>, _>>()
            .expect("it collects")
    })
}

// ------------------------------------------------------------------------------------------
// What a snapshot carries (AD-9 as amended; closes the Story 20/22 OPEN item)
// ------------------------------------------------------------------------------------------

/// The central correctness claim of this story: a computer bootstrapped from a snapshot applies a
/// LATER message that names a row the snapshot carried — without parking it and without minting a
/// second identity for that row.
#[tokio::test(start_paused = true)]
async fn a_bootstrapped_computer_applies_a_tail_message_naming_a_snapshot_row() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = applying("A", Arc::clone(&cloud), NOW_MS);
    let (mut second, b) = applying("B", Arc::clone(&cloud), NOW_MS + 1000);

    a.write_captured("from-a");
    first.enable(None).await.expect("A enables and publishes");

    let before = identities(&a);
    assert!(!before.is_empty(), "A must hold identities to carry");

    second.enable(None).await.expect("B bootstraps");

    assert_eq!(
        identities(&b),
        before,
        "the snapshot carried A's identities verbatim; a re-mint would republish the dataset"
    );

    a.write_captured("from-a-again");
    first.tick().await;
    second.tick().await;

    assert!(b.rows().contains(&"from-a-again".to_string()));
    let parked: i64 = b.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM sync_pending", [], |row| row.get(0))
            .expect("the parked count reads")
    });
    assert_eq!(parked, 0, "nothing may park on a row the snapshot carried");
}

/// A snapshot's watermark claims this install's own shipped head, so a bootstrapped computer does
/// not re-download the publisher's whole log just to recognise every message as a duplicate.
#[tokio::test(start_paused = true)]
async fn a_snapshot_claims_the_publishers_own_shipped_head() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = eager(Arc::clone(&cloud), "A");

    a.write_captured("one");
    first.enable(None).await.expect("A enables");
    a.write_captured("two");
    first.tick().await;

    a.write_captured("three");
    first.sync_now().await.expect("A publishes again");

    let install = a.install_id();
    let claimed = latest_of(&cloud).watermark.get(&install).copied();
    assert!(
        claimed.is_some_and(|seq| seq >= 0),
        "the watermark names A's own shipped head, not only what it applied: {claimed:?}"
    );
}

// ------------------------------------------------------------------------------------------
// The trigger (AD-9: 2 MB or 5,000 messages)
// ------------------------------------------------------------------------------------------

#[test]
fn the_tail_is_what_the_current_watermark_does_not_cover() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let db_path = dir.path().join("nixus.db");
    let conn = crate::db::test_dataset::migrated_dataset(&db_path);
    let install = "0a1b2c3d4e5f6071";
    crate::db::sync_segment::seed_log_messages(&conn, install, 7);
    crate::db::sync_segment::mark_shipped(&conn, 0, &[(1, 0), (2, 1), (3, 2)])
        .expect("segment 0 ships");
    crate::db::sync_segment::mark_shipped(&conn, 1, &[(4, 0), (5, 1)]).expect("segment 1 ships");

    let tail = |watermark: BTreeMap<String, i64>| {
        crate::db::snapshot_strip::tail_since_watermark(&conn, &watermark).expect("the tail reads")
    };

    assert_eq!(tail(BTreeMap::new()).0, 7, "no watermark covers nothing");
    assert_eq!(
        tail(BTreeMap::from([(install.to_string(), 0)])).0,
        4,
        "segment 0's three messages are covered; two shipped and two unshipped are not"
    );
    assert_eq!(
        tail(BTreeMap::from([(install.to_string(), 1)])).0,
        2,
        "only the unshipped tail is left"
    );
    assert_eq!(
        tail(BTreeMap::from([("ffffffffffffffff".to_string(), 9)])).0,
        7,
        "a watermark for another install covers nothing of this one"
    );
    assert!(
        tail(BTreeMap::new()).1 > 0,
        "the byte measure must not be vacuously zero"
    );
}

/// The thresholds decide, and either one alone is enough: the message count trips first in the
/// first pass, the byte count in the second.
#[tokio::test(start_paused = true)]
async fn a_new_snapshot_is_written_only_once_the_tail_passes_a_threshold() {
    for (max_messages, max_bytes) in [(5u64, u64::MAX), (u64::MAX, 60u64)] {
        let cloud = Arc::new(FakeObjectStore::default());
        let (mut first, a) = computer_with(
            "A",
            Arc::clone(&cloud),
            NOW_MS,
            SyncTuning {
                snapshot_tail_max_messages: max_messages,
                snapshot_tail_max_bytes: max_bytes,
                ..tuning()
            },
        );

        first.enable(None).await.expect("A enables");
        let after_enable = first.diagnostics().uploads;
        assert_eq!(after_enable, 1, "enable publishes the initial snapshot");

        first.tick().await;
        assert_eq!(
            first.diagnostics().uploads, after_enable,
            "an empty tail writes no snapshot"
        );

        for name in ["one", "two", "three", "four", "five", "six"] {
            a.write_captured(name);
            first.tick().await;
        }

        assert!(
            first.diagnostics().uploads > after_enable,
            "a tail past the threshold ({max_messages} messages / {max_bytes} bytes) writes one"
        );
    }
}

// ------------------------------------------------------------------------------------------
// Retention (AD-13)
// ------------------------------------------------------------------------------------------

/// A sweep deletes only up to the watermark of the `snap/LATEST` it RE-READS.
///
/// `compact` takes no watermark argument at all — that is the structural half of AD-13's rule —
/// and this arranges the race the rule exists for: the pointer in the cloud claims LESS than the
/// snapshot this computer published, which is what a lagging computer's publish looks like.
/// Segments above the re-read watermark must survive even though the publisher's own snapshot
/// contained them.
#[tokio::test]
async fn a_sweep_deletes_only_up_to_the_re_read_watermark() {
    let cloud = Arc::new(FakeObjectStore::default());
    let gated = syncing_fake(Arc::clone(&cloud));
    let install = "0a1b2c3d4e5f6071";

    cloud.set_clock(NOW_MS - (RETENTION_DAYS + 10) * DAY_MS);
    let segments: Vec<String> = (0..3)
        .map(|seq| {
            let key = crate::sync::segment::segment_key(install, seq);
            cloud.seed(&key, vec![seq as u8; 8]);
            key
        })
        .collect();

    let snap_id = "a".repeat(64);
    cloud.seed(&format!("{SNAP_KEY_PREFIX}{snap_id}"), vec![1]);
    let behind = LatestSnapshot {
        snap_id: snap_id.clone(),
        hash: "b".repeat(64),
        schema_version: 34,
        created_ms: NOW_MS,
        watermark: BTreeMap::from([(install.to_string(), 0)]),
        carries_identities: true,
    };
    cloud.seed(SNAP_LATEST_KEY, behind.body());

    let report = crate::sync::retention::compact(&gated, install, NOW_MS)
        .await
        .expect("the sweep runs");

    assert_eq!(report.segments_deleted, 1);
    assert!(
        cloud.stored(&segments[0]).is_none(),
        "the segment the re-read pointer covers is reclaimed"
    );
    for key in &segments[1..] {
        assert!(
            cloud.stored(key).is_some(),
            "{key} is above the re-read watermark and must survive"
        );
    }

    // And with no pointer at all nothing is deletable, however old: an account whose snapshot is
    // gone has no statement about what is redundant.
    cloud.remove(SNAP_LATEST_KEY);
    let report = crate::sync::retention::compact(&gated, install, NOW_MS)
        .await
        .expect("the sweep runs");
    assert_eq!(report.segments_deleted, 0);
    assert!(cloud.stored(&segments[1]).is_some());
}

#[tokio::test(start_paused = true)]
async fn a_segment_inside_the_retention_window_is_never_deleted() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS - 10 * DAY_MS);
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);

    first.enable(None).await.expect("A enables");
    for name in ["one", "two"] {
        a.write_captured(name);
        first.tick().await;
    }
    let segments = keys_under(&cloud, LOG_KEY_PREFIX);
    assert!(!segments.is_empty(), "something must be shipped");

    cloud.set_clock(NOW_MS);
    a.write_captured("three");
    first.sync_now().await.expect("A publishes and sweeps");

    let surviving = keys_under(&cloud, LOG_KEY_PREFIX);
    for key in &segments {
        assert!(
            surviving.contains(key),
            "{key} is 10 days old and the window is {RETENTION_DAYS} days"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn the_two_newest_snapshots_are_kept_and_older_ones_are_deleted() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS);
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);

    first.enable(None).await.expect("A enables");
    for (index, name) in ["one", "two", "three", "four"].iter().enumerate() {
        cloud.set_clock(NOW_MS + index as i64 * DAY_MS);
        a.write_captured(name);
        first.sync_now().await.expect("A publishes");
    }

    let snapshots = keys_under(&cloud, SNAP_KEY_PREFIX);
    assert_eq!(
        snapshots.len(),
        SNAPSHOTS_KEPT,
        "exactly the two newest survive: {snapshots:?}"
    );
    assert!(
        snapshots.contains(&latest_of(&cloud).snapshot_key().expect("a valid pointer")),
        "the snapshot the pointer names is always one of them"
    );
}

#[tokio::test(start_paused = true)]
async fn a_frozen_account_deletes_nothing() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS - (RETENTION_DAYS + 10) * DAY_MS);
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);

    first.enable(None).await.expect("A enables");
    for name in ["one", "two"] {
        a.write_captured(name);
        first.tick().await;
    }
    let before = cloud.keys();

    a.set_entitled(false);
    cloud.set_clock(NOW_MS);
    a.write_captured("three");
    let _ = first.sync_now().await;

    assert_eq!(
        cloud.calls_of(FakeOp::Delete),
        0,
        "AD-13: a Frozen account deletes nothing"
    );
    assert_eq!(cloud.keys(), before, "and nothing left the cloud");
}

#[tokio::test(start_paused = true)]
async fn an_install_unseen_for_the_retention_window_leaves_the_roster() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS);
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);

    first.enable(None).await.expect("A enables");
    a.write_captured("one");
    first.tick().await;

    let stale = "ffffffffffffffff".to_string();
    let head_key = crate::sync::segment::head_key(&stale);
    cloud.seed(
        &head_key,
        br#"{"install":"ffffffffffffffff","seq":0,"v":1}"#.to_vec(),
    );
    cloud.set_modified(&head_key, NOW_MS - (RETENTION_DAYS + 1) * DAY_MS);
    cloud.seed(
        ROSTER_KEY,
        Roster::of(vec![a.install_id(), stale.clone()]).body(),
    );

    a.write_captured("two");
    first.sync_now().await.expect("A publishes and sweeps");

    let roster = Roster::parse(&cloud.stored(ROSTER_KEY).expect("a roster")).expect("it parses");
    assert!(!roster.contains(&stale), "the stale member is pruned");
    assert!(roster.contains(&a.install_id()), "this computer stays");
    assert!(
        cloud.stored(&head_key).is_some(),
        "AD-13 prunes the roster entry, never the head object"
    );
}

#[tokio::test(start_paused = true)]
async fn a_sweep_never_addresses_a_key_outside_log_or_snap() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS - (RETENTION_DAYS + 10) * DAY_MS);
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);

    first.enable(None).await.expect("A enables");
    for name in ["one", "two"] {
        a.write_captured(name);
        first.tick().await;
    }
    cloud.seed("blob/aa", vec![1, 2, 3]);

    cloud.set_clock(NOW_MS);
    a.write_captured("three");
    first.sync_now().await.expect("A publishes and sweeps");

    assert!(
        cloud.calls_of(FakeOp::Delete) > 0,
        "the sweep must actually delete something, or this proves nothing"
    );
    for forbidden in ["owner", ROSTER_KEY, "head/", "blob/"] {
        assert_eq!(
            cloud.calls_of_prefix(FakeOp::Delete, forbidden),
            0,
            "{forbidden} must never be deleted (AD-13)"
        );
    }
}

// ------------------------------------------------------------------------------------------
// Offline past retention (AD-13)
// ------------------------------------------------------------------------------------------

/// A computer whose cursor is below the current snapshot's watermark and whose segments are gone
/// re-bootstraps; the unsent edit it made meanwhile crosses the swap, is replayed over the
/// restored file, and still reaches the other computer.
#[tokio::test(start_paused = true)]
async fn a_computer_offline_past_retention_re_bootstraps_and_keeps_its_unsent_log() {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS);
    let (mut first, a) = applying("A", Arc::clone(&cloud), NOW_MS);
    let (mut second, b) = applying("B", Arc::clone(&cloud), NOW_MS + 1000);

    a.write_captured("from-a");
    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    let b_install = b.install_id();

    a.write_captured("one");
    first.tick().await;
    a.write_captured("two");
    first.sync_now().await.expect("A publishes");
    assert!(
        !latest_of(&cloud).watermark.is_empty(),
        "the snapshot must claim something"
    );

    // Exactly what a sweep leaves behind: the snapshot is the only remaining copy of those
    // segments, so B's cursor can never be filled from the log.
    for key in keys_under(&cloud, LOG_KEY_PREFIX) {
        cloud.remove(&key);
    }

    second.tick().await;
    assert!(
        !b.rows().contains(&"two".to_string()),
        "B is genuinely behind before the re-bootstrap"
    );

    // An edit B has not shipped yet, made while it is behind.
    b.write_captured("only-on-b");
    assert!(b.unshipped() > 0);

    second.tick().await;

    assert!(
        b.rows().contains(&"two".to_string()),
        "B caught up through the snapshot rather than through the segments that are gone"
    );
    assert_eq!(
        b.dated_backups().len(),
        1,
        "CAP-5: a re-bootstrap keeps the displaced file"
    );
    assert!(
        b.rows().contains(&"only-on-b".to_string()),
        "AD-9: B's own unsent change was replayed over the restored file"
    );
    let own_log: i64 = b.read(|conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM sync_log WHERE install = ?1 AND seq IS NOT NULL",
            [&b_install],
            |row| row.get(0),
        )
        .expect("the count reads")
    });
    assert!(
        own_log > 0,
        "the carried log kept B's shipped rows, so `next_seq` cannot rewind (Story 19)"
    );

    second.tick().await;
    first.tick().await;
    assert!(
        a.rows().contains(&"only-on-b".to_string()),
        "B's carried edit really did ship"
    );
}

// ------------------------------------------------------------------------------------------
// The delete port (AD-6 vocabulary)
// ------------------------------------------------------------------------------------------

#[tokio::test]
async fn the_delete_port_maps_its_outcomes_the_way_the_protocol_reads_them() {
    use crate::sync::store::ObjectStore;

    let cloud = FakeObjectStore::default();
    let key = "log/0a1b2c3d4e5f6071/0000000000000000";
    cloud.seed(key, vec![1, 2, 3]);

    cloud.delete(key).await.expect("a stored key is removed");
    assert!(cloud.stored(key).is_none());

    cloud
        .delete(key)
        .await
        .expect("deleting an absent key is success, not NotFound");

    cloud.fail_next(FakeOp::Delete, StoreError::Forbidden);
    assert_eq!(cloud.delete("snap/x").await, Err(StoreError::Forbidden));

    assert_eq!(StoreOp::Delete.to_string(), "delete");
}

#[tokio::test]
async fn a_blocked_dataset_cannot_reach_the_delete_or_the_listing() {
    use crate::db::sync_state::FrozenReason;
    use crate::sync::gate::GatedError;
    use crate::sync::test_support::gated_fake;

    let cloud = Arc::new(FakeObjectStore::default());
    let gated = gated_fake(
        Arc::clone(&cloud),
        crate::models::DatasetKind::CloudLinked,
        false,
        Some(FrozenReason::EntitlementLapsed),
    );

    assert!(matches!(
        gated.delete("snap/x").await,
        Err(GatedError::Blocked(_))
    ));
    assert!(matches!(
        gated.list(LOG_KEY_PREFIX).await,
        Err(GatedError::Blocked(_))
    ));
    assert_eq!(cloud.calls(), 0, "no request reached the transport");
}
