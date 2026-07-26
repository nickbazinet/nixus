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
use crate::models::{CategoryCompareRow, TrendsInsightRequest, TrendsInsightResponse};

const BEDROCK_MODEL_ID: &str = "us.anthropic.claude-sonnet-4-6";
const OPENAI_MODEL_ID: &str = "gpt-4o";

pub enum ProviderClient {
    Bedrock(BedrockClient),
    OpenAI(OpenAIClient<OpenAIConfig>),
}

#[derive(Debug, Deserialize)]
struct AiInsightPayload {
    headline: String,
    body: String,
    #[serde(default = "default_tone")]
    tone: String,
}

fn default_tone() -> String {
    "calm".to_string()
}

fn check_gate(categories: &[CategoryCompareRow]) -> Result<(), AppError> {
    if categories.is_empty() {
        return Err(AppError::Validation {
            message: "No category compare data provided".to_string(),
            field: Some("categories".to_string()),
        });
    }

    let has_target = categories
        .iter()
        .any(|c| c.target_cents.unwrap_or(0) > 0);

    if !has_target {
        return Err(AppError::Validation {
            message: "No budget targets available for insight".to_string(),
            field: Some("categories".to_string()),
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
        r#"You are a calm personal finance educator. Compare the user's average monthly spending trends against their current monthly budget targets.

Rules:
- Use ONLY the category figures provided in the user message. Do not invent or recompute amounts.
- Write headline and body in {language}.
- Keep headline to one short sentence and body to 2-3 sentences.
- tone must be one of: calm, caution, positive (machine enum for UI styling, not localized).
- Be educational and actionable without being alarmist.
- If most categories are on track, prefer tone calm or positive.
- If several categories are over budget, prefer tone caution.

Respond with ONLY valid JSON in this exact format:
{{
  "headline": "...",
  "body": "...",
  "tone": "calm"
}}"#
    )
}

fn build_user_prompt(request: &TrendsInsightRequest) -> String {
    let mut lines = vec![
        format!("Window: {}", request.window_label),
        format!("Months in window: {}", request.months),
        "Category comparisons (avg monthly spend vs current monthly target):".to_string(),
    ];

    for row in &request.categories {
        let target = row
            .target_cents
            .map(|t| t.to_string())
            .unwrap_or_else(|| "none".to_string());
        let delta = row
            .delta_pct
            .map(|d| format!("{d}%"))
            .unwrap_or_else(|| "n/a".to_string());
        lines.push(format!(
            "- {}: avg_cents={}, target_cents={}, delta_pct={}, status={}",
            row.category_name, row.avg_cents, target, delta, row.status
        ));
    }

    lines.join("\n")
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

fn parse_insight_response(
    output_text: &str,
    window_label: &str,
) -> Result<TrendsInsightResponse, AppError> {
    let json_str = extract_json(output_text);
    let payload: AiInsightPayload =
        serde_json::from_str(json_str).map_err(|e| AppError::AiService {
            message: format!("Failed to parse AI response: {}. Raw: {}", e, output_text),
            recoverable: true,
        })?;

    Ok(TrendsInsightResponse {
        headline: payload.headline,
        body: payload.body,
        tone: normalize_tone(&payload.tone),
        window_label: window_label.to_string(),
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

    let response = client.chat().create(request).await.map_err(|e| {
        AppError::AiService {
            message: format!("OpenAI API error: {}", e),
            recoverable: true,
        }
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

pub async fn generate_trends_insight(
    provider: &ProviderClient,
    request: TrendsInsightRequest,
) -> Result<TrendsInsightResponse, AppError> {
    check_gate(&request.categories)?;

    let system_prompt = build_system_prompt(&request.locale);
    let user_prompt = build_user_prompt(&request);
    let window_label = request.window_label.clone();

    info!(
        "Generating trends insight for {} categories ({} window)",
        request.categories.len(),
        window_label
    );

    let output_text = match provider {
        ProviderClient::Bedrock(client) => {
            call_bedrock(client, &system_prompt, &user_prompt).await?
        }
        ProviderClient::OpenAI(client) => {
            call_openai(client, &system_prompt, &user_prompt).await?
        }
    };

    parse_insight_response(&output_text, &window_label)
}
