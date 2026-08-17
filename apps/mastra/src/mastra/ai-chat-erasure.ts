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
 * so a caller can report "Postgres done, Langfuse not" honestly. The Postgres
 * half deletes synchronously; the Langfuse half (U6) lists the target's
 * observations by `userId`, re-checks every row client-side, dedupes to
 * unique trace ids, batch-deletes under the erasure headroom budget, and ends
 * with ONE read-only requery (KTD6 — never a re-submitted delete).
 * `skipped_unconfigured` keeps exactly one meaning: the Langfuse credential
 * trio is absent. The two halves are independent on purpose: a fault in one
 * store never blocks the other's erasure — the exit code (CLI-side) still
 * reflects the worst store.
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
 * synchronously. The Langfuse half does not — deletion there is ~15 min
 * asynchronous with no completion receipt — so its normal terminal state is
 * "deletes submitted; N still visible" (a NON-failure), and the zero-visible
 * evidence is the operator's later preview rerun. This is why the outcomes
 * are per-store rather than one run-level verdict.
 *
 * Langfuse egress pin (KTD11): before ANY Langfuse request the module asserts
 * the configured base URL is https AND its host is allowlisted — against
 * `LANGFUSE_ALLOWED_HOSTS` when set, else the pinned vendor-cloud host
 * (`cloud.langfuse.com`). The env.ts production boot guard never fires in a
 * workstation tsx process, and the secret key grants read access to raw
 * conversation text, so the pin must live here too. A failed pin is a
 * distinct fault outcome with ZERO list/delete requests issued — never a
 * zero count. There is no project-identity probe (owner ruling, 2026-08-17):
 * Langfuse keys are project-scoped, so the env's key pair itself determines
 * the project; the workstation-hygiene assumption is recorded in R14.
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

import {
  env,
  getLangfuseTraceRetentionConfig,
  type LangfuseConfig,
} from "../config/env"

import { getAiChatStorage } from "./ai-chat-memory"
import { SEEKER_DEFAULT_RESOURCE_ID } from "./ai-chat-thread-ownership"
import {
  LANGFUSE_ERASURE_LIST_PAGE_SIZE,
  MAX_TRACE_IDS_PER_DELETE_REQUEST,
  deleteTraceBatch,
  isLangfuseTraceRetentionConfigured,
  listObservationsByUserIdPage,
  type LangfuseErasureListFailureReason,
} from "./langfuse-trace-retention"

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
 * Pinned vendor-cloud host the KTD11 egress pin falls back to when
 * `LANGFUSE_ALLOWED_HOSTS` is unset. The org's `forge-mastra` project lives
 * on the Langfuse EU cloud (`cloud.langfuse.com` — the same host the CLI
 * suite and runbook name); a region move or self-hosted target must arrive
 * with an explicit allowlist entry rather than sailing past the pin.
 */
export const LANGFUSE_ERASURE_PINNED_HOST = "cloud.langfuse.com"

/**
 * Per-run delete-request cap: the KD3 headroom share. The retention sweep
 * caps itself at 40/day of the org's 50/day Hobby delete quota
 * (`MAX_DELETE_REQUESTS_PER_RUN` in `./langfuse-trace-retention.ts`), so
 * erasure takes at most the remaining 10 per RUN. The cap is per RUN with
 * NO cross-run ledger: one run can never consume the sweep's allocation,
 * but N same-day runs spend 10·N of the org's 50/day — a spend ledger was
 * owner-declined (KD1/KD3), and the collision fails soft: a quota-hit run
 * reports `quota_exhausted` and reruns the next day. 10 requests x 50 ids =
 * 500 traces/run, which is also the headroom rate the quota outcome's
 * implied-days horizon is computed at (F2).
 */
export const MAX_ERASURE_DELETE_REQUESTS_PER_RUN = 10

/**
 * Per-run listing page cap, mirroring the retention module's
 * `MAX_LIST_PAGES_PER_RUN` rationale: a pathological backlog (or a drifted
 * pagination contract whose cursor never ends) must not spin the general API
 * bucket (30 req/min). 20 pages × 100 rows (`LANGFUSE_ERASURE_LIST_PAGE_SIZE`)
 * = 2,000 observations — far above any single subject's plausible trace
 * volume (measured max 9 traces/user, 2026-08-17). Erasure-local rather than
 * the imported constant so the two budgets can move independently.
 */
export const MAX_ERASURE_LIST_PAGES_PER_RUN = 20

/**
 * Delete-stage 429 discriminator (KTD5/R5): a `Retry-After` STRICTLY below
 * this many seconds reads as a transient throttle → retry-shortly guidance;
 * absent or at/above it reads as the org's DAILY delete quota → the R5 quota
 * outcome with remaining count + implied-days horizon. One hour splits the
 * plan's "short (minutes)" from "day-scale" with a wide margin on each side —
 * no legitimate transient throttle waits an hour, and a real daily-quota
 * reset is never under one.
 */
export const ERASURE_QUOTA_RETRY_AFTER_THRESHOLD_SECONDS = 3_600

/** Headroom rate for the implied-days horizon: 10 requests x 50 ids (F2). */
const ERASURE_TRACES_PER_DAY =
  MAX_ERASURE_DELETE_REQUESTS_PER_RUN * MAX_TRACE_IDS_PER_DELETE_REQUEST

/**
 * Count fields carried by every Langfuse outcome that got past the egress
 * pin — what the CLI report needs to name per-store state honestly (KTD5).
 */
export type LangfuseErasureCounts = {
  /** Raw observation rows listed across all pages (readable or not). */
  listedObservations: number
  /** Unique trace ids that passed the client-side `userId` re-check. */
  uniqueTraces: number
  /**
   * Rows whose own `userId` did NOT equal the target (AE6): skipped and
   * counted — their ids appear in NO delete request.
   */
  mismatchedRowsSkipped: number
  /**
   * Rows whose `userId` matched shape-wise but whose `traceId` was unreadable
   * — visible yet unaddressable. Non-zero REFUSES the whole half
   * (`refused_unaddressable_rows`) with zero deletes: such rows cannot be
   * deleted by id, and the refusal — not the read-only requery, which can
   * only re-list the same unaddressable rows — is what keeps the
   * completeness claim honest.
   */
  missingTraceIdRows: number
  /** Delete requests ATTEMPTED — each spends quota whether or not it 2xx'd. */
  deleteRequests: number
  /** Trace ids inside ACCEPTED delete requests (accepted ≠ gone; async). */
  tracesSubmitted: number
}

/**
 * Per-store outcome for the Langfuse half (U6). Every variant is exhaustive
 * on purpose — `formatLangfuseOutcome` is the ONE place this union becomes
 * text, so a widened union is a compile error there rather than a silent
 * fallthrough:
 *
 *  - `skipped_unconfigured` — the credential trio is absent (AE5). The ONLY
 *    meaning this kind ever has; the store's state is unknowable, which is
 *    why an execute run carrying it cannot exit 0.
 *  - `egress_refused` — the KTD11 pin refused the base URL (non-https or
 *    non-allowlisted host). ZERO list/delete requests were issued; never a
 *    zero count.
 *  - `counted` — preview: the deduped visible-trace count (R3).
 *  - `no_data` — a COMPLETE listing (no truncation, no unreadable rows) saw
 *    zero traces for this exact key (AE7) — distinct from an erasure.
 *  - `submitted` — execute: every unique trace id was accepted into a delete
 *    request. `requery` carries the ONE read-only follow-up listing (KTD6):
 *    "N still visible" is the NORMAL terminal state (~15 min async deletion,
 *    R15/AE4 — a non-failure), and a requery that itself failed is reported
 *    honestly WITHOUT failing the run — the deletes were already accepted,
 *    so a listing hiccup after them must not turn a full submission into a
 *    rerun instruction.
 *  - `rate_limited` — a 429 the run treats as transient: list-stage always
 *    (a read-bucket throttle — the daily-quota wording must NEVER attach to
 *    it), delete-stage only under a short `Retry-After` (see the threshold
 *    constant). Retry-shortly guidance, exit 2.
 *  - `quota_exhausted` — delete-stage 429 with absent or day-scale
 *    `Retry-After`: the R5 daily delete quota outcome, carrying the
 *    remaining trace count and the implied days-to-complete at the headroom
 *    rate (F2). No further delete requests are attempted.
 *  - `cap_exceeded` — a per-run bound hit with work remaining: the 10-request
 *    delete cap, or the listing page cap. Ids collected before the hit WERE
 *    deleted (the retention module's precedent — safe because exact-key
 *    reruns are idempotent) and the incomplete state is reported for a
 *    rerun. No requery: traces knowably remain, so it could only restate that.
 *  - `refused_unreadable_user_ids` — the listing returned rows whose
 *    `userId` cannot be read (R7): per-row ownership is unprovable, so the
 *    WHOLE half refuses with zero deletes rather than acting on unproven
 *    rows — the Langfuse mirror of the Postgres half's `unreadable_rows`.
 *  - `refused_unaddressable_rows` — the listing returned rows whose `userId`
 *    IS readable (and matching) but whose `traceId` is not: the target's
 *    rows are visible yet unaddressable by id. The same store-contract
 *    anomaly class as an unreadable `userId` (today's real listing carries
 *    both fields on every row), so the WHOLE half refuses with zero deletes
 *    in BOTH modes — deleting the addressable subset and reporting around
 *    the rest would blur the completeness claim, and no rerun fixes it:
 *    escalation plus the runbook's break-glass console path are the
 *    recovery.
 *  - `failed` — any other classified HTTP failure, stage-discriminated.
 */
export type LangfuseErasureOutcome =
  | { kind: "skipped_unconfigured" }
  | { kind: "egress_refused" }
  | ({ kind: "counted" } & LangfuseErasureCounts)
  | ({ kind: "no_data" } & LangfuseErasureCounts)
  | ({
      kind: "submitted"
      requery:
        | { ok: true; stillVisibleTraces: number }
        | { ok: false; reason: LangfuseErasureListFailureReason }
    } & LangfuseErasureCounts)
  | ({
      kind: "rate_limited"
      stage: "list" | "delete"
      retryAfterSeconds?: number
      /** Known for the delete stage only (the listing was complete there). */
      remainingTraces?: number
    } & LangfuseErasureCounts)
  | ({
      kind: "quota_exhausted"
      remainingTraces: number
      impliedDaysToComplete: number
    } & LangfuseErasureCounts)
  | ({
      kind: "cap_exceeded"
      cap: "list_pages" | "delete_requests"
      /** Known for the delete-request cap; unknowable past a truncated list. */
      remainingTraces?: number
    } & LangfuseErasureCounts)
  | ({
      kind: "refused_unreadable_user_ids"
      missingUserIdRows: number
    } & LangfuseErasureCounts)
  | ({
      kind: "refused_unaddressable_rows"
      missingTraceIdRows: number
    } & LangfuseErasureCounts)
  | ({
      kind: "failed"
      stage: "list" | "delete"
      reason: LangfuseErasureListFailureReason
      status?: number
    } & LangfuseErasureCounts)

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

/**
 * Injectable Langfuse seam. Tests (and the opt-in real-Postgres smoke) supply
 * an explicitly-UNCONFIGURED `getConfig` so zero outbound requests are
 * possible by construction; production callers omit it and the half reads
 * `getLangfuseTraceRetentionConfig()` (15s timeouts — the sweep-tuned budget,
 * not the 3s prompt one) plus `env.LANGFUSE_ALLOWED_HOSTS` for the pin.
 */
export type AiChatErasureLangfuseSeam = {
  getConfig?: () => LangfuseConfig
  /** CSV allowlist source for the KTD11 pin; default `env.LANGFUSE_ALLOWED_HOSTS`. */
  getAllowedHosts?: () => string | undefined
  fetchImpl?: typeof fetch
}

export type AiChatErasureOptions = {
  resourceId: string
  acquireMemory?: () => AiChatErasureMemoryAcquisition
  log?: AiChatErasureLog
  langfuse?: AiChatErasureLangfuseSeam
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
 * The KTD11 egress pin. True only when the base URL parses, is https, and its
 * host is allowlisted — against the CSV when set (same trim/lowercase rules
 * as env.ts's `csvSet`), else the pinned vendor-cloud host. Checked BEFORE
 * any Langfuse request; a refusal issues zero requests.
 */
function langfuseEgressAllowed(
  baseUrl: string | undefined,
  allowedHostsCsv: string | undefined,
): boolean {
  if (!baseUrl) return false
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  if (allowedHostsCsv !== undefined && allowedHostsCsv.trim().length > 0) {
    const allowed = new Set(
      allowedHostsCsv
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    )
    return allowed.has(host)
  }
  return host === LANGFUSE_ERASURE_PINNED_HOST
}

type LangfuseCollectResult = {
  /** Unique trace ids whose row's own `userId` proved equal to the target. */
  traceIds: string[]
  listedObservations: number
  mismatchedRowsSkipped: number
  missingUserIdRows: number
  missingTraceIdRows: number
  /** The page cap stopped the drain with a cursor still outstanding. */
  truncated: boolean
  failure?: {
    reason: LangfuseErasureListFailureReason
    status?: number
    retryAfterSeconds?: number
  }
}

/**
 * List → re-check → dedupe (KTD4/R7): drain the by-userId listing under the
 * page cap, prove every row's OWN `userId` equal to the target before its
 * traceId may enter the collected set (AE6 — the server-side filter is a
 * promise, not a proof; same discipline as the Postgres half's per-row
 * re-check), and dedupe across pages so one trace's many observations yield
 * one delete id. Collect-then-delete, like the Postgres half: deleting
 * mid-listing shifts pages under the cursor and can silently skip traces —
 * for erasure that is a completeness failure with no daily sweep behind it,
 * so deletes only start after the listing completes.
 */
async function collectLangfuseTraceIds({
  config,
  userId,
  fetchImpl,
}: {
  config: LangfuseConfig
  userId: string
  fetchImpl: typeof fetch
}): Promise<LangfuseCollectResult> {
  const traceIds: string[] = []
  const seen = new Set<string>()
  let listedObservations = 0
  let mismatchedRowsSkipped = 0
  let missingUserIdRows = 0
  let missingTraceIdRows = 0
  let truncated = false
  let failure: LangfuseCollectResult["failure"]
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    if (pages >= MAX_ERASURE_LIST_PAGES_PER_RUN) {
      truncated = true
      break
    }
    const page = await listObservationsByUserIdPage({
      config,
      userId,
      cursor,
      fetchImpl,
    })
    if (!page.ok) {
      failure = {
        reason: page.reason,
        ...(page.status !== undefined ? { status: page.status } : {}),
        ...(page.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: page.retryAfterSeconds }
          : {}),
      }
      break
    }
    pages += 1
    listedObservations += page.observationCount
    missingUserIdRows += page.missingUserIdCount
    missingTraceIdRows += page.missingTraceIdCount
    for (const row of page.rows) {
      // Exact value equality, never prefix or normalization (R2): the rows
      // are NOT pre-filtered by U5 — this is the one place ownership is
      // proven before an id may reach a delete batch (AE6).
      if (row.userId !== userId) {
        mismatchedRowsSkipped += 1
        continue
      }
      if (seen.has(row.traceId)) continue
      seen.add(row.traceId)
      traceIds.push(row.traceId)
    }
    if (!page.nextCursor) {
      // Pagination-drift guard (the sweep's `paginationSuspect` rationale):
      // a FULL page with no cursor smells like a drifted cursor field, which
      // would silently cap every listing at page one — and this module's
      // output licenses a completion claim, so a partial listing must
      // degrade to the loud incomplete outcome (`cap_exceeded`), never read
      // as complete.
      if (page.observationCount >= LANGFUSE_ERASURE_LIST_PAGE_SIZE) {
        truncated = true
      }
      break
    }
    cursor = page.nextCursor
  }
  return {
    traceIds,
    listedObservations,
    mismatchedRowsSkipped,
    missingUserIdRows,
    missingTraceIdRows,
    truncated,
    ...(failure !== undefined ? { failure } : {}),
  }
}

/**
 * The Langfuse half (U6): config gate → egress pin → list/re-check/dedupe →
 * (execute) budgeted batch deletes → ONE read-only requery. Runs AFTER the
 * Postgres half (F1) and independently of its outcome.
 *
 * Failure-shape decisions, documented where they bind:
 *  - A LIST-stage failure (or 429) deletes NOTHING — unlike the retention
 *    sweep, which deletes what it collected. The sweep has a daily rerun
 *    behind it and its upstream just proved healthy enough to answer pages;
 *    here a mid-listing fault means the upstream is misbehaving RIGHT NOW,
 *    and spending scarce delete quota into a failing/throttling upstream
 *    risks burning the day's headroom on requests that may also fail. The
 *    rerun (exit 2) is the recovery path either way.
 *  - A PAGE-CAP hit is different: the upstream is healthy, every collected
 *    id is proven, so the collected set IS deleted and the run reports
 *    incomplete (retention precedent; safe because exact-key reruns are
 *    idempotent).
 *  - `missingUserIdRows > 0` anywhere in the listing refuses the WHOLE half
 *    (R7) before any delete — ownership must be provable per row.
 */
async function runLangfuseHalf(
  mode: "preview" | "execute",
  resourceId: string,
  seam: AiChatErasureLangfuseSeam | undefined,
  sink: AiChatErasureLog,
): Promise<LangfuseErasureOutcome> {
  const config = (seam?.getConfig ?? getLangfuseTraceRetentionConfig)()
  if (!isLangfuseTraceRetentionConfigured(config)) {
    return { kind: "skipped_unconfigured" }
  }
  const allowedHosts = seam?.getAllowedHosts
    ? seam.getAllowedHosts()
    : env.LANGFUSE_ALLOWED_HOSTS
  if (!langfuseEgressAllowed(config.baseUrl, allowedHosts)) {
    // Loud and distinct (KTD11): a refused pin must never read as "no data".
    sink.warn("[ai-chat-erasure] event=langfuse_egress_refused")
    return { kind: "egress_refused" }
  }
  const fetchImpl = seam?.fetchImpl ?? fetch

  const collected = await collectLangfuseTraceIds({
    config,
    userId: resourceId,
    fetchImpl,
  })
  const counts: LangfuseErasureCounts = {
    listedObservations: collected.listedObservations,
    uniqueTraces: collected.traceIds.length,
    mismatchedRowsSkipped: collected.mismatchedRowsSkipped,
    missingTraceIdRows: collected.missingTraceIdRows,
    deleteRequests: 0,
    tracesSubmitted: 0,
  }

  // R7 refusal outranks everything after the pin: rows whose ownership cannot
  // be read poison the whole listing's trustworthiness, so no delete may
  // proceed — not even for rows that DID prove ownership.
  if (collected.missingUserIdRows > 0) {
    return {
      kind: "refused_unreadable_user_ids",
      missingUserIdRows: collected.missingUserIdRows,
      ...counts,
    }
  }
  // Unaddressable rows fail CLOSED the same way (in BOTH modes, zero deletes
  // issued): a v2 observation row without a readable `traceId` is the same
  // store-contract anomaly class as one without `userId` — today's real
  // listing carries both fields on every row. Deleting the addressable
  // subset and then reporting around the rest would blur the completeness
  // claim, and no rerun fixes it; escalation plus the runbook's break-glass
  // console path cover it.
  if (collected.missingTraceIdRows > 0) {
    return {
      kind: "refused_unaddressable_rows",
      ...counts,
      missingTraceIdRows: collected.missingTraceIdRows,
    }
  }
  if (collected.failure !== undefined) {
    if (collected.failure.reason === "rate_limited") {
      return {
        kind: "rate_limited",
        stage: "list",
        ...(collected.failure.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: collected.failure.retryAfterSeconds }
          : {}),
        ...counts,
      }
    }
    return {
      kind: "failed",
      stage: "list",
      reason: collected.failure.reason,
      ...(collected.failure.status !== undefined
        ? { status: collected.failure.status }
        : {}),
      ...counts,
    }
  }

  if (mode === "preview") {
    if (collected.truncated) {
      return { kind: "cap_exceeded", cap: "list_pages", ...counts }
    }
    // No KTD7-style sentinel probe guards this zero, deliberately: unlike
    // `listThreads`, which SWALLOWS store faults into empty results, the
    // HTTP listing classifies every fault into a non-ok reason handled
    // above — so a zero-row `ok` page is the server's genuine answer, not a
    // masked outage.
    // `mismatchedRowsSkipped` deliberately coexists with `no_data` (both
    // branches, here and execute below): other subjects' rows, outside the
    // claimed set by construction — the server filter over-returned and the
    // exact-equality re-check is what put them here (the plan's settled AE6
    // skip-and-count). Residual: an id-format drift moving the SUBJECT's own
    // rows into this counter would land on no_data — accepted (owner
    // decision, 2026-08-17); revisit only on a resource-key format migration.
    return collected.traceIds.length > 0
      ? { kind: "counted", ...counts }
      : { kind: "no_data", ...counts }
  }

  // ── Execute: budgeted batch deletes ──────────────────────────────────────
  if (collected.traceIds.length === 0 && !collected.truncated) {
    // No sentinel probe here either — see the preview no_data note above.
    return { kind: "no_data", ...counts }
  }
  const ids = collected.traceIds
  let tracesSubmitted = 0
  let deleteRequests = 0
  let deleteStop:
    | { kind: "cap" }
    | { kind: "rate_limited"; retryAfterSeconds: number }
    | { kind: "quota" }
    | {
        kind: "failed"
        reason: LangfuseErasureListFailureReason
        status?: number
      }
    | undefined
  while (tracesSubmitted < ids.length) {
    if (deleteRequests >= MAX_ERASURE_DELETE_REQUESTS_PER_RUN) {
      deleteStop = { kind: "cap" }
      break
    }
    const chunk = ids.slice(
      tracesSubmitted,
      tracesSubmitted + MAX_TRACE_IDS_PER_DELETE_REQUEST,
    )
    // Count the ATTEMPT before the call — a failed request still spends the
    // org-wide daily quota (same accounting as the retention sweep).
    deleteRequests += 1
    const result = await deleteTraceBatch({
      config,
      traceIds: chunk,
      fetchImpl,
    })
    if (!result.ok) {
      if (result.reason === "rate_limited") {
        const seconds = result.retryAfterSeconds
        deleteStop =
          seconds !== undefined &&
          seconds < ERASURE_QUOTA_RETRY_AFTER_THRESHOLD_SECONDS
            ? { kind: "rate_limited", retryAfterSeconds: seconds }
            : { kind: "quota" }
      } else {
        deleteStop = {
          kind: "failed",
          reason: result.reason,
          ...(result.status !== undefined ? { status: result.status } : {}),
        }
      }
      break
    }
    tracesSubmitted += chunk.length
  }
  const finalCounts: LangfuseErasureCounts = {
    ...counts,
    deleteRequests,
    tracesSubmitted,
  }
  const remainingTraces = ids.length - tracesSubmitted
  if (deleteStop !== undefined) {
    switch (deleteStop.kind) {
      case "cap":
        return {
          kind: "cap_exceeded",
          cap: "delete_requests",
          remainingTraces,
          ...finalCounts,
        }
      case "rate_limited":
        return {
          kind: "rate_limited",
          stage: "delete",
          retryAfterSeconds: deleteStop.retryAfterSeconds,
          remainingTraces,
          ...finalCounts,
        }
      case "quota":
        return {
          kind: "quota_exhausted",
          remainingTraces,
          impliedDaysToComplete: Math.ceil(
            remainingTraces / ERASURE_TRACES_PER_DAY,
          ),
          ...finalCounts,
        }
      case "failed":
        return {
          kind: "failed",
          stage: "delete",
          reason: deleteStop.reason,
          ...(deleteStop.status !== undefined
            ? { status: deleteStop.status }
            : {}),
          ...finalCounts,
        }
    }
  }
  if (collected.truncated) {
    // Everything collected was submitted, but the listing was cut short: the
    // run is knowably incomplete, so skip the requery (it could only restate
    // that) and report for a rerun.
    return { kind: "cap_exceeded", cap: "list_pages", ...finalCounts }
  }

  // ── ONE read-only requery (KTD6): count still-visible, NEVER re-delete ───
  // A re-submitted delete would double-spend quota on traces already pending
  // async deletion. "N still visible" is the normal terminal state (R15);
  // a requery that itself fails is reported inside the submitted outcome
  // rather than failing the run — the deletes were already accepted, and the
  // completion evidence is the operator's later preview rerun either way.
  const requery = await collectLangfuseTraceIds({
    config,
    userId: resourceId,
    fetchImpl,
  })
  if (requery.failure !== undefined) {
    return {
      kind: "submitted",
      requery: { ok: false, reason: requery.failure.reason },
      ...finalCounts,
    }
  }
  return {
    kind: "submitted",
    requery: { ok: true, stillVisibleTraces: requery.traceIds.length },
    ...finalCounts,
  }
}

/**
 * The ONE place a `PostgresErasureOutcome` becomes operator-facing text. Both
 * this module's log line and the CLI's report render through it, so a widened
 * union is a single edit rather than two switch chains drifting apart —
 * `formatLangfuseOutcome` below is its Langfuse sibling. Enum and counts
 * only (R4).
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

/**
 * The ONE place a `LangfuseErasureOutcome` becomes operator-facing text —
 * `formatPostgresOutcome`'s sibling, consumed by this module's completion log
 * AND the CLI report so the two can never drift. Enum and counts only (R4):
 * never a trace id, user id, or upstream text. Wording discipline the tests
 * pin: the daily-quota vocabulary (`daily_delete_quota` / `rerun_tomorrow`)
 * appears ONLY on the `quota_exhausted` branch — a list-stage 429 is a
 * read-bucket throttle and must never steer an operator at the delete quota.
 */
export function formatLangfuseOutcome(
  langfuse: LangfuseErasureOutcome,
): string {
  const shared = (counts: LangfuseErasureCounts): string =>
    ` listed=${counts.listedObservations} traces=${counts.uniqueTraces}` +
    ` mismatched_skipped=${counts.mismatchedRowsSkipped}` +
    (counts.missingTraceIdRows > 0
      ? ` missing_trace_id_rows=${counts.missingTraceIdRows}`
      : "")
  const deletes = (counts: LangfuseErasureCounts): string =>
    ` delete_requests=${counts.deleteRequests} traces_submitted=${counts.tracesSubmitted}`
  switch (langfuse.kind) {
    case "skipped_unconfigured":
    case "egress_refused":
      return `langfuse=${langfuse.kind}`
    case "counted":
      return `langfuse=counted${shared(langfuse)}`
    case "no_data":
      return `langfuse=no_data${shared(langfuse)}`
    case "submitted": {
      const requery = langfuse.requery.ok
        ? ` still_visible=${langfuse.requery.stillVisibleTraces}` +
          (langfuse.requery.stillVisibleTraces > 0
            ? " note=async_deletion_pending_verify_via_later_preview"
            : "")
        : ` requery=failed requery_reason=${langfuse.requery.reason} note=deletes_already_accepted_verify_via_later_preview`
      return `langfuse=submitted${shared(langfuse)}${deletes(langfuse)}${requery}`
    }
    case "rate_limited":
      return (
        `langfuse=rate_limited stage=${langfuse.stage}` +
        (langfuse.retryAfterSeconds !== undefined
          ? ` retry_after_s=${langfuse.retryAfterSeconds}`
          : "") +
        (langfuse.remainingTraces !== undefined
          ? ` remaining_traces=${langfuse.remainingTraces}`
          : "") +
        ` guidance=retry_shortly${shared(langfuse)}${deletes(langfuse)}`
      )
    case "quota_exhausted":
      return (
        `langfuse=quota_exhausted remaining_traces=${langfuse.remainingTraces}` +
        ` implied_days_to_complete=${langfuse.impliedDaysToComplete}` +
        ` guidance=daily_delete_quota_rerun_tomorrow${shared(langfuse)}${deletes(langfuse)}`
      )
    case "cap_exceeded":
      // Guidance differs by cap: past the delete-request cap the collected
      // ids were all SUBMITTED, and Langfuse deletion is ~15 min async — an
      // immediate rerun re-lists the same still-visible traces and
      // re-submits the same first chunks, burning another 10 org-quota
      // requests for zero progress. Only the list-page cap leaves genuinely
      // un-submitted work an immediate rerun can continue.
      return (
        `langfuse=cap_exceeded cap=${langfuse.cap}` +
        (langfuse.remainingTraces !== undefined
          ? ` remaining_traces=${langfuse.remainingTraces}`
          : "") +
        (langfuse.cap === "delete_requests"
          ? " guidance=rerun_after_async_deletion_settles wait_minutes=15"
          : " guidance=rerun_to_continue") +
        `${shared(langfuse)}${deletes(langfuse)}`
      )
    case "refused_unreadable_user_ids":
      return `langfuse=refused_unreadable_user_ids missing_user_id_rows=${langfuse.missingUserIdRows}${shared(langfuse)}`
    case "refused_unaddressable_rows":
      // The leading field IS the count `shared` would conditionally append,
      // so render the remaining shared counts explicitly rather than
      // printing it twice.
      return (
        `langfuse=refused_unaddressable_rows missing_trace_id_rows=${langfuse.missingTraceIdRows}` +
        ` listed=${langfuse.listedObservations} traces=${langfuse.uniqueTraces}` +
        ` mismatched_skipped=${langfuse.mismatchedRowsSkipped}`
      )
    case "failed":
      return (
        `langfuse=failed stage=${langfuse.stage} reason=${langfuse.reason}` +
        (langfuse.status !== undefined ? ` status=${langfuse.status}` : "") +
        `${shared(langfuse)}${deletes(langfuse)}`
      )
  }
}

/** Langfuse outcome kinds that make the completion line a WARN. */
const LANGFUSE_WARN_KINDS: ReadonlySet<LangfuseErasureOutcome["kind"]> =
  new Set([
    "egress_refused",
    "refused_unreadable_user_ids",
    "refused_unaddressable_rows",
    "rate_limited",
    "quota_exhausted",
    "cap_exceeded",
    "failed",
  ])

function logCompleted(
  log: AiChatErasureLog,
  mode: "preview" | "execute",
  postgres: PostgresErasureOutcome,
  langfuse: LangfuseErasureOutcome,
): void {
  const line = `[ai-chat-erasure] event=${mode}_complete ${formatPostgresOutcome(postgres)} ${formatLangfuseOutcome(langfuse)}`
  if (
    postgres.kind === "failed" ||
    postgres.kind === "unreachable" ||
    LANGFUSE_WARN_KINDS.has(langfuse.kind)
  ) {
    log.warn(line)
    return
  }
  log.info(line)
}

/**
 * The Postgres half, extracted so the two halves compose in `runErasure`
 * (Postgres first, then Langfuse — F1) with independent outcomes.
 */
async function runPostgresHalf(
  mode: "preview" | "execute",
  memory: AiChatErasureMemory,
  resourceId: string,
  sink: AiChatErasureLog,
): Promise<PostgresErasureOutcome> {
  // Probe BEFORE the counts (KTD7) — a swallowed store fault would otherwise
  // surface as a zero count and read as "no data found for this exact key".
  if (!(await probeStore(memory))) {
    sink.warn("[ai-chat-erasure] event=probe_failed stage=pre_count")
    return { kind: "unreachable" }
  }

  const collected = await collectThreadIds(memory, resourceId)
  if (!collected.ok) {
    return {
      kind: "failed",
      stage: "list",
      reason: collected.reason,
      threadsDeleted: 0,
    }
  }

  if (mode === "preview") {
    if (collected.threadIds.length > 0) {
      return { kind: "counted", threadCount: collected.threadIds.length }
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
      return { kind: "unreachable" }
    }
    return { kind: "no_data" }
  }

  // Second probe (KTD7): the collect phase can only report a zero list, and a
  // store that went down between the first probe and now would produce exactly
  // that. Re-prove liveness before committing to a destructive claim.
  if (!(await probeStore(memory))) {
    sink.warn("[ai-chat-erasure] event=probe_failed stage=pre_delete")
    return { kind: "unreachable" }
  }

  if (collected.threadIds.length === 0) {
    return { kind: "no_data" }
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
      return {
        kind: "failed",
        stage: "delete",
        reason: "store_error",
        threadsDeleted,
      }
    }
    // Vanished between collect and delete (deleted concurrently, or by an
    // earlier interrupted run): benign — the row is already gone, which is
    // what this run wanted.
    if (owner === null) continue
    // Fails CLOSED on an absent or null `resourceId`: ownership is proven per
    // thread, never assumed. Reaching here means the store contradicted its
    // own filter, so stop rather than delete one more row.
    if (owner.resourceId !== resourceId) {
      return {
        kind: "failed",
        stage: "delete",
        reason: "filter_mismatch",
        threadsDeleted,
      }
    }
    try {
      await memory.deleteThread(threadId)
    } catch {
      // Enum/count-only: the deleted-so-far count is what makes the rerun
      // guidance honest; the thrown message never appears anywhere.
      return {
        kind: "failed",
        stage: "delete",
        reason: "store_error",
        threadsDeleted,
      }
    }
    threadsDeleted += 1
  }
  // Messages and orphaned vectors ride `deleteThread`'s cascade — no separate
  // count is claimed for them, because none is observable here.
  return { kind: "erased", threadsDeleted }
}

async function runErasure(
  mode: "preview" | "execute",
  {
    resourceId,
    acquireMemory,
    log,
    langfuse: langfuseSeam,
  }: AiChatErasureOptions,
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

  // Postgres first, then Langfuse (F1) — and the Langfuse half runs whatever
  // the Postgres outcome was: the stores are independent, exact-key reruns
  // are idempotent, and a Postgres fault must not leave the subject's traces
  // standing when the Langfuse side is healthy. The CLI's exit code still
  // reflects the worst store.
  const postgres = await runPostgresHalf(
    mode,
    acquired.memory,
    resourceId,
    sink,
  )
  const langfuse = await runLangfuseHalf(mode, resourceId, langfuseSeam, sink)
  logCompleted(sink, mode, postgres, langfuse)
  return { kind: "completed", mode, postgres, langfuse }
}

/**
 * Read-only per-store count preview (R3/KD6). Deletes nothing in EITHER
 * store: the operator sees the blast radius before committing. Neither
 * `deleteThread` nor a Langfuse DELETE is ever issued on this path — the
 * unit suite asserts both directly.
 */
export function previewAiChatErasure(
  options: AiChatErasureOptions,
): Promise<AiChatErasureResult> {
  return runErasure("preview", options)
}

/**
 * Destructive run: collect-then-delete this resource's threads (and, through
 * `deleteThread`'s cascade, their messages and orphaned vectors), then the
 * Langfuse half — list/re-check/dedupe, budgeted batch deletes, one
 * read-only requery (KTD6). The caller owns the confirm gate — this function
 * assumes it already passed.
 */
export function executeAiChatErasure(
  options: AiChatErasureOptions,
): Promise<AiChatErasureResult> {
  return runErasure("execute", options)
}
