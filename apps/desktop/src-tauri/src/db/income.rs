use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{
    CreateIncomeEntryInput, CreateIncomeSourceInput, IncomeEntry, IncomeSource,
    IncomeSourceWithLastEntry, IncomeTotal, UpdateIncomeEntryInput, UpdateIncomeSourceInput,
};

const VALID_INCOME_TYPES: &[&str] = &["employment", "freelance", "investment", "other"];

pub fn insert_income_source(
    conn: &Connection,
    input: &CreateIncomeSourceInput,
) -> Result<IncomeSource, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Income source name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_INCOME_TYPES.contains(&input.income_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid income type: {}", input.income_type),
            field: Some("income_type".to_string()),
        });
    }

    conn.execute(
        "INSERT INTO income_sources (name, income_type) VALUES (?1, ?2)",
        params![name, input.income_type],
    )?;

    let id = conn.last_insert_rowid();
    get_income_source_by_id(conn, id)
}

pub fn get_all_income_sources(
    conn: &Connection,
) -> Result<Vec<IncomeSourceWithLastEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.income_type, s.created_at, s.updated_at,
                latest.total_cents, latest.month
         FROM income_sources s
         LEFT JOIN (
           SELECT source_id, month, SUM(amount_cents) AS total_cents
           FROM income_entries
           GROUP BY source_id, month
           HAVING month = (SELECT MAX(e2.month) FROM income_entries e2 WHERE e2.source_id = income_entries.source_id)
         ) latest ON latest.source_id = s.id
         ORDER BY s.name",
    )?;

    let sources = stmt
        .query_map([], |row| {
            Ok(IncomeSourceWithLastEntry {
                id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_amount_cents: row.get(5)?,
                last_month: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(sources)
}

pub fn update_income_source(
    conn: &Connection,
    id: i64,
    input: &UpdateIncomeSourceInput,
) -> Result<IncomeSource, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Income source name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_INCOME_TYPES.contains(&input.income_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid income type: {}", input.income_type),
            field: Some("income_type".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE income_sources SET name = ?1, income_type = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![name, input.income_type, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Income source not found".to_string(),
        });
    }

    get_income_source_by_id(conn, id)
}

pub fn delete_income_source(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM income_sources WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Income source not found".to_string(),
        });
    }
    Ok(())
}

pub fn insert_income_entry(
    conn: &Connection,
    input: &CreateIncomeEntryInput,
) -> Result<IncomeEntry, AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.date.is_empty() {
        return Err(AppError::Validation {
            message: "Date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    // Verify source exists
    conn.query_row(
        "SELECT id FROM income_sources WHERE id = ?1",
        params![input.source_id],
        |_| Ok(()),
    )
    .map_err(|_| AppError::Database {
        message: "Income source not found".to_string(),
    })?;

    // Derive month from date (first 7 chars: "2026-03")
    let month = &input.date[..7];

    conn.execute(
        "INSERT INTO income_entries (source_id, amount_cents, date, month)
         VALUES (?1, ?2, ?3, ?4)",
        params![input.source_id, input.amount_cents, input.date, month],
    )?;

    let id = conn.last_insert_rowid();
    get_income_entry_by_id(conn, id)
}

pub fn update_income_entry(
    conn: &Connection,
    id: i64,
    input: &UpdateIncomeEntryInput,
) -> Result<IncomeEntry, AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.date.is_empty() {
        return Err(AppError::Validation {
            message: "Date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    let month = &input.date[..7];

    let rows = conn.execute(
        "UPDATE income_entries SET source_id = ?1, amount_cents = ?2, date = ?3, month = ?4, updated_at = datetime('now') WHERE id = ?5",
        params![input.source_id, input.amount_cents, input.date, month, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Income entry not found".to_string(),
        });
    }

    get_income_entry_by_id(conn, id)
}

pub fn delete_income_entry(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM income_entries WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Income entry not found".to_string(),
        });
    }
    Ok(())
}

pub fn get_income_entries(
    conn: &Connection,
    source_id: Option<i64>,
) -> Result<Vec<IncomeEntry>, AppError> {
    let row_mapper = |row: &rusqlite::Row| -> rusqlite::Result<IncomeEntry> {
        Ok(IncomeEntry {
            id: row.get(0)?,
            source_id: row.get(1)?,
            source_name: row.get(2)?,
            income_type: row.get(3)?,
            amount_cents: row.get(4)?,
            date: row.get(5)?,
            month: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    };

    let entries = if let Some(sid) = source_id {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             WHERE e.source_id = ?1
             ORDER BY e.date DESC, e.id DESC",
        )?;
        let result = stmt.query_map(params![sid], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?;
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             ORDER BY e.date DESC, e.id DESC",
        )?;
        let result = stmt.query_map([], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?;
        result
    };

    Ok(entries)
}

pub fn get_income_entries_by_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<IncomeEntry>, AppError> {
    let start_date = format!("{:04}-{:02}-01", year, month);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end_date = format!("{:04}-{:02}-01", next_year, next_month);

    let mut stmt = conn.prepare(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.date >= ?1 AND e.date < ?2
         ORDER BY e.date DESC, e.id DESC",
    )?;

    let entries = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                date: row.get(5)?,
                month: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

pub fn get_income_total(conn: &Connection, year: i32, month: u32) -> Result<IncomeTotal, AppError> {
    let start_date = format!("{:04}-{:02}-01", year, month);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end_date = format!("{:04}-{:02}-01", next_year, next_month);

    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries WHERE date >= ?1 AND date < ?2",
            params![start_date, end_date],
            |row| row.get(0),
        )?;

    Ok(IncomeTotal {
        total_cents: total,
        month: format!("{:04}-{:02}", year, month),
    })
}

fn get_income_source_by_id(conn: &Connection, id: i64) -> Result<IncomeSource, AppError> {
    conn.query_row(
        "SELECT id, name, income_type, created_at, updated_at FROM income_sources WHERE id = ?1",
        params![id],
        |row| {
            Ok(IncomeSource {
                id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(AppError::from)
}

fn get_income_entry_by_id(conn: &Connection, id: i64) -> Result<IncomeEntry, AppError> {
    conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.id = ?1",
        params![id],
        |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                date: row.get(5)?,
                month: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(AppError::from)
}
