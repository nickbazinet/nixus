ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'budget-helper';
CREATE INDEX IF NOT EXISTS idx_chat_conversations_agent_id ON chat_conversations(agent_id);
