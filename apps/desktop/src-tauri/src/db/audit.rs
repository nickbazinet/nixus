use rusqlite::{params, Connection};

use crate::db::sync_identity;
use crate::db::ActiveDataset;
use crate::error::AppError;

/// `entity_type` as the audit call sites spell it, mapped to the table its `entity_id` is a row of.
///
/// `audit_log.entity_id` is one column pointing at eleven different tables, which is why the schema
/// cannot make it a foreign key and why AD-2's generic translation cannot reach it. This list is
/// the translation, and an entity type that is absent from it describes something that is not one
/// row of one table — `import`, `budget_template` and every AI chat action pass `entity_id` 0 — so
/// its `entity_uuid` is NULL by construction rather than by omission.
const AUDITED_TABLES: &[(&str, &str)] = &[
    ("account", "accounts"),
    ("expense", "expenses"),
    ("income_entry", "income_entries"),
    ("income_source", "income_sources"),
    ("maintenance_service_log", "maintenance_service_logs"),
    ("passive_asset", "passive_assets"),
    ("project", "projects"),
    ("project_contribution", "project_contributions"),
    ("recurring_income_template", "recurring_income_templates"),
    ("recurring_template", "recurring_expense_templates"),
    ("vehicle", "vehicles"),
];

pub(crate) fn entity_table(entity_type: &str) -> Option<&'static str> {
    AUDITED_TABLES
        .iter()
        .find(|(audited, _)| *audited == entity_type)
        .map(|(_, table)| *table)
}

/// Records the audit row of a change that has ALREADY been committed, in its own captured write.
///
/// Its own `ActiveDataset::write` and not the one that made the change, for two reasons that point
/// the same way. `entity_uuid` is read out of `sync_uuid`, which capture only populates when the
/// changing transaction FLUSHES, so an audit row written inside that transaction could not name the
/// entity it describes. And an audit row is a record OF a change rather than part of it, which is
/// why a failure here is logged and not returned: losing the trail must never undo the change.
pub fn record(
    active: &ActiveDataset,
    entity_type: &str,
    entity_id: i64,
    action: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) {
    if let Err(error) = active.write(|tx| {
        insert_audit_log(tx, entity_type, entity_id, action, old_value, new_value)
    }) {
        tracing::error!("Failed to write audit log: {}", error);
    }
}

// CAPTURE-SANCTIONED (AD-3): every caller reaches this through `ActiveDataset::write`, either as
// `audit::record` above or — for the two paths that are already inside a captured transaction —
// `db::budget_template`'s apply primitive and `commands/chat`'s action runner.
//
// `audit_log` is `AppendOnly` (AD-5): the row travels, is never edited and is never tombstoned, and
// the apply path of Story 20 runs on a connection this function is never called from, which is what
// makes "a remote-applied change writes no new audit row" true by construction.
pub fn insert_audit_log(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    action: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> Result<(), AppError> {
    let entity_uuid = match entity_table(entity_type) {
        Some(table) => sync_identity::lookup(conn, table, entity_id)?,
        None => None,
    };

    conn.execute(
        "INSERT INTO audit_log (entity_type, entity_id, entity_uuid, action, old_value, new_value) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            entity_type,
            entity_id,
            entity_uuid.as_ref().map(|uuid| uuid.as_slice()),
            action,
            old_value,
            new_value
        ],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every entity type the app audits is either translatable or deliberately not one row of one
    /// table. Stated as a list so adding an audited domain without deciding which it is fails here.
    #[test]
    fn the_entity_types_without_a_table_are_the_ones_that_are_not_a_single_row() {
        for entity_type in ["import", "budget_template", "chat_action", "create_expense"] {
            assert_eq!(entity_table(entity_type), None);
        }

        assert_eq!(entity_table("account"), Some("accounts"));
        assert_eq!(entity_table("recurring_template"), Some("recurring_expense_templates"));
    }

    /// The mapping is a claim about the SCHEMA, so it is checked against the registry rather than
    /// taken on trust: a table name typo would silently leave every audit row of that domain
    /// unnamed.
    #[test]
    fn every_audited_table_is_a_table_sync_knows_about() {
        for (entity_type, table) in AUDITED_TABLES {
            assert!(
                crate::sync::registry::table(table).is_some(),
                "{entity_type} claims to audit {table}, which the registry does not classify"
            );
        }
    }
}
