use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use tracing::info;

use crate::error::AppError;

pub mod account;
pub mod aggregates;
pub mod asset;
pub mod audit;
pub mod backup;
pub mod budget;
pub mod budget_template;
pub mod chat;
pub mod config;
pub mod danger_zone;
pub mod dashboard;
pub mod expense;
pub mod financial_health;
pub mod income;
pub mod maintenance;
pub mod net_worth;
pub mod onboarding;
pub mod projection;
pub mod projects;
pub mod recurring;
pub mod recurring_income;
pub mod retirement;
pub mod spending_trends;
pub mod yearly_summary;

/// The dataset active for this run: which one it is, and its open connection.
///
/// Both fields live in one struct behind one lock so they swap together and
/// never independently (AD-6) — no caller can observe an id paired with a
/// different dataset's connection. `{ id: None, conn: None }` is the
/// pre-selection state, which call sites surface as `AppError::NotConfigured`
/// rather than defaulting to a dataset of their own choosing.
pub struct ActiveDataset {
    pub id: Option<String>,
    pub conn: Option<Connection>,
}

pub struct DbState(pub Mutex<ActiveDataset>);

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/001_initial_schema.sql")),
    (2, include_str!("../../migrations/002_budget_tables.sql")),
    (3, include_str!("../../migrations/003_expenses_table.sql")),
    (4, include_str!("../../migrations/004_recreate_expenses_table.sql")),
    (5, include_str!("../../migrations/005_accounts.sql")),
    (6, include_str!("../../migrations/006_audit_log.sql")),
    (7, include_str!("../../migrations/007_passive_assets.sql")),
    (8, include_str!("../../migrations/008_net_worth_snapshots.sql")),
    (9, include_str!("../../migrations/009_chat_tables.sql")),
    (10, include_str!("../../migrations/010_audit_log_indexes.sql")),
    (11, include_str!("../../migrations/011_income_tables.sql")),
    (12, include_str!("../../migrations/012_income_entry_date.sql")),
    (13, include_str!("../../migrations/013_chat_message_type.sql")),
    (14, include_str!("../../migrations/014_config_table.sql")),
    (15, include_str!("../../migrations/015_merchant_category_hints.sql")),
    (16, include_str!("../../migrations/016_recurring_expenses.sql")),
    (17, include_str!("../../migrations/017_chat_agent_id.sql")),
    (18, include_str!("../../migrations/018_maintenance_tables.sql")),
    (19, include_str!("../../migrations/019_custom_service_logs.sql")),
    (20, include_str!("../../migrations/020_maintenance_custom_tasks.sql")),
    (21, include_str!("../../migrations/021_expense_income_account_id.sql")),
    (22, include_str!("../../migrations/022_budget_category_soft_delete.sql")),
    (23, include_str!("../../migrations/023_recurring_income.sql")),
    (
        24,
        include_str!("../../migrations/024_income_entry_recurring_template.sql"),
    ),
    (25, include_str!("../../migrations/025_projects.sql")),
];

pub fn init_db(app_data_dir: &Path) -> Result<Connection, AppError> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| AppError::File {
        message: format!("Failed to create app data directory: {}", e),
    })?;

    let db_path = app_data_dir.join("nkbaz-finance.db");

    open_configured(&db_path)
}

/// Shared by startup and backup restore so a restored database can never end up
/// configured differently from one opened at launch.
pub(crate) fn open_configured(db_path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    info!("Database opened at {:?}", db_path);

    run_migrations(&conn)?;

    Ok(conn)
}

pub(crate) fn run_migrations(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )?;

    for (version, sql) in MIGRATIONS {
        if *version > current_version {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                rusqlite::params![version],
            )?;
            tx.commit()?;
            info!("Applied migration v{}", version);
        }
    }

    info!(
        "Migrations complete. Current schema version: {}",
        MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn an_unselected_active_dataset_guards_with_not_configured() {
        let active = ActiveDataset {
            id: None,
            conn: None,
        };

        let guarded = active.conn.as_ref().ok_or(AppError::NotConfigured);

        assert!(matches!(guarded, Err(AppError::NotConfigured)));
        assert_eq!(active.id, None);
    }

    #[test]
    fn a_selected_active_dataset_guards_into_a_usable_connection() {
        let active = ActiveDataset {
            id: Some("default".to_string()),
            conn: Some(Connection::open_in_memory().expect("in-memory database")),
        };

        let conn = active
            .conn
            .as_ref()
            .ok_or(AppError::NotConfigured)
            .expect("a selected dataset has a connection");

        assert_eq!(
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .expect("query runs"),
            1
        );
    }

    // `select_dataset` opens and migrates before it acquires DbState's lock, so
    // this failing is exactly what leaves a previously active dataset untouched.
    #[test]
    fn init_db_fails_when_the_datasets_database_file_is_not_sqlite() {
        let dir = TempDir::new().expect("temp dir");
        std::fs::write(dir.path().join("nkbaz-finance.db"), b"not a sqlite file at all")
            .expect("garbage db written");

        let error = init_db(dir.path()).expect_err("opening a non-database must fail");

        assert!(
            matches!(error, AppError::Database { .. }),
            "expected AppError::Database, got {error:?}"
        );
    }
}
