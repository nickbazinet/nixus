use aws_sdk_bedrockruntime::types::ConversationRole;
use tauri::{AppHandle, Emitter};
use tracing::info;

use crate::ai::backend::{self, AiAttachment, AiOperation, AiRequest, AiRole, AiTurn};
use crate::ai::AiProvider;
use crate::error::AppError;

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

Valid action_types: "create_expense", "create_budget_category", "batch_actions", "update_balance", "create_account", "update_asset_value"
- For create_expense: params must include merchant, amount_cents, category_name, date
- For create_budget_category: params must include category_name and group_name; target_cents is optional
- For batch_actions: params must include actions, an array of {{action_type, params}} objects — see "Batching several actions into one card" below
- For update_balance: params must include account_id, balance_cents
- For create_account: params must include name, institution, account_type, currency
- For update_asset_value: params must include asset_id, value_cents

For create_expense, `category_name` must be the exact full name of one category listed in the data — never a numeric ID and never a fragment. If two listed categories share that name, or none matches, ask the user which category to use.
If you cannot determine a required field, ask the user for clarification instead of guessing.

### Creating a budget category

`create_budget_category` adds ONE new category to an EXISTING budget group.

- `category_name` (string, required): the new category's name.
- `group_name` (string, required): must be one of the group names listed under "Budget Groups" in the data. There is no way to create a group, and a name that is not listed will be refused — if you cannot tell which group the user means, ASK instead of guessing.
- `target_cents` (integer, optional): the monthly target. Omit it and the category is created with a $1.00 placeholder the user can edit later. If you do send it, it must be a whole number of cents greater than zero.

The card the user approves is what `display.details` says, so it must name the group and state the target — including when you omit `target_cents` and the placeholder applies. This is the exact shape, with the target omitted:

```action
{{
  "action": true,
  "action_type": "create_budget_category",
  "display": {{
    "label": "Add Budget Category",
    "details": [
      {{ "field": "Category", "value": "House" }},
      {{ "field": "Group", "value": "Needs" }},
      {{ "field": "Target", "value": "$1.00 (placeholder)" }}
    ]
  }},
  "params": {{
    "category_name": "House",
    "group_name": "Needs"
  }}
}}
```

When the user DID name a target, send `target_cents` and show that figure instead of the placeholder text.

Never send an id of any kind for either the category or the group. Ids in a payload are ignored, and names are the only reference.

If the category already exists, confirming again changes nothing and reports that it already exists, so there is no harm in a repeat — but do not propose a card for a category you can already see in the data.

### Batching several actions into one card

When the user has already told you, in one message, every action they want run — a fixed named list of new categories, a batch of expenses (from a statement, a spreadsheet, or dictated one by one), several balance updates, whatever — use `batch_actions` instead of one card per item. One card, one confirm, every item executed together. This works for ANY action type, including a mix of different types in the same batch.

- `actions` (array, required): one object per item, each shaped `{{ "action_type": "...", "params": {{...}} }}` — `action_type` must be one of the OTHER valid action types above (never `batch_actions` itself), and `params` must satisfy that type's own required fields exactly as if it were its own card.
- `display.details` must list every item in the batch so the user can review all of them before confirming — one detail row per item, summarising what it will do.
- Each item is executed independently: if one item fails (an unknown category, a bad account id), the rest still run, and the result message reports exactly which ones failed and why. This is why a failed item is safe to re-propose alone once the missing detail is known, without redoing the whole batch.

```action
{{
  "action": true,
  "action_type": "batch_actions",
  "display": {{
    "label": "Add 3 Budget Categories",
    "details": [
      {{ "field": "House Related", "value": "Housing — $1.00 (placeholder)" }},
      {{ "field": "Car", "value": "Transportation — $1.00 (placeholder)" }},
      {{ "field": "Other", "value": "Lifestyle — $1.00 (placeholder)" }}
    ]
  }},
  "params": {{
    "actions": [
      {{ "action_type": "create_budget_category", "params": {{ "category_name": "House Related", "group_name": "Housing" }} }},
      {{ "action_type": "create_budget_category", "params": {{ "category_name": "Car", "group_name": "Transportation" }} }},
      {{ "action_type": "create_budget_category", "params": {{ "category_name": "Other", "group_name": "Lifestyle" }} }}
    ]
  }}
}}
```

### One action per response

Emit AT MOST ONE ```action fence per response, and never list several top-level actions inside one fence — only the first is ever shown to the user, so the rest are silently lost. (`batch_actions`'s `actions` array is a single action with several items, not several top-level actions, and stays within this rule.)

When the user has told you every item of a multi-write request up front (named a list, dictated several expenses, confirmed a breakdown you proposed), put them all in ONE `batch_actions` fence — do not propose them one card at a time and do not wait between them, no matter how many items there are or what type of action they are.

Only fall back to proposing ONE action at a time when the user has NOT yet told you every item — e.g. they described the work but you still need to ask which categories, or confirm a breakdown, before you know the full list:
1. Summarise in plain text what you understood and how many items it involves.
2. Ask the user to confirm the breakdown, or to name which one to start with.
3. Once they have confirmed the full list, propose it as one `batch_actions` card.

A result message tells you what actually happened. If a previous action reports that it did not complete, or that the user cancelled it, do NOT re-send the same card — ask for the missing or unclear detail first.

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

/// One chat invocation's inputs. Grouped because all three are re-derived per invocation:
/// the tool loop rebuilds history and re-supplies the attachment for its follow-up call.
pub struct ChatInvocation {
    pub turns: Vec<AiTurn>,
    pub system_prompt: String,
    pub attachment: Option<AiAttachment>,
}

/// Streams one chat invocation through the provider port.
///
/// The `chat:response-chunk` event contract is unchanged: incremental chunks with
/// `done: false`, then a single empty chunk with `done: true` on success only. A
/// failure returns before the terminal event, exactly as before.
pub async fn stream_chat_response(
    byo: Option<&AiProvider>,
    app: &AppHandle,
    invocation: ChatInvocation,
) -> Result<String, AppError> {
    let ChatInvocation {
        turns,
        system_prompt,
        attachment,
    } = invocation;

    info!(
        "Sending chat message to AI ({} turns, attachment={})",
        turns.len(),
        attachment.is_some()
    );

    let emit_chunk = move |text: &str| {
        let _ = app.emit(
            "chat:response-chunk",
            ChatResponseChunk {
                chunk: text.to_string(),
                done: false,
            },
        );
    };

    let full_response = backend::invoke(
        byo,
        AiRequest {
            operation: AiOperation::Chat,
            system: system_prompt,
            turns,
            attachment,
        },
        &emit_chunk,
    )
    .await?;

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

/// Bridges the conversation history's existing `ConversationRole` representation
/// onto the port's role union, so the DB and test fixtures stay unchanged.
pub fn build_turn(role: ConversationRole, text: &str) -> AiTurn {
    AiTurn {
        role: match role {
            ConversationRole::Assistant => AiRole::Assistant,
            _ => AiRole::User,
        },
        text: text.to_string(),
    }
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

    fn budget_prompt() -> String {
        build_system_prompt("budget-helper", "2026-08-25", "Budget Groups:\n  - Needs\n")
    }

    /* The prompt contract for the category card. The model was already emitting
     * `create_budget_category` before the prompt named it, so these pin the shape the backend
     * now accepts rather than the shape it guessed. */

    #[test]
    fn budget_helper_prompt_advertises_the_category_action() {
        let prompt = budget_prompt();

        assert!(prompt.contains("create_budget_category"));
    }

    /// Both names are required server-side, so the prompt has to ask for both or every card is
    /// a validation failure the user sees as a dead button.
    #[test]
    fn budget_helper_prompt_requires_both_names_for_a_category_card() {
        let prompt = budget_prompt();

        assert!(prompt.contains("category_name"));
        assert!(prompt.contains("group_name"));
    }

    /// The optional target and its placeholder: without this the model either omits a required
    /// field or invents a figure the user never approved.
    #[test]
    fn budget_helper_prompt_states_the_target_is_optional_with_a_one_dollar_default() {
        let prompt = budget_prompt();

        assert!(prompt.contains("target_cents"));
        assert!(prompt.contains("optional"));
        assert!(prompt.contains("$1.00"));
    }

    /// A group is never auto-created, so an undeterminable group must become a question rather
    /// than a guessed name the resolver will refuse.
    #[test]
    fn budget_helper_prompt_tells_the_model_to_ask_when_the_group_is_unclear() {
        let prompt = budget_prompt();

        assert!(prompt.contains("ASK instead of guessing"));
        assert!(prompt.contains("no way to create a group"));
    }

    /// Only the first fence is ever rendered, so a multi-fence response silently drops writes
    /// the user believes they approved.
    #[test]
    fn budget_helper_prompt_permits_at_most_one_action_fence() {
        let prompt = budget_prompt();

        assert!(prompt.contains("AT MOST ONE"));
        assert!(prompt.contains("never list several top-level actions inside one fence"));
    }

    /// Now that `batch_actions` covers every action type, narrowing to one-at-a-time only
    /// applies before the user has named the full list — this pins that fallback still exists.
    #[test]
    fn budget_helper_prompt_still_narrows_to_one_action_before_the_full_list_is_known() {
        let prompt = budget_prompt();

        assert!(prompt.contains("has NOT yet told you every item"));
        assert!(prompt.contains("propose it as one `batch_actions` card"));
    }

    /// The recorded failure and cancellation lines are only useful if the prompt says to read
    /// them instead of resending.
    #[test]
    fn budget_helper_prompt_tells_the_model_not_to_resend_a_failed_or_cancelled_card() {
        let prompt = budget_prompt();

        assert!(prompt.contains("did not complete"));
        assert!(prompt.contains("cancelled"));
        assert!(prompt.contains("do NOT re-send the same card"));
    }

    /// The ```action fence for one action_type, so an assertion about what a card omits cannot be
    /// satisfied by the same token appearing in the surrounding prose or in another example.
    fn action_example(prompt: &str, action_type: &str) -> String {
        let needle = format!("\"action_type\": \"{}\"", action_type);
        prompt
            .split("```action")
            .find(|block| block.contains(&needle))
            .map(|block| {
                block
                    .split_once("```")
                    .map(|(fence, _)| fence.to_string())
                    .unwrap_or_else(|| block.to_string())
            })
            .unwrap_or_else(|| panic!("no action example for {action_type}"))
    }

    #[test]
    fn the_prompt_carries_an_action_example_for_creating_a_category() {
        let example = action_example(&budget_prompt(), "create_budget_category");

        assert!(example.contains("\"action\": true"));
        assert!(example.contains("\"label\": \"Add Budget Category\""));
    }

    /// The three details the user reads before approving. Without the group on the card they are
    /// confirming a write whose destination they cannot see.
    #[test]
    fn the_category_example_shows_category_group_and_target_details() {
        let example = action_example(&budget_prompt(), "create_budget_category");

        assert!(example.contains("{ \"field\": \"Category\", \"value\": \"House\" }"));
        assert!(example.contains("{ \"field\": \"Group\", \"value\": \"Needs\" }"));
        assert!(
            example.contains("{ \"field\": \"Target\", \"value\": \"$1.00 (placeholder)\" }")
        );
    }

    /// The visible placeholder wording, pinned separately: a card that shows a bare "$1.00" reads
    /// as a figure the user chose rather than one the backend supplied.
    #[test]
    fn the_category_example_labels_the_default_target_as_a_placeholder() {
        let example = action_example(&budget_prompt(), "create_budget_category");

        assert!(example.contains("$1.00 (placeholder)"));
    }

    #[test]
    fn the_category_example_params_carry_both_required_names() {
        let example = action_example(&budget_prompt(), "create_budget_category");
        let (_, params) = example
            .split_once("\"params\"")
            .expect("the example has a params object");

        assert!(params.contains("\"category_name\": \"House\""));
        assert!(params.contains("\"group_name\": \"Needs\""));
    }

    /// The example must actually exercise the documented default: a `target_cents` here would
    /// demonstrate the opposite of the omission the surrounding text describes.
    #[test]
    fn the_category_example_omits_the_optional_target() {
        let example = action_example(&budget_prompt(), "create_budget_category");

        assert!(!example.contains("target_cents"), "{example}");
    }

    /// The example is one fence among the prompt's examples, and adding it must not have loosened
    /// the one-action rule or displaced the expense example the other actions are modelled on.
    #[test]
    fn adding_the_category_example_leaves_the_expense_example_and_one_action_rule_intact() {
        let prompt = budget_prompt();
        let expense = action_example(&prompt, "create_expense");

        assert!(expense.contains("\"merchant\": \"Costco\""));
        assert!(expense.contains("\"amount_cents\": 4500"));
        assert!(expense.contains("\"category_name\": \"Groceries\""));
        assert!(expense.contains("\"date\": \"2026-03-14\""));

        assert!(prompt.contains("AT MOST ONE"));
        assert!(prompt.contains("never list several top-level actions inside one fence"));
    }

    /// Exactly three worked examples (expense, single category, batch actions). Counted as
    /// fence OPENINGS — the one-action rule mentions ```action inline as prose, and counting
    /// that too would make this assert the wrong number.
    #[test]
    fn the_prompt_carries_exactly_three_action_examples() {
        assert_eq!(budget_prompt().matches("```action\n").count(), 3);
    }

    /// The generic batch action the fix adds: without it, a confirmed multi-item request (of
    /// any action type, not just categories) still goes through one card at a time.
    #[test]
    fn budget_helper_prompt_advertises_the_generic_batch_action() {
        let prompt = budget_prompt();

        assert!(prompt.contains("batch_actions"));
        assert!(prompt.contains("\"actions\""));
        assert!(prompt.contains("ANY action type"));
    }

    #[test]
    fn the_batch_example_carries_an_array_of_action_items() {
        let example = action_example(&budget_prompt(), "batch_actions");
        let (_, params) = example
            .split_once("\"params\"")
            .expect("the example has a params object");

        assert!(params.contains("\"category_name\": \"House Related\""));
        assert!(params.contains("\"category_name\": \"Car\""));
        assert!(params.contains("\"category_name\": \"Other\""));
        assert!(params.contains("\"action_type\": \"create_budget_category\""));
    }

    /// The prompt must tell the model to prefer the batch action over one-at-a-time cards once
    /// the user has already named every item — this is the behaviour the fix targets, and it
    /// must apply regardless of which action type(s) are involved.
    #[test]
    fn budget_helper_prompt_tells_the_model_to_batch_a_confirmed_multi_item_request() {
        let prompt = budget_prompt();

        assert!(prompt.contains("do not propose them one card at a time"));
        assert!(prompt.contains("no matter how many items there are or what type of action they are"));
    }

    /// Ids are guessable and stale; the backend ignores them, and the prompt must not invite one.
    ///
    /// Phrased without naming any id field on purpose — the sibling test below asserts no id
    /// token appears anywhere in the prompt, and spelling one out here would both break that
    /// guard and hand the model the very field name to try.
    #[test]
    fn budget_helper_prompt_forbids_sending_any_id_for_a_category_card() {
        let prompt = budget_prompt();

        assert!(prompt.contains("Never send an id of any kind"));
        assert!(prompt.contains("names are the only reference"));
    }

    #[test]
    fn budget_helper_prompt_advertises_no_category_id_parameter() {
        let prompt = build_system_prompt("budget-helper", "2026-08-25", "Budget Categories:\n");

        assert!(!prompt.contains("category_id"));
        assert!(!prompt.contains("budget_category_id"));
    }

    /// `build_turn` is the bridge between the conversation history's stored
    /// `ConversationRole` and the port's role union. A mis-mapped assistant turn
    /// would silently attribute the model's own words to the user.
    #[test]
    fn build_turn_maps_the_user_role() {
        let turn = build_turn(ConversationRole::User, "how is my budget?");

        assert_eq!(turn.role, AiRole::User);
        assert_eq!(turn.text, "how is my budget?");
    }

    #[test]
    fn build_turn_maps_the_assistant_role() {
        let turn = build_turn(ConversationRole::Assistant, "it looks fine");

        assert_eq!(turn.role, AiRole::Assistant);
        assert_eq!(turn.text, "it looks fine");
    }

    #[test]
    fn build_turn_preserves_text_exactly_including_empty_and_multiline() {
        assert_eq!(build_turn(ConversationRole::User, "").text, "");
        assert_eq!(
            build_turn(ConversationRole::Assistant, "line one\n\nline two").text,
            "line one\n\nline two"
        );
        // Tool-call and action payloads travel as ordinary turn text.
        let fenced = "```tool_call\n{\"tool\":\"query_expenses\"}\n```";
        assert_eq!(build_turn(ConversationRole::User, fenced).text, fenced);
    }

    /// Round-trips the full history shape `commands/chat.rs` builds, so an inverted
    /// mapping cannot pass by being symmetric.
    #[test]
    fn build_turn_round_trips_an_alternating_history_in_order() {
        let history = [
            (ConversationRole::User, "first"),
            (ConversationRole::Assistant, "second"),
            (ConversationRole::User, "third"),
        ];

        let turns: Vec<AiTurn> = history
            .into_iter()
            .map(|(role, text)| build_turn(role, text))
            .collect();

        assert_eq!(
            turns.iter().map(|turn| turn.role).collect::<Vec<_>>(),
            vec![AiRole::User, AiRole::Assistant, AiRole::User]
        );
        assert_eq!(
            turns.iter().map(|turn| turn.text.as_str()).collect::<Vec<_>>(),
            vec!["first", "second", "third"]
        );
    }

    #[test]
    fn parse_tool_call_reads_a_name_only_query_payload() {
        let response = "```tool_call\n{\"tool\":\"query_expenses\",\"params\":{\"category_name\":\"Vacation\"}}\n```";

        let call = parse_tool_call(response).expect("tool call should parse");

        assert_eq!(call.tool, "query_expenses");
        assert_eq!(call.params["category_name"], "Vacation");
    }
}
