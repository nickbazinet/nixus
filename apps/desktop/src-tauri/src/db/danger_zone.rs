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
    // AD-15: a wipe of a synced dataset unlinks it. Deleting the row *is* the
    // Unlinked state. It still touches no cloud object here — the account learns of the wipe
    // through `commands::danger_zone`'s pending marker and `sync::wipe`'s separate `wipe` object
    // (story wipe-epoch), never through this transaction.
    "sync_state",
    // AD-10: what this computer has already uploaded. Forgetting it costs one
    // conditional request per picture afterwards, never a wrong answer.
    "sync_image_blobs",
    // AD-15: Story 14's seven. A wipe deletes locally and clears the sync tables, and emits
    // nothing: no tombstone, no message, no object. The other computers are emptied by the
    // account-wide wipe EVENT instead (story wipe-epoch), which is bounded and is registered
    // outside this transaction. Order is free among them because none has a foreign key — into
    // each other or into a data table.
    "sync_uuid",
    "sync_log",
    "sync_field_state",
    "sync_applied_vector",
    "sync_tombstone",
    "sync_pending",
    "sync_quarantine",
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
    "project_images",
    "projects",
    "accounts",
    "audit_log",
];

/// Test-only: proves the wipe exclusion list is exhaustive against the live schema.
#[cfg(test)]
pub const PRESERVED_TABLES: &[&str] = &["config", "schema_version", "sqlite_sequence"];

/// Deletes every row from all user-data tables. Returns the number of rows deleted.
///
/// The CALLER owns the transaction, and that is what makes "either every table is emptied or the
/// database is left untouched" true: the production caller is
/// `ActiveDataset::write_uncaptured`, which opens an `Immediate` transaction, detaches the
/// capture hook for its duration (AD-15: a wipe must emit no message) and commits only on `Ok`.
/// Opening a second transaction here would fail inside that one.
pub fn wipe_all(conn: &Connection) -> Result<u64, AppError> {
    let mut deleted: u64 = 0;

    for table in WIPE_TABLES {
        // Table names come from the const above, never from user input.
        let affected = conn.execute(&format!("DELETE FROM {}", table), [])?;
        deleted += affected as u64;
    }

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
            INSERT INTO project_images
                (project_id, image_bytes, mime_type, original_filename, byte_size, image_sha256)
                VALUES (1, x'89504e470d0a1a0a', 'image/png', 'cover.png', 8,
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            INSERT INTO config (key, value) VALUES ('onboarding_completed', 'true');
            INSERT INTO sync_state (id, install_id, machine_fingerprint, link_state, identity_id, owner_sub)
                VALUES (1, '0123456789abcdef',
                        'ab00000000000000000000000000000000000000000000000000000000000000',
                        'linked', 'us-east-1:abc', 'sub-1');
            INSERT INTO sync_image_blobs (image_sha256)
                VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            INSERT INTO sync_uuid (table_name, row_id, uuid)
                VALUES ('accounts', 1, x'000102030405060708090a0b0c0d0e0f');
            INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name)
                VALUES ('0123456789abcdef',
                        '0000000000000001-0123456789abcdef', 'field', 'accounts',
                        x'000102030405060708090a0b0c0d0e0f', 'name');
            -- The packed per-column map migration 033 stores, as one literal: count = 1, then
            -- `name_len = 4`, `name`, the 33-character HLC and 32 hash bytes. One literal and not
            -- `||`, because SQLite's concatenation converts its operands to TEXT.
            INSERT INTO sync_field_state (table_name, row_uuid, columns)
                VALUES ('accounts', x'000102030405060708090a0b0c0d0e0f',
                        x'0001046e616d65303030303030303030303030303030312d30313233343536373839616263646566bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
            INSERT INTO sync_applied_vector (install, seq, applied_offset)
                VALUES ('fedcba9876543210', 4, 0);
            INSERT INTO sync_tombstone
                (table_name, row_uuid, hlc, install, row_json, deleted_at, purge_after)
                VALUES ('expenses', x'0f0e0d0c0b0a09080706050403020100',
                        '0000000000000002-0123456789abcdef', '0123456789abcdef',
                        '{\"id\":1}', '2026-10-01 00:00:00', '2026-10-31 00:00:00');
            INSERT INTO sync_pending
                (install, seq, idx, hlc, kind, table_name, row_uuid,
                 waiting_on_table, waiting_on_uuid)
                VALUES ('fedcba9876543210', 4, 0,
                        '0000000000000003-fedcba9876543210', 'field', 'income_entries',
                        x'101112131415161718191a1b1c1d1e1f',
                        'income_sources', x'202122232425262728292a2b2c2d2e2f');
            INSERT INTO sync_quarantine
                (install, seq, idx, hlc, kind, table_name, row_uuid, reason)
                VALUES ('fedcba9876543210', 5, 0,
                        '0000000000000004-fedcba9876543210', 'tombstone', 'accounts',
                        x'303132333435363738393a3b3c3d3e3f', 'constraint_violation');
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
        let conn = migrated_db();
        seed_all(&conn);

        for table in WIPE_TABLES {
            assert!(
                count(&conn, table) > 0,
                "test seed missing rows for {}",
                table
            );
        }

        let deleted = wipe_all(&conn).expect("wipe succeeds");
        assert_eq!(deleted, WIPE_TABLES.len() as u64);

        for table in WIPE_TABLES {
            assert_eq!(count(&conn, table), 0, "{} should be empty", table);
        }
    }

    #[test]
    fn wipe_all_preserves_config_and_schema_version() {
        let conn = migrated_db();
        seed_all(&conn);

        wipe_all(&conn).expect("wipe succeeds");

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
        let conn = migrated_db();

        assert_eq!(wipe_all(&conn).expect("first wipe"), 0);
        assert_eq!(wipe_all(&conn).expect("second wipe"), 0);
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
        let conn = migrated_db();
        seed_all(&conn);

        // Remove a table listed in WIPE_TABLES so its DELETE fails mid-transaction.
        conn.execute_batch("DROP TABLE audit_log")
            .expect("drop audit_log");

        // The transaction is the caller's, exactly as in production: dropping it without a
        // commit is what `write_uncaptured` does for an `Err` from the closure.
        let tx = rusqlite::Transaction::new_unchecked(
            &conn,
            rusqlite::TransactionBehavior::Immediate,
        )
        .expect("begin");
        let err = wipe_all(&tx).expect_err("wipe must fail");
        drop(tx);
        assert!(matches!(err, AppError::Database { .. }));

        // Everything deleted before the failure must be restored.
        assert_eq!(count(&conn, "budget_groups"), 1, "rollback failed");
        assert_eq!(count(&conn, "chat_messages"), 1, "rollback failed");
        assert_eq!(count(&conn, "expenses"), 1, "rollback failed");
    }

    #[test]
    fn reclaim_space_succeeds_on_a_wal_file_backed_database() {
        let file = tempfile::NamedTempFile::new().expect("temp file");
        let conn = Connection::open(file.path()).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        run_migrations(&conn).expect("run migrations");
        seed_all(&conn);

        wipe_all(&conn).expect("wipe succeeds");
        reclaim_space(&conn).expect("checkpoint and vacuum succeed");

        for table in WIPE_TABLES {
            assert_eq!(count(&conn, table), 0, "{} should be empty", table);
        }
    }
}
