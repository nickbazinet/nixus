pub mod backend;
pub mod cc_parser;
pub mod chat;
pub mod hosted_bedrock;
#[cfg(test)]
mod hosted_e2e;
pub mod hosted_state;
pub mod project_advice;
pub mod trends_insight;

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

/// Snapshots the configured BYO provider so callers can release `AiState`'s guard
/// before crossing an await point. Both underlying clients are cheap handles.
///
/// `None` means "no BYO provider configured", which is no longer a terminal state:
/// hosted Bedrock can still serve a premium user who never entered credentials.
pub fn clone_provider(provider: &Option<AiProvider>) -> Option<AiProvider> {
    match provider {
        Some(AiProvider::Bedrock(client)) => Some(AiProvider::Bedrock(client.clone())),
        Some(AiProvider::OpenAI(client)) => Some(AiProvider::OpenAI(client.clone())),
        None => None,
    }
}

/// The database-side inputs the provider client needs, read in one pass.
///
/// Exists so no caller has to hold `DbState`'s guard across `init_ai_client`'s
/// `.await` points: the snapshot is taken under the lock, the lock is released,
/// and only then is the client built.
pub struct AiConfigSnapshot {
    configured: bool,
    provider: String,
}

pub fn read_ai_config(conn: &rusqlite::Connection) -> AiConfigSnapshot {
    let configured = crate::db::config::get(conn, "ai_configured")
        .unwrap_or_else(|| "false".to_string());
    let provider = crate::db::config::get(conn, "ai_provider")
        .unwrap_or_else(|| "bedrock".to_string());

    AiConfigSnapshot {
        configured: configured == "true",
        provider,
    }
}

/// Whether machine-wide ambient credentials (`AWS_REGION` + the AWS default
/// provider chain, `OPENAI_API_KEY`) may stand in for a missing keyring entry.
///
/// Default only, and that is the whole point: honouring the environment for a
/// non-default profile would hand it whatever credentials the machine happens to
/// carry, silently defeating the per-profile isolation this scoping buys. Default
/// keeps the pre-dataset behaviour so existing setups are unaffected.
fn ambient_fallback_allowed(dataset_id: &str) -> bool {
    dataset_id == crate::datasets::DEFAULT_DATASET_ID
}

/// Builds the provider client for `dataset_id`, whose keyring service owns that
/// profile's credentials — the id is what keeps a rebuilt client from picking up
/// the previously active profile's key.
pub async fn init_ai_client(config: &AiConfigSnapshot, dataset_id: &str) -> AiState {
    if !config.configured {
        info!("AI not configured, skipping client initialization");
        return AiState { provider: None };
    }

    match config.provider.as_str() {
        "bedrock" => {
            match crate::credentials::load_aws_credentials(dataset_id) {
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
                None if ambient_fallback_allowed(dataset_id) => {
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
                None => {
                    info!("No Bedrock credentials for this profile, leaving AI unconfigured");
                    AiState { provider: None }
                }
            }
        }
        "openai" => {
            let api_key = match crate::credentials::load_openai_key(dataset_id) {
                Some(key) => key,
                None if ambient_fallback_allowed(dataset_id) => {
                    match std::env::var("OPENAI_API_KEY") {
                        Ok(key) => key,
                        Err(_) => {
                            info!("No OpenAI API key found");
                            return AiState { provider: None };
                        }
                    }
                }
                None => {
                    info!("No OpenAI API key for this profile, leaving AI unconfigured");
                    return AiState { provider: None };
                }
            };
            info!("Initializing OpenAI client");
            let config = OpenAIConfig::new().with_api_key(api_key);
            let client = OpenAIClient::with_config(config);
            AiState { provider: Some(AiProvider::OpenAI(client)) }
        }
        other => {
            info!("Unknown AI provider: {}", other);
            AiState { provider: None }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials;
    use crate::datasets::DEFAULT_DATASET_ID;

    const DATASET_A: &str = "local-1";
    const DATASET_B: &str = "local-2";

    /// A non-default profile with no keyring key of its own must resolve to no
    /// provider, never to an ambient machine-wide one. `OPENAI_API_KEY` is set
    /// deliberately for the duration: without it the assertion would pass even
    /// with the ambient fallback still wide open, proving nothing.
    #[test]
    fn only_the_profile_holding_a_key_gets_a_provider() {
        let _g = credentials::test_keyring_guard();
        credentials::clear_credentials(DATASET_A);
        credentials::clear_credentials(DATASET_B);
        credentials::store_openai_key(DATASET_A, "sk-a").unwrap();

        let previous = std::env::var("OPENAI_API_KEY").ok();
        std::env::set_var("OPENAI_API_KEY", "sk-ambient-machine-wide");

        let config = AiConfigSnapshot {
            configured: true,
            provider: "openai".to_string(),
        };

        let with_key = tauri::async_runtime::block_on(init_ai_client(&config, DATASET_A));
        let without_key = tauri::async_runtime::block_on(init_ai_client(&config, DATASET_B));
        let default_falls_back =
            tauri::async_runtime::block_on(init_ai_client(&config, DEFAULT_DATASET_ID));

        match previous {
            Some(value) => std::env::set_var("OPENAI_API_KEY", value),
            None => std::env::remove_var("OPENAI_API_KEY"),
        }

        assert!(
            with_key.provider.is_some(),
            "dataset A stored its own key and must get a client"
        );
        assert!(
            without_key.provider.is_none(),
            "dataset B has no key of its own and must not inherit the ambient one"
        );
        assert!(
            default_falls_back.provider.is_some(),
            "Default's pre-dataset ambient fallback must still work"
        );
    }
}
