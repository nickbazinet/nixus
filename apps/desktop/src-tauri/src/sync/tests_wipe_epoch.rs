//! Story wipe-epoch: "delete everything" as an account-wide EVENT, proven end to end.
//!
//! Real files, the real capture hook, real segments, the real apply path and the production
//! `SyncActor` over a shared in-process `FakeObjectStore` — the same harness and the same honesty
//! caveat as `tests_m2_e2e.rs`: everything is real except the cloud, which is a fake with AD-6's
//! conditional-write semantics because there is no S3 to point at in CI.
//!
//! What every test here is about is the one bug the story exists to fix. Before it, a wipe of a
//! cloud-synced dataset deleted the rows, deleted `sync_state` (AD-15) and left the cloud alone —
//! so the next join restored `snap/LATEST`, replayed the other installs' log, and handed the user
//! back everything they had just erased.

use std::sync::Arc;
use std::time::Duration;

use crate::db::capture_fixtures as fixtures;
use crate::db::{danger_zone, sync_state, sync_wipe};
use crate::sync::manager::{SyncActor, SyncEnableOutcome, SyncFault, SyncTuning};
use crate::sync::snapshot::{self, LatestSnapshot};
use crate::sync::store::{StoreError, StoreOp};
use crate::sync::test_support::{
    syncing_fake, test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer,
};
use crate::sync::wipe::{self, WipeEvent, WIPE_OBJECT_KEY};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

/// Every interval collapsed, so one `tick()` is one whole cycle and the scenario — not the wall
/// clock — is what is under test. The intervals themselves are proven in `tests_segment.rs`.
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        remote_poll_interval: Duration::ZERO,
        // Collapsed like the rest: these scenarios are about NOTICING a wipe, and the absence
        // floor exists only to stop a never-wiped account paying for a probe it does not need.
        wipe_absence_recheck: Duration::ZERO,
        segment_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        reconcile_interval: Duration::from_secs(86_400),
        tombstone_purge_interval: Duration::from_secs(86_400),
        ..SyncTuning::default()
    }
}

fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

/// The same computer after the process restarted: a brand-new actor over the same dataset file.
///
/// This is what the production wipe really produces — `delete_all_data` stops the actor and
/// `start_for_active_dataset` spawns a fresh one — so every scenario below drives the registration
/// through a relaunched actor rather than through the one that happened to be running.
fn relaunch(probe: &ComputerProbe, clock: i64) -> Actor {
    let (actor, _status, _events) = SyncActor::new(probe.relaunch(clock, true), tuning());

    actor
}

/// "Delete everything" exactly as `commands::danger_zone::delete_all_data` performs it locally:
/// the install id read BEFORE the wipe, then the deletes and the pending marker in ONE uncaptured
/// transaction, and nothing touched in the cloud.
fn delete_everything(probe: &ComputerProbe) -> u64 {
    probe.with_active(|active| {
        let joined_install = {
            let conn = active.conn.as_ref().expect("a live connection");
            sync_state::load(conn)
                .expect("the state reads")
                .filter(sync_state::SyncState::joined)
                .map(|state| state.install_id)
        };
        assert!(
            joined_install.is_some(),
            "this computer has not joined, so the wipe would register no event at all and the \
             test would prove nothing"
        );

        active
            .write_uncaptured(|conn| {
                let deleted = danger_zone::wipe_all(conn)?;
                if let Some(install) = &joined_install {
                    sync_wipe::set_pending_wipe(conn, install)?;
                }

                Ok(deleted)
            })
            .expect("the wipe succeeds")
    })
}

fn local_epoch(probe: &ComputerProbe) -> u64 {
    probe.read(|conn| sync_wipe::local_epoch(conn).expect("the epoch reads"))
}

fn pending(probe: &ComputerProbe) -> Option<String> {
    probe.read(|conn| sync_wipe::pending_wipe(conn).expect("the marker reads"))
}

/// The account's epoch, read straight out of the fake cloud rather than through a computer.
fn cloud_epoch(cloud: &FakeObjectStore) -> u64 {
    match cloud.stored(WIPE_OBJECT_KEY) {
        None => 0,
        Some(body) => WipeEvent::parse(&body).expect("the marker parses").epoch,
    }
}

fn cloud_pointer(cloud: &FakeObjectStore) -> Option<LatestSnapshot> {
    cloud
        .stored(snapshot::SNAP_LATEST_KEY)
        .map(|body| LatestSnapshot::parse(&body).expect("the pointer parses"))
}

fn groups(probe: &ComputerProbe) -> i64 {
    probe
        .read(fixtures::count_budget_groups)
        .expect("the count reads")
}

fn names(probe: &ComputerProbe) -> Vec<String> {
    probe.read(fixtures::budget_group_names)
}

/// Ticks both computers enough times for one whole exchange to finish in both directions.
///
/// Virtual time is ADVANCED between rounds, which several of these scenarios need rather than
/// merely like: a computer that has just wiped itself — or has just been relaunched — rejoins
/// through `auto_start`, and that is deliberately floored by `auto_join_interval`. Calling `tick`
/// in a loop under paused time never clears the floor, so without this the self-healing rejoin
/// would be invisible and the proofs would be about `enable` being called by hand instead.
async fn settle(first: &mut Actor, second: &mut Actor) {
    for _ in 0..6 {
        tokio::time::advance(Duration::from_secs(60)).await;
        first.tick().await;
        second.tick().await;
    }
}

/// Two computers that have both joined one account and agree on one row.
async fn two_joined(cloud: &Arc<FakeObjectStore>) -> (Actor, ComputerProbe, Actor, ComputerProbe) {
    let (mut first, a) = computer("A", Arc::clone(cloud), NOW_MS);
    let (mut second, b) = computer("B", Arc::clone(cloud), NOW_MS + 1_000);

    a.captured(|tx| fixtures::insert_budget_group(tx, "Before-the-wipe", 0))
        .expect("A's row");
    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second).await;

    assert_eq!(groups(&a), 1, "the fixture must start with a row on A");
    assert_eq!(groups(&b), 1, "and the same row on B");
    assert_eq!(cloud_epoch(cloud), 0, "no wipe has happened yet");

    (first, a, second, b)
}

/// (a) The whole point: A wipes, and nothing it held survives anywhere — not on A, not on the
/// computer that was online when it happened, not on one that joins the account afterwards.
#[tokio::test(start_paused = true)]
async fn a_wipe_on_one_computer_empties_the_other_and_every_computer_after_it() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A rejoins after its wipe");

    assert_eq!(cloud_epoch(&cloud), 1, "the account moved to a new wipe epoch");
    assert_eq!(local_epoch(&a), 1);
    assert_eq!(pending(&a), None, "the event is registered, so nothing is owed");

    // B is online and learns about it on its very next cycle; the ones after that are the ordinary
    // join that follows, which is what makes it an EMPTY computer rather than a stopped one.
    second.tick().await;
    assert_eq!(groups(&b), 0, "B kept rows the user deleted");
    assert_eq!(local_epoch(&b), 1, "B adopted the account's epoch");
    settle(&mut first, &mut second).await;

    let (mut third, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    third.enable(None).await.expect("C joins the wiped account");
    settle(&mut first, &mut third).await;

    for (who, probe) in [("A", &a), ("B", &b), ("C", &c)] {
        assert_eq!(groups(probe), 0, "{who} still holds a pre-wipe row");
        assert!(
            !names(probe).contains(&"Before-the-wipe".to_string()),
            "{who} resurrected the row the user deleted"
        );
    }
}

/// (b) A new computer restores the CURRENT epoch's snapshot and never the one before it, including
/// whatever was entered after the wipe.
#[tokio::test(start_paused = true)]
async fn a_new_computer_restores_only_the_post_wipe_snapshot() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;
    let pre_wipe_snapshot = cloud_pointer(&cloud).expect("A published one").snap_id;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A rejoins");
    a.captured(|tx| fixtures::insert_budget_group(tx, "After-the-wipe", 0))
        .expect("A's post-wipe row");
    second.tick().await;
    let mut second = relaunch(&b, NOW_MS + 150_000);
    settle(&mut first, &mut second).await;

    let pointer = cloud_pointer(&cloud).expect("a post-wipe pointer");
    assert_eq!(pointer.wipe_epoch, 1, "the pointer is stamped with the new epoch");
    assert_ne!(
        pointer.snap_id, pre_wipe_snapshot,
        "the account still points at the snapshot of the deleted data"
    );
    assert!(
        cloud.keys().contains(&format!("snap/{pre_wipe_snapshot}")),
        "the pre-wipe object is NOT deleted — the app holds no permission to delete the user's \
         data (AD-13) and the bucket expires noncurrent versions only, so it is made UNREACHABLE \
         by the epoch rather than erased. Erasing the bytes is a manual request"
    );

    let (mut third, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    third.enable(None).await.expect("C joins");
    settle(&mut first, &mut third).await;

    assert!(
        !names(&c).contains(&"Before-the-wipe".to_string()),
        "C bootstrapped from the pre-wipe snapshot: {:?}",
        names(&c)
    );
    assert!(
        names(&c).contains(&"After-the-wipe".to_string()),
        "C must still receive what was entered after the wipe: {:?}",
        names(&c)
    );
}

/// (c) A computer that was switched off when the wipe happened empties itself the moment it comes
/// back — and crucially, BEFORE it uploads anything of its own.
#[tokio::test(start_paused = true)]
async fn a_computer_that_missed_the_wipe_self_wipes_before_it_uploads_anything() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _offline, b) = two_joined(&cloud).await;

    // B is away, and its own last edit is unsent — which is exactly what must not be published.
    b.captured(|tx| fixtures::insert_budget_group(tx, "B-wrote-this-then-left", 1))
        .expect("B's row");
    assert!(
        b.unshipped() > 0,
        "B must have something owed for this to prove anything"
    );

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A rejoins");

    // Days later, B is switched on. The join itself is where the epoch is compared, so the wipe
    // happens before `resume` could restore anything and before one segment is shipped.
    let mut second = relaunch(&b, NOW_MS + 500_000);
    let outcome = second.enable(None).await.expect("B comes back");

    assert!(matches!(outcome, SyncEnableOutcome::Enabled { .. }));
    assert_eq!(groups(&b), 0, "B kept the deleted rows");
    assert_eq!(local_epoch(&b), 1);
    assert_eq!(
        b.unshipped(),
        0,
        "B's unsent tail went with the wipe; nothing of the deleted dataset is owed"
    );
    assert_eq!(
        cloud_pointer(&cloud).expect("still a pointer").wipe_epoch,
        1,
        "B published a pre-wipe snapshot over the account"
    );
}

/// (d) THE CLOBBER REGRESSION. `LostCas::Adopt` refreshes `known_latest` from the pointer it just
/// lost to, so a computer that had not adopted the wipe would hold a valid `If-Match` token for
/// the post-wipe pointer and could overwrite it with a snapshot of the deleted data.
///
/// Asserted as the OUTCOME rather than the mechanism, because the mechanism is now two independent
/// refusals (the epoch check at the top of the cycle and `upload`'s own fresh read): B is cycled
/// repeatedly and asked for an explicit `sync_now` after the wipe, and the account's pointer must
/// still be a post-wipe one afterwards — proven by a brand-new computer bootstrapping from it.
#[tokio::test(start_paused = true)]
async fn a_stale_computer_cannot_publish_over_the_post_wipe_pointer() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A rejoins");
    assert_eq!(cloud_epoch(&cloud), 1);

    // B still believes in the pre-wipe account: it holds the rows, it holds an ETag for the
    // pointer it last read, and it is about to be asked to publish — twice.
    second.tick().await;
    second.tick().await;
    let _ = second.sync_now().await;
    second.tick().await;

    assert_eq!(
        cloud_pointer(&cloud).expect("the account still has a pointer").wipe_epoch,
        1,
        "a stale computer moved `snap/LATEST` back to a pre-wipe snapshot"
    );
    assert_eq!(groups(&b), 0, "and B is empty, not publishing");

    let (mut third, c) = computer("C", Arc::clone(&cloud), NOW_MS + 300_000);
    third.enable(None).await.expect("C joins");
    settle(&mut first, &mut third).await;
    assert_eq!(
        groups(&c),
        0,
        "C bootstrapped from a pointer a stale computer had clobbered: {:?}",
        names(&c)
    );
}

/// (e) The third restore path, and the one that had no guard at all: AD-13's re-bootstrap after an
/// unfillable gap. A pointer that predates the account's wipe is refused there too — and a refusal
/// means NOTHING is restored, so no dated backup is left behind either.
#[tokio::test(start_paused = true)]
async fn a_re_bootstrap_refuses_a_pointer_that_predates_the_wipe() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut only, b) = computer("B", Arc::clone(&cloud), NOW_MS);

    b.captured(|tx| fixtures::insert_budget_group(tx, "In-the-snapshot", 0))
        .expect("B's first row");
    only.enable(None).await.expect("B enables");
    only.tick().await;
    assert_eq!(
        cloud_pointer(&cloud).expect("B published").wipe_epoch,
        0,
        "the pointer this test needs is one written before any wipe"
    );

    // The snapshot the stale pointer names must DIFFER from B's live file, or restoring it would
    // be observationally a no-op and this test would prove nothing. The second row is written
    // AFTER the snapshot and then SHIPPED, so `replay_unsent` cannot put it back either: a
    // performed restore loses it, a refused one keeps it.
    b.captured(|tx| fixtures::insert_budget_group(tx, "Added-after-the-snapshot", 1))
        .expect("B's second row");
    only.tick().await;
    assert_eq!(b.unshipped(), 0, "the second row must be shipped, not merely unsent");
    assert_eq!(groups(&b), 2);

    // The account is wiped by another computer and B has already adopted the epoch — but the
    // wiping computer has not published its own pointer yet, so `snap/LATEST` is still the stale
    // one. That window is exactly when a re-bootstrap would do the damage.
    let store = syncing_fake(Arc::clone(&cloud));
    assert_eq!(
        wipe::register(&store, 0, NOW_MS).await,
        Ok(1),
        "another computer registers the wipe"
    );
    b.read(|conn| sync_wipe::set_local_epoch(conn, 1).expect("B adopts the epoch"));

    only.arrange_rebootstrap();
    only.tick().await;

    assert_eq!(
        groups(&b),
        2,
        "the re-bootstrap restored the pre-wipe snapshot, which holds only the first row: {:?}",
        names(&b)
    );
    assert!(
        names(&b).contains(&"Added-after-the-snapshot".to_string()),
        "the row written after the snapshot was displaced by a restore of deleted data"
    );
    assert!(
        b.dated_backups().is_empty(),
        "a restore happened: CAP-5's dated backup is only ever written by one that does"
    );
}

/// (f) The wipe is registered even when it happened with no network at all, and even when the app
/// is restarted in between. The marker survives because `config` does, and nothing is restored
/// before the event is registered.
#[tokio::test(start_paused = true)]
async fn an_offline_wipe_registers_on_the_next_start_and_resurrects_nothing() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, _b) = two_joined(&cloud).await;
    let pre_wipe = cloud_pointer(&cloud).expect("a pointer").snap_id;

    delete_everything(&a);
    assert_eq!(
        pending(&a).as_deref().map(str::len),
        Some(16),
        "the pending marker must hold the OLD install id, so a wipe-then-wipe is unambiguous"
    );
    assert_eq!(cloud_epoch(&cloud), 0, "nothing reached the cloud yet");

    // Still offline: the attempt fails at the very first read of the marker, and the fault must
    // leave the dataset still OWING the event rather than quietly joining without it.
    cloud.fail_next(
        FakeOp::Get,
        StoreError::Transport {
            operation: StoreOp::Get,
            status: None,
            code: None,
            retryable: true,
        },
    );
    let mut offline = relaunch(&a, NOW_MS + 100_000);
    assert!(
        offline.enable(None).await.is_err(),
        "the join must not proceed while the event is owed"
    );
    assert_eq!(
        groups(&a),
        0,
        "something was restored before the event was registered"
    );
    assert!(pending(&a).is_some(), "the owed event was lost");
    assert_eq!(cloud_epoch(&cloud), 0);

    // The app is restarted, and this time there is a network.
    let mut back = relaunch(&a, NOW_MS + 200_000);
    back.enable(None).await.expect("A joins and registers");

    assert_eq!(cloud_epoch(&cloud), 1);
    assert_eq!(pending(&a), None);
    assert_eq!(groups(&a), 0, "the pre-wipe data came back");
    assert_ne!(
        cloud_pointer(&cloud).expect("a pointer").snap_id,
        pre_wipe,
        "the account still points at the deleted dataset"
    );
}

/// (g) Two computers wiping at the same time converge on ONE epoch, because a cloud epoch that is
/// already ahead is adopted rather than incremented. Two epochs would make every other computer
/// wipe itself twice — and the second time it would take the post-wipe edits with it.
#[tokio::test(start_paused = true)]
async fn two_computers_wiping_at_once_converge_on_one_epoch() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, b) = two_joined(&cloud).await;

    delete_everything(&a);
    delete_everything(&b);

    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers");
    let mut second = relaunch(&b, NOW_MS + 110_000);
    second.enable(None).await.expect("B registers");

    assert_eq!(
        cloud_epoch(&cloud),
        1,
        "the second wipe incremented instead of adopting, so every computer would wipe twice"
    );
    assert_eq!(local_epoch(&a), 1);
    assert_eq!(local_epoch(&b), 1);

    // And the post-wipe edits of both survive the convergence.
    a.captured(|tx| fixtures::insert_budget_group(tx, "A-after", 0))
        .expect("A writes");
    b.captured(|tx| fixtures::insert_budget_group(tx, "B-after", 1))
        .expect("B writes");
    settle(&mut first, &mut second).await;

    for (who, probe) in [("A", &a), ("B", &b)] {
        assert!(
            names(probe).contains(&"A-after".to_string())
                && names(probe).contains(&"B-after".to_string()),
            "{who} lost a post-wipe edit to a second self-wipe: {:?}",
            names(probe)
        );
    }
}

/// (h) A second, genuinely later wipe moves the account to epoch 2.
#[tokio::test(start_paused = true)]
async fn wiping_twice_moves_the_account_to_the_second_epoch() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers the first wipe");
    second.tick().await;
    let mut second = relaunch(&b, NOW_MS + 150_000);
    settle(&mut first, &mut second).await;
    assert_eq!(cloud_epoch(&cloud), 1);
    assert_eq!(local_epoch(&b), 1, "B must have rejoined at the new epoch by itself");

    a.captured(|tx| fixtures::insert_budget_group(tx, "Between-the-wipes", 0))
        .expect("A writes again");
    settle(&mut first, &mut second).await;
    assert_eq!(groups(&b), 1, "B must hold the row the second wipe deletes");

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 300_000);
    first.enable(None).await.expect("A registers the second wipe");

    assert_eq!(cloud_epoch(&cloud), 2);
    assert_eq!(local_epoch(&a), 2);

    second.tick().await;
    assert_eq!(groups(&b), 0, "B did not act on the second wipe");
    assert_eq!(local_epoch(&b), 2);
}

/// (i) A backup imported AFTER the account was wiped keeps its data. A relinked file has not
/// joined under its new install id, so it is never emptied automatically — it takes the ordinary
/// join, which is CAP-5's question and a dated backup.
#[tokio::test(start_paused = true)]
async fn an_imported_backup_is_never_self_wiped() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers");
    let mut rejoined_b = relaunch(&b, NOW_MS + 120_000);
    settle(&mut first, &mut rejoined_b).await;
    assert_eq!(cloud_epoch(&cloud), 1);

    // `db::backup::restore_from_file` is a raw `fs::copy`, so an imported file brings back the
    // config of the backup — including an epoch BEHIND the account's — and its install id is
    // re-minted on open. The one thing that keeps it safe is that `relink_install` clears
    // `joined_at`: a file that has not joined is never emptied for an event it never took part in.
    let (mut imported, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    c.captured(|tx| fixtures::insert_budget_group(tx, "From-my-backup", 0))
        .expect("the imported row");
    c.read(|conn| {
        sync_state::set_pin(conn, "identity-1", "owner-sub-1").expect("the import is pinned");
        sync_state::mark_joined(conn).expect("the backup was taken from a joined computer");
        crate::sync::state::remint_install_on(conn).expect("the import path re-mints");
    });
    assert!(
        !c.read(|conn| sync_state::load(conn)
            .expect("reads")
            .expect("a row")
            .joined()),
        "a relinked file must not read as joined, or the next cycle would destroy it"
    );
    assert_eq!(local_epoch(&c), 0, "the imported file predates the wipe");

    let outcome = imported.enable(None).await.expect("the imported file joins");

    assert_eq!(
        groups(&c),
        1,
        "the imported data was destroyed by an account-wide wipe it never took part in"
    );
    assert!(
        names(&c).contains(&"From-my-backup".to_string()),
        "the imported row is gone"
    );
    // The EXACT path, pinned rather than one of two: the account holds a current post-wipe
    // pointer, this file holds rows of its own, so `assess` answers `ChoiceRequired` and the
    // user is asked CAP-5's question about ONE local row. `Waiting` here would mean the file was
    // refused a join it should have been offered, and `Enabled` would mean it was never asked.
    assert!(
        matches!(
            outcome,
            SyncEnableOutcome::LinkChoiceRequired { local_rows: 1, .. }
        ),
        "an imported file with data of its own must be ASKED CAP-5's question: {outcome:?}"
    );
    assert_eq!(local_epoch(&c), 0, "being asked must not adopt the epoch");
}

/// What `commands::backup::restore_into_active_dataset` leaves behind on a cloud-linked file: a
/// row of its own, the account pin, a re-minted install id, and the import marker.
fn imported_file(probe: &ComputerProbe, row: &str) {
    probe
        .captured(|tx| fixtures::insert_budget_group(tx, row, 0))
        .expect("the imported row");
    probe.read(|conn| {
        sync_state::set_pin(conn, "identity-1", "owner-sub-1").expect("the import is pinned");
        sync_state::mark_joined(conn).expect("the backup was taken from a joined computer");
        crate::sync::state::remint_install_on(conn).expect("the import path re-mints");
        sync_wipe::set_import_pending(conn, sync_wipe::ImportStage::Unregistered)
            .expect("the import marker stores");
    });
}

/// (j) The reported bug: delete everything, import a backup, and the next login must NOT lose it.
/// The import is the newest state — it is published over the account, the account's epoch moves
/// past the post-wipe snapshot, and every other computer takes the backup instead of the wipe.
#[tokio::test(start_paused = true)]
async fn an_imported_backup_replaces_the_account_instead_of_being_asked_about() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers");
    let mut second = relaunch(&b, NOW_MS + 120_000);
    settle(&mut first, &mut second).await;
    assert_eq!(cloud_epoch(&cloud), 1);
    assert_eq!(groups(&b), 0, "B must have followed the wipe");

    let (mut imported, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    imported_file(&c, "From-my-backup");

    let outcome = imported.enable(None).await.expect("the imported file joins");

    assert!(
        matches!(outcome, SyncEnableOutcome::Enabled { .. }),
        "an import must publish, not ask: {outcome:?}"
    );
    assert_eq!(names(&c), vec!["From-my-backup".to_string()], "the import was lost");
    assert_eq!(cloud_epoch(&cloud), 2, "the import must retire the post-wipe snapshot");
    assert_eq!(local_epoch(&c), 2);
    assert_eq!(cloud_pointer(&cloud).expect("a pointer").wipe_epoch, 2);
    assert_eq!(
        c.read(|conn| sync_wipe::import_pending(conn).expect("the marker reads")),
        None,
        "a published import owes the account nothing"
    );

    // The other computers follow the import exactly as they followed the wipe.
    let mut second = relaunch(&b, NOW_MS + 300_000);
    settle(&mut imported, &mut second).await;
    assert_eq!(
        names(&b),
        vec!["From-my-backup".to_string()],
        "B must end up with the backup, not with the empty post-wipe state"
    );
}

/// (k) An import whose epoch is registered but whose publish never landed (offline) is retried
/// WITHOUT a second bump, which would make every other computer wipe itself twice — and it still
/// replaces whatever post-wipe pointer another computer published in the meantime.
#[tokio::test(start_paused = true)]
async fn a_retried_import_publish_does_not_move_the_epoch_again() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, _b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers and publishes its empty snapshot");
    assert_eq!(cloud_epoch(&cloud), 1);

    let (mut imported, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    imported_file(&c, "From-my-backup");
    // The first attempt got as far as adopting the account's epoch and stopped there.
    c.read(|conn| {
        sync_wipe::set_local_epoch(conn, 1).expect("the epoch stores");
        sync_wipe::set_import_pending(conn, sync_wipe::ImportStage::Registered)
            .expect("the stage stores");
    });

    let outcome = imported.enable(None).await.expect("the retry joins");

    assert!(matches!(outcome, SyncEnableOutcome::Enabled { .. }), "{outcome:?}");
    assert_eq!(cloud_epoch(&cloud), 1, "the retry bumped the epoch a second time");
    assert_eq!(names(&c), vec!["From-my-backup".to_string()]);
}

/// B1: a computer whose machine FINGERPRINT drifted — renamed, or launched without the host
/// environment variable the fingerprint is built from — is relinked by `ensure_install_on` on
/// every dataset open. That must stay a RESUME: it is the same computer, it holds the account's
/// rows, and turning it into an unjoined one would ask CAP-5's question and let `replace` drop its
/// unsent edits. It must also keep self-wiping, because `AheadUnjoined` never does.
#[tokio::test(start_paused = true)]
async fn a_fingerprint_drift_still_resumes_and_still_honours_the_wipe() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, b) = two_joined(&cloud).await;

    // The row now claims a machine this one is not, which is what a rename produces.
    b.read(|conn| {
        conn.execute(
            "UPDATE sync_state SET machine_fingerprint = ?1 WHERE id = 1",
            ["cd00000000000000000000000000000000000000000000000000000000000000"],
        )
        .expect("the fingerprint is rewritten");
    });
    let relinked = b.read(|conn| {
        crate::sync::state::ensure_install_on(conn).expect("every dataset open reaches this")
    });
    assert!(
        relinked.joined(),
        "a fingerprint relink un-joined a healthy synced computer"
    );

    let mut second = relaunch(&b, NOW_MS + 50_000);
    let outcome = second.enable(None).await.expect("B resumes");
    assert!(
        matches!(outcome, SyncEnableOutcome::Enabled { .. }),
        "a drifted fingerprint must resume, never raise CAP-5's question: {outcome:?}"
    );
    assert_eq!(groups(&b), 1, "B kept the account's rows");

    // And because it is still joined, the account's wipe still reaches it.
    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A registers the wipe");
    second.tick().await;

    assert_eq!(groups(&b), 0, "a relinked-by-drift computer ignored the account's wipe");
    assert_eq!(local_epoch(&b), 1);
}

/// (j) After all of that, ordinary sync still works: an edit made on the wiped computer reaches
/// the one that wiped itself and the one that joined afterwards.
#[tokio::test(start_paused = true)]
async fn edits_made_after_the_wipe_reach_every_computer() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;

    delete_everything(&a);
    let mut first = relaunch(&a, NOW_MS + 100_000);
    first.enable(None).await.expect("A rejoins");
    second.tick().await;
    let mut second = relaunch(&b, NOW_MS + 150_000);
    settle(&mut first, &mut second).await;

    let (mut third, c) = computer("C", Arc::clone(&cloud), NOW_MS + 200_000);
    third.enable(None).await.expect("C joins");

    a.captured(|tx| fixtures::insert_budget_group(tx, "A-after-the-wipe", 0))
        .expect("A writes");
    for _ in 0..8 {
        tokio::time::advance(Duration::from_secs(60)).await;
        first.tick().await;
        second.tick().await;
        third.tick().await;
    }

    for (who, probe) in [("B", &b), ("C", &c)] {
        assert!(
            names(probe).contains(&"A-after-the-wipe".to_string()),
            "{who} never received the post-wipe edit: {:?}",
            names(probe)
        );
    }
    assert_eq!(cloud_epoch(&cloud), 1, "ordinary sync must not move the epoch");
}

/// S2: `fetch_latest_at` admits a pointer stamped at or ABOVE the cutoff, which includes one
/// stamped HIGHER — the ordinary race where the publisher registered its wipe and published before
/// this computer's own read of the marker landed. The restoring computer must then adopt the
/// POINTER's epoch and not merely the cutoff, or it would be left behind the data it has just
/// received and would wipe it on the next cycle.
#[tokio::test(start_paused = true)]
async fn a_restore_adopts_the_epoch_its_pointer_was_stamped_at() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, _b_actor, _b) = two_joined(&cloud).await;

    // A wipes twice, so the account's pointer is stamped at epoch 2.
    for round in 1..=2 {
        delete_everything(&a);
        let mut actor = relaunch(&a, NOW_MS + 100_000 * round);
        actor.enable(None).await.expect("A registers a wipe");
    }
    assert_eq!(cloud_epoch(&cloud), 2);
    assert_eq!(cloud_pointer(&cloud).expect("a pointer").wipe_epoch, 2);

    // A reader whose view of the MARKER lags the pointer: seeded directly, because the protocol
    // cannot move an epoch backwards and this is a state of one computer's knowledge, not of the
    // account. Everything below is then the ordinary join.
    cloud.seed(WIPE_OBJECT_KEY, WipeEvent { epoch: 1, wiped_ms: NOW_MS }.body());

    let (mut third, c) = computer("C", Arc::clone(&cloud), NOW_MS + 400_000);
    third.enable(None).await.expect("C joins and restores");

    assert_eq!(
        local_epoch(&c),
        2,
        "C adopted the cutoff instead of the epoch its snapshot was published at, so the account \
         still reads as ahead of it"
    );

    // The consequence, which is what makes the number above matter: with the true marker back,
    // C must NOT read the account as ahead and wipe what it has just restored.
    cloud.seed(WIPE_OBJECT_KEY, WipeEvent { epoch: 2, wiped_ms: NOW_MS }.body());
    a.captured(|tx| fixtures::insert_budget_group(tx, "After-both-wipes", 0))
        .expect("A writes");
    let mut first = relaunch(&a, NOW_MS + 500_000);
    settle(&mut first, &mut third).await;

    assert!(
        names(&c).contains(&"After-both-wipes".to_string()),
        "C wiped itself over a snapshot it had correctly restored: {:?}",
        names(&c)
    );
    assert_eq!(local_epoch(&c), 2);
}

/// S3: a dataset can become UNJOINED underneath a running actor — a copy or a restore re-mints the
/// install id and `remint_install_on` clears the join marker. `log_cycle` must then STOP the
/// actor, because `tick` only re-attempts the join while `!enabled`: returning with it still
/// enabled leaves it cycling forever against an account it can never reach, and the CAP-5 question
/// it is owed is never asked.
#[tokio::test(start_paused = true)]
async fn an_actor_that_becomes_unjoined_stops_instead_of_cycling_forever() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_a_actor, a, mut second, b) = two_joined(&cloud).await;

    // The account is wiped by a computer that is not modelled here, so no post-wipe pointer has
    // been published yet; B is then relinked underneath, exactly as an import or a copy does.
    let store = syncing_fake(Arc::clone(&cloud));
    assert_eq!(wipe::register(&store, 0, NOW_MS).await, Ok(1));
    b.read(|conn| {
        crate::db::sync_state::clear_joined_at(conn).expect("a copy or restore forgets the join");
    });

    second.tick().await;

    assert!(
        !second.diagnostics().enabled,
        "the actor is still enabled, so `tick` will never re-attempt the join and it cycles \
         against an account it cannot reach forever"
    );
    assert_eq!(
        groups(&b),
        1,
        "an unjoined dataset must never be emptied automatically: it may hold data the account \
         has never seen"
    );
    assert_eq!(local_epoch(&b), 0, "and it must not adopt the epoch without joining");

    // Once a post-wipe pointer exists, the stopped actor rejoins by itself and is ASKED.
    delete_everything(&a);
    let mut first_after = relaunch(&a, NOW_MS + 100_000);
    first_after.enable(None).await.expect("A registers and publishes");
    settle(&mut first_after, &mut second).await;

    assert_eq!(
        second.diagnostics().state,
        crate::sync::manager::SyncState::LinkChoiceRequired,
        "a stopped-and-unjoined computer holding rows must end up at CAP-5's question"
    );
    assert_eq!(groups(&b), 1, "and its rows are still there while it waits for the answer");
}

/// The typed fault `upload`'s publish gate raises, which is deliberately neither retried nor
/// backed off from: the cure is the self-wipe at the top of the next cycle, and a backoff would
/// only delay it.
#[test]
fn the_publish_gate_has_its_own_fault_code() {
    let fault = SyncFault::WipedElsewhere;

    assert_eq!(fault.code(), "wiped_elsewhere");
    assert!(!fault.retryable(), "repeating the same publish cannot help");
    assert!(fault.recoverable(), "it clears by itself within a cycle");
    assert!(
        fault.message().contains("another computer"),
        "support reads this line: {}",
        fault.message()
    );
}

/// The one structural reason a wipe can record its own intent at all.
#[test]
fn the_wipe_leaves_the_config_table_alone() {
    assert!(
        !danger_zone::WIPE_TABLES.contains(&"config"),
        "the epoch and the pending marker would be deleted by the very wipe they describe"
    );
}
