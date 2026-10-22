//! The shared action log actually travels.
//!
//! `audit_log` is `AppendOnly` (AD-5): every computer's entries are meant to end up on every
//! computer. They never did — the apply path created an audit row from the columns that travel, and
//! `entity_id` (a machine-local integer, NOT NULL, not a foreign key) is not one of them. Every
//! remote audit row was therefore parked "for a row that has not arrived yet", forever, and
//! re-driven on every batch.

use std::sync::Arc;
use std::time::Duration;

use crate::db::audit as audit_db;
use crate::db::capture_fixtures as fixtures;
use crate::sync::manager::{SyncActor, SyncTuning};
use crate::sync::test_support::{test_computer, ComputerProbe, FakeObjectStore, TestComputer};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        reconcile_interval: Duration::from_secs(86_400),
        auto_join_interval: Duration::ZERO,
        capability_recheck_interval: Duration::ZERO,
        ..SyncTuning::default()
    }
}

fn computer(id: &str, cloud: &Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, Arc::clone(cloud), clock);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

fn parked(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM sync_pending", [], |row| row.get(0))
            .expect("the parked count reads")
    })
}

async fn exchange(first: &mut Actor, second: &mut Actor) {
    for _ in 0..8 {
        first.tick().await;
        second.tick().await;
    }
}

#[tokio::test(start_paused = true)]
async fn an_audit_entry_arrives_filed_under_the_local_row_of_its_entity() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let (mut second, b) = computer("B", &cloud, NOW_MS + 60_000);
    first.auto_start_now().await;
    second.auto_start_now().await;

    // A project on A, and the entry that says so. On B the project will have another local id.
    b.captured(|tx| fixtures::insert_project(tx, "A project that only B had first").map(|_| ()))
        .expect("B's own project commits");
    let project = a
        .captured(|tx| fixtures::insert_project(tx, "Roof"))
        .expect("the project commits");
    a.captured(|tx| audit_db::insert_audit_log(tx, "project", project, "create", None, Some("{}")))
        .expect("the entry commits");

    exchange(&mut first, &mut second).await;

    let on_b = b.read(|conn| fixtures::audit_entries(conn).expect("the entries read"));
    assert_eq!(
        on_b.len(),
        1,
        "the entry reached the other computer: {on_b:?}"
    );
    let (entity_type, entity_id, named) = &on_b[0];
    assert_eq!(entity_type, "project");
    assert!(named, "and it still names its entity by uuid");

    let local_roof: i64 = b.read(|conn| {
        conn.query_row("SELECT id FROM projects WHERE name = 'Roof'", [], |row| {
            row.get(0)
        })
        .expect("the project reached B")
    });
    assert_eq!(
        *entity_id, local_roof,
        "filed under B's own row for the project, not A's number"
    );
    assert_ne!(
        *entity_id, project,
        "the fixture must give the two computers different ids"
    );
    assert_eq!(parked(&b), 0, "nothing waits for a row that is not coming");
}

#[tokio::test(start_paused = true)]
async fn an_audit_entry_that_describes_no_single_row_arrives_with_the_conventional_zero() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let (mut second, b) = computer("B", &cloud, NOW_MS + 60_000);
    first.auto_start_now().await;
    second.auto_start_now().await;

    a.captured(|tx| audit_db::insert_audit_log(tx, "import", 0, "create", None, Some("{}")))
        .expect("an import entry commits");
    // An entity that is not here (and so was never named) is the same case from the other side.
    a.captured(|tx| audit_db::insert_audit_log(tx, "project", 999, "delete", Some("{}"), None))
        .expect("an entry about a vanished row commits");

    exchange(&mut first, &mut second).await;

    let on_b = b.read(|conn| fixtures::audit_entries(conn).expect("the entries read"));
    assert_eq!(on_b.len(), 2, "both entries arrived: {on_b:?}");
    assert!(on_b.iter().all(|(_, entity_id, _)| *entity_id == 0));
    assert_eq!(parked(&b), 0);
}
