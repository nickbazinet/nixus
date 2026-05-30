use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};

use crate::ai::chat as chat_ai;
use crate::ai::{AiProvider, AiState};
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

fn build_history_messages(
    db_state: &State<DbState>,
    conv_id: i64,
) -> Result<Vec<aws_sdk_bedrockruntime::types::Message>, AppError> {
    let conn = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let db_messages = chat_db::get_conversation_messages(&conn, conv_id)?;

    let mut messages = Vec::new();
    for msg in &db_messages {
        let role = match msg.role.as_str() {
            "user" => aws_sdk_bedrockruntime::types::ConversationRole::User,
            "assistant" => aws_sdk_bedrockruntime::types::ConversationRole::Assistant,
            _ => continue,
        };
        messages.push(chat_ai::build_message(role, &msg.content)?);
    }

    // Drop trailing assistant message to maintain valid alternation (partial tool-call failure edge case)
    if db_messages.last().is_some_and(|m| m.role == "assistant") {
        messages.pop();
    }

    Ok(messages)
}

fn build_context(db_state: &State<DbState>) -> Result<String, AppError> {
    let conn = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    // Extract Bedrock client before any await points
    let bedrock_client = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        match &ai.provider {
            None => return Err(AppError::NotConfigured),
            Some(AiProvider::Bedrock(client)) => client.clone(),
            Some(AiProvider::OpenAI(_)) => return Err(AppError::NotConfigured),
        }
    };

    // Create or use existing conversation
    let conv_id = if let Some(id) = conversation_id {
        id
    } else {
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let title: String = message.chars().take(40).collect();
        let title = title.trim().to_string();
        let conv = chat_db::create_conversation(&conn, Some(&title), &agent_id)?;
        conv.id
    };

    // Insert user message
    let user_msg = {
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        chat_db::insert_message(&conn, conv_id, "user", &message, "chat")?
    };

    info!("Chat message received, conversation: {}", conv_id);

    // Build context and system prompt
    let context = build_context(&db_state)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = chat_ai::build_system_prompt(&agent_id, &today, &context);

    // Load conversation history (includes user message just inserted above)
    let history = build_history_messages(&db_state, conv_id)?;

    // First LLM call
    let first_response = chat_ai::stream_chat_response(
        &bedrock_client,
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
            let conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            chat_db::insert_message(&conn, conv_id, "assistant", &first_response, "tool_call")?;
        }

        // Emit tool-executing event
        let _ = app.emit("chat:tool-executing", &tool_call.tool);

        // Execute the tool
        let tool_result = execute_tool_call(&db_state, &tool_call)?;

        // Save tool-result user message
        {
            let conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            chat_db::insert_message(&conn, conv_id, "user", &tool_result, "tool_result")?;
        }

        // Reload full history (now includes tool-call and tool-result saved above)
        let history2 = build_history_messages(&db_state, conv_id)?;

        chat_ai::stream_chat_response(
            &bedrock_client,
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
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        chat_db::insert_message(&conn, conv_id, "assistant", &final_response, "chat")?;
    }

    Ok(SendMessageResult {
        conversation_id: conv_id,
        user_message_id: user_msg.id,
    })
}

fn execute_tool_call(
    db_state: &State<DbState>,
    tool_call: &chat_ai::ToolCallRequest,
) -> Result<String, AppError> {
    match tool_call.tool.as_str() {
        "query_expenses" => {
            let filters = expense_db::ExpenseSearchFilters {
                date_from: tool_call.params.get("date_from").and_then(|v| v.as_str()).map(String::from),
                date_to: tool_call.params.get("date_to").and_then(|v| v.as_str()).map(String::from),
                merchant: tool_call.params.get("merchant").and_then(|v| v.as_str()).map(String::from),
                category_id: tool_call.params.get("category_id").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
                limit: tool_call.params.get("limit").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
                sort: tool_call.params.get("sort").and_then(|v| v.as_str()).map(String::from),
            };
            let conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
            let results = expense_db::search_expenses(&conn, &filters)?;
            info!("Tool query_expenses returned {} results", results.len());
            Ok(chat_ai::format_tool_result(&results))
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
            let conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
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
            let conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;
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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let result_msg = match action_type.as_str() {
        "create_expense" => {
            let input = CreateExpenseInput {
                merchant: params["merchant"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                amount_cents: params["amount_cents"].as_i64().unwrap_or(0),
                budget_category_id: params["budget_category_id"].as_i64().unwrap_or(0),
                date: params["date"].as_str().unwrap_or("").to_string(),
            };
            let expense = expense_db::insert_expense(&conn, &input)?;
            format!(
                "Done. ${:.2} expense added for {}.",
                expense.amount_cents as f64 / 100.0,
                expense.merchant
            )
        }
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

    info!("Chat action executed: {} -> {}", action_type, result_msg);

    Ok(ActionResult {
        success: true,
        message: result_msg,
    })
}
