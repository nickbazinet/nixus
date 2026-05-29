ALTER TABLE chat_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'chat' CHECK(message_type IN ('chat', 'tool_call', 'tool_result'));
