use aws_sdk_bedrockruntime::Client;
use aws_sdk_bedrockruntime::types::{
    ContentBlock, ConversationRole, Message, SystemContentBlock,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::error::AppError;
use crate::models::{BudgetCategory, MerchantHint};

const MODEL_ID: &str = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const CONFIDENCE_THRESHOLD: f64 = 0.8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTransaction {
    pub merchant: String,
    pub amount_cents: i64,
    pub date: String,
    pub suggested_category_id: Option<i64>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub transactions: Vec<ParsedTransaction>,
    pub flagged_count: usize,
    pub auto_count: usize,
    pub unreadable: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AiTransaction {
    merchant: String,
    amount_cents: i64,
    date: String,
    suggested_category_id: Option<i64>,
    confidence: f64,
}

#[derive(Debug, Deserialize)]
struct AiResponse {
    transactions: Vec<AiTransaction>,
    #[serde(default)]
    unreadable: Vec<String>,
}

fn build_system_prompt(today: &str, categories: &[BudgetCategory], hints: &[MerchantHint]) -> String {
    let cat_list: Vec<String> = categories
        .iter()
        .map(|c| format!("  - id: {}, name: \"{}\"", c.id, c.name))
        .collect();

    let hints_section = if hints.is_empty() {
        String::new()
    } else {
        let top_hints: Vec<&MerchantHint> = hints.iter().take(30).collect();
        let hint_lines: Vec<String> = top_hints
            .iter()
            .map(|h| {
                let confidence_pct = (h.confidence_score * 100.0).round() as i64;
                format!(
                    "  - \"{}\" → category id {} (used {} times, {}% confidence)",
                    h.merchant, h.budget_category_id, h.usage_count, confidence_pct
                )
            })
            .collect();
        format!(
            "\nKnown merchant-category mappings from past imports (use these when the merchant matches):\n{}\n\nWhen a merchant matches a known mapping, use that category_id directly.\n",
            hint_lines.join("\n")
        )
    };

    format!(
        r#"You are a financial data extraction assistant. Extract transactions from the credit card statement image or PDF provided.

Today's date is {today}. Use the current year for any dates that don't include a year.

For each transaction, return:
- merchant: the merchant/vendor name
- amount_cents: the amount in cents. Always positive. Use a dot as the decimal separator when interpreting amounts. Commas in amounts should be treated as decimal separators, not thousands separators (e.g., 29,99$ means $29.99 = 2999 cents, NOT $2999). Examples: $45.67 = 4567, 29,99$ = 2999, 1 234,56$ = 123456.
- date: the transaction date in YYYY-MM-DD format
- suggested_category_id: the best matching budget category ID from the list below, or null if no good match
- confidence: your confidence in the category assignment (0.0 to 1.0)

Available budget categories:
{}
{}
If some transactions are unreadable (blurry, cut off, etc.), list them in the "unreadable" array with a description.

Respond with ONLY valid JSON in this exact format:
{{
  "transactions": [
    {{ "merchant": "...", "amount_cents": 1234, "date": "2026-01-15", "suggested_category_id": 5, "confidence": 0.95 }}
  ],
  "unreadable": ["Row 3: partially cut off, amount not visible"]
}}"#,
        cat_list.join("\n"),
        hints_section
    )
}

fn media_type_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub async fn parse_cc_statement(
    client: &Client,
    file_path: &str,
    categories: &[BudgetCategory],
    hints: &[MerchantHint],
) -> Result<ParseResult, AppError> {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let file_bytes = std::fs::read(file_path).map_err(|e| AppError::File {
        message: format!("Cannot read file: {}", e),
    })?;

    info!(
        "Sending file to Bedrock: {} ({} bytes, type: {})",
        file_path,
        file_bytes.len(),
        media_type_for_extension(&ext)
    );

    let media_type = media_type_for_extension(&ext);

    let image_block = if ext == "pdf" {
        ContentBlock::Document(
            aws_sdk_bedrockruntime::types::DocumentBlock::builder()
                .format(aws_sdk_bedrockruntime::types::DocumentFormat::Pdf)
                .name("statement")
                .source(
                    aws_sdk_bedrockruntime::types::DocumentSource::Bytes(
                        aws_sdk_bedrockruntime::primitives::Blob::new(file_bytes),
                    ),
                )
                .build()
                .map_err(|e| AppError::AiService {
                    message: format!("Failed to build document block: {}", e),
                    recoverable: false,
                })?,
        )
    } else {
        ContentBlock::Image(
            aws_sdk_bedrockruntime::types::ImageBlock::builder()
                .format(match media_type {
                    "image/png" => aws_sdk_bedrockruntime::types::ImageFormat::Png,
                    "image/jpeg" => aws_sdk_bedrockruntime::types::ImageFormat::Jpeg,
                    _ => aws_sdk_bedrockruntime::types::ImageFormat::Png,
                })
                .source(
                    aws_sdk_bedrockruntime::types::ImageSource::Bytes(
                        aws_sdk_bedrockruntime::primitives::Blob::new(file_bytes),
                    ),
                )
                .build()
                .map_err(|e| AppError::AiService {
                    message: format!("Failed to build image block: {}", e),
                    recoverable: false,
                })?,
        )
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = build_system_prompt(&today, categories, hints);

    let message = Message::builder()
        .role(ConversationRole::User)
        .content(image_block)
        .content(ContentBlock::Text(
            "Extract all transactions from this credit card statement.".to_string(),
        ))
        .build()
        .map_err(|e| AppError::AiService {
            message: format!("Failed to build message: {}", e),
            recoverable: false,
        })?;

    let response = client
        .converse()
        .model_id(MODEL_ID)
        .system(SystemContentBlock::Text(system_prompt))
        .messages(message)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Bedrock API error details: {:?}", e);
            AppError::AiService {
                message: format!("Bedrock API error: {:?}", e),
                recoverable: true,
            }
        })?;

    let output_text = response
        .output()
        .and_then(|o| o.as_message().ok())
        .and_then(|m| m.content().first())
        .and_then(|c| c.as_text().ok())
        .ok_or_else(|| AppError::AiService {
            message: "No text response from Bedrock".to_string(),
            recoverable: true,
        })?;

    info!("Bedrock response received, parsing JSON");

    // Extract JSON from response (handle markdown code blocks)
    let json_str = extract_json(output_text);

    let ai_response: AiResponse =
        serde_json::from_str(json_str).map_err(|e| AppError::AiService {
            message: format!("Failed to parse AI response: {}. Raw: {}", e, output_text),
            recoverable: true,
        })?;

    let transactions: Vec<ParsedTransaction> = ai_response
        .transactions
        .into_iter()
        .map(|t| ParsedTransaction {
            merchant: t.merchant,
            amount_cents: t.amount_cents,
            date: t.date,
            suggested_category_id: t.suggested_category_id,
            confidence: t.confidence,
        })
        .collect();

    let flagged_count = transactions
        .iter()
        .filter(|t| t.confidence < CONFIDENCE_THRESHOLD)
        .count();
    let auto_count = transactions.len() - flagged_count;

    info!(
        "Parsed {} transactions ({} auto, {} flagged, {} unreadable)",
        transactions.len(),
        auto_count,
        flagged_count,
        ai_response.unreadable.len()
    );

    Ok(ParseResult {
        transactions,
        flagged_count,
        auto_count,
        unreadable: ai_response.unreadable,
    })
}

fn extract_json(text: &str) -> &str {
    // Try to extract JSON from markdown code blocks
    if let Some(start) = text.find("```json") {
        let json_start = start + 7;
        if let Some(end) = text[json_start..].find("```") {
            return text[json_start..json_start + end].trim();
        }
    }
    if let Some(start) = text.find("```") {
        let json_start = start + 3;
        // Skip any language identifier on the same line
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
