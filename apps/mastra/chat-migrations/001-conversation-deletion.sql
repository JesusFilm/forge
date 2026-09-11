-- Acquire both locks before inspecting/backfilling. Advisory locking alone
-- serializes migrators, never application writers. No content in diagnostics.
LOCK TABLE ai_chat.mastra_messages, ai_chat.mastra_threads IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE invalid_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count FROM (VALUES
    ('mastra_threads', 'id', 'text', 'NO'),
    ('mastra_threads', 'resourceId', 'text', 'NO'),
    ('mastra_threads', 'updatedAt', 'timestamp without time zone', 'NO'),
    ('mastra_threads', 'updatedAtZ', 'timestamp with time zone', 'YES'),
    ('mastra_messages', 'id', 'text', 'NO'),
    ('mastra_messages', 'thread_id', 'text', 'NO'),
    ('mastra_messages', 'resourceId', 'text', 'YES')
  ) AS required(tbl, col, typ, nullable)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'ai_chat' AND c.table_name = required.tbl
      AND c.column_name = required.col AND c.data_type = required.typ
      AND c.is_nullable = required.nullable);
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'chat_native_shape_mismatch count=%', invalid_count;
  END IF;
  SELECT count(*) INTO invalid_count FROM ai_chat.mastra_messages m
    LEFT JOIN ai_chat.mastra_threads t ON t.id = m.thread_id
    WHERE t.id IS NULL OR m."resourceId" IS DISTINCT FROM t."resourceId";
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'chat_parent_integrity_failed count=%', invalid_count;
  END IF;
END $$;

CREATE TABLE ai_chat.forge_conversation_lifecycle (
  id text PRIMARY KEY,
  "resourceId" text NOT NULL,
  deleted boolean NOT NULL
);
CREATE INDEX forge_conversation_lifecycle_resource_idx
  ON ai_chat.forge_conversation_lifecycle ("resourceId");
INSERT INTO ai_chat.forge_conversation_lifecycle (id, "resourceId", deleted)
  SELECT id, "resourceId", false FROM ai_chat.mastra_threads;

CREATE FUNCTION ai_chat.forge_guard_thread_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE lifecycle ai_chat.forge_conversation_lifecycle%ROWTYPE;
BEGIN
  INSERT INTO ai_chat.forge_conversation_lifecycle (id, "resourceId", deleted)
    VALUES (NEW.id, NEW."resourceId", false) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO lifecycle FROM ai_chat.forge_conversation_lifecycle
    WHERE id = NEW.id FOR SHARE;
  IF NOT FOUND OR lifecycle.deleted OR lifecycle."resourceId" IS DISTINCT FROM NEW."resourceId" THEN
    RAISE EXCEPTION USING ERRCODE = 'P2470', MESSAGE = 'chat_write_refused';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ai_chat.forge_guard_message_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE lifecycle ai_chat.forge_conversation_lifecycle%ROWTYPE;
BEGIN
  SELECT * INTO lifecycle FROM ai_chat.forge_conversation_lifecycle
    WHERE id = NEW.thread_id FOR SHARE;
  IF NOT FOUND OR lifecycle.deleted OR lifecycle."resourceId" IS DISTINCT FROM NEW."resourceId" THEN
    RAISE EXCEPTION USING ERRCODE = 'P2470', MESSAGE = 'chat_write_refused';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ai_chat.forge_guard_thread_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- No lifecycle locks here: UPDATE already holds the native tuple lock.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId" THEN
    RAISE EXCEPTION USING ERRCODE = 'P2470', MESSAGE = 'chat_identity_refused';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ai_chat.forge_guard_message_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId"
    OR NEW.thread_id IS DISTINCT FROM OLD.thread_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P2470', MESSAGE = 'chat_identity_refused';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER forge_thread_insert BEFORE INSERT ON ai_chat.mastra_threads
  FOR EACH ROW EXECUTE FUNCTION ai_chat.forge_guard_thread_insert();
CREATE TRIGGER forge_message_insert BEFORE INSERT ON ai_chat.mastra_messages
  FOR EACH ROW EXECUTE FUNCTION ai_chat.forge_guard_message_insert();
CREATE TRIGGER forge_thread_identity BEFORE UPDATE ON ai_chat.mastra_threads
  FOR EACH ROW EXECUTE FUNCTION ai_chat.forge_guard_thread_identity();
CREATE TRIGGER forge_message_identity BEFORE UPDATE ON ai_chat.mastra_messages
  FOR EACH ROW EXECUTE FUNCTION ai_chat.forge_guard_message_identity();
ALTER TABLE ai_chat.mastra_messages ADD CONSTRAINT forge_message_parent
  FOREIGN KEY (thread_id) REFERENCES ai_chat.mastra_threads(id) ON DELETE CASCADE;
