use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::ai::backend::{
    self, AiAttachment, AiDocumentFormat, AiImageFormat, AiOperation, AiRequest, AiTurn,
};
use crate::ai::AiProvider;
use crate::error::AppError;
use crate::models::{BudgetCategory, BudgetGroup, IncomeSourceWithLastEntry, MerchantHint};

const CONFIDENCE_THRESHOLD: f64 = 0.8;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    #[default]
    Expense,
    Income,
}

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
    #[serde(default)]
    pub kind: TransactionKind,
    /// Income rows only: an existing income source the money most likely came from.
    #[serde(default)]
    pub suggested_income_source_id: Option<i64>,
    /// Income rows only: a short name for a new income source when none of the existing ones fit.
    #[serde(default)]
    pub propose_income_source: Option<String>,
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
    // Raw values for the same reason: an unexpected `kind` or a non-numeric source id degrades
    // to an expense row / no suggestion rather than failing the batch.
    #[serde(default)]
    kind: Option<serde_json::Value>,
    #[serde(default)]
    suggested_income_source_id: Option<serde_json::Value>,
    #[serde(default)]
    propose_income_source: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AiResponse {
    transactions: Vec<AiTransaction>,
    #[serde(default)]
    unreadable: Vec<String>,
}

fn build_system_prompt(
    today: &str,
    categories: &[BudgetCategory],
    groups: &[BudgetGroup],
    hints: &[MerchantHint],
    income_sources: &[IncomeSourceWithLastEntry],
) -> String {
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

    let income_sources_section = if income_sources.is_empty() {
        "\nAvailable income sources: none yet.\n".to_string()
    } else {
        let source_list: Vec<String> = income_sources
            .iter()
            .map(|s| format!("  - id: {}, name: \"{}\", type: {}", s.id, s.name, s.income_type))
            .collect();
        format!("\nAvailable income sources:\n{}\n", source_list.join("\n"))
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
        r#"You are a financial data extraction assistant. Extract transactions from the bank or credit card statement provided: an image, a PDF, a CSV/TSV or Excel export, or an OFX/QFX/QBO bank download.

Today's date is {today}. Use the current year for any dates that don't include a year.

Each transaction is either money going OUT (an expense) or money coming IN (income). Decide this from how the statement presents the line, never from the merchant alone:
- Money in: amounts shown with a minus sign, in parentheses, marked "CR"/"credit", or listed in a credits/deposits column; and lines such as payroll or salary deposits, direct deposits, transfers or e-transfers received, interest earned, dividends, refunds, returns, and cashback.
- Money out: purchases, withdrawals, bill payments made, fees, interest charged.
- A payment made toward this credit card's own balance (e.g. "PAYMENT - THANK YOU", "PAIEMENT - MERCI") is a transfer between the user's own accounts, not income: leave it out of the transactions entirely.
Never report incoming money as an expense.

For each transaction, return:
- kind: "expense" for money out, "income" for money in
- merchant: the merchant/vendor name, or for income the payer / description (e.g. the employer name)
- amount_cents: the amount in cents. Always positive, for both kinds. Use a dot as the decimal separator when interpreting amounts. Commas in amounts should be treated as decimal separators, not thousands separators (e.g., 29,99$ means $29.99 = 2999 cents, NOT $2999). Examples: $45.67 = 4567, 29,99$ = 2999, 1 234,56$ = 123456.
- date: the transaction date in YYYY-MM-DD format
- confidence: your confidence (0.0 to 1.0) in the category assignment for an expense, or in the income source assignment for income

Expense transactions only:
- suggested_category_id: the best matching budget category ID from the list below, or null if no good match
- propose_category: OMIT this field when suggested_category_id is set. When NO existing category is a reasonable fit, instead of forcing a bad match, set suggested_category_id to null, confidence to 0.0, and provide propose_category with a short, sensible category name for this merchant. If an existing group fits, set group_id to that group's ID and omit group_name. If no existing group fits either, set group_name to a short new group name and omit group_id.

Income transactions only (set suggested_category_id to null and omit propose_category):
- suggested_income_source_id: the matching income source ID from the list below, or null if none matches
- propose_income_source: OMIT this field when suggested_income_source_id is set. Otherwise set confidence to 0.0 and give a short name for a new income source (e.g. the employer, client, or "Interest").

Available budget categories:
{}
{}{}{}
If some transactions are unreadable (blurry, cut off, etc.), list them in the "unreadable" array with a description.

Respond with ONLY valid JSON in this exact format:
{{
  "transactions": [
    {{ "kind": "expense", "merchant": "...", "amount_cents": 1234, "date": "2026-01-15", "suggested_category_id": 5, "confidence": 0.95 }},
    {{ "kind": "expense", "merchant": "...", "amount_cents": 2500, "date": "2026-01-16", "suggested_category_id": null, "confidence": 0.0, "propose_category": {{ "name": "Pet Supplies", "group_id": 3 }} }},
    {{ "kind": "income", "merchant": "ACME Corp Payroll", "amount_cents": 250000, "date": "2026-01-15", "suggested_category_id": null, "suggested_income_source_id": 2, "confidence": 0.9 }},
    {{ "kind": "income", "merchant": "Interest", "amount_cents": 312, "date": "2026-01-31", "suggested_category_id": null, "suggested_income_source_id": null, "confidence": 0.0, "propose_income_source": "Interest" }}
  ],
  "unreadable": ["Row 3: partially cut off, amount not visible"]
}}"#,
        cat_list.join("\n"),
        groups_section,
        income_sources_section,
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

fn parse_kind(value: Option<&serde_json::Value>) -> TransactionKind {
    match value.and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()) {
        Some(kind) if kind == "income" => TransactionKind::Income,
        _ => TransactionKind::Expense,
    }
}

// A negative amount means the model kept the statement's credit sign despite the prompt; the
// sign is the more reliable signal, so the row becomes income with the absolute amount.
fn to_parsed_transaction(t: AiTransaction, income_source_ids: &[i64]) -> ParsedTransaction {
    let kind = if t.amount_cents < 0 {
        TransactionKind::Income
    } else {
        parse_kind(t.kind.as_ref())
    };
    let amount_cents = t.amount_cents.abs();

    match kind {
        TransactionKind::Expense => {
            let propose_category = parse_proposed_category(t.propose_category);
            let confidence = if propose_category.is_some() { 0.0 } else { t.confidence };
            ParsedTransaction {
                merchant: t.merchant,
                amount_cents,
                date: t.date,
                suggested_category_id: t.suggested_category_id,
                confidence,
                propose_category,
                kind,
                suggested_income_source_id: None,
                propose_income_source: None,
            }
        }
        TransactionKind::Income => {
            let suggested_income_source_id = t
                .suggested_income_source_id
                .and_then(|v| v.as_i64())
                .filter(|id| income_source_ids.contains(id));
            let propose_income_source = if suggested_income_source_id.is_some() {
                None
            } else {
                t.propose_income_source
                    .as_ref()
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            };
            // Without a matched source the row always lands in "needs review".
            let confidence = if suggested_income_source_id.is_some() { t.confidence } else { 0.0 };
            ParsedTransaction {
                merchant: t.merchant,
                amount_cents,
                date: t.date,
                suggested_category_id: None,
                confidence,
                propose_category: None,
                kind,
                suggested_income_source_id,
                propose_income_source,
            }
        }
    }
}

/// Maps the on-disk extension onto the closed attachment union. An unsupported
/// extension is rejected here rather than silently sent as a PNG.
fn attachment_for(ext: &str, bytes: Vec<u8>) -> Result<AiAttachment, AppError> {
    match ext {
        "pdf" => Ok(AiAttachment::Document {
            format: AiDocumentFormat::Pdf,
            bytes,
        }),
        "csv" => Ok(AiAttachment::Document {
            format: AiDocumentFormat::Csv,
            bytes,
        }),
        "xls" => Ok(AiAttachment::Document {
            format: AiDocumentFormat::Xls,
            bytes,
        }),
        "xlsx" => Ok(AiAttachment::Document {
            format: AiDocumentFormat::Xlsx,
            bytes,
        }),
        // Bedrock has no native format for TSV or OFX/QFX/QBO bank downloads, but all
        // are plain text (OFX is SGML/XML), so they travel as `txt`.
        "txt" | "tsv" | "ofx" | "qfx" | "qbo" => Ok(AiAttachment::Document {
            format: AiDocumentFormat::Txt,
            bytes,
        }),
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
    income_sources: &[IncomeSourceWithLastEntry],
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
    let system_prompt = build_system_prompt(&today, categories, groups, hints, income_sources);

    let output_text = backend::invoke(
        byo,
        AiRequest {
            operation: AiOperation::StatementImport,
            system: system_prompt,
            turns: vec![AiTurn::user(
                "Extract all transactions, both money out and money in, from this statement.",
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

    let income_source_ids: Vec<i64> = income_sources.iter().map(|s| s.id).collect();
    let transactions: Vec<ParsedTransaction> = ai_response
        .transactions
        .into_iter()
        .map(|t| to_parsed_transaction(t, &income_source_ids))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ai_transaction(json: serde_json::Value) -> AiTransaction {
        serde_json::from_value(json).unwrap()
    }

    fn document_format(ext: &str) -> AiDocumentFormat {
        match attachment_for(ext, vec![1]).expect(ext) {
            AiAttachment::Document { format, .. } => format,
            AiAttachment::Image { .. } => panic!("{ext} must map to a document"),
        }
    }

    #[test]
    fn spreadsheet_and_text_exports_map_to_their_document_formats() {
        assert_eq!(document_format("xls"), AiDocumentFormat::Xls);
        assert_eq!(document_format("xlsx"), AiDocumentFormat::Xlsx);
        for ext in ["txt", "tsv", "ofx", "qfx", "qbo"] {
            assert_eq!(document_format(ext), AiDocumentFormat::Txt, "{ext}");
        }
    }

    #[test]
    fn an_unknown_extension_is_rejected() {
        assert!(matches!(
            attachment_for("docx", vec![1]),
            Err(AppError::Validation { .. })
        ));
    }

    #[test]
    fn a_row_without_kind_stays_an_expense() {
        let parsed = to_parsed_transaction(
            ai_transaction(serde_json::json!({
                "merchant": "Grocer", "amount_cents": 4599, "date": "2026-03-10",
                "suggested_category_id": 1, "confidence": 0.95
            })),
            &[],
        );

        assert_eq!(parsed.kind, TransactionKind::Expense);
        assert_eq!(parsed.suggested_category_id, Some(1));
        assert_eq!(parsed.confidence, 0.95);
    }

    #[test]
    fn an_income_row_keeps_a_known_source_and_drops_category_fields() {
        let parsed = to_parsed_transaction(
            ai_transaction(serde_json::json!({
                "kind": "Income", "merchant": "ACME Payroll", "amount_cents": 250000,
                "date": "2026-03-15", "suggested_category_id": 4, "confidence": 0.9,
                "propose_category": { "name": "Salary" },
                "suggested_income_source_id": 2, "propose_income_source": "ACME"
            })),
            &[1, 2],
        );

        assert_eq!(parsed.kind, TransactionKind::Income);
        assert_eq!(parsed.suggested_category_id, None);
        assert!(parsed.propose_category.is_none());
        assert_eq!(parsed.suggested_income_source_id, Some(2));
        assert_eq!(parsed.propose_income_source, None);
        assert_eq!(parsed.confidence, 0.9);
    }

    #[test]
    fn an_income_row_with_an_unknown_source_is_flagged_with_its_proposal() {
        let parsed = to_parsed_transaction(
            ai_transaction(serde_json::json!({
                "kind": "income", "merchant": "Interest", "amount_cents": 312,
                "date": "2026-03-31", "suggested_category_id": null, "confidence": 0.9,
                "suggested_income_source_id": 99, "propose_income_source": "  Interest  "
            })),
            &[1, 2],
        );

        assert_eq!(parsed.suggested_income_source_id, None);
        assert_eq!(parsed.propose_income_source.as_deref(), Some("Interest"));
        assert_eq!(parsed.confidence, 0.0);
    }

    #[test]
    fn a_negative_amount_becomes_income_with_a_positive_amount() {
        let parsed = to_parsed_transaction(
            ai_transaction(serde_json::json!({
                "kind": "expense", "merchant": "Refund", "amount_cents": -2999,
                "date": "2026-03-12", "suggested_category_id": 3, "confidence": 0.9
            })),
            &[],
        );

        assert_eq!(parsed.kind, TransactionKind::Income);
        assert_eq!(parsed.amount_cents, 2999);
        assert_eq!(parsed.suggested_category_id, None);
    }

    #[test]
    fn malformed_income_fields_degrade_instead_of_failing_the_batch() {
        let response: AiResponse = serde_json::from_value(serde_json::json!({
            "transactions": [{
                "kind": 7, "merchant": "Shop", "amount_cents": 100, "date": "2026-03-01",
                "suggested_category_id": null, "confidence": 0.5,
                "suggested_income_source_id": "two", "propose_income_source": { "x": 1 }
            }]
        }))
        .unwrap();

        let parsed = to_parsed_transaction(response.transactions.into_iter().next().unwrap(), &[2]);
        assert_eq!(parsed.kind, TransactionKind::Expense);
        assert_eq!(parsed.suggested_income_source_id, None);
    }

    #[test]
    fn the_prompt_lists_income_sources() {
        let sources = vec![IncomeSourceWithLastEntry {
            id: 2,
            name: "ACME".to_string(),
            income_type: "employment".to_string(),
            last_amount_cents: None,
            last_month: None,
            created_at: String::new(),
            updated_at: String::new(),
        }];
        let prompt = build_system_prompt("2026-03-01", &[], &[], &[], &sources);

        assert!(prompt.contains("id: 2, name: \"ACME\", type: employment"));
        assert!(prompt.contains("\"kind\": \"income\""));
    }
}
