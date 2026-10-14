//! The capture regression tests AD-3 names one by one, plus the boundaries AD-12 and AD-5 draw
//! around them. These are release gates (AD-19).
//!
//! Every one of them runs against a REAL file-backed dataset with the real migrations and a real
//! COMMIT. An in-memory rollback would prove nothing about the thing that matters: that what was
//! committed and what was logged are the same transaction.

use rusqlite::types::Value;
use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::capture_fixtures as fixtures;
use crate::db::sync_capture::{self, StoredMessage};
use crate::db::{sync_identity, test_dataset, ActiveDataset};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::capture::{payload, Capture, ROW_COLUMN_MARKER};
use super::registry::{self, MergeKind, RowIdentity, TableClass};

/// A cloud-linked dataset with the hook installed, in a temp dir that is deleted with it.
struct Harness {
    _dir: TempDir,
    dataset: ActiveDataset,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl Harness {
    fn cloud_linked() -> Self {
        Self::build(|conn| {
            let capture = Capture::for_dataset(DatasetKind::CloudLinked, conn)
                .expect("capture is built")
                .expect("a cloud-linked dataset captures");
            capture.attach(conn).expect("the hook is installed");
            Some(capture)
        })
    }

    fn local_only() -> Self {
        Self::build(|conn| {
            Capture::for_dataset(DatasetKind::Local, conn).expect("a local dataset asks for none")
        })
    }

    /// Capture over the live schema plus the scratch tables, for the two cases the real schema
    /// cannot express.
    fn with_scratch() -> Self {
        Self::build(|conn| {
            fixtures::create_scratch_tables(conn).expect("the scratch tables are created");

            let capture = super::capture::capture_including(
                conn,
                "scratch_keyed",
                RowIdentity::Surrogate,
                MergeKind::Lww,
            )
            .expect("capture is built");
            capture.attach(conn).expect("the hook is installed");
            Some(capture)
        })
    }

    fn with_tagged_scratch() -> Self {
        Self::build(|conn| {
            fixtures::create_scratch_tables(conn).expect("the scratch tables are created");

            let capture = super::capture::capture_including(
                conn,
                "scratch_tagged",
                RowIdentity::Surrogate,
                MergeKind::Lww,
            )
            .expect("capture is built");
            capture.attach(conn).expect("the hook is installed");
            Some(capture)
        })
    }

    fn build(capture: impl FnOnce(&Connection) -> Option<Capture>) -> Self {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));
        let capture = capture(&conn);

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("capture-test".to_string()),
                conn: Some(conn),
                capture,
            },
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset
            .conn
            .as_ref()
            .expect("the harness always has a connection")
    }

    fn messages(&self) -> Vec<StoredMessage> {
        sync_capture::all_messages(self.conn()).expect("the log reads")
    }

    /// The value a `field` message carried for one column, read out of the row payload the
    /// message carries (`ROW_COLUMN_MARKER`).
    fn payload_of(&self, column: &str) -> Option<Vec<u8>> {
        self.messages()
            .into_iter()
            .filter(|message| message.kind == "field")
            .flat_map(|message| decoded_fields(&message))
            .find(|(name, _)| name == column)
            .map(|(_, value)| value)
    }

    /// Every value captured for one column, in message order: what a test that counts "how many
    /// times was `name` written" needs now that one message carries the whole row.
    fn values_of(&self, column: &str) -> Vec<Vec<u8>> {
        self.messages()
            .into_iter()
            .filter(|message| message.kind == "field")
            .flat_map(|message| decoded_fields(&message))
            .filter(|(name, _)| name == column)
            .map(|(_, value)| value)
            .collect()
    }

    fn uuid_of(&self, table: &str, row_id: i64) -> Option<[u8; 16]> {
        sync_identity::lookup(self.conn(), table, row_id).expect("the mapping reads")
    }
}

fn decoded_fields(message: &StoredMessage) -> Vec<(String, Vec<u8>)> {
    assert_eq!(
        message.column_name.as_deref(),
        Some(ROW_COLUMN_MARKER),
        "a field message carries the whole changed row under the row marker"
    );

    payload::decode_row(message.payload.as_deref().expect("a field message has a payload"))
        .expect("the row payload decodes")
}

fn field_columns(messages: &[StoredMessage], table: &str) -> Vec<String> {
    let mut columns: Vec<String> = messages
        .iter()
        .filter(|message| message.kind == "field" && message.table_name == table)
        .flat_map(decoded_fields)
        .map(|(name, _)| name)
        .collect();
    columns.sort();
    columns.dedup();
    columns
}

#[test]
fn a_committed_insert_becomes_one_message_carrying_every_captured_column() {
    let harness = Harness::cloud_linked();

    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the write commits");

    let messages = harness.messages();
    assert_eq!(
        field_columns(&messages, "budget_groups"),
        vec!["created_at", "deleted_at", "name", "sort_order"],
        "every captured column of a new row has to travel, including the NULL one: a remote \
         replica builds the row from these messages alone"
    );
    assert!(
        harness.payload_of("id").is_none(),
        "AD-2 keeps the local integer id out of every message"
    );
    assert_eq!(
        harness.payload_of("name"),
        Some(payload::encode(&Value::Text("Housing".to_string())))
    );

    let row_uuid = harness.uuid_of("budget_groups", id).expect("minted");
    assert!(messages
        .iter()
        .all(|message| message.row_uuid == row_uuid.to_vec()));
    assert_eq!(
        sync_capture::field_state_column_count(harness.conn()).expect("the state reads"),
        4,
        "one entry per captured field (AD-5)"
    );
    assert_eq!(
        sync_capture::field_state_row_count(harness.conn()).expect("the state reads"),
        1,
        "and all four live in ONE row since migration 033"
    );
}

#[test]
fn an_update_captures_only_the_columns_that_changed() {
    let harness = Harness::cloud_linked();
    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the insert commits");
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::rename_budget_group(tx, id, "Home"))
        .expect("the update commits");

    let added: Vec<_> = harness.messages().split_off(before);
    assert_eq!(added.len(), 1, "one changed row is one message");
    assert_eq!(
        decoded_fields(&added[0]),
        vec![(
            "name".to_string(),
            payload::encode(&Value::Text("Home".to_string()))
        )],
        "and it carries only the column that changed"
    );
}

#[test]
fn the_field_state_hash_follows_the_value_and_the_clock_moves_forward() {
    let harness = Harness::cloud_linked();
    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the insert commits");
    let row_uuid = harness.uuid_of("budget_groups", id).expect("minted");

    let first = sync_capture::field_state(harness.conn(), "budget_groups", &row_uuid, "name")
        .expect("the state reads")
        .expect("the field is owned");

    harness
        .dataset
        .write(|tx| fixtures::rename_budget_group(tx, id, "Housing"))
        .expect("a same-value update commits");
    let unchanged = sync_capture::field_state(harness.conn(), "budget_groups", &row_uuid, "name")
        .expect("the state reads")
        .expect("the field is owned");
    assert_eq!(
        unchanged, first,
        "the hook sees no change at all when the value does not change, so nothing is re-stamped"
    );

    harness
        .dataset
        .write(|tx| fixtures::rename_budget_group(tx, id, "Home"))
        .expect("the update commits");
    let second = sync_capture::field_state(harness.conn(), "budget_groups", &row_uuid, "name")
        .expect("the state reads")
        .expect("the field is owned");

    assert_ne!(
        second.content_hash, first.content_hash,
        "a different value hashes differently"
    );
    assert!(second.hlc > first.hlc, "the HLC of the newer write is greater");
    assert_eq!(
        second.install(),
        first.install(),
        "both writes are this install's"
    );
    assert!(
        sync_capture::field_state_accepts(
            harness.conn(),
            "budget_groups",
            &row_uuid,
            "name",
            "ffffffffffffffff-ffffffffffffffff"
        )
        .expect("the gate reads"),
        "AD-5's gate accepts a greater stamp"
    );
    assert!(
        !sync_capture::field_state_accepts(
            harness.conn(),
            "budget_groups",
            &row_uuid,
            "name",
            &first.hlc
        )
        .expect("the gate reads"),
        "and refuses the one that already lost"
    );
    assert_eq!(
        sync_capture::field_state_columns(harness.conn(), "budget_groups", &row_uuid)
            .expect("the columns read")
            .into_iter()
            .map(|(name, _)| name)
            .collect::<Vec<_>>(),
        vec!["created_at", "deleted_at", "name", "sort_order"],
        "reconcile (Story 22) walks the row's columns"
    );
}

#[test]
fn insert_or_replace_on_the_primary_key_keeps_the_rows_identity() {
    let harness = Harness::cloud_linked();
    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the insert commits");
    let original = harness.uuid_of("budget_groups", id).expect("minted");
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::replace_budget_group(tx, id, "Home", 7))
        .expect("the replace commits");

    let added: Vec<_> = harness.messages().split_off(before);
    assert!(
        !added.iter().any(|message| message.kind == "tombstone"),
        "the REPLACE's internal delete is half of an upsert, not a delete the user made"
    );
    assert_eq!(
        field_columns(&added, "budget_groups"),
        vec!["name", "sort_order"],
        "the collapsed upsert emits the columns that really changed, exactly like an UPDATE"
    );
    assert_eq!(
        harness.uuid_of("budget_groups", id),
        Some(original),
        "a REPLACE must not rename the row on every other computer"
    );
}

#[test]
fn a_replace_that_lands_on_a_new_row_id_is_a_tombstone_and_a_new_identity() {
    let harness = Harness::with_tagged_scratch();
    let first = harness
        .dataset
        .write(|tx| fixtures::insert_scratch_tagged(tx, "payroll", "first"))
        .expect("the insert commits");
    let original = harness.uuid_of("scratch_tagged", first).expect("minted");
    let before = harness.messages().len();

    let second = harness
        .dataset
        .write(|tx| fixtures::replace_scratch_tagged(tx, "payroll", "second"))
        .expect("the replace commits");

    assert_ne!(
        first, second,
        "a REPLACE conflicting on a UNIQUE column really does mint a new row id"
    );

    let added: Vec<_> = harness.messages().split_off(before);
    assert_eq!(
        added
            .iter()
            .map(|message| message.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["tombstone", "field"],
        "SQLite deleted one row and inserted another, and that is what the log must say"
    );
    assert_eq!(added[0].row_uuid, original.to_vec());
    assert_eq!(
        harness.uuid_of("scratch_tagged", first),
        None,
        "AD-2 drops the mapping with the tombstone, so a reused row id cannot inherit it"
    );
    assert_ne!(
        harness.uuid_of("scratch_tagged", second),
        Some(original),
        "the inserted row is a new identity"
    );
}

/// SQLite answers an unqualified `DELETE` with its truncate optimization — one `OP_Clear` and no
/// per-row callback — UNLESS a pre-update hook is registered, in which case it falls back to
/// deleting row by row. Having the hook installed is what defeats it, and this is the test that
/// says so: if the optimization ever applied, every one of these rows would vanish unlogged.
#[test]
fn a_delete_without_a_where_clause_captures_every_row() {
    let harness = Harness::cloud_linked();
    let ids = harness
        .dataset
        .write(|tx| {
            (0..5)
                .map(|row| fixtures::insert_budget_group(tx, &format!("group {row}"), row))
                .collect::<Result<Vec<_>, AppError>>()
        })
        .expect("the inserts commit");
    let uuids: Vec<_> = ids
        .iter()
        .map(|id| harness.uuid_of("budget_groups", *id).expect("minted"))
        .collect();
    let before = harness.messages().len();

    let deleted = harness
        .dataset
        .write(|tx| fixtures::delete_every_budget_group(tx))
        .expect("the delete commits");

    assert_eq!(deleted, 5);
    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        0
    );

    let added: Vec<_> = harness.messages().split_off(before);
    assert_eq!(
        added.len(),
        5,
        "five rows were deleted, so five tombstones have to exist"
    );
    assert!(added.iter().all(|message| message.kind == "tombstone"));

    let mut tombstoned: Vec<Vec<u8>> = added.iter().map(|m| m.row_uuid.clone()).collect();
    tombstoned.sort();
    let mut expected: Vec<Vec<u8>> = uuids.iter().map(|uuid| uuid.to_vec()).collect();
    expected.sort();
    assert_eq!(tombstoned, expected);

    assert_eq!(
        sync_identity::count(harness.conn()).expect("the mapping count reads"),
        0,
        "every mapping is dropped with its tombstone (AD-2)"
    );
    assert_eq!(
        sync_capture::field_state_row_count(harness.conn()).expect("the state reads"),
        0
    );
}

#[test]
fn a_tombstone_carries_the_whole_row_as_json() {
    let harness = Harness::cloud_linked();
    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 3))
        .expect("the insert commits");

    harness
        .dataset
        .write(|tx| fixtures::delete_every_budget_group(tx).map(|_| ()))
        .expect("the delete commits");

    let tombstone = harness
        .messages()
        .into_iter()
        .find(|message| message.kind == "tombstone")
        .expect("the delete was captured");
    let encoded = tombstone.payload.expect("a tombstone carries the row");
    let json: serde_json::Value = serde_json::from_slice(&encoded[1..]).expect("valid JSON");

    assert_eq!(json["name"], serde_json::json!("Housing"));
    assert_eq!(json["sort_order"], serde_json::json!(3));
    assert_eq!(json["deleted_at"], serde_json::Value::Null);
    assert!(
        json.get("id").is_none(),
        "the local integer id is not part of any message (AD-2), not even a tombstone's row"
    );
    assert!(harness.uuid_of("budget_groups", id).is_none());
}

/// AD-12 rests on this: a cascaded child is captured as its OWN tombstone at depth >= 1, which is
/// what makes the delete restorable instead of silently losing the children.
#[test]
fn a_foreign_key_cascade_captures_its_children_as_ordinary_changes() {
    let harness = Harness::cloud_linked();
    let (source, entries) = harness
        .dataset
        .write(|tx| {
            let source = fixtures::insert_income_source(tx, "Salary")?;
            let first = fixtures::insert_income_entry(tx, source, 100_000, "2026-01-15")?;
            let second = fixtures::insert_income_entry(tx, source, 120_000, "2026-02-15")?;
            Ok((source, vec![first, second]))
        })
        .expect("the inserts commit");

    let source_uuid = harness.uuid_of("income_sources", source).expect("minted");
    let entry_uuids: Vec<_> = entries
        .iter()
        .map(|id| harness.uuid_of("income_entries", *id).expect("minted"))
        .collect();
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::delete_income_source(tx, source).map(|_| ()))
        .expect("the delete commits");

    assert_eq!(
        fixtures::count_income_entries(harness.conn()).expect("the count reads"),
        0,
        "the schema's own ON DELETE CASCADE is what is being observed here"
    );

    let added: Vec<_> = harness.messages().split_off(before);
    assert_eq!(added.len(), 3, "the parent and both cascaded children");
    assert!(added.iter().all(|message| message.kind == "tombstone"));

    assert_eq!(
        sync_identity::count(harness.conn()).expect("the mapping count reads"),
        0,
        "recording the parent's tombstone drops its mapping, and the children's tombstones must \
         not mint it back: a new identity for a deleted row is junk no replica can resolve"
    );

    let mut tombstoned: Vec<(String, Vec<u8>)> = added
        .iter()
        .map(|message| (message.table_name.clone(), message.row_uuid.clone()))
        .collect();
    tombstoned.sort();
    let mut expected = vec![("income_sources".to_string(), source_uuid.to_vec())];
    expected.extend(
        entry_uuids
            .iter()
            .map(|uuid| ("income_entries".to_string(), uuid.to_vec())),
    );
    expected.sort();
    assert_eq!(tombstoned, expected);
}

#[test]
fn a_cascaded_child_is_seen_at_a_query_depth_above_zero() {
    let harness = Harness::cloud_linked();
    let source = harness
        .dataset
        .write(|tx| {
            let source = fixtures::insert_income_source(tx, "Salary")?;
            fixtures::insert_income_entry(tx, source, 100_000, "2026-01-15")?;
            Ok(source)
        })
        .expect("the inserts commit");

    let capture = harness
        .dataset
        .capture
        .as_ref()
        .expect("a cloud-linked harness captures");

    // Observed from INSIDE the transaction, before the flush empties the buffer: the depth is the
    // hook's own report of how the change was reached and cannot be recovered afterwards.
    let depths = harness
        .dataset
        .write(|tx| {
            fixtures::delete_income_source(tx, source)?;
            Ok(capture.buffered_depths())
        })
        .expect("the delete commits");

    assert_eq!(
        depths,
        vec![("income_sources", 0), ("income_entries", 1)],
        "the statement the caller wrote is depth 0 and the cascade SQLite ran is depth 1 (AD-3)"
    );
}

#[test]
fn a_childs_foreign_key_travels_as_the_parents_uuid() {
    let harness = Harness::cloud_linked();
    let (source, entry) = harness
        .dataset
        .write(|tx| {
            let source = fixtures::insert_income_source(tx, "Salary")?;
            let entry = fixtures::insert_income_entry(tx, source, 100_000, "2026-01-15")?;
            Ok((source, entry))
        })
        .expect("the inserts commit");

    let source_uuid = harness.uuid_of("income_sources", source).expect("minted");
    let entry_uuid = harness.uuid_of("income_entries", entry).expect("minted");
    assert_ne!(source_uuid, entry_uuid);

    assert_eq!(
        harness.payload_of("source_id"),
        Some(payload::encode(&Value::Blob(source_uuid.to_vec()))),
        "a parent is named by uuid and never by this computer's integer id (AD-2)"
    );

    assert_eq!(
        harness.payload_of("account_id"),
        Some(payload::encode(&Value::Null)),
        "an unset foreign key still has to be stated"
    );
}

#[test]
fn the_balance_column_is_never_captured_by_the_generic_hook() {
    let harness = Harness::cloud_linked();

    harness
        .dataset
        .write(|tx| fixtures::insert_account(tx, "Chequing", 123_456))
        .expect("the write commits");

    let messages = harness.messages();
    assert!(
        harness.payload_of("balance_cents").is_none(),
        "AD-5: the balance is written only by Story 16's two emitters"
    );
    assert_eq!(
        field_columns(&messages, "accounts"),
        vec![
            "account_type",
            "created_at",
            "currency",
            "institution",
            "name",
            "updated_at"
        ]
    );
}

#[test]
fn a_change_to_an_immutable_column_is_not_captured() {
    let harness = Harness::cloud_linked();
    let id = harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the insert commits");
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::restamp_budget_group(tx, id, "1999-01-01 00:00:00"))
        .expect("the update commits");

    assert_eq!(
        harness.messages().len(),
        before,
        "AD-5: a later write to an immutable column is a bug, not an Lww winner"
    );
}

#[test]
fn a_counter_column_is_captured_as_a_signed_delta() {
    let harness = Harness::cloud_linked();
    let (category, hint) = harness
        .dataset
        .write(|tx| {
            let group = fixtures::insert_budget_group(tx, "Housing", 0)?;
            let category = fixtures::insert_budget_category(tx, group, "Rent")?;
            Ok((group, category))
        })
        .and_then(|(_, category)| {
            // Inserted OUTSIDE `write`, then mapped explicitly, because the derived identity of a
            // natural-key row is its insert site's job (AD-2) and Story 16 owns that site.
            let conn = harness.conn();
            let hint = fixtures::insert_merchant_hint(conn, "Landlord", category)?;
            let category_uuid =
                sync_identity::lookup(conn, "budget_categories", category)?.expect("mapped");
            super::identity::ensure_derived(
                conn,
                "merchant_category_hints",
                hint,
                &super::identity::merchant_category_hint("Landlord", &category_uuid),
            )?;
            Ok((category, hint))
        })
        .expect("the fixture is built");
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::bump_merchant_hint(tx, hint, 1))
        .expect("the bump commits");

    let added: Vec<_> = harness.messages().split_off(before);
    let delta = added
        .iter()
        .find(|message| message.kind == "counter_delta")
        .expect("AD-5 captures a counter as a delta");

    assert_eq!(delta.column_name.as_deref(), Some("usage_count"));
    assert_eq!(delta.payload, Some(payload::encode(&Value::Integer(1))));
    assert!(
        sync_capture::field_state(
            harness.conn(),
            "merchant_category_hints",
            &delta.row_uuid,
            "usage_count"
        )
        .expect("the state reads")
        .is_none(),
        "a counter's value is the sum of its deltas, so there is no single winner to record"
    );
    assert!(category > 0);
}

#[test]
fn a_naturally_identified_row_written_without_its_derived_identity_fails_the_whole_write() {
    let harness = Harness::cloud_linked();
    let category = harness
        .dataset
        .write(|tx| {
            let group = fixtures::insert_budget_group(tx, "Housing", 0)?;
            fixtures::insert_budget_category(tx, group, "Rent")
        })
        .expect("the fixture commits");
    let before = harness.messages().len();

    let error = harness
        .dataset
        .write(|tx| fixtures::insert_merchant_hint(tx, "Landlord", category))
        .expect_err("capture must refuse to invent a derived identity");

    assert!(
        matches!(&error, AppError::Database { message } if message.contains("merchant_category_hints")),
        "the refusal has to name the table whose insert site is missing the mapping, got {error:?}"
    );
    assert_eq!(
        harness.messages().len(),
        before,
        "a failing flush writes no message"
    );
    assert_eq!(
        harness
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM merchant_category_hints",
                [],
                |row| row.get::<_, i64>(0)
            )
            .expect("the count reads"),
        0,
        "and it rolls the user's own row back with it"
    );
}

#[test]
fn a_rolled_back_write_leaves_neither_a_row_nor_a_message() {
    let harness = Harness::cloud_linked();

    let error = harness
        .dataset
        .write(|tx| {
            fixtures::insert_budget_group(tx, "Housing", 0)?;
            Err::<(), AppError>(AppError::Validation {
                message: "the caller changed its mind".to_string(),
                field: None,
            })
        })
        .expect_err("the closure failed");

    assert!(matches!(error, AppError::Validation { .. }));
    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        0
    );
    assert!(harness.messages().is_empty(), "AD-3: rollback discards the buffer");
    assert_eq!(
        sync_identity::count(harness.conn()).expect("the mapping count reads"),
        0
    );
}

#[test]
fn the_buffer_does_not_survive_into_the_next_write() {
    let harness = Harness::cloud_linked();

    let _ = harness.dataset.write(|tx| {
        fixtures::insert_budget_group(tx, "Discarded", 0)?;
        Err::<(), AppError>(AppError::Validation {
            message: "abandoned".to_string(),
            field: None,
        })
    });

    harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Kept", 0))
        .expect("the second write commits");

    assert_eq!(
        harness.values_of("name"),
        vec![payload::encode(&Value::Text("Kept".to_string()))],
        "the abandoned row must not reappear as a message under the next write's clock"
    );
}

#[test]
fn a_savepoint_rollback_discards_only_the_inner_changes() {
    let harness = Harness::cloud_linked();

    let kept = harness
        .dataset
        .write(|tx| {
            let kept = fixtures::insert_budget_group(tx, "Kept", 0)?;

            let inner = tx.savepoint(|conn| {
                fixtures::insert_budget_group(conn, "Discarded", 1)?;
                Err::<(), AppError>(AppError::Validation {
                    message: "the inner step failed".to_string(),
                    field: None,
                })
            });
            assert!(inner.is_err());

            Ok(kept)
        })
        .expect("the outer transaction commits");

    assert_eq!(
        fixtures::budget_group_name(harness.conn(), kept).expect("the row reads"),
        Some("Kept".to_string())
    );
    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        1
    );

    assert_eq!(
        harness.values_of("name"),
        vec![payload::encode(&Value::Text("Kept".to_string()))],
        "the savepoint rolled back its rows, so its messages have to go with them"
    );
}

#[test]
fn a_savepoint_that_succeeds_keeps_its_changes() {
    let harness = Harness::cloud_linked();

    harness
        .dataset
        .write(|tx| {
            fixtures::insert_budget_group(tx, "Outer", 0)?;
            tx.savepoint(|conn| fixtures::insert_budget_group(conn, "Inner", 1))
        })
        .expect("the write commits");

    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        2
    );
    assert_eq!(harness.values_of("name").len(), 2);
}

/// The hook's row id is meaningless for a `WITHOUT ROWID` table, and the one thing capture must
/// never do is key an identity by it: two rows would share one identity and a remote field write
/// would land on whichever of them SQLite reported last. Refusing fails the write instead.
#[test]
fn a_without_rowid_table_is_refused_rather_than_keyed_by_a_meaningless_row_id() {
    let harness = Harness::with_scratch();

    let error = harness
        .dataset
        .write(|tx| fixtures::insert_scratch_keyed(tx, "alpha", "first"))
        .expect_err("capture must refuse a row it cannot identify");

    assert!(
        matches!(&error, AppError::Database { message }
            if message.contains("scratch_keyed") && message.contains("WITHOUT ROWID")),
        "the refusal has to say which table and why, got {error:?}"
    );
    assert_eq!(
        fixtures::count_scratch_keyed(harness.conn()).expect("the count reads"),
        0,
        "and it takes the user's row with it rather than committing an unlogged one"
    );
    assert!(harness.messages().is_empty());
}

/// The tripwire that keeps the refusal above unreachable in production. A migration that makes a
/// travelling table `WITHOUT ROWID` has to deal with identity first (AD-2), and this is what tells
/// its author so.
#[test]
fn no_travelling_table_of_the_real_schema_is_without_rowid() {
    let dir = TempDir::new().expect("temp dir");
    let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

    let mut checked = 0;
    for rule in registry::TABLES {
        if matches!(rule.class, TableClass::LocalOnly) {
            continue;
        }

        assert!(
            sync_capture::table_has_rowid(&conn, rule.table).expect("the probe runs"),
            "{} travels and is WITHOUT ROWID, which capture cannot identify by row id",
            rule.table
        );
        checked += 1;
    }

    assert!(checked > 20, "the registry must really have been walked");
}

#[test]
fn a_local_only_dataset_installs_no_hook_and_writes_no_message() {
    let harness = Harness::local_only();
    assert!(
        harness.dataset.capture.is_none(),
        "inherited AD-12: a local profile has no capture state at all"
    );

    harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("a plain transaction commits");

    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        1
    );
    assert!(harness.messages().is_empty());
    assert_eq!(
        sync_identity::count(harness.conn()).expect("the mapping count reads"),
        0
    );
    assert!(
        crate::db::sync_state::load(harness.conn())
            .expect("the state reads")
            .is_none(),
        "a local-only dataset must not even be given an install id"
    );
}

#[test]
fn a_detached_closure_captures_nothing_and_the_hook_comes_back_afterwards() {
    let harness = Harness::cloud_linked();

    harness
        .dataset
        .write_uncaptured(|conn| fixtures::insert_budget_group(conn, "Wiped", 0))
        .expect("the uncaptured write commits");

    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        1
    );
    assert!(
        harness.messages().is_empty(),
        "AD-15: a wipe must not emit a message per row"
    );

    harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Captured", 1))
        .expect("the next write commits");

    assert_eq!(
        harness.values_of("name"),
        vec![payload::encode(&Value::Text("Captured".to_string()))],
        "the guard re-attached the hook, and only the row written after it is captured"
    );
}

/// AD-11's apply path opens its own connection to the same file and must run with capture off.
/// The hook is per connection, so this is structural rather than a rule to remember — and this is
/// the test that proves it is.
#[test]
fn a_second_connection_to_the_same_file_captures_nothing() {
    let harness = Harness::cloud_linked();
    let path: String = harness
        .conn()
        .query_row("SELECT file FROM pragma_database_list WHERE name = 'main'", [], |row| {
            row.get(0)
        })
        .expect("the path reads");

    let second = crate::db::open_configured(std::path::Path::new(&path)).expect("a second opener");
    fixtures::insert_budget_group(&second, "Applied", 0).expect("the remote-style write commits");
    drop(second);

    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        1
    );
    assert!(harness.messages().is_empty());
}

#[test]
fn the_payload_encoding_is_deterministic() {
    assert_eq!(payload::encode(&Value::Null), vec![payload::TAG_NULL]);
    assert_eq!(
        payload::encode(&Value::Integer(1)),
        vec![payload::TAG_INTEGER, 0, 0, 0, 0, 0, 0, 0, 1]
    );
    assert_eq!(
        payload::encode(&Value::Integer(-1)),
        vec![payload::TAG_INTEGER, 255, 255, 255, 255, 255, 255, 255, 255]
    );
    assert_eq!(
        payload::encode(&Value::Real(1.0)),
        vec![payload::TAG_REAL, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0]
    );
    assert_eq!(
        payload::encode(&Value::Text("hi".to_string())),
        vec![payload::TAG_TEXT, b'h', b'i']
    );
    assert_eq!(
        payload::encode(&Value::Blob(vec![1, 2])),
        vec![payload::TAG_BLOB, 1, 2]
    );
    assert_ne!(
        payload::encode(&Value::Text("1".to_string())),
        payload::encode(&Value::Integer(1)),
        "a tag that did not separate the types would make a text 1 and the number 1 one value"
    );
}

#[test]
fn the_install_id_capture_stamps_with_is_the_datasets_own() {
    let harness = Harness::cloud_linked();
    let capture = harness
        .dataset
        .capture
        .as_ref()
        .expect("a cloud-linked harness captures");
    let stored = crate::db::sync_state::load(harness.conn())
        .expect("the state reads")
        .expect("capture created the row");

    assert_eq!(capture.install_id(), stored.install_id);

    harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the write commits");

    assert!(harness
        .messages()
        .iter()
        .all(|message| message.install == stored.install_id));
}

/// AD-12 needs a cascaded child restorable, and a tombstone that cannot say which parent the row
/// belonged to is not restorable. The parent's tombstone is recorded first and drops the parent's
/// identity mapping, so the only way the child can still name it is for the flush to render EVERY
/// deleted row before it drops ANY mapping.
#[test]
fn a_cascaded_childs_tombstone_names_the_parent_it_was_deleted_with() {
    let harness = Harness::cloud_linked();
    let source = harness
        .dataset
        .write(|tx| {
            let source = fixtures::insert_income_source(tx, "Salary")?;
            fixtures::insert_income_entry(tx, source, 100_000, "2026-01-15")?;
            Ok(source)
        })
        .expect("the inserts commit");
    let source_uuid = harness.uuid_of("income_sources", source).expect("minted");

    harness
        .dataset
        .write(|tx| fixtures::delete_income_source(tx, source).map(|_| ()))
        .expect("the delete commits");

    let child = harness
        .messages()
        .into_iter()
        .find(|message| message.kind == "tombstone" && message.table_name == "income_entries")
        .expect("the cascaded child was captured");
    let encoded = child.payload.expect("a tombstone carries the row");
    let json: serde_json::Value = serde_json::from_slice(&encoded[1..]).expect("valid JSON");

    assert_eq!(
        json["source_id"],
        serde_json::json!(hex(&source_uuid)),
        "the child has to name its parent by uuid, not null"
    );
    assert_eq!(
        json["account_id"],
        serde_json::Value::Null,
        "a foreign key that really was unset stays null"
    );
}

/// The delete half of an `INSERT OR REPLACE` can cascade, so the insert half is NOT the change
/// right after the delete — the children sit between them.
#[test]
fn a_replace_whose_delete_cascades_is_still_collapsed() {
    let harness = Harness::cloud_linked();
    let (source, entry) = harness
        .dataset
        .write(|tx| {
            let source = fixtures::insert_income_source(tx, "Salary")?;
            let entry = fixtures::insert_income_entry(tx, source, 100_000, "2026-01-15")?;
            Ok((source, entry))
        })
        .expect("the inserts commit");
    let source_uuid = harness.uuid_of("income_sources", source).expect("minted");
    let entry_uuid = harness.uuid_of("income_entries", entry).expect("minted");
    let before = harness.messages().len();

    harness
        .dataset
        .write(|tx| fixtures::replace_income_source(tx, source, "Contracting"))
        .expect("the replace commits");

    assert_eq!(
        fixtures::count_income_entries(harness.conn()).expect("the count reads"),
        0,
        "the REPLACE's delete really did cascade, or this test proves nothing"
    );

    let added: Vec<_> = harness.messages().split_off(before);
    let parent: Vec<_> = added
        .iter()
        .filter(|message| message.table_name == "income_sources")
        .collect();

    assert!(
        parent.iter().all(|message| message.kind == "field"),
        "the parent was upserted, so it must not be tombstoned: {:?}",
        parent.iter().map(|m| &m.kind).collect::<Vec<_>>()
    );
    assert_eq!(
        harness.uuid_of("income_sources", source),
        Some(source_uuid),
        "a collapsed REPLACE keeps the row's identity even when its delete cascaded"
    );

    let child: Vec<_> = added
        .iter()
        .filter(|message| message.table_name == "income_entries")
        .collect();
    assert_eq!(child.len(), 1);
    assert_eq!(child[0].kind, "tombstone");
    assert_eq!(child[0].row_uuid, entry_uuid.to_vec());

    let json: serde_json::Value = serde_json::from_slice(
        &child[0].payload.as_ref().expect("the row travels")[1..],
    )
    .expect("valid JSON");
    assert_eq!(
        json["source_id"],
        serde_json::json!(hex(&source_uuid)),
        "the cascaded child still names the parent that survived the REPLACE"
    );
}

/// A hook read fault describes one change. If the savepoint that produced it is rolled back, the
/// change is gone and failing the outer transaction would be failing for nothing.
#[test]
fn a_fault_recorded_inside_a_rolled_back_savepoint_does_not_fail_the_write() {
    let harness = Harness::cloud_linked();
    let capture = harness
        .dataset
        .capture
        .as_ref()
        .expect("a cloud-linked harness captures");

    let id = harness
        .dataset
        .write(|tx| {
            let id = fixtures::insert_budget_group(tx, "Kept", 0)?;

            let inner = tx.savepoint(|conn| {
                fixtures::insert_budget_group(conn, "Discarded", 1)?;
                capture.record_fault("a column could not be read");
                Err::<(), AppError>(AppError::Validation {
                    message: "the inner step failed".to_string(),
                    field: None,
                })
            });
            assert!(inner.is_err());

            Ok(id)
        })
        .expect("the outer transaction still commits");

    assert_eq!(
        fixtures::budget_group_name(harness.conn(), id).expect("the row reads"),
        Some("Kept".to_string())
    );
    assert_eq!(harness.values_of("name").len(), 1);
}

#[test]
fn a_fault_that_predates_the_savepoint_still_fails_the_write() {
    let harness = Harness::cloud_linked();
    let capture = harness
        .dataset
        .capture
        .as_ref()
        .expect("a cloud-linked harness captures");

    let error = harness
        .dataset
        .write(|tx| {
            capture.record_fault("a column could not be read");
            fixtures::insert_budget_group(tx, "Doomed", 0)?;

            tx.savepoint(|conn| fixtures::insert_budget_group(conn, "Inner", 1))
                .map(|_| ())
        })
        .expect_err("a fault outside the savepoint still describes a change in this transaction");

    assert!(
        matches!(&error, AppError::Database { message } if message.contains("could not be captured")),
        "got {error:?}"
    );
    assert_eq!(
        fixtures::count_budget_groups(harness.conn()).expect("the count reads"),
        0
    );
    assert!(harness.messages().is_empty());
}

/// AD-9 swaps the dataset FILE under a live `Capture` (bootstrap, restore). The file that arrives
/// carries its own `sync_state`, and stamping its messages with the install id of the file it
/// replaced would put two machines in one `(install, seq)` space — the exact hazard AD-4 exists to
/// prevent.
#[test]
fn an_adopted_file_is_captured_under_its_own_install_id() {
    let mut harness = Harness::cloud_linked();
    let capture = harness
        .dataset
        .capture
        .take()
        .expect("a cloud-linked harness captures");
    let original = capture.install_id();

    let adopted_dir = TempDir::new().expect("temp dir");
    let adopted = test_dataset::migrated_dataset(&adopted_dir.path().join("nixus.db"));
    let fingerprint = crate::sync::clock::machine_fingerprint(
        &crate::sync::clock::MachineSignals::from_environment(),
    );
    crate::db::sync_state::ensure(&adopted, "0123456789abcdef", &fingerprint)
        .expect("the adopted file carries its own install identity");
    assert_ne!(original, "0123456789abcdef");

    capture
        .attach(&adopted)
        .expect("the hook moves to the adopted connection");

    let swapped = ActiveDataset {
        id: Some("capture-test".to_string()),
        conn: Some(adopted),
        capture: Some(capture),
    };
    swapped
        .write(|tx| fixtures::insert_budget_group(tx, "After the swap", 0))
        .expect("the write commits");

    let conn = swapped.conn.as_ref().expect("connected");
    let messages = sync_capture::all_messages(conn).expect("the log reads");

    assert!(!messages.is_empty());
    assert!(
        messages
            .iter()
            .all(|message| message.install == "0123456789abcdef"),
        "every message must carry the adopted file's install id, got {:?}",
        messages.iter().map(|m| &m.install).collect::<Vec<_>>()
    );
    assert!(
        messages.iter().all(|message| message.install != original),
        "and never the replaced file's"
    );
}

#[test]
fn every_message_of_one_changed_row_shares_one_stamp() {
    let harness = Harness::cloud_linked();

    harness
        .dataset
        .write(|tx| fixtures::insert_budget_group(tx, "Housing", 0))
        .expect("the write commits");

    let stamps: std::collections::BTreeSet<String> = harness
        .messages()
        .into_iter()
        .map(|message| message.hlc)
        .collect();

    assert_eq!(
        stamps.len(),
        1,
        "one user edit is one event: all four of its columns are concurrent by construction, and \
         a message's identity is (install, seq, idx) rather than its stamp (AD-4)"
    );
}

#[test]
fn a_row_payload_round_trips_and_is_deterministic() {
    let fields = vec![
        ("sort_order".to_string(), Value::Integer(3)),
        ("name".to_string(), Value::Text("Housing".to_string())),
        ("deleted_at".to_string(), Value::Null),
    ];
    let encoded = payload::encode_row(&fields);

    assert_eq!(
        payload::decode_row(&encoded).expect("it decodes"),
        vec![
            ("deleted_at".to_string(), payload::encode(&Value::Null)),
            (
                "name".to_string(),
                payload::encode(&Value::Text("Housing".to_string()))
            ),
            ("sort_order".to_string(), payload::encode(&Value::Integer(3))),
        ],
        "sorted by column name, so the same change always produces the same bytes"
    );

    let shuffled = vec![
        ("name".to_string(), Value::Text("Housing".to_string())),
        ("deleted_at".to_string(), Value::Null),
        ("sort_order".to_string(), Value::Integer(3)),
    ];
    assert_eq!(payload::encode_row(&shuffled), encoded);

    assert!(
        payload::decode_row(&encoded[..encoded.len() - 1]).is_err(),
        "a truncated payload is refused rather than read past its end"
    );
    assert!(payload::decode_row(&[]).is_err());
    assert_eq!(
        payload::decode_row(&payload::encode_row(&[])).expect("an empty row decodes"),
        vec![]
    );
}

/// The row marker stands in for "every column of this row" inside `column_name`, which migration
/// 032 requires to be NOT NULL for a `field` message. It only works because no real column can be
/// called that.
#[test]
fn no_column_of_the_real_schema_is_named_like_the_row_marker() {
    let dir = TempDir::new().expect("temp dir");
    let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

    let mut checked = 0;
    for rule in registry::TABLES {
        if matches!(rule.class, TableClass::LocalOnly) {
            continue;
        }

        for column in sync_capture::table_columns(&conn, rule.table).expect("the columns read") {
            assert_ne!(
                column, ROW_COLUMN_MARKER,
                "{}.{} collides with the row marker",
                rule.table, column
            );
            checked += 1;
        }
    }

    assert!(checked > 100, "only {checked} columns were checked");
}
