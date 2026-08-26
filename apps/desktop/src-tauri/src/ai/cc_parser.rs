use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::ai::backend::{self, AiAttachment, AiImageFormat, AiOperation, AiRequest, AiTurn};
use crate::ai::AiProvider;
use crate::error::AppError;
use crate::models::{BudgetCategory, BudgetGroup, MerchantHint};

const CONFIDENCE_THRESHOLD: f64 = 0.8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedCategory {
    pub name: String,
    pub group_id: Option<i64>,
    pub group_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTransaction {
    pub merchant: String,
    pub amount_cents: i64,
    pub date: String,
    pub suggested_category_id: Option<i64>,
    pub confidence: f64,
    #[serde(default)]
    pub propose_category: Option<ProposedCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub transactions: Vec<ParsedTransaction>,
    pub flagged_count: usize,
    pub auto_count: usize,
    pub unreadable: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AiProposedCategory {
    name: String,
    #[serde(default)]
    group_id: Option<i64>,
    #[serde(default)]
    group_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiTransaction {
    merchant: String,
    amount_cents: i64,
    date: String,
    suggested_category_id: Option<i64>,
    confidence: f64,
    // Deserialized as a raw JSON value first (see `parse_proposed_category`) so a
    // malformed `propose_category` from the model degrades to "no proposal"
    // instead of failing the whole batch of transactions.
    #[serde(default)]
    propose_category: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AiResponse {
    transactions: Vec<AiTransaction>,
    #[serde(default)]
    unreadable: Vec<String>,
}

fn build_system_prompt(today: &str, categories: &[BudgetCategory], groups: &[BudgetGroup], hints: &[MerchantHint]) -> String {
    let cat_list: Vec<String> = categories
        .iter()
        .map(|c| format!("  - id: {}, name: \"{}\"", c.id, c.name))
        .collect();

    let group_list: Vec<String> = groups
        .iter()
        .map(|g| format!("  - id: {}, name: \"{}\"", g.id, g.name))
        .collect();

    let groups_section = if groups.is_empty() {
        String::new()
    } else {
        format!("\nAvailable budget groups:\n{}\n", group_list.join("\n"))
    };

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
- propose_category: OMIT this field when suggested_category_id is set. When NO existing category is a reasonable fit, instead of forcing a bad match, set suggested_category_id to null, confidence to 0.0, and provide propose_category with a short, sensible category name for this merchant. If an existing group fits, set group_id to that group's ID and omit group_name. If no existing group fits either, set group_name to a short new group name and omit group_id.

Available budget categories:
{}
{}
{}
If some transactions are unreadable (blurry, cut off, etc.), list them in the "unreadable" array with a description.

Respond with ONLY valid JSON in this exact format:
{{
  "transactions": [
    {{ "merchant": "...", "amount_cents": 1234, "date": "2026-01-15", "suggested_category_id": 5, "confidence": 0.95 }},
    {{ "merchant": "...", "amount_cents": 2500, "date": "2026-01-16", "suggested_category_id": null, "confidence": 0.0, "propose_category": {{ "name": "Pet Supplies", "group_id": 3 }} }}
  ],
  "unreadable": ["Row 3: partially cut off, amount not visible"]
}}"#,
        cat_list.join("\n"),
        groups_section,
        hints_section
    )
}

// A malformed `propose_category` (wrong shape, missing name, etc.) must not fail the
// whole batch of transactions the way a top-level `AiResponse` parse failure would.
fn parse_proposed_category(value: Option<serde_json::Value>) -> Option<ProposedCategory> {
    let raw: AiProposedCategory = serde_json::from_value(value?).ok()?;

    let name = raw.name.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let group_id = raw.group_id.filter(|id| *id > 0);
    let group_name = raw
        .group_name
        .map(|g| g.trim().to_string())
        .filter(|g| !g.is_empty());

    Some(ProposedCategory {
        name,
        group_id,
        group_name,
    })
}

/// Maps the on-disk extension onto the closed attachment union. An unsupported
/// extension is rejected here rather than silently sent as a PNG.
fn attachment_for(ext: &str, bytes: Vec<u8>) -> Result<AiAttachment, AppError> {
    match ext {
        "pdf" => Ok(AiAttachment::Document { bytes }),
        "png" => Ok(AiAttachment::Image {
            format: AiImageFormat::Png,
            bytes,
        }),
        "jpg" | "jpeg" => Ok(AiAttachment::Image {
            format: AiImageFormat::Jpeg,
            bytes,
        }),
        // The message deliberately names the extension, never the path.
        other => Err(AppError::Validation {
            message: format!("Unsupported statement file type: .{}", other),
            field: Some("file_path".to_string()),
        }),
    }
}

pub async fn parse_cc_statement(
    byo: Option<&AiProvider>,
    file_path: &str,
    categories: &[BudgetCategory],
    groups: &[BudgetGroup],
    hints: &[MerchantHint],
) -> Result<ParseResult, AppError> {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let file_bytes = std::fs::read(file_path).map_err(|e| AppError::File {
        // `e` is io::Error, whose Display does not include the path; formatting the
        // path here would put a statement filename into an IPC error (AD-11).
        message: format!("Cannot read file: {}", e),
    })?;

    // Size and type only. The statement path is deliberately absent from every log
    // line in this module (AD-11).
    info!(
        "Preparing statement for AI extraction ({} bytes, type: {})",
        file_bytes.len(),
        ext
    );

    let attachment = attachment_for(&ext, file_bytes)?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system_prompt = build_system_prompt(&today, categories, groups, hints);

    let output_text = backend::invoke(
        byo,
        AiRequest {
            operation: AiOperation::StatementImport,
            system: system_prompt,
            turns: vec![AiTurn::user(
                "Extract all transactions from this credit card statement.",
            )],
            attachment: Some(attachment),
        },
        &backend::ignore_deltas(),
    )
    .await?;

    info!("AI response received, parsing JSON");

    let json_str = extract_json(&output_text);

    // The parse error's own text is included but the model output is NOT: raw
    // output contains transaction detail, and an AppError crosses IPC (AD-11).
    let ai_response: AiResponse =
        serde_json::from_str(json_str).map_err(|e| AppError::AiService {
            message: format!("Failed to parse the AI response: {}", e),
            recoverable: true,
        })?;

    let transactions: Vec<ParsedTransaction> = ai_response
        .transactions
        .into_iter()
        .map(|t| {
            let propose_category = parse_proposed_category(t.propose_category);
            let confidence = if propose_category.is_some() { 0.0 } else { t.confidence };
            ParsedTransaction {
                merchant: t.merchant,
                amount_cents: t.amount_cents,
                date: t.date,
                suggested_category_id: t.suggested_category_id,
                confidence,
                propose_category,
            }
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
