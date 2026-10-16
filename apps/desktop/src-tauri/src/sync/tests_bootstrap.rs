//! Bootstrap, the CAP-5 link choice and the CAP-2 timing gate, against Story 8's fake
//! object store and heavy-year dataset.
//!
//! The fake is the real protocol (create-only, `If-Match`, `304`, `412`, `409`, `404`) with
//! a call counter and a byte-proportional throttle, so "a local-only dataset makes zero
//! requests" and "a 10 Mbps link delivers this object in N seconds" are both assertions
//! about behaviour rather than about a return value.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tempfile::TempDir;

use crate::datasets::DB_FILE_NAME;
use crate::db::backup::{local_data_summary, DatasetSlot, LocalData};
use crate::db::sync_state::FrozenReason;
use crate::db::test_dataset::{heavy_year_dataset, HeavyYear};
use crate::db::{open_configured, run_migrations_up_to};
use crate::error::AppError;
use crate::models::DatasetKind;
use crate::sync::auth::{AccountPin, AuthError};
use crate::sync::bootstrap::{
    apply_choice, assess, measure_link, restore_latest, BootstrapError, BootstrapPlan, LinkChoice,
    LinkOutcome, ReplaceTarget, RestoreTarget, SeparateContext, CAP2_BUDGET,
    CAP2_BYTES_PER_SECOND,
};
use crate::sync::owner::{owner_object_body, OWNER_OBJECT_KEY};
use crate::sync::snapshot::{
    build_snapshot, BuiltSnapshot, LatestSnapshot, SnapshotError, SNAP_LATEST_KEY,
};
use crate::sync::store::StoreError;
use crate::sync::test_support::{gated_fake, syncing_fake, FakeGatedStore, FakeObjectStore, FakeOp};

/// The identity the Story-8 fake answers for, and the account the heavy-year fixture's
/// `sync_state` row is pinned to.
const IDENTITY: &str = "us-east-1:0000";
const SUB: &str = "sub-0";

fn pin() -> AccountPin {
    AccountPin::new(IDENTITY, SUB)
}

fn schema_version() -> u32 {
    u32::try_from(crate::db::latest_schema_version()).expect("the schema version fits")
}

/// A dataset that nothing else has open, with its connection held so a test can read what
/// the restore produced.
struct HeldDataset {
    held: Mutex<Option<Connection>>,
    closes: std::sync::atomic::AtomicUsize,
}

impl HeldDataset {
    fn opening(db_path: &Path) -> Self {
        Self {
            held: Mutex::new(Some(
                open_configured(db_path).expect("the dataset opens"),
            )),
            closes: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn with<T>(&self, read: impl FnOnce(&Connection) -> T) -> T {
        let held = self.held.lock().expect("not poisoned");

        read(held.as_ref().expect("the slot holds a connection"))
    }
}

impl DatasetSlot for HeldDataset {
    fn close(&self) -> Result<(), AppError> {
        self.closes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        drop(self.held.lock().expect("not poisoned").take());

        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), AppError> {
        *self.held.lock().expect("not poisoned") = Some(conn);

        Ok(())
    }
}

/// A brand-new computer's dataset: migrated and empty.
fn fresh_dataset() -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join(DB_FILE_NAME);
    drop(open_configured(&db_path).expect("the dataset opens"));

    (dir, db_path)
}

fn empty_summary() -> LocalData {
    LocalData::default()
}

fn summary_of(db_path: &Path) -> LocalData {
    let conn = open_configured(db_path).expect("the dataset opens");

    local_data_summary(&conn).expect("the summary reads")
}

/// A cloud that holds the owner object and a published snapshot of `source`.
async fn published_cloud(source: &Path) -> (Arc<FakeObjectStore>, FakeGatedStore, BuiltSnapshot) {
    let store = Arc::new(FakeObjectStore::default());
    let built = build_snapshot(source, schema_version())
        .await
        .expect("the snapshot builds");

    store.seed(OWNER_OBJECT_KEY, owner_object_body(&pin(), 1_760_000_000_000));
    store.seed(&built.key(), built.object.clone());
    store.seed(
        SNAP_LATEST_KEY,
        LatestSnapshot {
            snap_id: built.snap_id.clone(),
            hash: built.payload_sha256.clone(),
            schema_version: built.schema_version,
            created_ms: 1_760_000_000_000,
            watermark: Default::default(),
            carries_identities: true,
        }
        .body(),
    );

    let gated = syncing_fake(Arc::clone(&store));

    (store, gated, built)
}

fn latest_of(built: &BuiltSnapshot) -> LatestSnapshot {
    LatestSnapshot {
        snap_id: built.snap_id.clone(),
        hash: built.payload_sha256.clone(),
        schema_version: built.schema_version,
        created_ms: 1_760_000_000_000,
            watermark: Default::default(),
            carries_identities: true,
    }
}

pub(super) fn config_map(conn: &Connection) -> std::collections::BTreeMap<String, String> {
    let mut statement = conn
        .prepare("SELECT key, value FROM config")
        .expect("the config read prepares");
    statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("the config reads")
        .collect::<Result<_, _>>()
        .expect("the config collects")
}

pub(super) fn tables(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table'
               AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
               AND name NOT LIKE 'sync\\_%' ESCAPE '\\'
             ORDER BY name",
        )
        .expect("the table list prepares");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("the table list reads")
        .collect::<Result<_, _>>()
        .expect("the table list collects")
}

/// Every row of `table`, rendered with its rowid so a comparison can tell "the same rows"
/// from "the same rows renumbered" — the property AD-9 forbids `VACUUM INTO` to protect.
pub(super) fn dump(conn: &Connection, table: &str, skip: &[&str]) -> Vec<String> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT _rowid_, * FROM \"{table}\" ORDER BY _rowid_"
        ))
        .expect("the row dump prepares");
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();

    let mut rows = statement.query([]).expect("the row dump runs");
    let mut dumped = Vec::new();
    while let Some(row) = rows.next().expect("a row reads") {
        let mut rendered = String::new();
        for (at, name) in names.iter().enumerate() {
            if skip.contains(&name.as_str()) {
                continue;
            }
            let value = row.get_ref(at).expect("a value reads");
            rendered.push_str(&format!("{value:?}|"));
        }
        dumped.push(rendered);
    }

    dumped
}

#[tokio::test]
async fn a_local_only_dataset_runs_no_bootstrap_code_and_reaches_no_network() {
    let store = Arc::new(FakeObjectStore::default());
    let gated = gated_fake(Arc::clone(&store), DatasetKind::Local, true, None);

    let refused = assess(&gated, &pin(), &empty_summary())
        .await
        .expect_err("a local profile must not bootstrap");

    assert!(matches!(
        refused,
        BootstrapError::Blocked(crate::sync::gate::SyncBlocked::LocalOnlyDataset)
    ));
    assert_eq!(store.calls(), 0, "a local-only dataset must make no request");
}

#[tokio::test]
async fn a_frozen_or_unentitled_account_transfers_nothing() {
    for (entitled, frozen) in [
        (false, None),
        (true, Some(FrozenReason::EntitlementLapsed)),
        (true, Some(FrozenReason::OwnerMismatch)),
    ] {
        let store = Arc::new(FakeObjectStore::default());
        let gated = gated_fake(Arc::clone(&store), DatasetKind::CloudLinked, entitled, frozen);

        assert!(matches!(
            assess(&gated, &pin(), &empty_summary()).await,
            Err(BootstrapError::Blocked(_))
        ));
        assert_eq!(store.calls(), 0, "entitled={entitled} frozen={frozen:?}");
    }
}

#[tokio::test]
async fn an_account_with_no_owner_object_is_a_first_enable_and_not_a_bootstrap() {
    let store = Arc::new(FakeObjectStore::default());
    let gated = syncing_fake(Arc::clone(&store));

    assert_eq!(
        assess(&gated, &pin(), &empty_summary())
            .await
            .expect("the assessment succeeds"),
        BootstrapPlan::FirstEnable
    );
    assert_eq!(
        store.calls(),
        1,
        "an absent owner must be concluded from the owner GET alone"
    );
}

#[tokio::test]
async fn an_owner_object_naming_a_different_account_refuses_to_sync() {
    let store = Arc::new(FakeObjectStore::default());
    store.seed(
        OWNER_OBJECT_KEY,
        owner_object_body(&AccountPin::new(IDENTITY, "somebody-else"), 1),
    );
    let gated = syncing_fake(Arc::clone(&store));

    assert_eq!(
        assess(&gated, &pin(), &empty_summary()).await,
        Err(BootstrapError::OwnerMismatch)
    );
    assert_eq!(
        store.calls(),
        1,
        "nothing beyond the owner object may be read once the account disagrees"
    );
}

#[tokio::test]
async fn a_malformed_owner_object_is_never_read_as_an_absent_one() {
    let store = Arc::new(FakeObjectStore::default());
    store.seed(OWNER_OBJECT_KEY, b"{}".to_vec());
    let gated = syncing_fake(Arc::clone(&store));

    assert_eq!(
        assess(&gated, &pin(), &empty_summary()).await,
        Err(BootstrapError::Auth(AuthError::MalformedOwnerObject))
    );
}

#[tokio::test]
async fn an_owner_without_a_published_snapshot_has_nothing_to_restore() {
    let store = Arc::new(FakeObjectStore::default());
    store.seed(OWNER_OBJECT_KEY, owner_object_body(&pin(), 1));
    let gated = syncing_fake(Arc::clone(&store));

    assert_eq!(
        assess(&gated, &pin(), &empty_summary())
            .await
            .expect("the assessment succeeds"),
        BootstrapPlan::NoSnapshot
    );
}

#[tokio::test]
async fn an_empty_dataset_restores_without_a_choice_and_one_with_data_requires_it() {
    let heavy = heavy_year_dataset();
    let (_store, gated, built) = published_cloud(&heavy.db_path).await;

    assert!(matches!(
        assess(&gated, &pin(), &empty_summary())
            .await
            .expect("the assessment succeeds"),
        BootstrapPlan::Restore { latest, .. } if latest.snap_id == built.snap_id
    ));

    let local = summary_of(&heavy.db_path);
    assert!(!local.is_empty(), "the heavy-year fixture holds user data");

    let plan = assess(&gated, &pin(), &local)
        .await
        .expect("the assessment succeeds");
    let BootstrapPlan::ChoiceRequired { local: counted, .. } = plan else {
        panic!("a dataset with data must raise the CAP-5 choice, got {plan:?}");
    };
    assert_eq!(counted, local);
}

#[tokio::test]
async fn a_snapshot_from_a_newer_build_is_refused_before_it_is_downloaded() {
    let heavy = heavy_year_dataset();
    let (store, gated, built) = published_cloud(&heavy.db_path).await;
    let newer = schema_version() + 1;
    store.seed(
        SNAP_LATEST_KEY,
        LatestSnapshot {
            snap_id: built.snap_id.clone(),
            hash: built.payload_sha256.clone(),
            schema_version: newer,
            created_ms: 1,
            watermark: Default::default(),
            carries_identities: true,
        }
        .body(),
    );
    let before = store.transferred_bytes();

    assert_eq!(
        assess(&gated, &pin(), &empty_summary()).await,
        Err(BootstrapError::SnapshotTooNew {
            found: newer,
            supported: schema_version(),
        })
    );
    assert!(
        store.transferred_bytes() - before < built.object.len() as u64,
        "the snapshot object must not have been fetched"
    );
}

#[tokio::test]
async fn a_tampered_snapshot_object_is_refused_rather_than_written_over_the_dataset() {
    let heavy = heavy_year_dataset();
    let (store, gated, built) = published_cloud(&heavy.db_path).await;

    let mut tampered = built.object.clone();
    let at = tampered.len() / 2;
    tampered[at] ^= 0xff;
    store.seed(&built.key(), tampered);

    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);

    let refused = restore_latest(
        &gated,
        &latest_of(&built),
        &RestoreTarget {
            db_path: &db_path,
            dated_backup_dir: None,
        },
        &slot,
    )
    .await
    .expect_err("a tampered object must be refused");

    assert!(
        matches!(
            refused,
            BootstrapError::Snapshot(SnapshotError::Corrupt | SnapshotError::HashMismatch { .. })
        ),
        "got {refused:?}"
    );
    assert_eq!(
        slot.closes.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "the dataset must not even be closed for an object that failed verification"
    );
}

/// `snap/LATEST` is another computer's claim about which object is current. A valid
/// snapshot that is not the one the pointer names (a stale mirror, a cache) has to be
/// refused too, which the object's own header cannot catch.
#[tokio::test]
async fn a_snapshot_that_is_not_the_one_the_pointer_names_is_refused() {
    let heavy = heavy_year_dataset();
    let (_store, gated, built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);

    let mut lying = latest_of(&built);
    lying.hash = "0".repeat(64);

    let refused = restore_latest(
        &gated,
        &lying,
        &RestoreTarget {
            db_path: &db_path,
            dated_backup_dir: None,
        },
        &slot,
    )
    .await
    .expect_err("a mismatched pointer must be refused");

    assert!(
        matches!(
            refused,
            BootstrapError::Snapshot(SnapshotError::HashMismatch { .. })
        ),
        "got {refused:?}"
    );
}

#[tokio::test]
async fn a_pointer_that_does_not_name_a_snapshot_is_refused_before_any_request() {
    let heavy = heavy_year_dataset();
    let (store, gated, built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);
    let before = store.calls();

    let mut lying = latest_of(&built);
    lying.snap_id = "../owner".to_string();

    assert_eq!(
        restore_latest(
            &gated,
            &lying,
            &RestoreTarget {
                db_path: &db_path,
                dated_backup_dir: None,
            },
            &slot,
        )
        .await,
        Err(BootstrapError::Snapshot(SnapshotError::MalformedLatest))
    );
    assert_eq!(store.calls(), before, "no request may be sent for it");
}

#[tokio::test]
async fn a_heavy_year_snapshot_restores_into_a_fresh_data_dir_minus_what_is_stripped() {
    let heavy = heavy_year_dataset();
    let (_store, gated, built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);

    let report = restore_latest(
        &gated,
        &latest_of(&built),
        &RestoreTarget {
            db_path: &db_path,
            dated_backup_dir: None,
        },
        &slot,
    )
    .await
    .expect("the bootstrap succeeds");

    assert_eq!(report.snap_id, built.snap_id);
    assert!(!report.migrated, "the snapshot is at this build's schema");
    assert_eq!(
        slot.closes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the dataset is closed exactly once, before the swap"
    );

    let source = open_configured(&heavy.db_path).expect("the source opens");
    slot.with(|restored| {
        assert_eq!(
            tables(restored).into_iter().collect::<BTreeSet<_>>(),
            tables(&source).into_iter().collect::<BTreeSet<_>>()
        );

        for table in tables(&source) {
            match table.as_str() {
                // The three AD-5 deny-listed keys are stripped and the user's own settings
                // are not. Read as a map rather than dumped, because deleting rows leaves
                // `config`'s rowids with gaps the source does not have.
                "config" => {
                    let mut expected = config_map(&source);
                    for key in crate::db::config::LOCAL_ONLY_KEYS {
                        assert!(
                            expected.remove(*key).is_some(),
                            "the fixture must set {key} for the strip to be observable"
                        );
                    }
                    assert_eq!(config_map(restored), expected);
                }
                // AD-10: the bytes are lazy, everything else about the image travels.
                "project_images" => {
                    assert_eq!(
                        dump(restored, &table, &["image_bytes"]),
                        dump(&source, &table, &["image_bytes"])
                    );
                }
                _ => assert_eq!(
                    dump(restored, &table, &[]),
                    dump(&source, &table, &[]),
                    "{table} differs"
                ),
            }
        }

        let lazy: Vec<(Option<usize>, i64, Option<usize>)> = {
            let mut statement = restored
                .prepare(
                    "SELECT image_bytes, byte_size, thumbnail_bytes FROM project_images
                     ORDER BY project_id",
                )
                .expect("prepare");
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, Option<Vec<u8>>>(0)?.map(|bytes| bytes.len()),
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<Vec<u8>>>(2)?.map(|bytes| bytes.len()),
                    ))
                })
                .expect("read")
                .collect::<Result<_, _>>()
                .expect("collect")
        };
        assert_eq!(lazy.len(), heavy.project_images);
        for (image, byte_size, thumbnail) in lazy {
            assert_eq!(image, None, "full images must arrive lazily (AD-10)");
            assert_eq!(byte_size, heavy.image_payload_bytes as i64);
            assert!(thumbnail.is_some(), "thumbnails travel in the snapshot");
        }

        // The new computer's own install identity, not the one that built the snapshot.
        assert_eq!(
            crate::db::sync_state::load(restored).expect("the state reads"),
            None,
            "an empty dataset had no sync state to carry, and the snapshot carries none"
        );
    });
}

#[tokio::test]
async fn an_older_snapshot_is_migrated_on_the_way_in() {
    let dir = TempDir::new().expect("temp dir");
    let older_path = dir.path().join("older.db");
    {
        let conn = Connection::open(&older_path).expect("the older dataset opens");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("pragmas");
        run_migrations_up_to(&conn, 18).expect("an older schema");
        conn.execute("INSERT INTO budget_groups (id, name) VALUES (1, 'older')", [])
            .expect("a row");
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }

    // Framed by hand rather than through `build_snapshot`: its strip touches tables an
    // older schema does not have yet, and what is under test here is the *restore* of an
    // object a previous app version wrote.
    let payload = std::fs::read(&older_path).expect("the older database reads");
    let digest: [u8; 32] = <sha2::Sha256 as sha2::Digest>::digest(&payload).into();
    let object = crate::sync::object::ObjectHeader::new(18, digest).frame(
        &zstd::encode_all(
            payload.as_slice(),
            crate::sync::snapshot::SNAPSHOT_COMPRESSION_LEVEL,
        )
        .expect("the payload compresses"),
    );
    let latest = LatestSnapshot {
        snap_id: crate::sync::object::hex_lower(&digest),
        hash: crate::sync::object::hex_lower(&digest),
        schema_version: 18,
        created_ms: 1,
            watermark: Default::default(),
            carries_identities: true,
    };

    let store = Arc::new(FakeObjectStore::default());
    store.seed(OWNER_OBJECT_KEY, owner_object_body(&pin(), 1));
    store.seed(
        &latest.snapshot_key().expect("the key is well formed"),
        object,
    );
    let gated = syncing_fake(Arc::clone(&store));

    let (_target_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);

    let report = restore_latest(
        &gated,
        &latest,
        &RestoreTarget {
            db_path: &db_path,
            dated_backup_dir: None,
        },
        &slot,
    )
    .await
    .expect("the bootstrap succeeds");

    assert_eq!(report.schema_version, 18);
    assert!(report.migrated);
    slot.with(|conn| {
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .expect("the version reads");
        assert_eq!(version, crate::db::latest_schema_version());
        assert_eq!(
            conn.query_row("SELECT name FROM budget_groups WHERE id = 1", [], |row| row
                .get::<_, String>(0))
                .expect("the row survived"),
            "older"
        );
    });
}

/// CAP-5 *replace*: the cloud copy is loaded and the displaced file is kept, intact, as a
/// dated backup.
#[tokio::test]
async fn replace_loads_the_cloud_copy_and_keeps_the_old_file_as_a_dated_backup() {
    let heavy = heavy_year_dataset();
    let (_store, gated, built) = published_cloud(&heavy.db_path).await;

    let dir = TempDir::new().expect("temp dir");
    let db_path = dir.path().join(DB_FILE_NAME);
    let backups = dir.path().join("backups");
    {
        let conn = open_configured(&db_path).expect("the dataset opens");
        conn.execute(
            "INSERT INTO budget_groups (id, name) VALUES (1, 'what this computer had')",
            [],
        )
        .expect("a row");
        crate::db::sync_state::ensure(
            &conn,
            "0123456789abcdef",
            "ab00000000000000000000000000000000000000000000000000000000000000",
        )
        .expect("the install identity");
        crate::db::sync_state::set_pin(&conn, IDENTITY, SUB).expect("the pin");
    }
    let slot = HeldDataset::opening(&db_path);

    let outcome = apply_choice(
        &gated,
        &latest_of(&built),
        LinkChoice::Replace,
        &ReplaceTarget {
            db_path: &db_path,
            dated_backup_dir: &backups,
        },
        &SeparateContext {
            root: dir.path(),
            kept_dataset_id: "default",
            owner_sub: SUB,
            label: "Nixus Cloud",
        },
        &slot,
    )
    .await
    .expect("replace succeeds");

    let LinkOutcome::Replaced { report } = outcome else {
        panic!("replace must report a replacement");
    };
    let backup = report.swap.dated_backup.expect("a dated backup was kept");

    let kept = open_configured(&backup).expect("the dated backup opens");
    assert_eq!(
        kept.query_row("SELECT name FROM budget_groups WHERE id = 1", [], |row| row
            .get::<_, String>(0))
            .expect("the displaced data is in the backup"),
        "what this computer had"
    );
    slot.with(|conn| {
        let expenses: i64 = conn
            .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
            .expect("count");
        assert_eq!(expenses, heavy.expenses as i64, "the cloud copy is now live");

        // The restored dataset keeps its identity link: same install id, same account.
        let state = crate::db::sync_state::load(conn)
            .expect("the state reads")
            .expect("the row was carried over the swap");
        assert_eq!(state.install_id, "0123456789abcdef");
        assert_eq!(state.identity_id.as_deref(), Some(IDENTITY));
        assert_eq!(state.owner_sub.as_deref(), Some(SUB));
    });
}

/// CAP-5 *separate*: the cloud copy goes into a profile of its own and the existing file is
/// not even opened for writing — asserted on the bytes, which is the only claim that
/// cannot be satisfied by a careful rewrite.
#[tokio::test]
async fn separate_leaves_the_existing_file_byte_identical_and_links_a_new_profile() {
    let heavy = heavy_year_dataset();
    let (_store, gated, built) = published_cloud(&heavy.db_path).await;

    let root = TempDir::new().expect("temp dir");
    crate::datasets::bootstrap_registry_at(root.path()).expect("the registry exists");
    let kept_path = root.path().join(DB_FILE_NAME);
    {
        let conn = open_configured(&kept_path).expect("the dataset opens");
        conn.execute(
            "INSERT INTO budget_groups (id, name) VALUES (1, 'what this computer had')",
            [],
        )
        .expect("a row");
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }
    let before = std::fs::read(&kept_path).expect("readable");

    let outcome = apply_choice(
        &gated,
        &latest_of(&built),
        LinkChoice::Separate,
        &ReplaceTarget {
            db_path: &kept_path,
            dated_backup_dir: &root.path().join("backups"),
        },
        &SeparateContext {
            root: root.path(),
            kept_dataset_id: "default",
            owner_sub: SUB,
            label: "Nixus Cloud",
        },
        &crate::db::backup::UnopenedDataset,
    )
    .await
    .expect("separate succeeds");

    let LinkOutcome::Separated { dataset, report } = outcome else {
        panic!("separate must report a new dataset");
    };

    assert_eq!(dataset.kind, DatasetKind::CloudLinked);
    assert_eq!(dataset.cognito_sub.as_deref(), Some(SUB));
    assert_eq!(dataset.linked_from.as_deref(), Some("default"));
    assert_eq!(report.snap_id, built.snap_id);
    assert_eq!(
        report.swap.dated_backup, None,
        "a profile created empty has nothing to back up"
    );

    assert_eq!(
        std::fs::read(&kept_path).expect("readable"),
        before,
        "separate must leave the existing dataset byte-identical"
    );
    // The claim behind "unsynced": a later sign-in for this account resolves to the NEW
    // profile, so the kept one is never reopened as the synced dataset.
    assert_eq!(
        crate::datasets::find_or_create_cloud_dataset_at(root.path(), SUB, "Nixus Cloud")
            .expect("the registry resolves")
            .id,
        dataset.id
    );

    let separated = open_configured(&crate::datasets::dataset_db_path(
        root.path(),
        &dataset.id,
    ))
    .expect("the separated dataset opens");
    let expenses: i64 = separated
        .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
        .expect("count");
    assert_eq!(expenses, heavy.expenses as i64);
}

/// CAP-2, the release gate (AD-19): "usable within 5 s on a 10 Mbps connection, for
/// datasets up to about 10 MB (images excluded), measured from login complete".
///
/// The clock is split the way the capability is stated. The network leg is modelled from
/// the object's size at exactly 10 Mbps — `FakeObjectStore::throttle_to` sleeps in
/// proportion to the bytes it hands over, and `start_paused` makes that virtual time, so
/// the modelled figure is exact and reproducible rather than a measurement of this
/// machine's loopback. Everything else (verify, decompress, write the file, migrate,
/// reopen, query it) is real work on a real disk and is real measured time.
///
/// Two assertions, both meaningful:
/// - the model total is inside CAP-2's 5 s — the claim itself;
/// - the measured non-network part is inside `NON_NETWORK_CEILING`, which is roughly 3x the
///   debug-build measurement on a developer machine. A slow macOS or Windows runner
///   therefore has headroom, while a change that makes the restore an order of magnitude
///   slower still fails here instead of silently eating the whole budget.
#[tokio::test(start_paused = true)]
async fn the_new_computer_link_fits_in_the_cap2_budget_against_a_heavy_year_dataset() {
    /// Measured at 0.70 s on a developer machine (debug build, macOS, 14.95 MB payload
    /// from a 2.13 MB object). The ceiling is ~3x that, and deliberately low enough that
    /// even a run which only just passes it stays inside CAP-2: 1.705 s modelled + 2.2 s
    /// = 3.9 s of the 5 s budget. So the two assertions can never disagree, and an
    /// order-of-magnitude regression still fails here.
    const NON_NETWORK_CEILING: std::time::Duration = std::time::Duration::from_millis(2_200);

    let heavy = heavy_year_dataset();
    let (store, gated, _built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);

    // Set after the arrangement above so seeding the cloud costs nothing: the gate measures
    // the link, not the fixture.
    store.throttle_to(CAP2_BYTES_PER_SECOND);
    let counted = Arc::clone(&store);

    let (outcome, budget) = measure_link(
        async {
            let plan = assess(&gated, &pin(), &empty_summary()).await?;
            let BootstrapPlan::Restore { latest, .. } = plan else {
                panic!("an empty dataset must restore without a choice, got {plan:?}");
            };

            let report = restore_latest(
                &gated,
                &latest,
                &RestoreTarget {
                    db_path: &db_path,
                    dated_backup_dir: None,
                },
                &slot,
            )
            .await?;

            // "Usable" is the claim, so the data is actually read before the clock stops.
            let expenses: i64 = slot.with(|conn| {
                conn.query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
                    .expect("the restored dataset answers a query")
            });

            Ok::<_, BootstrapError>((report, expenses))
        },
        || counted.transferred_bytes(),
    )
    .await;

    let (report, expenses) = outcome.expect("the link succeeds");
    assert_eq!(expenses, heavy.expenses as i64);

    println!(
        "{}\n  object {} B (payload {} B), owner + LATEST + snapshot in {} requests",
        budget.breakdown(),
        report.object_bytes,
        report.payload_bytes,
        store.calls()
    );

    assert!(
        budget.measured <= NON_NETWORK_CEILING,
        "the CPU/disk half of the link took {:?}, over the {:?} ceiling",
        budget.measured,
        NON_NETWORK_CEILING
    );
    assert!(
        budget.within_budget(),
        "the modelled link took {:?}, over CAP-2's {:?}: {}",
        budget.model_total(),
        CAP2_BUDGET,
        budget.breakdown()
    );
}

/// The throttle has to be the thing that dominates, or the gate above would be measuring
/// the fixture instead of the link.
#[tokio::test(start_paused = true)]
async fn the_modelled_network_leg_matches_the_object_that_actually_moved() {
    let heavy: HeavyYear = heavy_year_dataset();
    let (store, gated, built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let slot = HeldDataset::opening(&db_path);
    store.throttle_to(CAP2_BYTES_PER_SECOND);
    let counted = Arc::clone(&store);

    let (outcome, budget) = measure_link(
        restore_latest(
            &gated,
            &latest_of(&built),
            &RestoreTarget {
                db_path: &db_path,
                dated_backup_dir: None,
            },
            &slot,
        ),
        || counted.transferred_bytes(),
    )
    .await;

    outcome.expect("the restore succeeds");

    assert_eq!(
        budget.transferred_bytes,
        built.object.len() as u64,
        "only the snapshot object crosses the wire on this path"
    );
    assert_eq!(store.calls_of(FakeOp::Get), 1);
    assert!(
        budget.network_model() >= std::time::Duration::from_millis(500),
        "a heavy year must model as a real download, not a rounding error"
    );
}

#[tokio::test]
async fn a_transport_fault_leaves_the_dataset_untouched() {
    let heavy = heavy_year_dataset();
    let (store, gated, built) = published_cloud(&heavy.db_path).await;
    let (_dir, db_path) = fresh_dataset();
    let before = std::fs::read(&db_path).expect("readable");
    let slot = HeldDataset::opening(&db_path);
    store.fail_next(FakeOp::Get, StoreError::ConditionalConflict);

    assert_eq!(
        restore_latest(
            &gated,
            &latest_of(&built),
            &RestoreTarget {
                db_path: &db_path,
                dated_backup_dir: None,
            },
            &slot,
        )
        .await,
        Err(BootstrapError::Store(StoreError::ConditionalConflict))
    );
    assert_eq!(
        slot.closes.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "a failed download must not close the dataset"
    );
    assert_eq!(std::fs::read(&db_path).expect("readable"), before);
}

/// AD-6's lock order is registry then active, and AD-9's "the manager closes its
/// connection before any file swap" is the `DatasetSlot` seam. Both are properties of which
/// names this file may mention, which is what makes them checkable.
#[test]
fn the_bootstrap_never_reaches_for_the_active_dataset_lock_or_for_sql() {
    let source = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/sync/bootstrap.rs"),
    )
    .expect("sync/bootstrap.rs is readable");

    let needles = [
        "DbState",
        "select_dataset_now",
        "ActiveDataset",
        "Connection",
        "SELECT ",
        "INSERT ",
        "PRAGMA ",
    ];
    let offenders: Vec<String> = source
        .lines()
        .enumerate()
        .map(|(index, line)| (index + 1, line.trim()))
        .filter(|(_, line)| !line.starts_with("//") && !line.starts_with("///"))
        .filter(|(_, line)| needles.iter().any(|needle| line.contains(needle)))
        .map(|(number, line)| format!("sync/bootstrap.rs:{number}: {line}"))
        .collect();

    assert!(
        offenders.is_empty(),
        "sync/bootstrap.rs must take no database connection, run no SQL and never touch \
         the active-dataset lock (AD-6 lock order, AD-9 closed connections):\n{}",
        offenders.join("\n")
    );
}
