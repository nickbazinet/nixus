use aws_sdk_bedrockruntime::types::{
    ContentBlock, ConversationRole, Message, SystemContentBlock,
};
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
    },
    Client as OpenAIClient,
};
use aws_sdk_bedrockruntime::Client as BedrockClient;
use serde::Deserialize;
use tracing::info;

use crate::error::AppError;
use crate::models::{
    AccountHeadroom, BudgetCategoryStatus, CategoryCompareRow, ProjectAdviceRequest,
    ProjectAdviceResponse,
};

const BEDROCK_MODEL_ID: &str = "us.anthropic.claude-sonnet-4-6";
const OPENAI_MODEL_ID: &str = "gpt-4o";

pub enum ProviderClient {
    Bedrock(BedrockClient),
    OpenAI(OpenAIClient<OpenAIConfig>),
}

#[derive(Debug, Deserialize)]
struct AiAdvicePayload {
    headline: String,
    body: String,
    #[serde(default = "default_tone")]
    tone: String,
}

fn default_tone() -> String {
    "calm".to_string()
}

// The gate is about the *pace* figures only. An empty category list is a legitimate state — the user
// is inside every target this month — and rejecting it would deny advice precisely to the person
// whose problem is income or timeline rather than overspending.
fn check_gate(request: &ProjectAdviceRequest) -> Result<(), AppError> {
    if request.project_name.trim().is_empty() {
        return Err(AppError::Validation {
            message: "Project name is required for advice".to_string(),
            field: Some("project_name".to_string()),
        });
    }

    if request.remaining_cents <= 0 {
        return Err(AppError::Validation {
            message: "A reached goal has no pace to advise on".to_string(),
            field: Some("remaining_cents".to_string()),
        });
    }

    if request.required_monthly_cents <= 0 {
        return Err(AppError::Validation {
            message: "No required monthly rate available for advice".to_string(),
            field: Some("required_monthly_cents".to_string()),
        });
    }

    Ok(())
}

fn normalize_tone(tone: &str) -> String {
    match tone {
        "calm" | "caution" | "positive" => tone.to_string(),
        _ => "calm".to_string(),
    }
}

fn build_system_prompt(locale: &str) -> String {
    let language = match locale {
        "fr" => "French",
        _ => "English",
    };

    format!(
        r#"You are a calm personal finance educator advising on ONE savings goal that is behind its own schedule. Your job is to commit to a short, sequenced recommendation the user can act on today — not to describe what is available to them.

Language and shape:
- Write headline and body in {language}.
- Keep the headline to one short sentence. The body may run up to 4-5 sentences, structured as a short sequenced recommendation: the move to make now, then the follow-up move.
- tone must be one of: calm, caution, positive (machine enum for UI styling, not localized).
- Be decisive. Prefer "I'd recommend ..." over "you could consider ..." or "you may want to look at ...". Do not simply list the figures back to the user.

What to recommend:
- If accounts with idle cash are listed, recommend moving a SPECIFIC dollar amount from a SPECIFIC named account into this goal now. Use the account names exactly as written, and name at most 2 of them.
- Every idle-cash figure you are given already has a safety margin built into it. It is NOT the account's full balance, and a buffer is already being held back for the user on every account listed. The amount you recommend must NEVER exceed the amount given for that account. Decide how much of that ceiling to actually recommend using the judgment guidance below — you do not have to recommend the full amount given, and recommending LESS is always acceptable and never discouraged.
- If you recommend applying ALL of the idle cash listed, you may state the revised monthly rate, but ONLY by quoting the "required monthly rate would become" figure from the user message verbatim.
- If you recommend a PARTIAL amount, you must NOT state any revised or recomputed monthly rate — no such figure was computed for that case. Instead restate the original required contribution rate as what to keep contributing, and describe the lump sum as closing part of the gap.
- If budget categories with room to spare are listed, name at most 1 of them, with the exact gap amount given, as spending to trim going forward.
- If over-budget categories are listed, you may name at most 2 of them with their dollar amounts as places the shortfall could come from.

Use your own financial judgment:
- The ceiling you are given for each account is a safety margin, not a target. Apply ordinary personal-finance common sense to decide how much of it, if any, actually makes sense to recommend for THIS account.
- Weigh the account's name and apparent role the same way a careful advisor would: money in something named like an emergency fund, rainy-day fund, or reserve deserves extra caution beyond the ceiling already applied — the usual guidance is to keep several months of essential expenses untouched for emergencies, so recommend a smaller share of it, or none at all, when that is the wiser call. A plain chequing or general savings account can usually absorb a larger share of its given ceiling.
- It is entirely acceptable, and often the better answer, to recommend less than the ceiling for an account, or to recommend touching only one of the two accounts listed, when that is the financially sounder choice.

Financial health first:
- The user's financial safety and stability always take priority over reaching this goal faster. An emptied or thinned-out account is never good advice, even when it would mathematically shorten the timeline.
- Never frame keeping money accessible as a delay or a cost. A slower goal with a stable cash cushion is the better outcome, and you should say so if the plan you give is a cautious one.

Hard limits, which override everything above:
- Use ONLY the figures in the user message. Do not invent, recompute or extrapolate any amount, including any revised monthly rate.
- Never mention any account or category that does not appear verbatim in the lists in the user message, and never mention an account type or an account the message did not name.
- If the message says there is no idle cash, NEVER name or imply any account and never recommend a lump sum. If it says there are no categories with room to spare, NEVER name or imply one. If it says there are no over-budget categories, say so plainly and speak only about the timeline, the target size, or income.
- Suggest nothing that requires data you were not given: no specific merchants, no interest rates, no account numbers.
- Be actionable without being alarmist, and never promise the goal will be met.

Style example, for sentence shape only:
"I'd recommend moving $1,234 from your Example Account into this goal now, which brings what you need down to $1,234 per month. From there, trimming $1,234 a month from Example Category covers a good share of what is left."
The numbers and names in that example are illustrative only. NEVER echo or reuse them; every figure and name in your answer must come from the user message.

Respond with ONLY valid JSON in this exact format:
{{
  "headline": "...",
  "body": "...",
  "tone": "caution"
}}"#
    )
}

fn build_user_prompt(
    request: &ProjectAdviceRequest,
    over_target_categories: &[BudgetCategoryStatus],
    under_target_categories: &[CategoryCompareRow],
    account_headroom: &[AccountHeadroom],
    adjusted_required_monthly_cents: Option<i64>,
) -> String {
    let mut lines = vec![
        format!("Savings goal: {}", request.project_name),
        format!("Still needed: {} cents", request.remaining_cents),
        format!(
            "Required contribution rate: {} cents per month",
            request.required_monthly_cents
        ),
    ];

    match request.actual_monthly_cents {
        Some(actual) => lines.push(format!(
            "Recent actual contribution rate: {actual} cents per month"
        )),
        None => lines.push("Recent actual contribution rate: not available".to_string()),
    }

    match request.months_to_target {
        Some(months) => lines.push(format!("Whole months left until the target date: {months}")),
        None => lines.push("Whole months left until the target date: not available".to_string()),
    }

    if over_target_categories.is_empty() {
        lines.push(
            "Over-budget categories this month: none — every category is at or under its target."
                .to_string(),
        );
    } else {
        lines.push("Over-budget categories this month:".to_string());
        for category in over_target_categories {
            lines.push(format!(
                "- {}: target {} cents, spent {} cents, over by {} cents",
                category.name,
                category.target_cents,
                category.spent_cents,
                category.spent_cents.saturating_sub(category.target_cents)
            ));
        }
    }

    let headroom_lines = liquid_headroom_lines(account_headroom);
    if headroom_lines.is_empty() {
        lines.push(
            "Accounts with idle cash: none — every chequing and savings balance is already assigned to a goal."
                .to_string(),
        );
    } else {
        lines.push(
            "Accounts with idle cash the user could log toward this goal today:".to_string(),
        );
        lines.extend(headroom_lines);
    }

    match adjusted_required_monthly_cents {
        Some(adjusted) => lines.push(format!(
            "If all the idle cash listed above were applied today, the required monthly rate would become: {adjusted} cents"
        )),
        None => lines.push(
            "If all the idle cash listed above were applied today, the required monthly rate would become: not applicable — no target date or no idle cash listed"
                .to_string(),
        ),
    }

    let slack_lines = category_slack_lines(under_target_categories);
    if slack_lines.is_empty() {
        lines.push(
            "Budget categories with room to spare: none — no category is meaningfully under its target."
                .to_string(),
        );
    } else {
        lines.push(
            "Budget categories with room to spare that could be redirected toward this goal:"
                .to_string(),
        );
        lines.extend(slack_lines);
    }

    lines.join("\n")
}

// A second, independent enforcement of the same rule the SQL already enforces. The prompt is the
// last place a type could leak to the provider, so the guarantee is asserted here too rather than
// trusted from three call sites away.
const PROMPTABLE_ACCOUNT_TYPES: [&str; 2] = ["chequing", "savings"];

fn liquid_headroom_lines(account_headroom: &[AccountHeadroom]) -> Vec<String> {
    account_headroom
        .iter()
        .filter(|account| PROMPTABLE_ACCOUNT_TYPES.contains(&account.account_type.as_str()))
        .filter(|account| account.unallocated_cents > 0)
        .map(|account| {
            format!(
                "- {} ({}): {} cents not assigned to any goal",
                account.account_name, account.account_type, account.unallocated_cents
            )
        })
        .collect()
}

fn category_slack_lines(under_target_categories: &[CategoryCompareRow]) -> Vec<String> {
    under_target_categories
        .iter()
        .filter_map(|category| {
            let target_cents = category.target_cents?;
            let slack_cents = target_cents - category.avg_cents;
            (slack_cents > 0).then(|| {
                format!(
                    "- {}: target {} cents, recent average spend {} cents, room to spare {} cents",
                    category.category_name, target_cents, category.avg_cents, slack_cents
                )
            })
        })
        .collect()
}

fn extract_json(text: &str) -> &str {
    if let Some(start) = text.find("```json") {
        let json_start = start + 7;
        if let Some(end) = text[json_start..].find("```") {
            return text[json_start..json_start + end].trim();
        }
    }
    if let Some(start) = text.find("```") {
        let json_start = start + 3;
        let json_start = text[json_start..]
            .find('\n')
            .map(|n| json_start + n + 1)
            .unwrap_or(json_start);
        if let Some(end) = text[json_start..].find("```") {
            return text[json_start..json_start + end].trim();
        }
    }
    text.trim()
}

fn parse_advice_response(
    output_text: &str,
    project_name: &str,
) -> Result<ProjectAdviceResponse, AppError> {
    let json_str = extract_json(output_text);
    let payload: AiAdvicePayload =
        serde_json::from_str(json_str).map_err(|e| AppError::AiService {
            message: format!("Failed to parse AI response: {}. Raw: {}", e, output_text),
            recoverable: true,
        })?;

    Ok(ProjectAdviceResponse {
        headline: payload.headline,
        body: payload.body,
        tone: normalize_tone(&payload.tone),
        project_name: project_name.to_string(),
    })
}

async fn call_bedrock(
    client: &BedrockClient,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, AppError> {
    let message = Message::builder()
        .role(ConversationRole::User)
        .content(ContentBlock::Text(user_prompt.to_string()))
        .build()
        .map_err(|e| AppError::AiService {
            message: format!("Failed to build message: {}", e),
            recoverable: false,
        })?;

    let response = client
        .converse()
        .model_id(BEDROCK_MODEL_ID)
        .system(SystemContentBlock::Text(system_prompt.to_string()))
        .messages(message)
        .send()
        .await
        .map_err(|e| AppError::AiService {
            message: format!("Bedrock API error: {:?}", e),
            recoverable: true,
        })?;

    response
        .output()
        .and_then(|o| o.as_message().ok())
        .and_then(|m| m.content().first())
        .and_then(|c| c.as_text().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::AiService {
            message: "No text response from Bedrock".to_string(),
            recoverable: true,
        })
}

async fn call_openai(
    client: &OpenAIClient<OpenAIConfig>,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, AppError> {
    let request = CreateChatCompletionRequestArgs::default()
        .model(OPENAI_MODEL_ID)
        .messages(vec![
            ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessageArgs::default()
                    .content(system_prompt)
                    .build()
                    .map_err(|e| AppError::AiService {
                        message: format!("Failed to build OpenAI system message: {}", e),
                        recoverable: false,
                    })?,
            ),
            ChatCompletionRequestMessage::User(
                ChatCompletionRequestUserMessageArgs::default()
                    .content(user_prompt)
                    .build()
                    .map_err(|e| AppError::AiService {
                        message: format!("Failed to build OpenAI user message: {}", e),
                        recoverable: false,
                    })?,
            ),
        ])
        .build()
        .map_err(|e| AppError::AiService {
            message: format!("Failed to build OpenAI request: {}", e),
            recoverable: false,
        })?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| AppError::AiService {
            message: format!("OpenAI API error: {}", e),
            recoverable: true,
        })?;

    response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::AiService {
            message: "No text response from OpenAI".to_string(),
            recoverable: true,
        })
}

pub async fn generate_project_advice(
    provider: &ProviderClient,
    request: ProjectAdviceRequest,
    over_target_categories: &[BudgetCategoryStatus],
    under_target_categories: &[CategoryCompareRow],
    account_headroom: &[AccountHeadroom],
    adjusted_required_monthly_cents: Option<i64>,
) -> Result<ProjectAdviceResponse, AppError> {
    check_gate(&request)?;

    let system_prompt = build_system_prompt(&request.locale);
    let user_prompt = build_user_prompt(
        &request,
        over_target_categories,
        under_target_categories,
        account_headroom,
        adjusted_required_monthly_cents,
    );
    let project_name = request.project_name.clone();

    info!(
        "Generating project advice for one goal with {} over-target categories, {} slack categories and {} liquid accounts with idle cash",
        over_target_categories.len(),
        under_target_categories.len(),
        account_headroom.len()
    );

    let output_text = match provider {
        ProviderClient::Bedrock(client) => {
            call_bedrock(client, &system_prompt, &user_prompt).await?
        }
        ProviderClient::OpenAI(client) => {
            call_openai(client, &system_prompt, &user_prompt).await?
        }
    };

    parse_advice_response(&output_text, &project_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ProjectAdviceRequest {
        ProjectAdviceRequest {
            project_name: "Car down payment".to_string(),
            remaining_cents: 600_000,
            required_monthly_cents: 100_000,
            actual_monthly_cents: Some(50_000),
            months_to_target: Some(6),
            locale: "en".to_string(),
        }
    }

    fn category(name: &str, target_cents: i64, spent_cents: i64) -> BudgetCategoryStatus {
        BudgetCategoryStatus {
            id: 1,
            group_id: 1,
            name: name.to_string(),
            target_cents,
            spent_cents,
            is_deleted: false,
        }
    }

    fn slack_category(name: &str, target_cents: i64, avg_cents: i64) -> CategoryCompareRow {
        CategoryCompareRow {
            category_id: 1,
            category_name: name.to_string(),
            avg_cents,
            target_cents: Some(target_cents),
            delta_pct: Some(-10),
            status: "under".to_string(),
        }
    }

    fn liquid_account(name: &str, account_type: &str, unallocated_cents: i64) -> AccountHeadroom {
        AccountHeadroom {
            account_id: 1,
            account_name: name.to_string(),
            account_type: account_type.to_string(),
            unallocated_cents,
        }
    }

    fn prompt_for(
        over_target_categories: &[BudgetCategoryStatus],
        under_target_categories: &[CategoryCompareRow],
        account_headroom: &[AccountHeadroom],
    ) -> String {
        build_user_prompt(
            &request(),
            over_target_categories,
            under_target_categories,
            account_headroom,
            None,
        )
    }

    const ADJUSTED_RATE_PREFIX: &str =
        "If all the idle cash listed above were applied today, the required monthly rate would become:";

    #[test]
    fn a_behind_goal_with_over_target_categories_passes_the_gate() {
        assert!(check_gate(&request()).is_ok());
    }

    // The whole point of the gate's shape: "nothing is over budget" is the user's *good* month, and
    // it must still be able to ask why the goal is behind.
    #[test]
    fn an_empty_category_list_is_valid_input_not_an_error() {
        assert!(check_gate(&request()).is_ok());

        let prompt = prompt_for(&[], &[], &[]);

        assert!(prompt.contains("Over-budget categories this month: none"));
    }

    #[test]
    fn a_blank_project_name_is_rejected() {
        let blank = ProjectAdviceRequest {
            project_name: "   ".to_string(),
            ..request()
        };

        let error = check_gate(&blank).unwrap_err();

        assert!(matches!(
            error,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("project_name")
        ));
    }

    #[test]
    fn a_reached_goal_is_rejected() {
        for remaining_cents in [0, -1, -600_000] {
            let reached = ProjectAdviceRequest {
                remaining_cents,
                ..request()
            };

            let error = check_gate(&reached).unwrap_err();

            assert!(matches!(
                error,
                AppError::Validation { ref field, .. }
                    if field.as_deref() == Some("remaining_cents")
            ));
        }
    }

    // A `neutral` project has no required rate, so there is no schedule to be behind and nothing
    // grounded to advise on. The button never reaches this state, and the gate makes that a contract.
    #[test]
    fn a_missing_required_rate_is_rejected() {
        let no_rate = ProjectAdviceRequest {
            required_monthly_cents: 0,
            ..request()
        };

        let error = check_gate(&no_rate).unwrap_err();

        assert!(matches!(
            error,
            AppError::Validation { ref field, .. }
                if field.as_deref() == Some("required_monthly_cents")
        ));
    }

    #[test]
    fn the_three_known_tones_survive_normalization() {
        for tone in ["calm", "caution", "positive"] {
            assert_eq!(normalize_tone(tone), tone);
        }
    }

    #[test]
    fn an_unknown_tone_falls_back_to_calm() {
        for tone in ["", "URGENT", "Caution", "panic", "positive "] {
            assert_eq!(normalize_tone(tone), "calm", "for {tone:?}");
        }
    }

    #[test]
    fn a_missing_tone_field_falls_back_to_calm() {
        let parsed =
            parse_advice_response(r#"{"headline":"H","body":"B"}"#, "Car down payment").unwrap();

        assert_eq!(parsed.tone, "calm");
        assert_eq!(parsed.project_name, "Car down payment");
    }

    #[test]
    fn a_fenced_json_response_parses() {
        let parsed = parse_advice_response(
            "```json\n{\"headline\":\"H\",\"body\":\"B\",\"tone\":\"caution\"}\n```",
            "Kitchen",
        )
        .unwrap();

        assert_eq!(parsed.headline, "H");
        assert_eq!(parsed.body, "B");
        assert_eq!(parsed.tone, "caution");
        assert_eq!(parsed.project_name, "Kitchen");
    }

    #[test]
    fn an_unparseable_response_is_a_recoverable_ai_error() {
        let error = parse_advice_response("sorry, I cannot help", "Kitchen").unwrap_err();

        assert!(matches!(
            error,
            AppError::AiService {
                recoverable: true,
                ..
            }
        ));
    }

    // The prompt is the only place the model learns any number, so these assertions are the
    // "no invented figures" guarantee: every amount it can see is one the backend put here.
    #[test]
    fn the_prompt_carries_only_the_supplied_figures() {
        let prompt = prompt_for(
            &[
                category("Groceries", 40_000, 55_000),
                category("Dining out", 20_000, 32_000),
            ],
            &[],
            &[],
        );

        assert!(prompt.contains("Still needed: 600000 cents"));
        assert!(prompt.contains("Required contribution rate: 100000 cents per month"));
        assert!(prompt.contains("Recent actual contribution rate: 50000 cents per month"));
        assert!(prompt.contains("Whole months left until the target date: 6"));
        assert!(prompt.contains("Groceries: target 40000 cents, spent 55000 cents, over by 15000 cents"));
        assert!(prompt.contains("Dining out: target 20000 cents, spent 32000 cents, over by 12000 cents"));
    }

    #[test]
    fn absent_rates_read_as_unavailable_never_as_zero() {
        let prompt = build_user_prompt(
            &ProjectAdviceRequest {
                actual_monthly_cents: None,
                months_to_target: None,
                ..request()
            },
            &[],
            &[],
            &[],
            None,
        );

        assert!(prompt.contains("Recent actual contribution rate: not available"));
        assert!(prompt.contains("Whole months left until the target date: not available"));
        assert!(!prompt.contains("Recent actual contribution rate: 0"));
        assert!(!prompt.contains("target date: 0"));
    }

    #[test]
    fn idle_cash_reaches_the_prompt_with_its_account_name_and_amount() {
        let prompt = prompt_for(
            &[],
            &[],
            &[
                liquid_account("Rainy day", "savings", 900_000),
                liquid_account("Everyday", "chequing", 400_000),
            ],
        );

        assert!(prompt.contains("Accounts with idle cash the user could log toward this goal today:"));
        assert!(prompt.contains("- Rainy day (savings): 900000 cents not assigned to any goal"));
        assert!(prompt.contains("- Everyday (chequing): 400000 cents not assigned to any goal"));
    }

    // The Boundaries rule the model can never be trusted to enforce: a non-liquid account must be
    // gone before the request leaves the process, not filtered by the provider's good behaviour.
    #[test]
    fn no_account_type_outside_chequing_and_savings_can_reach_the_prompt() {
        let prompt = prompt_for(
            &[],
            &[],
            &[
                liquid_account("TFSA", "tfsa", 5_000_000),
                liquid_account("RRSP", "rrsp", 5_000_000),
                liquid_account("FHSA", "fhsa", 5_000_000),
                liquid_account("Brokerage", "non_registered", 5_000_000),
                liquid_account("Wallet", "crypto", 5_000_000),
                liquid_account("Visa", "credit_card", 5_000_000),
                liquid_account("Everyday", "chequing", 100_000),
            ],
        );

        for leaked in ["TFSA", "RRSP", "FHSA", "Brokerage", "Wallet", "Visa"] {
            assert!(!prompt.contains(leaked), "{leaked} leaked into the prompt");
        }
        assert!(!prompt.contains("5000000"));
        assert!(prompt.contains("- Everyday (chequing): 100000 cents not assigned to any goal"));
    }

    #[test]
    fn a_fully_earmarked_liquid_account_is_reported_as_no_idle_cash() {
        let prompt = prompt_for(&[], &[], &[liquid_account("Everyday", "chequing", 0)]);

        assert!(prompt.contains("Accounts with idle cash: none"));
        assert!(!prompt.contains("Everyday"));
    }

    #[test]
    fn budget_slack_reaches_the_prompt_with_its_gap_amount() {
        let prompt = prompt_for(
            &[],
            &[
                slack_category("Transport", 50_000, 32_000),
                slack_category("Hobbies", 20_000, 12_500),
            ],
            &[],
        );

        assert!(prompt
            .contains("Budget categories with room to spare that could be redirected toward this goal:"));
        assert!(prompt.contains(
            "- Transport: target 50000 cents, recent average spend 32000 cents, room to spare 18000 cents"
        ));
        assert!(prompt.contains(
            "- Hobbies: target 20000 cents, recent average spend 12500 cents, room to spare 7500 cents"
        ));
    }

    #[test]
    fn a_category_without_a_target_is_never_offered_as_slack() {
        let prompt = prompt_for(
            &[],
            &[CategoryCompareRow {
                category_id: 9,
                category_name: "Untargeted".to_string(),
                avg_cents: 12_000,
                target_cents: None,
                delta_pct: None,
                status: "no_target".to_string(),
            }],
            &[],
        );

        assert!(prompt.contains("Budget categories with room to spare: none"));
        assert!(!prompt.contains("Untargeted"));
    }

    #[test]
    fn nothing_to_redirect_is_stated_plainly_in_both_lists() {
        let prompt = prompt_for(&[], &[], &[]);

        assert!(prompt.contains("Accounts with idle cash: none"));
        assert!(prompt.contains("Budget categories with room to spare: none"));
    }

    // The revised rate is the one number in the prompt the model is allowed to quote back as an
    // outcome, so it must arrive verbatim from Rust rather than as anything the model could derive.
    #[test]
    fn the_adjusted_rate_reaches_the_prompt_verbatim_when_one_was_computed() {
        let prompt = build_user_prompt(
            &request(),
            &[],
            &[],
            &[liquid_account("Rainy day", "savings", 300_000)],
            Some(50_000),
        );

        assert!(prompt.contains(&format!("{ADJUSTED_RATE_PREFIX} 50000 cents")));
    }

    #[test]
    fn no_target_date_leaves_the_adjusted_rate_marked_not_applicable() {
        let prompt = build_user_prompt(
            &ProjectAdviceRequest {
                months_to_target: None,
                ..request()
            },
            &[],
            &[],
            &[liquid_account("Rainy day", "savings", 300_000)],
            None,
        );

        assert!(prompt.contains(&format!("{ADJUSTED_RATE_PREFIX} not applicable")));
    }

    // Absent must read as "not applicable", never as a zero rate the model could present as
    // "you would owe nothing per month".
    #[test]
    fn no_idle_cash_leaves_the_adjusted_rate_marked_not_applicable() {
        let prompt = prompt_for(&[], &[], &[]);

        assert!(prompt.contains(&format!("{ADJUSTED_RATE_PREFIX} not applicable")));
        assert!(!prompt.contains(&format!("{ADJUSTED_RATE_PREFIX} 0 cents")));
    }

    #[test]
    fn the_system_prompt_forbids_a_recomputed_rate_for_a_partial_lump_sum() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains(
            "If you recommend a PARTIAL amount, you must NOT state any revised or recomputed monthly rate"
        ));
        assert!(system_prompt.contains("restate the original required contribution rate"));
    }

    #[test]
    fn the_system_prompt_permits_the_adjusted_rate_only_for_the_apply_all_case() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains(
            "If you recommend applying ALL of the idle cash listed, you may state the revised monthly rate, but ONLY by quoting the \"required monthly rate would become\" figure from the user message verbatim."
        ));
        assert!(system_prompt.contains("must NEVER exceed the amount given for that account"));
    }

    // The hard cap is enforced in Rust before the figure ever reaches the prompt (the model is only
    // ever shown a safe ceiling, never the true balance), so account-name judgment here is a second,
    // *optional* layer of common sense on top of that guarantee — not the thing standing between the
    // user and an emptied account, the way it was before the Rust-side halving existed.
    #[test]
    fn the_system_prompt_uses_account_name_as_judgment_on_top_of_the_hard_cap() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains("emergency fund"));
        assert!(system_prompt.contains("rainy-day fund"));
        assert!(system_prompt.contains("Use your own financial judgment:"));
        // The layering: judgment can recommend less, but the ceiling itself is still an absolute cap.
        assert!(system_prompt.contains("must NEVER exceed the amount given for that account"));
    }

    #[test]
    fn the_system_prompt_states_the_safety_margin_is_already_built_into_every_figure() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt
            .contains("Every idle-cash figure you are given already has a safety margin built into it"));
        assert!(system_prompt.contains("It is NOT the account's full balance"));
        assert!(system_prompt
            .contains("recommending LESS is always acceptable and never discouraged"));
    }

    #[test]
    fn the_system_prompt_puts_financial_health_ahead_of_the_goal() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains("Financial health first:"));
        assert!(system_prompt.contains(
            "The user's financial safety and stability always take priority over reaching this goal faster."
        ));
        assert!(system_prompt
            .contains("An emptied or thinned-out account is never good advice"));
    }

    // The example exists to shape prose, not to supply data; without the disclaimer its placeholder
    // amounts are exactly the kind of invented figure every other rule here forbids.
    #[test]
    fn the_system_prompt_marks_its_style_example_as_illustrative_only() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains("Style example, for sentence shape only:"));
        assert!(system_prompt.contains("illustrative only"));
        assert!(system_prompt.contains("NEVER echo or reuse them"));
    }

    #[test]
    fn the_system_prompt_asks_for_a_decisive_sequenced_plan() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains("up to 4-5 sentences"));
        assert!(system_prompt.contains("I'd recommend"));
        assert!(!system_prompt.contains("body to 2-3 sentences"));
    }

    #[test]
    fn the_system_prompt_forbids_inventing_an_account_or_a_slack_category() {
        let system_prompt = build_system_prompt("en");

        assert!(system_prompt.contains("at most 2"));
        assert!(system_prompt.contains("NEVER name or imply any account"));
        assert!(system_prompt.contains("does not appear verbatim"));
    }

    #[test]
    fn the_system_prompt_switches_language_on_locale() {
        assert!(build_system_prompt("fr").contains("in French"));
        assert!(build_system_prompt("en").contains("in English"));
        assert!(build_system_prompt("de").contains("in English"));
    }
}
