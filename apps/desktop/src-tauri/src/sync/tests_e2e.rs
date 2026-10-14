//! The Milestone-1 proof suite: "log in on a new computer and my data is there", run
//! end to end against a heavy-year dataset.
//!
//! Re-runnable by name on both platforms:
//!
//! ```text
//! cd apps/desktop/src-tauri && cargo test sync_e2e -- --nocapture
//! ```
//!
//! Every test prints one `PASS` line with the numbers it measured, so the CI log for macOS
//! and for Windows *is* the report. Nothing here is a mock of our own behaviour: the data is
//! Story 8's synthetic heavy year, the cloud is Story 8's `FakeObjectStore` with the real
//! create-only / `If-Match` / `304` / `412` / `409` / `404` semantics (MinIO could not be
//! pulled in CI, so there is no server to point at), and everything in between is the
//! production path — `SyncActor`, `bootstrap`, `snapshot`, `SyncGate`, `blob`, the guarded
//! swap in `db::backup`. The two "computers" are two independent app-data directories, each
//! with its own dataset, install identity and connections, over ONE shared cloud.
//!
//! Why it is deterministic rather than timed: the clock is virtual
//! (`#[tokio::test(start_paused = true)]` where time matters), so a slow Windows runner
//! changes no assertion. The one real measurement, CAP-2, is split the way the capability is
//! stated — the network leg is modelled from the object's size at exactly 10 Mbps and only
//! the CPU/disk leg is wall time, with a ceiling roughly 3x a developer machine's figure.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;

use crate::db::sync_state::FrozenReason;
use crate::db::test_dataset::{
    seed_heavy_year_into, stamp_text_columns_with_sentinels, HeavyYearShape, SENTINEL_PREFIX,
};
use crate::db::{config::LOCAL_ONLY_KEYS, open_configured};
use crate::models::DatasetKind;
use crate::sync::blob::{blob_key, BLOB_KEY_PREFIX};
use crate::sync::bootstrap::{measure_link, LinkChoice, CAP2_BUDGET, CAP2_BYTES_PER_SECOND};
use crate::sync::manager::{
    RemoteChoice, SyncActor, SyncEnableOutcome, SyncState, SyncStatusPayload, SyncTuning,
};
use crate::sync::snapshot::SNAP_LATEST_KEY;
use crate::entitlements::AccountCapabilities;
use crate::sync::auth::{AccountPin, AuthError};
use crate::sync::gate::{CapabilitySource, GateStateSource, SyncBlocked, SyncGate};
use crate::sync::state::GateState;
use crate::sync::test_support::{
    test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer,
    FAKE_IDENTITY_ID, FAKE_OWNER_SUB,
};
use crate::sync::tests_bootstrap::{config_map, dump, tables};

const SETTLE: Duration = Duration::from_secs(5);
const MIN_UPLOAD: Duration = Duration::from_secs(60);

/// Roughly 3x the debug-build figure Story 9 measured on a developer machine, so a slow
/// macOS or Windows runner has headroom while an order-of-magnitude regression still fails.
const NON_NETWORK_CEILING: Duration = Duration::from_millis(2_200);

type Actor = SyncActor<TestComputer>;

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
        tombstone_purge_interval: Duration::from_secs(86_400),
        // Reconcile is driven directly in `tests_reconcile.rs`: here it would be a full scan of
        // every travelling table inside a fixture that counts requests (AD-3, story 22).
        reconcile_interval: Duration::from_secs(86_400),
        max_backoff: Duration::from_secs(120),
    }
}

fn actor_for(host: TestComputer) -> Actor {
    let (actor, _status, _events) = SyncActor::new(host, tuning());

    actor
}

/// Two computers on one account, each with its own app-data directory and install identity.
fn two_computers(cloud: &Arc<FakeObjectStore>) -> (Actor, ComputerProbe, Actor, ComputerProbe) {
    let (first, a) = test_computer("A", Arc::clone(cloud), 1_700_000_000_000);
    let (second, b) = test_computer("B", Arc::clone(cloud), 1_800_000_000_000);

    (actor_for(first), a, actor_for(second), b)
}

/// An entitled account and a dataset pinned to a DIFFERENT one: the only two gate inputs
/// the shared harness fixes, and the pair AD-7's second refusal needs.
struct Entitled;

impl CapabilitySource for Entitled {
    async fn capabilities(&self) -> AccountCapabilities {
        AccountCapabilities::from_cloud_entitlement(true)
    }
}

struct PinnedElsewhere;

impl GateStateSource for PinnedElsewhere {
    fn gate_state(&self) -> Result<GateState, AuthError> {
        Ok(GateState {
            pin: Some(AccountPin::new("us-east-1:9999", "another-sub")),
            frozen_reason: None,
        })
    }
}

fn report(line: String) {
    println!("PASS sync_e2e: {line}");
}

/// The edit and the two polls it takes to publish it: the first notices the changed
/// `data_version` and opens the settle window, the second finds it elapsed and uploads.
async fn edit_then_settle(actor: &mut Actor, probe: &ComputerProbe, name: &str) {
    probe.write_row(name);
    actor.tick().await;
    tokio::time::advance(SETTLE + MIN_UPLOAD).await;
    actor.tick().await;
}

/// The same two polls as `edit_then_settle`, for the tests that run on a real clock: the
/// tuning's windows are bypassed by asking for the upload explicitly instead of sleeping.
async fn edit_then_settle_real(actor: &mut Actor, probe: &ComputerProbe) {
    probe.write_row("later");
    actor.sync_now().await.expect("the explicit upload succeeds");
}

fn schema_version() -> u32 {
    u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits")
}

fn opened(db_path: &std::path::Path) -> Connection {
    open_configured(db_path).expect("the dataset opens")
}

/// Every table of both datasets, rendered row by row with its rowid, minus the three parts
/// Milestone 1 documents as deliberately different.
fn compared_tables(source: &Connection, restored: &Connection) -> BTreeMap<String, usize> {
    assert_eq!(
        tables(source),
        tables(restored),
        "the two computers must hold the same tables before their rows are compared"
    );
    let mut rows = BTreeMap::new();
    for table in tables(source) {
        let (left, right) = match table.as_str() {
            // AD-5: the keys that describe THIS computer's credential state never travel.
            "config" => {
                let strip = |conn: &Connection| -> BTreeMap<String, String> {
                    config_map(conn)
                        .into_iter()
                        .filter(|(key, _)| !LOCAL_ONLY_KEYS.contains(&key.as_str()))
                        .collect()
                };
                assert_eq!(strip(source), strip(restored), "config differs");
                rows.insert(table.clone(), strip(source).len());
                continue;
            }
            // AD-10: the full picture arrives on demand, everything else about it travels.
            "project_images" => (
                dump(source, &table, &["image_bytes"]),
                dump(restored, &table, &["image_bytes"]),
            ),
            _ => (dump(source, &table, &[]), dump(restored, &table, &[])),
        };
        assert_eq!(left, right, "{table} differs between the two computers");
        rows.insert(table, left.len());
    }

    rows
}

/// (a) Enable on A, bootstrap on B: the data is identical table by table and the schema
/// version matches, with no question asked of a brand-new computer.
#[tokio::test]
async fn sync_e2e_a_new_computer_bootstraps_an_identical_dataset() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, mut computer_b, b) = two_computers(&cloud);
    let shape = seed_heavy_year_into(a.db_path());

    computer_a.enable(None).await.expect("A enables");
    let outcome = computer_b.enable(None).await.expect("B bootstraps");

    assert!(
        matches!(outcome, SyncEnableOutcome::Enabled { .. }),
        "an empty new computer is never asked CAP-5's question"
    );
    assert_eq!(computer_b.status().state, SyncState::Idle);

    a.close_live();
    b.close_live();
    let source = opened(a.db_path());
    let restored = opened(b.db_path());
    let compared = compared_tables(&source, &restored);
    let diagnostics = computer_b.diagnostics();

    assert_eq!(diagnostics.restores, 1);
    assert_eq!(diagnostics.schema_version, schema_version());
    assert!(
        compared.get("expenses").copied() == Some(shape.expenses),
        "the heavy year's expenses must all be there, found {:?}",
        compared.get("expenses")
    );
    report(format!(
        "(a) B bootstrapped {} tables identically ({} expenses, {} audit rows, {} chat \
         messages, {} project images), schema version {} on both",
        compared.len(),
        shape.expenses,
        shape.audit_rows,
        shape.chat_messages,
        shape.project_images,
        schema_version(),
    ));
}

/// (b) AD-10 and CAP-6, through the PRODUCTION path on both sides: A's sync cycle uploads the
/// full pictures as `blob/<sha256>` objects, only the thumbnails arrive with the snapshot, and
/// `SyncActor::fetch_image` — the one the `sync_fetch_project_image` command calls — brings each
/// picture down, hash-verified, on demand.
#[tokio::test]
async fn sync_e2e_b_project_images_arrive_lazily_and_hash_verify() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, mut computer_b, b) = two_computers(&cloud);
    let shape = seed_heavy_year_into(a.db_path());

    computer_a.enable(None).await.expect("A enables");
    computer_b.enable(None).await.expect("B bootstraps");

    let originals = a.read(|conn| {
        (1..=shape.project_images as i64)
            .map(|id| {
                crate::db::projects::get_project_image(conn, id)
                    .expect("the image reads")
                    .expect("the image exists")
            })
            .collect::<Vec<_>>()
    });
    for image in &originals {
        assert!(image.image_bytes.is_some(), "A still has the full picture");
    }

    // A's own cycle put every picture in the cloud, create-only, one object each.
    let blob_puts = cloud.calls_of_prefix(FakeOp::PutImmutable, BLOB_KEY_PREFIX);
    assert_eq!(blob_puts, shape.project_images as u64);
    for image in &originals {
        assert!(
            cloud
                .keys()
                .contains(&blob_key(&image.image_sha256).expect("a digest is a key")),
            "the object must be at blob/<image_sha256>"
        );
    }

    for image in b.read(|conn| {
        (1..=shape.project_images as i64)
            .map(|id| {
                crate::db::projects::get_project_image(conn, id)
                    .expect("the image reads")
                    .expect("the image exists")
            })
            .collect::<Vec<_>>()
    }) {
        assert_eq!(image.image_bytes, None, "AD-10: no full picture yet");
        assert!(image.thumbnail_bytes.is_some(), "the thumbnail travelled");
        assert_eq!(image.byte_size as usize, shape.image_payload_bytes);
    }

    // The lazy fetch, through the command's own path rather than through the blob helpers.
    let mut fetched_bytes = 0usize;
    for original in &originals {
        let payload = computer_b
            .fetch_image(original.project_id)
            .await
            .expect("B fetches the picture on demand");

        assert!(payload.full_image_available);
        assert_eq!(payload.image_sha256, original.image_sha256);
        fetched_bytes += payload.byte_size as usize;
    }

    let after = b.read(|conn| {
        crate::db::projects::get_project_image(conn, originals[0].project_id)
            .expect("the image reads")
            .expect("the image exists")
    });
    assert_eq!(after.image_bytes, originals[0].image_bytes);
    assert_eq!(after.image_sha256, originals[0].image_sha256);

    // A second cycle on A re-sends nothing: the persisted marker answers it (AD-19's cost lever).
    edit_then_settle_real(&mut computer_a, &a).await;
    assert_eq!(
        cloud.calls_of_prefix(FakeOp::PutImmutable, BLOB_KEY_PREFIX),
        blob_puts,
        "a later cycle must re-upload no picture at all"
    );

    report(format!(
        "(b) {} project images were uploaded once as blob/<sha256> ({} puts, 0 on the next \
         cycle), arrived on B as thumbnails only, then {} B of full image bytes were fetched on \
         demand and hash-verified against A",
        shape.project_images, blob_puts, fetched_bytes
    ));
}

/// (c) CAP-2: from "credentials ready" to "data usable" on a new computer, inside 5 s at
/// 10 Mbps. The network leg is modelled from the bytes that actually moved; everything else
/// is real measured wall time.
#[tokio::test(start_paused = true)]
async fn sync_e2e_c_a_new_computer_is_usable_inside_the_cap2_budget() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, mut computer_b, b) = two_computers(&cloud);
    let shape = seed_heavy_year_into(a.db_path());

    computer_a.enable(None).await.expect("A enables");

    // Only B's link is measured, so the throttle and the byte counter both start here.
    let before = cloud.transferred_bytes();
    cloud.throttle_to(CAP2_BYTES_PER_SECOND);
    let counted = Arc::clone(&cloud);
    let (outcome, budget) = measure_link(computer_b.enable(None), || {
        counted.transferred_bytes() - before
    })
    .await;

    outcome.expect("B bootstraps");
    let rows = b.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM expenses", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("the restored dataset answers a real query")
    });

    assert_eq!(rows, shape.expenses as i64, "usable means it answers queries");
    assert_eq!(
        cloud.calls_of_prefix(FakeOp::Get, BLOB_KEY_PREFIX),
        0,
        "CAP-6: the first load carries thumbnails only, so no picture is on the critical path"
    );
    assert!(
        budget.measured <= NON_NETWORK_CEILING,
        "the CPU/disk half took {:?}, over the {:?} ceiling",
        budget.measured,
        NON_NETWORK_CEILING
    );
    assert!(
        budget.within_budget(),
        "over CAP-2's {:?}: {}",
        CAP2_BUDGET,
        budget.breakdown()
    );
    report(format!("(c) {}", budget.breakdown()));
}

/// (d) CAP-5. *Replace* keeps a dated backup that opens and still holds the old data;
/// *separate* leaves the existing file byte-identical and links a second profile.
#[tokio::test(start_paused = true)]
async fn sync_e2e_d_replace_keeps_a_dated_backup_and_separate_keeps_the_old_file() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, mut computer_b, b) = two_computers(&cloud);
    a.write_row("from-a");
    computer_a.enable(None).await.expect("A enables");

    b.write_row("only-on-b");
    let asked = computer_b.enable(None).await.expect("the choice is not a fault");
    assert!(
        matches!(asked, SyncEnableOutcome::LinkChoiceRequired { local_rows: 1, .. }),
        "a computer with data is asked first, got {asked:?}"
    );
    assert_eq!(b.rows(), vec!["only-on-b".to_string()], "nothing moved yet");

    computer_b
        .enable(Some(LinkChoice::Replace))
        .await
        .expect("replace succeeds");

    assert_eq!(b.rows(), vec!["from-a".to_string()], "the cloud copy is live");
    let backups = b.dated_backups();
    assert_eq!(backups.len(), 1, "CAP-5: the displaced file is kept");
    let kept = opened(&backups[0]);
    assert_eq!(
        crate::db::test_dataset::marker_rows(&kept),
        vec!["only-on-b".to_string()],
        "the dated backup opens and still holds what this computer had"
    );
    drop(kept);

    // Separate, on a third computer, so the replace above is not what is being re-measured.
    let (third, c) = test_computer("C", Arc::clone(&cloud), 1_900_000_000_000);
    let mut computer_c = actor_for(third);
    crate::datasets::bootstrap_registry_at(c.root()).expect("the registry exists");
    c.write_row("only-on-c");
    c.close_live();
    let before = std::fs::read(c.db_path()).expect("the kept file reads");

    computer_c.enable(None).await.expect("C is asked");
    let outcome = computer_c
        .enable(Some(LinkChoice::Separate))
        .await
        .expect("separate succeeds");

    let SyncEnableOutcome::SeparateProfileCreated { dataset_id } = outcome else {
        panic!("separate must report the new profile, got {outcome:?}");
    };
    assert_eq!(
        std::fs::read(c.db_path()).expect("the kept file reads"),
        before,
        "separate must leave the existing dataset byte-identical"
    );
    let separated = opened(&crate::datasets::dataset_db_path(c.root(), &dataset_id));
    assert_eq!(
        crate::db::test_dataset::marker_rows(&separated),
        vec!["from-a".to_string()],
        "the cloud copy went into the new profile"
    );

    report(format!(
        "(d) replace kept {} dated backup holding the old row and loaded A's; separate left \
         {} B byte-identical and provisioned profile {}",
        backups.len(),
        before.len(),
        dataset_id
    ));
}

/// (e) AD-14: Frozen stops every transfer — the counter does not move at all — while local
/// reads and writes keep working, and leaving Frozen resumes.
#[tokio::test(start_paused = true)]
async fn sync_e2e_e_frozen_stops_every_transfer_and_leaving_it_resumes() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, _computer_b, _b) = two_computers(&cloud);
    a.write_row("before");
    computer_a.enable(None).await.expect("enable while entitled");
    let while_entitled = cloud.calls();

    a.set_entitled(false);
    edit_then_settle(&mut computer_a, &a, "during").await;
    for extra in ["more", "and-more"] {
        edit_then_settle(&mut computer_a, &a, extra).await;
    }

    assert_eq!(computer_a.status().state, SyncState::Frozen);
    assert_eq!(
        cloud.calls(),
        while_entitled,
        "AD-14: a Frozen account transfers nothing at all"
    );
    assert_eq!(
        a.rows(),
        vec![
            "before".to_string(),
            "during".to_string(),
            "more".to_string(),
            "and-more".to_string()
        ],
        "the local app is unaffected by Frozen"
    );
    assert_eq!(
        computer_a.diagnostics().frozen_reason,
        Some(FrozenReason::EntitlementLapsed.code())
    );

    a.set_entitled(true);
    computer_a.tick().await;
    tokio::time::advance(SETTLE + MIN_UPLOAD).await;
    computer_a.tick().await;

    assert_eq!(computer_a.status().state, SyncState::Idle);
    let resumed = cloud.calls();
    assert!(resumed > while_entitled, "leaving Frozen resumes sync");
    report(format!(
        "(e) 3 edits while Frozen moved 0 requests (counter stayed at {while_entitled}) and \
         4 local rows stayed readable; unfreezing took it to {resumed}"
    ));
}

/// (f) A publish that finds LATEST moved by the other computer never overwrites the cloud
/// copy, and accepting the offer to load it keeps the local file as a dated backup.
#[tokio::test(start_paused = true)]
async fn sync_e2e_f_a_conflicting_upload_never_overwrites_the_cloud_copy() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, mut computer_b, b) = two_computers(&cloud);
    a.write_row("from-a");
    computer_a.enable(None).await.expect("A enables");

    computer_b.enable(None).await.expect("B bootstraps");
    edit_then_settle(&mut computer_b, &b, "from-b").await;
    let theirs = cloud.stored(SNAP_LATEST_KEY).expect("B published");

    a.write_row("later-on-a");
    computer_a.sync_now().await.expect("A's attempt is not a fault");

    assert_eq!(computer_a.status().state, SyncState::RemoteChanged);
    assert!(computer_a.status().prompt.is_some(), "the user is offered the choice");
    assert_eq!(
        cloud.stored(SNAP_LATEST_KEY).as_deref(),
        Some(theirs.as_slice()),
        "their pointer is still theirs, byte for byte"
    );
    assert_eq!(computer_a.diagnostics().conflicts, 1);

    computer_a
        .resolve_remote(RemoteChoice::LoadRemote)
        .await
        .expect("A loads the cloud copy");

    assert_eq!(computer_a.status().state, SyncState::Idle);
    assert_eq!(a.dated_backups().len(), 1, "CAP-5: the displaced file is kept");
    let kept = opened(&a.dated_backups()[0]);
    assert!(
        crate::db::test_dataset::marker_rows(&kept).contains(&"later-on-a".to_string()),
        "the backup holds the edit the cloud copy displaced"
    );
    drop(kept);
    assert_eq!(a.rows(), vec!["from-a".to_string(), "from-b".to_string()]);

    report(format!(
        "(f) A's conflicting publish left LATEST at B's {} bytes, reported 1 conflict, and \
         loading the cloud copy kept 1 dated backup holding A's displaced edit",
        theirs.len()
    ));
}

/// (g) Local reads and writes are not sync activity: a burst inside the settle window
/// reaches the store zero times.
#[tokio::test(start_paused = true)]
async fn sync_e2e_g_local_reads_and_writes_make_no_store_call() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, _computer_b, _b) = two_computers(&cloud);
    computer_a.enable(None).await.expect("enable");
    tokio::time::advance(MIN_UPLOAD).await;
    let after_enable = cloud.calls();

    for (index, name) in ["one", "two", "three", "four", "five"].iter().enumerate() {
        a.write_row(name);
        let _ = a.rows();
        computer_a.tick().await;
        if index < 4 {
            tokio::time::advance(SETTLE / 3).await;
        }
    }

    assert_eq!(
        cloud.calls(),
        after_enable,
        "nothing may go out while the edits are still settling"
    );
    assert_eq!(a.rows().len(), 5, "and every write landed locally");

    tokio::time::advance(SETTLE).await;
    computer_a.tick().await;

    assert_eq!(
        computer_a.diagnostics().uploads,
        2,
        "the whole burst coalesces into exactly one upload"
    );
    report(format!(
        "(g) 5 writes and 5 reads inside the settle window made 0 requests (counter stayed \
         at {after_enable}) and then published once"
    ));
}

/// (h) Inherited AD-12: a local-only dataset runs no sync code — no host, so no actor, no
/// client and no request, and no tick ever changes that.
#[tokio::test(start_paused = true)]
async fn sync_e2e_h_a_local_only_dataset_runs_no_sync_code() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    let mut actor = actor_for(host.local_only());

    let fault = actor.enable(None).await.expect_err("a local profile cannot sync");

    assert_eq!(fault.code(), "local_only");
    assert_eq!(actor.status().state, SyncState::Unlinked);
    assert_eq!(cloud.calls(), 0);

    for name in ["one", "two"] {
        edit_then_settle(&mut actor, &probe, name).await;
    }

    assert_eq!(cloud.calls(), 0, "and no tick ever changes that");
    assert_eq!(actor.diagnostics().uploads, 0);
    assert_eq!(probe.rows().len(), 2, "the local app works as it always did");
    report(
        "(h) a local-only dataset refused with local_only and made 0 requests across 2 \
         edits and 4 ticks"
            .to_string(),
    );
}

/// (i) AD-7. Two refusals, both without touching the cloud copy: a prefix owned by another
/// user-pool `sub`, and a dataset pinned to another account.
#[tokio::test(start_paused = true)]
async fn sync_e2e_i_an_owner_or_pin_mismatch_refuses_to_sync() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, _computer_b, _b) = two_computers(&cloud);
    cloud.seed(
        crate::sync::owner::OWNER_OBJECT_KEY,
        br#"{"created_ms":1,"identity_id":"us-east-1:0000","sub":"somebody-else","v":1}"#.to_vec(),
    );

    let owner_fault = computer_a
        .enable(None)
        .await
        .expect_err("a foreign owner refuses");

    assert_eq!(owner_fault.code(), "owner_mismatch");
    assert!(!owner_fault.recoverable());
    assert_eq!(computer_a.status().state, SyncState::Error);
    assert_eq!(a.frozen_reason(), Some(FrozenReason::OwnerMismatch));
    assert!(
        cloud.stored(SNAP_LATEST_KEY).is_none(),
        "a refused computer publishes nothing"
    );

    // The other half of AD-7, which the harness's fixed gate state cannot express: a
    // dataset already pinned to another account refuses before any credential is usable.
    let before = cloud.calls();
    let gate = SyncGate::new(DatasetKind::CloudLinked, Entitled, PinnedElsewhere);
    let blocked = gate
        .check(Some(&AccountPin::new(FAKE_IDENTITY_ID, FAKE_OWNER_SUB)))
        .await
        .expect_err("a dataset pinned to another account refuses");

    assert!(
        matches!(blocked, SyncBlocked::PinMismatch { .. }),
        "expected a pin mismatch, got {blocked:?}"
    );
    assert_eq!(cloud.calls(), before, "a refused gate makes no request");
    report(format!(
        "(i) a foreign owner object refused with {} and a dataset pinned to another account \
         refused with {:?}, with 0 writes to the cloud",
        owner_fault.code(),
        blocked
    ));
}

/// AD-16's redaction, proven on a dataset whose every text column holds a sentinel: the
/// document the user hands to support carries counts, states, timings and codes, and not
/// one byte of what is in the database.
#[tokio::test(start_paused = true)]
async fn sync_e2e_diagnostics_export_carries_no_value_from_the_dataset() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, _computer_b, _b) = two_computers(&cloud);
    let shape: HeavyYearShape = seed_heavy_year_into(a.db_path());
    let stamp = a.read(stamp_text_columns_with_sentinels);

    assert!(
        stamp.stamped.len() >= 20,
        "the proof is only as wide as the columns it stamped: {:?}",
        stamp.stamped
    );
    // The control: the string the assertion below searches for has to be IN the dataset,
    // or "no sentinel in the export" would be true of an export of nothing.
    assert!(
        a.read(crate::db::test_dataset::marker_rows)
            .iter()
            .any(|name| name.starts_with(SENTINEL_PREFIX)),
        "the stamp must be readable back out of the dataset"
    );

    computer_a.enable(None).await.expect("A enables");
    // A fault as well as a success, so the document carries an error code and more than one
    // transition rather than only the happy path's.
    cloud.fail_next(
        FakeOp::PutImmutable,
        crate::sync::store::StoreError::Transport {
            operation: crate::sync::store::StoreOp::PutImmutable,
            status: None,
            code: None,
            retryable: true,
        },
    );
    edit_then_settle(&mut computer_a, &a, "SENTINEL-later-edit").await;

    let diagnostics = computer_a.diagnostics();
    let rendered = crate::commands::sync::diagnostics_json(
        &diagnostics,
        &crate::commands::sync::ExportEnvironment {
            app_version: "0.1.6".to_string(),
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            generated_ms: 1_760_000_000_000,
        },
    )
    .expect("the document renders");

    assert!(
        !rendered.contains(SENTINEL_PREFIX),
        "a stamped value reached the export: {rendered}"
    );
    assert!(
        !rendered.contains(&diagnostics.dataset_id),
        "the dataset id is an identifier, not a count, a state, a timing or a code"
    );
    for identifier in [FAKE_IDENTITY_ID, FAKE_OWNER_SUB] {
        assert!(
            !rendered.contains(identifier),
            "{identifier} is an account identifier and must be omitted"
        );
    }
    let parsed: serde_json::Value = serde_json::from_str(&rendered).expect("valid JSON");
    assert_eq!(parsed["export_version"], 1);
    assert!(
        parsed["sync"]["transitions"]
            .as_array()
            .is_some_and(|transitions| transitions.len() >= 2),
        "AD-16 asks for transitions, not just the current state"
    );
    assert_eq!(parsed["sync"]["last_error_code"], "offline");
    assert_eq!(parsed["counts"]["uploads"], 1);
    assert!(parsed["counts"]["local_rows"].as_i64().unwrap_or(0) > shape.expenses as i64);

    report(format!(
        "(AD-16) {} stamped text columns ({} refused by a CHECK) and {} rows produced a {} B \
         report with 0 sentinels, 0 identifiers, {} transitions and error code {}",
        stamp.stamped.len(),
        stamp.refused.len(),
        parsed["counts"]["local_rows"],
        rendered.len(),
        parsed["sync"]["transitions"].as_array().map_or(0, Vec::len),
        parsed["sync"]["last_error_code"],
    ));
}

/// The harness's own claim: two computers really are two computers. Nothing else in this
/// file means anything if they share a directory, a dataset or an install identity.
#[test]
fn sync_e2e_the_two_computers_share_nothing_but_the_cloud() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (_first, a) = test_computer("A", Arc::clone(&cloud), 1_700_000_000_000);
    let (_second, b) = test_computer("B", Arc::clone(&cloud), 1_800_000_000_000);

    assert_ne!(a.root(), b.root());
    assert_ne!(a.db_path(), b.db_path());
    assert!(!a.db_path().starts_with(b.root()));
    assert!(!b.db_path().starts_with(a.root()));
    assert!(Arc::ptr_eq(a.store(), b.store()), "one cloud account");
    report(format!(
        "(harness) two independent app-data roots over one cloud: {} and {}",
        a.root().display(),
        b.root().display()
    ));
}

/// A status payload the UI switches on is part of the proof too: Story 11's indicator reads
/// nothing else.
#[tokio::test(start_paused = true)]
async fn sync_e2e_the_status_payload_the_ui_reads_is_serializable_at_every_step() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut computer_a, a, _computer_b, _b) = two_computers(&cloud);
    let mut seen = Vec::new();
    let mut record = |payload: SyncStatusPayload| {
        serde_json::to_string(&payload).expect("the payload serializes");
        seen.push(payload.state);
    };

    record(computer_a.status());
    a.write_row("one");
    computer_a.enable(None).await.expect("enable");
    record(computer_a.status());
    edit_then_settle(&mut computer_a, &a, "two").await;
    record(computer_a.status());

    assert_eq!(
        seen,
        vec![SyncState::Unlinked, SyncState::Idle, SyncState::Idle]
    );
    report(format!("(ui) statuses observed: {seen:?}"));
}
