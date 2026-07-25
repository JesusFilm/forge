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
 * A run DRAINS the expired backlog: bounded sweeps (500 deletes each) repeat
 * until a sweep comes back non-full, capped at 20 sweeps per run so one run
 * cannot monopolize the small ai-chat pool (the remainder carries over to the
 * next tick). Each sweep scans oldest-first (`orderBy updatedAt ASC`) with an
 * early stop once rows are inside the shortest (30-day) window — nothing
 * younger can be expired under either window — and re-checks recency
 * immediately before every delete so a thread resumed mid-sweep is never
 * deleted. Deletes go through Memory.deleteThread (which also removes
 * messages + orphaned vectors).
 *
 * The purge bounds total junk to roughly one retention window of inflow; it
 * does NOT bound in-window growth (see plan §F — inbound auth + rate caps
 * remain the real inflow bound). It runs at boot and on a daily timer, gated
 * on a postgres backend being CONFIGURED AT ALL (`canAiChatDataPersist`) —
 * deliberately not on the resolved ai-chat backend: the kill-switch
 * (`AI_CHAT_MEMORY_BACKEND=memory`) stops writes but must never pause
 * retention on already-stored rows. For the same reason the purge operates on
 * a Memory built DIRECTLY over the persisted `ai_chat` store — never the
 * backend-resolved `getAiChatMemory()`, which under the kill-switch is an
 * InMemoryStore (a purge over it would log success while Postgres rows age).
 * `MASTRA_STORAGE_BACKEND=memory` local runs stay pool-free (the "boots clean
 * with no Postgres" invariant). Logging is enum/count-only plain strings —
 * never thread ids or resource ids.
 */

import { Memory } from "@mastra/memory"

import { canAiChatDataPersist } from "../config/env"

import { USER_RESOURCE_PREFIX } from "./ai-chat-thread-ownership"
import { getAiChatStorage } from "./ai-chat-memory"

export const AI_CHAT_ANON_RETENTION_DAYS = 30
export const AI_CHAT_USER_RETENTION_DAYS = 180
export const AI_CHAT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000
const PURGE_PAGE_SIZE = 100
/** Per-sweep delete bound so one sweep cannot monopolize the pool. */
const PURGE_MAX_DELETES_PER_SWEEP = 500
/**
 * Safety valve on the drain loop: ≤20 full sweeps (≤10k deletes) per run. A
 * pathological backlog carries over to the next daily tick instead of
 * grinding the 5-connection ai-chat pool indefinitely.
 */
const PURGE_MAX_SWEEPS_PER_RUN = 20
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Sentinel thread id for the per-run connectivity probe. `listThreads` swallows
 * store errors (returns empty), so without a probe a DB outage would drain to a
 * false `purge_complete scanned=0`. `getThreadById` THROWS on a store error, so
 * the run probes with it first (a missing id returns null cheaply). Reserved
 * string that cannot collide with a real conversation thread id.
 */
const RETENTION_PROBE_THREAD_ID = "__ai_chat_retention_connectivity_probe__"

/** The narrow Memory surface the purge needs — structural so tests fake it. */
export type AiChatRetentionMemory = {
  listThreads: (args: {
    page?: number
    perPage?: number
    orderBy?: { field?: "createdAt" | "updatedAt"; direction?: "ASC" | "DESC" }
  }) => Promise<{
    threads: Array<{
      id: string
      resourceId?: string | null
      updatedAt?: Date | string | null
    }>
    hasMore: boolean
  }>
  getThreadById: (args: { threadId: string }) => Promise<{
    resourceId?: string | null
    updatedAt?: Date | string | null
  } | null>
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

function toEpochMs(value: Date | string | null | undefined): number {
  if (value == null) return Number.NaN
  return new Date(value).getTime()
}

/**
 * One bounded sweep: page oldest-first with an early stop once rows are
 * inside the shortest window (ASC ⇒ everything after is younger), collect up
 * to the per-sweep bound, then delete — re-checking recency per thread first
 * so a conversation resumed between scan and delete survives. Collect-then-
 * delete so deletions cannot shift pagination mid-scan. Throws only if the
 * store does. Reports `collected` (the pre-recheck expired batch size) so the
 * drain loop can distinguish a full batch (backlog remains) from a genuinely
 * drained one even when the recency re-check spares some rows.
 */
async function sweepOnce(
  memory: AiChatRetentionMemory,
  nowMs: number,
): Promise<{ scanned: number; deleted: number; collected: number }> {
  const shortestWindowMs = AI_CHAT_ANON_RETENTION_DAYS * DAY_MS
  const expired: string[] = []
  let scanned = 0
  let page = 0
  let hasMore = true
  while (hasMore && expired.length < PURGE_MAX_DELETES_PER_SWEEP) {
    const result = await memory.listThreads({
      page,
      perPage: PURGE_PAGE_SIZE,
      orderBy: { field: "updatedAt", direction: "ASC" },
    })
    for (const thread of result.threads) {
      scanned += 1
      const updatedAtMs = toEpochMs(thread.updatedAt)
      // Null/unparseable updatedAt: skip, never delete. (PG sorts NULLs last
      // under ASC, so these only trail the early-stop point anyway.)
      if (Number.isNaN(updatedAtMs)) continue
      const ageMs = nowMs - updatedAtMs
      if (ageMs <= shortestWindowMs) {
        // Early stop: this row — and by ASC order every row after it — is too
        // young to be expired under either window.
        hasMore = false
        break
      }
      if (ageMs > retentionWindowMsFor(thread.resourceId)) {
        expired.push(thread.id)
        if (expired.length >= PURGE_MAX_DELETES_PER_SWEEP) break
      }
    }
    hasMore = hasMore && result.hasMore
    page += 1
  }

  let deleted = 0
  for (const threadId of expired) {
    // Recency re-check: the collect-phase snapshot may be stale — a thread
    // that got a message since the scan must survive the sweep.
    const fresh = await memory.getThreadById({ threadId })
    if (fresh === null) continue
    const freshUpdatedAtMs = toEpochMs(fresh.updatedAt)
    if (Number.isNaN(freshUpdatedAtMs)) continue
    if (nowMs - freshUpdatedAtMs <= retentionWindowMsFor(fresh.resourceId)) {
      continue
    }
    await memory.deleteThread(threadId)
    deleted += 1
  }
  return { scanned, deleted, collected: expired.length }
}

/**
 * One purge run: drain expired threads in bounded sweeps until a sweep comes
 * back non-full (backlog drained) or the per-run sweep cap is hit (remainder
 * carries over to the next tick). Returns totals for the log line. Begins with
 * a connectivity probe so a store outage fails loudly (→ the caller's
 * `purge_failed` log) instead of a false `purge_complete scanned=0`:
 * `listThreads` swallows store errors, but `getThreadById` throws.
 */
export async function runAiChatRetentionPurge({
  memory,
  now = () => Date.now(),
}: {
  memory: AiChatRetentionMemory
  now?: () => number
}): Promise<{ scanned: number; deleted: number; sweeps: number }> {
  // Connectivity probe (see RETENTION_PROBE_THREAD_ID): a missing id returns
  // null cheaply when the store is healthy, but throws on an outage — turning a
  // silent false success into an honest `purge_failed`.
  await memory.getThreadById({ threadId: RETENTION_PROBE_THREAD_ID })

  let totalScanned = 0
  let totalDeleted = 0
  let sweeps = 0
  while (sweeps < PURGE_MAX_SWEEPS_PER_RUN) {
    const { scanned, deleted, collected } = await sweepOnce(memory, now())
    sweeps += 1
    totalScanned += scanned
    totalDeleted += deleted
    // Drained when the sweep did NOT fill its collect batch. Keying on
    // `deleted` would stop early when the recency re-check spared part of a
    // full batch, stranding still-expired rows until the next daily tick.
    if (collected < PURGE_MAX_DELETES_PER_SWEEP) break
  }
  return { scanned: totalScanned, deleted: totalDeleted, sweeps }
}

let cachedRetentionMemory: AiChatRetentionMemory | null = null

/**
 * The Memory the purge operates on: built DIRECTLY over the persisted
 * `ai_chat` store, never `getAiChatMemory()` — under the kill-switch that
 * resolves to an InMemoryStore, and a purge over it would report success
 * (`scanned=0`) while the Postgres rows age past their windows. Lazy
 * singleton; wraps the PostgresStore singleton, so no extra pool.
 */
function getPersistedAiChatRetentionMemory(): AiChatRetentionMemory {
  if (cachedRetentionMemory === null) {
    cachedRetentionMemory = new Memory({ storage: getAiChatStorage() })
  }
  return cachedRetentionMemory
}

export function __resetAiChatRetentionMemoryForTesting(): void {
  cachedRetentionMemory = null
}

/**
 * Boot-time entry point: run one purge now and re-run daily. No-ops (returns
 * null) unless a postgres backend is configured at all (`canAiChatDataPersist`)
 * — NOT the resolved ai-chat backend, so the production kill-switch never
 * pauses retention while `MASTRA_STORAGE_BACKEND=memory` local runs never
 * open a pool. A failed run logs and waits for the next tick; it never
 * crashes the service. The timer is unref'd so it cannot hold the process
 * open. Single-instance assumption: a multi-replica deploy would run
 * redundant (harmless, wasteful) sweeps — add a leader guard before scaling
 * out.
 */
export function startAiChatRetentionPurge({
  isEnabled = canAiChatDataPersist,
  getMemory = getPersistedAiChatRetentionMemory,
  intervalMs = AI_CHAT_PURGE_INTERVAL_MS,
}: {
  isEnabled?: () => boolean
  getMemory?: () => AiChatRetentionMemory
  intervalMs?: number
} = {}): { stop: () => void } | null {
  if (!isEnabled()) {
    console.info(
      "[ai-chat-retention] event=purge_disabled reason=no_postgres_backend",
    )
    return null
  }

  const sweep = () => {
    void runAiChatRetentionPurge({ memory: getMemory() })
      .then(({ scanned, deleted, sweeps }) => {
        console.info(
          `[ai-chat-retention] event=purge_complete scanned=${scanned} deleted=${deleted} sweeps=${sweeps}`,
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
