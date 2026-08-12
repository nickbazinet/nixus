use chrono::NaiveDate;
use rusqlite::{params, Connection};

use crate::db::config;
use crate::error::AppError;
use crate::models::{
    AccountEarmarkBreakdown, AccountEarmarkSegment, AccountHeadroom,
    CreateProjectContributionInput, CreateProjectInput, Project, ProjectAllocationInput,
    ProjectContribution, ProjectSavedTotal, SavingsProjectsSummary, UpdateProjectInput,
};
use crate::projects::allocation::AllocationProject;
use crate::projects::pace::ProjectPaceRow;
use crate::projects::settlement::ConfirmedSuggestionMonth;

pub const SUGGESTION_SKIPPED_MONTH_CONFIG_KEY: &str = "projects_suggestion_skipped_month";

const SELECT_COLUMNS: &str = "id, name, target_cents, target_date, priority, icon, color, archived_at, created_at, updated_at";

const CONTRIBUTION_SELECT_COLUMNS: &str =
    "id, project_id, account_id, amount_cents, source, date, created_at";

// `suggested` is Epic 32's write path; rejecting it here would break that story even though this
// story's UI only ever sends `manual`.
const VALID_CONTRIBUTION_SOURCES: &[&str] = &["manual", "suggested"];

fn map_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        target_cents: row.get(2)?,
        target_date: row.get(3)?,
        priority: row.get(4)?,
        icon: row.get(5)?,
        color: row.get(6)?,
        archived_at: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn validate_project_fields(name: &str, target_cents: i64) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Project name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if target_cents <= 0 {
        return Err(AppError::Validation {
            message: "Target amount must be greater than zero".to_string(),
            field: Some("target_cents".to_string()),
        });
    }

    Ok(())
}

pub fn insert_project(conn: &Connection, input: &CreateProjectInput) -> Result<Project, AppError> {
    let name = input.name.trim();
    validate_project_fields(name, input.target_cents)?;

    // Absent priority means "least important goal I have", so it lands at the end of the active
    // order rather than tying every new project at 0. Scoped to `archived_at IS NULL` so an
    // archived project cannot leave a permanent gap in the dense 0..n-1 range.
    let priority = match input.priority {
        Some(explicit) => explicit,
        None => conn.query_row(
            "SELECT COALESCE(MAX(priority), -1) + 1 FROM projects WHERE archived_at IS NULL",
            [],
            |row| row.get(0),
        )?,
    };

    conn.execute(
        "INSERT INTO projects (name, target_cents, target_date, priority, icon, color)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            name,
            input.target_cents,
            input.target_date,
            priority,
            input.icon,
            input.color
        ],
    )?;

    get_project_by_id(conn, conn.last_insert_rowid())
}

pub fn get_active_projects(conn: &Connection) -> Result<Vec<Project>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM projects WHERE archived_at IS NULL ORDER BY priority, id"
    ))?;

    let projects = stmt
        .query_map([], map_project)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

pub fn get_project_by_id(conn: &Connection, id: i64) -> Result<Project, AppError> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM projects WHERE id = ?1"),
        params![id],
        map_project,
    )
    .map_err(AppError::from)
}

pub fn update_project(
    conn: &Connection,
    id: i64,
    input: &UpdateProjectInput,
) -> Result<Project, AppError> {
    let name = input.name.trim();
    validate_project_fields(name, input.target_cents)?;

    let rows = conn.execute(
        "UPDATE projects
         SET name = ?1, target_cents = ?2, target_date = ?3, priority = ?4, icon = ?5, color = ?6,
             updated_at = datetime('now')
         WHERE id = ?7",
        params![
            name,
            input.target_cents,
            input.target_date,
            input.priority.unwrap_or(0),
            input.icon,
            input.color,
            id
        ],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Project not found".to_string(),
        });
    }

    get_project_by_id(conn, id)
}

pub fn archive_project(conn: &Connection, id: i64) -> Result<Project, AppError> {
    // The `archived_at IS NULL` guard turns a double-archive into an error rather than silently
    // rewriting the original archive timestamp.
    let rows = conn.execute(
        "UPDATE projects
         SET archived_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1 AND archived_at IS NULL",
        params![id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Project not found".to_string(),
        });
    }

    get_project_by_id(conn, id)
}

// Db-layer internal: it never crosses the IPC boundary, so it carries no serde derives.
#[derive(Debug)]
pub struct ProjectPriorityChange {
    pub project_id: i64,
    pub old_json: String,
    pub new_json: String,
}

fn invalid_project_ids(message: &str) -> AppError {
    AppError::Validation {
        message: message.to_string(),
        field: Some("project_ids".to_string()),
    }
}

// The submitted list must be a permutation of the active set, and the whole rewrite is one
// transaction: a partially applied order would silently feed Story 32.2's suggested split a
// corrupted ranking. Every check runs before the transaction opens, so a rejection writes nothing.
pub fn reorder_projects(
    conn: &Connection,
    project_ids: &[i64],
) -> Result<Vec<ProjectPriorityChange>, AppError> {
    if project_ids.is_empty() {
        return Err(invalid_project_ids("At least one project is required"));
    }

    let active = get_active_projects(conn)?;

    if project_ids.len() != active.len() {
        return Err(invalid_project_ids(
            "The submitted order must contain every active project exactly once",
        ));
    }

    let mut seen = std::collections::HashSet::with_capacity(project_ids.len());
    let mut ordered = Vec::with_capacity(project_ids.len());
    for (index, id) in project_ids.iter().enumerate() {
        if !seen.insert(*id) {
            return Err(invalid_project_ids(&format!(
                "Project {id} appears more than once in the submitted order"
            )));
        }
        let previous = active
            .iter()
            .find(|project| project.id == *id)
            .ok_or_else(|| {
                invalid_project_ids(&format!("Project {id} is not an active project"))
            })?;
        let priority = i32::try_from(index).map_err(|_| {
            invalid_project_ids("The submitted order contains more projects than supported")
        })?;
        ordered.push((previous, priority));
    }

    let tx = conn.unchecked_transaction()?;

    let mut changes = Vec::new();
    for (previous, priority) in ordered {
        tx.execute(
            "UPDATE projects SET priority = ?1, updated_at = datetime('now')
             WHERE id = ?2 AND archived_at IS NULL",
            params![priority, previous.id],
        )?;

        if previous.priority != priority {
            let updated = get_project_by_id(&tx, previous.id)?;
            changes.push(ProjectPriorityChange {
                project_id: previous.id,
                old_json: serde_json::to_string(previous).unwrap_or_default(),
                new_json: serde_json::to_string(&updated).unwrap_or_default(),
            });
        }
    }

    tx.commit()?;

    Ok(changes)
}

fn map_contribution(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectContribution> {
    Ok(ProjectContribution {
        id: row.get(0)?,
        project_id: row.get(1)?,
        account_id: row.get(2)?,
        amount_cents: row.get(3)?,
        source: row.get(4)?,
        date: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn get_contribution_by_id(conn: &Connection, id: i64) -> Result<ProjectContribution, AppError> {
    conn.query_row(
        &format!("SELECT {CONTRIBUTION_SELECT_COLUMNS} FROM project_contributions WHERE id = ?1"),
        params![id],
        map_contribution,
    )
    .map_err(AppError::from)
}

fn validate_contribution_input(
    conn: &Connection,
    input: &CreateProjectContributionInput,
    date: &str,
) -> Result<(), AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Contribution amount must be greater than zero".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if date.is_empty() {
        return Err(AppError::Validation {
            message: "Contribution date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    if !VALID_CONTRIBUTION_SOURCES.contains(&input.source.as_str()) {
        return Err(AppError::Validation {
            message: format!("Unknown contribution source: {}", input.source),
            field: Some("source".to_string()),
        });
    }

    let project_is_active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)",
        params![input.project_id],
        |row| row.get(0),
    )?;
    if !project_is_active {
        return Err(AppError::Validation {
            message: "Project not found".to_string(),
            field: Some("project_id".to_string()),
        });
    }

    // Duplicated by the FK, but a field-scoped validation error is what the form can render; the
    // FK would surface as a raw SQLite message.
    let account_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
        params![input.account_id],
        |row| row.get(0),
    )?;
    if !account_exists {
        return Err(AppError::Validation {
            message: "Account not found".to_string(),
            field: Some("account_id".to_string()),
        });
    }

    Ok(())
}

pub fn insert_project_contribution(
    conn: &Connection,
    input: &CreateProjectContributionInput,
) -> Result<ProjectContribution, AppError> {
    let date = input.date.trim();
    validate_contribution_input(conn, input, date)?;

    conn.execute(
        "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.project_id,
            input.account_id,
            input.amount_cents,
            input.source,
            date
        ],
    )?;

    get_contribution_by_id(conn, conn.last_insert_rowid())
}

fn validate_suggested_allocations(
    conn: &Connection,
    allocations: &[&ProjectAllocationInput],
) -> Result<(), AppError> {
    let mut seen = std::collections::HashSet::with_capacity(allocations.len());

    for (index, allocation) in allocations.iter().enumerate() {
        let row = index + 1;

        // Only *negative* is invalid here: a zero entry has already been filtered out as "skip this
        // project", which is why this diverges from `insert_project_contribution`'s `<= 0`.
        if allocation.amount_cents < 0 {
            return Err(AppError::Validation {
                message: format!("Row {row}: amount cannot be negative"),
                field: Some("amount_cents".to_string()),
            });
        }

        if !seen.insert(allocation.project_id) {
            return Err(AppError::Validation {
                message: format!(
                    "Row {row}: project {} appears more than once in the confirmation",
                    allocation.project_id
                ),
                field: Some("project_id".to_string()),
            });
        }

        let project_is_active: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)",
            params![allocation.project_id],
            |row| row.get(0),
        )?;
        if !project_is_active {
            return Err(AppError::Validation {
                message: format!(
                    "Row {row}: project not found (id={})",
                    allocation.project_id
                ),
                field: Some("project_id".to_string()),
            });
        }

        // Pre-checked rather than left to the foreign key, so the user gets a field-scoped
        // validation error instead of a raw "FOREIGN KEY constraint failed".
        let account_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
            params![allocation.account_id],
            |row| row.get(0),
        )?;
        if !account_exists {
            return Err(AppError::Validation {
                message: format!(
                    "Row {row}: account not found (id={})",
                    allocation.account_id
                ),
                field: Some("account_id".to_string()),
            });
        }

        if NaiveDate::parse_from_str(allocation.date.trim(), "%Y-%m-%d").is_err() {
            return Err(AppError::Validation {
                message: format!("Row {row}: date must be an ISO 8601 YYYY-MM-DD value"),
                field: Some("date".to_string()),
            });
        }
    }

    Ok(())
}

// The one and only write path for suggested allocations (FR8, NFR4). `'suggested'` is a literal in
// the INSERT below and never a bound parameter, so no caller can forge a different source value; the
// schema's `CHECK (source IN ('manual','suggested'))` is only the backstop. Nothing here touches
// `accounts`: earmarking labels money that is already in the account (SC2).
pub fn insert_suggested_contributions(
    conn: &Connection,
    allocations: &[ProjectAllocationInput],
) -> Result<Vec<ProjectContribution>, AppError> {
    let funded: Vec<&ProjectAllocationInput> = allocations
        .iter()
        .filter(|allocation| allocation.amount_cents != 0)
        .collect();

    // A confirmation of nothing is a no-op, not an error: zeroing every amount is how the panel says
    // "skip these", so no transaction is opened at all.
    if funded.is_empty() {
        return Ok(Vec::new());
    }

    // All-or-nothing: every check runs before the transaction opens, so a batch with one bad entry
    // writes no rows at all — not even the valid entries ahead of it.
    validate_suggested_allocations(conn, &funded)?;

    let tx = conn.unchecked_transaction()?;

    let mut created_ids = Vec::with_capacity(funded.len());
    for allocation in &funded {
        tx.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, ?2, ?3, 'suggested', ?4)",
            params![
                allocation.project_id,
                allocation.account_id,
                allocation.amount_cents,
                allocation.date.trim()
            ],
        )?;
        created_ids.push(tx.last_insert_rowid());
    }

    tx.commit()?;

    created_ids
        .into_iter()
        .map(|id| get_contribution_by_id(conn, id))
        .collect()
}

// Returns the deleted row so the command layer has an audit `old_value` and the frontend knows
// which project and account keys to invalidate.
pub fn delete_project_contribution(
    conn: &Connection,
    id: i64,
) -> Result<ProjectContribution, AppError> {
    let contribution = get_contribution_by_id(conn, id)?;

    let rows = conn.execute(
        "DELETE FROM project_contributions WHERE id = ?1",
        params![id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Contribution not found".to_string(),
        });
    }

    Ok(contribution)
}

pub fn get_project_contributions(
    conn: &Connection,
    project_id: i64,
) -> Result<Vec<ProjectContribution>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CONTRIBUTION_SELECT_COLUMNS} FROM project_contributions
         WHERE project_id = ?1 ORDER BY date DESC, id DESC"
    ))?;

    let contributions = stmt
        .query_map(params![project_id], map_contribution)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(contributions)
}

// `COALESCE(..., 0)` is load-bearing: `SUM` over zero rows is `NULL`, which fails the `i64` get.
// Single-project read: the list surface uses `get_project_saved_totals` instead, so the only
// current caller is the test module; Story 31.4's dashboard rollup is the production consumer.
#[allow(dead_code)]
pub fn get_project_saved_cents(conn: &Connection, project_id: i64) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM project_contributions WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

pub fn get_project_saved_totals(conn: &Connection) -> Result<Vec<ProjectSavedTotal>, AppError> {
    // LEFT JOIN, not JOIN: a project with no contributions must still return a 0 row, which is
    // every project's state right after creation.
    let mut stmt = conn.prepare(
        "SELECT p.id, COALESCE(SUM(c.amount_cents), 0) AS saved_cents
         FROM projects p
         LEFT JOIN project_contributions c ON c.project_id = p.id
         WHERE p.archived_at IS NULL
         GROUP BY p.id",
    )?;

    let totals = stmt
        .query_map([], |row| {
            Ok(ProjectSavedTotal {
                project_id: row.get(0)?,
                saved_cents: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(totals)
}

// Read-only by contract: this is the "how is my balance split" answer, so it must not write
// anything — least of all `accounts.balance_cents`, which only the manual-edit path may touch.
pub fn get_account_earmark_breakdown(
    conn: &Connection,
    account_id: i64,
) -> Result<AccountEarmarkBreakdown, AppError> {
    let balance_cents: i64 = conn
        .query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Validation {
            message: "Account not found".to_string(),
            field: Some("account_id".to_string()),
        })?;

    // JOIN, not LEFT JOIN, and no `archived_at` filter: the driving table is the contributions, and
    // dropping archived projects would silently reappear as "unallocated" — money the user would
    // then read as free to spend.
    let mut stmt = conn.prepare(
        "SELECT c.project_id,
                p.name AS project_name,
                COALESCE(SUM(c.amount_cents), 0) AS earmarked_cents
         FROM project_contributions c
         JOIN projects p ON p.id = c.project_id
         WHERE c.account_id = ?1
         GROUP BY c.project_id, p.name
         ORDER BY earmarked_cents DESC, p.name",
    )?;

    let segments = stmt
        .query_map(params![account_id], |row| {
            Ok(AccountEarmarkSegment {
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                earmarked_cents: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let earmarked_cents = segments
        .iter()
        .map(|segment| segment.earmarked_cents)
        .sum::<i64>();

    Ok(AccountEarmarkBreakdown {
        account_id,
        balance_cents,
        earmarked_cents,
        unallocated_cents: balance_cents - earmarked_cents,
        segments,
    })
}

// Same earmark arithmetic as `get_account_earmark_breakdown`, widened to every liquid account and
// narrowed to the remainder: the advisory prompt only needs "which chequing/savings accounts hold
// money no goal has claimed". The type filter lives in SQL, not in the caller, so an account type
// outside `chequing`/`savings` cannot reach the model even if a future caller forgets to filter.
// `LEFT JOIN` (unlike the per-account breakdown's `JOIN`) keeps an account with no contributions at
// all — the common case, and the largest headroom. Archived projects are deliberately still counted,
// so money committed to a paused goal is not re-offered as free cash.
pub fn get_liquid_account_headroom(conn: &Connection) -> Result<Vec<AccountHeadroom>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT a.id,
                a.name,
                a.account_type,
                a.balance_cents - COALESCE(SUM(c.amount_cents), 0) AS unallocated_cents
         FROM accounts a
         LEFT JOIN project_contributions c ON c.account_id = a.id
         WHERE a.account_type IN ('chequing', 'savings')
         GROUP BY a.id, a.name, a.account_type, a.balance_cents
         HAVING unallocated_cents > 0
         ORDER BY unallocated_cents DESC, a.name",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AccountHeadroom {
                account_id: row.get(0)?,
                account_name: row.get(1)?,
                account_type: row.get(2)?,
                unallocated_cents: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

// Read-only rollup for the dashboard card. `LEFT JOIN` keeps a contribution-free project in the
// count, `COUNT(DISTINCT p.id)` undoes the join's row multiplication, and `total_target_cents` comes
// from a correlated subquery because `SUM(p.target_cents)` over the joined set would multiply each
// target by its contribution count. Archived projects are excluded everywhere: this answers "the
// goals I am actively working on", unlike `get_account_earmark_breakdown`, which keeps them.
pub fn get_savings_projects_summary(
    conn: &Connection,
) -> Result<SavingsProjectsSummary, AppError> {
    conn.query_row(
        "SELECT COUNT(DISTINCT p.id),
                COALESCE(SUM(c.amount_cents), 0),
                COALESCE((SELECT SUM(target_cents) FROM projects WHERE archived_at IS NULL), 0)
         FROM projects p
         LEFT JOIN project_contributions c ON c.project_id = p.id
         WHERE p.archived_at IS NULL",
        [],
        |row| {
            Ok(SavingsProjectsSummary {
                active_project_count: row.get(0)?,
                total_saved_cents: row.get(1)?,
                total_target_cents: row.get(2)?,
            })
        },
    )
    .map_err(AppError::from)
}

// Feeds `projects::allocation::compute_suggested_allocation`, which is pure and holds no
// `Connection`: this is the only place the suggestion path touches SQLite, and it is a read.
// One statement rather than composing `get_project_saved_totals` with `get_active_projects`, because
// the algorithm needs name, priority, target, target date and the saved sum on the same row, and two
// queries stitched together in Rust would reintroduce the ordering the SQL already guarantees.
pub fn get_active_allocation_projects(
    conn: &Connection,
) -> Result<Vec<AllocationProject>, AppError> {
    // LEFT JOIN + COALESCE, not JOIN: a project with no contributions must still return a row with
    // `saved_cents = 0`, which is every project's state right after creation.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.priority, p.target_cents, p.target_date,
                COALESCE(SUM(pc.amount_cents), 0) AS saved_cents
         FROM projects p
         LEFT JOIN project_contributions pc ON pc.project_id = p.id
         WHERE p.archived_at IS NULL
         GROUP BY p.id
         ORDER BY p.priority, p.id",
    )?;

    let projects = stmt
        .query_map([], |row| {
            Ok(AllocationProject {
                project_id: row.get(0)?,
                name: row.get(1)?,
                priority: row.get(2)?,
                target_cents: row.get(3)?,
                target_date: row.get(4)?,
                saved_cents: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

// Feeds `projects::pace::compute_project_pace`, which is pure and holds no `Connection`. The trailing
// window is a bound parameter rather than a `date('now','-3 months')` expression so that this query
// and the divisor in `pace.rs` share one clock (`chrono::Local` in the command layer): SQLite's UTC
// `now` would shift the window by a day for a late-evening read and silently change the average.
//
// Both sums come from one conditional aggregate rather than two queries: `saved_cents` and
// `recent_cents` must be read from the same snapshot, or a contribution written between two reads
// would count toward the target but not the pace.
pub fn get_active_project_pace_inputs(
    conn: &Connection,
    recent_since: &str,
) -> Result<Vec<ProjectPaceRow>, AppError> {
    // LEFT JOIN + COALESCE, not JOIN: a project with no contributions must still return a row, and
    // "no contributions yet" is half of the "too new to judge" gate.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.target_cents, p.target_date, p.created_at,
                COALESCE(SUM(pc.amount_cents), 0) AS saved_cents,
                COALESCE(SUM(CASE WHEN pc.date >= ?1 THEN pc.amount_cents ELSE 0 END), 0)
                    AS recent_cents
         FROM projects p
         LEFT JOIN project_contributions pc ON pc.project_id = p.id
         WHERE p.archived_at IS NULL
         GROUP BY p.id
         ORDER BY p.priority, p.id",
    )?;

    let rows = stmt
        .query_map(params![recent_since], |row| {
            Ok(ProjectPaceRow {
                project_id: row.get(0)?,
                target_cents: row.get(1)?,
                target_date: row.get(2)?,
                created_at: row.get(3)?,
                saved_cents: row.get(4)?,
                recent_cents: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

// Deliberately as broad as `project_contributions.account_id`'s `ON DELETE RESTRICT`: no
// `archived_at` filter. Narrowing to active projects would let an archived-only account past the
// caller's guard and into the raw foreign-key failure, which reaches the user as
// "FOREIGN KEY constraint failed". An empty vec means "nothing blocks this delete".
pub fn get_project_names_funded_by_account(
    conn: &Connection,
    account_id: i64,
) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.name
         FROM project_contributions c
         JOIN projects p ON p.id = c.project_id
         WHERE c.account_id = ?1
         ORDER BY p.name",
    )?;

    let names = stmt
        .query_map(params![account_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(names)
}

// "Did the user already confirm a split this month?" — derived from the ledger, never from a stored
// flag. A confirmation's only trace is the `source = 'suggested'` rows it wrote, and that trace is
// enough: no `confirmed` column exists, so the two can never disagree.
//
// The month is a bound parameter rather than `strftime('%Y-%m','now')` so that this query and the
// skip marker share one clock (`chrono::Local` in the command layer). Comparing local-time months
// against SQLite's UTC `now` would make a late-evening confirmation on the last day of a month look
// like next month's — the exact "it asked me again" bug this feature removes.
pub fn get_confirmed_suggestion_for_month(
    conn: &Connection,
    month: &str,
) -> Result<Option<ConfirmedSuggestionMonth>, AppError> {
    // `MAX(date)` is NULL over zero rows, which is what distinguishes "nothing confirmed" from
    // "confirmed 0 cents" — so it is read as `Option<String>` and drives the outer `None`.
    let (latest_date, total_cents, project_count): (Option<String>, i64, i64) = conn.query_row(
        "SELECT MAX(date), COALESCE(SUM(amount_cents), 0), COUNT(DISTINCT project_id)
         FROM project_contributions
         WHERE source = 'suggested' AND strftime('%Y-%m', date) = ?1",
        params![month],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    Ok(latest_date.map(|latest_date| ConfirmedSuggestionMonth {
        latest_date,
        total_cents,
        project_count,
    }))
}

// The stored half of the cadence, and the only thing a skip writes. It is a UI preference, not a
// financial fact, so it lives in `config` beside `emergency_fund_target_months` rather than in a
// table of its own.
pub fn get_suggestion_skipped_month(conn: &Connection) -> Option<String> {
    config::get(conn, SUGGESTION_SKIPPED_MONTH_CONFIG_KEY).filter(|month| !month.is_empty())
}

pub fn set_suggestion_skipped_month(conn: &Connection, month: &str) -> Result<(), AppError> {
    config::set(conn, SUGGESTION_SKIPPED_MONTH_CONFIG_KEY, month).map_err(AppError::from)
}

// Cleared by writing an empty value rather than by deleting the row: `config` exposes `get`/`set`
// only, an empty string is already "not a month" to `get_suggestion_skipped_month`, and this keeps
// clearing on the same upsert path as setting.
pub fn clear_suggestion_skipped_month(conn: &Connection) -> Result<(), AppError> {
    set_suggestion_skipped_month(conn, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::financial_health::evaluator::WaterfallStep;
    use crate::projects::allocation::{compute_suggested_allocation, AllocationInput};
    use crate::projects::pace::{compute_project_pace, PaceInput};

    fn projects_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                institution TEXT NOT NULL,
                account_type TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CAD',
                balance_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL,
                target_date TEXT,
                priority INTEGER NOT NULL DEFAULT 0,
                icon TEXT,
                color TEXT,
                archived_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE project_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
                amount_cents INTEGER NOT NULL,
                source TEXT NOT NULL CHECK (source IN ('manual', 'suggested')),
                date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_project_contributions_project_id ON project_contributions(project_id);
            CREATE INDEX idx_project_contributions_account_id ON project_contributions(account_id);
            CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        conn
    }

    fn create_input(name: &str, target_cents: i64) -> CreateProjectInput {
        CreateProjectInput {
            name: name.to_string(),
            target_cents,
            target_date: None,
            priority: None,
            icon: None,
            color: None,
        }
    }

    fn insert_test_account(conn: &Connection, balance_cents: i64) -> i64 {
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, currency, balance_cents)
             VALUES ('Chequing', 'RBC', 'chequing', 'CAD', ?1)",
            params![balance_cents],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn balance_cents(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn project_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn insert_project_persists_target_and_defaults() {
        let conn = projects_test_db();

        let project = insert_project(&conn, &create_input("Car down payment", 500_000)).unwrap();

        assert_eq!(project.name, "Car down payment");
        assert_eq!(project.target_cents, 500_000);
        assert_eq!(project.priority, 0);
        assert_eq!(project.archived_at, None);
        assert_eq!(project.target_date, None);
    }

    #[test]
    fn insert_project_without_priority_appends_to_the_end_of_the_order() {
        let conn = projects_test_db();

        let first = insert_project(&conn, &create_input("First", 100_000)).unwrap();
        let second = insert_project(&conn, &create_input("Second", 100_000)).unwrap();
        let third = insert_project(&conn, &create_input("Third", 100_000)).unwrap();

        assert_eq!(first.priority, 0);
        assert_eq!(second.priority, 1);
        assert_eq!(third.priority, 2);
    }

    #[test]
    fn insert_project_honours_an_explicitly_supplied_priority() {
        let conn = projects_test_db();
        insert_project(&conn, &create_input("First", 100_000)).unwrap();

        let mut explicit = create_input("Pinned to the top", 100_000);
        explicit.priority = Some(0);
        let pinned = insert_project(&conn, &explicit).unwrap();

        assert_eq!(pinned.priority, 0);
    }

    #[test]
    fn archived_projects_do_not_inflate_the_next_assigned_priority() {
        let conn = projects_test_db();
        insert_project(&conn, &create_input("Kept", 100_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 100_000)).unwrap();
        assert_eq!(archived.priority, 1);

        archive_project(&conn, archived.id).unwrap();

        let next = insert_project(&conn, &create_input("Next", 100_000)).unwrap();

        assert_eq!(next.priority, 1);
    }

    #[test]
    fn insert_project_trims_name_and_rejects_blank() {
        let conn = projects_test_db();

        let trimmed = insert_project(&conn, &create_input("  Roof  ", 100_000)).unwrap();
        assert_eq!(trimmed.name, "Roof");

        let error = insert_project(&conn, &create_input("   ", 100_000)).unwrap_err();
        match error {
            AppError::Validation { field, .. } => assert_eq!(field, Some("name".to_string())),
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn insert_project_rejects_non_positive_target() {
        let conn = projects_test_db();

        for target in [0, -1_000] {
            let error = insert_project(&conn, &create_input("Trip", target)).unwrap_err();
            match error {
                AppError::Validation { field, .. } => {
                    assert_eq!(field, Some("target_cents".to_string()));
                }
                other => panic!("expected validation error, got {other:?}"),
            }
        }
    }

    #[test]
    fn get_active_projects_excludes_archived_and_orders_by_priority() {
        let conn = projects_test_db();

        let mut low = create_input("Low priority", 100_000);
        low.priority = Some(5);
        let low = insert_project(&conn, &low).unwrap();

        let mut high = create_input("High priority", 200_000);
        high.priority = Some(1);
        let high = insert_project(&conn, &high).unwrap();

        let archived = insert_project(&conn, &create_input("Archived", 300_000)).unwrap();
        archive_project(&conn, archived.id).unwrap();

        let active = get_active_projects(&conn).unwrap();

        assert_eq!(
            active.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![high.id, low.id]
        );
    }

    #[test]
    fn update_project_changes_name_target_and_date() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Old name", 100_000)).unwrap();

        let updated = update_project(
            &conn,
            project.id,
            &UpdateProjectInput {
                name: "New name".to_string(),
                target_cents: 750_000,
                target_date: Some("2027-06-01".to_string()),
                priority: Some(2),
                icon: None,
                color: None,
            },
        )
        .unwrap();

        assert_eq!(updated.name, "New name");
        assert_eq!(updated.target_cents, 750_000);
        assert_eq!(updated.target_date, Some("2027-06-01".to_string()));
        assert_eq!(updated.priority, 2);
    }

    #[test]
    fn update_project_on_missing_id_errors() {
        let conn = projects_test_db();

        let error = update_project(
            &conn,
            999,
            &UpdateProjectInput {
                name: "Ghost".to_string(),
                target_cents: 100_000,
                target_date: None,
                priority: None,
                icon: None,
                color: None,
            },
        );

        assert!(error.is_err());
    }

    #[test]
    fn archive_project_soft_deletes_and_hides_from_active_list() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Boat", 900_000)).unwrap();
        let before = project_count(&conn);

        let archived = archive_project(&conn, project.id).unwrap();

        assert!(archived.archived_at.is_some());
        assert_eq!(project_count(&conn), before);
        assert!(get_active_projects(&conn).unwrap().is_empty());
    }

    #[test]
    fn archive_project_twice_errors() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Boat", 900_000)).unwrap();

        archive_project(&conn, project.id).unwrap();

        assert!(archive_project(&conn, project.id).is_err());
    }

    #[test]
    fn contribution_foreign_keys_cascade_on_project_and_restrict_on_account() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_000_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        conn.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, ?2, 25000, 'manual', '2026-08-01')",
            params![project.id, account_id],
        )
        .unwrap();

        assert!(conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .is_err());

        conn.execute("DELETE FROM projects WHERE id = ?1", params![project.id])
            .unwrap();

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_contributions WHERE project_id = ?1",
                params![project.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn project_mutations_never_move_account_balances() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let before = balance_cents(&conn, account_id);

        let project = insert_project(&conn, &create_input("Wedding", 2_000_000)).unwrap();
        assert_eq!(balance_cents(&conn, account_id), before);

        update_project(
            &conn,
            project.id,
            &UpdateProjectInput {
                name: "Wedding".to_string(),
                target_cents: 2_500_000,
                target_date: None,
                priority: None,
                icon: None,
                color: None,
            },
        )
        .unwrap();
        assert_eq!(balance_cents(&conn, account_id), before);

        archive_project(&conn, project.id).unwrap();
        assert_eq!(balance_cents(&conn, account_id), before);
    }

    fn contribution_input(
        project_id: i64,
        account_id: i64,
        amount_cents: i64,
    ) -> CreateProjectContributionInput {
        CreateProjectContributionInput {
            project_id,
            account_id,
            amount_cents,
            source: "manual".to_string(),
            date: "2026-08-01".to_string(),
        }
    }

    fn contribution_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM project_contributions", [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn expect_validation_field(error: AppError, expected: &str) {
        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some(expected.to_string()));
            }
            other => panic!("expected validation error on {expected}, got {other:?}"),
        }
    }

    #[test]
    fn insert_project_contribution_persists_row_and_raises_saved_total() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 800_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        assert_eq!(get_project_saved_cents(&conn, project.id).unwrap(), 0);

        let contribution =
            insert_project_contribution(&conn, &contribution_input(project.id, account_id, 25_000))
                .unwrap();

        assert_eq!(contribution.project_id, project.id);
        assert_eq!(contribution.account_id, account_id);
        assert_eq!(contribution.amount_cents, 25_000);
        assert_eq!(contribution.source, "manual");
        assert_eq!(contribution.date, "2026-08-01");
        assert_eq!(get_project_saved_cents(&conn, project.id).unwrap(), 25_000);
    }

    // The executable form of PRD SC2: earmarking is a label on money that is already in the
    // account, so the seeded balance is asserted literally on both sides of the ledger write.
    #[test]
    fn contribution_writes_never_move_account_balances() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let project = insert_project(&conn, &create_input("Roof", 900_000)).unwrap();

        let contribution =
            insert_project_contribution(&conn, &contribution_input(project.id, account_id, 40_000))
                .unwrap();
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);

        delete_project_contribution(&conn, contribution.id).unwrap();
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
    }

    #[test]
    fn saved_total_sums_contributions_from_different_accounts() {
        let conn = projects_test_db();
        let first_account = insert_test_account(&conn, 500_000);
        let second_account = insert_test_account(&conn, 600_000);
        let project = insert_project(&conn, &create_input("Trip", 1_000_000)).unwrap();

        insert_project_contribution(
            &conn,
            &contribution_input(project.id, first_account, 30_000),
        )
        .unwrap();
        insert_project_contribution(
            &conn,
            &contribution_input(project.id, second_account, 12_500),
        )
        .unwrap();

        assert_eq!(get_project_saved_cents(&conn, project.id).unwrap(), 42_500);
    }

    #[test]
    fn get_project_saved_cents_returns_zero_without_contributions() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Fresh", 100_000)).unwrap();

        assert_eq!(get_project_saved_cents(&conn, project.id).unwrap(), 0);
    }

    #[test]
    fn get_project_saved_totals_includes_empty_projects_and_excludes_archived() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let funded = insert_project(&conn, &create_input("Funded", 500_000)).unwrap();
        let empty = insert_project(&conn, &create_input("Empty", 500_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 500_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(funded.id, account_id, 15_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(archived.id, account_id, 99_000))
            .unwrap();
        archive_project(&conn, archived.id).unwrap();

        let totals = get_project_saved_totals(&conn).unwrap();

        let saved_for = |project_id: i64| {
            totals
                .iter()
                .find(|total| total.project_id == project_id)
                .map(|total| total.saved_cents)
        };
        assert_eq!(saved_for(funded.id), Some(15_000));
        assert_eq!(saved_for(empty.id), Some(0));
        assert_eq!(saved_for(archived.id), None);
    }

    #[test]
    fn delete_project_contribution_returns_row_and_lowers_saved_total() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 700_000);
        let project = insert_project(&conn, &create_input("Boat", 1_000_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 10_000))
            .unwrap();
        let removed =
            insert_project_contribution(&conn, &contribution_input(project.id, account_id, 22_000))
                .unwrap();

        let deleted = delete_project_contribution(&conn, removed.id).unwrap();

        assert_eq!(deleted.id, removed.id);
        assert_eq!(deleted.project_id, project.id);
        assert_eq!(deleted.account_id, account_id);
        assert_eq!(deleted.amount_cents, 22_000);
        assert_eq!(get_project_saved_cents(&conn, project.id).unwrap(), 10_000);
    }

    #[test]
    fn delete_project_contribution_on_missing_id_errors() {
        let conn = projects_test_db();

        assert!(delete_project_contribution(&conn, 999).is_err());
    }

    #[test]
    fn insert_project_contribution_rejects_non_positive_amount_without_writing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Sofa", 200_000)).unwrap();

        for amount in [0, -5_000] {
            let error =
                insert_project_contribution(&conn, &contribution_input(project.id, account_id, amount))
                    .unwrap_err();
            expect_validation_field(error, "amount_cents");
        }

        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn insert_project_contribution_rejects_blank_date() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Desk", 200_000)).unwrap();

        let mut input = contribution_input(project.id, account_id, 5_000);
        input.date = "   ".to_string();

        expect_validation_field(
            insert_project_contribution(&conn, &input).unwrap_err(),
            "date",
        );
        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn insert_project_contribution_rejects_unknown_account_and_project() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Bike", 200_000)).unwrap();

        expect_validation_field(
            insert_project_contribution(&conn, &contribution_input(project.id, 4_242, 5_000))
                .unwrap_err(),
            "account_id",
        );
        expect_validation_field(
            insert_project_contribution(&conn, &contribution_input(4_242, account_id, 5_000))
                .unwrap_err(),
            "project_id",
        );

        archive_project(&conn, project.id).unwrap();
        expect_validation_field(
            insert_project_contribution(&conn, &contribution_input(project.id, account_id, 5_000))
                .unwrap_err(),
            "project_id",
        );

        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn insert_project_contribution_allows_suggested_and_rejects_unknown_source() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Camera", 200_000)).unwrap();

        let mut suggested = contribution_input(project.id, account_id, 7_000);
        suggested.source = "suggested".to_string();
        let stored = insert_project_contribution(&conn, &suggested).unwrap();
        assert_eq!(stored.source, "suggested");

        let mut invalid = contribution_input(project.id, account_id, 7_000);
        invalid.source = "auto".to_string();
        expect_validation_field(
            insert_project_contribution(&conn, &invalid).unwrap_err(),
            "source",
        );
    }

    #[test]
    fn get_project_contributions_scopes_to_project_newest_first() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Fence", 400_000)).unwrap();
        let other = insert_project(&conn, &create_input("Other", 400_000)).unwrap();

        let mut older = contribution_input(project.id, account_id, 1_000);
        older.date = "2026-01-05".to_string();
        let older = insert_project_contribution(&conn, &older).unwrap();

        let mut newer = contribution_input(project.id, account_id, 2_000);
        newer.date = "2026-03-09".to_string();
        let newer = insert_project_contribution(&conn, &newer).unwrap();

        insert_project_contribution(&conn, &contribution_input(other.id, account_id, 9_000))
            .unwrap();

        let rows = get_project_contributions(&conn, project.id).unwrap();

        assert_eq!(
            rows.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![newer.id, older.id]
        );
    }

    fn insert_contribution_direct(
        conn: &Connection,
        project_id: i64,
        account_id: i64,
        amount_cents: i64,
    ) {
        conn.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, ?2, ?3, 'manual', '2026-08-01')",
            params![project_id, account_id, amount_cents],
        )
        .unwrap();
    }

    fn assert_sums_to_balance(breakdown: &AccountEarmarkBreakdown) {
        let segment_total: i64 = breakdown
            .segments
            .iter()
            .map(|segment| segment.earmarked_cents)
            .sum();
        assert_eq!(
            segment_total + breakdown.unallocated_cents,
            breakdown.balance_cents,
            "segments + unallocated must account for every cent of the balance"
        );
    }

    #[test]
    fn earmark_breakdown_splits_balance_across_projects_and_unallocated() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_000_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 2_000_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 500_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(kitchen.id, account_id, 300_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(trip.id, account_id, 100_000))
            .unwrap();

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(breakdown.account_id, account_id);
        assert_eq!(breakdown.balance_cents, 1_000_000);
        assert_eq!(breakdown.segments.len(), 2);
        assert_eq!(breakdown.earmarked_cents, 400_000);
        assert_eq!(breakdown.unallocated_cents, 600_000);
        assert_sums_to_balance(&breakdown);

        assert_eq!(breakdown.segments[0].project_id, kitchen.id);
        assert_eq!(breakdown.segments[0].project_name, "Kitchen");
        assert_eq!(breakdown.segments[0].earmarked_cents, 300_000);
        assert_eq!(breakdown.segments[1].project_id, trip.id);
        assert_eq!(breakdown.segments[1].earmarked_cents, 100_000);
    }

    #[test]
    fn earmark_breakdown_collapses_repeat_contributions_into_one_segment() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Roof", 800_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 15_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 5_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 2_500))
            .unwrap();

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(breakdown.segments.len(), 1);
        assert_eq!(breakdown.segments[0].earmarked_cents, 22_500);
        assert_eq!(breakdown.earmarked_cents, 22_500);
        assert_sums_to_balance(&breakdown);
    }

    #[test]
    fn earmark_breakdown_without_contributions_is_all_unallocated() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 640_000);

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert!(breakdown.segments.is_empty());
        assert_eq!(breakdown.earmarked_cents, 0);
        assert_eq!(breakdown.unallocated_cents, 640_000);
        assert_sums_to_balance(&breakdown);
    }

    #[test]
    fn earmark_breakdown_excludes_other_accounts_contributions() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let other_account = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Shared goal", 900_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 20_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(project.id, other_account, 70_000))
            .unwrap();

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(breakdown.segments.len(), 1);
        assert_eq!(breakdown.segments[0].earmarked_cents, 20_000);
        assert_eq!(breakdown.unallocated_cents, 480_000);
        assert_sums_to_balance(&breakdown);
    }

    #[test]
    fn earmark_breakdown_reports_negative_unallocated_when_over_earmarked() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 100_000);
        let project = insert_project(&conn, &create_input("Ambitious", 900_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 250_000))
            .unwrap();

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(breakdown.earmarked_cents, 250_000);
        assert_eq!(breakdown.unallocated_cents, -150_000);
        assert!(breakdown.unallocated_cents < 0);
        assert_sums_to_balance(&breakdown);
    }

    #[test]
    fn earmark_breakdown_keeps_archived_project_segments() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 700_000);
        let active = insert_project(&conn, &create_input("Active", 500_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 500_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(active.id, account_id, 60_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(archived.id, account_id, 40_000))
            .unwrap();
        archive_project(&conn, archived.id).unwrap();

        let breakdown = get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(breakdown.segments.len(), 2);
        assert!(breakdown
            .segments
            .iter()
            .any(|segment| segment.project_id == archived.id && segment.earmarked_cents == 40_000));
        assert_eq!(breakdown.earmarked_cents, 100_000);
        assert_sums_to_balance(&breakdown);
    }

    #[test]
    fn earmark_breakdown_on_unknown_account_is_a_field_scoped_validation_error() {
        let conn = projects_test_db();

        expect_validation_field(
            get_account_earmark_breakdown(&conn, 4_242).unwrap_err(),
            "account_id",
        );
    }

    #[test]
    fn earmark_breakdown_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let project = insert_project(&conn, &create_input("Fence", 400_000)).unwrap();
        insert_contribution_direct(&conn, project.id, account_id, 30_000);

        let contributions_before = contribution_count(&conn);
        let projects_before = project_count(&conn);

        get_account_earmark_breakdown(&conn, account_id).unwrap();

        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(project_count(&conn), projects_before);
    }

    fn insert_typed_account(
        conn: &Connection,
        name: &str,
        account_type: &str,
        balance_cents: i64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, currency, balance_cents)
             VALUES (?1, 'RBC', ?2, 'CAD', ?3)",
            params![name, account_type, balance_cents],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn liquid_headroom_ranks_every_liquid_account_by_unallocated_cash() {
        let conn = projects_test_db();
        let chequing = insert_typed_account(&conn, "Everyday", "chequing", 400_000);
        let savings = insert_typed_account(&conn, "Rainy day", "savings", 1_000_000);
        let project = insert_project(&conn, &create_input("Kitchen", 2_000_000)).unwrap();
        insert_contribution_direct(&conn, project.id, savings, 100_000);

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(headroom.len(), 2);
        assert_eq!(headroom[0].account_id, savings);
        assert_eq!(headroom[0].account_name, "Rainy day");
        assert_eq!(headroom[0].account_type, "savings");
        assert_eq!(headroom[0].unallocated_cents, 900_000);
        assert_eq!(headroom[1].account_id, chequing);
        assert_eq!(headroom[1].unallocated_cents, 400_000);
    }

    #[test]
    fn liquid_headroom_counts_an_untouched_account_as_fully_available() {
        let conn = projects_test_db();
        let account_id = insert_typed_account(&conn, "Everyday", "chequing", 640_000);

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(headroom.len(), 1);
        assert_eq!(headroom[0].account_id, account_id);
        assert_eq!(headroom[0].unallocated_cents, 640_000);
    }

    #[test]
    fn liquid_headroom_aggregates_contributions_across_every_project() {
        let conn = projects_test_db();
        let account_id = insert_typed_account(&conn, "Rainy day", "savings", 500_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 900_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 300_000)).unwrap();
        insert_contribution_direct(&conn, kitchen.id, account_id, 120_000);
        insert_contribution_direct(&conn, trip.id, account_id, 80_000);

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(headroom.len(), 1);
        assert_eq!(headroom[0].unallocated_cents, 300_000);
    }

    #[test]
    fn liquid_headroom_drops_a_fully_or_over_earmarked_account() {
        let conn = projects_test_db();
        let exact = insert_typed_account(&conn, "Exact", "chequing", 200_000);
        let over = insert_typed_account(&conn, "Over", "savings", 200_000);
        let project = insert_project(&conn, &create_input("Roof", 900_000)).unwrap();
        insert_contribution_direct(&conn, project.id, exact, 200_000);
        insert_contribution_direct(&conn, project.id, over, 250_000);

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert!(headroom.is_empty());
    }

    #[test]
    fn liquid_headroom_still_counts_an_archived_projects_claim() {
        let conn = projects_test_db();
        let account_id = insert_typed_account(&conn, "Rainy day", "savings", 500_000);
        let archived = insert_project(&conn, &create_input("Paused", 400_000)).unwrap();
        insert_contribution_direct(&conn, archived.id, account_id, 200_000);
        archive_project(&conn, archived.id).unwrap();

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(headroom[0].unallocated_cents, 300_000);
    }

    #[test]
    fn liquid_headroom_excludes_every_non_liquid_account_type() {
        let conn = projects_test_db();
        for account_type in [
            "credit_card",
            "tfsa",
            "rrsp",
            "fhsa",
            "non_registered",
            "crypto",
        ] {
            insert_typed_account(&conn, account_type, account_type, 1_000_000);
        }
        let chequing = insert_typed_account(&conn, "Everyday", "chequing", 100_000);

        let headroom = get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(headroom.len(), 1);
        assert_eq!(headroom[0].account_id, chequing);
        for row in &headroom {
            assert!(
                row.account_type == "chequing" || row.account_type == "savings",
                "leaked account type {}",
                row.account_type
            );
        }
    }

    #[test]
    fn liquid_headroom_on_empty_database_is_empty() {
        let conn = projects_test_db();

        assert!(get_liquid_account_headroom(&conn).unwrap().is_empty());
    }

    #[test]
    fn liquid_headroom_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_typed_account(&conn, "Everyday", "chequing", 1_234_567);
        let project = insert_project(&conn, &create_input("Fence", 400_000)).unwrap();
        insert_contribution_direct(&conn, project.id, account_id, 30_000);

        let contributions_before = contribution_count(&conn);
        let projects_before = project_count(&conn);

        get_liquid_account_headroom(&conn).unwrap();

        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(project_count(&conn), projects_before);
    }

    #[test]
    fn savings_summary_on_empty_database_is_all_zeros() {
        let conn = projects_test_db();

        let summary = get_savings_projects_summary(&conn).unwrap();

        assert_eq!(summary.active_project_count, 0);
        assert_eq!(summary.total_saved_cents, 0);
        assert_eq!(summary.total_target_cents, 0);
    }

    #[test]
    fn savings_summary_sums_contributions_of_one_project() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 25_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(project.id, account_id, 17_500))
            .unwrap();

        let summary = get_savings_projects_summary(&conn).unwrap();

        assert_eq!(summary.active_project_count, 1);
        assert_eq!(summary.total_saved_cents, 42_500);
        assert_eq!(summary.total_target_cents, 1_500_000);
    }

    #[test]
    fn savings_summary_spans_multiple_projects() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 300_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(kitchen.id, account_id, 60_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(trip.id, account_id, 15_000))
            .unwrap();

        let summary = get_savings_projects_summary(&conn).unwrap();

        assert_eq!(summary.active_project_count, 2);
        assert_eq!(summary.total_saved_cents, 75_000);
        assert_eq!(summary.total_target_cents, 800_000);
    }

    #[test]
    fn savings_summary_counts_project_without_contributions() {
        let conn = projects_test_db();
        insert_project(&conn, &create_input("Fresh goal", 200_000)).unwrap();

        let summary = get_savings_projects_summary(&conn).unwrap();

        assert_eq!(summary.active_project_count, 1);
        assert_eq!(summary.total_saved_cents, 0);
        assert_eq!(summary.total_target_cents, 200_000);
    }

    // The load-bearing test: it is the only thing distinguishing this rollup from the earmark
    // breakdown, which deliberately keeps archived projects.
    #[test]
    fn savings_summary_excludes_archived_projects_from_every_figure() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let active = insert_project(&conn, &create_input("Active", 500_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 300_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(active.id, account_id, 60_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(archived.id, account_id, 40_000))
            .unwrap();

        let before = get_savings_projects_summary(&conn).unwrap();
        assert_eq!(before.active_project_count, 2);
        assert_eq!(before.total_saved_cents, 100_000);
        assert_eq!(before.total_target_cents, 800_000);

        archive_project(&conn, archived.id).unwrap();

        let after = get_savings_projects_summary(&conn).unwrap();
        assert_eq!(after.active_project_count, 1);
        assert_eq!(after.total_saved_cents, 60_000);
        assert_eq!(after.total_target_cents, 500_000);
    }

    #[test]
    fn savings_summary_counts_multi_account_contributions_once() {
        let conn = projects_test_db();
        let first_account = insert_test_account(&conn, 500_000);
        let second_account = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Shared goal", 900_000)).unwrap();

        insert_project_contribution(&conn, &contribution_input(project.id, first_account, 20_000))
            .unwrap();
        insert_project_contribution(&conn, &contribution_input(project.id, second_account, 70_000))
            .unwrap();

        let summary = get_savings_projects_summary(&conn).unwrap();

        assert_eq!(summary.active_project_count, 1);
        assert_eq!(summary.total_saved_cents, 90_000);
        assert_eq!(summary.total_target_cents, 900_000);
    }

    // `projects_test_db()` sets `PRAGMA foreign_keys=ON`; production gets it from
    // `db::open_configured`. Without the pragma every FK below is inert and these tests would pass
    // vacuously, so the pragma is asserted, not assumed.
    fn assert_foreign_keys_enforced(conn: &Connection) {
        let enabled: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(enabled, 1, "foreign key enforcement must be on");
    }

    fn account_count(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn contribution_count_for_account(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM project_contributions WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn account_delete_is_refused_by_the_contribution_foreign_key() {
        let conn = projects_test_db();
        assert_foreign_keys_enforced(&conn);
        let account_id = insert_test_account(&conn, 1_234_567);
        let project = insert_project(&conn, &create_input("Car", 1_500_000)).unwrap();
        insert_contribution_direct(&conn, project.id, account_id, 25_000);

        let error = conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .unwrap_err();

        // The error code, never the message: SQLite's wording is not a stable contract.
        match error {
            rusqlite::Error::SqliteFailure(err, _) => {
                assert_eq!(err.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected a constraint violation, got {other:?}"),
        }

        // AC #5: a refused delete leaves the account, its contributions and its balance untouched.
        assert_eq!(account_count(&conn, account_id), 1);
        assert_eq!(contribution_count_for_account(&conn, account_id), 1);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
    }

    #[test]
    fn account_delete_is_untouched_when_nothing_was_contributed() {
        let conn = projects_test_db();
        assert_foreign_keys_enforced(&conn);
        let account_id = insert_test_account(&conn, 500_000);
        insert_project(&conn, &create_input("Car", 1_500_000)).unwrap();

        let rows = conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .unwrap();

        assert_eq!(rows, 1);
        assert_eq!(account_count(&conn, account_id), 0);
    }

    // The documented escape route: remove the project, its contributions cascade away, and the
    // account becomes deletable again. If this ever stops working the user is stuck.
    #[test]
    fn deleting_the_project_cascades_contributions_and_unblocks_the_account() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Car", 1_500_000)).unwrap();
        insert_contribution_direct(&conn, project.id, account_id, 25_000);

        conn.execute("DELETE FROM projects WHERE id = ?1", params![project.id])
            .unwrap();

        assert_eq!(contribution_count_for_account(&conn, account_id), 0);
        assert_eq!(
            conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
                .unwrap(),
            1
        );
    }

    #[test]
    fn funded_project_names_is_empty_for_an_account_that_funds_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        insert_project(&conn, &create_input("Car", 1_500_000)).unwrap();

        assert!(get_project_names_funded_by_account(&conn, account_id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn funded_project_names_deduplicates_repeat_contributions() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_contribution_direct(&conn, project.id, account_id, 10_000);
        insert_contribution_direct(&conn, project.id, account_id, 20_000);
        insert_contribution_direct(&conn, project.id, account_id, 30_000);

        assert_eq!(
            get_project_names_funded_by_account(&conn, account_id).unwrap(),
            vec!["Kitchen".to_string()]
        );
    }

    #[test]
    fn funded_project_names_are_alphabetical() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let vacation = insert_project(&conn, &create_input("Vacation", 500_000)).unwrap();
        let car = insert_project(&conn, &create_input("Car", 500_000)).unwrap();

        insert_contribution_direct(&conn, vacation.id, account_id, 10_000);
        insert_contribution_direct(&conn, car.id, account_id, 20_000);

        assert_eq!(
            get_project_names_funded_by_account(&conn, account_id).unwrap(),
            vec!["Car".to_string(), "Vacation".to_string()]
        );
    }

    // AC #6, and the guard-versus-foreign-key agreement proof: `ON DELETE RESTRICT` does not know
    // what `archived_at` means, so neither may the guard.
    #[test]
    fn funded_project_names_include_archived_projects() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let archived = insert_project(&conn, &create_input("Archived goal", 500_000)).unwrap();
        insert_contribution_direct(&conn, archived.id, account_id, 40_000);
        archive_project(&conn, archived.id).unwrap();

        assert_eq!(
            get_project_names_funded_by_account(&conn, account_id).unwrap(),
            vec!["Archived goal".to_string()]
        );
        assert!(conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .is_err());
    }

    #[test]
    fn funded_project_names_exclude_another_accounts_contributions() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 500_000);
        let other_account = insert_test_account(&conn, 500_000);
        let project = insert_project(&conn, &create_input("Shared goal", 900_000)).unwrap();

        insert_contribution_direct(&conn, project.id, other_account, 20_000);

        assert!(get_project_names_funded_by_account(&conn, account_id)
            .unwrap()
            .is_empty());
        assert_eq!(
            get_project_names_funded_by_account(&conn, other_account).unwrap(),
            vec!["Shared goal".to_string()]
        );
    }

    #[test]
    fn savings_summary_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let project = insert_project(&conn, &create_input("Fence", 400_000)).unwrap();
        insert_contribution_direct(&conn, project.id, account_id, 30_000);

        let contributions_before = contribution_count(&conn);
        let projects_before = project_count(&conn);

        get_savings_projects_summary(&conn).unwrap();

        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(project_count(&conn), projects_before);
    }

    fn active_order(conn: &Connection) -> Vec<i64> {
        get_active_projects(conn)
            .unwrap()
            .iter()
            .map(|project| project.id)
            .collect()
    }

    fn active_priorities(conn: &Connection) -> Vec<i32> {
        get_active_projects(conn)
            .unwrap()
            .iter()
            .map(|project| project.priority)
            .collect()
    }

    fn set_priority_direct(conn: &Connection, id: i64, priority: i32) {
        conn.execute(
            "UPDATE projects SET priority = ?1 WHERE id = ?2",
            params![priority, id],
        )
        .unwrap();
    }

    fn three_projects(conn: &Connection) -> (i64, i64, i64) {
        let first = insert_project(conn, &create_input("First", 100_000)).unwrap();
        let second = insert_project(conn, &create_input("Second", 200_000)).unwrap();
        let third = insert_project(conn, &create_input("Third", 300_000)).unwrap();
        (first.id, second.id, third.id)
    }

    #[test]
    fn reorder_projects_rewrites_priorities_in_the_submitted_order() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);

        reorder_projects(&conn, &[third, first, second]).unwrap();

        assert_eq!(active_order(&conn), vec![third, first, second]);
        assert_eq!(active_priorities(&conn), vec![0, 1, 2]);
    }

    #[test]
    fn reorder_projects_reports_only_the_projects_whose_priority_changed() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);

        let changes = reorder_projects(&conn, &[first, third, second]).unwrap();

        assert_eq!(
            changes
                .iter()
                .map(|change| change.project_id)
                .collect::<Vec<_>>(),
            vec![third, second]
        );
        for change in &changes {
            assert!(change.old_json.contains("\"priority\""));
            assert!(change.new_json.contains("\"priority\""));
            assert_ne!(change.old_json, change.new_json);
        }
    }

    #[test]
    fn reorder_projects_normalises_sparse_priorities_to_a_dense_range() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);
        set_priority_direct(&conn, first, 0);
        set_priority_direct(&conn, second, 5);
        set_priority_direct(&conn, third, 9);

        reorder_projects(&conn, &[second, third, first]).unwrap();

        assert_eq!(active_priorities(&conn), vec![0, 1, 2]);
        assert_eq!(active_order(&conn), vec![second, third, first]);
    }

    #[test]
    fn reorder_projects_on_a_single_project_is_a_no_op() {
        let conn = projects_test_db();
        let only = insert_project(&conn, &create_input("Only", 100_000)).unwrap();

        let changes = reorder_projects(&conn, &[only.id]).unwrap();

        assert!(changes.is_empty());
        assert_eq!(active_priorities(&conn), vec![0]);
    }

    #[test]
    fn reorder_projects_rejects_a_missing_id_without_writing() {
        let conn = projects_test_db();
        let (first, second, _third) = three_projects(&conn);
        let before = active_order(&conn);

        expect_validation_field(
            reorder_projects(&conn, &[second, first]).unwrap_err(),
            "project_ids",
        );
        assert_eq!(active_order(&conn), before);
    }

    #[test]
    fn reorder_projects_rejects_an_unknown_id_without_writing() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);
        let before = active_order(&conn);

        expect_validation_field(
            reorder_projects(&conn, &[first, second, third, 4_242]).unwrap_err(),
            "project_ids",
        );
        assert_eq!(active_order(&conn), before);
    }

    #[test]
    fn reorder_projects_rejects_a_duplicate_id_without_writing() {
        let conn = projects_test_db();
        let (first, second, _third) = three_projects(&conn);
        let before = active_order(&conn);

        expect_validation_field(
            reorder_projects(&conn, &[first, second, second]).unwrap_err(),
            "project_ids",
        );
        assert_eq!(active_order(&conn), before);
    }

    #[test]
    fn reorder_projects_rejects_an_archived_id_without_writing() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);
        archive_project(&conn, third).unwrap();
        let before = active_order(&conn);

        expect_validation_field(
            reorder_projects(&conn, &[first, second, third]).unwrap_err(),
            "project_ids",
        );
        assert_eq!(active_order(&conn), before);
    }

    #[test]
    fn reorder_projects_rejects_an_empty_list() {
        let conn = projects_test_db();
        three_projects(&conn);
        let before = active_order(&conn);

        expect_validation_field(reorder_projects(&conn, &[]).unwrap_err(), "project_ids");
        assert_eq!(active_order(&conn), before);
    }

    #[test]
    fn reorder_projects_leaves_archived_priorities_untouched() {
        let conn = projects_test_db();
        let (first, second, third) = three_projects(&conn);
        archive_project(&conn, third).unwrap();
        let archived_priority_before: i32 = conn
            .query_row(
                "SELECT priority FROM projects WHERE id = ?1",
                params![third],
                |row| row.get(0),
            )
            .unwrap();

        reorder_projects(&conn, &[second, first]).unwrap();

        let archived_priority_after: i32 = conn
            .query_row(
                "SELECT priority FROM projects WHERE id = ?1",
                params![third],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(archived_priority_after, archived_priority_before);
    }

    #[test]
    fn reorder_projects_never_moves_account_balances() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let (first, second, third) = three_projects(&conn);

        reorder_projects(&conn, &[third, second, first]).unwrap();

        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
    }

    fn priority_checksum(conn: &Connection) -> (i64, i64) {
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(priority), 0) FROM projects",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn allocation_projects_exclude_archived_and_sum_contributions() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 300_000)).unwrap();

        insert_contribution_direct(&conn, kitchen.id, account_id, 25_000);
        insert_contribution_direct(&conn, kitchen.id, account_id, 17_500);
        insert_contribution_direct(&conn, trip.id, account_id, 60_000);
        insert_contribution_direct(&conn, archived.id, account_id, 99_000);
        archive_project(&conn, archived.id).unwrap();

        let projects = get_active_allocation_projects(&conn).unwrap();

        assert_eq!(
            projects
                .iter()
                .map(|project| project.project_id)
                .collect::<Vec<_>>(),
            vec![kitchen.id, trip.id]
        );
        assert_eq!(projects[0].name, "Kitchen");
        assert_eq!(projects[0].priority, 0);
        assert_eq!(projects[0].target_cents, 1_500_000);
        assert_eq!(projects[0].saved_cents, 42_500);
        assert_eq!(projects[1].saved_cents, 60_000);
    }

    #[test]
    fn allocation_projects_report_zero_saved_without_contributions() {
        let conn = projects_test_db();
        let mut dated = create_input("Fresh", 200_000);
        dated.target_date = Some("2027-03-01".to_string());
        let fresh = insert_project(&conn, &dated).unwrap();

        let projects = get_active_allocation_projects(&conn).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_id, fresh.id);
        assert_eq!(projects[0].saved_cents, 0);
        assert_eq!(projects[0].target_date, Some("2027-03-01".to_string()));
    }

    fn insert_dated_contribution(
        conn: &Connection,
        project_id: i64,
        account_id: i64,
        amount_cents: i64,
        date: &str,
    ) {
        conn.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, ?2, ?3, 'manual', ?4)",
            params![project_id, account_id, amount_cents, date],
        )
        .unwrap();
    }

    fn backdate_project_creation(conn: &Connection, project_id: i64, created_at: &str) {
        conn.execute(
            "UPDATE projects SET created_at = ?1 WHERE id = ?2",
            params![created_at, project_id],
        )
        .unwrap();
    }

    #[test]
    fn pace_inputs_report_zero_sums_for_a_project_without_contributions() {
        let conn = projects_test_db();
        let mut dated = create_input("Fresh", 200_000);
        dated.target_date = Some("2027-03-01".to_string());
        let fresh = insert_project(&conn, &dated).unwrap();

        let rows = get_active_project_pace_inputs(&conn, "2026-05-12").unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].project_id, fresh.id);
        assert_eq!(rows[0].target_cents, 200_000);
        assert_eq!(rows[0].target_date, Some("2027-03-01".to_string()));
        assert_eq!(rows[0].saved_cents, 0);
        assert_eq!(rows[0].recent_cents, 0);
    }

    // The "too new to judge" gate reads `created_at` off this row, so the column must arrive
    // unmodified and parseable — a truncated or reformatted value would silently disable the gate.
    #[test]
    fn pace_inputs_carry_the_creation_timestamp_the_too_new_gate_reads() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Brand new", 200_000)).unwrap();
        backdate_project_creation(&conn, project.id, "2026-08-01 09:30:00");

        let rows = get_active_project_pace_inputs(&conn, "2026-05-12").unwrap();

        assert_eq!(rows[0].created_at, "2026-08-01 09:30:00");
        assert_eq!(rows[0].saved_cents, 0);
    }

    #[test]
    fn pace_inputs_exclude_older_rows_from_the_recent_window_but_not_from_saved() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_dated_contribution(&conn, project.id, account_id, 100_000, "2025-12-31");
        insert_dated_contribution(&conn, project.id, account_id, 200_000, "2026-05-11");
        insert_dated_contribution(&conn, project.id, account_id, 30_000, "2026-05-12");
        insert_dated_contribution(&conn, project.id, account_id, 70_000, "2026-08-01");

        let rows = get_active_project_pace_inputs(&conn, "2026-05-12").unwrap();

        assert_eq!(rows[0].saved_cents, 400_000);
        // Inclusive on the boundary date, exclusive of everything before it.
        assert_eq!(rows[0].recent_cents, 100_000);
    }

    #[test]
    fn pace_inputs_exclude_archived_projects_and_order_by_priority() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();
        let archived = insert_project(&conn, &create_input("Archived", 300_000)).unwrap();
        insert_dated_contribution(&conn, archived.id, account_id, 99_000, "2026-08-01");
        archive_project(&conn, archived.id).unwrap();

        let rows = get_active_project_pace_inputs(&conn, "2026-05-12").unwrap();

        assert_eq!(
            rows.iter().map(|row| row.project_id).collect::<Vec<_>>(),
            vec![kitchen.id, trip.id]
        );
    }

    // The pace read is the second consumer of NFR4's read/write separation: repeated reads must not
    // touch a row, and the same inputs must produce the same statuses every time.
    #[test]
    fn repeated_pace_reads_write_nothing_and_stay_identical() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let mut dated = create_input("Trip", 400_000);
        dated.target_date = Some("2027-02-12".to_string());
        let trip = insert_project(&conn, &dated).unwrap();
        insert_dated_contribution(&conn, trip.id, account_id, 60_000, "2026-08-01");

        let contributions_before = contribution_count(&conn);
        let projects_before = priority_checksum(&conn);

        let mut results = Vec::new();
        for _ in 0..5 {
            let rows = get_active_project_pace_inputs(&conn, "2026-05-12").unwrap();
            results.push(
                rows.iter()
                    .map(|project| {
                        compute_project_pace(&PaceInput {
                            today: "2026-08-12",
                            project,
                        })
                    })
                    .collect::<Vec<_>>(),
            );
        }

        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(priority_checksum(&conn), projects_before);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);

        assert_eq!(results[0].len(), 1);
        for result in &results {
            assert_eq!(result, &results[0]);
        }
    }

    // NFR4 in executable form: the suggestion path is a pure query, so five round trips through the
    // read plus the algorithm must leave the row counts, the priority checksum and the account
    // balance exactly as they were — and must return the identical answer every time.
    #[test]
    fn repeated_suggestion_reads_write_nothing_and_stay_identical() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let mut dated = create_input("Trip", 400_000);
        dated.target_date = Some("2026-11-11".to_string());
        let trip = insert_project(&conn, &dated).unwrap();
        insert_contribution_direct(&conn, kitchen.id, account_id, 25_000);
        insert_contribution_direct(&conn, trip.id, account_id, 60_000);

        let contributions_before = contribution_count(&conn);
        let projects_before = priority_checksum(&conn);

        let mut results = Vec::new();
        for _ in 0..5 {
            let projects = get_active_allocation_projects(&conn).unwrap();
            results.push(compute_suggested_allocation(&AllocationInput {
                current_step: WaterfallStep::ContributeRegisteredAccounts,
                avg_monthly_surplus_cents: 300_000,
                today: "2026-08-11".to_string(),
                projects,
            }));
        }

        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(priority_checksum(&conn), projects_before);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);

        assert_eq!(results.len(), 5);
        assert!(!results[0].is_empty());
        for result in &results {
            assert_eq!(result, &results[0]);
        }
    }

    fn allocation_input(
        project_id: i64,
        account_id: i64,
        amount_cents: i64,
    ) -> ProjectAllocationInput {
        ProjectAllocationInput {
            project_id,
            account_id,
            amount_cents,
            date: "2026-08-11".to_string(),
        }
    }

    fn sources(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT source FROM project_contributions ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn confirming_three_entries_creates_three_suggested_rows() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();
        let boat = insert_project(&conn, &create_input("Boat", 800_000)).unwrap();

        let created = insert_suggested_contributions(
            &conn,
            &[
                allocation_input(kitchen.id, account_id, 30_000),
                allocation_input(trip.id, account_id, 20_000),
                allocation_input(boat.id, account_id, 1),
            ],
        )
        .unwrap();

        assert_eq!(created.len(), 3);
        assert_eq!(contribution_count(&conn), 3);
        assert_eq!(sources(&conn), vec!["suggested"; 3]);
        assert_eq!(
            created
                .iter()
                .map(|row| (row.project_id, row.amount_cents))
                .collect::<Vec<_>>(),
            vec![(kitchen.id, 30_000), (trip.id, 20_000), (boat.id, 1)]
        );
        assert_eq!(get_project_saved_cents(&conn, kitchen.id).unwrap(), 30_000);
        assert_eq!(get_project_saved_cents(&conn, trip.id).unwrap(), 20_000);
        assert_eq!(created[0].date, "2026-08-11");
    }

    // Zero means "skip this project", so it is filtered before validation rather than rejected the
    // way `insert_project_contribution` rejects a non-positive manual amount.
    #[test]
    fn a_zero_entry_among_three_creates_only_the_two_funded_rows() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let skipped = insert_project(&conn, &create_input("Skipped", 400_000)).unwrap();
        let boat = insert_project(&conn, &create_input("Boat", 800_000)).unwrap();

        let created = insert_suggested_contributions(
            &conn,
            &[
                allocation_input(kitchen.id, account_id, 30_000),
                allocation_input(skipped.id, account_id, 0),
                allocation_input(boat.id, account_id, 5_000),
            ],
        )
        .unwrap();

        assert_eq!(created.len(), 2);
        assert_eq!(contribution_count(&conn), 2);
        assert_eq!(get_project_saved_cents(&conn, skipped.id).unwrap(), 0);
    }

    #[test]
    fn confirming_nothing_is_a_no_op_rather_than_an_error() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        assert!(insert_suggested_contributions(&conn, &[])
            .unwrap()
            .is_empty());
        assert!(insert_suggested_contributions(
            &conn,
            &[
                allocation_input(project.id, account_id, 0),
                allocation_input(project.id, account_id, 0),
            ]
        )
        .unwrap()
        .is_empty());

        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn confirming_a_negative_amount_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        expect_validation_field(
            insert_suggested_contributions(&conn, &[allocation_input(project.id, account_id, -1)])
                .unwrap_err(),
            "amount_cents",
        );
        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn confirming_the_same_project_twice_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        expect_validation_field(
            insert_suggested_contributions(
                &conn,
                &[
                    allocation_input(project.id, account_id, 10_000),
                    allocation_input(project.id, account_id, 5_000),
                ],
            )
            .unwrap_err(),
            "project_id",
        );
        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn confirming_an_unknown_or_archived_project_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let archived = insert_project(&conn, &create_input("Archived", 400_000)).unwrap();
        archive_project(&conn, archived.id).unwrap();

        expect_validation_field(
            insert_suggested_contributions(&conn, &[allocation_input(4_242, account_id, 10_000)])
                .unwrap_err(),
            "project_id",
        );
        expect_validation_field(
            insert_suggested_contributions(
                &conn,
                &[allocation_input(archived.id, account_id, 10_000)],
            )
            .unwrap_err(),
            "project_id",
        );
        assert_eq!(contribution_count(&conn), 0);
    }

    // A pre-check, not a raw foreign-key failure: the user gets a field-scoped validation error
    // instead of "FOREIGN KEY constraint failed".
    #[test]
    fn confirming_an_unknown_account_writes_nothing() {
        let conn = projects_test_db();
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        expect_validation_field(
            insert_suggested_contributions(&conn, &[allocation_input(project.id, 4_242, 10_000)])
                .unwrap_err(),
            "account_id",
        );
        assert_eq!(contribution_count(&conn), 0);
    }

    #[test]
    fn confirming_a_malformed_date_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let project = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        for date in ["", "2026-13-45", "2026/08/11", "11-08-2026", "today"] {
            let mut entry = allocation_input(project.id, account_id, 10_000);
            entry.date = date.to_string();
            expect_validation_field(
                insert_suggested_contributions(&conn, &[entry]).unwrap_err(),
                "date",
            );
        }
        assert_eq!(contribution_count(&conn), 0);
    }

    // AC #5 in executable form: one bad entry at the end of the batch must leave the two valid
    // entries ahead of it unwritten, which is why every check runs before the transaction opens.
    #[test]
    fn one_invalid_entry_rolls_back_the_whole_batch() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();

        let error = insert_suggested_contributions(
            &conn,
            &[
                allocation_input(kitchen.id, account_id, 30_000),
                allocation_input(trip.id, account_id, 20_000),
                allocation_input(4_242, account_id, 10_000),
            ],
        )
        .unwrap_err();

        expect_validation_field(error, "project_id");
        assert_eq!(contribution_count(&conn), 0);
        assert_eq!(get_project_saved_cents(&conn, kitchen.id).unwrap(), 0);
        assert_eq!(get_project_saved_cents(&conn, trip.id).unwrap(), 0);
    }

    // PRD SC2 for the confirm path: earmarking labels money that is already in the account, so both
    // source accounts' balances are asserted literally across a successful multi-account confirm.
    #[test]
    fn confirming_never_moves_account_balances() {
        let conn = projects_test_db();
        let first_account = insert_test_account(&conn, 1_234_567);
        let second_account = insert_test_account(&conn, 765_432);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();

        let created = insert_suggested_contributions(
            &conn,
            &[
                allocation_input(kitchen.id, first_account, 30_000),
                allocation_input(trip.id, second_account, 20_000),
            ],
        )
        .unwrap();

        assert_eq!(created.len(), 2);
        assert_eq!(balance_cents(&conn, first_account), 1_234_567);
        assert_eq!(balance_cents(&conn, second_account), 765_432);
    }

    // NFR4 tie-back to Story 32.2, re-proved now that a write path exists beside the read: five round
    // trips through the suggestion query after a confirm must change no row and return one answer.
    #[test]
    fn the_suggestion_read_stays_inert_after_a_confirm_has_written_rows() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let mut dated = create_input("Trip", 400_000);
        dated.target_date = Some("2026-11-11".to_string());
        let trip = insert_project(&conn, &dated).unwrap();

        insert_suggested_contributions(
            &conn,
            &[
                allocation_input(kitchen.id, account_id, 25_000),
                allocation_input(trip.id, account_id, 60_000),
            ],
        )
        .unwrap();

        let contributions_before = contribution_count(&conn);
        let projects_before = priority_checksum(&conn);
        assert_eq!(contributions_before, 2);

        let mut results = Vec::new();
        for _ in 0..5 {
            let projects = get_active_allocation_projects(&conn).unwrap();
            results.push(compute_suggested_allocation(&AllocationInput {
                current_step: WaterfallStep::ContributeRegisteredAccounts,
                avg_monthly_surplus_cents: 300_000,
                today: "2026-08-11".to_string(),
                projects,
            }));
        }

        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(priority_checksum(&conn), projects_before);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
        assert_eq!(sources(&conn), vec!["suggested"; 2]);

        assert!(!results[0].is_empty());
        for result in &results {
            assert_eq!(result, &results[0]);
        }
    }

    fn insert_suggested_direct(
        conn: &Connection,
        project_id: i64,
        account_id: i64,
        amount_cents: i64,
        date: &str,
    ) {
        conn.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, ?2, ?3, 'suggested', ?4)",
            params![project_id, account_id, amount_cents, date],
        )
        .unwrap();
    }

    fn config_value(conn: &Connection, key: &str) -> Option<String> {
        config::get(conn, key)
    }

    #[test]
    fn no_suggested_rows_this_month_means_nothing_was_confirmed() {
        let conn = projects_test_db();

        assert_eq!(
            get_confirmed_suggestion_for_month(&conn, "2026-08").unwrap(),
            None
        );
    }

    #[test]
    fn a_confirmed_month_reports_its_total_project_count_and_newest_date() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        let trip = insert_project(&conn, &create_input("Trip", 400_000)).unwrap();

        insert_suggested_direct(&conn, kitchen.id, account_id, 30_000, "2026-08-02");
        insert_suggested_direct(&conn, trip.id, account_id, 20_000, "2026-08-11");

        assert_eq!(
            get_confirmed_suggestion_for_month(&conn, "2026-08").unwrap(),
            Some(ConfirmedSuggestionMonth {
                latest_date: "2026-08-11".to_string(),
                total_cents: 50_000,
                project_count: 2,
            })
        );
    }

    // Two rows for one project is one confirmed goal, not two: the count is what the receipt copy
    // interpolates, so a repeat contribution must not inflate it.
    #[test]
    fn repeat_suggested_rows_for_one_project_count_once() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_suggested_direct(&conn, kitchen.id, account_id, 10_000, "2026-08-02");
        insert_suggested_direct(&conn, kitchen.id, account_id, 5_000, "2026-08-09");

        let confirmed = get_confirmed_suggestion_for_month(&conn, "2026-08")
            .unwrap()
            .unwrap();

        assert_eq!(confirmed.project_count, 1);
        assert_eq!(confirmed.total_cents, 15_000);
    }

    // The cadence rule at the SQL level: a confirmation only settles its own month.
    #[test]
    fn a_confirmation_in_another_month_does_not_settle_this_one() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_suggested_direct(&conn, kitchen.id, account_id, 30_000, "2026-07-31");

        assert_eq!(
            get_confirmed_suggestion_for_month(&conn, "2026-08").unwrap(),
            None
        );
        assert!(get_confirmed_suggestion_for_month(&conn, "2026-07")
            .unwrap()
            .is_some());
    }

    // The source filter is the whole point: a manually logged contribution is not an answer to the
    // suggestion, so it must never settle the month.
    #[test]
    fn a_manual_contribution_this_month_does_not_settle_the_month() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();

        insert_contribution_direct(&conn, kitchen.id, account_id, 30_000);
        let manual_month = conn
            .query_row(
                "SELECT strftime('%Y-%m', date) FROM project_contributions",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        assert_eq!(
            get_confirmed_suggestion_for_month(&conn, &manual_month).unwrap(),
            None
        );
    }

    // Archived goals stay in the receipt: the money was earmarked, and hiding it would make the
    // total the user reads disagree with the ledger.
    #[test]
    fn a_confirmed_month_keeps_archived_projects_in_its_total() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 900_000);
        let archived = insert_project(&conn, &create_input("Archived", 400_000)).unwrap();

        insert_suggested_direct(&conn, archived.id, account_id, 12_500, "2026-08-03");
        archive_project(&conn, archived.id).unwrap();

        let confirmed = get_confirmed_suggestion_for_month(&conn, "2026-08")
            .unwrap()
            .unwrap();

        assert_eq!(confirmed.total_cents, 12_500);
        assert_eq!(confirmed.project_count, 1);
    }

    #[test]
    fn the_confirmed_month_read_writes_nothing() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        insert_suggested_direct(&conn, kitchen.id, account_id, 30_000, "2026-08-02");

        let contributions_before = contribution_count(&conn);

        get_confirmed_suggestion_for_month(&conn, "2026-08").unwrap();

        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
    }

    #[test]
    fn the_skip_marker_round_trips_through_config() {
        let conn = projects_test_db();

        assert_eq!(get_suggestion_skipped_month(&conn), None);

        set_suggestion_skipped_month(&conn, "2026-08").unwrap();

        assert_eq!(
            get_suggestion_skipped_month(&conn),
            Some("2026-08".to_string())
        );
        assert_eq!(
            config_value(&conn, SUGGESTION_SKIPPED_MONTH_CONFIG_KEY),
            Some("2026-08".to_string())
        );
    }

    #[test]
    fn setting_the_skip_marker_twice_overwrites_rather_than_duplicates() {
        let conn = projects_test_db();

        set_suggestion_skipped_month(&conn, "2026-08").unwrap();
        set_suggestion_skipped_month(&conn, "2026-09").unwrap();

        assert_eq!(
            get_suggestion_skipped_month(&conn),
            Some("2026-09".to_string())
        );
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn clearing_the_skip_marker_makes_the_month_unsettled_again() {
        let conn = projects_test_db();
        set_suggestion_skipped_month(&conn, "2026-08").unwrap();

        clear_suggestion_skipped_month(&conn).unwrap();

        assert_eq!(get_suggestion_skipped_month(&conn), None);
    }

    // The regression test the spec demands: a skip writes to `config` and to nothing else. At the
    // ledger level it must stay indistinguishable from never opening the panel.
    #[test]
    fn skipping_never_writes_a_project_contribution() {
        let conn = projects_test_db();
        let account_id = insert_test_account(&conn, 1_234_567);
        let kitchen = insert_project(&conn, &create_input("Kitchen", 1_500_000)).unwrap();
        insert_contribution_direct(&conn, kitchen.id, account_id, 30_000);

        let contributions_before = contribution_count(&conn);
        let projects_before = project_count(&conn);

        set_suggestion_skipped_month(&conn, "2026-08").unwrap();
        clear_suggestion_skipped_month(&conn).unwrap();
        set_suggestion_skipped_month(&conn, "2026-09").unwrap();

        assert_eq!(contribution_count(&conn), contributions_before);
        assert_eq!(project_count(&conn), projects_before);
        assert_eq!(balance_cents(&conn, account_id), 1_234_567);
        assert_eq!(
            get_confirmed_suggestion_for_month(&conn, "2026-09").unwrap(),
            None
        );
    }
}
