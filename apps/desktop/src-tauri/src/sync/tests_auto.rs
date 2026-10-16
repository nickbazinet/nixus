//! fix F8: sync is automatic. Nobody turns it on, nobody is asked anything, and a computer that
//! is already syncing is never re-asked the first-connect question (AD-7, AD-9, AD-14, AD-16).
//!
//! Every test drives the production `SyncActor` over the in-process fake cloud, so the subject is
//! the behaviour the app has rather than one a harness arranged.

use std::sync::Arc;
use std::time::Duration;

use crate::db::sync_state;
use crate::sync::bootstrap::LinkChoice;
use crate::sync::manager::{
    SyncActor, SyncEnableOutcome, SyncState, SyncStatusPayload, SyncTuning,
};
use crate::sync::snapshot::{LatestSnapshot, SNAP_LATEST_KEY};
use crate::sync::store::{StoreError, StoreOp};
use crate::sync::test_support::{test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer};

use tokio::sync::mpsc::UnboundedReceiver;

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

/// Enough ticks for one whole reconcile pass: it reads ONE bounded chunk per cycle, and a pass is
/// a live chunk plus a deleted chunk for every travelling table (AD-3, story 22).
const RECONCILE_CHUNK_BUDGET: usize = 120;

/// One `tick()` is one whole cycle: the floors are zero so a test states the sequence of events
/// rather than waiting for them, and the snapshot thresholds stay REAL so no test accidentally
/// proves its point through an unrelated republish.
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        tombstone_purge_interval: Duration::from_secs(86_400),
        reconcile_interval: Duration::from_secs(86_400),
        auto_join_interval: Duration::ZERO,
        capability_recheck_interval: Duration::ZERO,
        ..SyncTuning::default()
    }
}

fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe, Events) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe, Events(events))
}

fn relaunched(probe: &ComputerProbe, clock: i64) -> (Actor, Events) {
    relaunched_with(probe, clock, tuning())
}

fn relaunched_with(probe: &ComputerProbe, clock: i64, tuning: SyncTuning) -> (Actor, Events) {
    let (actor, _status, events) = SyncActor::new(probe.relaunch(clock, true), tuning);

    (actor, Events(events))
}

/// Reconcile is normally off in this fixture (a full scan of every travelling table per tick), but
/// the identity-less-snapshot upgrade is deliberately gated on a COMPLETED pass, so the one test
/// that proves it has to let the pass run.
fn tuning_with_reconcile() -> SyncTuning {
    SyncTuning {
        reconcile_interval: Duration::ZERO,
        ..tuning()
    }
}

/// Every transition the actor published, which is how "no prompt was ever reached" becomes a
/// claim about the whole run instead of about the state it happened to end in.
struct Events(UnboundedReceiver<SyncStatusPayload>);

impl Events {
    fn states(&mut self) -> Vec<SyncState> {
        let mut seen = Vec::new();
        while let Ok(payload) = self.0.try_recv() {
            seen.push(payload.state);
        }

        seen
    }
}

fn assert_never_asked(label: &str, states: &[SyncState]) {
    for state in states {
        assert!(
            !matches!(
                state,
                SyncState::LinkChoiceRequired | SyncState::RemoteChanged | SyncState::Error
            ),
            "{label} reached {state:?}; a seamless sync asks nothing and reports nothing: {states:?}"
        );
    }
}

fn joined(probe: &ComputerProbe) -> bool {
    probe.read(|conn| {
        sync_state::load(conn)
            .expect("the row reads")
            .is_some_and(|state| state.joined())
    })
}

fn opted_out(probe: &ComputerProbe) -> bool {
    probe.read(|conn| {
        sync_state::load(conn)
            .expect("the row reads")
            .is_some_and(|state| state.sync_disabled)
    })
}

// ------------------------------------------------------------------------------------------
// 1. The product requirement: work on A, B gets it; work on B, A gets it; no prompt, ever.
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn two_entitled_computers_sync_both_ways_with_no_prompt_and_nothing_turned_on() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, mut events_a) = computer("A", Arc::clone(&cloud), NOW_MS);
    let (mut b, probe_b, mut events_b) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);

    probe_a.write_captured("rent");
    probe_a.write_captured("groceries");

    // The ONLY thing either side is ever asked to do. No `enable`, no link choice, no answer.
    a.auto_start_now().await;
    b.auto_start_now().await;

    assert!(joined(&probe_a), "A joined by itself");
    assert!(joined(&probe_b), "B joined by itself");
    assert!(
        probe_b.rows().contains(&"rent".to_string()),
        "B restored A's data automatically: {:?}",
        probe_b.rows()
    );

    probe_b.write_captured("fuel");
    probe_b.captured(|tx| {
        crate::db::test_dataset::rename_marker_row(tx, "groceries", "food");
        crate::db::test_dataset::delete_marker_row(tx, "rent");
        Ok(())
    })
    .expect("B's edits commit");

    b.tick().await;
    a.tick().await;

    let on_a = probe_a.rows();
    assert!(on_a.contains(&"fuel".to_string()), "A received B's new row: {on_a:?}");
    assert!(on_a.contains(&"food".to_string()), "A received B's rename: {on_a:?}");
    assert!(!on_a.contains(&"rent".to_string()), "A received B's delete: {on_a:?}");

    probe_a.write_captured("insurance");
    a.tick().await;
    b.tick().await;

    assert!(
        probe_b.rows().contains(&"insurance".to_string()),
        "B received A's later edit: {:?}",
        probe_b.rows()
    );

    assert_never_asked("A", &events_a.states());
    assert_never_asked("B", &events_b.states());
}

// ------------------------------------------------------------------------------------------
// 2. The owner's bug: a relaunch of a computer that already syncs must be silent.
// ------------------------------------------------------------------------------------------

/// The reported regression, reproduced at the reported shape: a dataset holding ~1,660 rows, a
/// cloud snapshot already published, and a relaunch. Before the join marker existed this is the
/// exact path that answered `ChoiceRequired` on every single launch.
#[tokio::test(start_paused = true)]
async fn a_relaunch_of_a_joined_computer_holding_records_asks_nothing() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _events) = computer("A", Arc::clone(&cloud), NOW_MS);

    let names: Vec<String> = (0..1_660).map(|index| format!("row-{index}")).collect();
    probe_a
        .captured(|tx| {
            for name in &names {
                crate::db::test_dataset::insert_marker_rows(tx, &[name.as_str()]);
            }
            Ok(())
        })
        .expect("a real-sized dataset commits");

    a.auto_start_now().await;
    assert!(joined(&probe_a));
    assert!(
        cloud.stored(SNAP_LATEST_KEY).is_some(),
        "the first automatic join publishes the account's snapshot"
    );

    let (mut relaunch, mut events) = relaunched(&probe_a, NOW_MS + 600_000);
    relaunch.auto_start_now().await;

    let states = events.states();
    assert_never_asked("the relaunched computer", &states);
    assert!(
        states.contains(&SyncState::Idle),
        "a relaunch settles to idle, not to a question: {states:?}"
    );
    assert_eq!(
        probe_a.rows().len(),
        1_660,
        "a silent resume must not duplicate or drop a row"
    );
}

#[tokio::test(start_paused = true)]
async fn both_computers_relaunch_and_still_exchange_their_tails() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _ea) = computer("A", Arc::clone(&cloud), NOW_MS);
    let (mut b, probe_b, _eb) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);

    probe_a.write_captured("from-a");
    a.auto_start_now().await;
    b.auto_start_now().await;

    let (mut a2, mut events_a) = relaunched(&probe_a, NOW_MS + 600_000);
    let (mut b2, mut events_b) = relaunched(&probe_b, NOW_MS + 700_000);
    a2.auto_start_now().await;
    b2.auto_start_now().await;

    probe_b.write_captured("from-b-after-relaunch");
    b2.tick().await;
    a2.tick().await;

    assert!(
        probe_a.rows().contains(&"from-b-after-relaunch".to_string()),
        "a relaunched A still applies B's tail: {:?}",
        probe_a.rows()
    );
    assert_never_asked("A after a relaunch", &events_a.states());
    assert_never_asked("B after a relaunch", &events_b.states());
}

// ------------------------------------------------------------------------------------------
// 3. The Milestone-1 snapshot already in the owner's account (F).
// ------------------------------------------------------------------------------------------

/// A pointer written by Milestone 1: no `watermark` key at all, and the object it names stripped
/// row identities. Hand-built, because this build cannot produce one any more.
fn seed_milestone_one_pointer(cloud: &FakeObjectStore, snap_id: &str) {
    let body = format!(
        "{{\"created_ms\":{NOW_MS},\"hash\":\"{}\",\"schema_version\":34,\"snap_id\":\"{snap_id}\",\"v\":1}}",
        "c".repeat(64)
    );
    cloud.seed(SNAP_LATEST_KEY, body.into_bytes());
}

#[tokio::test(start_paused = true)]
async fn a_legacy_linked_dataset_resumes_silently_and_replaces_the_identity_less_snapshot() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, mut events) = computer("A", Arc::clone(&cloud), NOW_MS);

    probe_a.write_captured("legacy-one");
    probe_a.write_captured("legacy-two");
    // The Milestone-1 state exactly: linked with a pin, and the migration's backfill treating it
    // as joined, over a cloud that still holds an identity-less snapshot.
    a.auto_start_now().await;
    seed_milestone_one_pointer(&cloud, &"a".repeat(64));
    let (mut a2, mut events2) = relaunched_with(&probe_a, NOW_MS + 600_000, tuning_with_reconcile());
    a2.auto_start_now().await;

    assert_never_asked("a legacy computer", &events.states());
    assert_never_asked("a legacy computer after a relaunch", &events2.states());

    // The upgrade is gated on a COMPLETED reconcile pass, which is what makes the replacement
    // snapshot one a new computer can safely apply this computer's tail on top of. The pass is one
    // bounded chunk per cycle (story 22), so it takes a chunk per travelling table and phase.
    for _ in 0..RECONCILE_CHUNK_BUDGET {
        a2.tick().await;
    }

    let pointer = LatestSnapshot::parse(&cloud.stored(SNAP_LATEST_KEY).expect("a pointer"))
        .expect("the pointer parses");
    assert!(
        pointer.carries_identities,
        "a joined computer must replace an identity-less snapshot, or no new computer can link"
    );

    let (mut b, probe_b, mut events_b) = computer("B", Arc::clone(&cloud), NOW_MS + 900_000);
    b.auto_start_now().await;

    let mut on_b = probe_b.rows();
    on_b.sort();
    assert_eq!(
        on_b,
        vec!["legacy-one".to_string(), "legacy-two".to_string()],
        "a computer that bootstraps after the upgrade holds each row exactly once"
    );
    b.tick().await;
    assert_eq!(probe_b.rows().len(), 2, "applying the tail may not duplicate a row");
    assert_never_asked("B", &events_b.states());
}

#[tokio::test(start_paused = true)]
async fn a_new_computer_refuses_to_bootstrap_from_an_identity_less_snapshot() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, _probe_a, _ea) = computer("A", Arc::clone(&cloud), NOW_MS);
    a.auto_start_now().await;
    seed_milestone_one_pointer(&cloud, &"a".repeat(64));

    let (mut b, probe_b, mut events_b) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);
    b.auto_start_now().await;

    assert!(
        !joined(&probe_b),
        "waiting is the only answer that cannot duplicate every row the tail re-creates"
    );
    assert_never_asked("B", &events_b.states());
    assert_eq!(
        b.status().state,
        SyncState::Unlinked,
        "and it is quiet while it waits"
    );
}

// ------------------------------------------------------------------------------------------
// 4. An account without the capability sees, does and costs nothing (AD-14).
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn an_account_without_the_capability_is_a_silent_no_op_until_it_gains_it() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, mut events) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.set_entitled(false);
    probe_a.write_captured("local-only-work");

    a.auto_start_now().await;
    a.tick().await;
    a.tick().await;

    assert_eq!(cloud.calls(), 0, "the gate refuses before any request is made");
    assert_eq!(a.status().state, SyncState::Unlinked);
    assert_eq!(a.status().error_code.as_deref(), Some("not_entitled"));
    assert_eq!(a.status().prompt, None);
    assert!(!joined(&probe_a));
    for state in events.states() {
        assert_eq!(
            state,
            SyncState::Unlinked,
            "an account without sync carries no sync chrome at all"
        );
    }

    probe_a.set_entitled(true);
    a.tick().await;

    assert!(
        joined(&probe_a),
        "an account that gains the capability joins without a restart"
    );
    assert!(cloud.stored(SNAP_LATEST_KEY).is_some());
}

// ------------------------------------------------------------------------------------------
// 5. Self-healing: a transient fault at launch is retried, not left until the next launch.
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_join_that_could_not_run_at_launch_starts_by_itself_once_the_network_is_back() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _events) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.write_captured("offline-work");

    cloud.fail_next(
        FakeOp::Get,
        StoreError::Transport {
            operation: StoreOp::Get,
            status: None,
            code: None,
            retryable: true,
        },
    );

    a.auto_start_now().await;
    assert!(!joined(&probe_a), "the launch attempt could not reach the cloud");
    assert_eq!(a.status().state, SyncState::Offline, "and says so, without failing");

    tokio::time::advance(Duration::from_secs(600)).await;
    a.tick().await;

    assert!(
        joined(&probe_a),
        "the join is retried from the tick, so no app restart is needed"
    );
    assert_eq!(a.status().state, SyncState::Idle);
}

/// The refusals that must never become an error indicator: there is nothing to report and nothing
/// the user can do but sign in or upgrade, which the settings screen explains from the code.
#[test]
fn only_the_refusals_the_user_cannot_act_on_are_silent() {
    use crate::sync::auth::AuthError;
    use crate::sync::gate::SyncBlocked;
    use crate::sync::manager::SyncFault;

    for quiet in [
        SyncFault::Auth(AuthError::SignedOut),
        SyncFault::Blocked(SyncBlocked::CapabilityMissing {
            capability: crate::entitlements::MULTI_DEVICE_SYNC,
        }),
        SyncFault::Blocked(SyncBlocked::LocalOnlyDataset),
    ] {
        assert!(
            crate::sync::manager::quiet_for_auto_join(&quiet),
            "{} must not surface as a failure",
            quiet.code()
        );
    }

    for loud in [
        SyncFault::Store(StoreError::Forbidden),
        SyncFault::OwnerMismatch,
        SyncFault::Blocked(SyncBlocked::Frozen {
            reason: crate::db::sync_state::FrozenReason::EntitlementLapsed,
        }),
    ] {
        assert!(
            !crate::sync::manager::quiet_for_auto_join(&loud),
            "{} is something the user has to be able to see",
            loud.code()
        );
    }
}

// ------------------------------------------------------------------------------------------
// 6. The switch is durable (E).
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn turning_sync_off_survives_a_relaunch_and_turning_it_on_joins_again() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _events) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.write_captured("mine");

    a.auto_start_now().await;
    assert!(joined(&probe_a));

    a.disable(true).await;
    assert!(opted_out(&probe_a), "the switch is stored in the dataset");
    assert!(a.status().paused);

    let (mut a2, _e2) = relaunched(&probe_a, NOW_MS + 600_000);
    let before = cloud.calls();
    a2.auto_start_now().await;
    a2.tick().await;

    assert_eq!(
        cloud.calls(),
        before,
        "a dataset the user switched off makes no request on the next launch either"
    );
    assert!(a2.status().paused);

    a2.enable(None).await.expect("turning it back on joins");
    assert!(!opted_out(&probe_a), "turning it on clears the switch");
    assert!(!a2.status().paused);
    assert_eq!(a2.status().state, SyncState::Idle);
}

/// A teardown is not a decision: a dataset switch, a sign-out and a process exit all disable the
/// actor, and none of them may leave the user opted out.
#[tokio::test(start_paused = true)]
async fn a_teardown_never_writes_the_users_switch() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _events) = computer("A", Arc::clone(&cloud), NOW_MS);
    a.auto_start_now().await;

    a.disable(false).await;

    assert!(!opted_out(&probe_a));
    assert!(joined(&probe_a), "and it is still a joined dataset");
}

// ------------------------------------------------------------------------------------------
// 7. The one remaining question (D).
// ------------------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn only_two_independent_histories_are_still_asked_about() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _ea) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.write_captured("from-the-cloud");
    a.auto_start_now().await;

    let (mut b, probe_b, mut events_b) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);
    probe_b.write_captured("my-own-history");

    b.auto_start_now().await;

    assert_eq!(b.status().state, SyncState::LinkChoiceRequired);
    assert!(
        matches!(b.status().prompt, Some(crate::sync::manager::SyncPrompt::LinkChoice { .. })),
        "two histories that share no row identities is the one case the user must settle"
    );
    assert!(!joined(&probe_b), "an unanswered question joins nothing");

    // "Decide later" is the dialog being dismissed: nothing is answered and nothing is marked.
    let before = cloud.calls();
    b.tick().await;
    b.tick().await;
    assert_eq!(cloud.calls(), before, "sync stays paused while the question is open");
    assert!(!joined(&probe_b));

    // A relaunch re-asks, and still marks nothing.
    let (mut b2, _e2) = relaunched(&probe_b, NOW_MS + 600_000);
    b2.auto_start_now().await;
    assert_eq!(b2.status().state, SyncState::LinkChoiceRequired);
    assert!(!joined(&probe_b));

    assert!(events_b.states().contains(&SyncState::LinkChoiceRequired));
}

#[tokio::test(start_paused = true)]
async fn answering_replace_joins_and_keeps_a_dated_backup() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _ea) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.write_captured("from-the-cloud");
    a.auto_start_now().await;

    let (mut b, probe_b, _eb) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);
    probe_b.write_captured("my-own-history");
    b.auto_start_now().await;

    b.enable(Some(LinkChoice::Replace))
        .await
        .expect("replace completes");

    assert!(joined(&probe_b), "an answered question completes the join");
    assert!(
        probe_b.rows().contains(&"from-the-cloud".to_string()),
        "and loads the cloud copy: {:?}",
        probe_b.rows()
    );
    assert_eq!(
        probe_b.dated_backups().len(),
        1,
        "nothing is displaced without a dated copy (CAP-5)"
    );
    assert_eq!(b.status().state, SyncState::Idle);
}

#[tokio::test(start_paused = true)]
async fn answering_separate_leaves_the_kept_dataset_unsynced_and_unasked() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut a, probe_a, _ea) = computer("A", Arc::clone(&cloud), NOW_MS);
    probe_a.write_captured("from-the-cloud");
    a.auto_start_now().await;

    let (mut b, probe_b, _eb) = computer("B", Arc::clone(&cloud), NOW_MS + 60_000);
    crate::datasets::bootstrap_registry_at(probe_b.root()).expect("the registry exists");
    probe_b.write_captured("my-own-history");
    b.auto_start_now().await;

    let outcome = b
        .enable(Some(LinkChoice::Separate))
        .await
        .expect("separate completes");
    assert!(matches!(
        outcome,
        SyncEnableOutcome::SeparateProfileCreated { .. }
    ));

    assert_eq!(
        probe_b.rows(),
        vec!["my-own-history".to_string()],
        "the kept dataset is left exactly as it was"
    );
    assert!(!joined(&probe_b));
    assert!(
        opted_out(&probe_b),
        "the kept dataset is deliberately unsynced, so the automatic join must not re-ask it"
    );

    let before = cloud.calls();
    b.tick().await;
    b.tick().await;
    assert_eq!(cloud.calls(), before);
    assert_eq!(b.status().state, SyncState::Unlinked);
}

// ------------------------------------------------------------------------------------------
// 8. The join marker and the switch travel with a restore, not with a snapshot.
// ------------------------------------------------------------------------------------------

#[test]
fn the_join_marker_and_the_switch_are_this_computers_own_state() {
    assert!(
        crate::db::snapshot_strip::STRIPPED_SYNC_TABLES.contains(&"sync_state"),
        "a snapshot that carried another computer's join marker would link it by accident"
    );
    assert!(
        crate::db::danger_zone::WIPE_TABLES.contains(&"sync_state"),
        "AD-15: deleting the row IS the unlinked state"
    );
}

