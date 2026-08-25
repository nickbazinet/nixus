use aws_sdk_bedrockruntime::Client;
use aws_sdk_bedrockruntime::types::{
    ContentBlock, ConversationRole, Message, SystemContentBlock,
};
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

use crate::error::AppError;

const MODEL_ID: &str = "us.anthropic.claude-sonnet-4-6";

#[derive(Clone, serde::Serialize)]
struct ChatResponseChunk {
    chunk: String,
    done: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ToolCallRequest {
    pub tool: String,
    pub params: serde_json::Value,
}

// Single-arm match is the extension point for additional agent prompts.
#[allow(clippy::match_single_binding)]
pub fn build_system_prompt(agent_id: &str, today: &str, context: &str) -> String {
    match agent_id {
        _ => build_budget_helper_prompt(today, context),
    }
}

fn build_budget_helper_prompt(today: &str, context: &str) -> String {
    format!(
        r#"You are a helpful financial assistant for a personal finance app. Answer the user's questions about their financial data using the context provided below.

Guidelines:
- Today's date is {today}.
- Use monospace formatting (backticks) for dollar amounts
- When comparing categories or accounts, use a simple table format
- Be concise and direct
- If the data doesn't contain what the user asks about, say so honestly
- All amounts are in cents in the data; convert to dollars for display

## Tools

You have access to tools to query detailed data. To use a tool, respond with ONLY a JSON block:

```tool_call
{{
  "tool": "query_expenses",
  "params": {{
    "date_from": "2026-01-01",
    "date_to": "2026-01-31",
    "merchant": "Costco",
    "category_name": "Groceries",
    "limit": 10,
    "sort": "date_desc"
  }}
}}
```

Available tools:
- **query_expenses**: Search expense records. All params are optional.
  - `date_from` (string, YYYY-MM-DD): Start date (inclusive)
  - `date_to` (string, YYYY-MM-DD): End date (inclusive)
  - `merchant` (string): Partial match on merchant name
  - `category_name` (string): Partial match on the budget category name. Case-insensitive for ASCII letters only — accented or non-Latin characters must match the stored case exactly
  - `limit` (integer): Max results, default 50, max 100
  - `sort` (string): "date_asc" or "date_desc" (default)

Categories are referenced by name only; there is no category ID parameter. When the user names a category ("expenses for Groceries"), pass that name as `category_name` — do not ask the user for a category ID. Matching is partial, so a name fragment works, and every category sharing that name is included. Use a tool when you need expense details not available in the current context. For relative periods ("the past 3 months", "last month"), compute absolute `date_from` and `date_to` values from today's date and pass those; there is no relative-period parameter. A `query_expenses` result lists the filters, limit and sort that were actually applied — trust those over anything from earlier in the conversation, and if it reports that the limit was reached, say the list may be incomplete. After receiving tool results, answer the user's question using that data. When presenting multiple expenses, use a table format. Always convert cents to dollars for display.

- **query_maintenance_status**: Get maintenance task status for vehicles. All params optional.
  - `vehicle_id` (integer): Filter to one vehicle. Omit for all vehicles.
  - `status_filter` (string): "upcoming", "due", "overdue", or "all" (default)

- **query_maintenance_history**: Get service log history for a vehicle.
  - `vehicle_id` (integer, required): Vehicle to query
  - `task_type_key` (string, optional): Filter to one task type (e.g. "engine_oil_filter")
  - `limit` (integer): Max results, default 20, max 50

Use maintenance tools when the user asks about vehicle maintenance schedules, due dates, service history, or odometer-related upkeep. Custom service logs (not tied to a scheduled task) appear in history with their free-text service name. Match vehicles by their display label (year, make, model — case-insensitive partial match) when the user says "Civic" etc., then pass the resolved `vehicle_id`. Never fabricate maintenance data — if no vehicles are registered, say so.

Maintenance data model: each vehicle has a display label derived from year/make/model and a current odometer (km). New vehicles get 12 default maintenance task types with km and/or time intervals. Status is computed from km OR time thresholds (whichever is worse): ok, upcoming, due, overdue. Default task type keys: engine_oil_filter, transmission_fluid, brake_fluid, coolant, power_steering_fluid, brake_pads, brake_discs, engine_air_filter, cabin_air_filter, spark_plugs, shock_absorbers, battery_replacement. Older vehicles may still have tire_rotation or tire_replacement tasks. Map user phrases: "oil change" → engine_oil_filter; "brake pads" → brake_pads; "rotors" or "disc brakes" → brake_discs; "battery" → battery_replacement.

## Actions

When the user asks you to PERFORM AN ACTION (add expense, update balance, create account, update asset value), respond with ONLY a JSON block in this exact format:

```action
{{
  "action": true,
  "action_type": "create_expense",
  "display": {{
    "label": "Add Expense",
    "details": [
      {{ "field": "Merchant", "value": "Costco" }},
      {{ "field": "Amount", "value": "$45.00" }},
      {{ "field": "Category", "value": "Groceries" }},
      {{ "field": "Date", "value": "2026-03-14" }}
    ]
  }},
  "params": {{
    "merchant": "Costco",
    "amount_cents": 4500,
    "category_name": "Groceries",
    "date": "2026-03-14"
  }}
}}
```

Valid action_types: "create_expense", "update_balance", "create_account", "update_asset_value"
- For create_expense: params must include merchant, amount_cents, category_name, date
- For update_balance: params must include account_id, balance_cents
- For create_account: params must include name, institution, account_type, currency
- For update_asset_value: params must include asset_id, value_cents

For create_expense, `category_name` must be the exact full name of one category listed in the data — never a numeric ID and never a fragment. If two listed categories share that name, or none matches, ask the user which category to use.
If you cannot determine a required field, ask the user for clarification instead of guessing.

For data QUERIES (not actions), respond with plain text as normal.

Current Financial Data:
{}
"#,
        context
    )
}

pub fn parse_tool_call(response: &str) -> Option<ToolCallRequest> {
    static RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"```tool_call\s*\n([\s\S]*?)```").unwrap());
    let caps = RE.captures(response)?;
    let json_str = caps.get(1)?.as_str().trim();
    serde_json::from_str(json_str).ok()
}

fn describe_applied_filters(filters: &crate::db::expense::ExpenseSearchFilters) -> String {
    let quoted =
        |value: &str| serde_json::to_string(value).unwrap_or_else(|_| format!("{:?}", value));

    let mut parts: Vec<String> = Vec::new();
    if let Some(ref category_name) = filters.category_name {
        parts.push(format!("category_name={}", quoted(category_name)));
    }
    if let Some(ref merchant) = filters.merchant {
        parts.push(format!("merchant={}", quoted(merchant)));
    }
    if let Some(ref date_from) = filters.date_from {
        parts.push(format!("date_from={}", quoted(date_from)));
    }
    if let Some(ref date_to) = filters.date_to {
        parts.push(format!("date_to={}", quoted(date_to)));
    }
    parts.push(format!("limit={}", filters.effective_limit()));
    parts.push(format!("sort={}", quoted(filters.effective_sort())));
    parts.join(", ")
}

pub fn format_tool_result(
    filters: &crate::db::expense::ExpenseSearchFilters,
    results: &[crate::db::expense::ExpenseSearchResult],
) -> String {
    let applied = describe_applied_filters(filters);
    if results.is_empty() {
        return format!(
            "Tool result for query_expenses (applied filters: {}): No expenses found matching the query.",
            applied
        );
    }

    let truncated = results.len() as i64 >= filters.effective_limit();
    let mut out = format!(
        "Tool result for query_expenses (applied filters: {}): {} expense(s) found{}:\n",
        applied,
        results.len(),
        if truncated {
            " (limit reached, more may exist)"
        } else {
            ""
        }
    );
    out.push_str("| Date | Merchant | Amount | Category |\n");
    out.push_str("|------|----------|--------|----------|\n");
    for r in results {
        out.push_str(&format!(
            "| {} | {} | ${:.2} | {} |\n",
            r.date, r.merchant, r.amount_cents as f64 / 100.0, r.category_name
        ));
    }
    out
}

pub fn format_maintenance_status_result(
    rows: &[crate::db::maintenance::MaintenanceStatusRow],
) -> String {
    if rows.is_empty() {
        return "Tool result: No maintenance data found matching the query.".to_string();
    }
    let mut out = format!("Tool result: {} maintenance task(s) found:\n", rows.len());
    out.push_str("| Vehicle | Task | Status | Next Due Date | Next Due Km | Km Remaining | Days Remaining |\n");
    out.push_str("|---------|------|--------|---------------|-------------|--------------|----------------|\n");
    for r in rows {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            r.vehicle_nickname,
            r.task_type_key,
            r.status,
            r.next_due_date.as_deref().unwrap_or("-"),
            r.next_due_odometer_km
                .map(|km| km.to_string())
                .unwrap_or_else(|| "-".to_string()),
            r.km_remaining
                .map(|km| km.to_string())
                .unwrap_or_else(|| "-".to_string()),
            r.days_remaining
                .map(|d| d.to_string())
                .unwrap_or_else(|| "-".to_string()),
        ));
    }
    out
}

pub fn format_maintenance_history_result(
    rows: &[crate::db::maintenance::MaintenanceHistoryRow],
) -> String {
    if rows.is_empty() {
        return "Tool result: No service history found.".to_string();
    }
    let mut out = format!("Tool result: {} service log(s) found:\n", rows.len());
    out.push_str("| Date | Task | Odometer (km) | Notes |\n");
    out.push_str("|------|------|---------------|-------|\n");
    for r in rows {
        out.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            r.service_date,
            r.service_name,
            r.odometer_km,
            r.notes.as_deref().unwrap_or("-"),
        ));
    }
    out
}

pub async fn stream_chat_response(
    client: &Client,
    app: &AppHandle,
    messages: Vec<Message>,
    system_prompt: &str,
) -> Result<String, AppError> {
    info!("Sending chat message to Bedrock ({} messages)", messages.len());

    let mut req = client
        .converse_stream()
        .model_id(MODEL_ID)
        .system(SystemContentBlock::Text(system_prompt.to_string()));

    for msg in messages {
        req = req.messages(msg);
    }

    let mut stream_resp = req.send().await.map_err(|e| {
        error!("Bedrock API error details: {:?}", e);
        AppError::AiService {
            message: format!("Bedrock streaming error: {:?}", e),
            recoverable: true,
        }
    })?;

    let mut full_response = String::new();

    loop {
        let event_result: Result<
            Option<aws_sdk_bedrockruntime::types::ConverseStreamOutput>,
            _,
        > = stream_resp.stream.recv().await;

        match event_result {
            Ok(Some(event)) => {
                if let aws_sdk_bedrockruntime::types::ConverseStreamOutput::ContentBlockDelta(
                    delta,
                ) = event
                {
                    if let Some(text_delta) = delta.delta() {
                        if let Ok(text) = text_delta.as_text() {
                            full_response.push_str(text);
                            let _ = app.emit(
                                "chat:response-chunk",
                                ChatResponseChunk {
                                    chunk: text.to_string(),
                                    done: false,
                                },
                            );
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                error!("Stream error: {}", e);
                return Err(AppError::AiService {
                    message: format!("Stream error: {}", e),
                    recoverable: true,
                });
            }
        }
    }

    // Signal completion
    let _ = app.emit(
        "chat:response-chunk",
        ChatResponseChunk {
            chunk: String::new(),
            done: true,
        },
    );

    info!("Chat response complete ({} chars)", full_response.len());

    Ok(full_response)
}

pub fn build_message(role: ConversationRole, text: &str) -> Result<Message, AppError> {
    Message::builder()
        .role(role)
        .content(ContentBlock::Text(text.to_string()))
        .build()
        .map_err(|e| AppError::AiService {
            message: format!("Failed to build message: {}", e),
            recoverable: false,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::expense::{ExpenseSearchFilters, ExpenseSearchResult};

    fn vacation_filters() -> ExpenseSearchFilters {
        ExpenseSearchFilters {
            category_name: Some("Vacation".to_string()),
            date_from: Some("2026-04-25".to_string()),
            date_to: Some("2026-08-25".to_string()),
            ..ExpenseSearchFilters::default()
        }
    }

    fn vacation_row() -> ExpenseSearchResult {
        ExpenseSearchResult {
            id: 1,
            merchant: "Air Canada".to_string(),
            amount_cents: 45_000,
            category_name: "Vacation".to_string(),
            date: "2026-06-02".to_string(),
            source: "manual".to_string(),
        }
    }

    #[test]
    fn format_tool_result_reports_the_applied_category_and_date_bounds() {
        let out = format_tool_result(&vacation_filters(), &[vacation_row()]);

        assert!(out.contains("category_name=\"Vacation\""));
        assert!(out.contains("date_from=\"2026-04-25\""));
        assert!(out.contains("date_to=\"2026-08-25\""));
        assert!(out.contains("Air Canada"));
    }

    #[test]
    fn format_tool_result_reports_the_applied_category_when_nothing_matched() {
        let out = format_tool_result(&vacation_filters(), &[]);

        assert!(out.contains("category_name=\"Vacation\""));
    }

    #[test]
    fn format_tool_result_reports_the_effective_limit_and_sort_defaults() {
        let out = format_tool_result(&ExpenseSearchFilters::default(), &[vacation_row()]);

        assert!(out.contains("limit=50"));
        assert!(out.contains("sort=\"date_desc\""));
    }

    #[test]
    fn format_tool_result_reports_the_clamped_limit_and_requested_sort() {
        let filters = ExpenseSearchFilters {
            limit: Some(5_000),
            sort: Some("date_asc".to_string()),
            ..ExpenseSearchFilters::default()
        };

        let out = format_tool_result(&filters, &[vacation_row()]);

        assert!(out.contains("limit=100"));
        assert!(out.contains("sort=\"date_asc\""));
    }

    #[test]
    fn format_tool_result_normalizes_an_unknown_sort_to_the_search_default() {
        let filters = ExpenseSearchFilters {
            sort: Some("amount_desc".to_string()),
            ..ExpenseSearchFilters::default()
        };

        let out = format_tool_result(&filters, &[vacation_row()]);

        assert!(out.contains("sort=\"date_desc\""));
    }

    #[test]
    fn format_tool_result_flags_truncation_when_the_row_count_reaches_the_limit() {
        let filters = ExpenseSearchFilters {
            limit: Some(1),
            ..ExpenseSearchFilters::default()
        };

        let out = format_tool_result(&filters, &[vacation_row()]);

        assert!(out.contains("limit reached"));
    }

    #[test]
    fn format_tool_result_does_not_flag_truncation_below_the_limit() {
        let filters = ExpenseSearchFilters {
            limit: Some(2),
            ..ExpenseSearchFilters::default()
        };

        let out = format_tool_result(&filters, &[vacation_row()]);

        assert!(!out.contains("limit reached"));
    }

    #[test]
    fn format_tool_result_quotes_filter_values_that_contain_separators() {
        let filters = ExpenseSearchFilters {
            category_name: Some("Va\"ca, tion".to_string()),
            ..ExpenseSearchFilters::default()
        };

        let out = format_tool_result(&filters, &[vacation_row()]);

        assert!(out.contains("category_name=\"Va\\\"ca, tion\""));
    }

    #[test]
    fn format_tool_result_names_the_tool_the_metadata_belongs_to() {
        let out = format_tool_result(&vacation_filters(), &[vacation_row()]);

        assert!(out.contains("query_expenses"));
    }

    #[test]
    fn budget_helper_prompt_advertises_no_category_id_parameter() {
        let prompt = build_system_prompt("budget-helper", "2026-08-25", "Budget Categories:\n");

        assert!(!prompt.contains("category_id"));
        assert!(!prompt.contains("budget_category_id"));
    }

    #[test]
    fn parse_tool_call_reads_a_name_only_query_payload() {
        let response = "```tool_call\n{\"tool\":\"query_expenses\",\"params\":{\"category_name\":\"Vacation\"}}\n```";

        let call = parse_tool_call(response).expect("tool call should parse");

        assert_eq!(call.tool, "query_expenses");
        assert_eq!(call.params["category_name"], "Vacation");
    }
}
