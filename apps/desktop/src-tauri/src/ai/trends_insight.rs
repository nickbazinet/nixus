use serde::Deserialize;
use tracing::info;

use crate::ai::backend::{self, AiOperation, AiRequest, AiTurn};
use crate::ai::AiProvider;
use crate::error::AppError;
use crate::models::{CategoryCompareRow, TrendsInsightRequest, TrendsInsightResponse};

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
    // The parse error's own text is included but the model output is NOT: raw
    // output can contain transaction detail, and an AppError crosses IPC (AD-11).
    let payload: AiInsightPayload =
        serde_json::from_str(json_str).map_err(|e| AppError::AiService {
            message: format!("Failed to parse the AI response: {}", e),
            recoverable: true,
        })?;

    Ok(TrendsInsightResponse {
        headline: payload.headline,
        body: payload.body,
        tone: normalize_tone(&payload.tone),
        window_label: window_label.to_string(),
    })
}

pub async fn generate_trends_insight(
    byo: Option<&AiProvider>,
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

    let output_text = backend::invoke(
        byo,
        AiRequest {
            operation: AiOperation::TrendsInsight,
            system: system_prompt,
            turns: vec![AiTurn::user(user_prompt)],
            attachment: None,
        },
        &backend::ignore_deltas(),
    )
    .await?;

    parse_insight_response(&output_text, &window_label)
}
