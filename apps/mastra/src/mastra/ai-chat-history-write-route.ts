/**
 * Bearer-gated WRITE surface for the ai-chat lane's persisted conversations
 * (feat-450): the rename handler behind `POST /forge-ai-chat-history-rename`,
 * registered in `./index.ts` with per-route in-handler validation (never
 * `/api/*` middleware — that breaks Studio). A sibling of the read-only
 * `ai-chat-history-route.ts` (feat-241), kept as its own module so the one
 * write path stays reviewable on its own; the two share only the lane's
 * admission, ownership, and title-clamp modules.
 *
 * Gate ladder, checked in order (plan KTD2): the shared lane admission
 * preamble (`refuseUnlessLaneAdmitted`, feat-283 — `SEEKER_ROUTE_ENABLED` →
 * 404, then the dedicated `AI_CHAT_SERVICE_API_KEYS` lane bearer → 401, key
 * sourcing inside that module) → body guard → `user:`-resource refusal
 * (R13: `anon:*` and the dogfood fallback are never renamable) → backend gate
 * (KTD4, below) → ownership → clamp → the guarded UPDATE, every store await
 * bounded by `TIME_BUDGET_MS.historyRead` (8s — strictly below the chat
 * proxy's window, so this route's clean `timeout` wins the race).
 *
 * WHY DIRECT SQL, NOT THE MEMORY API (plan KTD3): both `updateThread` and
 * `saveThread` in the installed `@mastra/pg` 1.22.3 unconditionally SET
 * `updatedAt`, and `updateThread` carries no resource predicate. A rename is
 * not conversation activity (KD6): bumping `updatedAt` would move the row to
 * the top of the rail (the list route orders `updatedAt DESC`) and reset the
 * 25-day retention clock (`ai-chat-retention.ts` keys the window on it). So
 * the write is a parameterized `UPDATE … SET title = $1 WHERE id = $2 AND
 * "resourceId" = $3` — `updatedAt` and `updatedAtZ` deliberately absent from
 * the SET clause, and the ownership predicate INSIDE the UPDATE's WHERE with
 * exact equality on the caller's resolved resource (atomic check-and-claim;
 * SQL `=` is the named exemption from a client-side re-check in the
 * single-predicate blast-radius law). `rowCount === 0` after the ownership
 * resolver passed means the thread vanished in the race → `thread_not_found`.
 *
 * PINNED DIST FACT (re-verify on every `@mastra/*` bump): the SET-clause
 * omission preserves `updatedAt` ONLY because no database trigger bumps the
 * column either. `@mastra/pg` installs its `trigger_set_timestamps` BEFORE
 * INSERT OR UPDATE trigger — which DOES rewrite `updatedAt`/`updatedAtZ` to
 * NOW() — for `TABLE_SPANS` alone (`if (tableName === TABLE_SPANS) { await
 * this.setupTimestampTriggers(tableName) }`), never for `mastra_threads`.
 * Re-verified 2026-09-06 against `@mastra/pg` 1.22.3 (title-repair's read was
 * 2026-08-28). The dist-pin test in `ai-chat-history-write-route.test.ts`
 * fails the suite on any bump that widens that gate.
 *
 * SAME STORE BY CONSTRUCTION (plan KTD4): the ownership read and the SQL
 * write must target the same Postgres. Ownership resolves through
 * `resolveOwnedExistingThread` over a module-cached Memory built DIRECTLY
 * over `getAiChatStorage()` (the retention/erasure construction), never the
 * backend-resolved `getAiChatMemory()` — under the `AI_CHAT_MEMORY_BACKEND=
 * memory` kill-switch that is an InMemoryStore, and a lookup over it would
 * answer a false `thread_not_found` for a thread that exists in Postgres. The
 * pool's connection string comes from the same `getMastraDatabaseUrl()`
 * resolver `buildAiChatStorage` uses, so read and write cannot diverge. And
 * BEFORE any store or pool construction the route checks
 * `resolveAiChatMemoryBackend() === "postgres"`, otherwise 503
 * `writes_disabled`: the kill-switch reverts writes, a title is user-authored
 * content landing in Postgres, and refusing with a distinct reason is honest.
 * This deliberately diverges from title-repair's explicit `env.DATABASE_URL`
 * refusal (and from the erasure tool's): that rationale protects a scheduled
 * BULK job from a wrong-database target, while this route's target is by
 * definition the store the listing just served the row from.
 *
 * WRITE-LEG INDETERMINACY (review finding, 2026-09-02): `settleWithinBudget`
 * out-races the inner promise without aborting it, and ONE 8s signal spans
 * the ownership read and the UPDATE. A slow ownership read can therefore
 * leave the budget firing while a 5s-ceilinged UPDATE is still in flight and
 * commits, so a 504 `timeout` (or a 500 `store_failed` from a connection
 * dropped after dispatch) does NOT mean the title was not stored. Both are
 * INDETERMINATE on the write leg; the pool's ceilings keep the window
 * narrow, and the client re-hydrates the row on its next page fetch rather
 * than assuming the old title survived. The write is idempotent, so a retry
 * is always safe.
 *
 * Logging is ENUM-only plain-string `[ai-chat-history] event=… reason=…` —
 * never a title, thread id, resource id, or exception text (R15).
 */

import { Memory } from "@mastra/memory"
import { Pool } from "pg"

import { getMastraDatabaseUrl, resolveAiChatMemoryBackend } from "../config/env"

import { refuseUnlessLaneAdmitted } from "./ai-chat-lane-admission"
import { AI_CHAT_SCHEMA_NAME, getAiChatStorage } from "./ai-chat-memory"
import {
  resolveOwnedExistingThread,
  USER_RESOURCE_PREFIX,
  type AiChatOwnershipMemory,
} from "./ai-chat-thread-ownership"
import { clampAiChatTitle } from "./ai-chat-title-clamp"
import { settleWithinBudget, TIME_BUDGET_MS } from "./budgets"

/**
 * Raw `title` bound in UTF-16 code units, checked BEFORE the clamp (plan
 * Assumptions): anything longer is 400 `invalid_body`, never silently cut.
 * The chat proxy mirrors this bound; the stored value is then clamped to
 * `AI_CHAT_TITLE_MAX_UNITS` (120).
 */
export const AI_CHAT_RENAME_TITLE_MAX_RAW_UNITS = 1_024

/** Mirrors the chat proxy's MAX_CONVERSATION_ID_CHARS bound (as the read
 * routes' `threadId` guard does). */
const MAX_THREAD_ID_CHARS = 200

/**
 * The rename pool's options, exported so the suite can pin them. Small and
 * lazy (module-scoped, opened on the first rename — never at import); every
 * ceiling is strictly below the 8s route budget because `settleWithinBudget`
 * races without aborting the inner query, so the pool's own timeouts are what
 * actually release the connection. Counted as its own module-scoped category
 * in the pool census in `ai-chat-memory.ts`'s header.
 */
export const AI_CHAT_RENAME_POOL_OPTIONS = {
  max: 2,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 2_000,
  query_timeout: 5_000,
  statement_timeout: 5_000,
} as const

const THREADS_TABLE = `${AI_CHAT_SCHEMA_NAME}.mastra_threads`

/**
 * The guarded title write (KTD3). SET `title` ONLY — no `"updatedAt"`, no
 * `"updatedAtZ"` (KD6/R12; see the header). WHERE binds the thread id AND
 * the caller's resolved resource with exact equality. Params: $1 clamped
 * title, $2 thread id, $3 resource.
 */
const TITLE_UPDATE_SQL = `UPDATE ${THREADS_TABLE}
SET title = $1
WHERE id = $2 AND "resourceId" = $3`

/** The narrow Memory surface the rename needs — the ownership resolver's
 * `getThreadById` only; structural so tests fake it. */
export type AiChatRenameMemory = Pick<AiChatOwnershipMemory, "getThreadById">

/** The narrow pg surface the rename needs — structural so tests fake it. */
export type AiChatRenamePool = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rowCount: number | null }>
}

/** Buffered-JSON route outcome (`{ status, body }` — index.ts wraps it). */
export type AiChatHistoryRenameRouteOutcome = { status: number; body: unknown }

/**
 * Handler input. Seams mirror the read routes': `getEnabled` / `getServiceKeys`
 * forward to the admission module's defaults (a registration passes neither),
 * `getBackend` defaults to the env resolver, `getMemory` / `getPool` default
 * to the module-cached persisted-store Memory and the lazy pool, `budgetMs`
 * makes the timeout branch deterministic.
 */
export type AiChatHistoryRenameHandlerInput = {
  authHeader: string | null | undefined
  readJson: () => Promise<unknown>
  getEnabled?: () => boolean
  getServiceKeys?: () => readonly string[]
  getBackend?: () => "postgres" | "memory"
  getMemory?: () => AiChatRenameMemory
  getPool?: () => AiChatRenamePool
  budgetMs?: number
}

function jsonOutcome(
  status: number,
  body: unknown,
): AiChatHistoryRenameRouteOutcome {
  return { status, body }
}

type AiChatRenameBody = {
  resourceId: string
  threadId: string
  title: string
}

/**
 * Body guard (KTD2): `resourceId` a string (an EMPTY string passes here and
 * is refused by the resource gate — 403, not 400), `threadId` non-empty and
 * at most 200 units, `title` a string of at most 1,024 raw units. Anything
 * else is 400 `invalid_body`.
 */
function parseRenameBody(value: unknown): AiChatRenameBody | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as {
    resourceId?: unknown
    threadId?: unknown
    title?: unknown
  }
  if (typeof v.resourceId !== "string") return null
  if (
    typeof v.threadId !== "string" ||
    v.threadId.length === 0 ||
    v.threadId.length > MAX_THREAD_ID_CHARS
  ) {
    return null
  }
  if (
    typeof v.title !== "string" ||
    v.title.length > AI_CHAT_RENAME_TITLE_MAX_RAW_UNITS
  ) {
    return null
  }
  return { resourceId: v.resourceId, threadId: v.threadId, title: v.title }
}

let cachedRenameMemory: AiChatRenameMemory | null = null

/**
 * The Memory the ownership read runs over: built DIRECTLY over the persisted
 * `ai_chat` store (see the header — never the kill-switch-resolved Memory).
 * Lazy singleton wrapping the PostgresStore singleton, so no extra pool.
 */
function getPersistedAiChatRenameMemory(): AiChatRenameMemory {
  if (cachedRenameMemory === null) {
    cachedRenameMemory = new Memory({ storage: getAiChatStorage() })
  }
  return cachedRenameMemory
}

let cachedRenamePool: AiChatRenamePool | null = null

/**
 * The rename pool: module-scoped and lazy, opened on the first rename. Its
 * connection string is the SAME resolver the ai-chat store uses, so the
 * ownership read and the title write cannot target different databases.
 *
 * The `error` listener is load-bearing, not hygiene: pg-pool re-attaches an
 * idle listener to every released client and calls `pool.emit("error", …)`
 * when an IDLE client fails (a Postgres-side reset, a dropped socket), and an
 * `error` event with no listener is an uncaught exception — process-fatal in
 * this single-replica runtime, which registers no global handler. The
 * `@mastra/pg` store attaches its own; this pool is ours to guard. Enum-only
 * log: the error can carry the connection string.
 */
function getAiChatRenamePool(): AiChatRenamePool {
  if (cachedRenamePool === null) {
    const pool = new Pool({
      connectionString: getMastraDatabaseUrl(),
      ...AI_CHAT_RENAME_POOL_OPTIONS,
    })
    pool.on("error", () => {
      console.warn("[ai-chat-history] event=rename_pool_idle_error")
    })
    cachedRenamePool = pool
  }
  return cachedRenamePool
}

/** Test-only reset hooks. Production never resets the singletons. */
export function __resetAiChatRenameStoreForTesting(): void {
  cachedRenameMemory = null
  cachedRenamePool = null
}

/**
 * `POST /forge-ai-chat-history-rename` core (R11/R12/R13/R14/R15): set an
 * owned thread's title without touching `updatedAt`. Returns the
 * `{ status, body }` outcome; success body is `{ ok: true, title }` with the
 * CLAMPED title the store now holds. Refusals: 400 `invalid_body` |
 * `invalid_title`, 403 `resource_forbidden` | `thread_forbidden`, 404
 * `thread_not_found`, 503 `writes_disabled`, 500 `store_failed`, 504
 * `timeout` (plus the admission preamble's 404/401 bodies).
 */
export async function handleAiChatHistoryRenameRequest({
  authHeader,
  readJson,
  getEnabled,
  getServiceKeys,
  getBackend = resolveAiChatMemoryBackend,
  getMemory = getPersistedAiChatRenameMemory,
  getPool = getAiChatRenamePool,
  budgetMs = TIME_BUDGET_MS.historyRead,
}: AiChatHistoryRenameHandlerInput): Promise<AiChatHistoryRenameRouteOutcome> {
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return refusal

  const raw = await readJson().catch(() => undefined)
  const body = parseRenameBody(raw)
  if (!body) return jsonOutcome(400, { reason: "invalid_body" })

  // R13: only signed-in resources may rename — the shared dogfood fallback,
  // anon:* ids, and anything else un-prefixed are refused before any store I/O.
  if (!body.resourceId.startsWith(USER_RESOURCE_PREFIX)) {
    console.warn(
      "[ai-chat-history] event=resource_rejected surface=rename reason=resource_forbidden",
    )
    return jsonOutcome(403, { reason: "resource_forbidden" })
  }

  // KTD4: the kill-switch reverts writes. Refuse with a distinct reason
  // BEFORE any Memory or pool is constructed — a lookup over the swapped-in
  // InMemoryStore would answer a false thread_not_found instead.
  if (getBackend() !== "postgres") {
    console.warn(
      "[ai-chat-history] event=rename_refused reason=writes_disabled",
    )
    return jsonOutcome(503, { reason: "writes_disabled" })
  }

  const budgetSignal = AbortSignal.timeout(budgetMs)
  try {
    // Inside the try (matching the read handlers): a sync construction throw
    // must map to store_failed, never escape the closed outcome shape.
    const memory = getMemory()
    const resolution = await settleWithinBudget(
      resolveOwnedExistingThread({
        memory,
        threadId: body.threadId,
        resource: body.resourceId,
      }),
      budgetSignal,
    )
    if (!resolution.ok) {
      console.warn(
        `[ai-chat-history] event=thread_access_rejected surface=rename reason=${resolution.reason}`,
      )
      return jsonOutcome(resolution.reason === "thread_forbidden" ? 403 : 404, {
        reason: resolution.reason,
      })
    }

    // Refuse on the CLAMPED result alone, whatever the raw input was: an
    // empty stored title would drop the thread back into the titling and
    // repair path (`title = ''`), so it is never a valid rename. (Title-repair's
    // raw-vs-clamped comparison tells a generation failure from an untitled
    // thread; it has no meaning on a write route.)
    // The shared UTF-16 cap can split a surrogate pair. Match pg's UTF-8
    // encoding before binding and echoing, so the response equals the stored
    // title even when that encoding replaces a lone surrogate with U+FFFD.
    const title = Buffer.from(clampAiChatTitle(body.title), "utf8").toString(
      "utf8",
    )
    if (title.length === 0) {
      console.warn(
        "[ai-chat-history] event=rename_rejected reason=invalid_title",
      )
      return jsonOutcome(400, { reason: "invalid_title" })
    }

    const result = await settleWithinBudget(
      getPool().query(TITLE_UPDATE_SQL, [
        title,
        body.threadId,
        body.resourceId,
      ]),
      budgetSignal,
    )
    if ((result.rowCount ?? 0) === 0) {
      // The resolver passed microseconds ago; a 0-row UPDATE means the thread
      // vanished (retention purge, erasure) in between. Not an error: the
      // same wire outcome as a missing thread.
      console.warn(
        "[ai-chat-history] event=rename_raced reason=thread_not_found",
      )
      return jsonOutcome(404, { reason: "thread_not_found" })
    }
    return jsonOutcome(200, { ok: true, title })
  } catch {
    // Fail CLOSED: a store outage (including the resolver's getThreadById
    // throw) is a generic failure — never thread_not_found, never exception
    // text.
    const reason = budgetSignal.aborted ? "timeout" : "store_failed"
    console.warn(`[ai-chat-history] event=rename_failed reason=${reason}`)
    return jsonOutcome(reason === "timeout" ? 504 : 500, { reason })
  }
}
