/**
 * Per-user erasure for the ai-chat lane (feat-337) — the reusable module the
 * `erase-user` CLI thinly wraps and the future apps/auth account-deletion
 * cascade (feat-356) will call.
 *
 * A subject-erasure request ("delete my data") must remove a resource's Seeker
 * data everywhere it lives. Since feat-321 that is TWO stores: the `ai_chat`
 * Postgres schema (threads + messages keyed by `resourceId`) and the
 * `forge-mastra` Langfuse project (traces keyed by the same value in `userId`).
 * This module owns the composition and returns INDEPENDENT per-store outcomes
 * so a caller can report "Postgres done, Langfuse not" honestly. PR 1 builds
 * the Postgres half; the Langfuse slot reports `not_implemented` until PR 2
 * fills it — deliberately NOT `skipped_unconfigured`, which keeps exactly one
 * meaning (the credential trio is absent).
 *
 * Retention does not make this redundant. The Postgres purge
 * (`./ai-chat-retention.ts`) is keyed to last activity, so a thread the subject
 * keeps using never ages out — this module is that store's only erasure path.
 *
 * Contract, in the order the safety matters:
 *
 *  - **Key equality, never prefix** (R2). The store-side
 *    `listThreads({ filter: { resourceId } })` filter IS the equality
 *    primitive; nothing here splits, trims, or pattern-matches a resource key.
 *    Two named refusals happen BEFORE any store is acquired: a blank key, and
 *    the exact shared fallback `SEEKER_DEFAULT_RESOURCE_ID` — many individuals'
 *    turns share that key, so key equality does not bound its blast radius to
 *    one subject (retention is that data's only deletion path).
 *  - **Filter integrity — the store's filter is a promise, not a proof.** Two
 *    independent client-side re-checks stand behind it, because a `@mastra/pg`
 *    bump that renamed the filter argument or made it inert would otherwise
 *    hand this tool every thread in the schema, and NO mocked test could catch
 *    it (every fake implements the filter as `===` because that is what the
 *    contract says). So: each listed row's own `resourceId` is re-checked
 *    during the collect, and every thread is re-read and proven to belong to
 *    the target immediately before it is deleted — failing CLOSED when a row's
 *    `resourceId` is absent or null, so ownership is proven per thread rather
 *    than assumed. Either check rejecting STOPS the run (`filter_mismatch` /
 *    `unreadable_rows`) instead of skipping and continuing. This is the same
 *    discipline `langfuse-trace-retention.ts` applies to its own listing's
 *    `startTime`, for the same reason: an inert server-side filter must
 *    degrade to a loud refusal, never a wider delete.
 *  - **Collect-then-delete** (KTD1). ALL pages drain into a collected id list
 *    before the first `deleteThread`. Interleaving deletes with pagination
 *    shifts pages and can silently skip threads — for retention that is a
 *    missed row the next daily sweep catches, for erasure it is a completeness
 *    failure with no sweep behind it.
 *  - **`deleteThread`, not hand-rolled SQL.** It also removes the thread's
 *    messages and orphaned vectors, which the old runbook SQL missed.
 *  - **Memory built DIRECTLY over `getAiChatStorage()`** — never
 *    `getAiChatMemory()`, whose `AI_CHAT_MEMORY_BACKEND=memory` kill switch
 *    resolves to an InMemoryStore: an erasure over it would report success
 *    while every Postgres row survived. Same reason the retention purge does
 *    it, one notch more serious.
 *  - **`DATABASE_URL` is asserted explicitly** (KTD1). `getMastraDatabaseUrl()`
 *    silently falls back to a localhost URL; for a destructive tool that is a
 *    "wrong database" hazard, so an unset value is a refusal, not a fallback.
 *  - **A connectivity probe guards every count that could read as "no data"**
 *    (KTD7). `listThreads` SWALLOWS store faults into empty results (see
 *    `./ai-chat-thread-ownership.ts` and `./ai-chat-retention.ts`), and a false
 *    "no data found for this exact key" is worse for erasure than a false
 *    purge-complete is for retention — it would be recorded as a completed
 *    request. `getThreadById` THROWS on a store fault, so a sentinel read runs
 *    before the counts and again before the deletes; a probe failure is a
 *    distinct fault outcome, never a zero count.
 *  - **Enum/count-only logging** (R4). Never a resource id, thread id, title,
 *    conversation text, or caught exception text — a caught error is classified
 *    and dropped.
 *
 * Verification honesty (R15): the Postgres half reports its deletion
 * synchronously. The Langfuse half (PR 2) will not — deletion there is ~15 min
 * asynchronous with no completion receipt — which is why the outcomes are
 * per-store rather than one run-level verdict.
 *
 * Accepted residual — concurrent writes during a run (owner decision,
 * 2026-08-17: accepted, build no handling). A thread created for the target
 * between the first and last listing page survives, while the run reports
 * `erased threads_deleted=N`. A subject who requested erasure is not
 * actively chatting, and a survivor ages out via retention within 25 days,
 * so the exposure is bounded. This stands after PR 2 makes exit 0 reachable;
 * reopen only on an observed incident, not by default.
 */

import { Memory } from "@mastra/memory"

import { env } from "../config/env"

import { getAiChatStorage } from "./ai-chat-memory"
import { SEEKER_DEFAULT_RESOURCE_ID } from "./ai-chat-thread-ownership"

/**
 * Sentinel thread id for the connectivity probe (KTD7). Reserved string that
 * cannot collide with a real conversation thread id; a missing id returns null
 * cheaply when the store is healthy and THROWS on a store fault. Deliberately
 * distinct from the retention purge's sentinel so the two jobs' probes are
 * independently greppable in logs.
 */
export const ERASURE_PROBE_THREAD_ID = "__ai_chat_erasure_connectivity_probe__"

/** Listing page size for the collect phase. */
const ERASURE_LIST_PAGE_SIZE = 100

/**
 * Loop guard on the collect phase: 200 pages x 100 = 20,000 threads, two
 * orders of magnitude above the per-resource creation ceiling
 * (`AI_CHAT_MAX_THREADS_PER_RESOURCE` = 200, which fails OPEN on a store
 * fault). It exists so a store whose `hasMore` never goes false cannot spin
 * forever; hitting it is a loud failure, never a silent truncation — a
 * truncated erasure that reported success is exactly the completeness failure
 * collect-then-delete exists to prevent.
 */
const ERASURE_MAX_LIST_PAGES = 200

/**
 * The narrow Memory surface erasure needs — structural so tests fake it. Both
 * read shapes carry `resourceId` because this module never trusts the
 * store-side filter alone (see "Filter integrity" in the module header): the
 * listing's rows are re-checked, and every thread is re-read and proven to
 * belong to the target immediately before it is deleted.
 */
export type AiChatErasureMemory = {
  getThreadById: (args: {
    threadId: string
  }) => Promise<{ resourceId?: string | null } | null>
  listThreads: (args: {
    filter?: { resourceId?: string }
    page?: number
    perPage?: number
  }) => Promise<{
    threads: Array<{ id: string; resourceId?: string | null }>
    hasMore: boolean
  }>
  deleteThread: (threadId: string) => Promise<void>
}

/**
 * Refusals that happen BEFORE any store is acquired. `database_url_missing`
 * rides here rather than in the Postgres outcome because it is a
 * configuration refusal, not a fact about the store's contents.
 */
export type AiChatErasureRefusalReason =
  | "blank_resource_id"
  | "shared_fallback_resource"
  | "database_url_missing"

/**
 * `filter_mismatch` and `unreadable_rows` both mean the STORE's contract
 * drifted out from under the key-equality primitive R2 rests on, so both stop
 * the run with zero further deletes rather than degrading quietly:
 *  - `filter_mismatch` — a row the store returned for this resource did not
 *    prove equal to the target, INCLUDING a row whose own `resourceId` is
 *    absent or null. Ownership is proven, never assumed.
 *  - `unreadable_rows` — a listed row carried no usable thread id. Dropping
 *    those silently would let a row-shape change report `no_data` over a
 *    populated key with no signal at all.
 */
export type PostgresErasureFailureReason =
  | "store_error"
  | "page_cap_exceeded"
  | "filter_mismatch"
  | "unreadable_rows"

/**
 * Per-store outcome for the `ai_chat` Postgres half. `no_data` is DISTINCT
 * from a successful erasure (R15 / AE7) and is only reachable behind a healthy
 * probe; `unreachable` is what an unhealthy probe produces instead.
 */
export type PostgresErasureOutcome =
  | { kind: "no_data" }
  | { kind: "counted"; threadCount: number }
  | { kind: "erased"; threadsDeleted: number }
  | { kind: "unreachable" }
  | {
      kind: "failed"
      stage: "list" | "delete"
      reason: PostgresErasureFailureReason
      threadsDeleted: number
    }

/**
 * Per-store outcome for the Langfuse half. PR 1 ships the slot only:
 * `not_implemented` says "this build cannot erase traces", which an operator
 * covers with the documented console bulk-delete. PR 2 (U6) widens this union
 * with the real outcomes — `skipped_unconfigured` (trio absent) among them,
 * kept distinct so the two never blur.
 */
export type LangfuseErasureOutcome = { kind: "not_implemented" }

export type AiChatErasureResult =
  | { kind: "refused"; reason: AiChatErasureRefusalReason }
  | {
      kind: "completed"
      mode: "preview" | "execute"
      postgres: PostgresErasureOutcome
      langfuse: LangfuseErasureOutcome
    }

export type AiChatErasureMemoryAcquisition =
  | { ok: true; memory: AiChatErasureMemory }
  | { ok: false; reason: "database_url_missing" }

/** Enum/count-only log sink (R4). Injected so tests can assert exact lines. */
export type AiChatErasureLog = {
  info: (line: string) => void
  warn: (line: string) => void
}

const defaultLog: AiChatErasureLog = {
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
}

let cachedErasureMemory: AiChatErasureMemory | null = null
/**
 * The STORE behind `cachedErasureMemory` — held separately because the pooled
 * connections (and therefore the disposal handle) belong to the store, not to
 * the `Memory` wrapper. Captured at acquisition so `closeAiChatErasureStore`
 * never has to call `getAiChatStorage()` itself, which would CONSTRUCT a store
 * (and open a pool) on a run that never touched one.
 */
let cachedErasureStore: { close?: () => Promise<void> } | null = null

/**
 * The Memory erasure operates on: built DIRECTLY over the persisted `ai_chat`
 * store (never the backend-resolved `getAiChatMemory()` — see the module
 * header), and only after `DATABASE_URL` is proven present. Reads
 * `env.DATABASE_URL` (post-`emptyToUndefined`, so a blank sourced value is
 * `undefined` here) rather than `getMastraDatabaseUrl()`, whose localhost
 * fallback must never silently become a destructive tool's target.
 */
export function acquirePersistedErasureMemory(): AiChatErasureMemoryAcquisition {
  if (env.DATABASE_URL === undefined) {
    return { ok: false, reason: "database_url_missing" }
  }
  if (cachedErasureMemory === null) {
    // Assigned WITHOUT a cast, deliberately (same as the retention purge's
    // `getPersistedAiChatRetentionMemory`): the structural type above is what
    // makes a `@mastra/memory` signature drift a compile error here rather
    // than a runtime surprise inside a destructive tool. If a future bump
    // breaks this assignment, fix or document the incompatibility — do not
    // bridge it through `unknown`.
    const storage = getAiChatStorage()
    cachedErasureStore = storage
    cachedErasureMemory = new Memory({ storage })
  }
  return { ok: true, memory: cachedErasureMemory }
}

/**
 * Release the pooled Postgres connections the acquisition above opened.
 * `erase-user` is a short-lived CLI, and an open `pg` pool keeps the event
 * loop alive — without this the operator's command would appear to hang after
 * printing its report and never deliver its exit code. Mirrors
 * `check-devotional-database-readiness.ts`'s `finally { await pool?.end() }`.
 * Best-effort and never throws: a disposal failure must not turn a completed
 * erasure into a nonzero exit.
 */
export async function closeAiChatErasureStore(): Promise<void> {
  const store = cachedErasureStore
  cachedErasureStore = null
  cachedErasureMemory = null
  if (store === null) return
  try {
    await store.close?.()
  } catch {
    // Cleanup is best-effort; enum-only, and never escalated.
  }
}

export function __resetAiChatErasureMemoryForTesting(): void {
  cachedErasureMemory = null
  cachedErasureStore = null
}

export type AiChatErasureOptions = {
  resourceId: string
  acquireMemory?: () => AiChatErasureMemoryAcquisition
  log?: AiChatErasureLog
}

/**
 * The two refusals R2 requires, checked before ANY store access so a refused
 * run cannot even open a connection. Exact value comparison — no trim, no
 * normalization: a key that differs from the fallback by whitespace IS a
 * different key, and treating it as the same would be the prefix/pattern
 * matching R2 bans.
 */
function refusalFor(resourceId: string): AiChatErasureRefusalReason | null {
  if (resourceId.trim().length === 0) return "blank_resource_id"
  if (resourceId === SEEKER_DEFAULT_RESOURCE_ID) {
    return "shared_fallback_resource"
  }
  return null
}

/**
 * Sentinel read (KTD7). Resolves true when the store answered — a `null`
 * (missing id) IS a healthy answer — and false when it threw.
 */
async function probeStore(memory: AiChatErasureMemory): Promise<boolean> {
  try {
    await memory.getThreadById({ threadId: ERASURE_PROBE_THREAD_ID })
    return true
  } catch {
    // Classified, never printed: a store error can embed connection strings.
    return false
  }
}

type CollectResult =
  | { ok: true; threadIds: string[] }
  | { ok: false; reason: PostgresErasureFailureReason; rejectedRows: number }

/**
 * Drain EVERY page of this resource's threads into one id list (KTD1), then
 * re-check the store's work.
 *
 * The `filter: { resourceId }` argument is the key-equality seam R2 rests on —
 * but it is the store's promise, not this module's proof. If a `@mastra/pg`
 * bump ever renamed the argument or neutered the filter, an unchecked collect
 * would hand the delete loop EVERY thread in the schema, and no mocked test
 * could go red (every fake implements the filter as `===` because that is what
 * the contract says). So each row's own `resourceId` is re-checked here, the
 * way `langfuse-trace-retention.ts` re-checks each listed row's `startTime`
 * against its cutoff, and for the same reason: a silently inert server-side
 * filter must degrade to a loud refusal, never a wider delete.
 *
 * Rejections are counted and STOP the run — never skipped and continued. A
 * partial collect over a store whose contract has drifted is exactly the
 * completeness failure collect-then-delete exists to prevent.
 *
 * Ids are deduped defensively so a store that repeats a row across pages
 * cannot double-count the reported total.
 */
async function collectThreadIds(
  memory: AiChatErasureMemory,
  resourceId: string,
): Promise<CollectResult> {
  const threadIds: string[] = []
  const seen = new Set<string>()
  let unreadableRows = 0
  let mismatchedRows = 0
  let page = 0
  try {
    for (;;) {
      if (page >= ERASURE_MAX_LIST_PAGES) {
        return { ok: false, reason: "page_cap_exceeded", rejectedRows: 0 }
      }
      const result = await memory.listThreads({
        filter: { resourceId },
        page,
        perPage: ERASURE_LIST_PAGE_SIZE,
      })
      for (const thread of result.threads) {
        if (typeof thread.id !== "string" || thread.id.length === 0) {
          unreadableRows += 1
          continue
        }
        // A row that carries a resourceId must match exactly. An ABSENT one is
        // not treated as a mismatch here — the row shape simply cannot answer
        // the question — because the pre-delete re-read below proves ownership
        // per thread and fails closed on exactly that case.
        if (
          thread.resourceId !== undefined &&
          thread.resourceId !== resourceId
        ) {
          mismatchedRows += 1
          continue
        }
        if (seen.has(thread.id)) continue
        seen.add(thread.id)
        threadIds.push(thread.id)
      }
      if (!result.hasMore) break
      page += 1
    }
  } catch {
    // Enum-only: the caught error never reaches a log line or a result.
    return { ok: false, reason: "store_error", rejectedRows: 0 }
  }
  if (mismatchedRows > 0) {
    return {
      ok: false,
      reason: "filter_mismatch",
      rejectedRows: mismatchedRows,
    }
  }
  if (unreadableRows > 0) {
    return {
      ok: false,
      reason: "unreadable_rows",
      rejectedRows: unreadableRows,
    }
  }
  return { ok: true, threadIds }
}

/**
 * The ONE place a `PostgresErasureOutcome` becomes operator-facing text. Both
 * this module's log line and the CLI's report render through it, so a widened
 * union is a single edit rather than two switch chains drifting apart — the
 * shape PR 2 needs when it fills the Langfuse slot. Enum and counts only (R4).
 */
export function formatPostgresOutcome(
  postgres: PostgresErasureOutcome,
): string {
  switch (postgres.kind) {
    case "counted":
      return `postgres=counted threads=${postgres.threadCount}`
    case "erased":
      return `postgres=erased threads_deleted=${postgres.threadsDeleted}`
    case "failed":
      return `postgres=failed stage=${postgres.stage} reason=${postgres.reason} threads_deleted=${postgres.threadsDeleted}`
    default:
      return `postgres=${postgres.kind}`
  }
}

function logCompleted(
  log: AiChatErasureLog,
  mode: "preview" | "execute",
  postgres: PostgresErasureOutcome,
  langfuse: LangfuseErasureOutcome,
): void {
  const line = `[ai-chat-erasure] event=${mode}_complete ${formatPostgresOutcome(postgres)} langfuse=${langfuse.kind}`
  if (postgres.kind === "failed" || postgres.kind === "unreachable") {
    log.warn(line)
    return
  }
  log.info(line)
}

async function runErasure(
  mode: "preview" | "execute",
  { resourceId, acquireMemory, log }: AiChatErasureOptions,
): Promise<AiChatErasureResult> {
  const sink = log ?? defaultLog

  const refusal = refusalFor(resourceId)
  if (refusal !== null) {
    sink.warn(`[ai-chat-erasure] event=refused reason=${refusal}`)
    return { kind: "refused", reason: refusal }
  }

  const acquired = (acquireMemory ?? acquirePersistedErasureMemory)()
  if (!acquired.ok) {
    sink.warn(`[ai-chat-erasure] event=refused reason=${acquired.reason}`)
    return { kind: "refused", reason: acquired.reason }
  }
  const memory = acquired.memory
  const langfuse: LangfuseErasureOutcome = { kind: "not_implemented" }

  const completed = (postgres: PostgresErasureOutcome): AiChatErasureResult => {
    logCompleted(sink, mode, postgres, langfuse)
    return { kind: "completed", mode, postgres, langfuse }
  }

  // Probe BEFORE the counts (KTD7) — a swallowed store fault would otherwise
  // surface as a zero count and read as "no data found for this exact key".
  if (!(await probeStore(memory))) {
    sink.warn("[ai-chat-erasure] event=probe_failed stage=pre_count")
    return completed({ kind: "unreachable" })
  }

  const collected = await collectThreadIds(memory, resourceId)
  if (!collected.ok) {
    return completed({
      kind: "failed",
      stage: "list",
      reason: collected.reason,
      threadsDeleted: 0,
    })
  }

  if (mode === "preview") {
    if (collected.threadIds.length > 0) {
      return completed({
        kind: "counted",
        threadCount: collected.threadIds.length,
      })
    }
    // Re-probe before reporting a ZERO count (KTD7 again, on the read path).
    // The pre-count probe only proves the store was alive when the run
    // started; `listThreads` swallows a fault that opens during the listing
    // into an empty result, so without this the preview would report "no data
    // found for this exact key" for a store that died mid-listing — and the
    // runbook tells the operator that reading means "re-derive the key".
    // Only the zero case pays for the extra read.
    if (!(await probeStore(memory))) {
      sink.warn("[ai-chat-erasure] event=probe_failed stage=post_count")
      return completed({ kind: "unreachable" })
    }
    return completed({ kind: "no_data" })
  }

  // Second probe (KTD7): the collect phase can only report a zero list, and a
  // store that went down between the first probe and now would produce exactly
  // that. Re-prove liveness before committing to a destructive claim.
  if (!(await probeStore(memory))) {
    sink.warn("[ai-chat-erasure] event=probe_failed stage=pre_delete")
    return completed({ kind: "unreachable" })
  }

  if (collected.threadIds.length === 0) {
    return completed({ kind: "no_data" })
  }

  let threadsDeleted = 0
  for (const threadId of collected.threadIds) {
    // Prove ownership immediately before deleting, from the thread's OWN row —
    // the same shape the retention purge uses for its recency re-check, and
    // the layer that survives a listing whose rows stop carrying `resourceId`
    // at all. `getThreadById` THROWS on a store fault (unlike `listThreads`),
    // so a fault here is a classified failure, never a skipped delete.
    let owner: { resourceId?: string | null } | null
    try {
      owner = await memory.getThreadById({ threadId })
    } catch {
      return completed({
        kind: "failed",
        stage: "delete",
        reason: "store_error",
        threadsDeleted,
      })
    }
    // Vanished between collect and delete (deleted concurrently, or by an
    // earlier interrupted run): benign — the row is already gone, which is
    // what this run wanted.
    if (owner === null) continue
    // Fails CLOSED on an absent or null `resourceId`: ownership is proven per
    // thread, never assumed. Reaching here means the store contradicted its
    // own filter, so stop rather than delete one more row.
    if (owner.resourceId !== resourceId) {
      return completed({
        kind: "failed",
        stage: "delete",
        reason: "filter_mismatch",
        threadsDeleted,
      })
    }
    try {
      await memory.deleteThread(threadId)
    } catch {
      // Enum/count-only: the deleted-so-far count is what makes the rerun
      // guidance honest; the thrown message never appears anywhere.
      return completed({
        kind: "failed",
        stage: "delete",
        reason: "store_error",
        threadsDeleted,
      })
    }
    threadsDeleted += 1
  }
  // Messages and orphaned vectors ride `deleteThread`'s cascade — no separate
  // count is claimed for them, because none is observable here.
  return completed({ kind: "erased", threadsDeleted })
}

/**
 * Read-only per-store count preview (R3/KD6). Deletes nothing: the operator
 * sees the blast radius before committing. `deleteThread` is never called on
 * this path — the unit suite asserts that directly.
 */
export function previewAiChatErasure(
  options: AiChatErasureOptions,
): Promise<AiChatErasureResult> {
  return runErasure("preview", options)
}

/**
 * Destructive run: collect-then-delete this resource's threads (and, through
 * `deleteThread`'s cascade, their messages and orphaned vectors). The caller
 * owns the confirm gate — this function assumes it already passed.
 */
export function executeAiChatErasure(
  options: AiChatErasureOptions,
): Promise<AiChatErasureResult> {
  return runErasure("execute", options)
}
