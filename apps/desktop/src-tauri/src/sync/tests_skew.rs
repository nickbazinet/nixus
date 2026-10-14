//! Version skew and clock skew end to end (AD-4, AD-11, AD-16).
//!
//! The thing both halves have to prove is the same: a computer that cannot make sense of what the
//! account holds keeps working locally, says so in a way the user can act on, and loses nothing —
//! then catches up by itself the moment the cause is gone.
//!
//! Version skew needs two builds and a test has one, so the ceiling the host reports is injectable:
//! lowering it is "this computer is the old one", raising it again is "the user updated Nixus".
//! Clock skew needs two wall clocks on one thread, which Story 20 recorded the apply path's `Clock`
//! deliberately does not allow — so the drift detection itself is proven in `sync/clock.rs` against
//! an injected clock, and what is proven here is what the ACTOR does with the answer.

use std::sync::Arc;
use std::time::Duration;

use crate::sync::manager::{SyncActor, SyncState, SyncTuning};
use crate::sync::test_support::{test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        // Zero so one `tick()` is one whole log cycle: these tests are about what the cycle
        // concludes, not about the clock that paces it.
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        tombstone_purge_interval: Duration::from_secs(86_400),
        reconcile_interval: Duration::from_secs(86_400),
        ..SyncTuning::default()
    }
}

/// A computer whose received batches really land in its tables, which is what "ends identical to
/// the sender" needs.
fn applying(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host, tuning());

    (actor, probe)
}

// ------------------------------------------------------------------------------------------
// Version skew (AD-11, CAP-7)
// ------------------------------------------------------------------------------------------

/// The central claim: an old build PARKS what a newer one wrote — it is not applied, not dropped
/// and not quarantined as poison — surfaces `update_needed`, and after the update applies it and
/// ends identical to the sender.
#[tokio::test(start_paused = true)]
async fn an_old_build_parks_a_newer_computers_segment_and_applies_it_after_the_update() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = applying("A", Arc::clone(&cloud), NOW_MS);
    let (mut second, b) = applying("B", Arc::clone(&cloud), NOW_MS + 1000);

    first.enable(None).await.expect("A enables and publishes");
    second.enable(None).await.expect("B bootstraps from A");

    // B is the old computer from here on: everything A ships now carries a schema version B's
    // build has never heard of.
    let current = b.schema_version();
    b.set_schema_version(current - 1);

    a.write_captured("from-the-new-build");
    first.tick().await;
    second.tick().await;

    assert_eq!(
        second.status().state,
        SyncState::UpdateNeeded,
        "AD-11: the user is told to update, not shown a transfer error"
    );
    assert_eq!(second.status().error_code.as_deref(), Some("update_needed"));
    assert!(
        second.status().recoverable,
        "updating the app is something the user can do"
    );

    let diagnostics = second.diagnostics();
    assert_eq!(diagnostics.parked_segments, 1);
    assert_eq!(
        (diagnostics.pending_messages, diagnostics.quarantined_messages),
        (0, 0),
        "parking is not quarantining and not the pending queue"
    );
    assert!(
        !b.rows().contains(&"from-the-new-build".to_string()),
        "nothing from a newer build may be half-applied"
    );
    assert!(
        b.applied_batches().is_empty(),
        "the batch never reached the applier"
    );

    // A local write still works and still ships: AD-11's "never block local use".
    b.write_captured("local-while-parked");
    second.tick().await;
    assert!(b.rows().contains(&"local-while-parked".to_string()));

    first.tick().await;
    assert!(
        a.rows().contains(&"local-while-parked".to_string()),
        "the old computer's own changes still reach the new one"
    );

    // The update.
    b.set_schema_version(current);
    second.tick().await;

    assert!(
        b.rows().contains(&"from-the-new-build".to_string()),
        "AD-11: the parked message is re-evaluated and applied after the update"
    );
    assert_eq!(second.diagnostics().parked_segments, 0);
    assert_eq!(
        second.status().state,
        SyncState::Idle,
        "the state clears itself once the cause is gone"
    );

    let mut mine = b.rows();
    let mut theirs = a.rows();
    mine.sort();
    theirs.sort();
    assert_eq!(mine, theirs, "both computers end with the same rows");
}

/// A parked segment is requested ONCE. The cloud object is the durable park (AD-6 makes it
/// immutable), so re-reading it every poll would be the whole cost of running a stale build.
#[tokio::test(start_paused = true)]
async fn a_parked_segment_is_not_requested_again_until_the_build_catches_up() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = computer("A", Arc::clone(&cloud), NOW_MS);
    let (mut second, b) = computer("B", Arc::clone(&cloud), NOW_MS + 1000);

    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");

    let current = b.schema_version();
    b.set_schema_version(current - 1);

    a.write_captured("newer");
    first.tick().await;
    second.tick().await;

    let after_first = cloud.calls_of(FakeOp::Get);
    second.tick().await;
    second.tick().await;

    let per_cycle = (cloud.calls_of(FakeOp::Get) - after_first) / 2;
    assert_eq!(
        per_cycle, 0,
        "a parked seq costs no plain GET per poll; only the conditional head reads remain"
    );
    assert_eq!(second.diagnostics().parked_segments, 1, "still exactly one");
}

// ------------------------------------------------------------------------------------------
// Clock skew (AD-4)
// ------------------------------------------------------------------------------------------

/// A refused remote stamp becomes the `clock_skew` state, with the drift as a number, and clears
/// itself on the first cycle that refuses nothing.
#[tokio::test(start_paused = true)]
async fn a_refused_remote_stamp_surfaces_clock_skew_and_then_clears() {
    const AHEAD_MS: i64 = 11 * 60 * 1000;

    let cloud = Arc::new(FakeObjectStore::default());
    let (mut actor, probe) = computer("A", Arc::clone(&cloud), NOW_MS);
    actor.enable(None).await.expect("A enables");

    probe.report_clock_skew(AHEAD_MS);
    actor.tick().await;

    assert_eq!(actor.status().state, SyncState::ClockSkew);
    assert_eq!(actor.status().error_code.as_deref(), Some("clock_skew"));
    assert!(
        actor.status().recoverable,
        "correcting the computer's date and time is something the user can do"
    );

    let diagnostics = actor.diagnostics();
    assert_eq!(diagnostics.clock_skews, 1);
    assert_eq!(
        diagnostics.last_clock_skew_ms,
        Some(AHEAD_MS),
        "AD-16 wants the drift as a number, never a timestamp"
    );
    assert_eq!(
        diagnostics.backoff_ms, None,
        "a wrong clock must not stop the segments this computer can still exchange"
    );

    actor.tick().await;

    assert_eq!(actor.status().state, SyncState::Idle);
    assert_eq!(actor.status().error_code, None);
    assert_eq!(
        actor.diagnostics().last_clock_skew_ms,
        Some(AHEAD_MS),
        "the state clears but support can still read that it happened"
    );
}

/// Local use is never blocked by a wrong clock: the write lands and still ships.
#[tokio::test(start_paused = true)]
async fn a_wrong_clock_never_blocks_a_local_write() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut actor, probe) = computer("A", Arc::clone(&cloud), NOW_MS);
    actor.enable(None).await.expect("A enables");

    probe.report_clock_skew(20 * 60 * 1000);
    actor.tick().await;
    assert_eq!(actor.status().state, SyncState::ClockSkew);

    probe.write_captured("written-with-a-wrong-clock");
    probe.report_clock_skew(20 * 60 * 1000);
    actor.tick().await;

    assert!(probe.rows().contains(&"written-with-a-wrong-clock".to_string()));
    assert_eq!(probe.unshipped(), 0, "the change left the computer");
}

// ------------------------------------------------------------------------------------------
// Diagnostics counts (AD-16: counts, never values)
// ------------------------------------------------------------------------------------------

/// The pending and quarantine counts are read from the dataset, not from the actor's memory, so a
/// relaunch reports the queue that is really there.
#[tokio::test(start_paused = true)]
async fn diagnostics_report_the_pending_and_quarantined_queues_from_the_dataset() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut actor, probe) = computer("A", Arc::clone(&cloud), NOW_MS);
    actor.enable(None).await.expect("A enables");

    assert_eq!(
        (
            actor.diagnostics().pending_messages,
            actor.diagnostics().quarantined_messages
        ),
        (0, 0)
    );

    probe.read(|conn| {
        crate::db::sync_apply::seed_worklists(conn, 3, 2);
    });

    let diagnostics = actor.diagnostics();
    assert_eq!(diagnostics.pending_messages, 3);
    assert_eq!(diagnostics.quarantined_messages, 2);
}
