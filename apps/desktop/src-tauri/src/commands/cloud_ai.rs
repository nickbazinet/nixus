use crate::error::AppError;

/// Whether the signed-in Nixus Cloud account carries hosted-AI premium access.
///
/// The entire IPC surface for hosted-AI status, and deliberately a bare boolean: the
/// request limit, the charged count and the period key stay inside the crate (AD-9),
/// so a webview that renders the entitlement can never hold a usage figure.
///
/// Never `Err`, because `premium_entitlement` is fail-closed. That is what lets a
/// caller treat "not premium" and "status could not be read" as the same silent
/// non-claim instead of an error state to surface.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_cloud_ai_premium() -> Result<bool, AppError> {
    Ok(crate::ai::hosted_bedrock::premium_entitlement().await)
}
