use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::Connection;
use tauri::State;

use crate::ai::{clone_provider, project_advice, AiState};
use crate::db::audit as audit_db;
use crate::db::budget as budget_db;
use crate::db::financial_health as financial_health_db;
use crate::db::projects as projects_db;
use crate::db::spending_trends as spending_trends_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    AccountEarmarkBreakdown, AccountHeadroom, BudgetCategoryStatus, CategoryCompareRow,
    CreateProjectContributionInput, CreateProjectInput, Project, ProjectAdviceRequest,
    ProjectAdviceResponse, ProjectAllocationInput, ProjectContribution, ProjectImage,
    ProjectImageMeta, ProjectPace, ProjectSavedTotal, ProjectThumbnail, SavingsProjectsSummary,
    SuggestedAllocationResponse, UpdateProjectInput,
};
use crate::projects::{allocation, image, pace, settlement};

// How many over-target categories the prompt may name. Two is the whole budget's worth of advice a
// person can act on this month; a longer list reads as a lecture and invites the model to pad.
const MAX_OVER_TARGET_CATEGORIES: usize = 2;

const MAX_SLACK_CATEGORIES: usize = 2;

const MAX_IDLE_CASH_ACCOUNTS: usize = 2;

// A structural safety margin, not a prompt instruction. Every idle-cash figure is halved before it
// reaches the model or the adjusted-rate arithmetic, so the model is never shown — and therefore can
// never recommend — more than half of what an account actually holds. This replaces the previous
// prompt-only "leave a buffer, especially for reserve-sounding names" rule, which the model applied
// only when a name happened to look like a reserve and ignored everywhere else. It applies uniformly
// to every liquid account regardless of its name. Integer division floors, which errs conservative.
const SAFE_TO_RECOMMEND_DIVISOR: i64 = 2;

// Matches the Trends screen's shortest window: a slack figure the advisory quotes must be one the
// user can go and see, and a longer window would average away the habit they'd have to change.
const SLACK_TREND_MONTHS: i32 = 3;


#[tauri::command(rename_all = "snake_case")]
pub fn create_project(
    state: State<DbState>,
    name: String,
    target_cents: i64,
    target_date: Option<String>,
    priority: Option<i32>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Project, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let input = CreateProjectInput {
        name,
        target_cents,
        target_date,
        priority,
        icon,
        color,
    };
    let result = projects_db::insert_project(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) =
        audit_db::insert_audit_log(&conn, "project", result.id, "create", None, Some(&details))
    {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_projects(state: State<DbState>) -> Result<Vec<Project>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::get_active_projects(&conn)
}

#[tauri::command(rename_all = "snake_case")]
// The parameter list IS the IPC contract: Tauri deserializes each `invoke` argument by name, so
// grouping these into a struct would change the shape the frontend must send.
#[allow(clippy::too_many_arguments)]
pub fn update_project(
    state: State<DbState>,
    id: i64,
    name: String,
    target_cents: i64,
    target_date: Option<String>,
    priority: Option<i32>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Project, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = serde_json::to_string(&projects_db::get_project_by_id(&conn, id)?).ok();

    let input = UpdateProjectInput {
        name,
        target_cents,
        target_date,
        priority,
        icon,
        color,
    };
    let result = projects_db::update_project(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "project",
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
pub fn reorder_projects(
    state: State<DbState>,
    project_ids: Vec<i64>,
) -> Result<Vec<Project>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let changes = projects_db::reorder_projects(&conn, &project_ids)?;

    for change in &changes {
        if let Err(e) = audit_db::insert_audit_log(
            &conn,
            "project",
            change.project_id,
            "update",
            Some(&change.old_json),
            Some(&change.new_json),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }

    projects_db::get_active_projects(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn archive_project(state: State<DbState>, id: i64) -> Result<Project, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = serde_json::to_string(&projects_db::get_project_by_id(&conn, id)?).ok();

    let result = projects_db::archive_project(&conn, id)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "project",
        id,
        "archive",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_project_contribution(
    state: State<DbState>,
    project_id: i64,
    account_id: i64,
    amount_cents: i64,
    date: String,
) -> Result<ProjectContribution, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    // `source` is hard-coded, never a parameter: `confirm_project_allocations` is the only path that
    // may produce a `"suggested"` row (FR8), so this command cannot be used to forge one.
    let input = CreateProjectContributionInput {
        project_id,
        account_id,
        amount_cents,
        source: "manual".to_string(),
        date,
    };
    let result = projects_db::insert_project_contribution(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "project_contribution",
        result.id,
        "create",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

// The only write path for suggested allocations, and thin by design: the FR6 step gate and FR7 cap
// live in `allocation::guard_confirmable`, every statement lives in `db/projects.rs`, and this
// function is the lock, the order of those two calls, and the audit trail. The waterfall is re-read
// here rather than trusted from the panel because the step or the surplus can change between the
// suggestion being rendered and the user confirming it.
#[tauri::command(rename_all = "snake_case")]
pub fn confirm_project_allocations(
    state: State<DbState>,
    allocations: Vec<ProjectAllocationInput>,
) -> Result<Vec<ProjectContribution>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;

    // Summed from the raw list, before the db layer drops zero entries, so padding a confirmation
    // with extra rows can never widen the cap.
    let total_cents: i64 = allocations
        .iter()
        .map(|allocation| allocation.amount_cents)
        .sum();
    allocation::guard_confirmable(
        &evaluation.current_step,
        figures.avg_monthly_surplus_cents,
        total_cents,
    )?;

    let created = projects_db::insert_suggested_contributions(&conn, &allocations)?;

    // One audit row per created contribution, not one summary row for the batch, so
    // `audit_log.entity_id` stays joinable back to the contribution it describes.
    for contribution in &created {
        let details = serde_json::to_string(contribution).unwrap_or_default();
        if let Err(e) = audit_db::insert_audit_log(
            &conn,
            "project_contribution",
            contribution.id,
            "create",
            None,
            Some(&details),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }

    Ok(created)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_project_contribution(
    state: State<DbState>,
    id: i64,
) -> Result<ProjectContribution, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let result = projects_db::delete_project_contribution(&conn, id)?;

    let old_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "project_contribution",
        result.id,
        "delete",
        Some(&old_json),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_project_contributions(
    state: State<DbState>,
    project_id: i64,
) -> Result<Vec<ProjectContribution>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::get_project_contributions(&conn, project_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_project_saved_totals(state: State<DbState>) -> Result<Vec<ProjectSavedTotal>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::get_project_saved_totals(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_account_earmark_breakdown(
    state: State<DbState>,
    account_id: i64,
) -> Result<AccountEarmarkBreakdown, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::get_account_earmark_breakdown(&conn, account_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_savings_projects_summary(
    state: State<DbState>,
) -> Result<SavingsProjectsSummary, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::get_savings_projects_summary(&conn)
}

// Two reads and a pure function, with no audit log because nothing changes: the suggestion flow is
// read/write-separated by architecture, and `confirm_project_allocations` is the only write path
// (NFR4). `Local::now()` lives here rather than in the algorithm so date-boundary cases stay testable
// without freezing the system clock — and it is the *single* clock for this command: the same
// `today` derives the month the ledger is queried for, the skip marker's month, and the reopen date.
#[tauri::command(rename_all = "snake_case")]
pub fn get_suggested_allocation(
    state: State<DbState>,
) -> Result<SuggestedAllocationResponse, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;
    let projects = projects_db::get_active_allocation_projects(&conn)?;

    let today = chrono::Local::now().date_naive();
    let input = allocation::AllocationInput {
        current_step: evaluation.current_step.clone(),
        avg_monthly_surplus_cents: figures.avg_monthly_surplus_cents,
        today: today.to_string(),
        projects,
    };
    let suggestions = allocation::compute_suggested_allocation(&input);

    let current_month = settlement::month_of(today);
    let confirmed = projects_db::get_confirmed_suggestion_for_month(&conn, &current_month)?;
    let confirmed_total_cents = confirmed
        .as_ref()
        .map_or(0, |confirmed| confirmed.total_cents);
    let skipped_month = projects_db::get_suggestion_skipped_month(&conn);
    let settlement =
        settlement::resolve_settlement(&current_month, confirmed, skipped_month.as_deref());

    // An unrepresentable date (the 1st of the next month always exists) would still not justify
    // failing the whole read, so it degrades to today rather than erroring.
    let next_suggestion_date = settlement::next_month_start(today).unwrap_or(today).to_string();

    Ok(SuggestedAllocationResponse {
        suggestions,
        available_surplus_cents: figures.avg_monthly_surplus_cents,
        remaining_surplus_cents: figures.avg_monthly_surplus_cents - confirmed_total_cents,
        current_month,
        next_suggestion_date,
        settlement,
    })
}

// A pure read plus a pure compute, with no audit log because nothing changes — same shape as
// `get_suggested_allocation`. `Local::now()` lives here rather than in the algorithm so date-boundary
// cases stay testable without freezing the system clock, and it is the *single* clock for this
// command: the same `today` bounds the trailing contribution window and measures the months left.
//
// A trailing window that cannot be represented (only reachable if `today` is near the epoch) degrades
// to `today`, which reduces the window to "contributions dated today" rather than failing the read.
#[tauri::command(rename_all = "snake_case")]
pub fn get_project_pace(state: State<DbState>) -> Result<Vec<ProjectPace>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let today = chrono::Local::now().date_naive();
    let window_months = u32::try_from(pace::RECENT_WINDOW_MONTHS).unwrap_or(3);
    let recent_since = today
        .checked_sub_months(chrono::Months::new(window_months))
        .unwrap_or(today);

    let rows = projects_db::get_active_project_pace_inputs(&conn, &recent_since.to_string())?;
    let today = today.to_string();

    Ok(rows
        .iter()
        .map(|project| {
            pace::compute_project_pace(&pace::PaceInput {
                today: &today,
                project,
            })
        })
        .collect())
}

// Deliberately unaudited, and the only mutation in this file that is: `audit_log` records financial
// facts, and a skip is not one — it moves no money, earmarks nothing, and writes no ledger row. It
// stores a single UI preference ("stop asking me until next month") in `config`, exactly like the
// emergency-fund target. Auditing it would put a non-financial event in the trail the user reads to
// reconstruct their money.
#[tauri::command(rename_all = "snake_case")]
pub fn skip_suggested_allocation_for_month(state: State<DbState>) -> Result<String, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let month = settlement::month_of(chrono::Local::now().date_naive());
    projects_db::set_suggestion_skipped_month(&conn, &month)?;

    Ok(month)
}

// The undo half of a skip. A confirmation needs no counterpart: its contributions are real and stay,
// so re-opening the panel after a confirm is a frontend toggle with nothing to unwind.
#[tauri::command(rename_all = "snake_case")]
pub fn clear_suggested_allocation_skip(state: State<DbState>) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    projects_db::clear_suggestion_skipped_month(&conn)
}

// The budget half of the prompt is read here, never accepted from the caller: the frontend can only
// send figures it was already given by `get_project_pace`, so there is no path by which a category
// name or an over-amount the backend did not itself read can reach the model.
fn over_target_categories(state: &State<'_, DbState>) -> Result<Vec<BudgetCategoryStatus>, AppError> {
    let now = chrono::Local::now();
    let year = now.format("%Y").to_string().parse::<i32>().unwrap_or(0);
    let month = now.format("%m").to_string().parse::<i32>().unwrap_or(0);

    let mut categories = {
        let active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

        budget_db::get_budget_status(&conn, year, month)?
    };

    categories.retain(|category| category.spent_cents > category.target_cents);
    categories.sort_by_key(|category| {
        std::cmp::Reverse(category.spent_cents.saturating_sub(category.target_cents))
    });
    categories.truncate(MAX_OVER_TARGET_CATEGORIES);

    Ok(categories)
}

// Same "read it here, never accept it from the caller" rule as `over_target_categories`, applied to
// the two redirect candidates. The trend window and the comparison come from `spending_trends`
// unchanged, so a slack figure the advisory quotes is the same number the Trends screen shows.
fn slack_categories(state: &State<'_, DbState>) -> Result<Vec<CategoryCompareRow>, AppError> {
    let mut categories = {
        let active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

        let by_category =
            spending_trends_db::get_monthly_spend_by_category(&conn, SLACK_TREND_MONTHS)?;
        let targets = spending_trends_db::get_category_targets(&conn)?;

        spending_trends_db::compute_category_compare(&by_category, SLACK_TREND_MONTHS, &targets)
    };

    categories.retain(|category| category.status == "under");
    categories.sort_by_key(|category| {
        std::cmp::Reverse(category.target_cents.unwrap_or(0) - category.avg_cents)
    });
    categories.truncate(MAX_SLACK_CATEGORIES);

    Ok(categories)
}

fn liquid_account_headroom(state: &State<'_, DbState>) -> Result<Vec<AccountHeadroom>, AppError> {
    let mut accounts = {
        let active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

        projects_db::get_liquid_account_headroom(&conn)?
    };

    accounts.truncate(MAX_IDLE_CASH_ACCOUNTS);

    Ok(accounts)
}

// The `AccountHeadroom` the db returns means "true unallocated cents" and is used honestly elsewhere.
// This builds a separate, advice-only copy so the feature that feeds an LLM sees a deliberately
// understated figure, while the model and the query it came from stay unchanged.
fn safe_to_recommend_headroom(account_headroom: &[AccountHeadroom]) -> Vec<AccountHeadroom> {
    account_headroom
        .iter()
        .map(|account| AccountHeadroom {
            unallocated_cents: account.unallocated_cents / SAFE_TO_RECOMMEND_DIVISOR,
            ..account.clone()
        })
        .collect()
}

// The one figure in the prompt that is neither read from the db nor supplied by the caller: what the
// required monthly rate would become if every dollar of the *listed* idle cash were applied as a lump
// sum today. It exists so the model can quote a revised rate without doing arithmetic — the rule
// everywhere in this codebase is that the model narrates numbers Rust computed, never derives them.
// `None` when there is no deadline (no monthly rate is definable at all) or when there is no idle cash
// (there would be nothing to apply, and the figure would merely restate the original rate).
fn adjusted_required_monthly_cents(
    remaining_cents: i64,
    months_to_target: Option<i64>,
    account_headroom: &[AccountHeadroom],
) -> Option<i64> {
    // `months_to_target` reaches us over IPC rather than from `allocation::months_to_target`'s
    // clamp, so the divisor is re-checked here instead of assumed positive.
    let months = months_to_target.filter(|months| *months > 0)?;

    let total_headroom_cents = account_headroom.iter().fold(0i64, |total, account| {
        total.saturating_add(account.unallocated_cents)
    });
    if total_headroom_cents <= 0 {
        return None;
    }

    let after_lump_sum = remaining_cents.saturating_sub(total_headroom_cents).max(0);

    // Ceiling division, the same idiom as `pace.rs` and `allocation.rs`: paying the floor every
    // month would land short of the target by up to `months - 1` cents.
    Some(after_lump_sum.saturating_add(months - 1) / months)
}

// Advisory text, so nothing is written and nothing is audited: `audit_log` records financial facts and
// a sentence is not one. The provider is resolved and the lock released before the first `.await`,
// exactly like `generate_trends_insight` — a held `MutexGuard` cannot cross an await point. The long
// parameter list IS the IPC contract, as in `update_project`, so it cannot be grouped into a struct.
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn generate_project_advice(
    state: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
    project_name: String,
    remaining_cents: i64,
    required_monthly_cents: i64,
    actual_monthly_cents: Option<i64>,
    months_to_target: Option<i64>,
    locale: String,
) -> Result<ProjectAdviceResponse, AppError> {
    let request = ProjectAdviceRequest {
        project_name,
        remaining_cents,
        required_monthly_cents,
        actual_monthly_cents,
        months_to_target,
        locale,
    };

    let categories = over_target_categories(&state)?;
    let slack = slack_categories(&state)?;
    let headroom = safe_to_recommend_headroom(&liquid_account_headroom(&state)?);
    let adjusted_monthly =
        adjusted_required_monthly_cents(remaining_cents, months_to_target, &headroom);

    // `None` is no longer an early return: hosted Bedrock may still serve a
    // premium user who has configured no BYO provider at all.
    let byo = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        clone_provider(&ai.provider)
    };

    project_advice::generate_project_advice(
        byo.as_ref(),
        request,
        &categories,
        &slack,
        &headroom,
        adjusted_monthly,
    )
    .await
}

const PROJECT_IMAGE_ENTITY: &str = "project_image";

/// Reads and validates the picked file into everything the store needs, touching no
/// database at all.
///
/// Split out from `set_project_image` because the ordering is load-bearing: the file read
/// happens here, *before* the `DbState` guard is taken, so a non-reentrant mutex is never
/// held across a multi-megabyte read while every other command waits. It is also the only
/// way the read-then-store path is reachable from `cargo test`, since `tauri::State` has no
/// public constructor.
///
/// The mime type comes from the proven format, never from an argument, so the value bound
/// into `project_images` can only be one of the two `project_images_mime_allowed` admits.
pub(crate) fn read_project_image_for_store(
    file_path: &str,
) -> Result<(&'static str, String, Vec<u8>), AppError> {
    let (format, bytes) = image::read(file_path)?;
    // The basename comes back through `inspect` rather than a second hand-rolled
    // `file_name()` branch: `inspect` already refuses a path carrying no usable name, and it
    // re-runs only a metadata stat, never a second read of the file.
    let original_filename = image::inspect(file_path)?;

    Ok((format.mime_type(), original_filename, bytes))
}

/// Exactly the four metadata fields, built by hand rather than by serializing a model, so
/// the audit trail cannot grow an image payload because someone later added a field to
/// `ProjectImage`. `project_id` is omitted because `entity_id` already carries it.
fn project_image_audit_value(meta: &ProjectImageMeta) -> String {
    serde_json::json!({
        "mime_type": meta.mime_type,
        "original_filename": meta.original_filename,
        "byte_size": meta.byte_size,
        "uploaded_at": meta.uploaded_at,
    })
    .to_string()
}

/// The read path over a plain `&Connection`, which is what makes it testable.
pub(crate) fn get_project_image_inner(
    conn: &Connection,
    project_id: i64,
) -> Result<Option<ProjectImage>, AppError> {
    let Some(row) = projects_db::get_project_image(conn, project_id)? else {
        return Ok(None);
    };

    Ok(Some(ProjectImage {
        project_id: row.project_id,
        mime_type: row.mime_type,
        original_filename: row.original_filename,
        byte_size: row.byte_size,
        uploaded_at: row.uploaded_at,
        image_base64: STANDARD.encode(&row.image_bytes),
    }))
}

/// Every active project's thumbnail in one read, backfilling any that are missing.
///
/// ONE call for the whole list, not one per row: that is the entire reason this command exists
/// separately from `get_project_image`, which stays behind an expanded row because it carries
/// up to 4 MiB. Every payload here is capped at `MAX_PROJECT_THUMBNAIL_BYTES`.
///
/// The backfill covers images stored before migration 027, and runs one image at a time rather
/// than loading every candidate at once. A candidate whose thumbnail cannot be produced is
/// skipped and left NULL: it is re-attempted on a later read, which costs one decode per app
/// session (the hook caches with `staleTime: Infinity`) and never costs the user a picture.
pub(crate) fn get_project_thumbnails_inner(
    conn: &Connection,
) -> Result<Vec<ProjectThumbnail>, AppError> {
    for project_id in projects_db::get_project_ids_needing_thumbnails(conn)? {
        let Some(stored) = projects_db::get_project_image(conn, project_id)? else {
            continue;
        };
        let Some(format) = image::ProjectImageFormat::from_mime_type(&stored.mime_type) else {
            continue;
        };
        let Some((bytes, mime_type)) = image::thumbnail(&stored.image_bytes, format) else {
            continue;
        };

        projects_db::set_project_thumbnail(conn, project_id, (&bytes, mime_type))?;
    }

    Ok(projects_db::get_project_thumbnails(conn)?
        .into_iter()
        .map(|row| ProjectThumbnail {
            project_id: row.project_id,
            mime_type: row.thumbnail_mime,
            image_base64: STANDARD.encode(&row.thumbnail_bytes),
        })
        .collect())
}

/// Stores already-validated bytes and records the write.
///
/// `byte_size` is never a parameter: `upsert_project_image` binds `bytes.len()` itself,
/// because `project_images_byte_size_matches_payload` rejects any disagreement and a
/// caller-supplied length is exactly how that disagreement would arise.
///
/// The thumbnail is derived here and rides the same statement. A picture whose derivative
/// could not be produced is stored anyway with a NULL thumbnail — the row falls back to its
/// placeholder tile rather than the upload being refused for a file the user can see.
pub(crate) fn set_project_image_inner(
    conn: &Connection,
    project_id: i64,
    mime_type: &str,
    original_filename: &str,
    bytes: &[u8],
) -> Result<ProjectImageMeta, AppError> {
    let derived = image::ProjectImageFormat::from_mime_type(mime_type)
        .and_then(|format| image::thumbnail(bytes, format));

    let row = projects_db::upsert_project_image(
        conn,
        project_id,
        &projects_db::ProjectImageWrite {
            mime_type,
            original_filename,
            bytes,
            thumbnail: derived
                .as_ref()
                .map(|(thumbnail, thumbnail_mime)| (thumbnail.as_slice(), *thumbnail_mime)),
        },
    )?;

    let meta = ProjectImageMeta {
        project_id: row.project_id,
        mime_type: row.mime_type,
        original_filename: row.original_filename,
        byte_size: row.byte_size,
        uploaded_at: row.uploaded_at,
    };

    let details = project_image_audit_value(&meta);
    if let Err(e) = audit_db::insert_audit_log(
        conn,
        PROJECT_IMAGE_ENTITY,
        project_id,
        "set",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(meta)
}

pub(crate) fn remove_project_image_inner(
    conn: &Connection,
    project_id: i64,
) -> Result<(), AppError> {
    // Read before deleting so the audit trail can record what was released. This loads the
    // payload and drops it — at most 4 MiB — because `get_project_image` is the only reader
    // and a metadata-only accessor would have no second caller.
    let Some(previous) = projects_db::get_project_image(conn, project_id)? else {
        // Removal is idempotent by design, and an audit entry for a state that never changed
        // would be a lie.
        return Ok(());
    };

    projects_db::delete_project_image(conn, project_id)?;

    let old_json = project_image_audit_value(&ProjectImageMeta {
        project_id: previous.project_id,
        mime_type: previous.mime_type,
        original_filename: previous.original_filename,
        byte_size: previous.byte_size,
        uploaded_at: previous.uploaded_at,
    });
    if let Err(e) = audit_db::insert_audit_log(
        conn,
        PROJECT_IMAGE_ENTITY,
        project_id,
        "remove",
        Some(&old_json),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

/// Refuses an unusable file before any write, so the picker can surface the reason at the
/// moment of choosing. Returns the basename it will display; no directory component ever
/// crosses back.
#[tauri::command(rename_all = "snake_case")]
pub fn validate_project_image(file_path: String) -> Result<String, AppError> {
    image::inspect(&file_path)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_project_image(
    state: State<DbState>,
    project_id: i64,
) -> Result<Option<ProjectImage>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    get_project_image_inner(&conn, project_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_project_thumbnails(state: State<DbState>) -> Result<Vec<ProjectThumbnail>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    get_project_thumbnails_inner(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_project_image(
    state: State<DbState>,
    project_id: i64,
    file_path: String,
) -> Result<ProjectImageMeta, AppError> {
    // One read, before the lock. Every project command is synchronous on the main thread and
    // `DbState`'s mutex is not reentrant, so holding it across the file read would stall
    // every other command for the duration of that read.
    let (mime_type, original_filename, bytes) = read_project_image_for_store(&file_path)?;

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    set_project_image_inner(&conn, project_id, mime_type, &original_filename, &bytes)
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_project_image(state: State<DbState>, project_id: i64) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    remove_project_image_inner(&conn, project_id)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::TempDir;

    use super::*;

    fn headroom(unallocated_cents: i64) -> AccountHeadroom {
        AccountHeadroom {
            account_id: 1,
            account_name: "Rainy day".to_string(),
            account_type: "savings".to_string(),
            unallocated_cents,
        }
    }

    #[test]
    fn the_lump_sum_is_subtracted_before_the_remainder_is_spread_over_the_months() {
        assert_eq!(
            adjusted_required_monthly_cents(600_000, Some(6), &[headroom(300_000)]),
            Some(50_000)
        );
    }

    #[test]
    fn every_listed_account_contributes_to_the_lump_sum() {
        assert_eq!(
            adjusted_required_monthly_cents(
                600_000,
                Some(6),
                &[headroom(200_000), headroom(100_000)]
            ),
            Some(50_000)
        );
    }

    // The same ceiling the deterministic pace uses: a floor would quote a rate that lands short of
    // the target by up to `months - 1` cents.
    #[test]
    fn the_adjusted_rate_rounds_up_like_the_pace_rate_does() {
        assert_eq!(
            adjusted_required_monthly_cents(1_500, Some(3), &[headroom(500)]),
            Some(334)
        );
    }

    // Idle cash larger than the gap is a real state — the goal could be closed outright today — and
    // it must read as zero rather than as a negative rate.
    #[test]
    fn idle_cash_that_covers_the_whole_gap_floors_the_rate_at_zero() {
        assert_eq!(
            adjusted_required_monthly_cents(600_000, Some(6), &[headroom(900_000)]),
            Some(0)
        );
    }

    #[test]
    fn no_deadline_means_no_adjusted_rate_at_all() {
        assert_eq!(
            adjusted_required_monthly_cents(600_000, None, &[headroom(300_000)]),
            None
        );
    }

    // `months_to_target` crosses IPC unvalidated, so a non-positive value must degrade rather than
    // divide by zero.
    #[test]
    fn a_non_positive_month_count_means_no_adjusted_rate() {
        for months in [0, -1] {
            assert_eq!(
                adjusted_required_monthly_cents(600_000, Some(months), &[headroom(300_000)]),
                None,
                "for {months}"
            );
        }
    }

    #[test]
    fn no_idle_cash_means_no_adjusted_rate() {
        assert_eq!(adjusted_required_monthly_cents(600_000, Some(6), &[]), None);
        assert_eq!(
            adjusted_required_monthly_cents(600_000, Some(6), &[headroom(0)]),
            None
        );
    }

    // The structural guarantee: whatever the account truly holds, the figure the prompt shows is half
    // of it, so no wording the model chooses can reach the full balance.
    #[test]
    fn only_half_of_an_accounts_true_idle_cash_is_ever_offered_to_the_model() {
        let safe = safe_to_recommend_headroom(&[headroom(1_400_000)]);

        assert_eq!(safe[0].unallocated_cents, 700_000);
    }

    // Every account, not just reserve-sounding ones — the name plays no part in the cap.
    #[test]
    fn the_halving_applies_to_every_listed_account_whatever_it_is_called() {
        let safe = safe_to_recommend_headroom(&[
            AccountHeadroom {
                account_name: "Everyday chequing".to_string(),
                account_type: "chequing".to_string(),
                ..headroom(265_988)
            },
            AccountHeadroom {
                account_name: "Emergency Fund".to_string(),
                ..headroom(1_000_000)
            },
        ]);

        assert_eq!(safe[0].unallocated_cents, 132_994);
        assert_eq!(safe[1].unallocated_cents, 500_000);
    }

    // Identity, name and type are untouched: only the amount is understated, so the prompt still
    // names the account the user will actually recognize.
    #[test]
    fn halving_changes_the_amount_and_nothing_else_about_the_account() {
        let safe = safe_to_recommend_headroom(&[headroom(999)]);

        assert_eq!(safe[0].account_id, 1);
        assert_eq!(safe[0].account_name, "Rainy day");
        assert_eq!(safe[0].account_type, "savings");
        // Floor, so an odd amount rounds toward holding more back rather than less.
        assert_eq!(safe[0].unallocated_cents, 499);
    }

    // The apply-all scenario the model may quote verbatim has to be the scenario it was actually
    // shown: computed from the halved total, never from the true one.
    #[test]
    fn the_adjusted_rate_is_computed_from_the_halved_idle_cash_not_the_true_balance() {
        let true_headroom = [headroom(600_000)];
        let safe = safe_to_recommend_headroom(&true_headroom);

        assert_eq!(
            adjusted_required_monthly_cents(900_000, Some(6), &safe),
            Some(100_000)
        );
        assert_eq!(
            adjusted_required_monthly_cents(900_000, Some(6), &true_headroom),
            Some(50_000)
        );
    }

    // A single cent of true headroom halves to zero, which must read as "no idle cash" rather than as
    // an adjusted rate identical to the original one.
    #[test]
    fn headroom_too_small_to_halve_yields_no_adjusted_rate() {
        let safe = safe_to_recommend_headroom(&[headroom(1)]);

        assert_eq!(safe[0].unallocated_cents, 0);
        assert_eq!(adjusted_required_monthly_cents(600_000, Some(6), &safe), None);
    }

    // ---------------------------------------------------------------------------
    // Project image
    //
    // Every test below runs against a real migrated database on a temp file, not the
    // hand-rolled in-memory fixture: all four `project_images` CHECK constraints stay live,
    // so a wrong `byte_size` or mime string fails here rather than in production.
    // ---------------------------------------------------------------------------

    const CAPTURE_SENTINEL: &str = "tracing-capture-is-live";

    fn migrated_db_with_a_project() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = crate::db::init_db(dir.path()).expect("init_db succeeds");
        conn.execute(
            "INSERT INTO projects (id, name, target_cents) VALUES (1, 'Kitchen', 500000)",
            [],
        )
        .expect("seed project");
        (dir, conn)
    }

    /// A 13-byte IHDR carrying the declared size, then the fixed colour-type tail — the same
    /// header shape `projects::image` parses. Nothing past the header is read, so no pixel
    /// data or CRC is needed, but the bytes must be a genuine PNG header or `image::read`
    /// refuses the file.
    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    fn stored_image(conn: &Connection) -> Option<ProjectImage> {
        get_project_image_inner(conn, 1).expect("the image read succeeds")
    }

    fn decoded(image: &ProjectImage) -> Vec<u8> {
        STANDARD
            .decode(&image.image_base64)
            .expect("the wire payload is valid base64")
    }

    /// Every persisted audit column that could carry a payload, as one string: a leak
    /// assertion has to cover `old_value` and `new_value` both, not whichever one the test
    /// happened to think of.
    fn all_audit_text(conn: &Connection) -> String {
        let mut statement = conn
            .prepare(
                "SELECT entity_type, entity_id, action,
                        COALESCE(old_value, ''), COALESCE(new_value, '')
                 FROM audit_log ORDER BY id",
            )
            .expect("the audit query prepares");
        let rows: Vec<String> = statement
            .query_map([], |row| {
                Ok(format!(
                    "{}|{}|{}|{}|{}",
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?
                ))
            })
            .expect("the audit rows map")
            .collect::<Result<Vec<_>, _>>()
            .expect("the audit rows read");

        rows.join("\n")
    }

    fn image_audit_values(conn: &Connection, action: &str) -> (Option<String>, Option<String>) {
        let matching: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log
                 WHERE entity_type = 'project_image' AND entity_id = 1 AND action = ?1",
                [action],
                |row| row.get(0),
            )
            .expect("the audit count reads");
        assert_eq!(matching, 1, "exactly one {action} audit row is expected");

        conn.query_row(
            "SELECT old_value, new_value FROM audit_log
             WHERE entity_type = 'project_image' AND entity_id = 1 AND action = ?1",
            [action],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the audit row reads")
    }

    /// The audit value's key set, sorted — an exact-key assertion is what makes "no payload
    /// in the audit trail" structural rather than a substring guess.
    fn audit_keys(value: &str) -> Vec<String> {
        let parsed: serde_json::Value =
            serde_json::from_str(value).expect("the audit value is JSON");
        let mut keys: Vec<String> = parsed
            .as_object()
            .expect("the audit value is a JSON object")
            .keys()
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    struct SharedSink(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for SharedSink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .expect("the capture buffer is usable")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Runs `body` with every `tracing` event on this thread captured, returning its value
    /// alongside the captured text.
    ///
    /// The leak guarantee this serves is about the SUCCESS path: a refusal message is easy to
    /// inspect by hand, but a stray `info!("stored {path}")` would only ever show up here.
    fn captured_tracing<T>(body: impl FnOnce() -> T) -> (T, String) {
        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&buffer);
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(move || SharedSink(Arc::clone(&sink)))
            .finish();

        let value = tracing::subscriber::with_default(subscriber, body);

        let captured =
            String::from_utf8_lossy(&buffer.lock().expect("the capture buffer is usable"))
                .to_string();
        (value, captured)
    }

    #[test]
    fn storing_a_png_reports_its_own_mime_and_payload_length_and_reads_back_byte_identically() {
        let (_dir, conn) = migrated_db_with_a_project();
        let payload = png_bytes(64, 64);

        let meta = set_project_image_inner(&conn, 1, "image/png", "cover.png", &payload)
            .expect("the image is stored");

        assert_eq!(meta.project_id, 1);
        assert_eq!(meta.mime_type, "image/png");
        assert_eq!(meta.original_filename, "cover.png");
        assert_eq!(
            meta.byte_size,
            i64::try_from(payload.len()).expect("a header-sized payload fits an i64")
        );
        assert!(
            !meta.uploaded_at.is_empty(),
            "uploaded_at comes from SQLite's clock, not from the caller"
        );

        let image = stored_image(&conn).expect("the stored image is readable");
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.byte_size, meta.byte_size);
        assert_eq!(
            decoded(&image),
            payload,
            "the wire payload must decode byte-identically to the source"
        );
    }

    #[test]
    fn the_set_audit_row_carries_only_metadata_and_never_the_payload() {
        let (_dir, conn) = migrated_db_with_a_project();
        let payload = png_bytes(64, 64);

        set_project_image_inner(&conn, 1, "image/png", "cover.png", &payload)
            .expect("the image is stored");

        let (old_value, new_value) = image_audit_values(&conn, "set");
        assert_eq!(old_value, None, "a store has no prior value to record");
        let new_value = new_value.expect("the set audit row records the new metadata");

        assert_eq!(
            audit_keys(&new_value),
            vec!["byte_size", "mime_type", "original_filename", "uploaded_at"],
            "the audit value must carry exactly the four metadata fields"
        );

        let audit = all_audit_text(&conn);
        assert!(
            !audit.contains("image_bytes"),
            "no payload key may reach the audit trail: {audit}"
        );
        assert!(
            !audit.contains(&STANDARD.encode(&payload)),
            "no base64 payload may reach the audit trail: {audit}"
        );
    }

    #[test]
    fn the_read_then_store_path_leaks_no_source_path_into_the_audit_trail_or_the_logs() {
        let (dir, conn) = migrated_db_with_a_project();
        let marker = format!("nixus-image-leak-marker-{}", std::process::id());
        let source_dir = dir.path().join(&marker);
        std::fs::create_dir_all(&source_dir).expect("the marker directory is created");
        let source = source_dir.join("cover.png");
        std::fs::write(&source, png_bytes(48, 48)).expect("the source image is written");
        let file_path = source.to_str().expect("a utf-8 temp path");

        let (meta, logs) = captured_tracing(|| {
            let (mime_type, original_filename, bytes) =
                read_project_image_for_store(file_path).expect("the source image is accepted");
            let meta = set_project_image_inner(&conn, 1, mime_type, &original_filename, &bytes)
                .expect("the image is stored");
            // Emitted inside the capture so the absence assertions below cannot pass on an
            // empty buffer: a capture that silently recorded nothing would prove nothing.
            tracing::error!("{}", CAPTURE_SENTINEL);
            meta
        });

        assert!(
            logs.contains(CAPTURE_SENTINEL),
            "the tracing capture must be live, got: {logs}"
        );
        assert!(
            !logs.contains(&marker),
            "no source path may reach a log line: {logs}"
        );
        let audit = all_audit_text(&conn);
        assert!(
            !audit.contains(&marker),
            "no source path may reach a persisted row: {audit}"
        );
        assert_eq!(
            meta.original_filename, "cover.png",
            "only the basename is ever stored"
        );
    }

    #[test]
    fn get_project_image_inner_returns_none_for_a_project_without_one() {
        let (_dir, conn) = migrated_db_with_a_project();

        assert!(
            stored_image(&conn).is_none(),
            "a project without a picture is the normal state, not a failure"
        );
    }

    #[test]
    fn removing_an_image_clears_it_and_records_metadata_only() {
        let (_dir, conn) = migrated_db_with_a_project();
        let payload = png_bytes(64, 64);
        set_project_image_inner(&conn, 1, "image/png", "cover.png", &payload)
            .expect("the image is stored");

        remove_project_image_inner(&conn, 1).expect("the image is removed");

        assert!(stored_image(&conn).is_none(), "the image is gone");

        let (old_value, new_value) = image_audit_values(&conn, "remove");
        let old_value = old_value.expect("the remove audit row records what was released");
        assert_eq!(
            new_value, None,
            "nothing survives to record as the new value"
        );
        assert_eq!(
            audit_keys(&old_value),
            vec!["byte_size", "mime_type", "original_filename", "uploaded_at"]
        );
        assert!(
            !all_audit_text(&conn).contains(&STANDARD.encode(&payload)),
            "removal must not be the moment a payload enters the audit trail"
        );
    }

    #[test]
    fn removing_an_image_that_was_never_there_is_a_silent_no_op() {
        let (_dir, conn) = migrated_db_with_a_project();

        remove_project_image_inner(&conn, 1).expect("removal is idempotent");

        assert_eq!(
            all_audit_text(&conn),
            "",
            "a state that never changed leaves no audit row"
        );
    }

    // `validate_project_image` is a pure delegation and a `#[tauri::command]` body cannot be
    // driven from a test, so its inner path is what the assertion reaches.
    #[test]
    fn the_validate_path_returns_a_bare_basename_with_no_directory_component() {
        let dir = TempDir::new().expect("temp dir");
        let nested = dir.path().join("Pictures").join("2026");
        std::fs::create_dir_all(&nested).expect("the nested directories are created");
        let source = nested.join("kitchen-cover.png");
        std::fs::write(&source, png_bytes(32, 32)).expect("the source image is written");

        let name = image::inspect(source.to_str().expect("a utf-8 temp path"))
            .expect("the source image is accepted");

        assert_eq!(name, "kitchen-cover.png");
        assert!(!name.contains(std::path::MAIN_SEPARATOR), "got {name}");
        assert!(!name.contains('/'), "got {name}");
    }

    /// A refused write must never be a destructive one: the archived guard fires ahead of the
    /// upsert, so the bytes already stored stay exactly where they were.
    #[test]
    fn a_write_refused_by_the_archived_guard_leaves_the_previous_image_intact() {
        let (_dir, conn) = migrated_db_with_a_project();
        let original = png_bytes(64, 64);
        set_project_image_inner(&conn, 1, "image/png", "cover.png", &original)
            .expect("the first image is stored");
        conn.execute(
            "UPDATE projects SET archived_at = datetime('now') WHERE id = 1",
            [],
        )
        .expect("the project is archived");

        let replacement = png_bytes(128, 96);
        assert_ne!(
            replacement, original,
            "the replacement must differ, or byte-identity would prove nothing"
        );
        let error =
            set_project_image_inner(&conn, 1, "image/jpeg", "replacement.jpg", &replacement)
                .expect_err("an archived project refuses a write");

        assert!(
            matches!(&error, AppError::Validation { field: Some(field), .. } if field == "project_id"),
            "expected the project_id guard, got {error:?}"
        );

        let image = stored_image(&conn).expect("the previous image survives the refusal");
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.original_filename, "cover.png");
        assert_eq!(
            decoded(&image),
            original,
            "a failed write must not destroy the stored payload"
        );
    }

    /// The stored derivative read straight out of SQLite, so a test can tell "returned by the
    /// command" from "written to the row" — which is the whole difference the backfill makes.
    fn persisted_thumbnail(conn: &Connection, project_id: i64) -> Option<(Vec<u8>, String)> {
        let (bytes, mime_type): (Option<Vec<u8>>, Option<String>) = conn
            .query_row(
                "SELECT thumbnail_bytes, thumbnail_mime FROM project_images WHERE project_id = ?1",
                rusqlite::params![project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the image row exists");

        Some((bytes?, mime_type?))
    }

    fn thumbnail_payload(thumbnail: &ProjectThumbnail) -> Vec<u8> {
        STANDARD
            .decode(&thumbnail.image_base64)
            .expect("the wire payload is valid base64")
    }

    /// Migration 027 shipped after 026, so a picture stored by an earlier build has NULL
    /// thumbnail columns. One list read has to fix that permanently, not just for that response.
    #[test]
    fn an_image_stored_without_a_thumbnail_is_backfilled_by_one_batch_read() {
        let (_dir, conn) = migrated_db_with_a_project();
        let source =
            image::rendered_test_image(400, 300, false, image::ProjectImageFormat::Png);
        // Straight through the db layer with no derivative, which is exactly the row shape every
        // image written before migration 027 has.
        projects_db::upsert_project_image(
            &conn,
            1,
            &projects_db::ProjectImageWrite {
                mime_type: "image/png",
                original_filename: "cover.png",
                bytes: &source,
                thumbnail: None,
            },
        )
        .expect("the pre-027 write succeeds");
        assert_eq!(persisted_thumbnail(&conn, 1), None);

        let thumbnails = get_project_thumbnails_inner(&conn).expect("the batch read succeeds");

        assert_eq!(thumbnails.len(), 1);
        let (stored_bytes, stored_mime) =
            persisted_thumbnail(&conn, 1).expect("the derivative is now on the row");
        assert_eq!(stored_mime, "image/png");
        assert_eq!(thumbnail_payload(&thumbnails[0]), stored_bytes);
        // Untouched by the backfill: only the two derivative columns may change, or a late
        // thumbnail would rewrite the moment the user actually uploaded.
        assert_eq!(
            stored_image(&conn)
                .expect("the picture is still there")
                .original_filename,
            "cover.png"
        );
    }

    /// The list surface's two guarantees in one read: active projects only, and a bounded payload
    /// for each. The size assertion is what breaks if the command ever ships full-size bytes.
    #[test]
    fn the_batch_read_covers_active_projects_only_and_bounds_every_payload() {
        let (_dir, conn) = migrated_db_with_a_project();
        for (id, name) in [(2, "Roof"), (3, "Boat")] {
            conn.execute(
                "INSERT INTO projects (id, name, target_cents) VALUES (?1, ?2, 900000)",
                rusqlite::params![id, name],
            )
            .expect("seed project");
        }
        // Incompressible on purpose: the stored picture has to be far larger than the 64 KiB
        // ceiling, or the bound below could pass simply because the fixture is small.
        let source = image::rendered_test_image(
            image::THUMBNAIL_EDGE,
            image::THUMBNAIL_EDGE,
            true,
            image::ProjectImageFormat::Png,
        );
        assert!(
            u64::try_from(source.len()).unwrap() > image::MAX_PROJECT_THUMBNAIL_BYTES,
            "the fixture must exceed the ceiling it is used to test, got {}",
            source.len()
        );
        for project_id in [1, 2, 3] {
            set_project_image_inner(&conn, project_id, "image/png", "cover.png", &source)
                .expect("the write succeeds");
        }
        // Archived only after its picture was stored, because the write guard refuses an archived
        // project outright — this is the real order in which such a row comes to exist.
        conn.execute(
            "UPDATE projects SET archived_at = datetime('now') WHERE id = 3",
            [],
        )
        .expect("the third project is archived");

        let thumbnails = get_project_thumbnails_inner(&conn).expect("the batch read succeeds");

        assert_eq!(
            thumbnails
                .iter()
                .map(|thumbnail| thumbnail.project_id)
                .collect::<Vec<_>>(),
            vec![1, 2],
            "an archived project is off the list, so its tile is never paid for"
        );
        for thumbnail in &thumbnails {
            let payload = thumbnail_payload(thumbnail);
            assert!(
                u64::try_from(payload.len()).unwrap() <= image::MAX_PROJECT_THUMBNAIL_BYTES,
                "project {} shipped {} bytes",
                thumbnail.project_id,
                payload.len()
            );
            assert_ne!(
                payload, source,
                "the payload must be the derivative, never the stored picture"
            );
        }
    }

    /// The rule the whole design bends around: a derivative that could not be produced must not
    /// cost the user the picture. `png_bytes` is a header the validator accepts with no pixel
    /// data behind it, so the decoder genuinely disagrees with the validator here.
    #[test]
    fn an_image_whose_thumbnail_cannot_be_produced_is_still_stored() {
        let (_dir, conn) = migrated_db_with_a_project();
        let undecodable = png_bytes(64, 64);

        let meta = set_project_image_inner(&conn, 1, "image/png", "cover.png", &undecodable)
            .expect("the upload succeeds despite the derivative failing");

        assert_eq!(meta.byte_size, i64::try_from(undecodable.len()).unwrap());
        assert_eq!(persisted_thumbnail(&conn, 1), None);
        assert!(decoded(&stored_image(&conn).expect("the picture is stored")) == undecodable);
        assert!(
            get_project_thumbnails_inner(&conn)
                .expect("the batch read succeeds")
                .is_empty(),
            "a NULL thumbnail is an absent entry, so the row falls back to its placeholder"
        );
    }

    /// Without the thumbnail riding the same upsert statement, this row would keep showing the
    /// PREVIOUS picture's tile after a replace.
    #[test]
    fn replacing_a_picture_never_leaves_the_previous_thumbnail_behind() {
        let (_dir, conn) = migrated_db_with_a_project();
        let decodable =
            image::rendered_test_image(400, 300, false, image::ProjectImageFormat::Png);
        set_project_image_inner(&conn, 1, "image/png", "first.png", &decodable)
            .expect("the first image is stored");
        assert!(persisted_thumbnail(&conn, 1).is_some());

        set_project_image_inner(&conn, 1, "image/png", "second.png", &png_bytes(64, 64))
            .expect("the replacement is stored");

        assert_eq!(persisted_thumbnail(&conn, 1), None);
    }
}
