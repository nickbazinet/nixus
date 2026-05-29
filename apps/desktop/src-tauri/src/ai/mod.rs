pub mod cc_parser;
pub mod chat;

use aws_config::BehaviorVersion;
use aws_sdk_bedrockruntime::Client as BedrockClient;
use async_openai::{Client as OpenAIClient, config::OpenAIConfig};
use tracing::info;

pub enum AiProvider {
    Bedrock(BedrockClient),
    OpenAI(OpenAIClient<OpenAIConfig>),
}

pub struct AiState {
    pub provider: Option<AiProvider>,
}

pub async fn init_ai_client(conn: &rusqlite::Connection) -> AiState {
    // Check if AI is configured
    let configured = crate::db::config::get(conn, "ai_configured")
        .unwrap_or_else(|| "false".to_string());
    if configured != "true" {
        info!("AI not configured, skipping client initialization");
        return AiState { provider: None };
    }

    let provider_name = crate::db::config::get(conn, "ai_provider")
        .unwrap_or_else(|| "bedrock".to_string());

    match provider_name.as_str() {
        "bedrock" => {
            match crate::credentials::load_aws_credentials() {
                Some((access_key, secret_key, region)) => {
                    info!("Initializing Bedrock client from keyring credentials");
                    use aws_sdk_bedrockruntime::config::Credentials;
                    let creds = Credentials::new(
                        &access_key,
                        &secret_key,
                        None,
                        None,
                        "nkbaz-keyring",
                    );
                    let config = aws_config::defaults(BehaviorVersion::latest())
                        .region(aws_config::Region::new(region))
                        .credentials_provider(creds)
                        .load()
                        .await;
                    let client = BedrockClient::new(&config);
                    AiState { provider: Some(AiProvider::Bedrock(client)) }
                }
                None => {
                    info!("No keyring credentials, falling back to default AWS config");
                    let region = std::env::var("AWS_REGION")
                        .unwrap_or_else(|_| "us-east-1".to_string());
                    let config = aws_config::defaults(BehaviorVersion::latest())
                        .region(aws_config::Region::new(region))
                        .load()
                        .await;
                    let client = BedrockClient::new(&config);
                    AiState { provider: Some(AiProvider::Bedrock(client)) }
                }
            }
        }
        "openai" => {
            let api_key = match crate::credentials::load_openai_key() {
                Some(key) => key,
                None => match std::env::var("OPENAI_API_KEY") {
                    Ok(key) => key,
                    Err(_) => {
                        info!("No OpenAI API key found");
                        return AiState { provider: None };
                    }
                },
            };
            info!("Initializing OpenAI client");
            let config = OpenAIConfig::new().with_api_key(api_key);
            let client = OpenAIClient::with_config(config);
            AiState { provider: Some(AiProvider::OpenAI(client)) }
        }
        _ => {
            info!("Unknown AI provider: {}", provider_name);
            AiState { provider: None }
        }
    }
}
