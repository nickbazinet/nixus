//! The SQL the convergence simulator runs against the real schema (Story 13, AD-19).
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! The simulator itself owns the merge semantics and the op model; this module owns nothing
//! but statements, so no story can accidentally move SQL into `sync/`.
//!
//! Every statement here is built from a closed set of `&'static str` table and column names
//! owned by `sync::sim::model` — never from anything a test generates — and every value is
//! bound as a parameter.

use std::collections::BTreeMap;

use rusqlite::types::{ToSqlOutput, Value};
use rusqlite::{Connection, ToSql};

/// A column value the simulator can write or read back. The schema's simulated surface is
/// integers and text only; `REAL` and `BLOB` columns are left at their defaults, so a cell
/// that compares equal is a cell that is equal, with no float tolerance to argue about.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum SimCell {
    Int(i64),
    Text(String),
    /// A row identity, which only ever appears in a dump *after* the simulator has
    /// translated a local integer foreign key into the uuid it stands for.
    Uuid([u8; 16]),
}

impl ToSql for SimCell {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        match self {
            Self::Int(value) => Ok(ToSqlOutput::Owned(Value::Integer(*value))),
            Self::Text(value) => Ok(ToSqlOutput::Owned(Value::Text(value.clone()))),
            Self::Uuid(value) => Ok(ToSqlOutput::Owned(Value::Blob(value.to_vec()))),
        }
    }
}

/// The budget groups and categories every replica starts from.
///
/// Explicit integer ids, written before any sync begins and never edited afterwards: they
/// stand for the rows a dataset already held when it was cloned, which is what lets the
/// natural key of `merchant_category_hints` be `(merchant, budget_category_id)` and still
/// mean the same thing on every replica without Story 14's uuid side table.
pub(crate) const SIM_CATEGORY_IDS: [i64; 4] = [1, 2, 3, 4];

/// A fixed `created_at` for the base rows.
///
/// The default is `datetime('now')`, which differs between two replicas opened a second apart, and
/// Story 20's whole-schema dump compares these rows: "rows the dataset already held when it was
/// cloned" has to mean byte-identical rows, or the base itself would read as a divergence.
const BASE_CREATED_AT: &str = "2026-01-01 00:00:00";

pub(crate) fn seed_shared_base(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO budget_groups (id, name, sort_order, created_at)          VALUES (1, 'Simulated', 0, ?1)",
        [BASE_CREATED_AT],
    )?;

    for id in SIM_CATEGORY_IDS {
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order, created_at)
             VALUES (?1, 1, ?2, 100000, ?3, ?4)",
            rusqlite::params![id, format!("Category {id}"), id, BASE_CREATED_AT],
        )?;
    }

    Ok(())
}

fn placeholders(count: usize) -> String {
    (1..=count)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn insert_row(
    conn: &Connection,
    table: &'static str,
    columns: &[(&'static str, SimCell)],
) -> rusqlite::Result<i64> {
    let names = columns
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT INTO {table} ({names}) VALUES ({})",
        placeholders(columns.len())
    );
    let values: Vec<&dyn ToSql> = columns.iter().map(|(_, cell)| cell as &dyn ToSql).collect();

    conn.execute(&sql, values.as_slice())?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn update_row(
    conn: &Connection,
    table: &'static str,
    id: i64,
    columns: &[(&'static str, SimCell)],
) -> rusqlite::Result<()> {
    if columns.is_empty() {
        return Ok(());
    }

    let assignments = columns
        .iter()
        .enumerate()
        .map(|(index, (name, _))| format!("{name} = ?{}", index + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "UPDATE {table} SET {assignments} WHERE id = ?{}",
        columns.len() + 1
    );

    let mut values: Vec<&dyn ToSql> = columns.iter().map(|(_, cell)| cell as &dyn ToSql).collect();
    values.push(&id);
    conn.execute(&sql, values.as_slice())?;

    Ok(())
}

/// Deletes by integer id with `foreign_keys = ON`, so the schema's own `ON DELETE CASCADE`
/// removes the children — the real behaviour AD-12 relies on, not a simulated one.
pub(crate) fn delete_row(conn: &Connection, table: &'static str, id: i64) -> rusqlite::Result<()> {
    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;

    Ok(())
}

pub(crate) fn child_ids(
    conn: &Connection,
    table: &'static str,
    foreign_key: &'static str,
    parent_id: i64,
) -> rusqlite::Result<Vec<i64>> {
    let mut statement =
        conn.prepare(&format!("SELECT id FROM {table} WHERE {foreign_key} = ?1 ORDER BY id"))?;
    let ids = statement
        .query_map([parent_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ids)
}

/// Adds `delta` to a counter column in one statement, so the pre-update hook sees the real
/// `new - old` an increment produces (AD-5) rather than a value the caller computed.
pub(crate) fn bump_counter(
    conn: &Connection,
    table: &'static str,
    id: i64,
    column: &'static str,
    delta: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        &format!("UPDATE {table} SET {column} = {column} + ?1 WHERE id = ?2"),
        rusqlite::params![delta, id],
    )?;

    Ok(())
}

/// Every row of any table, as `(rowid, column -> cell)`, skipping the cells SQLite reports as NULL.
///
/// Story 20's whole-schema dump needs this where [`dump_table`] cannot help: it is addressed by
/// `_rowid_` because not every synced table calls its key `id`, and a NULL column is OMITTED rather
/// than refused, because most columns of the real schema are nullable and "absent" compares just as
/// exactly as a null cell would.
pub(crate) fn dump_rows(
    conn: &Connection,
    table: &'static str,
    columns: &[&'static str],
) -> rusqlite::Result<Vec<(i64, BTreeMap<&'static str, SimCell>)>> {
    if columns.is_empty() {
        return Ok(Vec::new());
    }

    let selected = columns.join(", ");
    let mut statement = conn.prepare(&format!(
        "SELECT _rowid_, {selected} FROM {table} ORDER BY _rowid_"
    ))?;

    let rows = statement
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let mut cells = BTreeMap::new();
            for (offset, column) in columns.iter().enumerate() {
                let cell = match row.get_ref(offset + 1)? {
                    rusqlite::types::ValueRef::Null => continue,
                    rusqlite::types::ValueRef::Integer(number) => SimCell::Int(number),
                    rusqlite::types::ValueRef::Real(number) => SimCell::Text(number.to_string()),
                    rusqlite::types::ValueRef::Text(bytes) => {
                        SimCell::Text(String::from_utf8_lossy(bytes).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(bytes) => {
                        SimCell::Text(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
                    }
                };
                cells.insert(*column, cell);
            }

            Ok((id, cells))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Every row of `table`, as `(integer id, column -> cell)` in id order.
pub(crate) fn dump_table(
    conn: &Connection,
    table: &'static str,
    columns: &[&'static str],
) -> rusqlite::Result<Vec<(i64, BTreeMap<&'static str, SimCell>)>> {
    let selected = columns.join(", ");
    let mut statement =
        conn.prepare(&format!("SELECT id, {selected} FROM {table} ORDER BY id"))?;

    let rows = statement
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let mut cells = BTreeMap::new();
            for (offset, column) in columns.iter().enumerate() {
                let value = row.get_ref(offset + 1)?;
                let cell = match value {
                    rusqlite::types::ValueRef::Integer(number) => SimCell::Int(number),
                    rusqlite::types::ValueRef::Text(bytes) => {
                        SimCell::Text(String::from_utf8_lossy(bytes).into_owned())
                    }
                    other => {
                        return Err(rusqlite::Error::FromSqlConversionFailure(
                            offset + 1,
                            other.data_type(),
                            format!("{table}.{column} is not an integer or text column").into(),
                        ))
                    }
                };
                cells.insert(*column, cell);
            }

            Ok((id, cells))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_dataset::migrated_dataset;

    fn simulated_dataset() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("a temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .expect("foreign keys enable");
        seed_shared_base(&conn).expect("the shared base seeds");

        (dir, conn)
    }

    #[test]
    fn the_shared_base_is_the_same_rows_on_every_replica() {
        let (_one_dir, one) = simulated_dataset();
        let (_two_dir, two) = simulated_dataset();

        let categories = |conn: &Connection| {
            dump_table(conn, "budget_categories", &["name", "group_id"]).expect("the dump reads")
        };

        assert_eq!(categories(&one), categories(&two));
        assert_eq!(categories(&one).len(), SIM_CATEGORY_IDS.len());
    }

    #[test]
    fn a_row_inserts_updates_and_dumps_through_the_real_schema() {
        let (_dir, conn) = simulated_dataset();

        let id = insert_row(
            &conn,
            "accounts",
            &[
                ("name", SimCell::Text("Chequing".into())),
                ("institution", SimCell::Text("Bank".into())),
                ("account_type", SimCell::Text("chequing".into())),
            ],
        )
        .expect("the account inserts");

        update_row(
            &conn,
            "accounts",
            id,
            &[("balance_cents", SimCell::Int(-12_345))],
        )
        .expect("the balance updates");

        let dumped = dump_table(&conn, "accounts", &["name", "balance_cents"]).expect("it dumps");
        assert_eq!(
            dumped,
            vec![(
                id,
                BTreeMap::from([
                    ("name", SimCell::Text("Chequing".into())),
                    ("balance_cents", SimCell::Int(-12_345)),
                ])
            )]
        );
    }

    /// The cascade the simulator's foreign-key cases depend on is the schema's, so it is
    /// proven here rather than assumed: a simulated cascade would prove nothing about AD-12.
    #[test]
    fn deleting_a_parent_cascades_its_children_in_the_real_schema() {
        let (_dir, conn) = simulated_dataset();

        let source = insert_row(
            &conn,
            "income_sources",
            &[
                ("name", SimCell::Text("Employer".into())),
                ("income_type", SimCell::Text("employment".into())),
            ],
        )
        .expect("the source inserts");
        insert_row(
            &conn,
            "income_entries",
            &[
                ("source_id", SimCell::Int(source)),
                ("amount_cents", SimCell::Int(400_000)),
                ("date", SimCell::Text("2026-03-01".into())),
                ("month", SimCell::Text("2026-03".into())),
            ],
        )
        .expect("the entry inserts");

        assert_eq!(
            child_ids(&conn, "income_entries", "source_id", source)
                .expect("the children read")
                .len(),
            1
        );

        delete_row(&conn, "income_sources", source).expect("the parent deletes");

        assert!(dump_table(&conn, "income_entries", &["month"])
            .expect("it dumps")
            .is_empty());
    }
}
