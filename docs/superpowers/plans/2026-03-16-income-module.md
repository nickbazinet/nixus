# Income Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete income tracking — source management, entry recording, history view, dashboard cash flow card, onboarding step, and AI income-aware context.

**Architecture:** Two new SQLite tables (`income_sources`, `income_entries`) with a Rust db/commands module pair following the existing pattern. Frontend adds an `/income` route, `useIncome` hook, and income components. Dashboard gets a `CashFlowSummaryCard`. Onboarding wizard gets a 5th "Income" step between Assets and Import.

**Tech Stack:** Rust/rusqlite (backend), React/TypeScript, TanStack Router + Query, shadcn/ui, sonner toasts, React Hook Form.

---

## Chunk 1: Backend — Database, Models, DB Module, Commands

### Task 1: Database Migration

**Files:**
- Create: `src-tauri/migrations/011_income_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  income_type TEXT NOT NULL CHECK(income_type IN ('employment', 'freelance', 'investment', 'other')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, month)
);

CREATE INDEX idx_income_entries_source_id ON income_entries(source_id);
CREATE INDEX idx_income_entries_month ON income_entries(month);
```

Notes:
- `month` stores as `"YYYY-MM"` string (e.g., `"2026-03"`) — one entry per source per month
- `UNIQUE(source_id, month)` enforces one entry per source per month
- `ON DELETE CASCADE` so deleting a source removes its entries
- `amount_cents` as integer cents, consistent with existing pattern

- [ ] **Step 2: Register the migration**

Modify: `src-tauri/src/db/mod.rs` — add to the `MIGRATIONS` array:

```rust
(11, include_str!("../../migrations/011_income_tables.sql")),
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/011_income_tables.sql src-tauri/src/db/mod.rs
git commit -m "feat(income): add income_sources and income_entries migration"
```

---

### Task 2: Rust Models

**Files:**
- Modify: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: Add income models**

Append to `src-tauri/src/models/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeSource {
    pub id: i64,
    pub name: String,
    pub income_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateIncomeSourceInput {
    pub name: String,
    pub income_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIncomeSourceInput {
    pub name: String,
    pub income_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeEntry {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub income_type: String,
    pub amount_cents: i64,
    pub month: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateIncomeEntryInput {
    pub source_id: i64,
    pub amount_cents: i64,
    pub month: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIncomeEntryInput {
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeTotal {
    pub total_cents: i64,
    pub month: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeSourceWithLastEntry {
    pub id: i64,
    pub name: String,
    pub income_type: String,
    pub last_amount_cents: Option<i64>,
    pub last_month: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

Notes:
- `IncomeEntry` includes joined `source_name` and `income_type` for the history table
- `IncomeSourceWithLastEntry` includes the most recent entry amount for the source list display
- `IncomeTotal` used by the dashboard cash flow card

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/models/mod.rs
git commit -m "feat(income): add income source and entry models"
```

---

### Task 3: Income DB Module

**Files:**
- Create: `src-tauri/src/db/income.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod income;`)

- [ ] **Step 1: Create the db module**

Create `src-tauri/src/db/income.rs` following the account.rs pattern:

```rust
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
                e.amount_cents, e.month
         FROM income_sources s
         LEFT JOIN income_entries e ON e.source_id = s.id
           AND e.month = (SELECT MAX(e2.month) FROM income_entries e2 WHERE e2.source_id = s.id)
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

pub fn upsert_income_entry(
    conn: &Connection,
    input: &CreateIncomeEntryInput,
) -> Result<IncomeEntry, AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
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

    // Upsert: insert or update if entry already exists for this source+month
    conn.execute(
        "INSERT INTO income_entries (source_id, amount_cents, month)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(source_id, month) DO UPDATE SET
           amount_cents = excluded.amount_cents,
           updated_at = datetime('now')",
        params![input.source_id, input.amount_cents, input.month],
    )?;

    let entry = conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.source_id = ?1 AND e.month = ?2",
        params![input.source_id, input.month],
        |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                month: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )?;

    Ok(entry)
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

    let rows = conn.execute(
        "UPDATE income_entries SET amount_cents = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![input.amount_cents, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Income entry not found".to_string(),
        });
    }

    conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
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
                month: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(AppError::from)
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
            month: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    };

    let entries = if let Some(sid) = source_id {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             WHERE e.source_id = ?1
             ORDER BY e.month DESC, e.id DESC",
        )?;
        stmt.query_map(params![sid], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             ORDER BY e.month DESC, e.id DESC",
        )?;
        stmt.query_map([], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(entries)
}

pub fn get_income_total(conn: &Connection, month: &str) -> Result<IncomeTotal, AppError> {
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries WHERE month = ?1",
            params![month],
            |row| row.get(0),
        )?;

    Ok(IncomeTotal {
        total_cents: total,
        month: month.to_string(),
    })
}

pub fn get_entry_for_source_month(
    conn: &Connection,
    source_id: i64,
    month: &str,
) -> Result<Option<IncomeEntry>, AppError> {
    let result = conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.source_id = ?1 AND e.month = ?2",
        params![source_id, month],
        |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                month: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    );

    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
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
```

- [ ] **Step 2: Register the module**

Add `pub mod income;` to `src-tauri/src/db/mod.rs` (after `pub mod expense;`).

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/income.rs src-tauri/src/db/mod.rs
git commit -m "feat(income): add income db module with CRUD operations"
```

---

### Task 4: Income Commands Module

**Files:**
- Create: `src-tauri/src/commands/income.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod income;`)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Create the commands module**

Create `src-tauri/src/commands/income.rs`:

```rust
use tauri::State;

use crate::db::audit as audit_db;
use crate::db::income as income_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    CreateIncomeEntryInput, CreateIncomeSourceInput, IncomeEntry, IncomeSource,
    IncomeSourceWithLastEntry, IncomeTotal, UpdateIncomeEntryInput, UpdateIncomeSourceInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_income_source(
    state: State<DbState>,
    name: String,
    income_type: String,
) -> Result<IncomeSource, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateIncomeSourceInput { name, income_type };
    let result = income_db::insert_income_source(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        result.id,
        "create",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_sources(
    state: State<DbState>,
) -> Result<Vec<IncomeSourceWithLastEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_all_income_sources(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_income_source(
    state: State<DbState>,
    id: i64,
    name: String,
    income_type: String,
) -> Result<IncomeSource, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_source_json(&conn, id);

    let input = UpdateIncomeSourceInput { name, income_type };
    let result = income_db::update_income_source(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_income_source(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_source_json(&conn, id);

    income_db::delete_income_source(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        id,
        "delete",
        old_json.as_deref(),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_income_entry(
    state: State<DbState>,
    source_id: i64,
    amount_cents: i64,
    month: String,
) -> Result<IncomeEntry, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    // Check if entry already exists (for audit trail: create vs update)
    let existing = income_db::get_entry_for_source_month(&conn, source_id, &month)?;
    let old_json = existing.as_ref().and_then(|e| serde_json::to_string(e).ok());
    let action = if existing.is_some() { "update" } else { "create" };

    let input = CreateIncomeEntryInput {
        source_id,
        amount_cents,
        month,
    };
    let result = income_db::upsert_income_entry(&conn, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_entry",
        result.id,
        action,
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_income_entry(
    state: State<DbState>,
    id: i64,
    amount_cents: i64,
) -> Result<IncomeEntry, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_entry_json(&conn, id);

    let input = UpdateIncomeEntryInput { amount_cents };
    let result = income_db::update_income_entry(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_entry",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_entries(
    state: State<DbState>,
    source_id: Option<i64>,
) -> Result<Vec<IncomeEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_income_entries(&conn, source_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_total(
    state: State<DbState>,
    month: String,
) -> Result<IncomeTotal, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_income_total(&conn, &month)
}

fn get_source_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, name, income_type, created_at, updated_at FROM income_sources WHERE id = ?1",
        rusqlite::params![id],
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
    .ok()
    .and_then(|s| serde_json::to_string(&s).ok())
}

fn get_entry_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                month: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .ok()
    .and_then(|e| serde_json::to_string(&e).ok())
}
```

- [ ] **Step 2: Register the module**

Add `pub mod income;` to `src-tauri/src/commands/mod.rs` (after `pub mod import;`).

- [ ] **Step 3: Register commands in lib.rs**

Add to the `invoke_handler` in `src-tauri/src/lib.rs`, after the `commands::onboarding::check_onboarding_status` line:

```rust
commands::income::create_income_source,
commands::income::get_income_sources,
commands::income::update_income_source,
commands::income::delete_income_source,
commands::income::create_income_entry,
commands::income::update_income_entry,
commands::income::get_income_entries,
commands::income::get_income_total,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/income.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(income): add income Tauri commands with audit logging"
```

---

## Chunk 2: Frontend — Types, Hooks, Income Page (Story 9.1 + 9.2 + 9.3)

### Task 5: Frontend Types & Query Keys

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add income types**

Append to `src/lib/types.ts`:

```typescript
export interface IncomeSource {
  id: number;
  name: string;
  income_type: string;
  created_at: string;
  updated_at: string;
}

export interface IncomeSourceWithLastEntry {
  id: number;
  name: string;
  income_type: string;
  last_amount_cents: number | null;
  last_month: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIncomeSourceInput {
  name: string;
  income_type: string;
}

export interface UpdateIncomeSourceInput {
  id: number;
  name: string;
  income_type: string;
}

export interface IncomeEntry {
  id: number;
  source_id: number;
  source_name: string;
  income_type: string;
  amount_cents: number;
  month: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIncomeEntryInput {
  source_id: number;
  amount_cents: number;
  month: string;
}

export interface IncomeTotal {
  total_cents: number;
  month: string;
}
```

- [ ] **Step 2: Add income query keys**

Add to `src/lib/constants.ts` `queryKeys` object:

```typescript
incomeSources: ["income-sources"] as const,
incomeEntries: (sourceId?: number) =>
  sourceId !== undefined
    ? ["income-entries", sourceId] as const
    : ["income-entries"] as const,
incomeTotal: (month: string) => ["income-total", month] as const,
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts
git commit -m "feat(income): add frontend types and query keys"
```

---

### Task 6: useIncome Hook

**Files:**
- Create: `src/hooks/useIncome.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  IncomeSourceWithLastEntry,
  IncomeSource,
  IncomeEntry,
  IncomeTotal,
  CreateIncomeSourceInput,
  UpdateIncomeSourceInput,
  CreateIncomeEntryInput,
} from "@/lib/types";

export function useIncomeSources() {
  return useQuery({
    queryKey: queryKeys.incomeSources,
    queryFn: () => invoke<IncomeSourceWithLastEntry[]>("get_income_sources"),
  });
}

export function useCreateIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIncomeSourceInput) =>
      invoke<IncomeSource>("create_income_source", {
        name: input.name,
        income_type: input.income_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
    },
  });
}

export function useUpdateIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateIncomeSourceInput) =>
      invoke<IncomeSource>("update_income_source", {
        id: input.id,
        name: input.name,
        income_type: input.income_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
    },
  });
}

export function useDeleteIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_income_source", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
      queryClient.invalidateQueries({ queryKey: ["income-entries"] });
      queryClient.invalidateQueries({ queryKey: ["income-total"] });
    },
  });
}

export function useCreateIncomeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIncomeEntryInput) =>
      invoke<IncomeEntry>("create_income_entry", {
        source_id: input.source_id,
        amount_cents: input.amount_cents,
        month: input.month,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
      queryClient.invalidateQueries({ queryKey: ["income-entries"] });
      queryClient.invalidateQueries({ queryKey: ["income-total"] });
    },
  });
}

export function useUpdateIncomeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number; amount_cents: number }) =>
      invoke<IncomeEntry>("update_income_entry", {
        id: input.id,
        amount_cents: input.amount_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
      queryClient.invalidateQueries({ queryKey: ["income-entries"] });
      queryClient.invalidateQueries({ queryKey: ["income-total"] });
    },
  });
}

export function useIncomeEntries(sourceId?: number) {
  return useQuery({
    queryKey: queryKeys.incomeEntries(sourceId),
    queryFn: () =>
      invoke<IncomeEntry[]>("get_income_entries", {
        source_id: sourceId ?? null,
      }),
  });
}

export function useIncomeTotal(month: string) {
  return useQuery({
    queryKey: queryKeys.incomeTotal(month),
    queryFn: () => invoke<IncomeTotal>("get_income_total", { month }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useIncome.ts
git commit -m "feat(income): add useIncome hooks for data fetching"
```

---

### Task 7: Sidebar Navigation Update

**Files:**
- Modify: `src/components/shared/AppSidebar.tsx`

- [ ] **Step 1: Add Income nav item**

Add `DollarSign` to the lucide-react imports, then add the Income entry as the 3rd nav item (after Budget, before Accounts):

```typescript
{ to: "/income", label: "Income", icon: DollarSign },
```

The `navItems` array should become:
```typescript
const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/budget", label: "Budget", icon: Wallet },
  { to: "/income", label: "Income", icon: DollarSign },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/assets", label: "Assets", icon: Gem },
  { to: "/net-worth", label: "Net Worth", icon: TrendingUp },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/chat", label: "AI Chat", icon: MessageSquare },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/AppSidebar.tsx
git commit -m "feat(income): add Income to sidebar navigation"
```

---

### Task 8: Income Source Components

**Files:**
- Create: `src/components/income/AddIncomeSourceForm.tsx`
- Create: `src/components/income/EditIncomeSourceForm.tsx`
- Create: `src/components/income/IncomeSourceRow.tsx`

- [ ] **Step 1: Create AddIncomeSourceForm**

Create `src/components/income/AddIncomeSourceForm.tsx`:

```typescript
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateIncomeSource } from "@/hooks/useIncome";

const INCOME_TYPE_OPTIONS = [
  { value: "employment", label: "Employment" },
  { value: "freelance", label: "Freelance" },
  { value: "investment", label: "Investment" },
  { value: "other", label: "Other" },
];

interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

interface AddIncomeSourceFormProps {
  onClose: () => void;
}

export function AddIncomeSourceForm({ onClose }: AddIncomeSourceFormProps) {
  const createSource = useCreateIncomeSource();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IncomeSourceFormData>({
    defaultValues: {
      name: "",
      income_type: "employment",
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: IncomeSourceFormData) => {
    createSource.mutate(
      { name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(`Income source "${data.name}" added`);
          onClose();
        },
        onError: () => {
          toast.error("Failed to add income source");
        },
      },
    );
  };

  const selectClassName =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
    >
      <div className="space-y-1.5">
        <Label htmlFor="source-name">Name</Label>
        <Input
          id="source-name"
          placeholder="e.g., Salary"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: "Source name is required" })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source-type">Type</Label>
        <select
          id="source-type"
          className={selectClassName}
          {...register("income_type")}
        >
          {INCOME_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save Source
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create EditIncomeSourceForm**

Create `src/components/income/EditIncomeSourceForm.tsx`:

```typescript
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateIncomeSource } from "@/hooks/useIncome";
import type { IncomeSourceWithLastEntry } from "@/lib/types";

const INCOME_TYPE_OPTIONS = [
  { value: "employment", label: "Employment" },
  { value: "freelance", label: "Freelance" },
  { value: "investment", label: "Investment" },
  { value: "other", label: "Other" },
];

interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

interface EditIncomeSourceFormProps {
  source: IncomeSourceWithLastEntry;
  onClose: () => void;
}

export function EditIncomeSourceForm({
  source,
  onClose,
}: EditIncomeSourceFormProps) {
  const updateSource = useUpdateIncomeSource();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IncomeSourceFormData>({
    defaultValues: {
      name: source.name,
      income_type: source.income_type,
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: IncomeSourceFormData) => {
    updateSource.mutate(
      { id: source.id, name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(`Income source updated`);
          onClose();
        },
        onError: () => {
          toast.error("Failed to update income source");
        },
      },
    );
  };

  const selectClassName =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-source-name">Name</Label>
        <Input
          id="edit-source-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: "Source name is required" })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-source-type">Type</Label>
        <select
          id="edit-source-type"
          className={selectClassName}
          {...register("income_type")}
        >
          {INCOME_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Create IncomeSourceRow**

Create `src/components/income/IncomeSourceRow.tsx`:

```typescript
import { useState, useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useDeleteIncomeSource, useCreateIncomeEntry } from "@/hooks/useIncome";
import type { IncomeSourceWithLastEntry } from "@/lib/types";
import { EditIncomeSourceForm } from "./EditIncomeSourceForm";

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  employment: { label: "Employment", className: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300" },
  freelance: { label: "Freelance", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300" },
  investment: { label: "Investment", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300" },
  other: { label: "Other", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

interface IncomeSourceRowProps {
  source: IncomeSourceWithLastEntry;
  currentMonth: string;
}

export function IncomeSourceRow({ source, currentMonth }: IncomeSourceRowProps) {
  const formatCurrency = useFormatCurrency();
  const deleteSource = useDeleteIncomeSource();
  const createEntry = useCreateIncomeEntry();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showEntryInput, setShowEntryInput] = useState(false);
  const [draftAmount, setDraftAmount] = useState(0);
  const draftRef = useRef(0);

  const badge = TYPE_BADGES[source.income_type] ?? TYPE_BADGES.other;

  const handleDraftChange = (cents: number) => {
    draftRef.current = cents;
    setDraftAmount(cents);
  };

  const handleEntrySave = () => {
    const amount = draftRef.current;
    if (amount <= 0) {
      setShowEntryInput(false);
      return;
    }

    createEntry.mutate(
      { source_id: source.id, amount_cents: amount, month: currentMonth },
      {
        onSuccess: (entry) => {
          const typeLabel = TYPE_BADGES[source.income_type]?.label ?? source.income_type;
          toast.success(
            `Income recorded — ${formatCurrency(entry.amount_cents)} from ${typeLabel}`,
          );
          setShowEntryInput(false);
        },
        onError: () => {
          toast.error("Failed to record income");
        },
      },
    );
  };

  const handleEntryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEntrySave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowEntryInput(false);
    }
  };

  const handleRowClick = () => {
    if (!showEditForm) {
      // Pre-fill with current month's amount if it exists, otherwise 0
      const prefill =
        source.last_month === currentMonth && source.last_amount_cents != null
          ? source.last_amount_cents
          : 0;
      draftRef.current = prefill;
      setDraftAmount(prefill);
      setShowEntryInput(true);
    }
  };

  const handleDelete = () => {
    deleteSource.mutate(source.id, {
      onSuccess: () => {
        toast.success(`Income source "${source.name}" deleted`);
        setShowDeleteDialog(false);
      },
      onError: () => {
        toast.error("Failed to delete income source");
        setShowDeleteDialog(false);
      },
    });
  };

  if (showEditForm) {
    return (
      <EditIncomeSourceForm
        source={source}
        onClose={() => setShowEditForm(false)}
      />
    );
  }

  return (
    <>
      <div
        className="group cursor-pointer"
        onClick={handleRowClick}
      >
        <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {source.name}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm font-mono text-muted-foreground">
              {source.last_amount_cents != null
                ? formatCurrency(source.last_amount_cents)
                : "—"}
            </span>
            <div
              className="flex opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowEditForm(true)}
              >
                <Pencil className="size-3.5 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          </div>
        </div>

        {showEntryInput && (
          <div
            className="px-3 pb-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 pl-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date().toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <div onKeyDown={handleEntryKeyDown} className="flex-1 max-w-[180px]">
                <MoneyInput
                  value={draftAmount}
                  onChange={handleDraftChange}
                  className="h-7 text-sm"
                />
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleEntrySave}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) setShowDeleteDialog(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Income Source</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{source.name}"? All income entries
              for this source will also be deleted. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/income/
git commit -m "feat(income): add income source components (add, edit, row)"
```

---

### Task 9: Income Page Route

**Files:**
- Create: `src/routes/income.tsx`

- [ ] **Step 1: Create the income route**

Create `src/routes/income.tsx`:

```typescript
import { useState, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { IncomeSourceRow } from "@/components/income/IncomeSourceRow";
import { AddIncomeSourceForm } from "@/components/income/AddIncomeSourceForm";
import {
  useIncomeSources,
  useIncomeEntries,
  useIncomeTotal,
  useUpdateIncomeEntry,
} from "@/hooks/useIncome";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { IncomeEntry } from "@/lib/types";

export const Route = createFileRoute("/income")({
  component: IncomePage,
});

function IncomePage() {
  const formatCurrency = useFormatCurrency();
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterSourceId, setFilterSourceId] = useState<number | undefined>(
    undefined,
  );

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const { data: sources, isLoading: sourcesLoading } = useIncomeSources();
  const { data: entries } = useIncomeEntries(filterSourceId);
  const { data: total } = useIncomeTotal(currentMonth);

  const hasSources = sources && sources.length > 0;
  const hasEntries = entries && entries.length > 0;

  const selectClassName =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div>
      <PageHeader
        title="Income"
        actions={
          <div className="flex items-center gap-3">
            {total && total.total_cents > 0 && (
              <span className="text-sm text-muted-foreground">
                {monthLabel}:{" "}
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(total.total_cents)}
                </span>
              </span>
            )}
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Source
            </Button>
          </div>
        }
      />

      {/* Add Source Form */}
      {showAddForm && (
        <div className="mb-4">
          <AddIncomeSourceForm onClose={() => setShowAddForm(false)} />
        </div>
      )}

      {/* Income Sources Card */}
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            Income Sources
          </p>

          {sourcesLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          )}

          {!sourcesLoading && !hasSources && !showAddForm && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">
                Add your first income source to start tracking cash flow
              </p>
              <Button
                className="mt-3"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Source
              </Button>
            </div>
          )}

          {hasSources && (
            <div className="space-y-0.5">
              {sources.map((source) => (
                <IncomeSourceRow
                  key={source.id}
                  source={source}
                  currentMonth={currentMonth}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly History Card */}
      {hasSources && (
        <Card className="shadow-sm rounded-lg mt-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">
                Monthly History
              </p>
              {sources.length > 1 && (
                <select
                  value={filterSourceId ?? ""}
                  onChange={(e) =>
                    setFilterSourceId(
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">All Sources</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {!hasEntries && (
              <div className="py-8 text-center">
                <p className="text-muted-foreground">
                  No income recorded yet. Click a source above to record this
                  month's income.
                </p>
              </div>
            )}

            {hasEntries && (
              <div className="space-y-0.5">
                {entries.map((entry) => (
                  <IncomeEntryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IncomeEntryRow({ entry }: { entry: IncomeEntry }) {
  const formatCurrency = useFormatCurrency();
  const updateEntry = useUpdateIncomeEntry();
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(entry.amount_cents);
  const draftRef = useRef(entry.amount_cents);

  const handleDraftChange = (cents: number) => {
    draftRef.current = cents;
    setDraftAmount(cents);
  };

  const handleSave = () => {
    const amount = draftRef.current;
    if (amount <= 0 || amount === entry.amount_cents) {
      setEditing(false);
      return;
    }
    updateEntry.mutate(
      { id: entry.id, amount_cents: amount },
      {
        onSuccess: () => {
          toast.success("Income entry updated");
          setEditing(false);
        },
        onError: () => {
          toast.error("Failed to update income entry");
          setEditing(false);
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  };

  // Format "2026-03" → "March 2026"
  const [year, month] = entry.month.split("-");
  const monthLabel = new Date(Number(year), Number(month) - 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="group flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3">
        <span className="text-sm text-foreground">{monthLabel}</span>
        <span className="text-sm text-muted-foreground">{entry.source_name}</span>
      </div>
      <div className="flex items-center gap-1">
        {editing ? (
          <div onKeyDown={handleKeyDown}>
            <MoneyInput
              value={draftAmount}
              onChange={handleDraftChange}
              className="h-7 w-28 text-sm"
            />
          </div>
        ) : (
          <>
            <span className="text-sm font-medium font-mono text-right">
              {formatCurrency(entry.amount_cents)}
            </span>
            <button
              onClick={() => {
                draftRef.current = entry.amount_cents;
                setDraftAmount(entry.amount_cents);
                setEditing(true);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Edit income entry for ${entry.source_name}`}
            >
              <Pencil className="size-3.5 text-muted-foreground" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `cd /Users/nbazinet/projects/nkbaz-finance && npx tsr generate`
Expected: `routeTree.gen.ts` is updated with the `/income` route

- [ ] **Step 3: Verify frontend compiles**

Run: `npm run build`
Expected: builds without errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/income.tsx src/routeTree.gen.ts
git commit -m "feat(income): add Income page with source management and history"
```

---

## Chunk 3: Dashboard Cash Flow Card (Story 10.1)

### Task 10: Cash Flow Summary Card

**Files:**
- Create: `src/components/dashboard/CashFlowSummaryCard.tsx`
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Create CashFlowSummaryCard component**

Create `src/components/dashboard/CashFlowSummaryCard.tsx`:

```typescript
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface CashFlowSummaryCardProps {
  incomeCents: number;
  expensesCents: number;
  isLoading?: boolean;
}

export function CashFlowSummaryCard({
  incomeCents,
  expensesCents,
  isLoading,
}: CashFlowSummaryCardProps) {
  const formatCurrency = useFormatCurrency();
  const netCents = incomeCents - expensesCents;
  const ratio = incomeCents > 0 ? (expensesCents / incomeCents) * 100 : 0;

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg col-span-full">
        <CardContent className="p-6">
          <div className="h-5 w-24 bg-muted animate-pulse rounded mb-3" />
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (incomeCents === 0) {
    return (
      <Link to="/income" className="col-span-full">
        <Card
          className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
          role="link"
          aria-label="No income recorded this month. Go to Income page to record income."
        >
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No income recorded this month
            </p>
            <p className="text-xs text-primary mt-1">
              Record your income to see cash flow
            </p>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const progressColor =
    ratio > 100 ? "bg-rose-500" : ratio >= 90 ? "bg-amber-500" : "bg-emerald-500";

  const ariaLabel = `Cash Flow: ${formatCurrency(incomeCents)} income, ${formatCurrency(expensesCents)} expenses, net ${netCents >= 0 ? "positive" : "negative"} ${formatCurrency(Math.abs(netCents))}`;

  return (
    <Link to="/income" className="col-span-full">
      <Card
        className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
        role="link"
        aria-label={ariaLabel}
      >
        <CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            Cash Flow
          </p>
          <div className="flex items-baseline gap-6">
            <div>
              <span className="text-xs text-muted-foreground">Income</span>
              <p className="text-lg font-mono font-medium text-emerald-600 dark:text-emerald-400">
                {formatCurrency(incomeCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Expenses</span>
              <p className="text-lg font-mono font-medium text-rose-500">
                {formatCurrency(expensesCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Net</span>
              <p
                className={`text-lg font-mono font-medium ${
                  netCents >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-500"
                }`}
              >
                {formatCurrency(netCents)}
              </p>
            </div>
          </div>
          <div
            className="h-2 w-full rounded-full bg-muted mt-3"
            role="progressbar"
            aria-valuenow={Math.min(ratio, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all ${progressColor}`}
              style={{ width: `${Math.min(ratio, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Add CashFlowSummaryCard to dashboard**

Modify `src/routes/index.tsx`:

1. Add import at top:
```typescript
import { CashFlowSummaryCard } from "@/components/dashboard/CashFlowSummaryCard";
import { useIncomeTotal } from "@/hooks/useIncome";
```

2. Inside `IndexPage()`, after the existing hooks, add:
```typescript
const incomeTotal = useIncomeTotal(currentMonth);
```

Where `currentMonth` is:
```typescript
const currentMonth = `${year}-${String(month).padStart(2, "0")}`;
```

3. Add the card before the Hero Section grid (after the `<PageHeader>` section):
```typescript
{/* Cash Flow Card */}
<div className="grid grid-cols-1 mb-4">
  <CashFlowSummaryCard
    incomeCents={incomeTotal.data?.total_cents ?? 0}
    expensesCents={summary?.total_spent_cents ?? 0}
    isLoading={incomeTotal.isPending || budgetSummary.isPending}
  />
</div>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npm run build`
Expected: builds without errors

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/CashFlowSummaryCard.tsx src/routes/index.tsx
git commit -m "feat(income): add CashFlowSummaryCard to dashboard"
```

---

## Chunk 4: Onboarding Income Step (Story 11.1)

### Task 11: Onboarding Income Step

**Files:**
- Create: `src/components/onboarding/OnboardingIncomeStep.tsx`
- Modify: `src/components/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Create OnboardingIncomeStep**

Create `src/components/onboarding/OnboardingIncomeStep.tsx` following the `OnboardingAccountsStep` pattern:

```typescript
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useIncomeSources, useCreateIncomeSource } from "@/hooks/useIncome";

const INCOME_TYPE_OPTIONS = [
  { value: "employment", label: "Employment" },
  { value: "freelance", label: "Freelance" },
  { value: "investment", label: "Investment" },
  { value: "other", label: "Other" },
];

const TYPE_LABELS: Record<string, string> = {
  employment: "Employment",
  freelance: "Freelance",
  investment: "Investment",
  other: "Other",
};

interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

export function OnboardingIncomeStep() {
  const { data: sources = [] } = useIncomeSources();
  const createSource = useCreateIncomeSource();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<IncomeSourceFormData>({
    defaultValues: { name: "", income_type: "employment" },
    mode: "onSubmit",
  });

  const selectClassName =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

  const onSubmit = (data: IncomeSourceFormData) => {
    createSource.mutate(
      { name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(`Income source "${data.name}" added`);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error("Failed to add income source"),
      },
    );
  };

  return (
    <div>
      <h2 className="text-lg font-medium mb-2">Income Sources</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Set up your income sources so we can track your cash flow. You can skip
        this step and add them later.
      </p>

      {sources.length > 0 && (
        <div className="space-y-2 mb-4">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="font-medium text-sm">{source.name}</span>
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABELS[source.income_type] ?? source.income_type}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm ? (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
        >
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-source-name">Name</Label>
            <Input
              id="onboarding-source-name"
              placeholder="e.g., Salary"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: "Source name is required" })}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-source-type">Type</Label>
            <select
              id="onboarding-source-type"
              className={selectClassName}
              {...register("income_type")}
            >
              {INCOME_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save Source
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                setShowForm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          <Plus className="size-4 mr-1" /> Add Source
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update OnboardingWizard**

Modify `src/components/onboarding/OnboardingWizard.tsx`:

1. Add import:
```typescript
import { OnboardingIncomeStep } from "./OnboardingIncomeStep";
```

2. Update STEPS array to include Income between Assets and Import:
```typescript
const STEPS = [
  { label: "Budget", key: "budget" },
  { label: "Accounts", key: "accounts" },
  { label: "Assets", key: "assets" },
  { label: "Income", key: "income" },
  { label: "Import", key: "import" },
] as const;
```

3. Update the step content rendering to add the income step:
```typescript
{currentStep === 0 && <OnboardingBudgetStep />}
{currentStep === 1 && <OnboardingAccountsStep />}
{currentStep === 2 && <OnboardingAssetsStep />}
{currentStep === 3 && <OnboardingIncomeStep />}
{currentStep === 4 && <OnboardingImportStep />}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npm run build`
Expected: builds without errors

- [ ] **Step 4: Commit**

```bash
git add src/components/onboarding/OnboardingIncomeStep.tsx src/components/onboarding/OnboardingWizard.tsx
git commit -m "feat(income): add Income Sources step to onboarding wizard"
```

---

## Chunk 5: AI Income-Aware Context (Story 12.1)

### Task 12: Add Income Data to AI Chat Context

**Files:**
- Modify: `src-tauri/src/commands/chat.rs` (or wherever the AI prompt is constructed)

- [ ] **Step 1: Explore AI chat implementation**

Read:
- `src-tauri/src/commands/chat.rs`
- `src-tauri/src/db/chat.rs`

Look for where the Bedrock prompt context is assembled. The income total and source breakdown need to be injected there.

- [ ] **Step 2: Add income context to the AI prompt**

In the chat command that builds the prompt context, add income data retrieval:

```rust
use crate::db::income as income_db;

// In the function that assembles prompt context:
let now = chrono::Local::now();
let current_month = now.format("%Y-%m").to_string();
let income_total = income_db::get_income_total(&conn, &current_month)?;

let income_context = if income_total.total_cents > 0 {
    let sources = income_db::get_all_income_sources(&conn)?;
    let entries = income_db::get_income_entries(&conn, None)?;
    let current_entries: Vec<_> = entries
        .iter()
        .filter(|e| e.month == current_month)
        .collect();

    let mut breakdown = String::from("Income this month:\n");
    for entry in &current_entries {
        breakdown.push_str(&format!(
            "- {} ({}): ${:.2}\n",
            entry.source_name,
            entry.income_type,
            entry.amount_cents as f64 / 100.0
        ));
    }
    breakdown.push_str(&format!(
        "Total income: ${:.2}\n",
        income_total.total_cents as f64 / 100.0
    ));
    breakdown
} else {
    "No income recorded for the current month.\n".to_string()
};

// Append income_context to the system prompt or user context
```

The exact integration depends on how the chat prompt is currently assembled — this step requires reading the chat implementation first.

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/chat.rs
git commit -m "feat(income): add income data to AI chat context"
```

---

## Chunk 6: Visual Verification

### Task 13: Browser Validation

- [ ] **Step 1: Start the dev server**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify Income page**

1. Check sidebar shows "Income" as 3rd item (after Budget)
2. Navigate to Income page — empty state shows "Add your first income source..."
3. Click "Add Source" — form appears with name + type dropdown
4. Add a source — toast confirms, source appears in list with type badge
5. Click source row — inline amount input appears with current month label
6. Enter amount, press Enter — toast confirms with emerald styling
7. Check Monthly History section shows the entry
8. Test source edit (pencil icon) and delete (trash icon with confirmation)

- [ ] **Step 3: Verify Dashboard cash flow card**

1. Navigate to Dashboard
2. CashFlowSummaryCard shows income vs expenses
3. Progress bar color: emerald (<90%), amber (90-100%), rose (>100%)
4. Click card navigates to Income page
5. If no income recorded, shows empty state with link

- [ ] **Step 4: Verify Onboarding**

1. Clear onboarding state or use a fresh database
2. Walk through wizard — step 4 should be "Income Sources"
3. Can add sources during onboarding
4. Can skip the step
5. Step indicator shows 5 steps: Budget → Accounts → Assets → Income → Import

---

## Notes

- Follow existing codebase patterns exactly — this plan mirrors account.rs / AccountRow / useAccounts patterns
- All monetary values stored and transmitted as integer cents
- `month` field uses `"YYYY-MM"` format for consistent sorting and querying
- `ON DELETE CASCADE` on `income_entries.source_id` means deleting a source cleans up entries
- `UNIQUE(source_id, month)` + `ON CONFLICT` upsert means recording income for the same source+month updates rather than duplicates
- The `IncomeEntryRow` in the income page allows inline editing of amounts via hover → click
