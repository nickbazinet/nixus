//! AD-3 and AD-5 on the write paths Story 18 migrated: projects, the car module, chat, `config`
//! and the audit log.
//!
//! The write-site budget (`tests_write_site_budget.rs`) is the structural half — it proves no SQL
//! write was left outside `ActiveDataset::write`. This file is the behavioural half for the
//! domains Story 18 owns, plus the three AD-5 rules that only exist here: `config` is synced
//! EXCEPT the credential-state deny list, `audit_log` is append-only, and the audit helper is not
//! reachable from the apply path.

use std::collections::BTreeSet;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::sync_capture::{self, StoredMessage};
use crate::db::{
    audit as audit_db, chat as chat_db, config as config_db, maintenance as maintenance_db,
    projects as projects_db, stock as stock_db, sync_identity, test_dataset, ActiveDataset,
    WriteTx,
};
use crate::error::AppError;
use crate::models::{
    AddMaintenanceTaskInput, CreateProjectContributionInput, CreateProjectInput,
    CreateStockAssetInput, CreateVehicleInput, DatasetKind, LogMaintenanceServiceInput,
    UpdateProjectInput, UpdateServiceLogInput, UpdateVehicleInput,
};

use super::capture::Capture;
use super::identity;

struct Replica {
    _dir: TempDir,
    dataset: ActiveDataset,
}

impl Replica {
    fn open() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));
        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .expect("capture is built")
            .expect("a cloud-linked dataset captures");
        capture.attach(&conn).expect("the hook is installed");

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("domain-capture-test".to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset
            .conn
            .as_ref()
            .expect("a replica has a connection")
    }

    fn messages(&self) -> Vec<StoredMessage> {
        sync_capture::all_messages(self.conn()).expect("the log reads")
    }

    fn clear_log(&self) {
        self.conn()
            .execute_batch("DELETE FROM sync_log")
            .expect("the log clears");
    }

    fn touched_tables(&self) -> BTreeSet<String> {
        self.messages()
            .into_iter()
            .map(|message| message.table_name)
            .collect()
    }

    fn kinds_for(&self, table: &str) -> Vec<String> {
        self.messages()
            .into_iter()
            .filter(|message| message.table_name == table)
            .map(|message| message.kind)
            .collect()
    }

    fn write<T>(
        &self,
        operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        self.dataset.write(operation)
    }

    fn seed_project(&self) -> i64 {
        self.write(|tx| {
            projects_db::insert_project(
                tx,
                &CreateProjectInput {
                    name: "Kitchen".to_string(),
                    target_cents: 500_000,
                    target_date: None,
                    priority: None,
                    icon: None,
                    color: None,
                },
            )
        })
        .expect("the project is seeded")
        .id
    }

    fn seed_vehicle(&self) -> i64 {
        self.write(|tx| {
            maintenance_db::insert_vehicle(
                tx,
                &CreateVehicleInput {
                    odometer_km: 10_000,
                    make: Some("Toyota".to_string()),
                    model: Some("Camry".to_string()),
                    year: Some(2020),
                    use_default_template: true,
                    custom_tasks: None,
                },
            )
        })
        .expect("the vehicle is seeded")
        .id
    }

    fn audit_rows(&self) -> i64 {
        self.conn()
            .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
            .expect("the audit count reads")
    }
}

/// A 13-byte IHDR plus the fixed colour-type tail: the same header `projects::image` parses, which
/// is all `upsert_project_image` ever reads.
fn png_bytes() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&16u32.to_be_bytes());
    bytes.extend_from_slice(&16u32.to_be_bytes());
    bytes.extend_from_slice(&[8, 2, 0, 0, 0]);

    bytes
}

#[test]
fn the_project_write_sites_are_captured() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    assert_eq!(replica.kinds_for("projects"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| {
            projects_db::update_project(
                tx,
                project_id,
                &UpdateProjectInput {
                    name: "New kitchen".to_string(),
                    target_cents: 600_000,
                    target_date: None,
                    priority: None,
                    icon: None,
                    color: None,
                },
            )
        })
        .expect("the project is renamed");
    assert_eq!(replica.kinds_for("projects"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| projects_db::archive_project(tx, project_id))
        .expect("the project is archived");
    assert_eq!(replica.kinds_for("projects"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| projects_db::reorder_projects(tx, &[]))
        .expect_err("an empty order is refused before any write");
    assert!(
        replica.touched_tables().is_empty(),
        "a refused write captures nothing"
    );
}

#[test]
fn the_project_contribution_write_sites_are_captured() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    let account_id = replica
        .write(|tx| {
            crate::db::account::insert_account(
                tx,
                &crate::models::CreateAccountInput {
                    name: "Savings".to_string(),
                    institution: "Test Bank".to_string(),
                    account_type: "savings".to_string(),
                    currency: "CAD".to_string(),
                },
            )
        })
        .expect("the account is seeded")
        .id;
    replica.clear_log();

    let contribution = replica
        .write(|tx| {
            projects_db::insert_project_contribution(
                tx,
                &CreateProjectContributionInput {
                    project_id,
                    account_id,
                    amount_cents: 25_000,
                    source: "manual".to_string(),
                    date: "2026-10-01".to_string(),
                },
            )
        })
        .expect("the contribution is created");
    assert_eq!(replica.kinds_for("project_contributions"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| projects_db::delete_project_contribution(tx, contribution.id))
        .expect("the contribution is deleted");
    assert_eq!(
        replica.kinds_for("project_contributions"),
        vec!["tombstone"]
    );
}

/// AD-10: the picture's metadata and its thumbnail travel as ordinary fields, and the full payload
/// does not travel at all — it rides a content-addressed blob instead. AD-2: `project_images` is
/// `Natural`, so the write would FAIL outright without the derived identity its insert site binds.
#[test]
fn a_project_image_travels_as_metadata_and_never_as_its_bytes() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    replica.clear_log();

    let bytes = png_bytes();
    replica
        .write(|tx| {
            projects_db::upsert_project_image(
                tx,
                project_id,
                &projects_db::ProjectImageWrite {
                    mime_type: "image/png",
                    original_filename: "cover.png",
                    bytes: &bytes,
                    thumbnail: Some((&bytes, "image/png")),
                },
            )
        })
        .expect("the image is stored");

    assert_eq!(replica.kinds_for("project_images"), vec!["field"]);

    let message = replica
        .messages()
        .into_iter()
        .find(|message| message.table_name == "project_images")
        .expect("the image produced a message");
    let payload = message.payload.expect("a field message carries a payload");
    let columns: BTreeSet<String> = super::capture::payload::decode_row(&payload)
        .expect("the row payload decodes")
        .into_iter()
        .map(|(name, _)| name)
        .collect();

    assert!(
        !columns.contains("image_bytes"),
        "AD-10: the full payload must never enter a message"
    );
    for travelling in ["image_sha256", "mime_type", "byte_size", "thumbnail_bytes"] {
        assert!(
            columns.contains(travelling),
            "{travelling} is what a replica rebuilds the row from"
        );
    }

    // The derived identity AD-2 requires: the picture carries its project's own uuid.
    let project = sync_identity::lookup(replica.conn(), "projects", project_id)
        .expect("the project identity reads")
        .expect("the project has an identity");
    let image = sync_identity::lookup(replica.conn(), "project_images", project_id)
        .expect("the image identity reads")
        .expect("the image has an identity");
    assert_eq!(image, identity::project_image(&project));
}

/// The thumbnail backfill writes to a row that may predate capture entirely, which is exactly the
/// case where a missing `Natural` mapping would fail the whole write (AD-2).
#[test]
fn the_thumbnail_backfill_binds_the_identity_it_needs() {
    let replica = Replica::open();
    let project_id = replica.seed_project();

    // Written with the hook detached, so the row exists with NO identity, like a picture stored
    // before this dataset was linked.
    let bytes = png_bytes();
    replica
        .dataset
        .write_uncaptured(|conn| {
            projects_db::upsert_project_image(
                conn,
                project_id,
                &projects_db::ProjectImageWrite {
                    mime_type: "image/png",
                    original_filename: "cover.png",
                    bytes: &bytes,
                    thumbnail: None,
                },
            )
            .map(|_| ())
        })
        .expect("the pre-capture image is stored");
    assert_eq!(
        sync_identity::lookup(replica.conn(), "project_images", project_id)
            .expect("the identity reads"),
        None,
        "an uncaptured write must bind nothing"
    );
    replica.clear_log();

    replica
        .write(|tx| projects_db::set_project_thumbnail(tx, project_id, (&bytes, "image/png")))
        .expect("the backfill succeeds on a row that predates capture");

    assert_eq!(replica.kinds_for("project_images"), vec!["field"]);
    assert!(
        sync_identity::lookup(replica.conn(), "project_images", project_id)
            .expect("the identity reads")
            .is_some()
    );
}

#[test]
fn the_maintenance_write_sites_are_captured() {
    let replica = Replica::open();
    let vehicle_id = replica.seed_vehicle();

    // Creating a vehicle seeds its default schedule, so one write touches both tables.
    assert_eq!(
        replica.touched_tables(),
        BTreeSet::from([
            "vehicles".to_string(),
            "maintenance_tasks".to_string()
        ])
    );

    replica.clear_log();
    replica
        .write(|tx| {
            maintenance_db::update_vehicle(
                tx,
                vehicle_id,
                &UpdateVehicleInput {
                    make: Some("Honda".to_string()),
                    model: None,
                    year: None,
                },
            )
        })
        .expect("the vehicle is edited");
    assert_eq!(replica.kinds_for("vehicles"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| maintenance_db::update_vehicle_odometer(tx, vehicle_id, 20_000))
        .expect("the odometer advances");
    assert_eq!(replica.kinds_for("vehicles"), vec!["field"]);

    let task = replica
        .write(|tx| {
            maintenance_db::add_maintenance_task(
                tx,
                &AddMaintenanceTaskInput {
                    vehicle_id,
                    task_type_key: None,
                    custom_task_name: Some("Detailing".to_string()),
                    interval_km: Some(20_000),
                    interval_months: Some(12),
                },
            )
        })
        .expect("the custom task is added");

    replica.clear_log();
    let logged = replica
        .write(|tx| {
            maintenance_db::log_maintenance_service(
                tx,
                &LogMaintenanceServiceInput {
                    task_id: task.id,
                    service_date: "2026-01-15".to_string(),
                    odometer_km: 25_000,
                    notes: Some("Done".to_string()),
                },
            )
        })
        .expect("the service is logged");
    assert_eq!(
        replica.touched_tables(),
        BTreeSet::from([
            "maintenance_service_logs".to_string(),
            "maintenance_tasks".to_string(),
            "vehicles".to_string()
        ]),
        "one logged service moves the log row, the task's anchors and the odometer"
    );

    replica.clear_log();
    replica
        .write(|tx| {
            maintenance_db::update_service_log(
                tx,
                &UpdateServiceLogInput {
                    log_id: logged.log.id,
                    service_date: "2026-01-20".to_string(),
                    odometer_km: 25_500,
                    notes: None,
                    custom_service_name: None,
                },
            )
        })
        .expect("the log is corrected");
    assert_eq!(replica.kinds_for("maintenance_service_logs"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| maintenance_db::delete_service_log(tx, logged.log.id))
        .expect("the log is deleted");
    assert_eq!(
        replica.kinds_for("maintenance_service_logs"),
        vec!["tombstone"]
    );
}

/// `maintenance_tasks` is `Natural` (AD-2), so the two computers that seed the same schedule for
/// the same vehicle must derive the SAME task identity — otherwise one service schedule arrives as
/// two.
#[test]
fn a_maintenance_task_takes_its_derived_identity() {
    let replica = Replica::open();
    let vehicle_id = replica.seed_vehicle();

    let tasks: Vec<(i64, String)> = {
        let mut statement = replica
            .conn()
            .prepare("SELECT id, task_type_key FROM maintenance_tasks WHERE vehicle_id = ?1")
            .expect("the task list prepares");
        let rows = statement
            .query_map([vehicle_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("the task list reads")
            .collect::<Result<Vec<_>, _>>()
            .expect("the task list collects");
        rows
    };
    assert!(!tasks.is_empty(), "the default schedule must be seeded");

    let vehicle = sync_identity::lookup(replica.conn(), "vehicles", vehicle_id)
        .expect("the vehicle identity reads")
        .expect("the vehicle has an identity");

    for (task_id, task_type_key) in tasks {
        let found = sync_identity::lookup(replica.conn(), "maintenance_tasks", task_id)
            .expect("the task identity reads")
            .expect("every seeded task is mapped");
        assert_eq!(found, identity::maintenance_task(&vehicle, &task_type_key));
    }
}

/// Deleting a vehicle cascades into its tasks and service logs, and AD-12 needs every one of them
/// in the log or the delete cannot be replayed — or undone.
#[test]
fn deleting_a_vehicle_captures_its_cascaded_tasks_and_logs() {
    let replica = Replica::open();
    let vehicle_id = replica.seed_vehicle();
    let task_id: i64 = replica
        .conn()
        .query_row(
            "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
            [vehicle_id],
            |row| row.get(0),
        )
        .expect("a seeded task reads");
    replica
        .write(|tx| {
            maintenance_db::log_maintenance_service(
                tx,
                &LogMaintenanceServiceInput {
                    task_id,
                    service_date: "2026-01-15".to_string(),
                    odometer_km: 15_000,
                    notes: None,
                },
            )
        })
        .expect("the service is logged");
    replica.clear_log();

    replica
        .write(|tx| maintenance_db::delete_vehicle(tx, vehicle_id))
        .expect("the vehicle is deleted");

    for cascaded in ["vehicles", "maintenance_tasks", "maintenance_service_logs"] {
        assert!(
            replica
                .kinds_for(cascaded)
                .iter()
                .all(|kind| kind == "tombstone"),
            "{cascaded} must be captured as tombstones"
        );
        assert!(
            !replica.kinds_for(cascaded).is_empty(),
            "{cascaded} lost its cascaded rows"
        );
    }

    assert_eq!(
        replica
            .conn()
            .query_row("SELECT COUNT(*) FROM sync_uuid", [], |row| row
                .get::<_, i64>(0))
            .expect("the identity count reads"),
        0,
        "every mapping of a deleted row is forgotten (AD-2)"
    );
}

#[test]
fn the_chat_write_sites_are_captured() {
    let replica = Replica::open();

    let conversation = replica
        .write(|tx| chat_db::create_conversation(tx, Some("Budget check"), "finance"))
        .expect("the conversation is created");
    assert_eq!(replica.kinds_for("chat_conversations"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| chat_db::insert_message(tx, conversation.id, "user", "how am I doing?", "chat"))
        .expect("the message is stored");
    assert_eq!(replica.kinds_for("chat_messages"), vec!["field"]);
}

/// AD-5's per-ROW exclusion. `config` syncs, EXCEPT the three keys that describe this computer's
/// own credential state — and the proof has to be symmetric or it proves nothing.
#[test]
fn a_config_key_on_the_deny_list_produces_no_message_and_every_other_key_does() {
    let replica = Replica::open();

    for denied in config_db::LOCAL_ONLY_KEYS {
        replica.clear_log();
        replica
            .write(|tx| config_db::set(tx, denied, "this computer"))
            .expect("a deny-listed key is still writable");

        assert!(
            replica.touched_tables().is_empty(),
            "{denied} describes this computer's credential state and must not travel (AD-5)"
        );
        assert_eq!(
            sync_identity::lookup(replica.conn(), "config", config_row_id(&replica, denied))
                .expect("the identity reads"),
            None,
            "{denied} must not even acquire an identity"
        );
        assert_eq!(
            config_db::get(replica.conn(), denied).as_deref(),
            Some("this computer"),
            "{denied} is still stored locally"
        );
    }

    replica.clear_log();
    replica
        .write(|tx| config_db::set(tx, "theme", "dark"))
        .expect("a synced key is written");
    assert_eq!(replica.kinds_for("config"), vec!["field"]);

    // AD-2: `config` is `Natural`, keyed by the setting's name, so two computers agree on it.
    let row_id = config_row_id(&replica, "theme");
    assert_eq!(
        sync_identity::lookup(replica.conn(), "config", row_id)
            .expect("the identity reads")
            .expect("a synced key is mapped"),
        identity::config_key("theme")
    );

    replica.clear_log();
    replica
        .write(|tx| config_db::delete(tx, "theme").map_err(AppError::from))
        .expect("the key is cleared");
    assert_eq!(replica.kinds_for("config"), vec!["tombstone"]);
}

/// A deny-listed key updated a second time is the case a naive implementation gets wrong: the row
/// already exists, so the change arrives as an UPDATE rather than an INSERT.
#[test]
fn updating_a_deny_listed_config_key_still_produces_no_message() {
    let replica = Replica::open();
    replica
        .write(|tx| config_db::set(tx, "aws_region", "ca-central-1"))
        .expect("the region is set");
    replica.clear_log();

    replica
        .write(|tx| config_db::set(tx, "aws_region", "us-east-1"))
        .expect("the region is changed");
    assert!(replica.touched_tables().is_empty());

    replica
        .write(|tx| config_db::delete(tx, "aws_region").map_err(AppError::from))
        .expect("the region is cleared");
    assert!(
        replica.touched_tables().is_empty(),
        "a deny-listed key must not even tombstone"
    );
}

fn config_row_id(replica: &Replica, key: &str) -> i64 {
    replica
        .conn()
        .query_row("SELECT rowid FROM config WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .unwrap_or(-1)
}

/// AD-5: `audit_log` is `AppendOnly`. The row travels when it is written and nothing else about it
/// ever does — no edit, no tombstone — because the action log is shared history rather than state
/// two computers merge.
#[test]
fn the_audit_log_is_captured_on_insert_and_never_on_an_edit_or_a_delete() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    replica.clear_log();

    replica
        .write(|tx| audit_db::insert_audit_log(tx, "project", project_id, "create", None, Some("{}")))
        .expect("the audit row is written");
    assert_eq!(replica.kinds_for("audit_log"), vec!["field"]);

    let audit_id: i64 = replica
        .conn()
        .query_row("SELECT id FROM audit_log", [], |row| row.get(0))
        .expect("the audit id reads");

    replica.clear_log();
    replica
        .write(|tx| {
            tx.execute(
                "UPDATE audit_log SET action = 'tampered' WHERE id = ?1",
                [audit_id],
            )
            .map(|_| ())
            .map_err(AppError::from)
        })
        .expect("the update itself still runs");
    assert!(
        replica.touched_tables().is_empty(),
        "an append-only row has no message shape for an edit (AD-5)"
    );

    replica.clear_log();
    replica
        .write(|tx| {
            tx.execute("DELETE FROM audit_log WHERE id = ?1", [audit_id])
                .map(|_| ())
                .map_err(AppError::from)
        })
        .expect("a local prune still runs");
    assert!(
        replica.touched_tables().is_empty(),
        "pruning the local action log must not delete the entry on every other computer"
    );
    assert_eq!(
        sync_identity::lookup(replica.conn(), "audit_log", audit_id).expect("the identity reads"),
        None,
        "the mapping is still forgotten, because AD-2's rowid-reuse rule does not care why"
    );
}

/// The `entity_uuid` migration 034 added: an audit row names the affected row in uuid space, so the
/// shared action log survives the fact that every computer numbers its rows differently (AD-5).
#[test]
fn an_audit_row_names_its_entity_by_uuid_when_it_has_one() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    let project = sync_identity::lookup(replica.conn(), "projects", project_id)
        .expect("the project identity reads")
        .expect("the project has an identity");

    replica
        .write(|tx| {
            audit_db::insert_audit_log(tx, "project", project_id, "create", None, Some("{}"))
        })
        .expect("the audit row is written");
    // An action that is not one row of one table: `entity_id` 0 and no uuid to name.
    replica
        .write(|tx| audit_db::insert_audit_log(tx, "import", 0, "create", None, Some("{}")))
        .expect("the import audit row is written");

    let named: Option<Vec<u8>> = replica
        .conn()
        .query_row(
            "SELECT entity_uuid FROM audit_log WHERE entity_type = 'project'",
            [],
            |row| row.get(0),
        )
        .expect("the project audit row reads");
    assert_eq!(named.as_deref(), Some(&project[..]));

    let unnamed: Option<Vec<u8>> = replica
        .conn()
        .query_row(
            "SELECT entity_uuid FROM audit_log WHERE entity_type = 'import'",
            [],
            |row| row.get(0),
        )
        .expect("the import audit row reads");
    assert_eq!(
        unnamed, None,
        "an action with no single entity has no uuid to name, and NULL is what says so"
    );
}

/// AD-5's "remote-applied changes write no new audit row", as a property of the WRITE PATH rather
/// than a promise about Story 20's code.
///
/// The apply path runs with capture detached on a connection of its own (AD-11), and the only two
/// ways an audit row is ever written are `audit::record` — which opens an `ActiveDataset::write` —
/// and the two helpers already inside one. `write_uncaptured` IS that detached path here, and this
/// pins that a write through it leaves `audit_log` exactly as it was: Story 20 inherits the
/// contract "do not call `db::audit`", and this test is what fails if the apply path ever grows a
/// call to it through the dataset's own write.
#[test]
fn the_detached_write_path_the_apply_seam_uses_adds_no_audit_row() {
    let replica = Replica::open();
    let project_id = replica.seed_project();
    replica
        .write(|tx| {
            audit_db::insert_audit_log(tx, "project", project_id, "create", None, Some("{}"))
        })
        .expect("one local audit row exists");

    let before = replica.audit_rows();
    assert_eq!(before, 1, "the fixture must have something to protect");
    replica.clear_log();

    // What an apply does: rewrite a synced row on the detached path.
    replica
        .dataset
        .write_uncaptured(|conn| {
            projects_db::update_project(
                conn,
                project_id,
                &UpdateProjectInput {
                    name: "Renamed remotely".to_string(),
                    target_cents: 700_000,
                    target_date: None,
                    priority: None,
                    icon: None,
                    color: None,
                },
            )
            .map(|_| ())
        })
        .expect("the remote-shaped write applies");

    assert_eq!(
        replica.audit_rows(),
        before,
        "a remote-applied change must write no new audit row (AD-5)"
    );
    assert!(
        replica.touched_tables().is_empty(),
        "and it must emit no message of its own either (AD-11)"
    );
}

/// The savepoint half of Story 18's chat migration: a batch of AI actions is ONE captured
/// transaction, so a failed item has to roll its rows AND its buffered changes back together — a
/// message describing a row that no longer exists is unapplicable on every other computer.
#[test]
fn a_failed_item_inside_a_captured_batch_rolls_back_its_rows_and_its_messages() {
    let replica = Replica::open();

    let kept = replica
        .write(|tx| {
            let kept = projects_db::insert_project(
                tx,
                &CreateProjectInput {
                    name: "Kept".to_string(),
                    target_cents: 100_000,
                    target_date: None,
                    priority: None,
                    icon: None,
                    color: None,
                },
            )?;

            // The failing item, swallowed exactly as `batch_actions_action` swallows one.
            let failed = tx.savepoint(|conn| {
                projects_db::insert_project(
                    conn,
                    &CreateProjectInput {
                        name: "Rolled back".to_string(),
                        target_cents: 200_000,
                        target_date: None,
                        priority: None,
                        icon: None,
                        color: None,
                    },
                )?;

                Err::<(), AppError>(AppError::Validation {
                    message: "this item fails after writing".to_string(),
                    field: None,
                })
            });
            assert!(failed.is_err(), "the item must have failed");

            Ok(kept)
        })
        .expect("the surrounding batch still commits");

    let names: Vec<String> = {
        let mut statement = replica
            .conn()
            .prepare("SELECT name FROM projects ORDER BY id")
            .expect("the project list prepares");
        statement
            .query_map([], |row| row.get(0))
            .expect("the project list reads")
            .collect::<Result<Vec<_>, _>>()
            .expect("the project list collects")
    };
    assert_eq!(names, vec!["Kept".to_string()]);

    let messaged: Vec<Vec<u8>> = replica
        .messages()
        .into_iter()
        .filter(|message| message.table_name == "projects")
        .map(|message| message.row_uuid)
        .collect();
    let kept_uuid = sync_identity::lookup(replica.conn(), "projects", kept.id)
        .expect("the identity reads")
        .expect("the kept project is mapped");
    assert_eq!(
        messaged,
        vec![kept_uuid.to_vec()],
        "only the item that survived may be described in the log"
    );
}

/// AD-2: `stock_holdings` is `Natural`, so an insert site that forgot to bind the derived identity
/// would fail the WHOLE write on a synced profile — this is the test that says the binding is there.
/// AD-5: a price refresh has to be captured on BOTH tables, or a second computer shows a value its
/// own holding row cannot explain.
#[test]
fn a_stock_holding_and_the_price_refresh_that_revalues_it_are_both_captured() {
    let replica = Replica::open();

    let asset = replica
        .write(|tx| {
            stock_db::insert_stock_asset(
                tx,
                &CreateStockAssetInput {
                    symbol: "SHOP.TO".to_string(),
                    name: "Shopify".to_string(),
                    exchange: "TOR".to_string(),
                    quantity_micros: 2_500_000,
                },
            )
        })
        .expect("the holding is created");

    assert_eq!(replica.kinds_for("stock_holdings"), vec!["field"]);

    let asset_uuid = sync_identity::lookup(replica.conn(), "passive_assets", asset.id)
        .expect("the asset identity reads")
        .expect("the asset has an identity");
    let holding_uuid = sync_identity::lookup(replica.conn(), "stock_holdings", asset.id)
        .expect("the holding identity reads")
        .expect("the holding has an identity");
    assert_eq!(holding_uuid, identity::stock_holding(&asset_uuid));

    let columns: BTreeSet<String> = replica
        .messages()
        .into_iter()
        .filter(|message| message.table_name == "stock_holdings")
        .filter_map(|message| message.payload)
        .flat_map(|payload| {
            super::capture::payload::decode_row(&payload)
                .expect("the row payload decodes")
                .into_iter()
                .map(|(name, _)| name)
        })
        .collect();
    for travelling in ["symbol", "exchange", "quantity_micros", "created_at"] {
        assert!(
            columns.contains(travelling),
            "{travelling} is what a replica rebuilds the holding from"
        );
    }

    replica.clear_log();
    replica
        .write(|tx| stock_db::apply_price(tx, asset.id, &stock_db::PriceWrite { last_price_cents: 12_345, currency: "CAD", fx_rate_to_base_micros: stock_db::UNIT_FX_MICROS }))
        .expect("the price applies");

    assert_eq!(replica.kinds_for("stock_holdings"), vec!["field"]);
    assert_eq!(replica.kinds_for("passive_assets"), vec!["field"]);
}
