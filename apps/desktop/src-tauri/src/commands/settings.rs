use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

use crate::ai::{AiProvider, AiState};
use crate::db::config as config_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::credentials;

#[derive(Serialize)]
pub struct AiConfigResponse {
    pub provider: Option<String>,
    pub configured: bool,
    pub region: String,
}

#[derive(Serialize)]
pub struct TestConnectionResponse {
    pub status: String,
    pub provider: String,
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_ai_config(db: State<'_, DbState>) -> Result<AiConfigResponse, AppError> {
    let conn = db.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let provider = config_db::get(&conn, "ai_provider");
    let ai_configured = config_db::get(&conn, "ai_configured");
    let region = config_db::get(&conn, "aws_region")
        .unwrap_or_else(|| "us-east-1".to_string());

    let configured = ai_configured.as_deref() == Some("true");

    Ok(AiConfigResponse {
        provider,
        configured,
        region,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_aws_credentials(
    access_key: String,
    secret_key: String,
    region: String,
    db: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
) -> Result<(), AppError> {
    use aws_config::BehaviorVersion;
    use aws_sdk_bedrockruntime::config::Credentials;

    // Build a temporary client to validate credentials before storing
    let creds = Credentials::new(&access_key, &secret_key, None, None, "nkbaz-user");
    let aws_cfg = aws_config::defaults(BehaviorVersion::latest())
        .region(aws_config::Region::new(region.clone()))
        .credentials_provider(creds)
        .load()
        .await;
    let temp_client = aws_sdk_bedrockruntime::Client::new(&aws_cfg);

    // Validate credentials with a test call (list_async_invokes returns empty or auth error)
    temp_client
        .list_async_invokes()
        .send()
        .await
        .map_err(|_| AppError::InvalidCredentials)?;

    // Store credentials in keyring
    credentials::store_aws_credentials(&access_key, &secret_key, &region)
        .map_err(|e| AppError::AiService {
            message: e.to_string(),
            recoverable: false,
        })?;

    // Write config to DB
    {
        let conn = db.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        config_db::set(&conn, "ai_provider", "bedrock")
            .map_err(|e| AppError::Database { message: e.to_string() })?;
        config_db::set(&conn, "aws_region", &region)
            .map_err(|e| AppError::Database { message: e.to_string() })?;
        config_db::set(&conn, "ai_configured", "true")
            .map_err(|e| AppError::Database { message: e.to_string() })?;
    }

    // Update AiState in place (temp_client is the validated real client)
    let mut ai = ai_state.lock().map_err(|_| AppError::Database {
        message: "AI state lock poisoned".to_string(),
    })?;
    ai.provider = Some(AiProvider::Bedrock(temp_client));

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_openai_credentials(
    api_key: String,
    db: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
) -> Result<(), AppError> {
    use async_openai::{Client as OpenAIClient, config::OpenAIConfig};

    // Build and validate the OpenAI client
    let config = OpenAIConfig::new().with_api_key(&api_key);
    let temp_client = OpenAIClient::with_config(config);

    temp_client
        .models()
        .list()
        .await
        .map_err(|_| AppError::InvalidCredentials)?;

    // Store key in keyring
    credentials::store_openai_key(&api_key).map_err(|e| AppError::AiService {
        message: e.to_string(),
        recoverable: false,
    })?;

    // Write config to DB
    {
        let conn = db.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        config_db::set(&conn, "ai_provider", "openai")
            .map_err(|e| AppError::Database { message: e.to_string() })?;
        config_db::set(&conn, "ai_configured", "true")
            .map_err(|e| AppError::Database { message: e.to_string() })?;
    }

    // Update AiState in place
    let mut ai = ai_state.lock().map_err(|_| AppError::Database {
        message: "AI state lock poisoned".to_string(),
    })?;
    ai.provider = Some(AiProvider::OpenAI(temp_client));

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn clear_ai_credentials(
    db: State<'_, DbState>,
    ai_state: State<'_, Mutex<AiState>>,
) -> Result<(), AppError> {
    credentials::clear_credentials();

    {
        let conn = db.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        config_db::set(&conn, "ai_configured", "false")
            .map_err(|e| AppError::Database { message: e.to_string() })?;
    }

    let mut ai = ai_state.lock().map_err(|_| AppError::Database {
        message: "AI state lock poisoned".to_string(),
    })?;
    ai.provider = None;

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn test_ai_connection(
    ai_state: State<'_, Mutex<AiState>>,
) -> Result<TestConnectionResponse, AppError> {
    // Extract provider info and client before any await
    enum ProviderKind {
        Bedrock(aws_sdk_bedrockruntime::Client),
        OpenAI(async_openai::Client<async_openai::config::OpenAIConfig>),
    }

    let provider_kind = {
        let ai = ai_state.lock().map_err(|_| AppError::Database {
            message: "AI state lock poisoned".to_string(),
        })?;
        match &ai.provider {
            None => return Err(AppError::NotConfigured),
            Some(AiProvider::Bedrock(client)) => ProviderKind::Bedrock(client.clone()),
            Some(AiProvider::OpenAI(client)) => ProviderKind::OpenAI(client.clone()),
        }
    };

    match provider_kind {
        ProviderKind::Bedrock(client) => {
            client
                .list_async_invokes()
                .send()
                .await
                .map_err(|_| AppError::Unavailable)?;
            Ok(TestConnectionResponse {
                status: "ok".to_string(),
                provider: "bedrock".to_string(),
            })
        }
        ProviderKind::OpenAI(client) => {
            client
                .models()
                .list()
                .await
                .map_err(|_| AppError::Unavailable)?;
            Ok(TestConnectionResponse {
                status: "ok".to_string(),
                provider: "openai".to_string(),
            })
        }
    }
}
