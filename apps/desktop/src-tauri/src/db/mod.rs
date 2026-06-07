use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use tracing::info;

use crate::error::AppError;

pub mod account;
pub mod aggregates;
pub mod asset;
pub mod audit;
pub mod budget;
pub mod chat;
pub mod config;
pub mod dashboard;
pub mod expense;
pub mod financial_health;
pub mod income;
pub mod maintenance;
pub mod net_worth;
pub mod projection;
pub mod recurring;
pub mod spending_trends;
pub mod yearly_summary;

pub struct DbState(pub Mutex<Connection>);

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
];

pub fn init_db(app_data_dir: &Path) -> Result<Connection, AppError> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| AppError::File {
        message: format!("Failed to create app data directory: {}", e),
    })?;

    let db_path = app_data_dir.join("nkbaz-finance.db");
    let conn = Connection::open(&db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    info!("Database opened at {:?}", db_path);

    run_migrations(&conn)?;

    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<(), AppError> {
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
