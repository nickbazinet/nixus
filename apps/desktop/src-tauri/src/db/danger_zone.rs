use rusqlite::Connection;

use crate::error::AppError;

/// Every table holding user-generated data, ordered child-first so the wipe stays
/// correct with `PRAGMA foreign_keys=ON`.
///
/// Deliberately excluded:
/// - `config` — app preferences, AI provider selection and the `onboarding_completed`
///   flag. Preserved so the onboarding wizard does not reappear after a wipe.
/// - `schema_version` — migration bookkeeping. Clearing it would re-run every migration.
/// - `sqlite_sequence` — SQLite-internal AUTOINCREMENT counters.
///
/// `PRESERVED_TABLES` below keeps that exclusion list machine-checkable: a test asserts
/// `WIPE_TABLES + PRESERVED_TABLES` covers every table in the live schema, so a future
/// migration cannot silently add a table that survives "delete all data".
pub const WIPE_TABLES: &[&str] = &[
    "chat_messages",
    "chat_conversations",
    "maintenance_service_logs",
    "maintenance_tasks",
    "vehicles",
    "income_entries",
    "recurring_income_templates",
    "income_sources",
    "recurring_expense_templates",
    "merchant_category_hints",
    "expenses",
    "budget_categories",
    "budget_groups",
    "passive_assets",
    "net_worth_snapshots",
    "project_contributions",
    "projects",
    "accounts",
    "audit_log",
];

/// Test-only: proves the wipe exclusion list is exhaustive against the live schema.
#[cfg(test)]
pub const PRESERVED_TABLES: &[&str] = &["config", "schema_version", "sqlite_sequence"];

/// Deletes every row from all user-data tables in a single transaction.
///
/// Either every table is emptied or the database is left untouched. Returns the number
/// of rows deleted.
pub fn wipe_all(conn: &mut Connection) -> Result<u64, AppError> {
    let tx = conn.transaction()?;
    let mut deleted: u64 = 0;

    for table in WIPE_TABLES {
        // Table names come from the const above, never from user input.
        let affected = tx.execute(&format!("DELETE FROM {}", table), [])?;
        deleted += affected as u64;
    }

    tx.commit()?;
    Ok(deleted)
}

/// Flushes the WAL and reclaims disk space after a wipe. Must run outside a transaction.
///
/// Callers treat failure as non-fatal — the rows are already gone — but the error is
/// returned so it can be logged.
pub fn reclaim_space(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use std::collections::HashSet;

    fn migrated_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fks");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    fn seed_all(conn: &Connection) {
        conn.execute_batch(
            "
            INSERT INTO budget_groups (id, name) VALUES (1, 'Living');
            INSERT INTO budget_categories (id, group_id, name, target_cents)
                VALUES (1, 1, 'Groceries', 50000);
            INSERT INTO accounts (id, name, institution, account_type)
                VALUES (1, 'Chequing', 'Bank', 'chequing');
            INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
                VALUES ('Store', 1234, 1, '2026-08-01');
            INSERT INTO merchant_category_hints (merchant, budget_category_id)
                VALUES ('Store', 1);
            INSERT INTO recurring_expense_templates
                (merchant, amount_cents, budget_category_id, day_of_month)
                VALUES ('Rent', 100000, 1, 1);
            INSERT INTO passive_assets (name, asset_type, value_cents)
                VALUES ('House', 'real_estate', 50000000);
            INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json)
                VALUES (123, '2026-08-01', '{}');
            INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Job', 'employment');
            INSERT INTO income_entries (source_id, amount_cents, date, month)
                VALUES (1, 500000, '2026-08-01', '2026-08');
            INSERT INTO recurring_income_templates (source_id, amount_cents, day_of_month)
                VALUES (1, 500000, 1);
            INSERT INTO chat_conversations (id, title) VALUES (1, 'Chat');
            INSERT INTO chat_messages (conversation_id, role, content)
                VALUES (1, 'user', 'hello');
            INSERT INTO vehicles (id, nickname) VALUES (1, 'Civic');
            INSERT INTO maintenance_tasks (id, vehicle_id, task_type_key)
                VALUES (1, 1, 'oil_change');
            INSERT INTO maintenance_service_logs (vehicle_id, task_id, service_date, odometer_km)
                VALUES (1, 1, '2026-08-01', 1000);
            INSERT INTO audit_log (entity_type, entity_id, action)
                VALUES ('expense', 1, 'create');
            INSERT INTO projects (id, name, target_cents) VALUES (1, 'Car', 500000);
            INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
                VALUES (1, 1, 25000, 'manual', '2026-08-01');
            INSERT INTO config (key, value) VALUES ('onboarding_completed', 'true');
            ",
        )
        .expect("seed all tables");
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0))
            .unwrap_or_else(|e| panic!("count {}: {}", table, e))
    }

    #[test]
    fn wipe_all_empties_every_user_data_table() {
        let mut conn = migrated_db();
        seed_all(&conn);

        for table in WIPE_TABLES {
            assert!(
                count(&conn, table) > 0,
                "test seed missing rows for {}",
                table
            );
        }

        let deleted = wipe_all(&mut conn).expect("wipe succeeds");
        assert_eq!(deleted, WIPE_TABLES.len() as u64);

        for table in WIPE_TABLES {
            assert_eq!(count(&conn, table), 0, "{} should be empty", table);
        }
    }

    #[test]
    fn wipe_all_preserves_config_and_schema_version() {
        let mut conn = migrated_db();
        seed_all(&conn);

        wipe_all(&mut conn).expect("wipe succeeds");

        assert_eq!(count(&conn, "config"), 1, "config must survive the wipe");
        assert!(
            count(&conn, "schema_version") > 0,
            "schema_version must survive the wipe"
        );
        let onboarding: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'onboarding_completed'",
                [],
                |r| r.get(0),
            )
            .expect("onboarding flag preserved");
        assert_eq!(onboarding, "true");
    }

    #[test]
    fn wipe_all_is_idempotent_on_empty_database() {
        let mut conn = migrated_db();

        assert_eq!(wipe_all(&mut conn).expect("first wipe"), 0);
        assert_eq!(wipe_all(&mut conn).expect("second wipe"), 0);
    }

    /// Guards against a future migration adding a table that silently survives the wipe.
    #[test]
    fn wipe_list_covers_every_table_in_the_schema() {
        let conn = migrated_db();
        // sqlite_sequence only materializes once an AUTOINCREMENT row exists.
        seed_all(&conn);

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .expect("query sqlite_master");
        let live: HashSet<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .expect("map rows")
            .map(|r| r.expect("row"))
            .collect();

        let accounted: HashSet<String> = WIPE_TABLES
            .iter()
            .chain(PRESERVED_TABLES.iter())
            .map(|t| t.to_string())
            .collect();

        let unaccounted: Vec<&String> = live.difference(&accounted).collect();
        assert!(
            unaccounted.is_empty(),
            "tables present in the schema but neither wiped nor explicitly preserved: {:?}. \
             Add them to WIPE_TABLES or PRESERVED_TABLES.",
            unaccounted
        );

        let stale: Vec<&&str> = WIPE_TABLES.iter().filter(|t| !live.contains(**t)).collect();
        assert!(stale.is_empty(), "WIPE_TABLES lists missing tables: {:?}", stale);
    }

    #[test]
    fn wipe_all_rolls_back_when_a_delete_fails() {
        let mut conn = migrated_db();
        seed_all(&conn);

        // Remove a table listed in WIPE_TABLES so its DELETE fails mid-transaction.
        conn.execute_batch("DROP TABLE audit_log")
            .expect("drop audit_log");

        let err = wipe_all(&mut conn).expect_err("wipe must fail");
        assert!(matches!(err, AppError::Database { .. }));

        // Everything deleted before the failure must be restored.
        assert_eq!(count(&conn, "budget_groups"), 1, "rollback failed");
        assert_eq!(count(&conn, "chat_messages"), 1, "rollback failed");
        assert_eq!(count(&conn, "expenses"), 1, "rollback failed");
    }

    #[test]
    fn reclaim_space_succeeds_on_a_wal_file_backed_database() {
        let file = tempfile::NamedTempFile::new().expect("temp file");
        let mut conn = Connection::open(file.path()).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        run_migrations(&conn).expect("run migrations");
        seed_all(&conn);

        wipe_all(&mut conn).expect("wipe succeeds");
        reclaim_space(&conn).expect("checkpoint and vacuum succeed");

        for table in WIPE_TABLES {
            assert_eq!(count(&conn, table), 0, "{} should be empty", table);
        }
    }
}
