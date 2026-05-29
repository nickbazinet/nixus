use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Validation { message: String, field: Option<String> },
    Database { message: String },
    AiService { message: String, recoverable: bool },
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
            AppError::File { message } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("type", "file")?;
                map.serialize_entry("message", message)?;
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
