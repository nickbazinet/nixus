use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

/// Write-to-temp-then-rename, shared by every file-backed store so neither
/// carries its own atomic-write implementation.
///
/// WHY the temp path is derived with `with_extension`: it *replaces* the
/// extension, so `<name>.json` becomes `<name>.json.tmp` only because callers
/// pass paths whose stem contains no `.`. `profile_store::validate_sub`'s
/// charset allow-list is load-bearing for this scheme, not just for traversal.
pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::File {
        message: "Invalid JSON file path".to_string(),
    })?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::File {
        message: format!("Failed to create parent dir: {}", e),
    })?;

    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| AppError::File {
        message: format!("Failed to serialize JSON data: {}", e),
    })?;
    std::fs::write(&tmp_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write JSON temp file: {}", e),
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| AppError::File {
        message: format!("Failed to finalize JSON file: {}", e),
    })?;
    Ok(())
}

/// The same write-to-temp-then-rename for a caller that already holds the exact bytes.
///
/// It exists for `profile_store::mark_upload_declined`, which patches a document's TEXT rather
/// than re-serializing a struct: re-serializing would reorder the user's keys (AD-8 requires the
/// declined file to be the original plus one member). Sharing the temp-path scheme is what keeps
/// one atomic-write implementation in the codebase.
pub(crate) fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::File {
        message: "Invalid JSON file path".to_string(),
    })?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::File {
        message: format!("Failed to create parent dir: {}", e),
    })?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, bytes).map_err(|e| AppError::File {
        message: format!("Failed to write JSON temp file: {}", e),
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| AppError::File {
        message: format!("Failed to finalize JSON file: {}", e),
    })?;
    Ok(())
}
