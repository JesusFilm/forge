import { createHash } from "node:crypto"
import {
  runAiChatLifecycleTransaction,
  AiChatLifecycleError,
  type LifecycleOptions,
} from "./ai-chat-conversation-lifecycle"

type Marker = { id: string; resourceId: string }
export type ChatRecoveryInput = {
  format: "forge-chat-markers-v1"
  complete: true
  count: number
  sha256: string
  records: Marker[]
}
function digest(records: Marker[]) {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex")
}

/** Caller must quiesce ALL writers/cleanup until reconciliation finishes. */
export function captureCurrentChatMarkers(
  options: LifecycleOptions = {},
): Promise<ChatRecoveryInput> {
  return runAiChatLifecycleTransaction(async (db) => {
    await db.query(
      "LOCK TABLE ai_chat.forge_conversation_lifecycle, ai_chat.mastra_messages, ai_chat.mastra_threads IN SHARE MODE",
    )
    const records = (
      await db.query<Marker>(
        'SELECT id, "resourceId" FROM ai_chat.forge_conversation_lifecycle WHERE deleted ORDER BY id',
      )
    ).rows
    return {
      format: "forge-chat-markers-v1",
      complete: true,
      count: records.length,
      sha256: digest(records),
      records,
    }
  }, options)
}

function validateInput(input: unknown): ChatRecoveryInput {
  if (
    !input ||
    typeof input !== "object" ||
    !("format" in input) ||
    input.format !== "forge-chat-markers-v1" ||
    !("complete" in input) ||
    input.complete !== true ||
    !("records" in input) ||
    !Array.isArray(input.records) ||
    !("count" in input) ||
    input.count !== input.records.length ||
    !("sha256" in input)
  )
    throw new AiChatLifecycleError("not_ready")
  const records: Marker[] = []
  const ids = new Set<string>()
  for (const row of input.records) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !row.id ||
      typeof row.resourceId !== "string" ||
      !row.resourceId ||
      ids.has(row.id) ||
      Object.keys(row).sort().join() !== "id,resourceId"
    )
      throw new AiChatLifecycleError("not_ready")
    records.push({ id: row.id, resourceId: row.resourceId })
    ids.add(row.id)
  }
  if (digest(records) !== input.sha256)
    throw new AiChatLifecycleError("not_ready")
  return {
    format: "forge-chat-markers-v1",
    complete: true,
    count: records.length,
    sha256: input.sha256 as string,
    records,
  }
}

/** Replace the restored deleted subset with the EXACT authoritative current set.
 * Never union old markers: absent markers may have been intentionally erased.
 */
export function reconcileChatMarkers(
  input: unknown,
  options: LifecycleOptions = {},
) {
  const current = validateInput(input)
  return runAiChatLifecycleTransaction(async (db) => {
    await db.query(
      "LOCK TABLE ai_chat.forge_conversation_lifecycle, ai_chat.mastra_messages, ai_chat.mastra_threads IN ACCESS EXCLUSIVE MODE",
    )
    await db.query(
      'CREATE TEMP TABLE chat_restore_markers (id text PRIMARY KEY, "resourceId" text NOT NULL) ON COMMIT DROP',
    )
    await db.query(
      'INSERT INTO chat_restore_markers SELECT id, "resourceId" FROM jsonb_to_recordset($1::jsonb) AS x(id text, "resourceId" text)',
      [JSON.stringify(current.records)],
    )
    const conflict = await db.query<{
      count: number
    }>(`SELECT count(*)::int AS count FROM chat_restore_markers r
      LEFT JOIN ai_chat.forge_conversation_lifecycle l ON l.id=r.id
      LEFT JOIN ai_chat.mastra_threads t ON t.id=r.id
      WHERE (l.id IS NOT NULL AND l."resourceId" <> r."resourceId") OR (t.id IS NOT NULL AND t."resourceId" <> r."resourceId")`)
    if (conflict.rows[0]?.count !== 0)
      throw new AiChatLifecycleError("owner_conflict")
    await db.query(
      "DELETE FROM ai_chat.forge_conversation_lifecycle l WHERE l.deleted AND NOT EXISTS (SELECT 1 FROM chat_restore_markers r WHERE r.id=l.id)",
    )
    await db.query(
      'INSERT INTO ai_chat.forge_conversation_lifecycle (id,"resourceId",deleted) SELECT id,"resourceId",true FROM chat_restore_markers ON CONFLICT (id) DO UPDATE SET deleted=true',
    )
    await db.query(
      'DELETE FROM ai_chat.mastra_messages m USING chat_restore_markers r WHERE m.thread_id=r.id AND m."resourceId"=r."resourceId"',
    )
    const removed = await db.query(
      'DELETE FROM ai_chat.mastra_threads t USING chat_restore_markers r WHERE t.id=r.id AND t."resourceId"=r."resourceId"',
    )
    const invalid = await db.query<{
      count: number
    }>(`SELECT count(*)::int AS count FROM ai_chat.mastra_threads t
      LEFT JOIN ai_chat.forge_conversation_lifecycle l ON l.id=t.id
      WHERE l.id IS NULL OR l.deleted OR l."resourceId" <> t."resourceId"`)
    if (invalid.rows[0]?.count !== 0)
      throw new AiChatLifecycleError("not_ready")
    return { records: current.count, threadsRemoved: removed.rowCount ?? 0 }
  }, options)
}
