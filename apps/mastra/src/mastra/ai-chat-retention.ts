/** Flat retention, shared with Langfuse. Explicit deletion records never expire. */
import type { Pool } from "pg"
import { canAiChatDataPersist, env } from "../config/env"
import { isAiChatDeletionStorageCovered } from "./ai-chat-memory"
import { getAiChatWritePool } from "./ai-chat-database"
import { getAiChatGuardReadiness } from "./ai-chat-guard-readiness"
import { expireAiChatConversation } from "./ai-chat-conversation-lifecycle"

export const AI_CHAT_RETENTION_DAYS = 25
export const AI_CHAT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 500
const MAX_SWEEPS = 20
export function retentionWindowMsFor(
  _resourceId: string | null | undefined,
): number {
  return AI_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000
}
export type AiChatRetentionResult =
  | { kind: "not_ready"; reason: "not_applied" | "paused" }
  | {
      kind: "failed"
      reason: "incompatible" | "readiness_error" | "uncovered_storage"
    }
  | {
      kind: "complete"
      scanned: number
      deleted: number
      recordsDeleted: number
      sweeps: number
    }

/** Each bounded page is collected first; each ID is rechecked under content locks. */
export async function runAiChatRetentionPurge({
  pool = getAiChatWritePool(),
  now = Date.now,
}: { pool?: Pool; now?: () => number } = {}): Promise<AiChatRetentionResult> {
  if (env.AI_CHAT_MAINTENANCE_PAUSED === "true")
    return { kind: "not_ready", reason: "paused" }
  if (!isAiChatDeletionStorageCovered())
    return { kind: "failed", reason: "uncovered_storage" }
  const readiness = await getAiChatGuardReadiness(pool)
  if (readiness === "error")
    return { kind: "failed", reason: "readiness_error" }
  if (readiness === "incompatible")
    return { kind: "failed", reason: "incompatible" }
  if (readiness === "not_applied")
    return { kind: "not_ready", reason: "not_applied" }
  const cutoff = new Date(now() - retentionWindowMsFor(undefined))
  let scanned = 0,
    deleted = 0,
    recordsDeleted = 0,
    sweeps = 0
  // Cursor prevents refreshed candidates from stranding later expired rows.
  let after: string | null = null
  while (sweeps < MAX_SWEEPS) {
    const rows: Array<{ id: string }> = (
      await pool.query<{ id: string }>(
        `
      SELECT l.id FROM ai_chat.forge_conversation_lifecycle l
      LEFT JOIN ai_chat.mastra_threads t ON t.id=l.id
      WHERE NOT l.deleted AND ($1::text IS NULL OR l.id > $1)
        AND (t.id IS NULL OR COALESCE(t."updatedAtZ", t."updatedAt" AT TIME ZONE 'UTC') < $2)
      ORDER BY l.id LIMIT $3`,
        [after, cutoff, BATCH_SIZE],
      )
    ).rows
    sweeps++
    scanned += rows.length
    for (const row of rows) {
      const result = await expireAiChatConversation(row.id, cutoff, { pool })
      deleted += result.threadsDeleted
      recordsDeleted += result.recordsDeleted
    }
    if (rows.length < BATCH_SIZE) break
    after = rows.at(-1)!.id
  }
  return { kind: "complete", scanned, deleted, recordsDeleted, sweeps }
}

/** No startup await. A failed/deferred tick is retried, including after migration. */
export function startAiChatRetentionPurge({
  isEnabled = canAiChatDataPersist,
  run = runAiChatRetentionPurge,
  intervalMs = AI_CHAT_PURGE_INTERVAL_MS,
}: {
  isEnabled?: () => boolean
  run?: () => Promise<AiChatRetentionResult>
  intervalMs?: number
} = {}): { stop: () => void } | null {
  if (!isEnabled()) {
    console.info(
      "[ai-chat-retention] event=purge_disabled reason=no_postgres_backend",
    )
    return null
  }
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      const result = await run()
      if (result.kind === "not_ready")
        console.info(
          `[ai-chat-retention] event=purge_deferred reason=${result.reason}`,
        )
      else if (result.kind === "failed")
        console.warn(
          `[ai-chat-retention] event=purge_failed reason=${result.reason}`,
        )
      else
        console.info(
          `[ai-chat-retention] event=purge_complete scanned=${result.scanned} deleted=${result.deleted} records_deleted=${result.recordsDeleted} sweeps=${result.sweeps}`,
        )
    } catch {
      console.warn("[ai-chat-retention] event=purge_failed reason=sweep_error")
    } finally {
      running = false
    }
  }
  void sweep()
  const timer = setInterval(() => {
    void sweep()
  }, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
