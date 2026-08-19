use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;

use crate::ai::cc_parser;
use crate::ai::{AiProvider, AiState};
use crate::datasets;
use crate::db::audit as audit_db;
use crate::db::budget as budget_db;
use crate::db::expense as expense_db;
use crate::db::DbState;
use crate::error::AppError;

const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024; // 20MB

const ALLOWED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "pdf"];

const CLIPBOARD_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg"];

static PASTE_FILE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct FileValidationResult {
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
}

#[derive(Serialize)]
pub struct ClipboardImageSaveResult {
    pub file_path: String,
}

fn resolve_import_staging_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    datasets::active_dataset_dir(app)
}

fn normalize_clipboard_extension(extension: &str) -> Result<String, AppError> {
    let ext = extension.trim().trim_start_matches('.').to_lowercase();
    if !CLIPBOARD_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::File {
            message: "Only PNG and JPEG screenshots can be pasted".to_string(),
        });
    }
    Ok(ext)
}

fn validate_clipboard_bytes(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.is_empty() {
        return Err(AppError::File {
            message: "Clipboard image is empty".to_string(),
        });
    }
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(AppError::File {
            message: "File exceeds 20MB size limit".to_string(),
        });
    }
    Ok(())
}

fn cleanup_old_paste_files(imports_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(imports_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("paste-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn decode_clipboard_base64(bytes_base64: &str) -> Result<Vec<u8>, AppError> {
    base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.trim())
        .map_err(|_| AppError::File {
            message: "Invalid clipboard image data".to_string(),
        })
}

#[derive(Clone, Serialize)]
struct ImportProgress {
    stage: String,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
struct ImportComplete {
    transactions: Vec<cc_parser::ParsedTransaction>,
    flagged_count: usize,
    auto_count: usize,
    unreadable: Vec<String>,
    duplicate_indices: Vec<usize>,
}

#[derive(Clone, Serialize)]
struct ImportError {
    message: String,
    recoverable: bool,
}

#[tauri::command(rename_all = "snake_case")]
pub fn validate_cc_file(file_path: String) -> Result<FileValidationResult, AppError> {
    let path = std::path::Path::new(&file_path);

    if !path.exists() {
        return Err(AppError::File {
            message: "File not found".to_string(),
        });
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::File {
            message: "Only images and PDFs supported".to_string(),
        });
    }

    let metadata = std::fs::metadata(&file_path).map_err(|e| AppError::File {
        message: format!("Cannot read file: {}", e),
    })?;

    if metadata.len() > MAX_FILE_SIZE {
        return Err(AppError::File {
            message: "File exceeds 20MB size limit".to_string(),
        });
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(FileValidationResult {
        file_name,
        file_path,
        file_size: metadata.len(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_import_clipboard_image(
    app: AppHandle,
    bytes_base64: String,
    extension: String,
) -> Result<ClipboardImageSaveResult, AppError> {
    let ext = normalize_clipboard_extension(&extension)?;
    let bytes = decode_clipboard_base64(&bytes_base64)?;
    validate_clipboard_bytes(&bytes)?;

    let app_data_dir = resolve_import_staging_dir(&app)?;
    let imports_dir = app_data_dir.join("imports");
    std::fs::create_dir_all(&imports_dir).map_err(|e| AppError::File {
        message: format!("Failed to create imports directory: {}", e),
    })?;

    cleanup_old_paste_files(&imports_dir);

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = PASTE_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let file_path = imports_dir.join(format!("paste-{stamp}-{seq}.{ext}"));

    std::fs::write(&file_path, &bytes).map_err(|e| AppError::File {
        message: format!("Failed to write clipboard image: {}", e),
    })?;

    let file_path = file_path
        .to_str()
        .ok_or_else(|| AppError::File {
            message: "Invalid clipboard image path".to_string(),
        })?
        .to_string();

    info!("Saved clipboard import image to {}", file_path);

    Ok(ClipboardImageSaveResult { file_path })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn import_cc_statement(
    app: AppHandle,
    db_state: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
    file_path: String,
) -> Result<(), AppError> {
    // Emit uploading stage
    let _ = app.emit(
        "import:progress",
        ImportProgress {
            stage: "uploading".to_string(),
            message: Some("Preparing file...".to_string()),
        },
    );

    // Fetch budget categories, groups, and merchant hints for AI context
    let (categories, groups, hints) = {
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        let cats = budget_db::get_all_budget_categories(&conn)?;
        let groups = budget_db::get_budget_groups(&conn)?;
        let hints = expense_db::get_merchant_category_hints(&conn)?;
        (cats, groups, hints)
    };

    // Extract the Bedrock client before any await points
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

    // Emit extracting stage
    let _ = app.emit(
        "import:progress",
        ImportProgress {
            stage: "extracting".to_string(),
            message: Some("AI is reading your statement...".to_string()),
        },
    );

    info!("Starting AI extraction for file: {}", file_path);

    // Call AI parser
    let result = cc_parser::parse_cc_statement(&bedrock_client, &file_path, &categories, &groups, &hints).await;

    match result {
        Ok(parse_result) => {
            // Emit categorizing stage
            let _ = app.emit(
                "import:progress",
                ImportProgress {
                    stage: "categorizing".to_string(),
                    message: Some(format!(
                        "Categorized {} transactions...",
                        parse_result.transactions.len()
                    )),
                },
            );

            // Check for duplicates (non-blocking: degrade gracefully on error)
            let duplicate_indices = (|| -> Result<Vec<usize>, AppError> {
                let active = db_state.0.lock().map_err(|e| AppError::Database {
                    message: e.to_string(),
                })?;
                let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
                let tuples: Vec<(String, String, i64)> = parse_result
                    .transactions
                    .iter()
                    .map(|t| (t.merchant.clone(), t.date.clone(), t.amount_cents))
                    .collect();
                expense_db::find_duplicate_indices(&conn, &tuples)
            })()
            .unwrap_or_else(|e| {
                error!("Duplicate check failed (non-blocking): {}", e);
                Vec::new()
            });

            if !duplicate_indices.is_empty() {
                info!("{} potential duplicate(s) found", duplicate_indices.len());
            }

            // Emit done stage
            let _ = app.emit(
                "import:progress",
                ImportProgress {
                    stage: "done".to_string(),
                    message: None,
                },
            );

            // Emit complete with results
            let _ = app.emit(
                "import:complete",
                ImportComplete {
                    transactions: parse_result.transactions,
                    flagged_count: parse_result.flagged_count,
                    auto_count: parse_result.auto_count,
                    unreadable: parse_result.unreadable,
                    duplicate_indices,
                },
            );

            info!("Import complete");
            Ok(())
        }
        Err(e) => {
            error!("Import failed: {}", e);
            let _ = app.emit(
                "import:error",
                ImportError {
                    message: format!("{}", e),
                    recoverable: true,
                },
            );
            Err(e)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ConfirmTransaction {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
    pub original_suggested_category_id: Option<i64>,
}

#[derive(Serialize)]
pub struct ConfirmResult {
    pub imported_count: usize,
}

fn normalize_date(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();

    // Try YYYY-MM-DD first (already valid)
    if let Ok(d) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Ok(d.format("%Y-%m-%d").to_string());
    }

    // Title-case each segment (split on whitespace and hyphens) for chrono's %b
    // which expects "Mar" not "MAR" or "mar". Preserves delimiters.
    let title_cased: String = trimmed
        .split_inclusive(|c: char| c.is_whitespace() || c == '-')
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect();

    // Formats with year.
    // Slash formats: US (%m/%d/%Y) is tried before international (%d/%m/%Y).
    // Ambiguous dates like "03/04/2026" will be interpreted as US (March 4th).
    let formats_with_year = [
        "%d %b %Y", "%b %d, %Y", "%d-%b-%Y", "%b-%d-%Y",
        "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d",
    ];
    for fmt in &formats_with_year {
        if let Ok(d) = NaiveDate::parse_from_str(&title_cased, fmt) {
            return Ok(d.format("%Y-%m-%d").to_string());
        }
    }

    // Yearless formats — use current year
    let current_year = Local::now().year();
    let formats_no_year = ["%d %b", "%b %d", "%d-%b", "%b-%d"];
    for fmt in &formats_no_year {
        if let Ok(d) = NaiveDate::parse_from_str(
            &format!("{} {}", title_cased, current_year),
            &format!("{} %Y", fmt),
        ) {
            return Ok(d.format("%Y-%m-%d").to_string());
        }
    }

    Err(AppError::Validation {
        message: format!("Cannot parse date: '{}'", raw),
        field: Some("date".to_string()),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn confirm_import(
    state: State<DbState>,
    transactions: Vec<ConfirmTransaction>,
) -> Result<ConfirmResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let tuples: Vec<(String, i64, i64, String)> = transactions
        .iter()
        .map(|t| {
            let normalized_date = normalize_date(&t.date)?;
            Ok((
                t.merchant.clone(),
                t.amount_cents,
                t.budget_category_id,
                normalized_date,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let count = expense_db::bulk_insert_imported_expenses(&conn, &tuples)?;

    // Record merchant-category hints for future imports
    for tx in &transactions {
        if tx.merchant.trim().len() > 2 {
            let user_corrected = tx
                .original_suggested_category_id
                .map(|orig| orig != tx.budget_category_id)
                .unwrap_or(false);
            if let Err(e) = expense_db::record_merchant_category_hint(
                &conn,
                &tx.merchant,
                tx.budget_category_id,
                user_corrected,
            ) {
                tracing::warn!("Failed to record merchant hint: {}", e);
            }
        }
    }

    // Audit log
    let details = format!("{{\"transaction_count\":{},\"source\":\"cc_import\"}}", count);
    audit_db::insert_audit_log(&conn, "import", 0, "create", None, Some(&details))?;

    info!("Confirmed import: {} transactions saved", count);

    Ok(ConfirmResult {
        imported_count: count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clipboard_extension_allows_png_jpg_jpeg() {
        assert_eq!(normalize_clipboard_extension("PNG").unwrap(), "png");
        assert_eq!(normalize_clipboard_extension(".jpg").unwrap(), "jpg");
        assert_eq!(normalize_clipboard_extension("jpeg").unwrap(), "jpeg");
    }

    #[test]
    fn normalize_clipboard_extension_rejects_pdf_and_unknown() {
        assert!(normalize_clipboard_extension("pdf").is_err());
        assert!(normalize_clipboard_extension("gif").is_err());
    }

    #[test]
    fn validate_clipboard_bytes_rejects_empty_and_oversized() {
        assert!(validate_clipboard_bytes(&[]).is_err());
        let oversized = vec![0u8; (MAX_FILE_SIZE as usize) + 1];
        assert!(validate_clipboard_bytes(&oversized).is_err());
        assert!(validate_clipboard_bytes(&[1, 2, 3]).is_ok());
    }

    #[test]
    fn decode_clipboard_base64_roundtrip() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3, 4]);
        assert_eq!(decode_clipboard_base64(&encoded).unwrap(), vec![1, 2, 3, 4]);
        assert!(decode_clipboard_base64("%%%").is_err());
    }

    #[test]
    fn normalize_date_yyyy_mm_dd_passthrough() {
        assert_eq!(normalize_date("2026-03-14").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_with_whitespace() {
        assert_eq!(normalize_date("  2026-03-14  ").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_dd_mmm_yearless() {
        let year = Local::now().year();
        assert_eq!(
            normalize_date("14 MAR").unwrap(),
            format!("{}-03-14", year)
        );
    }

    #[test]
    fn normalize_date_dd_mmm_lowercase() {
        let year = Local::now().year();
        assert_eq!(
            normalize_date("14 mar").unwrap(),
            format!("{}-03-14", year)
        );
    }

    #[test]
    fn normalize_date_mmm_dd_yearless() {
        let year = Local::now().year();
        assert_eq!(
            normalize_date("Mar 14").unwrap(),
            format!("{}-03-14", year)
        );
    }

    #[test]
    fn normalize_date_dd_mmm_yyyy() {
        assert_eq!(normalize_date("14 Mar 2026").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_mmm_dd_comma_yyyy() {
        assert_eq!(normalize_date("Mar 14, 2026").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_mm_slash_dd_slash_yyyy() {
        assert_eq!(normalize_date("03/14/2026").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_yyyy_slash_mm_slash_dd() {
        assert_eq!(normalize_date("2026/03/14").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_dd_hyphen_mmm_yyyy() {
        assert_eq!(normalize_date("14-Mar-2026").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_dd_hyphen_mmm_uppercase() {
        assert_eq!(normalize_date("14-MAR-2026").unwrap(), "2026-03-14");
    }

    #[test]
    fn normalize_date_dd_hyphen_mmm_yearless() {
        let year = Local::now().year();
        assert_eq!(
            normalize_date("14-Mar").unwrap(),
            format!("{}-03-14", year)
        );
    }

    #[test]
    fn normalize_date_unparseable_returns_error() {
        let result = normalize_date("tomorrow");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            AppError::Validation { message, field } => {
                assert!(message.contains("tomorrow"));
                assert_eq!(field, Some("date".to_string()));
            }
            _ => panic!("Expected Validation error"),
        }
    }
}
