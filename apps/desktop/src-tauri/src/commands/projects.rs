use std::sync::Mutex;

use tauri::State;

use crate::ai::{project_advice, AiProvider, AiState};
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
    ProjectAdviceResponse, ProjectAllocationInput, ProjectContribution, ProjectPace,
    ProjectSavedTotal, SavingsProjectsSummary, SuggestedAllocationResponse, UpdateProjectInput,
};
use crate::projects::{allocation, pace, settlement};

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    projects_db::get_project_contributions(&conn, project_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_project_saved_totals(state: State<DbState>) -> Result<Vec<ProjectSavedTotal>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    projects_db::get_project_saved_totals(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_account_earmark_breakdown(
    state: State<DbState>,
    account_id: i64,
) -> Result<AccountEarmarkBreakdown, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    projects_db::get_account_earmark_breakdown(&conn, account_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_savings_projects_summary(
    state: State<DbState>,
) -> Result<SavingsProjectsSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let month = settlement::month_of(chrono::Local::now().date_naive());
    projects_db::set_suggestion_skipped_month(&conn, &month)?;

    Ok(month)
}

// The undo half of a skip. A confirmation needs no counterpart: its contributions are real and stay,
// so re-opening the panel after a confirm is a frontend toggle with nothing to unwind.
#[tauri::command(rename_all = "snake_case")]
pub fn clear_suggested_allocation_skip(state: State<DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
        let conn = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

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
        let conn = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

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
        let conn = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

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

    let provider = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        match &ai.provider {
            None => return Err(AppError::NotConfigured),
            Some(AiProvider::Bedrock(client)) => {
                project_advice::ProviderClient::Bedrock(client.clone())
            }
            Some(AiProvider::OpenAI(client)) => {
                project_advice::ProviderClient::OpenAI(client.clone())
            }
        }
    };

    project_advice::generate_project_advice(
        &provider,
        request,
        &categories,
        &slack,
        &headroom,
        adjusted_monthly,
    )
    .await
}

#[cfg(test)]
mod tests {
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
}
