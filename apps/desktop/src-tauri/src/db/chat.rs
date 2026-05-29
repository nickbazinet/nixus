use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct ChatConversation {
    pub id: i64,
    pub title: Option<String>,
    pub agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content: String,
    pub message_type: String,
    pub created_at: String,
}

pub fn create_conversation(conn: &Connection, title: Option<&str>, agent_id: &str) -> Result<ChatConversation, AppError> {
    conn.execute(
        "INSERT INTO chat_conversations (title, agent_id) VALUES (?1, ?2)",
        params![title, agent_id],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, title, agent_id, created_at, updated_at FROM chat_conversations WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn list_conversations_by_agent(
    conn: &Connection,
    agent_id: &str,
) -> Result<Vec<ChatConversation>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, agent_id, created_at, updated_at FROM chat_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC",
    )?;
    let conversations = stmt
        .query_map(params![agent_id], |row| {
            Ok(ChatConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(conversations)
}

pub fn insert_message(
    conn: &Connection,
    conversation_id: i64,
    role: &str,
    content: &str,
    message_type: &str,
) -> Result<ChatMessage, AppError> {
    conn.execute(
        "INSERT INTO chat_messages (conversation_id, role, content, message_type) VALUES (?1, ?2, ?3, ?4)",
        params![conversation_id, role, content, message_type],
    )?;
    let id = conn.last_insert_rowid();

    // Update conversation updated_at
    conn.execute(
        "UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?1",
        params![conversation_id],
    )?;

    conn.query_row(
        "SELECT id, conversation_id, role, content, message_type, created_at FROM chat_messages WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                message_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn get_conversation_messages(
    conn: &Connection,
    conversation_id: i64,
) -> Result<Vec<ChatMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, message_type, created_at FROM chat_messages WHERE conversation_id = ?1 ORDER BY id ASC",
    )?;

    let messages = stmt
        .query_map(params![conversation_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                message_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(messages)
}

pub fn get_conversation_messages_for_display(
    conn: &Connection,
    conversation_id: i64,
) -> Result<Vec<ChatMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, message_type, created_at FROM chat_messages WHERE conversation_id = ?1 AND message_type = 'chat' ORDER BY id ASC",
    )?;

    let messages = stmt
        .query_map(params![conversation_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                message_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(messages)
}

pub fn conversation_exists(conn: &Connection, conversation_id: i64) -> Result<bool, AppError> {
    let result = conn.query_row(
        "SELECT 1 FROM chat_conversations WHERE id = ?1",
        params![conversation_id],
        |_| Ok(()),
    );
    match result {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(AppError::from(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                agent_id TEXT NOT NULL DEFAULT 'budget-helper',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_conversation_exists_returns_true_for_existing_id() {
        let conn = setup_test_db();
        let conv = create_conversation(&conn, Some("test"), "budget-helper").unwrap();
        assert!(conversation_exists(&conn, conv.id).unwrap());
    }

    #[test]
    fn test_conversation_exists_returns_false_for_missing_id() {
        let conn = setup_test_db();
        assert!(!conversation_exists(&conn, 999).unwrap());
    }

    #[test]
    fn test_conversation_exists_returns_false_for_zero() {
        let conn = setup_test_db();
        assert!(!conversation_exists(&conn, 0).unwrap());
    }

    #[test]
    fn test_create_conversation_with_agent_id() {
        let conn = setup_test_db();
        let conv = create_conversation(&conn, Some("test"), "budget-helper").unwrap();
        assert_eq!(conv.agent_id, "budget-helper");
        assert_eq!(conv.title, Some("test".to_string()));
    }

    #[test]
    fn test_list_conversations_by_agent_returns_scoped_results() {
        let conn = setup_test_db();
        let conv1 = create_conversation(&conn, Some("conv1"), "budget-helper").unwrap();
        let conv2 = create_conversation(&conn, Some("conv2"), "budget-helper").unwrap();
        create_conversation(&conn, Some("conv3"), "other-agent").unwrap();

        // Make conv1 older so we can assert descending order
        conn.execute(
            "UPDATE chat_conversations SET updated_at = datetime('now', '-1 minute') WHERE id = ?1",
            params![conv1.id],
        )
        .unwrap();

        let results = list_conversations_by_agent(&conn, "budget-helper").unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|c| c.agent_id == "budget-helper"));
        // Verify descending updated_at order: newer conv2 should come first
        assert_eq!(results[0].id, conv2.id);
        assert_eq!(results[1].id, conv1.id);
    }

    #[test]
    fn test_existing_conversation_agent_id_unchanged() {
        let conn = setup_test_db();
        let conv = create_conversation(&conn, Some("my chat"), "budget-helper").unwrap();

        // Retrieve the stored agent_id directly from the DB and confirm it was not mutated
        let stored_agent_id: String = conn
            .query_row(
                "SELECT agent_id FROM chat_conversations WHERE id = ?1",
                params![conv.id],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(stored_agent_id, "budget-helper");
    }

    #[test]
    fn test_list_conversations_by_agent_empty() {
        let conn = setup_test_db();
        let results = list_conversations_by_agent(&conn, "budget-helper").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_create_conversation_stores_title() {
        let conn = setup_test_db();
        let long_msg = "This is a very long message that should be truncated at forty chars";
        let title: String = long_msg.chars().take(40).collect();
        let title = title.trim().to_string();
        let conv = create_conversation(&conn, Some(&title), "budget-helper").unwrap();
        // First 40 chars: "This is a very long message that should " -> trimmed removes trailing space
        assert_eq!(conv.title, Some("This is a very long message that should".to_string()));
    }
}
