use aws_sdk_bedrockruntime::types::ConversationRole;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};

use crate::ai::chat as chat_ai;
use crate::ai::backend::AiTurn;
use crate::ai::{clone_provider, AiState};
use crate::db::account as account_db;
use crate::db::asset as asset_db;
use crate::db::audit as audit_db;
use crate::db::budget as budget_db;
use crate::db::chat as chat_db;
use crate::db::dashboard as dashboard_db;
use crate::db::expense as expense_db;
use crate::db::income as income_db;
use crate::db::maintenance as maintenance_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{CreateAccountInput, CreateExpenseInput};

#[derive(Serialize)]
pub struct SendMessageResult {
    pub conversation_id: i64,
    pub user_message_id: i64,
}

// Filtering internal tool messages out of the history can leave two user turns adjacent, and
// Bedrock rejects any history that repeats a role or opens with the assistant. Same-role runs
// are merged instead of dropped so no user turn is lost.
fn alternating_turns(db_messages: &[chat_db::ChatMessage]) -> Vec<(ConversationRole, String)> {
    let mut turns: Vec<(ConversationRole, String)> = Vec::new();

    for msg in db_messages {
        let role = match msg.role.as_str() {
            "user" => ConversationRole::User,
            "assistant" => ConversationRole::Assistant,
            _ => continue,
        };
        match turns.last_mut() {
            Some((last_role, content)) if *last_role == role => {
                content.push_str("\n\n");
                content.push_str(&msg.content);
            }
            _ => turns.push((role, msg.content.clone())),
        }
    }

    if turns
        .first()
        .is_some_and(|(role, _)| *role == ConversationRole::Assistant)
    {
        turns.remove(0);
    }

    // A trailing assistant turn means the previous turn never got its answer back.
    if turns
        .last()
        .is_some_and(|(role, _)| *role == ConversationRole::Assistant)
    {
        turns.pop();
    }

    turns
}

fn build_history_turns(
    db_state: &State<DbState>,
    conv_id: i64,
) -> Result<Vec<AiTurn>, AppError> {
    let active = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    let db_messages = chat_db::get_conversation_messages_for_ai(&conn, conv_id)?;

    Ok(alternating_turns(&db_messages)
        .into_iter()
        .map(|(role, content)| chat_ai::build_turn(role, &content))
        .collect())
}

fn build_context(db_state: &State<DbState>) -> Result<String, AppError> {
    let active = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let now = chrono::Local::now();
    let year = now.format("%Y").to_string().parse::<i32>().unwrap_or(2026);
    let month = now.format("%m").to_string().parse::<i32>().unwrap_or(3);

    let mut ctx = String::new();

    // Budget summary
    if let Ok(summary) = dashboard_db::get_budget_summary(&conn, year, month) {
        ctx.push_str(&format!(
            "Budget Summary ({}-{:02}):\n  Total budget: {} cents\n  Total spent: {} cents\n  Remaining: {} cents\n\n",
            year, month, summary.total_target_cents, summary.total_spent_cents, summary.remaining_cents
        ));
    }

    // Budget categories with spending
    if let Ok(categories) = budget_db::get_budget_status(&conn, year, month) {
        ctx.push_str("Budget Categories:\n");
        for cat in &categories {
            ctx.push_str(&format!(
                "  - {}: target {} cents, spent {} cents\n",
                cat.name, cat.target_cents, cat.spent_cents
            ));
        }
        ctx.push('\n');
    }

    // Accounts
    if let Ok(accounts) = account_db::get_all_accounts(&conn) {
        ctx.push_str("Accounts:\n");
        for acc in &accounts {
            ctx.push_str(&format!(
                "  - {} ({}, {}): {} cents\n",
                acc.name, acc.institution, acc.account_type, acc.balance_cents
            ));
        }
        ctx.push('\n');
    }

    // Assets
    if let Ok(assets) = asset_db::get_all_assets(&conn) {
        ctx.push_str("Assets:\n");
        for asset in &assets {
            ctx.push_str(&format!(
                "  - {} ({}): {} cents\n",
                asset.name, asset.asset_type, asset.value_cents
            ));
        }
        ctx.push('\n');
    }

    // Income this month
    let current_year = now.format("%Y").to_string().parse::<i32>().unwrap_or(2026);
    let current_month_num = now.format("%m").to_string().parse::<u32>().unwrap_or(1);
    let month_entries = income_db::get_income_entries_by_month(&conn, current_year, current_month_num)
        .unwrap_or_default();

    if month_entries.is_empty() {
        ctx.push_str("No income recorded for the current month.\n\n");
    } else {
        ctx.push_str("Income this month:\n");
        for entry in &month_entries {
            ctx.push_str(&format!(
                "  - {} ({}): ${:.2}\n",
                entry.source_name,
                entry.income_type,
                entry.amount_cents as f64 / 100.0
            ));
        }
        if let Ok(total) = income_db::get_income_total(&conn, current_year, current_month_num) {
            ctx.push_str(&format!(
                "Total income: ${:.2}\n",
                total.total_cents as f64 / 100.0
            ));
        }
        ctx.push('\n');
    }

    if let Ok(vehicles) = maintenance_db::get_all_vehicles(&conn) {
        if vehicles.is_empty() {
            ctx.push_str("Maintenance Tracking: No vehicles registered.\n\n");
        } else {
            let alert_count = maintenance_db::get_maintenance_alert_summary(&conn)
                .map(|s| s.total_alerts)
                .unwrap_or(0);

            ctx.push_str("Maintenance Tracking:\n");
            ctx.push_str(&format!("  Vehicles: {}\n", vehicles.len()));
            if alert_count > 0 {
                ctx.push_str(&format!(
                    "  Alerts: {} tasks need attention\n",
                    alert_count
                ));
            } else {
                ctx.push_str("  Alerts: 0 tasks need attention\n");
            }
            ctx.push('\n');

            for vehicle in &vehicles {
                ctx.push_str(&format!(
                    "  - {} (id={}, odometer={} km)\n",
                    vehicle.nickname, vehicle.id, vehicle.odometer_km
                ));
            }
            ctx.push('\n');
        }
    }

    Ok(ctx)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn send_chat_message(
    app: AppHandle,
    db_state: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
    message: String,
    conversation_id: Option<i64>,
    agent_id: String,
) -> Result<SendMessageResult, AppError> {
    // Snapshot the BYO provider before any await point. Chat's tool protocol is
    // Bedrock-shaped, but that rule lives once in the backend port's support
    // matrix; `None` is no longer terminal because hosted Bedrock may serve a
    // premium user who configured no BYO credentials.
    let byo = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        clone_provider(&ai.provider)
    };

    // Create or use existing conversation
    let conv_id = if let Some(id) = conversation_id {
        id
    } else {
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        let title: String = message.chars().take(40).collect();
        let title = title.trim().to_string();
        let conv = chat_db::create_conversation(&conn, Some(&title), &agent_id)?;
        conv.id
    };

    // Insert user message
    let user_msg = {
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        chat_db::insert_message(&conn, conv_id, "user", &message, "chat")?
    };

    info!("Chat message received, conversation: {}", conv_id);

    // Build context and system prompt
    let context = build_context(&db_state)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = chat_ai::build_system_prompt(&agent_id, &today, &context);

    // Load conversation history (includes user message just inserted above)
    let history = build_history_turns(&db_state, conv_id)?;

    // First LLM call. Routed through the port on its own, so the second
    // (post-tool-call) invocation below re-evaluates precedence independently and
    // may legitimately resolve to a different provider (AD-9).
    let first_response = chat_ai::stream_chat_response(
        byo.as_ref(),
        &app,
        history,
        &system_prompt,
    )
    .await
    .map_err(|e| {
        error!("Chat AI error: {}", e);
        e
    })?;

    // Check for tool call
    let final_response = if let Some(tool_call) = chat_ai::parse_tool_call(&first_response) {
        info!("Tool call detected: {}", tool_call.tool);

        // Save tool-call assistant message
        {
            let active = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            chat_db::insert_message(&conn, conv_id, "assistant", &first_response, "tool_call")?;
        }

        // Emit tool-executing event
        let _ = app.emit("chat:tool-executing", &tool_call.tool);

        // Execute the tool
        let tool_result = execute_tool_call(&db_state, &tool_call)?;

        // Save tool-result user message
        {
            let active = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            chat_db::insert_message(&conn, conv_id, "user", &tool_result, "tool_result")?;
        }

        // Reload full history (now includes tool-call and tool-result saved above)
        let history2 = build_history_turns(&db_state, conv_id)?;

        // A second, fully independent routing decision: quota may have changed
        // between the two Bedrock invocations of this one visible turn.
        chat_ai::stream_chat_response(
            byo.as_ref(),
            &app,
            history2,
            &system_prompt,
        )
        .await
        .map_err(|e| {
            error!("Chat AI error (tool follow-up): {}", e);
            e
        })?
    } else {
        first_response
    };

    // Strip any residual tool_call blocks from final response (1-round limit)
    let final_response = regex::Regex::new(r"```tool_call\s*\n[\s\S]*?```")
        .map(|re| re.replace_all(&final_response, "").trim().to_string())
        .unwrap_or(final_response);

    // Save final AI response
    {
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        chat_db::insert_message(&conn, conv_id, "assistant", &final_response, "chat")?;
    }

    Ok(SendMessageResult {
        conversation_id: conv_id,
        user_message_id: user_msg.id,
    })
}

// The model quotes integers about as often as it emits them bare.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum LooseInt {
    Int(i64),
    Text(String),
}

impl LooseInt {
    fn value(&self) -> Option<i64> {
        match self {
            Self::Int(v) => Some(*v),
            Self::Text(s) => s.trim().parse().ok(),
        }
    }
}

// `category_id` is captured only to reject it: a numeric id echoed back by the model can be
// guessed or carried over from an earlier turn, so names are the only category reference.
#[derive(Debug, Clone, Default, Deserialize)]
struct AiExpenseQuery {
    date_from: Option<String>,
    date_to: Option<String>,
    merchant: Option<String>,
    category_name: Option<serde_json::Value>,
    category_id: Option<serde_json::Value>,
    limit: Option<LooseInt>,
    sort: Option<String>,
}

fn invalid_category_name(message: impl Into<String>) -> AppError {
    AppError::Validation {
        message: message.into(),
        field: Some("category_name".to_string()),
    }
}

fn expense_filters_from_params(
    params: &serde_json::Value,
) -> Result<expense_db::ExpenseSearchFilters, AppError> {
    let query: AiExpenseQuery =
        serde_json::from_value(params.clone()).map_err(|e| AppError::Validation {
            message: format!("query_expenses params are not valid: {}", e),
            field: None,
        })?;

    let category_name = match query.category_name {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(name)) => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Err(invalid_category_name(
                    "category_name must not be blank; omit it to search every category",
                ));
            }
            Some(trimmed.to_string())
        }
        Some(_) => {
            return Err(invalid_category_name(
                "category_name must be the category's name as text",
            ))
        }
    };

    let has_category_id = query.category_id.is_some_and(|value| !value.is_null());
    if has_category_id && category_name.is_none() {
        return Err(invalid_category_name(
            "query_expenses has no category_id parameter; pass the category's name as category_name",
        ));
    }

    Ok(expense_db::ExpenseSearchFilters {
        date_from: query.date_from,
        date_to: query.date_to,
        merchant: query.merchant,
        category_id: None,
        category_name,
        limit: query.limit.and_then(|limit| limit.value()),
        sort: query.sort,
    })
}

fn resolve_action_category_id(
    conn: &rusqlite::Connection,
    params: &serde_json::Value,
) -> Result<i64, AppError> {
    let name = params
        .get("category_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim();

    if name.is_empty() {
        return Err(invalid_category_name("category_name is required"));
    }

    match budget_db::resolve_active_category_id_by_name(conn, name)? {
        budget_db::CategoryNameMatch::Unique(id) => Ok(id),
        budget_db::CategoryNameMatch::Missing => Err(invalid_category_name(format!(
            "No active budget category named \"{}\"",
            name
        ))),
        budget_db::CategoryNameMatch::Ambiguous => Err(invalid_category_name(format!(
            "More than one active budget category is named \"{}\" — ask for a more specific category",
            name
        ))),
    }
}

fn create_expense_action(
    conn: &rusqlite::Connection,
    params: &serde_json::Value,
) -> Result<String, AppError> {
    let budget_category_id = resolve_action_category_id(conn, params)?;
    let input = CreateExpenseInput {
        merchant: params["merchant"].as_str().unwrap_or("").to_string(),
        amount_cents: params["amount_cents"].as_i64().unwrap_or(0),
        budget_category_id,
        date: params["date"].as_str().unwrap_or("").to_string(),
        account_id: None,
    };
    let expense = expense_db::insert_expense(conn, &input)?;
    Ok(format!(
        "Done. ${:.2} expense added for {}.",
        expense.amount_cents as f64 / 100.0,
        expense.merchant
    ))
}

fn execute_tool_call(
    db_state: &State<DbState>,
    tool_call: &chat_ai::ToolCallRequest,
) -> Result<String, AppError> {
    match tool_call.tool.as_str() {
        "query_expenses" => {
            let filters = expense_filters_from_params(&tool_call.params)?;
            let active = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            let results = expense_db::search_expenses(&conn, &filters)?;
            info!("Tool query_expenses returned {} results", results.len());
            Ok(chat_ai::format_tool_result(&filters, &results))
        }
        "query_maintenance_status" => {
            let filters = maintenance_db::MaintenanceStatusFilters {
                vehicle_id: tool_call
                    .params
                    .get("vehicle_id")
                    .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
                status_filter: tool_call
                    .params
                    .get("status_filter")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            };
            let active = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            let results = maintenance_db::query_maintenance_status(&conn, &filters)?;
            info!(
                "Tool query_maintenance_status returned {} results",
                results.len()
            );
            Ok(chat_ai::format_maintenance_status_result(&results))
        }
        "query_maintenance_history" => {
            let vehicle_id = tool_call
                .params
                .get("vehicle_id")
                .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .ok_or_else(|| AppError::Validation {
                    message: "vehicle_id is required for query_maintenance_history".to_string(),
                    field: Some("vehicle_id".to_string()),
                })?;
            let filters = maintenance_db::MaintenanceHistoryFilters {
                vehicle_id,
                task_type_key: tool_call
                    .params
                    .get("task_type_key")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                limit: tool_call
                    .params
                    .get("limit")
                    .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
            };
            let active = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            let results = maintenance_db::query_maintenance_history(&conn, &filters)?;
            info!(
                "Tool query_maintenance_history returned {} results",
                results.len()
            );
            Ok(chat_ai::format_maintenance_history_result(&results))
        }
        _ => Ok(format!("Tool result: Unknown tool '{}'", tool_call.tool)),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_chat_messages(
    state: State<DbState>,
    conversation_id: i64,
) -> Result<Vec<chat_db::ChatMessage>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    if !chat_db::conversation_exists(&conn, conversation_id)? {
        return Err(AppError::Validation {
            message: "Conversation not found".to_string(),
            field: Some("conversation_id".to_string()),
        });
    }
    chat_db::get_conversation_messages_for_display(&conn, conversation_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_conversations(
    state: State<DbState>,
    agent_id: String,
) -> Result<Vec<chat_db::ChatConversation>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    chat_db::list_conversations_by_agent(&conn, &agent_id)
}

#[derive(Serialize)]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command(rename_all = "snake_case")]
pub fn execute_chat_action(
    state: State<DbState>,
    action_type: String,
    params: serde_json::Value,
    conversation_id: i64,
) -> Result<ActionResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let result_msg = match action_type.as_str() {
        "create_expense" => create_expense_action(conn, &params)?,
        "update_balance" => {
            let account_id = params["account_id"].as_i64().ok_or_else(|| AppError::Validation {
                message: "account_id is required".to_string(),
                field: Some("account_id".to_string()),
            })?;
            let balance_cents = params["balance_cents"].as_i64().ok_or_else(|| AppError::Validation {
                message: "balance_cents is required".to_string(),
                field: Some("balance_cents".to_string()),
            })?;
            let (_, account) = account_db::update_account_balance(&conn, account_id, balance_cents)?;
            format!(
                "Done. {} balance updated to ${:.2}.",
                account.name,
                account.balance_cents as f64 / 100.0
            )
        }
        "create_account" => {
            let input = CreateAccountInput {
                name: params["name"].as_str().unwrap_or("").to_string(),
                institution: params["institution"].as_str().unwrap_or("").to_string(),
                account_type: params["account_type"].as_str().unwrap_or("chequing").to_string(),
                currency: params["currency"].as_str().unwrap_or("CAD").to_string(),
            };
            let account = account_db::insert_account(&conn, &input)?;
            format!("Done. Account \"{}\" created.", account.name)
        }
        "update_asset_value" => {
            let asset_id = params["asset_id"].as_i64().ok_or_else(|| AppError::Validation {
                message: "asset_id is required".to_string(),
                field: Some("asset_id".to_string()),
            })?;
            let value_cents = params["value_cents"].as_i64().ok_or_else(|| AppError::Validation {
                message: "value_cents is required".to_string(),
                field: Some("value_cents".to_string()),
            })?;
            let (_, asset) = asset_db::update_asset_value(&conn, asset_id, value_cents)?;
            format!(
                "Done. {} value updated to ${:.2}.",
                asset.name,
                asset.value_cents as f64 / 100.0
            )
        }
        _ => {
            return Err(AppError::Validation {
                message: format!("Unknown action type: {}", action_type),
                field: None,
            });
        }
    };

    // Audit log
    let details = serde_json::to_string(&params).unwrap_or_default();
    audit_db::insert_audit_log(&conn, &action_type, 0, "chat_action", None, Some(&details))?;

    // Insert success message into chat
    chat_db::insert_message(&conn, conversation_id, "assistant", &result_msg, "chat")?;

    // The action type only: `result_msg` carries the merchant and amount, which is
    // transaction content and must not reach an app log (AD-11). The user's own
    // audit-log row above is the intended record and stays complete.
    info!("Chat action executed: {}", action_type);

    Ok(ActionResult {
        success: true,
        message: result_msg,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    fn category_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                deleted_at TEXT
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                account_id INTEGER,
                date TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO budget_categories (id, group_id, name) VALUES (11, 1, 'Vacation');
            INSERT INTO budget_categories (id, group_id, name) VALUES (12, 1, 'Cloud');",
        )
        .unwrap();
        conn
    }

    fn expense_rows(conn: &Connection) -> Vec<(String, i64, i64)> {
        let mut stmt = conn
            .prepare("SELECT merchant, amount_cents, budget_category_id FROM expenses ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn vacation_expense_params() -> serde_json::Value {
        json!({
            "merchant": "Air Canada",
            "amount_cents": 45_000,
            "category_name": "Vacation",
            "date": "2026-06-02"
        })
    }

    fn validation_field(err: &AppError) -> Option<&str> {
        match err {
            AppError::Validation { field, .. } => field.as_deref(),
            _ => None,
        }
    }

    fn validation_message(err: &AppError) -> String {
        match err {
            AppError::Validation { message, .. } => message.clone(),
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    fn chat_row(id: i64, role: &str, content: &str, message_type: &str) -> chat_db::ChatMessage {
        chat_db::ChatMessage {
            id,
            conversation_id: 1,
            role: role.to_string(),
            content: content.to_string(),
            message_type: message_type.to_string(),
            created_at: "2026-08-25 10:00:00".to_string(),
        }
    }

    fn roles(turns: &[(ConversationRole, String)]) -> Vec<ConversationRole> {
        turns.iter().map(|(role, _)| role.clone()).collect()
    }

    #[test]
    fn expense_filters_from_params_maps_category_name_and_date_bounds() {
        let params = json!({
            "category_name": "Groceries",
            "date_from": "2025-12-24",
            "date_to": "2026-03-24"
        });

        let filters = expense_filters_from_params(&params).unwrap();

        assert_eq!(filters.category_name.as_deref(), Some("Groceries"));
        assert_eq!(filters.date_from.as_deref(), Some("2025-12-24"));
        assert_eq!(filters.date_to.as_deref(), Some("2026-03-24"));
        assert_eq!(filters.merchant, None);
        assert_eq!(filters.category_id, None);
        assert_eq!(filters.limit, None);
        assert_eq!(filters.sort, None);
    }

    #[test]
    fn expense_filters_from_params_maps_every_field_the_tool_advertises() {
        let params = json!({
            "date_from": "2026-01-01",
            "date_to": "2026-01-31",
            "merchant": "Costco",
            "category_name": "Groceries",
            "limit": 10,
            "sort": "date_asc"
        });

        let filters = expense_filters_from_params(&params).unwrap();

        assert_eq!(filters.date_from.as_deref(), Some("2026-01-01"));
        assert_eq!(filters.date_to.as_deref(), Some("2026-01-31"));
        assert_eq!(filters.merchant.as_deref(), Some("Costco"));
        assert_eq!(filters.category_name.as_deref(), Some("Groceries"));
        assert_eq!(filters.limit, Some(10));
        assert_eq!(filters.sort.as_deref(), Some("date_asc"));
    }

    #[test]
    fn expense_filters_from_params_keeps_the_name_authoritative_over_a_stale_category_id() {
        let params = json!({ "category_id": 3, "category_name": "Vacation" });

        let filters = expense_filters_from_params(&params).unwrap();

        assert_eq!(filters.category_id, None);
        assert_eq!(filters.category_name.as_deref(), Some("Vacation"));
    }

    #[test]
    fn expense_filters_from_params_rejects_a_stale_category_id_supplied_alone() {
        let err = expense_filters_from_params(&json!({ "category_id": 3 })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn expense_filters_from_params_rejects_a_category_id_paired_with_a_blank_name() {
        let err = expense_filters_from_params(&json!({ "category_id": 3, "category_name": "  " }))
            .unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn expense_filters_from_params_accepts_a_null_category_id() {
        let filters =
            expense_filters_from_params(&json!({ "category_id": null, "merchant": "Costco" }))
                .unwrap();

        assert_eq!(filters.merchant.as_deref(), Some("Costco"));
        assert_eq!(filters.category_name, None);
    }

    #[test]
    fn expense_filters_from_params_rejects_a_blank_category_name() {
        let err = expense_filters_from_params(&json!({ "category_name": "   " })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn expense_filters_from_params_rejects_a_non_string_category_name() {
        let err = expense_filters_from_params(&json!({ "category_name": 7 })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn expense_filters_from_params_trims_a_padded_category_name() {
        let filters =
            expense_filters_from_params(&json!({ "category_name": "  Vacation  " })).unwrap();

        assert_eq!(filters.category_name.as_deref(), Some("Vacation"));
    }

    #[test]
    fn expense_filters_from_params_still_coerces_quoted_limits() {
        let filters = expense_filters_from_params(&json!({ "limit": "25" })).unwrap();

        assert_eq!(filters.limit, Some(25));
    }

    #[test]
    fn expense_filters_from_params_leaves_every_field_unset_when_params_are_empty() {
        let filters = expense_filters_from_params(&json!({})).unwrap();

        assert_eq!(filters.date_from, None);
        assert_eq!(filters.date_to, None);
        assert_eq!(filters.merchant, None);
        assert_eq!(filters.category_id, None);
        assert_eq!(filters.category_name, None);
        assert_eq!(filters.limit, None);
        assert_eq!(filters.sort, None);
    }

    #[test]
    fn expense_filters_from_params_ignores_parameters_the_tool_does_not_define() {
        let filters =
            expense_filters_from_params(&json!({ "merchant": "Costco", "vibe": "spendy" }))
                .unwrap();

        assert_eq!(filters.merchant.as_deref(), Some("Costco"));
    }

    #[test]
    fn expense_filters_from_params_rejects_a_non_string_date_bound() {
        let err = expense_filters_from_params(&json!({ "date_from": 20260101 })).unwrap_err();

        assert!(matches!(err, AppError::Validation { .. }));
    }

    #[test]
    fn resolve_action_category_id_returns_the_internal_id_for_a_unique_name() {
        let conn = category_test_db();

        let id =
            resolve_action_category_id(&conn, &json!({ "category_name": "Vacation" })).unwrap();

        assert_eq!(id, 11);
    }

    #[test]
    fn resolve_action_category_id_ignores_a_model_supplied_budget_category_id() {
        let conn = category_test_db();

        let id = resolve_action_category_id(
            &conn,
            &json!({ "category_name": "Vacation", "budget_category_id": 12 }),
        )
        .unwrap();

        assert_eq!(id, 11);
    }

    #[test]
    fn resolve_action_category_id_rejects_an_unknown_name() {
        let conn = category_test_db();

        let err = resolve_action_category_id(&conn, &json!({ "category_name": "Groceries" }))
            .unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn resolve_action_category_id_rejects_an_ambiguous_name() {
        let conn = category_test_db();
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name) VALUES (13, 1, 'vacation')",
            [],
        )
        .unwrap();

        let err =
            resolve_action_category_id(&conn, &json!({ "category_name": "Vacation" })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn resolve_action_category_id_rejects_a_payload_carrying_only_a_numeric_id() {
        let conn = category_test_db();

        let err =
            resolve_action_category_id(&conn, &json!({ "budget_category_id": 11 })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn resolve_action_category_id_rejects_a_blank_name() {
        let conn = category_test_db();

        let err =
            resolve_action_category_id(&conn, &json!({ "category_name": "   " })).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
    }

    #[test]
    fn create_expense_action_inserts_the_resolved_category_id() {
        let conn = category_test_db();

        create_expense_action(&conn, &vacation_expense_params()).unwrap();

        assert_eq!(
            expense_rows(&conn),
            vec![("Air Canada".to_string(), 45_000, 11)]
        );
    }

    #[test]
    fn create_expense_action_inserts_nothing_for_an_unknown_category_name() {
        let conn = category_test_db();
        let mut params = vacation_expense_params();
        params["category_name"] = json!("Groceries");

        let err = create_expense_action(&conn, &params).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
        assert!(expense_rows(&conn).is_empty());
    }

    #[test]
    fn create_expense_action_inserts_nothing_for_an_ambiguous_category_name() {
        let conn = category_test_db();
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name) VALUES (13, 1, 'vacation')",
            [],
        )
        .unwrap();

        let err = create_expense_action(&conn, &vacation_expense_params()).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
        assert!(expense_rows(&conn).is_empty());
    }

    #[test]
    fn create_expense_action_distinguishes_a_missing_category_from_an_ambiguous_one() {
        let conn = category_test_db();
        let mut unknown_params = vacation_expense_params();
        unknown_params["category_name"] = json!("Groceries");
        let missing =
            validation_message(&create_expense_action(&conn, &unknown_params).unwrap_err());

        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name) VALUES (13, 1, 'vacation')",
            [],
        )
        .unwrap();
        let ambiguous = validation_message(
            &create_expense_action(&conn, &vacation_expense_params()).unwrap_err(),
        );

        assert_ne!(missing, ambiguous);
        assert!(missing.contains("Groceries"));
        assert!(ambiguous.contains("Vacation"));
    }

    #[test]
    fn create_expense_action_inserts_nothing_when_the_category_name_is_absent() {
        let conn = category_test_db();
        let params = json!({
            "merchant": "Air Canada",
            "amount_cents": 45_000,
            "budget_category_id": 11,
            "date": "2026-06-02"
        });

        let err = create_expense_action(&conn, &params).unwrap_err();

        assert_eq!(validation_field(&err), Some("category_name"));
        assert!(expense_rows(&conn).is_empty());
    }

    #[test]
    fn alternating_turns_merges_a_user_turn_orphaned_by_a_dropped_tool_exchange() {
        let history = [
            chat_row(1, "user", "cloud costs?", "chat"),
            chat_row(4, "user", "vacation expenses?", "chat"),
        ];

        let turns = alternating_turns(&history);

        assert_eq!(roles(&turns), vec![ConversationRole::User]);
        assert!(turns[0].1.contains("cloud costs?"));
        assert!(turns[0].1.contains("vacation expenses?"));
    }

    #[test]
    fn alternating_turns_never_repeats_a_role() {
        let history = [
            chat_row(1, "user", "first", "chat"),
            chat_row(2, "user", "second", "chat"),
            chat_row(3, "assistant", "answer", "chat"),
            chat_row(4, "assistant", "tool call", "tool_call"),
            chat_row(5, "user", "tool result", "tool_result"),
        ];

        let turns = alternating_turns(&history);

        for pair in roles(&turns).windows(2) {
            assert_ne!(pair[0], pair[1]);
        }
    }

    #[test]
    fn alternating_turns_starts_with_the_user() {
        let history = [
            chat_row(1, "assistant", "leftover answer", "chat"),
            chat_row(2, "user", "vacation expenses?", "chat"),
            chat_row(3, "assistant", "tool call", "tool_call"),
            chat_row(4, "user", "tool result", "tool_result"),
        ];

        let turns = alternating_turns(&history);

        assert_eq!(
            roles(&turns),
            vec![
                ConversationRole::User,
                ConversationRole::Assistant,
                ConversationRole::User,
            ]
        );
        assert!(!turns[0].1.contains("leftover answer"));
    }

    #[test]
    fn alternating_turns_drops_a_trailing_assistant_turn() {
        let history = [
            chat_row(1, "user", "vacation expenses?", "chat"),
            chat_row(2, "assistant", "unanswered", "chat"),
        ];

        let turns = alternating_turns(&history);

        assert_eq!(roles(&turns), vec![ConversationRole::User]);
    }

    #[test]
    fn alternating_turns_keeps_a_healthy_tool_exchange_intact() {
        let history = [
            chat_row(1, "user", "vacation expenses?", "chat"),
            chat_row(2, "assistant", "tool call", "tool_call"),
            chat_row(3, "user", "tool result", "tool_result"),
        ];

        let turns = alternating_turns(&history);

        assert_eq!(
            roles(&turns),
            vec![
                ConversationRole::User,
                ConversationRole::Assistant,
                ConversationRole::User,
            ]
        );
    }

    #[test]
    fn alternating_turns_is_empty_for_an_empty_history() {
        assert!(alternating_turns(&[]).is_empty());
    }

    #[test]
    fn alternating_turns_skips_rows_with_an_unknown_role() {
        let history = [
            chat_row(1, "system", "ignored", "chat"),
            chat_row(2, "user", "vacation expenses?", "chat"),
        ];

        let turns = alternating_turns(&history);

        assert_eq!(roles(&turns), vec![ConversationRole::User]);
        assert_eq!(turns[0].1, "vacation expenses?");
    }
}
