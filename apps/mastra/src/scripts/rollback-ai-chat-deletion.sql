BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('forge_ai_chat_migrations'));
LOCK TABLE ai_chat.mastra_messages, ai_chat.mastra_threads,
  ai_chat.forge_conversation_lifecycle, ai_chat.forge_schema_migrations
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  threads_before bigint;
  messages_before bigint;
BEGIN
  IF (SELECT count(*) FROM ai_chat.forge_schema_migrations) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM ai_chat.forge_schema_migrations
       WHERE version = 1 AND name = '001-conversation-deletion.sql'
         AND sha256 = '02a66a7903c6cff5b20b208c1d46f08eee42e963613cf348e558634a0432ed1f'
     ) THEN
    RAISE EXCEPTION 'Unexpected chat migration history; rollback refused';
  END IF;

  SELECT count(*) INTO threads_before FROM ai_chat.mastra_threads;
  SELECT count(*) INTO messages_before FROM ai_chat.mastra_messages;
  DROP TRIGGER forge_thread_insert ON ai_chat.mastra_threads;
  DROP TRIGGER forge_message_insert ON ai_chat.mastra_messages;
  DROP TRIGGER forge_thread_identity ON ai_chat.mastra_threads;
  DROP TRIGGER forge_message_identity ON ai_chat.mastra_messages;
  ALTER TABLE ai_chat.mastra_messages DROP CONSTRAINT forge_message_parent;
  DROP FUNCTION ai_chat.forge_guard_thread_insert();
  DROP FUNCTION ai_chat.forge_guard_message_insert();
  DROP FUNCTION ai_chat.forge_guard_thread_identity();
  DROP FUNCTION ai_chat.forge_guard_message_identity();
  DROP TABLE ai_chat.forge_conversation_lifecycle;
  DROP TABLE ai_chat.forge_schema_migrations;

  IF (SELECT count(*) FROM ai_chat.mastra_threads) <> threads_before
     OR (SELECT count(*) FROM ai_chat.mastra_messages) <> messages_before THEN
    RAISE EXCEPTION 'Native chat counts changed; rollback refused';
  END IF;
END $$;
COMMIT;
