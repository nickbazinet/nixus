//! Behaviour tests for the sync actor (Story 10), driven through `SyncActor` directly so
//! every rule is asserted under virtual time instead of waited for.
//!
//! The mailbox and its thread are exercised once, at the bottom, by the test that proves a
//! stop really stops: everything else is a property of the actor, not of the channel.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;

use crate::db::sync_state::FrozenReason;
use crate::sync::bootstrap::LinkChoice;
use crate::sync::manager::{
    self, RemoteChoice, SyncActor, SyncEnableOutcome, SyncFault, SyncState, SyncStatusPayload,
    SyncTuning,
};
use crate::sync::snapshot::SNAP_LATEST_KEY;
use crate::sync::store::{StoreError, StoreOp};
use crate::sync::test_support::{test_computer, ComputerProbe, FakeOp, FakeObjectStore, TestComputer};

const SETTLE: Duration = Duration::from_secs(5);
const MIN_UPLOAD: Duration = Duration::from_secs(60);

fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: SETTLE,
        min_upload_interval: MIN_UPLOAD,
        initial_backoff: Duration::from_secs(10),
        // The Story-19 log protocol is OFF in this fixture, deliberately: these tests count
        // requests to pin the SNAPSHOT debounce, and a conditional roster poll in the middle of
        // one would be counted as an upload. `tests_segment.rs` is where the log cycle is driven.
        remote_poll_interval: Duration::from_secs(86_400),
        segment_interval: Duration::from_secs(86_400),
        max_backoff: Duration::from_secs(120),
    }
}

type Actor = SyncActor<TestComputer>;

fn actor_for(
    host: TestComputer,
) -> (Actor, UnboundedReceiver<SyncStatusPayload>) {
    let (actor, _status, events) = SyncActor::new(host, tuning());

    (actor, events)
}

/// One computer, one shared fake cloud.
fn one_computer() -> (Actor, ComputerProbe, UnboundedReceiver<SyncStatusPayload>) {
    let store = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", store, 1_700_000_000_000);
    let (actor, events) = actor_for(host);

    (actor, probe, events)
}

fn states(events: &mut UnboundedReceiver<SyncStatusPayload>) -> Vec<SyncState> {
    let mut seen = Vec::new();
    while let Ok(payload) = events.try_recv() {
        seen.push(payload.state);
    }

    seen
}

/// A local edit, then the two polls it takes to publish it: the first notices the changed
/// `data_version` and starts the settle window, the second finds it elapsed and uploads.
/// Driving both is the point — a single tick uploading immediately would mean no debounce.
async fn edit_then_settle(actor: &mut Actor, probe: &ComputerProbe, name: &str) {
    probe.write_row(name);
    actor.tick().await;
    tokio::time::advance(SETTLE + MIN_UPLOAD).await;
    actor.tick().await;
}

fn offline_fault() -> StoreError {
    StoreError::Transport {
        operation: StoreOp::PutImmutable,
        status: None,
        code: None,
        retryable: true,
    }
}

#[tokio::test(start_paused = true)]
async fn enabling_on_a_new_account_writes_the_owner_object_and_the_first_snapshot() {
    let (mut actor, probe, mut events) = one_computer();
    probe.write_row("groceries");

    let outcome = actor.enable(None).await.expect("the first enable succeeds");

    assert!(matches!(outcome, SyncEnableOutcome::Enabled { .. }));
    assert!(probe.store().stored("owner").is_some(), "AD-7 owner binding");
    assert!(probe.store().stored(SNAP_LATEST_KEY).is_some());
    assert_eq!(actor.diagnostics().uploads, 1);
    // The first publish of a new account is create-only: there is no LATEST to match.
    assert_eq!(probe.store().calls_of(FakeOp::PutIfAbsent), 2);
    assert_eq!(probe.store().calls_of(FakeOp::PutIfMatch), 0);
    assert_eq!(states(&mut events), vec![SyncState::Syncing, SyncState::Idle]);
}

#[tokio::test(start_paused = true)]
async fn nothing_is_uploaded_until_the_edits_have_settled() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    let after_enable = probe.store().calls();

    probe.write_row("one");
    actor.tick().await;
    tokio::time::advance(SETTLE - Duration::from_millis(1)).await;
    actor.tick().await;

    assert_eq!(
        probe.store().calls(),
        after_enable,
        "an upload before the settle window would defeat the debounce"
    );
    assert_eq!(actor.diagnostics().uploads, 1);
}

#[tokio::test(start_paused = true)]
async fn a_burst_of_edits_coalesces_into_exactly_one_upload() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    // Past the floor between uploads, so the only thing under test is the settle window.
    tokio::time::advance(MIN_UPLOAD).await;

    for (index, name) in ["one", "two", "three", "four"].iter().enumerate() {
        probe.write_row(name);
        actor.tick().await;
        if index < 3 {
            tokio::time::advance(SETTLE / 2).await;
        }
    }

    tokio::time::advance(SETTLE).await;
    actor.tick().await;

    assert_eq!(
        actor.diagnostics().uploads,
        2,
        "the first enable plus one upload for the whole burst"
    );
}

#[tokio::test(start_paused = true)]
async fn the_minimum_interval_holds_back_a_settled_change() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");

    probe.write_row("one");
    tokio::time::advance(SETTLE).await;
    actor.tick().await;
    assert_eq!(actor.diagnostics().uploads, 1, "held by the minimum interval");

    tokio::time::advance(MIN_UPLOAD).await;
    actor.tick().await;
    assert_eq!(actor.diagnostics().uploads, 2);
}

#[tokio::test(start_paused = true)]
async fn the_second_upload_compares_and_swaps_against_the_latest_it_published() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    let published = probe
        .store()
        .etag_of(SNAP_LATEST_KEY)
        .expect("LATEST was published");

    edit_then_settle(&mut actor, &probe, "one").await;

    assert_eq!(actor.diagnostics().uploads, 2);
    assert_eq!(
        probe.store().calls_of(FakeOp::PutIfMatch),
        1,
        "the update of a LATEST this computer has seen is an If-Match, never a blind put"
    );
    assert_ne!(
        probe
            .store()
            .etag_of(SNAP_LATEST_KEY)
            .expect("LATEST still exists"),
        published,
        "a successful compare-and-swap moves the pointer"
    );
}

#[tokio::test(start_paused = true)]
async fn a_latest_that_moved_elsewhere_is_never_overwritten() {
    let (mut actor, probe, mut events) = one_computer();
    actor.enable(None).await.expect("enable");
    let mine = probe.store().stored(SNAP_LATEST_KEY).expect("my LATEST");
    let _ = states(&mut events);

    // Another computer publishes, which both moves the pointer and changes its ETag.
    let theirs = br#"{"created_ms":1800000000000,"hash":"ab","schema_version":30,"snap_id":"0000000000000000000000000000000000000000000000000000000000000000","v":1}"#;
    probe.store().seed(SNAP_LATEST_KEY, theirs.to_vec());

    edit_then_settle(&mut actor, &probe, "one").await;

    let status = actor.status();
    assert_eq!(status.state, SyncState::RemoteChanged);
    assert!(status.prompt.is_some(), "the user is offered the choice");
    assert_eq!(actor.diagnostics().conflicts, 1);
    assert_eq!(
        probe.store().stored(SNAP_LATEST_KEY).as_deref(),
        Some(theirs.as_slice()),
        "their pointer is still theirs, byte for byte"
    );
    assert_ne!(probe.store().stored(SNAP_LATEST_KEY), Some(mine));
    assert!(states(&mut events).contains(&SyncState::RemoteChanged));
}

#[tokio::test(start_paused = true)]
async fn a_pending_prompt_stops_the_poll_from_uploading_behind_the_user() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    probe.store().seed(
        SNAP_LATEST_KEY,
        br#"{"created_ms":1,"hash":"ab","schema_version":30,"snap_id":"0000000000000000000000000000000000000000000000000000000000000000","v":1}"#.to_vec(),
    );

    edit_then_settle(&mut actor, &probe, "one").await;
    let after_conflict = probe.store().calls();

    edit_then_settle(&mut actor, &probe, "two").await;

    assert_eq!(
        probe.store().calls(),
        after_conflict,
        "an unanswered prompt must not be resolved by a later tick"
    );
}

#[tokio::test(start_paused = true)]
async fn keeping_local_adopts_their_pointer_so_the_next_upload_publishes() {
    let (mut actor, probe, _events) = one_computer();
    probe.write_row("mine");
    actor.enable(None).await.expect("enable");

    // Their snapshot object has to exist for the pointer to be honest, so publish it from
    // a second computer against the same fake cloud. B bootstraps first (empty, so no
    // question is asked), then edits and publishes — which is what moves LATEST.
    let (second, second_probe) = {
        let store = Arc::clone(probe.store());
        test_computer("B", store, 1_800_000_000_000)
    };
    let (mut other, _other_events) = actor_for(second);
    other.enable(None).await.expect("B bootstraps");
    second_probe.write_row("theirs");
    other.sync_now().await.expect("B publishes");

    edit_then_settle(&mut actor, &probe, "mine-again").await;
    assert_eq!(actor.status().state, SyncState::RemoteChanged);

    actor
        .resolve_remote(RemoteChoice::KeepLocal)
        .await
        .expect("keeping local always succeeds");

    assert_eq!(actor.status().state, SyncState::Idle);
    assert!(actor.status().prompt.is_none());
    assert!(
        probe.dated_backups().is_empty(),
        "keeping local displaces nothing, so nothing is backed up"
    );

    actor.tick().await;
    tokio::time::advance(SETTLE).await;
    actor.tick().await;

    assert_eq!(
        actor.status().state,
        SyncState::Idle,
        "the adopted ETag makes the next compare-and-swap succeed"
    );
    assert_eq!(actor.diagnostics().uploads, 2);
    assert_eq!(actor.diagnostics().conflicts, 1);
}

#[tokio::test(start_paused = true)]
async fn loading_the_remote_copy_keeps_the_local_file_as_a_dated_backup() {
    let store = Arc::new(FakeObjectStore::default());
    let (first, probe) = test_computer("A", Arc::clone(&store), 1_700_000_000_000);
    let (second, second_probe) = test_computer("B", store, 1_800_000_000_000);

    let (mut actor, _events) = actor_for(first);
    let (mut other, _other_events) = actor_for(second);

    probe.write_row("only-on-a");
    actor.enable(None).await.expect("A enables");

    // B restores A's snapshot, edits, and publishes — so the cloud is ahead of A.
    other.enable(None).await.expect("B bootstraps");
    second_probe.write_row("only-on-b");
    other.sync_now().await.expect("B publishes");

    probe.write_row("later-on-a");
    actor.sync_now().await.expect("A's attempt is not an error");
    assert_eq!(actor.status().state, SyncState::RemoteChanged);

    actor
        .resolve_remote(RemoteChoice::LoadRemote)
        .await
        .expect("loading the cloud copy succeeds");

    assert_eq!(actor.status().state, SyncState::Idle);
    assert_eq!(
        probe.dated_backups().len(),
        1,
        "CAP-5: the displaced file is kept"
    );
    let rows = probe.rows();
    assert!(rows.contains(&"only-on-b".to_string()), "B's edit arrived");
    assert!(
        !rows.contains(&"later-on-a".to_string()),
        "the cloud copy replaced the local one"
    );
    assert_eq!(actor.diagnostics().restores, 1);
}

#[tokio::test(start_paused = true)]
async fn a_frozen_dataset_transfers_nothing_and_local_writes_still_work() {
    let (mut actor, probe, _events) = one_computer();
    probe.write_row("before");
    actor.enable(None).await.expect("enable while entitled");
    let before_freeze = probe.store().calls();

    probe.set_entitled(false);
    edit_then_settle(&mut actor, &probe, "during").await;

    assert_eq!(actor.status().state, SyncState::Frozen);
    assert_eq!(
        probe.store().calls(),
        before_freeze,
        "AD-14: a Frozen account transfers nothing at all"
    );
    assert_eq!(
        probe.rows(),
        vec!["before".to_string(), "during".to_string()],
        "the local app is unaffected"
    );
    assert_eq!(
        actor.diagnostics().frozen_reason,
        Some(FrozenReason::EntitlementLapsed.code())
    );

    probe.set_entitled(true);
    actor.tick().await;
    tokio::time::advance(SETTLE + MIN_UPLOAD).await;
    actor.tick().await;

    assert_eq!(
        actor.status().state,
        SyncState::Idle,
        "regaining the capability resumes sync"
    );
    assert!(probe.store().calls() > before_freeze);
}

#[tokio::test(start_paused = true)]
async fn a_local_only_dataset_reaches_neither_the_store_nor_a_credential() {
    let store = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", Arc::clone(&store), 1);
    let (mut actor, _events) = actor_for(host.local_only());

    let fault = actor.enable(None).await.expect_err("a local profile cannot sync");

    assert_eq!(fault.code(), "local_only");
    assert_eq!(actor.status().state, SyncState::Unlinked);
    assert_eq!(probe.store().calls(), 0);
    assert_eq!(actor.diagnostics().uploads, 0);

    edit_then_settle(&mut actor, &probe, "local").await;

    assert_eq!(probe.store().calls(), 0, "and no tick ever changes that");
}

#[tokio::test(start_paused = true)]
async fn an_offline_fault_backs_off_instead_of_retrying_every_tick() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");

    probe.store().fail_next(FakeOp::PutImmutable, offline_fault());
    edit_then_settle(&mut actor, &probe, "one").await;

    assert_eq!(actor.status().state, SyncState::Offline);
    let diagnostics = actor.diagnostics();
    assert_eq!(diagnostics.last_error_code.as_deref(), Some("offline"));
    assert!(diagnostics.backoff_ms.is_some_and(|ms| ms > 0));
    let during_backoff = probe.store().calls();

    actor.tick().await;
    assert_eq!(
        probe.store().calls(),
        during_backoff,
        "a tick inside the backoff window must send nothing"
    );

    tokio::time::advance(Duration::from_secs(120)).await;
    actor.tick().await;

    assert_eq!(actor.status().state, SyncState::Idle);
    assert!(probe.store().calls() > during_backoff);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_cloud_at_enable_is_a_status_and_never_an_empty_dataset() {
    let (mut actor, probe, mut events) = one_computer();
    probe.write_row("mine");
    probe.store().fail_next(FakeOp::Get, offline_fault());

    let fault = actor.enable(None).await.expect_err("the owner read fails");

    assert_eq!(fault.code(), "offline");
    assert!(fault.retryable());
    assert_eq!(actor.status().state, SyncState::Offline);
    assert_eq!(
        probe.rows(),
        vec!["mine".to_string()],
        "a failed enable touches no local data"
    );
    assert_eq!(states(&mut events), vec![SyncState::Syncing, SyncState::Offline]);
}

#[tokio::test(start_paused = true)]
async fn a_dataset_that_already_has_data_asks_before_anything_is_displaced() {
    let store = Arc::new(FakeObjectStore::default());
    let (first, first_probe) = test_computer("A", Arc::clone(&store), 1_700_000_000_000);
    let (second, second_probe) = test_computer("B", store, 1_800_000_000_000);

    let (mut actor, _events) = actor_for(first);
    first_probe.write_row("from-a");
    actor.enable(None).await.expect("A enables");

    let (mut other, _other_events) = actor_for(second);
    second_probe.write_row("from-b");

    let outcome = other.enable(None).await.expect("the choice is not a fault");

    match outcome {
        SyncEnableOutcome::LinkChoiceRequired { local_rows, .. } => assert_eq!(local_rows, 1),
        other => panic!("expected CAP-5's choice, got {other:?}"),
    }
    assert_eq!(other.status().state, SyncState::LinkChoiceRequired);
    assert_eq!(
        second_probe.rows(),
        vec!["from-b".to_string()],
        "nothing is displaced before the user answers"
    );
    assert!(second_probe.dated_backups().is_empty());

    other
        .enable(Some(LinkChoice::Replace))
        .await
        .expect("replace succeeds");

    assert_eq!(other.status().state, SyncState::Idle);
    assert_eq!(second_probe.rows(), vec!["from-a".to_string()]);
    assert_eq!(second_probe.dated_backups().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn sync_now_on_a_profile_that_is_not_enabled_is_a_typed_refusal() {
    let (mut actor, probe, _events) = one_computer();

    let fault = actor.sync_now().await.expect_err("nothing to sync yet");

    assert_eq!(fault.code(), "not_enabled");
    assert_eq!(probe.store().calls(), 0);
}

#[tokio::test(start_paused = true)]
async fn answering_a_prompt_that_does_not_exist_is_refused_without_a_transfer() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    let before = probe.store().calls();

    let fault = actor
        .resolve_remote(RemoteChoice::LoadRemote)
        .await
        .expect_err("there is no conflict to resolve");

    assert_eq!(fault.code(), "no_pending_prompt");
    assert_eq!(probe.store().calls(), before);
}

#[tokio::test(start_paused = true)]
async fn disabling_stops_the_poll_and_releases_the_dataset() {
    let (mut actor, probe, _events) = one_computer();
    actor.enable(None).await.expect("enable");
    let while_enabled = probe.store().calls();

    actor.disable().await;

    assert_eq!(actor.status().state, SyncState::Unlinked);
    assert!(!actor.status().enabled);

    edit_then_settle(&mut actor, &probe, "after").await;

    assert_eq!(probe.store().calls(), while_enabled);
    assert_eq!(
        probe.rows(),
        vec!["after".to_string()],
        "a disabled profile is still a working app"
    );
}

#[tokio::test(start_paused = true)]
async fn diagnostics_carry_counts_and_codes_but_no_value_from_the_dataset() {
    let (mut actor, probe, _events) = one_computer();
    let sentinels = [
        "SENTINEL-GROCERIES-4f2a",
        "SENTINEL-RENT-9b31",
        "SENTINEL-SALARY-c7d0",
    ];
    for sentinel in sentinels {
        probe.write_row(sentinel);
    }
    actor.enable(None).await.expect("enable");

    let diagnostics = actor.diagnostics();
    let serialized = serde_json::to_string(&diagnostics).expect("diagnostics serialize");

    for sentinel in sentinels {
        assert!(
            !serialized.contains(sentinel),
            "AD-16: {sentinel} must never leave the backend in diagnostics"
        );
    }
    assert_eq!(diagnostics.local_rows, Some(3), "counts are fine, values are not");
    assert_eq!(diagnostics.capability, "multi_device_sync");
    assert_eq!(diagnostics.uploads, 1);
    assert!(diagnostics.last_object_bytes.is_some_and(|bytes| bytes > 0));
}

#[tokio::test(start_paused = true)]
async fn the_status_payload_names_the_state_the_frontend_switches_on() {
    let (actor, _probe, _events) = one_computer();

    let serialized = serde_json::to_string(&actor.status()).expect("the payload serializes");

    assert!(serialized.contains(r#""state":"unlinked""#));
    assert!(serialized.contains(r#""dataset_id":"A""#));
    assert!(serialized.contains(r#""enabled":false"#));
}

/// The two-computer harness Story 12 and the final Milestone-1 proof build on: two
/// independent app-data directories, one shared cloud, no network and no Tauri app.
#[tokio::test(start_paused = true)]
async fn two_computers_one_account_end_to_end() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (first, a) = test_computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    let (second, b) = test_computer("B", Arc::clone(&cloud), 1_800_000_000_000);

    let (mut computer_a, _a_events) = actor_for(first);
    let (mut computer_b, _b_events) = actor_for(second);

    // 1. A enables with a small synthetic dataset and becomes the source of truth.
    a.write_row("from-a");
    computer_a.enable(None).await.expect("A enables");
    assert_eq!(computer_a.status().state, SyncState::Idle);

    // 2. B is a brand-new computer: empty, so it bootstraps with no question asked.
    let outcome = computer_b.enable(None).await.expect("B bootstraps");
    assert!(matches!(outcome, SyncEnableOutcome::Enabled { .. }));
    assert_eq!(
        b.rows(),
        vec!["from-a".to_string()],
        "A's data arrived on B through the snapshot"
    );

    // 3. B edits and publishes, so the cloud moves past what A last saw.
    edit_then_settle(&mut computer_b, &b, "from-b").await;
    assert_eq!(computer_b.status().state, SyncState::Idle);
    assert_eq!(computer_b.diagnostics().uploads, 1);

    // 4. A tries to publish and finds the cloud changed elsewhere. Nothing is overwritten.
    a.write_row("from-a-again");
    computer_a.sync_now().await.expect("A's attempt is not a fault");

    assert_eq!(computer_a.status().state, SyncState::RemoteChanged);
    assert_eq!(computer_a.diagnostics().conflicts, 1);
    assert!(computer_a.status().prompt.is_some());

    // 5. A loads the cloud copy and keeps its own file as a dated backup.
    computer_a
        .resolve_remote(RemoteChoice::LoadRemote)
        .await
        .expect("A loads the cloud copy");

    assert_eq!(computer_a.status().state, SyncState::Idle);
    assert_eq!(a.dated_backups().len(), 1);
    assert_eq!(a.rows(), vec!["from-a".to_string(), "from-b".to_string()]);
}

/// The only test that goes through the real mailbox and the real thread: it is what proves
/// `spawn` returns before any work happens and that a stop really stops.
#[tokio::test]
async fn the_spawned_actor_answers_immediately_and_stops_on_request() {
    let store = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", store, 1_700_000_000_000);
    probe.write_row("mine");

    let (handle, mut events) = manager::spawn(host, tuning()).expect("the actor thread starts");

    assert_eq!(handle.dataset_id(), "A");
    assert_eq!(
        handle.status().state,
        SyncState::Unlinked,
        "a status is readable before any network or database work"
    );

    handle.enable(None).await.expect("enable through the mailbox");
    assert_eq!(handle.status().state, SyncState::Idle);
    assert!(handle.diagnostics().await.expect("diagnostics").uploads >= 1);

    handle.stop();

    let stopped = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if handle.diagnostics().await.is_err() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert_eq!(stopped, Ok(true), "a stopped actor answers nothing");

    assert!(
        handle.enable(None).await.is_err(),
        "and cannot be re-enabled without being restarted"
    );
    // The event stream ends with the actor, which is the emitter task's stop signal.
    let mut saw_idle = false;
    while let Some(payload) = events.recv().await {
        saw_idle |= payload.state == SyncState::Idle;
    }
    assert!(saw_idle, "the sync:status stream carried the transitions");
}

/// A fault the actor cannot recover from must still leave a readable status rather than a
/// panic in a thread nobody is awaiting.
#[tokio::test(start_paused = true)]
async fn a_wrong_account_is_recorded_so_it_is_not_retried_forever() {
    let (mut actor, probe, _events) = one_computer();
    // Another account already owns the prefix (AD-7).
    probe.store().seed(
        "owner",
        br#"{"created_ms":1,"identity_id":"us-east-1:0000","sub":"somebody-else","v":1}"#.to_vec(),
    );

    let fault = actor.enable(None).await.expect_err("a foreign owner refuses");

    assert_eq!(fault.code(), "owner_mismatch");
    assert!(!fault.recoverable());
    assert_eq!(actor.status().state, SyncState::Error);
    assert_eq!(
        probe.frozen_reason(),
        Some(FrozenReason::OwnerMismatch),
        "AD-7: the refusal is persisted, not re-attempted on every tick"
    );
    assert!(probe.store().stored(SNAP_LATEST_KEY).is_none());
}

#[test]
fn every_fault_has_a_code_and_a_message_and_neither_is_empty() {
    let faults = [
        SyncFault::NotEnabled,
        SyncFault::NoPendingPrompt,
        SyncFault::ActorUnavailable,
        SyncFault::OwnerMismatch,
        SyncFault::Registry,
        SyncFault::StateUnavailable,
        SyncFault::Swap { rolled_back: true },
        SyncFault::UpdateNeeded {
            found: 99,
            supported: 30,
        },
        SyncFault::Store(StoreError::NotFound),
        SyncFault::Store(offline_fault()),
    ];

    for fault in faults {
        assert!(!fault.code().is_empty(), "{fault:?} has no code");
        assert!(!fault.message().is_empty(), "{fault:?} has no message");
        let error: crate::error::AppError = fault.clone().into();
        let serialized = serde_json::to_string(&error).expect("AppError::Sync serializes");
        assert!(serialized.contains(r#""type":"sync""#));
        assert!(serialized.contains(fault.code()));
    }
}
