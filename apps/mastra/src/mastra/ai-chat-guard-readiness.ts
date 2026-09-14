import type { QueryResult, QueryResultRow } from "pg"
import { CHAT_GUARD_BODY_MD5, CHAT_MIGRATION } from "./ai-chat-guard-manifest"

export type ChatQuery = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}
export type AiChatGuardReadiness =
  | "not_applied"
  | "ready"
  | "incompatible"
  | "error"

/** No cached negative result: deployed processes observe explicit migration. */
export async function getAiChatGuardReadiness(
  db: ChatQuery,
): Promise<AiChatGuardReadiness> {
  try {
    const objects = await db.query<{
      objects: number
      history: string | null
      lifecycle: string | null
    }>(`
      SELECT to_regclass('ai_chat.forge_schema_migrations')::text AS history,
        to_regclass('ai_chat.forge_conversation_lifecycle')::text AS lifecycle,
        ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='ai_chat' AND c.relname LIKE 'forge_%') +
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='ai_chat' AND p.proname LIKE 'forge_%') +
         (SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
          WHERE n.nspname='ai_chat' AND k.conname LIKE 'forge_%'))::int AS objects`)
    const state = objects.rows[0]
    if (!state) return "error"
    if (state.objects === 0) return "not_applied"
    if (!state.history || !state.lifecycle) return "incompatible"
    const history = await db.query<{
      version: number
      name: string
      sha256: string
    }>(
      "SELECT version, name, sha256 FROM ai_chat.forge_schema_migrations ORDER BY version",
    )
    if (
      history.rows.length !== 1 ||
      history.rows[0]?.version !== CHAT_MIGRATION.version ||
      history.rows[0]?.name !== CHAT_MIGRATION.name ||
      history.rows[0]?.sha256 !== CHAT_MIGRATION.sha256
    )
      return "incompatible"
    const guards = await db.query<{
      name: string
      table_name: string
      type: number
      enabled: string
      function_name: string
      body: string
      config: string[]
      security_definer: boolean
      unconditional: boolean
    }>(`
      SELECT t.tgname AS name, c.relname AS table_name, t.tgtype::int AS type,
        t.tgenabled AS enabled, p.proname AS function_name, md5(p.prosrc) AS body,
        p.proconfig AS config, p.prosecdef AS security_definer,
        (t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr=''::int2vector) AS unconditional
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='ai_chat' AND t.tgname LIKE 'forge_%'`)
    const expected = [
      ["forge_thread_insert", "mastra_threads", 7, "forge_guard_thread_insert"],
      [
        "forge_message_insert",
        "mastra_messages",
        7,
        "forge_guard_message_insert",
      ],
      [
        "forge_thread_identity",
        "mastra_threads",
        19,
        "forge_guard_thread_identity",
      ],
      [
        "forge_message_identity",
        "mastra_messages",
        19,
        "forge_guard_message_identity",
      ],
    ] as const
    if (
      guards.rows.length !== expected.length ||
      expected.some(
        ([name, table, type, fn]) =>
          !guards.rows.some(
            (row) =>
              row.name === name &&
              row.table_name === table &&
              row.type === type &&
              row.function_name === fn &&
              row.enabled === "O" &&
              row.body === CHAT_GUARD_BODY_MD5[fn] &&
              row.unconditional &&
              !row.security_definer &&
              row.config?.join() === "search_path=pg_catalog",
          ),
      )
    )
      return "incompatible"
    const shape = await db.query<{ valid: boolean }>(`
      SELECT
        (SELECT array_agg(column_name || ':' || data_type || ':' || is_nullable ORDER BY ordinal_position)
         FROM information_schema.columns WHERE table_schema='ai_chat' AND table_name='forge_conversation_lifecycle')
          = ARRAY['id:text:NO','resourceId:text:NO','deleted:boolean:NO']
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ai_chat.forge_conversation_lifecycle'::regclass
          AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)')
        AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='ai_chat'
          AND indexname='forge_conversation_lifecycle_resource_idx'
          AND indexdef LIKE '% USING btree ("resourceId")')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ai_chat.mastra_messages'::regclass
          AND conname='forge_message_parent' AND convalidated AND NOT condeferrable
          AND pg_get_constraintdef(oid)='FOREIGN KEY (thread_id) REFERENCES ai_chat.mastra_threads(id) ON DELETE CASCADE')
        AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgconstraint IN (
          SELECT oid FROM pg_constraint WHERE conname='forge_message_parent'
          AND conrelid='ai_chat.mastra_messages'::regclass) AND tgenabled <> 'O')
        AND current_setting('session_replication_role')='origin'
        AND has_schema_privilege('ai_chat','USAGE')
        AND NOT EXISTS (SELECT 1 FROM (VALUES
          ('ai_chat.forge_guard_thread_insert()'),('ai_chat.forge_guard_message_insert()'),
          ('ai_chat.forge_guard_thread_identity()'),('ai_chat.forge_guard_message_identity()')
        ) AS needed(fn) WHERE NOT has_function_privilege(needed.fn,'EXECUTE'))
        -- A comma-separated privilege argument means ANY, not ALL, in PostgreSQL.
        AND NOT EXISTS (SELECT 1 FROM (VALUES
          ('ai_chat.forge_schema_migrations','SELECT'),
          ('ai_chat.forge_conversation_lifecycle','SELECT'),('ai_chat.forge_conversation_lifecycle','INSERT'),
          ('ai_chat.forge_conversation_lifecycle','UPDATE'),('ai_chat.forge_conversation_lifecycle','DELETE'),
          ('ai_chat.mastra_threads','SELECT'),('ai_chat.mastra_threads','INSERT'),('ai_chat.mastra_threads','UPDATE'),('ai_chat.mastra_threads','DELETE'),
          ('ai_chat.mastra_messages','SELECT'),('ai_chat.mastra_messages','INSERT'),('ai_chat.mastra_messages','UPDATE'),('ai_chat.mastra_messages','DELETE')
        ) AS needed(tbl,privilege) WHERE NOT has_table_privilege(needed.tbl,needed.privilege))
        AND NOT EXISTS (SELECT 1 FROM (VALUES
          ('mastra_threads','id','text','NO'),('mastra_threads','resourceId','text','NO'),
          ('mastra_threads','updatedAt','timestamp without time zone','NO'),
          ('mastra_threads','updatedAtZ','timestamp with time zone','YES'),
          ('mastra_messages','id','text','NO'),('mastra_messages','thread_id','text','NO'),
          ('mastra_messages','resourceId','text','YES')
        ) AS required(tbl,col,typ,nullable) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema='ai_chat' AND c.table_name=required.tbl AND c.column_name=required.col
            AND c.data_type=required.typ AND c.is_nullable=required.nullable)) AS valid`)
    return shape.rows[0]?.valid === true ? "ready" : "incompatible"
  } catch {
    return "error"
  }
}
