use crate::error::AppError;

/// Whether the signed-in Nixus Cloud account's entitlement grants hosted AI.
///
/// The entire IPC surface for hosted-AI entitlement, and deliberately a bare boolean: every
/// usage figure stays inside the crate (AD-9), so a webview that renders the entitlement can
/// never hold one.
///
/// Capability-derived (billing AD-12): the answer comes from the offline-verified entitlement
/// statement, not from a plan label and not from the deprecated boolean the quota route carries.
///
/// Never `Err`, because the capability read is fail-closed. That is what lets a caller treat
/// "this plan does not include it" and "the entitlement could not be established" as the same
/// silent non-claim instead of an error state to surface.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_cloud_ai_premium() -> Result<bool, AppError> {
    Ok(crate::ai::hosted_bedrock::hosted_ai_entitled().await)
}
