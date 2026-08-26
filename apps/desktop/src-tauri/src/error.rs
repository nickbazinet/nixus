use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Validation { message: String, field: Option<String> },
    Database { message: String },
    AiService { message: String, recoverable: bool },
    Auth { message: String, recoverable: bool },
    /// A hosted-AI (Nixus Cloud Bedrock) failure. `code` is a `CloudAiErrorCode`
    /// from the shared wire contract, kept as the discriminator the frontend
    /// switches on; the raw upstream Bedrock error string is never carried here.
    HostedAi {
        code: String,
        message: String,
        recoverable: bool,
    },
    File { message: String },
    NotConfigured,
    InvalidCredentials,
    Unavailable,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Validation { message, .. } => write!(f, "Validation error: {}", message),
            AppError::Database { message } => write!(f, "Database error: {}", message),
            AppError::AiService { message, .. } => write!(f, "AI service error: {}", message),
            AppError::Auth { message, .. } => write!(f, "Authentication error: {}", message),
            AppError::HostedAi { code, message, .. } => {
                write!(f, "Hosted AI error ({}): {}", code, message)
            }
            AppError::File { message } => write!(f, "File error: {}", message),
            AppError::NotConfigured => write!(f, "AI provider not configured"),
            AppError::InvalidCredentials => write!(f, "AI credentials are invalid"),
            AppError::Unavailable => write!(f, "AI service unreachable"),
        }
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;

        match self {
            AppError::Validation { message, field } => {
                let len = if field.is_some() { 3 } else { 2 };
                let mut map = serializer.serialize_map(Some(len))?;
                map.serialize_entry("type", "validation")?;
                map.serialize_entry("message", message)?;
                if let Some(f) = field {
                    map.serialize_entry("field", f)?;
                }
                map.end()
            }
            AppError::Database { message } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("type", "database")?;
                map.serialize_entry("message", message)?;
                map.end()
            }
            AppError::AiService { message, recoverable } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "ai_service")?;
                map.serialize_entry("message", message)?;
                map.serialize_entry("recoverable", recoverable)?;
                map.end()
            }
            AppError::Auth { message, recoverable } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "auth")?;
                map.serialize_entry("message", message)?;
                map.serialize_entry("recoverable", recoverable)?;
                map.end()
            }
            AppError::File { message } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("type", "file")?;
                map.serialize_entry("message", message)?;
                map.end()
            }
            AppError::HostedAi {
                code,
                message,
                recoverable,
            } => {
                let mut map = serializer.serialize_map(Some(4))?;
                map.serialize_entry("type", "hosted_ai")?;
                map.serialize_entry("code", code)?;
                map.serialize_entry("message", message)?;
                map.serialize_entry("recoverable", recoverable)?;
                map.end()
            }
            AppError::NotConfigured => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "not_configured")?;
                map.serialize_entry("message", "AI provider not configured")?;
                map.serialize_entry("setup_url", "/settings")?;
                map.end()
            }
            AppError::InvalidCredentials => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "invalid_credentials")?;
                map.serialize_entry("message", "AI credentials are invalid")?;
                map.serialize_entry("setup_url", "/settings")?;
                map.end()
            }
            AppError::Unavailable => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("type", "unavailable")?;
                map.serialize_entry("message", "AI service unreachable")?;
                map.end()
            }
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database {
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_serializes_with_type_message_and_recoverable() {
        let json = serde_json::to_string(&AppError::Auth {
            message: "x".to_string(),
            recoverable: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"type":"auth","message":"x","recoverable":true}"#);
    }

    #[test]
    fn auth_error_serializes_unrecoverable_flag() {
        let json = serde_json::to_string(&AppError::Auth {
            message: "x".to_string(),
            recoverable: false,
        })
        .unwrap();
        assert_eq!(json, r#"{"type":"auth","message":"x","recoverable":false}"#);
    }

    #[test]
    fn auth_error_displays_with_authentication_prefix() {
        let error = AppError::Auth {
            message: "session missing".to_string(),
            recoverable: true,
        };
        assert_eq!(error.to_string(), "Authentication error: session missing");
    }

    #[test]
    fn hosted_ai_error_serializes_with_the_canonical_discriminated_union_shape() {
        let json = serde_json::to_string(&AppError::HostedAi {
            code: "quota_exhausted".to_string(),
            message: "Monthly hosted AI request limit reached.".to_string(),
            recoverable: true,
        })
        .unwrap();

        assert_eq!(
            json,
            r#"{"type":"hosted_ai","code":"quota_exhausted","message":"Monthly hosted AI request limit reached.","recoverable":true}"#
        );
    }

    #[test]
    fn hosted_ai_error_preserves_a_non_recoverable_code() {
        let json = serde_json::to_string(&AppError::HostedAi {
            code: "validation".to_string(),
            message: "Request rejected.".to_string(),
            recoverable: false,
        })
        .unwrap();

        assert!(json.contains(r#""type":"hosted_ai""#));
        assert!(json.contains(r#""code":"validation""#));
        assert!(json.contains(r#""recoverable":false"#));
    }

    #[test]
    fn hosted_ai_display_names_the_code_without_leaking_model_output() {
        let error = AppError::HostedAi {
            code: "hosted_unavailable".to_string(),
            message: "Hosted AI is unavailable.".to_string(),
            recoverable: true,
        };
        assert_eq!(
            error.to_string(),
            "Hosted AI error (hosted_unavailable): Hosted AI is unavailable."
        );
    }
}
