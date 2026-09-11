import type { Pool, PoolClient } from "pg"
import { getAiChatWritePool } from "./ai-chat-database"
import {
  getAiChatGuardReadiness,
  type ChatQuery,
} from "./ai-chat-guard-readiness"
import { isAiChatDeletionStorageCovered } from "./ai-chat-memory"

export class AiChatLifecycleError extends Error {
  constructor(
    readonly reason:
      | "not_ready"
      | "uncovered_storage"
      | "timeout"
      | "store_failed"
      | "retry"
      | "invalid_identity"
      | "owner_conflict",
  ) {
    super(`chat_lifecycle_${reason}`)
  }
}
export type LifecycleOptions = {
  pool?: Pool
  budgetMs?: number
  storageCovered?: () => boolean
}
type LifecycleRow = { id: string; resourceId: string; deleted: boolean }
const LIFECYCLE = "ai_chat.forge_conversation_lifecycle"

function codeOf(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined
}

/** Acquisition includes pool queueing; late acquisition is returned, never leaked. */
async function acquire(pool: Pool, milliseconds: number): Promise<PoolClient> {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pool.connect().then((client) => {
        if (expired) {
          client.release()
          throw new AiChatLifecycleError("timeout")
        }
        return client
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(new AiChatLifecycleError("timeout"))
        }, milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** All operations use whole-transaction retry and one wall-clock budget. */
export async function runAiChatLifecycleTransaction<T>(
  work: (db: ChatQuery) => Promise<T>,
  options: LifecycleOptions = {},
): Promise<T> {
  if (!(options.storageCovered ?? isAiChatDeletionStorageCovered)())
    throw new AiChatLifecycleError("uncovered_storage")
  const deadline = Date.now() + Math.min(options.budgetMs ?? 7_000, 7_000)
  for (let attempt = 0; attempt < 3; attempt++) {
    let release: ((destroy?: boolean) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new AiChatLifecycleError("timeout")
      const connection = await acquire(
        options.pool ?? getAiChatWritePool(),
        Math.min(2_000, remaining),
      )
      const onConnectionError = () => {}
      connection.on("error", onConnectionError)
      let released = false
      release = (destroy = false) => {
        if (released) return
        released = true
        connection.release(destroy)
        if (!destroy) connection.removeListener("error", onConnectionError)
      }
      const db: ChatQuery = {
        query: async (sql, values) => {
          const left = deadline - Date.now()
          if (released || left <= 0) throw new AiChatLifecycleError("timeout")
          await connection.query(
            "SELECT set_config('statement_timeout', $1, true)",
            [`${Math.max(1, left)}ms`],
          )
          return connection.query(sql, values ? [...values] : undefined)
        },
      }
      const result = await Promise.race([
        (async () => {
          await connection.query("BEGIN")
          await connection.query("SET LOCAL lock_timeout = '1000ms'")
          await connection.query(
            "SET LOCAL idle_in_transaction_session_timeout = '7000ms'",
          )
          if ((await getAiChatGuardReadiness(db)) !== "ready")
            throw new AiChatLifecycleError("not_ready")
          const value = await work(db)
          await db.query("COMMIT")
          return value
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              release?.(true)
              reject(new AiChatLifecycleError("timeout"))
            },
            Math.max(1, deadline - Date.now()),
          )
        }),
      ])
      release()
      return result
    } catch (error) {
      // Closing the lease rolls PostgreSQL back without awaiting another query
      // on a failed connection. A late callback cannot reuse the closed lease.
      release?.(true)
      const code = codeOf(error)
      if (
        (code === "40001" ||
          code === "40P01" ||
          (error instanceof AiChatLifecycleError &&
            error.reason === "retry")) &&
        attempt < 2 &&
        Date.now() < deadline
      )
        continue
      if (error instanceof AiChatLifecycleError) throw error
      if (code === "55P03" || code === "57014" || Date.now() >= deadline)
        throw new AiChatLifecycleError("timeout")
      throw new AiChatLifecycleError("store_failed")
    } finally {
      clearTimeout(timer)
    }
  }
  throw new AiChatLifecycleError("store_failed")
}

function validateIdentity(id: string, resourceId: string): void {
  if (!id.trim() || id.length > 200 || !resourceId.trim())
    throw new AiChatLifecycleError("invalid_identity")
}
async function lockLifecycle(
  db: ChatQuery,
  id: string,
): Promise<LifecycleRow | undefined> {
  return (
    await db.query<LifecycleRow>(
      `SELECT id, "resourceId", deleted FROM ${LIFECYCLE} WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0]
}
async function lockContent(db: ChatQuery, id: string) {
  await db.query(
    "SELECT id FROM ai_chat.mastra_messages WHERE thread_id=$1 ORDER BY id FOR UPDATE",
    [id],
  )
  return (
    await db.query<{ resourceId: string; updatedAt: Date }>(
      `SELECT "resourceId", COALESCE("updatedAtZ", "updatedAt" AT TIME ZONE 'UTC') AS "updatedAt" FROM ai_chat.mastra_threads WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0]
}
async function removeContent(
  db: ChatQuery,
  id: string,
  owner: string,
): Promise<number> {
  await db.query(
    'DELETE FROM ai_chat.mastra_messages WHERE thread_id=$1 AND "resourceId"=$2',
    [id, owner],
  )
  return (
    (
      await db.query(
        'DELETE FROM ai_chat.mastra_threads WHERE id=$1 AND "resourceId"=$2',
        [id, owner],
      )
    ).rowCount ?? 0
  )
}

/** Success means COMMIT was observed. Absence is reserved; foreign claims never mutate. */
export function deleteAiChatConversation(
  id: string,
  resourceId: string,
  options: LifecycleOptions = {},
): Promise<"deleted" | "unavailable"> {
  validateIdentity(id, resourceId)
  return runAiChatLifecycleTransaction(async (db) => {
    await db.query(
      `INSERT INTO ${LIFECYCLE} (id, "resourceId", deleted) VALUES ($1,$2,true) ON CONFLICT (id) DO NOTHING`,
      [id, resourceId],
    )
    const row = await lockLifecycle(db, id)
    if (!row) throw new AiChatLifecycleError("retry")
    if (row.resourceId !== resourceId) return "unavailable"
    const thread = await lockContent(db, id)
    if (thread && thread.resourceId !== resourceId)
      throw new AiChatLifecycleError("owner_conflict")
    await db.query(
      `UPDATE ${LIFECYCLE} SET deleted=true WHERE id=$1 AND "resourceId"=$2`,
      [id, resourceId],
    )
    await removeContent(db, id, resourceId)
    return "deleted"
  }, options)
}

/** Expiry removes live bookkeeping only, after current content activity is locked. */
export function expireAiChatConversation(
  id: string,
  cutoff: Date,
  options: LifecycleOptions = {},
) {
  return runAiChatLifecycleTransaction(async (db) => {
    const row = await lockLifecycle(db, id)
    if (!row || row.deleted) return { threadsDeleted: 0, recordsDeleted: 0 }
    const thread = await lockContent(db, id)
    if (thread && thread.resourceId !== row.resourceId)
      throw new AiChatLifecycleError("owner_conflict")
    if (thread && !(thread.updatedAt < cutoff))
      return { threadsDeleted: 0, recordsDeleted: 0 }
    const threadsDeleted = await removeContent(db, id, row.resourceId)
    const recordsDeleted =
      (
        await db.query(
          `DELETE FROM ${LIFECYCLE} WHERE id=$1 AND "resourceId"=$2 AND NOT deleted`,
          [id, row.resourceId],
        )
      ).rowCount ?? 0
    return { threadsDeleted, recordsDeleted }
  }, options)
}

/** R13: removing the exact resource's markers intentionally permits later recreation. */
export function eraseAiChatConversation(
  id: string,
  resourceId: string,
  options: LifecycleOptions = {},
) {
  validateIdentity(id, resourceId)
  return runAiChatLifecycleTransaction(async (db) => {
    const row = await lockLifecycle(db, id)
    const thread = await lockContent(db, id)
    if (
      (row && row.resourceId !== resourceId) ||
      (thread && thread.resourceId !== resourceId)
    )
      throw new AiChatLifecycleError("owner_conflict")
    if (!row && thread) throw new AiChatLifecycleError("not_ready")
    const threadsDeleted = await removeContent(db, id, resourceId)
    const recordsDeleted =
      (
        await db.query(
          `DELETE FROM ${LIFECYCLE} WHERE id=$1 AND "resourceId"=$2`,
          [id, resourceId],
        )
      ).rowCount ?? 0
    return { threadsDeleted, recordsDeleted }
  }, options)
}
