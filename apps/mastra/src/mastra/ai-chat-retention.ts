/**
 * Retention purge for the ai-chat lane's persisted memory (feat-208).
 *
 * Seeker conversations can carry deeply personal spiritual content, so
 * persistence ships WITH a retention position: anonymous threads (resource
 * `anon:*`, the dogfood fallback, and anything else un-prefixed) are deleted
 * 30 days after last activity; signed-in threads (`user:*`) after 180 days.
 * Thread `updatedAt` is a true rolling last-activity key — @mastra/pg's
 * saveMessages bumps it transactionally with every message insert.
 *
 * The purge is also the adversarial backstop on storage growth (the
 * per-resource thread ceiling only bounds a cooperative client — see
 * ./ai-chat-thread-ownership.ts). It runs at boot and on a daily timer, but
 * ONLY when the resolved ai-chat backend is postgres: under the `memory`
 * backend it must no-op so local dev/tests keep the "boots clean with no
 * Postgres" invariant. Deletes go through Memory.deleteThread (which also
 * removes messages + orphaned vectors) and are bounded per run. Logging is
 * enum/count-only plain strings — never thread ids or resource ids.
 */

import { resolveAiChatMemoryBackend } from "../config/env"

import { getAiChatMemory } from "./memory"

export const AI_CHAT_ANON_RETENTION_DAYS = 30
export const AI_CHAT_USER_RETENTION_DAYS = 180
export const AI_CHAT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000
const PURGE_PAGE_SIZE = 100
/** Per-run delete bound so one sweep cannot monopolize the pool. */
const PURGE_MAX_DELETES_PER_RUN = 500
const DAY_MS = 24 * 60 * 60 * 1000

/** Resource-key prefix for signed-in users (chat proxy contract, feat-208). */
const USER_RESOURCE_PREFIX = "user:"

/** The narrow Memory surface the purge needs — structural so tests fake it. */
export type AiChatRetentionMemory = {
  listThreads: (args: { page?: number; perPage?: number }) => Promise<{
    threads: Array<{
      id: string
      resourceId?: string | null
      updatedAt?: Date | string | null
    }>
    hasMore: boolean
  }>
  deleteThread: (threadId: string) => Promise<void>
}

/**
 * Retention window for a resource key. Prefix-check only — NEVER split on ":"
 * (an OIDC sub may contain anything). Non-`user:` resources (anon:*, the
 * seeker-dogfood fallback, unknown callers) get the short anonymous window.
 */
export function retentionWindowMsFor(
  resourceId: string | null | undefined,
): number {
  return typeof resourceId === "string" &&
    resourceId.startsWith(USER_RESOURCE_PREFIX)
    ? AI_CHAT_USER_RETENTION_DAYS * DAY_MS
    : AI_CHAT_ANON_RETENTION_DAYS * DAY_MS
}

/**
 * One bounded purge sweep: page through threads, collect ids whose last
 * activity is past their window, then delete. Collect-then-delete (not
 * delete-while-paging) so deletions cannot shift pagination mid-scan.
 * Returns counts for the log line. Throws only if the store does.
 */
export async function runAiChatRetentionPurge({
  memory,
  now = () => Date.now(),
}: {
  memory: AiChatRetentionMemory
  now?: () => number
}): Promise<{ scanned: number; deleted: number }> {
  const nowMs = now()
  const expired: string[] = []
  let scanned = 0
  let page = 0
  let hasMore = true
  while (hasMore && expired.length < PURGE_MAX_DELETES_PER_RUN) {
    const result = await memory.listThreads({ page, perPage: PURGE_PAGE_SIZE })
    for (const thread of result.threads) {
      scanned += 1
      if (thread.updatedAt == null) continue
      const updatedAtMs = new Date(thread.updatedAt).getTime()
      if (Number.isNaN(updatedAtMs)) continue
      if (nowMs - updatedAtMs > retentionWindowMsFor(thread.resourceId)) {
        expired.push(thread.id)
        if (expired.length >= PURGE_MAX_DELETES_PER_RUN) break
      }
    }
    hasMore = result.hasMore
    page += 1
  }

  let deleted = 0
  for (const threadId of expired) {
    await memory.deleteThread(threadId)
    deleted += 1
  }
  return { scanned, deleted }
}

/**
 * Boot-time entry point: run one sweep now and re-run daily. No-ops (returns
 * null) unless the resolved ai-chat backend is postgres — the gate that keeps
 * `MASTRA_STORAGE_BACKEND=memory` local runs from ever opening a pool. A
 * failed sweep logs and waits for the next tick; it never crashes the service.
 * The timer is unref'd so it cannot hold the process open.
 */
export function startAiChatRetentionPurge({
  getBackend = resolveAiChatMemoryBackend,
  getMemory = () => getAiChatMemory() as unknown as AiChatRetentionMemory,
  intervalMs = AI_CHAT_PURGE_INTERVAL_MS,
}: {
  getBackend?: () => "postgres" | "memory"
  getMemory?: () => AiChatRetentionMemory
  intervalMs?: number
} = {}): { stop: () => void } | null {
  if (getBackend() !== "postgres") {
    console.info(
      "[ai-chat-retention] event=purge_disabled reason=backend_not_postgres",
    )
    return null
  }

  const sweep = () => {
    void runAiChatRetentionPurge({ memory: getMemory() })
      .then(({ scanned, deleted }) => {
        console.info(
          `[ai-chat-retention] event=purge_complete scanned=${scanned} deleted=${deleted}`,
        )
      })
      .catch(() => {
        // Count/enum-only logging — never the caught error (could embed ids).
        console.warn(
          "[ai-chat-retention] event=purge_failed reason=sweep_error",
        )
      })
  }

  sweep()
  const timer = setInterval(sweep, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
