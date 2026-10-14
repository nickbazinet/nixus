//! Row identity (AD-2): which uuid a row has, and where it comes from.
//!
//! Two mechanisms, and the difference between them is the whole of AD-2:
//!
//! - A **surrogate** row's identity is random (UUIDv4) and minted LAZILY into `sync_uuid` the first
//!   time the row is seen. Nothing about the row determines it, so it can only ever be created on
//!   one computer and travel from there.
//! - A **natural-key** or **template-generated** row's identity is DERIVED (UUIDv5) from its key,
//!   expressed in the uuids of the rows it references and never in local integer ids. That is what
//!   lets two computers that independently create "the same" row land on one row rather than two,
//!   with no coordinator: both compute the same identity from the same facts.
//!
//! `sync_uuid` is the only place an identity is bound to a local integer id; the SQL for it is in
//! `db::sync_identity` (project-context rule 1) and this module decides what to put there.

use rusqlite::Connection;
use uuid::Uuid;

use crate::db::sync_identity::{self, Mapping, RowUuid};
use crate::error::AppError;

/// The FROZEN namespace every derived identity is computed under.
///
/// A literal and not a computed value, because the bytes are the contract: the same logical row on
/// two computers, or on one computer across two app versions, has to derive the same identity
/// forever. Changing this constant renames every natural-key and template-generated row in every
/// database that already exists, which is a migration and not a refactor.
///
/// `the_namespace_is_the_frozen_derivation_of_the_nixus_url` pins both halves: that the literal is
/// exactly UUIDv5 of the URL namespace over [`NAMESPACE_URL_NAME`], so it is explicable rather than
/// arbitrary, and that it still has the value it shipped with.
#[allow(dead_code)]
pub const NAMESPACE: Uuid = Uuid::from_bytes([
    0x80, 0xf9, 0xe8, 0x05, 0x6e, 0xb4, 0x53, 0xc0, 0x8c, 0x1b, 0x53, 0x84, 0xeb, 0x57, 0xcb, 0x65,
]);

/// What [`NAMESPACE`] was derived from, once, so the constant can be re-checked rather than trusted.
#[allow(dead_code)]
pub const NAMESPACE_URL_NAME: &str = "https://nixusapp.com/sync/row-identity/v1";

/// The uuid of a surrogate row, minted on first sight and stable afterwards.
///
/// Lazy on purpose (AD-2): a local-only user pays nothing, and no data table gains a uuid column.
/// The mint is `INSERT OR IGNORE` plus a read in [`sync_identity::ensure`], so two callers racing
/// for one row both end up with the identity that won.
pub fn uuid_for(conn: &Connection, table: &str, row_id: i64) -> Result<RowUuid, AppError> {
    if let Some(existing) = sync_identity::lookup(conn, table, row_id)? {
        return Ok(existing);
    }

    Ok(sync_identity::ensure(conn, table, row_id, Uuid::new_v4().as_bytes())?.uuid)
}

/// Binds a DERIVED identity to a local row, for the natural-key and template-generated cases AD-2
/// says are "mapped explicitly at their insert sites".
///
/// Returns the binding in force afterwards. Its `row_id` is the caller's own unless this computer
/// had already generated a local row for the same logical row, in which case the identity stays
/// with the row that claimed it first and the caller learns which one that is.
pub fn ensure_derived(
    conn: &Connection,
    table: &str,
    row_id: i64,
    uuid: &RowUuid,
) -> Result<Mapping, AppError> {
    sync_identity::ensure(conn, table, row_id, uuid)
}

/// `merchant_category_hints (merchant, category uuid)` — the schema's `UNIQUE(merchant,
/// budget_category_id)`, with the integer category id replaced by the CATEGORY'S OWN UUID.
///
/// The substitution is the point: `budget_category_id` 3 is a different category on every computer,
/// so a key built from it would collide two unrelated hints and split one hint in two.
pub fn merchant_category_hint(merchant: &str, category: &RowUuid) -> RowUuid {
    derive("merchant_category_hints", &[merchant.as_bytes(), category])
}

/// AD-5's cause key for a balance delta, as one uuid: `(cause row uuid, kind)` plus a
/// discriminator that decides whether the key is per ROW or per OCCURRENCE.
///
/// Per row (`discriminator` empty) is what makes a reversal idempotent ACROSS COMPUTERS: two
/// computers deleting the same expense both derive the same cause, so the account is credited once
/// rather than twice. Per occurrence (`discriminator` = the emitting message's own `hlc`) is what
/// keeps a REPEATED cause from being mistaken for a duplicate: editing one expense twice is two
/// real events, and a key that ignored the occurrence would deduplicate the second into a lost
/// update.
///
/// The cause row's TABLE is part of the material even though a row uuid is already unique, for the
/// same reason [`derive`] includes it everywhere else: the key has to stay injective if a later
/// story derives a cause from something that is not a row uuid.
pub fn balance_cause(
    cause_table: &str,
    cause_row: &RowUuid,
    kind: &str,
    discriminator: &str,
) -> RowUuid {
    derive(
        "balance_cause",
        &[
            cause_table.as_bytes(),
            cause_row,
            kind.as_bytes(),
            discriminator.as_bytes(),
        ],
    )
}

/// `maintenance_tasks (vehicle uuid, task_type_key)` — the schema's `UNIQUE(vehicle_id,
/// task_type_key)`, with the vehicle named by uuid.
pub fn maintenance_task(vehicle: &RowUuid, task_type_key: &str) -> RowUuid {
    derive("maintenance_tasks", &[vehicle, task_type_key.as_bytes()])
}

/// `project_images` takes its owning project's uuid: the table's primary key IS `project_id`, so
/// the image has no identity of its own beyond "the picture of that project".
pub fn project_image(project: &RowUuid) -> RowUuid {
    derive("project_images", &[project])
}

/// `config` is keyed by the setting's name, which is already machine-independent — so unlike every
/// other derived identity there is no referenced row to express it through.
pub fn config_key(key: &str) -> RowUuid {
    derive("config", &[key.as_bytes()])
}

/// An expense row that every computer generates on its own from a recurring template at startup:
/// `(template uuid, period)`, so the same month's row is ONE row rather than one per computer.
pub fn recurring_expense(template: &RowUuid, period: &str) -> RowUuid {
    derive("expenses", &[template, period.as_bytes()])
}

/// The income half of the same rule.
pub fn recurring_income(template: &RowUuid, period: &str) -> RowUuid {
    derive("income_entries", &[template, period.as_bytes()])
}

/// UUIDv5 over the table name and the key parts, each part LENGTH-PREFIXED.
///
/// The length prefix is what makes the construction injective: without it `("ab", "c")` and
/// `("a", "bc")` hash the same bytes, so two different merchants could share one identity. The
/// table name is included so the same key material in two tables cannot collide either.
fn derive(table: &str, parts: &[&[u8]]) -> RowUuid {
    let mut name = Vec::new();
    for part in std::iter::once(table.as_bytes()).chain(parts.iter().copied()) {
        name.extend_from_slice(&(part.len() as u64).to_be_bytes());
        name.extend_from_slice(part);
    }

    *Uuid::new_v5(&NAMESPACE, &name).as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_dataset::migrated_dataset;
    use std::collections::HashSet;
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        (dir, conn)
    }

    fn hex(uuid: &RowUuid) -> String {
        uuid.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    const CATEGORY: RowUuid = [0x11; 16];
    const VEHICLE: RowUuid = [0x22; 16];
    const PROJECT: RowUuid = [0x33; 16];
    const TEMPLATE: RowUuid = [0x44; 16];

    #[test]
    fn the_namespace_is_the_frozen_derivation_of_the_nixus_url() {
        assert_eq!(
            NAMESPACE,
            Uuid::new_v5(&Uuid::NAMESPACE_URL, NAMESPACE_URL_NAME.as_bytes()),
            "the literal must stay exactly the derivation it is documented as"
        );
        assert_eq!(
            NAMESPACE.to_string(),
            "80f9e805-6eb4-53c0-8c1b-5384eb57cb65",
            "changing the namespace renames every derived row in every existing database"
        );
    }

    /// THE golden test. Every one of these values is now part of the stored format: a row created
    /// by an older build and a row created by a newer one have to share an identity, so any change
    /// to the construction — the namespace, the length prefix, the table name, the part order —
    /// breaks one of these literals rather than silently splitting rows in two.
    #[test]
    fn every_derivation_has_the_value_it_shipped_with() {
        assert_eq!(
            hex(&merchant_category_hint("Metro", &CATEGORY)),
            "1d22ece8167e5262b139746437bbf96e"
        );
        assert_eq!(
            hex(&maintenance_task(&VEHICLE, "oil_change")),
            "cb03aab2cab452a683877458655d9faa"
        );
        assert_eq!(hex(&project_image(&PROJECT)), "cee1badd1b2d5f389951f98409f56132");
        assert_eq!(hex(&config_key("theme")), "63fff85987455b5897512b5f954c5778");
        assert_eq!(
            hex(&recurring_expense(&TEMPLATE, "2026-10")),
            "597c1e7a05555786975b9d87a565a4d4"
        );
        assert_eq!(
            hex(&recurring_income(&TEMPLATE, "2026-10")),
            "5aed10a8ef97533d948f0e409d0a75e3"
        );
    }

    #[test]
    fn a_derived_identity_is_a_version_5_uuid() {
        for derived in [
            merchant_category_hint("Metro", &CATEGORY),
            maintenance_task(&VEHICLE, "oil_change"),
            project_image(&PROJECT),
            config_key("theme"),
            recurring_expense(&TEMPLATE, "2026-10"),
            recurring_income(&TEMPLATE, "2026-10"),
        ] {
            let uuid = Uuid::from_bytes(derived);
            assert_eq!(uuid.get_version_num(), 5, "{uuid} must be a derived uuid");
        }
    }

    /// The length prefix earning its place: `("ab", "c")` and `("a", "bc")` would hash the same
    /// bytes without it, so two different merchants would share one identity.
    #[test]
    fn the_length_prefix_keeps_the_construction_injective() {
        assert_ne!(
            merchant_category_hint("ab", &CATEGORY),
            merchant_category_hint("a", &CATEGORY),
        );
        assert_ne!(
            derive("t", &[b"ab", b"c"]),
            derive("t", &[b"a", b"bc"]),
            "concatenation alone would make these equal"
        );
    }

    /// The table name earning its place: the two template rules take the same `(template, period)`
    /// material, and an expense is not an income entry.
    #[test]
    fn the_same_key_material_in_two_tables_derives_two_identities() {
        assert_ne!(
            recurring_expense(&TEMPLATE, "2026-10"),
            recurring_income(&TEMPLATE, "2026-10"),
        );
    }

    #[test]
    fn a_different_period_or_a_different_template_is_a_different_row() {
        let other_template: RowUuid = [0x55; 16];

        assert_ne!(
            recurring_expense(&TEMPLATE, "2026-10"),
            recurring_expense(&TEMPLATE, "2026-11"),
        );
        assert_ne!(
            recurring_expense(&TEMPLATE, "2026-10"),
            recurring_expense(&other_template, "2026-10"),
        );
    }

    /// AD-2's reason for the whole design: a key built from `budget_category_id` would be a key
    /// built from a number that means something different on every computer.
    #[test]
    fn a_natural_key_is_expressed_in_the_referenced_rows_uuid_not_its_integer_id() {
        let other_category: RowUuid = [0x66; 16];

        assert_ne!(
            merchant_category_hint("Metro", &CATEGORY),
            merchant_category_hint("Metro", &other_category),
            "two categories must give two hints"
        );
    }

    #[test]
    fn a_surrogate_identity_is_minted_once_and_is_random() {
        let (_dir, conn) = dataset();

        let first = uuid_for(&conn, "accounts", 1).expect("the first mint");
        assert_eq!(
            uuid_for(&conn, "accounts", 1).expect("the second call"),
            first,
            "minting is lazy, not repeated"
        );

        let minted: HashSet<RowUuid> = (2..=50)
            .map(|row_id| uuid_for(&conn, "accounts", row_id).expect("a mint"))
            .collect();
        assert_eq!(minted.len(), 49, "a random identity must not repeat");
        assert_eq!(
            Uuid::from_bytes(first).get_version_num(),
            4,
            "a surrogate identity is random, not derived"
        );
    }

    /// THE POINT OF THE WHOLE STORY, stated as a test: two databases that gave the same logical
    /// rows DIFFERENT integer ids must still agree on every derived identity, and must disagree on
    /// every surrogate one.
    #[test]
    fn two_databases_with_different_integer_ids_agree_on_every_derived_identity() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();

        // The same three logical rows, inserted in a different ORDER on each side, so SQLite hands
        // out different integer ids for them. Read back by name, which is the only thing the two
        // databases agree on.
        const LOGICAL: [&str; 3] = ["Living", "Lifestyle", "Obligations"];
        let ids_on = |conn: &Connection, order: [&str; 3]| -> Vec<i64> {
            for (index, name) in order.iter().enumerate() {
                conn.execute(
                    "INSERT INTO budget_groups (name, sort_order) VALUES (?1, ?2)",
                    rusqlite::params![name, index as i64],
                )
                .expect("a group inserts");
            }

            LOGICAL
                .iter()
                .map(|name| {
                    conn.query_row(
                        "SELECT id FROM budget_groups WHERE name = ?1",
                        rusqlite::params![name],
                        |row| row.get(0),
                    )
                    .expect("the id reads")
                })
                .collect()
        };

        let one_ids = ids_on(&one, LOGICAL);
        let two_ids = ids_on(&two, ["Obligations", "Lifestyle", "Living"]);
        assert_eq!(one_ids, vec![1, 2, 3]);
        assert_eq!(
            two_ids,
            vec![3, 2, 1],
            "the fixture must actually produce different integer ids or this proves nothing"
        );

        // Each side mints its own surrogate identity for "Living" from its own integer id.
        let one_living = uuid_for(&one, "budget_groups", one_ids[0]).expect("a mint");
        let two_living = uuid_for(&two, "budget_groups", two_ids[0]).expect("a mint");
        assert_ne!(
            one_living, two_living,
            "a surrogate identity is per-computer; it travels, it is not re-derived"
        );

        // A derived identity, however, is a function of the facts — so once the two sides know the
        // referenced row's uuid, they agree without ever exchanging the derived value.
        let shared_category: RowUuid = one_living;
        assert_eq!(
            merchant_category_hint("Metro", &shared_category),
            merchant_category_hint("Metro", &shared_category),
        );

        // And it survives being bound to two different local rows, which is the case that makes the
        // whole scheme work: each database maps the one identity onto whatever rowid it used.
        let derived = recurring_expense(&TEMPLATE, "2026-10");
        let on_one = ensure_derived(&one, "expenses", 41, &derived).expect("one side maps it");
        let on_two = ensure_derived(&two, "expenses", 907, &derived).expect("the other side maps it");
        assert_eq!(on_one.uuid, on_two.uuid, "one identity, two local rows");
        assert_eq!((on_one.row_id, on_two.row_id), (41, 907));
        assert_eq!(
            sync_identity::row_id_for(&one, "expenses", &derived).expect("read"),
            Some(41)
        );
        assert_eq!(
            sync_identity::row_id_for(&two, "expenses", &derived).expect("read"),
            Some(907)
        );
    }

    /// Two computers generating the same month from the same template must converge on ONE row,
    /// which in the mapping is one identity bound to whatever rowid each side happened to use.
    #[test]
    fn a_template_generated_row_maps_to_one_identity_per_period() {
        let (_dir, conn) = dataset();

        let october = recurring_expense(&TEMPLATE, "2026-10");
        ensure_derived(&conn, "expenses", 1, &october).expect("the first generation");

        let second = ensure_derived(&conn, "expenses", 2, &october).expect("a second generation");
        assert_eq!(second.uuid, october, "the identity is a function of the facts");
        assert_eq!(
            second.row_id, 1,
            "the identity already belongs to row 1 and does not move"
        );
        assert_eq!(
            sync_identity::row_id_for(&conn, "expenses", &october).expect("read"),
            Some(1),
            "a second local row must not steal the identity"
        );
    }

    /// No data table may gain a uuid column (AD-2), and that is checked against the LIVE schema
    /// rather than asserted in prose, so a later migration cannot quietly add one.
    #[test]
    fn no_data_table_carries_a_uuid_column() {
        let (_dir, conn) = dataset();

        let mut tables = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table'
                   AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
                   AND name NOT LIKE 'sync\\_%' ESCAPE '\\'",
            )
            .expect("the table list prepares");
        let data_tables: Vec<String> = tables
            .query_map([], |row| row.get::<_, String>(0))
            .expect("the table list reads")
            .collect::<Result<_, _>>()
            .expect("the table list collects");
        assert!(
            data_tables.len() > 20,
            "the live schema must actually be there, got {}",
            data_tables.len()
        );

        let columns_of = |table: &str| -> Vec<String> {
            let mut columns = conn
                .prepare("SELECT name FROM pragma_table_info(?1)")
                .expect("the column list prepares");
            columns
                .query_map([table], |row| row.get::<_, String>(0))
                .expect("the column list reads")
                .collect::<Result<_, _>>()
                .expect("the column list collects")
        };

        for table in &data_tables {
            let offenders: Vec<String> = columns_of(table)
                .into_iter()
                .filter(|column| column.contains("uuid"))
                // AD-5's ONE sanctioned exception, named rather than allowed for by a count.
                // `audit_log.entity_uuid` is not this row's identity — that still lives in
                // `sync_uuid` — it is a REFERENCE to another row, and it has to be a column
                // because `entity_id` points at eleven different tables and is therefore not a
                // foreign key AD-2's translation could resolve (migration 034).
                .filter(|column| !(table == "audit_log" && column == "entity_uuid"))
                .collect();
            assert!(
                offenders.is_empty(),
                "{table} carries {offenders:?}; row identity lives in sync_uuid, not in a data table"
            );
        }

        assert!(
            columns_of("audit_log").contains(&"entity_uuid".to_string()),
            "the exception above must stay a statement about a column that exists"
        );

        // Non-vacuity: the search term is one that WOULD be found if a uuid column existed.
        assert!(columns_of("sync_uuid").contains(&"uuid".to_string()));
    }
}
