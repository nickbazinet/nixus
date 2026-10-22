//! Decentralised identity for the records that PREDATE sync (AD-2, amended).
//!
//! # What this closes
//!
//! A synced row travels under an identity (`sync_uuid`). A record written before sync was on has
//! none, and the first version minted a random UUIDv4 for it the moment anything first touched it:
//! reconcile, a captured edit, an insert site that needed it as a parent. That is correct for one
//! computer and wrong for two that hold the same records — a second computer signing in, a
//! restored backup, an older snapshot, two Milestone-1 computers. Each mints its own identity for
//! every record, each publishes "this record exists" under it, and each applies the other's as a
//! new row. Every table doubles, on both computers.
//!
//! # Why not "one computer decides"
//!
//! The obvious cure is a leader: the first computer to publish mints, everyone else adopts what it
//! minted. It works, and it makes one computer the owner of the dataset — the others become
//! guests that have to throw their own copy away (a *replace*) to join. Sync here has no owner. Any
//! computer may be the first, the second or the tenth, in any order, offline for any length of
//! time, and has to land on the same rows without anyone having been asked.
//!
//! So the identity of a record that predates sync is not minted, it is DERIVED: UUIDv5 over the
//! table, the record's **creation facts** and an ordinal. Two computers holding the same record
//! compute the same identity without ever speaking, which is exactly how AD-2 already treats
//! natural keys and template-generated rows. There is nothing to elect, nothing to wait for and no
//! window in which two computers can disagree.
//!
//! # Creation facts, and what is deliberately not one
//!
//! The facts are what a record WAS when it came into being plus the descriptors nobody re-types:
//! its `Immutable` columns (`created_at`, `source`, ...), its name-like columns, and the identity
//! of the parent it is never moved away from. Volatile state never feeds the identity: a balance, a
//! budget target, an asset's value, a priority, an odometer, a soft-delete flag, an edit
//! timestamp, an expense's category or account link. Two computers that disagree about THOSE hold
//! the same record in two states, and they must still land on one row — the field merge (AD-5)
//! settles the state, the identity only settles which record it is. Were they part of the identity,
//! one edit on one computer would split the record in two, and — worse — every record that points
//! at it would split too (a retargeted budget category would duplicate all of its expenses).
//!
//! The opposite error is the dangerous one: two DIFFERENT records sharing an identity would be
//! merged field by field, and one would silently overwrite the other. So a leaf record (an expense,
//! an income entry, a chat message...) keeps everything that makes it that transaction in its
//! facts, and the facts of a record that has children are chosen so a collision is not a real
//! possibility (a second-resolution `created_at` plus its name). Records whose facts are
//! genuinely identical get an ORDINAL: the n-th of them, in local row order, is `ordinal n` on
//! every computer. They are interchangeable by construction, so which row is which is immaterial.
//!
//! Splitting is the safe failure: a record edited in a fact column on one computer before it was
//! adopted is derived differently there, and shows up twice. That is the old behaviour, confined
//! to the records somebody actually changed — never a table's worth.
//!
//! # The frozen format
//!
//! [`FACTS_V1`] and the digest layout are stored format, exactly like `identity::NAMESPACE`: an
//! identity derived today must be derived identically by every future build, or two versions of
//! the app would disagree about which record is which. Changing a fact list is a migration; the
//! golden test in this file fails first.

use std::collections::HashMap;

use rusqlite::types::Value;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db::sync_apply as apply_db;
use crate::db::sync_identity::{self, RowUuid};
use crate::error::AppError;

use super::capture::payload;
use super::identity;
use super::registry;

/// Domain separation, versioned with the facts: a digest of one version can never be mistaken for
/// another's.
const DIGEST_DOMAIN: &[u8] = b"nixus/sync/legacy-row/v1";

/// What a row held BEFORE the write that is about to change it, by column name.
///
/// The capture hook sees an `UPDATE` after the statement has run, so a record's first captured edit
/// would otherwise be derived from its edited state — and no other computer holds that state. The
/// hook buffered the old values, and deriving from those is what makes "first touched by an edit"
/// land on the identity of the record as it was.
pub(crate) type Observed = HashMap<String, Value>;

/// Parent identities to read as another identity: `(parent table, identity) -> identity`.
///
/// What lets the duplicate repair (`dedupe`) compare the children of two records it has already
/// decided are the same record: the children of each point at a different parent identity, and
/// only after the second is read as the first do they have the same facts.
pub(crate) type Remap = HashMap<(&'static str, RowUuid), RowUuid>;

/// Where the next free ordinal of each class of identical records was last found, within ONE
/// settle pass.
///
/// Without it the n-th of n identical records re-probes the n-1 ordinals the others already took,
/// which is quadratic: two thousand identical audit entries took half a minute. Within a pass
/// ordinals are only ever taken, never freed, so resuming after the last one found is exactly as
/// correct as starting over — and it must never outlive the pass (a rolled-back chunk would leave
/// it ahead of the database), which is why the pass owns it and a failed chunk drops it.
#[derive(Debug, Default)]
pub(crate) struct Ordinals {
    next: HashMap<(&'static str, [u8; 32]), u32>,
    /// Ordinals tried, so a test can prove the work is linear without timing anything.
    #[cfg(test)]
    pub(crate) probes: u64,
}

/// The creation facts of one table (see the module documentation).
struct Facts {
    table: &'static str,
    /// Plain columns, hashed as themselves, in this order.
    columns: &'static [&'static str],
    /// Foreign keys, hashed as the IDENTITY of the row they name (`NULL` stays `NULL`), in this
    /// order. Only parents a record is never moved away from appear here.
    parents: &'static [&'static str],
}

/// FROZEN. The facts of every table that has no natural key, which is every table whose identity
/// would otherwise be a coin toss.
///
/// `config`, `maintenance_tasks`, `merchant_category_hints` and `project_images` are absent on
/// purpose: their identity is already a function of a natural key (AD-2), and a record cannot have
/// two sources of truth about which record it is.
const FACTS_V1: &[Facts] = &[
    Facts {
        table: "accounts",
        columns: &[
            "name",
            "institution",
            "account_type",
            "currency",
            "created_at",
        ],
        parents: &[],
    },
    // The entity is named by uuid (migration 034), never by the machine-local `entity_id`.
    Facts {
        table: "audit_log",
        columns: &[
            "entity_type",
            "entity_uuid",
            "action",
            "old_value",
            "new_value",
            "created_at",
        ],
        parents: &[],
    },
    Facts {
        table: "budget_categories",
        columns: &["name", "created_at"],
        parents: &["group_id"],
    },
    Facts {
        table: "budget_groups",
        columns: &["name", "created_at"],
        parents: &[],
    },
    // The title is derived from the first message after the conversation exists, so it is state.
    Facts {
        table: "chat_conversations",
        columns: &["agent_id", "created_at"],
        parents: &[],
    },
    Facts {
        table: "chat_messages",
        columns: &["role", "content", "created_at", "message_type"],
        parents: &["conversation_id"],
    },
    // The category and the account are links the user re-points, so they are state, not facts.
    Facts {
        table: "expenses",
        columns: &["merchant", "amount_cents", "date", "source", "created_at"],
        parents: &[],
    },
    Facts {
        table: "income_entries",
        columns: &["amount_cents", "date", "month", "created_at"],
        parents: &["source_id", "recurring_income_template_id"],
    },
    Facts {
        table: "income_sources",
        columns: &["name", "income_type", "created_at"],
        parents: &[],
    },
    Facts {
        table: "maintenance_service_logs",
        columns: &[
            "custom_service_name",
            "service_date",
            "odometer_km",
            "notes",
            "created_at",
        ],
        parents: &["vehicle_id", "task_id"],
    },
    // The totals are recomputed over the day; the snapshot is "the one for that date".
    Facts {
        table: "net_worth_snapshots",
        columns: &["snapshot_date", "created_at"],
        parents: &[],
    },
    // The value is what the user keeps updating, so it is state.
    Facts {
        table: "passive_assets",
        columns: &["name", "asset_type", "created_at"],
        parents: &[],
    },
    Facts {
        table: "project_contributions",
        columns: &["amount_cents", "source", "date", "created_at"],
        parents: &["project_id", "account_id"],
    },
    Facts {
        table: "projects",
        columns: &["name", "created_at"],
        parents: &[],
    },
    // A template's amount, day and switch are settings. Were they facts, retuning one on a single
    // computer would split it, and the split would generate every month's expense twice.
    Facts {
        table: "recurring_expense_templates",
        columns: &["merchant", "created_at"],
        parents: &[],
    },
    Facts {
        table: "recurring_income_templates",
        columns: &["created_at"],
        parents: &["source_id"],
    },
    Facts {
        table: "vehicles",
        columns: &["nickname", "make", "model", "year", "created_at"],
        parents: &[],
    },
];

fn facts_of(table: &str) -> Option<&'static Facts> {
    FACTS_V1.iter().find(|facts| facts.table == table)
}

/// Whether a table's identity is derived from creation facts (as opposed to a natural key).
pub(crate) fn has_creation_facts(table: &str) -> bool {
    facts_of(table).is_some()
}

/// The identity of a record that existed before it had one; `None` when there is no such record
/// to name — the row is not in the table and nothing was observed of it.
///
/// A recorded identity wins outright. Otherwise the record's creation facts are digested and the
/// first free ordinal for that digest is bound to the row. "Free" means no OTHER local row holds
/// it and no local tombstone retired it: a retired identity is one other computers were told is
/// gone, and handing it to a new row would have them drop that row's creation.
///
/// `observed` carries the values the row had before the write that is touching it, when there is
/// one (see [`Observed`]); everything else is read from the table. A row that is already deleted
/// by the time it is named — a balance delta caused by the very expense this write removed — is
/// named from what was observed of it.
pub(crate) fn legacy_identity(
    conn: &Connection,
    table: &str,
    row_id: i64,
    observed: Option<&Observed>,
    mut ordinals: Option<&mut Ordinals>,
) -> Result<Option<RowUuid>, AppError> {
    if let Some(found) = sync_identity::lookup(conn, table, row_id)? {
        return Ok(Some(found));
    }

    let rule = registry::table(table).ok_or_else(|| unclassified(table))?;
    let facts = facts_of(rule.table).ok_or_else(|| unclassified(table))?;
    let Some(digest) = creation_digest(conn, facts, row_id, observed, None)? else {
        return Ok(None);
    };

    let mut ordinal: u32 = ordinals
        .as_ref()
        .and_then(|hints| hints.next.get(&(rule.table, digest)))
        .copied()
        .unwrap_or(0);
    loop {
        #[cfg(test)]
        if let Some(hints) = ordinals.as_deref_mut() {
            hints.probes += 1;
        }

        let candidate = identity::legacy_row(rule.table, &digest, ordinal);

        if !retired(conn, rule.table, &candidate)? {
            let binding = sync_identity::ensure(conn, rule.table, row_id, &candidate)?;
            if binding.row_id == row_id {
                if let Some(hints) = ordinals.as_deref_mut() {
                    hints
                        .next
                        .insert((rule.table, digest), ordinal.saturating_add(1));
                }

                // `ensure` answers with the identity IN FORCE: a row that was bound between the
                // lookup above and here keeps what it was given.
                return Ok(Some(binding.uuid));
            }
        }

        ordinal = ordinal.checked_add(1).ok_or_else(|| AppError::Database {
            message: format!("{table} holds more identical records than an ordinal can number"),
        })?;
    }
}

/// An identity this computer has recorded a delete for.
fn retired(conn: &Connection, table: &str, uuid: &RowUuid) -> Result<bool, AppError> {
    Ok(apply_db::tombstone(conn, table, uuid)?.is_some())
}

/// SHA-256 over the domain, the table and every fact, each length-prefixed so two different
/// records cannot spell the same bytes. `None` when the row is gone and nothing was observed.
fn creation_digest(
    conn: &Connection,
    facts: &Facts,
    row_id: i64,
    observed: Option<&Observed>,
    remap: Option<&Remap>,
) -> Result<Option<[u8; 32]>, AppError> {
    let wanted: Vec<&'static str> = facts
        .columns
        .iter()
        .chain(facts.parents.iter())
        .copied()
        .collect();
    let live = apply_db::read_columns(conn, facts.table, row_id, &wanted)?;
    let value_of = |name: &str| -> Option<Value> {
        observed
            .and_then(|values| values.get(name))
            .cloned()
            .or_else(|| {
                live.iter()
                    .find(|(column, _)| *column == name)
                    .map(|(_, value)| value.clone())
            })
    };

    // Not in the table and not observed either: there is no record here to name.
    if wanted.iter().any(|column| value_of(column).is_none()) {
        return Ok(None);
    }

    let mut hasher = Sha256::new();
    absorb(&mut hasher, DIGEST_DOMAIN);
    absorb(&mut hasher, facts.table.as_bytes());

    for column in facts.columns {
        let value = value_of(column).unwrap_or(Value::Null);
        absorb(&mut hasher, column.as_bytes());
        absorb(&mut hasher, &payload::encode(&value));
    }

    for column in facts.parents {
        let value = value_of(column).unwrap_or(Value::Null);
        let parent =
            registry::fk_parent(facts.table, column).ok_or_else(|| AppError::Database {
                message: format!(
                    "{}.{column} is named a parent but is not a foreign key",
                    facts.table
                ),
            })?;

        absorb(&mut hasher, column.as_bytes());
        absorb(
            &mut hasher,
            &payload::encode(&parent_fact(conn, parent, &value, remap)?),
        );
    }

    Ok(Some(hasher.finalize().into()))
}

/// A foreign key as the fact it contributes: the parent's identity, or `NULL`.
///
/// A parent that does not exist is `NULL` too. Foreign keys are enforced, so that is a hand-edited
/// database; it must still get an identity (and not block every row beneath it), and `NULL` is
/// what two computers with the same defect would agree on.
fn parent_fact(
    conn: &Connection,
    parent: &'static str,
    value: &Value,
    remap: Option<&Remap>,
) -> Result<Value, AppError> {
    let Value::Integer(parent_row) = value else {
        return Ok(Value::Null);
    };

    match super::reconcile::existing_identity(conn, parent, *parent_row)? {
        Some(uuid) => {
            let read_as = remap
                .and_then(|remap| remap.get(&(parent, uuid)))
                .copied()
                .unwrap_or(uuid);

            Ok(Value::Blob(read_as.to_vec()))
        }
        None => Ok(Value::Null),
    }
}

/// The digest of a record's creation facts with its parents read through `remap`, for a record
/// that already has an identity — the key two records are compared by when deciding whether they
/// are one record held twice. `None` when the table has no creation facts or the row is gone.
pub(crate) fn digest_through(
    conn: &Connection,
    table: &str,
    row_id: i64,
    remap: &Remap,
) -> Result<Option<[u8; 32]>, AppError> {
    let Some(facts) = facts_of(table) else {
        return Ok(None);
    };

    creation_digest(conn, facts, row_id, None, Some(remap))
}

fn absorb(hasher: &mut Sha256, part: &[u8]) {
    hasher.update((part.len() as u64).to_be_bytes());
    hasher.update(part);
}

fn unclassified(table: &str) -> AppError {
    AppError::Database {
        message: format!("{table} has no creation facts, so a record in it cannot be adopted"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::capture_fixtures as fixtures;
    use crate::db::test_dataset::migrated_dataset;
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        (dir, conn)
    }

    fn account(conn: &Connection, id: i64, name: &str, cents: i64, stamp: &str) {
        conn.execute(
            "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents, \
             created_at, updated_at) VALUES (?1, ?2, 'Bank', 'chequing', 'CAD', ?3, ?4, ?4)",
            rusqlite::params![id, name, cents, stamp],
        )
        .expect("an account inserts");
    }

    fn adopt(conn: &Connection, table: &str, row_id: i64) -> RowUuid {
        legacy_identity(conn, table, row_id, None, None)
            .expect("the identity derives")
            .expect("the row exists")
    }

    /// Every table the registry gives a SURROGATE identity must have creation facts — otherwise a
    /// record in it could only be given a random one, and this whole module would have a hole in
    /// the middle — and every fact must be something the registry knows about.
    #[test]
    fn every_surrogate_table_has_facts_and_every_fact_is_a_real_column() {
        for rule in registry::TABLES {
            let surrogate = matches!(
                rule.identity,
                Some(registry::RowIdentity::Surrogate | registry::RowIdentity::SurrogateOrTemplate)
            );
            assert_eq!(
                has_creation_facts(rule.table),
                surrogate,
                "{} {} creation facts",
                rule.table,
                if surrogate { "needs" } else { "must not have" }
            );
        }

        for facts in FACTS_V1 {
            for column in facts.columns {
                let merge = registry::merge_kind(facts.table, column)
                    .unwrap_or_else(|| panic!("{}.{column} is not a registry column", facts.table));
                assert!(
                    !matches!(
                        merge,
                        registry::MergeKind::Balance
                            | registry::MergeKind::Counter
                            | registry::MergeKind::Excluded
                    ),
                    "{}.{column} is folded or excluded state, never a creation fact",
                    facts.table
                );
            }
            for column in facts.parents {
                assert!(
                    registry::fk_parent(facts.table, column).is_some(),
                    "{}.{column} is declared a parent but is not a foreign key",
                    facts.table
                );
            }
        }
    }

    /// THE POINT, as a test: two computers that numbered the same record differently, and never
    /// spoke, derive the same identity for it.
    #[test]
    fn two_computers_holding_the_same_record_derive_the_same_identity() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();

        account(&one, 1, "Emergency", 912_702, "2026-03-15 21:58:20");
        // Different row id, different balance, different `updated_at`: the same record, differently
        // numbered and in a different state.
        account(&two, 77, "Emergency", 2_412_702, "2026-03-15 21:58:20");
        two.execute(
            "UPDATE accounts SET updated_at = '2026-10-21 20:31:16' WHERE id = 77",
            [],
        )
        .expect("the edit applies");

        assert_eq!(
            adopt(&one, "accounts", 1),
            adopt(&two, "accounts", 77),
            "a balance and an edit timestamp are state, not which record it is"
        );
    }

    #[test]
    fn a_different_record_derives_a_different_identity() {
        let (_dir, conn) = dataset();
        account(&conn, 1, "Emergency", 100, "2026-03-15 21:58:20");
        account(&conn, 2, "Emergency", 100, "2026-03-15 21:58:21");
        account(&conn, 3, "Main Chequing", 100, "2026-03-15 21:58:20");

        let identities = [
            adopt(&conn, "accounts", 1),
            adopt(&conn, "accounts", 2),
            adopt(&conn, "accounts", 3),
        ];
        assert_eq!(
            identities
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3,
            "a different name or a different creation second is a different record"
        );
    }

    #[test]
    fn a_record_edited_in_a_fact_before_it_was_adopted_is_a_different_record() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        account(&one, 1, "Emergency", 100, "2026-03-15 21:58:20");
        account(&two, 1, "Emergency fund", 100, "2026-03-15 21:58:20");

        assert_ne!(
            adopt(&one, "accounts", 1),
            adopt(&two, "accounts", 1),
            "splitting is the safe failure: it can double a record, never merge two of them"
        );
    }

    /// Three coffees on one day are one fact set three times. Each is its own record, numbered the
    /// same way on every computer.
    #[test]
    fn identical_records_get_consecutive_ordinals_in_local_row_order() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        for conn in [&one, &two] {
            fixtures::seed_pre_sync_records(conn).expect("the records seed");
        }

        // Rows 4, 5 and 6 are the three identical coffees.
        let first: Vec<RowUuid> = (4..=6).map(|id| adopt(&one, "expenses", id)).collect();
        let second: Vec<RowUuid> = (4..=6).map(|id| adopt(&two, "expenses", id)).collect();

        assert_eq!(
            first, second,
            "the n-th identical record is the same record everywhere"
        );
        assert_eq!(
            first.iter().collect::<std::collections::HashSet<_>>().len(),
            3,
            "identical records are still three records"
        );
        assert_eq!(
            first,
            vec![
                identity::legacy_row("expenses", &digest_of(&one, "expenses", 4), 0),
                identity::legacy_row("expenses", &digest_of(&one, "expenses", 4), 1),
                identity::legacy_row("expenses", &digest_of(&one, "expenses", 4), 2),
            ]
        );
    }

    fn digest_of(conn: &Connection, table: &str, row_id: i64) -> [u8; 32] {
        let facts = facts_of(table).expect("facts exist");
        creation_digest(conn, facts, row_id, None, None)
            .expect("the digest computes")
            .expect("the row exists")
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// THE golden test of the format: the digest of one fixed record, and the identity it derives.
    /// Both are stored format. If either changes, a record adopted by an older build and the same
    /// record adopted by this one are two records, on every computer that holds it.
    #[test]
    fn the_creation_digest_has_the_value_it_shipped_with() {
        let (_dir, conn) = dataset();
        account(&conn, 1, "Emergency", 912_702, "2026-03-15 21:58:20");

        assert_eq!(
            hex(&digest_of(&conn, "accounts", 1)),
            "79439a0b8fc68717218e7339558b81a81a5c204a6ceb5d32536936f369d4e142",
            "the facts, their order or their encoding changed"
        );
        assert_eq!(
            hex(&adopt(&conn, "accounts", 1)),
            "5139de7859375c098837fabf6f5be382",
            "the derivation changed"
        );
    }

    #[test]
    fn a_recorded_identity_is_never_replaced() {
        let (_dir, conn) = dataset();
        account(&conn, 1, "Emergency", 100, "2026-03-15 21:58:20");

        let minted = identity::uuid_for(&conn, "accounts", 1).expect("a random mint");
        assert_eq!(adopt(&conn, "accounts", 1), minted);
    }

    #[test]
    fn deriving_twice_is_idempotent() {
        let (_dir, conn) = dataset();
        account(&conn, 1, "Emergency", 100, "2026-03-15 21:58:20");

        assert_eq!(adopt(&conn, "accounts", 1), adopt(&conn, "accounts", 1));
        assert_eq!(sync_identity::count(&conn).expect("the count reads"), 1);
    }

    /// A retired identity is one other computers were told is gone; a new record must not inherit it.
    #[test]
    fn an_identity_this_computer_deleted_is_skipped() {
        let (_dir, conn) = dataset();
        account(&conn, 1, "Emergency", 100, "2026-03-15 21:58:20");
        let first = adopt(&conn, "accounts", 1);

        crate::db::sync_apply::record_tombstone(
            &conn,
            "accounts",
            &first,
            &"0".repeat(33),
            "0a1b2c3d4e5f6071",
            "{}",
            30,
        )
        .expect("the tombstone records");
        sync_identity::forget(&conn, "accounts", 1).expect("the mapping goes");

        assert_ne!(
            adopt(&conn, "accounts", 1),
            first,
            "the row is adopted again under the next ordinal, not under the retired identity"
        );
    }

    /// A child's identity names its parent's, so records beneath one parent cannot be confused
    /// with the same-looking records beneath another.
    #[test]
    fn a_child_is_derived_through_its_parents_identity() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        for (conn, group_ids) in [(&one, (1, 2)), (&two, (9, 4))] {
            conn.execute_batch("PRAGMA foreign_keys = OFF")
                .expect("fks off");
            for (id, name) in [(group_ids.0, "Living"), (group_ids.1, "Lifestyle")] {
                conn.execute(
                    "INSERT INTO budget_groups (id, name, sort_order, created_at) \
                     VALUES (?1, ?2, 0, '2026-03-15 21:56:07')",
                    rusqlite::params![id, name],
                )
                .expect("a group inserts");
            }
            // The same category ("Groceries") under each of the two groups.
            for (id, group) in [(1, group_ids.0), (2, group_ids.1)] {
                conn.execute(
                    "INSERT INTO budget_categories (id, group_id, name, target_cents, created_at) \
                     VALUES (?1, ?2, 'Groceries', 1000, '2026-03-15 21:56:07')",
                    rusqlite::params![id, group],
                )
                .expect("a category inserts");
            }
        }

        let one_groceries: Vec<RowUuid> = (1..=2)
            .map(|id| adopt(&one, "budget_categories", id))
            .collect();
        let two_groceries: Vec<RowUuid> = (1..=2)
            .map(|id| adopt(&two, "budget_categories", id))
            .collect();

        assert_ne!(
            one_groceries[0], one_groceries[1],
            "same name, different group: two records"
        );
        assert_eq!(
            one_groceries, two_groceries,
            "and the same two records on a computer that numbered its groups differently"
        );
    }

    /// The failure that would hurt most if the state leaked into the identity: retargeting one
    /// budget category on one computer must not split the category and, through it, every expense.
    #[test]
    fn a_budget_target_is_state_and_does_not_move_a_category() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        for conn in [&one, &two] {
            fixtures::seed_pre_sync_records(conn).expect("the records seed");
        }
        two.execute(
            "UPDATE budget_categories SET target_cents = 999999 WHERE id = 1",
            [],
        )
        .expect("the target is retargeted on one computer only");

        assert_eq!(
            adopt(&one, "budget_categories", 1),
            adopt(&two, "budget_categories", 1)
        );
    }

    /// The hook sees an UPDATE after it ran; the identity must still be that of the record as it
    /// was, because that is the record the other computer holds.
    #[test]
    fn values_observed_before_a_write_decide_the_identity_not_the_edited_row() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        account(&one, 1, "Emergency", 100, "2026-03-15 21:58:20");
        account(&two, 1, "Emergency", 100, "2026-03-15 21:58:20");
        // The user renames the account on `two`; the hook buffered the old row.
        two.execute("UPDATE accounts SET name = 'Rainy day' WHERE id = 1", [])
            .expect("the rename applies");
        let before: Observed = [("name".to_string(), Value::Text("Emergency".to_string()))]
            .into_iter()
            .collect();

        assert_eq!(
            adopt(&one, "accounts", 1),
            legacy_identity(&two, "accounts", 1, Some(&before), None)
                .expect("derives")
                .expect("the row exists"),
            "the first captured edit of a record adopts it as it was"
        );
    }

    /// A row that is already deleted when it is named — the expense a balance reversal was caused
    /// by, removed in the very write that is being captured — is named from what was observed of it.
    #[test]
    fn a_row_that_is_gone_is_named_from_what_was_observed_of_it() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        fixtures::seed_pre_sync_records(&one).expect("the records seed");
        fixtures::seed_pre_sync_records(&two).expect("the records seed");

        let before: Observed = {
            let facts = facts_of("expenses").expect("facts exist");
            apply_db::read_columns(&two, "expenses", 1, facts.columns)
                .expect("the row reads")
                .into_iter()
                .map(|(column, value)| (column.to_string(), value))
                .collect()
        };
        two.execute("DELETE FROM expenses WHERE id = 1", [])
            .expect("the delete applies");

        assert_eq!(
            legacy_identity(&two, "expenses", 1, None, None).expect("answers"),
            None,
            "with nothing observed there is simply no record to name"
        );
        assert_eq!(
            adopt(&one, "expenses", 1),
            legacy_identity(&two, "expenses", 1, Some(&before), None)
                .expect("derives")
                .expect("named from the observation"),
            "a deleted record is the same record on the computer that still holds it"
        );
    }

    #[test]
    fn a_table_without_creation_facts_cannot_be_adopted() {
        let (_dir, conn) = dataset();

        assert!(legacy_identity(&conn, "config", 1, None, None).is_err());
        assert!(legacy_identity(&conn, "not_a_table", 1, None, None).is_err());
    }
}
